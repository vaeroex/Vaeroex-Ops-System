"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type ReportPeriod = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly" | "Year to Date";
type DateRange = {
  start: Date;
  end: Date;
  startDate: string;
  endDate: string;
  startIso: string;
  endIso: string;
};
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type ChecklistRunRow = Database["public"]["Tables"]["checklist_runs"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type FormSubmissionRow = Database["public"]["Tables"]["form_submissions"]["Row"];
type AssetRow = Database["public"]["Tables"]["assets"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type JsonRecord = Record<string, unknown>;

const REPORT_PERIODS: ReportPeriod[] = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "Year to Date"];

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithError(message: string): never {
  redirect(`/app/reports?error=${encodeURIComponent(message)}` as Route);
}

function redirectWithMessage(message: string): never {
  redirect(`/app/reports?message=${encodeURIComponent(message)}` as Route);
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

  await requireActiveSubscription({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId: context.activeWorkspace.id
  });

  return {
    supabase,
    user,
    workspace: context.activeWorkspace,
    workspaceId: context.activeWorkspace.id
  };
}

function isReportPeriod(value: string): value is ReportPeriod {
  return REPORT_PERIODS.includes(value as ReportPeriod);
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T12:00:00.000Z`);
  }

  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function startOfWeek(date: Date) {
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  return startOfDay(addDays(date, -diff));
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date) {
  return endOfDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

function startOfQuarter(date: Date) {
  const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterMonth, 1));
}

function endOfQuarter(date: Date) {
  const quarterMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  return endOfDay(new Date(Date.UTC(date.getUTCFullYear(), quarterMonth + 3, 0)));
}

function startOfYear(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function endOfYear(date: Date) {
  return endOfDay(new Date(Date.UTC(date.getUTCFullYear(), 11, 31)));
}

function makeRange(start: Date, end: Date): DateRange {
  const normalizedStart = startOfDay(start);
  const normalizedEnd = endOfDay(end);

  return {
    start: normalizedStart,
    end: normalizedEnd,
    startDate: dateOnly(normalizedStart),
    endDate: dateOnly(normalizedEnd),
    startIso: normalizedStart.toISOString(),
    endIso: normalizedEnd.toISOString()
  };
}

function getPeriodRange(period: ReportPeriod, anchorDate: string) {
  const anchor = parseDate(anchorDate);
  const today = parseDate("");

  if (period === "Daily") {
    return makeRange(anchor, anchor);
  }

  if (period === "Weekly") {
    const start = startOfWeek(anchor);
    return makeRange(start, addDays(start, 6));
  }

  if (period === "Monthly") {
    return makeRange(startOfMonth(anchor), endOfMonth(anchor));
  }

  if (period === "Quarterly") {
    return makeRange(startOfQuarter(anchor), endOfQuarter(anchor));
  }

  if (period === "Yearly") {
    return makeRange(startOfYear(anchor), endOfYear(anchor));
  }

  return makeRange(startOfYear(today), today);
}

function getComparisonRange(period: ReportPeriod, range: DateRange) {
  if (period === "Daily") {
    return makeRange(addDays(range.start, -1), addDays(range.end, -1));
  }

  if (period === "Weekly") {
    return makeRange(addDays(range.start, -7), addDays(range.end, -7));
  }

  if (period === "Monthly") {
    const previousMonth = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth() - 1, 1));
    return makeRange(startOfMonth(previousMonth), endOfMonth(previousMonth));
  }

  if (period === "Quarterly") {
    const previousQuarter = new Date(Date.UTC(range.start.getUTCFullYear(), range.start.getUTCMonth() - 3, 1));
    return makeRange(startOfQuarter(previousQuarter), endOfQuarter(previousQuarter));
  }

  if (period === "Yearly") {
    const previousYear = new Date(Date.UTC(range.start.getUTCFullYear() - 1, 0, 1));
    return makeRange(startOfYear(previousYear), endOfYear(previousYear));
  }

  const previousStart = new Date(Date.UTC(range.start.getUTCFullYear() - 1, 0, 1));
  const previousEnd = new Date(Date.UTC(range.end.getUTCFullYear() - 1, range.end.getUTCMonth(), range.end.getUTCDate()));
  return makeRange(previousStart, previousEnd);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function inIsoRange(value: string | null, range: DateRange) {
  if (!value) {
    return false;
  }

  const time = new Date(value).getTime();
  return time >= range.start.getTime() && time <= range.end.getTime();
}

function normalizeCategory(value: string) {
  return value.trim().toLowerCase();
}

function matchesCategory(category: string, row: { category?: string | null; issue_type?: string | null }, moduleName: string) {
  if (!category || category === "All") {
    return true;
  }

  const target = normalizeCategory(category);
  return (
    normalizeCategory(moduleName) === target ||
    normalizeCategory(row.category || "") === target ||
    normalizeCategory(row.issue_type || "") === target
  );
}

function readableList(values: string[], fallback: string) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${fallback}`;
}

function trendPhrase(current: number, previous: number) {
  const diff = current - previous;

  if (diff === 0) {
    return `${current} (no change)`;
  }

  return `${current} (${diff > 0 ? "up" : "down"} ${Math.abs(diff)})`;
}

function comparisonLabel(period: ReportPeriod) {
  if (period === "Daily") return "yesterday";
  if (period === "Weekly") return "last week";
  if (period === "Monthly") return "last month";
  if (period === "Quarterly") return "last quarter";
  if (period === "Yearly") return "last year";
  return "previous year-to-date";
}

function insightText(run: VaeroexRunRow) {
  const output = isRecord(run.output_json) ? run.output_json : {};
  const summary = str(output.executive_summary) || str(output.summary) || str(output.response_markdown);

  if (summary) {
    return summary.replace(/^#+\s*/gm, "").split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
  }

  return run.status === "failed" ? "A Vaeroex run failed during this period." : "";
}

async function fetchReportSource(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  range: DateRange,
  category: string
) {
  const [tasks, issues, checklistRuns, sops, submissions, assets, vaeroexRuns] = await Promise.all([
    supabase
      .from("tasks")
      .select("id,title,description,status,priority,category,due_date,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("issues")
      .select("id,title,description,issue_type,severity,status,root_cause,recommended_fix,due_date,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("checklist_runs")
      .select("id,checklist_id,status,responses_json,notes,completed_at,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("sops")
      .select("id,title,department,category,status,version,ai_generated,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("form_submissions")
      .select("id,form_id,submitter_name,data_json,ai_summary,ai_detected_priority,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("assets")
      .select("id,asset_name,asset_type,location,status,last_checked_at,notes,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("ai_agent_runs")
      .select("id,agent_type,input_json,output_json,status,error_message,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100)
  ]);

  const taskRows = ((tasks.data ?? []) as TaskRow[]).filter((task) => matchesCategory(category, task, "Tasks"));
  const issueRows = ((issues.data ?? []) as IssueRow[]).filter((issue) => matchesCategory(category, issue, "Issues"));
  const checklistRunRows = ((checklistRuns.data ?? []) as ChecklistRunRow[]).filter(() =>
    matchesCategory(category, {}, "Checklists")
  );
  const sopRows = ((sops.data ?? []) as SopRow[]).filter((sop) => matchesCategory(category, sop, "SOPs"));
  const submissionRows = ((submissions.data ?? []) as FormSubmissionRow[]).filter(() => matchesCategory(category, {}, "Forms"));
  const assetRows = ((assets.data ?? []) as AssetRow[]).filter(() => matchesCategory(category, {}, "Assets"));
  const runRows = ((vaeroexRuns.data ?? []) as VaeroexRunRow[]).filter(() => matchesCategory(category, {}, "Vaeroex insights"));

  const completedTasks = taskRows.filter((task) => task.status === "Done" && inIsoRange(task.updated_at || task.created_at, range));
  const createdTasks = taskRows.filter((task) => inIsoRange(task.created_at, range));
  const overdueTasks = taskRows.filter((task) => task.status !== "Done" && Boolean(task.due_date && task.due_date <= range.endDate));
  const openTasks = taskRows.filter((task) => task.status !== "Done");
  const completedChecklistRuns = checklistRunRows.filter(
    (run) => (run.completed_at && inIsoRange(run.completed_at, range)) || (run.status === "Complete" && inIsoRange(run.created_at, range))
  );
  const checklistExceptions = checklistRunRows.filter(
    (run) => run.status !== "Complete" && run.status !== "Done" && (inIsoRange(run.created_at, range) || !run.completed_at)
  );
  const newIssues = issueRows.filter((issue) => inIsoRange(issue.created_at, range));
  const openIssues = issueRows.filter((issue) => issue.status !== "Closed");
  const newSops = sopRows.filter((sop) => inIsoRange(sop.created_at, range));
  const formSubmissions = submissionRows.filter((submission) => inIsoRange(submission.created_at, range));
  const flaggedAssets = assetRows.filter((asset) => asset.status !== "Ready");
  const vaeroexInsights = runRows.filter((run) => run.status === "completed" && inIsoRange(run.created_at, range));

  return {
    counts: {
      completed_tasks: completedTasks.length,
      created_tasks: createdTasks.length,
      open_tasks: openTasks.length,
      overdue_tasks: overdueTasks.length,
      checklist_completions: completedChecklistRuns.length,
      checklist_exceptions: checklistExceptions.length,
      new_issues: newIssues.length,
      open_issues: openIssues.length,
      form_submissions: formSubmissions.length,
      sops_created: newSops.length,
      flagged_assets: flaggedAssets.length,
      vaeroex_insights: vaeroexInsights.length
    },
    items: {
      completed_tasks: completedTasks.slice(0, 8).map((task) => task.title),
      overdue_tasks: overdueTasks.slice(0, 8).map((task) => `${task.title}${task.due_date ? ` due ${task.due_date}` : ""}`),
      open_issues: openIssues.slice(0, 8).map((issue) => `${issue.title}${issue.severity ? ` (${issue.severity})` : ""}`),
      checklist_completions: completedChecklistRuns.slice(0, 8).map((run) => run.notes || `Checklist run ${run.id.slice(0, 8)}`),
      checklist_exceptions: checklistExceptions.slice(0, 8).map((run) => run.notes || `Checklist run ${run.id.slice(0, 8)} needs review`),
      sops_created: newSops.slice(0, 8).map((sop) => `${sop.title}${sop.status ? ` (${sop.status})` : ""}`),
      form_submissions: formSubmissions.slice(0, 8).map((submission) => submission.ai_summary || submission.submitter_name || "Form submission"),
      flagged_assets: flaggedAssets.slice(0, 8).map((asset) => `${asset.asset_name}${asset.status ? ` (${asset.status})` : ""}`),
      vaeroex_insights: vaeroexInsights.map(insightText).filter(Boolean).slice(0, 5)
    },
    future_sources: {
      crm_leads: "CRM/leads will be included here when that module is added.",
      kpi_metrics: "KPI and metrics tables will be included here when added.",
      uploaded_files: "Uploaded file summaries will be included here when file intake is added."
    }
  };
}

function riskItems(source: Awaited<ReturnType<typeof fetchReportSource>>) {
  const risks = [
    source.counts.overdue_tasks ? `${source.counts.overdue_tasks} overdue task${source.counts.overdue_tasks === 1 ? "" : "s"} need owner follow-up.` : "",
    source.counts.open_issues ? `${source.counts.open_issues} open issue${source.counts.open_issues === 1 ? "" : "s"} remain unresolved.` : "",
    source.counts.checklist_exceptions
      ? `${source.counts.checklist_exceptions} checklist run${source.counts.checklist_exceptions === 1 ? "" : "s"} need review.`
      : "",
    source.counts.flagged_assets ? `${source.counts.flagged_assets} asset${source.counts.flagged_assets === 1 ? "" : "s"} are not marked ready.` : ""
  ].filter(Boolean);

  return risks.length ? risks : ["No major operational risks were found in the selected period."];
}

function recommendedActions(source: Awaited<ReturnType<typeof fetchReportSource>>) {
  const actions = [
    source.counts.overdue_tasks ? "Assign an owner and next step for each overdue task before the next management review." : "",
    source.counts.open_issues ? "Review open issues by severity and convert unresolved items into dated follow-up tasks." : "",
    source.counts.checklist_exceptions ? "Review incomplete checklist runs and update the checklist or accountability process where needed." : "",
    source.counts.flagged_assets ? "Confirm asset readiness and document any maintenance or replacement decisions." : "",
    source.counts.sops_created === 0 ? "Pick one repeated workflow from this period and turn it into an SOP draft." : ""
  ].filter(Boolean);

  return actions.length ? actions : ["Keep the current operating cadence and review trends again in the next report."];
}

function buildReportBody({
  period,
  reportType,
  workspaceName,
  category,
  currentRange,
  previousRange,
  current,
  previous
}: {
  period: ReportPeriod;
  reportType: string;
  workspaceName: string;
  category: string;
  currentRange: DateRange;
  previousRange: DateRange;
  current: Awaited<ReturnType<typeof fetchReportSource>>;
  previous: Awaited<ReturnType<typeof fetchReportSource>>;
}) {
  const previousLabel = comparisonLabel(period);
  const risks = riskItems(current);
  const nextActions = recommendedActions(current);
  const summary =
    `${workspaceName} completed ${current.counts.completed_tasks} task${current.counts.completed_tasks === 1 ? "" : "s"}, ` +
    `${current.counts.checklist_completions} checklist run${current.counts.checklist_completions === 1 ? "" : "s"}, and ` +
    `${current.counts.sops_created} SOP update${current.counts.sops_created === 1 ? "" : "s"} during this period. ` +
    `${current.counts.open_issues} open issue${current.counts.open_issues === 1 ? "" : "s"} and ` +
    `${current.counts.overdue_tasks} overdue task${current.counts.overdue_tasks === 1 ? "" : "s"} need attention.`;

  return `# ${period} ${reportType} - Generated by Vaeroex

Period: ${currentRange.startDate} to ${currentRange.endDate}
Workspace: ${workspaceName}
Category: ${category || "All"}

## Executive Summary
${summary}

## Trend Comparison
- Completed tasks: ${trendPhrase(current.counts.completed_tasks, previous.counts.completed_tasks)} vs ${previousLabel}
- Checklist completions: ${trendPhrase(current.counts.checklist_completions, previous.counts.checklist_completions)} vs ${previousLabel}
- New issues: ${trendPhrase(current.counts.new_issues, previous.counts.new_issues)} vs ${previousLabel}
- Form submissions: ${trendPhrase(current.counts.form_submissions, previous.counts.form_submissions)} vs ${previousLabel}
- SOP updates: ${trendPhrase(current.counts.sops_created, previous.counts.sops_created)} vs ${previousLabel}

## Completed Work
${readableList(
  [
    ...current.items.completed_tasks.map((item) => `Task completed: ${item}`),
    ...current.items.checklist_completions.map((item) => `Checklist completed: ${item}`),
    ...current.items.sops_created.map((item) => `SOP updated: ${item}`)
  ],
  "No completed tasks, checklist completions, or SOP updates were found in this period."
)}

## Open Issues
${readableList(current.items.open_issues, "No open issues are currently listed for this filter.")}

## Overdue Tasks
${readableList(current.items.overdue_tasks, "No overdue tasks were found for this period.")}

## KPI Trends
- Completed tasks: ${trendPhrase(current.counts.completed_tasks, previous.counts.completed_tasks)}
- Open tasks now: ${current.counts.open_tasks}
- Open issues now: ${current.counts.open_issues}
- Checklist exceptions: ${trendPhrase(current.counts.checklist_exceptions, previous.counts.checklist_exceptions)}
- Form submissions: ${trendPhrase(current.counts.form_submissions, previous.counts.form_submissions)}
- CRM/leads, KPI tables, and uploaded file metrics will appear here when those modules are added.

## Operational Risks
${readableList(risks, "No major operational risks were found in the selected period.")}

## Recommended Next Actions
${readableList(nextActions, "Keep the current operating cadence and review trends again in the next report.")}

## Vaeroex Insights
${readableList(current.items.vaeroex_insights, "No Vaeroex insights were saved during this period.")}

Comparison period: ${previousRange.startDate} to ${previousRange.endDate}`;
}

export async function generateReportAction(formData: FormData) {
  const { supabase, user, workspace, workspaceId } = await requireWorkspace();
  const periodValue = text(formData, "report_period");
  const period = isReportPeriod(periodValue) ? periodValue : "Weekly";
  const reportType = text(formData, "report_type") || "Operations Summary";
  const category = text(formData, "category") || "All";
  const anchorDate = text(formData, "anchor_date");
  const currentRange = getPeriodRange(period, anchorDate);
  const previousRange = getComparisonRange(period, currentRange);

  const [current, previous] = await Promise.all([
    fetchReportSource(supabase, workspaceId, currentRange, category),
    fetchReportSource(supabase, workspaceId, previousRange, category)
  ]);

  const bodyMarkdown = buildReportBody({
    period,
    reportType,
    workspaceName: workspace.name,
    category,
    currentRange,
    previousRange,
    current,
    previous
  });

  const sourceData = {
    generated_from: "period_report",
    report_period: period,
    report_type: reportType,
    category,
    workspace_id: workspaceId,
    date_range: {
      start: currentRange.startDate,
      end: currentRange.endDate
    },
    comparison_range: {
      start: previousRange.startDate,
      end: previousRange.endDate
    },
    current,
    previous
  } satisfies Json;

  const { error } = await supabase.from("reports").insert({
    workspace_id: workspaceId,
    report_type: `${period} ${reportType}`,
    title: `${period} ${reportType} - Generated by Vaeroex`,
    date_range_start: currentRange.startDate,
    date_range_end: currentRange.endDate,
    body_markdown: bodyMarkdown,
    source_data_json: sourceData,
    created_by: user.id
  });

  if (error) {
    redirectWithError(error.message);
  }

  revalidatePath("/app/reports");
  redirectWithMessage(`${period} report generated.`);
}
