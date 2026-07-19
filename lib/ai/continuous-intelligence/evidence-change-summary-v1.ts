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

export const EVIDENCE_CHANGE_SUMMARY_V1_VERSION = 1 as const;
export const EVIDENCE_CHANGE_SUMMARY_V1_MAX_CHANGES = 12;

export type EvidenceChangeValue = string | number | null;
export type EvidenceChangeDirection = "increased" | "decreased" | "unchanged" | "changed";
export type EvidenceChangeFreshness = "current" | "stale" | "unknown";

export type DeterministicEvidenceChange = Readonly<{
  changeId: string;
  recordName: string;
  previousValue: EvidenceChangeValue;
  currentValue: EvidenceChangeValue;
  direction: EvidenceChangeDirection;
  magnitude: number | null;
  unit: string | null;
  period: string | null;
  material: boolean;
  rank: number;
  freshness: EvidenceChangeFreshness;
  updatedAt: string;
  citationIds: readonly number[];
}>;

export type EvidenceChangeSummaryV1Input = Readonly<{
  evidenceContext: ContinuousIntelligenceEvidenceContext;
  changes: readonly DeterministicEvidenceChange[];
  confidenceCeiling: ContinuousIntelligenceConfidence;
  asOf: string;
  settings?: Readonly<{ maximumChanges?: number }>;
  limitations?: readonly ContinuousIntelligenceReasonCode[];
  onTelemetry?: (telemetry: ContinuousIntelligenceTelemetry) => void;
}>;

export type EvidenceChangeHighlight = Readonly<{
  changeId: string;
  recordName: string;
  previousValue: EvidenceChangeValue;
  currentValue: EvidenceChangeValue;
  direction: EvidenceChangeDirection;
  magnitude: number | null;
  unit: string | null;
  period: string | null;
  material: true;
  freshness: EvidenceChangeFreshness;
  statement: string;
  citationIds: readonly number[];
}>;

export type EvidenceChangeSummaryV1Output = Readonly<{
  contract: "evidence_change_summary_v1";
  version: typeof EVIDENCE_CHANGE_SUMMARY_V1_VERSION;
  fingerprint: string;
  summary: string;
  highlights: readonly EvidenceChangeHighlight[];
  confidence: ContinuousIntelligenceConfidence;
  freshness: ContinuousIntelligenceFreshness;
  limitations: readonly ContinuousIntelligenceReasonCode[];
  evidence: ContinuousIntelligenceEvidenceSummary;
  attribution: typeof DETERMINISTIC_PROVIDER_ATTRIBUTION;
}>;

type EligibleChange = DeterministicEvidenceChange & { acceptedCitationIds: readonly number[] };

const CONFIDENCE_RANK: Record<ContinuousIntelligenceConfidence, number> = {
  Insufficient: 0,
  Low: 1,
  Medium: 2,
  High: 3
};

function normalizedName(value: string) {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function timestamp(value: string) {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function boundedChangeCount(value: number | undefined) {
  if (!Number.isFinite(value)) return 8;
  return Math.min(EVIDENCE_CHANGE_SUMMARY_V1_MAX_CHANGES, Math.max(1, Math.floor(value || 1)));
}

function changeTieKey(change: EligibleChange) {
  return JSON.stringify({
    recordName: change.recordName,
    previousValue: change.previousValue,
    currentValue: change.currentValue,
    direction: change.direction,
    magnitude: change.magnitude,
    unit: change.unit,
    period: change.period,
    material: change.material,
    rank: change.rank,
    freshness: change.freshness,
    citationIds: [...change.acceptedCitationIds].sort((left, right) => left - right)
  });
}

function formatValue(value: EvidenceChangeValue) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return "not available";
}

function changeStatement(change: EligibleChange) {
  const period = change.period ? ` for ${change.period}` : "";
  if (change.direction === "unchanged") {
    return `${change.recordName} remained ${formatValue(change.currentValue)}${period}.`;
  }
  return `${change.recordName} ${change.direction} from ${formatValue(change.previousValue)} to ${formatValue(change.currentValue)}${period}.`;
}

function overallFreshness(changes: readonly EligibleChange[]): ContinuousIntelligenceFreshness {
  if (!changes.length || changes.every((change) => change.freshness === "unknown")) return "unknown";
  if (changes.every((change) => change.freshness === "current")) return "current";
  if (changes.every((change) => change.freshness !== "current")) return "stale";
  return "mixed";
}

function lowerConfidence(...values: ContinuousIntelligenceConfidence[]) {
  return [...values].sort((left, right) => CONFIDENCE_RANK[left] - CONFIDENCE_RANK[right])[0] || "Insufficient";
}

function evidenceConfidence(
  changes: readonly EligibleChange[],
  independentSourceCount: number,
  freshness: ContinuousIntelligenceFreshness
): ContinuousIntelligenceConfidence {
  if (!changes.length) return "Insufficient";
  if (freshness === "stale" || freshness === "unknown") return "Low";
  if (independentSourceCount < 2) return "Medium";
  return "High";
}

function changeSummary(changes: readonly EligibleChange[]) {
  if (!changes.length) return "No material evidence changes were established in the eligible evidence scope.";
  const increased = changes.filter((change) => change.direction === "increased").length;
  const decreased = changes.filter((change) => change.direction === "decreased").length;
  const unchanged = changes.filter((change) => change.direction === "unchanged").length;
  const changed = changes.filter((change) => change.direction === "changed").length;
  return `${changes.length} material evidence change${changes.length === 1 ? " was" : "s were"} established: ${increased} increased, ${decreased} decreased, ${unchanged} unchanged, and ${changed} otherwise changed.`;
}

function hasConflictingChanges(changes: readonly EligibleChange[]) {
  const directionsByName = new Map<string, Set<EvidenceChangeDirection>>();
  for (const change of changes) {
    const key = normalizedName(change.recordName);
    const directions = directionsByName.get(key) || new Set<EvidenceChangeDirection>();
    directions.add(change.direction);
    directionsByName.set(key, directions);
  }
  return Array.from(directionsByName.values()).some((directions) =>
    directions.has("increased") && directions.has("decreased")
  );
}

function buildEvidenceChangeSummary(
  input: EvidenceChangeSummaryV1Input
): ContinuousIntelligenceBuildResult<EvidenceChangeSummaryV1Output> {
  const reasonCodes = new Set<ContinuousIntelligenceReasonCode>(input.limitations || []);
  const eligibleById = new Map<string, EligibleChange>();
  for (const change of input.changes) {
    if (!change.changeId.trim() || !change.recordName.trim()) continue;
    const resolved = resolveOriginalContinuousEvidence({
      context: input.evidenceContext,
      citationIds: change.citationIds
    });
    resolved.reasonCodes.forEach((reason) => reasonCodes.add(reason));
    if (!resolved.valid) continue;
    const candidate: EligibleChange = {
      ...change,
      acceptedCitationIds: resolved.entries.map((entry) => entry.citationId)
    };
    const existing = eligibleById.get(change.changeId);
    if (
      !existing ||
      timestamp(candidate.updatedAt) > timestamp(existing.updatedAt) ||
      (
        timestamp(candidate.updatedAt) === timestamp(existing.updatedAt) &&
        changeTieKey(candidate).localeCompare(changeTieKey(existing)) < 0
      )
    ) {
      eligibleById.set(change.changeId, candidate);
    }
  }

  const allEligible = Array.from(eligibleById.values()).sort((left, right) =>
    left.rank - right.rank || timestamp(right.updatedAt) - timestamp(left.updatedAt) || left.changeId.localeCompare(right.changeId)
  );
  const selected = allEligible.filter((change) => change.material).slice(0, boundedChangeCount(input.settings?.maximumChanges));
  const consumedCitationIds = Array.from(new Set(allEligible.flatMap((change) => change.acceptedCitationIds))).sort((left, right) => left - right);
  const consumedEntries = input.evidenceContext.manifest.evidence.filter((entry) => consumedCitationIds.includes(entry.citationId));
  const evidence = summarizeContinuousEvidence({ manifest: input.evidenceContext.manifest, entries: consumedEntries });
  const freshness = overallFreshness(allEligible);
  if (!allEligible.length) {
    reasonCodes.add("no_eligible_evidence");
    reasonCodes.add("insufficient_evidence");
  }
  if (!selected.length) reasonCodes.add("no_material_changes");
  if (freshness === "stale") reasonCodes.add("stale_evidence");
  if (allEligible.length && evidence.independentSourceCount < 2) reasonCodes.add("single_independent_source");
  if (hasConflictingChanges(allEligible)) reasonCodes.add("conflicting_evidence");
  const deterministicFacts = allEligible.map((change) => ({
    changeId: change.changeId,
    recordName: change.recordName,
    previousValue: change.previousValue,
    currentValue: change.currentValue,
    direction: change.direction,
    magnitude: change.magnitude,
    unit: change.unit,
    period: change.period,
    material: change.material,
    rank: change.rank,
    freshness: change.freshness,
    updatedAt: change.updatedAt,
    citationIds: change.acceptedCitationIds
  }));
  const maximumChanges = boundedChangeCount(input.settings?.maximumChanges);
  const fingerprint = buildContinuousIntelligenceFingerprint({
    contractId: "evidence_change_summary_v1",
    contractVersion: EVIDENCE_CHANGE_SUMMARY_V1_VERSION,
    manifest: input.evidenceContext.manifest,
    citationIds: consumedCitationIds,
    deterministicFacts,
    relevantSettings: {
      asOf: input.asOf.slice(0, 10),
      maximumChanges,
      limitations: [...(input.limitations || [])].sort()
    }
  });
  const highlights: EvidenceChangeHighlight[] = selected.map((change) => ({
    changeId: change.changeId,
    recordName: change.recordName.trim(),
    previousValue: change.previousValue,
    currentValue: change.currentValue,
    direction: change.direction,
    magnitude: change.magnitude,
    unit: change.unit,
    period: change.period,
    material: true,
    freshness: change.freshness,
    statement: changeStatement(change),
    citationIds: change.acceptedCitationIds
  }));
  const limitations = Array.from(reasonCodes);
  const output: EvidenceChangeSummaryV1Output = deepFreeze({
    contract: "evidence_change_summary_v1",
    version: EVIDENCE_CHANGE_SUMMARY_V1_VERSION,
    fingerprint,
    summary: changeSummary(selected),
    highlights,
    confidence: lowerConfidence(
      input.confidenceCeiling,
      evidenceConfidence(allEligible, evidence.independentSourceCount, freshness)
    ),
    freshness,
    limitations,
    evidence,
    attribution: DETERMINISTIC_PROVIDER_ATTRIBUTION
  });

  return {
    output,
    fingerprint,
    evidence,
    reasonCodes: limitations,
    freshness,
    insufficientEvidence: !allEligible.length
  };
}

function validateEvidenceChangeSummary(input: EvidenceChangeSummaryV1Input, output: EvidenceChangeSummaryV1Output) {
  const failures: ContinuousIntelligenceReasonCode[] = [];
  if (
    output.contract !== "evidence_change_summary_v1" ||
    output.version !== EVIDENCE_CHANGE_SUMMARY_V1_VERSION ||
    output.attribution.provider !== "deterministic" ||
    output.attribution.model !== null ||
    !output.fingerprint ||
    CONFIDENCE_RANK[output.confidence] > CONFIDENCE_RANK[input.confidenceCeiling]
  ) failures.push("validation_failed");
  if (new Set(output.highlights.map((highlight) => highlight.changeId)).size !== output.highlights.length) {
    failures.push("validation_failed");
  }
  const citationIds = output.highlights.flatMap((highlight) => highlight.citationIds);
  if (citationIds.length && !verifyContinuousOutputCitations({ context: input.evidenceContext, citationIds })) {
    failures.push("citation_verification_failed");
  }
  return failures;
}

export function runEvidenceChangeSummaryV1(
  input: EvidenceChangeSummaryV1Input
): ContinuousIntelligenceResult<EvidenceChangeSummaryV1Output> {
  return runDeterministicContinuousIntelligence({
    contractId: "evidence_change_summary_v1",
    contractVersion: EVIDENCE_CHANGE_SUMMARY_V1_VERSION,
    build: () => buildEvidenceChangeSummary(input),
    validate: (output) => validateEvidenceChangeSummary(input, output),
    onTelemetry: input.onTelemetry
  });
}
