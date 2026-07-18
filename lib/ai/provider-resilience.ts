import "server-only";

import type { AIProviderName } from "@/lib/ai/providers/types";

export type AIProviderRetrySettings = {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
  circuitFailureThreshold: number;
  circuitOpenMs: number;
};

type CircuitState = {
  failureCount: number;
  openedUntil: number;
};

const DEFAULT_SETTINGS: AIProviderRetrySettings = {
  timeoutMs: 18_000,
  maxRetries: 1,
  retryBaseDelayMs: 750,
  circuitFailureThreshold: 5,
  circuitOpenMs: 60_000
};

const circuitStates: Record<AIProviderName, CircuitState> = {
  openai: { failureCount: 0, openedUntil: 0 },
  nvidia: { failureCount: 0, openedUntil: 0 }
};

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback;
}

function providerPrefix(provider: AIProviderName) {
  return provider === "nvidia" ? "VAEROEX_NVIDIA" : "VAEROEX_OPENAI";
}

export function getAIProviderRetrySettings(
  provider: AIProviderName = process.env.AI_PROVIDER?.trim().toLowerCase() === "nvidia" ? "nvidia" : "openai"
): AIProviderRetrySettings {
  const prefix = providerPrefix(provider);

  return {
    timeoutMs: numberEnv(`${prefix}_TIMEOUT_MS`, DEFAULT_SETTINGS.timeoutMs, 5_000, 120_000),
    maxRetries: numberEnv(`${prefix}_MAX_RETRIES`, DEFAULT_SETTINGS.maxRetries, 0, 4),
    retryBaseDelayMs: numberEnv(`${prefix}_RETRY_BASE_DELAY_MS`, DEFAULT_SETTINGS.retryBaseDelayMs, 100, 5_000),
    circuitFailureThreshold: numberEnv(`${prefix}_CIRCUIT_FAILURE_THRESHOLD`, DEFAULT_SETTINGS.circuitFailureThreshold, 2, 50),
    circuitOpenMs: numberEnv(`${prefix}_CIRCUIT_OPEN_MS`, DEFAULT_SETTINGS.circuitOpenMs, 10_000, 10 * 60_000)
  };
}

export function isRetryableAIProviderStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function getAIProviderCircuitSnapshot(provider: AIProviderName, nowMs = Date.now()) {
  const state = circuitStates[provider];
  return {
    failureCount: state.failureCount,
    openedUntil: state.openedUntil,
    open: state.openedUntil > nowMs
  };
}

export function assertAIProviderCircuitClosed(provider: AIProviderName, nowMs = Date.now()) {
  const snapshot = getAIProviderCircuitSnapshot(provider, nowMs);
  if (snapshot.open) {
    const seconds = Math.max(1, Math.ceil((snapshot.openedUntil - nowMs) / 1000));
    throw new Error(`Vaeroex intelligence is temporarily unavailable after repeated provider failures. Try again in about ${seconds} seconds.`);
  }
}

export function recordAIProviderSuccess(provider: AIProviderName) {
  circuitStates[provider] = { failureCount: 0, openedUntil: 0 };
}

export function recordAIProviderFailure(provider: AIProviderName, settings = getAIProviderRetrySettings(provider), nowMs = Date.now()) {
  const state = circuitStates[provider];
  state.failureCount += 1;
  if (state.failureCount >= settings.circuitFailureThreshold) state.openedUntil = nowMs + settings.circuitOpenMs;
}

export function resetAIProviderCircuitForTests(provider?: AIProviderName) {
  const providers: AIProviderName[] = provider ? [provider] : ["openai", "nvidia"];
  providers.forEach((name) => {
    circuitStates[name] = { failureCount: 0, openedUntil: 0 };
  });
}

function timeoutError(provider: AIProviderName, timeoutMs: number) {
  const error = new Error(`${provider} request timed out after ${timeoutMs}ms.`);
  error.name = "AbortError";
  return error;
}

export async function consumeAIProviderResponse<T>(
  provider: AIProviderName,
  input: RequestInfo | URL,
  init: RequestInit,
  consume: (response: Response) => Promise<T>,
  settings = getAIProviderRetrySettings(provider)
) {
  assertAIProviderCircuitClosed(provider);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(timeoutError(provider, settings.timeoutMs)), settings.timeoutMs);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const value = await consume(response);
    if (response.ok) recordAIProviderSuccess(provider);
    else if (isRetryableAIProviderStatus(response.status)) recordAIProviderFailure(provider, settings);
    return { response, value };
  } catch (error) {
    recordAIProviderFailure(provider, settings);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
