import { available, unavailable } from "@/lib/intelligence/snapshot/v1/state";
import type {
  KpiProducerMetricV1,
  KpiProducerOutputV1,
  KpiRecommendedTargetV1,
  KpiSnapshotV1,
  SnapshotState
} from "@/lib/intelligence/snapshot/v1/types";

function targetState(target: KpiProducerMetricV1["configuredSemanticTarget"]): KpiSnapshotV1["configuredSemanticTarget"] {
  return target.kind === "none"
    ? unavailable("unavailable", "target_not_configured")
    : available(target);
}

function effectiveTargetState(target: KpiProducerMetricV1["effectiveAuthoritativeTarget"]): KpiSnapshotV1["effectiveAuthoritativeTarget"] {
  return target.kind === "none"
    ? unavailable("unavailable", "target_not_configured")
    : available(target);
}

function recommendationTarget(metric: KpiProducerMetricV1): SnapshotState<Readonly<{
  target: KpiRecommendedTargetV1;
  confidence: "Higher" | "Medium" | "Low";
  outlierCount: number;
}>> {
  if (metric.semantics.desiredDirection === "unknown") {
    return unavailable("unknown_semantics", "semantic_direction_unknown");
  }
  if (metric.recommendation.confidence === "Unavailable") {
    return unavailable("unavailable", "recommendation_not_available");
  }
  if (metric.recommendation.range) {
    return available({
      target: { kind: "range", min: metric.recommendation.range.min, max: metric.recommendation.range.max },
      confidence: metric.recommendation.confidence,
      outlierCount: metric.recommendation.outliers
    });
  }
  if (metric.recommendation.value !== null) {
    return available({
      target: { kind: "scalar", value: metric.recommendation.value },
      confidence: metric.recommendation.confidence,
      outlierCount: metric.recommendation.outliers
    });
  }
  return unavailable("unavailable", "recommendation_not_available");
}

function adaptMetric(metric: KpiProducerMetricV1): KpiSnapshotV1 {
  const semantics = metric.semantics.desiredDirection === "unknown"
    ? unavailable<KpiSnapshotV1["semantics"] extends SnapshotState<infer T> ? T : never>(
      "unknown_semantics",
      "semantic_direction_unknown"
    )
    : available({
      desiredDirection: metric.semantics.desiredDirection,
      targetBehavior: metric.semantics.targetBehavior,
      idealValue: metric.semantics.idealValue,
      idealRangeMin: metric.semantics.idealRangeMin,
      idealRangeMax: metric.semantics.idealRangeMax,
      classificationSource: metric.semantics.classificationSource,
      classificationConfidence: metric.semantics.classificationConfidence,
      classificationConfirmed: metric.semantics.classificationConfirmed
    });
  const performance = metric.semantics.desiredDirection === "unknown"
    ? unavailable<KpiSnapshotV1["performance"] extends SnapshotState<infer T> ? T : never>(
      "unknown_semantics",
      "semantic_direction_unknown"
    )
    : available({ ...metric.evaluation });
  const recommendation = recommendationTarget(metric);

  return {
    id: metric.id,
    identity: {
      canonicalName: metric.semantics.canonicalName,
      displayName: metric.semantics.displayName,
      originalSourceLabel: metric.semantics.originalSourceLabel,
      unit: metric.semantics.unit,
      scale: metric.semantics.scale,
      metricRole: metric.semantics.metricRole
    },
    semantics,
    manualTarget: metric.manualTarget === null
      ? unavailable("not_applicable", "target_not_configured")
      : available({ value: metric.manualTarget }),
    configuredSemanticTarget: targetState(metric.configuredSemanticTarget),
    effectiveAuthoritativeTarget: effectiveTargetState(metric.effectiveAuthoritativeTarget),
    recommendationAvailability: recommendation.state === "available" ? "available" : "unavailable",
    recommendedNextTarget: recommendation,
    observations: {
      current: metric.observations.current ? { ...metric.observations.current } : null,
      previous: metric.observations.previous ? { ...metric.observations.previous } : null,
      rangeStart: metric.observations.rangeStart ? { ...metric.observations.rangeStart } : null,
      selectedRange: {
        ...metric.observations.selectedRange,
        boundedObservations: metric.observations.selectedRange.boundedObservations.map((observation) => ({ ...observation }))
      }
    },
    performance,
    freshness: available({ ...metric.freshness }),
    evidenceReferenceIds: [...metric.evidenceReferenceIds]
  };
}

export function adaptKpiProducerOutputV1(output: KpiProducerOutputV1) {
  return output.map(adaptMetric);
}
