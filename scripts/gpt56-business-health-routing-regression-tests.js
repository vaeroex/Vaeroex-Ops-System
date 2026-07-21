const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

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
  BUSINESS_HEALTH_GPT56_POLICY_ID,
  BUSINESS_HEALTH_GPT56_POLICY_SELECTOR,
  resolveBusinessHealthGenerationPolicy
} = require("../lib/ai/providers/workflow-provider-policy.ts");
const { AIProviderExecutionError, runStructuredAI } = require("../lib/ai/providers/provider-manager.ts");
const { OpenAIProvider } = require("../lib/ai/providers/openai-provider.ts");
const { resetAIProviderCircuitForTests } = require("../lib/ai/provider-resilience.ts");
const { estimatedProviderCostCents } = require("../lib/ai/usage.ts");
const { businessHealthProviderAttemptTelemetry } = require("../lib/ai/business-health-explanation/service.ts");
const { resolveBusinessHealthAnalysisStateFromRuns } = require("../lib/ai/business-health-explanation/storage.ts");

const strictOutput = {
  name: "business_health_explanation_v1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["ok"],
    properties: { ok: { type: "boolean" } }
  }
};

function resolvePolicy() {
  return resolveBusinessHealthGenerationPolicy({
    startedAtMs: Date.now(),
    structuredOutput: strictOutput
  });
}

function providerResult(content, model) {
  return {
    content: JSON.stringify(content),
    requestId: "PRIVATE_PROVIDER_REQUEST_ID",
    latencyMs: 8,
    finishReason: "completed",
    truncationDetected: false,
    runtimeModel: model,
    usage: {
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
      cachedInputTokens: 10,
      reasoningTokens: 5
    }
  };
}

function provider(name, generate) {
  return {
    name,
    supportsAttachments: name === "openai",
    isConfigured: () => true,
    generate
  };
}

function requestFor(policy, providers, validate) {
  const primary = policy.providerPolicy.steps[0];
  return {
    primaryProvider: primary.provider,
    primaryModel: primary.model,
    fallbackModel: "gpt-5.6-terra",
    providerPolicy: policy.providerPolicy,
    executionBudget: policy.executionBudget,
    systemPrompt: "PRIVATE_SYSTEM_PROMPT",
    userContent: [{ type: "text", text: "PRIVATE_CUSTOMER_EVIDENCE" }],
    generationMode: "interactive_executive",
    maxOutputTokens: policy.requestMaxOutputTokens,
    settings: {
      timeoutMs: 1_000,
      maxRetries: 0,
      retryBaseDelayMs: 1,
      circuitFailureThreshold: 50,
      circuitOpenMs: 10_000
    },
    providers,
    validate
  };
}

function validateOk(value) {
  return value && value.ok === true
    ? { ok: true, value }
    : {
        ok: false,
        reason: "Required signal missing.",
        diagnostic: {
          reasonCode: "missing_required_signal",
          stage: "ranked_signal_coverage",
          expectedField: "$",
          expectedType: "object",
          observedType: "object"
        }
      };
}

function policyGatingTests() {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalSelector = process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY;
  try {
    process.env.VERCEL_ENV = "preview";
    process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY = BUSINESS_HEALTH_GPT56_POLICY_SELECTOR;
    const selected = resolvePolicy();
    assert.equal(selected.providerPolicy.id, BUSINESS_HEALTH_GPT56_POLICY_ID);
    assert.deepEqual(selected.providerPolicy.steps.map((step) => [step.provider, step.model]), [
      ["openai", "gpt-5.6-sol"],
      ["openai", "gpt-5.6-terra"]
    ], "the exact Preview selector must permit a same-provider multi-model policy");
    assert.equal(selected.executionBudget.deadlineAtMs - Date.now() <= 90_000, true, "the selected workflow deadline must not exceed 90 seconds");
    assert.equal(selected.providerPolicy.steps[0].workflowConfiguration.reasoning.effort, "low");
    assert.equal(selected.providerPolicy.steps[1].workflowConfiguration.reasoning.effort, "medium");
    for (const step of selected.providerPolicy.steps) {
      assert.equal(step.workflowConfiguration.reasoning.mode, "standard");
      assert.equal(step.workflowConfiguration.timeoutMs, 30_000);
      assert.equal(step.workflowConfiguration.maxAttempts, 1);
      assert.equal(step.workflowConfiguration.maxOutputTokens, 2_500);
      assert.equal(step.workflowConfiguration.temperature, null);
      assert.equal(step.workflowConfiguration.topP, null);
      assert.equal(step.workflowConfiguration.store, false);
      assert.equal(step.workflowConfiguration.stream, false);
      assert.equal(step.workflowConfiguration.structuredOutput.strict, true);
    }

    delete process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY;
    assert.equal(resolvePolicy().providerPolicy.id, "business_health_preview_nvidia_primary_v1", "selector absence must preserve existing Preview routing");
    process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY = "invalid_policy";
    assert.equal(resolvePolicy().providerPolicy.id, "business_health_preview_nvidia_primary_v1", "an invalid selector must preserve existing Preview routing");
    process.env.VERCEL_ENV = "production";
    process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY = BUSINESS_HEALTH_GPT56_POLICY_SELECTOR;
    assert.equal(resolvePolicy().providerPolicy.id, "business_health_openai_primary_v1", "the selector must be ignored outside Preview");
  } finally {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
    if (originalSelector === undefined) delete process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY;
    else process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY = originalSelector;
  }
}

async function providerPolicyTests() {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalSelector = process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY;
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    process.env.VERCEL_ENV = "preview";
    process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY = BUSINESS_HEALTH_GPT56_POLICY_SELECTOR;

    const directCalls = [];
    const directPolicy = resolvePolicy();
    const direct = await runStructuredAI(requestFor(directPolicy, {
      openai: provider("openai", async (request) => {
        directCalls.push(request);
        return providerResult({ ok: true, wording: "Plain but valid." }, `${request.model}-runtime`);
      }),
      nvidia: provider("nvidia", async () => { throw new Error("NVIDIA must not be called."); })
    }, validateOk));
    assert.equal(directCalls.length, 1, "a valid Sol response, including stylistically plain wording, must not call Terra");
    assert.equal(directCalls[0].model, "gpt-5.6-sol");
    assert.equal(directCalls[0].temperature, undefined);
    assert.equal(directCalls[0].topP, undefined);
    assert.equal(direct.fallbackUsed, false);
    assert.equal(direct.model, "gpt-5.6-sol-runtime", "accepted attribution must use the exact runtime model");
    assert.equal(direct.attempts[0].attemptOrdinal, 1);
    assert.equal(direct.attempts[0].policyStep, 1);

    const fallbackCalls = [];
    const fallbackPolicy = resolvePolicy();
    const fallback = await runStructuredAI(requestFor(fallbackPolicy, {
      openai: provider("openai", async (request) => {
        fallbackCalls.push(request.model);
        return request.model === "gpt-5.6-sol"
          ? providerResult({ ok: false }, "gpt-5.6-sol-runtime")
          : providerResult({ ok: true }, "gpt-5.6-terra-runtime");
      }),
      nvidia: provider("nvidia", async () => { throw new Error("NVIDIA must not be called."); })
    }, validateOk));
    assert.deepEqual(fallbackCalls, ["gpt-5.6-sol", "gpt-5.6-terra"], "an allowed Sol validation failure must invoke Terra exactly once");
    assert.equal(fallback.fallbackUsed, true, "same-provider fallback must be derived from the accepted policy step");
    assert.equal(fallback.acceptedAttemptOrdinal, 2);
    assert.equal(fallback.model, "gpt-5.6-terra-runtime");
    assert.equal(fallback.attempts[0].fallbackReason, "missing_required_signal");
    assert.equal(fallback.attempts[1].role, "fallback");

    let forbiddenFallbackCalls = 0;
    const blockedPolicy = resolvePolicy();
    await assert.rejects(
      runStructuredAI(requestFor(blockedPolicy, {
        openai: provider("openai", async (request) => {
          if (request.model === "gpt-5.6-terra") forbiddenFallbackCalls += 1;
          return providerResult({ ok: false }, `${request.model}-runtime`);
        }),
        nvidia: provider("nvidia", async () => { throw new Error("NVIDIA must not be called."); })
      }, () => ({
        ok: false,
        reason: "Confidence wording was not accepted.",
        diagnostic: {
          reasonCode: "invalid_overall_confidence",
          stage: "confidence",
          expectedField: "$",
          expectedType: "object",
          observedType: "object"
        }
      }))),
      (error) => error instanceof AIProviderExecutionError
    );
    assert.equal(forbiddenFallbackCalls, 0, "a failure outside the explicit allowlist must not invoke Terra");
  } finally {
    console.log = originalLog;
    console.error = originalError;
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
    if (originalSelector === undefined) delete process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY;
    else process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY = originalSelector;
  }
}

async function openAIResponsesTests() {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const bodies = [];
  process.env.OPENAI_API_KEY = "test-key-not-a-secret";
  resetAIProviderCircuitForTests("openai");
  global.fetch = async (_input, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({
      model: "gpt-5.6-sol-runtime",
      output_text: "{\"ok\":true}",
      output: [{ type: "reasoning", content: [{ type: "reasoning_text", text: "PRIVATE_HIDDEN_REASONING" }] }],
      status: "completed",
      usage: {
        input_tokens: 80,
        output_tokens: 24,
        total_tokens: 104,
        input_tokens_details: { cached_tokens: 12 },
        output_tokens_details: { reasoning_tokens: 9 }
      }
    }), { status: 200, headers: { "x-request-id": "provider-request" } });
  };
  const settings = {
    timeoutMs: 1_000,
    maxRetries: 0,
    retryBaseDelayMs: 1,
    circuitFailureThreshold: 50,
    circuitOpenMs: 10_000
  };
  try {
    const provider = new OpenAIProvider();
    const result = await provider.generate({
      model: "gpt-5.6-sol",
      systemPrompt: "System contract",
      userContent: [{ type: "text", text: "Bounded facts" }],
      maxOutputTokens: 2_500,
      reasoning: { mode: "standard", effort: "low" },
      structuredOutput: strictOutput,
      store: false,
      stream: false,
      settings
    });
    assert.equal(bodies[0].model, "gpt-5.6-sol");
    assert.deepEqual(bodies[0].reasoning, { effort: "low" }, "standard reasoning must use the qualified Responses API representation");
    assert.equal(bodies[0].max_output_tokens, 2_500);
    assert.equal(bodies[0].store, false);
    assert.equal(bodies[0].stream, false);
    assert.equal(bodies[0].text.format.type, "json_schema");
    assert.equal(bodies[0].text.format.strict, true);
    assert.equal("temperature" in bodies[0], false);
    assert.equal("top_p" in bodies[0], false);
    assert.equal(result.runtimeModel, "gpt-5.6-sol-runtime");
    assert.equal(result.usage.reasoningTokens, 9);
    assert.equal(result.usage.cachedInputTokens, 12);
    assert.doesNotMatch(result.content, /PRIVATE_HIDDEN_REASONING/, "hidden reasoning must never enter the validated or persisted output path");

    await provider.generate({
      model: "gpt-4o-mini",
      systemPrompt: "Legacy system contract",
      userContent: [{ type: "text", text: "Legacy request" }],
      temperature: 0.2,
      maxOutputTokens: 400,
      settings
    });
    assert.equal(bodies[1].temperature, 0.2, "legacy OpenAI callers must retain their sampling setting");
    assert.equal(bodies[1].text.format.type, "json_object", "legacy OpenAI callers must retain their existing JSON mode");
    assert.equal("reasoning" in bodies[1], false);
    assert.equal("store" in bodies[1], false);
    assert.equal("stream" in bodies[1], false);
  } finally {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
    resetAIProviderCircuitForTests("openai");
  }
}

function storageAndTelemetryTests() {
  const currentFingerprint = "b".repeat(64);
  const oldFingerprint = "a".repeat(64);
  const facts = {
    available: true,
    score: 52,
    status: "Watch",
    trajectory: "Holding steady",
    comparison: "No material score movement.",
    comparisonDelta: 0,
    dataQualityBase: 60,
    riskPenalty: 12,
    opportunityAdjustment: 4,
    confidence: "Medium",
    freshness: "current",
    latestEvidenceAt: "2026-07-19T00:00:00.000Z",
    deterministicSummary: "Business Health is 52.",
    drivers: [],
    limitations: []
  };
  const oldArtifact = {
    contractId: "business_health_explanation_v1",
    contractVersion: "business_health_explanation_v1",
    validatorVersion: "business_health_explanation_validator_v1",
    fingerprint: oldFingerprint,
    generatedAt: "2026-07-19T00:00:00.000Z",
    analysis: {
      executive_interpretation: "The current score reflects the supplied deterministic drivers and remains bounded by the available evidence.",
      why_it_matters: "Leadership can use the established facts without treating the explanation as a new business fact.",
      leadership_consideration: "Review the validated drivers while preserving the stated evidence limitations.",
      provisional_hypothesis: null
    },
    facts,
    citations: [],
    providerAttribution: {
      provider: "openai",
      model: "gpt-5.6-sol-runtime",
      fallbackUsed: false,
      providerPolicyId: BUSINESS_HEALTH_GPT56_POLICY_ID
    }
  };
  const staleState = resolveBusinessHealthAnalysisStateFromRuns({
    runs: [
      {
        id: "failed-current",
        status: "failed",
        input_json: { fingerprint: currentFingerprint },
        output_json: {},
        error_message: "safe failure",
        created_at: "2026-07-20T00:00:00.000Z",
        updated_at: "2026-07-20T00:00:00.000Z"
      },
      {
        id: "completed-old",
        status: "completed",
        input_json: { fingerprint: oldFingerprint },
        output_json: oldArtifact,
        error_message: null,
        created_at: "2026-07-19T00:00:00.000Z",
        updated_at: "2026-07-19T00:00:00.000Z"
      }
    ],
    analysisPackage: { fingerprint: currentFingerprint, facts },
    requestTokenAvailable: true
  });
  assert.equal(staleState.status, "stale", "a two-model failure must preserve and expose the last valid artifact as stale");
  assert.equal(staleState.artifact.fingerprint, oldFingerprint);

  const currentArtifact = { ...oldArtifact, fingerprint: currentFingerprint };
  const currentState = resolveBusinessHealthAnalysisStateFromRuns({
    runs: [{
      id: "completed-current",
      status: "completed",
      input_json: { fingerprint: currentFingerprint },
      output_json: currentArtifact,
      error_message: null,
      created_at: "2026-07-20T00:00:00.000Z",
      updated_at: "2026-07-20T00:00:00.000Z"
    }],
    analysisPackage: { fingerprint: currentFingerprint, facts },
    requestTokenAvailable: true
  });
  assert.equal(currentState.status, "current", "an unchanged fingerprint must reopen the cached artifact immediately");
  assert.equal(currentState.artifact.fingerprint, currentFingerprint);

  const telemetry = businessHealthProviderAttemptTelemetry({
    provider: "openai",
    model: "gpt-5.6-sol",
    runtimeModel: "gpt-5.6-sol-runtime",
    attempt: 1,
    attemptOrdinal: 1,
    policyStep: 1,
    fallback: false,
    role: "primary",
    success: false,
    latencyMs: 30_000,
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    cachedInputTokens: 0,
    reasoningTokens: 10,
    estimatedCostCents: 1,
    requestId: "PRIVATE_PROVIDER_REQUEST_ID",
    failureType: "structured_output",
    fallbackReason: "contextual_validation_failure",
    finishReason: "completed",
    truncationDetected: false,
    validationDiagnostic: {
      reasonCode: "contextual_validation_failed",
      stage: "contextual_validation",
      expectedField: "$",
      expectedType: "object",
      observedType: "object"
    }
  });
  const serialized = JSON.stringify(telemetry);
  assert.doesNotMatch(serialized, /PRIVATE_PROVIDER_REQUEST_ID|PRIVATE_SYSTEM_PROMPT|PRIVATE_CUSTOMER_EVIDENCE/, "Business Health telemetry must remain content-free");
  assert.equal("requestId" in telemetry, false, "provider request IDs must not be persisted in Business Health telemetry");
  assert.equal(telemetry.validation_reason_code, "contextual_validation_failed");

  assert.equal(estimatedProviderCostCents({
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    totalTokens: 2_000_000,
    model: "gpt-5.6-terra",
    metadata: {
      provider_attempts: [
        { runtime_model: "gpt-5.6-sol", input_tokens: 1_000_000, output_tokens: 1_000_000 },
        { runtime_model: "gpt-5.6-terra", input_tokens: 1_000_000, output_tokens: 1_000_000 }
      ]
    }
  }), 5_250, "cost accounting must include both safe same-provider attempt records");
}

async function main() {
  policyGatingTests();
  await providerPolicyTests();
  await openAIResponsesTests();
  storageAndTelemetryTests();
  process.stdout.write("GPT-5.6 Business Health routing regressions passed.\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
