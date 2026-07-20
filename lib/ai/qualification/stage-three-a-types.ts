import type {
  AIValidationReasonCode,
  AIValidationStage,
  AIValidationValueType
} from "@/lib/ai/validation-diagnostics";
import type { RerankResult } from "@/lib/ai/evidence-engine/contracts";
import type { EvidenceCandidate, EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";
import type { QualificationProvider, QualificationReasoningMode } from "@/lib/ai/qualification/types";
import type { QualificationValidation } from "@/lib/ai/qualification/types";

export const STAGE_THREE_A_CONTRACT_IDS = [
  "business_health_explanation_v1",
  "leadership_priorities_v1"
] as const;

export const STAGE_THREE_A_RETRIEVAL_PATHS = ["baseline", "nvidia_reranked"] as const;

export type StageThreeAContractId = (typeof STAGE_THREE_A_CONTRACT_IDS)[number];
export type StageThreeARetrievalPath = (typeof STAGE_THREE_A_RETRIEVAL_PATHS)[number];

export type StageThreeASyntheticRecord = Readonly<{
  candidate: EvidenceCandidate;
  signalId: string;
  kind: "risk" | "opportunity";
  scoreImpact: number;
  relevant: boolean;
  material: boolean;
  contradictory: boolean;
  stale: boolean;
  authorizedWorkspace: boolean;
  active: boolean;
  originalEvidenceEligible: boolean;
}>;

export type StageThreeAFixture = Readonly<{
  id: string;
  contractId: StageThreeAContractId;
  state: string;
  queryText: string;
  corpusFingerprint: string;
  records: readonly StageThreeASyntheticRecord[];
  requiredSignalIds: readonly string[];
  permittedRelationships: readonly Readonly<{ leftSignalId: string; rightSignalId: string }>[];
  score: number;
  status: string;
  trajectory: string;
  comparison: string;
  comparisonDelta: number;
  dataQualityBase: number;
  riskPenalty: number;
  opportunityAdjustment: number;
  confidence: "High" | "Medium" | "Low";
  freshness: "current" | "stale";
  limitations: readonly string[];
}>;

export type StageThreeAContractPackage = Readonly<{
  systemPrompt: string;
  input: Readonly<Record<string, unknown>>;
  manifest: EvidenceManifest;
  requiredCitationIds: readonly number[];
  requiredTerms: readonly string[];
  representedDomains: readonly string[];
  validate(value: unknown): QualificationValidation;
}>;

export type StageThreeARetrievalMetrics = Readonly<{
  candidateCount: number;
  selectedEvidenceCount: number;
  sourceDiversity: number;
  independentSourceCount: number;
  duplicateConcentration: number;
  recallAt20: number;
  precisionAt10: number;
  ndcgAt10: number;
  relevantEvidenceRecall: number;
  precisionAtSelectedK: number;
  ndcgAtSelectedK: number;
  mrr: number;
  materialSignalCoverage: number;
  requiredSignalCoverage: number;
  contradictorySignalCoverage: number;
  staleEvidenceCoverage: number;
  permittedRelationshipCoverage: number;
  promotedRelevantCount: number;
  demotedDistractorCount: number;
  lifecycleExclusionAccuracy: number;
  workspaceIsolationAccuracy: number;
}>;

export type StageThreeABlindQualityScore = Readonly<{
  factualFidelity: number;
  citationGrounding: number;
  numericFidelity: number;
  requiredSignalCoverage: number;
  executiveUsefulness: number;
  strategicInsight: number;
  clarity: number;
  concision: number;
  prioritization: number;
  crossDomainSynthesis: number;
  uncertaintyDiscipline: number;
  sourceDiversity: number;
  contradictoryEvidenceTreatment: number;
  unsupportedInferenceDiscipline: number;
  reasoningLeakageDiscipline: number;
  readability: number;
  total: number;
}>;

export type StageThreeAProbeResult = Readonly<{
  benchmarkVersion: "nvidia_capability_stage_3a_v1";
  profileId: string;
  provider: QualificationProvider;
  model: string;
  reasoningMode: QualificationReasoningMode;
  retrievalPath: StageThreeARetrievalPath;
  contractId: StageThreeAContractId;
  fixtureId: string;
  corpusFingerprint: string;
  state: string;
  candidatePoolFingerprint: string;
  selectedCandidateFingerprint: string;
  selectedSignalIds: readonly string[];
  representedDomains: readonly string[];
  retrievalMetrics: StageThreeARetrievalMetrics;
  reranker: Readonly<{
    model: string;
    status: RerankResult["status"] | "not_used";
    latencyMs: number;
    failureCode: RerankResult["failureCode"];
    failOpenUsed: boolean;
  }>;
  endpointHealthy: boolean;
  httpStatus: number | null;
  completed: boolean;
  contractValid: boolean;
  numericIntegrity: boolean;
  citationIntegrity: boolean;
  requiredSignalCoverage: boolean;
  contradictorySignalCoverage: boolean;
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
  generationLatencyMs: number;
  totalLatencyMs: number;
  firstByteMs: number | null;
  firstTokenMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  tokenCountsEstimated: boolean;
  estimatedSynthesisCostCents: number;
  estimatedRerankerCostCents: number | null;
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
  blindQuality: StageThreeABlindQualityScore | null;
}>;
