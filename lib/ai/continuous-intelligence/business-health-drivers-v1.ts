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

export const BUSINESS_HEALTH_DRIVERS_V1_VERSION = 1 as const;
export const BUSINESS_HEALTH_DRIVERS_V1_MAX_DRIVERS = 6;

export type BusinessHealthDriverDirection = "favorable" | "unfavorable" | "neutral" | "unknown";
export type BusinessHealthDriverFreshness = "current" | "stale" | "unknown";
export type BusinessHealthDriverAgreement = "aligned" | "mixed" | "conflicting" | "unknown";

export type DeterministicBusinessHealthDriver = Readonly<{
  driverId: string;
  name: string;
  value: number | string | null;
  direction: BusinessHealthDriverDirection;
  weight: number;
  scoreContribution: number | null;
  period: string | null;
  freshness: BusinessHealthDriverFreshness;
  agreement?: BusinessHealthDriverAgreement;
  citationIds: readonly number[];
}>;

export type BusinessHealthDriversV1Input = Readonly<{
  evidenceContext: ContinuousIntelligenceEvidenceContext;
  score: number | null;
  drivers: readonly DeterministicBusinessHealthDriver[];
  confidenceCeiling: ContinuousIntelligenceConfidence;
  asOf: string;
  settings?: Readonly<{ maximumDrivers?: number }>;
  limitations?: readonly ContinuousIntelligenceReasonCode[];
  onTelemetry?: (telemetry: ContinuousIntelligenceTelemetry) => void;
}>;

export type BusinessHealthDriverOutput = Readonly<{
  driverId: string;
  name: string;
  value: number | string | null;
  direction: BusinessHealthDriverDirection;
  weight: number;
  scoreContribution: number | null;
  period: string | null;
  freshness: BusinessHealthDriverFreshness;
  statement: string;
  citationIds: readonly number[];
}>;

export type BusinessHealthDriversV1Output = Readonly<{
  contract: "business_health_drivers_v1";
  version: typeof BUSINESS_HEALTH_DRIVERS_V1_VERSION;
  fingerprint: string;
  score: number | null;
  explanation: string;
  drivers: readonly BusinessHealthDriverOutput[];
  confidence: ContinuousIntelligenceConfidence;
  freshness: ContinuousIntelligenceFreshness;
  limitations: readonly ContinuousIntelligenceReasonCode[];
  evidence: ContinuousIntelligenceEvidenceSummary;
  attribution: typeof DETERMINISTIC_PROVIDER_ATTRIBUTION;
}>;

type EligibleDriver = DeterministicBusinessHealthDriver & { acceptedCitationIds: readonly number[] };

const CONFIDENCE_RANK: Record<ContinuousIntelligenceConfidence, number> = {
  Insufficient: 0,
  Low: 1,
  Medium: 2,
  High: 3
};

function boundedDriverCount(value: number | undefined) {
  if (!Number.isFinite(value)) return 4;
  return Math.min(BUSINESS_HEALTH_DRIVERS_V1_MAX_DRIVERS, Math.max(1, Math.floor(value || 1)));
}

function driverTieKey(driver: EligibleDriver) {
  return JSON.stringify({
    name: driver.name,
    value: driver.value,
    direction: driver.direction,
    weight: driver.weight,
    scoreContribution: driver.scoreContribution,
    period: driver.period,
    freshness: driver.freshness,
    agreement: driver.agreement || "unknown",
    citationIds: [...driver.acceptedCitationIds].sort((left, right) => left - right)
  });
}

function formatValue(value: number | string | null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return "not available";
}

function driverStatement(driver: EligibleDriver) {
  const period = driver.period ? ` for ${driver.period}` : "";
  const direction = driver.direction === "unknown" ? "with no configured direction" : `with a ${driver.direction} direction`;
  return `${driver.name} is ${formatValue(driver.value)}${period}, ${direction}.`;
}

function freshness(drivers: readonly EligibleDriver[]): ContinuousIntelligenceFreshness {
  if (!drivers.length || drivers.every((driver) => driver.freshness === "unknown")) return "unknown";
  if (drivers.every((driver) => driver.freshness === "current")) return "current";
  if (drivers.every((driver) => driver.freshness !== "current")) return "stale";
  return "mixed";
}

function lowerConfidence(...values: ContinuousIntelligenceConfidence[]) {
  return [...values].sort((left, right) => CONFIDENCE_RANK[left] - CONFIDENCE_RANK[right])[0] || "Insufficient";
}

function evidenceConfidence(
  drivers: readonly EligibleDriver[],
  independentSourceCount: number,
  freshnessState: ContinuousIntelligenceFreshness
): ContinuousIntelligenceConfidence {
  if (!drivers.length) return "Insufficient";
  if (freshnessState === "stale" || freshnessState === "unknown") return "Low";
  if (independentSourceCount < 2) return "Medium";
  return "High";
}

function explanation(score: number | null, drivers: readonly EligibleDriver[]) {
  if (score === null || !Number.isFinite(score)) {
    return "Business Health is unavailable because an eligible deterministic score was not provided.";
  }
  if (!drivers.length) {
    return `Business Health is ${score}, but no eligible weighted drivers are available for explanation.`;
  }
  const grouped = new Map<string, { name: string; directions: BusinessHealthDriverDirection[] }>();
  for (const driver of drivers) {
    const name = driver.name.normalize("NFKC").trim().replace(/\s+/g, " ");
    const key = name.toLocaleLowerCase("en-US");
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { name, directions: [driver.direction] });
    } else if (!existing.directions.includes(driver.direction)) {
      existing.directions.push(driver.direction);
    }
  }
  const driverList = Array.from(grouped.values())
    .map((driver) => `${driver.name} (${driver.directions.join(" and ")})`)
    .join(", ");
  return `Business Health is ${score}. The highest-weighted eligible drivers are ${driverList}.`;
}

function buildBusinessHealthDrivers(
  input: BusinessHealthDriversV1Input
): ContinuousIntelligenceBuildResult<BusinessHealthDriversV1Output> {
  const reasonCodes = new Set<ContinuousIntelligenceReasonCode>(input.limitations || []);
  const eligibleById = new Map<string, EligibleDriver>();
  for (const driver of input.drivers) {
    if (!driver.driverId.trim() || !driver.name.trim()) continue;
    const resolved = resolveOriginalContinuousEvidence({
      context: input.evidenceContext,
      citationIds: driver.citationIds
    });
    resolved.reasonCodes.forEach((reason) => reasonCodes.add(reason));
    if (!resolved.valid) continue;
    const candidate: EligibleDriver = {
      ...driver,
      acceptedCitationIds: resolved.entries.map((entry) => entry.citationId)
    };
    const existing = eligibleById.get(driver.driverId);
    if (
      !existing ||
      driver.weight > existing.weight ||
      (driver.weight === existing.weight && driverTieKey(candidate).localeCompare(driverTieKey(existing)) < 0)
    ) eligibleById.set(driver.driverId, candidate);
  }

  const maximumDrivers = boundedDriverCount(input.settings?.maximumDrivers);
  const selected = Array.from(eligibleById.values())
    .sort((left, right) =>
      right.weight - left.weight ||
      Math.abs(right.scoreContribution || 0) - Math.abs(left.scoreContribution || 0) ||
      left.driverId.localeCompare(right.driverId)
    )
    .slice(0, maximumDrivers);
  const citationIds = Array.from(new Set(selected.flatMap((driver) => driver.acceptedCitationIds))).sort((left, right) => left - right);
  const entries = input.evidenceContext.manifest.evidence.filter((entry) => citationIds.includes(entry.citationId));
  const evidence = summarizeContinuousEvidence({ manifest: input.evidenceContext.manifest, entries });
  const freshnessState = freshness(selected);
  const outputDrivers: BusinessHealthDriverOutput[] = selected.map((driver) => ({
    driverId: driver.driverId,
    name: driver.name.trim(),
    value: driver.value,
    direction: driver.direction,
    weight: driver.weight,
    scoreContribution: driver.scoreContribution,
    period: driver.period,
    freshness: driver.freshness,
    statement: driverStatement(driver),
    citationIds: driver.acceptedCitationIds
  }));
  if (!selected.length) reasonCodes.add("no_eligible_evidence");
  if (input.score === null || !Number.isFinite(input.score) || !selected.length) reasonCodes.add("insufficient_evidence");
  if (freshnessState === "stale") reasonCodes.add("stale_evidence");
  if (selected.length && evidence.independentSourceCount < 2) reasonCodes.add("single_independent_source");
  if (selected.some((driver) => driver.agreement === "conflicting")) reasonCodes.add("conflicting_evidence");
  const deterministicFacts = {
    score: input.score,
    confidenceCeiling: input.confidenceCeiling,
    drivers: selected.map((driver) => ({
      driverId: driver.driverId,
      name: driver.name,
      value: driver.value,
      direction: driver.direction,
      weight: driver.weight,
      scoreContribution: driver.scoreContribution,
      period: driver.period,
      freshness: driver.freshness,
      agreement: driver.agreement || "unknown",
      citationIds: driver.acceptedCitationIds
    }))
  };
  const fingerprint = buildContinuousIntelligenceFingerprint({
    contractId: "business_health_drivers_v1",
    contractVersion: BUSINESS_HEALTH_DRIVERS_V1_VERSION,
    manifest: input.evidenceContext.manifest,
    citationIds,
    deterministicFacts,
    relevantSettings: {
      asOf: input.asOf.slice(0, 10),
      maximumDrivers,
      limitations: [...(input.limitations || [])].sort()
    }
  });
  const limitations = Array.from(reasonCodes);
  const output: BusinessHealthDriversV1Output = deepFreeze({
    contract: "business_health_drivers_v1",
    version: BUSINESS_HEALTH_DRIVERS_V1_VERSION,
    fingerprint,
    score: Number.isFinite(input.score) ? input.score : null,
    explanation: explanation(Number.isFinite(input.score) ? input.score : null, selected),
    drivers: outputDrivers,
    confidence: input.score === null || !Number.isFinite(input.score)
      ? "Insufficient"
      : lowerConfidence(
          input.confidenceCeiling,
          evidenceConfidence(selected, evidence.independentSourceCount, freshnessState)
        ),
    freshness: freshnessState,
    limitations,
    evidence,
    attribution: DETERMINISTIC_PROVIDER_ATTRIBUTION
  });
  return {
    output,
    fingerprint,
    evidence,
    reasonCodes: limitations,
    freshness: freshnessState,
    insufficientEvidence: limitations.includes("insufficient_evidence")
  };
}

function validateBusinessHealthDrivers(input: BusinessHealthDriversV1Input, output: BusinessHealthDriversV1Output) {
  const failures: ContinuousIntelligenceReasonCode[] = [];
  if (
    output.contract !== "business_health_drivers_v1" ||
    output.version !== BUSINESS_HEALTH_DRIVERS_V1_VERSION ||
    output.attribution.provider !== "deterministic" ||
    output.attribution.model !== null ||
    !output.fingerprint ||
    CONFIDENCE_RANK[output.confidence] > CONFIDENCE_RANK[input.confidenceCeiling]
  ) failures.push("validation_failed");
  if (new Set(output.drivers.map((driver) => driver.driverId)).size !== output.drivers.length) {
    failures.push("validation_failed");
  }
  const citationIds = output.drivers.flatMap((driver) => driver.citationIds);
  if (citationIds.length && !verifyContinuousOutputCitations({ context: input.evidenceContext, citationIds })) {
    failures.push("citation_verification_failed");
  }
  return failures;
}

export function runBusinessHealthDriversV1(
  input: BusinessHealthDriversV1Input
): ContinuousIntelligenceResult<BusinessHealthDriversV1Output> {
  return runDeterministicContinuousIntelligence({
    contractId: "business_health_drivers_v1",
    contractVersion: BUSINESS_HEALTH_DRIVERS_V1_VERSION,
    build: () => buildBusinessHealthDrivers(input),
    validate: (output) => validateBusinessHealthDrivers(input, output),
    onTelemetry: input.onTelemetry
  });
}
