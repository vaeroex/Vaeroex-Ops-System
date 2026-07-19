const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const route = read("app/api/internal/nvidia-qualification/route.ts");
const page = read("app/app/admin/nvidia-qualification/page.tsx");
const profiles = read("lib/ai/qualification/profiles.ts");
const contracts = read("lib/ai/qualification/contracts.ts");
const client = read("lib/ai/qualification/generation-client.ts");
const runner = read("lib/ai/qualification/stage-one.ts");
const types = read("lib/ai/qualification/types.ts");

assert.match(types, /business_health_explanation_v1/);
assert.match(types, /executive_brief_benchmark_v1/);
assert.match(types, /leadership_priorities_benchmark_v1/);
assert.doesNotMatch(types, /deep_strategic_analysis/, "Deep Strategic Analysis must not consume Stage 1 benchmark budget");

for (const model of [
  "nvidia/nemotron-3-nano-30b-a3b",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
  "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  "nvidia/nemotron-3-super-120b-a12b",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "z-ai/glm-5.2",
  "deepseek-ai/deepseek-v4-flash",
  "deepseek-ai/deepseek-v4-pro",
  "openai/gpt-oss-20b",
  "meta/llama-3.3-70b-instruct"
]) {
  assert.ok(profiles.includes(model), `qualification profiles must include ${model}`);
}
assert.match(profiles, /resolveVaeroexModel\("cross_business_reasoning", "openai"\)/, "the control must use the configured Production OpenAI route");
assert.match(profiles, /chat_template_kwargs:\s*\{ enable_thinking: false \}/, "documented no-thinking profiles must be explicit");
assert.match(profiles, /reasoning_budget:\s*2048/, "bounded reasoning must be explicit");
assert.match(profiles, /systemPrefix:\s*"\/no_think"/, "the existing 49B no-think control must remain explicit");

assert.match(contracts, /validateBusinessHealthExplanationOutput/, "Business Health must use the merged validator");
assert.match(contracts, /buildEvidenceManifest/, "fixtures must use an immutable Evidence Engine manifest");
assert.match(contracts, /buildSourceRegistry/, "fixtures must preserve application-owned source identity");
assert.match(contracts, /citations_attached_after_validation:\s*true/, "models must not own citation IDs");
assert.match(contracts, /Do not invent causes, impacts, forecasts/, "planned contracts must keep semantic boundaries explicit");

assert.match(client, /stream:\s*true/, "NVIDIA probes must expose first-token timing where transport supports streaming");
assert.match(client, /controller\.abort\(\)/, "each isolated probe must enforce its own timeout");
assert.match(client, /maxRetries:\s*0/, "Stage 1 must score isolated attempts without hidden retries");
assert.doesNotMatch(client, /runStructuredAI|providerPolicy|fallback/i, "Stage 1 must not invoke active routing or fallback logic");
assert.match(runner, /response_not_json/);
assert.match(runner, /unexpected_truncation/);

assert.match(route, /process\.env\.VERCEL_ENV === "preview"/, "the live harness must fail closed outside Preview");
assert.match(route, /VAEROEX_AI_SMOKE_TEST_ENABLED/, "the live harness must require the existing explicit smoke-test gate");
assert.match(route, /isVaeroexAdminUser/, "only an authorized Vaeroex admin may invoke probes");
assert.match(route, /runIndex < 1 \|\| runIndex > 3/, "Stage 1 must cap measured repetitions at three");
assert.match(route, /url\.searchParams\.get\("profileId"\)/, "the signed-in Preview may run one isolated probe through direct navigation");
assert.match(route, /return probeResponse\(\{ profileId, contractId, runIndex \}\)/, "GET and POST must share one validated probe path");
assert.match(route, /excluded:\s*\["deep_strategic_analysis"\]/, "the route must disclose the approved exclusion");
assert.doesNotMatch(route, /\.from\(|workspaceId|evidence excerpt|systemPrompt|userContent|content:/, "the route must not read customer data or log prompt content");
assert.match(route, /outputCharacters/, "content-free completion metadata should be retained");

assert.match(page, /process\.env\.VERCEL_ENV === "preview"/, "the browser-compatible runner must remain Preview-only");
assert.match(page, /getVaeroexAdminAccess/, "the browser-compatible runner must remain admin-only");
assert.match(page, /runStageOneQualificationProbe/, "the page must use the same isolated Stage 1 runner");
assert.match(page, /data-testid="qualification-result"/, "the page must expose only sanitized result metadata");
assert.match(page, /excluded:\s*\["deep_strategic_analysis"\]/, "the browser-compatible runner must retain the approved scope exclusion");
assert.doesNotMatch(page, /\.from\(|workspaceId|evidence excerpt|systemPrompt|userContent/, "the page must not read or render customer evidence");

process.stdout.write("NVIDIA capability qualification regressions passed.\n");
