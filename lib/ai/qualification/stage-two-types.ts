import "server-only";

import type {
  AIValidationReasonCode,
  AIValidationStage,
  AIValidationValueType
} from "@/lib/ai/validation-diagnostics";
import type { EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";
import type {
  QualificationProvider,
  QualificationReasoningMode,
  QualificationValidation
} from "@/lib/ai/qualification/types";

export const STAGE_TWO_CONTRACT_IDS = [
  "business_health_explanation_v1",
  "executive_brief_v1",
  "leadership_priorities_v1"
] as const;

export type StageTwoContractId = (typeof STAGE_TWO_CONTRACT_IDS)[number];

export type StageTwoFixture = Readonly<{
  id: string;
  contractId: StageTwoContractId;
  state: string;
  fingerprint: string;
  systemPrompt: string;
  input: Readonly<Record<string, unknown>>;
  timeoutMs: 90_000;
  manifest: EvidenceManifest;
  requiredCitationIds: readonly number[];
  requiredTerms: readonly string[];
  representedDomains: readonly string[];
  permittedHypothesis: string | null;
  validate(value: unknown): QualificationValidation;
}>;

export type StageTwoQualityScore = Readonly<{
  completeness: number;
  clarity: number;
  concision: number;
  prioritization: number;
  crossDomainSynthesis: number;
  uncertaintyDiscipline: number;
  readability: number;
  executiveUsefulness: number;
  total: number;
}>;

export type StageTwoProbeResult = Readonly<{
  benchmarkVersion: "nvidia_capability_stage_2_v1";
  profileId: string;
  provider: QualificationProvider;
  model: string;
  reasoningMode: QualificationReasoningMode;
  contractId: StageTwoContractId;
  fixtureId: string;
  fixtureFingerprint: string;
  state: string;
  endpointHealthy: boolean;
  httpStatus: number | null;
  completed: boolean;
  contractValid: boolean;
  numericIntegrity: boolean;
  citationIntegrity: boolean;
  requiredSignalCoverage: boolean;
  unsupportedInferenceDetected: boolean;
  reasoningLeakageDetected: boolean;
  validationReasonCode: AIValidationReasonCode | null;
  validationStage: AIValidationStage | null;
  validationExpectedField: string | null;
  validationExpectedType: AIValidationValueType | null;
  validationObservedType: AIValidationValueType | null;
  validationExpectedCount: number | null;
  validationObservedCount: number | null;
  validationFieldPresent: boolean | null;
  finishReason: string | null;
  truncationDetected: boolean;
  reasoningContentDetected: boolean;
  latencyMs: number;
  firstByteMs: number | null;
  firstTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  tokenCountsEstimated: boolean;
  outputCharacters: number;
  transportFailureCode:
    | "missing_credentials"
    | "timeout"
    | "rate_limit"
    | "unavailable"
    | "malformed_transport"
    | "transport_failure"
    | null;
  blindOutput: string | null;
  blindQuality: StageTwoQualityScore | null;
}>;
