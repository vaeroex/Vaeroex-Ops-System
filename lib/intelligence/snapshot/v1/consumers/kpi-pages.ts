import "server-only";

import type { Database } from "@/lib/supabase/types";
import { canonicalSnapshotJson } from "@/lib/intelligence/snapshot/v1/canonical";
import type { KpiCompareProjectionV1, KpiPageProjectionV1 } from "@/lib/intelligence/snapshot/v1/projections";
import type { KpiSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";
import {
  kpiSemantics,
  kpiSettingForName,
  normalizeKpiName,
  type KpiSettingRow
} from "@/lib/kpis/settings";
import {
  evaluateKpiPerformance,
  recommendKpiTarget,
  resolveKpiTargetReference,
  type KpiPerformanceEvaluation,
  type KpiSemantics,
  type KpiTargetRecommendation,
  type KpiTargetReference
} from "@/lib/kpis/semantics";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
export type KpiConsumerToneV1 = "green" | "yellow" | "red" | "neutral";

export type KpiPageConsumerStateV1 = Readonly<{
  kpiId: string;
  metricName: string;
  semantics: KpiSemantics;
  manualTarget: number | null;
  targetReference: KpiTargetReference;
  evaluation: KpiPerformanceEvaluation;
  recommendation: KpiTargetRecommendation;
  tone: KpiConsumerToneV1;
  statusText: "On Track" | "Near Target" | "Behind" | "Direction not set" | "Target not set" | "Missing Data";
}>;

function rowsForMetric(rows: KpiRow[], metricName: string) {
  return rows
    .filter((row) => normalizeKpiName(row.name) === normalizeKpiName(metricName))
    .sort((left, right) => left.metric_date.localeCompare(right.metric_date)
      || left.created_at.localeCompare(right.created_at)
      || left.id.localeCompare(right.id));
}

function toneForEvaluation(actualValue: number | null, evaluation: KpiPerformanceEvaluation): KpiConsumerToneV1 {
  if (actualValue === null || evaluation.targetStatus === "direction_unknown" || evaluation.targetStatus === "no_target") return "neutral";
  if (evaluation.targetStatus === "achieved" || evaluation.targetStatus === "within_range") return "green";
  if (evaluation.targetStatus === "moving_toward_target") return "yellow";
  return "red";
}

function pointInTimeTone({
  actualValue,
  semantics,
  manualTarget
}: {
  actualValue: number | null;
  semantics: KpiSemantics;
  manualTarget: number | null;
}): KpiConsumerToneV1 {
  if (actualValue === null || semantics.desiredDirection === "unknown") return "neutral";
  return toneForEvaluation(
    actualValue,
    evaluateKpiPerformance({ observations: [{ actual_value: actualValue }], semantics, target: manualTarget })
  );
}

function statusText({
  actualValue,
  semantics,
  targetReference,
  tone
}: {
  actualValue: number | null;
  semantics: KpiSemantics;
  targetReference: KpiTargetReference;
  tone: KpiConsumerToneV1;
}): KpiPageConsumerStateV1["statusText"] {
  if (actualValue === null) return "Missing Data";
  if (semantics.desiredDirection === "unknown") return "Direction not set";
  if (targetReference.kind === "none") return "Target not set";
  if (tone === "green") return "On Track";
  if (tone === "yellow") return "Near Target";
  return "Behind";
}

function stateTarget(value: KpiSnapshotV1["effectiveAuthoritativeTarget"]): KpiTargetReference {
  return value.state === "available" ? value.value : { kind: "none" };
}

function stateManualTarget(value: KpiSnapshotV1["manualTarget"]) {
  return value.state === "available" ? value.value.value : null;
}

function projectedSemantics(snapshot: KpiSnapshotV1, legacy: KpiSemantics): KpiSemantics {
  if (snapshot.semantics.state !== "available") {
    if (legacy.desiredDirection !== "unknown") throw new Error(`KPI ${snapshot.id} semantics are missing from IntelligenceSnapshotV1.`);
    return legacy;
  }
  const projected = snapshot.semantics.value;
  const legacyCanonical = {
    desiredDirection: legacy.desiredDirection,
    targetBehavior: legacy.targetBehavior,
    idealValue: legacy.idealValue,
    idealRangeMin: legacy.idealRangeMin,
    idealRangeMax: legacy.idealRangeMax,
    classificationSource: legacy.classificationSource,
    classificationConfidence: legacy.classificationConfidence,
    classificationConfirmed: legacy.classificationConfirmed
  };
  if (canonicalSnapshotJson(projected) !== canonicalSnapshotJson(legacyCanonical)) {
    throw new Error(`KPI ${snapshot.id} semantics disagree with IntelligenceSnapshotV1.`);
  }
  return { ...legacy, ...projected };
}

function projectedEvaluation(snapshot: KpiSnapshotV1, legacy: KpiPerformanceEvaluation) {
  if (snapshot.performance.state !== "available") {
    if (legacy.targetStatus !== "direction_unknown") throw new Error(`KPI ${snapshot.id} performance is missing from IntelligenceSnapshotV1.`);
    return legacy;
  }
  if (canonicalSnapshotJson(snapshot.performance.value) !== canonicalSnapshotJson(legacy)) {
    throw new Error(`KPI ${snapshot.id} performance disagrees with IntelligenceSnapshotV1.`);
  }
  return { ...snapshot.performance.value };
}

function assertRecommendation(snapshot: KpiSnapshotV1, recommendation: KpiTargetRecommendation) {
  const projected = snapshot.recommendedNextTarget;
  if (projected.state !== "available") {
    if (recommendation.confidence !== "Unavailable") {
      throw new Error(`KPI ${snapshot.id} recommendation availability disagrees with IntelligenceSnapshotV1.`);
    }
    return;
  }
  const target = projected.value.target;
  const expectedTarget = recommendation.range
    ? { kind: "range", min: recommendation.range.min, max: recommendation.range.max }
    : recommendation.value === null
      ? null
      : { kind: "scalar", value: recommendation.value };
  if (canonicalSnapshotJson({
    target,
    confidence: projected.value.confidence,
    outlierCount: projected.value.outlierCount
  }) !== canonicalSnapshotJson({
    target: expectedTarget,
    confidence: recommendation.confidence,
    outlierCount: recommendation.outliers
  })) {
    throw new Error(`KPI ${snapshot.id} recommendation disagrees with IntelligenceSnapshotV1.`);
  }
}

export function materializeKpiPageStateV1({
  snapshot,
  rows,
  settings
}: {
  snapshot: KpiSnapshotV1;
  rows: KpiRow[];
  settings: KpiSettingRow[];
}): KpiPageConsumerStateV1 {
  const snapshotRow = rows.find((row) => row.id === snapshot.id);
  if (!snapshotRow) throw new Error(`KPI ${snapshot.id} does not resolve to its authoritative source row.`);
  const metricName = snapshotRow.name;
  const metricRows = rowsForMetric(rows, metricName);
  const latest = metricRows.at(-1);
  if (!latest || latest.id !== snapshot.id) throw new Error(`KPI ${snapshot.id} source identity does not resolve to its latest row.`);
  const legacySemantics = kpiSemantics(metricName, settings);
  const expectedIdentity = {
    canonicalName: legacySemantics.canonicalName,
    displayName: legacySemantics.displayName,
    originalSourceLabel: legacySemantics.originalSourceLabel,
    unit: legacySemantics.unit,
    scale: legacySemantics.scale,
    metricRole: legacySemantics.metricRole
  };
  if (canonicalSnapshotJson(snapshot.identity) !== canonicalSnapshotJson(expectedIdentity)) {
    throw new Error(`KPI ${snapshot.id} presentation identity disagrees with its authoritative source row.`);
  }
  const semantics = projectedSemantics(snapshot, legacySemantics);
  const legacyManualTarget = kpiSettingForName(settings, metricName)?.target ?? latest.target ?? null;
  const manualTarget = stateManualTarget(snapshot.manualTarget);
  if (manualTarget !== legacyManualTarget) throw new Error(`KPI ${snapshot.id} manual target disagrees with IntelligenceSnapshotV1.`);
  const legacyTarget = resolveKpiTargetReference(legacySemantics, legacyManualTarget);
  const targetReference = stateTarget(snapshot.effectiveAuthoritativeTarget);
  if (canonicalSnapshotJson(targetReference) !== canonicalSnapshotJson(legacyTarget)) {
    throw new Error(`KPI ${snapshot.id} effective target disagrees with IntelligenceSnapshotV1.`);
  }
  const legacyEvaluation = evaluateKpiPerformance({ observations: metricRows, semantics: legacySemantics, target: legacyManualTarget });
  const evaluation = projectedEvaluation(snapshot, legacyEvaluation);
  const recommendation = recommendKpiTarget({ observations: metricRows, semantics: legacySemantics });
  assertRecommendation(snapshot, recommendation);
  const tone = pointInTimeTone({ actualValue: latest.actual_value, semantics, manualTarget });

  return {
    kpiId: snapshot.id,
    metricName,
    semantics,
    manualTarget,
    targetReference,
    evaluation,
    recommendation,
    tone,
    statusText: statusText({ actualValue: latest.actual_value, semantics, targetReference, tone })
  };
}

export function buildLegacyKpiPageStateV1({
  metricName,
  rows,
  settings
}: {
  metricName: string;
  rows: KpiRow[];
  settings: KpiSettingRow[];
}): KpiPageConsumerStateV1 {
  const metricRows = rowsForMetric(rows, metricName);
  const latest = metricRows.at(-1);
  if (!latest) throw new Error(`KPI ${metricName} has no presentation row.`);
  const semantics = kpiSemantics(metricName, settings);
  const manualTarget = kpiSettingForName(settings, metricName)?.target ?? latest.target ?? null;
  const targetReference = resolveKpiTargetReference(semantics, manualTarget);
  const evaluation = evaluateKpiPerformance({ observations: metricRows, semantics, target: manualTarget });
  const recommendation = recommendKpiTarget({ observations: metricRows, semantics });
  const tone = pointInTimeTone({ actualValue: latest.actual_value, semantics, manualTarget });

  return {
    kpiId: latest.id,
    metricName,
    semantics,
    manualTarget,
    targetReference,
    evaluation,
    recommendation,
    tone,
    statusText: statusText({ actualValue: latest.actual_value, semantics, targetReference, tone })
  };
}

export function buildKpiPageStatesFromSnapshotV1({
  projection,
  rows,
  settings
}: {
  projection: KpiPageProjectionV1;
  rows: KpiRow[];
  settings: KpiSettingRow[];
}) {
  const states = projection.kpis.map((snapshot) => materializeKpiPageStateV1({ snapshot, rows, settings }));
  const byName = new Map(states.map((state) => [normalizeKpiName(state.metricName), state]));
  if (byName.size !== states.length) throw new Error("KPI page projection contains duplicate customer-facing identities.");
  return { states, byName };
}

export function buildKpiCompareStatesFromSnapshotV1({
  projection,
  rows,
  settings
}: {
  projection: KpiCompareProjectionV1;
  rows: KpiRow[];
  settings: KpiSettingRow[];
}) {
  const states = projection.kpis.map((snapshot) => materializeKpiPageStateV1({ snapshot, rows, settings }));
  const byName = new Map(states.map((state) => [normalizeKpiName(state.metricName), state]));
  if (byName.size !== states.length) throw new Error("KPI compare projection contains duplicate customer-facing identities.");
  return { states, byName };
}
