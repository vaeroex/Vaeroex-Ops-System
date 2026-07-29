import type { Database } from "@/lib/supabase/types";
import { kpiMeasurementAgeDays, kpiMeasurementFreshness } from "@/lib/kpis/freshness";
import {
  getConfiguredMetricNames,
  kpiSemantics,
  kpiSettingForName,
  normalizeKpiName,
  type KpiSettingRow
} from "@/lib/kpis/settings";
import {
  evaluateKpiPerformance,
  recommendKpiTarget,
  resolveKpiTargetReference
} from "@/lib/kpis/semantics";
import type {
  KpiObservationPointV1,
  KpiProducerMetricV1,
  KpiProducerOutputV1
} from "@/lib/intelligence/snapshot/v1/types";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];

function compareRowsOldest(left: KpiRow, right: KpiRow) {
  return left.metric_date.localeCompare(right.metric_date)
    || left.created_at.localeCompare(right.created_at)
    || left.id.localeCompare(right.id);
}

function boundedObservations(points: KpiObservationPointV1[]) {
  if (points.length <= 6) return points;
  return [points[0], ...points.slice(-5)];
}

export function buildCanonicalKpiProducerOutputV1({
  workspaceId,
  rows,
  settings,
  asOf
}: {
  workspaceId: string;
  rows: KpiRow[];
  settings: KpiSettingRow[];
  asOf: string;
}): KpiProducerOutputV1 {
  const evaluationDate = new Date(asOf);
  if (!Number.isFinite(evaluationDate.getTime())) throw new Error("Canonical KPI producer asOf must be a valid timestamp.");
  if (rows.some((row) => row.workspace_id !== workspaceId)) {
    throw new Error("Canonical KPI producer received a row from another workspace.");
  }
  if (settings.some((setting) => setting.workspace_id !== workspaceId)) {
    throw new Error("Canonical KPI producer received settings from another workspace.");
  }

  return getConfiguredMetricNames(rows, settings, true).map((metricName) => {
    const metricRows = rows
      .filter((row) => normalizeKpiName(row.name) === normalizeKpiName(metricName))
      .sort(compareRowsOldest);
    const latest = metricRows.at(-1);
    if (!latest) throw new Error(`Canonical KPI ${metricName} has no source row.`);
    const setting = kpiSettingForName(settings, metricName);
    const semantics = kpiSemantics(metricName, settings);
    const manualTarget = setting?.target ?? latest.target ?? null;
    const points = metricRows.flatMap((row) => row.actual_value === null ? [] : [{
      observationId: row.id,
      observedAt: row.metric_date,
      value: row.actual_value
    } satisfies KpiObservationPointV1]);
    const latestPoint = points.at(-1) || null;
    const selected = boundedObservations(points);

    return {
      id: latest.id,
      workspaceId,
      semantics,
      manualTarget,
      configuredSemanticTarget: resolveKpiTargetReference(semantics),
      effectiveAuthoritativeTarget: resolveKpiTargetReference(semantics, manualTarget),
      evaluation: evaluateKpiPerformance({ observations: metricRows, semantics, target: manualTarget }),
      recommendation: recommendKpiTarget({ observations: metricRows, semantics }),
      observations: {
        current: latestPoint,
        previous: points.at(-2) || null,
        rangeStart: points[0] || null,
        selectedRange: {
          startAt: points[0]?.observedAt || null,
          endAt: latestPoint?.observedAt || null,
          totalObservationCount: points.length,
          boundedObservations: selected
        }
      },
      freshness: {
        status: kpiMeasurementFreshness(latestPoint?.observedAt, evaluationDate),
        ageDays: kpiMeasurementAgeDays(latestPoint?.observedAt, evaluationDate),
        latestMeasurementAt: latestPoint?.observedAt || null
      },
      evidenceReferenceIds: []
    } satisfies KpiProducerMetricV1;
  });
}
