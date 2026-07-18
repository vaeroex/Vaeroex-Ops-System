import "server-only";

import { getAIProviderRetrySettings, type AIProviderRetrySettings } from "@/lib/ai/provider-resilience";
import { resolveAIProviderAttemptWindow, type AIProviderExecutionBudget } from "@/lib/ai/providers/execution-budget";
import { OpenAIProvider } from "@/lib/ai/providers/openai-provider";
import { NvidiaProvider } from "@/lib/ai/providers/nvidia-provider";
import { AIProviderError, AIProviderPolicyError, type AIGenerationMode, type AIProvider, type AIProviderInputPart, type AIProviderName } from "@/lib/ai/providers/types";
import type { SafeAIValidationDiagnostic, StructuredOutputValidation } from "@/lib/ai/validation-diagnostics";

export const NVIDIA_NEMOTRON_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1.5";

export type { StructuredOutputValidation } from "@/lib/ai/validation-diagnostics";

export type AIProviderAttempt = {
  provider: AIProviderName;
  model: string;
  attempt: number;
  fallback: boolean;
  success: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  requestId: string | null;
  failureType: "transport" | "structured_output" | "unsupported_input" | "deadline" | null;
  finishReason: string | null;
  truncationDetected: boolean;
  validationDiagnostic: SafeAIValidationDiagnostic | null;
  timeoutBudgetMs?: number;
  deadlineRemainingMs?: number;
};

export type AIProviderRoutingPolicyStep = {
  provider: AIProviderName;
  model: string;
  minimumRemainingMs?: number;
};

export type AIProviderRoutingPolicy = {
  id: string;
  steps: AIProviderRoutingPolicyStep[];
};

export class AIProviderExecutionError extends Error {
  constructor(
    cause: unknown,
    readonly primaryProvider: AIProviderName,
    readonly attempts: AIProviderAttempt[]
  ) {
    super(cause instanceof Error ? cause.message : `${primaryProvider} provider failed.`, { cause });
    this.name = "AIProviderExecutionError";
  }
}

type ProviderRegistry = Record<AIProviderName, AIProvider>;

type RunStructuredAIRequest<T> = {
  primaryProvider: AIProviderName;
  primaryModel: string;
  fallbackModel: string;
  systemPrompt: string;
  userContent: AIProviderInputPart[];
  temperature?: number;
  generationMode?: AIGenerationMode;
  maxOutputTokens?: number;
  settings?: AIProviderRetrySettings;
  validate: (value: unknown) => StructuredOutputValidation<T>;
  providers?: ProviderRegistry;
  logContext?: { workflow?: string; modelRoute?: string; executionPath?: string; providerPolicyId?: string };
  executionBudget?: AIProviderExecutionBudget;
  providerPolicy?: AIProviderRoutingPolicy;
};

function providerRegistry(): ProviderRegistry {
  return { openai: new OpenAIProvider(), nvidia: new NvidiaProvider() };
}

function parseStructuredJson(content: string): unknown {
  const trimmed = content.trim();
  const withoutFence = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    : trimmed;
  return JSON.parse(withoutFence);
}

function isRetryable(error: unknown) {
  if (error instanceof AIProviderError) return error.retryable;
  return /timed out|timeout|aborterror|aborted|fetch failed|network/i.test(
    `${error instanceof Error ? error.name : ""} ${error instanceof Error ? error.message : ""}`
  );
}

function logAttempt(
  attempt: AIProviderAttempt,
  context: RunStructuredAIRequest<unknown>["logContext"],
  fallback: boolean,
  validationTelemetryEnabled: boolean
) {
  const diagnostic = validationTelemetryEnabled ? attempt.validationDiagnostic : null;
  const payload = {
    level: attempt.success ? "info" : "error",
    component: "vaeroex-ai-provider",
    event: attempt.success ? "request_succeeded" : "request_failed",
    provider: attempt.provider,
    model: attempt.model,
    latencyMs: attempt.latencyMs,
    success: attempt.success,
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    totalTokens: attempt.totalTokens,
    attempt: attempt.attempt,
    fallback,
    failureType: attempt.failureType,
    finishReason: attempt.finishReason,
    truncationDetected: attempt.truncationDetected,
    validationReasonCode: diagnostic?.reasonCode || null,
    validationStage: diagnostic?.stage || null,
    expectedField: diagnostic?.expectedField || null,
    expectedType: diagnostic?.expectedType || null,
    observedType: diagnostic?.observedType || null,
    expectedCount: diagnostic?.expectedCount ?? null,
    observedCount: diagnostic?.observedCount ?? null,
    fieldPresent: diagnostic?.fieldPresent ?? null,
    timeoutBudgetMs: attempt.timeoutBudgetMs ?? null,
    deadlineRemainingMs: Number.isFinite(attempt.deadlineRemainingMs) ? attempt.deadlineRemainingMs : null,
    workflow: context?.workflow || null,
    modelRoute: context?.modelRoute || null,
    executionPath: context?.executionPath || null,
    providerPolicyId: context?.providerPolicyId || null
  };
  const serialized = JSON.stringify(payload);
  if (attempt.success) console.log(serialized);
  else console.error(serialized);
}

function repairContent(parts: AIProviderInputPart[], reason: string): AIProviderInputPart[] {
  return [
    ...parts,
    {
      type: "text",
      text: `Your previous response did not satisfy the required JSON contract (${reason.slice(0, 180)}). Return one valid JSON object only. Do not add markdown fences, commentary, or fields outside the requested contract.`
    }
  ];
}

function settingsForProvider(provider: AIProviderName, override?: AIProviderRetrySettings) {
  const base = getAIProviderRetrySettings(provider);
  if (!override) return base;

  return {
    ...base,
    timeoutMs: Math.min(base.timeoutMs, override.timeoutMs),
    maxRetries: Math.min(base.maxRetries, override.maxRetries)
  };
}

async function waitBeforeRetry(settings: AIProviderRetrySettings, attemptNumber: number) {
  const delayMs = Math.min(settings.retryBaseDelayMs * 2 ** Math.max(0, attemptNumber - 1), 5_000);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runProvider<T>({
  provider,
  providerName,
  model,
  request,
  maxAttempts,
  fallback,
  attempts,
  minimumRemainingMs
}: {
  provider: AIProvider;
  providerName: AIProviderName;
  model: string;
  request: RunStructuredAIRequest<T>;
  maxAttempts: number;
  fallback: boolean;
  attempts: AIProviderAttempt[];
  minimumRemainingMs?: number;
}) {
  let lastError: unknown;
  let validationReason = "";
  const configuredProviderSettings = settingsForProvider(providerName, request.settings);
  const validationTelemetryEnabled = request.generationMode === "interactive_executive";

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const attemptWindow = resolveAIProviderAttemptWindow({
      budget: request.executionBudget,
      provider: providerName,
      fallback,
      configuredTimeoutMs: configuredProviderSettings.timeoutMs
    });
    const hasPolicyWindow = !Number.isFinite(attemptWindow.remainingMs) || attemptWindow.remainingMs >= Math.max(0, minimumRemainingMs || 0);
    if (!attemptWindow.canStart || !hasPolicyWindow) {
      const skippedAttempt: AIProviderAttempt = {
        provider: providerName,
        model,
        attempt: attemptNumber,
        fallback,
        success: false,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestId: null,
        failureType: "deadline",
        finishReason: null,
        truncationDetected: false,
        validationDiagnostic: null,
        timeoutBudgetMs: attemptWindow.timeoutMs,
        deadlineRemainingMs: attemptWindow.remainingMs
      };
      attempts.push(skippedAttempt);
      logAttempt(skippedAttempt, request.logContext, fallback, validationTelemetryEnabled);
      throw new AIProviderError(`${providerName} was skipped because the workflow deadline had insufficient time remaining.`, providerName, true);
    }
    const providerSettings = {
      ...configuredProviderSettings,
      timeoutMs: attemptWindow.timeoutMs
    };
    const startedAt = Date.now();
    try {
      const result = await provider.generate({
        model,
        systemPrompt: request.systemPrompt,
        userContent: validationReason ? repairContent(request.userContent, validationReason) : request.userContent,
        temperature: request.temperature ?? 0.2,
        generationMode: request.generationMode,
        maxOutputTokens: request.maxOutputTokens,
        settings: providerSettings
      });
      if (result.truncationDetected) {
        validationReason = "truncated response";
        const failedAttempt: AIProviderAttempt = {
          provider: providerName,
          model,
          attempt: attemptNumber,
          fallback,
          success: false,
          latencyMs: result.latencyMs,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          requestId: result.requestId,
          failureType: "structured_output",
          finishReason: result.finishReason,
          truncationDetected: true,
          validationDiagnostic: {
            reasonCode: "unexpected_truncation",
            stage: "canonical_schema",
            expectedField: "$",
            expectedType: "object",
            observedType: "string",
            truncationDetected: true
          },
          timeoutBudgetMs: attemptWindow.timeoutMs,
          deadlineRemainingMs: attemptWindow.remainingMs
        };
        attempts.push(failedAttempt);
        logAttempt(failedAttempt, request.logContext, fallback, validationTelemetryEnabled);
        lastError = new AIProviderError(`${providerName} returned a truncated response.`, providerName, true);
        if (attemptNumber < maxAttempts) await waitBeforeRetry(providerSettings, attemptNumber);
        continue;
      }
      let parsed: unknown;
      try {
        parsed = parseStructuredJson(result.content);
      } catch {
        validationReason = "malformed JSON";
        const failedAttempt: AIProviderAttempt = {
          provider: providerName,
          model,
          attempt: attemptNumber,
          fallback,
          success: false,
          latencyMs: result.latencyMs,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          requestId: result.requestId,
          failureType: "structured_output",
          finishReason: result.finishReason,
          truncationDetected: result.truncationDetected,
          validationDiagnostic: {
            reasonCode: "response_not_json",
            stage: "json_parsing",
            expectedField: "$",
            expectedType: "object",
            observedType: "string",
            truncationDetected: false
          },
          timeoutBudgetMs: attemptWindow.timeoutMs,
          deadlineRemainingMs: attemptWindow.remainingMs
        };
        attempts.push(failedAttempt);
        logAttempt(failedAttempt, request.logContext, fallback, validationTelemetryEnabled);
        lastError = new AIProviderError(`${providerName} returned malformed JSON.`, providerName, true);
        if (attemptNumber < maxAttempts) await waitBeforeRetry(providerSettings, attemptNumber);
        continue;
      }

      const validation = request.validate(parsed);
      if (!validation.ok) {
        validationReason = validation.reason;
        const failedAttempt: AIProviderAttempt = {
          provider: providerName,
          model,
          attempt: attemptNumber,
          fallback,
          success: false,
          latencyMs: result.latencyMs,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          requestId: result.requestId,
          failureType: "structured_output",
          finishReason: result.finishReason,
          truncationDetected: result.truncationDetected,
          validationDiagnostic: validation.diagnostic || {
            reasonCode: "unknown_validation_failure",
            stage: "contextual_validation",
            truncationDetected: false
          },
          timeoutBudgetMs: attemptWindow.timeoutMs,
          deadlineRemainingMs: attemptWindow.remainingMs
        };
        attempts.push(failedAttempt);
        logAttempt(failedAttempt, request.logContext, fallback, validationTelemetryEnabled);
        lastError = new AIProviderError(`${providerName} returned invalid structured output.`, providerName, true);
        if (attemptNumber < maxAttempts) await waitBeforeRetry(providerSettings, attemptNumber);
        continue;
      }

      const successfulAttempt: AIProviderAttempt = {
        provider: providerName,
        model,
        attempt: attemptNumber,
        fallback,
        success: true,
        latencyMs: result.latencyMs,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        requestId: result.requestId,
        failureType: null,
        finishReason: result.finishReason,
        truncationDetected: result.truncationDetected,
        validationDiagnostic: null,
        timeoutBudgetMs: attemptWindow.timeoutMs,
        deadlineRemainingMs: attemptWindow.remainingMs
      };
      attempts.push(successfulAttempt);
      logAttempt(successfulAttempt, request.logContext, fallback, validationTelemetryEnabled);
      return { value: validation.value, result, provider: providerName, model };
    } catch (error) {
      if (error instanceof AIProviderPolicyError) throw error;
      lastError = error;
      const unsupported = error instanceof AIProviderError && /attachment input/i.test(error.message);
      const failedAttempt: AIProviderAttempt = {
        provider: providerName,
        model,
        attempt: attemptNumber,
        fallback,
        success: false,
        latencyMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        requestId: null,
        failureType: unsupported ? "unsupported_input" : "transport",
        finishReason: null,
        truncationDetected: false,
        validationDiagnostic: null,
        timeoutBudgetMs: attemptWindow.timeoutMs,
        deadlineRemainingMs: attemptWindow.remainingMs
      };
      attempts.push(failedAttempt);
      logAttempt(failedAttempt, request.logContext, fallback, validationTelemetryEnabled);
      if (unsupported || !isRetryable(error)) break;
      if (attemptNumber < maxAttempts) await waitBeforeRetry(providerSettings, attemptNumber);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${providerName} provider failed.`);
}

export async function runStructuredAI<T>(request: RunStructuredAIRequest<T>) {
  const providers = request.providers || providerRegistry();
  const attempts: AIProviderAttempt[] = [];
  const policy: AIProviderRoutingPolicy = request.providerPolicy || {
    id: "legacy_configured_provider_order",
    steps: [
      { provider: request.primaryProvider, model: request.primaryModel },
      ...(request.primaryProvider === "nvidia" ? [{ provider: "openai" as const, model: request.fallbackModel }] : [])
    ]
  };
  if (!policy.steps.length || policy.steps.length > 2 || new Set(policy.steps.map((step) => step.provider)).size !== policy.steps.length) {
    throw new AIProviderPolicyError("The AI provider policy is invalid.");
  }
  const primaryProvider = policy.steps[0].provider;
  let finalResult: Awaited<ReturnType<typeof runProvider<T>>> | null = null;
  let finalError: unknown;
  let completed = false;

  for (const [index, step] of policy.steps.entries()) {
    const providerSettings = settingsForProvider(step.provider, request.settings);
    const maxAttempts = Math.max(1, Math.min(providerSettings.maxRetries + 1, 2));
    try {
      finalResult = await runProvider({
        provider: providers[step.provider],
        providerName: step.provider,
        model: step.model,
        request,
        maxAttempts,
        fallback: index > 0,
        attempts,
        minimumRemainingMs: step.minimumRemainingMs
      });
      completed = true;
      break;
    } catch (error) {
      if (error instanceof AIProviderPolicyError) throw error;
      finalError = error;
    }
  }

  if (!completed || !finalResult) {
    throw new AIProviderExecutionError(finalError, primaryProvider, attempts);
  }

  const aggregate = attempts.reduce(
    (sum, attempt) => ({
      inputTokens: sum.inputTokens + attempt.inputTokens,
      outputTokens: sum.outputTokens + attempt.outputTokens,
      totalTokens: sum.totalTokens + attempt.totalTokens,
      latencyMs: sum.latencyMs + attempt.latencyMs
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: 0 }
  );

  return {
    output: finalResult.value,
    provider: finalResult.provider,
    model: finalResult.model,
    requestId: finalResult.result.requestId,
    fallbackUsed: finalResult.provider !== primaryProvider,
    providerPolicyId: policy.id,
    attempts,
    ...aggregate
  };
}

export async function createAIEmbeddings(inputs: string[], timeoutMs?: number) {
  const provider = new OpenAIProvider();
  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small";
  const base = getAIProviderRetrySettings("openai");
  return provider.createEmbeddings(inputs, model, timeoutMs ? { ...base, timeoutMs: Math.min(base.timeoutMs, timeoutMs), maxRetries: 0 } : base);
}

export function getAIProviderRuntimeStatus() {
  const configured = (process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  const activeProvider: AIProviderName = configured === "nvidia" ? "nvidia" : "openai";
  const providers = providerRegistry();
  return {
    activeProvider,
    configuredValue: configured,
    configurationValid: configured === "openai" || configured === "nvidia" || configured === "",
    openaiConfigured: providers.openai.isConfigured(),
    nvidiaConfigured: providers.nvidia.isConfigured(),
    nvidiaModel: NVIDIA_NEMOTRON_MODEL,
    embeddingProvider: "openai" as const
  };
}
