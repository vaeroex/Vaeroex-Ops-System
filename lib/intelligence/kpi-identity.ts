import type { Database } from "@/lib/supabase/types";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];

export function normalizeKpiName(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function compareKpiRowsNewest(a: KpiRow, b: KpiRow) {
  const metricDate = (b.metric_date || "").localeCompare(a.metric_date || "");
  if (metricDate) return metricDate;

  const updatedAt = (b.updated_at || "").localeCompare(a.updated_at || "");
  if (updatedAt) return updatedAt;

  const createdAt = (b.created_at || "").localeCompare(a.created_at || "");
  if (createdAt) return createdAt;

  return b.id.localeCompare(a.id);
}

export function groupKpisByNormalizedName(rows: KpiRow[]) {
  const groups = new Map<string, KpiRow[]>();

  for (const row of [...rows].sort(compareKpiRowsNewest)) {
    const key = normalizeKpiName(row.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  return groups;
}
