import { createKpiAction } from "@/app/app/operations/actions";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, TextArea, TextInput } from "@/components/operations/FormControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import type { Database } from "@/lib/supabase/types";

type KpisPageProps = {
  searchParams?: Promise<{ error?: string; message?: string; metric?: string }>;
};

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type KpiTone = "green" | "yellow" | "red" | "neutral";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2
});

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

function getTrendRows(kpis: KpiRow[], metricName: string) {
  return kpis
    .filter((kpi) => kpi.name === metricName)
    .sort((a, b) => `${a.metric_date}-${a.created_at}`.localeCompare(`${b.metric_date}-${b.created_at}`))
    .slice(-12);
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
  const selectedMetric = params?.metric && metricNames.includes(params.metric) ? params.metric : metricNames[0] || "";
  const trendRows = selectedMetric ? getTrendRows(kpis, selectedMetric) : [];

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

      <SectionCard title="Trend analysis" description="Select a KPI to review movement over time, target performance, and the management readout.">
        {metricNames.length ? (
          <div className="space-y-5">
            <form method="get" className="flex flex-col gap-3 sm:max-w-xl sm:flex-row sm:items-end">
              <label className="flex-1 text-sm font-medium">
                KPI
                <select
                  name="metric"
                  defaultValue={selectedMetric}
                  className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
                >
                  {metricNames.map((metric) => (
                    <option key={metric} value={metric}>
                      {metric}
                    </option>
                  ))}
                </select>
              </label>
              <PrimaryButton>View trend</PrimaryButton>
            </form>
            <TrendAnalysis rows={trendRows} metricName={selectedMetric} />
          </div>
        ) : (
          <EmptyState title="No trend data yet" description="Create KPI records over time to unlock charts and trend summaries." />
        )}
      </SectionCard>

      <section className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <SectionCard title="KPI log" description="Each metric is scoped to the current workspace and can use its own target.">
          {kpis.length ? (
            <div className="space-y-4">
              {kpis.map((kpi) => {
                const tone = metricTone(kpi.actual_value, kpi.target);

                return (
                  <article key={kpi.id} className="rounded-lg border border-line p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="font-semibold">{kpi.name}</p>
                        <p className="mt-1 text-sm text-muted">
                          {kpi.category || "General"} · {kpi.metric_date}
                        </p>
                      </div>
                      <KpiStatusBadge tone={tone} />
                    </div>

                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted">Actual</p>
                        <p className="mt-1 font-semibold">{kpi.actual_value === null ? "Not set" : numberFormatter.format(kpi.actual_value)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted">Target</p>
                        <p className="mt-1 font-semibold">{kpi.target === null ? "No target" : numberFormatter.format(kpi.target)}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted">Owner</p>
                        <p className="mt-1 font-semibold">{kpi.owner || "Unassigned"}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted">Source</p>
                        <p className="mt-1 font-semibold">{kpi.source || "Manual"}</p>
                      </div>
                    </div>

                    {kpi.notes ? <p className="mt-4 text-sm leading-6 text-muted">{kpi.notes}</p> : null}
                  </article>
                );
              })}
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
