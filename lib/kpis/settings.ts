import type { Database } from "@/lib/supabase/types";
import { resolveKpiSemantics } from "@/lib/kpis/semantics";

export type KpiSettingRow = Database["public"]["Tables"]["kpi_settings"]["Row"];

export const KPI_COLOR_PALETTE = [
  { value: "#1E6BFF", label: "Vaeroex Blue" },
  { value: "#38BDF8", label: "Electric Blue" },
  { value: "#0B1F4D", label: "Deep Navy" },
  { value: "#10B981", label: "Emerald" },
  { value: "#F59E0B", label: "Amber" },
  { value: "#EF4444", label: "Red" },
  { value: "#8B5CF6", label: "Violet" },
  { value: "#F97316", label: "Orange" },
  { value: "#14B8A6", label: "Teal" },
  { value: "#D1D5DB", label: "Premium Silver" }
] as const;

const HIGH_CONTRAST_DEFAULT_COLORS = new Set(["#10B981", "#38BDF8", "#F59E0B", "#EF4444", "#8B5CF6", "#F97316", "#14B8A6", "#D1D5DB"]);
export const AUTO_KPI_COLOR_PALETTE = KPI_COLOR_PALETTE.filter((color) => HIGH_CONTRAST_DEFAULT_COLORS.has(color.value));
const DEFAULT_KPI_COLOR = AUTO_KPI_COLOR_PALETTE[0]?.value || KPI_COLOR_PALETTE[0].value;

export const KPI_COLOR_SOURCES = ["automatic", "user", "legacy_unclassified"] as const;
export type KpiColorSource = (typeof KPI_COLOR_SOURCES)[number];

type KpiColorAssignmentSetting = Pick<KpiSettingRow, "kpi_name" | "color"> & {
  color_source?: string | null;
};

export function normalizeKpiName(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function resolveSelectedKpiNames(
  value: string | string[] | undefined,
  metricNames: string[],
  fallbackCount = 3
) {
  const requested = (Array.isArray(value) ? value : value ? [value] : [])
    .map((name) => name.trim())
    .filter(Boolean);

  if (!requested.length) {
    return metricNames.slice(0, Math.min(metricNames.length, fallbackCount));
  }

  const availableIdentities = new Set(metricNames.map(normalizeKpiName));
  const selectedByIdentity = new Map<string, string>();

  for (const name of requested) {
    const identity = normalizeKpiName(name);
    if (availableIdentities.has(identity) && !selectedByIdentity.has(identity)) {
      selectedByIdentity.set(identity, name);
    }
  }

  return [...selectedByIdentity.values()];
}

export function approvedKpiColor(value: string | null | undefined): string {
  const match = KPI_COLOR_PALETTE.find((color) => color.value === value);
  return match?.value || DEFAULT_KPI_COLOR;
}

function stableKpiColorHash(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

export function automaticKpiColorForIdentity(workspaceId: string, kpiIdentity: string) {
  const identity = `${workspaceId.trim().toLowerCase()}::${normalizeKpiName(kpiIdentity)}`;
  const index = stableKpiColorHash(identity) % AUTO_KPI_COLOR_PALETTE.length;
  return AUTO_KPI_COLOR_PALETTE[index]?.value || DEFAULT_KPI_COLOR;
}

export function allocateAutomaticKpiColors(
  workspaceId: string,
  kpiIdentities: readonly string[],
  existingSettings: readonly KpiColorAssignmentSetting[] = []
) {
  const pendingByIdentity = new Map<string, string>();
  for (const identity of kpiIdentities) {
    const normalized = normalizeKpiName(identity);
    if (normalized && !pendingByIdentity.has(normalized)) pendingByIdentity.set(normalized, identity.trim());
  }

  const counts = new Map<string, number>(AUTO_KPI_COLOR_PALETTE.map((color) => [color.value, 0]));
  for (const setting of existingSettings) {
    if (pendingByIdentity.has(normalizeKpiName(setting.kpi_name))) continue;
    if (counts.has(setting.color)) counts.set(setting.color, (counts.get(setting.color) || 0) + 1);
  }

  const sortedPending = [...pendingByIdentity.entries()].sort((left, right) => {
    const leftHash = stableKpiColorHash(`${workspaceId}::${left[0]}`);
    const rightHash = stableKpiColorHash(`${workspaceId}::${right[0]}`);
    return leftHash - rightHash || left[0].localeCompare(right[0]);
  });
  const assignments = new Map<string, string>();

  for (const [normalized, identity] of sortedPending) {
    const minimum = Math.min(...counts.values());
    const preferredIndex = stableKpiColorHash(`${workspaceId}::${normalized}`) % AUTO_KPI_COLOR_PALETTE.length;
    const eligible = AUTO_KPI_COLOR_PALETTE
      .map((color, index) => ({ color: color.value, distance: (index - preferredIndex + AUTO_KPI_COLOR_PALETTE.length) % AUTO_KPI_COLOR_PALETTE.length }))
      .filter(({ color }) => counts.get(color) === minimum)
      .sort((left, right) => left.distance - right.distance || left.color.localeCompare(right.color));
    const color = eligible[0]?.color || automaticKpiColorForIdentity(workspaceId, identity);
    assignments.set(normalized, color);
    counts.set(color, (counts.get(color) || 0) + 1);
  }

  return assignments;
}

export function kpiSettingsByName(settings: KpiSettingRow[]) {
  return new Map(settings.map((setting) => [normalizeKpiName(setting.kpi_name), setting]));
}

export function kpiSettingForName(settings: KpiSettingRow[], name: string | null | undefined) {
  return kpiSettingsByName(settings).get(normalizeKpiName(name));
}

export function kpiSemantics(name: string, settings: KpiSettingRow[]) {
  return resolveKpiSemantics(name, kpiSettingForName(settings, name));
}

export function kpiColor(name: string, settings: KpiSettingRow[], fallbackIndex = 0): string {
  const setting = kpiSettingForName(settings, name);

  if (setting?.color) {
    return approvedKpiColor(setting.color);
  }

  void fallbackIndex;
  return automaticKpiColorForIdentity("", name);
}

export function kpiWeight(name: string, settings: KpiSettingRow[]) {
  return kpiSettingForName(settings, name)?.weight ?? 1;
}

export function isKpiVisible(name: string, settings: KpiSettingRow[]) {
  return kpiSettingForName(settings, name)?.is_visible !== false;
}

export function kpiDefinition(name: string, settings: KpiSettingRow[]) {
  return kpiSettingForName(settings, name)?.definition || "";
}

export function kpiDisplayUnit(name: string, settings: KpiSettingRow[]) {
  return kpiSettingForName(settings, name)?.display_unit || "";
}

export function kpiValueFormat(name: string, settings: KpiSettingRow[]) {
  return kpiSettingForName(settings, name)?.value_format || "";
}

export function kpiXAxisLabel(name: string, settings: KpiSettingRow[]) {
  return kpiSettingForName(settings, name)?.x_axis_label || "Date";
}

export function kpiYAxisLabel(name: string, settings: KpiSettingRow[]) {
  const setting = kpiSettingForName(settings, name);
  return setting?.y_axis_label || setting?.display_unit || name;
}

export function kpiPreferredChartType(name: string, settings: KpiSettingRow[]) {
  const value = kpiSettingForName(settings, name)?.preferred_chart_type;
  return value === "bar" || value === "mixed" ? value : "line";
}

export function configuredKpiTarget(name: string, settings: KpiSettingRow[]) {
  const target = kpiSettingForName(settings, name)?.target;
  return target === undefined ? null : target;
}

export function kpiColorMayBeLowContrast(value: string | null | undefined) {
  return value === "#0B1F4D";
}

export function getConfiguredMetricNames<T extends { name: string }>(rows: T[], settings: KpiSettingRow[], includeHidden = false) {
  const namesByNormalizedLabel = new Map<string, string>();
  for (const row of rows) {
    const normalized = normalizeKpiName(row.name);
    if (normalized && !namesByNormalizedLabel.has(normalized)) namesByNormalizedLabel.set(normalized, row.name);
  }
  const names = [...namesByNormalizedLabel.values()];

  return names
    .filter((name) => includeHidden || isKpiVisible(name, settings))
    .sort((a, b) => {
      const aSetting = kpiSettingForName(settings, a);
      const bSetting = kpiSettingForName(settings, b);
      const sortDelta = (aSetting?.sort_order ?? 0) - (bSetting?.sort_order ?? 0);

      return sortDelta || kpiWeight(b, settings) - kpiWeight(a, settings) || a.localeCompare(b);
    });
}

export function applyKpiSettingsToRows<T extends { name: string; target: number | null; category?: string | null }>(
  rows: T[],
  settings: KpiSettingRow[],
  options: { includeHidden?: boolean } = {}
) {
  const byName = kpiSettingsByName(settings);

  return rows
    .filter((row) => options.includeHidden || byName.get(normalizeKpiName(row.name))?.is_visible !== false)
    .map((row) => {
      const setting = byName.get(normalizeKpiName(row.name));

      if (!setting) {
        return row;
      }

      return {
        ...row,
        category: setting.category || row.category || null,
        target: setting.target ?? row.target
      };
    });
}

export function sortKpiRowsBySettings<T extends { name: string; metric_date: string; created_at: string }>(
  rows: T[],
  settings: KpiSettingRow[]
) {
  return [...rows].sort((a, b) => {
    const weightDelta = kpiWeight(b.name, settings) - kpiWeight(a.name, settings);

    return weightDelta || b.metric_date.localeCompare(a.metric_date) || b.created_at.localeCompare(a.created_at);
  });
}
