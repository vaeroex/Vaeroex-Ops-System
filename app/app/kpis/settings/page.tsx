import type { Route } from "next";
import Link from "next/link";
import { updateKpiSettingAction } from "@/app/app/operations/actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { ModuleTabs } from "@/components/operations/ModuleTabs";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import {
  approvedKpiColor,
  getConfiguredMetricNames,
  kpiColorMayBeLowContrast,
  kpiSettingForName,
  KPI_COLOR_PALETTE,
  type KpiSettingRow
} from "@/lib/kpis/settings";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type KpiSettingsPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];

function SuccessNotice({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return <div className="rounded-lg border border-emerald-400/35 bg-emerald-950/30 p-3 text-sm text-emerald-100">{message}</div>;
}

function canManageKpiSettings(role: string | null | undefined) {
  return role === "owner" || role === "admin";
}

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
}

function latestByMetric(rows: KpiRow[]) {
  const latest = new Map<string, KpiRow>();

  for (const row of rows) {
    if (!latest.has(row.name)) {
      latest.set(row.name, row);
    }
  }

  return latest;
}

function metricNames(rows: KpiRow[], settings: KpiSettingRow[]) {
  const names = new Set<string>(getConfiguredMetricNames(rows, settings, true));

  settings.forEach((setting) => names.add(setting.kpi_name));

  return [...names].sort((a, b) => a.localeCompare(b));
}

function KpiSettingCard({
  metric,
  setting,
  latest,
  canManage
}: {
  metric: string;
  setting: KpiSettingRow | undefined;
  latest: KpiRow | undefined;
  canManage: boolean;
}) {
  const target = setting?.target ?? latest?.target ?? null;
  const weight = setting?.weight ?? 1;
  const color = approvedKpiColor(setting?.color);
  const category = setting?.category ?? latest?.category ?? "";
  const isVisible = setting?.is_visible ?? true;
  const definition = setting?.definition ?? "";
  const sortOrder = setting?.sort_order ?? 0;
  const unitType = setting?.unit_type ?? "";
  const displayUnit = setting?.display_unit ?? "";
  const valueFormat = setting?.value_format ?? "";
  const xAxisLabel = setting?.x_axis_label ?? "Date";
  const yAxisLabel = setting?.y_axis_label ?? metric;
  const preferredChartType = setting?.preferred_chart_type ?? "line";
  const lowContrastWarning = kpiColorMayBeLowContrast(color);

  return (
    <article className="rounded-lg border border-white/10 bg-[#08111f] text-slate-100">
      <details>
        <summary className="grid cursor-pointer list-none gap-3 p-3 transition hover:border-cyan-300/35 hover:bg-cyan-950/25 sm:grid-cols-[minmax(180px,1.4fr)_120px_90px_90px_90px] sm:items-center">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <h2 className="truncate text-sm font-semibold text-white">{metric}</h2>
            </div>
            <p className="mt-1 line-clamp-1 text-xs leading-5 text-slate-400">
              {definition || "No definition set yet."}
            </p>
          </div>
          <span className="text-xs text-slate-300">Target <span className="font-semibold text-white">{target === null ? "not set" : target}</span></span>
          <span className="text-xs text-slate-300">Weight <span className="font-semibold text-white">{weight}/10</span></span>
          <span className="text-xs text-slate-300">{category || "General"}</span>
          <span className={`w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${isVisible ? "border-emerald-400/35 bg-emerald-950/30 text-emerald-100" : "border-slate-600/40 bg-slate-950/50 text-slate-300"}`}>
            {isVisible ? "Visible" : "Hidden"}
          </span>
        </summary>

        <div className="border-t border-white/10 bg-slate-950/45 p-4">
          {canManage ? (
        <form action={updateKpiSettingAction} className="grid gap-4 lg:grid-cols-2">
          <input type="hidden" name="return_path" value="/app/kpis/settings" />
          <input type="hidden" name="kpi_name" value={metric} />
          <label className="block text-sm font-medium">
            Target
            <input
              name="target"
              type="number"
              step="0.01"
              defaultValue={formatNumber(target)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-vaeroex-accent"
            />
          </label>
          <label className="block text-sm font-medium">
            Weight
            <input
              name="weight"
              type="number"
              min="0"
              max="10"
              step="0.1"
              defaultValue={weight}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-vaeroex-accent"
            />
          </label>
          <label className="block text-sm font-medium">
            Category
            <input
              name="category"
              defaultValue={category}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-vaeroex-accent"
            />
          </label>
          <label className="block text-sm font-medium">
            Sort order
            <input
              name="sort_order"
              type="number"
              step="1"
              defaultValue={sortOrder}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-vaeroex-accent"
            />
          </label>
          <label className="block text-sm font-medium">
            Unit/type
            <input
              name="unit_type"
              defaultValue={unitType}
              placeholder="Currency, count, rate, hours"
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
            />
          </label>
          <label className="block text-sm font-medium">
            Display unit
            <input
              name="display_unit"
              defaultValue={displayUnit}
              placeholder="$, %, count, hours"
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
            />
          </label>
          <label className="block text-sm font-medium">
            X-axis label
            <input
              name="x_axis_label"
              defaultValue={xAxisLabel}
              placeholder="Date, Week, Month"
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
            />
          </label>
          <label className="block text-sm font-medium">
            Y-axis label
            <input
              name="y_axis_label"
              defaultValue={yAxisLabel}
              placeholder="Revenue ($), Lead Count, Conversion %"
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
            />
          </label>
          <label className="block text-sm font-medium">
            Value format
            <input
              name="value_format"
              defaultValue={valueFormat}
              placeholder="Currency, percent, number"
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
            />
          </label>
          <label className="block text-sm font-medium">
            Preferred chart type
            <select
              name="preferred_chart_type"
              defaultValue={preferredChartType}
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-vaeroex-accent"
            >
              <option value="line">Line</option>
              <option value="bar">Bar</option>
              <option value="mixed">Mixed</option>
            </select>
          </label>
          <label className="block text-sm font-medium lg:col-span-2">
            Definition
            <textarea
              name="definition"
              rows={3}
              defaultValue={definition}
              placeholder="Define how this KPI should be interpreted by leadership."
              className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
            />
          </label>
          <fieldset className="space-y-2 lg:col-span-2">
            <legend className="text-sm font-semibold text-white">Approved high-contrast color</legend>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {KPI_COLOR_PALETTE.map((option) => (
                <label key={option.value} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-200">
                  <input name="color" type="radio" value={option.value} defaultChecked={color === option.value} />
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: option.value }} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/45 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Preview</p>
              <div className="mt-2 flex items-center gap-3">
                <span className="h-3 w-3 rounded-full" style={{ backgroundColor: color }} />
                <span className="h-1 w-20 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs text-slate-300">{metric}</span>
              </div>
              {lowContrastWarning ? (
                <p className="mt-2 text-xs leading-5 text-amber-100">
                  This color may be difficult to see in the current Pulsar theme. Keep it only if your team intentionally chose it.
                </p>
              ) : null}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-200 lg:col-span-2">
            <input name="is_visible" type="checkbox" defaultChecked={isVisible} className="h-4 w-4 rounded border-line text-vaeroex-blue" />
            Show this KPI in dashboards, reports, and Vaeroex intelligence
          </label>
          <div className="lg:col-span-2">
            <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
              Save KPI settings
            </button>
          </div>
        </form>
          ) : (
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <span className="block text-xs uppercase tracking-wide text-slate-400">Target</span>
            {target === null ? "Not set" : target}
          </p>
          <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <span className="block text-xs uppercase tracking-wide text-slate-400">Category</span>
            {category || "General"}
          </p>
          <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3 md:col-span-2">
            <span className="block text-xs uppercase tracking-wide text-slate-400">Definition</span>
            {definition || "No definition set yet."}
          </p>
        </div>
          )}
        </div>
      </details>
    </article>
  );
}

export default async function KpiSettingsPage({ searchParams }: KpiSettingsPageProps) {
  const params = await searchParams;
  const { supabase, context, workspaceId } = await requireWorkspacePage();
  const canManage = canManageKpiSettings(context.membership?.role);
  const [kpiResult, settingsResult] = await Promise.all([
    supabase
      .from("kpis")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("metric_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.from("kpi_settings").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true }).order("weight", { ascending: false })
  ]);
  const kpis = (kpiResult.data || []) as KpiRow[];
  const settings = (settingsResult.data || []) as KpiSettingRow[];
  const latest = latestByMetric(kpis);
  const names = metricNames(kpis, settings);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace KPI Configuration"
        title="KPI Settings"
        description="Manage KPI targets, weights, visibility, and definitions. Historical values stay locked."
        actions={
          <Link href="/app/kpis" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-vaeroex-accent hover:text-vaeroex-blue">
            Back to KPIs
          </Link>
        }
      />
      <ModuleTabs
        tabs={[
          { label: "Overview", href: "/app/kpis" },
          { label: "Compare", href: "/app/kpis?section=compare" as Route },
          { label: "Records", href: "/app/kpis?section=records" as Route },
          { label: "Imports", href: "/app/files?status=Imported" as Route },
          { label: "Settings", href: "/app/kpis/settings" as Route, active: true }
        ]}
      />
      <ErrorNotice message={params?.error || kpiResult.error?.message || settingsResult.error?.message} />
      <SuccessNotice message={params?.message} />

      {!canManage ? (
        <div className="rounded-lg border border-amber-400/35 bg-amber-950/30 p-3 text-sm leading-6 text-amber-100">
          KPI settings are read-only for your role. Ask a workspace owner or admin to change targets, weights, colors, definitions, or visibility.
        </div>
      ) : null}

      <details className="rounded-lg border border-white/10 bg-[#08111f] p-3 text-sm text-slate-300">
        <summary className="cursor-pointer font-semibold text-slate-100">How KPI settings affect intelligence</summary>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <p>Targets define whether performance is on pace.</p>
          <p>Weights make important KPIs more prominent in risk and opportunity signals.</p>
          <p>Hidden KPIs remain in history but stay out of dashboards and Vaeroex intelligence.</p>
        </div>
      </details>

      {names.length ? (
        <section className="space-y-2">
          {names.map((metric) => (
            <KpiSettingCard
              key={metric}
              metric={metric}
              setting={kpiSettingForName(settings, metric)}
              latest={latest.get(metric)}
              canManage={canManage}
            />
          ))}
        </section>
      ) : (
        <SectionCard title="No KPI definitions yet" description="Create a KPI record first, then return here to configure targets, colors, visibility, weights, and definitions.">
          <Link href="/app/kpis" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Create first KPI
          </Link>
        </SectionCard>
      )}
    </div>
  );
}
