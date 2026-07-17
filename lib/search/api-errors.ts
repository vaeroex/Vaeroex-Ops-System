const DEFAULT_SEARCH_ASK_ERROR = "Vaeroex could not answer that question right now.";
const SEARCH_ASK_TIMEOUT_ERROR = "The analysis took too long. Please try again.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function globalSearchApiErrorMessage(status: number, payload: unknown) {
  if (status === 408 || status === 504) return SEARCH_ASK_TIMEOUT_ERROR;
  if (status >= 500) return DEFAULT_SEARCH_ASK_ERROR;

  if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
    return payload.error.trim().slice(0, 240);
  }

  return DEFAULT_SEARCH_ASK_ERROR;
}
