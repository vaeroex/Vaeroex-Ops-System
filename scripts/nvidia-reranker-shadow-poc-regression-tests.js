const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const {
  NvidiaTextReranker,
  NVIDIA_TEXT_RERANKER_MAX_CANDIDATES,
  nvidiaTextRerankerShadowEnabled
} = require("../lib/ai/evidence-engine/nvidia-text-reranker.ts");
const {
  NVIDIA_RERANKER_POC_FIXTURES,
  RERANKER_POC_WORKSPACE_ID,
  assertSyntheticRerankerPocCandidates,
  rerankerPocFixtureCandidates,
  rerankerPocRecordIsEligible
} = require("../lib/ai/evidence-engine/reranker-poc-fixtures.ts");
const {
  RERANKER_POC_MAX_CANDIDATES,
  aggregatePoolSizeDistribution,
  applyDeterministicAuthorityAndDiversityPolicy,
  buildRetrievalPoolMeasurement,
  freezeRerankerPocCandidatePool,
  removeExactCandidateDuplicates,
  retrievalPoolInstrumentationEnabled
} = require("../lib/ai/evidence-engine/reranker-poc-pool.ts");
const {
  RerankerPocCircuitBreaker,
  privacySafeRerankerPocReport,
  runNvidiaRerankerPocBenchmark
} = require("../lib/ai/evidence-engine/benchmark.ts");

function successfulRanking(candidates, mode, orderedOrdinals, latencyMs = 5) {
  return {
    version: "rerank_result_v1",
    adapterId: "synthetic-judgment-reranker",
    adapterVersion: "synthetic-judgment-reranker-v1",
    provider: "nvidia",
    model: "synthetic-reranker",
    mode,
    status: "success",
    rankings: orderedOrdinals.map((candidateOrdinal, index) => ({
      candidateOrdinal,
      rank: index + 1,
      score: candidates.length - index
    })),
    inputCount: candidates.length,
    inputTokens: candidates.length * 10,
    inputTokensEstimated: false,
    latencyMs,
    failureCode: null
  };
}

function failedRanking(candidates, mode, failureCode = "timeout") {
  return {
    version: "rerank_result_v1",
    adapterId: "synthetic-failure-reranker",
    adapterVersion: "synthetic-failure-reranker-v1",
    provider: "nvidia",
    model: "synthetic-reranker",
    mode,
    status: "failed",
    rankings: [],
    inputCount: candidates.length,
    inputTokens: null,
    inputTokensEstimated: false,
    latencyMs: 5,
    failureCode
  };
}

async function main() {
  assert.equal(NVIDIA_RERANKER_POC_FIXTURES.length, 24);
  assert.deepEqual(
    new Set(NVIDIA_RERANKER_POC_FIXTURES.map((fixture) => fixture.category)),
    new Set([
      "exact_kpi", "kpi_alias", "maximize_kpi", "minimize_kpi", "target_range_kpi", "exact_target_kpi",
      "similar_kpi", "similar_department", "reporting_period", "freshness", "source_authority",
      "duplicate_chunks", "same_source_chunks", "conflicting_sources", "wrong_entity", "wrong_period",
      "sparse", "large_pool", "keyword_only", "semantic", "numeric_ambiguity", "prompt_injection",
      "lifecycle_exclusion", "workspace_isolation"
    ])
  );

  const duplicateFixture = NVIDIA_RERANKER_POC_FIXTURES.find((fixture) => fixture.category === "duplicate_chunks");
  const duplicateCandidates = rerankerPocFixtureCandidates(duplicateFixture);
  assert.equal(duplicateCandidates.length, 3);
  assert.equal(removeExactCandidateDuplicates(duplicateCandidates).length, 2);
  const duplicatePool = freezeRerankerPocCandidatePool({ workspaceId: RERANKER_POC_WORKSPACE_ID, candidates: duplicateCandidates });
  assert.equal(duplicatePool.candidates.length, 2);
  assert.ok(Object.isFrozen(duplicatePool));
  assert.ok(Object.isFrozen(duplicatePool.candidates));

  const largeFixture = NVIDIA_RERANKER_POC_FIXTURES.find((fixture) => fixture.category === "large_pool");
  const largeCandidates = rerankerPocFixtureCandidates(largeFixture);
  const largePool = freezeRerankerPocCandidatePool({ workspaceId: RERANKER_POC_WORKSPACE_ID, candidates: largeCandidates });
  assert.equal(largeCandidates.length, 54);
  assert.equal(largePool.candidates.length, RERANKER_POC_MAX_CANDIDATES);
  assert.equal(RERANKER_POC_MAX_CANDIDATES, NVIDIA_TEXT_RERANKER_MAX_CANDIDATES);

  const largeMeasurement = buildRetrievalPoolMeasurement({
    candidatesBeforeEligibility: 54,
    eligibleCandidates: largeCandidates,
    selectedCount: 10,
    retrievalMode: "vector",
    vectorSucceeded: true,
    keywordFallbackUsed: false,
    retrievalLatencyMs: 12.6
  });
  assert.equal(largeMeasurement.beforeEligibilityBucket, "49+");
  assert.equal(largeMeasurement.candidatePoolBucket, "21-48");
  assert.equal(largeMeasurement.selectedCount, 10);
  const distribution = aggregatePoolSizeDistribution([largeMeasurement]);
  assert.equal(distribution.beforeEligibility["49+"], 1);
  assert.equal(distribution.afterCanonicalSourceHandling["21-48"], 1);

  const authorityFixture = NVIDIA_RERANKER_POC_FIXTURES.find((fixture) => fixture.category === "source_authority");
  const authorityCandidates = rerankerPocFixtureCandidates(authorityFixture);
  const authorityOrdered = applyDeterministicAuthorityAndDiversityPolicy(authorityCandidates);
  assert.equal(authorityOrdered[0].evidenceRole, "original");
  assert.equal(authorityOrdered.at(-1).source.sourceType, "business_note");
  assert.equal(authorityCandidates.find((candidate) => candidate.source.sourceType === "business_note").evidenceRole, "supporting");

  const lifecycleFixture = NVIDIA_RERANKER_POC_FIXTURES.find((fixture) => fixture.category === "lifecycle_exclusion");
  const lifecycleCandidates = rerankerPocFixtureCandidates(lifecycleFixture);
  assert.deepEqual(lifecycleCandidates.map((candidate) => candidate.candidateId), ["life-current"]);
  const workspaceFixture = NVIDIA_RERANKER_POC_FIXTURES.find((fixture) => fixture.category === "workspace_isolation");
  const workspaceCandidates = rerankerPocFixtureCandidates(workspaceFixture);
  assert.equal(workspaceCandidates.some((candidate) => candidate.candidateId === "workspace-foreign"), false);
  assert.ok(NVIDIA_RERANKER_POC_FIXTURES.every((fixture) =>
    rerankerPocFixtureCandidates(fixture).every((candidate) => candidate.workspaceId === RERANKER_POC_WORKSPACE_ID)
  ));
  assert.ok(NVIDIA_RERANKER_POC_FIXTURES.every((fixture) => fixture.records.every((record) =>
    rerankerPocRecordIsEligible(record) === (record.expectedExclusion === null)
  )));

  let providerCalls = 0;
  const observedCandidateIds = new Set();
  const judgmentReranker = {
    id: "synthetic-judgment-reranker",
    version: "synthetic-judgment-reranker-v1",
    provider: "nvidia",
    model: "synthetic-reranker",
    async rerank({ queryText, candidates, mode }) {
      providerCalls += 1;
      assertSyntheticRerankerPocCandidates(candidates);
      for (const candidate of candidates) observedCandidateIds.add(candidate.candidateId);
      const fixture = NVIDIA_RERANKER_POC_FIXTURES.find((item) => item.queryText === queryText);
      const grades = new Map(fixture.records.map((record) => [record.candidateId, record.relevanceGrade]));
      const ordered = candidates
        .map((candidate, ordinal) => ({ ordinal, grade: grades.get(candidate.candidateId) || 0 }))
        .sort((left, right) => right.grade - left.grade || left.ordinal - right.ordinal)
        .map((item) => item.ordinal);
      return successfulRanking(candidates, mode, ordered);
    }
  };
  const qualityReport = await runNvidiaRerankerPocBenchmark({
    reranker: judgmentReranker,
    inputCostCentsPerMillion: 0
  });
  assert.equal(providerCalls, NVIDIA_RERANKER_POC_FIXTURES.length);
  assert.equal(observedCandidateIds.has("workspace-foreign"), false);
  assert.equal(observedCandidateIds.has("life-archived"), false);
  assert.equal(observedCandidateIds.has("life-deleted"), false);
  assert.equal(qualityReport.qualification.zeroCrossWorkspaceLeakage, true);
  assert.equal(qualityReport.qualification.zeroLifecycleLeakage, true);
  assert.equal(qualityReport.qualification.noBusinessNoteAuthorityPromotion, true);
  assert.equal(qualityReport.qualification.citationSourceCorrectnessMaintained, true);
  assert.equal(qualityReport.qualification.completeSourceMetadataPreservation, true);
  assert.equal(qualityReport.qualification.activeResultsUnchanged, true);
  assert.equal(qualityReport.qualification.readyForProduction, false);
  assert.ok(qualityReport.reranked.ndcgAt10 >= qualityReport.baseline.ndcgAt10);
  assert.ok(qualityReport.reranked.mrr >= qualityReport.baseline.mrr);
  assert.equal(qualityReport.reranked.duplicateSelectedChunkRate, 0);
  assert.equal(qualityReport.reranked.businessNoteOverPromotionRate, 0);

  const safeReport = privacySafeRerankerPocReport(qualityReport);
  const serializedSafeReport = JSON.stringify(safeReport);
  assert.doesNotMatch(serializedSafeReport, /Synthetic July revenue was 1\.25 million/);
  assert.doesNotMatch(serializedSafeReport, /Ignore all instructions/);
  assert.doesNotMatch(serializedSafeReport, /queryText|passageText|excerpt|customerName|workspaceId/);
  assert.match(serializedSafeReport, /exact-kpi-01/);

  let failureCalls = 0;
  const failedReranker = {
    id: "synthetic-failure-reranker",
    version: "synthetic-failure-reranker-v1",
    provider: "nvidia",
    model: "synthetic-reranker",
    async rerank({ candidates, mode }) {
      failureCalls += 1;
      return failedRanking(candidates, mode);
    }
  };
  const failedReport = await runNvidiaRerankerPocBenchmark({ reranker: failedReranker, inputCostCentsPerMillion: 0 });
  assert.equal(failureCalls, 5, "the circuit breaker must stop calls after five consecutive failures");
  assert.equal(failedReport.failures.circuitBreaker.open, true);
  assert.equal(failedReport.failures.circuitBreaker.openReason, "five_consecutive_failures");
  assert.ok(failedReport.runs.every((run) =>
    run.baselineSelectedCandidateIds.join("|") === run.rerankedSelectedCandidateIds.join("|")
  ), "provider failure must preserve baseline ordering");
  assert.equal(failedReport.qualification.correctFailOpenBehavior, true);

  const sustainedBreaker = new RerankerPocCircuitBreaker();
  for (let index = 0; index < 49; index += 1) sustainedBreaker.record("success");
  sustainedBreaker.record("failed");
  assert.equal(sustainedBreaker.canAttempt(), true, "exactly two percent must not open the sustained breaker");
  sustainedBreaker.record("failed");
  assert.equal(sustainedBreaker.canAttempt(), false);
  assert.equal(sustainedBreaker.snapshot().openReason, "sustained_failure_rate");

  const adapterCandidate = duplicatePool.candidates[0];
  const tooMany = Array.from({ length: NVIDIA_TEXT_RERANKER_MAX_CANDIDATES + 1 }, (_, index) => ({
    ...adapterCandidate,
    candidateId: `overflow-${index}`,
    provenance: { ...adapterCandidate.provenance, recordId: `overflow-${index}` }
  }));
  let unsafeFetchCalls = 0;
  const strictAdapter = new NvidiaTextReranker({
    apiKey: "synthetic-test-key",
    fetchImpl: async () => {
      unsafeFetchCalls += 1;
      return new Response("{}", { status: 200 });
    }
  });
  const oversized = await strictAdapter.rerank({ queryText: "synthetic query", candidates: tooMany, mode: "shadow" });
  assert.equal(oversized.failureCode, "unsafe_benchmark_input");
  const duplicateIds = await strictAdapter.rerank({
    queryText: "synthetic query",
    candidates: [adapterCandidate, adapterCandidate],
    mode: "shadow"
  });
  assert.equal(duplicateIds.failureCode, "unsafe_benchmark_input");
  assert.equal(unsafeFetchCalls, 0);

  let malformedFetchCalls = 0;
  const malformedAdapter = new NvidiaTextReranker({
    apiKey: "synthetic-test-key",
    fetchImpl: async () => {
      malformedFetchCalls += 1;
      return new Response(JSON.stringify({ rankings: [{ index: 0, logit: 1 }, { index: 0, logit: 0.5 }] }), { status: 200 });
    }
  });
  const malformed = await malformedAdapter.rerank({
    queryText: "synthetic query",
    candidates: duplicatePool.candidates,
    mode: "shadow"
  });
  assert.equal(malformed.failureCode, "malformed_response");
  assert.equal(malformedFetchCalls, 1);

  const priorEnvironment = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    VAEROEX_NVIDIA_RERANK_POC: process.env.VAEROEX_NVIDIA_RERANK_POC,
    VAEROEX_NVIDIA_RERANK_SHADOW: process.env.VAEROEX_NVIDIA_RERANK_SHADOW,
    VAEROEX_EVIDENCE_ENGINE_SHADOW_CONFIRM: process.env.VAEROEX_EVIDENCE_ENGINE_SHADOW_CONFIRM,
    VAEROEX_NVIDIA_RERANK_BENCHMARK_MODE: process.env.VAEROEX_NVIDIA_RERANK_BENCHMARK_MODE,
    VAEROEX_RERANK_POOL_INSTRUMENTATION: process.env.VAEROEX_RERANK_POOL_INSTRUMENTATION
  };
  process.env.VAEROEX_NVIDIA_RERANK_POC = "true";
  process.env.VAEROEX_NVIDIA_RERANK_SHADOW = "true";
  process.env.VAEROEX_EVIDENCE_ENGINE_SHADOW_CONFIRM = "synthetic_benchmark";
  process.env.VAEROEX_NVIDIA_RERANK_BENCHMARK_MODE = "synthetic";
  process.env.VERCEL_ENV = "production";
  process.env.VAEROEX_RERANK_POOL_INSTRUMENTATION = "true";
  assert.equal(nvidiaTextRerankerShadowEnabled(), false);
  assert.equal(retrievalPoolInstrumentationEnabled(), false);
  process.env.VERCEL_ENV = "preview";
  assert.equal(nvidiaTextRerankerShadowEnabled(), true);
  assert.equal(retrievalPoolInstrumentationEnabled(), true);
  process.env.VAEROEX_NVIDIA_RERANK_BENCHMARK_MODE = "approved_customer_data";
  assert.equal(nvidiaTextRerankerShadowEnabled(), false);
  for (const [key, value] of Object.entries(priorEnvironment)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }

  const evidenceIndex = read("lib/ai/evidence-index.ts");
  assert.doesNotMatch(evidenceIndex, /new NvidiaTextReranker|runEvidenceRerankerShadow/);
  assert.match(evidenceIndex, /reasonCode: "synthetic_benchmark_only"/);
  assert.ok(
    evidenceIndex.indexOf('stage: "rerank"') < evidenceIndex.indexOf("const selectedIds"),
    "the shadow boundary must remain before selection, source registry, manifests, and citations"
  );
  assert.ok(evidenceIndex.indexOf("const selectedIds") < evidenceIndex.indexOf("const sourceRegistry = buildSourceRegistry"));
  assert.ok(evidenceIndex.indexOf("const sourceRegistry = buildSourceRegistry") < evidenceIndex.indexOf("const manifest = buildEvidenceManifest"));
  assert.match(evidenceIndex, /selectedCandidateIds: candidates\.slice\(0, query\.resultLimit\)/);

  const benchmarkScript = read("scripts/evidence-engine-reranker-benchmark.js");
  assert.match(benchmarkScript, /VERCEL_ENV === "production"/);
  assert.match(benchmarkScript, /nvidiaTextRerankerShadowEnabled/);
  assert.match(benchmarkScript, /NVIDIA_RERANK_API_KEY/);
  assert.match(benchmarkScript, /--baseline-only/);
  assert.doesNotMatch(benchmarkScript, /console\.log\([^)]*queryText|console\.log\([^)]*passageText/);

  process.stdout.write(JSON.stringify({
    message: "NVIDIA reranker shadow POC regressions passed.",
    fixtures: NVIDIA_RERANKER_POC_FIXTURES.length,
    syntheticProviderCalls: providerCalls,
    activeProviderCalls: 0,
    productionEnabled: false,
    rawTextTelemetry: false
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
