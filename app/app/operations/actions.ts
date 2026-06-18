"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { VAEROEX_SYSTEM_PROMPT } from "@/lib/ai/prompts/vaeroex-system-prompt";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
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
  redirect(`${path}?error=${encodeURIComponent(message)}` as Route);
}

function redirectWithMessage(path: string, message: string): never {
  redirect(`${path}?message=${encodeURIComponent(message)}` as Route);
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

  await requireActiveSubscription({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId: context.activeWorkspace.id
  });

  return {
    supabase,
    user,
    workspaceId: context.activeWorkspace.id
  };
}

function formSchemaFromLines(fieldLines: string): Json {
  const values = lines(fieldLines);
  const fields = values.length ? values : ["Submitted by", "Operational details", "Priority", "Manager notes"];

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

  const limit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId,
    limit: "forms"
  });

  if (limit.reached) {
    redirectWithError(path, "You’ve reached the limit for your current Vaeroex Ops System plan.");
  }

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
    title: `Follow up: ${submission.submitter_name || "Form submission"}`,
    description: submission.ai_summary || "Review form submission and confirm next action.",
    status: "To Do",
    priority: submission.ai_detected_priority || "Medium",
    category: "Form follow-up",
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
  redirectWithMessage(path, "Follow-up task created.");
}

export async function createChecklistAction(formData: FormData) {
  const path = "/app/checklists";
  const { supabase, user, workspaceId } = await requireWorkspace(path);
  const name = text(formData, "name");

  requireValue(path, "Checklist name", name);
  validateLength(path, "Checklist description", text(formData, "description"), 1200);

  const limit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId,
    limit: "checklists"
  });

  if (limit.reached) {
    redirectWithError(path, "You’ve reached the limit for your current Vaeroex Ops System plan.");
  }

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

  requireValue(path, "Task title", title);
  validateLength(path, "Task description", text(formData, "description"), 2000);

  const { error } = await supabase.from("tasks").insert({
    workspace_id: workspaceId,
    title,
    description: text(formData, "description"),
    status: text(formData, "status") || "To Do",
    priority: text(formData, "priority") || "Medium",
    category: text(formData, "category"),
    due_date: text(formData, "due_date") || null,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Task created.");
}

export async function updateTaskStatusAction(formData: FormData) {
  const path = "/app/tasks";
  const { supabase, workspaceId } = await requireWorkspace(path);
  const taskId = text(formData, "task_id");

  const { error } = await supabase
    .from("tasks")
    .update({ status: text(formData, "status") || "To Do" })
    .eq("id", taskId)
    .eq("workspace_id", workspaceId);

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  redirectWithMessage(path, "Task status updated.");
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
    title: `Resolve issue: ${issue.title}`,
    description: issue.recommended_fix || issue.description || "Review issue and confirm next action.",
    status: "To Do",
    priority: issue.severity === "High" ? "High" : issue.severity === "Urgent" ? "Urgent" : "Medium",
    category: "Issue resolution",
    related_type: "issue",
    related_id: issue.id,
    created_by: user.id
  });

  if (error) {
    redirectWithError(path, error.message);
  }

  revalidatePath(path);
  revalidatePath("/app/tasks");
  redirectWithMessage(path, "Resolution task created.");
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
