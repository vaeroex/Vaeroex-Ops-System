import "server-only";

import type {
  AIValidationReasonCode,
  AIValidationStage,
  AIValidationValueType
} from "@/lib/ai/validation-diagnostics";
import type { QualificationProvider } from "@/lib/ai/qualification/types";
import type { StageTwoContractId } from "@/lib/ai/qualification/stage-two-types";

export const STAGE_THREE_B_ASSEMBLY_MODES = ["one_pass", "deterministic_assembly"] as const;
export type StageThreeBAssemblyMode = (typeof STAGE_THREE_B_ASSEMBLY_MODES)[number];

export type OpenAIReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export type OpenAIReasoningMode = "standard" | "pro";

export type StageThreeBWorkflowSettings = Readonly<{
  timeoutMs: 30_000 | 60_000 | 90_000;
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  reasoningEffort?: OpenAIReasoningEffort;
  reasoningMode?: OpenAIReasoningMode;
  requestExtensions?: Readonly<Record<string, unknown>>;
}>;

export type StageThreeBProfile = Readonly<{
  id: string;
  provider: QualificationProvider;
  model: string;
  transport: "openai_responses" | "openai_production_adapter" | "nvidia_chat_completions";
  label: string;
  workflows: Readonly<Partial<Record<StageTwoContractId, StageThreeBWorkflowSettings>>>;
  deterministicAssemblyEligible: boolean;
}>;

export type StageThreeBTransportResult = Readonly<{
  content: string;
  endpointHealthy: boolean;
  httpStatus: number | null;
  completed: boolean;
  requestedModel: string;
  runtimeModel: string | null;
  requestedReasoningEffort: OpenAIReasoningEffort | null;
  effectiveReasoningEffort: string | null;
  requestedReasoningMode: OpenAIReasoningMode | null;
  effectiveReasoningMode: string | null;
  finishReason: string | null;
  truncationDetected: boolean;
  reasoningContentDetected: boolean;
  latencyMs: number;
  firstByteMs: number | null;
  firstTokenMs: number | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  tokenCountsEstimated: boolean;
  transportFailureCode:
    | "missing_credentials"
    | "timeout"
    | "rate_limit"
    | "unavailable"
    | "malformed_transport"
    | "transport_failure"
    | null;
}>;

export type StageThreeBQualityScore = Readonly<{
  factualFidelity: number;
  executiveUsefulness: number;
  strategicInsight: number;
  crossDomainSynthesis: number;
  prioritizationQuality: number;
  explanationDepth: number;
  clarity: number;
  concision: number;
  completeness: number;
  uncertaintyDiscipline: number;
  counterSignalTreatment: number;
  actionabilityWithoutOverclaiming: number;
  executiveVoice: number;
  total: number;
}>;

export type StageThreeBProbeResult = Readonly<{
  benchmarkVersion: "executive_synthesis_stage_3b_v1";
  profileId: string;
  provider: QualificationProvider;
  requestedModel: string;
  runtimeModel: string | null;
  transport: StageThreeBProfile["transport"];
  assemblyMode: StageThreeBAssemblyMode;
  contractId: StageTwoContractId;
  fixtureId: string;
  fixtureFingerprint: string;
  state: string;
  requestedReasoningEffort: OpenAIReasoningEffort | null;
  effectiveReasoningEffort: string | null;
  requestedReasoningMode: OpenAIReasoningMode | null;
  effectiveReasoningMode: string | null;
  endpointHealthy: boolean;
  httpStatus: number | null;
  completed: boolean;
  contractValid: boolean;
  accepted: boolean;
  numericIntegrity: boolean;
  citationIntegrity: boolean;
  requiredSignalCoverage: boolean;
  unsupportedInferenceDetected: boolean;
  unauthorizedRelationshipDetected: boolean;
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
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  tokenCountsEstimated: boolean;
  outputCharacters: number;
  outputWords: number;
  estimatedCostUsd: number | null;
  costBasis: "published_token_pricing" | "nvidia_prototype_credit_no_token_price";
  transportFailureCode: StageThreeBTransportResult["transportFailureCode"];
  outputFingerprint: string | null;
  blindOutput: string | null;
  blindQuality: StageThreeBQualityScore | null;
}>;

export type OpenAIModelAccessAudit = Readonly<{
  model: "gpt-5.6-terra" | "gpt-5.6-sol";
  accessible: boolean;
  httpStatus: number | null;
  runtimeModelId: string | null;
  ownedBy: string | null;
  failureCode: "missing_credentials" | "denied" | "unavailable" | "transport_failure" | null;
}>;
