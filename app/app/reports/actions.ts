"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { applyKpiSettingsToRows, sortKpiRowsBySettings, type KpiSettingRow } from "@/lib/kpis/settings";
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
type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type CrmLeadHistoryRow = Database["public"]["Tables"]["crm_lead_history"]["Row"];
type OperationalMetricRow = Database["public"]["Tables"]["operational_metrics"]["Row"];
type JsonRecord = Record<string, unknown>;

const REPORT_PERIODS: ReportPeriod[] = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "Year to Date"];
const reportNumberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function safeReportsReturnPath(value: string) {
  return value === "/app/briefings" ? "/app/briefings" : "/app/reports";
}

function redirectWithError(message: string, returnPath = "/app/reports"): never {
  redirect(`${safeReportsReturnPath(returnPath)}?error=${encodeURIComponent(message)}` as Route);
}

function redirectWithMessage(message: string, returnPath = "/app/reports"): never {
  redirect(`${safeReportsReturnPath(returnPath)}?message=${encodeURIComponent(message)}` as Route);
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
  const normalizedModule = normalizeCategory(moduleName);
  const moduleAliases =
    normalizedModule === "business signals"
      ? ["tasks", "source signals", "follow-ups"]
      : normalizedModule === "crm"
        ? ["customer pipeline"]
        : [];

  return (
    normalizedModule === target ||
    moduleAliases.includes(target) ||
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

function formatKpiNumber(value: number) {
  return reportNumberFormatter.format(value);
}

function groupKpisByName(kpis: KpiRow[]) {
  return kpis.reduce<Record<string, KpiRow[]>>((groups, kpi) => {
    groups[kpi.name] = groups[kpi.name] || [];
    groups[kpi.name].push(kpi);
    return groups;
  }, {});
}

function kpiMovementRows(kpis: KpiRow[], endDate: string) {
  return Object.entries(groupKpisByName(kpis))
    .map(([name, rows]) => {
      const values = rows
        .filter((row) => row.actual_value !== null && row.metric_date <= endDate)
        .sort((a, b) => `${a.metric_date}-${a.created_at}`.localeCompare(`${b.metric_date}-${b.created_at}`))
        .slice(-12);
      const first = values[0];
      const latest = values[values.length - 1];
      const previous = values[values.length - 2];
      const deltas = values.slice(1).map((row, index) => Math.abs((row.actual_value as number) - (values[index].actual_value as number)));
      const firstValue = first?.actual_value as number | undefined;
      const latestValue = latest?.actual_value as number | undefined;
      const change = firstValue !== undefined && latestValue !== undefined ? latestValue - firstValue : null;
      const changePercent =
        firstValue !== undefined && latestValue !== undefined && firstValue !== 0
          ? ((latestValue - firstValue) / Math.abs(firstValue)) * 100
          : null;
      const volatility = deltas.length ? deltas.reduce((sum, value) => sum + value, 0) / deltas.length : null;

      return {
        name,
        first,
        latest,
        previous,
        count: values.length,
        change,
        changePercent,
        volatility
      };
    })
    .filter((trend) => trend.count >= 2 && trend.latest);
}

function buildKpiTrendObservations(kpis: KpiRow[], range: DateRange) {
  const trends = kpiMovementRows(kpis, range.endDate);

  if (!trends.length) {
    return [];
  }

  const improving = [...trends]
    .filter((trend) => trend.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0];
  const declining = [...trends]
    .filter((trend) => (trend.changePercent ?? 0) < 0)
    .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))[0];
  const volatile = [...trends]
    .filter((trend) => trend.volatility !== null)
    .sort((a, b) => (b.volatility ?? 0) - (a.volatility ?? 0))[0];
  const revenue = trends.find((trend) => normalizeCategory(trend.name).includes("revenue") || normalizeCategory(trend.name).includes("sales"));
  const leads = trends.find((trend) => normalizeCategory(trend.name).includes("lead"));
  const observations = [
    improving && improving.changePercent !== null
      ? `${improving.name} is improving fastest at ${formatKpiNumber(improving.changePercent)}% across its latest ${improving.count} entries.`
      : "",
    declining && declining.changePercent !== null
      ? `${declining.name} is declining most at ${formatKpiNumber(Math.abs(declining.changePercent))}%.`
      : "",
    volatile && volatile.volatility !== null
      ? `${volatile.name} is the most volatile, averaging ${formatKpiNumber(volatile.volatility)} points of movement between entries.`
      : ""
  ].filter(Boolean);

  if (revenue && leads && revenue.change !== null && leads.change !== null) {
    if (leads.change > 0 && revenue.change < 0) {
      observations.push("Leads are rising while revenue is falling, which may point to conversion, pricing, response quality, or sales-process issues.");
    } else if (leads.change < 0 && revenue.change > 0) {
      observations.push("Revenue is rising while leads are falling, which may mean larger deals are offsetting a weaker pipeline.");
    } else if (leads.change > 0 && revenue.change > 0) {
      observations.push("Leads and revenue are both rising, which suggests pipeline volume and sales results are currently aligned.");
    } else if (leads.change < 0 && revenue.change < 0) {
      observations.push("Leads and revenue are both falling, which should be reviewed before the next management meeting.");
    }
  }

  return observations;
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
  const [
    tasks,
    issues,
    checklistRuns,
    sops,
    submissions,
    assets,
    kpis,
    kpiSettings,
    vaeroexRuns,
    files,
    fileImports,
    crmLeads,
    crmLeadHistory,
    operationalMetrics
  ] = await Promise.all([
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
      .from("kpis")
      .select("id,name,category,target,actual_value,metric_date,owner,source,notes,source_file_id,import_id,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("metric_date", { ascending: false })
      .limit(300),
    supabase.from("kpi_settings").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true }).order("weight", { ascending: false }),
    supabase
      .from("ai_agent_runs")
      .select("id,agent_type,input_json,output_json,status,error_message,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("file_uploads")
      .select("id,display_name,original_name,file_extension,import_type,import_status,imported_rows,analysis_summary,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("file_imports")
      .select("id,file_upload_id,import_type,status,rows_total,rows_imported,extraction_summary,created_at,imported_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("crm_leads")
      .select("id,lead_name,company,status,estimated_value,owner,notes,source_file_id,import_id,last_activity_at,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("crm_lead_history")
      .select("id,lead_id,event_type,status,estimated_value,owner,notes,source_file_id,import_id,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("operational_metrics")
      .select("id,metric_name,category,value,metric_date,owner,notes,source_file_id,import_id,created_at,updated_at")
      .eq("workspace_id", workspaceId)
      .order("metric_date", { ascending: false })
      .limit(300)
  ]);

  const taskRows = ((tasks.data ?? []) as TaskRow[]).filter((task) => matchesCategory(category, task, "Business Signals"));
  const issueRows = ((issues.data ?? []) as IssueRow[]).filter((issue) => matchesCategory(category, issue, "Issues"));
  const checklistRunRows = ((checklistRuns.data ?? []) as ChecklistRunRow[]).filter(() =>
    matchesCategory(category, {}, "Checklists")
  );
  const sopRows = ((sops.data ?? []) as SopRow[]).filter((sop) => matchesCategory(category, sop, "SOPs"));
  const submissionRows = ((submissions.data ?? []) as FormSubmissionRow[]).filter(() => matchesCategory(category, {}, "Forms"));
  const assetRows = ((assets.data ?? []) as AssetRow[]).filter(() => matchesCategory(category, {}, "Assets"));
  const kpiSettingRows = (kpiSettings.data ?? []) as KpiSettingRow[];
  const kpiRows = (sortKpiRowsBySettings(applyKpiSettingsToRows((kpis.data ?? []) as KpiRow[], kpiSettingRows), kpiSettingRows) as KpiRow[]).filter((kpi) =>
    matchesCategory(category, kpi, "KPIs")
  );
  const runRows = ((vaeroexRuns.data ?? []) as VaeroexRunRow[]).filter(() => matchesCategory(category, {}, "Vaeroex insights"));
  const fileRows = ((files.data ?? []) as FileUploadRow[]).filter(() => matchesCategory(category, {}, "Files"));
  const fileImportRows = ((fileImports.data ?? []) as FileImportRow[]).filter(() => matchesCategory(category, {}, "Files"));
  const crmLeadRows = ((crmLeads.data ?? []) as CrmLeadRow[]).filter(() => matchesCategory(category, {}, "CRM"));
  const crmLeadHistoryRows = ((crmLeadHistory.data ?? []) as CrmLeadHistoryRow[]).filter(() => matchesCategory(category, {}, "CRM"));
  const operationalMetricRows = ((operationalMetrics.data ?? []) as OperationalMetricRow[]).filter(
    (metric) => matchesCategory(category, metric, "Business metrics") || matchesCategory(category, metric, "Operational metrics")
  );

  const businessSignalsInPeriod = taskRows.filter((task) => inIsoRange(task.due_date || task.created_at, range) || inIsoRange(task.created_at, range));
  const contextualBusinessSignals = businessSignalsInPeriod.filter((task) =>
    Boolean(task.description || task.category || task.related_type || task.ai_generated)
  );
  const completedTasks = businessSignalsInPeriod;
  const createdTasks = taskRows.filter((task) => inIsoRange(task.created_at, range));
  const overdueTasks = contextualBusinessSignals;
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
  const recordedKpis = kpiRows.filter((kpi) => kpi.metric_date >= range.startDate && kpi.metric_date <= range.endDate);
  const kpiTrendObservations = buildKpiTrendObservations(kpiRows, range);
  const vaeroexInsights = runRows.filter((run) => run.status === "completed" && inIsoRange(run.created_at, range));
  const uploadedFiles = fileRows.filter((file) => inIsoRange(file.created_at, range));
  const importedFiles = fileRows.filter((file) => file.import_status === "imported" && inIsoRange(file.updated_at || file.created_at, range));
  const completedImports = fileImportRows.filter((item) => item.status === "completed" && inIsoRange(item.imported_at || item.created_at, range));
  const pendingImports = fileImportRows.filter((item) => item.status === "needs_review" || item.status === "extracted");
  const analyzedFiles = fileRows.filter((file) => Boolean(file.analysis_summary) && inIsoRange(file.updated_at || file.created_at, range));
  const newCrmLeads = crmLeadRows.filter((lead) => inIsoRange(lead.created_at, range));
  const crmLeadChanges = crmLeadHistoryRows.filter((item) => inIsoRange(item.created_at, range));
  const recordedOperationalMetrics = operationalMetricRows.filter(
    (metric) => metric.metric_date >= range.startDate && metric.metric_date <= range.endDate
  );
  const sourceLinkedKpis = recordedKpis.filter((kpi) => Boolean(kpi.source_file_id || kpi.import_id));

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
      kpis_recorded: recordedKpis.length,
      vaeroex_insights: vaeroexInsights.length,
      uploaded_files: uploadedFiles.length,
      imported_files: importedFiles.length,
      completed_imports: completedImports.length,
      pending_imports: pendingImports.length,
      imported_file_rows: completedImports.reduce((sum, item) => sum + item.rows_imported, 0),
      source_linked_kpis: sourceLinkedKpis.length,
      crm_leads: newCrmLeads.length,
      crm_lead_changes: crmLeadChanges.length,
      operational_metrics: recordedOperationalMetrics.length,
      file_analyses: analyzedFiles.length
    },
    items: {
      completed_tasks: completedTasks.slice(0, 8).map((task) => task.title),
      overdue_tasks: overdueTasks.slice(0, 8).map((task) => task.title),
      open_issues: openIssues.slice(0, 8).map((issue) => `${issue.title}${issue.severity ? ` (${issue.severity})` : ""}`),
      checklist_completions: completedChecklistRuns.slice(0, 8).map((run) => run.notes || `Checklist run ${run.id.slice(0, 8)}`),
      checklist_exceptions: checklistExceptions.slice(0, 8).map((run) => run.notes || `Checklist run ${run.id.slice(0, 8)} needs review`),
      sops_created: newSops.slice(0, 8).map((sop) => `${sop.title}${sop.status ? ` (${sop.status})` : ""}`),
      form_submissions: formSubmissions.slice(0, 8).map((submission) => submission.ai_summary || submission.submitter_name || "Form submission"),
      flagged_assets: flaggedAssets.slice(0, 8).map((asset) => `${asset.asset_name}${asset.status ? ` (${asset.status})` : ""}`),
      kpis_recorded: recordedKpis
        .slice(0, 8)
        .map((kpi) => `${kpi.name}: ${kpi.actual_value ?? "not set"}${kpi.target !== null ? ` vs target ${kpi.target}` : ""}`),
      kpi_trend_observations: kpiTrendObservations,
      vaeroex_insights: vaeroexInsights.map(insightText).filter(Boolean).slice(0, 5),
      uploaded_files: uploadedFiles
        .slice(0, 8)
        .map((file) => `${file.display_name} (${file.file_extension.toUpperCase()}, ${file.import_status.replace(/_/g, " ")})`),
      imported_files: importedFiles.slice(0, 8).map((file) => `${file.display_name}: ${file.imported_rows} imported row${file.imported_rows === 1 ? "" : "s"}`),
      completed_imports: completedImports
        .slice(0, 8)
        .map((item) => `${item.import_type}: ${item.rows_imported} of ${item.rows_total} row${item.rows_total === 1 ? "" : "s"} saved`),
      pending_imports: pendingImports
        .slice(0, 8)
        .map((item) => `${item.import_type}: ${item.rows_total} row${item.rows_total === 1 ? "" : "s"} waiting for review`),
      file_insights: analyzedFiles.map((file) => `${file.display_name}: ${file.analysis_summary || ""}`).filter(Boolean).slice(0, 5),
      crm_leads: newCrmLeads
        .slice(0, 8)
        .map((lead) => `${lead.lead_name}${lead.company ? ` at ${lead.company}` : ""}${lead.status ? ` (${lead.status})` : ""}`),
      crm_lead_changes: crmLeadChanges
        .slice(0, 8)
        .map((item) => `${item.event_type} lead activity${item.status ? ` (${item.status})` : ""}${item.estimated_value !== null ? ` valued at ${item.estimated_value}` : ""}`),
      operational_metrics: recordedOperationalMetrics
        .slice(0, 8)
        .map((metric) => `${metric.metric_name}: ${metric.value ?? "not set"}${metric.category ? ` (${metric.category})` : ""}`)
    }
  };
}

function riskItems(source: Awaited<ReturnType<typeof fetchReportSource>>) {
  const risks = [
    source.counts.overdue_tasks ? `${source.counts.overdue_tasks} Business Signal${source.counts.overdue_tasks === 1 ? "" : "s"} may indicate response, handoff, customer, market, or operational context worth leadership review.` : "",
    source.counts.open_issues ? `${source.counts.open_issues} open issue${source.counts.open_issues === 1 ? "" : "s"} remain unresolved.` : "",
    source.counts.checklist_exceptions
      ? `${source.counts.checklist_exceptions} checklist run${source.counts.checklist_exceptions === 1 ? "" : "s"} need review.`
      : "",
    source.counts.flagged_assets ? `${source.counts.flagged_assets} asset${source.counts.flagged_assets === 1 ? "" : "s"} are not marked ready.` : "",
    source.counts.pending_imports ? `${source.counts.pending_imports} data extraction${source.counts.pending_imports === 1 ? "" : "s"} are waiting for mapping review.` : "",
    source.counts.imported_files && source.counts.kpis_recorded === 0 && source.counts.operational_metrics === 0
      ? "Files were imported, but no KPI or business metric records were found in the selected period."
      : ""
  ].filter(Boolean);

  return risks.length ? risks : ["No major business risks were found in the selected period."];
}

function recommendedActions(source: Awaited<ReturnType<typeof fetchReportSource>>) {
  const actions = [
    source.counts.overdue_tasks ? "Review the Business Signal pattern before the next management review." : "",
    source.counts.open_issues ? "Review open issues by severity and decide whether an investigation summary is needed." : "",
    source.counts.checklist_exceptions ? "Review incomplete checklist runs and update the checklist or accountability process where needed." : "",
    source.counts.flagged_assets ? "Confirm asset readiness and document any maintenance or replacement decisions." : "",
    source.counts.pending_imports ? "Review pending file mappings and save approved data so dashboards and reports use the latest numbers." : "",
    source.counts.uploaded_files ? "Review newly uploaded files and decide which spreadsheets should become KPIs, CRM leads, or business metrics. Manual records can be added any time without imports." : "",
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
    `${workspaceName} captured ${current.counts.completed_tasks} Business Signal${current.counts.completed_tasks === 1 ? "" : "s"}, ` +
    `${current.counts.checklist_completions} checklist run${current.counts.checklist_completions === 1 ? "" : "s"}, and ` +
    `${current.counts.sops_created} SOP update${current.counts.sops_created === 1 ? "" : "s"} during this period. ` +
    `${current.counts.uploaded_files} file${current.counts.uploaded_files === 1 ? "" : "s"} were uploaded and ` +
    `${current.counts.imported_file_rows} spreadsheet row${current.counts.imported_file_rows === 1 ? "" : "s"} were imported where useful. ` +
    `${current.counts.open_issues} open issue${current.counts.open_issues === 1 ? "" : "s"} and ` +
    `${current.counts.overdue_tasks} Business Signal${current.counts.overdue_tasks === 1 ? "" : "s"} provide context for leadership review.`;

  return `# ${period} ${reportType} - Generated by Vaeroex

Period: ${currentRange.startDate} to ${currentRange.endDate}
Workspace: ${workspaceName}
Category: ${category || "All"}

## Executive Summary
${summary}

## Trend Comparison
- Business Signals: ${trendPhrase(current.counts.completed_tasks, previous.counts.completed_tasks)} vs ${previousLabel}
- Checklist completions: ${trendPhrase(current.counts.checklist_completions, previous.counts.checklist_completions)} vs ${previousLabel}
- New issues: ${trendPhrase(current.counts.new_issues, previous.counts.new_issues)} vs ${previousLabel}
- Form submissions: ${trendPhrase(current.counts.form_submissions, previous.counts.form_submissions)} vs ${previousLabel}
- SOP updates: ${trendPhrase(current.counts.sops_created, previous.counts.sops_created)} vs ${previousLabel}
- KPIs recorded: ${trendPhrase(current.counts.kpis_recorded, previous.counts.kpis_recorded)} vs ${previousLabel}
- Uploaded files: ${trendPhrase(current.counts.uploaded_files, previous.counts.uploaded_files)} vs ${previousLabel}
- Completed data imports: ${trendPhrase(current.counts.completed_imports, previous.counts.completed_imports)} vs ${previousLabel}
- CRM leads: ${trendPhrase(current.counts.crm_leads, previous.counts.crm_leads)} vs ${previousLabel}

## Business Signals and Source Context
${readableList(
  [
    ...current.items.completed_tasks.map((item) => `Business Signal: ${item}`),
    ...current.items.checklist_completions.map((item) => `Checklist completed: ${item}`),
    ...current.items.sops_created.map((item) => `SOP updated: ${item}`)
  ],
  "No Business Signals, checklist completions, or SOP updates were found in this period."
)}

## Open Issues
${readableList(current.items.open_issues, "No open issues are currently listed for this filter.")}

## Business Signal Evidence
${readableList(current.items.overdue_tasks, "No Business Signal evidence was found for this period.")}

## KPI Trends
- KPI records added: ${trendPhrase(current.counts.kpis_recorded, previous.counts.kpis_recorded)}
- KPI records from imported files: ${trendPhrase(current.counts.source_linked_kpis, previous.counts.source_linked_kpis)}
${readableList(current.items.kpis_recorded, "No KPI records were found for this period.")}
- KPI comparison observations:
${readableList(current.items.kpi_trend_observations, "No KPI trend observations were available yet. Add at least two dated values for a KPI to unlock comparisons.")}
- Business Signals: ${trendPhrase(current.counts.completed_tasks, previous.counts.completed_tasks)}
- Business Signals in memory now: ${current.counts.open_tasks}
- Open issues now: ${current.counts.open_issues}
- Checklist exceptions: ${trendPhrase(current.counts.checklist_exceptions, previous.counts.checklist_exceptions)}
- Form submissions: ${trendPhrase(current.counts.form_submissions, previous.counts.form_submissions)}
- Business metrics recorded: ${trendPhrase(current.counts.operational_metrics, previous.counts.operational_metrics)}

## Uploaded Files and Imported Data
- Files uploaded: ${trendPhrase(current.counts.uploaded_files, previous.counts.uploaded_files)}
- Files marked imported: ${trendPhrase(current.counts.imported_files, previous.counts.imported_files)}
- Completed data imports: ${trendPhrase(current.counts.completed_imports, previous.counts.completed_imports)}
- Data extractions waiting for review: ${current.counts.pending_imports}
- Imported spreadsheet rows: ${trendPhrase(current.counts.imported_file_rows, previous.counts.imported_file_rows)}
- CRM leads added: ${trendPhrase(current.counts.crm_leads, previous.counts.crm_leads)}
- CRM lead history changes: ${trendPhrase(current.counts.crm_lead_changes, previous.counts.crm_lead_changes)}
- File analyses completed: ${trendPhrase(current.counts.file_analyses, previous.counts.file_analyses)}
${readableList(
  [
    ...current.items.uploaded_files.map((item) => `File uploaded: ${item}`),
    ...current.items.completed_imports.map((item) => `Completed import: ${item}`),
    ...current.items.pending_imports.map((item) => `Pending review: ${item}`),
    ...current.items.imported_files.map((item) => `Import completed: ${item}`),
    ...current.items.crm_leads.map((item) => `CRM lead: ${item}`),
    ...current.items.crm_lead_changes.map((item) => `CRM history: ${item}`),
    ...current.items.operational_metrics.map((item) => `Business metric: ${item}`)
  ],
  "No uploaded files, spreadsheet imports, CRM leads, or business metrics were found in this period."
)}

## File Insights
${readableList(current.items.file_insights, "No Vaeroex file reviews were saved during this period.")}

## Risks
${readableList(risks, "No major business risks were found in the selected period.")}

## Recommended Next Actions
${readableList(nextActions, "Keep the current operating cadence and review trends again in the next report.")}

## Vaeroex Insights
${readableList(current.items.vaeroex_insights, "No Vaeroex insights were saved during this period.")}

Comparison period: ${previousRange.startDate} to ${previousRange.endDate}`;
}

export async function generateReportAction(formData: FormData) {
  const { supabase, user, workspace, workspaceId } = await requireWorkspace();
  const returnPath = safeReportsReturnPath(text(formData, "return_path"));
  const periodValue = text(formData, "report_period");
  const period = isReportPeriod(periodValue) ? periodValue : "Weekly";
  const reportType = text(formData, "report_type") || "Intelligence Summary";
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
    redirectWithError(error.message, returnPath);
  }

  revalidatePath("/app/reports");
  revalidatePath("/app/briefings");
  redirectWithMessage(`${period} briefing generated.`, returnPath);
}
