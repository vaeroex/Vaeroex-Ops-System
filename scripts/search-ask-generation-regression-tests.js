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
const providerExecutionBudget = read("lib/ai/providers/execution-budget.ts");
const workspaceContext = read("lib/workspaces/current.ts");
const usageLimits = read("lib/billing/usage-limits.ts");
const workflowProviderPolicy = read("lib/ai/providers/workflow-provider-policy.ts");
const synchronousPolicyStart = workflowProviderPolicy.indexOf("export function buildSynchronousExecutiveProviderPolicy");
const synchronousPolicyEnd = workflowProviderPolicy.indexOf("export function resolveBusinessHealthGenerationPolicy", synchronousPolicyStart);
const synchronousWorkflowProviderPolicy = workflowProviderPolicy.slice(synchronousPolicyStart, synchronousPolicyEnd);

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

assert.match(providerManager, /step\.workflowConfiguration\?\.maxAttempts[\s\S]*Math\.max\(1, Math\.min\(providerSettings\.maxRetries \+ 1, 2\)\)/, "each provider step must honor explicit step settings before the caller's retry budget");
assert.match(providerManager, /fallbackUsed:\s*finalResult\.policyStep > 1/, "provider-manager fallback status must reflect the accepted workflow policy step");
assert.match(providerManager, /provider:\s*finalResult\.provider/, "successful NVIDIA generation must report NVIDIA as the final provider");
assert.match(providerManager, /model:\s*finalResult\.model/, "successful generation must persist the model that actually completed it");
assert.match(synchronousWorkflowProviderPolicy, /id:\s*"synchronous_executive_openai_first_interim"/, "synchronous Executive Analysis must identify its latency-driven interim policy explicitly");
assert.match(synchronousWorkflowProviderPolicy, /provider:\s*"openai"[\s\S]*provider:\s*"nvidia"/, "synchronous Executive Analysis must use explicit OpenAI then NVIDIA order");
assert.doesNotMatch(synchronousWorkflowProviderPolicy, /resolveConfiguredAIProvider|previewVariant|VERCEL_ENV/, "the synchronous policy must neither inherit global order nor retain a Preview selector");
assert.match(vaeroexClient, /const configuredProvider = resolveConfiguredAIProvider\(\)/, "all workflows without an explicit policy must preserve global provider configuration");
assert.doesNotMatch(searchRoute, /EXECUTIVE_PROVIDER_POLICY_HEADER|resolvePreviewExecutiveProviderPolicyVariant/, "the release route must not retain benchmark request plumbing");
assert.doesNotMatch(askWorkspace, /executive_provider_policy|previewExecutiveProviderPolicyHeader|x-vaeroex-preview-executive-policy/, "the Ask UI must not retain benchmark query or header plumbing");
assert.match(searchRoute, /SEARCH_ASK_NVIDIA_SECONDARY_MINIMUM_REMAINING_MS = SEARCH_ASK_NVIDIA_TIMEOUT_MS \+ SEARCH_ASK_PROVIDER_TRANSITION_RESERVE_MS/, "OpenAI-first routing must reserve a meaningful full NVIDIA secondary window");
assert.match(searchRoute, /SEARCH_ASK_TOTAL_DEADLINE_MS = 27_000/, "interactive Search or Ask must use one workflow-level deadline");
assert.match(searchRoute, /SEARCH_ASK_PROVIDER_MAX_RETRIES = 0/, "interactive Search or Ask must not spend its deadline on a second NVIDIA attempt");
assert.match(searchRoute, /provider_attempts:\s*providerAttempts/, "failed Search or Ask usage must preserve completed provider attempts");
assert.match(apiErrors, /status === 408 \|\| status === 504/, "structured timeout responses must map to a safe user message");
assert.doesNotMatch(askWorkspace, /new Error\(payload\.error/, "structured API errors must never be coerced into [object Object]");
assert.match(providerResilience, /controller\.abort\(timeoutError\(provider, settings\.timeoutMs\)\)/, "provider timeouts must abort the active request");
assert.match(providerResilience, /finally \{[\s\S]*clearTimeout\(timeout\)/, "provider timeout cleanup must always run");
assert.match(searchRoute, /Promise\.all\(\[structuredContextPromise, memoryContextPromise\]\)/, "structured context and Business Memory retrieval must run concurrently");
assert.match(searchRoute, /Promise\.all\(\[[\s\S]*evidenceRetrievalPromise,[\s\S]*usageLimitPromise[\s\S]*\]\)/, "evidence retrieval and the monthly usage check must run concurrently");
assert.match(searchRoute, /getWorkspaceContext\(undefined, \{ supabase, user \}\)/, "workspace authorization must reuse the already authenticated Supabase user");
assert.match(workspaceContext, /authenticated\?\.user \|\| \(await supabase\.auth\.getUser\(\)\)\.data\.user/, "shared workspace authorization must retain its normal authentication fallback");
assert.match(searchRoute, /isAiRunUsageLimitReached/, "interactive Ask must use the focused monthly AI-run usage check");
assert.match(usageLimits, /export async function isAiRunUsageLimitReached[\s\S]*from\("ai_agent_runs"\)[\s\S]*\.eq\("workspace_id", workspaceId\)/, "the focused usage check must remain workspace-scoped");
assert.doesNotMatch(searchRoute, /isUsageLimitReached\(/, "interactive Ask must not load unrelated workspace usage counters");
assert.match(searchRoute, /preparation_timings_ms:\s*timing\.snapshot\(\)/, "Search or Ask telemetry must persist metadata-only preparation timings");
for (const stage of [
  "authentication_ms",
  "workspace_authorization_ms",
  "evidence_retrieval_database_ms",
  "evidence_ranking_deduplication_ms",
  "signal_planning_ms",
  "business_health_context_loading_ms",
  "prompt_compaction_ms",
  "provider_prompt_construction_ms"
]) {
  assert.match(`${searchRoute}\n${read("lib/ai/bounded-context.ts")}\n${read("lib/ai/executive-intelligence.ts")}\n${vaeroexClient}`, new RegExp(stage), `preparation telemetry must include ${stage}`);
}
assert.match(searchRoute, /providerExecutionBudget:/, "interactive generation must pass a strict workflow deadline to the provider manager");
assert.match(providerExecutionBudget, /fallbackReserveMs/, "the primary provider must reserve a meaningful fallback window");
assert.match(providerExecutionBudget, /canStart:\s*timeoutMs >= minimumAttemptWindowMs/, "a provider must not start without a useful remaining window");

const routeDurationMs = Number((searchRoute.match(/export const maxDuration = (\d+)/) || [])[1]) * 1_000;
const totalDeadlineMs = Number((searchRoute.match(/SEARCH_ASK_TOTAL_DEADLINE_MS = ([\d_]+)/) || [])[1].replaceAll("_", ""));
const responseReserveMs = Number((searchRoute.match(/SEARCH_ASK_RESPONSE_RESERVE_MS = ([\d_]+)/) || [])[1].replaceAll("_", ""));
const nvidiaTimeoutMs = Number((searchRoute.match(/SEARCH_ASK_NVIDIA_TIMEOUT_MS = ([\d_]+)/) || [])[1].replaceAll("_", ""));
const openaiTimeoutMs = Number((searchRoute.match(/SEARCH_ASK_OPENAI_TIMEOUT_MS = ([\d_]+)/) || [])[1].replaceAll("_", ""));
assert.equal(routeDurationMs, 30_000, "the regression must model the deployed Vercel function limit");
assert.equal(totalDeadlineMs, 27_000, "interactive Search or Ask must stop before the Vercel function limit");
assert.ok(routeDurationMs - totalDeadlineMs >= 3_000, "the workflow deadline must leave a meaningful Vercel safety buffer");
assert.ok(responseReserveMs >= 1_500, "usage persistence and response serialization must retain explicit deadline space");
assert.ok(nvidiaTimeoutMs >= 10_000 && nvidiaTimeoutMs <= 11_000, "NVIDIA must receive the measured 10-11 second workflow window");
assert.ok(openaiTimeoutMs >= 8_000 && openaiTimeoutMs <= 9_000, "OpenAI fallback must receive the measured 8-9 second workflow window");
assert.ok(nvidiaTimeoutMs + openaiTimeoutMs < totalDeadlineMs, "provider windows must leave time for bounded preparation and persistence");

const { AIProviderExecutionError, runStructuredAI } = require("../lib/ai/providers/provider-manager.ts");
const { resolveAIProviderAttemptWindow } = require("../lib/ai/providers/execution-budget.ts");
const { AIProviderError } = require("../lib/ai/providers/types.ts");
const { recordVaeroexAiUsage } = require("../lib/ai/usage.ts");
const { globalSearchApiErrorMessage } = require("../lib/search/api-errors.ts");
const { buildSynchronousExecutiveProviderPolicy } = require("../lib/ai/providers/workflow-provider-policy.ts");

const providerResult = (content, inputTokens, outputTokens) => ({
  content: JSON.stringify(content),
  requestId: "regression-request",
  latencyMs: 5,
  finishReason: "stop",
  truncationDetected: false,
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
  const openAiFirstPolicy = buildSynchronousExecutiveProviderPolicy({
    modelRoute: "cross_business_reasoning",
    nvidiaSecondaryMinimumRemainingMs: 10_750
  });
  assert.equal(openAiFirstPolicy.id, "synchronous_executive_openai_first_interim", "telemetry must identify the workflow-specific interim policy");
  assert.deepEqual(openAiFirstPolicy.steps.map((step) => step.provider), ["openai", "nvidia"], "synchronous Executive Analysis must use explicit OpenAI then NVIDIA order");
  assert.equal(openAiFirstPolicy.steps[1].minimumRemainingMs, 10_750, "synchronous Executive Analysis must require a meaningful NVIDIA secondary window");

  let unexpectedNvidiaCalls = 0;
  const openAiDirect = await runStructuredAI({
    ...request,
    providerPolicy: openAiFirstPolicy,
    settings: { ...request.settings, timeoutMs: 10_500, maxRetries: 0 },
    providers: {
      nvidia: provider("nvidia", async () => {
        unexpectedNvidiaCalls += 1;
        return providerResult({ ok: true }, 80, 15);
      }),
      openai: provider("openai", async () => providerResult({ ok: true }, 100, 20))
    }
  });
  assert.equal(openAiDirect.provider, "openai", "the workflow must accept a valid OpenAI primary response");
  assert.equal(openAiDirect.fallbackUsed, false, "the workflow must not label its OpenAI primary as fallback");
  assert.equal(openAiDirect.providerPolicyId, "synchronous_executive_openai_first_interim", "usage telemetry must retain the final workflow policy");
  assert.equal(unexpectedNvidiaCalls, 0, "a valid OpenAI response must not trigger a duplicate NVIDIA request");

  const orderedCalls = [];
  const openAiToNvidiaFallback = await runStructuredAI({
    ...request,
    providerPolicy: openAiFirstPolicy,
    settings: { ...request.settings, timeoutMs: 10_500, maxRetries: 0 },
    executionBudget: {
      deadlineAtMs: Date.now() + 20_000,
      providerTimeoutMs: { nvidia: 10_500, openai: 100 },
      minimumAttemptWindowMs: { nvidia: 5_000, openai: 50 },
      fallbackReserveMs: 0,
      transitionReserveMs: 0
    },
    providers: {
      openai: provider("openai", async () => {
        orderedCalls.push("openai");
        throw new AIProviderError("OpenAI timed out.", "openai", true);
      }),
      nvidia: provider("nvidia", async () => {
        orderedCalls.push("nvidia");
        return providerResult({ ok: true }, 80, 15);
      })
    }
  });
  assert.deepEqual(orderedCalls, ["openai", "nvidia"], "the workflow must execute providers sequentially without duplicate calls");
  assert.equal(openAiToNvidiaFallback.provider, "nvidia", "NVIDIA may complete the workflow only after OpenAI fails with sufficient time remaining");
  assert.equal(openAiToNvidiaFallback.fallbackUsed, true, "a successful secondary NVIDIA attempt must be recorded as fallback");

  let skippedNvidiaCalls = 0;
  const insufficientSecondaryWindow = {
    deadlineAtMs: Date.now() + 10_500,
    providerTimeoutMs: { nvidia: 10_500, openai: 100 },
    minimumAttemptWindowMs: { nvidia: 5_000, openai: 50 },
    fallbackReserveMs: 0,
    transitionReserveMs: 0
  };
  await assert.rejects(
    runStructuredAI({
      ...request,
      providerPolicy: openAiFirstPolicy,
      settings: { ...request.settings, timeoutMs: 100, maxRetries: 0 },
      executionBudget: insufficientSecondaryWindow,
      providers: {
        openai: provider("openai", async () => {
          throw new AIProviderError("OpenAI timed out.", "openai", true);
        }),
        nvidia: provider("nvidia", async () => {
          skippedNvidiaCalls += 1;
          return providerResult({ ok: true }, 80, 15);
        })
      }
    }),
    (error) => {
      assert.ok(error instanceof AIProviderExecutionError, "an exhausted policy must retain provider attempt telemetry");
      assert.equal(error.attempts.at(-1).provider, "nvidia");
      assert.equal(error.attempts.at(-1).failureType, "deadline");
      return true;
    }
  );
  assert.equal(skippedNvidiaCalls, 0, "NVIDIA secondary must not begin without the policy's full meaningful window");

  const boundedWindow = resolveAIProviderAttemptWindow({
    budget: {
      deadlineAtMs: 30_000,
      providerTimeoutMs: { nvidia: 10_500, openai: 8_500 },
      minimumAttemptWindowMs: { nvidia: 5_000, openai: 5_000 },
      fallbackReserveMs: 8_500,
      transitionReserveMs: 250
    },
    provider: "nvidia",
    fallback: false,
    configuredTimeoutMs: 18_000,
    nowMs: 5_000
  });
  assert.equal(boundedWindow.timeoutMs, 10_500, "healthy preparation must leave the full NVIDIA workflow window");
  assert.equal(boundedWindow.reservedMs, 8_750, "the NVIDIA attempt must reserve OpenAI fallback and transition time");

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

  let lateOpenAiCalls = 0;
  const expiringBudget = {
    deadlineAtMs: Date.now() + 1_000,
    providerTimeoutMs: { nvidia: 500, openai: 500 },
    minimumAttemptWindowMs: { nvidia: 50, openai: 100 },
    fallbackReserveMs: 300,
    transitionReserveMs: 1
  };
  await assert.rejects(
    runStructuredAI({
      ...request,
      settings: { ...request.settings, timeoutMs: 500, maxRetries: 0 },
      executionBudget: expiringBudget,
      providers: {
        nvidia: provider("nvidia", async () => {
          expiringBudget.deadlineAtMs = Date.now() - 1;
          throw new AIProviderError("NVIDIA timed out.", "nvidia", true);
        }),
        openai: provider("openai", async () => {
          lateOpenAiCalls += 1;
          return providerResult({ ok: true }, 100, 20);
        })
      }
    }),
    (error) => {
      assert.ok(error instanceof AIProviderExecutionError, "deadline exhaustion must retain provider attempt telemetry");
      assert.equal(error.attempts.at(-1).provider, "openai", "the skipped fallback must remain visible in metadata");
      assert.equal(error.attempts.at(-1).failureType, "deadline", "the fallback skip must be distinguished from a provider timeout");
      return true;
    }
  );
  assert.equal(lateOpenAiCalls, 0, "OpenAI must not begin when the total workflow deadline cannot support a useful attempt");

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

  const originalConsoleError = console.error;
  const safeValidationLogs = [];
  console.error = (...args) => safeValidationLogs.push(args.map((value) => String(value)).join(" "));
  try {
    await assert.rejects(
      runStructuredAI({
        ...request,
        primaryProvider: "openai",
        generationMode: "interactive_executive",
        settings: { ...request.settings, maxRetries: 0 },
        systemPrompt: "PRIVATE_SYSTEM_PROMPT_MARKER",
        userContent: [{ type: "text", text: "PRIVATE_CUSTOMER_EVIDENCE_MARKER" }],
        providers: {
          nvidia: provider("nvidia", async () => providerResult({ ok: true }, 0, 0)),
          openai: provider("openai", async () => providerResult({ private_model_output: "PRIVATE_MODEL_OUTPUT_MARKER" }, 55, 21))
        },
        validate() {
          return {
            ok: false,
            reason: "synthetic validation failure",
            diagnostic: {
              reasonCode: "missing_required_signal",
              stage: "ranked_signal_coverage",
              expectedField: "analysis.findings[].signal_id",
              expectedType: "string",
              observedType: "array",
              expectedCount: 3,
              observedCount: 2,
              fieldPresent: true,
              truncationDetected: false
            }
          };
        },
        logContext: { workflow: "executive_intelligence", executionPath: "cross_business_reasoning" }
      }),
      (error) => {
        assert.ok(error instanceof AIProviderExecutionError, "invalid canonical output must retain safe provider telemetry");
        assert.equal(error.attempts[0].validationDiagnostic.reasonCode, "missing_required_signal");
        assert.equal(error.attempts[0].finishReason, "stop");
        return true;
      }
    );
  } finally {
    console.error = originalConsoleError;
  }
  const safeValidationLog = safeValidationLogs.join("\n");
  assert.match(safeValidationLog, /"validationReasonCode":"missing_required_signal"/, "interactive validation logs must include the safe reason code");
  assert.match(safeValidationLog, /"validationStage":"ranked_signal_coverage"/, "interactive validation logs must include the safe stage");
  assert.match(safeValidationLog, /"finishReason":"stop"/, "interactive validation logs must include finish metadata");
  assert.doesNotMatch(safeValidationLog, /PRIVATE_SYSTEM_PROMPT_MARKER|PRIVATE_CUSTOMER_EVIDENCE_MARKER|PRIVATE_MODEL_OUTPUT_MARKER/, "validation telemetry must never contain prompts, evidence, or model output");

  await assert.rejects(
    runStructuredAI({
      ...request,
      primaryProvider: "openai",
      generationMode: "interactive_executive",
      settings: { ...request.settings, maxRetries: 0 },
      providers: {
        nvidia: provider("nvidia", async () => providerResult({ ok: true }, 0, 0)),
        openai: provider("openai", async () => ({
          ...providerResult({ partial: true }, 40, 520),
          finishReason: "max_output_tokens",
          truncationDetected: true
        }))
      }
    }),
    (error) => {
      assert.ok(error instanceof AIProviderExecutionError, "truncated output must retain provider attempt metadata");
      assert.equal(error.attempts[0].validationDiagnostic.reasonCode, "unexpected_truncation");
      assert.equal(error.attempts[0].truncationDetected, true);
      return true;
    }
  );

  await assert.rejects(
    runStructuredAI({
      ...request,
      primaryProvider: "openai",
      generationMode: "interactive_executive",
      settings: { ...request.settings, maxRetries: 0 },
      providers: {
        nvidia: provider("nvidia", async () => providerResult({ ok: true }, 0, 0)),
        openai: provider("openai", async () => ({
          ...providerResult({ ignored: true }, 33, 8),
          content: "not-json PRIVATE_MODEL_OUTPUT_MARKER"
        }))
      }
    }),
    (error) => {
      assert.ok(error instanceof AIProviderExecutionError, "non-JSON output must retain provider attempt metadata");
      assert.equal(error.attempts[0].validationDiagnostic.reasonCode, "response_not_json");
      assert.equal(error.attempts[0].validationDiagnostic.stage, "json_parsing");
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
