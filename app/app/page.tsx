import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { GlobalSearchTrigger } from "@/components/app/GlobalSearchTrigger";
import { BusinessHealthTrendChart, type BusinessHealthTrendPoint } from "@/components/intelligence/BusinessHealthTrendChart";
import { ExecutiveHomepage } from "@/components/intelligence/ExecutiveHomepage";
import { LeadershipDecisionJournal } from "@/components/intelligence/LeadershipDecisionJournal";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { filterEligibleMemoryRowsByLifecycle } from "@/lib/ai/evidence-index";
import { loadApprovedBusinessNoteContextV1 } from "@/lib/ai/business-notes/contextual-evidence";
import { businessNoteReleaseChannel } from "@/lib/ai/business-notes/release-channel";
import { buildBusinessHealthExplanationFromSnapshotV1 } from "@/lib/ai/business-health-explanation/snapshot-context";
import { loadBusinessHealthAnalysisState } from "@/lib/ai/business-health-explanation/storage";
import { trySealBusinessHealthExplanationPackage } from "@/lib/ai/business-health-explanation/token";
import { getBusinessHealthSnapshotResult, recordDailyBusinessHealthSnapshot } from "@/lib/intelligence/business-health-history";
import { excludeChecklistDerivedMetrics, excludeChecklistDerivedRecords } from "@/lib/intelligence/checklist-retirement";
import { buildBusinessIntelligenceCoverage } from "@/lib/intelligence/coverage";
import { evidenceLineageMetadata, filterBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { buildExecutiveHomepageModel } from "@/lib/intelligence/executive-homepage";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import { buildIntelligenceLayer, type IntelligenceLayerResult } from "@/lib/intelligence/layer";
import { buildOperationalEvidenceInsights } from "@/lib/intelligence/operational-evidence";
import {
  buildOverviewRunCompatibility,
  latestOverviewEvidenceUpdate,
  type OverviewCompatibilityRun
} from "@/lib/intelligence/overview-run-compatibility";
import { buildIntelligenceSnapshotFromProducersV1 } from "@/lib/intelligence/snapshot/v1/composition";
import { buildExecutiveHomepageFromSnapshotV1 } from "@/lib/intelligence/snapshot/v1/consumers/executive-overview";
import { projectExecutiveOverviewV1 } from "@/lib/intelligence/snapshot/v1/projections";
import {
  applyKpiSettingsToRows,
  getConfiguredMetricNames,
  kpiColor,
  kpiSemantics,
  kpiWeight,
  sortKpiRowsBySettings,
  type KpiSettingRow
} from "@/lib/kpis/settings";
import { effectiveKpiTarget, evaluateKpiPerformance, isKpiTargetMiss, type KpiPerformanceEvaluation } from "@/lib/kpis/semantics";
import type { Database, Json } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type DashboardPageProps = {
  searchParams?: Promise<{ period?: string; view?: string; error?: string; message?: string }>;
};

type DashboardPeriod = "Daily" | "Weekly" | "Monthly" | "Quarterly" | "Yearly" | "Year to Date";
type DashboardMode = "Executive View" | "Operations View" | "Intelligence View";
type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type AssetRow = Database["public"]["Tables"]["assets"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type CrmLeadHistoryRow = Database["public"]["Tables"]["crm_lead_history"]["Row"];
type OperationalMetricRow = Database["public"]["Tables"]["operational_metrics"]["Row"];
type AssignmentRow = Database["public"]["Tables"]["operational_assignments"]["Row"];
type ShareRow = Database["public"]["Tables"]["record_shares"]["Row"];
type PersonRow = Database["public"]["Tables"]["people"]["Row"];
type BusinessDecisionRow = Database["public"]["Tables"]["business_decisions"]["Row"];
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
  performanceEffect: KpiPerformanceEvaluation["latestPerformanceEffect"];
  selectedRangeTrend: KpiPerformanceEvaluation["selectedRangeTrend"];
  rawMovement: KpiPerformanceEvaluation["rawMovement"];
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

function trendTone(effect: KpiPerformanceEvaluation["latestPerformanceEffect"]) {
  if (effect === "favorable") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (effect === "unfavorable") return "border-red-200 bg-red-50 text-red-700";
  return "border-line bg-white text-ink";
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
    .filter((kpi) => lower(kpi.name) === lower(name) && kpi.actual_value !== null)
    .sort((a, b) => `${a.metric_date}-${a.created_at}`.localeCompare(`${b.metric_date}-${b.created_at}`));
}

function aggregateKpi(rows: KpiRow[], name: string, startDate: string, endDate: string) {
  const values = rows
    .filter((row) => lower(row.name) === lower(name) && inDateRange(row.metric_date, startDate, endDate) && row.actual_value !== null)
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
  const semantics = kpiSemantics(name, settings);
  const selectedRows = rowsForMetric(kpis, name).filter((row) => inDateRange(row.metric_date, range.startDate, range.endDate));
  const periodEvaluation = evaluateKpiPerformance({
    observations: [
      { actual_value: previous },
      { actual_value: current }
    ],
    semantics
  });
  const selectedEvaluation = evaluateKpiPerformance({ observations: selectedRows, semantics });

  return {
    name,
    rows: rowsForMetric(kpis, name),
    color: kpiColor(name, settings, fallbackIndex),
    weight: kpiWeight(name, settings),
    current,
    previous,
    change,
    changePercent,
    performanceEffect: periodEvaluation.latestPerformanceEffect,
    selectedRangeTrend: selectedEvaluation.selectedRangeTrend,
    rawMovement: periodEvaluation.rawMovement
  };
}

function isConvertedStatus(status: string | null | undefined) {
  const normalized = lower(status);
  return normalized.includes("converted") || normalized.includes("won") || normalized.includes("customer") || normalized.includes("closed");
}

function isOpenIssue(issue: IssueRow) {
  const deletedAt = (issue as IssueRow & { deleted_at?: string | null }).deleted_at;
  return lower(issue.status) !== "closed" && lower(issue.status) !== "resolved" && !deletedAt;
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
      tone={trendTone(trend.performanceEffect)}
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
    const key = lower(row.name).trim();
    if (!latest.has(key)) {
      latest.set(key, row);
    }
  }

  return [...latest.values()];
}

function buildSmartAlerts({
  targetMissKpis,
  crmLeadsWithoutFollowup,
  staleSops,
  oldIssues,
  unanalyzedFiles
}: {
  targetMissKpis: KpiRow[];
  crmLeadsWithoutFollowup: CrmLeadRow[];
  staleSops: SopRow[];
  oldIssues: IssueRow[];
  unanalyzedFiles: FileUploadRow[];
}) {
  return [
    targetMissKpis.length
      ? {
          id: "kpis-below-target",
          severity: "High",
          title: `${targetMissKpis.length} KPI${targetMissKpis.length === 1 ? "" : "s"} outside target`,
          why: "Metrics outside their direction-aware target should be reviewed against eligible evidence and open risks.",
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
          why: "Uploaded files should either feed historical memory or produce clear intelligence findings.",
          action: "Review files",
          href: "/app/sources"
        }
      : null
  ].filter(Boolean) as DashboardAlert[];
}

function dashboardKpiTargetReference(kpi: KpiRow, settings: KpiSettingRow[]) {
  const semantics = kpiSemantics(kpi.name, settings);
  if (semantics.desiredDirection === "target_range" && semantics.idealRangeMin !== null && semantics.idealRangeMax !== null) {
    return `acceptable range ${formatMetricValue(semantics.idealRangeMin, kpi.name)} to ${formatMetricValue(semantics.idealRangeMax, kpi.name)}`;
  }
  const target = effectiveKpiTarget(semantics, kpi.target);
  return target === null ? "target unavailable" : `target ${formatMetricValue(target, kpi.name)}`;
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

  return "Vaeroex surfaced this because the related records point to a leadership decision or evidence review.";
}

function signalRecommendedAction(item: DashboardSignal, tone: "risk" | "opportunity" | "action") {
  if (item.recommendedAction) {
    return item.recommendedAction;
  }

  if (tone === "risk") {
    return "Review the source evidence and decide what leadership should investigate next.";
  }

  if (tone === "opportunity") {
    return "Open the related evidence and decide what leadership should validate next.";
  }

  return "Review the executive recommendation and decide what leadership should examine next.";
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
  businessHealthHistoryError
}: {
  intelligence: IntelligenceLayerResult;
  businessHealthHistory: BusinessHealthTrendPoint[];
  businessHealthHistoryError?: string | null;
}) {
  const briefingCards = [
    {
      label: "Top risk",
      title: intelligence.topRisk?.title || "No major risk visible",
      body: intelligence.topRisk?.summary || "Vaeroex does not see a strong active risk signal yet.",
      href: intelligence.topRisk ? (`/app/intelligence?finding=${encodeURIComponent(intelligence.topRisk.id)}` as Route) : ("/app/intelligence" as Route),
      tone: "border-red-400/30 bg-red-950/25"
    },
    {
      label: "Top opportunity",
      title: intelligence.topOpportunity?.title || "Needs more context",
      body: intelligence.topOpportunity?.summary || "Add customer, KPI, file, or report history to reveal stronger opportunities.",
      href: intelligence.topOpportunity ? (`/app/intelligence?finding=${encodeURIComponent(intelligence.topOpportunity.id)}` as Route) : ("/app/sources" as Route),
      tone: "border-emerald-400/30 bg-emerald-950/25"
    },
    {
      label: "Executive recommendation",
      title: intelligence.topRecommendation?.recommendedAction || "Add source data",
      body: intelligence.topRecommendation?.why || "Vaeroex recommends adding business context before making stronger executive recommendations.",
      href: intelligence.topRecommendation ? (`/app/intelligence?finding=${encodeURIComponent(intelligence.topRecommendation.id)}` as Route) : ("/app/intelligence" as Route),
      tone: "border-cyan-400/30 bg-cyan-950/25"
    }
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
            asOfDate={dateOnly(new Date())}
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
        </div>
      </div>
    </section>
  );
}

function IntelligenceBriefingHero({
  risk,
  opportunity,
  action,
  period
}: {
  risk?: DashboardSignal;
  opportunity?: DashboardSignal;
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
      emptyBody: "Add more KPI history or eligible evidence to reveal stronger opportunity patterns.",
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
  return (
    <section className="overflow-hidden rounded-lg border border-cyan-300/20 bg-[#061225] text-white shadow-command">
      <div className="border-b border-white/10 bg-[radial-gradient(circle_at_15%_0%,rgba(56,189,248,0.22),transparent_34%),linear-gradient(135deg,rgba(30,107,255,0.18),transparent_58%)] p-6">
        <div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-vaeroex-accent">Leadership Intelligence Briefing</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">What should leadership know that is not immediately obvious?</h2>
            <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-200">
              Vaeroex is reading the {period.toLowerCase()} workspace context for risk, opportunity, attention, and the next decision.
            </p>
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
                  <Link
                    href={`/app/intelligence?finding=${encodeURIComponent(item.id)}` as Route}
                    className="inline-flex min-h-10 items-center rounded-lg border border-cyan-300/25 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:border-vaeroex-accent/60 hover:bg-cyan-950/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45"
                  >
                    Review finding
                  </Link>
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

export default async function AppDashboardPage({ searchParams }: DashboardPageProps) {
  const params = await searchParams;
  const period = isDashboardPeriod(params?.period) ? params.period : "Weekly";
  const dashboardMode = isDashboardMode(params?.view) ? params.view : "Executive View";
  const range = rangeForPeriod(period);
  const { supabase, context, workspaceId } = await requireWorkspacePage();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  const [
    kpiResult,
    kpiSettingsResult,
    issueResult,
    sopResult,
    fileResult,
    importResult,
    assetResult,
    crmLeadResult,
    crmHistoryResult,
    vaeroexRunResult,
    metricResult,
    assignmentResult,
    shareResult,
    peopleResult,
    decisionResult,
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
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("assets").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("crm_lead_history").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase
      .from("ai_agent_runs")
      .select("agent_type,input_json,output_json,status,error_message,created_at,updated_at,archived_at,deleted_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("operational_metrics").select("*").eq("workspace_id", workspaceId).order("metric_date", { ascending: false }).limit(500),
    supabase.from("operational_assignments").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("due_date", { ascending: true, nullsFirst: false }).limit(60),
    supabase.from("record_shares").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(40),
    supabase.from("people").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name").limit(100),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(30),
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
  const intelligenceKpis = excludeChecklistDerivedMetrics(kpis);
  const intelligenceKpiSettings = excludeChecklistDerivedMetrics(kpiSettings);
  const issues = excludeChecklistDerivedRecords(filterBusinessEvidence((issueResult.data || []) as IssueRow[]));
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
  const overviewRunCompatibility = buildOverviewRunCompatibility(
    (vaeroexRunResult.data || []) as OverviewCompatibilityRun[]
  );
  const operationalMetrics = filterBySourceParentEligibility(filterBusinessEvidence(rawOperationalMetrics), sourceParentEligibility);
  const intelligenceOperationalMetrics = excludeChecklistDerivedMetrics(operationalMetrics);
  const assignments = (assignmentResult.data || []) as AssignmentRow[];
  const shares = ((shareResult.data || []) as ShareRow[]).filter((share) => share.source_type !== "report");
  const people = filterBusinessEvidence((peopleResult.data || []) as PersonRow[]);
  const decisions = filterBusinessEvidence((decisionResult.data || []) as BusinessDecisionRow[]);
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
    issueResult.error,
    sopResult.error,
    fileResult.error,
    importResult.error,
    assetResult.error,
    crmLeadResult.error,
    crmHistoryResult.error,
    vaeroexRunResult.error,
    metricResult.error,
    assignmentResult.error,
    shareResult.error,
    peopleResult.error,
    decisionResult.error,
    memoryChunksResult.error,
    sourceParentResult.error,
    memoryEligibilityError
  ].filter(Boolean);
  const businessHealthSourceErrors = [
    kpiResult.error,
    kpiSettingsResult.error,
    issueResult.error,
    sopResult.error,
    fileResult.error,
    importResult.error,
    assetResult.error,
    crmLeadResult.error,
    crmHistoryResult.error,
    vaeroexRunResult.error,
    metricResult.error,
    peopleResult.error,
    decisionResult.error,
    memoryChunksResult.error,
    sourceParentResult.error,
    memoryEligibilityError
  ].filter(Boolean);
  const names = getConfiguredMetricNames(intelligenceKpis, intelligenceKpiSettings);
  const revenueMetric = latestMetric(intelligenceKpis, ["revenue", "sales"])?.name || names.find((name) => lower(name).includes("revenue")) || "Revenue";
  const leadsMetric = latestMetric(intelligenceKpis, ["lead", "customer"])?.name || names.find((name) => lower(name).includes("lead") || lower(name).includes("customer")) || "Customer Activity";
  const customMetric =
    names.find((name) => name !== revenueMetric && name !== leadsMetric && !lower(name).includes("conversion")) ||
    intelligenceOperationalMetrics[0]?.metric_name ||
    "Custom KPI";
  const primaryTrends = [revenueMetric, leadsMetric, customMetric]
    .filter((name, index, array) => array.indexOf(name) === index)
    .map((name, index) => buildMetricTrend(intelligenceKpis, name, range, intelligenceKpiSettings, index));
  const weeklyRange = rangeForPeriod("Weekly");
  const weeklyTrends = [revenueMetric, leadsMetric, customMetric]
    .filter((name, index, array) => array.indexOf(name) === index)
    .map((name, index) => buildMetricTrend(intelligenceKpis, name, weeklyRange, intelligenceKpiSettings, index));
  const comparisonTrends = names.slice(0, 6).map((name, index) => buildMetricTrend(intelligenceKpis, name, range, intelligenceKpiSettings, index));
  const openIssues = issues.filter(isOpenIssue);
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
    .filter((trend) => trend.performanceEffect === "favorable")
    .sort((a, b) => (b.changePercent ?? 0) * b.weight - (a.changePercent ?? 0) * a.weight)
    .slice(0, 4);
  const negativeTrends = comparisonTrends
    .filter((trend) => trend.performanceEffect === "unfavorable")
    .sort((a, b) => Math.abs(b.changePercent ?? 0) * b.weight - Math.abs(a.changePercent ?? 0) * a.weight)
    .slice(0, 4);
  const risks = [
    openIssues.length ? `${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"} remain unresolved.` : "",
    pendingImports.length ? `${pendingImports.length} extracted file import${pendingImports.length === 1 ? "" : "s"} are waiting for mapping review.` : "",
    negativeTrends[0] ? `${negativeTrends[0].name} moved ${negativeTrends[0].rawMovement}, an unfavorable change of ${numberFormatter.format(Math.abs(negativeTrends[0].changePercent || 0))}% vs the previous period.` : ""
  ].filter(Boolean);
  const opportunities = [
    leadsCreated.length ? `${leadsCreated.length} customer activity record${leadsCreated.length === 1 ? "" : "s"} can be reviewed for response quality or conversion.` : "",
    positiveTrends[0] ? `${positiveTrends[0].name} shows the strongest favorable movement this period.` : "",
    recentImports.length ? `${recentImports.length} recent import${recentImports.length === 1 ? "" : "s"} added fresh business history for Vaeroex review.` : "",
    intelligenceOperationalMetrics.length ? "Business metrics are available for staffing, job volume, costs, utilization, or custom trend reviews." : ""
  ].filter(Boolean);
  const recommendedActions = [
    openIssues.length ? "Sort open issues by severity and review unresolved items with leadership." : "",
    pendingImports.length ? "Open Files and save approved mappings so the dashboard uses the latest uploaded data." : "",
    negativeTrends.length ? "Review unfavorably moving KPIs against recent imports, customer activity evidence, and open issues." : "",
    !intelligenceKpis.length ? "Connect or add one KPI source so Vaeroex can establish a baseline." : "",
    !crmLeads.length ? "Connect or import customer activity evidence when available." : ""
  ].filter(Boolean);
  const latestKpiRows = latestKpisByName(intelligenceKpis);
  const targetMissKpis = latestKpiRows.filter((kpi) => {
    if (kpi.actual_value === null) return false;
    const evaluation = evaluateKpiPerformance({ observations: [kpi], semantics: kpiSemantics(kpi.name, intelligenceKpiSettings), target: kpi.target });
    return isKpiTargetMiss(evaluation.targetStatus);
  });
  const crmLeadsWithoutFollowup = crmLeads.filter((lead) => !isConvertedStatus(lead.status) && (!lead.last_activity_at || isOlderThan(lead.last_activity_at, 30)));
  const staleSops = sops.filter((sop) => isOlderThan(sop.updated_at || sop.created_at, 90));
  const oldIssues = openIssues.filter((issue) => isOlderThan(issue.created_at, 14));
  const unanalyzedFiles = files.filter((file) => !file.analysis_summary && !file.archived_at && !file.deleted_at);
  const baseSmartAlerts = buildSmartAlerts({
    targetMissKpis,
    crmLeadsWithoutFollowup,
    staleSops,
    oldIssues,
    unanalyzedFiles
  });
  const smartAlerts = baseSmartAlerts;
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
    ...targetMissKpis.slice(0, 3).map((kpi) => ({
      id: `kpi-${kpi.id}`,
      title: kpi.name,
      source: "KPI risk",
      status: "Outside target",
      context: `Actual ${formatMetricValue(kpi.actual_value, kpi.name)} vs ${dashboardKpiTargetReference(kpi, intelligenceKpiSettings)}. Leadership weight: ${numberFormatter.format(kpiWeight(kpi.name, intelligenceKpiSettings))}/10.`,
      href: "/app/kpis" as Route
    })),
    ...pendingImports.slice(0, 3).map((item) => ({
      id: `import-${item.id}`,
      title: `${item.import_type.replace(/_/g, " ")} import needs review`,
      source: "Files",
      status: item.status,
      context: `${item.rows_imported} of ${item.rows_total} rows saved. Review mappings before using this data in intelligence.`,
      href: "/app/sources" as Route
    })),
    ...negativeTrends.slice(0, 3).map((trend) => ({
      id: `trend-risk-${trend.name}`,
      title: trend.name,
      source: "KPI trend",
      status: "Unfavorable",
      context: `${trend.name} ${trend.rawMovement} ${numberFormatter.format(Math.abs(trend.changePercent || 0))}% vs the previous period, which is unfavorable for this KPI. Leadership weight: ${numberFormatter.format(trend.weight)}/10.`,
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
      status: "Favorable",
      context: `${trend.name} ${trend.rawMovement} ${percentLabel(trend.changePercent)} compared with the previous period, which is favorable for this KPI. Leadership weight: ${numberFormatter.format(trend.weight)}/10.`,
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
    pendingImports.length
      ? {
          id: "action-pending-imports",
          title: "Approve file import mappings",
          source: `${pendingImports.length} file import${pendingImports.length === 1 ? "" : "s"}`,
          status: "Needs review",
          context: "Save approved mappings so KPIs and dashboards use the latest uploaded data.",
          href: "/app/sources" as Route
        }
      : null,
    negativeTrends[0]
      ? {
          id: `action-negative-trend-${negativeTrends[0].name}`,
          title: `Review ${negativeTrends[0].name}`,
          source: "KPI trend",
          status: "Unfavorable",
          context: "Compare this KPI against recent customer activity evidence, imports, and open issues.",
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
  ].filter(Boolean).slice(0, 3) as DashboardSignal[];
  const hasWorkspaceData = Boolean(intelligenceKpis.length || issues.length || files.length || crmLeads.length || sops.length || intelligenceOperationalMetrics.length);
  const todayDate = dateOnly(new Date());
  const dueWindowEndDate = dateOnly(addDays(new Date(), 14));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const currentUserPerson = people.find((person) => person.email?.toLowerCase() === user?.email?.toLowerCase()) ?? null;
  const activeAssignments = assignments.filter((assignment) => {
    const status = lower(assignment.status);
    return !assignment.archived_at && status !== "done" && status !== "dismissed" && status !== "complete";
  });
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
  const shareRecipientLabel = (share: ShareRow) => {
    if (share.person_id && peopleById.has(share.person_id)) {
      return peopleById.get(share.person_id)?.full_name || "Person";
    }

    if (share.role) return share.role;
    if (share.department) return share.department;
    return "Entire workspace";
  };
  const operationalInsights = buildOperationalEvidenceInsights({
    kpis: intelligenceKpis,
    kpiSettings: intelligenceKpiSettings,
    operationalMetrics: intelligenceOperationalMetrics,
    memoryChunks,
    files,
    imports
  });
  const intelligenceLayer = buildIntelligenceLayer({
    workspace: context.activeWorkspace,
    kpis: intelligenceKpis,
    kpiSettings: intelligenceKpiSettings,
    issues,
    files,
    crmLeads,
    imports,
    sops,
    people,
    decisions,
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
        kpis: intelligenceKpis.length,
        files: files.length,
        issues: issues.length,
        crm_leads: crmLeads.length,
        business_memory_signals: businessHealthMemorySignals,
        vaeroex_runs: overviewRunCompatibility.snapshotSourceCount,
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
    kpis: intelligenceKpis,
    issues,
    files,
    imports,
    sops,
    crmLeads,
    crmHistory,
    overviewRunCompatibility,
    operationalMetrics: intelligenceOperationalMetrics,
    assets,
    people,
    decisions,
    memoryChunks
  });
  const latestEvidenceUpdate = latestOverviewEvidenceUpdate([
    ...intelligenceKpis.map((row) => row.updated_at || row.created_at),
    ...issues.map((row) => row.updated_at || row.created_at),
    ...files.map((row) => row.updated_at || row.created_at),
    ...decisions.map((row) => row.updated_at || row.created_at)
  ], overviewRunCompatibility);
  const businessHealthExplanationAsOf = new Date().toISOString();
  let executiveHomepageModel: ReturnType<typeof buildExecutiveHomepageModel>;
  try {
    const executiveOverviewSnapshot = buildIntelligenceSnapshotFromProducersV1({
      workspaceId,
      asOf: businessHealthExplanationAsOf,
      intelligence: intelligenceLayer,
      coverage: businessIntelligenceCoverage
    });
    const executiveOverviewProjection = projectExecutiveOverviewV1(executiveOverviewSnapshot.snapshot);
    executiveHomepageModel = buildExecutiveHomepageFromSnapshotV1({
      projection: executiveOverviewProjection,
      intelligence: intelligenceLayer,
      coverage: businessIntelligenceCoverage,
      snapshots: businessHealthSnapshotResult.snapshots,
      kpiTrends: comparisonTrends,
      sourceDataAvailable: businessHealthSourceErrors.length === 0
    }).model;
  } catch (error) {
    if (process.env.VERCEL_ENV !== "preview") throw error;
    console.error(JSON.stringify({
      level: "error",
      component: "executive-overview",
      event: "snapshot_v1_projection_fallback",
      classification: "adapter_defect",
      reason: error instanceof Error ? error.message : "snapshot_construction_failed"
    }));
    executiveHomepageModel = buildExecutiveHomepageModel({
      intelligence: intelligenceLayer,
      coverage: businessIntelligenceCoverage,
      snapshots: businessHealthSnapshotResult.snapshots,
      kpiTrends: comparisonTrends,
      sourceDataAvailable: businessHealthSourceErrors.length === 0
    });
  }
  const executiveSourceLabelsByKey = Object.fromEntries([
    ...files.map((file) => [`source-file:${file.id}`, file.display_name]),
    ...imports.flatMap((item) => {
      const source = files.find((file) => file.id === item.file_upload_id);
      return source ? [[`import:${item.id}`, source.display_name] as const] : [];
    })
  ]);
  const businessNoteContextReleaseChannel = businessNoteReleaseChannel();
  const businessNoteContext = await loadApprovedBusinessNoteContextV1({
    supabase,
    workspaceId,
    releaseChannel: businessNoteContextReleaseChannel,
    asOf: businessHealthExplanationAsOf
  });
  if (businessNoteContext.error) {
    console.error(JSON.stringify({
      level: "error",
      component: "business-health-explanation",
      event: "business_note_context_load_failed",
      reason: businessNoteContext.error.message
    }));
  }
  const businessHealthExplanationSnapshot = buildBusinessHealthExplanationFromSnapshotV1({
    workspaceId,
    intelligence: intelligenceLayer,
    homepage: executiveHomepageModel,
    snapshots: businessHealthSnapshotResult.snapshots,
    coverage: businessIntelligenceCoverage,
    ...(businessNoteContext.records.length ? {
      contextualEvidence: {
        releaseChannel: businessNoteContextReleaseChannel,
        records: businessNoteContext.records
      }
    } : {}),
    sourceLabelsByKey: executiveSourceLabelsByKey,
    asOf: businessHealthExplanationAsOf
  });
  const businessHealthAnalysisPackage = businessHealthExplanationSnapshot.analysisPackage;
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
  const isExecutiveView = dashboardMode === "Executive View";
  const isOperationsView = dashboardMode === "Operations View";
  const isIntelligenceView = dashboardMode === "Intelligence View";
  const modeDescription =
    dashboardMode === "Executive View"
      ? "How are we doing? Vaeroex summarizes health, risk, opportunity, evidence, and the next executive recommendation."
      : dashboardMode === "Operations View"
        ? `What is happening? A ${period.toLowerCase()} source-record view of KPIs, issues, source visibility, and customer activity evidence.`
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

      {isExecutiveView ? (
        <ExecutiveHomepage
          firstName={firstNameFromUser(user)}
          lastUpdatedLabel={lastUpdatedLabel(latestEvidenceUpdate)}
          model={executiveHomepageModel}
          healthHistory={businessHealthHistory}
          healthHistoryAsOfDate={dateOnly(new Date())}
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
                </div>
              </SectionCard>
            </section>
          </DashboardAccordion>

          <DashboardAccordion
            title="Decision Journal"
            summary={`${decisions.length} leadership decision${decisions.length === 1 ? "" : "s"} retained for future review.`}
          >
            <LeadershipDecisionJournal
              decisions={decisions}
              returnPath="/app?view=Intelligence%20View#decision-journal"
            />
          </DashboardAccordion>
        </>
      ) : null}

      {isOperationsView ? (
        <>
          <DashboardAccordion
            title="Workspace signals"
            summary={`${overdueOperationalAssignments.length} unresolved review item${overdueOperationalAssignments.length === 1 ? "" : "s"} and ${dueSoonAssignments.length} upcoming item${dueSoonAssignments.length === 1 ? "" : "s"}.`}
          >
      <section className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
	        <SectionCard
	          title="Workspace signals"
	          description="Assigned review items for this workspace."
        >
	          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
	            <StatCard label="Upcoming signals" value={dueSoonAssignments.length} detail="Time-sensitive context" tone={dueSoonAssignments.length ? "border-amber-200 bg-amber-50 text-amber-900" : undefined} />
	            <StatCard label="Unresolved" value={overdueOperationalAssignments.length} detail="Signals needing review" tone={overdueOperationalAssignments.length ? "border-red-200 bg-red-50 text-red-700" : undefined} />
            <StatCard label="Saved recs" value={recommendationAssignments.length} detail="Vaeroex recommendations" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/reports" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              Saved analyses
            </Link>
          </div>
        </SectionCard>

	        <SectionCard title="Workspace context" description="Assigned review items that help leadership understand ownership and unresolved operational context.">
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

      <section>
        <SectionCard title="Recent shares" description="KPI views, file analyses, and Vaeroex decision support shared inside the workspace.">
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
              ? "Your workspace already has activity. Focus on improving existing KPI sources, customer activity evidence, and SOPs instead of creating duplicate systems."
              : "Add KPI sources, customer activity evidence, and SOPs only when they help Vaeroex analyze the business. You can keep execution in your existing tools."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/kpis" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              {kpis.length ? "Review KPIs" : "Add KPI"}
            </Link>
            <Link href="/app/sources" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              {crmLeads.length ? "Review customer evidence" : "Add customer evidence"}
            </Link>
          </div>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm font-semibold text-ink">{hasWorkspaceData ? "Turn visibility into leadership review" : "Import existing data"}</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            {hasWorkspaceData
              ? "Use recent files, imports, and Vaeroex findings to keep leadership reviews current."
              : "Upload CSV or XLSX files when you already have data to bring in. Vaeroex stages mappings for review before saving anything to history."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/sources" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              {files.length ? "Review files" : "Upload files"}
            </Link>
            <Link href="/app/reports" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              Review saved analyses
            </Link>
          </div>
        </article>
      </section>

          </DashboardAccordion>

          <DashboardAccordion
            title="KPIs"
            summary={`${primaryTrends.length} primary KPI trend${primaryTrends.length === 1 ? "" : "s"} shown for ${period.toLowerCase()}. ${positiveTrends.length} favorable, ${negativeTrends.length} unfavorable.`}
          >
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {primaryTrends.map((trend) => (
          <KpiCard key={trend.name} trend={trend} />
        ))}
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
            title="Issues"
            summary={`${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"} in this period.`}
          >
      <section>
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
      </section>

          </DashboardAccordion>

          <DashboardAccordion
            title="Files, SOPs, and customer evidence"
            summary={`${recentFiles.length} recent file${recentFiles.length === 1 ? "" : "s"}, ${sopUpdates.length} SOP update${sopUpdates.length === 1 ? "" : "s"}, and ${leadsCreated.length} new customer activity record${leadsCreated.length === 1 ? "" : "s"}.`}
          >
      <section className="grid gap-4 xl:grid-cols-4">
        <SectionCard title="Files" description="Uploads and approved imports feeding business memory.">
          <div className="mb-3 text-xs text-muted">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="font-semibold text-ink">{fileAnalyses.length}</p>
              <p>Recent file analyses</p>
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

      <section>
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

      </section>

          </DashboardAccordion>
        </>
      ) : null}
    </div>
  );
}
