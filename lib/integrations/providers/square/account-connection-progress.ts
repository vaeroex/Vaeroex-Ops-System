import "server-only";

import { isPromise } from "node:util/types";

/** Diagnostic observations only; none is authorization or a commit receipt. */
export const SQUARE_CONSENT_STAGES = Object.freeze([
  "unknown", "callback_authority_checks", "state_consume", "state_consumed",
  "application_secret_access", "application_secret_payload_validation", "application_secret_decode_validation",
  "application_secret_binding_validation", "application_secret_returned", "application_secret_validation",
  "application_secret_verified", "token_request", "token_response_body", "token_schema_validation",
  "token_schema_validated", "token_status_request", "token_status_response_body",
  "token_status_schema_validation", "token_status_verification", "token_verified",
  "merchant_request", "merchant_validation", "merchant_verified", "locations_request",
  "locations_validation", "locations_validated", "main_location_request", "main_location_validation",
  "discovery_verification", "discovery_verified", "credential_encrypt_requested",
  "credential_encrypt_returned", "fenced_store_requested", "fenced_store_returned"
] as const);
export type SquareConsentStage = typeof SQUARE_CONSENT_STAGES[number];
export type SquareConsentObserver = (stage: SquareConsentStage) => void;
export function isSquareConsentStage(value: unknown): value is SquareConsentStage {
  return typeof value === "string" && (SQUARE_CONSENT_STAGES as readonly string[]).includes(value);
}
/** Do not await telemetry or inspect/serialize any object it returns or throws.
 * Native rejected promises are drained without calling an arbitrary then getter. */
export function reportSquareConsentProgress(observer: SquareConsentObserver | undefined, stage: SquareConsentStage) {
  try {
    if (!isSquareConsentStage(stage) || typeof observer !== "function") return;
    const result: unknown = observer(stage);
    if (isPromise(result)) Promise.prototype.then.call(result, undefined, () => {});
  } catch { /* Diagnostics must never affect the original operation. */ }
}
