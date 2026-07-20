const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const profiles = read("lib/ai/qualification/stage-three-b-profiles.ts");
const generation = read("lib/ai/qualification/stage-three-b-generation.ts");
const runner = read("lib/ai/qualification/stage-three-b.ts");
const types = read("lib/ai/qualification/stage-three-b-types.ts");
const fixtures = read("lib/ai/qualification/stage-two-fixtures.ts");
const route = read("app/api/internal/nvidia-qualification/stage-three-b/route.ts");
const page = read("app/app/admin/nvidia-qualification/stage-three-b/page.tsx");

for (const model of [
  "gpt-5.6-terra",
  "gpt-5.6-sol",
  "gpt-4o-mini",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "nvidia/nemotron-3-super-120b-a12b"
]) assert.match(profiles, new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

for (const excluded of [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.2",
  "gpt-4.1",
  "deepseek",
  "glm",
  "nano-30b",
  "nano-8b",
  "49b"
]) assert.doesNotMatch(profiles, new RegExp(excluded, "i"));

assert.match(generation, /https:\/\/api\.openai\.com\/v1\/responses/);
assert.match(generation, /https:\/\/api\.openai\.com\/v1\/models/);
assert.match(generation, /reasoning:\s*\{/);
assert.match(generation, /effort:\s*settings\.reasoningEffort/);
assert.match(generation, /mode:\s*"pro"/);
assert.match(generation, /type:\s*"json_schema"/);
assert.match(generation, /strict:\s*true/);
assert.match(generation, /store:\s*false/);
assert.match(generation, /runtimeModel:\s*payload\.model/);
assert.match(generation, /effectiveReasoningEffort:\s*payload\.reasoning\?\.effort \|\| null/);
assert.match(generation, /effectiveReasoningMode:\s*payload\.reasoning\?\.mode \|\| null/);
assert.match(generation, /reasoningTokens/);
assert.doesNotMatch(generation, /runStructuredAI|provider-manager|providerPolicy/);

for (const deadline of ["30_000", "60_000", "90_000"]) {
  assert.match(profiles, new RegExp(`timeoutMs: ${deadline}`));
  assert.match(route, new RegExp(deadline));
}
assert.match(profiles, /reasoningEffort:\s*"low"/);
assert.match(profiles, /reasoningEffort:\s*"medium"/);
assert.match(profiles, /reasoningEffort:\s*"high"/);
assert.match(profiles, /reasoningMode:\s*"pro"/);
assert.match(profiles, /enable_thinking:\s*false/);
assert.match(profiles, /enable_thinking:\s*true/);
assert.match(profiles, /reasoning_budget/);

for (const contract of [
  "business_health_explanation_v1",
  "leadership_priorities_v1",
  "executive_brief_v1"
]) {
  assert.match(profiles, new RegExp(contract));
}
assert.match(types, /one_pass/);
assert.match(types, /deterministic_assembly/);
assert.match(runner, /deterministicAssembly/);
assert.match(runner, /covered_signal_ordinals/);
assert.match(runner, /primary_concern_ordinal/);
assert.match(runner, /strongest_positive_signal_ordinal/);
assert.match(runner, /verifyEvidenceManifestCitations/);
assert.match(runner, /numericIntegrity/);
assert.match(runner, /requiredSignalCoverage/);
assert.match(runner, /unsupportedInferenceDetected/);
assert.match(runner, /unauthorizedRelationshipDetected/);
assert.match(runner, /reasoningLeakageDetected/);
assert.match(runner, /published_token_pricing/);
assert.match(runner, /nvidia_prototype_credit_no_token_price/);
assert.doesNotMatch(runner, /fallback|runStructuredAI|providerPolicy/i);

assert.equal((fixtures.match(/id: "bh-/g) || []).length, 8);
assert.equal((fixtures.match(/id: "brief-/g) || []).length, 11);
assert.equal((fixtures.match(/id: "priorities-/g) || []).length, 9);
assert.match(fixtures, /required_signal_identity/);
assert.match(fixtures, /primary_concern_required/);
assert.match(fixtures, /strongest_positive_signal_required/);
assert.match(fixtures, /do not manufacture upside/i);
assert.match(fixtures, /Do not repeat the same signal merely to satisfy multiple fields/);

for (const surface of [route, page]) {
  assert.match(surface, /process\.env\.VERCEL_ENV === "preview"/);
  assert.match(surface, /VAEROEX_AI_SMOKE_TEST_ENABLED/);
  assert.match(surface, /blindOutput: _blindOutput/);
  assert.doesNotMatch(surface, /\.from\(|workspaceId|customer evidence|evidence excerpt/i);
}
assert.match(route, /isVaeroexAdminUser/);
assert.match(route, /auditStageThreeBOpenAIModelAccess/);
assert.match(route, /fallbackEnabled:\s*false/);
assert.match(route, /activeRoutingChanged:\s*false/);
assert.match(page, /getVaeroexAdminAccess/);
assert.match(page, /data-testid="stage-three-b-result"/);

process.stdout.write("NVIDIA Stage 3B qualification regressions passed.\n");
