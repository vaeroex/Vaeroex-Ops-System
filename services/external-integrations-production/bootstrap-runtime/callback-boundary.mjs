import { createHash, timingSafeEqual } from "node:crypto";

export const SQUARE_PRODUCTION_HOST = "square.vaeroex.com";
export const SQUARE_CALLBACK_PATH = "/api/integrations/square/callback";
export const SQUARE_HANDOFF_VERSION = "square_oauth_callback_handoff_v1";

const MAX_HEADER_COUNT = 64;
const MAX_RAW_QUERY_BYTES = 8_192;
const STATE_PATTERN = /^(?:r1_)?[A-Za-z0-9_-]{43}$/;
const CODE_PATTERN = /^[\x21-\x7e]{1,191}$/;
const HANDOFF_HEADERS = Object.freeze({
  version: "x-vaeroex-oauth-handoff-version",
  query: "x-vaeroex-oauth-query",
});
const ALLOWED_HANDOFF_HEADERS = new Set(Object.values(HANDOFF_HEADERS));

export class CallbackBoundaryError extends Error {
  constructor() {
    super("square_production_callback_rejected");
    this.name = "CallbackBoundaryError";
  }
}

function reject() {
  throw new CallbackBoundaryError();
}

function exactRawHeaders(rawHeaders) {
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0 || rawHeaders.length / 2 > MAX_HEADER_COUNT) reject();
  const values = new Map();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const rawName = rawHeaders[index], value = rawHeaders[index + 1];
    if (typeof rawName !== "string" || typeof value !== "string" || rawName.length === 0 || rawName.length > 256) reject();
    const name = rawName.toLowerCase();
    if (value.length > (name === HANDOFF_HEADERS.query ? 10_923 : 8_192)) reject();
    const existing = values.get(name);
    if (existing) existing.push(value);
    else values.set(name, [value]);
  }
  return values;
}

function one(headers, name, required = true) {
  const values = headers.get(name);
  if (!values) {
    if (required) reject();
    return null;
  }
  if (values.length !== 1) reject();
  return values[0];
}

function decodeValue(value) {
  try {
    const decoded = decodeURIComponent(value.replaceAll("+", " "));
    if (decoded.length === 0 || decoded.length > 2_048 || /[\u0000-\u001f\u007f]/.test(decoded)) reject();
    return decoded;
  } catch {
    return reject();
  }
}

function parseRawQuery(encoded) {
  if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]{1,10923}$/.test(encoded)) reject();
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.length === 0 || bytes.length > MAX_RAW_QUERY_BYTES || bytes.toString("base64url") !== encoded) reject();
  let rawQuery;
  try {
    rawQuery = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return reject();
  }
  if (/[^\x21-\x7e]/.test(rawQuery) || rawQuery.includes("\\") || rawQuery.includes("#")) reject();
  const parts = rawQuery.split("&");
  if (parts.length < 2 || parts.length > 3) reject();
  const values = new Map();
  const allowed = new Set(["state", "code", "response_type", "error", "error_description"]);
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator < 1 || separator === part.length - 1) reject();
    const key = part.slice(0, separator), rawValue = part.slice(separator + 1);
    if (!allowed.has(key) || values.has(key)) reject();
    values.set(key, decodeValue(rawValue));
  }
  const state = values.get("state");
  if (typeof state !== "string" || !STATE_PATTERN.test(state)) reject();
  if (values.has("error")) {
    if (values.has("code") || values.has("response_type")) reject();
    return Object.freeze({ kind: "denied", state, authorizationCode: null });
  }
  if (values.has("error_description")) reject();
  const code = values.get("code");
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) reject();
  if (values.has("response_type") && values.get("response_type") !== "code") reject();
  return Object.freeze({ kind: "authorized", state, authorizationCode: code });
}

function checkedHandoff(input) {
  if (!input || Object.keys(input).sort().join(",") !== "method,rawHeaders,url" || input.method !== "GET" || input.url !== SQUARE_CALLBACK_PATH) reject();
  const headers = exactRawHeaders(input.rawHeaders);
  if (one(headers, "host") !== SQUARE_PRODUCTION_HOST) reject();
  for (const name of ["forwarded", "x-forwarded-host", "x-original-url", "x-rewrite-url"]) {
    if (headers.has(name)) reject();
  }
  if (headers.has("transfer-encoding") || headers.has("expect")) reject();
  const contentLength = one(headers, "content-length", false);
  if (contentLength !== null && contentLength.trim() !== "0") reject();
  for (const name of headers.keys()) {
    if (name.startsWith("x-vaeroex-oauth-") && !ALLOWED_HANDOFF_HEADERS.has(name)) reject();
  }
  if (one(headers, HANDOFF_HEADERS.version) !== SQUARE_HANDOFF_VERSION) reject();
  return parseRawQuery(one(headers, HANDOFF_HEADERS.query));
}

function sameHash(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || !/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function checkedConsumption(value, expectedHash, nowMs) {
  if (!value || Object.keys(value).sort().join(",") !== "accepted,consumedAtMs,csrfVerified,currentGeneration,expiresAtMs,generation,stateHash") reject();
  if (value.accepted !== true || value.csrfVerified !== true || !sameHash(value.stateHash, expectedHash) ||
    !Number.isSafeInteger(value.generation) || value.generation < 1 ||
    !Number.isSafeInteger(value.currentGeneration) || value.currentGeneration !== value.generation ||
    !Number.isSafeInteger(value.expiresAtMs) || value.expiresAtMs <= nowMs ||
    !Number.isSafeInteger(value.consumedAtMs) || value.consumedAtMs !== nowMs) reject();
  return value.generation;
}

/**
 * Verifies the independently bounded internal handoff, then delegates one
 * atomic state consumption. A future enabled authority must bind the state to
 * the initiating browser/actor (csrfVerified), current connection generation,
 * expiration, and first consumption in the same transaction. The disabled
 * Production bootstrap injects an authority that accepts no state.
 */
export async function evaluateSquareProductionCallback(input, dependencies) {
  try {
    if (!dependencies || Object.keys(dependencies).sort().join(",") !== "consumeState,now" ||
      typeof dependencies.consumeState !== "function" || typeof dependencies.now !== "function") reject();
    const handoff = checkedHandoff(input);
    const nowMs = dependencies.now();
    if (!Number.isSafeInteger(nowMs) || nowMs < 0) reject();
    const stateHash = createHash("sha256").update(handoff.state, "utf8").digest("hex");
    const consumed = await dependencies.consumeState(Object.freeze({ stateHash, nowMs }));
    const generation = checkedConsumption(consumed, stateHash, nowMs);
    return Object.freeze(handoff.kind === "authorized"
      ? { kind: "authorized", authorizationCode: handoff.authorizationCode, generation }
      : { kind: "denied", generation });
  } catch {
    return reject();
  }
}
