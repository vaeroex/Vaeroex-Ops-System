import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import {
  exitDemoWorkspaceAction,
  resetDemoWorkspaceAction
} from "@/app/app/demo/actions";
import { ContextualAskVaeroex } from "@/components/ai/ContextualAskVaeroex";
import { GlobalSearchTrigger } from "@/components/app/GlobalSearchTrigger";
import { BusinessHealthTrendChart, type BusinessHealthTrendPoint } from "@/components/intelligence/BusinessHealthTrendChart";
import { ExecutiveHomepage } from "@/components/intelligence/ExecutiveHomepage";
import { PrestigeOperationsPanel } from "@/components/intelligence/PrestigeOperationsPanel";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { filterEligibleMemoryRowsByLifecycle } from "@/lib/ai/evidence-index";
import { buildBusinessHealthExplanationPackage } from "@/lib/ai/business-health-explanation/context";
import { loadBusinessHealthAnalysisState } from "@/lib/ai/business-health-explanation/storage";
import { trySealBusinessHealthExplanationPackage } from "@/lib/ai/business-health-explanation/token";
import { isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { ensureDemoWorkspacePopulated, getDemoWorkspaceCounts, isDemoWorkspaceRecord } from "@/lib/demo/workspace-demo";
import { getBusinessHealthSnapshotResult, recordDailyBusinessHealthSnapshot } from "@/lib/intelligence/business-health-history";
import { buildBusinessIntelligenceCoverage } from "@/lib/intelligence/coverage";
import { evidenceLineageMetadata, filterBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { buildExecutiveHomepageModel } from "@/lib/intelligence/executive-homepage";
import { generatedOutputHref } from "@/lib/intelligence/generated-output";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import { buildIntelligenceLayer, type IntelligenceLayerResult } from "@/lib/intelligence/layer";
import { buildOperationalEvidenceInsights } from "@/lib/intelligence/operational-evidence";
import { buildPrestigeIntelligence, type PrestigeIntelligence } from "@/lib/intelligence/prestige";
import {
  applyKpiSettingsToRows,
  getConfiguredMetricNames,
  kpiColor,
  kpiWeight,
  sortKpiRowsBySettings,
  type KpiSettingRow
} from "@/lib/kpis/settings";
import type { Database, Json } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type DashboardPageProps = {
  searchParams?: Promise<{ period?: string; view?: string; error?: string; message?: string }>;
};

type DashboardPeriod = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly" | "Year to Date";
type DashboardMode = "Executive View" | "Operations View" | "Intelligence View";
type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type ChecklistRow = Database["public"]["Tables"]["checklists"]["Row"];
type ChecklistRunRow = Database["public"]["Tables"]["checklist_runs"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type AssetRow = Database["public"]["Tables"]["assets"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type CrmLeadHistoryRow = Database["public"]["Tables"]["crm_lead_history"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type OperationalMetricRow = Database["public"]["Tables"]["operational_metrics"]["Row"];
type NotificationRow = Database["public"]["Tables"]["notifications"]["Row"];
type AssignmentRow = Database["public"]["Tables"]["operational_assignments"]["Row"];
type ShareRow = Database["public"]["Tables"]["record_shares"]["Row"];
type PersonRow = Database["public"]["Tables"]["people"]["Row"];
type BusinessDecisionRow = Database["public"]["Tables"]["business_decisions"]["Row"];
type RecommendationOutcomeRow = Database["public"]["Tables"]["vaeroex_recommendation_outcomes"]["Row"];
type BusinessMemoryChunkRow = Database["public"]["Tables"]["business_memory_chunks"]["Row"];
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
  color: string;
  weight: number;
  current: number | null;
  previous: number | null;
  change: number | null;
  changePercent: number | null;
};
type DashboardAlert = {
  id: string;
  severity: "High" | "Medium" | "Low";
  title: string;
  why: string;
  action: string;
  href: string;
};
type DashboardSignal = {
  id: string;
  title: string;
  source: string;
  status?: string | null;
  context: string;
  evidence?: string;
  reasoning?: string;
  confidence?: "High" | "Medium" | "Low";
  recommendedAction?: string;
  href: Route;
};

const PERIODS: DashboardPeriod[] = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "Year to Date"];
const DASHBOARD_MODES: DashboardMode[] = ["Executive View", "Intelligence View", "Operations View"];
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const currencyFormatter = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });

function isDashboardPeriod(value: string | undefined): value is DashboardPeriod {
  return PERIODS.includes(value as DashboardPeriod);
}

function isDashboardMode(value: string | undefined): value is DashboardMode {
  return DASHBOARD_MODES.includes(value as DashboardMode);
}

function dashboardHref(period: DashboardPeriod, mode: DashboardMode) {
  return `/app?period=${encodeURIComponent(period)}&view=${encodeURIComponent(mode)}` as Route;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFileGeneratedReport(report: ReportRow) {
  const source = isRecord(report.source_data_json) ? report.source_data_json : {};
  return source.generated_from === "file" || isRecord(source.file) || Array.isArray(source.attached_files);
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

function buildMetricTrend(kpis: KpiRow[], name: string, range: DateRange, settings: KpiSettingRow[], fallbackIndex = 0): MetricTrend {
  const current = aggregateKpi(kpis, name, range.startDate, range.endDate);
  const previous = aggregateKpi(kpis, name, range.previousStartDate, range.previousEndDate);
  const change = current !== null && previous !== null ? current - previous : null;
  const changePercent = change !== null && previous !== null && previous !== 0 ? (change / Math.abs(previous)) * 100 : null;

  return {
    name,
    rows: rowsForMetric(kpis, name),
    color: kpiColor(name, settings, fallbackIndex),
    weight: kpiWeight(name, settings),
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
  const lifecycle = task as TaskRow & { deleted_at?: string | null; archived_at?: string | null };
  return lower(task.status) !== "done" && lower(task.status) !== "complete" && !lifecycle.deleted_at && !lifecycle.archived_at;
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

function firstNameFromUser(user: { user_metadata?: Record<string, unknown> } | null) {
  const fullName = user?.user_metadata?.full_name;
  const firstName = user?.user_metadata?.first_name;
  const candidate = typeof firstName === "string" ? firstName : typeof fullName === "string" ? fullName.split(/\s+/)[0] : "";
  return candidate.trim() || null;
}

function lastUpdatedLabel(value: string | null) {
  if (!value) return "after more evidence is added";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function StatCard({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone?: string }) {
  return (
    <article className={`rounded-lg border p-4 shadow-panel ${tone || "border-line/80 bg-white text-ink"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-normal">{value}</p>
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

function LineChart({ title, rows, color = "#1E6BFF" }: { title: string; rows: KpiRow[]; color?: string }) {
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
    <div className="overflow-hidden rounded-lg border border-line/80 bg-white shadow-panel">
      <div className="border-b border-line bg-slate-50/80 px-4 py-3">
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
    <div className="overflow-hidden rounded-lg border border-line/80 bg-white shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-slate-50/80 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">Multi-KPI comparison</p>
          <p className="mt-1 text-xs leading-5 text-muted">Indexed trend lines compare different metric types without mixing units.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
          {usable.map((trend) => (
            <span key={trend.name} className="inline-flex items-center gap-2">
              <span className="h-2 w-5 rounded-full" style={{ backgroundColor: trend.color }} />
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
          {usable.map((trend) => {
            const rows = trend.rows.slice(-12);
            const values = rows.map((row) => row.actual_value as number);
            const points = rows.map((row, rowIndex) => `${xFor(rowIndex, rows.length)},${yFor(normalizedValue(row.actual_value as number, values))}`).join(" ");

            return (
              <polyline
                key={trend.name}
                fill="none"
                points={points}
                stroke={trend.color}
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

function isOlderThan(value: string | null | undefined, days: number) {
  if (!value) {
    return false;
  }

  return new Date(value).getTime() < Date.now() - days * 24 * 60 * 60 * 1000;
}

function severityTone(severity: DashboardAlert["severity"]) {
  if (severity === "High") return "border-red-200 bg-red-50 text-red-700";
  if (severity === "Medium") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-vaeroex-accent/50 bg-vaeroex-soft text-vaeroex-blue";
}

function latestKpisByName(kpis: KpiRow[]) {
  const latest = new Map<string, KpiRow>();

  for (const row of kpis) {
    if (!latest.has(row.name)) {
      latest.set(row.name, row);
    }
  }

  return [...latest.values()];
}

function groupCounts(values: Array<string | null | undefined>) {
  return values.reduce<Record<string, number>>((counts, value) => {
    const label = value || "Workspace";
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {});
}

function buildSmartAlerts({
  overdueTasks,
  unassignedTasks,
  belowTargetKpis,
  crmLeadsWithoutFollowup,
  staleSops,
  oldIssues,
  unanalyzedFiles,
  hasCurrentReport,
  checklistsWithoutRecentRuns
}: {
  overdueTasks: TaskRow[];
  unassignedTasks: TaskRow[];
  belowTargetKpis: KpiRow[];
  crmLeadsWithoutFollowup: CrmLeadRow[];
  staleSops: SopRow[];
  oldIssues: IssueRow[];
  unanalyzedFiles: FileUploadRow[];
  hasCurrentReport: boolean;
  checklistsWithoutRecentRuns: ChecklistRow[];
}) {
  return [
    overdueTasks.length
      ? {
          id: "source-signal-pattern",
          severity: "High",
          title: `${overdueTasks.length} Business Signal${overdueTasks.length === 1 ? "" : "s"} may indicate a pattern`,
          why: "Business Signals are evidence and context. A concentrated pattern may indicate slower response speed, customer friction, or process drift.",
          action: "Review the Business Signal pattern with leadership",
          href: "/app/tasks"
        }
      : null,
    unassignedTasks.length
      ? {
          id: "unassigned-tasks",
          severity: "Medium",
          title: `${unassignedTasks.length} business signal${unassignedTasks.length === 1 ? "" : "s"} with limited context`,
          why: "Signals with limited context make it harder for leadership to understand whether the pattern is isolated or systemic.",
          action: "Review business context",
          href: "/app/tasks"
        }
      : null,
    belowTargetKpis.length
      ? {
          id: "kpis-below-target",
          severity: "High",
          title: `${belowTargetKpis.length} KPI${belowTargetKpis.length === 1 ? "" : "s"} below target`,
          why: "Below-target metrics should be reviewed against Business Signals, customer activity evidence, and open risks.",
          action: "Review KPIs",
          href: "/app/kpis"
        }
      : null,
    crmLeadsWithoutFollowup.length
      ? {
          id: "crm-followup",
          severity: "Medium",
          title: `${crmLeadsWithoutFollowup.length} customer activity record${crmLeadsWithoutFollowup.length === 1 ? "" : "s"} show response gaps`,
          why: "Customer records without recent activity can indicate retention, conversion, or response-quality risk.",
          action: "Review customer activity evidence",
          href: "/app/sources"
        }
      : null,
    staleSops.length
      ? {
          id: "stale-sops",
          severity: "Low",
          title: `${staleSops.length} SOP${staleSops.length === 1 ? "" : "s"} may need review`,
          why: "Procedures that have not been touched recently can drift away from how the team actually works.",
          action: "Review SOPs",
          href: "/app/sops"
        }
      : null,
    oldIssues.length
      ? {
          id: "old-issues",
          severity: "High",
          title: `${oldIssues.length} issue${oldIssues.length === 1 ? "" : "s"} open too long`,
          why: "Long-running issues often signal process breakdowns that need a manager decision.",
          action: "Review issues",
          href: "/app/issues"
        }
      : null,
    unanalyzedFiles.length
      ? {
          id: "unanalyzed-files",
          severity: "Medium",
          title: `${unanalyzedFiles.length} uploaded file${unanalyzedFiles.length === 1 ? "" : "s"} not reviewed`,
          why: "Uploaded files should either feed historical memory or produce clear findings for reports.",
          action: "Review files",
          href: "/app/sources"
        }
      : null,
    !hasCurrentReport
      ? {
          id: "missing-report",
          severity: "Low",
          title: "No report generated for this period",
          why: "A saved report gives leadership a clean management summary and a record of decisions.",
          action: "Generate report",
          href: "/app/reports"
        }
      : null,
    checklistsWithoutRecentRuns.length
      ? {
          id: "checklist-runs",
          severity: "Medium",
          title: `${checklistsWithoutRecentRuns.length} checklist${checklistsWithoutRecentRuns.length === 1 ? "" : "s"} have no recent run`,
          why: "Checklists only improve intelligence when they are actually completed and reviewed.",
          action: "Run checklists",
          href: "/app/checklists"
        }
      : null
  ].filter(Boolean) as DashboardAlert[];
}

function DashboardAccordion({
  title,
  summary,
  children,
  defaultOpen = false
}: {
  title: string;
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="group rounded-lg border border-white/10 bg-[#08111f] shadow-panel">
      <summary className="flex min-h-11 cursor-pointer list-none flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h3 className="text-base font-semibold text-white">{title}</h3>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-400">{summary}</p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300 group-open:bg-cyan-400/10 group-open:text-cyan-100">
          Details
        </span>
      </summary>
      <div className="space-y-4 border-t border-white/10 p-5">{children}</div>
    </details>
  );
}

function confidenceForSignal(item: DashboardSignal, tone: "risk" | "opportunity" | "action") {
  if (item.confidence) {
    return item.confidence;
  }

  const normalized = lower(item.status);

  if (normalized.includes("urgent") || normalized.includes("high") || normalized.includes("below") || normalized.includes("declin") || normalized.includes("failed")) {
    return "High";
  }

  if (normalized.includes("medium") || normalized.includes("needs") || normalized.includes("recommended") || tone === "action") {
    return "Medium";
  }

  return tone === "opportunity" ? "Medium" : "Low";
}

function confidenceTone(confidence: "High" | "Medium" | "Low") {
  if (confidence === "High") return "border-cyan-300/40 bg-cyan-400/15 text-cyan-100";
  if (confidence === "Medium") return "border-blue-300/30 bg-blue-500/15 text-blue-100";
  return "border-slate-400/30 bg-slate-500/15 text-slate-100";
}

function signalEvidence(item: DashboardSignal) {
  return item.evidence || item.context;
}

function compactSignalText(value: string | null | undefined, fallback: string, maxLength = 150) {
  const text = (value || fallback).replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  const shortened = text.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
  return `${shortened}...`;
}

function signalReasoning(item: DashboardSignal, tone: "risk" | "opportunity" | "action") {
  if (item.reasoning) {
    return item.reasoning;
  }

  if (tone === "risk") {
    return `Vaeroex surfaced this because ${item.source.toLowerCase()} activity may create execution risk if it remains unresolved.`;
  }

  if (tone === "opportunity") {
    return `Vaeroex surfaced this because ${item.source.toLowerCase()} activity may indicate clearer revenue, process, or leadership improvement potential.`;
  }

  return `Vaeroex surfaced this because the related records point to a leadership decision or Business Signal review.`;
}

function signalRecommendedAction(item: DashboardSignal, tone: "risk" | "opportunity" | "action") {
  if (item.recommendedAction) {
    return item.recommendedAction;
  }

  if (tone === "risk") {
    return "Review the source evidence and decide whether leadership needs an executive report or improvement plan.";
  }

  if (tone === "opportunity") {
    return "Open the related evidence and decide whether leadership needs a report, meeting agenda, or improvement plan.";
  }

  return "Review the executive recommendation and decide what leadership should examine next.";
}

function EvidenceDisclosure({
  evidence,
  why,
  action,
  compact = false
}: {
  evidence: string;
  why: string;
  action: string;
  compact?: boolean;
}) {
  return (
    <details className={`mt-3 rounded-lg border border-white/10 bg-slate-950/35 ${compact ? "p-3" : "p-4"}`}>
      <summary className="cursor-pointer text-xs font-semibold text-vaeroex-accent">View evidence and confidence</summary>
      <dl className="mt-3 grid gap-2 text-xs leading-5 text-slate-300">
        <div>
          <dt className="font-semibold text-slate-100">Data used</dt>
          <dd className="mt-1">{evidence}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-100">Why Vaeroex surfaced it</dt>
          <dd className="mt-1">{why}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-100">Executive recommendation</dt>
          <dd className="mt-1">{action}</dd>
        </div>
      </dl>
    </details>
  );
}

function confidenceForPriority(priority: string | undefined) {
  if (priority === "Urgent" || priority === "High") return "High";
  if (priority === "Medium") return "Medium";
  return "Low";
}

function IntelligencePriorityTools({ intelligence }: { intelligence: PrestigeIntelligence }) {
  const recommendation = intelligence.recommendationTracking.approvalQueue[0];
  const profitLeak = intelligence.profitLeaks[0];
  const memory = intelligence.memoryTimeline[0];
  const risk = intelligence.riskSimulation[0];
  const decision = intelligence.decisions.reviewDue[0] || intelligence.decisions.recent[0];
  const benchmark = intelligence.benchmarkMode[0];
  const tools = [
    {
      title: "Recommendation Queue",
      href: recommendation?.href || ("/app/tasks" as Route),
      evidence: recommendation?.evidence || `${intelligence.recommendationTracking.approvalQueue.length} recommendation${intelligence.recommendationTracking.approvalQueue.length === 1 ? "" : "s"} waiting for review.`,
      reasoning: recommendation?.why || "Vaeroex produces recommendations for human review; execution stays in the systems and teams the business already uses.",
      confidence: confidenceForPriority(recommendation?.priority),
      action: recommendation?.action || "Review the queue and choose which recommendation needs an executive report, meeting agenda, or improvement plan."
    },
    {
      title: "Profit Leak Detector",
      href: profitLeak?.href || ("/app/sources" as Route),
      evidence: profitLeak?.evidence || `${intelligence.profitLeaks.length} profit leak signal${intelligence.profitLeaks.length === 1 ? "" : "s"} detected.`,
      reasoning: profitLeak?.why || "Vaeroex looks for missed revenue, stalled customer response, unresolved issues, and unclear Business Signals.",
      confidence: confidenceForPriority(profitLeak?.priority),
      action: profitLeak?.action || "Review customer activity, KPI, and issue evidence for avoidable leakage before the next leadership review."
    },
    {
      title: "Business Memory",
      href: memory?.href || ("/app/reports" as Route),
      evidence: memory?.whatHappened || `${intelligence.memoryTimeline.length} memory record${intelligence.memoryTimeline.length === 1 ? "" : "s"} stored.`,
      reasoning: memory?.cause || "Vaeroex uses prior reports, decisions, imports, and outcomes to explain why current signals matter.",
      confidence: memory ? "Medium" : "Low",
      action: memory?.actionTaken || "Log decisions, reports, and outcomes so future briefings can compare what changed."
    },
    {
      title: "Risk Simulation",
      href: risk?.href || ("/app/issues" as Route),
      evidence: risk?.evidence || `${intelligence.riskSimulation.length} forward-looking risk scenario${intelligence.riskSimulation.length === 1 ? "" : "s"} generated.`,
      reasoning: risk?.why || "Vaeroex projects unresolved signals forward so leaders can decide before the issue becomes normal.",
      confidence: confidenceForPriority(risk?.priority),
      action: risk?.action || "Review the scenario and decide whether leadership needs an executive report, meeting agenda, or escalation discussion."
    },
    {
      title: "Decision Journal",
      href: "/app" as Route,
      evidence: decision?.reason || decision?.expected_outcome || `${intelligence.decisions.recent.length} recent decision${intelligence.decisions.recent.length === 1 ? "" : "s"} available.`,
      reasoning: decision ? "A saved leadership decision can be reviewed against later outcomes and business memory." : "No decision record is available yet, so Vaeroex has less context for why actions were taken.",
      confidence: decision ? "Medium" : "Low",
      action: decision ? "Review whether the expected outcome happened, then update the decision status." : "Log the next leadership decision so Vaeroex can track the reason and outcome."
    },
    {
      title: "Benchmark Mode",
      href: "/app/kpis" as Route,
      evidence: benchmark?.evidence || `${intelligence.benchmarkMode.length} operating benchmark${intelligence.benchmarkMode.length === 1 ? "" : "s"} available.`,
      reasoning: "Vaeroex compares this workspace against default operating standards, not anonymous customer data.",
      confidence: benchmark?.status === "Missing data" ? "Low" : "Medium",
      action: benchmark?.recommendedAction || "Use benchmark gaps to decide which KPI, checklist, or report needs stronger structure."
    }
  ];

  return (
    <section className="grid gap-4 xl:grid-cols-3">
      {tools.map((tool) => (
        <article
          key={tool.title}
          className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel transition hover:border-cyan-300/45 hover:bg-blue-950/25"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">{tool.title}</h3>
            <span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${confidenceTone(tool.confidence as "High" | "Medium" | "Low")}`}>
              {tool.confidence} confidence
            </span>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-300">
            <span className="font-semibold text-slate-100">Executive recommendation:</span> {tool.action}
          </p>
          <EvidenceDisclosure evidence={tool.evidence} why={tool.reasoning} action={tool.action} compact />
          <Link
            href={tool.href}
            className="mt-4 inline-flex rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-vaeroex-accent hover:border-cyan-200 hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
          >
            Open related context
          </Link>
        </article>
      ))}
    </section>
  );
}

function SignalList({
  items,
  empty,
  tone
}: {
  items: DashboardSignal[];
  empty: string;
  tone: "risk" | "opportunity" | "action";
}) {
  const toneClasses = {
    risk:
      "border-red-400/40 bg-red-950/30 text-red-100 shadow-sm shadow-red-950/20 hover:border-red-300/70 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 active:bg-red-950/60",
    opportunity:
      "border-emerald-400/40 bg-emerald-950/30 text-emerald-100 shadow-sm shadow-emerald-950/20 hover:border-cyan-400/50 hover:bg-emerald-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 active:bg-emerald-950/60",
    action:
      "border-cyan-400/30 bg-slate-950/70 text-slate-100 shadow-sm shadow-slate-950/20 hover:border-cyan-400/60 hover:bg-blue-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 active:bg-blue-950/50"
  };

  return (
    <SimpleList
      items={items}
      empty={empty}
      render={(item: DashboardSignal) => (
        <article
          key={item.id}
          className={`rounded-lg border p-3 text-sm transition ${toneClasses[tone]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold leading-5">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 opacity-90">{item.context}</p>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${confidenceTone(confidenceForSignal(item, tone))}`}>
              {confidenceForSignal(item, tone)}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-5 opacity-90">
            <span className="font-semibold opacity-95">Evidence:</span> {signalEvidence(item)}
          </p>
          <div className="mt-3">
            <ContextualAskVaeroex
              label="Explain This"
              prompt="Explain what this intelligence signal means, why it matters, which evidence supports it, and what remains uncertain. Stay focused on this signal."
              contextType={`home_${tone}_signal`}
              contextId={item.id}
              sourceTitle={item.title}
              sourceSummary={item.context}
              evidence={[
                `Source: ${item.source}`,
                `Status: ${item.status || "Not labeled"}`,
                `Evidence: ${signalEvidence(item)}`,
                `Reasoning: ${signalReasoning(item, tone)}`,
                `Confidence: ${confidenceForSignal(item, tone)}`,
                `Leadership review: ${signalRecommendedAction(item, tone)}`
              ]}
              compact
            />
          </div>
        </article>
      )}
    />
  );
}

function intelligenceHealthTone(status: IntelligenceLayerResult["businessHealth"]["status"]) {
  if (status === "Strong") return "border-emerald-300/35 bg-emerald-400/10 text-emerald-100";
  if (status === "Watch") return "border-amber-300/35 bg-amber-400/10 text-amber-100";
  if (status === "At Risk") return "border-red-300/35 bg-red-400/10 text-red-100";
  return "border-slate-300/25 bg-white/[0.05] text-slate-100";
}

function IntelligenceLayerSummary({
  intelligence,
  businessHealthHistory,
  businessHealthHistoryError,
  isDemoWorkspace
}: {
  intelligence: IntelligenceLayerResult;
  businessHealthHistory: BusinessHealthTrendPoint[];
  businessHealthHistoryError?: string | null;
  isDemoWorkspace: boolean;
}) {
  const briefingCards = [
    {
      label: "Top risk",
      title: intelligence.topRisk?.title || "No major risk visible",
      body: intelligence.topRisk?.summary || "Vaeroex does not see a strong active risk signal yet.",
      href: intelligence.topRisk ? generatedOutputHref({ type: "risk_brief", source: intelligence.topRisk.id }) : ("/app/intelligence" as Route),
      tone: "border-red-400/30 bg-red-950/25"
    },
    {
      label: "Top opportunity",
      title: intelligence.topOpportunity?.title || "Needs more context",
      body: intelligence.topOpportunity?.summary || "Add customer, KPI, file, or report history to reveal stronger opportunities.",
      href: intelligence.topOpportunity ? generatedOutputHref({ type: "executive_briefing", source: intelligence.topOpportunity.id }) : ("/app/sources" as Route),
      tone: "border-emerald-400/30 bg-emerald-950/25"
    },
    {
      label: "Executive recommendation",
      title: intelligence.topRecommendation?.recommendedAction || "Add source data",
      body: intelligence.topRecommendation?.why || "Vaeroex recommends adding business context before making stronger executive recommendations.",
      href: intelligence.topRecommendation ? generatedOutputHref({ type: "action_plan", source: intelligence.topRecommendation.id }) : ("/app/reports" as Route),
      tone: "border-cyan-400/30 bg-cyan-950/25"
    }
  ];
  const memorySignals = intelligence.memorySummary.sourceRecords + intelligence.memorySummary.kpiHistoryRecords;
  const briefingEvidence = [
    `Business health: ${intelligence.businessHealth.score}/100 (${intelligence.businessHealth.status})`,
    `Trend: ${intelligence.businessHealth.trend}`,
    `Data confidence: ${intelligence.dataQuality.confidence} (${intelligence.dataQuality.score}/100)`,
    `Business Memory signals: ${memorySignals}`,
    intelligence.topRisk
      ? `Top Risk: ${intelligence.topRisk.title}. ${intelligence.topRisk.summary} Evidence: ${intelligence.topRisk.evidence.join("; ")}`
      : "Top Risk: no major risk visible",
    intelligence.topOpportunity
      ? `Top Opportunity: ${intelligence.topOpportunity.title}. ${intelligence.topOpportunity.summary} Evidence: ${intelligence.topOpportunity.evidence.join("; ")}`
      : "Top Opportunity: more context needed",
    intelligence.topRecommendation
      ? `Executive Recommendation: ${intelligence.topRecommendation.recommendedAction}. Why: ${intelligence.topRecommendation.why}`
      : "Executive Recommendation: add source data",
    intelligence.topForecast
      ? `Forecast signal: ${intelligence.topForecast.title}. Confidence: ${intelligence.topForecast.confidence}`
      : `Forecast readiness: ${intelligence.forecastReadiness.label}. ${intelligence.forecastReadiness.reason}`
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-cyan-300/20 bg-[#061225] text-white shadow-command">
      <div className="grid gap-5 p-5 xl:grid-cols-[.78fr_1.22fr] xl:p-6">
        <div className="rounded-lg border border-white/10 bg-white/[0.05] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-vaeroex-accent">Business health</p>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${intelligenceHealthTone(intelligence.businessHealth.status)}`}>
              {intelligence.businessHealth.status}
            </span>
          </div>
          <div className="mt-5 flex items-end gap-3">
            <p className="text-6xl font-semibold tracking-tight">{intelligence.businessHealth.score}</p>
            <p className="pb-2 text-lg font-semibold text-slate-300">/ 100</p>
          </div>
          <dl className="mt-5 grid gap-3 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/35 px-3 py-2">
              <dt className="text-slate-400">Trend</dt>
              <dd className="font-semibold text-slate-100">{intelligence.businessHealth.trend}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/35 px-3 py-2">
              <dt className="text-slate-400">Data confidence</dt>
              <dd className="font-semibold text-slate-100">{intelligence.dataQuality.confidence}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-950/35 px-3 py-2">
              <dt className="text-slate-400">Business memory</dt>
              <dd className="font-semibold text-slate-100">{intelligence.memorySummary.sourceRecords + intelligence.memorySummary.kpiHistoryRecords} signals</dd>
            </div>
          </dl>
          <BusinessHealthTrendChart
            points={businessHealthHistory}
            currentScore={intelligence.businessHealth.score}
            currentStatus={intelligence.businessHealth.status}
            currentTrend={intelligence.businessHealth.trend}
            isDemoWorkspace={isDemoWorkspace}
            errorMessage={businessHealthHistoryError}
          />
        </div>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-vaeroex-accent">Vaeroex briefing</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">What leadership should know now</h2>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">{intelligence.executiveSummary}</p>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {briefingCards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className={`rounded-lg border p-4 text-slate-100 transition hover:border-cyan-300/50 hover:bg-blue-950/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50 ${card.tone}`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-300">{card.label}</p>
                <h3 className="mt-3 line-clamp-2 text-base font-semibold text-white">{card.title}</h3>
                <p className="mt-2 line-clamp-3 text-xs leading-5 text-slate-300">{card.body}</p>
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/app/intelligence" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
              Open Intelligence
            </Link>
            <Link href="/app/sources" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">
              Add evidence
            </Link>
          </div>
          <div className="rounded-lg border border-cyan-300/20 bg-slate-950/35 p-4">
            <div className="mb-3">
              <p className="text-sm font-semibold text-white">Explain this briefing</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Generate an inline explanation of this recommendation without leaving Home.
              </p>
            </div>
            <ContextualAskVaeroex
              label="Explain This"
              prompt="Explain the current Home briefing directly. Describe what it means, why it matters, which supplied evidence supports it, and any meaningful uncertainty. Do not expand into a general report or forecast."
              contextType="home_leadership_briefing"
              contextId="home-what-leadership-should-know-now"
              sourceTitle="What leadership should know now"
              sourceSummary={intelligence.executiveSummary}
              evidence={briefingEvidence}
              compact
              defaultCollapsed={false}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function IntelligenceBriefingHero({
  risk,
  opportunity,
  attention,
  action,
  period
}: {
  risk?: DashboardSignal;
  opportunity?: DashboardSignal;
  attention?: DashboardSignal;
  action?: DashboardSignal;
  period: DashboardPeriod;
}) {
  const briefingItems = [
    {
      id: "risk",
      question: "Top Risk",
      fallback: "No major risk is visible yet.",
      emptyBody: "Vaeroex needs more business context before surfacing a high-confidence risk.",
      detailLabel: "Evidence",
      item: risk,
      tone: "risk" as const
    },
    {
      id: "opportunity",
      question: "Top Opportunity",
      fallback: "No clear opportunity is visible yet.",
      emptyBody: "Add more KPI history, reports, or Business Signals to reveal stronger opportunity patterns.",
      detailLabel: "Evidence",
      item: opportunity,
      tone: "opportunity" as const
    },
    {
      id: "action",
      question: "Executive Recommendation",
      fallback: "Keep adding records so Vaeroex can build a stronger recommendation queue.",
      emptyBody: "Vaeroex will recommend a leadership review when the evidence is stronger.",
      detailLabel: "Reason",
      item: action,
      tone: "action" as const
    }
  ];
  const briefingEvidence = [
    `Period: ${period}`,
    risk ? `Biggest risk: ${risk.title}. ${risk.context}. Evidence: ${signalEvidence(risk)}` : "Biggest risk: no major risk visible",
    opportunity
      ? `Biggest opportunity: ${opportunity.title}. ${opportunity.context}. Evidence: ${signalEvidence(opportunity)}`
      : "Biggest opportunity: no clear opportunity visible",
    attention
      ? `Requires attention: ${attention.title}. ${attention.context}. Recommended: ${signalRecommendedAction(attention, "risk")}`
      : "Requires attention: no immediate attention item visible",
    action
      ? `Executive recommendation: ${action.title}. ${action.context}. Recommended: ${signalRecommendedAction(action, "action")}`
      : "Executive recommendation: keep adding records for stronger recommendations"
  ];

  return (
    <section className="overflow-hidden rounded-lg border border-cyan-300/20 bg-[#061225] text-white shadow-command">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_15%_0%,rgba(56,189,248,0.22),transparent_34%),linear-gradient(135deg,rgba(30,107,255,0.18),transparent_58%)] p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-vaeroex-accent">Leadership Intelligence Briefing</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">What should leadership know that is not immediately obvious?</h2>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-200">
              Vaeroex is reading the {period.toLowerCase()} workspace context for risk, opportunity, attention, and the next decision.
            </p>
          </div>
          <div className="w-full max-w-md rounded-lg border border-cyan-300/20 bg-slate-950/30 p-3 lg:w-auto">
            <ContextualAskVaeroex
              label="Explain This"
              prompt="Explain this leadership briefing directly. Connect only the selected risk, opportunity, and recommendation when the supplied evidence supports that relationship, then state any meaningful uncertainty."
              contextType="home_intelligence_briefing"
              contextId={`home-intelligence-briefing-${period}`}
              sourceTitle="Leadership Intelligence Briefing"
              sourceSummary={`Risk: ${risk?.title || "none visible"}. Opportunity: ${opportunity?.title || "none visible"}. Executive recommendation: ${action?.title || "keep adding context"}.`}
              evidence={briefingEvidence}
              compact
              defaultCollapsed={false}
            />
          </div>
        </div>
      </div>

      <div className="grid items-start gap-3 p-4 md:grid-cols-3 lg:p-5">
        {briefingItems.map(({ id, question, fallback, emptyBody, detailLabel, item, tone }) => {
          const confidence = item ? confidenceForSignal(item, tone) : "Low";
          const body = item
            ? compactSignalText(item.context, "Vaeroex is still learning from the available workspace context.", 145)
            : emptyBody;
          const detail = item
            ? compactSignalText(
                id === "action" ? signalReasoning(item, tone) : signalEvidence(item),
                "Workspace evidence is still limited.",
                125
              )
            : "More source data needed.";

          return (
            <article key={id} className="min-h-[168px] rounded-lg border border-white/10 bg-white/[0.055] p-3 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                  {question}
                </span>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${confidenceTone(confidence)}`}>
                  Confidence: {confidence}
                </span>
              </div>

              <h3 className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-white">
                {compactSignalText(item?.title, fallback, 92)}
              </h3>

              <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">
                {body}
              </p>

              <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-300">
                <span className="font-semibold text-white">{detailLabel}:</span> {detail}
              </p>

              {item ? (
                <div className="mt-3">
                  {id === "action" ? (
                    <Link
                      href={generatedOutputHref({
                        type: "executive_briefing",
                        title: item.title,
                        summary: item.context,
                        why: signalReasoning(item, tone),
                        remedy: signalRecommendedAction(item, tone)
                      })}
                      className="inline-flex min-h-10 items-center rounded-lg border border-cyan-300/25 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-vaeroex-accent/60 hover:bg-cyan-950/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
                    >
                      Generate Executive Brief
                    </Link>
                  ) : (
                    <ContextualAskVaeroex
                      label="Explain This"
                      prompt="Explain what this briefing card means, why it matters, which evidence supports it, and what remains uncertain. Stay focused on this card."
                      contextType={`home_briefing_${id}`}
                      contextId={item.id}
                      sourceTitle={item.title}
                      sourceSummary={item.context}
                      evidence={[
                        `Source: ${item.source}`,
                        `Status: ${item.status || "Not labeled"}`,
                        `Evidence: ${signalEvidence(item)}`,
                        `Reasoning: ${signalReasoning(item, tone)}`,
                        `Confidence: ${confidence}`,
                        `Leadership review: ${signalRecommendedAction(item, tone)}`
                      ]}
                      compact
                    />
                  )}
                </div>
              ) : (
                <p className="mt-3 text-xs leading-5 text-slate-400">Add more records, imports, decisions, and outcomes to strengthen this signal.</p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function DemoActionButton({ children, tone = "secondary" }: { children: ReactNode; tone?: "primary" | "secondary" | "danger" }) {
  const className =
    tone === "primary"
      ? "rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white"
      : tone === "danger"
        ? "rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-semibold text-red-700"
        : "rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink";

  return <button className={className}>{children}</button>;
}

function DemoWorkspaceBanner({
  counts,
  canUseAdminTools
}: {
  counts: {
    kpis: number;
    operationalMetrics: number;
    crm: number;
    tasks: number;
    issues: number;
    reports: number;
    sops: number;
    files: number;
    fileAnalyses: number;
    assets: number;
    checklists: number;
    alerts: number;
    insights: number;
  };
  canUseAdminTools: boolean;
}) {
  const summaryItems = [
    ["Demo KPIs", counts.kpis],
    ["Demo Customer Evidence", counts.crm],
    ["Demo Business Signals", counts.tasks],
    ["Demo Reports", counts.reports],
    ["Demo Issues", counts.issues]
  ];
  const countItems = [
    ["KPIs", counts.kpis],
    ["Business metrics", counts.operationalMetrics],
    ["Customer activity evidence", counts.crm],
    ["Business Signals", counts.tasks],
    ["Open issues", counts.issues],
    ["Reports", counts.reports],
    ["SOPs", counts.sops],
    ["Files", counts.files],
    ["File analyses", counts.fileAnalyses],
    ["Assets", counts.assets],
    ["Checklists", counts.checklists],
    ["Alerts", counts.alerts],
    ["Vaeroex insights", counts.insights]
  ];

  return (
    <section className="rounded-lg border-2 border-vaeroex-accent/60 bg-vaeroex-soft p-5 text-vaeroex-navy shadow-panel">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em]">Workspace mode</p>
          <h2 className="mt-2 text-3xl font-black uppercase tracking-wide">DEMO WORKSPACE</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6">
            Demo Workspace &mdash; operations intelligence sample data from January to current month. No real emails or customer notifications are sent.
            It includes YTD KPI movement, customer activity evidence, weak-month alerts, reports, Business Signals, issues, SOPs, checklist history, files, decisions, and Vaeroex insights.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canUseAdminTools ? (
            <form action={resetDemoWorkspaceAction}>
              <DemoActionButton tone="danger">Reset demo workspace</DemoActionButton>
            </form>
          ) : null}
          <form action={exitDemoWorkspaceAction}>
            <DemoActionButton>Switch back to my workspace</DemoActionButton>
          </form>
        </div>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <article className="rounded-lg border border-vaeroex-accent/40 bg-white/80 p-4">
          <p className="text-sm font-semibold">March dip</p>
          <p className="mt-2 text-xs leading-5">
            Revenue fell below target while response time increased, conversion dropped, and checklist completion missed the mark.
          </p>
        </article>
        <article className="rounded-lg border border-vaeroex-accent/40 bg-white/80 p-4">
          <p className="text-sm font-semibold">April and May recovery</p>
          <p className="mt-2 text-xs leading-5">
            SOP review, checklist review, and customer activity visibility helped the business recover from the weak month.
          </p>
        </article>
        <article className="rounded-lg border border-vaeroex-accent/40 bg-white/80 p-4">
          <p className="text-sm font-semibold">Current month signals</p>
          <p className="mt-2 text-xs leading-5">
            Revenue is healthy, but response time, conversion, Business Signals, and checklist completion still need leadership attention.
          </p>
        </article>
      </div>
      <div className="mt-5 rounded-lg border border-vaeroex-accent/40 bg-white/80 p-4">
        <p className="text-sm font-semibold">Demo Dashboard Summary</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {summaryItems.map(([label, value]) => (
            <div key={label} className="rounded-lg bg-vaeroex-soft p-3">
              <p className="text-2xl font-semibold">{value}</p>
              <p className="mt-1 text-xs leading-4">{label}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {countItems.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-white/80 p-3">
            <p className="text-lg font-semibold">{value}</p>
            <p className="mt-1 text-xs leading-4">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export default async function AppDashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const period = isDashboardPeriod(params?.period) ? params.period : "Weekly";
  const dashboardMode = isDashboardMode(params?.view) ? params.view : "Executive View";
  const range = rangeForPeriod(period);
  const { supabase, context, workspaceId } = await requireWorkspacePage();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const canUseAdminOnboardingTools = isVaeroexAdminUser(user);
  const isViewingDemoWorkspace = isDemoWorkspaceRecord(context.activeWorkspace);

  if (isViewingDemoWorkspace && user) {
    await ensureDemoWorkspacePopulated(supabase, workspaceId, user);
  }

  const [
    kpiResult,
    kpiSettingsResult,
    taskResult,
    issueResult,
    checklistResult,
    checklistRunResult,
    sopResult,
    fileResult,
    importResult,
    assetResult,
    crmLeadResult,
    crmHistoryResult,
    reportResult,
    vaeroexRunResult,
    metricResult,
    notificationResult,
    assignmentResult,
    shareResult,
    peopleResult,
    decisionResult,
    recommendationOutcomeResult,
    memoryChunksResult
  ] = await Promise.all([
    supabase
      .from("kpis")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("metric_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("kpi_settings").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true }).order("weight", { ascending: false }),
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("checklists").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("assets").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("crm_lead_history").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(10),
    supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(10),
    supabase.from("operational_metrics").select("*").eq("workspace_id", workspaceId).order("metric_date", { ascending: false }).limit(500),
    supabase
      .from("notifications")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("operational_assignments").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("due_date", { ascending: true, nullsFirst: false }).limit(60),
    supabase.from("record_shares").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(40),
    supabase.from("people").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name").limit(100),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(30),
    supabase
      .from("vaeroex_recommendation_outcomes")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("business_memory_chunks").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).is("archived_at", null).limit(500)
  ]);

  const rawKpis = (kpiResult.data || []) as KpiRow[];
  const rawCrmLeads = (crmLeadResult.data || []) as CrmLeadRow[];
  const rawCrmHistory = (crmHistoryResult.data || []) as CrmLeadHistoryRow[];
  const rawOperationalMetrics = (metricResult.data || []) as OperationalMetricRow[];
  const sourceParentResult = await loadSourceParentEligibilityResult({
    supabase,
    workspaceId,
    rows: [...rawKpis, ...rawCrmLeads, ...rawCrmHistory, ...rawOperationalMetrics]
  });
  const sourceParentEligibility = sourceParentResult.eligibility;
  const kpiSettings = (kpiSettingsResult.data || []) as KpiSettingRow[];
  const kpis = filterBySourceParentEligibility(
    filterBusinessEvidence(sortKpiRowsBySettings(applyKpiSettingsToRows(rawKpis, kpiSettings), kpiSettings) as KpiRow[]),
    sourceParentEligibility
  );
  const tasks = filterBusinessEvidence((taskResult.data || []) as TaskRow[]);
  const issues = filterBusinessEvidence((issueResult.data || []) as IssueRow[]);
  const checklists = filterBusinessEvidence((checklistResult.data || []) as ChecklistRow[]);
  const activeChecklistIds = new Set(checklists.map((checklist) => checklist.id));
  const checklistRuns = filterBusinessEvidence((checklistRunResult.data || []) as ChecklistRunRow[])
    .filter((run) => activeChecklistIds.has(run.checklist_id));
  const sops = filterBusinessEvidence((sopResult.data || []) as SopRow[]);
  const files = filterBusinessEvidence((fileResult.data || []) as FileUploadRow[]);
  const activeFileIds = new Set(files.map((file) => file.id));
  const imports = filterBusinessEvidence((importResult.data || []) as FileImportRow[])
    .filter((item) => activeFileIds.has(item.file_upload_id));
  const assets = filterBusinessEvidence((assetResult.data || []) as AssetRow[]);
  const crmLeads = filterBySourceParentEligibility(filterBusinessEvidence(rawCrmLeads), sourceParentEligibility);
  const activeCustomerEvidenceIds = new Set(crmLeads.map((lead) => lead.id));
  const crmHistory = filterBySourceParentEligibility(filterBusinessEvidence(rawCrmHistory), sourceParentEligibility)
    .filter((history) => activeCustomerEvidenceIds.has(history.lead_id));
  const reports = filterBusinessEvidence((reportResult.data || []) as ReportRow[]);
  const vaeroexRuns = (vaeroexRunResult.data || []) as VaeroexRunRow[];
  const businessEvidenceRuns = filterBusinessEvidence(vaeroexRuns, { sourceKind: "platform_run" });
  const operationalMetrics = filterBySourceParentEligibility(filterBusinessEvidence(rawOperationalMetrics), sourceParentEligibility);
  const notifications = (notificationResult.data || []) as NotificationRow[];
  const assignments = (assignmentResult.data || []) as AssignmentRow[];
  const shares = (shareResult.data || []) as ShareRow[];
  const people = filterBusinessEvidence((peopleResult.data || []) as PersonRow[]);
  const decisions = filterBusinessEvidence((decisionResult.data || []) as BusinessDecisionRow[]);
  const recommendationOutcomes = filterBusinessEvidence((recommendationOutcomeResult.data || []) as RecommendationOutcomeRow[]);
  let memoryChunks = [] as BusinessMemoryChunkRow[];
  let memoryEligibilityError: Error | null = null;
  try {
    memoryChunks = await filterEligibleMemoryRowsByLifecycle({
      supabase,
      workspaceId,
      rows: (memoryChunksResult.data || []) as BusinessMemoryChunkRow[]
    }) as BusinessMemoryChunkRow[];
  } catch (error) {
    memoryEligibilityError = error instanceof Error ? error : new Error("Business Memory eligibility could not be verified.");
  }
  const errors = [
    kpiResult.error,
    kpiSettingsResult.error,
    taskResult.error,
    issueResult.error,
    checklistResult.error,
    checklistRunResult.error,
    sopResult.error,
    fileResult.error,
    importResult.error,
    assetResult.error,
    crmLeadResult.error,
    crmHistoryResult.error,
    reportResult.error,
    vaeroexRunResult.error,
    metricResult.error,
    notificationResult.error,
    assignmentResult.error,
    shareResult.error,
    peopleResult.error,
    decisionResult.error,
    recommendationOutcomeResult.error,
    memoryChunksResult.error,
    sourceParentResult.error,
    memoryEligibilityError
  ].filter(Boolean);
  const businessHealthSourceErrors = [
    kpiResult.error,
    kpiSettingsResult.error,
    taskResult.error,
    issueResult.error,
    checklistResult.error,
    checklistRunResult.error,
    sopResult.error,
    fileResult.error,
    importResult.error,
    assetResult.error,
    crmLeadResult.error,
    crmHistoryResult.error,
    reportResult.error,
    vaeroexRunResult.error,
    metricResult.error,
    peopleResult.error,
    decisionResult.error,
    recommendationOutcomeResult.error,
    memoryChunksResult.error,
    sourceParentResult.error,
    memoryEligibilityError
  ].filter(Boolean);
  const demoWorkspaceCounts = isViewingDemoWorkspace ? await getDemoWorkspaceCounts(supabase, workspaceId) : null;

  const names = getConfiguredMetricNames(kpis, kpiSettings);
  const revenueMetric = latestMetric(kpis, ["revenue", "sales"])?.name || names.find((name) => lower(name).includes("revenue")) || "Revenue";
  const leadsMetric = latestMetric(kpis, ["lead", "customer"])?.name || names.find((name) => lower(name).includes("lead") || lower(name).includes("customer")) || "Customer Activity";
  const customMetric =
    names.find((name) => name !== revenueMetric && name !== leadsMetric && !lower(name).includes("conversion")) ||
    operationalMetrics[0]?.metric_name ||
    "Custom KPI";
  const primaryTrends = [revenueMetric, leadsMetric, customMetric]
    .filter((name, index, array) => array.indexOf(name) === index)
    .map((name, index) => buildMetricTrend(kpis, name, range, kpiSettings, index));
  const weeklyRange = rangeForPeriod("Weekly");
  const weeklyTrends = [revenueMetric, leadsMetric, customMetric]
    .filter((name, index, array) => array.indexOf(name) === index)
    .map((name, index) => buildMetricTrend(kpis, name, weeklyRange, kpiSettings, index));
  const comparisonTrends = names.slice(0, 6).map((name, index) => buildMetricTrend(kpis, name, range, kpiSettings, index));
  const openTasks = tasks.filter(isOpenTask);
  const overdueTasks = openTasks.filter((task) => inIsoRange(task.due_date || task.created_at, range.start, range.end));
  const openIssues = issues.filter(isOpenIssue);
  const checklistFailures = checklistRuns.filter((run) => isChecklistFailure(run) && inIsoRange(run.created_at, range.start, range.end));
  const sopUpdates = sops.filter((sop) => inIsoRange(sop.updated_at || sop.created_at, range.start, range.end));
  const recentFiles = files.filter((file) => inIsoRange(file.created_at, range.start, range.end));
  const fileAnalyses = files.filter((file) => Boolean(file.analysis_summary)).slice(0, 6);
  const recentImports = imports.filter((item) => inIsoRange(item.imported_at || item.created_at, range.start, range.end));
  const pendingImports = imports.filter((item) => item.status === "needs_review" || item.status === "extracted");
  const fileGeneratedReports = reports.filter(isFileGeneratedReport);
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
    .sort((a, b) => (b.changePercent ?? 0) * b.weight - (a.changePercent ?? 0) * a.weight)
    .slice(0, 4);
  const negativeTrends = comparisonTrends
    .filter((trend) => (trend.change ?? 0) < 0)
    .sort((a, b) => Math.abs(b.changePercent ?? 0) * b.weight - Math.abs(a.changePercent ?? 0) * a.weight)
    .slice(0, 4);
  const risks = [
    overdueTasks.length ? `${overdueTasks.length} Business Signal${overdueTasks.length === 1 ? "" : "s"} may indicate response, handoff, customer, market, or operational context worth leadership review.` : "",
    openIssues.length ? `${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"} remain unresolved.` : "",
    checklistFailures.length ? `${checklistFailures.length} checklist run${checklistFailures.length === 1 ? "" : "s"} failed or need review.` : "",
    pendingImports.length ? `${pendingImports.length} extracted file import${pendingImports.length === 1 ? "" : "s"} are waiting for mapping review.` : "",
    negativeTrends[0] ? `${negativeTrends[0].name} is down ${numberFormatter.format(Math.abs(negativeTrends[0].changePercent || 0))}% vs the previous period.` : ""
  ].filter(Boolean);
  const opportunities = [
    leadsCreated.length ? `${leadsCreated.length} customer activity record${leadsCreated.length === 1 ? "" : "s"} can be reviewed for response quality or conversion.` : "",
    positiveTrends[0] ? `${positiveTrends[0].name} is showing the strongest improvement this period.` : "",
    recentImports.length ? `${recentImports.length} recent import${recentImports.length === 1 ? "" : "s"} added fresh business history for reports and Vaeroex review.` : "",
    operationalMetrics.length ? "Business metrics are available for staffing, job volume, costs, utilization, or custom trend reviews." : ""
  ].filter(Boolean);
  const recommendedActions = [
    overdueTasks.length ? "Review the Business Signal pattern before the next leadership check-in." : "",
    openIssues.length ? "Sort open issues by severity and review unresolved items with leadership." : "",
    checklistFailures.length ? "Review failed checklist runs and update the process or escalation rule." : "",
    pendingImports.length ? "Open Files and save approved mappings so the dashboard uses the latest uploaded data." : "",
    negativeTrends.length ? "Review declining KPIs against recent imports, customer activity evidence, and Business Signals." : "",
    !kpis.length ? "Connect or add one KPI source so Vaeroex can establish a baseline." : "",
    !crmLeads.length ? "Connect or import customer activity evidence when available." : "",
    !reports.length ? "Generate a report for this period so the management summary is saved." : ""
  ].filter(Boolean);
  const latestKpiRows = latestKpisByName(kpis);
  const belowTargetKpis = latestKpiRows.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value < kpi.target * 0.9);
  const unassignedTasks = openTasks.filter((task) => !task.assigned_to);
  const crmLeadsWithoutFollowup = crmLeads.filter((lead) => !isConvertedStatus(lead.status) && (!lead.last_activity_at || isOlderThan(lead.last_activity_at, 30)));
  const staleSops = sops.filter((sop) => isOlderThan(sop.updated_at || sop.created_at, 90));
  const oldIssues = openIssues.filter((issue) => isOlderThan(issue.created_at, 14));
  const unanalyzedFiles = files.filter((file) => !file.analysis_summary && !file.archived_at && !file.deleted_at);
  const hasCurrentReport = reports.some((report) =>
    report.date_range_start && report.date_range_end
      ? report.date_range_start <= range.endDate && report.date_range_end >= range.startDate
      : inIsoRange(report.created_at, range.start, range.end)
  );
  const recentRunChecklistIds = new Set(checklistRuns.filter((run) => inIsoRange(run.created_at, range.start, range.end)).map((run) => run.checklist_id));
  const checklistsWithoutRecentRuns = checklists.filter((checklist) => !recentRunChecklistIds.has(checklist.id));
  const baseSmartAlerts = buildSmartAlerts({
    overdueTasks,
    unassignedTasks,
    belowTargetKpis,
    crmLeadsWithoutFollowup,
    staleSops,
    oldIssues,
    unanalyzedFiles,
    hasCurrentReport,
    checklistsWithoutRecentRuns
  });
  const demoStoryAlerts: DashboardAlert[] = isViewingDemoWorkspace
    ? [
        {
          id: "demo-march-dip",
          severity: "High",
          title: "March performance dip detected",
          why: "Revenue fell below the $40,000 target while response time rose to 32 hours, conversion dropped to 18%, and checklist completion fell to 78%.",
          action: "Review March report",
          href: "/app/reports"
        },
        {
          id: "demo-current-month-mixed",
          severity: "Medium",
          title: "Current month has mixed signals",
          why: "Revenue is above target, but conversion, response time, Business Signals, and checklist completion still need leadership review.",
          action: "Review executive intelligence",
          href: "/app/intelligence"
        }
      ]
    : [];
  const smartAlerts = [...demoStoryAlerts, ...baseSmartAlerts];
  const prioritizedIssues = [...oldIssues, ...openIssues.filter((issue) => !oldIssues.some((oldIssue) => oldIssue.id === issue.id))];
  const riskSignals: DashboardSignal[] = [
    ...prioritizedIssues.slice(0, 3).map((issue) => ({
      id: `issue-${issue.id}`,
      title: issue.title,
      source: "Issue",
      status: issue.severity || issue.status,
      context: issue.recommended_fix || `Status: ${issue.status || "Open"}`,
      href: "/app/issues" as Route
    })),
    ...(overdueTasks.length
      ? [
          {
            id: "source-signal-pattern",
            title: "Business Signal pattern needs review",
            source: "Business evidence",
            status: overdueTasks.length >= 3 ? "High" : "Medium",
            context: `${overdueTasks.length} Business Signal${overdueTasks.length === 1 ? "" : "s"} suggest a possible pattern in response speed, handoffs, or service quality. Example: ${overdueTasks[0]?.title || "business signal"}.`,
          evidence: `${overdueTasks.length} Business Signal${overdueTasks.length === 1 ? "" : "s"} from existing systems; Vaeroex is treating them as evidence, not work items.`,
            reasoning: "A recurring Business Signal pattern may point to operational friction even when the underlying work is managed elsewhere.",
            confidence: overdueTasks.length >= 3 ? ("High" as const) : ("Medium" as const),
            recommendedAction: "Leadership should review the current workflow and decide whether an executive brief or improvement plan is needed.",
            href: "/app/tasks" as Route
          }
        ]
      : []),
    ...belowTargetKpis.slice(0, 3).map((kpi) => ({
      id: `kpi-${kpi.id}`,
      title: kpi.name,
      source: "KPI risk",
      status: "Below target",
      context: `Actual ${formatMetricValue(kpi.actual_value, kpi.name)} vs target ${formatMetricValue(kpi.target, kpi.name)}. Leadership weight: ${numberFormatter.format(kpiWeight(kpi.name, kpiSettings))}/10.`,
      href: "/app/kpis" as Route
    })),
    ...checklistFailures.slice(0, 3).map((run) => ({
      id: `checklist-${run.id}`,
      title: run.notes || `Checklist run ${run.id.slice(0, 8)}`,
      source: "Checklist",
      status: run.status,
      context: `Run recorded ${new Date(run.created_at).toLocaleDateString()}. Review the checklist result and escalation rule.`,
      href: "/app/checklists" as Route
    })),
    ...pendingImports.slice(0, 3).map((item) => ({
      id: `import-${item.id}`,
      title: `${item.import_type.replace(/_/g, " ")} import needs review`,
      source: "Files",
      status: item.status,
      context: `${item.rows_imported} of ${item.rows_total} rows saved. Review mappings before using this data in reports.`,
      href: "/app/sources" as Route
    })),
    ...negativeTrends.slice(0, 3).map((trend) => ({
      id: `trend-risk-${trend.name}`,
      title: trend.name,
      source: "KPI trend",
      status: "Declining",
      context: `${trend.name} is down ${numberFormatter.format(Math.abs(trend.changePercent || 0))}% vs the previous period. Leadership weight: ${numberFormatter.format(trend.weight)}/10.`,
      href: "/app/kpis" as Route
    }))
  ].slice(0, 3);
  const opportunitySignals: DashboardSignal[] = [
    ...leadsCreated.slice(0, 3).map((lead) => ({
      id: `lead-${lead.id}`,
      title: lead.lead_name,
      source: lead.company ? `Customer evidence · ${lead.company}` : "Customer evidence",
      status: lead.status,
      context: `${lead.last_activity_at ? `Last activity ${new Date(lead.last_activity_at).toLocaleDateString()}` : "No recent activity recorded"}. Review only as customer evidence from connected or imported sources.`,
      href: "/app/sources" as Route
    })),
    ...positiveTrends.slice(0, 3).map((trend) => ({
      id: `trend-opportunity-${trend.name}`,
      title: trend.name,
      source: "KPI trend",
      status: "Improving",
      context: `${trend.name} improved ${percentLabel(trend.changePercent)} compared with the previous period. Leadership weight: ${numberFormatter.format(trend.weight)}/10.`,
      href: "/app/kpis" as Route
    })),
    ...recentImports.slice(0, 3).map((item) => ({
      id: `recent-import-${item.id}`,
      title: `${item.import_type.replace(/_/g, " ")} import`,
      source: "Files",
      status: item.status === "completed" ? "Saved" : item.status,
      context: `${item.rows_imported} of ${item.rows_total} rows available for historical reporting.`,
      href: "/app/sources" as Route
    })),
    ...fileAnalyses.slice(0, 3).map((file) => ({
      id: `file-analysis-${file.id}`,
      title: file.display_name,
      source: "File analysis",
      status: file.import_status,
      context: file.analysis_summary ? file.analysis_summary.slice(0, 140) : "Analysis saved to workspace memory.",
      href: "/app/sources" as Route
    }))
  ].slice(0, 3);
  const recommendedActionSignals: DashboardSignal[] = [
    overdueTasks.length
      ? {
          id: "action-source-signal-pattern",
          title: "Review Business Signal pattern",
          source: `${overdueTasks.length} Business Signal${overdueTasks.length === 1 ? "" : "s"}`,
          status: "High",
          context: `Use the business evidence to determine whether response speed, handoffs, or service quality need leadership review. Example: ${overdueTasks[0]?.title || "business signal"}.`,
          evidence: `${overdueTasks.length} Business Signal${overdueTasks.length === 1 ? "" : "s"} currently support this recommendation.`,
          reasoning: "Vaeroex is not assigning work; it is surfacing a pattern from existing systems for executive review.",
          confidence: overdueTasks.length >= 3 ? ("High" as const) : ("Medium" as const),
          recommendedAction: "Review the current workflow with leadership and generate an improvement plan only if the evidence is material.",
          href: "/app/tasks" as Route
        }
      : null,
    openIssues.length
      ? {
          id: "action-open-issues",
          title: "Review open issues",
          source: `${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"}`,
          status: openIssues[0]?.severity || "Medium",
          context: `Start with: ${openIssues[0]?.title || "the highest-priority issue"}.`,
          href: "/app/issues" as Route
        }
      : null,
    checklistFailures.length
      ? {
          id: "action-checklists",
          title: "Review failed checklist runs",
          source: `${checklistFailures.length} checklist run${checklistFailures.length === 1 ? "" : "s"}`,
          status: checklistFailures[0]?.status || "Needs review",
          context: "Review the process, evidence, or escalation pattern if the failure repeats.",
          href: "/app/checklists" as Route
        }
      : null,
    pendingImports.length
      ? {
          id: "action-pending-imports",
          title: "Approve file import mappings",
          source: `${pendingImports.length} file import${pendingImports.length === 1 ? "" : "s"}`,
          status: "Needs review",
          context: "Save approved mappings so reports and dashboards use the latest uploaded data.",
          href: "/app/sources" as Route
        }
      : null,
    negativeTrends[0]
      ? {
          id: `action-negative-trend-${negativeTrends[0].name}`,
          title: `Review ${negativeTrends[0].name}`,
          source: "KPI trend",
          status: "Declining",
          context: "Compare this KPI against recent customer activity evidence, imports, issues, and Business Signals.",
          href: "/app/kpis" as Route
        }
      : null,
    !kpis.length
      ? {
          id: "action-first-kpi",
          title: "Connect a KPI source",
          source: "KPI setup",
          status: "Start here",
          context: "Add one leadership-level metric such as revenue, conversion, jobs completed, response time, or customer issues.",
          href: "/app/kpis" as Route
        }
      : null,
    !crmLeads.length
      ? {
          id: "action-first-crm",
          title: "Connect customer activity evidence",
          source: "Customer evidence setup",
          status: "Start here",
          context: "Customer activity evidence can improve revenue, retention, and response-quality intelligence.",
          href: "/app/sources" as Route
        }
      : null,
    !reports.length
      ? {
          id: "action-first-report",
          title: "Generate a report",
          source: "Reports",
          status: "Recommended",
          context: "Save a management summary so decisions and intelligence findings have a record.",
          href: "/app/reports" as Route
        }
      : null
  ].filter(Boolean).slice(0, 3) as DashboardSignal[];
  const demoCounts = {
    kpis: demoWorkspaceCounts?.kpis ?? kpis.length,
    operationalMetrics: demoWorkspaceCounts?.operationalMetrics ?? operationalMetrics.length,
    crm: demoWorkspaceCounts?.crmLeads ?? crmLeads.length,
    tasks: demoWorkspaceCounts?.tasks ?? openTasks.length,
    issues: demoWorkspaceCounts?.issues ?? openIssues.length,
    reports: demoWorkspaceCounts?.reports ?? reports.length,
    sops: demoWorkspaceCounts?.sops ?? sops.length,
    files: demoWorkspaceCounts?.files ?? files.length,
    fileAnalyses: demoWorkspaceCounts?.fileAnalyses ?? fileAnalyses.length,
    assets: demoWorkspaceCounts?.assets ?? 0,
    checklists: demoWorkspaceCounts?.checklists ?? checklists.length,
    alerts: smartAlerts.length,
    insights: demoWorkspaceCounts?.vaeroexInsights ?? businessEvidenceRuns.length
  };
  const hasWorkspaceData = Boolean(kpis.length || tasks.length || issues.length || files.length || crmLeads.length || reports.length || sops.length || checklistRuns.length || operationalMetrics.length);
  const todayDate = dateOnly(new Date());
  const dueWindowEndDate = dateOnly(addDays(new Date(), 14));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const currentUserPerson = people.find((person) => person.email?.toLowerCase() === user?.email?.toLowerCase()) ?? null;
  const activeAssignments = assignments.filter((assignment) => {
    const status = lower(assignment.status);
    return !assignment.archived_at && status !== "done" && status !== "dismissed" && status !== "complete";
  });
  const attentionNotifications = [...notifications].sort((a, b) => {
    const readSort = Number(Boolean(a.read_at)) - Number(Boolean(b.read_at));
    return readSort || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
  const unreadNotifications = attentionNotifications.filter((notification) => !notification.read_at);
  const kpiAlertNotifications = attentionNotifications.filter((notification) => notification.type === "kpi_alert");
  const recentReportShares = shares.filter((share) => share.source_type === "report").slice(0, 5);
  const dueSoonAssignments = activeAssignments
    .filter((assignment) => assignment.due_date && assignment.due_date >= todayDate && assignment.due_date <= dueWindowEndDate)
    .slice(0, 5);
  const overdueOperationalAssignments = activeAssignments.filter((assignment) => assignment.due_date && assignment.due_date < todayDate).slice(0, 5);
  const assignedToMe = currentUserPerson ? activeAssignments.filter((assignment) => assignment.assigned_person_id === currentUserPerson.id).slice(0, 5) : [];
  const assignedToMyRole = currentUserPerson?.role_title
    ? activeAssignments.filter((assignment) => assignment.assigned_role === currentUserPerson.role_title).slice(0, 5)
    : [];
  const assignedToMyDepartment = currentUserPerson?.department
    ? activeAssignments.filter((assignment) => assignment.assigned_department === currentUserPerson.department).slice(0, 5)
    : [];
  const recommendationAssignments = activeAssignments.filter((assignment) => assignment.source_type === "vaeroex_recommendation");
  const alertsByRole = Object.entries(groupCounts(kpiAlertNotifications.map((notification) => notification.recipient_role)));
  const alertsByDepartment = Object.entries(groupCounts(kpiAlertNotifications.map((notification) => notification.recipient_department)));
  const shareRecipientLabel = (share: ShareRow) => {
    if (share.person_id && peopleById.has(share.person_id)) {
      return peopleById.get(share.person_id)?.full_name || "Person";
    }

    if (share.role) return share.role;
    if (share.department) return share.department;
    return "Entire workspace";
  };
  const prestigeIntelligence = buildPrestigeIntelligence({
    workspaceName: context.activeWorkspace?.name || "Vaeroex workspace",
    isDemoWorkspace: isViewingDemoWorkspace,
    periodLabel: period,
    range,
    kpis,
    tasks,
    issues,
    checklists,
    checklistRuns,
    sops,
    files,
    imports,
    assets,
    crmLeads,
    reports: [],
    vaeroexRuns: businessEvidenceRuns,
    operationalMetrics,
    notifications,
    assignments,
    shares,
    people,
    decisions,
    recommendationOutcomes
  });
  const operationalInsights = buildOperationalEvidenceInsights({
    kpis,
    operationalMetrics,
    memoryChunks,
    files,
    imports
  });
  const intelligenceLayer = buildIntelligenceLayer({
    workspace: context.activeWorkspace,
    kpis,
    tasks,
    issues,
    files,
    reports,
    vaeroexRuns: businessEvidenceRuns,
    crmLeads,
    imports,
    sops,
    people,
    decisions,
    recommendationOutcomes,
    operationalInsights
  });
  const businessHealthMemorySignals = intelligenceLayer.memorySummary.sourceRecords + intelligenceLayer.memorySummary.kpiHistoryRecords;
  if (!businessHealthSourceErrors.length && intelligenceLayer.businessHealth.available) {
    await recordDailyBusinessHealthSnapshot(supabase, {
      workspaceId,
      score: intelligenceLayer.businessHealth.score,
      status: intelligenceLayer.businessHealth.status,
      trend: intelligenceLayer.businessHealth.trend,
      dataConfidence: intelligenceLayer.dataQuality.confidence,
      dataQualityScore: intelligenceLayer.dataQuality.score,
      memorySignalCount: businessHealthMemorySignals,
      sourceSummary: {
        kpis: kpis.length,
        reports: 0,
        files: files.length,
        issues: issues.length,
        crm_leads: crmLeads.length,
        business_memory_signals: businessHealthMemorySignals,
        vaeroex_runs: businessEvidenceRuns.length,
        ...evidenceLineageMetadata({ sourceType: "business_health_snapshot" })
      }
    });
  }
  const businessHealthSnapshotResult = await getBusinessHealthSnapshotResult(supabase, workspaceId);
  const businessHealthHistory: BusinessHealthTrendPoint[] = businessHealthSnapshotResult.snapshots.map((snapshot) => ({
    snapshotDate: snapshot.snapshot_date,
    score: snapshot.score,
    status: snapshot.status,
    trend: snapshot.trend
  }));
  const businessIntelligenceCoverage = buildBusinessIntelligenceCoverage({
    kpis,
    tasks,
    issues,
    checklists,
    checklistRuns,
    files,
    imports,
    sops,
    crmLeads,
    crmHistory,
    reports,
    vaeroexRuns: businessEvidenceRuns,
    operationalMetrics,
    assets,
    people,
    decisions,
    recommendationOutcomes,
    memoryChunks
  });
  const latestEvidenceUpdate = [
    ...kpis.map((row) => row.updated_at || row.created_at),
    ...tasks.map((row) => row.updated_at || row.created_at),
    ...issues.map((row) => row.updated_at || row.created_at),
    ...files.map((row) => row.updated_at || row.created_at),
    ...reports.map((row) => row.updated_at || row.created_at),
    ...businessEvidenceRuns.map((row) => row.updated_at || row.created_at),
    ...decisions.map((row) => row.updated_at || row.created_at),
    ...recommendationOutcomes.map((row) => row.updated_at || row.created_at)
  ].filter(Boolean).sort().at(-1) || null;
  const executiveHomepageModel = buildExecutiveHomepageModel({
    intelligence: intelligenceLayer,
    coverage: businessIntelligenceCoverage,
    snapshots: businessHealthSnapshotResult.snapshots,
    kpiTrends: comparisonTrends,
    sourceDataAvailable: businessHealthSourceErrors.length === 0
  });
  const businessHealthAnalysisPackage = buildBusinessHealthExplanationPackage({
    workspaceId,
    intelligence: intelligenceLayer,
    homepage: executiveHomepageModel,
    snapshots: businessHealthSnapshotResult.snapshots,
    sourceLabelsByKey: Object.fromEntries([
      ...files.map((file) => [`source-file:${file.id}`, file.display_name]),
      ...imports.flatMap((item) => {
        const source = files.find((file) => file.id === item.file_upload_id);
        return source ? [[`import:${item.id}`, source.display_name] as const] : [];
      })
    ])
  });
  const businessHealthAnalysisToken = user && dashboardMode === "Executive View"
    ? trySealBusinessHealthExplanationPackage({
        analysisPackage: businessHealthAnalysisPackage,
        workspaceId,
        userId: user.id
      })
    : null;
  const businessHealthAnalysisState = dashboardMode === "Executive View"
    ? await loadBusinessHealthAnalysisState({
        supabase,
        workspaceId,
        analysisPackage: businessHealthAnalysisPackage,
        requestTokenAvailable: Boolean(businessHealthAnalysisToken)
      })
    : { status: "available" as const, artifact: null, message: null };
  const topAttentionSignal = riskSignals[1] || recommendedActionSignals[0] || riskSignals[0];
  const isExecutiveView = dashboardMode === "Executive View";
  const isOperationsView = dashboardMode === "Operations View";
  const isIntelligenceView = dashboardMode === "Intelligence View";
  const modeDescription =
    dashboardMode === "Executive View"
      ? "How are we doing? Vaeroex summarizes health, risk, opportunity, evidence, and the next executive recommendation."
      : dashboardMode === "Operations View"
        ? `What is happening? A ${period.toLowerCase()} source-record view of KPIs, Business Signals, issues, checklists, source visibility, customer activity evidence, and reports.`
        : `What should leadership know that is not immediately obvious? A ${period.toLowerCase()} intelligence briefing from signals, memory, risks, opportunities, and executive recommendations.`;

  return (
    <div className="space-y-6">
      {!isExecutiveView ? (
        <PageHeader
          eyebrow="Home"
          title={context.activeWorkspace?.name ?? "Vaeroex workspace"}
          description={modeDescription}
          actions={
            <div className="flex flex-wrap gap-2">
              <GlobalSearchTrigger className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
                Search
              </GlobalSearchTrigger>
              <Link href="/app/intelligence" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">
                View Intelligence
              </Link>
            </div>
          }
        />
      ) : null}

      {params?.message ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{params.message}</div> : null}
      <ErrorNotice message={params?.error} />

      {!isExecutiveView ? <ErrorNotice message={errors[0]?.message || null} /> : null}

      {isViewingDemoWorkspace && !isExecutiveView ? <DemoWorkspaceBanner counts={demoCounts} canUseAdminTools={canUseAdminOnboardingTools} /> : null}

      {isExecutiveView ? (
        <ExecutiveHomepage
          firstName={firstNameFromUser(user)}
          lastUpdatedLabel={lastUpdatedLabel(latestEvidenceUpdate)}
          model={executiveHomepageModel}
          healthHistory={businessHealthHistory}
          healthHistoryError={businessHealthSnapshotResult.errorMessage}
          businessHealthAnalysis={{
            state: businessHealthAnalysisState,
            requestToken: businessHealthAnalysisToken,
            facts: businessHealthAnalysisPackage.facts,
            citations: businessHealthAnalysisPackage.citations
          }}
        />
      ) : null}

      {isIntelligenceView ? (
        <>
          <IntelligenceBriefingHero
            risk={riskSignals[0]}
            opportunity={opportunitySignals[0]}
            attention={topAttentionSignal}
            action={recommendedActionSignals[0]}
            period={period}
          />

          <DashboardAccordion
            title="Intelligence signals"
            summary={`${riskSignals.length} actionable risk signal${riskSignals.length === 1 ? "" : "s"}, ${opportunitySignals.length} opportunit${opportunitySignals.length === 1 ? "y" : "ies"}, and ${recommendedActionSignals.length} executive recommendation${recommendedActionSignals.length === 1 ? "" : "s"} are available for review.`}
          >
            <section className="grid gap-4 xl:grid-cols-3">
              <SectionCard title="Risks" description="Top source records behind the current risk summary.">
                <SignalList items={riskSignals} empty="No major risks found for this period." tone="risk" />
              </SectionCard>

              <SectionCard title="Opportunities" description="Specific customer evidence, KPI gains, imports, or analyses worth reviewing.">
                <SignalList items={opportunitySignals} empty="No clear opportunities found yet." tone="opportunity" />
              </SectionCard>

              <SectionCard title="Recommendation queue" description="Each recommendation points to evidence and the related source context.">
                <SignalList
                  items={recommendedActionSignals}
                  empty="Keep the current cadence and review again after more activity is recorded."
                  tone="action"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link href="/app/sources" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
                    Review files
                  </Link>
                  <Link href="/app/sources" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
                    Review customer context
                  </Link>
                  <Link href={generatedOutputHref({ type: "executive_briefing" })} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
                    Generate Executive Briefing
                  </Link>
                </div>
              </SectionCard>
            </section>
          </DashboardAccordion>

          <DashboardAccordion
            title="Advanced Intelligence"
            summary="Risk simulation, profit leak detection, business memory, decision review, benchmarks, and recommendation tracking stay here when leadership wants deeper context."
          >
            <div className="mb-4">
              <IntelligencePriorityTools intelligence={prestigeIntelligence} />
            </div>
            <PrestigeOperationsPanel
              intelligence={prestigeIntelligence}
              returnPath="/app"
              dateRangeStart={range.startDate}
              dateRangeEnd={range.endDate}
              isDemoWorkspace={isViewingDemoWorkspace}
              showHealthHero={false}
            />
          </DashboardAccordion>
        </>
      ) : null}

      {isOperationsView ? (
        <>
          <DashboardAccordion
            title="Workspace signals"
            summary={`${unreadNotifications.length} unread notification${unreadNotifications.length === 1 ? "" : "s"}, ${overdueOperationalAssignments.length} unresolved review item${overdueOperationalAssignments.length === 1 ? "" : "s"}, and ${recentReportShares.length} recently shared report${recentReportShares.length === 1 ? "" : "s"}.`}
          >
      <section className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <SectionCard
	          title="Workspace signals"
	          description="Notifications, shared reports, KPI alerts, and Business Signals for this workspace."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Unread" value={unreadNotifications.length} detail="Notifications waiting" tone={unreadNotifications.length ? "border-vaeroex-accent/50 bg-vaeroex-soft text-vaeroex-blue" : undefined} />
            <StatCard label="KPI alerts" value={kpiAlertNotifications.length} detail="Rules triggered" tone={kpiAlertNotifications.length ? "border-amber-200 bg-amber-50 text-amber-900" : undefined} />
            <StatCard label="Shared reports" value={recentReportShares.length} detail="Recent in-app shares" />
	            <StatCard label="Upcoming signals" value={dueSoonAssignments.length} detail="Time-sensitive context" tone={dueSoonAssignments.length ? "border-amber-200 bg-amber-50 text-amber-900" : undefined} />
	            <StatCard label="Unresolved" value={overdueOperationalAssignments.length} detail="Signals needing review" tone={overdueOperationalAssignments.length ? "border-red-200 bg-red-50 text-red-700" : undefined} />
            <StatCard label="Saved recs" value={recommendationAssignments.length} detail="Vaeroex recommendations" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/notifications" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              Open notifications
            </Link>
            <Link href="/app/tasks" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              Review Business Signals
            </Link>
            <Link href="/app/reports" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              Reports
            </Link>
          </div>
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-ink">Needs attention</h3>
            <SimpleList
              items={unreadNotifications.slice(0, 5)}
              empty="No unread notifications need attention."
              render={(notification: NotificationRow) => (
                <Link
                  key={notification.id}
                  href="/app/notifications"
                  className="block rounded-lg border border-vaeroex-accent/40 bg-vaeroex-soft p-3 text-sm hover:border-vaeroex-accent"
                >
                  <span className="font-semibold text-ink">{notification.title}</span>
                  <span className="mt-1 block text-xs text-muted">
                    {notification.priority} · {notification.related_module || notification.type} · {new Date(notification.created_at).toLocaleDateString()}
                  </span>
                </Link>
              )}
            />
          </div>
        </SectionCard>

	        <SectionCard title="Business Signal context" description="Imported or generated observations that help leadership understand patterns without making Vaeroex the execution system.">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
	              <h3 className="text-sm font-semibold text-ink">Personal context</h3>
              <SimpleList
                items={assignedToMe}
	                empty={currentUserPerson ? "No personal source context is visible." : "No matching profile context found for your login email."}
                render={(assignment: AssignmentRow) => (
                  <div key={assignment.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold">{assignment.title}</p>
                      <StatusBadge value={assignment.priority} />
                    </div>
	                    <p className="mt-1 text-xs text-muted">Status: {assignment.status}</p>
                  </div>
                )}
              />
            </div>
            <div>
	              <h3 className="text-sm font-semibold text-ink">Role context</h3>
              <SimpleList
                items={assignedToMyRole}
	                empty={currentUserPerson?.role_title ? `No source context for ${currentUserPerson.role_title}.` : "Add role context on the People page to improve interpretation."}
                render={(assignment: AssignmentRow) => (
                  <div key={assignment.id} className="rounded-lg border border-line p-3">
                    <p className="text-sm font-semibold">{assignment.title}</p>
	                    <p className="mt-1 text-xs text-muted">{assignment.assigned_role} · {assignment.status}</p>
                  </div>
                )}
              />
            </div>
            <div>
	              <h3 className="text-sm font-semibold text-ink">Area context</h3>
              <SimpleList
                items={assignedToMyDepartment}
	                empty={currentUserPerson?.department ? `No source context for this area.` : "Add area context on the People page to improve interpretation."}
                render={(assignment: AssignmentRow) => (
                  <div key={assignment.id} className="rounded-lg border border-line p-3">
                    <p className="text-sm font-semibold">{assignment.title}</p>
	                    <p className="mt-1 text-xs text-muted">{assignment.assigned_department} · {assignment.status}</p>
                  </div>
                )}
              />
            </div>
            <div>
	              <h3 className="text-sm font-semibold text-ink">Unresolved review items</h3>
              <SimpleList
                items={overdueOperationalAssignments}
	                empty="No unresolved review items."
                render={(assignment: AssignmentRow) => (
                  <div key={assignment.id} className="rounded-lg border border-red-100 bg-red-50 p-3 text-red-700">
                    <p className="text-sm font-semibold">{assignment.title}</p>
	                    <p className="mt-1 text-xs">Review context: {assignment.source_title || assignment.status}</p>
                  </div>
                )}
              />
            </div>
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Recent shares" description="Reports, KPI views, file analyses, and Vaeroex decision support shared inside the workspace.">
          <SimpleList
            items={shares.slice(0, 6)}
            empty="No records have been shared yet."
            render={(share: ShareRow) => (
              <div key={share.id} className="rounded-lg border border-line p-3">
                <p className="text-sm font-semibold">{share.source_title}</p>
                <p className="mt-1 text-xs text-muted">
                  {share.source_type.replace(/_/g, " ")} · {shareRecipientLabel(share)} · {share.distribution_schedule.replace(/_/g, " ")}
                </p>
              </div>
            )}
          />
        </SectionCard>

        <SectionCard title="KPI alerts by role" description="Who is receiving KPI alert signals.">
          <SimpleList
            items={alertsByRole.map(([label, count]) => ({ id: label, label, count }))}
            empty="No role-based KPI alerts have triggered yet."
            render={(item: { id: string; label: string; count: number }) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
                <span className="font-semibold text-ink">{item.label}</span>
                <span className="text-muted">{item.count}</span>
              </div>
            )}
          />
        </SectionCard>

        <SectionCard title="KPI alerts by department" description="Departments with recent alert activity.">
          <SimpleList
            items={alertsByDepartment.map(([label, count]) => ({ id: label, label, count }))}
            empty="No department KPI alerts have triggered yet."
            render={(item: { id: string; label: string; count: number }) => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-line p-3 text-sm">
                <span className="font-semibold text-ink">{item.label}</span>
                <span className="text-muted">{item.count}</span>
              </div>
            )}
          />
        </SectionCard>
      </section>

          </DashboardAccordion>

          <DashboardAccordion
            title="Workspace structure"
            summary={hasWorkspaceData ? "Existing records are available. Use this section to improve structure or bring more data into Vaeroex." : "No major records yet. Start from scratch or import existing data."}
          >
      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm font-semibold text-ink">{hasWorkspaceData ? "Improve current structure" : "Build your first structure"}</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            {hasWorkspaceData
              ? "Your workspace already has activity. Focus on improving existing KPI sources, customer activity evidence, Business Signals, SOPs, and reports instead of creating duplicate systems."
              : "Add KPI sources, customer activity evidence, Business Signals, SOPs, and reports only when they help Vaeroex analyze the business. You can keep execution in your existing tools."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/kpis" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              {kpis.length ? "Review KPIs" : "Add KPI"}
            </Link>
            <Link href="/app/sources" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              {crmLeads.length ? "Review customer evidence" : "Add customer evidence"}
            </Link>
            <Link href="/app/tasks" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              {tasks.length ? "Review Business Signals" : "Add Business Signal"}
            </Link>
          </div>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm font-semibold text-ink">{hasWorkspaceData ? "Turn visibility into leadership review" : "Import existing data"}</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            {hasWorkspaceData
              ? "Use recent files, imports, reports, and Vaeroex findings to update leadership reviews and keep reports current."
              : "Upload CSV or XLSX files when you already have data to bring in. Vaeroex stages mappings for review before saving anything to history."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/sources" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              {files.length ? "Review files" : "Upload files"}
            </Link>
            <Link href={reports.length ? "/app/reports" : generatedOutputHref({ type: "executive_briefing" })} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              {reports.length ? "Review reports" : "Generate Executive Brief"}
            </Link>
          </div>
        </article>
      </section>

          </DashboardAccordion>

          <DashboardAccordion
            title="KPIs"
            summary={`${primaryTrends.length} primary KPI trend${primaryTrends.length === 1 ? "" : "s"} shown for ${period.toLowerCase()}. ${positiveTrends.length} improving, ${negativeTrends.length} declining.`}
          >
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {primaryTrends.map((trend) => (
          <KpiCard key={trend.name} trend={trend} />
        ))}
        <StatCard label="Business Signals" value={openTasks.length} detail={`${overdueTasks.length} in this view`} tone={overdueTasks.length ? "border-blue-200 bg-blue-50 text-blue-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"} />
        <StatCard label="Open Risks" value={openIssues.length} detail="Active risks and blockers" tone={openIssues.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"} />
        <StatCard label="Recent Imports" value={recentImports.length} detail={`${pendingImports.length} waiting for review`} tone={pendingImports.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-line bg-white text-ink"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <LineChart title="Revenue trend" rows={rowsForMetric(kpis, revenueMetric)} color={kpiColor(revenueMetric, kpiSettings, 0)} />
        <LineChart title="Customer activity trend" rows={rowsForMetric(kpis, leadsMetric)} color={kpiColor(leadsMetric, kpiSettings, 1)} />
        <LineChart title={`${customMetric} trend`} rows={rowsForMetric(kpis, customMetric)} color={kpiColor(customMetric, kpiSettings, 2)} />
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

          </DashboardAccordion>

          <DashboardAccordion
            title="Business Signals, issues, and checklists"
            summary={`${openTasks.length} Business Signal${openTasks.length === 1 ? "" : "s"}, ${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"}, and ${checklistFailures.length} checklist failure${checklistFailures.length === 1 ? "" : "s"} in this period.`}
          >
      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Business Signals" description="Business observations and context that may explain patterns.">
          <SimpleList
            items={openTasks.slice(0, 6)}
            empty="No Business Signals yet."
            render={(task: TaskRow) => (
              <div key={task.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{task.title}</p>
                  <StatusBadge value={task.category || "General"} />
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">{task.description || "Business context saved for Vaeroex memory."}</p>
                <p className="mt-2 text-xs text-muted">{new Date(task.due_date || task.created_at).toLocaleDateString()}</p>
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

          </DashboardAccordion>

          <DashboardAccordion
            title="Files, SOPs, customer evidence, and reports"
            summary={`${recentFiles.length} recent file${recentFiles.length === 1 ? "" : "s"}, ${sopUpdates.length} SOP update${sopUpdates.length === 1 ? "" : "s"}, ${leadsCreated.length} new customer activity record${leadsCreated.length === 1 ? "" : "s"}, and ${reports.length} saved report${reports.length === 1 ? "" : "s"}.`}
          >
      <section className="grid gap-4 xl:grid-cols-4">
        <SectionCard title="Files" description="Uploads and approved imports feeding business memory.">
          <div className="mb-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="font-semibold text-ink">{fileAnalyses.length}</p>
              <p>Recent file analyses</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="font-semibold text-ink">{fileGeneratedReports.length}</p>
              <p>Reports created from files</p>
            </div>
          </div>
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

        <SectionCard title="File insights" description="Latest Vaeroex file reviews saved to workspace memory.">
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
        <SectionCard title="Customer activity evidence" description="Customer status and activity evidence from current source records plus imported history.">
          <div className="space-y-3">
            {Object.entries(pipeline).length ? (
              Object.entries(pipeline).map(([status, value]) => (
                <div key={status} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1fr_auto_auto]">
                  <p className="text-sm font-semibold">{status}</p>
                  <p className="text-sm text-muted">{value.count} record{value.count === 1 ? "" : "s"}</p>
                  <p className="text-sm text-muted">{value.value ? currencyFormatter.format(value.value) : "Value not used"}</p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted">No customer activity evidence yet.</p>
            )}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <StatCard label="Customer records added" value={leadsCreated.length} detail={period} />
            <StatCard label="Converted records" value={leadsConverted.length} detail={period} />
            <StatCard label="Activity history" value={leadHistoryChanges.length} detail="Manual and imported changes" />
          </div>
        </SectionCard>

        <SectionCard title="Reports and Vaeroex insights" description="Saved management summaries and recent Vaeroex decision support.">
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
                items={businessEvidenceRuns.slice(0, 5)}
                empty="No Vaeroex decision support saved yet."
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

          </DashboardAccordion>
        </>
      ) : null}
    </div>
  );
}
