import type { KpiSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";

export const SPATIAL_KPI_PRESENTATION_V1 = "spatial_kpi_presentation_v1" as const;

export type SpatialKpiPointV1 = Readonly<{
  id: string;
  observedAt: string;
  value: number;
  position: readonly [number, number, 0];
}>;

export type SpatialKpiTargetV1 = Readonly<{
  kind: "scalar" | "range";
  source: "manual" | "semantic";
  minimumValue: number;
  maximumValue: number;
  minimumY: number;
  maximumY: number;
}>;

export type SpatialKpiSceneModelV1 = Readonly<{
  contract: typeof SPATIAL_KPI_PRESENTATION_V1;
  sourceContract: "intelligence_snapshot_v1";
  kpiId: string;
  label: string;
  unit: string | null;
  minimumValue: number;
  maximumValue: number;
  points: readonly SpatialKpiPointV1[];
  target: SpatialKpiTargetV1 | null;
}>;

export function buildSpatialKpiSceneModelV1(kpi: KpiSnapshotV1): SpatialKpiSceneModelV1 {
  const observations = kpi.observations.selectedRange.boundedObservations;
  const targetReference = kpi.effectiveAuthoritativeTarget.state === "available"
    ? kpi.effectiveAuthoritativeTarget.value
    : null;
  const targetValues = targetReference?.kind === "scalar"
    ? [targetReference.value]
    : targetReference?.kind === "range"
      ? [targetReference.min, targetReference.max]
      : [];
  const values = [...observations.map((point) => point.value), ...targetValues];
  const minimumValue = values.length ? Math.min(...values) : 0;
  const maximumValue = values.length ? Math.max(...values) : 0;
  const valueRange = maximumValue - minimumValue;
  const valueToY = (value: number) => valueRange === 0 ? 0 : -2.2 + ((value - minimumValue) / valueRange) * 4.4;
  const points = observations.map((point, index) => ({
    id: point.observationId,
    observedAt: point.observedAt,
    value: point.value,
    position: [
      observations.length <= 1 ? 0 : -4.6 + (index / (observations.length - 1)) * 9.2,
      valueToY(point.value),
      0
    ] as const
  }));
  const target = targetReference?.kind === "scalar"
    ? {
        kind: "scalar" as const,
        source: targetReference.source,
        minimumValue: targetReference.value,
        maximumValue: targetReference.value,
        minimumY: valueToY(targetReference.value),
        maximumY: valueToY(targetReference.value)
      }
    : targetReference?.kind === "range"
      ? {
          kind: "range" as const,
          source: targetReference.source,
          minimumValue: targetReference.min,
          maximumValue: targetReference.max,
          minimumY: valueToY(targetReference.min),
          maximumY: valueToY(targetReference.max)
        }
      : null;

  return Object.freeze({
    contract: SPATIAL_KPI_PRESENTATION_V1,
    sourceContract: "intelligence_snapshot_v1",
    kpiId: kpi.id,
    label: kpi.identity.displayName,
    unit: kpi.identity.unit,
    minimumValue,
    maximumValue,
    points: Object.freeze(points),
    target
  });
}
