import "server-only";

export type OpenAIRetrySettings = {
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

const DEFAULT_SETTINGS: OpenAIRetrySettings = {
  timeoutMs: 18_000,
  maxRetries: 1,
  retryBaseDelayMs: 750,
  circuitFailureThreshold: 5,
  circuitOpenMs: 60_000
};

const circuitState: CircuitState = {
  failureCount: 0,
  openedUntil: 0
};

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const value = Number.parseInt(process.env[name] || "", 10);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(Math.max(value, min), max);
}

export function getOpenAIRetrySettings(): OpenAIRetrySettings {
  return {
    timeoutMs: numberEnv("VAEROEX_OPENAI_TIMEOUT_MS", DEFAULT_SETTINGS.timeoutMs, 5_000, 120_000),
    maxRetries: numberEnv("VAEROEX_OPENAI_MAX_RETRIES", DEFAULT_SETTINGS.maxRetries, 0, 4),
    retryBaseDelayMs: numberEnv("VAEROEX_OPENAI_RETRY_BASE_DELAY_MS", DEFAULT_SETTINGS.retryBaseDelayMs, 100, 5_000),
    circuitFailureThreshold: numberEnv(
      "VAEROEX_OPENAI_CIRCUIT_FAILURE_THRESHOLD",
      DEFAULT_SETTINGS.circuitFailureThreshold,
      2,
      50
    ),
    circuitOpenMs: numberEnv("VAEROEX_OPENAI_CIRCUIT_OPEN_MS", DEFAULT_SETTINGS.circuitOpenMs, 10_000, 10 * 60_000)
  };
}

export function isRetryableOpenAIStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function getOpenAICircuitSnapshot(nowMs = Date.now()) {
  return {
    failureCount: circuitState.failureCount,
    openedUntil: circuitState.openedUntil,
    open: circuitState.openedUntil > nowMs
  };
}

export function assertOpenAICircuitClosed(nowMs = Date.now()) {
  const snapshot = getOpenAICircuitSnapshot(nowMs);

  if (snapshot.open) {
    const seconds = Math.max(1, Math.ceil((snapshot.openedUntil - nowMs) / 1000));
    throw new Error(`Vaeroex intelligence is temporarily unavailable after repeated provider failures. Try again in about ${seconds} seconds.`);
  }
}

export function recordOpenAISuccess() {
  circuitState.failureCount = 0;
  circuitState.openedUntil = 0;
}

export function recordOpenAIFailure(settings = getOpenAIRetrySettings(), nowMs = Date.now()) {
  circuitState.failureCount += 1;

  if (circuitState.failureCount >= settings.circuitFailureThreshold) {
    circuitState.openedUntil = nowMs + settings.circuitOpenMs;
  }
}

export function resetOpenAICircuitForTests() {
  circuitState.failureCount = 0;
  circuitState.openedUntil = 0;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt: number, settings: OpenAIRetrySettings) {
  return Math.min(settings.retryBaseDelayMs * 2 ** Math.max(0, attempt - 1), 8_000);
}

function timeoutError(timeoutMs: number) {
  const error = new Error(`OpenAI request timed out after ${timeoutMs}ms.`);
  error.name = "AbortError";
  return error;
}

export async function fetchWithOpenAIResilience(
  input: RequestInfo | URL,
  init: RequestInit,
  settings = getOpenAIRetrySettings()
) {
  assertOpenAICircuitClosed();

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= settings.maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(timeoutError(settings.timeoutMs)), settings.timeoutMs);

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!isRetryableOpenAIStatus(response.status)) {
        if (response.ok) {
          recordOpenAISuccess();
        }

        return response;
      }

      if (attempt >= settings.maxRetries) {
        recordOpenAIFailure(settings);
        return response;
      }
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;

      if (attempt >= settings.maxRetries) {
        recordOpenAIFailure(settings);
        throw error;
      }
    }

    await sleep(retryDelay(attempt + 1, settings));
  }

  recordOpenAIFailure(settings);
  throw lastError instanceof Error ? lastError : new Error("OpenAI request failed.");
}
