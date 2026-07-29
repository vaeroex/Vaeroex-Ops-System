export type KpiMeasurementFreshness = "current" | "stale" | "old";

export function kpiMeasurementAgeDays(observedAt: string | null | undefined, asOf = new Date()) {
  if (!observedAt) return null;
  const date = observedAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(parsed)) return null;
  return Math.floor((asOf.getTime() - parsed) / 86_400_000);
}

export function kpiMeasurementFreshness(
  observedAt: string | null | undefined,
  asOf = new Date()
): KpiMeasurementFreshness {
  const ageDays = kpiMeasurementAgeDays(observedAt, asOf);
  if (ageDays !== null && ageDays <= 45) return "current";
  if (ageDays !== null && ageDays <= 120) return "stale";
  return "old";
}
