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
const searchRoute = read("app/api/search/route.ts");
const providerManager = read("lib/ai/providers/provider-manager.ts");
const vaeroexClient = read("lib/ai/vaeroex-client.ts");
const queryPlanner = read("lib/ai/query-depth-planner.ts");

assert.match(
  globalSearch,
  /fetch\(`\/api\/search\?q=\$\{encodeURIComponent\(trimmedQuery\)\}`/,
  "typing must continue to use deterministic GET search"
);
assert.match(globalSearch, /onSubmit=\{submitQuestion\}/, "the Search or Ask form must own explicit question submission");
assert.match(globalSearch, /onKeyDown=\{submitQuestionOnEnter\}/, "Enter must use an explicit question-submit handler");
assert.match(globalSearch, /event\.currentTarget\.form\?\.requestSubmit\(\)/, "Enter must request exactly one native form submission");
assert.match(globalSearch, /event\.preventDefault\(\);[\s\S]{0,120}requestSubmit\(\)/, "explicit Enter handling must prevent the browser's second implicit submit");
assert.match(globalSearch, /type="submit"[\s\S]{0,700}aria-label="Ask Vaeroex"/, "the panel must expose a clear Ask submit action");
assert.match(globalSearch, /if \(trimmedQuery\.length < 2 \|\| askingRef\.current\) return;/, "a question must not start twice while generation is active");
assert.match(globalSearch, /searchAbortRef\.current\?\.abort\(\)/, "explicit Ask must cancel pending GET search work");
assert.match(globalSearch, /generationAbortRef/, "generation cancellation must be scoped separately from live search");
assert.match(globalSearch, /data-vaeroex-skip-global-activity/, "the local Search or Ask activity state must not create a duplicate global form activity");

const submitStart = globalSearch.indexOf("async function submitQuestion");
const submitEnd = globalSearch.indexOf("function submitQuestionOnEnter");
const submitSource = globalSearch.slice(submitStart, submitEnd);
assert.match(submitSource, /method:\s*"POST"/, "explicit Ask must call the generative POST endpoint");
assert.equal((submitSource.match(/fetch\("\/api\/search"/g) || []).length, 1, "one explicit Ask must issue only one POST request");

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

assert.match(providerManager, /primaryMaxAttempts = request\.primaryProvider === "nvidia" \? 2/, "NVIDIA must receive exactly one retry");
assert.match(providerManager, /fallbackUsed:\s*finalResult\.provider !== request\.primaryProvider/, "provider-manager fallback status must reflect the provider that completed the request");
assert.match(providerManager, /provider:\s*finalResult\.provider/, "successful NVIDIA generation must report NVIDIA as the final provider");
assert.match(providerManager, /model:\s*finalResult\.model/, "successful generation must persist the model that actually completed it");

const { runStructuredAI } = require("../lib/ai/providers/provider-manager.ts");
const { AIProviderError } = require("../lib/ai/providers/types.ts");
const { recordVaeroexAiUsage } = require("../lib/ai/usage.ts");

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

  let nvidiaCalls = 0;
  const fallback = await runStructuredAI({
    ...request,
    providers: {
      nvidia: provider("nvidia", async () => {
        nvidiaCalls += 1;
        throw new AIProviderError("NVIDIA timed out.", "nvidia", true);
      }),
      openai: provider("openai", async () => providerResult({ ok: true }, 180, 30))
    }
  });
  assert.equal(nvidiaCalls, 2, "NVIDIA timeout must receive exactly one retry");
  assert.equal(fallback.provider, "openai", "OpenAI must complete the request after bounded NVIDIA failure");
  assert.equal(fallback.fallbackUsed, true, "provider-manager fallback status must be true after OpenAI succeeds");
  assert.equal(fallback.attempts.length, 3, "fallback attempts must include two NVIDIA attempts and one OpenAI attempt");

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
  assert.equal(inserted[0].metadata_json.provider_attempts.length, 3, "persisted usage must retain every provider attempt");
}

runRuntimeTests()
  .then(() => console.log("Search or Ask generation regression tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
