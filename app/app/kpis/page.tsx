import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { createKpiAction, updateKpiSettingAction } from "@/app/app/operations/actions";
import { KpiAlertRulePanel, ShareRecordPanel, type TeamPersonOption } from "@/components/accountability/AccountabilityForms";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { ModuleTabs } from "@/components/operations/ModuleTabs";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { buildPrestigeIntelligence } from "@/lib/intelligence/prestige";
import {
  applyKpiSettingsToRows,
  getConfiguredMetricNames,
  kpiColor,
  kpiDefinition,
  kpiDisplayUnit,
  kpiPreferredChartType,
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
    start?: string;
    end?: string;
  }>;
};

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type KpiAlertRuleRow = Database["public"]["Tables"]["kpi_alert_rules"]["Row"];
type ShareRow = Database["public"]["Tables"]["record_shares"]["Row"];
type KpiTone = "green" | "yellow" | "red" | "neutral";
type ComparisonMode = "actual" | "percent" | "normalized";
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
  range
}: {
  timeline: KpiTimeline;
  range: { label: string; startDate: string; endDate: string };
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-white">Timeline</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            {range.label}: {range.startDate} to {range.endDate}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {KPI_TIMELINES.map((item) => (
            <Link
              key={item}
              href={timelineHref(item)}
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
      </div>
      <form method="get" className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <input type="hidden" name="timeline" value="Custom Range" />
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
    </section>
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
  const recommendation = recommendedTargetForMetric(kpi.name, rows);
  const href = `/app/kpis?metric=${encodeURIComponent(kpi.name)}&section=detail#kpi-detail` as Route;

  return (
    <article className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <h2 className="truncate text-sm font-semibold text-white">{kpi.name}</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{kpi.category || "General"} · {kpi.owner || "Unassigned"}</p>
        </div>
        <KpiStatusBadge tone={tone} />
      </div>
      <p className="mt-4 text-3xl font-semibold text-white">{formatSettingValue(kpi.actual_value, kpi.name, settings)}</p>
      <div className="mt-3 grid gap-2 text-xs leading-5 text-slate-300 sm:grid-cols-2">
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
        <p>
          <span className="block text-slate-500">Target guidance</span>
          {recommendation.value === null ? "Needs history" : `${recommendation.confidence} confidence`}
        </p>
      </div>
      <Link href={href} className="mt-4 inline-flex min-h-10 items-center rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45">
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

function timelineHref(timeline: KpiTimeline) {
  return `/app/kpis?timeline=${encodeURIComponent(timeline)}` as Route;
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

function startOfWeek(date: Date) {
  const day = date.getUTCDay();
  return startOfDay(addDays(date, -((day + 6) % 7)));
}

function startOfMonth(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfQuarter(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1));
}

function comparisonRange(label: string, currentStart: Date, currentEnd: Date, previousStart: Date, previousEnd: Date) {
  return {
    label,
    currentStart: dateOnly(startOfDay(currentStart)),
    currentEnd: dateOnly(startOfDay(currentEnd)),
    previousStart: dateOnly(startOfDay(previousStart)),
    previousEnd: dateOnly(startOfDay(previousEnd))
  };
}

function periodComparisonRanges(today = new Date()) {
  const currentDay = startOfDay(today);
  const currentWeekStart = startOfWeek(currentDay);
  const currentMonthStart = startOfMonth(currentDay);
  const currentQuarterStart = startOfQuarter(currentDay);
  const currentYearStart = startOfYear(currentDay);
  const previousYearSameDay = new Date(Date.UTC(currentDay.getUTCFullYear() - 1, currentDay.getUTCMonth(), currentDay.getUTCDate()));

  return [
    comparisonRange("Day over Day", currentDay, currentDay, addDays(currentDay, -1), addDays(currentDay, -1)),
    comparisonRange("Week over Week", currentWeekStart, currentDay, addDays(currentWeekStart, -7), addDays(currentDay, -7)),
    comparisonRange("Month over Month", currentMonthStart, currentDay, new Date(Date.UTC(currentDay.getUTCFullYear(), currentDay.getUTCMonth() - 1, 1)), new Date(Date.UTC(currentDay.getUTCFullYear(), currentDay.getUTCMonth() - 1, currentDay.getUTCDate()))),
    comparisonRange("Quarter over Quarter", currentQuarterStart, currentDay, new Date(Date.UTC(currentQuarterStart.getUTCFullYear(), currentQuarterStart.getUTCMonth() - 3, 1)), new Date(Date.UTC(currentDay.getUTCFullYear(), currentDay.getUTCMonth() - 3, currentDay.getUTCDate()))),
    comparisonRange("Year over Year", currentYearStart, currentDay, startOfYear(previousYearSameDay), previousYearSameDay),
    comparisonRange("Year to Date", currentYearStart, currentDay, startOfYear(previousYearSameDay), previousYearSameDay)
  ];
}

function aggregateRows(rows: KpiRow[], metricName: string, startDate: string, endDate: string) {
  const values = rows
    .filter((row) => row.metric_date >= startDate && row.metric_date <= endDate && row.actual_value !== null)
    .map((row) => row.actual_value as number);

  if (!values.length) {
    return null;
  }

  const label = lower(metricName);
  const total = values.reduce((sum, value) => sum + value, 0);

  if (label.includes("rate") || label.includes("conversion") || label.includes("utilization")) {
    return total / values.length;
  }

  return total;
}

function comparisonRows(rows: KpiRow[], metricName: string) {
  return periodComparisonRanges().map((range) => {
    const current = aggregateRows(rows, metricName, range.currentStart, range.currentEnd);
    const previous = aggregateRows(rows, metricName, range.previousStart, range.previousEnd);
    const change = current !== null && previous !== null ? current - previous : null;
    const changePercent = change !== null && previous !== null && previous !== 0 ? (change / Math.abs(previous)) * 100 : null;

    return {
      ...range,
      current,
      previous,
      change,
      changePercent
    };
  });
}

function PeriodComparisonTable({ rows, metricName }: { rows: KpiRow[]; metricName: string }) {
  const comparisons = comparisonRows(rows, metricName);

  return (
    <div className="overflow-hidden rounded-lg border border-white/10 bg-slate-950/35">
      <div className="border-b border-white/10 px-4 py-3">
        <p className="text-sm font-semibold text-white">Period comparisons</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">Aggregated movement for this KPI across common management reporting windows.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3">Period</th>
              <th className="px-4 py-3">Current</th>
              <th className="px-4 py-3">Previous</th>
              <th className="px-4 py-3">Change</th>
            </tr>
          </thead>
          <tbody>
            {comparisons.map((item) => (
              <tr key={item.label} className="border-t border-white/10">
                <td className="px-4 py-3 font-medium text-white">{item.label}</td>
                <td className="px-4 py-3 text-slate-300">{formatNumericValue(item.current, metricName, "No data")}</td>
                <td className="px-4 py-3 text-slate-300">{formatNumericValue(item.previous, metricName, "No data")}</td>
                <td className="px-4 py-3 text-slate-300">
                  {item.change === null
                    ? "Needs history"
                    : `${item.change > 0 ? "+" : ""}${formatNumericValue(item.change, metricName)}${
                        item.changePercent === null ? "" : ` (${numberFormatter.format(item.changePercent)}%)`
                      }`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
          <polyline fill="none" points={actualPoints} stroke="#1E6BFF" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
          {chartRows.map((row, index) => (
            <circle key={row.id} cx={xFor(index)} cy={yFor(row.actual_value as number)} r="5" fill="#1E6BFF" stroke="#ffffff" strokeWidth="2" />
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
  const leads = usable.find((trend) => lower(trend.name).includes("lead"));
  const notes = [
    improving && improving.changePercent !== null
      ? `${improving.name} is improving fastest at ${numberFormatter.format(improving.changePercent)}% across the selected history.`
      : "No KPI has enough positive movement to identify a clear fastest improver.",
    declining && declining.changePercent !== null
      ? `${declining.name} is declining most at ${numberFormatter.format(Math.abs(declining.changePercent))}%.`
      : "No selected KPI is currently declining across its available history.",
    volatile && volatile.volatility !== null
      ? `${volatile.name} is the most volatile, with an average move of ${formatNumericValue(volatile.volatility, volatile.name)} between entries.`
      : "Volatility needs more dated values before it becomes useful."
  ];

  if (revenue && leads) {
    const revenueDirection = trendDirection(revenue);
    const leadsDirection = trendDirection(leads);

    if (leadsDirection === "up" && revenueDirection === "down") {
      notes.push("Leads are rising while revenue is falling, which may point to conversion, pricing, or follow-up issues.");
    } else if (leadsDirection === "down" && revenueDirection === "up") {
      notes.push("Revenue is rising while leads are falling, which may mean larger deals are offsetting a weaker pipeline.");
    } else if (leadsDirection === revenueDirection && leadsDirection !== "flat") {
      notes.push(`Leads and revenue are both moving ${leadsDirection}, which suggests pipeline volume and sales results are currently aligned.`);
    }
  }

  return notes;
}

function ComparisonAnalysis({ trends, mode }: { trends: KpiTrend[]; mode: ComparisonMode }) {
  const notes = comparisonNotes(trends);

  return (
    <div className="space-y-4">
      <OverlayTrendChart trends={trends} mode={mode} />
      <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
        <p className="text-sm font-semibold text-white">Comparison notes</p>
        <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
          {notes.map((note) => (
            <div key={note} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
              <p>{note}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
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
      <div className="rounded-lg border border-amber-400/35 bg-amber-950/25 p-4 text-sm leading-6 text-amber-100">
        <p className="font-semibold">Not enough history to recommend a reliable target.</p>
        <p className="mt-2">{recommendation.limitation}</p>
        <p className="mt-2">Suggested next data: upload 6-12 months of KPI history or prior monthly reports.</p>
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
          Confidence: {recommendation.confidence}
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
      <div className="mt-4 flex flex-wrap gap-2">
        <form action={updateKpiSettingAction}>
          <input type="hidden" name="return_path" value="/app/kpis" />
          <input type="hidden" name="kpi_name" value={metricName} />
          <input type="hidden" name="target" value={recommendation.value} />
          <input type="hidden" name="weight" value={setting?.weight ?? 1} />
          <input type="hidden" name="category" value={setting?.category ?? latest?.category ?? ""} />
          <input type="hidden" name="definition" value={setting?.definition ?? ""} />
          <input type="hidden" name="color" value={setting?.color ?? "#1E6BFF"} />
          <input type="hidden" name="sort_order" value={setting?.sort_order ?? 0} />
          <input type="hidden" name="unit_type" value={setting?.unit_type ?? ""} />
          <input type="hidden" name="display_unit" value={setting?.display_unit ?? ""} />
          <input type="hidden" name="value_format" value={setting?.value_format ?? ""} />
          <input type="hidden" name="x_axis_label" value={setting?.x_axis_label ?? "Date"} />
          <input type="hidden" name="y_axis_label" value={setting?.y_axis_label ?? metricName} />
          <input type="hidden" name="preferred_chart_type" value={setting?.preferred_chart_type ?? "line"} />
          <input type="hidden" name="is_visible" value={(setting?.is_visible ?? true) ? "true" : "false"} />
          <button className="min-h-10 rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
            Apply recommended target
          </button>
        </form>
        <Link href={(`/app/ask?prompt=${encodeURIComponent(`Explain the recommended target for KPI: ${metricName}`)}`) as Route} className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">
          Ask Vaeroex why
        </Link>
      </div>
    </div>
  );
}

function TrendAnalysis({ rows, metricName, settings }: { rows: KpiRow[]; metricName: string; settings: KpiSettingRow[] }) {
  if (!metricName) {
    return (
      <EmptyState
        title="No trends yet"
        description="Save two or more KPI records with dates to unlock trend charts and movement summaries."
      />
    );
  }

  const latest = rows[rows.length - 1];
  const previous = rows[rows.length - 2];
  const actualValues = rows.map((row) => row.actual_value).filter((value): value is number => value !== null);
  const averageActual = average(actualValues);
  const latestTone = metricTone(latest?.actual_value ?? null, latest?.target ?? null);
  const targetStatus = statusLabel(latestTone);
  const movement = trendDeltaLabel(latest, previous, metricName);
  const latestValue = formatNumericValue(latest?.actual_value, metricName);
  const averageValue = formatNumericValue(averageActual, metricName, "Not enough data");
  const definition = kpiDefinition(metricName, settings);
  const weight = kpiWeight(metricName, settings);
  const chartType = kpiPreferredChartType(metricName, settings);
  const yAxisLabel = kpiYAxisLabel(metricName, settings);

  const insights = [
    latest ? `Latest result is ${latestValue} for ${formatShortDate(latest.metric_date)}.` : "",
    definition ? `Definition: ${definition}` : "",
    `Leadership weight: ${numberFormatter.format(weight)} out of 10.`,
    `Preferred chart: ${chartType}. Y-axis: ${yAxisLabel}.`,
    latest?.target === null || latest?.target === undefined
      ? "Add a target to show whether this KPI is on pace."
      : `Current target status: ${targetStatus.toLowerCase()}.`,
    previous ? `Movement from the previous entry: ${movement.toLowerCase()}.` : "Add another entry to compare movement.",
    rows.length < 4 ? "Four or more entries will make the trend more reliable." : "There is enough history here for a useful management review."
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <TrendSummaryCard label="Latest Value" value={latestValue} detail={latest ? `Recorded ${formatShortDate(latest.metric_date)}` : "No value yet"} />
        <TrendSummaryCard label="Change" value={movement} detail="Latest entry compared with the previous entry" />
        <TrendSummaryCard label="Average" value={averageValue} detail={`Average across ${actualValues.length} recorded value${actualValues.length === 1 ? "" : "s"}`} />
        <TrendSummaryCard label="Target Hit Rate" value={targetHitRate(rows)} detail="Share of records that met or beat target" />
      </div>

      <TrendChart rows={rows.slice(-12)} metricName={metricName} settings={settings} />
      <PeriodComparisonTable rows={rows} metricName={metricName} />

      <div className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
        <p className="text-sm font-semibold text-white">KPI summary</p>
        <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
          {insights.map((insight) => (
            <div key={insight} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
              <p>{insight}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
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
  const kpiSettings = (kpiSettingsResult.data || []) as KpiSettingRow[];
  const adjustedKpis = sortKpiRowsBySettings(applyKpiSettingsToRows(rawKpis, kpiSettings), kpiSettings) as KpiRow[];
  const timeline = isKpiTimeline(params?.timeline) ? params.timeline : "90D";
  const selectedTimelineRange = timelineRange(timeline, adjustedKpis.length ? adjustedKpis : rawKpis, params?.start, params?.end);
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
  const trendRows = primaryMetric ? getMetricHistoryRows(kpis, primaryMetric) : [];
  const selectedTrends = buildTrends(kpis, selectedMetrics, kpiSettings);
  const hasComparison = selectedMetrics.length > 1;
  const comparisonMode = isComparisonMode(params?.mode) ? params.mode : defaultComparisonMode(selectedTrends);
  const activeSection =
    params?.section === "compare" || params?.metric === "compare"
      ? "compare"
      : params?.section === "records" || params?.sort
        ? "records"
        : params?.section === "detail"
          ? "detail"
          : "overview";
  const selectedMetricRows = primaryMetric ? getMetricHistoryRows(allVisibleKpis, primaryMetric) : [];
  const selectedLatestKpi = selectedMetricRows.at(-1);
  const selectedKpiSetting = primaryMetric ? kpiSettingForName(kpiSettings, primaryMetric) : undefined;
  const selectedRecommendation = primaryMetric ? recommendedTargetForMetric(primaryMetric, allVisibleKpis) : null;
  const managedKpis = kpis.map((kpi) => {
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
            <Link href="/app/files?status=Uploaded" className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">
              Import KPI Data
            </Link>
            <Link href="/app/ask" className="min-h-10 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">
              Ask Vaeroex
            </Link>
          </div>
        }
      />
      <ModuleTabs
        tabs={[
          { label: "Overview", href: "/app/kpis", active: activeSection === "overview" || activeSection === "detail" },
          { label: "Compare", href: "/app/kpis?section=compare" as Route, active: activeSection === "compare" },
          { label: "Records", href: "/app/kpis?section=records" as Route, active: activeSection === "records" },
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

      <TimelineControls timeline={timeline} range={selectedTimelineRange} />

      {activeSection === "overview" || activeSection === "detail" ? (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryStat label="Total KPIs" value={metricNames.length} detail="Visible measurement definitions" tone={metricNames.length ? "green" : "yellow"} />
            <SummaryStat label="On Track" value={onTrackCount} detail="Latest value meets target" tone={onTrackCount ? "green" : "neutral"} />
            <SummaryStat label="Behind Target" value={behindTargetCount} detail="Needs management review" tone={behindTargetCount ? "red" : "green"} />
            <SummaryStat label="Missing Data" value={missingDataCount} detail="Needs a current value" tone={missingDataCount ? "yellow" : "green"} />
            <SummaryStat label="Updated This Month" value={updatedThisMonthCount} detail="Fresh KPI signals" tone={updatedThisMonthCount ? "green" : "yellow"} />
          </section>

          {latestKpiRows.length ? (
            <section className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
              {latestKpiRows.slice(0, 9).map((kpi, index) => (
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
            <EmptyState title="No KPIs yet" description="Create your first KPI manually or import reviewed CSV/XLSX data to start measuring what matters." />
          )}

          <section className="grid gap-4 xl:grid-cols-[1.25fr_.75fr]">
            <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">KPI Comparison</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    {selectedMetrics.length > 1 ? `Comparing ${selectedMetrics.join(", ")}.` : "Select multiple KPIs in Compare to overlay trend lines."}
                  </p>
                </div>
                <Link href="/app/kpis?section=compare" className="w-fit rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-vaeroex-accent/50 hover:bg-cyan-950/40 hover:text-vaeroex-accent">
                  Compare KPIs
                </Link>
              </div>
              <div className="mt-4">
                {hasComparison ? <ComparisonAnalysis trends={selectedTrends} mode={comparisonMode} /> : <TrendAnalysis rows={trendRows} metricName={primaryMetric} settings={kpiSettings} />}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">Vaeroex KPI Summary</p>
              <p className="mt-3 text-sm leading-6 text-slate-300">{kpiSummary}</p>
              <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/35 p-3 text-sm leading-6 text-slate-300">
                <p className="font-semibold text-white">Top KPI needing attention</p>
                <p className="mt-1">{topAttentionKpi ? `${topAttentionKpi.name}: ${statusLabel(metricTone(topAttentionKpi.actual_value, topAttentionKpi.target))}` : "No KPI has enough data yet."}</p>
              </div>
              <Link href={(`/app/ask?prompt=${encodeURIComponent("Review our KPI trends and recommend the next leadership action.")}`) as Route} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
                Ask Vaeroex about these KPIs
              </Link>
            </div>
          </section>

          {activeSection === "detail" && primaryMetric ? (
            <section id="kpi-detail" className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
              <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">KPI Detail</p>
                    <h2 className="mt-2 text-xl font-semibold text-white">{primaryMetric}</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{kpiDefinition(primaryMetric, kpiSettings) || "No definition set yet."}</p>
                  </div>
                  <KpiStatusBadge tone={metricTone(selectedLatestKpi?.actual_value ?? null, selectedLatestKpi?.target ?? null)} />
                </div>
                <div className="mt-4">
                  <TrendAnalysis rows={selectedMetricRows} metricName={primaryMetric} settings={kpiSettings} />
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
                <details className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-sm text-slate-300 shadow-panel">
                  <summary className="cursor-pointer font-semibold text-white">Evidence and history</summary>
                  <div className="mt-3 space-y-2">
                    {selectedMetricRows.slice(-8).reverse().map((row) => (
                      <div key={row.id} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
                        <p className="font-semibold text-white">{formatSettingValue(row.actual_value, row.name, kpiSettings)} · {row.metric_date}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-400">{row.source || "Manual"}{row.notes ? ` · ${row.notes}` : ""}</p>
                      </div>
                    ))}
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
              <form method="get" className="space-y-3 rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
                <input type="hidden" name="section" value="compare" />
                <input type="hidden" name="timeline" value={timeline} />
                {timeline === "Custom Range" ? (
                  <>
                    <input type="hidden" name="start" value={selectedTimelineRange.startDate} />
                    <input type="hidden" name="end" value={selectedTimelineRange.endDate} />
                  </>
                ) : null}
                <div>
                  <p className="text-sm font-semibold text-white">Compare KPIs</p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Select KPI lines for this view. Colors, targets, definitions, and axis labels are managed in KPI Settings.
                  </p>
                </div>
                <fieldset className="grid gap-2 sm:grid-cols-3">
                  {[
                    ["actual", "Actual values"],
                    ["percent", "Percent change"],
                    ["normalized", "Normalized 0-100"]
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
                </fieldset>
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
                <PrimaryButton>Update chart</PrimaryButton>
              </form>

              <TrendAnalysis rows={trendRows} metricName={primaryMetric} settings={kpiSettings} />
              {hasComparison ? <ComparisonAnalysis trends={selectedTrends} mode={comparisonMode} /> : null}
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
                <TextInput label="Name" name="name" placeholder="Revenue, Leads, Conversion Rate" required />
                <TextInput label="Category" name="category" placeholder="Sales, Operations, Finance" />
                <TextInput label="Target" name="target" type="number" step="0.01" />
                <TextInput label="Actual Value" name="actual_value" type="number" step="0.01" />
                <TextInput label="Date" name="metric_date" type="date" defaultValue={today} />
                <TextInput label="Owner" name="owner" placeholder="Manager or department" />
                <TextInput label="Source" name="source" placeholder="POS, CRM, spreadsheet, manual" />
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
            emptyDescription="Create your first KPI for revenue, leads, conversion rate, follow-up completion, or any custom metric your team reviews."
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
