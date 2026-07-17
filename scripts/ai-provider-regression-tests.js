const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const manager = read("lib/ai/providers/provider-manager.ts");
const openai = read("lib/ai/providers/openai-provider.ts");
const nvidia = read("lib/ai/providers/nvidia-provider.ts");
const client = read("lib/ai/vaeroex-client.ts");
const kpi = read("lib/ai/kpi-overview.ts");
const embeddings = read("lib/ai/evidence-index.ts");
const smoke = read("lib/ai/provider-smoke-test.ts");
const guardrails = read("lib/ai/provider-guardrails.ts");
const usage = read("lib/ai/usage.ts");
const env = read(".env.example");

assert.match(manager, /nvidia\/llama-3\.3-nemotron-super-49b-v1\.5/, "NVIDIA must use the approved Nemotron model");
assert.match(nvidia, /https:\/\/integrate\.api\.nvidia\.com\/v1\/chat\/completions/, "NVIDIA must use its server API endpoint");
assert.match(nvidia, /process\.env\.NVIDIA_API_KEY/, "NVIDIA credentials must remain server-side");
assert.match(openai, /process\.env\.OPENAI_API_KEY/, "OpenAI fallback credentials must remain server-side");
assert.match(manager, /primaryProvider !== "nvidia"/, "only NVIDIA primary calls should automatically enter the OpenAI fallback path");
assert.match(manager, /primaryMaxAttempts = request\.primaryProvider === "nvidia" \? 2/, "NVIDIA must receive exactly one retry");
assert.match(manager, /waitBeforeRetry/, "provider retries must use bounded backoff");
assert.match(manager, /repairContent/, "invalid structured responses must receive one repair attempt");
assert.match(manager, /validate: \(value: unknown\)/, "provider outputs must be validated by the caller contract");
assert.match(client, /validateVaeroexWorkflowContract/, "all Vaeroex workflows must validate their structured contract");
assert.match(kpi, /validateKpiOverviewContract/, "the bounded KPI workflow must validate its structured contract");
assert.match(client, /runStructuredAI/, "main Vaeroex generation must use the provider manager");
assert.match(kpi, /runStructuredAI/, "KPI generation must use the provider manager");
assert.match(embeddings, /createAIEmbeddings/, "Business Memory embeddings must use the provider abstraction");
assert.doesNotMatch(client, /api\.openai\.com|integrate\.api\.nvidia\.com/, "the main client must not call vendor endpoints directly");
assert.doesNotMatch(kpi, /api\.openai\.com|integrate\.api\.nvidia\.com/, "the KPI client must not call vendor endpoints directly");
assert.match(guardrails, /ai\.provider\.user/, "provider calls must enforce a per-user limit");
assert.match(guardrails, /ai\.provider\.workspace/, "provider calls must enforce a per-workspace limit");
assert.match(guardrails, /strict: true/g, "provider rate limits must fail closed when the limiter is unavailable");
assert.match(usage, /provider_attempts/, "usage cost must account for retries and fallback attempts");
assert.match(usage, /NVIDIA_INPUT_COST_CENTS_PER_1M/, "NVIDIA cost overrides must be configurable");
assert.match(smoke, /buildWorkspaceEvidenceContext/, "the smoke test must execute workspace-scoped Business Memory retrieval");
assert.match(smoke, /evidence\.available/, "the smoke test must reject a demo workspace without eligible evidence");
assert.match(smoke, /runVaeroexCompletionWithUsage/, "the smoke test must execute the complete Vaeroex generation path");
assert.match(smoke, /recordVaeroexAiUsage/, "live provider smoke usage must be tracked");
assert.match(smoke, /fallbackVerified/, "the smoke test must verify OpenAI fallback deterministically");
assert.match(env, /AI_PROVIDER=openai/, "OpenAI must remain the default provider");
assert.match(env, /NVIDIA_API_KEY=/, "the server-side NVIDIA key must be documented");
assert.doesNotMatch(env, /NEXT_PUBLIC_NVIDIA/, "NVIDIA credentials must never be public");

console.log("AI provider regression tests passed.");
