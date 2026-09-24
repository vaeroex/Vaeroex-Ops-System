import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { ProviderAccessCredential } from "@/lib/integrations/credentials/broker";
import type { CredentialKms } from "@/lib/integrations/credentials/kms";
import type { ProviderApplicationSecret } from "@/lib/integrations/credentials/secret-manager";
import { createSquareAccountDiscovery } from "@/lib/integrations/providers/square/account-discovery";
import {
  createSquareOAuthCredentialProvider, createSquareOAuthPolicy,
  readSquareAuthenticatedDiscovery, squareAuthorizationUrl, SQUARE_OAUTH_SCOPES,
  type SquareOAuthTransport
} from "@/lib/integrations/providers/square/account-connection-oauth";
import { parseSquareProductionCallbackHandoff, SQUARE_CALLBACK_PATH } from "../bootstrap-runtime/callback-boundary.mjs";

const uuid = z.string().uuid();
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const scopes = z.array(z.string()).refine(value => JSON.stringify(value) === JSON.stringify(SQUARE_OAUTH_SCOPES));
const callbackUri = "https://square.vaeroex.com/api/integrations/square/callback";
const returnPath = "/app/settings/integrations/square";

/** Exact representation of the already-installed one-seller permit. This is
 * not permission: every RPC rechecks LOGIN, live session, membership, entity,
 * current configuration/generation, fences and expiry in migration 25. */
export const InternalPermitSchema = z.object({
  providerKey: z.literal("square"), environment: z.literal("production"),
  projectId: z.literal("vaeroex-integrations-prod"),
  permitId: uuid, workspaceId: uuid, businessEntityId: uuid, operatorId: uuid,
  operatorSessionId: uuid, generation: z.number().int().positive().safe(),
  configurationFingerprint: fingerprint, rowVersion: z.literal(1),
  applicationId: z.string().regex(/^sq0idp-[A-Za-z0-9_-]{1,184}$/),
  expectedMerchantId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/),
  expectedLocationId: z.string().regex(/^[A-Za-z0-9._:-]{1,32}$/),
  approvalExpiresAt: z.string().datetime(),
  runtimeEnabled: z.literal(false), providerCallsEnabled: z.literal(false),
  customerOnboardingEnabled: z.literal(false), webhookIntakeEnabled: z.literal(false),
  evidenceEnabled: z.literal(false), economicContributionsEnabled: z.literal(false),
  aiDispatchEnabled: z.literal(false)
}).strict();
export type InternalPermit = z.infer<typeof InternalPermitSchema>;
export type InternalActor = Readonly<{ actorId: string; sessionId: string; workspaceId: string; businessEntityId: string }>;
export type InternalRpc = (operation: string, payload: Record<string, unknown>) => Promise<unknown>;

export class InternalConsentError extends Error {
  constructor(readonly stage: "state_create" | "state_consume" | "exchange_acquire" | "provider_exchange" | "credential_commit" | "authority",
    readonly uncertain = false) {
    super(`square_internal_consent_${stage}_${uncertain ? "requires_reconciliation" : "denied"}`);
  }
}

/** Byte-for-byte migration 25's length-prefixed fingerprint contract. */
export function internalFingerprint(parts: readonly (string | number)[]) {
  const values = ["square-production-internal-runtime-v1", ...parts.map(String)];
  if (values.some(value => !/^[\x20-\x7e]*$/.test(value))) throw new InternalConsentError("authority");
  return `sha256:${createHash("sha256").update(values.map(value => `${value.length}:${value}`).join(""), "utf8").digest("hex")}`;
}

const ReceiptSchema = z.object({
  permitId: uuid, stateId: uuid, generation: z.number().int().positive().safe(),
  configurationFingerprint: fingerprint, consumeReceiptFingerprint: fingerprint,
  status: z.enum(["consumed", "replayed", "acquired", "stored", "uncertain"]),
  exchangeId: uuid.optional(), exchangeRequestFingerprint: fingerprint.optional(),
  exchangeReceiptFingerprint: fingerprint.optional(), credentialCommandFingerprint: fingerprint.nullable().optional(),
  applicationId: z.string().optional(), applicationSecretVersionResource: z.string().optional(),
  kmsKeyResource: z.string().optional(), requestedScopes: scopes.optional(),
  expectedMerchantId: z.string().optional(), expectedLocationId: z.string().optional(),
  auditFingerprint: fingerprint.optional(), replayed: z.boolean().optional()
}).strict();
export type InternalReceipt = z.infer<typeof ReceiptSchema>;
export type ExchangeInput = Readonly<{ stateId: string; consumeReceiptFingerprint: string;
  generation: number; configurationFingerprint: string; permitId: string; authorizationCode: string }>;

function checkedPermit(value: unknown, now: Date) {
  const permit = InternalPermitSchema.parse(value);
  if (!Number.isFinite(now.getTime()) || Date.parse(permit.approvalExpiresAt) <= now.getTime()) throw new InternalConsentError("authority");
  return permit;
}
function receipt(value: unknown, permit: InternalPermit, expected?: Partial<InternalReceipt>) {
  const result = ReceiptSchema.parse(value);
  if (result.permitId !== permit.permitId || result.generation !== permit.generation ||
    result.configurationFingerprint !== permit.configurationFingerprint ||
    Object.entries(expected ?? {}).some(([key, expectedValue]) => result[key as keyof InternalReceipt] !== expectedValue))
    throw new InternalConsentError("authority");
  return result;
}
function actorMatches(actor: InternalActor, permit: InternalPermit) {
  return actor.actorId === permit.operatorId && actor.sessionId === permit.operatorSessionId &&
    actor.workspaceId === permit.workspaceId && actor.businessEntityId === permit.businessEntityId;
}

/** Only OAuth LOGIN is installed in this service. Broker transport is a
 * server-owned, authenticated service capability; never a request-selected URL. */
export function createInternalOAuth(input: {
  permit: InternalPermit; oauthRpc: InternalRpc;
  brokerExchange(request: ExchangeInput): Promise<Readonly<{ status: "stored"; nonEconomic: true }>>;
  now?: () => Date;
}) {
  const now = input.now ?? (() => new Date());
  const permit = Object.freeze(InternalPermitSchema.parse(input.permit));
  const policy = createSquareOAuthPolicy({ environment: "production", applicationId: permit.applicationId, redirectUri: callbackUri, returnPath });
  return Object.freeze({
    async initiate(actor: InternalActor) {
      checkedPermit(permit, now());
      if (!actorMatches(actor, permit)) throw new InternalConsentError("authority");
      const state = randomBytes(32).toString("base64url"), stateId = randomUUID();
      const stateHash = createHash("sha256").update(state).digest("hex");
      const expiresAt = new Date(Math.min(now().getTime() + 9 * 60_000, Date.parse(permit.approvalExpiresAt))).toISOString();
      const requestFingerprint = internalFingerprint(["create-state-v1", permit.permitId, stateId, stateHash,
        actor.actorId, actor.sessionId, expiresAt, permit.rowVersion]);
      // No create retry: the applied contract intentionally has no create-state
      // reconciliation RPC. A lost response requires operator reconciliation.
      let result: unknown;
      try { result = await input.oauthRpc("create_state", { actorId: actor.actorId, sessionId: actor.sessionId,
        permitId: permit.permitId, stateId, stateHash, expiresAt, requestFingerprint }); }
      catch { throw new InternalConsentError("state_create", true); }
      const created = z.object({ permitId: uuid, stateId: uuid, state: z.literal("consent_pending"),
        expiresAt: z.string(), auditFingerprint: fingerprint }).strict().parse(result);
      if (created.permitId !== permit.permitId || created.stateId !== stateId || Date.parse(created.expiresAt) !== Date.parse(expiresAt))
        throw new InternalConsentError("state_create", true);
      return Object.freeze({ authorizationUrl: squareAuthorizationUrl({ policy, applicationId: permit.applicationId, state }), expiresAt });
    },
    async callback(request: { method: string; url: string; rawHeaders: string[] }) {
      checkedPermit(permit, now());
      const callback = parseSquareProductionCallbackHandoff(request);
      const stateHash = createHash("sha256").update(callback.state).digest("hex");
      if (callback.kind === "denied") {
        try {
          const denied = z.object({ status: z.literal("denied"), generation: z.number(), configurationFingerprint: fingerprint,
            denialReceiptFingerprint: fingerprint }).strict().parse(await input.oauthRpc("deny_state", {
            stateHash, denyRequestFingerprint: internalFingerprint(["deny-state-v1", stateHash])
          }));
          if (denied.generation !== permit.generation || denied.configurationFingerprint !== permit.configurationFingerprint)
            throw new InternalConsentError("authority");
          return Object.freeze({ status: "denied" as const });
        } catch { throw new InternalConsentError("state_consume", true); }
      }
      const payload = { stateHash, consumeRequestFingerprint: internalFingerprint(["consume-state-v2", stateHash]) };
      let consumed: InternalReceipt;
      try { consumed = receipt(await input.oauthRpc("consume_state", payload), permit); }
      catch {
        // Receipt lookup, not a second consume or code exchange.
        try { consumed = receipt(await input.oauthRpc("reconcile_state", payload), permit); }
        catch { throw new InternalConsentError("state_consume", true); }
      }
      if (consumed.status !== "consumed") throw new InternalConsentError("state_consume", true);
      try {
        return await input.brokerExchange({ permitId: permit.permitId, stateId: consumed.stateId,
          generation: permit.generation, configurationFingerprint: permit.configurationFingerprint,
          consumeReceiptFingerprint: consumed.consumeReceiptFingerprint, authorizationCode: callback.authorizationCode });
      } catch { throw new InternalConsentError("provider_exchange", true); }
    }
  });
}

export type BrokerDependencies = {
  permit: InternalPermit; brokerRpc: InternalRpc; transport: SquareOAuthTransport;
  applicationSecret(resource: string): Promise<ProviderApplicationSecret>;
  kms: Pick<CredentialKms, "encrypt">; now?: () => Date;
};

/** Broker holds the only application-secret/KMS capability. The DB exchange
 * latch commits before any credential/provider operation. There is no exchange
 * retry, refresh, revocation, scheduler, webhook, economic or AI dependency. */
export function createInternalBroker(input: BrokerDependencies) {
  const now = input.now ?? (() => new Date());
  const permit = Object.freeze(InternalPermitSchema.parse(input.permit));
  return Object.freeze({
    async exchange(value: ExchangeInput): Promise<Readonly<{ status: "stored"; nonEconomic: true }>> {
      checkedPermit(permit, now());
      const command = z.object({ stateId: uuid, consumeReceiptFingerprint: fingerprint, generation: z.number(),
        configurationFingerprint: fingerprint, permitId: uuid, authorizationCode: z.string().regex(/^[\x21-\x7e]{1,191}$/)
      }).strict().parse(value);
      if (command.permitId !== permit.permitId || command.generation !== permit.generation ||
        command.configurationFingerprint !== permit.configurationFingerprint) throw new InternalConsentError("authority");
      const acquire = { stateId: command.stateId, exchangeRequestFingerprint: internalFingerprint([
        "acquire-exchange-v1", command.stateId, command.consumeReceiptFingerprint
      ]) };
      const expected = { stateId: command.stateId, consumeReceiptFingerprint: command.consumeReceiptFingerprint,
        exchangeRequestFingerprint: acquire.exchangeRequestFingerprint };
      let acquired: InternalReceipt;
      try { acquired = receipt(await input.brokerRpc("acquire_exchange", acquire), permit, expected); }
      catch {
        try { acquired = receipt(await input.brokerRpc("reconcile_acquire", acquire), permit, expected); }
        catch { throw new InternalConsentError("exchange_acquire", true); }
      }
      if (acquired.status === "stored") return Object.freeze({ status: "stored", nonEconomic: true });
      if (acquired.status !== "acquired" || !acquired.exchangeId || !acquired.exchangeReceiptFingerprint ||
        acquired.applicationId !== permit.applicationId || acquired.expectedMerchantId !== permit.expectedMerchantId ||
        acquired.expectedLocationId !== permit.expectedLocationId || !acquired.requestedScopes ||
        !/^projects\/vaeroex-integrations-prod\/secrets\/square-production-application\/versions\/[1-9][0-9]*$/.test(acquired.applicationSecretVersionResource ?? "") ||
        !/^projects\/vaeroex-integrations-prod\/locations\/us-west1\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+$/.test(acquired.kmsKeyResource ?? ""))
        throw new InternalConsentError("exchange_acquire", true);
      const exchangeReceipt = { ...acquire, exchangeId: acquired.exchangeId, exchangeReceiptFingerprint: acquired.exchangeReceiptFingerprint };
      let reconciled = false;
      const reconcile = () => {
        if (reconciled) throw new InternalConsentError("credential_commit", true);
        reconciled = true;
        return input.brokerRpc("reconcile_exchange", exchangeReceipt);
      };
      let stage: "provider_exchange" | "credential_commit" = "provider_exchange";
      try {
        const policy = createSquareOAuthPolicy({ environment: "production", applicationId: permit.applicationId, redirectUri: callbackUri, returnPath });
        const provider = createSquareOAuthCredentialProvider({ policy, applicationId: permit.applicationId, transport: input.transport });
        const credential = await provider.exchangeAuthorizationCode({
          applicationSecret: await input.applicationSecret(acquired.applicationSecretVersionResource!),
          authorizationCode: command.authorizationCode, requestedScopes: acquired.requestedScopes,
          externalAuthorizedEntityReference: permit.expectedMerchantId, now: now()
        });
        const discovery = createSquareAccountDiscovery({ environment: "production", applicationId: permit.applicationId,
          readAuthenticated: request => readSquareAuthenticatedDiscovery({ ...request, transport: input.transport }), clock: now });
        await discovery.verify({ externalAuthorizedEntityReference: permit.expectedMerchantId,
          credential: new ProviderAccessCredential({ providerKey: "square", providerEnvironment: "production",
            accessExpiresAt: credential.accessExpiresAt, grantedScopes: credential.grantedScopes, accessToken: credential.accessToken }) });
        const seller = discovery.consumeVerifiedDiscovery();
        if (seller.merchantId !== permit.expectedMerchantId || seller.defaultLocationId !== permit.expectedLocationId ||
          !seller.locations.some(location => location.id === permit.expectedLocationId && location.status === "ACTIVE"))
          throw new InternalConsentError("authority");
        const credentialId = randomUUID(), credentialVersion = 1;
        const aadContext = { credentialId, credentialVersion: "1", environment: "production", generation: String(permit.generation),
          permitId: permit.permitId, projectId: "vaeroex-integrations-prod", providerKey: "square" };
        const aadDigest = internalFingerprint(["aad-v1", "square", "production", "vaeroex-integrations-prod",
          permit.generation, permit.permitId, credentialId, credentialVersion]);
        const plaintext = Buffer.from(canonicalContractJson(credential)), additionalAuthenticatedData = Buffer.from(canonicalContractJson(aadContext));
        let ciphertextBase64: string;
        try { ciphertextBase64 = Buffer.from(await input.kms.encrypt({ keyResource: acquired.kmsKeyResource!, plaintext, additionalAuthenticatedData })).toString("base64"); }
        finally { plaintext.fill(0); additionalAuthenticatedData.fill(0); }
        const externalEntityFingerprint = internalFingerprint(["external-entity-v1", seller.merchantId, seller.defaultLocationId]);
        const commandFingerprint = internalFingerprint(["credential-command-v1", command.stateId, acquired.exchangeId,
          acquired.exchangeReceiptFingerprint, credentialId, credentialVersion, internalFingerprint(["ciphertext-v1", ciphertextBase64]),
          aadDigest, externalEntityFingerprint, credential.issuedAt, credential.accessExpiresAt, credential.grantedScopes.join(",")]);
        const payload = { aadContext, aadDigest, accessExpiresAt: credential.accessExpiresAt, ciphertextBase64, commandFingerprint,
          credentialId, credentialVersion, exchangeId: acquired.exchangeId, exchangeReceiptFingerprint: acquired.exchangeReceiptFingerprint,
          externalEntityFingerprint, grantedScopes: credential.grantedScopes, locationId: seller.defaultLocationId,
          merchantId: seller.merchantId, providerIssuedAt: credential.issuedAt, stateId: command.stateId };
        stage = "credential_commit";
        let committed: InternalReceipt;
        try { committed = receipt(await input.brokerRpc("commit_credential", payload), permit, { ...expected,
          exchangeId: acquired.exchangeId, exchangeReceiptFingerprint: acquired.exchangeReceiptFingerprint, credentialCommandFingerprint: commandFingerprint }); }
        catch { committed = receipt(await reconcile(), permit, { ...expected,
          exchangeId: acquired.exchangeId, exchangeReceiptFingerprint: acquired.exchangeReceiptFingerprint, credentialCommandFingerprint: commandFingerprint }); }
        if (committed.status !== "stored") throw new InternalConsentError("credential_commit", true);
        return Object.freeze({ status: "stored", nonEconomic: true });
      } catch {
        // The only post-provider recovery is the existing receipt/fencing RPC.
        // No retry or reconstruction of a possibly-issued provider token.
        if (!reconciled) try { await reconcile(); } catch { /* Fixed outward state; no raw diagnostics. */ }
        throw new InternalConsentError(stage, true);
      }
    }
  });
}

/** Transport boundary for the existing OAuth Cloud Run service. A null permit
 * installs no runtime capability. Public customer routes remain unchanged.
 * The private connect route requires the existing account/session authority;
 * the callback accepts only the reviewed managed-edge handoff. */
export function createInternalOAuthHandler(input: {
  runtime: ReturnType<typeof createInternalOAuth> | null;
  authenticate(request: Request): Promise<InternalActor | null>;
}) {
  return async (request: Request, rawHeaders: string[] = []): Promise<Response> => {
    const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
    if (!input.runtime) return Response.json({ error: "production_integration_runtime_disabled" }, { status: 404, headers });
    try {
      const url = new URL(request.url);
      if (request.method === "POST" && url.origin === "https://square.vaeroex.com" &&
        url.pathname === "/api/integrations/square/connect" && !url.search) {
        const actor = await input.authenticate(request);
        if (!actor || request.body !== null) throw new InternalConsentError("authority");
        return Response.json(await input.runtime.initiate(actor), { headers });
      }
      if (request.method === "GET" && url.pathname === SQUARE_CALLBACK_PATH && !url.search) {
        const result = await input.runtime.callback({ method: request.method, url: url.pathname, rawHeaders });
        return Response.json(result, { headers });
      }
    } catch { return Response.json({ error: "square_internal_consent_requires_reconciliation" }, { status: 409, headers }); }
    return Response.json({ error: "production_integration_runtime_disabled" }, { status: 404, headers });
  };
}
