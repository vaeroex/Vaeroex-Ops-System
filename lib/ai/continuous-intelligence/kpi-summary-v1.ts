import "server-only";

import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";
import {
  DETERMINISTIC_PROVIDER_ATTRIBUTION,
  type ContinuousIntelligenceBuildResult,
  type ContinuousIntelligenceConfidence,
  type ContinuousIntelligenceEvidenceContext,
  type ContinuousIntelligenceEvidenceSummary,
  type ContinuousIntelligenceFreshness,
  type ContinuousIntelligenceReasonCode,
  type ContinuousIntelligenceResult,
  type ContinuousIntelligenceTelemetry
} from "@/lib/ai/continuous-intelligence/contracts";
import {
  resolveOriginalContinuousEvidence,
  summarizeContinuousEvidence,
  verifyContinuousOutputCitations
} from "@/lib/ai/continuous-intelligence/evidence-context";
import { buildContinuousIntelligenceFingerprint } from "@/lib/ai/continuous-intelligence/fingerprint";
import { runDeterministicContinuousIntelligence } from "@/lib/ai/continuous-intelligence/telemetry";

export const KPI_SUMMARY_V1_VERSION = 1 as const;
export const KPI_SUMMARY_V1_MAX_METRICS = 8;

export type KpiMovement = "increased" | "decreased" | "unchanged" | "not_enough_history";
export type KpiTargetDirection = "higher" | "lower" | "exact" | "unknown";
export type KpiMetricFreshness = "current" | "stale" | "old" | "undated";
export type KpiPerformanceStatus =
  | "on_track"
  | "needs_attention"
  | "missing_target"
  | "direction_not_configured"
  | "missing_value";

export type DeterministicKpiRecord = Readonly<{
  recordId: string;
  metricKey: string;
  name: string;
  actualValue: number | null;
  target?: number | null;
  metricDate?: string | null;
  updatedAt: string;
  citationIds: readonly number[];
}>;

export type DeterministicKpiSetting = Readonly<{
  metricKey: string;
  visible?: boolean;
  target?: number | null;
  direction?: KpiTargetDirection;
  weight?: number;
  sortOrder?: number;
}>;

export type KpiSummaryV1Input = Readonly<{
  evidenceContext: ContinuousIntelligenceEvidenceContext;
  records: readonly DeterministicKpiRecord[];
  settings?: readonly DeterministicKpiSetting[];
  asOf: string;
  onTelemetry?: (telemetry: ContinuousIntelligenceTelemetry) => void;
}>;

export type KpiSummaryMetric = Readonly<{
  metricKey: string;
  name: string;
  latestValue: number | null;
  priorValue: number | null;
  target: number | null;
  direction: KpiTargetDirection;
  targetComparison: "above" | "below" | "at" | "unavailable";
  performanceStatus: KpiPerformanceStatus;
  movement: KpiMovement;
  changePercent: number | null;
  reportingPeriod: string | null;
  priorPeriod: string | null;
  freshness: KpiMetricFreshness;
  statement: string;
  citationIds: readonly number[];
}>;

export type KpiSummaryV1Output = Readonly<{
  contract: "kpi_summary_v1";
  version: typeof KPI_SUMMARY_V1_VERSION;
  fingerprint: string;
  summary: string;
  metrics: readonly KpiSummaryMetric[];
  confidence: ContinuousIntelligenceConfidence;
  freshness: ContinuousIntelligenceFreshness;
  limitations: readonly ContinuousIntelligenceReasonCode[];
  evidence: ContinuousIntelligenceEvidenceSummary;
  attribution: typeof DETERMINISTIC_PROVIDER_ATTRIBUTION;
}>;

type EligibleKpiRow = DeterministicKpiRecord & { acceptedCitationIds: readonly number[] };

function normalizedMetricKey(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function dateOnly(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function timestamp(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function compareRows(left: EligibleKpiRow, right: EligibleKpiRow) {
  return timestamp(right.metricDate) - timestamp(left.metricDate) ||
    timestamp(right.updatedAt) - timestamp(left.updatedAt) ||
    left.recordId.localeCompare(right.recordId) ||
    JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function metricFreshness(metricDate: string | null, asOf: string): KpiMetricFreshness {
  if (!metricDate) return "undated";
  const ageDays = Math.floor((timestamp(asOf) - timestamp(metricDate)) / 86_400_000);
  if (!Number.isFinite(ageDays)) return "undated";
  if (ageDays <= 45) return "current";
  if (ageDays <= 120) return "stale";
  return "old";
}

function movement(latest: number | null, prior: number | null): KpiMovement {
  if (!finiteNumber(latest) || !finiteNumber(prior)) return "not_enough_history";
  if (latest > prior) return "increased";
  if (latest < prior) return "decreased";
  return "unchanged";
}

function changePercent(latest: number | null, prior: number | null) {
  if (!finiteNumber(latest) || !finiteNumber(prior) || prior === 0) return null;
  return Number((((latest - prior) / Math.abs(prior)) * 100).toFixed(2));
}

function targetComparison(actual: number | null, target: number | null): KpiSummaryMetric["targetComparison"] {
  if (!finiteNumber(actual) || !finiteNumber(target)) return "unavailable";
  if (actual > target) return "above";
  if (actual < target) return "below";
  return "at";
}

function performanceStatus(
  actual: number | null,
  target: number | null,
  direction: KpiTargetDirection
): KpiPerformanceStatus {
  if (!finiteNumber(actual)) return "missing_value";
  if (!finiteNumber(target)) return "missing_target";
  if (direction === "unknown") return "direction_not_configured";
  if (direction === "higher") return actual >= target ? "on_track" : "needs_attention";
  if (direction === "lower") return actual <= target ? "on_track" : "needs_attention";
  return actual === target ? "on_track" : "needs_attention";
}

function formatNumber(value: number | null) {
  if (!finiteNumber(value)) return "not available";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function metricStatement(metric: Omit<KpiSummaryMetric, "statement">) {
  const movementText = metric.movement === "not_enough_history"
    ? "Prior-period comparison is unavailable"
    : metric.movement === "unchanged"
      ? "The value was unchanged"
      : `The value ${metric.movement} from ${formatNumber(metric.priorValue)}`;
  const targetText = metric.target === null
    ? "No target is configured"
    : metric.direction === "unknown"
      ? `The configured target is ${formatNumber(metric.target)}, but target direction is not configured`
      : `The value is ${metric.targetComparison} the configured target of ${formatNumber(metric.target)}`;
  return `${metric.name} is ${formatNumber(metric.latestValue)}. ${movementText}. ${targetText}.`;
}

function overallFreshness(metrics: readonly KpiSummaryMetric[]): ContinuousIntelligenceFreshness {
  if (!metrics.length || metrics.every((metric) => metric.freshness === "undated")) return "unknown";
  if (metrics.every((metric) => metric.freshness === "current")) return "current";
  if (metrics.every((metric) => metric.freshness !== "current")) return "stale";
  return "mixed";
}

function confidence(metrics: readonly KpiSummaryMetric[], independentSourceCount: number): ContinuousIntelligenceConfidence {
  if (!metrics.length) return "Insufficient";
  if (metrics.every((metric) => metric.latestValue === null)) return "Low";
  if (metrics.filter((metric) => metric.freshness !== "current").length > metrics.length / 2) return "Low";
  if (independentSourceCount < 2) return "Medium";
  return metrics.filter((metric) => metric.priorValue !== null).length >= Math.min(3, metrics.length) ? "High" : "Medium";
}

function summary(metrics: readonly KpiSummaryMetric[]) {
  if (!metrics.length) return "No eligible KPI evidence is available for a deterministic summary.";
  const increased = metrics.filter((metric) => metric.movement === "increased").length;
  const decreased = metrics.filter((metric) => metric.movement === "decreased").length;
  const unchanged = metrics.filter((metric) => metric.movement === "unchanged").length;
  const unavailable = metrics.filter((metric) => metric.movement === "not_enough_history").length;
  return `${metrics.length} eligible KPI${metrics.length === 1 ? "" : "s"} summarized: ${increased} increased, ${decreased} decreased, ${unchanged} unchanged, and ${unavailable} without enough history.`;
}

function priorityScore(setting: DeterministicKpiSetting | undefined, metric: KpiSummaryMetric) {
  const statusScore: Record<KpiPerformanceStatus, number> = {
    needs_attention: 50,
    missing_target: 25,
    direction_not_configured: 20,
    missing_value: 15,
    on_track: 10
  };
  return statusScore[metric.performanceStatus] + Math.max(0, setting?.weight ?? 1) * 10 - Math.max(0, setting?.sortOrder ?? 0) * 0.01;
}

function buildKpiSummary(input: KpiSummaryV1Input): ContinuousIntelligenceBuildResult<KpiSummaryV1Output> {
  const settingsByKey = new Map<string, DeterministicKpiSetting>();
  for (const setting of input.settings || []) {
    const key = normalizedMetricKey(setting.metricKey);
    if (!key) continue;
    if (settingsByKey.has(key)) throw new Error("KPI settings must be unique within a deterministic contract scope.");
    settingsByKey.set(key, setting);
  }
  const reasonCodes = new Set<ContinuousIntelligenceReasonCode>();
  const rowsByRecordId = new Map<string, EligibleKpiRow>();

  for (const row of input.records) {
    const key = normalizedMetricKey(row.metricKey);
    if (!key || !row.name.trim() || settingsByKey.get(key)?.visible === false) continue;
    const resolved = resolveOriginalContinuousEvidence({
      context: input.evidenceContext,
      citationIds: row.citationIds
    });
    resolved.reasonCodes.forEach((reason) => reasonCodes.add(reason));
    if (!resolved.valid) continue;
    const acceptedCitationIds = resolved.entries.map((entry) => entry.citationId);
    const candidate: EligibleKpiRow = { ...row, acceptedCitationIds };
    const existing = rowsByRecordId.get(row.recordId);
    if (!existing || compareRows(candidate, existing) < 0) rowsByRecordId.set(row.recordId, candidate);
  }

  const grouped = new Map<string, EligibleKpiRow[]>();
  for (const row of rowsByRecordId.values()) {
    const key = normalizedMetricKey(row.metricKey);
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }

  const provisional = Array.from(grouped.entries()).map(([key, rows]) => {
    const sorted = [...rows].sort(compareRows);
    const latest = sorted[0];
    const latestPeriod = dateOnly(latest.metricDate);
    const prior = sorted.find((row) => dateOnly(row.metricDate) !== latestPeriod && finiteNumber(row.actualValue)) || null;
    const setting = settingsByKey.get(key);
    const target = finiteNumber(setting?.target) ? setting.target : finiteNumber(latest.target) ? latest.target : null;
    const direction = setting?.direction || "unknown";
    const metricWithoutStatement: Omit<KpiSummaryMetric, "statement"> = {
      metricKey: latest.metricKey,
      name: latest.name.trim(),
      latestValue: finiteNumber(latest.actualValue) ? latest.actualValue : null,
      priorValue: prior && finiteNumber(prior.actualValue) ? prior.actualValue : null,
      target,
      direction,
      targetComparison: targetComparison(latest.actualValue, target),
      performanceStatus: performanceStatus(latest.actualValue, target, direction),
      movement: movement(latest.actualValue, prior?.actualValue ?? null),
      changePercent: changePercent(latest.actualValue, prior?.actualValue ?? null),
      reportingPeriod: latestPeriod,
      priorPeriod: dateOnly(prior?.metricDate),
      freshness: metricFreshness(latestPeriod, input.asOf),
      citationIds: Array.from(new Set([
        ...latest.acceptedCitationIds,
        ...(prior?.acceptedCitationIds || [])
      ])).sort((left, right) => left - right)
    };
    const metric = { ...metricWithoutStatement, statement: metricStatement(metricWithoutStatement) };
    return { key, rows: sorted, setting, metric, score: priorityScore(setting, metric) };
  }).sort((left, right) => right.score - left.score || left.metric.name.localeCompare(right.metric.name));

  const selected = provisional.slice(0, KPI_SUMMARY_V1_MAX_METRICS);
  const metrics = selected.map((item) => item.metric);
  const consumedRows = selected.flatMap((item) => item.rows);
  const consumedCitationIds = Array.from(new Set(consumedRows.flatMap((row) => row.acceptedCitationIds))).sort((left, right) => left - right);
  const consumedEntries = input.evidenceContext.manifest.evidence.filter((entry) => consumedCitationIds.includes(entry.citationId));
  const evidence = summarizeContinuousEvidence({ manifest: input.evidenceContext.manifest, entries: consumedEntries });
  const relevantSettings = selected.map(({ key, setting }) => ({ key, setting: setting || null }));
  const deterministicFacts = consumedRows.map((row) => ({
    recordId: row.recordId,
    metricKey: normalizedMetricKey(row.metricKey),
    name: row.name,
    actualValue: row.actualValue,
    target: row.target ?? null,
    metricDate: dateOnly(row.metricDate),
    updatedAt: row.updatedAt,
    citationIds: row.acceptedCitationIds
  }));
  const fingerprint = buildContinuousIntelligenceFingerprint({
    contractId: "kpi_summary_v1",
    contractVersion: KPI_SUMMARY_V1_VERSION,
    manifest: input.evidenceContext.manifest,
    citationIds: consumedCitationIds,
    deterministicFacts,
    relevantSettings: { asOf: dateOnly(input.asOf), settings: relevantSettings }
  });
  const freshness = overallFreshness(metrics);
  if (!metrics.length) {
    reasonCodes.add("no_eligible_evidence");
    reasonCodes.add("insufficient_evidence");
  }
  if (metrics.some((metric) => metric.priorValue === null)) reasonCodes.add("missing_history");
  if (metrics.some((metric) => metric.target === null)) reasonCodes.add("missing_target");
  if (metrics.some((metric) => metric.target !== null && metric.direction === "unknown")) reasonCodes.add("direction_not_configured");
  if (metrics.some((metric) => metric.freshness === "stale" || metric.freshness === "old")) reasonCodes.add("stale_evidence");
  if (metrics.some((metric) => metric.freshness === "undated")) reasonCodes.add("undated_evidence");
  if (metrics.length && evidence.independentSourceCount < 2) reasonCodes.add("single_independent_source");
  const limitations = Array.from(reasonCodes);
  const output: KpiSummaryV1Output = deepFreeze({
    contract: "kpi_summary_v1",
    version: KPI_SUMMARY_V1_VERSION,
    fingerprint,
    summary: summary(metrics),
    metrics,
    confidence: confidence(metrics, evidence.independentSourceCount),
    freshness,
    limitations,
    evidence,
    attribution: DETERMINISTIC_PROVIDER_ATTRIBUTION
  });

  return { output, fingerprint, evidence, reasonCodes: limitations, freshness, insufficientEvidence: !metrics.length };
}

function validateKpiSummary(input: KpiSummaryV1Input, output: KpiSummaryV1Output) {
  const failures: ContinuousIntelligenceReasonCode[] = [];
  if (
    output.contract !== "kpi_summary_v1" ||
    output.version !== KPI_SUMMARY_V1_VERSION ||
    output.attribution.provider !== "deterministic" ||
    output.attribution.model !== null ||
    !output.fingerprint
  ) failures.push("validation_failed");
  const metricKeys = output.metrics.map((metric) => normalizedMetricKey(metric.metricKey));
  if (new Set(metricKeys).size !== metricKeys.length) failures.push("validation_failed");
  const citationIds = output.metrics.flatMap((metric) => metric.citationIds);
  if (citationIds.length && !verifyContinuousOutputCitations({ context: input.evidenceContext, citationIds })) {
    failures.push("citation_verification_failed");
  }
  return failures;
}

export function runKpiSummaryV1(input: KpiSummaryV1Input): ContinuousIntelligenceResult<KpiSummaryV1Output> {
  return runDeterministicContinuousIntelligence({
    contractId: "kpi_summary_v1",
    contractVersion: KPI_SUMMARY_V1_VERSION,
    build: () => buildKpiSummary(input),
    validate: (output) => validateKpiSummary(input, output),
    onTelemetry: input.onTelemetry
  });
}
