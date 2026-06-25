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

  return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>;
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

  return (
    <article className="rounded-lg border border-line bg-white shadow-panel">
      <details>
        <summary className="flex cursor-pointer list-none flex-col gap-3 p-4 transition hover:bg-cyan-950/30 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <h2 className="truncate text-base font-semibold text-ink">{metric}</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted">
              Target {target === null ? "not set" : target} · {category || "General"} · {isVisible ? "Visible" : "Hidden"}
            </p>
          </div>
          <span className="w-fit rounded-full border border-vaeroex-blue/30 bg-vaeroex-soft px-3 py-1 text-xs font-semibold text-vaeroex-blue">
            Weight {weight}/10
          </span>
        </summary>

        <div className="border-t border-line bg-slate-50/60 p-4">
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
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-vaeroex-blue"
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
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-vaeroex-blue"
            />
          </label>
          <label className="block text-sm font-medium">
            Category
            <input
              name="category"
              defaultValue={category}
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-vaeroex-blue"
            />
          </label>
          <label className="block text-sm font-medium">
            Sort order
            <input
              name="sort_order"
              type="number"
              step="1"
              defaultValue={sortOrder}
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-vaeroex-blue"
            />
          </label>
          <label className="block text-sm font-medium lg:col-span-2">
            Definition
            <textarea
              name="definition"
              rows={3}
              defaultValue={definition}
              placeholder="Define how this KPI should be interpreted by leadership."
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-vaeroex-blue"
            />
          </label>
          <fieldset className="space-y-2 lg:col-span-2">
            <legend className="text-sm font-semibold text-ink">Approved high-contrast color</legend>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              {KPI_COLOR_PALETTE.map((option) => (
                <label key={option.value} className="flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2 text-xs font-semibold">
                  <input name="color" type="radio" value={option.value} defaultChecked={color === option.value} />
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: option.value }} />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold lg:col-span-2">
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
          <p className="rounded-lg border border-line bg-slate-50 p-3">
            <span className="block text-xs uppercase tracking-wide text-muted">Target</span>
            {target === null ? "Not set" : target}
          </p>
          <p className="rounded-lg border border-line bg-slate-50 p-3">
            <span className="block text-xs uppercase tracking-wide text-muted">Category</span>
            {category || "General"}
          </p>
          <p className="rounded-lg border border-line bg-slate-50 p-3 md:col-span-2">
            <span className="block text-xs uppercase tracking-wide text-muted">Definition</span>
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
        description="Workspace administrators manage KPI targets, weights, definitions, visibility, and colors here. Historical KPI values are not edited from this page."
        actions={
          <Link href="/app/kpis" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:border-vaeroex-accent hover:text-vaeroex-blue">
            Back to KPIs
          </Link>
        }
      />
      <ModuleTabs
        tabs={[
          { label: "Overview", href: "/app/kpis" },
          { label: "Charts", href: "/app/kpis?section=charts" as Route },
          { label: "Comparisons", href: "/app/kpis?metric=compare" as Route },
          { label: "History", href: "/app/kpis?sort=last_updated" as Route },
          { label: "Imports", href: "/app/files?status=Imported" as Route },
          { label: "Settings", href: "/app/kpis/settings" as Route, active: true }
        ]}
      />
      <ErrorNotice message={params?.error || kpiResult.error?.message || settingsResult.error?.message} />
      <SuccessNotice message={params?.message} />

      {!canManage ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          KPI settings are read-only for your role. Ask a workspace owner or admin to change targets, weights, colors, definitions, or visibility.
        </div>
      ) : null}

      <SectionCard
        title="Configuration rules"
        description="Targets and weights guide dashboards, reports, and Vaeroex intelligence. They do not rewrite historical KPI values."
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-line bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-ink">Targets</p>
            <p className="mt-1 text-xs leading-5 text-muted">Used to decide whether current performance is on pace.</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-ink">Weights</p>
            <p className="mt-1 text-xs leading-5 text-muted">Higher weights make a KPI more prominent in Vaeroex risk and opportunity signals.</p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-3 text-sm">
            <p className="font-semibold text-ink">Visibility</p>
            <p className="mt-1 text-xs leading-5 text-muted">Hidden KPIs remain in history but are removed from dashboards and Vaeroex intelligence.</p>
          </div>
        </div>
      </SectionCard>

      {names.length ? (
        <section className="grid gap-4 xl:grid-cols-2">
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
