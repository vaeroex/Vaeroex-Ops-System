const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fixtures = read("lib/ai/qualification/stage-two-fixtures.ts");
const runner = read("lib/ai/qualification/stage-two.ts");
const types = read("lib/ai/qualification/stage-two-types.ts");
const route = read("app/api/internal/nvidia-qualification/stage-two/route.ts");
const page = read("app/app/admin/nvidia-qualification/stage-two/page.tsx");

for (const contract of [
  "business_health_explanation_v1",
  "executive_brief_v1",
  "leadership_priorities_v1"
]) assert.match(types, new RegExp(contract));

for (const excluded of [
  "biggest_risk_v1",
  "biggest_opportunity_v1",
  "review_changes_v1",
  "deep_strategic_analysis"
]) assert.doesNotMatch(types, new RegExp(excluded));

for (const profile of [
  "nvidia-nemotron-3-ultra-550b-disabled",
  "nvidia-nemotron-3-super-120b-bounded",
  "nvidia-deepseek-v4-pro-disabled",
  "nvidia-glm-5-2-default",
  "openai-production-control"
]) assert.match(runner, new RegExp(profile));

assert.match(fixtures, /FIXTURE_VERSION = "executive_overview_stage_2_fixture_v1"/);
assert.match(fixtures, /buildEvidenceManifest/);
assert.match(fixtures, /buildSourceRegistry/);
assert.match(fixtures, /verifyEvidenceManifestCitations/);
assert.match(fixtures, /ordinal as a JSON number/);
assert.match(fixtures, /tradeoff as either a JSON string or null/);
assert.match(fixtures, /uncertainty must be a complete sentence of at least 15 characters/);
assert.match(fixtures, /Do not omit any field/);
assert.equal((fixtures.match(/id: "bh-/g) || []).length, 8, "Stage 2 must freeze eight Business Health states");
assert.equal((fixtures.match(/id: "brief-/g) || []).length, 11, "Stage 3B must retain eleven Executive Brief states");
assert.equal((fixtures.match(/id: "priorities-/g) || []).length, 9, "Stage 3B must retain nine Leadership Priorities states");

assert.match(runner, /timeoutMs: fixture\.timeoutMs/);
assert.match(runner, /blindQualityScore/);
assert.match(runner, /numericIntegrity/);
assert.match(runner, /citationIntegrity/);
assert.match(runner, /requiredSignalCoverage/);
assert.match(runner, /unsupportedInferenceDetected/);
assert.match(runner, /reasoningLeakageDetected/);
assert.doesNotMatch(runner, /fallback|providerPolicy|runStructuredAI/i, "isolated Stage 2 scoring must not hide a provider failure behind fallback");

for (const surface of [route, page]) {
  assert.match(surface, /process\.env\.VERCEL_ENV === "preview"/);
  assert.match(surface, /VAEROEX_AI_SMOKE_TEST_ENABLED/);
  assert.match(surface, /runIndex (?:>|<=) 4/);
  assert.match(surface, /blindOutput: _blindOutput/, "logs must remove accepted model text");
  assert.doesNotMatch(surface, /\.from\(|workspaceId|customer evidence|evidence excerpt/i);
}
assert.match(route, /STAGE_TWO_FIXTURES\.length \* 4/);
assert.match(route, /isVaeroexAdminUser/);
assert.match(page, /getVaeroexAdminAccess/);
assert.match(page, /data-testid="stage-two-result"/);

process.stdout.write("NVIDIA Stage 2 qualification regressions passed.\n");
