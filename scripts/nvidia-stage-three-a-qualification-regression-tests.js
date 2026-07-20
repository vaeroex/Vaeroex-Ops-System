const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fixtures = read("lib/ai/qualification/stage-three-a-fixtures.ts");
const runner = read("lib/ai/qualification/stage-three-a.ts");
const types = read("lib/ai/qualification/stage-three-a-types.ts");
const route = read("app/api/internal/nvidia-qualification/stage-three-a/route.ts");
const page = read("app/app/admin/nvidia-qualification/stage-three-a/page.tsx");

for (const contract of ["business_health_explanation_v1", "leadership_priorities_v1"]) {
  assert.match(types, new RegExp(contract));
}
for (const excluded of ["executive_brief_v1", "deep_strategic_analysis"]) {
  assert.doesNotMatch(types, new RegExp(excluded));
}
for (const profile of [
  "nvidia-nemotron-3-ultra-550b-disabled",
  "nvidia-nemotron-3-super-120b-bounded",
  "openai-production-control"
]) assert.match(runner, new RegExp(profile));

assert.match(fixtures, /nvidia_capability_stage_3a_fixture_v1/);
assert.match(fixtures, /archetypes\.flatMap/);
assert.equal((fixtures.match(/id: "(?:single-domain-clear|cross-domain-supported|distractor-heavy-buried|duplicates-dependent-sources|stale-conflicting|sparse-low-evidence|similar-content-distinct-provenance|strong-versus-weak-sources|lifecycle-and-derived-exclusions|independent-support-and-minority-conflict)"/g) || []).length, 10);
for (const property of [
  "authorizedWorkspace",
  "active",
  "originalEvidenceEligible",
  "contradictory",
  "stale",
  "duplicateOf",
  "independentSourceKey"
]) assert.match(fixtures, new RegExp(property));

assert.match(runner, /eligibleRecords\(fixture\)/);
assert.match(runner, /new NvidiaTextReranker\(\)\.rerank/);
assert.match(runner, /mode: "shadow"/);
assert.match(runner, /applyRerankResult/);
assert.match(runner, /rerankResult\?\.status !== "success"/);
assert.match(runner, /buildSourceRegistry/);
assert.match(runner, /buildEvidenceManifest/);
assert.match(runner, /verifyEvidenceManifestCitations/);
assert.match(runner, /stage_3a_bounded_distinct_signal_planner_v1/);
assert.match(runner, /timeoutMs: 90_000/);
assert.match(runner, /blindQuality/);
for (const metric of [
  "relevantEvidenceRecall",
  "recallAt20",
  "precisionAt10",
  "ndcgAt10",
  "precisionAtSelectedK",
  "ndcgAtSelectedK",
  "mrr",
  "sourceDiversity",
  "independentSourceCount",
  "contradictorySignalCoverage",
  "workspaceIsolationAccuracy",
  "lifecycleExclusionAccuracy"
]) assert.match(runner, new RegExp(metric));
assert.doesNotMatch(runner, /runStructuredAI|providerPolicy|fallbackProvider/i, "Stage 3A must score each synthesis provider independently");

for (const surface of [route, page]) {
  assert.match(surface, /process\.env\.VERCEL_ENV === "preview"/);
  assert.match(surface, /VAEROEX_AI_SMOKE_TEST_ENABLED/);
  assert.match(surface, /runIndex (?:>|<=) 4/);
  assert.match(surface, /blindOutput: _blindOutput/, "content-free telemetry must remove accepted model text");
  assert.doesNotMatch(surface, /\.from\(|customer evidence|evidence excerpt/i);
}
assert.match(route, /isVaeroexAdminUser/);
assert.match(route, /totalExecutions/);
assert.match(route, /activeRetrievalChanged: false/);
assert.match(page, /getVaeroexAdminAccess/);
assert.match(page, /data-testid="stage-three-a-result"/);

process.stdout.write("NVIDIA Stage 3A qualification regressions passed.\n");
