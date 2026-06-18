import { createKpiAction, deleteKpiAction, updateKpiAction } from "@/app/app/operations/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, TextArea, TextInput } from "@/components/operations/FormControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import type { Database } from "@/lib/supabase/types";

type KpisPageProps = {
  searchParams?: Promise<{ error?: string; message?: string; metric?: string | string[] }>;
};

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type KpiTone = "green" | "yellow" | "red" | "neutral";
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

const chartColors = ["#2563eb", "#059669", "#dc2626", "#7c3aed", "#ea580c", "#0891b2", "#be123c"];

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
  if (tone === "green") return "On target";
  if (tone === "yellow") return "Near target";
  if (tone === "red") return "Below target";
  return "Tracking";
}

function toneClasses(tone: KpiTone) {
  if (tone === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "yellow") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-700";
  return "border-line bg-white text-ink";
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

  return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>;
}

function MetricCard({
  label,
  value,
  detail,
  tone
}: {
  label: string;
  value: string | number;
  detail: string;
  tone: KpiTone;
}) {
  return (
    <article className={`rounded-lg border p-4 shadow-panel ${toneClasses(tone)}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">{label}</p>
        <span className="rounded-full bg-white/70 px-2 py-1 text-[11px] font-semibold">{statusLabel(tone)}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-5 opacity-80">{detail}</p>
    </article>
  );
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

function getMetricNames(kpis: KpiRow[]) {
  return Array.from(new Set(kpis.map((kpi) => kpi.name).filter(Boolean))).sort((a, b) => a.localeCompare(b));
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

function getTrendRows(kpis: KpiRow[], metricName: string) {
  return kpis
    .filter((kpi) => kpi.name === metricName)
    .sort((a, b) => `${a.metric_date}-${a.created_at}`.localeCompare(`${b.metric_date}-${b.created_at}`))
    .slice(-12);
}

function buildTrends(kpis: KpiRow[], metricNames: string[]) {
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
      color: chartColors[index % chartColors.length],
      latest,
      previous,
      change,
      changePercent,
      volatility
    } satisfies KpiTrend;
  });
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
    <article className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-xl font-semibold text-ink">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{detail}</p>
    </article>
  );
}

function TrendChart({ rows, metricName }: { rows: KpiRow[]; metricName: string }) {
  const chartRows = rows.filter((row) => row.actual_value !== null);

  if (chartRows.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-slate-50 p-5 text-sm leading-6 text-muted">
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

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">{metricName}</p>
          <p className="text-xs text-muted">Last {chartRows.length} recorded values</p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted">
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
            return <line key={line} x1={paddingX} x2={width - paddingX} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />;
          })}
          <text x="8" y={paddingTop + 5} className="fill-slate-500 text-[11px]">
            {numberFormatter.format(maxValue)}
          </text>
          <text x="8" y={paddingTop + plotHeight} className="fill-slate-500 text-[11px]">
            {numberFormatter.format(minValue)}
          </text>
          {targetRows.length >= 2 ? (
            <polyline fill="none" points={targetPoints} stroke="#f59e0b" strokeDasharray="8 7" strokeLinecap="round" strokeWidth="3" />
          ) : null}
          <polyline fill="none" points={actualPoints} stroke="#2563eb" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
          {chartRows.map((row, index) => (
            <circle key={row.id} cx={xFor(index)} cy={yFor(row.actual_value as number)} r="5" fill="#2563eb" stroke="#ffffff" strokeWidth="2" />
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

function OverlayTrendChart({ trends }: { trends: KpiTrend[] }) {
  const chartTrends = trends.filter((trend) => trend.rows.filter((row) => row.actual_value !== null).length >= 2);

  if (chartTrends.length < 2) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-slate-50 p-5 text-sm leading-6 text-muted">
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
  const xFor = (index: number, count: number) => paddingX + (index / Math.max(count - 1, 1)) * plotWidth;
  const yFor = (value: number) => paddingTop + (1 - value / 100) * plotHeight;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-ink">KPI comparison chart</p>
          <p className="text-xs leading-5 text-muted">Indexed trend view. Each line is scaled to its own min/max so different metric types can be compared.</p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted">
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
            return <line key={line} x1={paddingX} x2={width - paddingX} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="1" />;
          })}
          <text x="8" y={paddingTop + 5} className="fill-slate-500 text-[11px]">
            High
          </text>
          <text x="8" y={paddingTop + plotHeight} className="fill-slate-500 text-[11px]">
            Low
          </text>
          {chartTrends.map((trend) => {
            const rows = trend.rows.filter((row) => row.actual_value !== null);
            const values = rows.map((row) => row.actual_value as number);
            const points = rows
              .map((row, index) => `${xFor(index, rows.length)},${yFor(normalizedPointValue(row.actual_value as number, values))}`)
              .join(" ");

            return (
              <g key={trend.name}>
                <polyline fill="none" points={points} stroke={trend.color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
                {rows.map((row, index) => (
                  <circle
                    key={`${trend.name}-${row.id}`}
                    cx={xFor(index, rows.length)}
                    cy={yFor(normalizedPointValue(row.actual_value as number, values))}
                    r="4"
                    fill={trend.color}
                    stroke="#ffffff"
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

function ComparisonAnalysis({ trends }: { trends: KpiTrend[] }) {
  const notes = comparisonNotes(trends);

  return (
    <div className="space-y-4">
      <OverlayTrendChart trends={trends} />
      <div className="rounded-lg border border-line bg-slate-50 p-4">
        <p className="text-sm font-semibold text-ink">Comparison notes</p>
        <div className="mt-3 space-y-2 text-sm leading-6 text-muted">
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

function TrendAnalysis({ rows, metricName }: { rows: KpiRow[]; metricName: string }) {
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

  const insights = [
    latest ? `Latest result is ${latestValue} for ${formatShortDate(latest.metric_date)}.` : "",
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

      <TrendChart rows={rows} metricName={metricName} />

      <div className="rounded-lg border border-line bg-slate-50 p-4">
        <p className="text-sm font-semibold text-ink">Management readout</p>
        <div className="mt-3 space-y-2 text-sm leading-6 text-muted">
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

export default async function KpisPage({ searchParams }: KpisPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const today = new Date().toISOString().slice(0, 10);

  const [kpiResult, completedTasksResult, openTasksResult] = await Promise.all([
    supabase
      .from("kpis")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("metric_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "Done"),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "Done")
  ]);

  const kpis = (kpiResult.data || []) as KpiRow[];
  const revenue = findLatestMetric(kpis, ["revenue", "sales"]);
  const leads = findLatestMetric(kpis, ["lead"]);
  const conversionRate = findLatestMetric(kpis, ["conversion"]);
  const completedTasks = completedTasksResult.count || 0;
  const openTasks = openTasksResult.count || 0;

  const metricCards = [
    {
      label: "Revenue",
      value: formatMetricValue(revenue),
      detail: formatTarget(revenue),
      tone: metricTone(revenue?.actual_value ?? null, revenue?.target ?? null)
    },
    {
      label: "Leads",
      value: formatMetricValue(leads),
      detail: formatTarget(leads),
      tone: metricTone(leads?.actual_value ?? null, leads?.target ?? null)
    },
    {
      label: "Conversion Rate",
      value: formatMetricValue(conversionRate),
      detail: formatTarget(conversionRate),
      tone: metricTone(conversionRate?.actual_value ?? null, conversionRate?.target ?? null)
    },
    {
      label: "Tasks Completed",
      value: completedTasks,
      detail: "All completed tasks in this workspace",
      tone: completedTasks > 0 ? "green" : "yellow"
    },
    {
      label: "Open Tasks",
      value: openTasks,
      detail: "Lower is better for daily accountability",
      tone: openTaskTone(openTasks)
    },
    {
      label: "Custom Metrics",
      value: kpis.length,
      detail: "KPIs tracked in this workspace",
      tone: kpis.length > 0 ? "green" : "yellow"
    }
  ] satisfies Array<{ label: string; value: string | number; detail: string; tone: KpiTone }>;
  const metricNames = getMetricNames(kpis);
  const selectedMetrics = getSelectedMetrics(params?.metric, metricNames);
  const primaryMetric = selectedMetrics[0] || "";
  const trendRows = primaryMetric ? getTrendRows(kpis, primaryMetric) : [];
  const selectedTrends = buildTrends(kpis, selectedMetrics);
  const hasComparison = selectedMetrics.length > 1;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="KPIs"
        title="KPI dashboard"
        description="Track practical business metrics by workspace, compare actual results to targets, and keep owners accountable."
      />

      <ErrorNotice
        message={params?.error || kpiResult.error?.message || completedTasksResult.error?.message || openTasksResult.error?.message}
      />
      <SuccessNotice message={params?.message} />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {metricCards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </section>

      <SectionCard title="Trend analysis" description="Select one or more KPIs to review movement, target performance, and comparison notes.">
        {metricNames.length ? (
          <div className="space-y-5">
            <form method="get" className="space-y-3 rounded-lg border border-line bg-slate-50 p-4">
              <div>
                <p className="text-sm font-semibold text-ink">Compare KPIs</p>
                <p className="mt-1 text-xs leading-5 text-muted">Check or uncheck KPI lines, then update the chart.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {metricNames.map((metric) => (
                  <label key={metric} className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
                    <input
                      name="metric"
                      type="checkbox"
                      value={metric}
                      defaultChecked={selectedMetrics.includes(metric)}
                      className="h-4 w-4 rounded border-line text-vaeroex-blue"
                    />
                    <span>{metric}</span>
                  </label>
                ))}
              </div>
              <PrimaryButton>Update chart</PrimaryButton>
            </form>

            <TrendAnalysis rows={trendRows} metricName={primaryMetric} />

            {hasComparison ? (
              <section className="space-y-3">
                <div>
                  <h3 className="text-base font-semibold text-ink">Multi-KPI comparison</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    Overlaying {selectedMetrics.length} KPI trend lines: {selectedMetrics.join(", ")}.
                  </p>
                </div>
                <ComparisonAnalysis trends={selectedTrends} />
              </section>
            ) : null}
          </div>
        ) : (
          <EmptyState title="No trend data yet" description="Create KPI records over time to unlock charts and trend summaries." />
        )}
      </SectionCard>

      <section className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <SectionCard title="KPI log" description="Each metric is scoped to the current workspace and can use its own target.">
          {kpis.length ? (
            <div className="overflow-hidden rounded-lg border border-line">
              <div className="hidden grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.8fr_0.8fr] gap-3 border-b border-line bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted lg:grid">
                <span>KPI</span>
                <span>Date</span>
                <span>Actual</span>
                <span>Target</span>
                <span>Owner</span>
                <span>Status</span>
              </div>
              <div className="divide-y divide-line">
                {kpis.map((kpi) => {
                  const tone = metricTone(kpi.actual_value, kpi.target);

                  return (
                    <article key={kpi.id} className="bg-white p-4">
                      <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr_0.7fr_0.7fr_0.8fr_0.8fr] lg:items-center">
                        <div>
                          <p className="font-semibold">{kpi.name}</p>
                          <p className="mt-1 text-sm text-muted">{kpi.category || "General"}</p>
                        </div>
                        <p className="text-sm text-muted">{kpi.metric_date}</p>
                        <p className="text-sm font-semibold">
                          {kpi.actual_value === null ? "Not set" : formatNumericValue(kpi.actual_value, kpi.name)}
                        </p>
                        <p className="text-sm font-semibold">{kpi.target === null ? "No target" : formatNumericValue(kpi.target, kpi.name)}</p>
                        <p className="text-sm text-muted">{kpi.owner || "Unassigned"}</p>
                        <KpiStatusBadge tone={tone} />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1">Source: {kpi.source || "Manual"}</span>
                        {kpi.notes ? <span className="rounded-full bg-slate-100 px-2.5 py-1">Notes saved</span> : null}
                      </div>
                      {kpi.notes ? <p className="mt-3 text-sm leading-6 text-muted">{kpi.notes}</p> : null}

                      <div className="mt-4 flex flex-col gap-3">
                        <form action={deleteKpiAction}>
                          <input type="hidden" name="kpi_id" value={kpi.id} />
                          <ConfirmSubmitButton
                            message={`Delete KPI record for ${kpi.name}? This cannot be undone.`}
                            className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700"
                          >
                            Delete KPI
                          </ConfirmSubmitButton>
                        </form>
                      </div>

                      <details className="mt-3 rounded-lg border border-line bg-slate-50 p-4">
                        <summary className="inline-flex cursor-pointer rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold text-ink">
                          Edit KPI
                        </summary>
                        <form action={updateKpiAction} className="mt-4 space-y-4">
                          <input type="hidden" name="kpi_id" value={kpi.id} />
                          <TextInput label="Name" name="name" defaultValue={kpi.name} required />
                          <TextInput label="Category" name="category" defaultValue={kpi.category} />
                          <div className="grid gap-4 sm:grid-cols-2">
                            <TextInput label="Target" name="target" type="number" step="0.01" defaultValue={kpi.target} />
                            <TextInput label="Actual Value" name="actual_value" type="number" step="0.01" defaultValue={kpi.actual_value} />
                          </div>
                          <TextInput label="Date" name="metric_date" type="date" defaultValue={kpi.metric_date} />
                          <div className="grid gap-4 sm:grid-cols-2">
                            <TextInput label="Owner" name="owner" defaultValue={kpi.owner} />
                            <TextInput label="Source" name="source" defaultValue={kpi.source} />
                          </div>
                          <TextArea label="Notes" name="notes" rows={3} defaultValue={kpi.notes} />
                          <div className="flex flex-wrap gap-2">
                            <PrimaryButton>Save changes</PrimaryButton>
                          </div>
                        </form>
                      </details>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No KPIs yet"
              description="Create your first KPI for revenue, leads, conversion rate, task completion, or any custom metric your team reviews."
            />
          )}
        </SectionCard>

        <SectionCard title="Create KPI" description="Use one metric per row so trends stay easy to review.">
          <form action={createKpiAction} className="space-y-4">
            <TextInput label="Name" name="name" placeholder="Revenue, Leads, Conversion Rate" required />
            <TextInput label="Category" name="category" placeholder="Sales, Operations, Finance" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="Target" name="target" type="number" step="0.01" />
              <TextInput label="Actual Value" name="actual_value" type="number" step="0.01" />
            </div>
            <TextInput label="Date" name="metric_date" type="date" defaultValue={today} />
            <TextInput label="Owner" name="owner" placeholder="Manager or department" />
            <TextInput label="Source" name="source" placeholder="POS, CRM, spreadsheet, manual" />
            <TextArea label="Notes" name="notes" rows={4} />
            <PrimaryButton>Save KPI</PrimaryButton>
          </form>
        </SectionCard>
      </section>
    </div>
  );
}
