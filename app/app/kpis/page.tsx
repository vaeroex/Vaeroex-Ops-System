import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { createKpiAction, updateKpiSettingAction, updateKpiValueAction } from "@/app/app/operations/actions";
import { ContextualAskVaeroex } from "@/components/ai/ContextualAskVaeroex";
import { KpiAlertRulePanel, ShareRecordPanel, type TeamPersonOption } from "@/components/accountability/AccountabilityForms";
import { GlobalSearchTrigger } from "@/components/app/GlobalSearchTrigger";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { ModuleTabs } from "@/components/operations/ModuleTabs";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { buildPrestigeIntelligence } from "@/lib/intelligence/prestige";
import { buildKpiForecastEligibility } from "@/lib/kpis/forecast-eligibility";
import {
  applyKpiSettingsToRows,
  getConfiguredMetricNames,
  KPI_COLOR_PALETTE,
  kpiColor,
  kpiColorMayBeLowContrast,
  kpiDefinition,
  kpiDisplayUnit,
  kpiSettingForName,
  kpiWeight,
  kpiXAxisLabel,
  kpiYAxisLabel,
  kpiValueFormat,
  sortKpiRowsBySettings,
  type KpiSettingRow
} from "@/lib/kpis/settings";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import type { Database } from "@/lib/supabase/types";

type KpisPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
    metric?: string | string[];
    section?: string;
    sort?: string;
    timeline?: string;
    mode?: string;
    status?: string;
    show?: string;
    target_applied?: string;
    undo_kpi?: string;
    undo_target?: string;
    start?: string;
    end?: string;
  }>;
};

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type KpiAlertRuleRow = Database["public"]["Tables"]["kpi_alert_rules"]["Row"];
type ShareRow = Database["public"]["Tables"]["record_shares"]["Row"];
type KpiTone = "green" | "yellow" | "red" | "neutral";
type ComparisonMode = "actual" | "percent" | "normalized";
type KpiStatusFilter = "all" | "on-track" | "behind-target" | "missing-data" | "updated-this-month";
type KpiTargetRecommendation = {
  value: number | null;
  confidence: "Low" | "Medium" | "Higher" | "Unavailable";
  reason: string;
  dataUsed: string;
  dateRange: string;
  limitation: string;
  outliers: string;
};
type KpiTrend = {
  name: string;
  rows: KpiRow[];
  color: string;
  latest: KpiRow | undefined;
  previous: KpiRow | undefined;
  change: number | null;
  changePercent: number | null;
  volatility: number | null;
};

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2
});

const kpiEditFields: ManagedRecordEditField[] = [
  { name: "name", label: "Name", required: true },
  { name: "category", label: "Category" },
  { name: "owner", label: "Owner" },
  { name: "source", label: "Source" },
  { name: "notes", label: "Notes", type: "textarea", rows: 4 }
];
const KPI_TIMELINES = ["7D", "30D", "90D", "6M", "12M", "YTD", "All Time", "Custom Range"] as const;
type KpiTimeline = (typeof KPI_TIMELINES)[number];

function lower(value: string | null | undefined) {
  return (value || "").toLowerCase();
}

function findLatestMetric(kpis: KpiRow[], keywords: string[]) {
  return kpis.find((kpi) => {
    const haystack = `${lower(kpi.name)} ${lower(kpi.category)}`;
    return keywords.some((keyword) => haystack.includes(keyword));
  });
}

function metricTone(actual: number | null, target: number | null): KpiTone {
  if (actual === null || target === null) {
    return "neutral";
  }

  if (target === 0) {
    return actual === 0 ? "green" : "red";
  }

  if (actual >= target) {
    return "green";
  }

  return actual >= target * 0.9 ? "yellow" : "red";
}

function openTaskTone(openTasks: number): KpiTone {
  if (openTasks === 0) {
    return "green";
  }

  return openTasks <= 5 ? "yellow" : "red";
}

function statusLabel(tone: KpiTone) {
  if (tone === "green") return "On Track";
  if (tone === "yellow") return "Near Target";
  if (tone === "red") return "Behind";
  return "Missing Data";
}

function toneClasses(tone: KpiTone) {
  if (tone === "green") return "border-emerald-400/35 bg-emerald-950/30 text-emerald-100";
  if (tone === "yellow") return "border-amber-400/35 bg-amber-950/30 text-amber-100";
  if (tone === "red") return "border-red-400/35 bg-red-950/30 text-red-100";
  return "border-slate-600/40 bg-slate-950/55 text-slate-200";
}

function formatMetricValue(kpi: KpiRow | undefined, fallback = "Not set") {
  if (!kpi || kpi.actual_value === null) {
    return fallback;
  }

  return formatNumericValue(kpi.actual_value, `${kpi.name} ${kpi.category || ""}`);
}

function formatNumericValue(value: number | null | undefined, label: string, fallback = "Not set") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const normalizedLabel = lower(label);

  if (normalizedLabel.includes("revenue") || normalizedLabel.includes("sales")) {
    return currencyFormatter.format(value);
  }

  if (normalizedLabel.includes("conversion") || normalizedLabel.includes("rate")) {
    return `${numberFormatter.format(value)}%`;
  }

  return numberFormatter.format(value);
}

function formatTarget(kpi: KpiRow | undefined) {
  if (!kpi || kpi.target === null) {
    return "No target set";
  }

  const label = `${lower(kpi.name)} ${lower(kpi.category)}`;

  if (label.includes("revenue") || label.includes("sales")) {
    return `Target ${currencyFormatter.format(kpi.target)}`;
  }

  if (label.includes("conversion") || label.includes("rate")) {
    return `Target ${numberFormatter.format(kpi.target)}%`;
  }

  return `Target ${numberFormatter.format(kpi.target)}`;
}

function formatSettingValue(value: number | null | undefined, metricName: string, settings: KpiSettingRow[], fallback = "Not set") {
  if (value === null || value === undefined) {
    return fallback;
  }

  const format = lower(kpiValueFormat(metricName, settings));
  const unit = kpiDisplayUnit(metricName, settings);

  if (format.includes("currency") || unit === "$") {
    return currencyFormatter.format(value);
  }

  if (format.includes("percent") || unit === "%") {
    return `${numberFormatter.format(value)}%`;
  }

  return `${numberFormatter.format(value)}${unit && !["$", "%"].includes(unit) ? ` ${unit}` : ""}`;
}

function monthSpan(rows: KpiRow[]) {
  const dates = rows.map((row) => row.metric_date).filter(Boolean).sort();
  if (!dates.length) return 0;
  const first = new Date(`${dates[0]}T12:00:00.000Z`);
  const last = new Date(`${dates[dates.length - 1]}T12:00:00.000Z`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(last.getTime())) return 0;

  return Math.max(1, (last.getUTCFullYear() - first.getUTCFullYear()) * 12 + last.getUTCMonth() - first.getUTCMonth() + 1);
}

function standardDeviation(values: number[]) {
  const avg = average(values);
  if (avg === null || values.length < 2) return 0;
  const variance = average(values.map((value) => (value - avg) ** 2)) ?? 0;
  return Math.sqrt(variance);
}

function recommendedTargetForMetric(metricName: string, rows: KpiRow[]): KpiTargetRecommendation {
  const valueRows = rows
    .filter((row) => row.name === metricName && row.actual_value !== null)
    .sort((a, b) => `${a.metric_date}-${a.created_at}`.localeCompare(`${b.metric_date}-${b.created_at}`));
  const values = valueRows.map((row) => row.actual_value as number);
  const count = values.length;

  if (count <= 2) {
    return {
      value: null,
      confidence: "Unavailable",
      reason: "Not enough history to recommend a reliable target.",
      dataUsed: `${count} KPI value${count === 1 ? "" : "s"} available`,
      dateRange: valueRows.length ? `${valueRows[0].metric_date} to ${valueRows[valueRows.length - 1].metric_date}` : "No dated history",
      limitation: "Vaeroex needs at least 3 data points for a low-confidence suggestion and more history for stronger guidance.",
      outliers: "Outlier review needs more values."
    };
  }

  const avg = average(values) ?? values[count - 1];
  const recentValues = values.slice(-Math.min(3, values.length));
  const recentAvg = average(recentValues) ?? avg;
  const deviation = standardDeviation(values);
  const outlierCount = values.filter((value) => Math.abs(value - avg) > deviation * 2 && deviation > 0).length;
  const cleanValues = outlierCount && count >= 6 ? values.filter((value) => Math.abs(value - avg) <= deviation * 2) : values;
  const cleanRecentAvg = average(cleanValues.slice(-Math.min(3, cleanValues.length))) ?? recentAvg;
  const first = cleanValues[0] ?? values[0];
  const last = cleanValues[cleanValues.length - 1] ?? values[count - 1];
  const trendRatio = first !== 0 ? (last - first) / Math.abs(first) : 0;
  const historyMonths = monthSpan(valueRows);
  const confidence: KpiTargetRecommendation["confidence"] = count >= 12 || historyMonths >= 6 ? "Higher" : count >= 6 ? "Medium" : "Low";
  const directionalFactor = trendRatio > 0.12 ? 1.04 : trendRatio < -0.12 ? 0.98 : 1.02;
  const suggested = Math.max(0, cleanRecentAvg * directionalFactor);
  const rounded = Math.abs(suggested) >= 1000 ? Math.round(suggested / 100) * 100 : Math.round(suggested * 100) / 100;

  return {
    value: rounded,
    confidence,
    reason: `Based on your historical ${metricName} data, recent performance is ${trendRatio > 0.08 ? "improving" : trendRatio < -0.08 ? "declining" : "relatively steady"}. Vaeroex keeps this suggestion conservative and does not overwrite your manual target.`,
    dataUsed: `${count} KPI value${count === 1 ? "" : "s"} across ${historyMonths} month${historyMonths === 1 ? "" : "s"}`,
    dateRange: `${valueRows[0].metric_date} to ${valueRows[valueRows.length - 1].metric_date}`,
    limitation:
      confidence === "Low"
        ? "Limited confidence because fewer than 6 data points are available."
        : confidence === "Medium"
          ? "Medium confidence because the history is useful but still limited for seasonality."
          : "Higher confidence based on available workspace history, not an industry benchmark.",
    outliers: outlierCount ? `${outlierCount} possible outlier${outlierCount === 1 ? "" : "s"} detected and softened in the suggestion.` : "No major outliers detected."
  };
}

function KpiStatusBadge({ tone }: { tone: KpiTone }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses(tone)}`}>
      {statusLabel(tone)}
    </span>
  );
}

function SuccessNotice({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return <div className="rounded-lg border border-emerald-400/35 bg-emerald-950/30 p-4 text-sm text-emerald-100">{message}</div>;
}

function TimelineControls({
  timeline,
  range,
  status
}: {
  timeline: KpiTimeline;
  range: { label: string; startDate: string; endDate: string };
  status: KpiStatusFilter;
}) {
  return (
    <details open={timeline !== "90D"} className="rounded-lg border border-white/10 bg-[#08111f] text-slate-100 shadow-panel">
      <summary className="flex cursor-pointer list-none flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Timeline: {timeline}</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            {range.label}: {range.startDate} to {range.endDate}
          </p>
        </div>
        <span className="w-fit rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100">
          Change range
        </span>
      </summary>
      <div className="border-t border-white/10 p-4">
        <div className="flex flex-wrap gap-2">
          {KPI_TIMELINES.map((item) => (
            <Link
              key={item}
              href={timelineHref(item, status)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                item === timeline
                  ? "border-vaeroex-blue bg-vaeroex-blue text-white"
                  : "border-white/10 bg-slate-950/50 text-slate-200 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent"
              }`}
            >
              {item}
            </Link>
          ))}
        </div>
        <form method="get" className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <input type="hidden" name="timeline" value="Custom Range" />
          {status !== "all" ? <input type="hidden" name="status" value={status} /> : null}
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Start
            <input
              name="start"
              type="date"
              defaultValue={timeline === "Custom Range" ? range.startDate : ""}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
            />
          </label>
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            End
            <input
              name="end"
              type="date"
              defaultValue={timeline === "Custom Range" ? range.endDate : ""}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
            />
          </label>
          <button className="self-end rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
            Apply custom range
          </button>
        </form>
      </div>
    </details>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
  href
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: KpiTone;
  href: Route;
}) {
  return (
    <article className={`rounded-lg border p-4 shadow-panel ${toneClasses(tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-80">{label}</p>
        <span className="rounded-full bg-white/70 px-2 py-1 text-[11px] font-semibold">{statusLabel(tone)}</span>
      </div>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
      <p className="mt-2 min-h-10 text-xs leading-5 opacity-80">{detail}</p>
      <Link href={href} className="mt-4 inline-flex text-xs font-semibold underline underline-offset-4">
        View details
      </Link>
    </article>
  );
}

function SummaryStat({ label, value, detail, tone = "neutral" }: { label: string; value: string | number; detail: string; tone?: KpiTone }) {
  return (
    <article className={`rounded-lg border p-3 ${toneClasses(tone)}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs leading-5 opacity-80">{detail}</p>
    </article>
  );
}

function StatusFilterCard({
  label,
  value,
  detail,
  tone,
  active,
  href
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: KpiTone;
  active: boolean;
  href: Route;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`block rounded-lg border p-3 transition ${
        active
          ? "border-vaeroex-accent bg-cyan-950/45 text-cyan-50 shadow-panel ring-1 ring-vaeroex-accent/40"
          : `${toneClasses(tone)} hover:border-vaeroex-accent/50 hover:bg-cyan-950/30 hover:text-cyan-50`
      }`}
    >
      <span className="text-xs font-semibold uppercase tracking-[0.14em] opacity-80">{label}</span>
      <span className="mt-2 block text-2xl font-semibold">{value}</span>
      <span className="mt-1 block text-xs leading-5 opacity-80">{detail}</span>
    </Link>
  );
}

function KpiTile({
  kpi,
  rows,
  settings,
  color,
  index
}: {
  kpi: KpiRow;
  rows: KpiRow[];
  settings: KpiSettingRow[];
  color: string;
  index: number;
}) {
  const tone = metricTone(kpi.actual_value, kpi.target);
  const href = `/app/kpis?metric=${encodeURIComponent(kpi.name)}&section=detail#kpi-detail` as Route;

  return (
    <article className="rounded-lg border border-white/10 bg-[#08111f] p-3 text-slate-100 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <h2 className="truncate text-sm font-semibold text-white">{kpi.name}</h2>
          </div>
        </div>
        <KpiStatusBadge tone={tone} />
      </div>
      <p className="mt-3 text-2xl font-semibold text-white">{formatSettingValue(kpi.actual_value, kpi.name, settings)}</p>
      <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-300 sm:grid-cols-3">
        <p>
          <span className="block text-slate-500">Target</span>
          {kpi.target === null ? "Not set" : formatSettingValue(kpi.target, kpi.name, settings)}
        </p>
        <p>
          <span className="block text-slate-500">Trend</span>
          {trendLabelForRows(rows)}
        </p>
        <p>
          <span className="block text-slate-500">Last updated</span>
          {kpi.updated_at ? formatShortDate(kpi.updated_at.slice(0, 10)) : formatShortDate(kpi.metric_date)}
        </p>
      </div>
      <Link href={href} className="mt-3 inline-flex min-h-10 items-center rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45">
        View details
      </Link>
      <span className="sr-only">KPI tile {index + 1}</span>
    </article>
  );
}

function KpiDetailPanel({
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
    <details open={defaultOpen} className="rounded-lg border border-white/10 bg-[#08111f] text-slate-100 shadow-panel">
      <summary className="flex cursor-pointer list-none flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-400">{summary}</p>
        </div>
        <span className="w-fit rounded-full border border-white/10 px-3 py-1 text-xs font-semibold text-cyan-100 group-open:bg-cyan-950/40 group-open:text-vaeroex-accent">
          Expand
        </span>
      </summary>
      <div className="border-t border-white/10 p-5">{children}</div>
    </details>
  );
}

function metricDetailsHref(metric: KpiRow | null | undefined): Route {
  if (!metric?.name) {
    return "/app/kpis?section=charts#trend-analysis" as Route;
  }

  return `/app/kpis?metric=${encodeURIComponent(metric.name)}&section=charts#trend-analysis` as Route;
}

function formatShortDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${value}T12:00:00.000Z`));
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function paramValues(value: string | string[] | undefined) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getSelectedMetrics(value: string | string[] | undefined, metricNames: string[]) {
  const selected = paramValues(value).filter((metric) => metricNames.includes(metric));

  if (selected.length) {
    return Array.from(new Set(selected));
  }

  return metricNames.slice(0, Math.min(metricNames.length, 3));
}

function isKpiTimeline(value: string | undefined): value is KpiTimeline {
  return KPI_TIMELINES.includes(value as KpiTimeline);
}

function isComparisonMode(value: string | undefined): value is ComparisonMode {
  return value === "actual" || value === "percent" || value === "normalized";
}

function isKpiStatusFilter(value: string | undefined): value is KpiStatusFilter {
  return value === "all" || value === "on-track" || value === "behind-target" || value === "missing-data" || value === "updated-this-month";
}

function statusFilterLabel(filter: KpiStatusFilter) {
  if (filter === "on-track") return "On Track";
  if (filter === "behind-target") return "Behind Target";
  if (filter === "missing-data") return "Missing Data";
  if (filter === "updated-this-month") return "Updated This Month";
  return "Total";
}

function matchesStatusFilter(row: KpiRow, filter: KpiStatusFilter) {
  if (filter === "all") return true;
  if (filter === "updated-this-month") return updatedThisMonth(row);

  const tone = metricTone(row.actual_value, row.target);
  if (filter === "on-track") return tone === "green";
  if (filter === "behind-target") return tone === "red";
  return row.actual_value === null;
}

function kpiHref(params: Record<string, string | number | null | undefined>) {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "" && value !== "all") {
      search.set(key, String(value));
    }
  });

  const query = search.toString();
  return (query ? `/app/kpis?${query}` : "/app/kpis") as Route;
}

function timelineQueryParams(timeline: KpiTimeline, range: { startDate: string; endDate: string }) {
  return timeline === "Custom Range"
    ? {
        timeline,
        start: range.startDate,
        end: range.endDate
      }
    : { timeline };
}

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function startOfYear(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
}

function validDateParam(value: string | undefined) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function timelineRange(timeline: KpiTimeline, rows: KpiRow[], customStart?: string, customEnd?: string) {
  const today = startOfDay(new Date());
  const todayDate = dateOnly(today);
  const allDates = rows.map((row) => row.metric_date).filter(Boolean).sort();
  const earliest = allDates[0] || dateOnly(addMonths(today, -12));

  if (timeline === "Custom Range") {
    const startDate = validDateParam(customStart) || earliest;
    const endDate = validDateParam(customEnd) || todayDate;

    return {
      label: "Custom Range",
      startDate: startDate <= endDate ? startDate : endDate,
      endDate: startDate <= endDate ? endDate : startDate
    };
  }

  if (timeline === "All Time") {
    return { label: "All Time", startDate: earliest, endDate: todayDate };
  }

  if (timeline === "YTD") {
    return { label: "Year to Date", startDate: dateOnly(startOfYear(today)), endDate: todayDate };
  }

  if (timeline === "12M") {
    return { label: "Last 12 months", startDate: dateOnly(addMonths(today, -12)), endDate: todayDate };
  }

  if (timeline === "6M") {
    return { label: "Last 6 months", startDate: dateOnly(addMonths(today, -6)), endDate: todayDate };
  }

  const days = timeline === "7D" ? 7 : timeline === "30D" ? 30 : 90;
  return { label: `Last ${days} days`, startDate: dateOnly(addDays(today, -(days - 1))), endDate: todayDate };
}

function filterKpisByTimeline(rows: KpiRow[], range: { startDate: string; endDate: string }) {
  return rows.filter((row) => row.metric_date >= range.startDate && row.metric_date <= range.endDate);
}

function timelineHref(timeline: KpiTimeline, status: KpiStatusFilter) {
  return kpiHref({ timeline, status });
}

function compareHref({
  timeline,
  range,
  metrics,
  mode
}: {
  timeline: KpiTimeline;
  range: { startDate: string; endDate: string };
  metrics: string[];
  mode: ComparisonMode;
}) {
  const search = new URLSearchParams();
  search.set("section", "compare");
  search.set("timeline", timeline);
  search.set("mode", mode);

  metrics.forEach((metric) => {
    if (metric) {
      search.append("metric", metric);
    }
  });

  if (timeline === "Custom Range") {
    search.set("start", range.startDate);
    search.set("end", range.endDate);
  }

  return `/app/kpis?${search.toString()}` as Route;
}

function formatLongDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function timeframeDisplay(range: { label: string; startDate: string; endDate: string }) {
  const dateRange = `${formatLongDate(range.startDate)} - ${formatLongDate(range.endDate)}`;

  if (range.label === "Custom Range") {
    return `Showing ${dateRange}`;
  }

  return `${range.label}: ${dateRange}`;
}

function getTrendRows(kpis: KpiRow[], metricName: string) {
  return kpis
    .filter((kpi) => kpi.name === metricName)
    .sort((a, b) => `${a.metric_date}-${a.created_at}`.localeCompare(`${b.metric_date}-${b.created_at}`))
    .slice(-24);
}

function getMetricHistoryRows(kpis: KpiRow[], metricName: string) {
  return kpis
    .filter((kpi) => kpi.name === metricName)
    .sort((a, b) => `${a.metric_date}-${a.created_at}`.localeCompare(`${b.metric_date}-${b.created_at}`));
}

function latestRowsByMetric(rows: KpiRow[], names: string[]) {
  return names
    .map((name) => getMetricHistoryRows(rows, name).at(-1))
    .filter((row): row is KpiRow => Boolean(row));
}

function trendLabelForRows(rows: KpiRow[]) {
  const values = rows.filter((row) => row.actual_value !== null);
  const latest = values.at(-1);
  const previous = values.at(-2);

  if (!latest || !previous || latest.actual_value === null || previous.actual_value === null) {
    return "Not enough history";
  }

  const delta = latest.actual_value - previous.actual_value;
  const threshold = Math.max(1, Math.abs(previous.actual_value) * 0.02);

  if (delta > threshold) return "Improving";
  if (delta < -threshold) return "Declining";
  return "Holding Steady";
}

function updatedThisMonth(row: KpiRow) {
  const today = new Date();
  const monthPrefix = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  return (row.updated_at || row.created_at || row.metric_date).startsWith(monthPrefix) || row.metric_date.startsWith(monthPrefix);
}

function buildTrends(kpis: KpiRow[], metricNames: string[], settings: KpiSettingRow[]) {
  return metricNames.map((name, index) => {
    const rows = getTrendRows(kpis, name);
    const latest = rows[rows.length - 1];
    const previous = rows[rows.length - 2];
    const values = rows.map((row) => row.actual_value).filter((value): value is number => value !== null);
    const first = values[0];
    const last = values[values.length - 1];
    const change = first !== undefined && last !== undefined ? last - first : null;
    const changePercent = first !== undefined && last !== undefined && first !== 0 ? ((last - first) / Math.abs(first)) * 100 : null;
    const deltas = values.slice(1).map((value, valueIndex) => Math.abs(value - values[valueIndex]));
    const volatility = deltas.length ? average(deltas) : null;

    return {
      name,
      rows,
      color: kpiColor(name, settings, index),
      latest,
      previous,
      change,
      changePercent,
      volatility
    } satisfies KpiTrend;
  });
}

function defaultComparisonMode(trends: KpiTrend[]): ComparisonMode {
  const latestValues = trends
    .map((trend) => trend.latest?.actual_value)
    .filter((value): value is number => value !== null && value !== undefined && value > 0)
    .sort((a, b) => a - b);

  if (latestValues.length < 2) {
    return "actual";
  }

  const smallest = latestValues[0] || 1;
  const largest = latestValues[latestValues.length - 1] || smallest;
  return largest / smallest > 8 ? "normalized" : "actual";
}

function trendDeltaLabel(latest: KpiRow | undefined, previous: KpiRow | undefined, metricName: string) {
  if (!latest || latest.actual_value === null || !previous || previous.actual_value === null) {
    return "Need one more record";
  }

  const delta = latest.actual_value - previous.actual_value;

  if (delta === 0) {
    return "No change";
  }

  const direction = delta > 0 ? "Up" : "Down";
  const absolute = formatNumericValue(Math.abs(delta), metricName);
  const percent =
    previous.actual_value !== 0 ? ` (${numberFormatter.format((Math.abs(delta) / Math.abs(previous.actual_value)) * 100)}%)` : "";

  return `${direction} ${absolute}${percent}`;
}

function targetHitRate(rows: KpiRow[]) {
  const rowsWithTargets = rows.filter((row) => row.actual_value !== null && row.target !== null);

  if (!rowsWithTargets.length) {
    return "No targets";
  }

  const onTarget = rowsWithTargets.filter((row) => metricTone(row.actual_value, row.target) === "green").length;
  return `${numberFormatter.format((onTarget / rowsWithTargets.length) * 100)}%`;
}

function TrendSummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-400">{detail}</p>
    </article>
  );
}

function TrendChart({ rows, metricName, settings }: { rows: KpiRow[]; metricName: string; settings: KpiSettingRow[] }) {
  const chartRows = rows.filter((row) => row.actual_value !== null);

  if (chartRows.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/35 p-5 text-sm leading-6 text-slate-300">
        Add at least two dated records for {metricName || "this KPI"} to show a trend line.
      </div>
    );
  }

  const width = 680;
  const height = 240;
  const paddingX = 44;
  const paddingTop = 28;
  const paddingBottom = 44;
  const values = chartRows.flatMap((row) =>
    row.target === null || row.target === undefined ? [row.actual_value as number] : [row.actual_value as number, row.target]
  );
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue || 1;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingTop - paddingBottom;
  const xFor = (index: number) => paddingX + (index / Math.max(chartRows.length - 1, 1)) * plotWidth;
  const yFor = (value: number) => paddingTop + (1 - (value - minValue) / range) * plotHeight;
  const actualPoints = chartRows.map((row, index) => `${xFor(index)},${yFor(row.actual_value as number)}`).join(" ");
  const targetRows = chartRows.filter((row) => row.target !== null);
  const targetPoints = chartRows
    .map((row, index) => (row.target === null ? null : `${xFor(index)},${yFor(row.target)}`))
    .filter(Boolean)
    .join(" ");
  const firstDate = chartRows[0]?.metric_date;
  const lastDate = chartRows[chartRows.length - 1]?.metric_date;
  const axisX = kpiXAxisLabel(metricName, settings);
  const axisY = kpiYAxisLabel(metricName, settings);
  const chartColor = kpiColor(metricName, settings);

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/35">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-white">{metricName}</p>
          <p className="text-xs text-slate-400">Last {chartRows.length} recorded values · {axisX} / {axisY}</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2">
            <span className="h-2 w-5 rounded-full bg-vaeroex-blue" />
            Actual
          </span>
          {targetRows.length ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-0.5 w-5 border-t-2 border-dashed border-amber-500" />
              Target
            </span>
          ) : null}
        </div>
      </div>
      <div className="p-3">
        <svg className="h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metricName} trend chart`}>
          {[0, 1, 2, 3].map((line) => {
            const y = paddingTop + (line / 3) * plotHeight;
            return <line key={line} x1={paddingX} x2={width - paddingX} y1={y} y2={y} stroke="rgba(148,163,184,.24)" strokeWidth="1" />;
          })}
          <text x="8" y={paddingTop + 5} className="fill-slate-400 text-[11px]">
            {numberFormatter.format(maxValue)}
          </text>
          <text x="8" y={paddingTop + plotHeight} className="fill-slate-400 text-[11px]">
            {numberFormatter.format(minValue)}
          </text>
          {targetRows.length >= 2 ? (
            <polyline fill="none" points={targetPoints} stroke="#f59e0b" strokeDasharray="8 7" strokeLinecap="round" strokeWidth="3" />
          ) : null}
          <polyline fill="none" points={actualPoints} stroke={chartColor} strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
          {chartRows.map((row, index) => (
            <circle key={row.id} cx={xFor(index)} cy={yFor(row.actual_value as number)} r="5" fill={chartColor} stroke="#ffffff" strokeWidth="2" />
          ))}
          {firstDate ? (
            <text x={paddingX} y={height - 14} className="fill-slate-500 text-[11px]">
              {formatShortDate(firstDate)}
            </text>
          ) : null}
          {lastDate ? (
            <text x={width - paddingX} y={height - 14} textAnchor="end" className="fill-slate-500 text-[11px]">
              {formatShortDate(lastDate)}
            </text>
          ) : null}
        </svg>
      </div>
    </div>
  );
}

function normalizedPointValue(value: number, values: number[]) {
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const range = maxValue - minValue;

  if (!range) {
    return 50;
  }

  return ((value - minValue) / range) * 100;
}

function comparisonPointValue(value: number, values: number[], mode: ComparisonMode) {
  if (mode === "normalized") {
    return normalizedPointValue(value, values);
  }

  if (mode === "percent") {
    const first = values[0] || 0;
    return first === 0 ? 0 : ((value - first) / Math.abs(first)) * 100;
  }

  return value;
}

function OverlayTrendChart({ trends, mode }: { trends: KpiTrend[]; mode: ComparisonMode }) {
  const chartTrends = trends.filter((trend) => trend.rows.filter((row) => row.actual_value !== null).length >= 2);

  if (chartTrends.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/35 p-5 text-sm leading-6 text-slate-300">
        Select at least two KPIs with two or more dated values to compare trend lines.
      </div>
    );
  }

  const width = 720;
  const height = 260;
  const paddingX = 44;
  const paddingTop = 28;
  const paddingBottom = 44;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingTop - paddingBottom;
  const allPointValues = chartTrends.flatMap((trend) => {
    const rows = trend.rows.filter((row) => row.actual_value !== null);
    const values = rows.map((row) => row.actual_value as number);
    return values.map((value) => comparisonPointValue(value, values, mode));
  });
  const minValue = mode === "normalized" ? 0 : Math.min(...allPointValues);
  const maxValue = mode === "normalized" ? 100 : Math.max(...allPointValues);
  const valueRange = maxValue - minValue || 1;
  const xFor = (index: number, count: number) => paddingX + (index / Math.max(count - 1, 1)) * plotWidth;
  const yFor = (value: number) => paddingTop + (1 - (value - minValue) / valueRange) * plotHeight;
  const modeLabel = mode === "actual" ? "Actual values" : mode === "percent" ? "Percent change from first value" : "Normalized 0-100";

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/35">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-white">KPI comparison chart</p>
          <p className="text-xs leading-5 text-slate-400">{modeLabel}. Use normalized mode when selected KPIs have different scales.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-slate-300">
          {chartTrends.map((trend) => (
            <span key={trend.name} className="inline-flex items-center gap-2">
              <span className="h-2 w-5 rounded-full" style={{ backgroundColor: trend.color }} />
              {trend.name}
            </span>
          ))}
        </div>
      </div>
      <div className="p-3">
        <svg className="h-auto w-full" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Multi-KPI comparison trend chart">
          {[0, 1, 2, 3, 4].map((line) => {
            const y = paddingTop + (line / 4) * plotHeight;
            return <line key={line} x1={paddingX} x2={width - paddingX} y1={y} y2={y} stroke="rgba(148,163,184,.24)" strokeWidth="1" />;
          })}
          <text x="8" y={paddingTop + 5} className="fill-slate-400 text-[11px]">
            {mode === "actual" ? numberFormatter.format(maxValue) : mode === "percent" ? `${numberFormatter.format(maxValue)}%` : "High"}
          </text>
          <text x="8" y={paddingTop + plotHeight} className="fill-slate-400 text-[11px]">
            {mode === "actual" ? numberFormatter.format(minValue) : mode === "percent" ? `${numberFormatter.format(minValue)}%` : "Low"}
          </text>
          {chartTrends.map((trend) => {
            const rows = trend.rows.filter((row) => row.actual_value !== null);
            const values = rows.map((row) => row.actual_value as number);
            const points = rows
              .map((row, index) => `${xFor(index, rows.length)},${yFor(comparisonPointValue(row.actual_value as number, values, mode))}`)
              .join(" ");

            return (
              <g key={trend.name}>
                <polyline fill="none" points={points} stroke={trend.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
                {rows.map((row, index) => (
                  <circle
                    key={`${trend.name}-${row.id}`}
                    cx={xFor(index, rows.length)}
                    cy={yFor(comparisonPointValue(row.actual_value as number, values, mode))}
                    r="4"
                    fill={trend.color}
                    stroke="#0B1220"
                    strokeWidth="2"
                  />
                ))}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function trendDirection(trend: KpiTrend) {
  if (trend.change === null) {
    return "flat";
  }

  if (trend.change > 0) {
    return "up";
  }

  if (trend.change < 0) {
    return "down";
  }

  return "flat";
}

function trendActualValues(trend: KpiTrend) {
  return trend.rows.map((row) => row.actual_value).filter((value): value is number => value !== null);
}

function trendDateRange(trends: KpiTrend[]) {
  const dates = trends.flatMap((trend) => trend.rows.map((row) => row.metric_date)).filter(Boolean).sort();

  if (!dates.length) {
    return null;
  }

  return { startDate: dates[0], endDate: dates[dates.length - 1] };
}

function monthsBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T12:00:00.000Z`);
  const end = new Date(`${endDate}T12:00:00.000Z`);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  return Math.max(1, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1);
}

function comparisonConfidence({
  trends,
  dataQualityScore,
  memoryCount
}: {
  trends: KpiTrend[];
  dataQualityScore: number;
  memoryCount: number;
}) {
  const usableTrends = trends.filter((trend) => trendActualValues(trend).length >= 2);
  const recordCount = trends.reduce((count, trend) => count + trendActualValues(trend).length, 0);
  const range = trendDateRange(usableTrends);
  const coverageMonths = range ? monthsBetween(range.startDate, range.endDate) : 0;
  const recordDepthScore = Math.min(30, recordCount * 2);
  const breadthScore = Math.min(20, usableTrends.length * 6);
  const historyScore = Math.min(25, coverageMonths * 4);
  const qualityScore = Math.min(15, dataQualityScore * 0.15);
  const memoryScore = Math.min(10, memoryCount * 2);
  const score = Math.round(Math.min(90, recordDepthScore + breadthScore + historyScore + qualityScore + memoryScore));
  const label = score >= 70 ? "Good" : score >= 55 ? "Moderate" : score >= 35 ? "Limited" : "Low";
  const forecastConfidence =
    score >= 70 && coverageMonths >= 4 && recordCount >= 12
      ? "Good"
      : score >= 55 && coverageMonths >= 3 && recordCount >= 8
        ? "Moderate"
        : "Low";
  const limitations = [
    usableTrends.length < 2 ? "At least two KPIs need usable history for reliable comparison." : "",
    recordCount < 8 ? "The comparison has fewer than 8 dated KPI values." : "",
    coverageMonths < 3 ? "Historical coverage is under 3 months, so seasonality and forecasting are limited." : "",
    dataQualityScore < 60 ? "Workspace data quality is still developing." : "",
    memoryCount < 3 ? "Business Memory coverage is limited." : ""
  ].filter(Boolean);

  return {
    score,
    label,
    forecastConfidence,
    coverageMonths,
    limitations: limitations.length ? limitations.join(" ") : "Enough KPI history exists for a useful leadership review, though forecasts should still be treated as directional."
  };
}

function comparisonContext({
  trends,
  range,
  dataQualityScore,
  memoryCount
}: {
  trends: KpiTrend[];
  range: { label: string; startDate: string; endDate: string };
  dataQualityScore: number;
  memoryCount: number;
}) {
  const recordCount = trends.reduce((count, trend) => count + trendActualValues(trend).length, 0);
  const actualRange = trendDateRange(trends);
  const confidence = comparisonConfidence({ trends, dataQualityScore, memoryCount });
  const forecast = buildKpiForecastEligibility(trends.flatMap((trend) => trend.rows));
  const comparedKpis = trends.map((trend) => trend.name).filter(Boolean);
  const historicalCoverage = actualRange
    ? `${monthsBetween(actualRange.startDate, actualRange.endDate)} month${monthsBetween(actualRange.startDate, actualRange.endDate) === 1 ? "" : "s"} (${formatLongDate(actualRange.startDate)} - ${formatLongDate(actualRange.endDate)})`
    : "No dated KPI history in this range";

  return {
    timeframe: timeframeDisplay(range),
    recordCount,
    comparedKpis,
    currentKpiAvailability: forecast.currentAvailabilityLabel,
    historicalCoverage,
    historicalDepth: forecast.historicalDepthLabel,
    measurementFreshness: forecast.freshnessLabel,
    forecastReadiness: forecast,
    forecastConfidence: forecast.label,
    confidenceLabel: confidence.label,
    confidenceScore: confidence.score,
    dataLimitations: `${forecast.reason} ${confidence.limitations}`,
    businessMemoryCoverage: `${memoryCount} memory signal${memoryCount === 1 ? "" : "s"} available; data quality ${dataQualityScore}/100`
  };
}

function percentChangeLabel(trend: KpiTrend) {
  if (trend.changePercent === null) {
    return "not enough comparable history";
  }

  const direction = trend.changePercent > 0 ? "up" : trend.changePercent < 0 ? "down" : "flat";
  return `${direction} ${numberFormatter.format(Math.abs(trend.changePercent))}%`;
}

function metricMatches(trend: KpiTrend | undefined, keywords: string[]) {
  if (!trend) {
    return false;
  }

  const name = lower(trend.name);
  return keywords.some((keyword) => name.includes(keyword));
}

function comparisonNotes(trends: KpiTrend[]) {
  const usable = trends.filter((trend) => trend.rows.filter((row) => row.actual_value !== null).length >= 2);

  if (usable.length < 2) {
    return ["Select at least two KPIs with two or more values to unlock comparison notes."];
  }

  const improving = usable
    .filter((trend) => trend.changePercent !== null)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))[0];
  const declining = usable
    .filter((trend) => (trend.changePercent ?? 0) < 0)
    .sort((a, b) => (a.changePercent ?? 0) - (b.changePercent ?? 0))[0];
  const volatile = usable
    .filter((trend) => trend.volatility !== null)
    .sort((a, b) => (b.volatility ?? 0) - (a.volatility ?? 0))[0];
  const revenue = usable.find((trend) => lower(trend.name).includes("revenue") || lower(trend.name).includes("sales"));
  const customerActivity = usable.find((trend) => lower(trend.name).includes("lead") || lower(trend.name).includes("customer"));
  const conversion = usable.find((trend) => metricMatches(trend, ["conversion", "close rate"]));
  const responseTime = usable.find((trend) => metricMatches(trend, ["response", "reply time", "speed"]));
  const satisfaction = usable.find((trend) => metricMatches(trend, ["satisfaction", "csat", "nps"]));
  const issues = usable.find((trend) => metricMatches(trend, ["issue", "complaint", "risk"]));
  const overdue = usable.find((trend) => metricMatches(trend, ["overdue", "late", "backlog"]));
  const notes = [
    improving && improving.changePercent !== null
      ? `Biggest positive movement: ${improving.name} is ${percentChangeLabel(improving)}. This matters because it may be the KPI creating the most operating leverage right now.`
      : "No KPI has enough positive movement to identify a clear fastest improver.",
    declining && declining.changePercent !== null
      ? `Biggest risk signal: ${declining.name} is ${percentChangeLabel(declining)}. Leadership should check whether this is an isolated dip or a downstream effect from staffing, follow-up, service quality, or demand.`
      : "No selected KPI is currently declining across its available history.",
    volatile && volatile.volatility !== null
      ? `Most volatile KPI: ${volatile.name} moves by about ${formatNumericValue(volatile.volatility, volatile.name)} between entries. Volatility matters because it makes planning less reliable even when the latest value looks acceptable.`
      : "Volatility needs more dated values before it becomes useful."
  ];

  if (revenue && customerActivity) {
    const revenueDirection = trendDirection(revenue);
    const customerActivityDirection = trendDirection(customerActivity);

    if (customerActivityDirection === "up" && revenueDirection === "down") {
      notes.push("Customer activity is rising while revenue is falling, which points to a possible conversion, pricing, qualification, or response-quality bottleneck rather than a demand problem.");
    } else if (customerActivityDirection === "down" && revenueDirection === "up") {
      notes.push("Revenue is rising while customer activity is falling, which may mean higher-value work is offsetting weaker activity volume. That can be healthy short term, but customer activity quality should be watched.");
    } else if (customerActivityDirection === revenueDirection && customerActivityDirection !== "flat") {
      notes.push(`Customer activity and revenue are both moving ${customerActivityDirection}, which suggests activity volume and revenue results are currently aligned.`);
    }
  }

  if (customerActivity && conversion && trendDirection(customerActivity) === "up" && trendDirection(conversion) === "down") {
    notes.push("Customer activity is improving while conversion is declining. Vaeroex would treat this as a response quality, qualification, or revenue process signal.");
  }

  if (responseTime && (conversion || revenue) && trendDirection(responseTime) === "up") {
    const paired = (conversion || revenue) as KpiTrend;
    notes.push(
      `${responseTime.name} is rising while ${paired.name} is ${percentChangeLabel(paired)}. If higher response time means slower service, this may be creating a customer or sales bottleneck.`
    );
  }

  if (satisfaction && revenue && trendDirection(revenue) === "up" && trendDirection(satisfaction) === "down") {
    notes.push("Revenue is improving while customer satisfaction is declining. Growth may be creating service strain that should be corrected before it becomes churn or complaints.");
  }

  const executionRisk = issues || overdue;

  if (executionRisk && revenue && trendDirection(revenue) === "up" && trendDirection(executionRisk) === "up") {
    notes.push("Operating demand appears to be rising while issues or Business Signals are also increasing. That pattern can indicate capacity, response, or service-quality pressure.");
  }

  return notes;
}

function ComparisonDataContext({
  context
}: {
  context: ReturnType<typeof comparisonContext>;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
      <p className="text-sm font-semibold text-white">Data Context</p>
      <dl className="mt-3 grid gap-3 text-xs leading-5 text-slate-300 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <dt className="font-semibold text-slate-400">Timeframe analyzed</dt>
          <dd className="mt-1 text-white">{context.timeframe}</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <dt className="font-semibold text-slate-400">KPI records</dt>
          <dd className="mt-1 text-white">{context.recordCount}</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <dt className="font-semibold text-slate-400">KPIs compared</dt>
          <dd className="mt-1 text-white">{context.comparedKpis.join(", ") || "None selected"}</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <dt className="font-semibold text-slate-400">Current KPI data</dt>
          <dd className="mt-1 text-white">{context.currentKpiAvailability}</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <dt className="font-semibold text-slate-400">Historical depth</dt>
          <dd className="mt-1 text-white">{context.historicalDepth}</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <dt className="font-semibold text-slate-400">Measurement freshness</dt>
          <dd className="mt-1 text-white">{context.measurementFreshness}</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <dt className="font-semibold text-slate-400">Forecast readiness</dt>
          <dd className="mt-1 text-white">{context.forecastConfidence} ({context.confidenceScore}/100 comparison score)</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <dt className="font-semibold text-slate-400">Business Memory used</dt>
          <dd className="mt-1 text-white">{context.businessMemoryCoverage}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs leading-5 text-slate-400">{context.dataLimitations}</p>
    </div>
  );
}

function ComparisonAnalysis({
  trends,
  mode,
  context
}: {
  trends: KpiTrend[];
  mode: ComparisonMode;
  context: ReturnType<typeof comparisonContext>;
}) {
  const notes = comparisonNotes(trends);
  const evidence = [
    `Timeframe: ${context.timeframe}`,
    `KPIs compared: ${context.comparedKpis.join(", ") || "None"}`,
    `Comparison mode: ${mode}`,
    `KPI records: ${context.recordCount}`,
    `Current KPI data: ${context.currentKpiAvailability}`,
    `Historical coverage: ${context.historicalCoverage}`,
    `Historical depth: ${context.historicalDepth}`,
    `Measurement freshness: ${context.measurementFreshness}`,
    `Forecast readiness: ${context.forecastConfidence}; comparison score ${context.confidenceScore}/100`,
    `Business Memory coverage: ${context.businessMemoryCoverage}`,
    `Data limitations: ${context.dataLimitations}`,
    ...trends.map((trend) => `${trend.name}: ${percentChangeLabel(trend)}; latest ${formatNumericValue(trend.latest?.actual_value, trend.name)}; records ${trendActualValues(trend).length}`)
  ];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-cyan-400/25 bg-cyan-950/20 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Timeframe analyzed</p>
        <p className="mt-2 text-base font-semibold text-white">{context.timeframe}</p>
        <p className="mt-1 text-xs leading-5 text-slate-300">
          Preset ranges update immediately. Custom ranges apply after you choose dates.
        </p>
      </div>
      <OverlayTrendChart trends={trends} mode={mode} />
      <div className="rounded-lg border border-cyan-400/25 bg-[#08111f] p-4">
        <div className="mb-3">
          <p className="text-sm font-semibold text-white">Explain This Comparison</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Generate an inline leadership readout using this chart, timeframe, selected KPIs, and available Business Memory.
          </p>
        </div>
        <ContextualAskVaeroex
          label="Explain This Comparison"
          prompt="Explain what this KPI comparison shows. Identify only the strongest supported relationship, why it matters, the evidence in the selected timeframe, and any meaningful uncertainty. Do not turn it into a general business briefing."
          contextType="kpi_comparison"
          contextId={`kpi-comparison-${context.comparedKpis.join("-")}-${mode}`}
          sourceTitle="KPI comparison"
          sourceSummary={`Comparing ${context.comparedKpis.join(", ") || "selected KPIs"} across ${context.timeframe} in ${mode} mode.`}
          evidence={evidence}
          compact
          defaultCollapsed={false}
        />
      </div>
      <ComparisonDataContext context={context} />
      <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
        <p className="text-sm font-semibold text-white">Comparison Insights</p>
        <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
          {notes.map((note, index) => (
            <div key={`${note}-${index}`} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
              <p>{note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function kpiDetailReturnPath(metricName: string) {
  return `/app/kpis?metric=${encodeURIComponent(metricName)}&section=detail`;
}

function KpiSettingHiddenFields({
  metricName,
  setting,
  latest,
  target,
  includeTarget = true
}: {
  metricName: string;
  setting: KpiSettingRow | undefined;
  latest: KpiRow | undefined;
  target?: number | string | null;
  includeTarget?: boolean;
}) {
  return (
    <>
      <input type="hidden" name="kpi_name" value={metricName} />
      {includeTarget ? <input type="hidden" name="target" value={target ?? setting?.target ?? latest?.target ?? ""} /> : null}
      <input type="hidden" name="weight" value={setting?.weight ?? 1} />
      <input type="hidden" name="category" value={setting?.category ?? latest?.category ?? ""} />
      <input type="hidden" name="definition" value={setting?.definition ?? ""} />
      <input type="hidden" name="color" value={setting?.color ?? "#10B981"} />
      <input type="hidden" name="sort_order" value={setting?.sort_order ?? 0} />
      <input type="hidden" name="unit_type" value={setting?.unit_type ?? ""} />
      <input type="hidden" name="display_unit" value={setting?.display_unit ?? ""} />
      <input type="hidden" name="value_format" value={setting?.value_format ?? ""} />
      <input type="hidden" name="x_axis_label" value={setting?.x_axis_label ?? "Date"} />
      <input type="hidden" name="y_axis_label" value={setting?.y_axis_label ?? metricName} />
      <input type="hidden" name="preferred_chart_type" value={setting?.preferred_chart_type ?? "line"} />
      <input type="hidden" name="is_visible" value={(setting?.is_visible ?? true) ? "true" : "false"} />
    </>
  );
}

function ManualTargetForm({
  metricName,
  setting,
  latest
}: {
  metricName: string;
  setting: KpiSettingRow | undefined;
  latest: KpiRow | undefined;
}) {
  return (
    <form action={updateKpiSettingAction} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
      <input type="hidden" name="return_path" value={kpiDetailReturnPath(metricName)} />
      <KpiSettingHiddenFields metricName={metricName} setting={setting} latest={latest} includeTarget={false} />
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Manual target
        <input
          name="target"
          type="number"
          step="0.01"
          defaultValue={setting?.target ?? latest?.target ?? ""}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="min-h-10 rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
          Save target
        </button>
        <Link href={(`/app/kpis?metric=${encodeURIComponent(metricName)}&section=detail#kpi-detail`) as Route} className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">
          Cancel
        </Link>
      </div>
    </form>
  );
}

function KpiTargetRecommendationPanel({
  metricName,
  recommendation,
  setting,
  latest
}: {
  metricName: string;
  recommendation: KpiTargetRecommendation;
  setting: KpiSettingRow | undefined;
  latest: KpiRow | undefined;
}) {
  if (recommendation.value === null) {
    return (
      <div className="space-y-3 rounded-lg border border-amber-400/35 bg-amber-950/25 p-4 text-sm leading-6 text-amber-100">
        <div>
          <p className="font-semibold">Not enough history to recommend a reliable target.</p>
          <p className="mt-2">{recommendation.limitation}</p>
          <p className="mt-2">Suggested next data: upload 6-12 months of KPI history or prior monthly reports.</p>
        </div>
        <ManualTargetForm metricName={metricName} setting={setting} latest={latest} />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-cyan-400/25 bg-cyan-950/20 p-4 text-sm text-cyan-50">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Vaeroex Recommended Target</p>
          <p className="mt-2 text-2xl font-semibold text-white">{numberFormatter.format(recommendation.value)}</p>
        </div>
        <span className="w-fit rounded-full border border-cyan-300/35 bg-cyan-950/40 px-3 py-1 text-xs font-semibold text-cyan-100">
          Confidence: {recommendation.confidence === "Higher" ? "High" : recommendation.confidence}
        </span>
      </div>
      <p className="mt-3 leading-6">{recommendation.reason}</p>
      <dl className="mt-4 grid gap-3 text-xs leading-5 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
          <dt className="font-semibold text-white">Data used</dt>
          <dd className="mt-1 text-slate-300">{recommendation.dataUsed}</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
          <dt className="font-semibold text-white">Date range</dt>
          <dd className="mt-1 text-slate-300">{recommendation.dateRange}</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
          <dt className="font-semibold text-white">Limitation</dt>
          <dd className="mt-1 text-slate-300">{recommendation.limitation}</dd>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
          <dt className="font-semibold text-white">Outliers</dt>
          <dd className="mt-1 text-slate-300">{recommendation.outliers}</dd>
        </div>
      </dl>
      <ManualTargetForm metricName={metricName} setting={setting} latest={latest} />
      <div className="mt-4 flex flex-wrap gap-2">
        <form action={updateKpiSettingAction}>
          <input type="hidden" name="return_path" value={kpiDetailReturnPath(metricName)} />
          <KpiSettingHiddenFields metricName={metricName} setting={setting} latest={latest} target={recommendation.value} />
          <input type="hidden" name="target_change_context" value="recommended" />
          <input type="hidden" name="previous_target" value={setting?.target ?? latest?.target ?? ""} />
          <button className="min-h-10 rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
            Apply recommended target
          </button>
        </form>
      </div>
      <div className="mt-4">
        <ContextualAskVaeroex
          label="Explain This"
          prompt={`Explain why ${recommendation.value} was recommended as the target for ${metricName}, which KPI evidence supports it, and what uncertainty should be considered.`}
          contextType="kpi_recommended_target"
          contextId={latest?.id || metricName}
          sourceTitle={`${metricName} recommended target`}
          sourceSummary={`Recommended target ${recommendation.value}. Current/manual target ${setting?.target ?? latest?.target ?? "not set"}. Latest value ${latest?.actual_value ?? "not set"}.`}
          evidence={[
            recommendation.reason,
            recommendation.dataUsed,
            `Date range: ${recommendation.dateRange}`,
            `Confidence: ${recommendation.confidence === "Higher" ? "High" : recommendation.confidence}`,
            `Limitations: ${recommendation.limitation}`,
            `Outliers: ${recommendation.outliers}`
          ]}
          defaultCollapsed={false}
          compact
        />
      </div>
    </div>
  );
}

function TargetUndoNotice({
  metricName,
  previousTarget,
  setting,
  latest
}: {
  metricName?: string;
  previousTarget?: string;
  setting: KpiSettingRow | undefined;
  latest: KpiRow | undefined;
}) {
  if (!metricName || previousTarget === undefined) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-cyan-400/35 bg-cyan-950/30 p-4 text-sm text-cyan-50 md:flex-row md:items-center md:justify-between">
      <p>
        Recommended target applied to <span className="font-semibold text-white">{metricName}</span>. Previous target:{" "}
        <span className="font-semibold text-white">{previousTarget ? numberFormatter.format(Number(previousTarget)) : "No target"}</span>.
      </p>
      <div className="flex flex-wrap gap-2">
        <form action={updateKpiSettingAction}>
          <input type="hidden" name="return_path" value={kpiDetailReturnPath(metricName)} />
          <KpiSettingHiddenFields metricName={metricName} setting={setting} latest={latest} target={previousTarget} />
          <input type="hidden" name="target_change_context" value="undo" />
          <button className="min-h-10 rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
            Undo
          </button>
        </form>
        <Link href="/app/kpis/settings" className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">
          View target settings
        </Link>
      </div>
    </div>
  );
}

function KpiValueEditForm({
  row,
  metricName,
  settings,
  title = "Edit KPI value"
}: {
  row: KpiRow;
  metricName: string;
  settings: KpiSettingRow[];
  title?: string;
}) {
  return (
    <form action={updateKpiValueAction} className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/35 p-3 sm:grid-cols-2">
      <input type="hidden" name="return_path" value={kpiDetailReturnPath(metricName)} />
      <input type="hidden" name="kpi_id" value={row.id} />
      <div className="sm:col-span-2">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          Original imported references are preserved. Use this only when the visible KPI value, date, target, notes, or source label needs correction.
        </p>
      </div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Value
        <input
          name="actual_value"
          type="number"
          step="0.01"
          defaultValue={row.actual_value ?? ""}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Date
        <input
          name="metric_date"
          type="date"
          defaultValue={row.metric_date}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Row target
        <input
          name="target"
          type="number"
          step="0.01"
          defaultValue={row.target ?? ""}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Source label
        <input
          name="source"
          defaultValue={row.source ?? ""}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 sm:col-span-2">
        Notes
        <textarea
          name="notes"
          defaultValue={row.notes ?? ""}
          rows={3}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button className="min-h-10 rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
          Save value
        </button>
        <span className="text-xs text-slate-500">Current: {formatSettingValue(row.actual_value, row.name, settings)} · {row.metric_date}</span>
      </div>
    </form>
  );
}

function KpiChartSettingsForm({
  metricName,
  setting,
  latest
}: {
  metricName: string;
  setting: KpiSettingRow | undefined;
  latest: KpiRow | undefined;
}) {
  const selectedColor = setting?.color ?? "#10B981";
  const lowContrastColor = kpiColorMayBeLowContrast(selectedColor);

  return (
    <form action={updateKpiSettingAction} className="grid gap-3 rounded-lg border border-white/10 bg-slate-950/35 p-3 sm:grid-cols-2">
      <input type="hidden" name="return_path" value={kpiDetailReturnPath(metricName)} />
      <input type="hidden" name="kpi_name" value={metricName} />
      <input type="hidden" name="weight" value={setting?.weight ?? 1} />
      <input type="hidden" name="category" value={setting?.category ?? latest?.category ?? ""} />
      <input type="hidden" name="definition" value={setting?.definition ?? ""} />
      <input type="hidden" name="sort_order" value={setting?.sort_order ?? 0} />
      <input type="hidden" name="unit_type" value={setting?.unit_type ?? ""} />
      <input type="hidden" name="is_visible" value={(setting?.is_visible ?? true) ? "true" : "false"} />
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Target
        <input
          name="target"
          type="number"
          step="0.01"
          defaultValue={setting?.target ?? latest?.target ?? ""}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Display unit
        <input
          name="display_unit"
          defaultValue={setting?.display_unit ?? ""}
          placeholder="$, %, hours, units"
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        X-axis label
        <input
          name="x_axis_label"
          defaultValue={setting?.x_axis_label ?? "Date"}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Y-axis label
        <input
          name="y_axis_label"
          defaultValue={setting?.y_axis_label ?? metricName}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        />
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Value format
        <select
          name="value_format"
          defaultValue={setting?.value_format ?? ""}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        >
          <option value="">Standard number</option>
          <option value="currency">Currency</option>
          <option value="percentage">Percentage</option>
          <option value="duration">Duration</option>
          <option value="count">Count</option>
          <option value="decimal">Decimal</option>
        </select>
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        Preferred chart
        <select
          name="preferred_chart_type"
          defaultValue={setting?.preferred_chart_type ?? "line"}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        >
          <option value="line">Line</option>
          <option value="bar">Bar</option>
          <option value="mixed">Mixed</option>
        </select>
      </label>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 sm:col-span-2">
        Color
        <select
          name="color"
          defaultValue={selectedColor}
          className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
        >
          {KPI_COLOR_PALETTE.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} ({option.value})
            </option>
          ))}
        </select>
      </label>
      {lowContrastColor ? (
        <p className="rounded-lg border border-amber-400/35 bg-amber-950/30 p-3 text-xs leading-5 text-amber-100 sm:col-span-2">
          This color may be difficult to see in the current theme.
        </p>
      ) : null}
      <div className="sm:col-span-2">
        <button className="min-h-10 rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
          Save chart settings
        </button>
      </div>
    </form>
  );
}

function AlertRuleList({ rules }: { rules: KpiAlertRuleRow[] }) {
  if (!rules.length) {
    return <p className="rounded-lg border border-dashed border-white/15 bg-slate-950/35 p-3 text-sm text-slate-300">No KPI alert rules yet.</p>;
  }

  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
      <h4 className="text-sm font-semibold text-white">Active alert rules</h4>
      <div className="mt-3 space-y-2">
        {rules.slice(0, 8).map((rule) => (
          <div key={rule.id} className="grid gap-2 rounded-lg border border-white/10 bg-[#08111f] p-3 text-sm text-slate-300 md:grid-cols-[1fr_auto_auto]">
            <span className="font-medium">{rule.kpi_name}</span>
            <span className="text-slate-400 capitalize">{rule.condition_type.replace(/_/g, " ")}</span>
            <span className="text-slate-400">
              {rule.recipient_scope === "role" ? rule.role : rule.recipient_scope === "department" ? rule.department : rule.recipient_scope}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function KpisPage({ searchParams }: KpisPageProps) {
  const params = await searchParams;
  const { supabase, context, workspaceId } = await requireWorkspacePage();
  const today = new Date().toISOString().slice(0, 10);

  const [
    kpiResult,
    completedTasksResult,
    openTasksResult,
    folderResult,
    peopleResult,
    alertRulesResult,
    shareResult,
    taskResult,
    issueResult,
    checklistRunResult,
    crmResult,
    fileResult,
    reportResult,
    notificationResult,
    kpiSettingsResult
  ] = await Promise.all([
    supabase
      .from("kpis")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("metric_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "Done"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "Done"),
    getRecordFolders(supabase, workspaceId, "kpis"),
    supabase.from("people").select("id,full_name,role_title,department").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name"),
    supabase.from("kpi_alert_rules").select("*").eq("workspace_id", workspaceId).eq("is_active", true).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("record_shares").select("*").eq("workspace_id", workspaceId).eq("source_type", "kpi").is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(20),
    supabase.from("notifications").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(50),
    supabase.from("kpi_settings").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true }).order("weight", { ascending: false })
  ]);

  const rawKpis = (kpiResult.data || []) as KpiRow[];
  const sourceFiles = (fileResult.data || []) as FileUploadRow[];
  const kpiSettings = (kpiSettingsResult.data || []) as KpiSettingRow[];
  const adjustedKpis = sortKpiRowsBySettings(applyKpiSettingsToRows(rawKpis, kpiSettings), kpiSettings) as KpiRow[];
  const timeline = isKpiTimeline(params?.timeline) ? params.timeline : "90D";
  const selectedTimelineRange = timelineRange(timeline, adjustedKpis.length ? adjustedKpis : rawKpis, params?.start, params?.end);
  const activeStatusFilter = isKpiStatusFilter(params?.status) ? params.status : "all";
  const showAllTiles = params?.show === "all";
  const kpis = filterKpisByTimeline(adjustedKpis, selectedTimelineRange);
  const allVisibleKpis = adjustedKpis;
  const people = (peopleResult.data || []) as TeamPersonOption[];
  const alertRules = (alertRulesResult.data || []) as KpiAlertRuleRow[];
  const shares = (shareResult.data || []) as ShareRow[];
  const revenue = findLatestMetric(kpis, ["revenue", "sales"]);
  const leads = findLatestMetric(kpis, ["lead"]);
  const conversionRate = findLatestMetric(kpis, ["conversion"]);
  const completedTasks = completedTasksResult.count || 0;
  const openTasks = openTasksResult.count || 0;
  const intelligence = buildPrestigeIntelligence({
    workspaceName: context.activeWorkspace?.name || "Vaeroex workspace",
    isDemoWorkspace: false,
    periodLabel: "KPIs",
    range: { startDate: today, endDate: today, previousStartDate: today, previousEndDate: today },
    kpis,
    tasks: taskResult.data || [],
    issues: issueResult.data || [],
    assets: [],
    checklists: [],
    checklistRuns: checklistRunResult.data || [],
    sops: [],
    files: fileResult.data || [],
    imports: [],
    crmLeads: crmResult.data || [],
    reports: reportResult.data || [],
    vaeroexRuns: [],
    operationalMetrics: [],
    notifications: notificationResult.data || [],
    assignments: [],
    shares,
    people: [],
    decisions: [],
    recommendationOutcomes: []
  });

  const metricNames = getConfiguredMetricNames(allVisibleKpis, kpiSettings);
  const latestKpiRows = latestRowsByMetric(allVisibleKpis, metricNames);
  const behindTargetCount = latestKpiRows.filter((kpi) => metricTone(kpi.actual_value, kpi.target) === "red").length;
  const nearTargetCount = latestKpiRows.filter((kpi) => metricTone(kpi.actual_value, kpi.target) === "yellow").length;
  const onTrackCount = latestKpiRows.filter((kpi) => metricTone(kpi.actual_value, kpi.target) === "green").length;
  const missingDataCount = metricNames.length - latestKpiRows.filter((kpi) => kpi.actual_value !== null).length;
  const updatedThisMonthCount = latestKpiRows.filter(updatedThisMonth).length;
  const filteredLatestKpiRows = latestKpiRows.filter((kpi) => matchesStatusFilter(kpi, activeStatusFilter));
  const filteredMetricNames = new Set(filteredLatestKpiRows.map((kpi) => kpi.name));
  const filteredKpis = activeStatusFilter === "all" ? kpis : kpis.filter((kpi) => filteredMetricNames.has(kpi.name));
  const visibleTileRows = showAllTiles ? filteredLatestKpiRows : filteredLatestKpiRows.slice(0, 6);
  const hiddenTileCount = Math.max(0, filteredLatestKpiRows.length - visibleTileRows.length);
  const filterCount = activeStatusFilter === "all" ? metricNames.length : filteredLatestKpiRows.length;
  const topAttentionKpi = latestKpiRows.find((kpi) => metricTone(kpi.actual_value, kpi.target) === "red") || latestKpiRows.find((kpi) => metricTone(kpi.actual_value, kpi.target) === "yellow") || latestKpiRows[0];
  const kpiSummary =
    latestKpiRows.length === 0
      ? "Create your first KPI manually or import reviewed spreadsheet data to start the measurement layer."
      : behindTargetCount
        ? `${behindTargetCount} KPI${behindTargetCount === 1 ? "" : "s"} are behind target. Vaeroex recommends reviewing the evidence before changing targets.`
        : nearTargetCount
          ? `${nearTargetCount} KPI${nearTargetCount === 1 ? "" : "s"} are near target. Watch trend direction before taking corrective action.`
          : "Visible KPIs are currently on track or waiting for more history. Continue adding dated values so trends become more reliable.";
  const selectedMetrics = getSelectedMetrics(params?.metric, metricNames);
  const primaryMetric = selectedMetrics[0] || "";
  const selectedTrends = buildTrends(kpis, selectedMetrics, kpiSettings);
  const hasComparison = selectedMetrics.length > 1;
  const comparisonMode = isComparisonMode(params?.mode) ? params.mode : defaultComparisonMode(selectedTrends);
  const selectedComparisonContext = comparisonContext({
    trends: selectedTrends,
    range: selectedTimelineRange,
    dataQualityScore: intelligence.dataQuality.score,
    memoryCount: intelligence.memoryTimeline.length
  });
  const activeSection =
    params?.section === "compare" || params?.metric === "compare"
      ? "compare"
      : params?.section === "records" || params?.sort
        ? "records"
        : params?.section === "detail"
          ? "detail"
          : "overview";
  const selectedMetricRows = primaryMetric ? getMetricHistoryRows(allVisibleKpis, primaryMetric) : [];
  const selectedMetricActualValues = selectedMetricRows.map((row) => row.actual_value).filter((value): value is number => value !== null);
  const selectedLatestKpi = selectedMetricRows.at(-1);
  const selectedSourceFile = selectedLatestKpi?.source_file_id ? sourceFiles.find((file) => file.id === selectedLatestKpi.source_file_id) : null;
  const selectedKpiSetting = primaryMetric ? kpiSettingForName(kpiSettings, primaryMetric) : undefined;
  const selectedRecommendation = primaryMetric ? recommendedTargetForMetric(primaryMetric, allVisibleKpis) : null;
  const undoMetricName = params?.target_applied === "true" ? params.undo_kpi : undefined;
  const undoSetting = undoMetricName ? kpiSettingForName(kpiSettings, undoMetricName) : undefined;
  const undoLatestKpi = undoMetricName ? getMetricHistoryRows(allVisibleKpis, undoMetricName).at(-1) : undefined;
  const managedKpis = filteredKpis.map((kpi) => {
    const management = managedValues(kpi);
    const tone = metricTone(kpi.actual_value, kpi.target);
    const kpiShares = shares.filter((share) => share.source_id === kpi.id);
    const matchingAlertRules = alertRules.filter((rule) => rule.kpi_name === kpi.name);

    return {
      id: kpi.id,
      title: kpi.name,
      type: "KPI",
      status: statusLabel(tone),
      owner: kpi.owner || "Unassigned",
      category: kpi.category || "General",
      createdAt: kpi.created_at,
      updatedAt: management.updatedAt || kpi.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(kpi.notes, `${formatNumericValue(kpi.actual_value, kpi.name)} recorded for ${kpi.metric_date}.`),
      meta: [
        { label: "Date", value: kpi.metric_date },
        { label: "Actual", value: formatNumericValue(kpi.actual_value, kpi.name) },
        { label: "Target", value: kpi.target === null ? "No target" : formatNumericValue(kpi.target, kpi.name) },
        { label: "Source", value: kpi.source || "Manual" },
        { label: "Shares", value: kpiShares.length ? `${kpiShares.length} share record${kpiShares.length === 1 ? "" : "s"}` : "Not shared" },
        { label: "Alert rules", value: matchingAlertRules.length ? matchingAlertRules.length : "None" }
      ],
      editFields: kpiEditFields,
      editValues: {
        name: kpi.name,
        category: kpi.category,
        owner: kpi.owner,
        source: kpi.source,
        notes: kpi.notes
      },
      children: (
        <div className="space-y-4 text-sm leading-6 text-muted">
          <p>{kpi.notes || "No notes."}</p>
          <p>
            <span className="font-semibold text-ink">Current status:</span> {statusLabel(tone)}
          </p>
          <ShareRecordPanel
            sourceType="kpi"
            sourceId={kpi.id}
            sourceTitle={kpi.name}
            relatedModule="KPIs"
            returnPath="/app/kpis"
            actionHref="/app/kpis"
            people={people}
          />
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Measurement Layer"
        title="KPIs"
        description="Track the numbers that shape Vaeroex intelligence."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/app/kpis?section=records#add-kpi" className="min-h-10 rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
              Add KPI
            </Link>
            <Link href="/app/files?status=Import%20Ready" className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">
              Import KPI Data
            </Link>
            <GlobalSearchTrigger initialQuery="How are my KPIs doing?" className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">
              Search or Ask
            </GlobalSearchTrigger>
          </div>
        }
      />
      <ModuleTabs
        tabs={[
          { label: "Overview", href: kpiHref({ ...timelineQueryParams(timeline, selectedTimelineRange), status: activeStatusFilter }), active: activeSection === "overview" || activeSection === "detail" },
          { label: "Compare", href: "/app/kpis?section=compare" as Route, active: activeSection === "compare" },
          { label: "Records", href: kpiHref({ ...timelineQueryParams(timeline, selectedTimelineRange), status: activeStatusFilter, section: "records" }), active: activeSection === "records" },
          { label: "Imports", href: "/app/files?status=Imported" as Route },
          { label: "Settings", href: "/app/kpis/settings" as Route }
        ]}
      />

      <ErrorNotice
        message={
          params?.error ||
          kpiResult.error?.message ||
          completedTasksResult.error?.message ||
          openTasksResult.error?.message ||
    folderResult.error?.message ||
    peopleResult.error?.message ||
    alertRulesResult.error?.message ||
    shareResult.error?.message ||
          taskResult.error?.message ||
          issueResult.error?.message ||
          checklistRunResult.error?.message ||
    crmResult.error?.message ||
    fileResult.error?.message ||
    reportResult.error?.message ||
    notificationResult.error?.message ||
    kpiSettingsResult.error?.message
        }
      />
      <SuccessNotice message={params?.message} />
      <TargetUndoNotice
        metricName={undoMetricName}
        previousTarget={params?.undo_target}
        setting={undoSetting}
        latest={undoLatestKpi}
      />

      {activeSection === "overview" || activeSection === "detail" ? (
        <>
          <TimelineControls timeline={timeline} range={selectedTimelineRange} status={activeStatusFilter} />

          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatusFilterCard
              label="Total KPIs"
              value={metricNames.length}
              detail="Show all visible KPIs"
              tone={metricNames.length ? "green" : "yellow"}
              active={activeStatusFilter === "all"}
              href={kpiHref({ ...timelineQueryParams(timeline, selectedTimelineRange), status: "all" })}
            />
            <StatusFilterCard
              label="On Track"
              value={onTrackCount}
              detail="Latest value meets target"
              tone={onTrackCount ? "green" : "neutral"}
              active={activeStatusFilter === "on-track"}
              href={kpiHref({ ...timelineQueryParams(timeline, selectedTimelineRange), status: "on-track" })}
            />
            <StatusFilterCard
              label="Behind Target"
              value={behindTargetCount}
              detail="Needs management review"
              tone={behindTargetCount ? "red" : "green"}
              active={activeStatusFilter === "behind-target"}
              href={kpiHref({ ...timelineQueryParams(timeline, selectedTimelineRange), status: "behind-target" })}
            />
            <StatusFilterCard
              label="Missing Data"
              value={missingDataCount}
              detail="Needs a current value"
              tone={missingDataCount ? "yellow" : "green"}
              active={activeStatusFilter === "missing-data"}
              href={kpiHref({ ...timelineQueryParams(timeline, selectedTimelineRange), status: "missing-data" })}
            />
            <StatusFilterCard
              label="Updated This Month"
              value={updatedThisMonthCount}
              detail="Fresh KPI signals"
              tone={updatedThisMonthCount ? "green" : "yellow"}
              active={activeStatusFilter === "updated-this-month"}
              href={kpiHref({ ...timelineQueryParams(timeline, selectedTimelineRange), status: "updated-this-month" })}
            />
          </section>

          <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-[#08111f] px-4 py-3 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing <span className="font-semibold text-white">{filterCount}</span> {statusFilterLabel(activeStatusFilter)} KPI{filterCount === 1 ? "" : "s"}.
            </p>
            {activeStatusFilter !== "all" ? (
              <Link href={kpiHref({ ...timelineQueryParams(timeline, selectedTimelineRange), status: "all" })} className="w-fit text-xs font-semibold text-vaeroex-accent underline underline-offset-4">
                Clear filter
              </Link>
            ) : null}
          </div>

          {filteredLatestKpiRows.length ? (
            <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {visibleTileRows.map((kpi, index) => (
                <KpiTile
                  key={kpi.id}
                  kpi={kpi}
                  rows={getMetricHistoryRows(allVisibleKpis, kpi.name)}
                  settings={kpiSettings}
                  color={kpiColor(kpi.name, kpiSettings, index)}
                  index={index}
                />
              ))}
            </section>
          ) : (
            <EmptyState title="No KPIs match this filter" description="Clear the filter, create a KPI manually, or import reviewed CSV/XLSX data to continue building the measurement layer." />
          )}

          {hiddenTileCount ? (
            <div className="flex justify-center">
              <Link
                href={kpiHref({ ...timelineQueryParams(timeline, selectedTimelineRange), status: activeStatusFilter, show: "all" })}
                className="rounded-lg border border-white/10 px-4 py-2 text-sm font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent"
              >
                Show all {filteredLatestKpiRows.length} KPIs
              </Link>
            </div>
          ) : null}

          <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">Vaeroex KPI Summary</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">{kpiSummary}</p>
            <div className="mt-4 grid gap-3 text-sm leading-6 text-slate-300 md:grid-cols-[1fr_auto] md:items-center">
              <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
                <p className="font-semibold text-white">Top KPI needing attention</p>
                <p className="mt-1">{topAttentionKpi ? `${topAttentionKpi.name}: ${statusLabel(metricTone(topAttentionKpi.actual_value, topAttentionKpi.target))}` : "No KPI has enough data yet."}</p>
              </div>
              <Link href="/app/kpis?section=compare" className="w-fit rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">
                Compare multiple KPIs
              </Link>
            </div>
            <div className="mt-4">
              <ContextualAskVaeroex
                label="Explain These KPIs"
                prompt="Explain what these KPI trends mean, which metric most needs attention, the supporting values, and any meaningful uncertainty."
                contextType="kpi_summary"
                contextId={topAttentionKpi?.id || "kpi-summary"}
                sourceTitle="KPI summary"
                sourceSummary={kpiSummary}
                evidence={[
                  `${onTrackCount} on track`,
                  `${behindTargetCount} behind target`,
                  `${missingDataCount} missing data`,
                  `${updatedThisMonthCount} updated this month`,
                  topAttentionKpi ? `Top attention KPI: ${topAttentionKpi.name}` : "No top attention KPI yet"
                ]}
                compact
                defaultCollapsed={false}
              />
            </div>
          </section>

          {activeSection === "detail" && primaryMetric ? (
            <section id="kpi-detail" className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
              <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">KPI Detail</p>
                    <h2 className="mt-2 text-xl font-semibold text-white">{primaryMetric}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{kpiDefinition(primaryMetric, kpiSettings) || "No definition set yet."}</p>
                  </div>
                  <KpiStatusBadge tone={metricTone(selectedLatestKpi?.actual_value ?? null, selectedLatestKpi?.target ?? null)} />
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <TrendSummaryCard
                    label="Current"
                    value={formatSettingValue(selectedLatestKpi?.actual_value, primaryMetric, kpiSettings)}
                    detail={selectedLatestKpi ? `Recorded ${formatShortDate(selectedLatestKpi.metric_date)}` : "No value yet"}
                  />
                  <TrendSummaryCard
                    label="Target"
                    value={formatSettingValue(selectedLatestKpi?.target ?? selectedKpiSetting?.target, primaryMetric, kpiSettings)}
                    detail={selectedLatestKpi?.target !== null && selectedLatestKpi?.target !== undefined ? "Current target setting" : selectedKpiSetting?.target !== null && selectedKpiSetting?.target !== undefined ? "Current target setting" : "No target set"}
                  />
                  <TrendSummaryCard
                    label="Trend"
                    value={trendLabelForRows(selectedMetricRows)}
                    detail="Latest movement from history"
                  />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <TrendSummaryCard
                    label="Average"
                    value={formatNumericValue(average(selectedMetricActualValues), primaryMetric, "Not enough data")}
                    detail={`Across ${selectedMetricActualValues.length} recorded value${selectedMetricActualValues.length === 1 ? "" : "s"}`}
                  />
                  <TrendSummaryCard
                    label="Target Hit Rate"
                    value={targetHitRate(selectedMetricRows)}
                    detail="Share of history at or above target"
                  />
                  <TrendSummaryCard
                    label="Records"
                    value={String(selectedMetricRows.length)}
                    detail="Historical KPI values stored"
                  />
                </div>
                <div className="mt-4">
                  <TrendChart rows={selectedMetricRows.slice(-12)} metricName={primaryMetric} settings={kpiSettings} />
                </div>
                <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/35 p-4">
                  <p className="text-sm font-semibold text-white">Vaeroex summary</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    {selectedLatestKpi
                      ? `${primaryMetric} is ${statusLabel(metricTone(selectedLatestKpi.actual_value, selectedLatestKpi.target)).toLowerCase()} at ${formatSettingValue(selectedLatestKpi.actual_value, primaryMetric, kpiSettings)}. ${selectedMetricRows.length < 4 ? "More history will make recommendations more reliable." : "History is sufficient for a useful management review."}`
                      : "Add a current value to unlock status, trend, and target guidance."}
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {selectedRecommendation ? (
                  <KpiTargetRecommendationPanel
                    metricName={primaryMetric}
                    recommendation={selectedRecommendation}
                    setting={selectedKpiSetting}
                    latest={selectedLatestKpi}
                  />
                ) : null}
                {selectedLatestKpi ? (
                  <details className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-sm text-slate-300 shadow-panel">
                    <summary className="cursor-pointer font-semibold text-white">Edit latest value</summary>
                    <div className="mt-3">
                      <KpiValueEditForm row={selectedLatestKpi} metricName={primaryMetric} settings={kpiSettings} title="Edit latest value" />
                    </div>
                  </details>
                ) : null}
                <details className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-sm text-slate-300 shadow-panel">
                  <summary className="cursor-pointer font-semibold text-white">Evidence and history</summary>
                  <div className="mt-3 space-y-3">
                    {selectedMetricRows.slice(-10).reverse().map((row) => (
                      <details key={row.id} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
                        <summary className="cursor-pointer">
                          <span className="font-semibold text-white">{formatSettingValue(row.actual_value, row.name, kpiSettings)} · {row.metric_date}</span>
                          <span className="mt-1 block text-xs leading-5 text-slate-400">{row.source || "Manual"}{row.notes ? ` · ${row.notes}` : ""}</span>
                        </summary>
                        <div className="mt-3">
                          <KpiValueEditForm row={row} metricName={primaryMetric} settings={kpiSettings} title="Edit historical value" />
                        </div>
                      </details>
                    ))}
                    {!selectedMetricRows.length ? <p>No history records yet.</p> : null}
                  </div>
                </details>
                <details className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-sm text-slate-300 shadow-panel">
                  <summary className="cursor-pointer font-semibold text-white">Chart settings</summary>
                  <div className="mt-3">
                    <KpiChartSettingsForm metricName={primaryMetric} setting={selectedKpiSetting} latest={selectedLatestKpi} />
                  </div>
                </details>
                <details className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-sm text-slate-300 shadow-panel">
                  <summary className="cursor-pointer font-semibold text-white">Source/import information</summary>
                  <div className="mt-3 space-y-2 text-xs leading-5 text-slate-400">
                    <p>Latest source: {selectedLatestKpi?.source || "Manual or not provided"}</p>
                    <div>
                      Source file:{" "}
                      {selectedSourceFile ? (
                        <Link href={`/app/sources?file=${selectedSourceFile.id}#file-${selectedSourceFile.id}` as Route} className="font-semibold text-cyan-100 underline underline-offset-4 hover:text-white">
                          {selectedSourceFile.display_name}
                        </Link>
                      ) : selectedLatestKpi?.source_file_id ? (
                        <span>{selectedLatestKpi.source_file_id}</span>
                      ) : (
                        <span>None</span>
                      )}
                    </div>
                    <p>Import ID: {selectedLatestKpi?.import_id || "None"}</p>
                    <p>Import row: {selectedLatestKpi?.import_row_id || "None"}</p>
                  </div>
                </details>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      {activeSection === "compare" ? (
        <section id="trend-analysis" className="space-y-5">
          {metricNames.length ? (
            <>
              <div className="space-y-5 rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Compare KPIs</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      Preset ranges update the chart immediately. Use Custom Range only when you need exact dates.
                    </p>
                  </div>
                  <span className="w-fit rounded-full border border-cyan-400/25 bg-cyan-950/30 px-3 py-1 text-xs font-semibold text-cyan-100">
                    Applied: {selectedComparisonContext.timeframe}
                  </span>
                </div>

                <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Date Range</p>
                      <p className="mt-1 text-sm font-semibold text-white">{selectedComparisonContext.timeframe}</p>
                    </div>
                    <p className="text-xs leading-5 text-slate-400">Preset changes apply immediately.</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {KPI_TIMELINES.filter((item) => item !== "Custom Range").map((item) => (
                      <Link
                        key={item}
                        href={compareHref({ timeline: item, range: selectedTimelineRange, metrics: selectedMetrics, mode: comparisonMode })}
                        aria-current={item === timeline ? "true" : undefined}
                        className={`min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                          item === timeline
                            ? "border-vaeroex-blue bg-vaeroex-blue text-white shadow-panel ring-1 ring-vaeroex-accent/35"
                            : "border-white/10 bg-slate-950/50 text-slate-200 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent"
                        }`}
                      >
                        {item}
                      </Link>
                    ))}
                    <span
                      className={`min-h-10 rounded-lg border px-3 py-2 text-xs font-semibold ${
                        timeline === "Custom Range"
                          ? "border-vaeroex-blue bg-vaeroex-blue text-white shadow-panel ring-1 ring-vaeroex-accent/35"
                          : "border-white/10 bg-slate-950/50 text-slate-300"
                      }`}
                    >
                      Custom Range
                    </span>
                  </div>
                  <form method="get" className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                    <input type="hidden" name="section" value="compare" />
                    <input type="hidden" name="timeline" value="Custom Range" />
                    <input type="hidden" name="mode" value={comparisonMode} />
                    {selectedMetrics.map((metric) => (
                      <input key={metric} type="hidden" name="metric" value={metric} />
                    ))}
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Custom start
                      <input
                        name="start"
                        type="date"
                        defaultValue={selectedTimelineRange.startDate}
                        className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
                      />
                    </label>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Custom end
                      <input
                        name="end"
                        type="date"
                        defaultValue={selectedTimelineRange.endDate}
                        className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm normal-case tracking-normal text-slate-100 outline-none focus:border-vaeroex-accent"
                      />
                    </label>
                    <PrimaryButton>Apply custom range</PrimaryButton>
                  </form>
                </div>

                <form method="get" className="space-y-5">
                  <input type="hidden" name="section" value="compare" />
                  <input type="hidden" name="timeline" value={timeline} />
                  {timeline === "Custom Range" ? (
                    <>
                      <input type="hidden" name="start" value={selectedTimelineRange.startDate} />
                      <input type="hidden" name="end" value={selectedTimelineRange.endDate} />
                    </>
                  ) : null}
                  <div>
                    <p className="text-sm font-semibold text-white">Select KPIs</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      Choose two or more KPI lines to compare. Overview stays focused on one KPI at a time.
                    </p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {metricNames.map((metric, index) => (
                      <label key={metric} className="flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/30">
                        <input
                          name="metric"
                          type="checkbox"
                          value={metric}
                          defaultChecked={selectedMetrics.includes(metric)}
                          className="h-4 w-4 rounded border-white/20 text-vaeroex-blue"
                        />
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: kpiColor(metric, kpiSettings, index) }} />
                        <span className="min-w-0 flex-1 truncate">{metric}</span>
                        <span className="text-xs text-slate-400">W {numberFormatter.format(kpiWeight(metric, kpiSettings))}</span>
                      </label>
                    ))}
                  </div>

                  <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-end">
                    <fieldset>
                      <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">Compare Mode</legend>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        {[
                          ["actual", "Actual"],
                          ["normalized", "Normalized"],
                          ["percent", "Percent Change"]
                        ].map(([value, label]) => (
                          <label key={value} className="flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-slate-950/45 px-3 py-2 text-sm text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/30">
                            <input
                              name="mode"
                              type="radio"
                              value={value}
                              defaultChecked={comparisonMode === value}
                              className="h-4 w-4 rounded border-white/20 text-vaeroex-blue"
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </fieldset>

                    <div className="flex flex-col gap-2">
                      <PrimaryButton>Update KPIs & Mode</PrimaryButton>
                      <p className="max-w-xs text-xs leading-5 text-slate-400">Applied range stays {selectedTimelineRange.label} unless you choose a preset or apply a custom range.</p>
                    </div>
                  </div>
                </form>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-white">KPI comparison</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    {hasComparison
                      ? `Comparing ${selectedMetrics.join(", ")} across ${selectedTimelineRange.label.toLowerCase()}.`
                      : "Select at least two KPIs to compare trend lines."}
                  </p>
                </div>
                <ComparisonAnalysis trends={selectedTrends} mode={comparisonMode} context={selectedComparisonContext} />
              </div>
            </>
          ) : (
            <EmptyState title="No trend data yet" description="Create KPI records over time to unlock charts and trend summaries." />
          )}
        </section>
      ) : null}

      {activeSection === "records" ? (
        <section className="space-y-4">
          <div id="add-kpi">
            <CreateDrawer title="Create KPI" description="Use one metric per row so trends stay easy to review." triggerLabel="New KPI">
              <form action={createKpiAction} className="grid gap-4 lg:grid-cols-2">
                <TextInput label="Name" name="name" placeholder="Revenue, Conversion Rate, Response Time" required />
                <TextInput label="Category" name="category" placeholder="Sales, Operations, Finance" />
                <TextInput label="Target" name="target" type="number" step="0.01" />
                <TextInput label="Actual Value" name="actual_value" type="number" step="0.01" />
                <TextInput label="Date" name="metric_date" type="date" defaultValue={today} />
                <TextInput label="Owner" name="owner" placeholder="Manager or department" />
                <TextInput label="Source" name="source" placeholder="POS, source system, spreadsheet, manual" />
                <div className="lg:col-span-2">
                  <TextArea label="Notes" name="notes" rows={4} />
                </div>
                <div className="lg:col-span-2">
                  <PrimaryButton>Save KPI</PrimaryButton>
                </div>
              </form>
            </CreateDrawer>
          </div>

          <ManagedRecordList
            collection="kpis"
            records={managedKpis}
            folders={folderResult.folders}
            title="KPI records"
            description="Search, filter, group, edit, archive, duplicate, or bulk-manage KPI rows."
            emptyTitle="No KPIs yet"
            emptyDescription="Create your first KPI for revenue, conversion rate, response time, customer activity, or any custom metric leadership reviews."
            searchParams={params}
          />

          <KpiDetailPanel
            title="Alerts and ownership"
            summary={`${alertRules.length} KPI alert rule${alertRules.length === 1 ? "" : "s"} configured. Expand to add alert rules or review active thresholds.`}
          >
            <section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
              <KpiAlertRulePanel kpiNames={metricNames} people={people} />
              <AlertRuleList rules={alertRules} />
            </section>
          </KpiDetailPanel>

          <KpiDetailPanel
            title="Benchmarks and data quality"
            summary={`Data Quality Score: ${intelligence.dataQuality.score}/100. ${intelligence.dataQuality.gaps.length} gap${intelligence.dataQuality.gaps.length === 1 ? "" : "s"} need review.`}
          >
            <section className="grid gap-4 xl:grid-cols-2">
              <SectionCard title="Benchmark comparisons" description="Vaeroex compares this workspace against default operating standards, not anonymous customer data.">
                <div className="grid gap-3 md:grid-cols-2">
                  {intelligence.benchmarkMode.map((item) => (
                    <article key={item.title} className="rounded-lg border border-white/10 bg-slate-950/35 p-4 text-slate-100">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-white">{item.title}</p>
                        <KpiStatusBadge tone={item.status === "On track" ? "green" : item.status === "Needs attention" ? "yellow" : "neutral"} />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-300">{item.evidence}</p>
                      <p className="mt-2 text-xs leading-5 text-slate-400">{item.recommendedAction}</p>
                    </article>
                  ))}
                </div>
              </SectionCard>
              <SectionCard title="KPI risk and data quality" description={`Data Quality Score: ${intelligence.dataQuality.score}/100.`}>
                <div className="space-y-3">
                  {intelligence.dataQuality.gaps.slice(0, 6).map((gap) => (
                    <Link key={gap.id} href={gap.href} className="block rounded-lg border border-white/10 bg-slate-950/35 p-3 text-sm text-slate-300">
                      <span className="font-semibold text-white">{gap.title}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-400">{gap.why}</span>
                    </Link>
                  ))}
                  {!intelligence.dataQuality.gaps.length ? <p className="text-sm leading-6 text-slate-300">No major KPI data gaps found.</p> : null}
                </div>
              </SectionCard>
            </section>
          </KpiDetailPanel>
        </section>
      ) : null}

    </div>
  );
}
