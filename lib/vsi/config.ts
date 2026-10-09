import type { VsiResearchTier } from "./research";
export const VSI_MODEL = "gpt-6-luna" as const;
export const VSI_COST_CATALOG = "openai-standard-2026-10-08";
// Official standard rates <=272k input: /api/docs/models/gpt-6-luna and /api/docs/pricing.
export const VSI_RATES = { inputPerMillion: 0.10, cachedInputPerMillion: 0.01, outputPerMillion: 0.50, webSearchCall: 0.01 } as const;
function numberSetting(name: string, fallback: number, min: number, max: number) {
  const value = Number(process.env[name] || "");
  return Number.isFinite(value) && value >= min ? Math.min(value, max) : fallback;
}
export function getVsiConfig() {
  return { maxInputChars: Math.floor(numberSetting("VAEROEX_VSI_MAX_INPUT_CHARS", 48_000, 32_000, 48_000)), maxQuestionChars: 8_000,
    maxOutputTokens: Math.floor(numberSetting("VAEROEX_VSI_MAX_OUTPUT_TOKENS", 4_000, 2_000, 6_000)),
    maxWebSearchCalls: Math.floor(numberSetting("VAEROEX_VSI_MAX_WEB_SEARCH_CALLS", 12, 2, 12)), maxRetries: 0,
    maxProviderCalls: 5, maxProviderInputBytes: 192_000, maxResearchRounds: 3,
    timeoutMs: numberSetting("VAEROEX_VSI_TIMEOUT_MS", 180_000, 60_000, 180_000),
    // Five bounded Luna calls, at most 12 chargeable searches; unrelated Executive Intelligence routing stays unchanged.
    requestReserveUsd: numberSetting("VAEROEX_VSI_REQUEST_RESERVE_USD", 0.25, 0.25, 1),
    workspaceMonthlyBudgetUsd: numberSetting("VAEROEX_VSI_WORKSPACE_MONTHLY_BUDGET_USD", 50, 1, 10_000) };
}
export function vsiResearchLimits(tier: VsiResearchTier) {
  const totalTools = Math.min(getVsiConfig().maxWebSearchCalls, tier === "deep" ? 12 : tier === "standard" ? 6 : 2);
  return { totalTools, rounds: tier === "simple" ? 2 : tier === "standard" ? 2 : 3,
    reasoning: tier === "deep" ? "high" as const : "medium" as const,
    maxOutputTokens: tier === "simple" ? 2500 : 4000 };
}
export function vsiEstimatedCost(usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; webSearchCalls: number }) {
  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens);
  return ((usage.inputTokens - cached) * VSI_RATES.inputPerMillion + cached * VSI_RATES.cachedInputPerMillion
    + usage.outputTokens * VSI_RATES.outputPerMillion) / 1_000_000 + usage.webSearchCalls * VSI_RATES.webSearchCall;
}
