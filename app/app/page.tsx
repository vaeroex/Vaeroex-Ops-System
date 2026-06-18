import Link from "next/link";
import type { ReactNode } from "react";
import { EmptyState } from "@/components/operations/EmptyState";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import type { Database, Json } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type DashboardPageProps = {
  searchParams?: Promise<{ period?: string }>;
};

type DashboardPeriod = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly" | "Year to Date";
type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type ChecklistRunRow = Database["public"]["Tables"]["checklist_runs"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type CrmLeadHistoryRow = Database["public"]["Tables"]["crm_lead_history"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type OperationalMetricRow = Database["public"]["Tables"]["operational_metrics"]["Row"];
type DateRange = {
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
};
type MetricTrend = {
  name: string;
  rows: KpiRow[];
  current: number | null;
  previous: number | null;
  change: number | null;
  changePercent: number | null;
};

const PERIODS: DashboardPeriod[] = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "Year to Date"];
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const currencyFormatter = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });
const chartColors = ["#2563eb", "#059669", "#dc2626", "#7c3aed", "#ea580c", "#0891b2"];

function isDashboardPeriod(value: string | undefined): value is DashboardPeriod {
  return PERIODS.includes(value as DashboardPeriod);
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function endOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfWeek(date: Date) {
  return startOfDay(addDays(date, -((date.getUTCDay() + 6) % 7)));
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
  const quarterStart = startOfQuarter(date);
  return endOfDay(new Date(Date.UTC(quarterStart.getUTCFullYear(), quarterStart.getUTCMonth() + 3, 0)));
}

function startOfYear(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function endOfYear(date: Date) {
  return endOfDay(new Date(Date.UTC(date.getUTCFullYear(), 11, 31)));
}

function rangeForPeriod(period: DashboardPeriod, today = new Date()): DateRange {
  const anchor = startOfDay(today);
  let start = anchor;
  let end = endOfDay(anchor);
  let previousStart = addDays(anchor, -1);
  let previousEnd = endOfDay(previousStart);

  if (period === "Weekly") {
    start = startOfWeek(anchor);
    previousStart = addDays(start, -7);
    previousEnd = endOfDay(addDays(start, -1));
  } else if (period === "Monthly") {
    start = startOfMonth(anchor);
    end = endOfDay(anchor);
    previousStart = startOfMonth(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1)));
    previousEnd = endOfMonth(previousStart);
  } else if (period === "Quarterly") {
    start = startOfQuarter(anchor);
    end = endOfDay(anchor);
    previousStart = startOfQuarter(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 3, 1)));
    previousEnd = endOfQuarter(previousStart);
  } else if (period === "Yearly") {
    start = startOfYear(anchor);
    end = endOfYear(anchor);
    previousStart = startOfYear(new Date(Date.UTC(anchor.getUTCFullYear() - 1, 0, 1)));
    previousEnd = endOfYear(previousStart);
  } else if (period === "Year to Date") {
    start = startOfYear(anchor);
    end = endOfDay(anchor);
    previousStart = startOfYear(new Date(Date.UTC(anchor.getUTCFullYear() - 1, 0, 1)));
    previousEnd = endOfDay(new Date(Date.UTC(anchor.getUTCFullYear() - 1, anchor.getUTCMonth(), anchor.getUTCDate())));
  }

  return {
    start,
    end,
    previousStart,
    previousEnd,
    startDate: dateOnly(start),
    endDate: dateOnly(end),
    previousStartDate: dateOnly(previousStart),
    previousEndDate: dateOnly(previousEnd)
  };
}

function lower(value: string | null | undefined) {
  return (value || "").toLowerCase();
}

function inIsoRange(value: string | null, rangeStart: Date, rangeEnd: Date) {
  if (!value) {
    return false;
  }

  const time = new Date(value).getTime();
  return time >= rangeStart.getTime() && time <= rangeEnd.getTime();
}

function inDateRange(value: string | null, startDate: string, endDate: string) {
  return Boolean(value && value >= startDate && value <= endDate);
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00.000Z`));
}

function formatMetricValue(value: number | null | undefined, label: string, fallback = "No data") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalized = lower(label);

  if (normalized.includes("revenue") || normalized.includes("sales") || normalized.includes("cost")) {
    return currencyFormatter.format(value);
  }

  if (normalized.includes("rate") || normalized.includes("conversion") || normalized.includes("utilization")) {
    return `${numberFormatter.format(value)}%`;
  }

  return numberFormatter.format(value);
}

function percentLabel(value: number | null) {
  if (value === null) {
    return "No comparison";
  }

  if (value === 0) {
    return "No change";
  }

  return `${value > 0 ? "+" : ""}${numberFormatter.format(value)}%`;
}

function trendTone(change: number | null) {
  if (change === null || change === 0) return "border-line bg-white text-ink";
  return change > 0 ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-700";
}

function latestMetric(kpis: KpiRow[], keywords: string[]) {
  return kpis.find((kpi) => {
    const haystack = `${lower(kpi.name)} ${lower(kpi.category)}`;
    return keywords.some((keyword) => haystack.includes(keyword));
  });
}

function metricNames(kpis: KpiRow[]) {
  return Array.from(new Set(kpis.map((kpi) => kpi.name).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function rowsForMetric(kpis: KpiRow[], name: string) {
  return kpis
    .filter((kpi) => kpi.name === name && kpi.actual_value !== null)
    .sort((a, b) => `${a.metric_date}-${a.created_at}`.localeCompare(`${b.metric_date}-${b.created_at}`));
}

function aggregateKpi(rows: KpiRow[], name: string, startDate: string, endDate: string) {
  const values = rows
    .filter((row) => row.name === name && inDateRange(row.metric_date, startDate, endDate) && row.actual_value !== null)
    .map((row) => row.actual_value as number);

  if (!values.length) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  const normalized = lower(name);
  return normalized.includes("rate") || normalized.includes("conversion") || normalized.includes("utilization") ? total / values.length : total;
}

function buildMetricTrend(kpis: KpiRow[], name: string, range: DateRange): MetricTrend {
  const current = aggregateKpi(kpis, name, range.startDate, range.endDate);
  const previous = aggregateKpi(kpis, name, range.previousStartDate, range.previousEndDate);
  const change = current !== null && previous !== null ? current - previous : null;
  const changePercent = change !== null && previous !== null && previous !== 0 ? (change / Math.abs(previous)) * 100 : null;

  return {
    name,
    rows: rowsForMetric(kpis, name),
    current,
    previous,
    change,
    changePercent
  };
}

function isConvertedStatus(status: string | null | undefined) {
  const normalized = lower(status);
  return normalized.includes("converted") || normalized.includes("won") || normalized.includes("customer") || normalized.includes("closed");
}

function isChecklistFailure(run: ChecklistRunRow) {
  const normalized = lower(run.status);
  return normalized && normalized !== "complete" && normalized !== "completed" && normalized !== "done";
}

function isOpenTask(task: TaskRow) {
  const deletedAt = (task as TaskRow & { deleted_at?: string | null }).deleted_at;
  return lower(task.status) !== "done" && lower(task.status) !== "complete" && !deletedAt;
}

function isOpenIssue(issue: IssueRow) {
  const deletedAt = (issue as IssueRow & { deleted_at?: string | null }).deleted_at;
  return lower(issue.status) !== "closed" && lower(issue.status) !== "resolved" && !deletedAt;
}

function readableOutput(run: VaeroexRunRow) {
  const output = run.output_json;

  if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, Json | undefined>;
    const summary = record.executive_summary || record.summary || record.response_markdown;

    if (typeof summary === "string" && summary.trim()) {
      return summary.replace(/^#+\s*/gm, "").split("\n").map((line) => line.trim()).filter(Boolean)[0] || "Vaeroex generated an insight.";
    }
  }

  return run.status === "failed" ? "A Vaeroex run failed and needs review." : "Vaeroex generated an insight.";
}

function StatCard({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone?: string }) {
  return (
    <article className={`rounded-lg border p-4 shadow-panel ${tone || "border-line bg-white text-ink"}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-5 opacity-80">{detail}</p>
    </article>
  );
}

function KpiCard({ trend }: { trend: MetricTrend }) {
  return (
    <StatCard
      label={trend.name}
      value={formatMetricValue(trend.current, trend.name)}
      detail={`${percentLabel(trend.changePercent)} vs previous period`}
      tone={trendTone(trend.change)}
    />
  );
}

function LineChart({ title, rows, color = "#2563eb" }: { title: string; rows: KpiRow[]; color?: string }) {
  const chartRows = rows.filter((row) => row.actual_value !== null).slice(-12);

  if (chartRows.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-slate-50 p-5 text-sm leading-6 text-muted">
        Add at least two dated records for {title} to show a trend.
      </div>
    );
  }

  const width = 640;
  const height = 220;
  const paddingX = 42;
  const paddingTop = 24;
  const paddingBottom = 38;
  const values = chartRows.map((row) => row.actual_value as number);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingTop - paddingBottom;
  const xFor = (index: number) => paddingX + (index / Math.max(chartRows.length - 1, 1)) * plotWidth;
  const yFor = (value: number) => paddingTop + (1 - (value - minValue) / range) * plotHeight;
  const points = chartRows.map((row, index) => `${xFor(index)},${yFor(row.actual_value as number)}`).join(" ");

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-1 text-xs text-muted">Last {chartRows.length} historical values</p>
      </div>
      <div className="p-3">
        <svg className="h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} trend`}>
          {[0, 1, 2, 3].map((line) => {
            const y = paddingTop + (line / 3) * plotHeight;
            return <line key={line} x1={paddingX} x2={width - paddingX} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />;
          })}
          <polyline fill="none" points={points} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
          {chartRows.map((row, index) => (
            <circle key={row.id} cx={xFor(index)} cy={yFor(row.actual_value as number)} r="4.5" fill={color} stroke="#ffffff" strokeWidth="2" />
          ))}
          <text x="8" y={paddingTop + 4} className="fill-slate-500 text-[11px]">
            {numberFormatter.format(maxValue)}
          </text>
          <text x="8" y={paddingTop + plotHeight} className="fill-slate-500 text-[11px]">
            {numberFormatter.format(minValue)}
          </text>
          <text x={paddingX} y={height - 12} className="fill-slate-500 text-[11px]">
            {formatShortDate(chartRows[0].metric_date)}
          </text>
          <text x={width - paddingX} y={height - 12} textAnchor="end" className="fill-slate-500 text-[11px]">
            {formatShortDate(chartRows[chartRows.length - 1].metric_date)}
          </text>
        </svg>
      </div>
    </div>
  );
}

function normalizedValue(value: number, values: number[]) {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  return maxValue === minValue ? 50 : ((value - minValue) / (maxValue - minValue)) * 100;
}

function MultiKpiComparison({ trends }: { trends: MetricTrend[] }) {
  const usable = trends.filter((trend) => trend.rows.length >= 2).slice(0, 4);

  if (usable.length < 2) {
    return <EmptyState title="More KPI history needed" description="Add at least two KPIs with two dated values each to unlock multi-KPI comparison." />;
  }

  const width = 720;
  const height = 250;
  const paddingX = 42;
  const paddingTop = 24;
  const paddingBottom = 38;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingTop - paddingBottom;
  const xFor = (index: number, count: number) => paddingX + (index / Math.max(count - 1, 1)) * plotWidth;
  const yFor = (value: number) => paddingTop + (1 - value / 100) * plotHeight;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">Multi-KPI comparison</p>
          <p className="mt-1 text-xs leading-5 text-muted">Indexed trend lines compare different metric types without mixing units.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {usable.map((trend, index) => (
            <span key={trend.name} className="inline-flex items-center gap-2">
              <span className="h-2 w-5 rounded-full" style={{ backgroundColor: chartColors[index % chartColors.length] }} />
              {trend.name}
            </span>
          ))}
        </div>
      </div>
      <div className="p-3">
        <svg className="h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Multi-KPI trend comparison">
          {[0, 1, 2, 3, 4].map((line) => {
            const y = paddingTop + (line / 4) * plotHeight;
            return <line key={line} x1={paddingX} x2={width - paddingX} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />;
          })}
          {usable.map((trend, index) => {
            const rows = trend.rows.slice(-12);
            const values = rows.map((row) => row.actual_value as number);
            const points = rows.map((row, rowIndex) => `${xFor(rowIndex, rows.length)},${yFor(normalizedValue(row.actual_value as number, values))}`).join(" ");

            return (
              <polyline
                key={trend.name}
                fill="none"
                points={points}
                stroke={chartColors[index % chartColors.length]}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="4"
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function SimpleList<T extends { id: string }>({
  items,
  empty,
  render
}: {
  items: T[];
  empty: string;
  render: (item: T) => ReactNode;
}) {
  if (!items.length) {
    return <p className="text-sm leading-6 text-muted">{empty}</p>;
  }

  return <div className="space-y-3">{items.map((item) => render(item))}</div>;
}

export default async function AppDashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const period = isDashboardPeriod(params?.period) ? params.period : "Weekly";
  const range = rangeForPeriod(period);
  const { supabase, context, workspaceId } = await requireWorkspacePage();

  const [
    kpiResult,
    taskResult,
    issueResult,
    checklistRunResult,
    sopResult,
    fileResult,
    importResult,
    crmLeadResult,
    crmHistoryResult,
    reportResult,
    vaeroexRunResult,
    metricResult
  ] = await Promise.all([
    supabase
      .from("kpis")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("metric_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("crm_lead_history").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(10),
    supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(10),
    supabase.from("operational_metrics").select("*").eq("workspace_id", workspaceId).order("metric_date", { ascending: false }).limit(500)
  ]);

  const kpis = (kpiResult.data || []) as KpiRow[];
  const tasks = (taskResult.data || []) as TaskRow[];
  const issues = (issueResult.data || []) as IssueRow[];
  const checklistRuns = (checklistRunResult.data || []) as ChecklistRunRow[];
  const sops = (sopResult.data || []) as SopRow[];
  const files = (fileResult.data || []) as FileUploadRow[];
  const imports = (importResult.data || []) as FileImportRow[];
  const crmLeads = (crmLeadResult.data || []) as CrmLeadRow[];
  const crmHistory = (crmHistoryResult.data || []) as CrmLeadHistoryRow[];
  const reports = (reportResult.data || []) as ReportRow[];
  const vaeroexRuns = (vaeroexRunResult.data || []) as VaeroexRunRow[];
  const operationalMetrics = (metricResult.data || []) as OperationalMetricRow[];
  const errors = [
    kpiResult.error,
    taskResult.error,
    issueResult.error,
    checklistRunResult.error,
    sopResult.error,
    fileResult.error,
    importResult.error,
    crmLeadResult.error,
    crmHistoryResult.error,
    reportResult.error,
    vaeroexRunResult.error,
    metricResult.error
  ].filter(Boolean);

  const names = metricNames(kpis);
  const revenueMetric = latestMetric(kpis, ["revenue", "sales"])?.name || names.find((name) => lower(name).includes("revenue")) || "Revenue";
  const leadsMetric = latestMetric(kpis, ["lead"])?.name || names.find((name) => lower(name).includes("lead")) || "Leads";
  const customMetric =
    names.find((name) => name !== revenueMetric && name !== leadsMetric && !lower(name).includes("conversion")) ||
    operationalMetrics[0]?.metric_name ||
    "Custom KPI";
  const primaryTrends = [revenueMetric, leadsMetric, customMetric]
    .filter((name, index, array) => array.indexOf(name) === index)
    .map((name) => buildMetricTrend(kpis, name, range));
  const comparisonTrends = names.slice(0, 6).map((name) => buildMetricTrend(kpis, name, range));
  const openTasks = tasks.filter(isOpenTask);
  const overdueTasks = openTasks.filter((task) => Boolean(task.due_date && task.due_date <= range.endDate));
  const openIssues = issues.filter(isOpenIssue);
  const checklistFailures = checklistRuns.filter((run) => isChecklistFailure(run) && inIsoRange(run.created_at, range.start, range.end));
  const sopUpdates = sops.filter((sop) => inIsoRange(sop.updated_at || sop.created_at, range.start, range.end));
  const recentFiles = files.filter((file) => inIsoRange(file.created_at, range.start, range.end));
  const fileAnalyses = files.filter((file) => Boolean(file.analysis_summary)).slice(0, 6);
  const recentImports = imports.filter((item) => inIsoRange(item.imported_at || item.created_at, range.start, range.end));
  const pendingImports = imports.filter((item) => item.status === "needs_review" || item.status === "extracted");
  const leadsCreated = crmLeads.filter((lead) => inIsoRange(lead.created_at, range.start, range.end));
  const leadsConverted = crmLeads.filter((lead) => isConvertedStatus(lead.status) && inIsoRange(lead.updated_at || lead.created_at, range.start, range.end));
  const leadHistoryChanges = crmHistory.filter((item) => inIsoRange(item.created_at, range.start, range.end));
  const pipeline = crmLeads.reduce<Record<string, { count: number; value: number }>>((groups, lead) => {
    const status = lead.status || "New";
    groups[status] = groups[status] || { count: 0, value: 0 };
    groups[status].count += 1;
    groups[status].value += lead.estimated_value || 0;
    return groups;
  }, {});
  const positiveTrends = comparisonTrends
    .filter((trend) => (trend.change ?? 0) > 0)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
    .slice(0, 4);
  const negativeTrends = comparisonTrends
    .filter((trend) => (trend.change ?? 0) < 0)
    .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))
    .slice(0, 4);
  const risks = [
    overdueTasks.length ? `${overdueTasks.length} overdue task${overdueTasks.length === 1 ? "" : "s"} need owner follow-up.` : "",
    openIssues.length ? `${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"} remain unresolved.` : "",
    checklistFailures.length ? `${checklistFailures.length} checklist run${checklistFailures.length === 1 ? "" : "s"} failed or need review.` : "",
    pendingImports.length ? `${pendingImports.length} extracted file import${pendingImports.length === 1 ? "" : "s"} are waiting for mapping review.` : "",
    negativeTrends[0] ? `${negativeTrends[0].name} is down ${numberFormatter.format(Math.abs(negativeTrends[0].changePercent || 0))}% vs the previous period.` : ""
  ].filter(Boolean);
  const opportunities = [
    leadsCreated.length ? `${leadsCreated.length} new lead${leadsCreated.length === 1 ? "" : "s"} can be reviewed for follow-up or conversion.` : "",
    positiveTrends[0] ? `${positiveTrends[0].name} is showing the strongest improvement this period.` : "",
    recentImports.length ? `${recentImports.length} recent import${recentImports.length === 1 ? "" : "s"} added fresh business history for reports and Vaeroex analysis.` : "",
    operationalMetrics.length ? "Operational metrics are available for staffing, job volume, costs, utilization, or custom trend reviews." : ""
  ].filter(Boolean);
  const recommendedActions = [
    overdueTasks.length ? "Assign due dates and owners for overdue work before the next management check-in." : "",
    openIssues.length ? "Sort open issues by severity and convert unresolved items into tasks." : "",
    checklistFailures.length ? "Review failed checklist runs and update the process or escalation rule." : "",
    pendingImports.length ? "Open Files and save approved mappings so the dashboard uses the latest uploaded data." : "",
    negativeTrends.length ? "Review declining KPIs against recent imports, CRM activity, and task workload." : "",
    !reports.length ? "Generate a report for this period so the management summary is saved." : ""
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Executive Dashboard"
        title={context.activeWorkspace?.name ?? "Vaeroex executive dashboard"}
        description={`A ${period.toLowerCase()} view of KPI history, tasks, issues, files, CRM activity, reports, and Vaeroex recommendations.`}
      />

      {errors.length ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errors[0]?.message || "Dashboard data could not be loaded."}
        </div>
      ) : null}

      <section className="flex flex-wrap gap-2 rounded-lg border border-line bg-white p-3 shadow-panel">
        {PERIODS.map((item) => (
          <Link
            key={item}
            href={`/app?period=${encodeURIComponent(item)}`}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              item === period ? "bg-vaeroex-blue text-white" : "border border-line bg-slate-50 text-slate-700 hover:border-vaeroex-blue"
            }`}
          >
            {item}
          </Link>
        ))}
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {primaryTrends.map((trend) => (
          <KpiCard key={trend.name} trend={trend} />
        ))}
        <StatCard label="Open Tasks" value={openTasks.length} detail={`${overdueTasks.length} overdue`} tone={overdueTasks.length ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"} />
        <StatCard label="Open Issues" value={openIssues.length} detail="Active operational blockers" tone={openIssues.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"} />
        <StatCard label="Recent Imports" value={recentImports.length} detail={`${pendingImports.length} waiting for review`} tone={pendingImports.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-line bg-white text-ink"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <LineChart title="Revenue trend" rows={rowsForMetric(kpis, revenueMetric)} color="#059669" />
        <LineChart title="Leads trend" rows={rowsForMetric(kpis, leadsMetric)} color="#2563eb" />
        <LineChart title={`${customMetric} trend`} rows={rowsForMetric(kpis, customMetric)} color="#7c3aed" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
        <SectionCard title="KPI comparison" description="Historical imported and manually entered KPI values are compared across the selected period.">
          <MultiKpiComparison trends={comparisonTrends} />
        </SectionCard>

        <SectionCard title="Trend readout" description="What improved and what needs attention.">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
            <div>
              <h3 className="text-sm font-semibold text-ink">Positive trends</h3>
              <SimpleList
                items={positiveTrends.map((trend) => ({ ...trend, id: trend.name }))}
                empty="No positive KPI movement found for this period yet."
                render={(trend: MetricTrend & { id: string }) => (
                  <p key={trend.name} className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">
                    {trend.name}: {percentLabel(trend.changePercent)}
                  </p>
                )}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Negative trends</h3>
              <SimpleList
                items={negativeTrends.map((trend) => ({ ...trend, id: trend.name }))}
                empty="No negative KPI movement found for this period."
                render={(trend: MetricTrend & { id: string }) => (
                  <p key={trend.name} className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                    {trend.name}: {percentLabel(trend.changePercent)}
                  </p>
                )}
              />
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Tasks" description="Open work and overdue accountability.">
          <SimpleList
            items={openTasks.slice(0, 6)}
            empty="No open tasks."
            render={(task: TaskRow) => (
              <div key={task.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{task.title}</p>
                  <StatusBadge value={task.priority} />
                </div>
                <p className="mt-1 text-xs text-muted">Due {task.due_date || "not set"} · {task.status}</p>
              </div>
            )}
          />
        </SectionCard>

        <SectionCard title="Issues" description="Open risks and process breakdowns.">
          <SimpleList
            items={openIssues.slice(0, 6)}
            empty="No open issues."
            render={(issue: IssueRow) => (
              <div key={issue.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{issue.title}</p>
                  <StatusBadge value={issue.severity} />
                </div>
                <p className="mt-1 text-xs leading-5 text-muted">{issue.recommended_fix || issue.status}</p>
              </div>
            )}
          />
        </SectionCard>

        <SectionCard title="Checklist failures" description="Recent runs that did not finish cleanly.">
          <SimpleList
            items={checklistFailures.slice(0, 6)}
            empty="No checklist failures in this period."
            render={(run: ChecklistRunRow) => (
              <div key={run.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{run.notes || `Checklist run ${run.id.slice(0, 8)}`}</p>
                  <StatusBadge value={run.status} />
                </div>
                <p className="mt-1 text-xs text-muted">{new Date(run.created_at).toLocaleDateString()}</p>
              </div>
            )}
          />
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-4">
        <SectionCard title="Files" description="Uploads and approved imports feeding business memory.">
          <SimpleList
            items={recentFiles.slice(0, 5)}
            empty="No files uploaded in this period."
            render={(file: FileUploadRow) => (
              <div key={file.id} className="rounded-lg border border-line p-3">
                <p className="text-sm font-semibold">{file.display_name}</p>
                <p className="mt-1 text-xs text-muted">
                  {file.file_extension.toUpperCase()} · {file.import_status.replace(/_/g, " ")} · {file.imported_rows} rows
                </p>
              </div>
            )}
          />
        </SectionCard>

        <SectionCard title="File insights" description="Latest Vaeroex file analyses saved to workspace memory.">
          <SimpleList
            items={fileAnalyses}
            empty="No file analyses saved yet."
            render={(file: FileUploadRow) => (
              <div key={file.id} className="rounded-lg border border-line p-3">
                <p className="text-sm font-semibold">{file.display_name}</p>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted">{file.analysis_summary}</p>
              </div>
            )}
          />
        </SectionCard>

        <SectionCard title="Recent imports" description="Historical rows added or waiting for review.">
          <SimpleList
            items={imports.slice(0, 6)}
            empty="No imports yet."
            render={(item: FileImportRow) => (
              <div key={item.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold capitalize">{item.import_type}</p>
                  <StatusBadge value={item.status === "completed" ? "Saved" : item.status} />
                </div>
                <p className="mt-1 text-xs text-muted">{item.rows_imported} of {item.rows_total} rows saved</p>
              </div>
            )}
          />
        </SectionCard>

        <SectionCard title="SOP updates" description="Recent process documentation changes.">
          <SimpleList
            items={sopUpdates.slice(0, 6)}
            empty="No SOP updates in this period."
            render={(sop: SopRow) => (
              <div key={sop.id} className="rounded-lg border border-line p-3">
                <p className="text-sm font-semibold">{sop.title}</p>
                <p className="mt-1 text-xs text-muted">{sop.status} · {sop.category || sop.department || "General"}</p>
              </div>
            )}
          />
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <SectionCard title="CRM pipeline" description="Lead status and value from current CRM records plus imported history.">
          <div className="space-y-3">
            {Object.entries(pipeline).length ? (
              Object.entries(pipeline).map(([status, value]) => (
                <div key={status} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_auto_auto]">
                  <p className="text-sm font-semibold">{status}</p>
                  <p className="text-sm text-muted">{value.count} lead{value.count === 1 ? "" : "s"}</p>
                  <p className="text-sm text-muted">{currencyFormatter.format(value.value)}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No CRM leads yet.</p>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="Leads created" value={leadsCreated.length} detail={period} />
            <StatCard label="Leads converted" value={leadsConverted.length} detail={period} />
            <StatCard label="Lead history" value={leadHistoryChanges.length} detail="Imported changes" />
          </div>
        </SectionCard>

        <SectionCard title="Reports and Vaeroex insights" description="Saved management summaries and recent Vaeroex recommendations.">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">Latest reports</h3>
              <SimpleList
                items={reports.slice(0, 5)}
                empty="No reports generated yet."
                render={(report: ReportRow) => (
                  <div key={report.id} className="rounded-lg border border-line p-3">
                    <p className="text-sm font-semibold">{report.title}</p>
                    <p className="mt-1 text-xs text-muted">{report.report_type} · {new Date(report.created_at).toLocaleDateString()}</p>
                  </div>
                )}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Latest Vaeroex insights</h3>
              <SimpleList
                items={vaeroexRuns.slice(0, 5)}
                empty="No Vaeroex insights yet."
                render={(run: VaeroexRunRow) => (
                  <div key={run.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold capitalize">{run.agent_type.replace(/_/g, " ")}</p>
                      <StatusBadge value={run.status} />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted">{readableOutput(run)}</p>
                  </div>
                )}
              />
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Risks">
          <SimpleList
            items={risks.map((item, index) => ({ id: `${index}`, label: item }))}
            empty="No major risks found for this period."
            render={(item: { id: string; label: string }) => <p key={item.id} className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">{item.label}</p>}
          />
        </SectionCard>

        <SectionCard title="Opportunities">
          <SimpleList
            items={opportunities.map((item, index) => ({ id: `${index}`, label: item }))}
            empty="No clear opportunities found yet."
            render={(item: { id: string; label: string }) => <p key={item.id} className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">{item.label}</p>}
          />
        </SectionCard>

        <SectionCard title="Recommended actions">
          <SimpleList
            items={recommendedActions.map((item, index) => ({ id: `${index}`, label: item }))}
            empty="Keep the current cadence and review again after more activity is recorded."
            render={(item: { id: string; label: string }) => <p key={item.id} className="rounded-lg border border-line bg-slate-50 p-3 text-sm text-slate-700">{item.label}</p>}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/files" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              Review files
            </Link>
            <Link href="/app/reports" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              Generate report
            </Link>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
