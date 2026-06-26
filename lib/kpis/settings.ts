import type { Database } from "@/lib/supabase/types";

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

const DEFAULT_KPI_COLOR = KPI_COLOR_PALETTE[0].value;
const AUTO_KPI_COLOR_PALETTE = KPI_COLOR_PALETTE.filter((color) => color.value !== "#0B1F4D");

export function normalizeKpiName(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function approvedKpiColor(value: string | null | undefined): string {
  const match = KPI_COLOR_PALETTE.find((color) => color.value === value);
  return match?.value || DEFAULT_KPI_COLOR;
}

export function kpiSettingsByName(settings: KpiSettingRow[]) {
  return new Map(settings.map((setting) => [normalizeKpiName(setting.kpi_name), setting]));
}

export function kpiSettingForName(settings: KpiSettingRow[], name: string | null | undefined) {
  return kpiSettingsByName(settings).get(normalizeKpiName(name));
}

export function kpiColor(name: string, settings: KpiSettingRow[], fallbackIndex = 0): string {
  const setting = kpiSettingForName(settings, name);

  if (setting?.color) {
    return approvedKpiColor(setting.color);
  }

  return AUTO_KPI_COLOR_PALETTE[fallbackIndex % AUTO_KPI_COLOR_PALETTE.length]?.value || DEFAULT_KPI_COLOR;
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
  const names = Array.from(new Set(rows.map((row) => row.name).filter(Boolean)));

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
