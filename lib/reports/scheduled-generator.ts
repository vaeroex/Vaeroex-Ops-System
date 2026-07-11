import type { SupabaseClient } from "@supabase/supabase-js";
import { applyKpiSettingsToRows, sortKpiRowsBySettings, type KpiSettingRow } from "@/lib/kpis/settings";
import { categoryConfig, categoryLabel, type ReportSubscriptionCategory } from "@/lib/reports/subscriptions";
import {
  filterBusinessEvidence,
  sanitizeBusinessEvidenceText
} from "@/lib/intelligence/evidence-eligibility";
import type { Database, Json } from "@/lib/supabase/types";

type AdminSupabase = SupabaseClient<Database>;
type PreferenceRow = Database["public"]["Tables"]["report_subscription_preferences"]["Row"];
type WorkspaceRow = Database["public"]["Tables"]["workspaces"]["Row"];

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
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
  const diff = (date.getUTCDay() + 6) % 7;
  return startOfDay(addDays(date, -diff));
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date: Date) {
  return endOfDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

function startOfQuarter(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
}

function endOfQuarter(date: Date) {
  return endOfDay(new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3 + 3, 0)));
}

function rangeForCategory(category: ReportSubscriptionCategory, runDate: Date) {
  const anchor = category === "monthly_executive_summary" || category === "quarterly_business_review" ? addDays(runDate, -1) : runDate;

  if (category === "monthly_executive_summary") {
    return { start: startOfMonth(anchor), end: endOfMonth(anchor) };
  }

  if (category === "quarterly_business_review") {
    return { start: startOfQuarter(anchor), end: endOfQuarter(anchor) };
  }

  const start = startOfWeek(anchor);
  return { start, end: addDays(start, 6) };
}

function inRange(value: string | null, start: Date, end: Date) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= start.getTime() && time <= end.getTime();
}

function firstInsightText(output: Json) {
  if (!output || typeof output !== "object" || Array.isArray(output)) return "";
  const record = output as Record<string, unknown>;
  const value = record.executive_summary || record.summary || record.response_markdown;

  if (typeof value !== "string") return "";

  return value
    .replace(/^#+\s*/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)[0] || "";
}

function list(values: string[], fallback: string) {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${fallback}`;
}

async function buildScheduledReportSource(supabase: AdminSupabase, workspaceId: string, start: Date, end: Date) {
  const [tasks, issues, checklists, kpis, kpiSettings, crm, insights, assignments, files] = await Promise.all([
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).order("metric_date", { ascending: false }).limit(300),
    supabase.from("kpi_settings").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true }).order("weight", { ascending: false }),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    supabase.from("operational_assignments").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("due_date", { ascending: true }).limit(100),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100)
  ]);

  const sourceErrors = [
    tasks.error,
    issues.error,
    checklists.error,
    kpis.error,
    kpiSettings.error,
    crm.error,
    insights.error,
    assignments.error,
    files.error
  ].filter(Boolean);

  if (sourceErrors.length) {
    throw new Error("Required scheduled-report source data could not be loaded. No report was created.");
  }

  const taskRows = tasks.data || [];
  const issueRows = issues.data || [];
  const checklistRows = checklists.data || [];
  const kpiSettingRows = (kpiSettings.data || []) as KpiSettingRow[];
  const kpiRows = sortKpiRowsBySettings(applyKpiSettingsToRows(kpis.data || [], kpiSettingRows), kpiSettingRows);
  const crmRows = crm.data || [];
  const insightRows = filterBusinessEvidence(insights.data || [], { sourceKind: "platform_run" });
  const assignmentRows = assignments.data || [];
  const fileRows = filterBusinessEvidence(files.data || []);
  const openTasks = taskRows.filter((task) => !["Done", "Complete"].includes(task.status || ""));
  const businessSignalsInPeriod = taskRows.filter((task) => inRange(task.due_date || task.created_at, start, end) || inRange(task.created_at, start, end));
  const contextualBusinessSignals = businessSignalsInPeriod.filter((task) =>
    Boolean(task.description || task.category || task.related_type || task.ai_generated)
  );
  const overdueTasks = contextualBusinessSignals;
  const completedTasks = businessSignalsInPeriod;
  const openIssues = issueRows.filter((issue) => !["Closed", "Resolved"].includes(issue.status || ""));
  const checklistExceptions = checklistRows.filter((run) => !["Done", "Complete"].includes(run.status || "") && inRange(run.created_at, start, end));
  const currentKpis = kpiRows.filter((kpi) => kpi.metric_date >= dateOnly(start) && kpi.metric_date <= dateOnly(end));
  const belowTargetKpis = currentKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value < kpi.target);
  const newLeads = crmRows.filter((lead) => inRange(lead.created_at, start, end));
  const recentInsights = insightRows.filter((run) => inRange(run.created_at, start, end));
  const openAssignments = assignmentRows.filter((assignment) => !["Done", "Dismissed"].includes(assignment.status || ""));
  const uploadedFiles = fileRows.filter((file) => inRange(file.created_at, start, end));

  return {
    counts: {
      completed_tasks: completedTasks.length,
      open_tasks: openTasks.length,
      overdue_tasks: overdueTasks.length,
      open_issues: openIssues.length,
      checklist_exceptions: checklistExceptions.length,
      kpis_recorded: currentKpis.length,
      below_target_kpis: belowTargetKpis.length,
      crm_leads: newLeads.length,
      vaeroex_insights: recentInsights.length,
      open_assignments: openAssignments.length,
      uploaded_files: uploadedFiles.length
    },
    items: {
      completed_tasks: completedTasks.slice(0, 8).map((task) => task.title),
      overdue_tasks: overdueTasks.slice(0, 8).map((task) => task.title),
      open_issues: openIssues.slice(0, 8).map((issue) => `${issue.title}${issue.severity ? ` (${issue.severity})` : ""}`),
      checklist_exceptions: checklistExceptions.slice(0, 8).map((run) => run.notes || `Checklist run ${run.id.slice(0, 8)} needs review`),
      below_target_kpis: belowTargetKpis.slice(0, 8).map((kpi) => `${kpi.name}: ${kpi.actual_value} vs target ${kpi.target}`),
      crm_leads: newLeads.slice(0, 8).map((lead) => `${lead.lead_name}${lead.company ? ` at ${lead.company}` : ""}${lead.status ? ` (${lead.status})` : ""}`),
      vaeroex_insights: recentInsights.map((run) => sanitizeBusinessEvidenceText(firstInsightText(run.output_json))).filter(Boolean).slice(0, 6),
      open_assignments: openAssignments.slice(0, 8).map((assignment) => assignment.title),
      uploaded_files: uploadedFiles.slice(0, 8).map((file) => `${file.display_name} (${file.import_status.replace(/_/g, " ")})`)
    }
  };
}

function reportBody({
  category,
  workspaceName,
  startDate,
  endDate,
  source
}: {
  category: ReportSubscriptionCategory;
  workspaceName: string;
  startDate: string;
  endDate: string;
  source: Awaited<ReturnType<typeof buildScheduledReportSource>>;
}) {
  const title = categoryLabel(category);
  const risks = [
    source.counts.overdue_tasks ? `${source.counts.overdue_tasks} Business Signal${source.counts.overdue_tasks === 1 ? "" : "s"} may indicate response, handoff, customer, market, or operational context worth leadership review.` : "",
    source.counts.open_issues ? `${source.counts.open_issues} open issue${source.counts.open_issues === 1 ? "" : "s"} are still unresolved.` : "",
    source.counts.below_target_kpis ? `${source.counts.below_target_kpis} KPI${source.counts.below_target_kpis === 1 ? "" : "s"} are below target.` : "",
    source.counts.checklist_exceptions ? `${source.counts.checklist_exceptions} checklist run${source.counts.checklist_exceptions === 1 ? "" : "s"} need review.` : ""
  ].filter(Boolean);
  const actions = [
    source.counts.overdue_tasks ? "Review the Business Signal pattern before the next leadership check-in." : "",
    source.counts.below_target_kpis ? "Review below-target KPIs and decide whether leadership needs an improvement plan for each key metric." : "",
    source.counts.open_issues ? "Review the most important unresolved issues with leadership." : "",
    source.counts.vaeroex_insights ? "Review recent Vaeroex insights and decide which recommendations need an executive report, SOP, checklist, meeting agenda, or improvement plan." : "",
    source.counts.uploaded_files ? "Review recent uploads and approve any mappings that should feed KPI history." : ""
  ].filter(Boolean);

  return `# ${title} - Generated by Vaeroex

Period: ${startDate} to ${endDate}
Workspace: ${workspaceName}

## Executive Summary
Vaeroex generated this scheduled report from current workspace activity, KPI history, customer activity evidence, Business Signals, uploaded files, and saved Vaeroex insights. This period includes ${source.counts.completed_tasks} Business Signal${source.counts.completed_tasks === 1 ? "" : "s"}, ${source.counts.crm_leads} new customer activity record${source.counts.crm_leads === 1 ? "" : "s"}, ${source.counts.kpis_recorded} KPI record${source.counts.kpis_recorded === 1 ? "" : "s"}, and ${source.counts.vaeroex_insights} saved Vaeroex insight${source.counts.vaeroex_insights === 1 ? "" : "s"}.

## What Needs Attention
${list(risks, "No urgent risks were detected for this scheduled report.")}

## Business Signals
${list(source.items.completed_tasks, "No Business Signals were found in this period.")}

## Open Issues
${list(source.items.open_issues, "No open issues were found.")}

## Business Signal Evidence
${list(source.items.overdue_tasks, "No Business Signal evidence was found.")}

## KPI Signals
${list(source.items.below_target_kpis, "No below-target KPIs were found for this period.")}

## Customer Activity Evidence
${list(source.items.crm_leads, "No new customer activity evidence was found in this period.")}

## Open Review Signals
${list(source.items.open_assignments, "No open review signals were found.")}

## Recent Files
${list(source.items.uploaded_files, "No files were uploaded in this period.")}

## Vaeroex Insights
${list(source.items.vaeroex_insights, "No saved Vaeroex insights were found in this period.")}

## Recommended Next Actions
${list(actions, "Keep the current operating cadence and review again on the next scheduled report.")}`;
}

export async function createScheduledReport({
  supabase,
  workspace,
  category,
  preferences,
  runDate = new Date()
}: {
  supabase: AdminSupabase;
  workspace: WorkspaceRow;
  category: ReportSubscriptionCategory;
  preferences: PreferenceRow[];
  runDate?: Date;
}) {
  const config = categoryConfig(category);
  const range = rangeForCategory(category, runDate);
  const startDate = dateOnly(range.start);
  const endDate = dateOnly(range.end);
  const source = await buildScheduledReportSource(supabase, workspace.id, range.start, range.end);
  const body = reportBody({ category, workspaceName: workspace.name, startDate, endDate, source });
  const sourceData = {
    generated_from: "scheduled_report_subscription",
    subscription_category: category,
    report_period: config.reportPeriod,
    report_type: config.reportType,
    date_range: { start: startDate, end: endDate },
    preference_count: preferences.length,
    source
  } satisfies Json;

  const { data: report, error: reportError } = await supabase
    .from("reports")
    .insert({
      workspace_id: workspace.id,
      report_type: `${config.reportPeriod} ${config.reportType}`,
      title: `${categoryLabel(category)} - Generated by Vaeroex`,
      date_range_start: startDate,
      date_range_end: endDate,
      body_markdown: body,
      source_data_json: sourceData,
      created_by: null
    })
    .select("id")
    .single();

  if (reportError || !report) {
    throw new Error(reportError?.message || "Scheduled report could not be created.");
  }

  const timestamp = new Date().toISOString();
  const notifications = preferences.map((preference) => ({
    workspace_id: workspace.id,
    type: "scheduled_report_ready",
    title: `${categoryLabel(category)} is ready`,
    body: "Vaeroex generated this scheduled report from workspace data and saved Vaeroex insights. Email delivery is preference-based and never forced.",
    priority: category === "quarterly_business_review" ? "High" : "Medium",
    related_module: "Reports",
    related_record_type: "report",
    related_record_id: report.id,
    action_label: "Open report",
    action_href: "/app/reports",
    recipient_scope: preference.preference_scope,
    recipient_person_id: preference.person_id,
    recipient_role: preference.role,
    recipient_department: null,
    metadata_json: { subscription_category: category, preference_id: preference.id } satisfies Json
  }));

  if (notifications.length) {
    const { error } = await supabase.from("notifications").insert(notifications);
    if (error) {
      throw new Error(error.message);
    }
  }

  if (preferences.length) {
    await supabase
      .from("report_subscription_preferences")
      .update({ last_generated_at: timestamp, last_notified_at: timestamp })
      .in("id", preferences.map((preference) => preference.id));
  }

  return { reportId: report.id, source, startDate, endDate };
}
