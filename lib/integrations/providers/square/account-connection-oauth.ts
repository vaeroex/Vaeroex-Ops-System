import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { contractSha256, canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { IsoTimestampSchema } from "@/lib/integrations/contracts/primitives";
import type { OAuthCredentialProvider } from "@/lib/integrations/credentials/broker";
import {
  CREDENTIAL_SECURITY_CONTRACT_VERSIONS,
  CredentialEnvelopeSchema,
  PHASE_5_DIRECT_KMS_MAX_PLAINTEXT_BYTES,
  type CredentialEnvelope,
  type CredentialRefreshBoundaryReporter
} from "@/lib/integrations/credentials/contracts";
import {
  ProviderOAuthPolicySchema,
  type ProviderOAuthPolicy
} from "@/lib/integrations/credentials/oauth-policy";
import { ProviderCredentialRefreshFailure } from "@/lib/integrations/credentials/provider-failure";
import type { ProviderApplicationSecret } from "@/lib/integrations/credentials/secret-manager";
import { SquareAccountEnvironmentSchema } from "@/lib/integrations/providers/square/account-connection-contracts";
import { SQUARE_ENVIRONMENTS, SQUARE_MINIMUM_READ_SCOPES } from "@/lib/integrations/providers/square/contracts";
import { reportSquareConsentProgress, type SquareConsentObserver } from "./account-connection-progress";

/** API 2026-08-19; square-nodejs-sdk 45.1.0, e4a5bf7e1a2b97c2b995fde28c55ddbc35dc0e76.
 * Confidential code flow, not PKCE: short-lived access, multi-use non-expiring refresh.
 * OAuth POSTs deliberately do not pass through or modify business read-only policy.
 */
export const SQUARE_OAUTH_API_VERSION = "2026-08-19" as const;
export const SQUARE_OAUTH_POLICY_VERSION = "square_account_oauth_policy_v1" as const;
export const SQUARE_OAUTH_MAX_RESPONSE_BYTES = 65_536;
export const SQUARE_OAUTH_TIMEOUT_MS = 5_000;
export const SQUARE_OAUTH_CLOCK_SKEW_MS = 60_000;
export const SQUARE_OAUTH_SCOPES = Object.freeze([...SQUARE_MINIMUM_READ_SCOPES].sort());
const ACCESS_LIFETIME_MS = 86_400_000;
const ApplicationIdSchema = z.string().min(8).max(191).regex(/^[A-Za-z0-9._:-]+$/);
const MerchantIdSchema = z.string().min(1).max(191).regex(/^[A-Za-z0-9._:-]+$/);
const AccessTokenSchema = z.string().min(16).max(16_384).refine(value => !/[\u0000-\u0020\u007f]/.test(value));
const StateSchema = z.string().regex(/^(?:r1_)?[A-Za-z0-9_-]{43}$/);
const CodeSchema = z.string().min(1).max(191).refine(value => !/[\u0000-\u0020\u007f]/.test(value));

export type SquareOAuthTransportRequest = Readonly<{
  url: string;
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body: string | null;
  signal: AbortSignal;
  maximumResponseBytes: number;
}>;
export type SquareOAuthTransportResponse = Readonly<{
  status: number;
  body: AsyncIterable<Uint8Array>;
  close?: () => void | PromiseLike<void>;
}>;
/** No built-in network or secret access. The injected transport must not follow redirects,
 * must cooperate with abort, and must bound its own read/allocation to maximumResponseBytes.
 */
export type SquareOAuthTransport = (request: SquareOAuthTransportRequest) => PromiseLike<SquareOAuthTransportResponse>;

function fail(code: ConstructorParameters<typeof ProviderCredentialRefreshFailure>[0] = "integrity_failure"): never {
  throw new ProviderCredentialRefreshFailure(code);
}
function origin(environment: "sandbox" | "production") {
  return `https://${SQUARE_ENVIRONMENTS[environment].hostname}`;
}
function exactScopes(value: readonly string[]) {
  return value.length === SQUARE_OAUTH_SCOPES.length &&
    [...value].sort().every((scope, index) => scope === SQUARE_OAUTH_SCOPES[index]);
}
function exactHttpsUrl(value: string) {
  if (typeof value !== "string" || value.length > 2_048 || /[\s\\%]/.test(value)) fail();
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.href !== value) fail();
  return url;
}

export function createSquareOAuthPolicy(input: Readonly<{
  environment: "sandbox" | "production";
  applicationId: string;
  redirectUri: string;
  returnPath: string;
}>): ProviderOAuthPolicy {
  const environment = SquareAccountEnvironmentSchema.parse(input.environment);
  ApplicationIdSchema.parse(input.applicationId);
  const redirect = exactHttpsUrl(input.redirectUri);
  return ProviderOAuthPolicySchema.parse({
    contractVersion: "provider_oauth_policy_v1", policyVersion: SQUARE_OAUTH_POLICY_VERSION,
    providerKey: "square", providerEnvironment: environment,
    authorizationMode: "oauth2_confidential_authorization_code",
    authorizationEndpoint: `${origin(environment)}/oauth2/authorize`,
    tokenEndpoint: `${origin(environment)}/oauth2/token`,
    revocationEndpoint: `${origin(environment)}/oauth2/revoke`,
    callbackUri: redirect.href, callbackPath: redirect.pathname,
    defaultAuthorizationReturnPath: input.returnPath, defaultReauthorizationReturnPath: input.returnPath,
    permittedReturnPaths: [input.returnPath], requestedScopes: [...SQUARE_OAUTH_SCOPES],
    tokenLifetime: { accessTokenMaximumSeconds: 86_400, requiredAccessTokenLifetimeSeconds: 86_400,
      providerShortLivedAccessTokenRequired: true },
    externalEntityAuthority: { requiredForAuthorization: true, authorizedEntityTypes: ["merchant"],
      reauthorizationEntityTypes: ["merchant"] }
  });
}
function checkedPolicy(value: ProviderOAuthPolicy, applicationId: string) {
  const policy = ProviderOAuthPolicySchema.parse(value);
  const expected = createSquareOAuthPolicy({ environment: SquareAccountEnvironmentSchema.parse(policy.providerEnvironment),
    applicationId, redirectUri: policy.callbackUri, returnPath: policy.defaultAuthorizationReturnPath });
  if (canonicalContractJson(policy) !== canonicalContractJson(expected)) fail();
  return policy;
}

export function squareAuthorizationUrl(input: Readonly<{ policy: ProviderOAuthPolicy; applicationId: string; state: string }>) {
  const policy = checkedPolicy(input.policy, input.applicationId);
  const url = new URL(policy.authorizationEndpoint);
  url.searchParams.set("client_id", input.applicationId);
  url.searchParams.set("redirect_uri", policy.callbackUri);
  url.searchParams.set("scope", policy.requestedScopes.join(" "));
  url.searchParams.set("state", StateSchema.parse(input.state));
  // Square supports only session=true in Sandbox; Production requires false.
  url.searchParams.set("session", policy.providerEnvironment === "sandbox" ? "true" : "false");
  return url.href;
}

export type SquareOAuthCallback = Readonly<{ kind: "authorized"; state: string; authorizationCode: string }> |
  Readonly<{ kind: "denied"; state: string }>;
/** Only parses the handoff. The checked store must consume actor/session-bound state for
 * denial as well as success, before exchange. Never return/echo error_description.
 */
export function parseSquareOAuthCallback(value: string, expectedRedirectUri: string): SquareOAuthCallback {
  try {
    if (typeof value !== "string" || value.length > 8_192 || /[\u0000-\u0020\u007f\\]/.test(value)) fail();
    const url = new URL(value), redirect = exactHttpsUrl(expectedRedirectUri);
    if (url.origin !== redirect.origin || url.pathname !== redirect.pathname || url.username || url.password || url.hash) fail();
    const allowed = new Set(["state", "code", "response_type", "error", "error_description"]);
    for (const key of url.searchParams.keys()) {
      if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) fail();
    }
    const state = StateSchema.parse(url.searchParams.get("state"));
    if (url.searchParams.has("error")) {
      if (url.searchParams.has("code") || url.searchParams.has("response_type") || !url.searchParams.get("error")) fail();
      return Object.freeze({ kind: "denied", state });
    }
    if (url.searchParams.has("error_description") ||
      (url.searchParams.has("response_type") && url.searchParams.get("response_type") !== "code")) fail();
    return Object.freeze({ kind: "authorized", state, authorizationCode: CodeSchema.parse(url.searchParams.get("code")) });
  } catch { throw new Error("square_oauth_callback_rejected"); }
}

/** Pre-allocation guard, not a replacement JSON grammar/parser. Every current Square
 * response has <=20,000 raw values and <=one key per value: counting keys too gives
 * a conservative 40,000-token bound. At most 13 active key sets (64 keys each) exist.
 * Unknown values are charged; repeated occurrences and duplicate keys get no discount.
 */
function parseBoundedJson(text: string, maximumStringLength: number, check: () => void = () => {}) {
  const stack: Array<{ object: boolean; keyExpected: boolean; keys: Set<string> }> = [];
  let tokens = 0;
  for (let index = 0; index < text.length; index++) {
    if (index % 4096 === 0) check();
    const char = text[index];
    if (char === "{" || char === "[") {
      if (++tokens > 40_000 || stack.length >= 13) fail();
      stack.push({ object: char === "{", keyExpected: char === "{", keys: new Set() });
    } else if (char === "}" || char === "]") {
      if (!stack.pop()) fail();
    } else if (char === ",") {
      const frame = stack[stack.length - 1]; if (frame?.object) frame.keyExpected = true;
    } else if (char === '"') {
      if (++tokens > 40_000) fail();
      const start = index, frame = stack[stack.length - 1];
      const key = frame?.object && frame.keyExpected;
      const maximum = key ? 128 : maximumStringLength;
      let length = 0;
      while (++index < text.length && text[index] !== '"') {
        if (++length > maximum) fail();
        if (text[index] === "\\") { index++; if (text[index] === "u") index += 4; }
      }
      if (index >= text.length) fail();
      if (key) {
        const name = JSON.parse(text.slice(start, index + 1));
        if (frame.keys.has(name) || frame.keys.size >= 64) fail();
        frame.keys.add(name); frame.keyExpected = false;
      }
    } else if (char !== ":" && !/\s/.test(char)) {
      if (++tokens > 40_000) fail();
      // JSON.parse subsequently validates exact literal/number grammar. This loop
      // is bounded by wire bytes and never constructs a numeric/string collection.
      while (index + 1 < text.length && !/[\s,\]}:]/.test(text[index + 1])) {
        index++; if (index % 4096 === 0) check();
      }
    }
  }
  if (stack.length !== 0) fail();
  check();
  return JSON.parse(text) as unknown;
}

/** Fixed retained collection: one 64KiB buffer, one current transport chunk, one
 * sequential cancellation callback. No chunk array or ever-growing abort Promise.race.
 * Decoding/JSON parsing occurs only after the byte budget. Unknown provider fields are
 * not projected. Each accepted credential has exactly two containers (root + scopes).
 */
async function post(input: Readonly<{
  environment: "sandbox" | "production"; path: "/oauth2/token" | "/oauth2/token/status" |
    "/v2/merchants/me" | "/v2/locations" | "/v2/locations/main";
  headers?: Readonly<Record<string, string>>; body: Record<string, unknown> | null;
  transport: SquareOAuthTransport; signal?: AbortSignal; timeoutMs?: number;
  observeConsent?: SquareConsentObserver;
}>): Promise<Record<string, unknown>> {
  const timeoutMs = input.timeoutMs ?? SQUARE_OAUTH_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > SQUARE_OAUTH_TIMEOUT_MS) fail();
  // Discovery retains the existing fixed Merchant/Location 16MiB wire budget;
  // the unchanged parsers independently apply their raw-value/schema limits.
  const discovery = input.path.startsWith("/v2/");
  const maximumResponseBytes = discovery ? 16 * 1024 * 1024 : SQUARE_OAUTH_MAX_RESPONSE_BYTES;
  const buffer = Buffer.alloc(maximumResponseBytes);
  const controller = new AbortController();
  const deadline = Date.now() + timeoutMs;
  let stopped = false, activeWait: (() => void) | null = null;
  let response: SquareOAuthTransportResponse | null = null;
  const stop = () => { stopped = true; controller.abort(); activeWait?.(); };
  const timer = setTimeout(stop, timeoutMs);
  input.signal?.addEventListener("abort", stop, { once: true });
  if (input.signal?.aborted) stop();
  const check = () => { if (stopped || Date.now() >= deadline) { stop(); fail("provider_transient"); } };
  const wait = <T>(pending: PromiseLike<T>): Promise<T> => new Promise((resolve, reject) => {
    const interrupted = () => { if (activeWait === interrupted) activeWait = null; reject(new ProviderCredentialRefreshFailure("provider_transient")); };
    if (stopped) { Promise.resolve(pending).catch(() => {}); interrupted(); return; }
    activeWait = interrupted;
    Promise.resolve(pending).then(value => {
      if (activeWait === interrupted) activeWait = null;
      if (stopped) interrupted(); else resolve(value);
    }, () => { if (activeWait === interrupted) activeWait = null; reject(new ProviderCredentialRefreshFailure("provider_transient")); });
  });
  const close = (value: SquareOAuthTransportResponse) => {
    try { Promise.resolve(value.close?.()).catch(() => {}); } catch { /* Never expose transport errors. */ }
  };
  try {
    check();
    const opening = Promise.resolve().then(() => { check(); return input.transport({
      url: `${origin(input.environment)}${input.path}`, method: discovery ? "GET" : "POST",
      headers: Object.freeze({ "Square-Version": SQUARE_OAUTH_API_VERSION, "Content-Type": "application/json", ...input.headers }),
      body: input.body === null ? null : JSON.stringify(input.body), signal: controller.signal,
      maximumResponseBytes
    }); });
    // A late opening cannot publish a token or retain a live response after cancellation.
    opening.then(value => { if (stopped) close(value); }, () => {});
    response = await wait(opening);
    check();
    if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) fail();
    if (response.status >= 300 && response.status < 400) fail();
    if (response.status === 429 || response.status >= 500) fail("provider_transient");
    if (input.path === "/oauth2/token") reportSquareConsentProgress(input.observeConsent, "token_response_body");
    if (input.path === "/oauth2/token/status") reportSquareConsentProgress(input.observeConsent, "token_status_response_body");
    const iterator = response.body[Symbol.asyncIterator]();
    let length = 0, reads = 0;
    while (true) {
      check();
      const next = await wait(iterator.next());
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || next.value.byteLength > buffer.length - length) fail();
      buffer.set(next.value, length); length += next.value.byteLength;
      // A resolved empty/tiny-chunk stream must allow timers/cancellation to run.
      if (++reads % 64 === 0) await wait(new Promise<void>(resolve => setImmediate(resolve)));
    }
    if (length === 0) fail();
    const parsed = parseBoundedJson(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)), discovery ? 4096 : 16384, check);
    check();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) fail();
    const record = parsed as Record<string, unknown>;
    if (record.errors !== undefined && (!Array.isArray(record.errors) || record.errors.length !== 0)) {
      const codes = Array.isArray(record.errors) ? record.errors.slice(0, 64).map(error =>
        error && typeof error === "object" ? (error as Record<string, unknown>).code : null) : [];
      if (codes.includes("ACCESS_TOKEN_REVOKED")) fail("provider_revoked");
      if (codes.includes("INVALID_GRANT") || codes.includes("ACCESS_TOKEN_EXPIRED")) fail("invalid_grant");
      // HTTP authentication failure closes only the current credential scope;
      // unknown provider error names never establish shared-grant revocation.
      if (response.status === 401) fail("invalid_grant");
      if (response.status === 429 || response.status >= 500) fail("provider_transient");
      fail();
    }
    if (response.status === 429 || response.status >= 500) fail("provider_transient");
    if (response.status === 401) fail("invalid_grant");
    if (response.status < 200 || response.status >= 300) fail();
    return record;
  } catch (error) {
    if (error instanceof ProviderCredentialRefreshFailure) throw error;
    return fail();
  } finally {
    stopped = true; activeWait = null; clearTimeout(timer);
    input.signal?.removeEventListener("abort", stop); controller.abort();
    if (response) close(response);
    buffer.fill(0);
  }
}

export async function readSquareAuthenticatedDiscovery(input: Readonly<{
  transport: SquareOAuthTransport; environment: "sandbox" | "production";
  path: "/v2/merchants/me" | "/v2/locations" | "/v2/locations/main";
  accessToken: string; signal?: AbortSignal; timeoutMs?: number;
}>): Promise<Record<string, unknown>> {
  try {
    const environment = SquareAccountEnvironmentSchema.parse(input.environment);
    const path = z.enum(["/v2/merchants/me", "/v2/locations", "/v2/locations/main"]).parse(input.path);
    const accessToken = AccessTokenSchema.parse(input.accessToken);
    return await post({ environment, path, transport: input.transport, signal: input.signal, timeoutMs: input.timeoutMs,
      headers: { Authorization: `Bearer ${accessToken}` }, body: null });
  } catch (error) { if (error instanceof ProviderCredentialRefreshFailure) throw error; fail(); }
}

const TokenSchema = z.object({
  access_token: AccessTokenSchema, refresh_token: z.string().min(16).max(16_384),
  token_type: z.literal("bearer"), expires_at: IsoTimestampSchema, merchant_id: MerchantIdSchema,
  short_lived: z.literal(true), refresh_token_expires_at: z.never().optional()
});
const StatusSchema = z.object({
  scopes: z.array(z.string().min(1).max(255)).max(64), expires_at: IsoTimestampSchema,
  client_id: ApplicationIdSchema, merchant_id: MerchantIdSchema
});

function checkedSecret(secret: ProviderApplicationSecret, environment: "sandbox" | "production", applicationId: string) {
  if (secret.providerKey !== "square" || secret.environment !== environment) fail();
  return secret.use(value => {
    if (value.clientId !== applicationId || value.clientSecret.length > 1_024 || /[\u0000-\u0020\u007f]/.test(value.clientSecret)) fail();
    return value;
  });
}

export function createSquareOAuthCredentialProvider(input: Readonly<{
  policy: ProviderOAuthPolicy; applicationId: string; transport: SquareOAuthTransport;
  signal?: AbortSignal; timeoutMs?: number;
  observeConsent?: SquareConsentObserver;
}>): OAuthCredentialProvider {
  const applicationId = ApplicationIdSchema.parse(input.applicationId);
  const policy = checkedPolicy(input.policy, applicationId);
  const environment = SquareAccountEnvironmentSchema.parse(policy.providerEnvironment);
  const { transport, signal, timeoutMs } = input;
  const observeConsent = environment === "sandbox" ? input.observeConsent : undefined;
  const obtain = async (request: Record<string, unknown>, now: Date, prior?: CredentialEnvelope, reporter?: CredentialRefreshBoundaryReporter) => {
    const report = async (stage: "provider_token_request" | "provider_response_parse", outcome: "started" | "succeeded") => {
      try { await reporter?.({ stage, outcome, reasonCode: outcome }); } catch { /* Telemetry never grants or denies credentials. */ }
    };
    await report("provider_token_request", "started");
    reportSquareConsentProgress(observeConsent, "token_request");
    const raw = await post({ environment, path: "/oauth2/token", body: request, transport, signal, timeoutMs, observeConsent });
    await report("provider_token_request", "succeeded");
    await report("provider_response_parse", "started");
    reportSquareConsentProgress(observeConsent, "token_schema_validation");
    const token = TokenSchema.parse(raw);
    reportSquareConsentProgress(observeConsent, "token_schema_validated");
    reportSquareConsentProgress(observeConsent, "token_status_request");
    const rawStatus = await post({ environment, path: "/oauth2/token/status", body: null,
      headers: { Authorization: `Bearer ${token.access_token}` }, transport, signal, timeoutMs, observeConsent });
    reportSquareConsentProgress(observeConsent, "token_status_schema_validation");
    const status = StatusSchema.parse(rawStatus);
    reportSquareConsentProgress(observeConsent, "token_status_verification");
    if (!exactScopes(status.scopes)) fail("scope_loss");
    if (status.client_id !== applicationId || status.merchant_id !== token.merchant_id ||
      Date.parse(status.expires_at) !== Date.parse(token.expires_at)) fail();
    const issuedMs = Date.parse(token.expires_at) - ACCESS_LIFETIME_MS;
    if (!Number.isFinite(now.getTime()) || Math.abs(issuedMs - now.getTime()) > SQUARE_OAUTH_CLOCK_SKEW_MS) fail();
    if (prior && (token.merchant_id !== prior.externalAuthorizedEntityReference || token.refresh_token !== prior.refreshToken)) fail();
    const envelope = CredentialEnvelopeSchema.parse({
      schemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope, providerKey: "square", environment,
      externalAuthorizedEntityReference: token.merchant_id, accessToken: token.access_token,
      accessExpiresAt: new Date(Date.parse(token.expires_at)).toISOString(), refreshToken: token.refresh_token,
      refreshExpiresAt: null, grantedScopes: [...SQUARE_OAUTH_SCOPES],
      issuedAt: prior?.issuedAt ?? new Date(issuedMs).toISOString(), updatedAt: new Date(issuedMs).toISOString()
    });
    if (Buffer.byteLength(canonicalContractJson(envelope)) > PHASE_5_DIRECT_KMS_MAX_PLAINTEXT_BYTES) fail();
    reportSquareConsentProgress(observeConsent, "token_verified");
    await report("provider_response_parse", "succeeded");
    return envelope;
  };
  // Each operation performs one token request, never an implicit authorization-code retry.
  return Object.freeze({
    providerKey: "square", environment, refreshTokenRotationPolicy: "returned_token_authoritative", tokenType: "bearer",
    async exchangeAuthorizationCode(value) {
      try {
        if (!exactScopes(value.requestedScopes)) fail("scope_loss");
        reportSquareConsentProgress(observeConsent, "application_secret_validation");
        const secret = checkedSecret(value.applicationSecret, environment, applicationId);
        reportSquareConsentProgress(observeConsent, "application_secret_verified");
        const envelope = await obtain({ client_id: applicationId, client_secret: secret.clientSecret,
          code: CodeSchema.parse(value.authorizationCode), redirect_uri: policy.callbackUri,
          grant_type: "authorization_code", short_lived: true }, value.now);
        if (value.externalAuthorizedEntityReference != null && envelope.externalAuthorizedEntityReference !== value.externalAuthorizedEntityReference) fail();
        return envelope;
      } catch (error) { if (error instanceof ProviderCredentialRefreshFailure) throw error; fail(); }
    },
    async refreshCredential(value) {
      try {
        const prior = CredentialEnvelopeSchema.parse(value.credential);
        if (prior.providerKey !== "square" || prior.environment !== environment || prior.refreshExpiresAt !== null || !exactScopes(prior.grantedScopes)) fail();
        const secret = checkedSecret(value.applicationSecret, environment, applicationId);
        return await obtain({ client_id: applicationId, client_secret: secret.clientSecret,
          refresh_token: prior.refreshToken, grant_type: "refresh_token", scopes: [...SQUARE_OAUTH_SCOPES],
          short_lived: true }, value.now, prior, value.reportBoundary);
      } catch (error) { if (error instanceof ProviderCredentialRefreshFailure) throw error; fail(); }
    },
    async revokeCredential() {
      // A connection-bound credential is not grant-level revocation authority.
      // Square's merchant/default revoke is app-wide; access-token-only revoke
      // leaves refresh authorization intact and can still affect shared tokens.
      // No approved grant-level action exists in this dormant milestone.
      return fail();
    }
  });
}

const RevocationSchema = z.object({
  type: z.literal("oauth.authorization.revoked"), merchant_id: MerchantIdSchema,
  event_id: z.string().min(1).max(255).regex(/^[A-Za-z0-9_-]+$/), created_at: IsoTimestampSchema,
  data: z.object({ type: z.literal("revocation"), object: z.object({ revocation: z.object({
    revoked_at: IsoTimestampSchema, revoker_type: z.enum(["APPLICATION", "MERCHANT", "SQUARE"])
  }) }) })
});
/** Authentication only. The scoped checked database must deduplicate eventId and order
 * revocation against credential issuance/generation; delivery is not ordered by Square.
 * No invented short freshness cutoff discards legitimate delayed/retried revocations.
 */
export function verifySquareRevocationNotification(input: Readonly<{
  rawBody: Uint8Array | string; signature: string; notificationUrl: string; signatureKey: string;
  environment: "sandbox" | "production"; applicationId: string;
}>) {
  try {
    const environment = SquareAccountEnvironmentSchema.parse(input.environment);
    const applicationId = ApplicationIdSchema.parse(input.applicationId);
    const url = exactHttpsUrl(input.notificationUrl).href;
    if (typeof input.signatureKey !== "string" || input.signatureKey.length < 16 || input.signatureKey.length > 1_024 ||
      typeof input.signature !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(input.signature)) fail();
    if (typeof input.rawBody !== "string" && !(input.rawBody instanceof Uint8Array)) fail();
    if (typeof input.rawBody === "string" && input.rawBody.length > SQUARE_OAUTH_MAX_RESPONSE_BYTES) fail();
    const body = typeof input.rawBody === "string" ? Buffer.from(input.rawBody) : input.rawBody;
    if (body.byteLength === 0 || body.byteLength > SQUARE_OAUTH_MAX_RESPONSE_BYTES) fail();
    const expected = createHmac("sha256", input.signatureKey).update(url).update(body).digest();
    const received = Buffer.from(input.signature, "base64");
    if (received.length !== expected.length || !timingSafeEqual(expected, received)) fail();
    const event = RevocationSchema.parse(parseBoundedJson(new TextDecoder("utf-8", { fatal: true }).decode(body), 4096));
    const safe = { environment, applicationId, merchantId: event.merchant_id, eventId: event.event_id,
      createdAt: event.created_at, revokedAt: event.data.object.revocation.revoked_at,
      revokerType: event.data.object.revocation.revoker_type };
    return Object.freeze({ ...safe, eventFingerprint: contractSha256({
      fingerprintPurpose: "square_authenticated_revocation_v1", ...safe
    }) });
  } catch { throw new Error("square_revocation_notification_rejected"); }
}
