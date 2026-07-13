"use server";

import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { applyKpiSettingsToRows, sortKpiRowsBySettings, type KpiSettingRow } from "@/lib/kpis/settings";
import { filterOriginalBusinessEvidence, sanitizeBusinessEvidenceText } from "@/lib/intelligence/evidence-eligibility";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type ReportPeriod = "Today" | "Last 7 days" | "Last 30 days" | "Monthly" | "Quarterly" | "Yearly" | "Year to Date";
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
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type CrmLeadHistoryRow = Database["public"]["Tables"]["crm_lead_history"]["Row"];
type OperationalMetricRow = Database["public"]["Tables"]["operational_metrics"]["Row"];

const REPORT_PERIODS: ReportPeriod[] = ["Today", "Last 7 days", "Last 30 days", "Monthly", "Quarterly", "Yearly", "Year to Date"];
const reportNumberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function safeReportsReturnPath(value: string) {
  return value === "/app" ? "/app" : "/app/reports";
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

function normalizeLegacyPeriod(value: string): ReportPeriod {
  if (isReportPeriod(value)) return value;
  if (value === "Daily") return "Today";
  if (value === "Weekly") return "Last 7 days";
  return "Last 7 days";
}

function normalizeReportType(value: string) {
  if (/board|quarterly business review/i.test(value)) return "Board Report";
  return "Executive Brief";
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

  if (period === "Today") {
    return makeRange(anchor, anchor);
  }

  if (period === "Last 7 days") {
    return makeRange(addDays(anchor, -6), anchor);
  }

  if (period === "Last 30 days") {
    return makeRange(addDays(anchor, -29), anchor);
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
  if (period === "Today") {
    return makeRange(addDays(range.start, -1), addDays(range.end, -1));
  }

  if (period === "Last 7 days") {
    return makeRange(addDays(range.start, -7), addDays(range.end, -7));
  }

  if (period === "Last 30 days") {
    return makeRange(addDays(range.start, -30), addDays(range.end, -30));
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
      : normalizedModule === "customer evidence"
        ? ["customer activity", "customer evidence", "crm"]
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
  const customerActivity = trends.find((trend) => normalizeCategory(trend.name).includes("lead") || normalizeCategory(trend.name).includes("customer"));
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

  if (revenue && customerActivity && revenue.change !== null && customerActivity.change !== null) {
    if (customerActivity.change > 0 && revenue.change < 0) {
      observations.push("Customer activity is rising while revenue is falling, which may point to conversion, pricing, response quality, or sales-process issues.");
    } else if (customerActivity.change < 0 && revenue.change > 0) {
      observations.push("Revenue is rising while customer activity is falling, which may mean higher-value work is offsetting weaker activity volume.");
    } else if (customerActivity.change > 0 && revenue.change > 0) {
      observations.push("Customer activity and revenue are both rising, which suggests activity volume and sales results are currently aligned.");
    } else if (customerActivity.change < 0 && revenue.change < 0) {
      observations.push("Customer activity and revenue are both falling, which should be reviewed before the next management meeting.");
    }
  }

  return observations;
}

function comparisonLabel(period: ReportPeriod) {
  if (period === "Today") return "yesterday";
  if (period === "Last 7 days") return "the previous seven days";
  if (period === "Last 30 days") return "the previous thirty days";
  if (period === "Monthly") return "last month";
  if (period === "Quarterly") return "last quarter";
  if (period === "Yearly") return "last year";
  return "previous year-to-date";
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
    files,
    fileImports,
    crmLeads,
    crmLeadHistory,
    operationalMetrics
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id,title,description,status,priority,category,related_type,ai_generated,due_date,created_at,updated_at")
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
      .select("id,name,category,target,actual_value,metric_date,owner,source,notes,source_file_id,import_id,created_at,updated_at,archived_at,deleted_at")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("deleted_at", null)
      .order("metric_date", { ascending: false })
      .limit(300),
    supabase.from("kpi_settings").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true }).order("weight", { ascending: false }),
    supabase
      .from("file_uploads")
      .select("id,display_name,original_name,file_extension,import_type,import_status,imported_rows,analysis_summary,metadata_json,created_at,updated_at,archived_at,deleted_at")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("deleted_at", null)
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
      .select("id,metric_name,category,value,metric_date,owner,notes,source_file_id,import_id,created_at,updated_at,archived_at,deleted_at")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("deleted_at", null)
      .order("metric_date", { ascending: false })
      .limit(300)
  ]);

  const sourceErrors = [
    tasks.error,
    issues.error,
    checklistRuns.error,
    sops.error,
    submissions.error,
    assets.error,
    kpis.error,
    kpiSettings.error,
    files.error,
    fileImports.error,
    crmLeads.error,
    crmLeadHistory.error,
    operationalMetrics.error
  ].filter(Boolean);

  if (sourceErrors.length) {
    throw new Error("Required report source data could not be loaded. No report was created.");
  }

  const taskRows = filterOriginalBusinessEvidence((tasks.data ?? []) as TaskRow[]).filter((task) => matchesCategory(category, task, "Business Signals"));
  const issueRows = filterOriginalBusinessEvidence((issues.data ?? []) as IssueRow[]).filter((issue) => matchesCategory(category, issue, "Issues"));
  const checklistRunRows = ((checklistRuns.data ?? []) as ChecklistRunRow[]).filter(() =>
    matchesCategory(category, {}, "Checklists")
  );
  const sopRows = ((sops.data ?? []) as SopRow[]).filter((sop) => matchesCategory(category, sop, "SOPs"));
  const submissionRows = ((submissions.data ?? []) as FormSubmissionRow[]).filter(() => matchesCategory(category, {}, "Forms"));
  const assetRows = ((assets.data ?? []) as AssetRow[]).filter(() => matchesCategory(category, {}, "Assets"));
  const kpiSettingRows = (kpiSettings.data ?? []) as KpiSettingRow[];
  const eligibleKpis = filterOriginalBusinessEvidence((kpis.data ?? []) as KpiRow[]);
  const kpiRows = (sortKpiRowsBySettings(applyKpiSettingsToRows(eligibleKpis, kpiSettingRows), kpiSettingRows) as KpiRow[]).filter((kpi) =>
    matchesCategory(category, kpi, "KPIs")
  );
  // Execution history is platform telemetry, never original business evidence.
  const fileRows = filterOriginalBusinessEvidence((files.data ?? []) as FileUploadRow[]).filter(() => matchesCategory(category, {}, "Files"));
  const fileImportRows = ((fileImports.data ?? []) as FileImportRow[]).filter(() => matchesCategory(category, {}, "Files"));
  const crmLeadRows = ((crmLeads.data ?? []) as CrmLeadRow[]).filter(() => matchesCategory(category, {}, "Customer Evidence"));
  const crmLeadHistoryRows = ((crmLeadHistory.data ?? []) as CrmLeadHistoryRow[]).filter(() => matchesCategory(category, {}, "Customer Evidence"));
  const operationalMetricRows = filterOriginalBusinessEvidence((operationalMetrics.data ?? []) as OperationalMetricRow[]).filter(
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
  const uploadedFiles = fileRows.filter((file) => inIsoRange(file.created_at, range));
  const importedFiles = fileRows.filter((file) => file.import_status === "imported" && inIsoRange(file.updated_at || file.created_at, range));
  const completedImports = fileImportRows.filter((item) => item.status === "completed" && inIsoRange(item.imported_at || item.created_at, range));
  const pendingImports = fileImportRows.filter((item) => item.status === "needs_review" || item.status === "extracted");
  const analyzedFiles = fileRows.filter((file) => Boolean(sanitizeBusinessEvidenceText(file.analysis_summary)) && inIsoRange(file.updated_at || file.created_at, range));
  const newCrmLeads = crmLeadRows.filter((lead) => inIsoRange(lead.created_at, range));
  const crmLeadChanges = crmLeadHistoryRows.filter((item) => inIsoRange(item.created_at, range));
  const recordedOperationalMetrics = operationalMetricRows.filter(
    (metric) => metric.metric_date >= range.startDate && metric.metric_date <= range.endDate
  );
  const sourceLinkedKpis = recordedKpis.filter((kpi) => Boolean(kpi.source_file_id || kpi.import_id));
  const originalSourceIds = new Set([
    ...taskRows.map((row) => `signal:${row.id}`),
    ...issueRows.map((row) => `issue:${row.id}`),
    ...fileRows.map((row) => `file:${row.id}`),
    ...kpiRows.map((row) => `kpi:${row.name.trim().toLowerCase()}`),
    ...operationalMetricRows.map((row) => `metric:${row.id}`)
  ]);

  return {
    evidence: {
      original_source_count: originalSourceIds.size,
      source_types: [
        taskRows.length ? "Business Signals" : "",
        issueRows.length ? "Issues" : "",
        fileRows.length ? "Files" : "",
        kpiRows.length ? "KPIs" : "",
        operationalMetricRows.length ? "Operational Metrics" : ""
      ].filter(Boolean)
    },
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
      file_insights: analyzedFiles.map((file) => `${file.display_name}: ${sanitizeBusinessEvidenceText(file.analysis_summary)}`).filter(Boolean).slice(0, 5),
      crm_leads: newCrmLeads
        .slice(0, 8)
        .map((lead) => `${lead.lead_name}${lead.company ? ` at ${lead.company}` : ""}${lead.status ? ` (${lead.status})` : ""}`),
      crm_lead_changes: crmLeadChanges
        .slice(0, 8)
        .map((item) => `${item.event_type} customer activity${item.status ? ` (${item.status})` : ""}`),
      operational_metrics: recordedOperationalMetrics
        .slice(0, 8)
        .map((metric) => `${metric.metric_name}: ${metric.value ?? "not set"}${metric.category ? ` (${metric.category})` : ""}`)
    }
  };
}

function riskItems(source: Awaited<ReturnType<typeof fetchReportSource>>) {
  const risks = [
    source.counts.overdue_tasks ? `${source.counts.overdue_tasks} Business Signal${source.counts.overdue_tasks === 1 ? "" : "s"} may indicate a pattern worth leadership review.` : "",
    source.counts.open_issues ? `${source.counts.open_issues} open issue${source.counts.open_issues === 1 ? "" : "s"} remain unresolved.` : "",
    source.counts.flagged_assets ? `${source.counts.flagged_assets} asset${source.counts.flagged_assets === 1 ? "" : "s"} are not marked ready.` : "",
    source.counts.imported_files && source.counts.kpis_recorded === 0 && source.counts.operational_metrics === 0
      ? "Files were imported, but no KPI or business metric records were found in the selected period."
      : ""
  ].filter(Boolean);

  return risks.length ? risks : ["No supported risk signal was identified from the eligible evidence in this period."];
}

function recommendedActions(source: Awaited<ReturnType<typeof fetchReportSource>>) {
  const actions = [
    source.counts.open_issues ? "Review the most severe open issue and determine whether a focused investigation is warranted." : "",
    source.counts.overdue_tasks ? "Review the Business Signal pattern with leadership before drawing a broader conclusion." : "",
    source.counts.kpis_recorded ? "Review the strongest and weakest KPI movements against current targets." : "",
    source.counts.uploaded_files ? "Confirm that newly uploaded evidence is current and relevant to the decisions under review." : ""
  ].filter(Boolean);

  return actions.length ? actions : ["Continue collecting current evidence and review again when a supported change appears."];
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
  const summary = `${workspaceName} has ${current.evidence.original_source_count} eligible original evidence source${current.evidence.original_source_count === 1 ? "" : "s"} supporting this review. The report found ${current.counts.open_issues} open issue${current.counts.open_issues === 1 ? "" : "s"}, ${current.counts.kpis_recorded} current KPI record${current.counts.kpis_recorded === 1 ? "" : "s"}, and ${current.counts.uploaded_files} newly uploaded file${current.counts.uploaded_files === 1 ? "" : "s"} in the selected period.`;

  return `# ${period} ${reportType} - Generated by Vaeroex

Period: ${currentRange.startDate} to ${currentRange.endDate}
Workspace: ${workspaceName}
Category: ${category || "All"}

## Executive Summary
${summary}

## What Changed
- KPI records: ${trendPhrase(current.counts.kpis_recorded, previous.counts.kpis_recorded)} vs ${previousLabel}
- New issues: ${trendPhrase(current.counts.new_issues, previous.counts.new_issues)} vs ${previousLabel}
- Business Signals: ${trendPhrase(current.counts.completed_tasks, previous.counts.completed_tasks)} vs ${previousLabel}
- New source files: ${trendPhrase(current.counts.uploaded_files, previous.counts.uploaded_files)} vs ${previousLabel}
${readableList(current.items.kpi_trend_observations, "Historical depth is not yet sufficient for a supported KPI comparison.")}

## Risks
${readableList(risks, "No major business risks were found in the selected period.")}

## Leadership Review
${readableList(nextActions, "Keep the current operating cadence and review trends again in the next report.")}

## Supporting Evidence
- Eligible original sources: ${current.evidence.original_source_count}
- Source types: ${current.evidence.source_types.join(", ") || "None available"}
${readableList(current.items.open_issues, "No active issue evidence was found for this period.")}
${readableList(current.items.kpis_recorded, "No KPI evidence was found for this period.")}
${readableList(current.items.uploaded_files, "No new file evidence was found for this period.")}

## Limitations
This report is derived analysis. It does not create original evidence, change Business Health, or confirm causes that are not directly supported by the listed sources.

Comparison period: ${previousRange.startDate} to ${previousRange.endDate}`;
}

export async function generateReportAction(formData: FormData) {
  const { supabase, user, workspace, workspaceId } = await requireWorkspace();
  const returnPath = safeReportsReturnPath(text(formData, "return_path"));
  const periodValue = text(formData, "report_period");
  const period = normalizeLegacyPeriod(periodValue);
  const reportType = normalizeReportType(text(formData, "report_type") || "Executive Brief");
  const category = text(formData, "category") || "All";
  const anchorDate = text(formData, "anchor_date");
  const currentRange = getPeriodRange(period, anchorDate);
  const previousRange = getComparisonRange(period, currentRange);
  const rateLimit = await enforceRateLimit({
    action: "report.generate",
    limit: 20,
    windowSeconds: 10 * 60,
    userId: user.id,
    workspaceId,
    identifiers: [period, reportType],
    metadata: { source: "report_generation", period, report_type: reportType }
  });

  if (!rateLimit.allowed) {
    redirectWithError(rateLimitMessage(rateLimit), returnPath);
  }

  let current: Awaited<ReturnType<typeof fetchReportSource>>;
  let previous: Awaited<ReturnType<typeof fetchReportSource>>;
  try {
    [current, previous] = await Promise.all([
      fetchReportSource(supabase, workspaceId, currentRange, category),
      fetchReportSource(supabase, workspaceId, previousRange, category)
    ]);
  } catch {
    redirectWithError("Required evidence could not be loaded, so no report was created.", returnPath);
  }

  const minimumSources = reportType === "Board Report" ? 3 : 1;
  if (current.evidence.original_source_count < minimumSources) {
    redirectWithError(
      reportType === "Board Report"
        ? "Board Reports require at least three eligible original evidence sources."
        : "Add eligible original evidence before generating an Executive Brief.",
      returnPath
    );
  }

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
    derived_analysis: true,
    evidence_count: current.evidence.original_source_count,
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
    report_type: reportType,
    title: reportType,
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
  revalidatePath("/app");
  redirectWithMessage(`${reportType} generated.`, returnPath);
}
