import "server-only";
import { z } from "zod";
import { CredentialEnvelopeSchema, type CredentialEnvelope } from "@/lib/integrations/credentials/contracts";
import { ProviderAccessCredential } from "@/lib/integrations/credentials/broker";
import { ProviderApplicationSecret } from "@/lib/integrations/credentials/secret-manager";
import { ProviderCredentialRefreshFailure } from "@/lib/integrations/credentials/provider-failure";
import { createSquareAccountDiscovery } from "@/lib/integrations/providers/square/account-discovery";
import { createSquareOAuthCredentialProvider, createSquareOAuthPolicy, readSquareAuthenticatedDiscovery,
  squareAuthorizationUrl, SQUARE_OAUTH_SCOPES, type SquareOAuthTransport } from "@/lib/integrations/providers/square/account-connection-oauth";
import { SQUARE_API_VERSION } from "@/lib/integrations/providers/square/contracts";
import { parseSquarePaymentResponse } from "@/lib/integrations/providers/square/payment-responses";

export const directCallbackUri = "https://www.vaeroex.com/api/integrations/square/callback";
const origin = "https://connect.squareup.com";
const failure = () => new Error("square_direct_provider_failed");
const reauthorize = () => new Error("square_direct_reauthorization_required");
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9._:-]+$/);
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable();
const paymentInput = z.object({ workspaceId: z.string().uuid(), connectionId: z.string().uuid(), merchantId: id,
  locationId: id.max(50), windowStart: z.string().datetime({ offset: true }), windowEnd: z.string().datetime({ offset: true }),
  cursor: z.string().regex(/^[A-Za-z0-9._~:+-]{1,4096}={0,2}$/).nullable(),
  cursorBindingFingerprint: fingerprint, cursorFingerprint: fingerprint }).strict();
function outward(error: unknown): never {
  if (error instanceof Error && error.message === "square_direct_reauthorization_required" ||
      error instanceof ProviderCredentialRefreshFailure && ["invalid_grant", "provider_revoked", "scope_loss"].includes(error.code)) {
    throw reauthorize();
  }
  throw failure();
}
function credentialForProduction(value: CredentialEnvelope, now?: Date) {
  const credential = CredentialEnvelopeSchema.parse(value);
  if (credential.providerKey !== "square" || credential.environment !== "production" ||
      credential.grantedScopes.length !== SQUARE_OAUTH_SCOPES.length ||
      [...credential.grantedScopes].sort().some((scope, index) => scope !== SQUARE_OAUTH_SCOPES[index])) throw failure();
  if (now && Date.parse(credential.accessExpiresAt) <= now.getTime()) throw reauthorize();
  return credential;
}
async function boundedJson(response: Response, maximumBytes: number): Promise<Record<string, unknown>> {
  if (response.redirected || response.status >= 300 && response.status < 400 || !response.body) {
    await response.body?.cancel().catch(() => undefined); throw failure();
  }
  const reader = response.body.getReader(), buffer = Buffer.alloc(maximumBytes);
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      if (part.value.length > maximumBytes - length) throw failure();
      buffer.set(part.value, length); length += part.value.length;
    }
    if (response.status === 401) throw reauthorize();
    if (!response.ok) throw failure();
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw failure();
    return parsed as Record<string, unknown>;
  } finally { buffer.fill(0); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

/** Uses the existing provider validators; no database LOGIN/broker authority or VM is involved. */
export function createDirectSquareProvider(input: {
  applicationId: string; applicationSecret: string; network?: typeof fetch; now?: () => Date;
  authorize?: () => Promise<void>;
}) {
  try {
    const applicationId = z.string().min(8).max(191).regex(/^[A-Za-z0-9._:-]+$/).parse(input.applicationId);
    const applicationSecret = new ProviderApplicationSecret({ schemaVersion: "provider_application_secret_v1",
      providerKey: "square", environment: "production", clientId: applicationId, clientSecret: input.applicationSecret });
    const network = input.network ?? fetch, now = input.now ?? (() => new Date());
    const policy = createSquareOAuthPolicy({ environment: "production", applicationId, redirectUri: directCallbackUri,
      returnPath: "/app/settings/integrations/square" });
    const transport: SquareOAuthTransport = async request => {
      const url = new URL(request.url);
      const discovery = ["/v2/merchants/me", "/v2/locations", "/v2/locations/main"].includes(url.pathname);
      if (url.origin !== origin || url.username || url.password || url.search || url.hash ||
          (!discovery && !["/oauth2/token", "/oauth2/token/status"].includes(url.pathname)) ||
          request.method !== (discovery ? "GET" : "POST") || request.signal.aborted) throw failure();
      await input.authorize?.();
      if (request.signal.aborted) throw failure();
      const response = await network(request.url, { method: request.method, headers: request.headers, body: request.body,
        signal: request.signal, redirect: "error", credentials: "omit", cache: "no-store" });
      if (response.redirected || response.status >= 300 && response.status < 400 || !response.body) {
        await response.body?.cancel().catch(() => undefined); throw failure();
      }
      const reader = response.body.getReader(); let bytes = 0, closed = false;
      const close = async () => { if (closed) return; closed = true; request.signal.removeEventListener("abort", abort);
        await reader.cancel().catch(() => undefined); try { reader.releaseLock(); } catch { /* In-flight read settles on cancellation. */ } };
      const abort = () => { void close(); };
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) { await close(); throw failure(); }
      async function* body() {
        try { for (;;) { if (closed || request.signal.aborted) throw failure();
          const part = await reader.read(); if (part.done) return;
          bytes += part.value.length; if (bytes > request.maximumResponseBytes) throw failure(); yield part.value;
        } } finally { await close(); }
      }
      return { status: response.status, body: body(), close };
    };
    const oauth = createSquareOAuthCredentialProvider({ applicationId, policy, transport });
    return {
      authorizationUrl(state: string) {
        try { return squareAuthorizationUrl({ policy, applicationId, state }); } catch (error) { return outward(error); }
      },
      async exchange(code: string) {
        try {
          const credential = credentialForProduction(CredentialEnvelopeSchema.parse(await oauth.exchangeAuthorizationCode({
            authorizationCode: code, applicationSecret, requestedScopes: SQUARE_OAUTH_SCOPES, now: now()
          })), now());
          if (!credential.externalAuthorizedEntityReference) throw failure();
          const discovery = createSquareAccountDiscovery({ environment: "production", applicationId, clock: now,
            readAuthenticated: request => readSquareAuthenticatedDiscovery({ ...request, transport }) });
          await discovery.verify({ externalAuthorizedEntityReference: credential.externalAuthorizedEntityReference,
            credential: new ProviderAccessCredential({ providerKey: "square", providerEnvironment: "production",
              accessToken: credential.accessToken, accessExpiresAt: credential.accessExpiresAt, grantedScopes: credential.grantedScopes }) });
          const verified = discovery.consumeVerifiedDiscovery();
          const locations = verified.locations.filter(location => location.status === "ACTIVE").map(({ id, label }) => ({ id, label }));
          if (!locations.length) throw failure();
          return { credential, merchantId: verified.merchantId, sellerLabel: verified.merchantLabel, locations };
        } catch (error) { return outward(error); }
      },
      async refresh(value: CredentialEnvelope): Promise<CredentialEnvelope> {
        try { return credentialForProduction(CredentialEnvelopeSchema.parse(await oauth.refreshCredential({
          credential: credentialForProduction(value), applicationSecret, now: now()
        })), now()); } catch (error) { return outward(error); }
      },
      async payments(raw: z.infer<typeof paymentInput> & { credential: CredentialEnvelope }) {
        try {
          const { credential: rawCredential, ...rest } = raw;
          const request = paymentInput.parse(rest), credential = credentialForProduction(rawCredential, now());
          const start = Date.parse(request.windowStart), end = Date.parse(request.windowEnd);
          if (credential.externalAuthorizedEntityReference !== request.merchantId || end <= start ||
              end - start > 31 * 86_400_000 || end > now().getTime() ||
              (request.cursor === null ? request.cursorFingerprint !== null || request.cursorBindingFingerprint !== null :
                request.cursorFingerprint === null || request.cursorBindingFingerprint === null)) throw failure();
          // Avoid Square's implicit created-at one-year filter when reading later updates.
          const query: Record<string, string> = { begin_time: "1970-01-01T00:00:00.000Z", end_time: request.windowEnd,
            updated_at_begin_time: request.windowStart, updated_at_end_time: request.windowEnd,
            location_id: request.locationId, limit: "100", sort_order: "ASC", sort_field: "UPDATED_AT" };
          if (request.cursor !== null) query.cursor = request.cursor;
          const parsedInput = { providerKey: "square", providerEnvironment: "production", apiVersion: SQUARE_API_VERSION,
            operation: "list_payments", connectionAuthority: { workspaceId: request.workspaceId, connectionId: request.connectionId,
              providerEntityType: "merchant", providerEntityId: request.merchantId }, requestContext: {
              authorizedLocationIds: [request.locationId], locationId: request.locationId, query,
              expectedCursorBindingFingerprint: request.cursorBindingFingerprint,
              expectedResponseCursorFingerprint: request.cursorFingerprint } };
          // Validate continuation authority before exposing the token to a network request.
          if (parseSquarePaymentResponse({ ...parsedInput, response: { payments: [] } }).outcome !== "accepted") throw failure();
          await input.authorize?.();
          const response = await network(`${origin}/v2/payments?${new URLSearchParams(query)}`, { method: "GET",
            headers: { Authorization: `Bearer ${credential.accessToken}`, "Square-Version": SQUARE_API_VERSION },
            redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15_000) });
          const value = await boundedJson(response, 2_097_152);
          const parsed = parseSquarePaymentResponse({ ...parsedInput, response: value });
          if (parsed.outcome !== "accepted") throw failure();
          const payments = parsed.value.items.map(item => {
            const updatedAt = item.updatedAt ?? item.createdAt;
            if (!item.id || item.locationId !== request.locationId || !item.createdAt || !updatedAt ||
                Date.parse(updatedAt) < start || Date.parse(updatedAt) > end || Date.parse(item.createdAt) > end) throw failure();
            const money = item.totalMoney ?? item.amountMoney;
            return { id: item.id, locationId: item.locationId, status: item.status ?? "UNKNOWN", createdAt: item.createdAt,
              updatedAt, amountMinor: money?.amountMinor ?? null, currency: money?.currency ?? null };
          });
          const cursor = parsed.value.pagination.cursorPresent ? z.string().parse(value.cursor) : null;
          return { payments, cursor, cursorBindingFingerprint: parsed.value.cursorBindingFingerprint,
            cursorFingerprint: parsed.value.pagination.cursorFingerprint };
        } catch (error) { return outward(error); }
      },
      async revoke(value: CredentialEnvelope): Promise<void> {
        try {
          const credential = credentialForProduction(value);
          if (!credential.externalAuthorizedEntityReference) throw failure();
          // Caller fences its unique seller/workspace binding before this whole-grant revocation.
          // Merchant authority remains usable when the seller's access token has expired.
          await input.authorize?.();
          const response = await network(`${origin}/oauth2/revoke`, { method: "POST",
            headers: { Authorization: applicationSecret.use(secret => `Client ${secret.clientSecret}`),
              "Square-Version": SQUARE_API_VERSION, "Content-Type": "application/json" },
            body: JSON.stringify({ client_id: applicationId, merchant_id: credential.externalAuthorizedEntityReference, revoke_only_access_token: false }),
            redirect: "error", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(15_000) });
          const result = await boundedJson(response, 65_536);
          if (result.success !== true || (Array.isArray(result.errors) && result.errors.length > 0)) throw failure();
        } catch (error) { return outward(error); }
      }
    };
  } catch (error) { return outward(error); }
}
