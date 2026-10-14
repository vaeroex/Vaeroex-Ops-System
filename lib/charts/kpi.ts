import { evaluateKpiPerformance, isKpiTargetMet, isKpiTargetMiss, resolveKpiTargetReference, type KpiSemantics } from "@/lib/kpis/semantics";
import { parseComparisons } from "./comparison";
type Observation = { id: string; actual_value: number | null; metric_date: string; created_at: string; source?: string | null };
export function kpiComparisons({ name, rows, semantics, target }: { name: string; rows: readonly Observation[]; semantics: KpiSemantics; target: number | null }) {
  if (semantics.metricRole !== "actual" || !semantics.unit?.trim()) return [];
  const ordered = [...rows].filter(row => row.actual_value !== null && Number.isFinite(row.actual_value)).sort((a, b) => a.metric_date.localeCompare(b.metric_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const latest = ordered.at(-1);
  if (!latest) return [];
  const previous = ordered.filter(row => row.metric_date < latest.metric_date).at(-1);
  const direction = semantics.desiredDirection === "maximize" || semantics.desiredDirection === "minimize" ? semantics.desiredDirection : "neutral";
  const base = { version: 1, title: name, unit: semantics.unit || "", direction,
    after: { label: "Actual", value: latest.actual_value, context: latest.metric_date },
    sources: [{ label: `${latest.source || "KPI record"} · ${latest.metric_date}`, href: `/app/kpis?metric=${encodeURIComponent(name)}&section=records` }],
    limitations: [] as string[] };
  const charts: unknown[] = [];
  if (previous) charts.push({ ...base, id: `${latest.id}:prior`, kind: "observation", before: { label: "Prior recorded", value: previous.actual_value, context: previous.metric_date },
    context: `${previous.metric_date} → ${latest.metric_date} · recorded observations`, limitations: ["These are recorded KPI values, not necessarily equal-length reporting periods.", ...(direction === "neutral" ? ["Confirm a metric direction or inspect its target to interpret this movement."] : [])] });
  const reference = resolveKpiTargetReference(semantics, target);
  if (reference.kind === "scalar" && semantics.desiredDirection !== "unknown") {
    const evaluation = evaluateKpiPerformance({ observations: [latest], semantics, target });
    const favorable = isKpiTargetMet(evaluation.targetStatus);
    charts.push({ ...base, id: `${latest.id}:target`, kind: "target", before: { label: "Target", value: reference.value, context: "Current configured target" }, context: `${latest.metric_date} · actual versus current target`, outcome: favorable ? "favorable" : isKpiTargetMiss(evaluation.targetStatus) ? "unfavorable" : "neutral",
      limitations: ["Uses the current configured target; historical target changes are not reconstructed."] });
  }
  if (reference.kind === "range") {
    charts.push({ ...base, id: `${latest.id}:range-min`, kind: "target", before: { label: "Target range", value: reference.min, context: `Acceptable range: ${reference.min}–${reference.max}` }, context: `${latest.metric_date} · acceptable range ${reference.min}–${reference.max}`, targetRange: { min: reference.min, max: reference.max }, direction: "neutral", outcome: latest.actual_value! >= reference.min && latest.actual_value! <= reference.max ? "favorable" : "unfavorable", limitations: ["The shaded reference shows the current acceptable range. Both bounds determine target performance."] });
  }
  return parseComparisons(charts);
}
