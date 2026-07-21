const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

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
const resilience = read("lib/ai/provider-resilience.ts");
const env = read(".env.example");
const searchRoute = read("app/api/search/route.ts");

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

assert.match(manager, /nvidia\/llama-3\.3-nemotron-super-49b-v1\.5/, "NVIDIA must use the approved Nemotron model");
assert.match(nvidia, /https:\/\/integrate\.api\.nvidia\.com\/v1\/chat\/completions/, "NVIDIA must use its server API endpoint");
assert.match(nvidia, /process\.env\.NVIDIA_API_KEY/, "NVIDIA credentials must remain server-side");
assert.match(searchRoute, /generationMode:\s*"interactive_executive"/, "interactive Executive Analysis must opt into its provider-neutral fast mode");
assert.match(manager, /generationMode:\s*request\.generationMode/, "the provider manager must pass the workflow generation mode without selecting a vendor");
assert.match(nvidia, /interactiveExecutive \? `\/no_think/, "NVIDIA interactive Executive Analysis must disable hidden reasoning with the documented system directive");
assert.match(nvidia, /temperature:\s*interactiveExecutive \? 0 : request\.temperature/, "NVIDIA reasoning-off mode must use greedy decoding");
assert.match(nvidia, /!interactiveExecutive \? \{ top_p: 0\.95 \} : \{\}/, "greedy mode must not also override top-p");
assert.doesNotMatch(openai, /no_think|interactiveExecutive/, "the NVIDIA reasoning mode must not alter OpenAI behavior");
assert.match(openai, /type:\s*"json_schema"/, "OpenAI workflows must support strict Responses API schemas when explicitly requested");
assert.match(openai, /request\.reasoning\.effort/, "OpenAI workflows must support explicit reasoning effort without changing legacy callers");
assert.match(openai, /typeof request\.temperature === "number"/, "OpenAI must omit temperature when a workflow requires model-default sampling");
assert.match(openai, /process\.env\.OPENAI_API_KEY/, "OpenAI fallback credentials must remain server-side");
assert.match(manager, /request\.providerPolicy \|\|/, "workflow-specific provider order must be expressed as an explicit policy");
assert.match(manager, /for \(const \[index, step\] of policy\.steps\.entries\(\)\)/, "the provider manager must execute one ordered policy step at a time");
assert.match(manager, /step\.workflowConfiguration\?\.maxAttempts[\s\S]*Math\.max\(1, Math\.min\(providerSettings\.maxRetries \+ 1, 2\)\)/, "provider retries must honor explicit step settings before legacy workflow settings");
assert.match(manager, /fallbackUsed:\s*finalResult\.policyStep > 1/, "fallback attribution must use the accepted policy step rather than provider identity");
assert.match(resilience, /maxRetries:\s*1/, "the default provider policy must retain one retry outside bounded workflows");
assert.match(resilience, /const value = await consume\(response\)[\s\S]*recordAIProviderSuccess/, "provider success must be recorded only after the complete response body is consumed");
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

async function runDynamicProviderTests() {
  const { consumeAIProviderResponse, resetAIProviderCircuitForTests } = require("../lib/ai/provider-resilience.ts");
  const { NvidiaProvider } = require("../lib/ai/providers/nvidia-provider.ts");
  const originalFetch = global.fetch;
  const originalKey = process.env.NVIDIA_API_KEY;
  const settings = {
    timeoutMs: 25,
    maxRetries: 0,
    retryBaseDelayMs: 1,
    circuitFailureThreshold: 50,
    circuitOpenMs: 10_000
  };

  try {
    global.fetch = async (_input, init) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve("{\"ok\":true}"), 150);
        init.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(init.signal.reason || new Error("aborted"));
        }, { once: true });
      })
    });
    await assert.rejects(
      consumeAIProviderResponse("nvidia", "https://provider.test", {}, (response) => response.text(), settings),
      /timed out|abort/i,
      "the provider timeout must remain active while the response body is being read"
    );

    resetAIProviderCircuitForTests();
    const requestBodies = [];
    process.env.NVIDIA_API_KEY = "test-key-not-a-secret";
    global.fetch = async (_input, init) => {
      requestBodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "{\"ok\":true}" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
      }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const provider = new NvidiaProvider();
    const baseRequest = {
      model: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
      systemPrompt: "System contract",
      userContent: [{ type: "text", text: "Request" }],
      temperature: 0.2,
      maxOutputTokens: 400,
      settings: { ...settings, timeoutMs: 500 }
    };
    await provider.generate({ ...baseRequest, generationMode: "interactive_executive" });
    await provider.generate({ ...baseRequest, generationMode: "default" });

    assert.match(requestBodies[0].messages[0].content, /^\/no_think\n/, "interactive Executive Analysis must put /no_think in NVIDIA's system prompt");
    assert.equal(requestBodies[0].temperature, 0, "interactive Executive Analysis must use greedy decoding");
    assert.equal("top_p" in requestBodies[0], false, "greedy NVIDIA requests must not also change top-p");
    assert.doesNotMatch(requestBodies[1].messages[0].content, /^\/no_think/, "other NVIDIA workflows must preserve reasoning mode");
    assert.equal(requestBodies[1].temperature, 0.2, "other NVIDIA workflows must preserve their requested temperature");
    assert.equal(requestBodies[1].top_p, 0.95, "other NVIDIA workflows must preserve current provider defaults");

    global.fetch = async () => new Response(JSON.stringify({
      choices: [{ finish_reason: "length", message: { content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 10, completion_tokens: 400, total_tokens: 410 }
    }), { status: 200, headers: { "content-type": "application/json" } });
    const truncated = await provider.generate({ ...baseRequest, generationMode: "interactive_executive" });
    assert.equal(truncated.finishReason, "length", "provider finish metadata must preserve output-limit termination");
    assert.equal(truncated.truncationDetected, true, "output-limit termination must be marked for provider-manager rejection");
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalKey;
    resetAIProviderCircuitForTests();
  }
}

runDynamicProviderTests()
  .then(() => console.log("AI provider regression tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
