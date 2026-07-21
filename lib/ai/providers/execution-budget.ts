import type { AIProviderName } from "@/lib/ai/providers/types";

export type AIProviderExecutionBudget = {
  deadlineAtMs: number;
  providerTimeoutMs: Partial<Record<AIProviderName, number>>;
  minimumAttemptWindowMs: Partial<Record<AIProviderName, number>>;
  fallbackReserveMs: number;
  reserveFallbackForPrimary?: boolean;
  transitionReserveMs?: number;
};

export type AIProviderAttemptWindow = {
  canStart: boolean;
  timeoutMs: number;
  remainingMs: number;
  reservedMs: number;
};

export function resolveAIProviderAttemptWindow({
  budget,
  provider,
  fallback,
  configuredTimeoutMs,
  nowMs = Date.now()
}: {
  budget?: AIProviderExecutionBudget;
  provider: AIProviderName;
  fallback: boolean;
  configuredTimeoutMs: number;
  nowMs?: number;
}): AIProviderAttemptWindow {
  if (!budget) {
    return {
      canStart: true,
      timeoutMs: configuredTimeoutMs,
      remainingMs: Number.POSITIVE_INFINITY,
      reservedMs: 0
    };
  }

  const remainingMs = Math.max(0, Math.floor(budget.deadlineAtMs - nowMs));
  const transitionReserveMs = Math.max(0, Math.floor(budget.transitionReserveMs || 0));
  const fallbackReserveMs = !fallback && (provider === "nvidia" || budget.reserveFallbackForPrimary === true)
    ? Math.max(0, Math.floor(budget.fallbackReserveMs))
    : 0;
  const reservedMs = transitionReserveMs + fallbackReserveMs;
  const availableMs = Math.max(0, remainingMs - reservedMs);
  const desiredTimeoutMs = Math.max(1, Math.floor(budget.providerTimeoutMs[provider] || configuredTimeoutMs));
  const timeoutMs = Math.max(0, Math.min(configuredTimeoutMs, desiredTimeoutMs, availableMs));
  const minimumAttemptWindowMs = Math.max(1, Math.floor(budget.minimumAttemptWindowMs[provider] || 1));

  return {
    canStart: timeoutMs >= minimumAttemptWindowMs,
    timeoutMs,
    remainingMs,
    reservedMs
  };
}
