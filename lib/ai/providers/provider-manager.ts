import "server-only";

import { getAIProviderRetrySettings, type AIProviderRetrySettings } from "@/lib/ai/provider-resilience";
import { resolveAIProviderAttemptWindow, type AIProviderExecutionBudget } from "@/lib/ai/providers/execution-budget";
import { OpenAIProvider } from "@/lib/ai/providers/openai-provider";
import { NvidiaProvider } from "@/lib/ai/providers/nvidia-provider";
import {
  AIProviderError,
  AIProviderPolicyError,
  type AIGenerationMode,
  type AIProvider,
  type AIProviderInputPart,
  type AIProviderName,
  type AIProviderReasoning,
  type AIProviderStructuredOutput
} from "@/lib/ai/providers/types";
import { estimatedCostCents } from "@/lib/ai/usage";
import type { SafeAIValidationDiagnostic, StructuredOutputValidation } from "@/lib/ai/validation-diagnostics";

export const NVIDIA_NEMOTRON_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1.5";

export type { StructuredOutputValidation } from "@/lib/ai/validation-diagnostics";

export type AIProviderFallbackReason =
  | "timeout"
  | "transport_failure"
  | "empty_response"
  | "malformed_response"
  | "schema_failure"
  | "contextual_validation_failure"
  | "unsupported_inference"
  | "unsupported_relationship"
  | "missing_required_signal"
  | "citation_integrity_failure"
  | "numeric_integrity_failure";

export type AIProviderWorkflowConfiguration = Readonly<{
  timeoutMs?: number;
  maxAttempts?: number;
  maxOutputTokens?: number;
  temperature?: number | null;
  topP?: number | null;
  reasoning?: AIProviderReasoning;
  structuredOutput?: AIProviderStructuredOutput;
  store?: boolean;
  stream?: false;
}>;

export type AIProviderAttempt = {
  provider: AIProviderName;
  model: string;
  runtimeModel: string | null;
  attempt: number;
  attemptOrdinal: number;
  policyStep: number;
  fallback: boolean;
  role: "primary" | "fallback";
  success: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  estimatedCostCents: number;
  requestId: string | null;
  failureType: "transport" | "structured_output" | "unsupported_input" | "deadline" | null;
  fallbackReason: AIProviderFallbackReason | null;
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
  workflowConfiguration?: AIProviderWorkflowConfiguration;
};

export type AIProviderRoutingPolicy = {
  id: string;
  steps: AIProviderRoutingPolicyStep[];
  fallbackOn?: readonly AIProviderFallbackReason[];
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
    runtimeModel: attempt.runtimeModel,
    latencyMs: attempt.latencyMs,
    success: attempt.success,
    inputTokens: attempt.inputTokens,
    outputTokens: attempt.outputTokens,
    totalTokens: attempt.totalTokens,
    cachedInputTokens: attempt.cachedInputTokens,
    reasoningTokens: attempt.reasoningTokens,
    estimatedCostCents: attempt.estimatedCostCents,
    attempt: attempt.attempt,
    attemptOrdinal: attempt.attemptOrdinal,
    policyStep: attempt.policyStep,
    role: attempt.role,
    fallback,
    failureType: attempt.failureType,
    fallbackReason: attempt.fallbackReason,
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

function settingsForPolicyStep(
  provider: AIProviderName,
  override: AIProviderRetrySettings | undefined,
  workflowConfiguration: AIProviderWorkflowConfiguration | undefined
) {
  const inherited = settingsForProvider(provider, override);
  if (!workflowConfiguration?.timeoutMs) return inherited;

  return {
    ...inherited,
    timeoutMs: Math.min(Math.max(Math.floor(workflowConfiguration.timeoutMs), 1), 120_000),
    maxRetries: 0
  };
}

function requestNumber(
  workflowConfiguration: AIProviderWorkflowConfiguration | undefined,
  key: "temperature" | "topP",
  inherited: number | undefined
) {
  if (workflowConfiguration && Object.prototype.hasOwnProperty.call(workflowConfiguration, key)) {
    return workflowConfiguration[key] ?? undefined;
  }
  return inherited;
}

function validationFallbackReason(diagnostic: SafeAIValidationDiagnostic | null): AIProviderFallbackReason | null {
  if (!diagnostic) return null;
  if (diagnostic.reasonCode === "unsupported_inference") return "unsupported_inference";
  if (diagnostic.reasonCode === "unsupported_relationship") return "unsupported_relationship";
  if (diagnostic.reasonCode === "missing_required_signal") return "missing_required_signal";
  if (diagnostic.reasonCode === "invalid_citation_id" || diagnostic.stage === "citation_provenance") {
    return "citation_integrity_failure";
  }
  if (diagnostic.reasonCode === "numeric_integrity_failed" || diagnostic.stage === "numeric_integrity") {
    return "numeric_integrity_failure";
  }
  if (diagnostic.reasonCode === "contextual_validation_failed" || diagnostic.stage === "contextual_validation") {
    return "contextual_validation_failure";
  }
  if (diagnostic.stage === "canonical_schema") return "schema_failure";
  return null;
}

function transportFallbackReason(error: unknown): AIProviderFallbackReason | null {
  if (error instanceof AIProviderError) {
    if (error.code === "empty_response") return "empty_response";
    if (error.code === "transport_failure") return "transport_failure";
    if (error.code === "configuration" || error.code === "refusal" || error.code === "unsupported_input") return null;
  }
  const description = `${error instanceof Error ? error.name : ""} ${error instanceof Error ? error.message : ""}`;
  if (/timed out|timeout|aborterror|aborted/i.test(description)) return "timeout";
  if (/empty response/i.test(description)) return "empty_response";
  return "transport_failure";
}

function attemptCost(model: string, inputTokens: number, outputTokens: number) {
  return estimatedCostCents({ model, inputTokens, outputTokens });
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
  minimumRemainingMs,
  policyStep,
  workflowConfiguration
}: {
  provider: AIProvider;
  providerName: AIProviderName;
  model: string;
  request: RunStructuredAIRequest<T>;
  maxAttempts: number;
  fallback: boolean;
  attempts: AIProviderAttempt[];
  minimumRemainingMs?: number;
  policyStep: number;
  workflowConfiguration?: AIProviderWorkflowConfiguration;
}) {
  let lastError: unknown;
  let validationReason = "";
  const configuredProviderSettings = settingsForPolicyStep(providerName, request.settings, workflowConfiguration);
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
        runtimeModel: null,
        attempt: attemptNumber,
        attemptOrdinal: attempts.length + 1,
        policyStep,
        fallback,
        role: fallback ? "fallback" : "primary",
        success: false,
        latencyMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        estimatedCostCents: 0,
        requestId: null,
        failureType: "deadline",
        fallbackReason: null,
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
        temperature: requestNumber(workflowConfiguration, "temperature", request.temperature ?? 0.2),
        topP: requestNumber(workflowConfiguration, "topP", undefined),
        generationMode: request.generationMode,
        maxOutputTokens: workflowConfiguration?.maxOutputTokens ?? request.maxOutputTokens,
        reasoning: workflowConfiguration?.reasoning,
        structuredOutput: workflowConfiguration?.structuredOutput,
        store: workflowConfiguration?.store,
        stream: workflowConfiguration?.stream,
        settings: providerSettings
      });
      if (result.truncationDetected) {
        validationReason = "truncated response";
        const failedAttempt: AIProviderAttempt = {
          provider: providerName,
          model,
          runtimeModel: result.runtimeModel || model,
          attempt: attemptNumber,
          attemptOrdinal: attempts.length + 1,
          policyStep,
          fallback,
          role: fallback ? "fallback" : "primary",
          success: false,
          latencyMs: result.latencyMs,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          cachedInputTokens: result.usage.cachedInputTokens || 0,
          reasoningTokens: result.usage.reasoningTokens || 0,
          estimatedCostCents: attemptCost(result.runtimeModel || model, result.usage.inputTokens, result.usage.outputTokens),
          requestId: result.requestId,
          failureType: "structured_output",
          fallbackReason: "malformed_response",
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
          runtimeModel: result.runtimeModel || model,
          attempt: attemptNumber,
          attemptOrdinal: attempts.length + 1,
          policyStep,
          fallback,
          role: fallback ? "fallback" : "primary",
          success: false,
          latencyMs: result.latencyMs,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          cachedInputTokens: result.usage.cachedInputTokens || 0,
          reasoningTokens: result.usage.reasoningTokens || 0,
          estimatedCostCents: attemptCost(result.runtimeModel || model, result.usage.inputTokens, result.usage.outputTokens),
          requestId: result.requestId,
          failureType: "structured_output",
          fallbackReason: "malformed_response",
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
        const diagnostic = validation.diagnostic || {
          reasonCode: "unknown_validation_failure" as const,
          stage: "contextual_validation" as const,
          truncationDetected: false
        };
        const failedAttempt: AIProviderAttempt = {
          provider: providerName,
          model,
          runtimeModel: result.runtimeModel || model,
          attempt: attemptNumber,
          attemptOrdinal: attempts.length + 1,
          policyStep,
          fallback,
          role: fallback ? "fallback" : "primary",
          success: false,
          latencyMs: result.latencyMs,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
          cachedInputTokens: result.usage.cachedInputTokens || 0,
          reasoningTokens: result.usage.reasoningTokens || 0,
          estimatedCostCents: attemptCost(result.runtimeModel || model, result.usage.inputTokens, result.usage.outputTokens),
          requestId: result.requestId,
          failureType: "structured_output",
          fallbackReason: validationFallbackReason(diagnostic),
          finishReason: result.finishReason,
          truncationDetected: result.truncationDetected,
          validationDiagnostic: diagnostic,
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
        runtimeModel: result.runtimeModel || model,
        attempt: attemptNumber,
        attemptOrdinal: attempts.length + 1,
        policyStep,
        fallback,
        role: fallback ? "fallback" : "primary",
        success: true,
        latencyMs: result.latencyMs,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        cachedInputTokens: result.usage.cachedInputTokens || 0,
        reasoningTokens: result.usage.reasoningTokens || 0,
        estimatedCostCents: attemptCost(result.runtimeModel || model, result.usage.inputTokens, result.usage.outputTokens),
        requestId: result.requestId,
        failureType: null,
        fallbackReason: null,
        finishReason: result.finishReason,
        truncationDetected: result.truncationDetected,
        validationDiagnostic: null,
        timeoutBudgetMs: attemptWindow.timeoutMs,
        deadlineRemainingMs: attemptWindow.remainingMs
      };
      attempts.push(successfulAttempt);
      logAttempt(successfulAttempt, request.logContext, fallback, validationTelemetryEnabled);
      return { value: validation.value, result, provider: providerName, model: result.runtimeModel || model, policyStep };
    } catch (error) {
      if (error instanceof AIProviderPolicyError) throw error;
      lastError = error;
      const unsupported = error instanceof AIProviderError && /attachment input/i.test(error.message);
      const failedAttempt: AIProviderAttempt = {
        provider: providerName,
        model,
        runtimeModel: null,
        attempt: attemptNumber,
        attemptOrdinal: attempts.length + 1,
        policyStep,
        fallback,
        role: fallback ? "fallback" : "primary",
        success: false,
        latencyMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        estimatedCostCents: 0,
        requestId: null,
        failureType: unsupported ? "unsupported_input" : "transport",
        fallbackReason: unsupported ? null : transportFallbackReason(error),
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
  if (
    !policy.steps.length ||
    policy.steps.length > 2 ||
    policy.steps.some((step) => !step.model.trim()) ||
    policy.steps.some((step) => {
      const maxAttempts = step.workflowConfiguration?.maxAttempts;
      return maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 2);
    })
  ) {
    throw new AIProviderPolicyError("The AI provider policy is invalid.");
  }
  const primaryProvider = policy.steps[0].provider;
  let finalResult: Awaited<ReturnType<typeof runProvider<T>>> | null = null;
  let finalError: unknown;
  let completed = false;

  for (const [index, step] of policy.steps.entries()) {
    const providerSettings = settingsForPolicyStep(step.provider, request.settings, step.workflowConfiguration);
    const maxAttempts = step.workflowConfiguration?.maxAttempts
      ?? Math.max(1, Math.min(providerSettings.maxRetries + 1, 2));
    try {
      finalResult = await runProvider({
        provider: providers[step.provider],
        providerName: step.provider,
        model: step.model,
        request,
        maxAttempts,
        fallback: index > 0,
        attempts,
        minimumRemainingMs: step.minimumRemainingMs,
        policyStep: index + 1,
        workflowConfiguration: step.workflowConfiguration
      });
      completed = true;
      break;
    } catch (error) {
      if (error instanceof AIProviderPolicyError) throw error;
      finalError = error;
      const latestAttempt = attempts.at(-1);
      const mayUseConfiguredFallback = index < policy.steps.length - 1 && (
        !policy.fallbackOn || Boolean(latestAttempt?.fallbackReason && policy.fallbackOn.includes(latestAttempt.fallbackReason))
      );
      if (!mayUseConfiguredFallback) break;
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
      cachedInputTokens: sum.cachedInputTokens + attempt.cachedInputTokens,
      reasoningTokens: sum.reasoningTokens + attempt.reasoningTokens,
      estimatedCostCents: sum.estimatedCostCents + attempt.estimatedCostCents,
      latencyMs: sum.latencyMs + attempt.latencyMs
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      estimatedCostCents: 0,
      latencyMs: 0
    }
  );

  return {
    output: finalResult.value,
    provider: finalResult.provider,
    model: finalResult.model,
    requestId: finalResult.result.requestId,
    fallbackUsed: finalResult.policyStep > 1,
    acceptedAttemptOrdinal: attempts.find((attempt) => attempt.success)?.attemptOrdinal || null,
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
