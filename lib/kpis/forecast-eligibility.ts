import type { Database } from "@/lib/supabase/types";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];

export type KpiForecastReadinessState =
  | "ready"
  | "directional_only"
  | "building_history"
  | "stale_data"
  | "insufficient_historical_measurements"
  | "no_kpi_data";

export type KpiForecastMetricStatus = {
  name: string;
  state: KpiForecastReadinessState;
  measurementCount: number;
  distinctMeasurementDates: number;
  firstMeasurementDate: string | null;
  latestMeasurementDate: string | null;
  latestActualValue: number | null;
  latestTarget: number | null;
  isFresh: boolean;
  ageDays: number | null;
};

export type KpiForecastEligibilitySummary = {
  state: KpiForecastReadinessState;
  label: string;
  reason: string;
  ready: boolean;
  directional: boolean;
  currentKpiCount: number;
  totalMeasurementCount: number;
  readyKpiCount: number;
  directionalKpiCount: number;
  staleKpiCount: number;
  kpisWithHistoryCount: number;
  freshKpiCount: number;
  minimumPeriods: number;
  directionalPeriods: number;
  freshnessDays: number;
  currentAvailabilityLabel: string;
  historicalDepthLabel: string;
  freshnessLabel: string;
  metrics: KpiForecastMetricStatus[];
};

type ForecastOptions = {
  now?: Date | string;
  minimumPeriods?: number;
  directionalPeriods?: number;
  freshnessDays?: number;
};

function dateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : null;
}

function parseDate(value: string | null | undefined) {
  const date = value ? new Date(`${dateOnly(value)}T12:00:00.000Z`) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function daysBetween(later: Date, earlier: Date) {
  return Math.floor((later.getTime() - earlier.getTime()) / 86400000);
}

function normalizeName(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function latestByDate(rows: KpiRow[]) {
  return [...rows].sort((a, b) => {
    const dateDelta = (dateOnly(b.metric_date) || "").localeCompare(dateOnly(a.metric_date) || "");
    if (dateDelta) return dateDelta;
    return (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || "");
  })[0];
}

function activeKpiRows(rows: KpiRow[]) {
  return rows.filter((row) => !row.archived_at && !row.deleted_at && normalizeName(row.name));
}

export function buildKpiForecastEligibility(rows: KpiRow[], options: ForecastOptions = {}): KpiForecastEligibilitySummary {
  const now = typeof options.now === "string" ? new Date(options.now) : options.now || new Date();
  const referenceDate = Number.isNaN(now.getTime()) ? new Date() : now;
  const minimumPeriods = options.minimumPeriods ?? 4;
  const directionalPeriods = options.directionalPeriods ?? 2;
  const freshnessDays = options.freshnessDays ?? 45;
  const grouped = new Map<string, KpiRow[]>();

  for (const row of activeKpiRows(rows)) {
    const key = normalizeName(row.name);
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }

  const metrics = Array.from(grouped.values()).map<KpiForecastMetricStatus>((metricRows) => {
    const latest = latestByDate(metricRows);
    const measurementRows = metricRows.filter((row) => row.actual_value !== null && parseDate(row.metric_date));
    const measurementDates = Array.from(new Set(measurementRows.map((row) => dateOnly(row.metric_date)).filter((value): value is string => Boolean(value)))).sort();
    const latestMeasurementDate = measurementDates.at(-1) || null;
    const latestMeasurement = latestByDate(measurementRows);
    const latestDate = parseDate(latestMeasurementDate);
    const ageDays = latestDate ? daysBetween(referenceDate, latestDate) : null;
    const isFresh = ageDays !== null && ageDays <= freshnessDays;
    let state: KpiForecastReadinessState = "building_history";

    if (!measurementRows.length) {
      state = "insufficient_historical_measurements";
    } else if (!isFresh) {
      state = "stale_data";
    } else if (measurementDates.length >= minimumPeriods) {
      state = "ready";
    } else if (measurementDates.length >= directionalPeriods) {
      state = "directional_only";
    }

    return {
      name: latest?.name || metricRows[0]?.name || "KPI",
      state,
      measurementCount: measurementRows.length,
      distinctMeasurementDates: measurementDates.length,
      firstMeasurementDate: measurementDates[0] || null,
      latestMeasurementDate,
      latestActualValue: latestMeasurement?.actual_value ?? latest?.actual_value ?? null,
      latestTarget: latestMeasurement?.target ?? latest?.target ?? null,
      isFresh,
      ageDays
    };
  });

  const currentKpiCount = metrics.length;
  const totalMeasurementCount = metrics.reduce((count, metric) => count + metric.measurementCount, 0);
  const readyKpiCount = metrics.filter((metric) => metric.state === "ready").length;
  const directionalKpiCount = metrics.filter((metric) => metric.state === "directional_only").length;
  const staleKpiCount = metrics.filter((metric) => metric.state === "stale_data").length;
  const kpisWithHistoryCount = metrics.filter((metric) => metric.distinctMeasurementDates >= directionalPeriods).length;
  const freshKpiCount = metrics.filter((metric) => metric.isFresh).length;
  const kpiNoun = currentKpiCount === 1 ? "KPI" : "KPIs";
  const currentAvailabilityLabel = currentKpiCount
    ? `${currentKpiCount} current ${kpiNoun} available`
    : "No current KPI data available";
  const historicalDepthLabel = currentKpiCount
    ? `${kpisWithHistoryCount} of ${currentKpiCount} ${kpiNoun} have at least ${directionalPeriods} dated measurements`
    : "No historical KPI measurements yet";
  const freshnessLabel = currentKpiCount
    ? `${freshKpiCount} of ${currentKpiCount} ${kpiNoun} updated within ${freshnessDays} days`
    : "No KPI freshness signal yet";

  if (!currentKpiCount) {
    return {
      state: "no_kpi_data",
      label: "No KPI data",
      reason: "No KPI records are available yet. Add current KPI values first, then build dated history before relying on forecasts.",
      ready: false,
      directional: false,
      currentKpiCount,
      totalMeasurementCount,
      readyKpiCount,
      directionalKpiCount,
      staleKpiCount,
      kpisWithHistoryCount,
      freshKpiCount,
      minimumPeriods,
      directionalPeriods,
      freshnessDays,
      currentAvailabilityLabel,
      historicalDepthLabel,
      freshnessLabel,
      metrics
    };
  }

  if (!totalMeasurementCount) {
    return {
      state: "insufficient_historical_measurements",
      label: "Insufficient historical measurements",
      reason: `${currentAvailabilityLabel}, but reliable forecasting requires dated actual values across multiple time periods.`,
      ready: false,
      directional: false,
      currentKpiCount,
      totalMeasurementCount,
      readyKpiCount,
      directionalKpiCount,
      staleKpiCount,
      kpisWithHistoryCount,
      freshKpiCount,
      minimumPeriods,
      directionalPeriods,
      freshnessDays,
      currentAvailabilityLabel,
      historicalDepthLabel,
      freshnessLabel,
      metrics
    };
  }

  if (readyKpiCount) {
    const remaining = currentKpiCount - readyKpiCount;

    return {
      state: "ready",
      label: readyKpiCount === currentKpiCount ? "Forecasting ready" : `Forecasting ready for ${readyKpiCount} of ${currentKpiCount} KPIs`,
      reason: remaining
        ? `${currentAvailabilityLabel}. ${readyKpiCount} ${readyKpiCount === 1 ? "KPI has" : "KPIs have"} enough fresh history for forecast support; ${remaining} ${remaining === 1 ? "KPI still needs" : "KPIs still need"} more dated measurements or newer values.`
        : `${currentAvailabilityLabel}. Each active KPI has enough recent dated history for responsible directional forecasting.`,
      ready: true,
      directional: true,
      currentKpiCount,
      totalMeasurementCount,
      readyKpiCount,
      directionalKpiCount,
      staleKpiCount,
      kpisWithHistoryCount,
      freshKpiCount,
      minimumPeriods,
      directionalPeriods,
      freshnessDays,
      currentAvailabilityLabel,
      historicalDepthLabel,
      freshnessLabel,
      metrics
    };
  }

  if (directionalKpiCount) {
    return {
      state: "directional_only",
      label: "Directional only",
      reason: `${currentAvailabilityLabel}. Forecasting should stay directional because KPI history is useful but not deep enough for stronger predictions yet.`,
      ready: false,
      directional: true,
      currentKpiCount,
      totalMeasurementCount,
      readyKpiCount,
      directionalKpiCount,
      staleKpiCount,
      kpisWithHistoryCount,
      freshKpiCount,
      minimumPeriods,
      directionalPeriods,
      freshnessDays,
      currentAvailabilityLabel,
      historicalDepthLabel,
      freshnessLabel,
      metrics
    };
  }

  if (staleKpiCount === currentKpiCount) {
    return {
      state: "stale_data",
      label: "Stale data",
      reason: `${currentAvailabilityLabel}, but the latest KPI measurements are older than ${freshnessDays} days. Update current values before using forecasts.`,
      ready: false,
      directional: false,
      currentKpiCount,
      totalMeasurementCount,
      readyKpiCount,
      directionalKpiCount,
      staleKpiCount,
      kpisWithHistoryCount,
      freshKpiCount,
      minimumPeriods,
      directionalPeriods,
      freshnessDays,
      currentAvailabilityLabel,
      historicalDepthLabel,
      freshnessLabel,
      metrics
    };
  }

  return {
    state: "building_history",
    label: "Building history",
    reason: `${currentAvailabilityLabel}. Vaeroex can describe current KPI performance, but forecasting is still building history because most KPIs need measurements across multiple dates.`,
    ready: false,
    directional: false,
    currentKpiCount,
    totalMeasurementCount,
    readyKpiCount,
    directionalKpiCount,
    staleKpiCount,
    kpisWithHistoryCount,
    freshKpiCount,
    minimumPeriods,
    directionalPeriods,
    freshnessDays,
    currentAvailabilityLabel,
    historicalDepthLabel,
    freshnessLabel,
    metrics
  };
}
