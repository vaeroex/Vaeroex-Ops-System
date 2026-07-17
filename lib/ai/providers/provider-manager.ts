import "server-only";

import { getAIProviderRetrySettings, type AIProviderRetrySettings } from "@/lib/ai/provider-resilience";
import { resolveAIProviderAttemptWindow, type AIProviderExecutionBudget } from "@/lib/ai/providers/execution-budget";
import { OpenAIProvider } from "@/lib/ai/providers/openai-provider";
import { NvidiaProvider } from "@/lib/ai/providers/nvidia-provider";
import { AIProviderError, AIProviderPolicyError, type AIProvider, type AIProviderInputPart, type AIProviderName } from "@/lib/ai/providers/types";

export const NVIDIA_NEMOTRON_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1.5";

export type StructuredOutputValidation<T> = { ok: true; value: T } | { ok: false; reason: string };

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
  timeoutBudgetMs?: number;
  deadlineRemainingMs?: number;
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
  maxOutputTokens?: number;
  settings?: AIProviderRetrySettings;
  validate: (value: unknown) => StructuredOutputValidation<T>;
  providers?: ProviderRegistry;
  logContext?: { workflow?: string; modelRoute?: string; executionPath?: string };
  executionBudget?: AIProviderExecutionBudget;
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

function logAttempt(attempt: AIProviderAttempt, context: RunStructuredAIRequest<unknown>["logContext"], fallback: boolean) {
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
    timeoutBudgetMs: attempt.timeoutBudgetMs ?? null,
    deadlineRemainingMs: Number.isFinite(attempt.deadlineRemainingMs) ? attempt.deadlineRemainingMs : null,
    workflow: context?.workflow || null,
    modelRoute: context?.modelRoute || null,
    executionPath: context?.executionPath || null
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
  attempts
}: {
  provider: AIProvider;
  providerName: AIProviderName;
  model: string;
  request: RunStructuredAIRequest<T>;
  maxAttempts: number;
  fallback: boolean;
  attempts: AIProviderAttempt[];
}) {
  let lastError: unknown;
  let validationReason = "";
  const configuredProviderSettings = settingsForProvider(providerName, request.settings);

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const attemptWindow = resolveAIProviderAttemptWindow({
      budget: request.executionBudget,
      provider: providerName,
      fallback,
      configuredTimeoutMs: configuredProviderSettings.timeoutMs
    });
    if (!attemptWindow.canStart) {
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
        timeoutBudgetMs: attemptWindow.timeoutMs,
        deadlineRemainingMs: attemptWindow.remainingMs
      };
      attempts.push(skippedAttempt);
      logAttempt(skippedAttempt, request.logContext, fallback);
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
        maxOutputTokens: request.maxOutputTokens,
        settings: providerSettings
      });
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
          timeoutBudgetMs: attemptWindow.timeoutMs,
          deadlineRemainingMs: attemptWindow.remainingMs
        };
        attempts.push(failedAttempt);
        logAttempt(failedAttempt, request.logContext, fallback);
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
          timeoutBudgetMs: attemptWindow.timeoutMs,
          deadlineRemainingMs: attemptWindow.remainingMs
        };
        attempts.push(failedAttempt);
        logAttempt(failedAttempt, request.logContext, fallback);
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
        timeoutBudgetMs: attemptWindow.timeoutMs,
        deadlineRemainingMs: attemptWindow.remainingMs
      };
      attempts.push(successfulAttempt);
      logAttempt(successfulAttempt, request.logContext, fallback);
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
        timeoutBudgetMs: attemptWindow.timeoutMs,
        deadlineRemainingMs: attemptWindow.remainingMs
      };
      attempts.push(failedAttempt);
      logAttempt(failedAttempt, request.logContext, fallback);
      if (unsupported || !isRetryable(error)) break;
      if (attemptNumber < maxAttempts) await waitBeforeRetry(providerSettings, attemptNumber);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${providerName} provider failed.`);
}

export async function runStructuredAI<T>(request: RunStructuredAIRequest<T>) {
  const providers = request.providers || providerRegistry();
  const attempts: AIProviderAttempt[] = [];
  const settings = settingsForProvider(request.primaryProvider, request.settings);
  const primaryMaxAttempts = Math.max(1, Math.min(settings.maxRetries + 1, 2));
  let finalResult: Awaited<ReturnType<typeof runProvider<T>>>;

  try {
    finalResult = await runProvider({
      provider: providers[request.primaryProvider],
      providerName: request.primaryProvider,
      model: request.primaryModel,
      request,
      maxAttempts: primaryMaxAttempts,
      fallback: false,
      attempts
    });
  } catch (primaryError) {
    if (primaryError instanceof AIProviderPolicyError) throw primaryError;
    if (request.primaryProvider !== "nvidia") {
      throw new AIProviderExecutionError(primaryError, request.primaryProvider, attempts);
    }

    const fallbackSettings = settingsForProvider("openai", request.settings);
    const fallbackMaxAttempts = Math.max(1, Math.min(fallbackSettings.maxRetries + 1, 2));

    try {
      finalResult = await runProvider({
        provider: providers.openai,
        providerName: "openai",
        model: request.fallbackModel,
        request,
        maxAttempts: fallbackMaxAttempts,
        fallback: true,
        attempts
      });
    } catch (fallbackError) {
      if (fallbackError instanceof AIProviderPolicyError) throw fallbackError;
      throw new AIProviderExecutionError(fallbackError, request.primaryProvider, attempts);
    }
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
    fallbackUsed: finalResult.provider !== request.primaryProvider,
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
