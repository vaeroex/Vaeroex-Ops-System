import type { EvidenceCandidate, EvidenceReranker, RerankResult } from "@/lib/ai/evidence-engine/contracts";
import {
  EVIDENCE_ENGINE_FROZEN_FIXTURES,
  fixtureEvidenceCandidates,
  frozenRecordIsEligible,
  type FrozenEvidenceFixture
} from "@/lib/ai/evidence-engine/benchmark-fixtures";
import { applyRerankResult } from "@/lib/ai/evidence-engine/reranker";

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
