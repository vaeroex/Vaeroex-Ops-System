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
  EVIDENCE_CANDIDATE_VERSION,
  EVIDENCE_MANIFEST_VERSION,
  EVIDENCE_QUERY_VERSION,
  SOURCE_REGISTRY_VERSION
} = require("../lib/ai/evidence-engine/contracts.ts");
const { buildSourceRegistry } = require("../lib/ai/evidence-engine/source-registry.ts");
const { buildEvidenceManifest } = require("../lib/ai/evidence-engine/manifest.ts");
const { verifyEvidenceManifestCitations } = require("../lib/ai/evidence-engine/citation-verification.ts");
const {
  DeterministicNoopReranker,
  applyRerankResult,
  runEvidenceRerankerShadow
} = require("../lib/ai/evidence-engine/reranker.ts");
const {
  NvidiaTextReranker,
  buildNvidiaTextRerankRequest,
  nvidiaTextRerankerShadowEnabled
} = require("../lib/ai/evidence-engine/nvidia-text-reranker.ts");
const { EvidenceDecisionTrace } = require("../lib/ai/evidence-engine/tracing.ts");
const {
  EVIDENCE_ENGINE_FROZEN_FIXTURES,
  fixtureEvidenceCandidates,
  frozenRecordIsEligible
} = require("../lib/ai/evidence-engine/benchmark-fixtures.ts");
const { runEvidenceEngineRerankerBenchmark } = require("../lib/ai/evidence-engine/benchmark.ts");

function candidate(id, overrides = {}) {
  const workspaceId = overrides.workspaceId || "workspace-a";
  const evidenceRole = overrides.evidenceRole || "original";
  const sourceKey = overrides.sourceKey || "file:source-a";
  return {
    version: EVIDENCE_CANDIDATE_VERSION,
    candidateId: id,
    workspaceId,
    domain: overrides.domain || "finance",
    recordType: overrides.recordType || "metric",
    title: overrides.title || "Monthly revenue",
    excerpt: overrides.excerpt || "Monthly revenue was 125000 for June 2026.",
    summary: overrides.summary || null,
    evidenceRole,
    source: {
      sourceType: overrides.sourceType || "source_file",
      sourceId: overrides.sourceId || "source-a",
      sourceFileId: overrides.sourceFileId || "source-a",
      parentSourceId: overrides.parentSourceId || "source-a",
      canonicalSourceKey: `${workspaceId}:${sourceKey}`,
      independentSourceKey: evidenceRole === "original"
        ? `${workspaceId}:${overrides.independentSourceKey || sourceKey}`
        : null
    },
    provenance: {
      recordId: id,
      indexedAt: overrides.indexedAt || "2026-07-19T00:00:00.000Z",
      recordedAt: overrides.recordedAt || "2026-07-01T00:00:00.000Z",
      lineageVersion: overrides.lineageVersion || "test_lineage_v1"
    },
    eligibility: {
      eligible: true,
      lifecycleState: "active",
      originalEvidenceEligible: evidenceRole === "original",
      decisionVersion: overrides.decisionVersion || "test_eligibility_v1"
    },
    quality: overrides.quality || "high",
    confidenceScore: overrides.confidenceScore || 80,
    retrieval: {
      mode: overrides.mode || "vector",
      baseRank: overrides.baseRank || 1,
      score: overrides.score ?? 0.8,
      embeddingVersion: overrides.embeddingVersion || "embedding-v1"
    }
  };
}

function manifestFor(candidates, overrides = {}) {
  const workspaceId = overrides.workspaceId || "workspace-a";
  const registry = buildSourceRegistry({ workspaceId, candidates });
  return buildEvidenceManifest({
    workspaceId,
    queryText: overrides.queryText || "What changed?",
    candidates,
    sourceRegistry: registry,
    generatedAt: overrides.generatedAt || "2026-07-19T01:00:00.000Z",
    candidateRetrieverVersion: "retriever-v1",
    embeddingVersion: "embedding-v1",
    rerankerVersion: "deterministic-noop-v1",
    signalPlannerVersion: "signal-planner-v1"
  });
}

async function main() {
  assert.equal(EVIDENCE_QUERY_VERSION, "evidence_query_v1");
  assert.equal(EVIDENCE_CANDIDATE_VERSION, "evidence_candidate_v1");
  assert.equal(SOURCE_REGISTRY_VERSION, "source_registry_v1");
  assert.equal(EVIDENCE_MANIFEST_VERSION, "evidence_manifest_v1");

  const supportingFirst = candidate("chunk-a", { evidenceRole: "supporting", sourceKey: "file:shared" });
  const originalSecond = candidate("row-a", { evidenceRole: "original", sourceKey: "file:shared" });
  const registry = buildSourceRegistry({ workspaceId: "workspace-a", candidates: [supportingFirst, originalSecond] });
  assert.equal(registry.entries.length, 1);
  assert.equal(registry.entries[0].evidenceRole, "original");
  assert.equal(registry.entries[0].candidateIds.length, 2);
  assert.equal(registry.independentOriginalSourceCount, 1);
  assert.equal(registry.candidateToSourceOrdinal["chunk-a"], registry.candidateToSourceOrdinal["row-a"]);
  assert.ok(Object.isFrozen(registry));
  assert.ok(Object.isFrozen(registry.entries));

  assert.throws(
    () => buildSourceRegistry({ workspaceId: "workspace-a", candidates: [candidate("foreign", { workspaceId: "workspace-b" })] }),
    /authorized workspace/
  );
  assert.throws(
    () => buildSourceRegistry({ workspaceId: "workspace-a", candidates: [candidate("duplicate"), candidate("duplicate")] }),
    /unique/
  );
  assert.throws(
    () => buildSourceRegistry({
      workspaceId: "workspace-a",
      candidates: [
        candidate("source-one", { sourceKey: "file:shared", independentSourceKey: "file:first" }),
        candidate("source-two", { sourceKey: "file:shared", independentSourceKey: "file:second" })
      ]
    }),
    /multiple independent source identities/
  );

  const firstCandidate = candidate("candidate-a");
  const secondCandidate = candidate("candidate-b", { sourceKey: "file:source-b", sourceId: "source-b", sourceFileId: "source-b" });
  const manifest = manifestFor([firstCandidate, secondCandidate]);
  const equivalentManifest = manifestFor([firstCandidate, secondCandidate], { generatedAt: "2026-07-19T02:00:00.000Z" });
  const changedManifest = manifestFor([
    candidate("candidate-a", { excerpt: "Monthly revenue was 124000 for June 2026." }),
    secondCandidate
  ]);
  assert.equal(manifest.manifestId, equivalentManifest.manifestId, "generated_at must not change an evidence identity");
  assert.notEqual(manifest.manifestId, changedManifest.manifestId, "evidence content changes must create a new manifest");
  assert.deepEqual(manifest.evidence.map((entry) => entry.citationId), [1, 2]);
  assert.equal(manifest.policy.citationsApplicationGenerated, true);
  assert.equal(manifest.policy.sourceIndependenceApplicationCalculated, true);
  assert.equal(manifest.policy.derivedOutputsExcludedFromOriginalEvidence, true);
  assert.ok(Object.isFrozen(manifest));
  assert.ok(Object.isFrozen(manifest.evidence[0]));

  const validCitations = verifyEvidenceManifestCitations({
    manifest,
    citationIds: [1, 2],
    requiredCitationIds: [1, 2]
  });
  assert.equal(validCitations.valid, true);
  assert.deepEqual(validCitations.verifiedCitationIds, [1, 2]);
  assert.equal(validCitations.observedCount, 2);

  const duplicateCitation = verifyEvidenceManifestCitations({ manifest, citationIds: [1, 1] });
  assert.equal(duplicateCitation.valid, false);
  assert.ok(duplicateCitation.rejected.some((item) => item.reason === "duplicate_citation"));
  const unknownCitation = verifyEvidenceManifestCitations({ manifest, citationIds: [99] });
  assert.ok(unknownCitation.rejected.some((item) => item.reason === "unknown_citation"));
  const missingCitation = verifyEvidenceManifestCitations({ manifest, citationIds: [1], requiredCitationIds: [1, 2] });
  assert.ok(missingCitation.rejected.some((item) => item.reason === "missing_required_citation" && item.citationId === 2));

  const tamperedManifest = JSON.parse(JSON.stringify(manifest));
  tamperedManifest.sourceRegistry.entries[0].candidateIds = [];
  const lineageMismatch = verifyEvidenceManifestCitations({ manifest: tamperedManifest, citationIds: [1] });
  assert.ok(lineageMismatch.rejected.some((item) => item.reason === "source_registry_mismatch"));

  const noop = new DeterministicNoopReranker();
  const noopResult = await noop.rerank({ queryText: "revenue", candidates: [firstCandidate, secondCandidate], mode: "active" });
  assert.deepEqual(applyRerankResult([firstCandidate, secondCandidate], noopResult).map((item) => item.candidateId), ["candidate-a", "candidate-b"]);

  const reverseReranker = {
    id: "reverse-test",
    version: "reverse-test-v1",
    provider: "nvidia",
    model: "fixture-reranker",
    async rerank({ candidates, mode }) {
      return {
        version: "rerank_result_v1",
        adapterId: this.id,
        adapterVersion: this.version,
        provider: this.provider,
        model: this.model,
        mode,
        status: "success",
        rankings: candidates.map((_, index) => ({
          candidateOrdinal: candidates.length - index - 1,
          rank: index + 1,
          score: candidates.length - index
        })),
        inputCount: candidates.length,
        inputTokens: 12,
        inputTokensEstimated: false,
        latencyMs: 3,
        failureCode: null
      };
    }
  };
  const shadow = await runEvidenceRerankerShadow({
    queryText: "revenue",
    candidates: [firstCandidate, secondCandidate],
    reranker: reverseReranker
  });
  assert.deepEqual(shadow.activeCandidates.map((item) => item.candidateId), ["candidate-a", "candidate-b"]);
  assert.deepEqual(applyRerankResult([firstCandidate, secondCandidate], shadow.shadowResult).map((item) => item.candidateId), ["candidate-b", "candidate-a"]);
  const duplicateOrdinalResult = {
    ...shadow.shadowResult,
    rankings: [
      { candidateOrdinal: 0, rank: 1, score: 2 },
      { candidateOrdinal: 0, rank: 2, score: 1 }
    ]
  };
  assert.deepEqual(
    applyRerankResult([firstCandidate, secondCandidate], duplicateOrdinalResult).map((item) => item.candidateId),
    ["candidate-a", "candidate-b"],
    "duplicate reranker ordinals must fail open to deterministic order"
  );

  let capturedRequest;
  const nvidia = new NvidiaTextReranker({
    apiKey: "test-only-key",
    baseUrl: "https://example.test/v1",
    fetchImpl: async (url, init) => {
      capturedRequest = { url, init };
      return new Response(JSON.stringify({
        rankings: [
          { index: 1, logit: 4.5 },
          { index: 0, logit: 1.25 }
        ],
        usage: { prompt_tokens: 42 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const nvidiaResult = await nvidia.rerank({
    queryText: "Which metric changed?",
    candidates: [firstCandidate, secondCandidate],
    mode: "shadow"
  });
  assert.equal(nvidiaResult.status, "success");
  assert.equal(nvidiaResult.inputTokens, 42);
  assert.equal(nvidiaResult.inputTokensEstimated, false);
  assert.deepEqual(nvidiaResult.rankings.map((item) => item.candidateOrdinal), [1, 0]);
  assert.equal(capturedRequest.url, "https://example.test/v1/ranking");
  const requestBody = capturedRequest.init.body;
  assert.equal(requestBody.includes("candidate-a"), false);
  assert.equal(requestBody.includes("source-a"), false);
  assert.equal(requestBody.includes("workspace-a"), false);
  assert.equal(capturedRequest.init.headers.Authorization, "Bearer test-only-key");

  const request = buildNvidiaTextRerankRequest({ queryText: "Which metric changed?", candidates: [firstCandidate] });
  assert.deepEqual(Object.keys(request), ["model", "query", "passages", "truncate"]);
  assert.deepEqual(Object.keys(request.passages[0]), ["text"]);

  const malformedNvidia = new NvidiaTextReranker({
    apiKey: "test-only-key",
    fetchImpl: async () => new Response(JSON.stringify({ rankings: [{ index: 0, logit: 1 }] }), { status: 200 })
  });
  const malformedResult = await malformedNvidia.rerank({
    queryText: "revenue",
    candidates: [firstCandidate, secondCandidate],
    mode: "shadow"
  });
  assert.equal(malformedResult.status, "failed");
  assert.equal(malformedResult.failureCode, "malformed_response");
  assert.equal(malformedResult.inputTokensEstimated, true);
  assert.deepEqual(applyRerankResult([firstCandidate, secondCandidate], malformedResult).map((item) => item.candidateId), ["candidate-a", "candidate-b"]);

  for (const [status, failureCode] of [[429, "rate_limit"], [503, "unavailable"]]) {
    const failingNvidia = new NvidiaTextReranker({
      apiKey: "test-only-key",
      fetchImpl: async () => new Response("", { status })
    });
    const result = await failingNvidia.rerank({ queryText: "revenue", candidates: [firstCandidate], mode: "shadow" });
    assert.equal(result.status, "failed");
    assert.equal(result.failureCode, failureCode);
  }
  const timeoutNvidia = new NvidiaTextReranker({
    apiKey: "test-only-key",
    fetchImpl: async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    }
  });
  const timeoutResult = await timeoutNvidia.rerank({ queryText: "revenue", candidates: [firstCandidate], mode: "shadow" });
  assert.equal(timeoutResult.failureCode, "timeout");
  const missingCredentials = new NvidiaTextReranker({ apiKey: "" });
  const priorNvidiaKey = process.env.NVIDIA_API_KEY;
  const priorRerankKey = process.env.NVIDIA_RERANK_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_RERANK_API_KEY;
  const missingCredentialsResult = await missingCredentials.rerank({ queryText: "revenue", candidates: [firstCandidate], mode: "shadow" });
  assert.equal(missingCredentialsResult.status, "skipped");
  assert.equal(missingCredentialsResult.failureCode, "missing_credentials");
  if (priorNvidiaKey !== undefined) process.env.NVIDIA_API_KEY = priorNvidiaKey;
  if (priorRerankKey !== undefined) process.env.NVIDIA_RERANK_API_KEY = priorRerankKey;

  const trace = new EvidenceDecisionTrace();
  trace.add({
    stage: "candidate_retrieval",
    status: "success",
    durationMs: 8,
    inputCount: null,
    outputCount: 2,
    provider: "deterministic",
    model: null,
    reasonCode: null
  });
  assert.throws(() => trace.add({
    stage: "rerank",
    status: "success",
    durationMs: 3,
    inputCount: 2,
    outputCount: 2,
    provider: "nvidia",
    model: "fixture",
    reasonCode: null,
    workspaceId: "must-not-log"
  }), /content-free/);
  assert.equal(JSON.stringify(trace.snapshot()).includes("workspace-a"), false);

  const previousVercelEnv = process.env.VERCEL_ENV;
  const previousShadow = process.env.VAEROEX_NVIDIA_RERANK_SHADOW;
  const previousConfirm = process.env.VAEROEX_EVIDENCE_ENGINE_SHADOW_CONFIRM;
  process.env.VERCEL_ENV = "production";
  process.env.VAEROEX_NVIDIA_RERANK_SHADOW = "true";
  process.env.VAEROEX_EVIDENCE_ENGINE_SHADOW_CONFIRM = "preview";
  assert.equal(nvidiaTextRerankerShadowEnabled(), false);
  if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previousVercelEnv;
  if (previousShadow === undefined) delete process.env.VAEROEX_NVIDIA_RERANK_SHADOW; else process.env.VAEROEX_NVIDIA_RERANK_SHADOW = previousShadow;
  if (previousConfirm === undefined) delete process.env.VAEROEX_EVIDENCE_ENGINE_SHADOW_CONFIRM; else process.env.VAEROEX_EVIDENCE_ENGINE_SHADOW_CONFIRM = previousConfirm;

  assert.equal(EVIDENCE_ENGINE_FROZEN_FIXTURES.length, 10);
  for (const fixture of EVIDENCE_ENGINE_FROZEN_FIXTURES) {
    const candidates = fixtureEvidenceCandidates(fixture);
    assert.ok(candidates.every((item) => item.workspaceId === "fixture-workspace"));
    assert.ok(candidates.every((item) => {
      const record = fixture.records.find((recordItem) => recordItem.id === item.candidateId);
      return record && frozenRecordIsEligible(record);
    }));
  }
  const lifecycleFixture = EVIDENCE_ENGINE_FROZEN_FIXTURES.find((fixture) => fixture.fixtureId === "lifecycle_exclusion");
  assert.ok(lifecycleFixture);
  assert.deepEqual(fixtureEvidenceCandidates(lifecycleFixture).map((item) => item.candidateId), ["life-1"]);
  const navigationFixture = EVIDENCE_ENGINE_FROZEN_FIXTURES.find((fixture) => fixture.fixtureId === "navigation_query");
  assert.deepEqual(fixtureEvidenceCandidates(navigationFixture), []);

  const judgmentReranker = {
    id: "judgment-test",
    version: "judgment-test-v1",
    provider: "nvidia",
    model: "fixture-reranker",
    async rerank({ queryText, candidates, mode }) {
      const fixture = EVIDENCE_ENGINE_FROZEN_FIXTURES.find((item) => item.query === queryText);
      const grades = new Map(fixture.records.map((item) => [item.id, item.relevanceGrade]));
      const ordered = candidates
        .map((item, ordinal) => ({ ordinal, grade: grades.get(item.candidateId) || 0 }))
        .sort((left, right) => right.grade - left.grade || left.ordinal - right.ordinal);
      return {
        version: "rerank_result_v1",
        adapterId: this.id,
        adapterVersion: this.version,
        provider: this.provider,
        model: this.model,
        mode,
        status: "success",
        rankings: ordered.map((item, index) => ({ candidateOrdinal: item.ordinal, rank: index + 1, score: item.grade })),
        inputCount: candidates.length,
        inputTokens: candidates.length * 10,
        inputTokensEstimated: false,
        latencyMs: 5,
        failureCode: null
      };
    }
  };
  const benchmark = await runEvidenceEngineRerankerBenchmark({ reranker: judgmentReranker });
  assert.equal(benchmark.fixtureCount, 10);
  assert.equal(benchmark.lifecycleExclusionAccuracy, 1);
  assert.equal(benchmark.workspaceIsolationAccuracy, 1);
  assert.ok(benchmark.reranked.ndcgAt10 >= benchmark.baseline.ndcgAt10);
  assert.equal(benchmark.qualification.readyForPromotion, false);
  assert.equal(benchmark.qualification.unsupportedClaimIncrease, null);

  const failedReranker = {
    id: "failed-test",
    version: "failed-test-v1",
    provider: "nvidia",
    model: "fixture-reranker",
    async rerank({ candidates, mode }) {
      return {
        version: "rerank_result_v1",
        adapterId: this.id,
        adapterVersion: this.version,
        provider: this.provider,
        model: this.model,
        mode,
        status: "failed",
        rankings: [],
        inputCount: candidates.length,
        inputTokens: null,
        inputTokensEstimated: false,
        latencyMs: 5,
        failureCode: "timeout"
      };
    }
  };
  const failedBenchmark = await runEvidenceEngineRerankerBenchmark({ reranker: failedReranker });
  assert.equal(failedBenchmark.fallbackCorrectness, 1);
  assert.deepEqual(failedBenchmark.reranked, failedBenchmark.baseline);

  const evidenceIndexSource = read("lib/ai/evidence-index.ts");
  assert.match(evidenceIndexSource, /class SupabasePgvectorCandidateRetriever implements CandidateRetriever/);
  assert.match(evidenceIndexSource, /runEvidenceRerankerShadow/);
  assert.doesNotMatch(evidenceIndexSource, /applyRerankResult/);
  assert.match(evidenceIndexSource, /selectedCandidateIds/);
  const migrationSource = read("supabase/migrations/202607110001_business_memory_evidence_eligibility.sql");
  assert.match(migrationSource, /Filter inactive or invalid source lineage before vector-match limits are applied/);
  assert.match(migrationSource, /public\.is_workspace_member\(bmc\.workspace_id\)/);
  assert.match(migrationSource, /order by bmc\.embedding <=> query_embedding\s+limit/);
  const adr = read("docs/architecture/adr-001-vaeroex-evidence-engine.md");
  assert.match(adr, /Vaeroex Evidence Engine/);
  assert.match(adr, /Shadow evaluation cannot affect active workflow output/);

  console.log("Evidence Engine regression tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
