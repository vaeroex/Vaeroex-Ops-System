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
    maxOutputTokens: Math.floor(numberSetting("VAEROEX_VSI_MAX_OUTPUT_TOKENS", 3_000, 1_000, 6_000)),
    maxWebSearchCalls: Math.floor(numberSetting("VAEROEX_VSI_MAX_WEB_SEARCH_CALLS", 2, 1, 2)), maxRetries: 0,
    timeoutMs: numberSetting("VAEROEX_VSI_TIMEOUT_MS", 65_000, 10_000, 90_000),
    // Separate from Executive Intelligence's allowance. Covers two bounded calls and two searches.
    requestReserveUsd: 0.10, workspaceMonthlyBudgetUsd: numberSetting("VAEROEX_VSI_WORKSPACE_MONTHLY_BUDGET_USD", 50, 1, 10_000) };
}
export function vsiEstimatedCost(usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; webSearchCalls: number }) {
  const cached = Math.min(usage.inputTokens, usage.cachedInputTokens);
  return ((usage.inputTokens - cached) * VSI_RATES.inputPerMillion + cached * VSI_RATES.cachedInputPerMillion
    + usage.outputTokens * VSI_RATES.outputPerMillion) / 1_000_000 + usage.webSearchCalls * VSI_RATES.webSearchCall;
}
