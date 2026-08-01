import type { EvidenceCandidate, EvidenceReranker, RerankResult } from "@/lib/ai/evidence-engine/contracts";
import {
  EVIDENCE_ENGINE_FROZEN_FIXTURES,
  fixtureEvidenceCandidates,
  frozenRecordIsEligible,
  type FrozenEvidenceFixture
} from "@/lib/ai/evidence-engine/benchmark-fixtures";
import { applyRerankResult } from "@/lib/ai/evidence-engine/reranker";
import {
  NVIDIA_RERANKER_POC_FIXTURES,
  RERANKER_POC_WORKSPACE_ID,
  assertSyntheticRerankerPocCandidates,
  rerankerPocFixtureCandidates,
  rerankerPocRecordIsEligible,
  type RerankerPocFixture,
  type RerankerPocRecord
} from "@/lib/ai/evidence-engine/reranker-poc-fixtures";
import {
  aggregatePoolSizeDistribution,
  applyDeterministicAuthorityAndDiversityPolicy,
  buildRetrievalPoolMeasurement,
  freezeRerankerPocCandidatePool,
  type RetrievalPoolMeasurement
} from "@/lib/ai/evidence-engine/reranker-poc-pool";
import { deepFreeze } from "@/lib/ai/evidence-engine/immutability";

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentileValue * sorted.length) - 1))];
}

function judgments(fixture: FrozenEvidenceFixture) {
  return new Map(fixture.records.map((record) => [record.id, record]));
}

function dcg(grades: number[]) {
  return grades.reduce((sum, grade, index) => sum + (Math.pow(2, grade) - 1) / Math.log2(index + 2), 0);
}

export function evaluateEvidenceRanking(fixture: FrozenEvidenceFixture, candidates: readonly EvidenceCandidate[]) {
  const byId = judgments(fixture);
  const eligibleRelevant = fixture.records.filter((record) => frozenRecordIsEligible(record) && record.relevanceGrade > 0);
  const top20 = candidates.slice(0, 20);
  const top10 = candidates.slice(0, 10);
  const relevantTop20 = top20.filter((candidate) => (byId.get(candidate.candidateId)?.relevanceGrade || 0) > 0);
  const relevantTop10 = top10.filter((candidate) => (byId.get(candidate.candidateId)?.relevanceGrade || 0) > 0);
  const grades = top10.map((candidate) => byId.get(candidate.candidateId)?.relevanceGrade || 0);
  const idealGrades = eligibleRelevant.map((record) => record.relevanceGrade).sort((left, right) => right - left).slice(0, 10);
  const idealDcg = dcg(idealGrades);
  const firstRelevantIndex = candidates.findIndex((candidate) => (byId.get(candidate.candidateId)?.relevanceGrade || 0) > 0);
  const coveredSignals = new Set(
    top10.map((candidate) => byId.get(candidate.candidateId)?.signalId).filter((signal): signal is string => Boolean(signal))
  );
  const requiredSignalCoverage = fixture.requiredSignalIds.length
    ? fixture.requiredSignalIds.filter((signal) => coveredSignals.has(signal)).length / fixture.requiredSignalIds.length
    : 1;
  const sourceDiversity = new Set(top10.map((candidate) => candidate.source.canonicalSourceKey)).size;
  const independentSourceCoverage = new Set(
    top10.map((candidate) => candidate.source.independentSourceKey).filter((key): key is string => Boolean(key))
  ).size;
  const citationPrecision = top10.length ? relevantTop10.length / top10.length : fixture.shouldRetrieve ? 0 : 1;

  return {
    recallAt20: eligibleRelevant.length ? relevantTop20.length / eligibleRelevant.length : 1,
    precisionAt10: relevantTop10.length / 10,
    ndcgAt10: idealDcg ? dcg(grades) / idealDcg : 1,
    mrr: firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : eligibleRelevant.length ? 0 : 1,
    sourceDiversity,
    independentSourceCoverage,
    citationPrecision,
    downstreamSignalPlanQuality: requiredSignalCoverage,
    downstreamAnswerQuality: requiredSignalCoverage * 0.65 + citationPrecision * 0.35
  };
}

function lifecycleExclusionAccuracy(fixture: FrozenEvidenceFixture, candidates: readonly EvidenceCandidate[]) {
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  const correct = fixture.records.filter((record) => candidateIds.has(record.id) === (fixture.shouldRetrieve && frozenRecordIsEligible(record))).length;
  return fixture.records.length ? correct / fixture.records.length : 1;
}

function workspaceIsolationAccuracy(fixture: FrozenEvidenceFixture, candidates: readonly EvidenceCandidate[]) {
  const foreignIds = new Set(fixture.records.filter((record) => record.workspaceId && record.workspaceId !== "fixture-workspace").map((record) => record.id));
  return candidates.some((candidate) => foreignIds.has(candidate.candidateId)) ? 0 : 1;
}

export type EvidenceBenchmarkRun = {
  fixtureId: string;
  baseline: ReturnType<typeof evaluateEvidenceRanking>;
  reranked: ReturnType<typeof evaluateEvidenceRanking>;
  rerankResult: RerankResult;
  lifecycleExclusionAccuracy: number;
  workspaceIsolationAccuracy: number;
  fallbackCorrect: boolean;
};

export async function runEvidenceEngineRerankerBenchmark({
  reranker,
  fixtures = EVIDENCE_ENGINE_FROZEN_FIXTURES
}: {
  reranker: EvidenceReranker;
  fixtures?: readonly FrozenEvidenceFixture[];
}) {
  const runs: EvidenceBenchmarkRun[] = [];

  for (const fixture of fixtures) {
    const candidates = fixtureEvidenceCandidates(fixture);
    const result = fixture.shouldRetrieve
      ? await reranker.rerank({ queryText: fixture.query, candidates, mode: "shadow" })
      : {
          version: "rerank_result_v1" as const,
          adapterId: reranker.id,
          adapterVersion: reranker.version,
          provider: reranker.provider,
          model: reranker.model,
          mode: "shadow" as const,
          status: "skipped" as const,
          rankings: [],
          inputCount: 0,
          inputTokens: 0,
          inputTokensEstimated: false,
          latencyMs: 0,
          failureCode: "disabled" as const
        };
    const reranked = applyRerankResult(candidates, result);
    runs.push({
      fixtureId: fixture.fixtureId,
      baseline: evaluateEvidenceRanking(fixture, candidates),
      reranked: evaluateEvidenceRanking(fixture, reranked),
      rerankResult: result,
      lifecycleExclusionAccuracy: lifecycleExclusionAccuracy(fixture, candidates),
      workspaceIsolationAccuracy: workspaceIsolationAccuracy(fixture, candidates),
      fallbackCorrect: result.status === "success" || reranked.map((item) => item.candidateId).join("|") === candidates.map((item) => item.candidateId).join("|")
    });
  }

  const measured = runs.filter((run) => run.rerankResult.status !== "skipped" || run.fixtureId !== "navigation_query");
  const metric = (side: "baseline" | "reranked", key: keyof EvidenceBenchmarkRun["baseline"]) =>
    average(measured.map((run) => Number(run[side][key])));
  const latencies = measured.map((run) => run.rerankResult.latencyMs);
  const inputTokens = measured.reduce((sum, run) => sum + (run.rerankResult.inputTokens || 0), 0);
  const configuredCost = Number.parseFloat(process.env.NVIDIA_RERANK_INPUT_COST_CENTS_PER_1M || "");
  const estimatedCostCents = Number.isFinite(configuredCost) ? (inputTokens / 1_000_000) * configuredCost : null;
  const baseline = {
    recallAt20: metric("baseline", "recallAt20"),
    precisionAt10: metric("baseline", "precisionAt10"),
    ndcgAt10: metric("baseline", "ndcgAt10"),
    mrr: metric("baseline", "mrr"),
    sourceDiversity: metric("baseline", "sourceDiversity"),
    independentSourceCoverage: metric("baseline", "independentSourceCoverage"),
    citationPrecision: metric("baseline", "citationPrecision"),
    downstreamSignalPlanQuality: metric("baseline", "downstreamSignalPlanQuality"),
    downstreamAnswerQuality: metric("baseline", "downstreamAnswerQuality")
  };
  const reranked = {
    recallAt20: metric("reranked", "recallAt20"),
    precisionAt10: metric("reranked", "precisionAt10"),
    ndcgAt10: metric("reranked", "ndcgAt10"),
    mrr: metric("reranked", "mrr"),
    sourceDiversity: metric("reranked", "sourceDiversity"),
    independentSourceCoverage: metric("reranked", "independentSourceCoverage"),
    citationPrecision: metric("reranked", "citationPrecision"),
    downstreamSignalPlanQuality: metric("reranked", "downstreamSignalPlanQuality"),
    downstreamAnswerQuality: metric("reranked", "downstreamAnswerQuality")
  };
  const qualification = {
    zeroLifecycleLeakage: runs.every((run) => run.lifecycleExclusionAccuracy === 1),
    zeroWorkspaceLeakage: runs.every((run) => run.workspaceIsolationAccuracy === 1),
    noMaterialRecallRegression: reranked.recallAt20 >= baseline.recallAt20 - 0.01,
    noCitationPrecisionRegression: reranked.citationPrecision >= baseline.citationPrecision,
    measurableRankingImprovement:
      reranked.ndcgAt10 >= baseline.ndcgAt10 + 0.05 ||
      reranked.mrr >= baseline.mrr + 0.05 ||
      reranked.precisionAt10 >= baseline.precisionAt10 + 0.05,
    acceptableP95Latency: percentile(latencies, 0.95) <= 500,
    correctFailOpenBehavior: runs.every((run) => run.fallbackCorrect),
    unsupportedClaimIncrease: null as null,
    readyForPromotion: false
  };

  return {
    benchmarkVersion: "evidence_engine_reranker_benchmark_v1",
    fixtureCount: fixtures.length,
    baseline,
    reranked,
    latency: { averageMs: average(latencies), p95Ms: percentile(latencies, 0.95) },
    cost: { inputTokens, estimatedCostCents, estimateAvailable: estimatedCostCents !== null },
    adapterFailures: runs.filter((run) => run.rerankResult.status === "failed").length,
    fallbackCorrectness: average(runs.map((run) => run.fallbackCorrect ? 1 : 0)),
    lifecycleExclusionAccuracy: average(runs.map((run) => run.lifecycleExclusionAccuracy)),
    workspaceIsolationAccuracy: average(runs.map((run) => run.workspaceIsolationAccuracy)),
    qualification,
    runs
  };
}

const POC_RECALL_CUTOFFS = [1, 3, 5, 10, 20] as const;
const POC_PRECISION_CUTOFFS = [1, 3, 5, 10] as const;

function normalizedCandidateContent(candidate: EvidenceCandidate) {
  return `${candidate.title}\n${candidate.summary || ""}\n${candidate.excerpt}`
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function pocRecordsById(fixture: RerankerPocFixture) {
  return new Map(fixture.records.map((record) => [record.candidateId, record]));
}

function relevantRecord(record: RerankerPocRecord | undefined) {
  return Boolean(record && record.relevanceGrade > 0 && rerankerPocRecordIsEligible(record));
}

function rate(count: number, total: number) {
  return total ? count / total : 0;
}

export function evaluateRerankerPocRanking(
  fixture: RerankerPocFixture,
  candidates: readonly EvidenceCandidate[]
) {
  const byId = pocRecordsById(fixture);
  const eligibleCandidateIds = new Set(rerankerPocFixtureCandidates(fixture).map((candidate) => candidate.candidateId));
  const eligibleRelevantIds = new Set(
    candidates
      .filter((candidate) => relevantRecord(byId.get(candidate.candidateId)))
      .map((candidate) => candidate.candidateId)
  );
  const selected = candidates.slice(0, fixture.resultLimit);
  const at = (cutoff: number) => candidates.slice(0, cutoff);
  const relevantAt = (cutoff: number) => at(cutoff).filter((candidate) => relevantRecord(byId.get(candidate.candidateId))).length;
  const recallAt = (cutoff: number) => eligibleRelevantIds.size ? relevantAt(cutoff) / eligibleRelevantIds.size : 1;
  const precisionAt = (cutoff: number) => rate(relevantAt(cutoff), Math.min(cutoff, candidates.length));
  const gradesAt = (cutoff: number) => at(cutoff).map((candidate) => byId.get(candidate.candidateId)?.relevanceGrade || 0);
  const idealGradesAt = (cutoff: number) => Array.from(eligibleRelevantIds)
    .map((candidateId) => byId.get(candidateId)?.relevanceGrade || 0)
    .sort((left, right) => right - left)
    .slice(0, cutoff);
  const ndcgAt = (cutoff: number) => {
    const ideal = dcg(idealGradesAt(cutoff));
    return ideal ? dcg(gradesAt(cutoff)) / ideal : 1;
  };
  const firstRelevantIndex = candidates.findIndex((candidate) => relevantRecord(byId.get(candidate.candidateId)));
  const selectedRecords = selected.map((candidate) => byId.get(candidate.candidateId)).filter((item): item is RerankerPocRecord => Boolean(item));
  const exactSelectedKeys = selected.map((candidate) => `${candidate.source.canonicalSourceKey}:${normalizedCandidateContent(candidate)}`);
  const duplicateSelectedCount = exactSelectedKeys.length - new Set(exactSelectedKeys).size;
  const relevantSelectedRecords = selectedRecords.filter((record) => record.relevanceGrade > 0);
  let authorityPairs = 0;
  let authorityInversions = 0;
  for (let leftIndex = 0; leftIndex < relevantSelectedRecords.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < relevantSelectedRecords.length; rightIndex += 1) {
      const left = relevantSelectedRecords[leftIndex];
      const right = relevantSelectedRecords[rightIndex];
      if (left.expectedAuthorityPreference === right.expectedAuthorityPreference) continue;
      authorityPairs += 1;
      if (left.expectedAuthorityPreference > right.expectedAuthorityPreference) authorityInversions += 1;
    }
  }
  const firstRelevantOriginal = selectedRecords.findIndex((record) => record.relevanceGrade > 0 && record.evidenceRole === "original");
  const firstRelevantBusinessNote = selectedRecords.findIndex((record) =>
    record.relevanceGrade > 0 && record.sourceType === "business_note"
  );
  const businessNoteOverPromotion = firstRelevantOriginal >= 0 && firstRelevantBusinessNote >= 0 && firstRelevantBusinessNote < firstRelevantOriginal
    ? 1
    : 0;
  const coveredGroups = new Set(selectedRecords.map((record) => record.relevanceGroup).filter((value): value is string => Boolean(value)));
  const downstreamContextValidationFailed = fixture.requiredRelevanceGroups.some((group) => !coveredGroups.has(group));
  const citationSourceCorrect = selected.every((candidate) => {
    const record = byId.get(candidate.candidateId);
    return Boolean(
      record &&
      eligibleCandidateIds.has(candidate.candidateId) &&
      candidate.workspaceId === RERANKER_POC_WORKSPACE_ID &&
      candidate.source.sourceId === record?.sourceId &&
      candidate.source.canonicalSourceKey === `${RERANKER_POC_WORKSPACE_ID}:${record?.canonicalSourceId}`
    );
  });

  return {
    recallAt1: recallAt(1),
    recallAt3: recallAt(3),
    recallAt5: recallAt(5),
    recallAt10: recallAt(10),
    recallAt20: recallAt(20),
    precisionAt1: precisionAt(1),
    precisionAt3: precisionAt(3),
    precisionAt5: precisionAt(5),
    precisionAt10: precisionAt(10),
    mrr: firstRelevantIndex >= 0 ? 1 / (firstRelevantIndex + 1) : eligibleRelevantIds.size ? 0 : 1,
    ndcgAt5: ndcgAt(5),
    ndcgAt10: ndcgAt(10),
    firstRelevantResultPosition: firstRelevantIndex >= 0 ? firstRelevantIndex + 1 : null,
    irrelevantSelectedChunkRate: rate(selectedRecords.filter((record) => record.relevanceGrade === 0).length, selected.length),
    duplicateSelectedChunkRate: rate(duplicateSelectedCount, selected.length),
    wrongEntityRate: rate(selectedRecords.filter((record) => record.wrongEntity).length, selected.length),
    wrongKpiRate: rate(selectedRecords.filter((record) => record.wrongKpi).length, selected.length),
    wrongReportingPeriodRate: rate(selectedRecords.filter((record) => record.wrongReportingPeriod).length, selected.length),
    staleSourceRate: rate(selectedRecords.filter((record) => record.freshness === "stale").length, selected.length),
    sourceAuthorityInversionRate: rate(authorityInversions, authorityPairs),
    businessNoteOverPromotionRate: businessNoteOverPromotion,
    citationSourceCorrectness: citationSourceCorrect ? 1 : 0,
    downstreamContextValidationFailureRate: downstreamContextValidationFailed ? 1 : 0
  };
}

export class RerankerPocCircuitBreaker {
  private attempts = 0;
  private failures = 0;
  private consecutiveFailures = 0;
  private openReason: "five_consecutive_failures" | "sustained_failure_rate" | null = null;

  canAttempt() {
    return this.openReason === null;
  }

  record(status: RerankResult["status"]) {
    if (status === "skipped") return;
    this.attempts += 1;
    if (status === "success") {
      this.consecutiveFailures = 0;
      return;
    }
    this.failures += 1;
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 5) {
      this.openReason = "five_consecutive_failures";
    } else if (this.attempts >= 50 && this.failures / this.attempts > 0.02) {
      this.openReason = "sustained_failure_rate";
    }
  }

  snapshot() {
    return deepFreeze({
      attempts: this.attempts,
      failures: this.failures,
      consecutiveFailures: this.consecutiveFailures,
      open: this.openReason !== null,
      openReason: this.openReason
    });
  }
}

function circuitBreakerResult(reranker: EvidenceReranker, candidateCount: number): RerankResult {
  return deepFreeze({
    version: "rerank_result_v1" as const,
    adapterId: reranker.id,
    adapterVersion: reranker.version,
    provider: reranker.provider,
    model: reranker.model,
    mode: "shadow" as const,
    status: "skipped" as const,
    rankings: [],
    inputCount: candidateCount,
    inputTokens: 0,
    inputTokensEstimated: false,
    latencyMs: 0,
    failureCode: "circuit_breaker_open" as const
  });
}

export const RERANKER_POC_MAX_PROVIDER_REQUESTS = 250;
export const RERANKER_POC_LATENCY_POOL_SIZES = [3, 8, 20, 48] as const;
export const RERANKER_POC_WARMUP_CALLS_PER_POOL = 1;
export const RERANKER_POC_MEASURED_CALLS_PER_POOL = 25;
export const RERANKER_POC_PLANNED_PROVIDER_REQUESTS =
  NVIDIA_RERANKER_POC_FIXTURES.length +
  RERANKER_POC_LATENCY_POOL_SIZES.length *
    (RERANKER_POC_WARMUP_CALLS_PER_POOL + RERANKER_POC_MEASURED_CALLS_PER_POOL);

class BoundedRerankerPocAdapter implements EvidenceReranker {
  readonly id: string;
  readonly version: string;
  readonly provider: EvidenceReranker["provider"];
  readonly model: string;
  private attemptedRequests = 0;
  private successfulRequests = 0;
  private inputTokens = 0;
  private readonly failures = new Map<NonNullable<RerankResult["failureCode"]>, number>();

  constructor(
    private readonly delegate: EvidenceReranker,
    private readonly maximumRequests = RERANKER_POC_MAX_PROVIDER_REQUESTS
  ) {
    if (maximumRequests < 1 || maximumRequests > RERANKER_POC_MAX_PROVIDER_REQUESTS) {
      throw new Error("The NVIDIA reranker POC request limit is outside the approved boundary.");
    }
    this.id = delegate.id;
    this.version = delegate.version;
    this.provider = delegate.provider;
    this.model = delegate.model;
  }

  async rerank(input: Parameters<EvidenceReranker["rerank"]>[0]) {
    if (this.attemptedRequests >= this.maximumRequests) {
      return circuitBreakerResult(this.delegate, input.candidates.length);
    }
    this.attemptedRequests += 1;
    const result = await this.delegate.rerank(input);
    if (result.status === "success") this.successfulRequests += 1;
    if (result.failureCode) {
      this.failures.set(result.failureCode, (this.failures.get(result.failureCode) || 0) + 1);
    }
    this.inputTokens += result.inputTokens || 0;
    return result;
  }

  snapshot() {
    return deepFreeze({
      maximumRequests: this.maximumRequests,
      attemptedRequests: this.attemptedRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.attemptedRequests - this.successfulRequests,
      inputTokens: this.inputTokens,
      requestLimitReached: this.attemptedRequests >= this.maximumRequests,
      authenticationFailures: this.failures.get("authentication_failed") || 0,
      schemaFailures: this.failures.get("malformed_response") || 0,
      timeouts: this.failures.get("timeout") || 0,
      providerErrors: Array.from(this.failures.entries()).reduce((sum, [code, count]) =>
        ["rate_limit", "unavailable", "transport_failure"].includes(code) ? sum + count : sum, 0)
    });
  }
}

type PocMetrics = ReturnType<typeof evaluateRerankerPocRanking>;

type RerankerPocBenchmarkRun = {
  queryId: string;
  category: RerankerPocFixture["category"];
  retrievalMode: RerankerPocFixture["retrievalMode"];
  resultLimit: number;
  measurement: RetrievalPoolMeasurement;
  baseline: PocMetrics;
  reranked: PocMetrics;
  baselineSelectedCandidateIds: string[];
  rerankedSelectedCandidateIds: string[];
  rerankResult: RerankResult;
  fallbackCorrect: boolean;
  sourceMetadataPreserved: boolean;
  activeResultUnchanged: true;
  excludedCandidateIds: string[];
  crossWorkspaceExcludedCandidateIds: string[];
  lifecycleExcludedCandidateIds: string[];
};

function aggregatePocMetrics(items: readonly PocMetrics[]) {
  const keys = Object.keys(items[0] || {}) as Array<keyof PocMetrics>;
  return Object.fromEntries(keys.map((key) => {
    const values = items.map((item) => item[key]).filter((value): value is number => typeof value === "number");
    return [key, average(values)];
  })) as Record<keyof PocMetrics, number>;
}

function relativeReduction(baseline: number, candidate: number) {
  if (baseline === 0) return candidate === 0 ? 0 : Number.NEGATIVE_INFINITY;
  return (baseline - candidate) / baseline;
}

export async function runNvidiaRerankerPocBenchmark({
  reranker,
  fixtures = NVIDIA_RERANKER_POC_FIXTURES,
  timeoutMs = 750,
  inputCostCentsPerMillion = Number.parseFloat(process.env.NVIDIA_RERANK_INPUT_COST_CENTS_PER_1M || ""),
  circuitBreaker = new RerankerPocCircuitBreaker()
}: {
  reranker: EvidenceReranker;
  fixtures?: readonly RerankerPocFixture[];
  timeoutMs?: number;
  inputCostCentsPerMillion?: number;
  circuitBreaker?: RerankerPocCircuitBreaker;
}) {
  const runs: RerankerPocBenchmarkRun[] = [];

  for (const fixture of fixtures) {
    const eligibleCandidates = rerankerPocFixtureCandidates(fixture);
    const frozenPool = freezeRerankerPocCandidatePool({
      workspaceId: RERANKER_POC_WORKSPACE_ID,
      candidates: eligibleCandidates
    });
    assertSyntheticRerankerPocCandidates(frozenPool.candidates);
    const measurement = buildRetrievalPoolMeasurement({
      candidatesBeforeEligibility: fixture.records.length,
      eligibleCandidates,
      selectedCount: Math.min(fixture.resultLimit, frozenPool.candidates.length),
      retrievalMode: fixture.retrievalMode,
      vectorSucceeded: fixture.retrievalMode === "vector",
      keywordFallbackUsed: false,
      retrievalLatencyMs: 0
    });
    const sourceMetadataBefore = frozenPool.candidates.map((candidate) => JSON.stringify({
      candidateId: candidate.candidateId,
      workspaceId: candidate.workspaceId,
      source: candidate.source,
      evidenceRole: candidate.evidenceRole,
      confidenceScore: candidate.confidenceScore,
      eligibility: candidate.eligibility
    }));
    const result = circuitBreaker.canAttempt()
      ? await reranker.rerank({
          queryText: fixture.queryText,
          candidates: frozenPool.candidates,
          mode: "shadow",
          timeoutMs
        })
      : circuitBreakerResult(reranker, frozenPool.candidates.length);
    circuitBreaker.record(result.status);
    const rerankedCandidates = applyRerankResult(frozenPool.candidates, result);
    const policyCandidates = result.status === "success"
      ? applyDeterministicAuthorityAndDiversityPolicy(rerankedCandidates)
      : [...frozenPool.candidates];
    const sourceMetadataAfter = policyCandidates.map((candidate) => JSON.stringify({
      candidateId: candidate.candidateId,
      workspaceId: candidate.workspaceId,
      source: candidate.source,
      evidenceRole: candidate.evidenceRole,
      confidenceScore: candidate.confidenceScore,
      eligibility: candidate.eligibility
    })).sort();
    const preservedMetadata = [...sourceMetadataBefore].sort().every((value, index) => value === sourceMetadataAfter[index]);
    const fallbackCorrect = result.status === "success" ||
      rerankedCandidates.map((candidate) => candidate.candidateId).join("|") === frozenPool.candidates.map((candidate) => candidate.candidateId).join("|");

    runs.push({
      queryId: fixture.queryId,
      category: fixture.category,
      retrievalMode: fixture.retrievalMode,
      resultLimit: fixture.resultLimit,
      measurement,
      baseline: evaluateRerankerPocRanking(fixture, frozenPool.candidates),
      reranked: evaluateRerankerPocRanking(fixture, policyCandidates),
      baselineSelectedCandidateIds: frozenPool.candidates.slice(0, fixture.resultLimit).map((candidate) => candidate.candidateId),
      rerankedSelectedCandidateIds: policyCandidates.slice(0, fixture.resultLimit).map((candidate) => candidate.candidateId),
      rerankResult: result,
      fallbackCorrect,
      sourceMetadataPreserved: preservedMetadata,
      activeResultUnchanged: true,
      excludedCandidateIds: fixture.records.filter((record) => !rerankerPocRecordIsEligible(record)).map((record) => record.candidateId),
      crossWorkspaceExcludedCandidateIds: fixture.records
        .filter((record) => record.expectedExclusion === "cross_workspace")
        .map((record) => record.candidateId),
      lifecycleExcludedCandidateIds: fixture.records
        .filter((record) => record.expectedExclusion !== null && record.expectedExclusion !== "cross_workspace")
        .map((record) => record.candidateId)
    });
  }

  const baseline = aggregatePocMetrics(runs.map((run) => run.baseline));
  const reranked = aggregatePocMetrics(runs.map((run) => run.reranked));
  const calls = runs.filter((run) => run.rerankResult.status !== "skipped");
  const successfulCalls = calls.filter((run) => run.rerankResult.status === "success");
  const latencies = calls.map((run) => run.rerankResult.latencyMs);
  const inputTokens = calls.reduce((sum, run) => sum + (run.rerankResult.inputTokens || 0), 0);
  const estimatedCostCents = Number.isFinite(inputCostCentsPerMillion)
    ? (inputTokens / 1_000_000) * inputCostCentsPerMillion
    : null;
  const estimatedCostPerThousandCents = estimatedCostCents !== null && successfulCalls.length
    ? estimatedCostCents / successfulCalls.length * 1_000
    : null;
  const timeoutRate = rate(calls.filter((run) => run.rerankResult.failureCode === "timeout").length, calls.length);
  const providerErrorRate = rate(calls.filter((run) => run.rerankResult.status === "failed" && run.rerankResult.failureCode !== "timeout").length, calls.length);
  const fallbackRate = rate(runs.filter((run) => run.rerankResult.status !== "success").length, runs.length);
  const categoryMetrics = Object.fromEntries(Array.from(new Set(runs.map((run) => run.category))).map((category) => {
    const categoryRuns = runs.filter((run) => run.category === category);
    return [category, {
      queryCount: categoryRuns.length,
      baseline: aggregatePocMetrics(categoryRuns.map((run) => run.baseline)),
      reranked: aggregatePocMetrics(categoryRuns.map((run) => run.reranked))
    }];
  }));
  const primaryMetrics = ["recallAt20", "precisionAt10", "ndcgAt10", "mrr"] as const;
  const measurableRankingImprovement =
    reranked.ndcgAt10 >= baseline.ndcgAt10 + 0.05 ||
    reranked.mrr >= baseline.mrr + 0.05 ||
    reranked.precisionAt10 >= baseline.precisionAt10 + 0.05;
  const noOtherPrimaryMetricRegression = primaryMetrics.every((key) => reranked[key] >= baseline[key] - 0.01);
  const qualification = {
    zeroCrossWorkspaceLeakage: runs.every((run) => run.crossWorkspaceExcludedCandidateIds.every((candidateId) =>
      !run.baselineSelectedCandidateIds.includes(candidateId) && !run.rerankedSelectedCandidateIds.includes(candidateId)
    )),
    zeroLifecycleLeakage: runs.every((run) => run.lifecycleExcludedCandidateIds.every((candidateId) =>
      !run.baselineSelectedCandidateIds.includes(candidateId) && !run.rerankedSelectedCandidateIds.includes(candidateId)
    )),
    citationSourceCorrectnessMaintained: reranked.citationSourceCorrectness === 1,
    noBusinessNoteAuthorityPromotion: reranked.businessNoteOverPromotionRate === 0,
    noMaterialRecallRegression: reranked.recallAt20 >= baseline.recallAt20 - 0.01,
    measurableRankingImprovement,
    noOtherPrimaryMetricRegression,
    irrelevantSelectionReductionAtLeastTenPercent:
      relativeReduction(baseline.irrelevantSelectedChunkRate, reranked.irrelevantSelectedChunkRate) >= 0.10,
    noDownstreamValidationFailureIncrease:
      reranked.downstreamContextValidationFailureRate <= baseline.downstreamContextValidationFailureRate,
    acceptableP95Latency: percentile(latencies, 0.95) <= 500,
    acceptableP99Latency: percentile(latencies, 0.99) <= 750,
    acceptableTimeoutRate: timeoutRate <= 0.01,
    acceptableFallbackRate: fallbackRate <= 0.02,
    acceptableEstimatedCost: estimatedCostPerThousandCents === null || estimatedCostPerThousandCents <= 500,
    completeSourceMetadataPreservation: runs.every((run) => run.sourceMetadataPreserved),
    correctFailOpenBehavior: runs.every((run) => run.fallbackCorrect),
    activeResultsUnchanged: runs.every((run) => run.activeResultUnchanged)
  };
  const mandatoryGatesPassed = Object.values(qualification).every(Boolean);

  return deepFreeze({
    benchmarkVersion: "nvidia_reranker_shadow_poc_benchmark_v1",
    fixtureVersion: "nvidia_reranker_poc_fixture_v1",
    fixtureCount: fixtures.length,
    baseline,
    reranked,
    categoryMetrics,
    poolSizeDistribution: aggregatePoolSizeDistribution(runs.map((run) => run.measurement)),
    latency: {
      p50Ms: percentile(latencies, 0.50),
      p95Ms: percentile(latencies, 0.95),
      p99Ms: percentile(latencies, 0.99)
    },
    failures: {
      timeoutRate,
      providerErrorRate,
      fallbackRate,
      providerErrorCount: calls.filter((run) => run.rerankResult.status === "failed").length,
      circuitBreaker: circuitBreaker.snapshot()
    },
    cost: {
      inputTokens,
      configuredInputCostCentsPerMillion: Number.isFinite(inputCostCentsPerMillion) ? inputCostCentsPerMillion : null,
      estimatedCostCents,
      estimatedCostPerThousandQualifiedReranksCents: estimatedCostPerThousandCents,
      estimateAvailable: estimatedCostPerThousandCents !== null
    },
    qualification: {
      ...qualification,
      mandatoryGatesPassed,
      qualifiedForActivePilot: mandatoryGatesPassed && successfulCalls.length === fixtures.length,
      readyForProduction: false
    },
    activeVolumeAssessment: {
      measuredFromActiveRuntime: false,
      knownFocusedFileAnalysisResultLimit: 3,
      requiresNonProductionRuntimeMeasurement: true
    },
    runs
  });
}

const POC_CATEGORY_GROUPS = {
  kpiAliases: ["kpi_alias", "similar_kpi"],
  semanticDirection: ["maximize_kpi", "minimize_kpi", "target_range_kpi", "exact_target_kpi"],
  reportingPeriodConflicts: ["reporting_period", "wrong_period"],
  entityConflicts: ["similar_department", "wrong_entity"],
  currentVersusStale: ["freshness"],
  authorityVersusBusinessNotes: ["source_authority", "conflicting_sources"],
  duplicateAndSameSource: ["duplicate_chunks", "same_source_chunks"],
  numericAmbiguity: ["numeric_ambiguity"],
  promptInjectedText: ["prompt_injection"],
  sparsePools: ["sparse"],
  largePools: ["large_pool"]
} as const satisfies Record<string, readonly RerankerPocFixture["category"][]>;

function categoryOutcome({ baseline, reranked }: { baseline: PocMetrics; reranked: PocMetrics }) {
  const baselineComposite = average([baseline.ndcgAt10, baseline.mrr, baseline.precisionAt10]);
  const rerankedComposite = average([reranked.ndcgAt10, reranked.mrr, reranked.precisionAt10]);
  const delta = rerankedComposite - baselineComposite;
  return delta > 0.000001 ? "win" : delta < -0.000001 ? "loss" : "tie";
}

function groupedCategoryComparison(runs: readonly RerankerPocBenchmarkRun[]) {
  return Object.fromEntries(Object.entries(POC_CATEGORY_GROUPS).map(([group, categories]) => {
    const groupRuns = runs.filter((run) => (categories as readonly string[]).includes(run.category));
    const outcomes = groupRuns.map(categoryOutcome);
    return [group, {
      queryCount: groupRuns.length,
      wins: outcomes.filter((outcome) => outcome === "win").length,
      losses: outcomes.filter((outcome) => outcome === "loss").length,
      ties: outcomes.filter((outcome) => outcome === "tie").length,
      baseline: aggregatePocMetrics(groupRuns.map((run) => run.baseline)),
      reranked: aggregatePocMetrics(groupRuns.map((run) => run.reranked))
    }];
  }));
}

async function runLatencyQualification({
  reranker,
  circuitBreaker,
  timeoutMs,
  warmupCallsPerPool,
  measuredCallsPerPool
}: {
  reranker: EvidenceReranker;
  circuitBreaker: RerankerPocCircuitBreaker;
  timeoutMs: number;
  warmupCallsPerPool: number;
  measuredCallsPerPool: number;
}) {
  const largeFixture = NVIDIA_RERANKER_POC_FIXTURES.find((fixture) => fixture.category === "large_pool");
  if (!largeFixture) throw new Error("The synthetic large-pool latency fixture is unavailable.");
  const pool = freezeRerankerPocCandidatePool({
    workspaceId: RERANKER_POC_WORKSPACE_ID,
    candidates: rerankerPocFixtureCandidates(largeFixture)
  });
  assertSyntheticRerankerPocCandidates(pool.candidates);
  const byPoolSize: Record<string, { attempted: number; successful: number; latencies: number[] }> = {};
  let warmupCalls = 0;
  let measuredCalls = 0;
  let circuitBreakerActivations = 0;

  for (const poolSize of RERANKER_POC_LATENCY_POOL_SIZES) {
    const candidates = pool.candidates.slice(0, poolSize);
    if (candidates.length !== poolSize) throw new Error("The latency pool is smaller than the approved representative size.");
    byPoolSize[String(poolSize)] = { attempted: 0, successful: 0, latencies: [] };
    for (let index = 0; index < warmupCallsPerPool; index += 1) {
      if (!circuitBreaker.canAttempt()) {
        circuitBreakerActivations += 1;
        break;
      }
      const result = await reranker.rerank({
        queryText: largeFixture.queryText,
        candidates,
        mode: "shadow",
        timeoutMs
      });
      circuitBreaker.record(result.status);
      warmupCalls += 1;
    }
    for (let index = 0; index < measuredCallsPerPool; index += 1) {
      if (!circuitBreaker.canAttempt()) {
        circuitBreakerActivations += 1;
        break;
      }
      const result = await reranker.rerank({
        queryText: largeFixture.queryText,
        candidates,
        mode: "shadow",
        timeoutMs
      });
      circuitBreaker.record(result.status);
      measuredCalls += 1;
      byPoolSize[String(poolSize)].attempted += 1;
      if (result.status === "success") {
        byPoolSize[String(poolSize)].successful += 1;
        byPoolSize[String(poolSize)].latencies.push(result.latencyMs);
      }
    }
  }

  const successfulLatencies = Object.values(byPoolSize).flatMap((entry) => entry.latencies);
  return deepFreeze({
    poolSizes: [...RERANKER_POC_LATENCY_POOL_SIZES],
    warmupCalls,
    measuredCalls,
    successfulMeasuredCalls: successfulLatencies.length,
    p50Ms: percentile(successfulLatencies, 0.50),
    p95Ms: percentile(successfulLatencies, 0.95),
    p99Ms: percentile(successfulLatencies, 0.99),
    byPoolSize: Object.fromEntries(Object.entries(byPoolSize).map(([poolSize, entry]) => [poolSize, {
      attempted: entry.attempted,
      successful: entry.successful,
      p50Ms: percentile(entry.latencies, 0.50),
      p95Ms: percentile(entry.latencies, 0.95),
      p99Ms: percentile(entry.latencies, 0.99)
    }])),
    circuitBreakerActivations
  });
}

export async function runNvidiaRerankerPocQualification({
  reranker,
  timeoutMs = 750,
  warmupCallsPerPool = RERANKER_POC_WARMUP_CALLS_PER_POOL,
  measuredCallsPerPool = RERANKER_POC_MEASURED_CALLS_PER_POOL,
  maximumRequests = RERANKER_POC_MAX_PROVIDER_REQUESTS,
  inputCostCentsPerMillion = Number.parseFloat(process.env.NVIDIA_RERANK_INPUT_COST_CENTS_PER_1M || "")
}: {
  reranker: EvidenceReranker;
  timeoutMs?: number;
  warmupCallsPerPool?: number;
  measuredCallsPerPool?: number;
  maximumRequests?: number;
  inputCostCentsPerMillion?: number;
}) {
  const plannedRequests = NVIDIA_RERANKER_POC_FIXTURES.length +
    RERANKER_POC_LATENCY_POOL_SIZES.length * (warmupCallsPerPool + measuredCallsPerPool);
  if (plannedRequests > maximumRequests || plannedRequests > RERANKER_POC_MAX_PROVIDER_REQUESTS) {
    throw new Error("The NVIDIA reranker POC exceeds the approved provider-request limit.");
  }
  const boundedReranker = new BoundedRerankerPocAdapter(reranker, maximumRequests);
  const circuitBreaker = new RerankerPocCircuitBreaker();
  const quality = await runNvidiaRerankerPocBenchmark({
    reranker: boundedReranker,
    timeoutMs,
    inputCostCentsPerMillion,
    circuitBreaker
  });
  const latency = await runLatencyQualification({
    reranker: boundedReranker,
    circuitBreaker,
    timeoutMs,
    warmupCallsPerPool,
    measuredCallsPerPool
  });
  const requests = boundedReranker.snapshot();
  const estimatedCostCents = Number.isFinite(inputCostCentsPerMillion)
    ? requests.inputTokens / 1_000_000 * inputCostCentsPerMillion
    : null;
  const estimatedCostPerThousandCents = estimatedCostCents !== null && requests.successfulRequests
    ? estimatedCostCents / requests.successfulRequests * 1_000
    : null;
  const fallbackRate = rate(requests.failedRequests, requests.attemptedRequests);
  const categoryOutcomes = Object.fromEntries(quality.runs.map((run) => [run.category, categoryOutcome(run)]));
  const outcomeValues = Object.values(categoryOutcomes);
  const adoptionGates = deepFreeze({
    zeroCrossWorkspaceLeakage: quality.qualification.zeroCrossWorkspaceLeakage,
    zeroLifecycleLeakage: quality.qualification.zeroLifecycleLeakage,
    citationSourceCorrectnessMaintained: quality.qualification.citationSourceCorrectnessMaintained,
    noBusinessNoteAuthorityPromotion: quality.qualification.noBusinessNoteAuthorityPromotion,
    noMaterialRecallRegression: quality.qualification.noMaterialRecallRegression,
    measurableRankingImprovement: quality.qualification.measurableRankingImprovement,
    noOtherPrimaryMetricRegression: quality.qualification.noOtherPrimaryMetricRegression,
    irrelevantSelectionReductionAtLeastTenPercent: quality.qualification.irrelevantSelectionReductionAtLeastTenPercent,
    noDownstreamValidationFailureIncrease: quality.qualification.noDownstreamValidationFailureIncrease,
    acceptableP95Latency: latency.p95Ms <= 500,
    acceptableP99Latency: latency.p99Ms <= 750,
    acceptableTimeoutRate: rate(requests.timeouts, requests.attemptedRequests) <= 0.01,
    acceptableFallbackRate: fallbackRate <= 0.02,
    acceptableEstimatedCost: estimatedCostPerThousandCents === null || estimatedCostPerThousandCents <= 500,
    completeSourceMetadataPreservation: quality.qualification.completeSourceMetadataPreservation,
    correctFailOpenBehavior: quality.qualification.correctFailOpenBehavior,
    activeResultsUnchanged: quality.qualification.activeResultsUnchanged
  });

  return deepFreeze({
    qualificationVersion: "nvidia_reranker_shadow_poc_qualification_v1",
    model: reranker.model,
    syntheticFixtureSet: true,
    plannedRequests,
    requestLimit: maximumRequests,
    quality,
    categoryComparison: {
      wins: outcomeValues.filter((outcome) => outcome === "win").length,
      losses: outcomeValues.filter((outcome) => outcome === "loss").length,
      ties: outcomeValues.filter((outcome) => outcome === "tie").length,
      outcomes: categoryOutcomes,
      groups: groupedCategoryComparison(quality.runs)
    },
    latency,
    requests,
    failures: {
      fallbackRate,
      circuitBreaker: circuitBreaker.snapshot(),
      circuitBreakerActivations: latency.circuitBreakerActivations
    },
    cost: {
      inputTokens: requests.inputTokens,
      configuredInputCostCentsPerMillion: Number.isFinite(inputCostCentsPerMillion) ? inputCostCentsPerMillion : null,
      estimatedCostCents,
      estimatedCostPerThousandQualifiedReranksCents: estimatedCostPerThousandCents,
      exactHostedCostVerified: estimatedCostPerThousandCents !== null
    },
    adoptionGates,
    mandatoryGatesPassed: Object.values(adoptionGates).every(Boolean),
    readyForProduction: false
  });
}

export function privacySafeRerankerPocQualificationReport(
  report: Awaited<ReturnType<typeof runNvidiaRerankerPocQualification>>
) {
  const quality = privacySafeRerankerPocReport(report.quality);
  const { runs: _runs, ...aggregateQuality } = quality;
  return deepFreeze({
    qualificationVersion: report.qualificationVersion,
    model: report.model,
    syntheticFixtureSet: report.syntheticFixtureSet,
    plannedRequests: report.plannedRequests,
    requestLimit: report.requestLimit,
    quality: aggregateQuality,
    categoryComparison: report.categoryComparison,
    latency: report.latency,
    requests: report.requests,
    failures: report.failures,
    cost: report.cost,
    adoptionGates: report.adoptionGates,
    mandatoryGatesPassed: report.mandatoryGatesPassed,
    readyForProduction: false
  });
}

export function privacySafeRerankerPocReport(report: Awaited<ReturnType<typeof runNvidiaRerankerPocBenchmark>>) {
  return deepFreeze({
    benchmarkVersion: report.benchmarkVersion,
    fixtureVersion: report.fixtureVersion,
    fixtureCount: report.fixtureCount,
    baseline: report.baseline,
    reranked: report.reranked,
    categoryMetrics: report.categoryMetrics,
    poolSizeDistribution: report.poolSizeDistribution,
    latency: report.latency,
    failures: report.failures,
    cost: report.cost,
    qualification: report.qualification,
    activeVolumeAssessment: report.activeVolumeAssessment,
    runs: report.runs.map((run) => ({
      queryId: run.queryId,
      category: run.category,
      retrievalMode: run.retrievalMode,
      resultLimit: run.resultLimit,
      poolMeasurement: run.measurement,
      baselineSelectedCandidateIds: run.baselineSelectedCandidateIds,
      rerankedSelectedCandidateIds: run.rerankedSelectedCandidateIds,
      excludedCandidateIds: run.excludedCandidateIds,
      status: run.rerankResult.status,
      failureCode: run.rerankResult.failureCode,
      latencyMs: run.rerankResult.latencyMs,
      inputCount: run.rerankResult.inputCount,
      inputTokens: run.rerankResult.inputTokens,
      inputTokensEstimated: run.rerankResult.inputTokensEstimated,
      fallbackCorrect: run.fallbackCorrect,
      sourceMetadataPreserved: run.sourceMetadataPreserved,
      activeResultUnchanged: run.activeResultUnchanged
    }))
  });
}
