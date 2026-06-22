import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import {
  createDemoWorkspaceAction,
  createFreshDemoWorkspaceAction,
  exitDemoWorkspaceAction,
  openDemoWorkspaceAction,
  resetDemoWorkspaceAction
} from "@/app/app/demo/actions";
import { OnboardingChecklist, type OnboardingChecklistItem } from "@/components/app/OnboardingChecklist";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { BusinessHealthHero, PrestigeOperationsPanel } from "@/components/intelligence/PrestigeOperationsPanel";
import { EmptyState } from "@/components/operations/EmptyState";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { isVaeroexAdminEmail, isVaeroexAdminUser } from "@/lib/admin/admin-emails";
import { ensureDemoWorkspacePopulated, getDemoWorkspaceCounts, isDemoWorkspaceRecord } from "@/lib/demo/workspace-demo";
import { buildPrestigeIntelligence } from "@/lib/intelligence/prestige";
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
  href: Route;
};

const PERIODS: DashboardPeriod[] = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "Year to Date"];
const DASHBOARD_MODES: DashboardMode[] = ["Executive View", "Operations View", "Intelligence View"];
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const currencyFormatter = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });
const chartColors = ["#1E6BFF", "#38BDF8", "#0B1F4D", "#059669", "#f59e0b", "#dc2626"];

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

function workspaceStatusLabel(workspace: Database["public"]["Tables"]["workspaces"]["Row"] | null) {
  if (!workspace) return "Setup required";
  if (workspace.subscription_status === "demo") return "Demo workspace";
  if (!workspace.subscription_required || workspace.manually_unlocked || ["active", "trialing"].includes(workspace.subscription_status)) return "Active";
  if (workspace.subscription_status === "manual_review") return "Pending activation";
  return "Subscription required";
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
          id: "overdue-tasks",
          severity: "High",
          title: `${overdueTasks.length} overdue follow-up${overdueTasks.length === 1 ? "" : "s"}`,
          why: "Overdue work usually means ownership, capacity, or handoff problems need review.",
          action: "Review overdue follow-ups",
          href: "/app/tasks"
        }
      : null,
    unassignedTasks.length
      ? {
          id: "unassigned-tasks",
          severity: "Medium",
          title: `${unassignedTasks.length} follow-up${unassignedTasks.length === 1 ? "" : "s"} without an owner`,
          why: "Follow-ups without clear ownership are easy to miss even when the team is busy.",
          action: "Assign owners",
          href: "/app/tasks"
        }
      : null,
    belowTargetKpis.length
      ? {
          id: "kpis-below-target",
          severity: "High",
          title: `${belowTargetKpis.length} KPI${belowTargetKpis.length === 1 ? "" : "s"} below target`,
          why: "Below-target metrics should be reviewed against recent follow-ups, CRM activity, and open risks.",
          action: "Review KPIs",
          href: "/app/kpis"
        }
      : null,
    crmLeadsWithoutFollowup.length
      ? {
          id: "crm-followup",
          severity: "Medium",
          title: `${crmLeadsWithoutFollowup.length} CRM lead${crmLeadsWithoutFollowup.length === 1 ? "" : "s"} need follow-up review`,
          why: "Leads without recent activity or next-step notes can quietly stall revenue.",
          action: "Review CRM",
          href: "/app/crm"
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
          href: "/app/files"
        }
      : null,
    !hasCurrentReport
      ? {
          id: "missing-report",
          severity: "Low",
          title: "No report generated for this period",
          why: "A saved report gives the owner a clean management summary and a record of decisions.",
          action: "Generate report",
          href: "/app/reports"
        }
      : null,
    checklistsWithoutRecentRuns.length
      ? {
          id: "checklist-runs",
          severity: "Medium",
          title: `${checklistsWithoutRecentRuns.length} checklist${checklistsWithoutRecentRuns.length === 1 ? "" : "s"} have no recent run`,
          why: "Checklists only create accountability when they are actually completed and reviewed.",
          action: "Run checklists",
          href: "/app/checklists"
        }
      : null
  ].filter(Boolean) as DashboardAlert[];
}

function ExecutiveBriefingCard({
  period,
  whatChanged,
  improved,
  declined,
  attention,
  recommendation
}: {
  period: DashboardPeriod;
  whatChanged: string;
  improved: string;
  declined: string;
  attention: string;
  recommendation: string;
}) {
  return (
    <section className="rounded-lg border border-slate-800 bg-vaeroex-navy p-5 text-white shadow-command">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <VaeroexLogo variant="symbol" size="sm" />
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-silver">Executive briefing</p>
          </div>
          <h2 className="mt-3 text-2xl font-semibold text-white">What changed and what to do next</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-100">
            A {period.toLowerCase()} owner-ready readout from KPIs, CRM, follow-ups, risks, files, checklists, SOPs, reports, and Vaeroex insights.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/app/tasks" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white hover:bg-blue-950/70 hover:text-white hover:ring-1 hover:ring-vaeroex-accent/45">Create Follow-up</Link>
          <Link href="/app/reports" className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">Generate Report</Link>
          <Link href="/app/issues" className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">Review Issues</Link>
          <Link href="/app/kpis" className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">Review KPIs</Link>
        </div>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-5">
        {[
          ["What changed", whatChanged],
          ["Improved", improved],
          ["Declined", declined],
          ["Needs attention", attention],
          ["Vaeroex recommends", recommendation]
        ].map(([label, value]) => (
          <article key={label} className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-silver">{label}</p>
            <p className="mt-2 text-sm leading-6 text-slate-100">{value}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function SmartAlerts({
  alerts,
  title = "Smart alerts",
  description = "In-app alerts from the current workspace. Start here when deciding what needs attention."
}: {
  alerts: DashboardAlert[];
  title?: string;
  description?: string;
}) {
  if (!alerts.length) {
    return (
      <section className="rounded-lg border border-emerald-100 bg-emerald-50 p-5 text-emerald-800">
        <p className="text-sm font-semibold">No urgent alerts right now.</p>
        <p className="mt-1 text-sm leading-6">Vaeroex did not find overdue follow-ups, stale reviews, or missing reports that need immediate attention.</p>
      </section>
    );
  }

  return (
    <SectionCard title={title} description={description}>
      <div className="grid gap-3 lg:grid-cols-3">
        {alerts.slice(0, 6).map((alert) => (
          <article key={alert.id} className={`rounded-lg border p-4 shadow-sm ${severityTone(alert.severity)}`}>
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold">{alert.title}</p>
              <span className="rounded-full bg-white/80 px-2.5 py-1 text-xs font-semibold">{alert.severity}</span>
            </div>
            <p className="mt-2 text-sm leading-6 opacity-90">{alert.why}</p>
            <Link href={alert.href as Route} className="mt-4 inline-flex rounded-lg bg-white px-3 py-2 text-xs font-semibold text-ink shadow-sm hover:border-vaeroex-accent hover:text-vaeroex-blue">
              {alert.action}
            </Link>
          </article>
        ))}
      </div>
    </SectionCard>
  );
}

function DashboardModeSelector({ mode, period }: { mode: DashboardMode; period: DashboardPeriod }) {
  return (
    <div className="rounded-lg border border-vaeroex-silver/70 bg-white p-1 shadow-sm">
      <div className="grid gap-1 sm:grid-cols-3">
        {DASHBOARD_MODES.map((item) => (
          <Link
            key={item}
            href={dashboardHref(period, item)}
            className={`rounded-md px-3 py-2 text-center text-sm font-semibold transition ${
              item === mode
                ? "bg-vaeroex-blue text-white shadow-sm shadow-blue-900/20"
                : "text-slate-700 hover:bg-blue-950/10 hover:text-vaeroex-blue"
            }`}
          >
            {item}
          </Link>
        ))}
      </div>
    </div>
  );
}

function PeriodSelector({ period, mode }: { period: DashboardPeriod; mode: DashboardMode }) {
  return (
    <div className="flex flex-wrap gap-2">
      {PERIODS.map((item) => (
        <Link
          key={item}
          href={dashboardHref(item, mode)}
          className={`rounded-lg px-3 py-2 text-sm font-semibold ${
            item === period
              ? "bg-vaeroex-blue text-white shadow-sm shadow-blue-900/20"
              : "border border-line bg-white text-slate-700 hover:border-vaeroex-accent hover:text-vaeroex-blue"
          }`}
        >
          {item}
        </Link>
      ))}
    </div>
  );
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
    <details open={defaultOpen} className="group rounded-lg border border-vaeroex-silver/80 bg-white shadow-panel">
      <summary className="flex cursor-pointer list-none flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">{title}</h3>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">{summary}</p>
        </div>
        <span className="inline-flex w-fit rounded-full border border-line px-3 py-1 text-xs font-semibold text-slate-600 group-open:bg-vaeroex-soft group-open:text-vaeroex-blue">
          Expand
        </span>
      </summary>
      <div className="space-y-4 border-t border-vaeroex-silver p-5">{children}</div>
    </details>
  );
}

function RecommendedActionsCard({ actions }: { actions: string[] }) {
  return (
    <SectionCard title="Recommended actions" description="The shortest action list Vaeroex found for the current workspace.">
      <SimpleList
        items={actions.slice(0, 5).map((item, index) => ({ id: `${index}`, label: item }))}
        empty="Keep the current cadence and review again after more activity is recorded."
        render={(item: { id: string; label: string }) => (
          <p key={item.id} className="rounded-lg border border-line bg-slate-50 p-3 text-sm text-slate-700">{item.label}</p>
        )}
      />
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href="/app/tasks" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
          Create follow-up
        </Link>
        <Link href="/app/reports" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
          Generate report
        </Link>
      </div>
    </SectionCard>
  );
}

function WeeklyTrendCard({ trends }: { trends: MetricTrend[] }) {
  const visibleTrends = trends.filter((trend) => trend.current !== null).slice(0, 4);

  return (
    <SectionCard title="Weekly trend" description="A compact readout of the current week against the prior week.">
      <SimpleList
        items={visibleTrends.map((trend) => ({ ...trend, id: trend.name }))}
        empty="No weekly KPI movement is visible yet."
        render={(trend: MetricTrend & { id: string }) => (
          <div key={trend.id} className="rounded-lg border border-line p-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-ink">{trend.name}</p>
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                (trend.change ?? 0) >= 0 ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
              }`}>
                {percentLabel(trend.changePercent)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Current: {formatMetricValue(trend.current, trend.name)} · Previous: {formatMetricValue(trend.previous, trend.name)}
            </p>
          </div>
        )}
      />
    </SectionCard>
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
    risk: "border-red-100 bg-red-50/80 text-red-800 hover:border-red-200 hover:bg-red-50",
    opportunity: "border-emerald-100 bg-emerald-50/80 text-emerald-800 hover:border-emerald-200 hover:bg-emerald-50",
    action: "border-line bg-slate-50 text-slate-800 hover:border-vaeroex-accent hover:bg-vaeroex-soft"
  };

  return (
    <SimpleList
      items={items}
      empty={empty}
      render={(item: DashboardSignal) => (
        <Link
          key={item.id}
          href={item.href}
          className={`block rounded-lg border p-3 text-sm transition ${toneClasses[tone]}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{item.title}</p>
              <p className="mt-1 text-xs opacity-80">{item.source}</p>
            </div>
            {item.status ? <StatusBadge value={item.status} /> : null}
          </div>
          <p className="mt-2 text-xs leading-5 opacity-90">{item.context}</p>
        </Link>
      )}
    />
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

function DemoWorkspaceControls({
  demoWorkspaceExists,
  isViewingDemoWorkspace,
  canUseAdminTools
}: {
  demoWorkspaceExists: boolean;
  isViewingDemoWorkspace: boolean;
  canUseAdminTools: boolean;
}) {
  return (
    <div className="space-y-2">
      {demoWorkspaceExists ? (
        <p className="text-xs leading-5 text-amber-900">Demo workspace already exists. Open it, reset it, or create a fresh demo.</p>
      ) : (
        <p className="text-xs leading-5 text-muted">Create a separate demo workspace with realistic sample data for testing Vaeroex.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {demoWorkspaceExists && !isViewingDemoWorkspace ? (
          <form action={openDemoWorkspaceAction}>
            <DemoActionButton tone="primary">Open Demo Workspace</DemoActionButton>
          </form>
        ) : null}
        <form action={createDemoWorkspaceAction}>
          <DemoActionButton tone={demoWorkspaceExists ? "secondary" : "primary"}>
            {demoWorkspaceExists ? "Check demo workspace" : "Create demo workspace"}
          </DemoActionButton>
        </form>
        {canUseAdminTools && demoWorkspaceExists ? (
          <form action={resetDemoWorkspaceAction}>
            <DemoActionButton tone="danger">Reset demo workspace</DemoActionButton>
          </form>
        ) : null}
        {canUseAdminTools ? (
          <form action={createFreshDemoWorkspaceAction}>
            <DemoActionButton>Create fresh demo</DemoActionButton>
          </form>
        ) : null}
        {isViewingDemoWorkspace ? (
          <form action={exitDemoWorkspaceAction}>
            <DemoActionButton>Switch back to my workspace</DemoActionButton>
          </form>
        ) : null}
      </div>
    </div>
  );
}

function AdminToolsBadge({ source }: { source: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 shadow-panel md:flex-row md:items-center md:justify-between">
      <div>
        <p className="text-sm font-semibold">Admin tools enabled</p>
        <p className="mt-1 text-xs leading-5">Admin access detected by {source}. Normal customers do not see this panel.</p>
      </div>
      <span className="inline-flex w-fit rounded-full bg-white px-3 py-1 text-xs font-semibold text-amber-900">Vaeroex admin</span>
    </section>
  );
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
    ["Demo Leads", counts.crm],
    ["Demo Follow-ups", counts.tasks],
    ["Demo Reports", counts.reports],
    ["Demo Issues", counts.issues]
  ];
  const countItems = [
    ["KPIs", counts.kpis],
    ["Business metrics", counts.operationalMetrics],
    ["CRM leads", counts.crm],
    ["Open follow-ups", counts.tasks],
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
            It includes YTD KPI movement, CRM activity, weak-month alerts, reports, follow-ups, issues, SOPs, checklist history, files, decisions, and Vaeroex insights.
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
            SOP review, checklist follow-up, and CRM accountability helped the business recover from the weak month.
          </p>
        </article>
        <article className="rounded-lg border border-vaeroex-accent/40 bg-white/80 p-4">
          <p className="text-sm font-semibold">Current month signals</p>
          <p className="mt-2 text-xs leading-5">
            Revenue is healthy, but response time, conversion, overdue follow-ups, and checklist completion still need owner attention.
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
  const adminDetectionSource = isVaeroexAdminEmail(user?.email) ? "VAEROEX_ADMIN_EMAILS" : "Supabase user metadata";
  const currentWorkspaceStatus = workspaceStatusLabel(context.activeWorkspace);
  const isViewingDemoWorkspace = isDemoWorkspaceRecord(context.activeWorkspace);
  const demoWorkspace = context.workspaces.find(isDemoWorkspaceRecord) ?? null;

  if (isViewingDemoWorkspace && user) {
    await ensureDemoWorkspacePopulated(supabase, workspaceId, user);
  }

  const [
    kpiResult,
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
    recommendationOutcomeResult
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
    supabase.from("checklists").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("assets").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("crm_lead_history").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(10),
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
      .limit(40)
  ]);

  const kpis = (kpiResult.data || []) as KpiRow[];
  const tasks = (taskResult.data || []) as TaskRow[];
  const issues = (issueResult.data || []) as IssueRow[];
  const checklists = (checklistResult.data || []) as ChecklistRow[];
  const checklistRuns = (checklistRunResult.data || []) as ChecklistRunRow[];
  const sops = (sopResult.data || []) as SopRow[];
  const files = (fileResult.data || []) as FileUploadRow[];
  const imports = (importResult.data || []) as FileImportRow[];
  const assets = (assetResult.data || []) as AssetRow[];
  const crmLeads = (crmLeadResult.data || []) as CrmLeadRow[];
  const crmHistory = (crmHistoryResult.data || []) as CrmLeadHistoryRow[];
  const reports = (reportResult.data || []) as ReportRow[];
  const vaeroexRuns = (vaeroexRunResult.data || []) as VaeroexRunRow[];
  const operationalMetrics = (metricResult.data || []) as OperationalMetricRow[];
  const notifications = (notificationResult.data || []) as NotificationRow[];
  const assignments = (assignmentResult.data || []) as AssignmentRow[];
  const shares = (shareResult.data || []) as ShareRow[];
  const people = (peopleResult.data || []) as PersonRow[];
  const decisions = (decisionResult.data || []) as BusinessDecisionRow[];
  const recommendationOutcomes = (recommendationOutcomeResult.data || []) as RecommendationOutcomeRow[];
  const errors = [
    kpiResult.error,
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
    recommendationOutcomeResult.error
  ].filter(Boolean);
  const demoWorkspaceCounts = isViewingDemoWorkspace ? await getDemoWorkspaceCounts(supabase, workspaceId) : null;

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
  const weeklyRange = rangeForPeriod("Weekly");
  const weeklyTrends = [revenueMetric, leadsMetric, customMetric]
    .filter((name, index, array) => array.indexOf(name) === index)
    .map((name) => buildMetricTrend(kpis, name, weeklyRange));
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
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
    .slice(0, 4);
  const negativeTrends = comparisonTrends
    .filter((trend) => (trend.change ?? 0) < 0)
    .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))
    .slice(0, 4);
  const risks = [
    overdueTasks.length ? `${overdueTasks.length} overdue follow-up${overdueTasks.length === 1 ? "" : "s"} need owner attention.` : "",
    openIssues.length ? `${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"} remain unresolved.` : "",
    checklistFailures.length ? `${checklistFailures.length} checklist run${checklistFailures.length === 1 ? "" : "s"} failed or need review.` : "",
    pendingImports.length ? `${pendingImports.length} extracted file import${pendingImports.length === 1 ? "" : "s"} are waiting for mapping review.` : "",
    negativeTrends[0] ? `${negativeTrends[0].name} is down ${numberFormatter.format(Math.abs(negativeTrends[0].changePercent || 0))}% vs the previous period.` : ""
  ].filter(Boolean);
  const opportunities = [
    leadsCreated.length ? `${leadsCreated.length} new lead${leadsCreated.length === 1 ? "" : "s"} can be reviewed for follow-up or conversion.` : "",
    positiveTrends[0] ? `${positiveTrends[0].name} is showing the strongest improvement this period.` : "",
    recentImports.length ? `${recentImports.length} recent import${recentImports.length === 1 ? "" : "s"} added fresh business history for reports and Vaeroex review.` : "",
    operationalMetrics.length ? "Business metrics are available for staffing, job volume, costs, utilization, or custom trend reviews." : ""
  ].filter(Boolean);
  const recommendedActions = [
    overdueTasks.length ? "Assign due dates and owners for overdue follow-ups before the next management check-in." : "",
    openIssues.length ? "Sort open issues by severity and convert unresolved items into accountable follow-ups." : "",
    checklistFailures.length ? "Review failed checklist runs and update the process or escalation rule." : "",
    pendingImports.length ? "Open Files and save approved mappings so the dashboard uses the latest uploaded data." : "",
    negativeTrends.length ? "Review declining KPIs against recent imports, CRM activity, and follow-up workload." : "",
    !kpis.length ? "Create your first KPI manually, or import existing KPI data if you already have a spreadsheet." : "",
    !crmLeads.length ? "Add a CRM lead manually, or import a lead list later when one is available." : "",
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
          why: "Revenue is above target, but conversion, response time, overdue follow-ups, and checklist completion still need owner follow-up.",
          action: "Review recommended actions",
          href: "/app/tasks"
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
    ...overdueTasks.slice(0, 3).map((task) => ({
      id: `task-${task.id}`,
      title: task.title,
      source: "Follow-up",
      status: task.priority || task.status,
      context: `Due ${task.due_date || "not set"} · ${task.assigned_to ? `Owner: ${task.assigned_to}` : "Owner not assigned"}`,
      href: "/app/tasks" as Route
    })),
    ...belowTargetKpis.slice(0, 3).map((kpi) => ({
      id: `kpi-${kpi.id}`,
      title: kpi.name,
      source: "KPI risk",
      status: "Below target",
      context: `Actual ${formatMetricValue(kpi.actual_value, kpi.name)} vs target ${formatMetricValue(kpi.target, kpi.name)}.`,
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
      href: "/app/files" as Route
    })),
    ...negativeTrends.slice(0, 3).map((trend) => ({
      id: `trend-risk-${trend.name}`,
      title: trend.name,
      source: "KPI trend",
      status: "Declining",
      context: `${trend.name} is down ${numberFormatter.format(Math.abs(trend.changePercent || 0))}% vs the previous period.`,
      href: "/app/kpis" as Route
    }))
  ].slice(0, 3);
  const opportunitySignals: DashboardSignal[] = [
    ...leadsCreated.slice(0, 3).map((lead) => ({
      id: `lead-${lead.id}`,
      title: lead.lead_name,
      source: lead.company ? `CRM · ${lead.company}` : "CRM",
      status: lead.status,
      context: `${formatMetricValue(lead.estimated_value, "revenue", "No value set")} estimated value · ${lead.last_activity_at ? `Last activity ${new Date(lead.last_activity_at).toLocaleDateString()}` : "No recent activity recorded"}.`,
      href: "/app/crm" as Route
    })),
    ...positiveTrends.slice(0, 3).map((trend) => ({
      id: `trend-opportunity-${trend.name}`,
      title: trend.name,
      source: "KPI trend",
      status: "Improving",
      context: `${trend.name} improved ${percentLabel(trend.changePercent)} compared with the previous period.`,
      href: "/app/kpis" as Route
    })),
    ...recentImports.slice(0, 3).map((item) => ({
      id: `recent-import-${item.id}`,
      title: `${item.import_type.replace(/_/g, " ")} import`,
      source: "Files",
      status: item.status === "completed" ? "Saved" : item.status,
      context: `${item.rows_imported} of ${item.rows_total} rows available for historical reporting.`,
      href: "/app/files" as Route
    })),
    ...fileAnalyses.slice(0, 3).map((file) => ({
      id: `file-analysis-${file.id}`,
      title: file.display_name,
      source: "File analysis",
      status: file.import_status,
      context: file.analysis_summary ? file.analysis_summary.slice(0, 140) : "Analysis saved to workspace memory.",
      href: "/app/files" as Route
    }))
  ].slice(0, 3);
  const recommendedActionSignals: DashboardSignal[] = [
    overdueTasks.length
      ? {
          id: "action-overdue-tasks",
          title: "Assign overdue follow-ups",
          source: `${overdueTasks.length} overdue follow-up${overdueTasks.length === 1 ? "" : "s"}`,
          status: "High",
          context: `Start with: ${overdueTasks[0]?.title || "the oldest overdue follow-up"}.`,
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
          context: "Update the process, owner, or escalation rule if the failure repeats.",
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
          href: "/app/files" as Route
        }
      : null,
    negativeTrends[0]
      ? {
          id: `action-negative-trend-${negativeTrends[0].name}`,
          title: `Review ${negativeTrends[0].name}`,
          source: "KPI trend",
          status: "Declining",
          context: "Compare this KPI against recent CRM activity, imports, issues, and follow-up workload.",
          href: "/app/kpis" as Route
        }
      : null,
    !kpis.length
      ? {
          id: "action-first-kpi",
          title: "Create your first KPI",
          source: "KPI setup",
          status: "Start here",
          context: "Add one owner-level metric such as revenue, leads, jobs completed, or customer issues.",
          href: "/app/kpis" as Route
        }
      : null,
    !crmLeads.length
      ? {
          id: "action-first-crm",
          title: "Add your first CRM lead",
          source: "CRM setup",
          status: "Start here",
          context: "A single lead is enough to connect sales follow-up to reports and dashboard context.",
          href: "/app/crm" as Route
        }
      : null,
    !reports.length
      ? {
          id: "action-first-report",
          title: "Generate a report",
          source: "Reports",
          status: "Recommended",
          context: "Save a management summary so decisions and follow-up work have a record.",
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
    insights: demoWorkspaceCounts?.vaeroexInsights ?? vaeroexRuns.filter((run) => run.status === "completed").length
  };
  const onboardingItems: OnboardingChecklistItem[] = [
    {
      id: "profile",
      title: "Complete business profile",
      helpText: "Confirm workspace name, contact, team size, and business details so Vaeroex has the right context.",
      href: "/app/setup",
      completed: Boolean(context.activeWorkspace?.primary_contact_email || context.activeWorkspace?.size)
    },
    {
      id: "business-type",
      title: "Choose business type",
      helpText: "Business type helps Vaeroex suggest practical visibility, accountability, execution, KPI, and report structure.",
      href: "/app/setup",
      completed: Boolean(context.activeWorkspace?.industry)
    },
    {
      id: "kpi",
      title: "Add first KPI",
      helpText: "Start with one number the owner cares about, such as revenue, leads, jobs completed, or customer issues.",
      href: "/app/kpis",
      completed: Boolean(kpis.length)
    },
    {
      id: "crm",
      title: "Add first CRM lead",
      helpText: "A single lead is enough to make the dashboard and reports start reflecting sales follow-up.",
      href: "/app/crm",
      completed: Boolean(crmLeads.length)
    },
    {
      id: "file",
      title: "Upload first file",
      helpText: "Optional: upload CSV, XLSX, PDF, DOCX, PNG, or JPG when you already have business data to review.",
      href: "/app/files",
      completed: Boolean(files.length),
      optional: true
    },
    {
      id: "task",
      title: "Create first follow-up",
      helpText: "Create one accountable next action with a priority and due date.",
      href: "/app/tasks",
      completed: Boolean(tasks.length)
    },
    {
      id: "vaeroex",
      title: "Run first Vaeroex review",
      helpText: "Ask Vaeroex what needs attention using the records already in this workspace.",
      href: "/app/agents",
      completed: vaeroexRuns.some((run) => run.status === "completed")
    },
    {
      id: "report",
      title: "Generate first report",
      helpText: "Save a clean management summary so the owner can see what changed and what to do next.",
      href: "/app/reports",
      completed: Boolean(reports.length)
    }
  ];
  const briefing = isViewingDemoWorkspace
    ? {
        whatChanged:
          "The demo history runs from January through the current month. January started okay, February improved, March dipped, April recovered partially, May improved, and the current month is mixed.",
        improved:
          "May recovered above target after SOP review, checklist follow-up, CRM accountability, and clearer response-time ownership.",
        declined:
          "March revenue fell below the $40,000 target while response time rose to 32 hours, conversion dropped to 18%, and checklist completion fell to 78%.",
        attention:
          "The current month still shows softer conversion, slower response time, overdue follow-ups, and checklist completion below target.",
        recommendation:
          "Create a CRM follow-up, update the customer follow-up SOP, run a checklist review, create a KPI review follow-up, and generate a monthly recovery report."
      }
    : {
        whatChanged: recentImports.length
          ? `${recentImports.length} recent import${recentImports.length === 1 ? "" : "s"} updated workspace history.`
          : leadsCreated.length
            ? `${leadsCreated.length} CRM lead${leadsCreated.length === 1 ? "" : "s"} were created this period.`
            : "No major new data changes were found for this period yet.",
        improved: positiveTrends[0]
          ? `${positiveTrends[0].name} improved ${percentLabel(positiveTrends[0].changePercent)} compared with the previous period.`
          : "No positive KPI movement is visible yet.",
        declined: negativeTrends[0]
          ? `${negativeTrends[0].name} declined ${percentLabel(negativeTrends[0].changePercent)} compared with the previous period.`
          : "No declining KPI trend is visible yet.",
        attention: smartAlerts[0]?.title || risks[0] || "No urgent attention area was detected.",
        recommendation: recommendedActions[0] || "Keep adding real records, then generate a report after the next management review."
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
  const assignmentOwnerLabel = (assignment: AssignmentRow) => {
    if (assignment.assigned_person_id && peopleById.has(assignment.assigned_person_id)) {
      return peopleById.get(assignment.assigned_person_id)?.full_name || "Assigned person";
    }

    if (assignment.assigned_role) return assignment.assigned_role;
    if (assignment.assigned_department) return assignment.assigned_department;
    return "Workspace";
  };
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
    reports,
    vaeroexRuns,
    operationalMetrics,
    notifications,
    assignments,
    shares,
    people,
    decisions,
    recommendationOutcomes
  });
  const isExecutiveView = dashboardMode === "Executive View";
  const isOperationsView = dashboardMode === "Operations View";
  const isIntelligenceView = dashboardMode === "Intelligence View";
  const incompleteOnboardingCount = onboardingItems.filter((item) => !item.completed && !item.optional).length;
  const onboardingSummary = incompleteOnboardingCount
    ? `${incompleteOnboardingCount} required setup item${incompleteOnboardingCount === 1 ? "" : "s"} remaining.`
    : "Workspace setup is complete enough for ongoing review.";
  const modeDescription =
    dashboardMode === "Executive View"
      ? "A concise briefing focused on health, alerts, priorities, actions, and the weekly trend."
      : dashboardMode === "Operations View"
        ? `A ${period.toLowerCase()} operating view of KPIs, follow-ups, issues, checklists, ownership, CRM, and reports.`
        : `A ${period.toLowerCase()} intelligence view of business memory, trends, benchmarks, data quality, profit leaks, and signals.`;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operations Intelligence"
        title={context.activeWorkspace?.name ?? "Vaeroex intelligence dashboard"}
        description={modeDescription}
        actions={
          <div className="flex flex-col gap-3">
            <DashboardModeSelector mode={dashboardMode} period={period} />
            <PeriodSelector period={period} mode={dashboardMode} />
          </div>
        }
      />

      {params?.message ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{params.message}</div> : null}
      {params?.error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{params.error}</div> : null}

      {canUseAdminOnboardingTools ? (
        <DashboardAccordion
          title="Admin Tools"
          summary={`Hidden from customer dashboards. Onboarding: ${onboardingItems.filter((item) => item.completed).length}/${onboardingItems.length} complete. Skipped: ${onboardingItems.filter((item) => item.optional && !item.completed).length}. Workspace status: ${currentWorkspaceStatus}.`}
        >
          <div className="space-y-4">
            <AdminToolsBadge source={adminDetectionSource} />
            <OnboardingChecklist
              workspaceId={workspaceId}
              items={onboardingItems}
              adminControls
              workspaceStatus={currentWorkspaceStatus}
              demoWorkspaceForm={
                <DemoWorkspaceControls
                  demoWorkspaceExists={Boolean(demoWorkspace)}
                  isViewingDemoWorkspace={isViewingDemoWorkspace}
                  canUseAdminTools={canUseAdminOnboardingTools}
                />
              }
            />
          </div>
        </DashboardAccordion>
      ) : null}

      {errors.length ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errors[0]?.message || "Dashboard data could not be loaded."}
        </div>
      ) : null}

      {isViewingDemoWorkspace ? <DemoWorkspaceBanner counts={demoCounts} canUseAdminTools={canUseAdminOnboardingTools} /> : null}

      {!canUseAdminOnboardingTools && incompleteOnboardingCount ? (
        <DashboardAccordion title="Workspace setup" summary={onboardingSummary}>
          <OnboardingChecklist
            workspaceId={workspaceId}
            items={onboardingItems}
            adminControls={false}
            workspaceStatus={currentWorkspaceStatus}
          />
        </DashboardAccordion>
      ) : null}

      {isExecutiveView ? (
        <>
          <BusinessHealthHero intelligence={prestigeIntelligence} periodLabel={period} />

          <SmartAlerts
            alerts={smartAlerts.slice(0, 3)}
            title="Top 3 alerts"
            description="The highest-priority signals Vaeroex found for this workspace."
          />

          <ExecutiveBriefingCard
            period={period}
            whatChanged={briefing.whatChanged}
            improved={briefing.improved}
            declined={briefing.declined}
            attention={briefing.attention}
            recommendation={briefing.recommendation}
          />

          <section className="grid gap-4 xl:grid-cols-[1fr_.85fr]">
            <RecommendedActionsCard actions={recommendedActions} />
            <WeeklyTrendCard trends={weeklyTrends} />
          </section>
        </>
      ) : null}

      {isIntelligenceView ? (
        <PrestigeOperationsPanel
          intelligence={prestigeIntelligence}
          returnPath="/app"
          dateRangeStart={range.startDate}
          dateRangeEnd={range.endDate}
          isDemoWorkspace={isViewingDemoWorkspace}
          showHealthHero={false}
        />
      ) : null}

      {isOperationsView ? (
        <>
          <DashboardAccordion
            title="Ownership"
            summary={`${unreadNotifications.length} unread notification${unreadNotifications.length === 1 ? "" : "s"}, ${overdueOperationalAssignments.length} overdue assignment${overdueOperationalAssignments.length === 1 ? "" : "s"}, and ${recentReportShares.length} recently shared report${recentReportShares.length === 1 ? "" : "s"}.`}
          >
      <section className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <SectionCard
          title="Team accountability"
          description="Notifications, shared reports, KPI alerts, and assigned follow-up work for this workspace."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard label="Unread" value={unreadNotifications.length} detail="Notifications waiting" tone={unreadNotifications.length ? "border-vaeroex-accent/50 bg-vaeroex-soft text-vaeroex-blue" : undefined} />
            <StatCard label="KPI alerts" value={kpiAlertNotifications.length} detail="Rules triggered" tone={kpiAlertNotifications.length ? "border-amber-200 bg-amber-50 text-amber-900" : undefined} />
            <StatCard label="Shared reports" value={recentReportShares.length} detail="Recent in-app shares" />
            <StatCard label="Due soon" value={dueSoonAssignments.length} detail="Next 14 days" tone={dueSoonAssignments.length ? "border-amber-200 bg-amber-50 text-amber-900" : undefined} />
            <StatCard label="Overdue" value={overdueOperationalAssignments.length} detail="Assignments past due" tone={overdueOperationalAssignments.length ? "border-red-200 bg-red-50 text-red-700" : undefined} />
            <StatCard label="Assigned recs" value={recommendationAssignments.length} detail="Vaeroex follow-ups" />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/notifications" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              Open notifications
            </Link>
            <Link href="/app/tasks" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              Review assignments
            </Link>
            <Link href="/app/reports" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              Shared reports
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

        <SectionCard title="Accountability assignments" description="Follow-ups can be assigned to a person, role, or department without changing app permissions.">
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">Assigned to me</h3>
              <SimpleList
                items={assignedToMe}
                empty={currentUserPerson ? "No assignments are directed to you." : "No matching person record found for your login email."}
                render={(assignment: AssignmentRow) => (
                  <div key={assignment.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold">{assignment.title}</p>
                      <StatusBadge value={assignment.priority} />
                    </div>
                    <p className="mt-1 text-xs text-muted">Due {assignment.due_date || "not set"} · {assignment.status}</p>
                  </div>
                )}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Assigned to my role</h3>
              <SimpleList
                items={assignedToMyRole}
                empty={currentUserPerson?.role_title ? `No assignments for ${currentUserPerson.role_title}.` : "Add your role on the People page to see role-based assignments."}
                render={(assignment: AssignmentRow) => (
                  <div key={assignment.id} className="rounded-lg border border-line p-3">
                    <p className="text-sm font-semibold">{assignment.title}</p>
                    <p className="mt-1 text-xs text-muted">{assignment.assigned_role} · Due {assignment.due_date || "not set"}</p>
                  </div>
                )}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Assigned to my department</h3>
              <SimpleList
                items={assignedToMyDepartment}
                empty={currentUserPerson?.department ? `No assignments for ${currentUserPerson.department}.` : "Add your department on the People page to see department work."}
                render={(assignment: AssignmentRow) => (
                  <div key={assignment.id} className="rounded-lg border border-line p-3">
                    <p className="text-sm font-semibold">{assignment.title}</p>
                    <p className="mt-1 text-xs text-muted">{assignment.assigned_department} · Due {assignment.due_date || "not set"}</p>
                  </div>
                )}
              />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-ink">Overdue assignments</h3>
              <SimpleList
                items={overdueOperationalAssignments}
                empty="No overdue team assignments."
                render={(assignment: AssignmentRow) => (
                  <div key={assignment.id} className="rounded-lg border border-red-100 bg-red-50 p-3 text-red-700">
                    <p className="text-sm font-semibold">{assignment.title}</p>
                    <p className="mt-1 text-xs">Owner: {assignmentOwnerLabel(assignment)} · Due {assignment.due_date}</p>
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

        <SectionCard title="KPI alerts by role" description="Who is receiving KPI follow-up signals.">
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
              ? "Your workspace already has activity. Focus on improving existing KPIs, CRM records, follow-ups, checklists, SOPs, and reports instead of creating duplicate systems."
              : "Add KPIs, CRM leads, follow-ups, checklists, and SOPs directly in Vaeroex. The dashboard and reports work as soon as records are created."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/kpis" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              {kpis.length ? "Review KPIs" : "Add KPI"}
            </Link>
            <Link href="/app/crm" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              {crmLeads.length ? "Review CRM" : "Add CRM lead"}
            </Link>
            <Link href="/app/tasks" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              {tasks.length ? "Review follow-ups" : "Add follow-up"}
            </Link>
          </div>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm font-semibold text-ink">{hasWorkspaceData ? "Turn visibility into execution" : "Import existing data"}</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            {hasWorkspaceData
              ? "Use recent files, imports, reports, and Vaeroex findings to update existing dashboards, assign follow-up work, and keep reports current."
              : "Upload CSV or XLSX files when you already have data to bring in. Vaeroex stages mappings for review before saving anything to history."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/files" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              {files.length ? "Review files" : "Upload files"}
            </Link>
            <Link href="/app/reports" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              {reports.length ? "Review reports" : "Generate report"}
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
        <StatCard label="Open Follow-ups" value={openTasks.length} detail={`${overdueTasks.length} overdue`} tone={overdueTasks.length ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"} />
        <StatCard label="Open Risks" value={openIssues.length} detail="Active risks and blockers" tone={openIssues.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"} />
        <StatCard label="Recent Imports" value={recentImports.length} detail={`${pendingImports.length} waiting for review`} tone={pendingImports.length ? "border-amber-200 bg-amber-50 text-amber-900" : "border-line bg-white text-ink"} />
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <LineChart title="Revenue trend" rows={rowsForMetric(kpis, revenueMetric)} color="#1E6BFF" />
        <LineChart title="Leads trend" rows={rowsForMetric(kpis, leadsMetric)} color="#38BDF8" />
        <LineChart title={`${customMetric} trend`} rows={rowsForMetric(kpis, customMetric)} color="#0B1F4D" />
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
            title="Follow-ups, issues, and checklists"
            summary={`${openTasks.length} open follow-up${openTasks.length === 1 ? "" : "s"}, ${openIssues.length} open issue${openIssues.length === 1 ? "" : "s"}, and ${checklistFailures.length} checklist failure${checklistFailures.length === 1 ? "" : "s"} in this period.`}
          >
      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Follow-up ownership" description="Open follow-ups and overdue accountability.">
          <SimpleList
            items={openTasks.slice(0, 6)}
            empty="No open follow-ups."
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

          </DashboardAccordion>

          <DashboardAccordion
            title="Files, SOPs, CRM, and reports"
            summary={`${recentFiles.length} recent file${recentFiles.length === 1 ? "" : "s"}, ${sopUpdates.length} SOP update${sopUpdates.length === 1 ? "" : "s"}, ${leadsCreated.length} new lead${leadsCreated.length === 1 ? "" : "s"}, and ${reports.length} saved report${reports.length === 1 ? "" : "s"}.`}
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
            <StatCard label="Lead history" value={leadHistoryChanges.length} detail="Manual and imported changes" />
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
                items={vaeroexRuns.slice(0, 5)}
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

      {isIntelligenceView ? (
        <DashboardAccordion
          title="Intelligence signals"
          summary={`${riskSignals.length} actionable risk signal${riskSignals.length === 1 ? "" : "s"}, ${opportunitySignals.length} opportunit${opportunitySignals.length === 1 ? "y" : "ies"}, and ${recommendedActionSignals.length} recommended action${recommendedActionSignals.length === 1 ? "" : "s"} are available for review.`}
        >
      <section className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Risks" description="Top source records behind the current risk summary.">
          <SignalList items={riskSignals} empty="No major risks found for this period." tone="risk" />
        </SectionCard>

        <SectionCard title="Opportunities" description="Specific leads, KPI gains, imports, or analyses worth acting on.">
          <SignalList items={opportunitySignals} empty="No clear opportunities found yet." tone="opportunity" />
        </SectionCard>

        <SectionCard title="Recommended actions" description="Each action points to the module where the work should happen.">
          <SignalList
            items={recommendedActionSignals}
            empty="Keep the current cadence and review again after more activity is recorded."
            tone="action"
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/files" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              Review files
            </Link>
            <Link href="/app/crm" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              Review CRM
            </Link>
            <Link href="/app/reports" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
              Generate report
            </Link>
          </div>
        </SectionCard>
      </section>
        </DashboardAccordion>
      ) : null}
    </div>
  );
}
