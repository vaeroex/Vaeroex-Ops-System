"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { VAEROEX_SYSTEM_PROMPT } from "@/lib/ai/prompts/vaeroex-system-prompt";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { approvedKpiColor, KPI_COLOR_PALETTE } from "@/lib/kpis/settings";
import { requireToolExecution } from "@/lib/security/tool-execution-gateway";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function bool(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function lines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function validateLength(path: string, label: string, value: string, maxLength: number) {
  if (value.length > maxLength) {
    redirectWithError(path, `${label} must be ${maxLength} characters or fewer.`);
  }
}

function requireValue(path: string, label: string, value: string, maxLength = 160) {
  if (!value) {
    redirectWithError(path, `${label} is required.`);
  }

  validateLength(path, label, value, maxLength);
}

function redirectWithError(path: string, message: string): never {
  redirect(pathWithParams(path, { error: message }) as Route);
}

function pathWithParams(path: string, params: Record<string, string>) {
  const hashIndex = path.indexOf("#");
  const pathWithoutHash = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const separator = pathWithoutHash.includes("?") ? "&" : "?";
  const query = new URLSearchParams(params).toString();

  return `${pathWithoutHash}${separator}${query}${hash}`;
}

function redirectWithMessage(path: string, message: string): never {
  redirect(pathWithParams(path, { message }) as Route);
}

function redirectWithMessageParams(path: string, message: string, params: Record<string, string>): never {
  redirect(pathWithParams(path, { message, ...params }) as Route);
}

function returnPath(formData: FormData, fallback: string) {
  const value = text(formData, "return_path");
  return value.startsWith("/app") ? value : fallback;
}

function optionalNumber(path: string, label: string, value: string) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    redirectWithError(path, `${label} must be a valid number.`);
  }

  return parsed;
}

function metricDateOrToday(path: string, value: string) {
  const metricDate = value || new Date().toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(metricDate)) {
    redirectWithError(path, "Date must use the YYYY-MM-DD format.");
  }

  return metricDate;
}

async function requireWorkspace(path: string) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectWithError(path, "Supabase is not configured.");
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

function formSchemaFromLines(fieldLines: string): Json {
  const values = lines(fieldLines);
  const fields = values.length ? values : ["Submitted by", "Business details", "Priority", "Manager notes"];

  return fields.map((field, index) => ({
    key: slugify(field) || `field-${index + 1}`,
    label: field,
    type: field.toLowerCase().includes("priority") ? "priority" : field.toLowerCase().includes("date") ? "date" : "text",
    required: index < 2
  })) as Json;
}

export async function createFormAction(formData: FormData) {
  const path = "/app/forms";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const name = text(formData, "name");

  requireValue(path, "Form name", name);
  validateLength(path, "Form type", text(formData, "form_type"), 80);
  validateLength(path, "Description", text(formData, "description"), 800);

  const { error } = await supabase.from("forms").insert({
    workspace_id: workspaceId,
    name,
    description: text(formData, "description"),
    form_type: text(formData, "form_type") || "operations",
    schema_json: formSchemaFromLines(text(formData, "fields")),
    is_public: bool(formData, "is_public"),
    public_slug: bool(formData, "is_public") ? `${slugify(name)}-${workspaceId.slice(0, 6)}` : null,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Form created.");
}

export async function createFormSubmissionAction(formData: FormData) {
  const formId = text(formData, "form_id");
  const path = returnPath(formData, formId ? `/app/forms/${formId}` : "/app/forms");
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const summary = text(formData, "summary");

  requireValue(path, "Form", formId);
  requireValue(path, "Submission summary", summary, 3000);

  const dataJson = {
    summary,
    priority: text(formData, "priority"),
    follow_up: text(formData, "follow_up")
  } satisfies Json;

  const { error } = await supabase.from("form_submissions").insert({
    workspace_id: workspaceId,
    form_id: formId,
    submitted_by: user.id,
    submitter_name: text(formData, "submitter_name"),
    submitter_email: text(formData, "submitter_email"),
    data_json: dataJson,
    ai_summary: text(formData, "summary") ? `Vaeroex summary draft: ${text(formData, "summary")}` : null,
    ai_detected_priority: text(formData, "priority") || "Medium",
    ai_detected_followups_json: lines(text(formData, "follow_up")) as Json
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  revalidatePath("/app/form-submissions");
  redirectWithMessage(path, "Submission saved.");
}

export async function convertSubmissionToTaskAction(formData: FormData) {
  const submissionId = text(formData, "submission_id");
  const formId = text(formData, "form_id");
  const path = returnPath(formData, formId ? `/app/forms/${formId}` : "/app/form-submissions");
  const { supabase, user, workspaceId } = await requireWorkspace(path);

  const { data: submission, error: submissionError } = await supabase
    .from("form_submissions")
    .select("*")
    .eq("id", submissionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (submissionError || !submission) {
    redirectWithError(path, submissionError?.message || "Submission not found.");
  }

  const { error } = await supabase.from("tasks").insert({
    workspace_id: workspaceId,
    title: `Business signal: ${submission.submitter_name || "Form submission"}`,
    description: submission.ai_summary || "Review form submission as source evidence.",
    status: "Business Signal",
    priority: "Context",
    category: "Form context",
    related_type: "form_submission",
    related_id: submission.id,
    ai_generated: true,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  revalidatePath("/app/form-submissions");
  revalidatePath("/app/tasks");
  redirectWithMessage(path, "Business signal saved to Business Memory.");
}

export async function createChecklistAction(formData: FormData) {
  const path = "/app/checklists";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const name = text(formData, "name");

  requireValue(path, "Checklist name", name);
  validateLength(path, "Checklist description", text(formData, "description"), 1200);

  const { error } = await supabase.from("checklists").insert({
    workspace_id: workspaceId,
    name,
    description: text(formData, "description"),
    category: text(formData, "category"),
    frequency: text(formData, "frequency"),
    items_json: lines(text(formData, "items")) as Json,
    assigned_role: text(formData, "assigned_role"),
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Checklist created.");
}

export async function runChecklistAction(formData: FormData) {
  const path = returnPath(formData, "/app/checklists");
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const checklistId = text(formData, "checklist_id");
  const status = text(formData, "status") || "Complete";

  requireValue(path, "Checklist", checklistId);
  validateLength(path, "Run notes", text(formData, "notes"), 1000);

  const { error } = await supabase.from("checklist_runs").insert({
    workspace_id: workspaceId,
    checklist_id: checklistId,
    assigned_to: user.id,
    assigned_person_id: text(formData, "person_id") || null,
    assigned_role: text(formData, "role") || null,
    assigned_department: text(formData, "department") || null,
    due_date: text(formData, "due_date") || null,
    priority: text(formData, "priority") || "Medium",
    status,
    responses_json: lines(text(formData, "responses")) as Json,
    notes: text(formData, "notes"),
    completed_at: status === "Complete" ? new Date().toISOString() : null
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  revalidatePath("/app/checklist-runs");
  redirectWithMessage(path, "Checklist run saved.");
}

export async function createTaskAction(formData: FormData) {
  const path = "/app/tasks";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const title = text(formData, "title");

  requireValue(path, "Business signal title", title);
  validateLength(path, "Business signal description", text(formData, "description"), 2000);

  const { error } = await supabase.from("tasks").insert({
    workspace_id: workspaceId,
    title,
    description: text(formData, "description"),
    status: text(formData, "status") || "Business Signal",
    priority: text(formData, "priority") || "Context",
    category: text(formData, "category"),
    assigned_person_id: text(formData, "person_id") || null,
    assigned_role: text(formData, "role") || null,
    assigned_department: text(formData, "department") || null,
    due_date: text(formData, "due_date") || null,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Business signal saved to Business Memory.");
}

export async function createBusinessSignalAction(formData: FormData) {
  const path = "/app/tasks";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const title = text(formData, "title");
  const description = text(formData, "description");
  const category = text(formData, "category") || "General";
  const signalDate = text(formData, "signal_date");
  const source = text(formData, "source") || "Manual";

  requireValue(path, "Business signal title", title);
  validateLength(path, "Business signal description", description, 2000);

  const { error } = await supabase.from("tasks").insert({
    workspace_id: workspaceId,
    title,
    description,
    status: "Business Signal",
    priority: "Context",
    category,
    due_date: signalDate || null,
    related_type: source === "Uploaded" ? "Uploaded" : "Manual",
    ai_generated: false,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  revalidatePath("/app");
  revalidatePath("/app/intelligence");
  redirectWithMessage(path, "Business signal saved to Business Memory.");
}

export async function updateTaskStatusAction(formData: FormData) {
  const path = "/app/tasks";
  const { supabase, workspaceId } = await requireWorkspace(path);
  const taskId = text(formData, "task_id");

  const { error } = await supabase
    .from("tasks")
    .update({ status: text(formData, "status") || "Business Signal" })
    .eq("id", taskId)
    .eq("workspace_id", workspaceId);

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Business signal updated.");
}

export async function deleteBusinessSignalAction(formData: FormData) {
  const path = returnPath(formData, "/app/tasks");
  const { supabase, user, workspaceId, membership } = await requireWorkspace(path);
  const recordId = text(formData, "record_id");

  if (!recordId) {
    redirectWithError(path, "Business Signal is required.");
  }

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "delete_record",
        args: {
          recordId,
          collection: "business_signals",
          action: "delete"
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: recordId,
        metadata: {
          source: "business_signal_delete"
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithError(path, error instanceof Error ? error.message : "Business Signal deletion was blocked by Vaeroex security policy.");
  }

  const lifecycleClient = supabase as unknown as {
    rpc: (name: string, args: Record<string, string>) => Promise<{ data: Array<{ signal_id: string }> | null; error: { message: string } | null }>;
  };
  const { data, error } = await lifecycleClient.rpc("update_business_signal_lifecycle", {
    p_workspace_id: workspaceId,
    p_signal_id: recordId,
    p_action: "delete"
  });

  if (error || !data?.length) {
    redirectWithError(path, error?.message || "Business Signal could not be deleted.");
  }

  revalidatePath(path);
  revalidatePath("/app");
  revalidatePath("/app/intelligence");
  revalidatePath("/app/reports");
  redirectWithMessage(path, "Business Signal deleted and removed from active intelligence.");
}

export async function createKpiAction(formData: FormData) {
  const path = "/app/kpis";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const name = text(formData, "name");
  const category = text(formData, "category");
  const owner = text(formData, "owner");
  const notes = text(formData, "notes");
  const source = text(formData, "source");

  requireValue(path, "KPI name", name);
  validateLength(path, "Category", category, 100);
  validateLength(path, "Owner", owner, 120);
  validateLength(path, "Notes", notes, 1500);
  validateLength(path, "Source", source, 160);

  const { error } = await supabase.from("kpis").insert({
    workspace_id: workspaceId,
    name,
    category,
    target: optionalNumber(path, "Target", text(formData, "target")),
    actual_value: optionalNumber(path, "Actual value", text(formData, "actual_value")),
    metric_date: metricDateOrToday(path, text(formData, "metric_date")),
    owner,
    notes,
    source,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "KPI saved.");
}

export async function updateKpiAction(formData: FormData) {
  const path = "/app/kpis";
  const { supabase, user, workspaceId, membership } = await requireWorkspace(path);
  const kpiId = text(formData, "kpi_id");
  const name = text(formData, "name");
  const category = text(formData, "category");
  const owner = text(formData, "owner");
  const notes = text(formData, "notes");
  const source = text(formData, "source");

  requireValue(path, "KPI", kpiId, 80);
  requireValue(path, "KPI name", name);
  validateLength(path, "Category", category, 100);
  validateLength(path, "Owner", owner, 120);
  validateLength(path, "Notes", notes, 1500);
  validateLength(path, "Source", source, 160);

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "update_kpi_record",
        args: {
          kpiId,
          fieldSet: ["name", "category", "owner", "notes", "source"]
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: kpiId,
        metadata: {
          source: "kpi_record_edit"
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithError(path, error instanceof Error ? error.message : "KPI update was blocked by Vaeroex security policy.");
  }

  const { data, error } = await supabase
    .from("kpis")
    .update({
      name,
      category,
      owner,
      notes,
      source
    })
    .eq("id", kpiId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error) {
    redirectWithError(path, error.message);
  }

  if (!data) {
    redirectWithError(path, "KPI not found, or you do not have permission to edit it.");
  }

  revalidatePath(path);
  revalidatePath("/app/reports");
  redirectWithMessage(path, "KPI updated.");
}

export async function updateKpiValueAction(formData: FormData) {
  const path = returnPath(formData, "/app/kpis");
  const { supabase, user, workspaceId, membership } = await requireWorkspace(path);
  const kpiId = text(formData, "kpi_id");
  const actualValue = optionalNumber(path, "Actual value", text(formData, "actual_value"));
  const target = optionalNumber(path, "Target", text(formData, "target"));
  const metricDate = metricDateOrToday(path, text(formData, "metric_date"));
  const notes = text(formData, "notes");
  const source = text(formData, "source");

  requireValue(path, "KPI", kpiId, 80);
  validateLength(path, "Notes", notes, 1500);
  validateLength(path, "Source", source, 160);

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "update_kpi_record",
        args: {
          kpiId,
          fieldSet: ["actual_value", "target", "metric_date", "notes", "source"]
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: kpiId,
        metadata: {
          source: "kpi_value_edit"
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithError(path, error instanceof Error ? error.message : "KPI value update was blocked by Vaeroex security policy.");
  }

  const { data, error } = await supabase
    .from("kpis")
    .update({
      actual_value: actualValue,
      target,
      metric_date: metricDate,
      notes,
      source
    })
    .eq("id", kpiId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error) {
    redirectWithError(path, error.message);
  }

  if (!data) {
    redirectWithError(path, "KPI value not found, or you do not have permission to edit it.");
  }

  revalidatePath("/app");
  revalidatePath("/app/intelligence");
  revalidatePath("/app/kpis");
  revalidatePath("/app/reports");
  redirectWithMessage(path, "KPI value updated.");
}

export async function updateKpiSettingAction(formData: FormData) {
  const path = returnPath(formData, "/app/kpis/settings");
  const { supabase, user, workspaceId, membership } = await requireWorkspace(path);
  const kpiName = text(formData, "kpi_name");
  const category = text(formData, "category");
  const definition = text(formData, "definition");
  const unitType = text(formData, "unit_type");
  const displayUnit = text(formData, "display_unit");
  const valueFormat = text(formData, "value_format");
  const xAxisLabel = text(formData, "x_axis_label");
  const yAxisLabel = text(formData, "y_axis_label");
  const preferredChartType = text(formData, "preferred_chart_type") || "line";
  const color = approvedKpiColor(text(formData, "color"));
  const target = optionalNumber(path, "Target", text(formData, "target"));
  const weight = optionalNumber(path, "Weight", text(formData, "weight")) ?? 1;
  const sortOrder = optionalNumber(path, "Sort order", text(formData, "sort_order")) ?? 0;

  requireValue(path, "KPI name", kpiName);
  validateLength(path, "Category", category, 100);
  validateLength(path, "Definition", definition, 1200);
  validateLength(path, "Unit/type", unitType, 80);
  validateLength(path, "Display unit", displayUnit, 80);
  validateLength(path, "Value format", valueFormat, 80);
  validateLength(path, "X-axis label", xAxisLabel, 80);
  validateLength(path, "Y-axis label", yAxisLabel, 80);

  if (!KPI_COLOR_PALETTE.some((item) => item.value === color)) {
    redirectWithError(path, "Choose an approved KPI color.");
  }

  if (weight < 0 || weight > 10) {
    redirectWithError(path, "KPI weight must be between 0 and 10.");
  }

  if (!["line", "bar", "mixed"].includes(preferredChartType)) {
    redirectWithError(path, "Choose line, bar, or mixed as the chart type.");
  }

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "update_kpi_settings",
        args: {
          kpiName
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: null,
        metadata: {
          source: "kpi_settings_update"
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithError(path, error instanceof Error ? error.message : "KPI settings update was blocked by Vaeroex security policy.");
  }

  const { error } = await supabase.from("kpi_settings").upsert(
    {
      workspace_id: workspaceId,
      kpi_name: kpiName,
      category: category || null,
      target,
      weight,
      definition: definition || null,
      color,
      is_visible: bool(formData, "is_visible"),
      sort_order: Math.round(sortOrder),
      unit_type: unitType || null,
      display_unit: displayUnit || null,
      value_format: valueFormat || null,
      x_axis_label: xAxisLabel || null,
      y_axis_label: yAxisLabel || null,
      preferred_chart_type: preferredChartType,
      created_by: user.id
    },
    { onConflict: "workspace_id,kpi_name" }
  );

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath("/app");
  revalidatePath("/app/kpis");
  revalidatePath("/app/kpis/settings");
  revalidatePath("/app/reports");
  if (text(formData, "target_change_context") === "recommended") {
    redirectWithMessageParams(path, "Recommended target applied.", {
      target_applied: "true",
      undo_kpi: kpiName,
      undo_target: text(formData, "previous_target")
    });
  }

  if (text(formData, "target_change_context") === "undo") {
    redirectWithMessage(path, "Previous target restored.");
  }

  redirectWithMessage(path, "KPI settings updated.");
}

export async function deleteKpiAction(formData: FormData) {
  const path = "/app/kpis";
  const { supabase, user, workspaceId, membership } = await requireWorkspace(path);
  const kpiId = text(formData, "kpi_id");

  requireValue(path, "KPI", kpiId, 80);

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "delete_kpi_record",
        args: {
          recordId: kpiId
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: kpiId,
        metadata: {
          source: "kpi_record_delete"
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithError(path, error instanceof Error ? error.message : "KPI deletion was blocked by Vaeroex security policy.");
  }

  const { data, error } = await supabase
    .from("kpis")
    .delete()
    .eq("id", kpiId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error) {
    redirectWithError(path, error.message);
  }

  if (!data) {
    redirectWithError(path, "KPI not found, or you do not have permission to delete it.");
  }

  revalidatePath(path);
  revalidatePath("/app/reports");
  redirectWithMessage(path, "KPI deleted.");
}

export async function createCrmLeadAction(formData: FormData) {
  void formData;
  redirectWithError(
    "/app/sources",
    "Customer record creation in Vaeroex has been retired. Upload source files, preserve reports, or connect external systems so Vaeroex can analyze customer activity as evidence."
  );
}

export async function createIssueAction(formData: FormData) {
  const path = "/app/issues";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const title = text(formData, "title");

  requireValue(path, "Issue title", title);
  validateLength(path, "Issue description", text(formData, "description"), 2000);

  const { error } = await supabase.from("issues").insert({
    workspace_id: workspaceId,
    title,
    description: text(formData, "description"),
    issue_type: text(formData, "issue_type"),
    severity: text(formData, "severity") || "Medium",
    status: text(formData, "status") || "Open",
    root_cause: text(formData, "root_cause"),
    recommended_fix: text(formData, "recommended_fix"),
    assigned_person_id: text(formData, "person_id") || null,
    assigned_role: text(formData, "role") || null,
    assigned_department: text(formData, "department") || null,
    due_date: text(formData, "due_date") || null,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Issue logged.");
}

export async function convertIssueToTaskAction(formData: FormData) {
  const path = "/app/issues";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const issueId = text(formData, "issue_id");

  const { data: issue, error: issueError } = await supabase
    .from("issues")
    .select("*")
    .eq("id", issueId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (issueError || !issue) {
    redirectWithError(path, issueError?.message || "Issue not found.");
  }

  const { error } = await supabase.from("tasks").insert({
    workspace_id: workspaceId,
    title: `Business signal: ${issue.title}`,
    description: issue.description || issue.root_cause || issue.recommended_fix || "Review issue as business context.",
    status: "Business Signal",
    priority: "Context",
    category: "Issue context",
    assigned_person_id: issue.assigned_person_id,
    assigned_role: issue.assigned_role,
    assigned_department: issue.assigned_department,
    due_date: issue.due_date,
    related_type: "issue",
    related_id: issue.id,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  revalidatePath("/app/tasks");
  redirectWithMessage(path, "Business signal saved to Business Memory.");
}

export async function createAssetAction(formData: FormData) {
  const path = "/app/assets";
  const { supabase, workspaceId } = await requireWorkspace(path);
  const assetName = text(formData, "asset_name");

  requireValue(path, "Asset name", assetName);
  validateLength(path, "Asset notes", text(formData, "notes"), 1200);

  const { error } = await supabase.from("assets").insert({
    workspace_id: workspaceId,
    asset_name: assetName,
    asset_type: text(formData, "asset_type"),
    identifier: text(formData, "identifier"),
    location: text(formData, "location"),
    status: text(formData, "status") || "Ready",
    notes: text(formData, "notes")
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Asset added.");
}

export async function createAssetCheckAction(formData: FormData) {
  const path = "/app/assets";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const assetId = text(formData, "asset_id");
  const status = text(formData, "status") || "Ready";

  requireValue(path, "Asset", assetId);
  validateLength(path, "Asset check notes", text(formData, "notes"), 1000);

  const { error } = await supabase.from("asset_checks").insert({
    workspace_id: workspaceId,
    asset_id: assetId,
    checked_by: user.id,
    status,
    notes: text(formData, "notes"),
    photos_json: [] as Json
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  await supabase
    .from("assets")
    .update({ status, last_checked_at: new Date().toISOString() })
    .eq("id", assetId)
    .eq("workspace_id", workspaceId);

  revalidatePath(path);
  redirectWithMessage(path, "Asset check saved.");
}

export async function createPersonAction(formData: FormData) {
  const path = "/app/people";
  const { supabase, workspaceId } = await requireWorkspace(path);
  const fullName = text(formData, "full_name");

  requireValue(path, "Name", fullName);
  validateLength(path, "Email", text(formData, "email"), 160);

  const { error } = await supabase.from("people").insert({
    workspace_id: workspaceId,
    full_name: fullName,
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    role_title: text(formData, "role_title"),
    department: text(formData, "department"),
    status: text(formData, "status") || "active",
    start_date: text(formData, "start_date") || null,
    notes: text(formData, "notes")
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Person added.");
}

export async function createSopAction(formData: FormData) {
  const path = "/app/sops";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const title = text(formData, "title");

  requireValue(path, "SOP title", title);
  validateLength(path, "SOP body", text(formData, "body_markdown"), 20000);

  const { error } = await supabase.from("sops").insert({
    workspace_id: workspaceId,
    title,
    department: text(formData, "department"),
    category: text(formData, "category"),
    body_markdown: text(formData, "body_markdown"),
    status: text(formData, "status") || "Draft",
    version: Number(text(formData, "version") || 1),
    created_by: user.id,
    ai_generated: false
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "SOP created.");
}

export async function createReportAction(formData: FormData) {
  if (!VAEROEX_SYSTEM_PROMPT.trim()) {
    redirectWithError("/app/reports", "Vaeroex prompt is not configured.");
  }

  const path = "/app/reports";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const title = text(formData, "title") || "Weekly Operations Report - Generated by Vaeroex";
  validateLength(path, "Report title", title, 180);
  validateLength(path, "Report body", text(formData, "body_markdown"), 30000);

  const { error } = await supabase.from("reports").insert({
    workspace_id: workspaceId,
    report_type: text(formData, "report_type") || "Weekly Operations Report",
    title: title.includes("Vaeroex") ? title : `${title} - Generated by Vaeroex`,
    date_range_start: text(formData, "date_range_start") || null,
    date_range_end: text(formData, "date_range_end") || null,
    body_markdown:
      text(formData, "body_markdown") ||
      "# Weekly Operations Report\n\nGenerated by Vaeroex.\n\n## Executive Summary\nAdd workspace activity, bottlenecks, and recommended next actions.",
    source_data_json: { createdFrom: "manual_phase_3" } satisfies Json,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Report created.");
}
