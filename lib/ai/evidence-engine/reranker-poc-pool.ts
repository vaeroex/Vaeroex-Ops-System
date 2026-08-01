import type { EvidenceCandidate, EvidenceRetrievalMode } from "@/lib/ai/evidence-engine/contracts";
import { evidenceEngineHash } from "@/lib/ai/evidence-engine/hash";
import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";

export const RERANKER_POC_POOL_VERSION = "reranker_poc_pool_v1" as const;
export const RERANKER_POC_MAX_CANDIDATES = 48;

export type RetrievalPoolBucket = "1-3" | "4-5" | "6-8" | "9-20" | "21-48" | "49+" | "empty";

export type RetrievalPoolMeasurement = Readonly<{
  version: typeof RERANKER_POC_POOL_VERSION;
  candidatesBeforeEligibility: number;
  candidatesAfterEligibility: number;
  candidatesAfterExactDeduplication: number;
  candidatesAfterCanonicalSourceHandling: number;
  distinctSources: number;
  distinctSourceTypes: number;
  selectedCount: number;
  beforeEligibilityBucket: RetrievalPoolBucket;
  afterEligibilityBucket: RetrievalPoolBucket;
  candidatePoolBucket: RetrievalPoolBucket;
  retrievalMode: EvidenceRetrievalMode;
  vectorSucceeded: boolean;
  keywordFallbackUsed: boolean;
  retrievalLatencyMs: number;
}>;

function normalizedExactText(candidate: EvidenceCandidate) {
  return [candidate.title, candidate.summary || "", candidate.excerpt]
    .join("\n")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function exactDuplicateKey(candidate: EvidenceCandidate) {
  return evidenceEngineHash({
    canonicalSourceKey: candidate.source.canonicalSourceKey,
    text: normalizedExactText(candidate)
  });
}

export function removeExactCandidateDuplicates(candidates: readonly EvidenceCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = exactDuplicateKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function applyCanonicalSourcePoolHandling(
  candidates: readonly EvidenceCandidate[],
  maximumCandidates = RERANKER_POC_MAX_CANDIDATES
) {
  const boundedMaximum = Math.min(RERANKER_POC_MAX_CANDIDATES, Math.max(1, maximumCandidates));
  const firstBySource: EvidenceCandidate[] = [];
  const remaining: EvidenceCandidate[] = [];
  const seenSources = new Set<string>();

  for (const candidate of candidates) {
    if (!seenSources.has(candidate.source.canonicalSourceKey)) {
      seenSources.add(candidate.source.canonicalSourceKey);
      firstBySource.push(candidate);
    } else {
      remaining.push(candidate);
    }
  }

  return [...firstBySource, ...remaining].slice(0, boundedMaximum);
}

export function assertAuthorizedEligibleCandidatePool({
  workspaceId,
  candidates
}: {
  workspaceId: string;
  candidates: readonly EvidenceCandidate[];
}) {
  const candidateIds = new Set<string>();
  for (const candidate of candidates) {
    if (candidateIds.has(candidate.candidateId)) {
      throw new Error("The reranker POC candidate pool contains duplicate candidate IDs.");
    }
    candidateIds.add(candidate.candidateId);
    if (candidate.workspaceId !== workspaceId) {
      throw new Error("The reranker POC candidate pool contains a cross-workspace candidate.");
    }
    if (!candidate.eligibility.eligible || candidate.eligibility.lifecycleState !== "active") {
      throw new Error("The reranker POC candidate pool contains lifecycle-ineligible evidence.");
    }
  }
}

export function freezeRerankerPocCandidatePool({
  workspaceId,
  candidates
}: {
  workspaceId: string;
  candidates: readonly EvidenceCandidate[];
}) {
  assertAuthorizedEligibleCandidatePool({ workspaceId, candidates });
  const afterExactDeduplication = removeExactCandidateDuplicates(candidates);
  const frozenCandidates = applyCanonicalSourcePoolHandling(afterExactDeduplication);
  assertAuthorizedEligibleCandidatePool({ workspaceId, candidates: frozenCandidates });
  return deepFreeze({
    version: RERANKER_POC_POOL_VERSION,
    workspaceId,
    candidates: [...frozenCandidates],
    afterExactDeduplicationCount: afterExactDeduplication.length,
    afterCanonicalSourceHandlingCount: frozenCandidates.length
  });
}

function authorityTier(candidate: EvidenceCandidate) {
  if (candidate.evidenceRole === "original") return 0;
  if (candidate.evidenceRole === "supporting" && candidate.source.sourceType !== "business_note") return 1;
  if (candidate.evidenceRole === "supporting") return 2;
  if (candidate.evidenceRole === "historical") return 3;
  return 4;
}

export function applyDeterministicAuthorityAndDiversityPolicy(candidates: readonly EvidenceCandidate[]) {
  const rankedOrdinal = new Map(candidates.map((candidate, index) => [candidate.candidateId, index]));
  const firstBySource = new Map<string, EvidenceCandidate>();
  const remaining: EvidenceCandidate[] = [];

  for (const candidate of candidates) {
    if (!firstBySource.has(candidate.source.canonicalSourceKey)) {
      firstBySource.set(candidate.source.canonicalSourceKey, candidate);
    } else {
      remaining.push(candidate);
    }
  }

  const byAuthorityThenRank = (left: EvidenceCandidate, right: EvidenceCandidate) =>
    authorityTier(left) - authorityTier(right) ||
    (rankedOrdinal.get(left.candidateId) || 0) - (rankedOrdinal.get(right.candidateId) || 0) ||
    left.candidateId.localeCompare(right.candidateId);

  return [
    ...Array.from(firstBySource.values()).sort(byAuthorityThenRank),
    ...remaining.sort(byAuthorityThenRank)
  ];
}

export function retrievalPoolBucket(count: number): RetrievalPoolBucket {
  if (count <= 0) return "empty";
  if (count <= 3) return "1-3";
  if (count <= 5) return "4-5";
  if (count <= 8) return "6-8";
  if (count <= 20) return "9-20";
  if (count <= 48) return "21-48";
  return "49+";
}

export function buildRetrievalPoolMeasurement({
  candidatesBeforeEligibility,
  eligibleCandidates,
  selectedCount,
  retrievalMode,
  vectorSucceeded,
  keywordFallbackUsed,
  retrievalLatencyMs
}: {
  candidatesBeforeEligibility: number;
  eligibleCandidates: readonly EvidenceCandidate[];
  selectedCount: number;
  retrievalMode: EvidenceRetrievalMode;
  vectorSucceeded: boolean;
  keywordFallbackUsed: boolean;
  retrievalLatencyMs: number;
}): RetrievalPoolMeasurement {
  const afterExactDeduplication = removeExactCandidateDuplicates(eligibleCandidates);
  const afterCanonicalSourceHandling = applyCanonicalSourcePoolHandling(afterExactDeduplication);
  return deepFreeze({
    version: RERANKER_POC_POOL_VERSION,
    candidatesBeforeEligibility: Math.max(candidatesBeforeEligibility, eligibleCandidates.length),
    candidatesAfterEligibility: eligibleCandidates.length,
    candidatesAfterExactDeduplication: afterExactDeduplication.length,
    candidatesAfterCanonicalSourceHandling: afterCanonicalSourceHandling.length,
    distinctSources: new Set(afterCanonicalSourceHandling.map((candidate) => candidate.source.canonicalSourceKey)).size,
    distinctSourceTypes: new Set(afterCanonicalSourceHandling.map((candidate) => candidate.source.sourceType)).size,
    selectedCount: Math.min(Math.max(0, selectedCount), afterCanonicalSourceHandling.length),
    beforeEligibilityBucket: retrievalPoolBucket(Math.max(candidatesBeforeEligibility, eligibleCandidates.length)),
    afterEligibilityBucket: retrievalPoolBucket(eligibleCandidates.length),
    candidatePoolBucket: retrievalPoolBucket(afterCanonicalSourceHandling.length),
    retrievalMode,
    vectorSucceeded,
    keywordFallbackUsed,
    retrievalLatencyMs: Math.max(0, Math.round(retrievalLatencyMs))
  });
}

export function retrievalPoolInstrumentationEnabled() {
  if (process.env.VERCEL_ENV === "production") return false;
  return process.env.VAEROEX_RERANK_POOL_INSTRUMENTATION === "true";
}

export function aggregatePoolSizeDistribution(measurements: readonly RetrievalPoolMeasurement[]) {
  const emptyDistribution = (): Record<RetrievalPoolBucket, number> => ({
    empty: 0,
    "1-3": 0,
    "4-5": 0,
    "6-8": 0,
    "9-20": 0,
    "21-48": 0,
    "49+": 0
  });
  const beforeEligibility = emptyDistribution();
  const afterEligibility = emptyDistribution();
  const afterExactDeduplication = emptyDistribution();
  const afterCanonicalSourceHandling = emptyDistribution();
  for (const measurement of measurements) {
    beforeEligibility[measurement.beforeEligibilityBucket] += 1;
    afterEligibility[measurement.afterEligibilityBucket] += 1;
    afterExactDeduplication[retrievalPoolBucket(measurement.candidatesAfterExactDeduplication)] += 1;
    afterCanonicalSourceHandling[measurement.candidatePoolBucket] += 1;
  }
  return deepFreeze({
    beforeEligibility,
    afterEligibility,
    afterExactDeduplication,
    afterCanonicalSourceHandling
  });
}

export function contentFreePoolMeasurement(measurement: RetrievalPoolMeasurement) {
  return { ...measurement };
}
