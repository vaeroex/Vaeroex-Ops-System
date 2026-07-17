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

const globalSearch = read("components/app/GlobalSearch.tsx");
const askWorkspace = read("components/app/AskVaeroexWorkspace.tsx");
const searchRoute = read("app/api/search/route.ts");
const providerManager = read("lib/ai/providers/provider-manager.ts");
const vaeroexClient = read("lib/ai/vaeroex-client.ts");
const queryPlanner = read("lib/ai/query-depth-planner.ts");
const apiErrors = read("lib/search/api-errors.ts");
const providerResilience = read("lib/ai/provider-resilience.ts");

assert.match(
  globalSearch,
  /fetch\(`\/api\/search\?q=\$\{encodeURIComponent\(trimmedQuery\)\}`/,
  "typing must continue to use deterministic GET search"
);
assert.match(globalSearch, /onSubmit=\{openSelectedResult\}/, "Search Enter must open the selected deterministic result");
assert.doesNotMatch(globalSearch, /method:\s*"POST"|submitQuestion|generationAbortRef|aria-label="Ask Vaeroex"/, "Search must not retain Ask generation behavior");

const submitStart = askWorkspace.indexOf("async function requestAnalysis");
const submitEnd = askWorkspace.indexOf("function submitInitial", submitStart);
const submitSource = askWorkspace.slice(submitStart, submitEnd);
assert.match(submitSource, /method:\s*"POST"/, "dedicated Ask must call the generative POST endpoint");
assert.equal((submitSource.match(/fetch\("\/api\/search"/g) || []).length, 1, "Ask and follow-up must share one POST call site");
assert.match(askWorkspace, /requestInFlightRef\.current/, "Ask must reject duplicate generation while a request is active");
assert.match(askWorkspace, /requestControllerRef/, "Ask cancellation must be scoped separately from Search");
assert.match(askWorkspace, /data-vaeroex-skip-global-activity/, "local Ask activity must not create duplicate global form activity");

assert.match(searchRoute, /export async function GET/, "deterministic workspace search must remain available");
assert.match(searchRoute, /export async function POST/, "the bounded generation endpoint must remain available");
assert.match(searchRoute, /runVaeroexCompletionWithUsage/, "generation must continue through the provider-neutral Vaeroex client");
assert.match(vaeroexClient, /runStructuredAI/, "the Vaeroex client must continue through the provider manager");
assert.match(searchRoute, /recordVaeroexAiUsage\([\s\S]*agentType:\s*"global_search_or_ask"/, "successful generation must persist AI usage");
assert.match(queryPlanner, /classification === "search_navigation"[\s\S]*requiresOpenAI:\s*false/, "navigation requests must remain deterministic");
assert.match(queryPlanner, /The request asks to locate or open a workspace record/, "record-location requests must stay on the search path");

const successfulUsageStart = searchRoute.indexOf("await recordVaeroexAiUsage", searchRoute.indexOf("const generation = await"));
const successfulUsageEnd = searchRoute.indexOf("return NextResponse.json", successfulUsageStart);
const successfulUsage = searchRoute.slice(successfulUsageStart, successfulUsageEnd);
assert.match(successfulUsage, /\.\.\.generation\.usage/, "persisted usage must inherit provider-manager metadata");
assert.match(successfulUsage, /\.\.\.\(isRecord\(generation\.usage\.metadata\)/, "provider attempt metadata must be preserved");
assert.doesNotMatch(successfulUsage, /fallback_used:\s*false/, "Search or Ask must not overwrite a real OpenAI fallback with false");

assert.match(providerManager, /primaryMaxAttempts = Math\.max\(1, Math\.min\(settings\.maxRetries \+ 1, 2\)\)/, "provider attempts must honor the caller's retry budget");
assert.match(providerManager, /fallbackMaxAttempts = Math\.max\(1, Math\.min\(fallbackSettings\.maxRetries \+ 1, 2\)\)/, "OpenAI fallback attempts must honor the caller's retry budget");
assert.match(providerManager, /fallbackUsed:\s*finalResult\.provider !== request\.primaryProvider/, "provider-manager fallback status must reflect the provider that completed the request");
assert.match(providerManager, /provider:\s*finalResult\.provider/, "successful NVIDIA generation must report NVIDIA as the final provider");
assert.match(providerManager, /model:\s*finalResult\.model/, "successful generation must persist the model that actually completed it");
assert.match(searchRoute, /SEARCH_ASK_PROVIDER_TIMEOUT_MS = 8_000/, "interactive Search or Ask must reserve time for fallback and response overhead");
assert.match(searchRoute, /SEARCH_ASK_PROVIDER_MAX_RETRIES = 0/, "interactive Search or Ask must not spend its deadline on a second NVIDIA attempt");
assert.match(searchRoute, /provider_attempts:\s*providerAttempts/, "failed Search or Ask usage must preserve completed provider attempts");
assert.match(apiErrors, /status === 408 \|\| status === 504/, "structured timeout responses must map to a safe user message");
assert.doesNotMatch(askWorkspace, /new Error\(payload\.error/, "structured API errors must never be coerced into [object Object]");
assert.match(providerResilience, /controller\.abort\(timeoutError\(provider, settings\.timeoutMs\)\)/, "provider timeouts must abort the active request");
assert.match(providerResilience, /finally \{[\s\S]*clearTimeout\(timeout\)/, "provider timeout cleanup must always run");

const routeDurationMs = Number((searchRoute.match(/export const maxDuration = (\d+)/) || [])[1]) * 1_000;
const providerTimeoutMs = Number((searchRoute.match(/SEARCH_ASK_PROVIDER_TIMEOUT_MS = ([\d_]+)/) || [])[1].replaceAll("_", ""));
assert.equal(routeDurationMs, 30_000, "the regression must model the deployed Vercel function limit");
assert.ok(providerTimeoutMs * 2 <= 16_000, "one NVIDIA attempt plus one OpenAI fallback must leave at least 14 seconds for retrieval and response work");

const { AIProviderExecutionError, runStructuredAI } = require("../lib/ai/providers/provider-manager.ts");
const { AIProviderError } = require("../lib/ai/providers/types.ts");
const { recordVaeroexAiUsage } = require("../lib/ai/usage.ts");
const { globalSearchApiErrorMessage } = require("../lib/search/api-errors.ts");

const providerResult = (content, inputTokens, outputTokens) => ({
  content: JSON.stringify(content),
  requestId: "regression-request",
  latencyMs: 5,
  usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens }
});

const provider = (name, generate) => ({
  name,
  supportsAttachments: name === "openai",
  isConfigured: () => true,
  generate
});

const request = {
  primaryProvider: "nvidia",
  primaryModel: "nvidia/llama-3.3-nemotron-super-49b-v1.5",
  fallbackModel: "gpt-4o-mini",
  systemPrompt: "Return JSON.",
  userContent: [{ type: "text", text: "bounded regression input" }],
  settings: {
    timeoutMs: 50,
    maxRetries: 1,
    retryBaseDelayMs: 1,
    circuitFailureThreshold: 5,
    circuitOpenMs: 10_000
  },
  validate(value) {
    return value && value.ok === true ? { ok: true, value } : { ok: false, reason: "missing ok" };
  }
};

async function runRuntimeTests() {
  const direct = await runStructuredAI({
    ...request,
    providers: {
      nvidia: provider("nvidia", async () => providerResult({ ok: true }, 120, 20)),
      openai: provider("openai", async () => providerResult({ ok: true }, 0, 0))
    }
  });
  assert.equal(direct.provider, "nvidia", "a successful NVIDIA response must remain on NVIDIA");
  assert.equal(direct.model, request.primaryModel, "a successful NVIDIA response must record the Nemotron model");
  assert.equal(direct.fallbackUsed, false, "direct NVIDIA success must not report fallback");
  assert.equal(direct.attempts.length, 1, "direct NVIDIA success must issue one provider request");
  assert.equal(direct.attempts[0].fallback, false, "direct NVIDIA success must not be labeled as fallback");

  let nvidiaCalls = 0;
  const fallback = await runStructuredAI({
    ...request,
    settings: { ...request.settings, maxRetries: 0 },
    providers: {
      nvidia: provider("nvidia", async () => {
        nvidiaCalls += 1;
        throw new AIProviderError("NVIDIA timed out.", "nvidia", true);
      }),
      openai: provider("openai", async () => providerResult({ ok: true }, 180, 30))
    }
  });
  assert.equal(nvidiaCalls, 1, "interactive NVIDIA timeout must fall back without a second long attempt");
  assert.equal(fallback.provider, "openai", "OpenAI must complete the request after bounded NVIDIA failure");
  assert.equal(fallback.fallbackUsed, true, "provider-manager fallback status must be true after OpenAI succeeds");
  assert.equal(fallback.attempts.length, 2, "interactive fallback must include one NVIDIA attempt and one OpenAI attempt");
  assert.equal(fallback.attempts[0].fallback, false, "the primary timeout must remain labeled as a primary attempt");
  assert.equal(fallback.attempts[1].fallback, true, "the OpenAI completion must be labeled as fallback");

  let defaultNvidiaCalls = 0;
  const defaultRetry = await runStructuredAI({
    ...request,
    providers: {
      nvidia: provider("nvidia", async () => {
        defaultNvidiaCalls += 1;
        if (defaultNvidiaCalls === 1) throw new AIProviderError("NVIDIA timed out.", "nvidia", true);
        return providerResult({ ok: true }, 90, 15);
      }),
      openai: provider("openai", async () => {
        throw new Error("OpenAI fallback should not run after a successful NVIDIA retry.");
      })
    }
  });
  assert.equal(defaultNvidiaCalls, 2, "non-interactive workflows must retain the configured NVIDIA retry");
  assert.equal(defaultRetry.provider, "nvidia", "a successful default NVIDIA retry must remain on NVIDIA");

  await assert.rejects(
    runStructuredAI({
      ...request,
      settings: { ...request.settings, maxRetries: 0 },
      providers: {
        nvidia: provider("nvidia", async () => {
          throw new AIProviderError("NVIDIA timed out.", "nvidia", true);
        }),
        openai: provider("openai", async () => {
          throw new AIProviderError("OpenAI timed out.", "openai", true);
        })
      }
    }),
    (error) => {
      assert.ok(error instanceof AIProviderExecutionError, "exhausted provider execution must retain attempt metadata");
      assert.equal(error.attempts.length, 2, "failed execution must retain the primary and fallback attempts");
      assert.equal(error.attempts[0].fallback, false, "the failed NVIDIA attempt must remain primary");
      assert.equal(error.attempts[1].fallback, true, "the failed OpenAI attempt must remain fallback");
      return true;
    }
  );

  const inserted = [];
  const fakeSupabase = {
    from(table) {
      assert.equal(table, "ai_usage");
      return {
        async insert(row) {
          inserted.push(row);
          return { error: null };
        }
      };
    }
  };
  await recordVaeroexAiUsage({
    supabase: fakeSupabase,
    workspaceId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    agentType: "global_search_or_ask",
    usage: {
      inputTokens: fallback.inputTokens,
      outputTokens: fallback.outputTokens,
      totalTokens: fallback.totalTokens,
      model: fallback.model,
      latencyMs: fallback.latencyMs,
      status: "completed",
      metadata: {
        provider: fallback.provider,
        primary_provider: request.primaryProvider,
        fallback_used: fallback.fallbackUsed,
        provider_attempts: fallback.attempts
      }
    }
  });
  assert.equal(inserted.length, 1, "one completed generation must create one AI usage row");
  assert.equal(inserted[0].metadata_json.fallback_used, true, "persisted fallback status must match provider attempts");
  assert.equal(inserted[0].metadata_json.provider_attempts.length, 2, "persisted usage must retain every provider attempt");

  assert.equal(
    globalSearchApiErrorMessage(504, { error: { code: "FUNCTION_INVOCATION_TIMEOUT" } }),
    "The analysis took too long. Please try again.",
    "structured Vercel timeout errors must remain readable"
  );
  assert.equal(
    globalSearchApiErrorMessage(500, { error: { message: "provider details" } }),
    "Vaeroex could not answer that question right now.",
    "structured provider errors must not expose internals"
  );
  assert.doesNotMatch(globalSearchApiErrorMessage(504, { error: {} }), /\[object Object\]/, "API errors must never stringify objects");
}

runRuntimeTests()
  .then(() => console.log("Search or Ask generation regression tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
