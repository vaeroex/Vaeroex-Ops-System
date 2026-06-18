import { createKpiAction } from "@/app/app/operations/actions";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, TextArea, TextInput } from "@/components/operations/FormControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import type { Database } from "@/lib/supabase/types";

type KpisPageProps = {
  searchParams?: Promise<{ error?: string }>;
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

  const label = `${lower(kpi.name)} ${lower(kpi.category)}`;

  if (label.includes("revenue") || label.includes("sales")) {
    return currencyFormatter.format(kpi.actual_value);
  }

  if (label.includes("conversion") || label.includes("rate")) {
    return `${numberFormatter.format(kpi.actual_value)}%`;
  }

  return numberFormatter.format(kpi.actual_value);
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

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {metricCards.map((card) => (
          <MetricCard key={card.label} {...card} />
        ))}
      </section>

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
