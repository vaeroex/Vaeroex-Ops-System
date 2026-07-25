import "server-only";

import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import {
  EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
  EXECUTIVE_KPI_ANALYSIS_CONTRACT_VERSION,
  EXECUTIVE_KPI_ANALYSIS_VALIDATOR_VERSION,
  type ExecutiveKpiAnalysisPackage,
  type ExecutiveKpiMetricFact,
  type ExecutiveKpiRelationshipFact
} from "@/lib/ai/executive-kpi-analysis/contracts";

const STALE_AFTER_DAYS = 45;
const MAX_OBSERVATIONS_PER_KPI = 24;

export type ExecutiveKpiAnalysisInputTrend = Readonly<{
  name: string;
  directionality: "higher" | "lower" | "exact" | null;
  rows: readonly Readonly<{
    id: string;
    actualValue: number | null;
    targetValue: number | null;
    observedAt: string;
    sourceFileId: string | null;
    sourceLabel: string | null;
  }>[];
}>;

function rounded(value: number) {
  return Number(value.toFixed(6));
}

function normalizedValue(value: number, values: readonly number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return max === min ? 50 : rounded(((value - min) / (max - min)) * 100);
}

function percentageChange(first: number, latest: number) {
  return first === 0 ? null : rounded(((latest - first) / Math.abs(first)) * 100);
}

function trendDirection(change: number | null): ExecutiveKpiMetricFact["trendDirection"] {
  if (change === null) return "insufficient_history";
  if (Math.abs(change) < 0.000001) return "flat";
  return change > 0 ? "up" : "down";
}

function freshness(latestObservedAt: string | null, now: Date): ExecutiveKpiMetricFact["freshness"] {
  if (!latestObservedAt) return "unavailable";
  const time = Date.parse(`${latestObservedAt}T12:00:00.000Z`);
  if (!Number.isFinite(time)) return "unavailable";
  return Math.floor((now.getTime() - time) / 86_400_000) > STALE_AFTER_DAYS ? "stale" : "current";
}

function directionality(value: ExecutiveKpiAnalysisInputTrend["directionality"]): ExecutiveKpiMetricFact["directionality"] {
  if (value === "higher") return "higher_is_better";
  if (value === "lower") return "lower_is_better";
  if (value === "exact") return "exact_target";
  return "neutral_contextual";
}

function movementRelationship(left: ExecutiveKpiMetricFact, right: ExecutiveKpiMetricFact): ExecutiveKpiRelationshipFact {
  const usable = left.trendDirection !== "insufficient_history"
    && right.trendDirection !== "insufficient_history"
    && left.trendDirection !== "flat"
    && right.trendDirection !== "flat";
  return {
    leftOrdinal: left.ordinal,
    rightOrdinal: right.ordinal,
    status: usable ? "observed_movement_only" : "not_established",
    movement: !usable
      ? "not_established"
      : left.trendDirection === right.trendDirection
        ? "same_direction"
        : "opposite_direction",
    correlationCoefficient: null,
    significanceThreshold: null,
    causationEstablished: false
  };
}

function deterministicNote(metric: ExecutiveKpiMetricFact) {
  if (metric.percentageChange === null) return `${metric.name} does not have enough comparable history to calculate percentage movement.`;
  const movement = metric.percentageChange > 0 ? "up" : metric.percentageChange < 0 ? "down" : "flat";
  const directionNote = metric.directionality === "neutral_contextual"
    ? " Whether that movement is favorable depends on how this KPI is configured."
    : "";
  return `${metric.name} is ${movement} ${Math.abs(metric.percentageChange)}% across the selected timeframe.${directionNote}`;
}

export function buildExecutiveKpiAnalysisPackage({
  workspaceId,
  trends,
  mode,
  timeframe,
  startDate,
  endDate,
  confidenceLabel,
  confidenceScore,
  limitations,
  now = new Date()
}: {
  workspaceId: string;
  trends: readonly ExecutiveKpiAnalysisInputTrend[];
  mode: "actual" | "percent" | "normalized";
  timeframe: string;
  startDate: string;
  endDate: string;
  confidenceLabel: string;
  confidenceScore: number;
  limitations: readonly string[];
  now?: Date;
}): ExecutiveKpiAnalysisPackage {
  const metrics: ExecutiveKpiMetricFact[] = trends.map((trend, index) => {
    const usableRows = trend.rows
      .filter((row): row is typeof row & { actualValue: number } => row.actualValue !== null)
      .sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.id.localeCompare(right.id))
      .slice(-MAX_OBSERVATIONS_PER_KPI);
    const values = usableRows.map((row) => row.actualValue);
    const first = values.at(0);
    const latest = values.at(-1);
    const change = first === undefined || latest === undefined || values.length < 2 ? null : percentageChange(first, latest);
    const latestObservedAt = usableRows.at(-1)?.observedAt || null;
    return {
      ordinal: index + 1,
      stableKpiIds: usableRows.map((row) => row.id).sort(),
      name: trend.name,
      directionality: directionality(trend.directionality),
      trendDirection: trendDirection(change),
      percentageChange: change,
      observationCount: usableRows.length,
      freshness: freshness(latestObservedAt, now),
      latestObservedAt,
      values: usableRows.map((row) => ({
        observedAt: row.observedAt,
        actualValue: row.actualValue,
        targetValue: row.targetValue,
        normalizedValue: normalizedValue(row.actualValue, values),
        percentFromFirst: first === undefined ? null : percentageChange(first, row.actualValue)
      }))
    };
  });
  const relationships: ExecutiveKpiRelationshipFact[] = [];
  for (let left = 0; left < metrics.length; left += 1) {
    for (let right = left + 1; right < metrics.length; right += 1) {
      relationships.push(movementRelationship(metrics[left], metrics[right]));
    }
  }

  const sourceMap = new Map<string, { sourceLabel: string; metricOrdinals: Set<number>; recordedAt: string | null }>();
  trends.forEach((trend, index) => {
    trend.rows.forEach((row) => {
      const key = row.sourceFileId || `kpi-record:${trend.name}`;
      const current = sourceMap.get(key) || {
        sourceLabel: row.sourceLabel || (row.sourceFileId ? "Uploaded KPI evidence" : "KPI record"),
        metricOrdinals: new Set<number>(),
        recordedAt: null
      };
      current.metricOrdinals.add(index + 1);
      if (row.observedAt && (!current.recordedAt || row.observedAt > current.recordedAt)) current.recordedAt = row.observedAt;
      sourceMap.set(key, current);
    });
  });
  const citations = Array.from(sourceMap.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, source], index) => ({
      citationId: index + 1,
      sourceLabel: source.sourceLabel,
      sourceType: source.sourceLabel === "KPI record" ? "KPI record" as const : "Uploaded evidence" as const,
      metricOrdinals: Array.from(source.metricOrdinals).sort((left, right) => left - right),
      recordedAt: source.recordedAt
    }));
  const boundedLimitations = Array.from(new Set([
    ...limitations,
    "The comparison shows timing and movement, but it does not establish that one KPI caused another.",
    metrics.some((metric) => metric.directionality === "neutral_contextual")
      ? "At least one KPI has no explicit favorable direction, so movement is described without labeling it good or bad."
      : ""
  ].filter(Boolean))).slice(0, 6);
  const facts = {
    timeframe,
    startDate,
    endDate,
    mode,
    confidenceLabel,
    confidenceScore,
    metrics,
    relationships,
    limitations: boundedLimitations,
    deterministicFallback: metrics
      .filter((metric) => metric.observationCount >= 2)
      .sort((left, right) => Math.abs(right.percentageChange || 0) - Math.abs(left.percentageChange || 0))
      .slice(0, 3)
      .map(deterministicNote)
  } as const;
  const fingerprint = evidenceEngineHash({
    contractId: EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
    contractVersion: EXECUTIVE_KPI_ANALYSIS_CONTRACT_VERSION,
    validatorVersion: EXECUTIVE_KPI_ANALYSIS_VALIDATOR_VERSION,
    period: { startDate, endDate, timeframe },
    mode,
    confidence: { label: confidenceLabel, score: confidenceScore },
    metrics: metrics.map((metric) => ({
      stableKpiIds: metric.stableKpiIds,
      name: metric.name,
      directionality: metric.directionality,
      values: metric.values
    })),
    relationships,
    limitations: boundedLimitations,
    citations: citations.map((citation) => ({
      sourceLabel: citation.sourceLabel,
      sourceType: citation.sourceType,
      metricOrdinals: citation.metricOrdinals,
      recordedAt: citation.recordedAt
    }))
  });
  return {
    contractId: EXECUTIVE_KPI_ANALYSIS_CONTRACT_ID,
    contractVersion: EXECUTIVE_KPI_ANALYSIS_CONTRACT_VERSION,
    validatorVersion: EXECUTIVE_KPI_ANALYSIS_VALIDATOR_VERSION,
    workspaceId,
    fingerprint,
    facts,
    citations
  };
}
