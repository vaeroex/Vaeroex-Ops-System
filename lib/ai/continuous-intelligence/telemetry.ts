import "server-only";

import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";
import {
  CONTINUOUS_INTELLIGENCE_TELEMETRY_VERSION,
  CONTINUOUS_INTELLIGENCE_VALIDATOR_VERSION,
  type ContinuousIntelligenceBuildResult,
  type ContinuousIntelligenceContractId,
  type ContinuousIntelligenceReasonCode,
  type ContinuousIntelligenceResult,
  type ContinuousIntelligenceTelemetry
} from "@/lib/ai/continuous-intelligence/contracts";

type DeterministicExecutionOptions<TOutput> = Readonly<{
  contractId: ContinuousIntelligenceContractId;
  contractVersion: 1;
  build: () => ContinuousIntelligenceBuildResult<TOutput>;
  validate: (output: TOutput) => readonly ContinuousIntelligenceReasonCode[];
  onTelemetry?: (telemetry: ContinuousIntelligenceTelemetry) => void;
}>;

export function contentFreeContinuousIntelligenceLog(telemetry: ContinuousIntelligenceTelemetry) {
  return JSON.stringify(telemetry);
}

export function runDeterministicContinuousIntelligence<TOutput>({
  contractId,
  contractVersion,
  build,
  validate,
  onTelemetry
}: DeterministicExecutionOptions<TOutput>): ContinuousIntelligenceResult<TOutput> {
  const startedAt = Date.now();
  const built = build();
  const validationReasonCodes = Array.from(new Set(validate(built.output)));
  const validationOutcome = validationReasonCodes.length ? "invalid" : "valid";
  const reasonCodes = Array.from(new Set([...built.reasonCodes, ...validationReasonCodes]));
  const telemetry: ContinuousIntelligenceTelemetry = deepFreeze({
    telemetryVersion: CONTINUOUS_INTELLIGENCE_TELEMETRY_VERSION,
    contractId,
    contractVersion,
    validatorVersion: CONTINUOUS_INTELLIGENCE_VALIDATOR_VERSION,
    evidenceManifestVersion: built.evidence.manifestVersion,
    fingerprint: built.fingerprint,
    provider: "deterministic",
    candidateCount: built.evidence.candidateCount,
    sourceCount: built.evidence.sourceCount,
    independentSourceCount: built.evidence.independentSourceCount,
    executionMs: Date.now() - startedAt,
    validationOutcome,
    outcome: built.insufficientEvidence ? "insufficient_evidence" : "deterministic",
    deterministicFallback: true,
    reasonCodes,
    freshness: built.freshness
  });
  onTelemetry?.(telemetry);
  if (validationOutcome === "invalid") {
    throw new Error(`Deterministic Continuous Intelligence validation failed: ${validationReasonCodes.join(", ")}`);
  }
  return deepFreeze({ output: deepFreeze(built.output), telemetry });
}
