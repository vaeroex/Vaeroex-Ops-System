import "server-only";

import type { EvidenceManifest, SourceRegistry } from "@/lib/ai/evidence-engine/contracts";

export const CONTINUOUS_INTELLIGENCE_VALIDATOR_VERSION = "continuous_intelligence_validator_v1" as const;
export const CONTINUOUS_INTELLIGENCE_TELEMETRY_VERSION = "continuous_intelligence_telemetry_v1" as const;

export type ContinuousIntelligenceContractId =
  | "kpi_summary_v1"
  | "business_health_drivers_v1"
  | "evidence_change_summary_v1";

export type ContinuousIntelligenceConfidence = "Insufficient" | "Low" | "Medium" | "High";
export type ContinuousIntelligenceFreshness = "current" | "mixed" | "stale" | "unknown";

export type ContinuousIntelligenceReasonCode =
  | "no_eligible_evidence"
  | "insufficient_evidence"
  | "citation_verification_failed"
  | "derived_evidence_excluded"
  | "missing_history"
  | "missing_target"
  | "direction_not_configured"
  | "stale_evidence"
  | "undated_evidence"
  | "single_independent_source"
  | "conflicting_evidence"
  | "no_material_changes"
  | "validation_failed";

export type ContinuousIntelligenceEvidenceContext = Readonly<{
  authorizedWorkspaceId: string;
  manifest: EvidenceManifest;
  sourceRegistry: SourceRegistry;
}>;

export type ContinuousIntelligenceProviderAttribution = Readonly<{
  provider: "deterministic";
  model: null;
}>;

export const DETERMINISTIC_PROVIDER_ATTRIBUTION: ContinuousIntelligenceProviderAttribution = Object.freeze({
  provider: "deterministic",
  model: null
});

export type ContinuousIntelligenceEvidenceSummary = Readonly<{
  manifestVersion: EvidenceManifest["version"];
  candidateCount: number;
  sourceCount: number;
  independentSourceCount: number;
  citationIds: readonly number[];
}>;

export type ContinuousIntelligenceTelemetry = Readonly<{
  telemetryVersion: typeof CONTINUOUS_INTELLIGENCE_TELEMETRY_VERSION;
  contractId: ContinuousIntelligenceContractId;
  contractVersion: 1;
  validatorVersion: typeof CONTINUOUS_INTELLIGENCE_VALIDATOR_VERSION;
  evidenceManifestVersion: EvidenceManifest["version"];
  fingerprint: string;
  provider: "deterministic";
  candidateCount: number;
  sourceCount: number;
  independentSourceCount: number;
  executionMs: number;
  validationOutcome: "valid" | "invalid";
  outcome: "deterministic" | "insufficient_evidence";
  deterministicFallback: true;
  reasonCodes: readonly ContinuousIntelligenceReasonCode[];
  freshness: ContinuousIntelligenceFreshness;
}>;

export type ContinuousIntelligenceResult<TOutput> = Readonly<{
  output: Readonly<TOutput>;
  telemetry: ContinuousIntelligenceTelemetry;
}>;

export type ContinuousIntelligenceBuildResult<TOutput> = Readonly<{
  output: TOutput;
  fingerprint: string;
  evidence: ContinuousIntelligenceEvidenceSummary;
  reasonCodes: readonly ContinuousIntelligenceReasonCode[];
  freshness: ContinuousIntelligenceFreshness;
  insufficientEvidence: boolean;
}>;
