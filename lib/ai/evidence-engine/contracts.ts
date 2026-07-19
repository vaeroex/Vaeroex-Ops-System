export const EVIDENCE_QUERY_VERSION = "evidence_query_v1" as const;
export const EVIDENCE_CANDIDATE_VERSION = "evidence_candidate_v1" as const;
export const SOURCE_REGISTRY_VERSION = "source_registry_v1" as const;
export const RERANK_RESULT_VERSION = "rerank_result_v1" as const;
export const RANKED_SIGNAL_PLAN_VERSION = "ranked_signal_plan_v1" as const;
export const EVIDENCE_MANIFEST_VERSION = "evidence_manifest_v1" as const;
export const CITATION_VERIFICATION_VERSION = "citation_verification_v1" as const;

export type EvidenceRole = "original" | "supporting" | "derived" | "historical";
export type EvidenceRetrievalMode = "vector" | "keyword" | "structured" | "none";

export type EvidenceQuery = Readonly<{
  version: typeof EVIDENCE_QUERY_VERSION;
  workspaceId: string;
  text: string;
  requestedDomains: readonly string[];
  strategy: "auto" | "keyword_only";
  candidateLimit: number;
  resultLimit: number;
  minimumSourceDiversity: number;
  freshnessAfter: string | null;
}>;

export type EvidenceCandidate = Readonly<{
  version: typeof EVIDENCE_CANDIDATE_VERSION;
  candidateId: string;
  workspaceId: string;
  domain: string;
  recordType: string;
  title: string;
  excerpt: string;
  summary: string | null;
  evidenceRole: EvidenceRole;
  source: Readonly<{
    sourceType: string;
    sourceId: string | null;
    sourceFileId: string | null;
    parentSourceId: string | null;
    canonicalSourceKey: string;
    independentSourceKey: string | null;
  }>;
  provenance: Readonly<{
    recordId: string;
    indexedAt: string;
    recordedAt: string | null;
    lineageVersion: string;
  }>;
  eligibility: Readonly<{
    eligible: true;
    lifecycleState: "active";
    originalEvidenceEligible: boolean;
    decisionVersion: string;
  }>;
  quality: string;
  confidenceScore: number;
  retrieval: Readonly<{
    mode: Exclude<EvidenceRetrievalMode, "none">;
    baseRank: number;
    score: number | null;
    embeddingVersion: string | null;
  }>;
}>;

export type CandidateRetrievalResult = Readonly<{
  version: "candidate_retrieval_result_v1";
  query: EvidenceQuery;
  retrieverId: string;
  retrieverVersion: string;
  retrievalMode: EvidenceRetrievalMode;
  candidates: readonly EvidenceCandidate[];
  selectedCandidateIds: readonly string[];
  limitations: readonly string[];
}>;

export interface CandidateRetriever {
  readonly id: string;
  readonly version: string;
  retrieve(query: EvidenceQuery): Promise<CandidateRetrievalResult>;
}

export type SourceRegistryEntry = Readonly<{
  sourceOrdinal: string;
  canonicalSourceKey: string;
  independentSourceKey: string | null;
  sourceType: string;
  title: string;
  evidenceRole: EvidenceRole;
  sourceId: string | null;
  sourceFileId: string | null;
  parentSourceId: string | null;
  candidateIds: readonly string[];
}>;

export type SourceRegistry = Readonly<{
  version: typeof SOURCE_REGISTRY_VERSION;
  workspaceId: string;
  entries: readonly SourceRegistryEntry[];
  candidateToSourceOrdinal: Readonly<Record<string, string>>;
  independentOriginalSourceCount: number;
}>;

export type RerankResult = Readonly<{
  version: typeof RERANK_RESULT_VERSION;
  adapterId: string;
  adapterVersion: string;
  provider: "deterministic" | "nvidia";
  model: string;
  mode: "shadow" | "active";
  status: "success" | "skipped" | "failed";
  rankings: readonly Readonly<{
    candidateOrdinal: number;
    rank: number;
    score: number | null;
  }>[];
  inputCount: number;
  inputTokens: number | null;
  inputTokensEstimated: boolean;
  latencyMs: number;
  failureCode: "disabled" | "missing_credentials" | "timeout" | "rate_limit" | "unavailable" | "malformed_response" | "transport_failure" | null;
}>;

export interface EvidenceReranker {
  readonly id: string;
  readonly version: string;
  readonly provider: RerankResult["provider"];
  readonly model: string;
  rerank(input: Readonly<{
    queryText: string;
    candidates: readonly EvidenceCandidate[];
    mode: "shadow" | "active";
    timeoutMs?: number;
  }>): Promise<RerankResult>;
}

export type RankedSignalPlan = Readonly<{
  version: typeof RANKED_SIGNAL_PLAN_VERSION;
  planId: string;
  manifestId: string;
  signals: readonly Readonly<{
    signalId: string;
    rank: number;
    domains: readonly string[];
    citationIds: readonly number[];
    independentSourceCount: number;
    confidenceCeiling: "Insufficient" | "Low" | "Medium" | "High";
  }>[];
  permittedRelationships: readonly Readonly<{
    leftSignalId: string;
    rightSignalId: string;
    citationIds: readonly number[];
  }>[];
  requiredSignalIds: readonly string[];
}>;

export type EvidenceManifestEntry = Readonly<{
  citationId: number;
  candidateId: string;
  sourceOrdinal: string;
  domain: string;
  title: string;
  excerpt: string;
  summary: string | null;
  evidenceRole: EvidenceRole;
  originalEvidenceEligible: boolean;
  confidenceScore: number;
  indexedAt: string;
  recordedAt: string | null;
  lineageVersion: string;
  eligibilityDecisionVersion: string;
}>;

export type EvidenceManifest = Readonly<{
  version: typeof EVIDENCE_MANIFEST_VERSION;
  manifestId: string;
  workspaceId: string;
  queryFingerprint: string;
  generatedAt: string;
  evidence: readonly EvidenceManifestEntry[];
  sourceRegistry: SourceRegistry;
  componentVersions: Readonly<{
    candidateRetriever: string;
    embedding: string | null;
    reranker: string;
    sourceRegistry: typeof SOURCE_REGISTRY_VERSION;
    signalPlanner: string;
    citationVerifier: typeof CITATION_VERIFICATION_VERSION;
  }>;
  policy: Readonly<{
    derivedOutputsExcludedFromOriginalEvidence: true;
    citationsApplicationGenerated: true;
    sourceIndependenceApplicationCalculated: true;
  }>;
}>;

export type CitationVerificationReason =
  | "unknown_citation"
  | "duplicate_citation"
  | "missing_required_citation"
  | "ineligible_evidence"
  | "source_registry_mismatch";

export type CitationVerificationResult = Readonly<{
  version: typeof CITATION_VERIFICATION_VERSION;
  verifierVersion: typeof CITATION_VERIFICATION_VERSION;
  valid: boolean;
  verifiedCitationIds: readonly number[];
  rejected: readonly Readonly<{
    citationId: number | null;
    reason: CitationVerificationReason;
  }>[];
  expectedCount: number;
  observedCount: number;
}>;
