import { QBO_ERROR_POLICY_VERSION } from "@/lib/integrations/providers/qbo/contracts";

type JsonRecord = Record<string, unknown>;

export type QboProviderErrorKind =
  | "authentication"
  | "authorization_scope"
  | "validation_schema"
  | "rate_limit"
  | "transient_network"
  | "provider_5xx"
  | "not_found"
  | "malformed_response"
  | "unsupported_provider_contract"
  | "unknown";

export type QboRetryDisposition =
  | "do_not_retry"
  | "retry_with_backoff"
  | "reauthorization_required";

export type QboProviderErrorClassification = Readonly<{
  policyVersion: typeof QBO_ERROR_POLICY_VERSION;
  kind: QboProviderErrorKind;
  retryDisposition: QboRetryDisposition;
  safeCode: string;
  safeDetail: string;
  retryAfterMs: number | null;
  intuitTid: string | null;
}>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function header(headers: Record<string, string | undefined> | undefined, key: string) {
  if (!headers) return null;
  const foundKey = Object.keys(headers).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  return foundKey ? headers[foundKey] ?? null : null;
}

export function parseQboRetryAfter(value: string | null | undefined, now = new Date()) {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1_000;
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return null;
  return Math.max(0, parsed.getTime() - now.getTime());
}

function firstFaultError(body: unknown) {
  const root = record(body);
  const response = record(root?.IntuitResponse) ?? root;
  const fault = record(response?.Fault);
  const errors = fault?.Error;
  const firstError = Array.isArray(errors) ? record(errors[0]) : record(errors);
  return {
    faultType: typeof fault?.type === "string" ? fault.type : null,
    code: typeof firstError?.code === "string" ? firstError.code : null
  };
}

export function classifyQboProviderError(input: {
  httpStatus: number | null;
  body?: unknown;
  headers?: Record<string, string | undefined>;
  transportFailure?: boolean;
}) {
  const retryAfterMs = parseQboRetryAfter(header(input.headers, "retry-after"));
  const intuitTid = header(input.headers, "intuit_tid") ?? header(input.headers, "intuit-tid");
  const fault = firstFaultError(input.body);

  let kind: QboProviderErrorKind = "unknown";
  let retryDisposition: QboRetryDisposition = "do_not_retry";

  if (input.transportFailure || input.httpStatus === null) {
    kind = "transient_network";
    retryDisposition = "retry_with_backoff";
  } else if (input.httpStatus === 401) {
    kind = "authentication";
    retryDisposition = "reauthorization_required";
  } else if (input.httpStatus === 403) {
    kind = "authorization_scope";
    retryDisposition = "reauthorization_required";
  } else if (input.httpStatus === 404) {
    kind = "not_found";
  } else if (input.httpStatus === 429) {
    kind = "rate_limit";
    retryDisposition = "retry_with_backoff";
  } else if (input.httpStatus >= 500 && input.httpStatus <= 599) {
    kind = "provider_5xx";
    retryDisposition = "retry_with_backoff";
  } else if (fault.faultType?.toLowerCase() === "validation" || input.httpStatus === 400 || input.httpStatus === 422) {
    kind = "validation_schema";
  } else if (fault.faultType?.toLowerCase() === "authentication") {
    kind = "authentication";
    retryDisposition = "reauthorization_required";
  } else if (fault.faultType?.toLowerCase() === "authorization") {
    kind = "authorization_scope";
    retryDisposition = "reauthorization_required";
  } else if (fault.faultType?.toLowerCase() === "service") {
    kind = "provider_5xx";
    retryDisposition = "retry_with_backoff";
  }

  return {
    policyVersion: QBO_ERROR_POLICY_VERSION,
    kind,
    retryDisposition,
    safeCode: fault.code ?? `http_${input.httpStatus ?? "transport"}`,
    safeDetail: "QuickBooks Online provider response was classified with customer-safe metadata only.",
    retryAfterMs,
    intuitTid
  } satisfies QboProviderErrorClassification;
}

export const QBO_RATE_LIMIT_OBSERVATION_POLICY = {
  policyVersion: QBO_ERROR_POLICY_VERSION,
  retryAfterHeader: "Retry-After",
  limiterAuthority: "vaeroex_internal_conservative_policy",
  noSleepOrQueueInPhase7: true,
  documentedProviderMaximumsAreNotEncodedAsTenantAuthority: true
} as const;
