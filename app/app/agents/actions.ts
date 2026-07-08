"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { buildWorkspaceEvidenceContext, evidenceContextAsJson } from "@/lib/ai/evidence-index";
import { cleanVaeroexErrorMessage } from "@/lib/ai/errors";
import { runVaeroexCompletionWithUsage } from "@/lib/ai/vaeroex-client";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { getVaeroexWorkflow, type VaeroexSaveTarget } from "@/lib/ai/vaeroex-workflows";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { buildWorkspaceSnapshot } from "@/lib/ai/workspace-snapshot";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { requireToolExecution, type RegisteredToolName } from "@/lib/security/tool-execution-gateway";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type JsonRecord = Record<string, unknown>;

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === null || value === undefined || value === "") {
    return [];
  }

  return [value];
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function priority(value: unknown) {
  const candidate = str(value, "Medium");
  return ["Low", "Medium", "High", "Urgent"].includes(candidate) ? candidate : "Medium";
}

function dateOrNull(value: unknown) {
  const candidate = str(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function redirectWithError(message: string): never {
  redirect(`/app/agents?error=${encodeURIComponent(message)}`);
}

async function requireWorkspace() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectWithError("Supabase is not configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const context = await getWorkspaceContext();

  if (!context.activeWorkspace) {
    redirect("/app/setup");
  }

  if (!context.membership || context.membership.workspace_id !== context.activeWorkspace.id || context.membership.status !== "active") {
    redirect("/app/setup?error=Workspace access is required.");
  }

  await requireActiveSubscription({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId: context.activeWorkspace.id
  });

  return {
    supabase,
    user,
    workspaceId: context.activeWorkspace.id,
    membership: context.membership
  };
}

function buildInputJson(workflowKey: string, userPrompt: string, extraInputs: Json, workspaceSnapshot: Json) {
  return {
    workflow: workflowKey,
    user_prompt: userPrompt,
    extra_inputs: extraInputs,
    workspace_snapshot: workspaceSnapshot
  } satisfies Json;
}

async function storeFailedRun({
  workspaceId,
  userId,
  workflowKey,
  inputJson,
  message
}: {
  workspaceId: string;
  userId: string;
  workflowKey: string;
  inputJson: Json;
  message: string;
}) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return null;
  }

  const { data } = await supabase
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: workflowKey,
      input_json: inputJson,
      output_json: {} satisfies Json,
      status: "failed",
      error_message: message,
      created_by: userId
    })
    .select("id")
    .maybeSingle();

  return data?.id ?? null;
}

export async function runVaeroexAction(formData: FormData) {
  const { supabase, user, workspaceId } = await requireWorkspace();
  const workflow = getVaeroexWorkflow(text(formData, "workflow_key"));
  const userPrompt = text(formData, "user_prompt");
  const extraInputs = {
    date_range_start: text(formData, "date_range_start"),
    date_range_end: text(formData, "date_range_end"),
    subject: text(formData, "subject")
  } satisfies Json;
  let workspaceSnapshot = {} as Json;
  let inputJson = buildInputJson(workflow.key, userPrompt, extraInputs, workspaceSnapshot);
  let destination = "/app/agents";

  try {
    const rateLimit = await enforceRateLimit({
      action: "vaeroex.run",
      limit: 12,
      windowSeconds: 10 * 60,
      userId: user.id,
      workspaceId,
      identifiers: [workflow.key],
      metadata: { source: "ask_vaeroex", workflow: workflow.key }
    });

    if (!rateLimit.allowed) {
      throw new Error(rateLimitMessage(rateLimit));
    }

    const limit = await isUsageLimitReached({
      supabase,
      userId: user.id,
      email: user.email,
      workspaceId,
      limit: "ai_runs_this_month"
    });

    if (limit.reached) {
      throw new Error("You’ve reached the monthly Vaeroex usage limit for this workspace.");
    }

    workspaceSnapshot = (await buildWorkspaceSnapshot(supabase, workspaceId)) as Json;
    const evidenceContext = await buildWorkspaceEvidenceContext({
      supabase,
      workspaceId,
      query: `${workflow.title}\n${userPrompt}\n${extraInputs.subject || ""}`
    });
    const evidenceAwareInputs = {
      ...extraInputs,
      evidence_context: evidenceContextAsJson(evidenceContext)
    } satisfies Json;
    inputJson = buildInputJson(workflow.key, userPrompt, evidenceAwareInputs, workspaceSnapshot);

    const { outputJson, usage } = await runVaeroexCompletionWithUsage({
      workflow,
      userPrompt,
      workspaceSnapshot,
      extraInputs: evidenceAwareInputs
    });

    const { data, error } = await supabase
      .from("ai_agent_runs")
      .insert({
        workspace_id: workspaceId,
        agent_type: workflow.key,
        input_json: inputJson,
        output_json: outputJson,
        status: "completed",
        created_by: user.id
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Vaeroex run could not be saved.");
    }

    await recordVaeroexAiUsage({
      supabase,
      workspaceId,
      userId: user.id,
      agentType: workflow.key,
      usage: {
        ...usage,
        metadata: {
          evidence_retrieval_mode: evidenceContext.retrievalMode,
          evidence_chunks: evidenceContext.chunks.length,
          evidence_confidence_score: evidenceContext.confidenceScore
        }
      }
    });

    revalidatePath("/app/agents");
    destination = `/app/agents?run=${data.id}`;
  } catch (error) {
    const message = cleanVaeroexErrorMessage(error instanceof Error ? error.message : undefined);
    const failedRunId = await storeFailedRun({
      workspaceId,
      userId: user.id,
      workflowKey: workflow.key,
      inputJson,
      message
    });
    revalidatePath("/app/agents");
    destination = `/app/agents${failedRunId ? `?run=${failedRunId}&` : "?"}error=${encodeURIComponent(message)}`;
  }

  redirect(destination as Route);
}

async function getRun(runId: string) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const { data: run, error } = await supabase
    .from("ai_agent_runs")
    .select("*")
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !run) {
    redirectWithError(error?.message || "Vaeroex result not found.");
  }

  return { supabase, user, workspaceId, membership, run, output: asRecord(run.output_json) };
}

function taskDrafts(output: JsonRecord) {
  return [
    ...asArray(output.suggested_tasks),
    ...asArray(output.tasks),
    ...asArray(output.follow_up_tasks)
  ].map((task, index) => {
    const record = asRecord(task);
    const title = str(record.title, typeof task === "string" ? task : `Vaeroex review ${index + 1}`);
    const description =
      str(record.description) ||
      str(record.reason_this_matters) ||
      str(record.recommended_action) ||
      "Review this Vaeroex recommendation as an executive intelligence signal.";

    return {
      title,
      description,
      priority: priority(record.priority),
      category: str(record.category, "Vaeroex review"),
      due_date: dateOrNull(record.due_date) ?? dateOrNull(record.recommended_due_date)
    };
  });
}

function fieldSchema(fields: unknown, formName: string): Json {
  const values = asArray(fields).length ? asArray(fields) : ["Submitted by", "Business details", "Priority", "Manager notes"];

  return values.map((field, index) => {
    const record = asRecord(field);
    const label = str(record.label, typeof field === "string" ? field : `Field ${index + 1}`);
    return {
      key: slugify(str(record.key, `${formName}-${label}`)) || `field-${index + 1}`,
      label,
      type: str(record.type, label.toLowerCase().includes("priority") ? "priority" : "text"),
      required: typeof record.required === "boolean" ? record.required : index < 2
    };
  }) as Json;
}

function formDrafts(output: JsonRecord) {
  const drafts = [...asArray(output.form), ...asArray(output.forms), ...asArray(output.suggested_forms)];

  return drafts.map((draft, index) => {
    const record = asRecord(draft);
    const name = str(record.name, typeof draft === "string" ? draft : `Vaeroex form ${index + 1}`);
    return {
      name,
      description: str(record.description, str(record.purpose, "Draft generated by Vaeroex for manager review.")),
      form_type: str(record.form_type, "operations"),
      schema_json: fieldSchema(record.fields ?? record.recommended_fields, name)
    };
  });
}

function checklistDrafts(output: JsonRecord) {
  const drafts = [...asArray(output.checklist), ...asArray(output.checklists), ...asArray(output.suggested_checklists)];

  return drafts.map((draft, index) => {
    const record = asRecord(draft);
    const name = str(record.name, str(record.checklist_name, typeof draft === "string" ? draft : `Vaeroex checklist ${index + 1}`));
    const items = asArray(record.items ?? record.checklist_items).map((item) =>
      typeof item === "string" ? item : str(asRecord(item).label, str(asRecord(item).title, "Checklist item"))
    );

    return {
      name,
      description: str(record.description, str(record.purpose, "Draft generated by Vaeroex for manager review.")),
      category: str(record.category, "Operations"),
      frequency: str(record.frequency, "As needed"),
      assigned_role: str(record.assigned_role, str(record.owner_role, "Manager")),
      items_json: (items.length ? items : ["Review evidence", "Document decision", "Identify source-system implications", "Prepare leadership review"]) as Json
    };
  });
}

function sopDrafts(output: JsonRecord) {
  const drafts = [...asArray(output.sop), ...asArray(output.sops), ...asArray(output.suggested_sops)];

  return drafts.map((draft, index) => {
    const record = asRecord(draft);
    const title = str(record.title, typeof draft === "string" ? draft : `Vaeroex SOP ${index + 1}`);
    return {
      title,
      department: str(record.department, "Operations"),
      category: str(record.category, "Vaeroex draft"),
      body_markdown:
        str(record.body_markdown) ||
        str(record.content_markdown) ||
        str(record.markdown) ||
        `# ${title}\n\nDraft generated by Vaeroex for manager review.`,
      version: Number(record.version || 1)
    };
  });
}

function reportDrafts(output: JsonRecord) {
  const drafts = [...asArray(output.report), ...asArray(output.reports)];

  if (!drafts.length && (output.response_markdown || output.summary)) {
    drafts.push(output);
  }

  return drafts.map((draft, index) => {
    const record = asRecord(draft);
    const title = str(record.title, index === 0 ? "Operations Report - Generated by Vaeroex" : `Operations Report ${index + 1} - Generated by Vaeroex`);
    return {
      title: title.includes("Vaeroex") ? title : `${title} - Generated by Vaeroex`,
      report_type: str(record.report_type, "Operations Report"),
      date_range_start: dateOrNull(record.date_range_start),
      date_range_end: dateOrNull(record.date_range_end),
      body_markdown:
        str(record.body_markdown) ||
        str(record.response_markdown) ||
        str(output.response_markdown) ||
        `# ${title}\n\nGenerated by Vaeroex.\n\n${str(record.summary, str(output.summary, "Summary pending manager review."))}`
    };
  });
}

async function appendSavedRecord(runId: string, target: VaeroexSaveTarget, output: JsonRecord, ids: string[]) {
  const { supabase, workspaceId } = await requireWorkspace();
  const savedRecords = asArray(output.saved_records).filter(isRecord);
  const nextOutput = {
    ...output,
    saved_records: [
      ...savedRecords,
      {
        target,
        ids,
        count: ids.length,
        saved_at: new Date().toISOString()
      }
    ]
  } as Json;

  await supabase
    .from("ai_agent_runs")
    .update({ output_json: nextOutput })
    .eq("id", runId)
    .eq("workspace_id", workspaceId);
}

function redirectSaved(runId: string, count: number, target: VaeroexSaveTarget): never {
  redirect(`/app/agents?run=${runId}&saved=${encodeURIComponent(`${count} ${target} saved`)}`);
}

export async function saveVaeroexOutputAction(formData: FormData) {
  const runId = text(formData, "run_id");
  const target = text(formData, "save_target") as VaeroexSaveTarget;

  if (!runId || !["tasks", "sop", "form", "checklist", "report"].includes(target)) {
    redirectWithError("Choose a Vaeroex result and save target.");
  }

  const { supabase, user, workspaceId, membership, run, output } = await getRun(runId);
  const toolByTarget: Record<VaeroexSaveTarget, RegisteredToolName> = {
    tasks: "save_vaeroex_output_tasks",
    form: "save_vaeroex_output_form",
    checklist: "save_vaeroex_output_checklist",
    sop: "save_vaeroex_output_sop",
    report: "save_vaeroex_output_report"
  };
  await requireToolExecution<{ runId: string }>(
    {
      supabase,
      workspaceId,
      userId: user.id,
      userRole: membership.role
    },
    {
      toolName: toolByTarget[target],
      args: { runId },
      initiatedBy: "user",
      confirmationReceived: true,
      targetRecordId: run.id,
      metadata: {
        save_target: target,
        agent_type: run.agent_type
      } satisfies Json
    }
  );
  const createdIds: string[] = [];

  if (target === "tasks") {
    const drafts = taskDrafts(output);

    if (!drafts.length) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent("This Vaeroex result has no task drafts to save.")}`);
    }

    const { data, error } = await supabase
      .from("tasks")
      .insert(
        drafts.map((task) => ({
          workspace_id: workspaceId,
          title: task.title,
          description: task.description,
          status: "To Do",
          priority: task.priority,
          category: task.category,
          due_date: task.due_date,
          related_type: "vaeroex_run",
          related_id: run.id,
          ai_generated: true,
          created_by: user.id
        }))
      )
      .select("id");

    if (error) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent(error.message)}`);
    }

    createdIds.push(...(data || []).map((item) => item.id));
    revalidatePath("/app/tasks");
  }

  if (target === "form") {
    const drafts = formDrafts(output);

    if (!drafts.length) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent("This Vaeroex result has no form draft to save.")}`);
    }

    const { data, error } = await supabase
      .from("forms")
      .insert(
        drafts.map((form) => ({
          workspace_id: workspaceId,
          name: form.name,
          description: form.description,
          form_type: form.form_type,
          schema_json: form.schema_json,
          is_public: false,
          public_slug: null,
          created_by: user.id
        }))
      )
      .select("id");

    if (error) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent(error.message)}`);
    }

    createdIds.push(...(data || []).map((item) => item.id));
    revalidatePath("/app/forms");
  }

  if (target === "checklist") {
    const drafts = checklistDrafts(output);

    if (!drafts.length) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent("This Vaeroex result has no checklist draft to save.")}`);
    }

    const { data, error } = await supabase
      .from("checklists")
      .insert(
        drafts.map((checklist) => ({
          workspace_id: workspaceId,
          name: checklist.name,
          description: checklist.description,
          category: checklist.category,
          frequency: checklist.frequency,
          items_json: checklist.items_json,
          assigned_role: checklist.assigned_role,
          created_by: user.id
        }))
      )
      .select("id");

    if (error) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent(error.message)}`);
    }

    createdIds.push(...(data || []).map((item) => item.id));
    revalidatePath("/app/checklists");
  }

  if (target === "sop") {
    const drafts = sopDrafts(output);

    if (!drafts.length) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent("This Vaeroex result has no SOP draft to save.")}`);
    }

    const { data, error } = await supabase
      .from("sops")
      .insert(
        drafts.map((sop) => ({
          workspace_id: workspaceId,
          title: sop.title,
          department: sop.department,
          category: sop.category,
          body_markdown: sop.body_markdown,
          status: "Draft",
          version: sop.version,
          created_by: user.id,
          ai_generated: true
        }))
      )
      .select("id");

    if (error) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent(error.message)}`);
    }

    createdIds.push(...(data || []).map((item) => item.id));
    revalidatePath("/app/sops");
  }

  if (target === "report") {
    const drafts = reportDrafts(output);

    if (!drafts.length) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent("This Vaeroex result has no report draft to save.")}`);
    }

    const { data, error } = await supabase
      .from("reports")
      .insert(
        drafts.map((report) => ({
          workspace_id: workspaceId,
          report_type: report.report_type,
          title: report.title,
          date_range_start: report.date_range_start,
          date_range_end: report.date_range_end,
          body_markdown: report.body_markdown,
          source_data_json: {
            vaeroex_run_id: run.id,
            workflow: run.agent_type,
            saved_at: new Date().toISOString()
          } satisfies Json,
          created_by: user.id
        }))
      )
      .select("id");

    if (error) {
      redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent(error.message)}`);
    }

    createdIds.push(...(data || []).map((item) => item.id));
    revalidatePath("/app/reports");
  }

  if (!createdIds.length) {
    redirect(`/app/agents?run=${run.id}&error=${encodeURIComponent("No records were saved from this Vaeroex result.")}`);
  }

  await appendSavedRecord(run.id, target, output, createdIds);
  revalidatePath("/app/agents");
  revalidatePath("/app");
  redirectSaved(run.id, createdIds.length, target);
}
