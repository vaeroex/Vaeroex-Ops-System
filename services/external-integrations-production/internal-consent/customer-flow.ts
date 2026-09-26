import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { ProviderAccessCredential } from "@/lib/integrations/credentials/broker";
import { CredentialEnvelopeSchema } from "@/lib/integrations/credentials/contracts";
import type { CredentialKms } from "@/lib/integrations/credentials/kms";
import type { ProviderApplicationSecret } from "@/lib/integrations/credentials/secret-manager";
import { oauthStateHash } from "@/lib/integrations/credentials/oauth-state";
import { createSquareAccountDiscovery } from "@/lib/integrations/providers/square/account-discovery";
import { createSquareOAuthCredentialProvider, createSquareOAuthPolicy, readSquareAuthenticatedDiscovery,
  SQUARE_OAUTH_SCOPES, type SquareOAuthTransport } from "@/lib/integrations/providers/square/account-connection-oauth";
import { parseSquareProductionCallbackHandoff } from "../bootstrap-runtime/callback-boundary.mjs";

const uuid = z.string().uuid();
const positive = z.number().int().positive().safe();
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const callbackUri = "https://square.vaeroex.com/api/integrations/square/callback";
const returnPath = "/app/settings/integrations/square";
const StateSchema = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(false) }).strict(),
  z.object({ accepted: z.literal(true), stateId: uuid, actorId: uuid, sessionId: uuid, workspaceId: uuid,
    connectionId: uuid, businessEntityId: uuid, generation: positive, rowVersion: positive,
    applicationId: z.string(), configurationFingerprint: fingerprint }).strict()
]);
const ConsumedSchema = z.object({ status: z.enum(["acquired", "replayed"]), stateId: uuid,
  connectionId: uuid, generation: positive }).strict();
const DeniedSchema = z.object({ accepted: z.literal(true) }).strict();
const SellerSchema = z.object({ status: z.literal("stored"), nonEconomic: z.literal(true) }).strict();
const AcquiredSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("acquired"), stateId: uuid, connectionId: uuid, workspaceId: uuid,
    businessEntityId: uuid, actorId: uuid, sessionId: uuid, generation: positive,
    configurationFingerprint: fingerprint, applicationId: z.string(),
    kmsKeyResource: z.string().regex(/^projects\/vaeroex-integrations-prod\/locations\/us-west1\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+$/) }).strict(),
  z.object({ status: z.literal("replayed"), stateId: uuid, connectionId: uuid, generation: positive }).strict(),
  z.object({ status: z.literal("stored"), stateId: uuid, connectionId: uuid, generation: positive }).strict()
]);
const CommittedSchema = z.object({ status: z.literal("stored"), connectionId: uuid, generation: positive,
  replayed: z.boolean() }).strict();

export type CustomerRpc = (operation: "lookup_state" | "consume_state" | "deny_state" |
  "authorization_failed", payload: Record<string, unknown>) => Promise<unknown>;
export type CustomerExchange = Readonly<{ stateId: string; connectionId: string; generation: number;
  actorId: string; sessionId: string; workspaceId: string; businessEntityId: string;
  applicationId: string; configurationFingerprint: string; authorizationCode: string }>;
export type CustomerBrokerRpc = (operation: "acquire_exchange" | "authorize_exchange" | "commit_credential",
  payload: Record<string, unknown>) => Promise<unknown>;

/** Same ordered, length-prefixed SHA-256 construction as the reviewed private
 * provider-neutral fingerprint helper. No token, code or raw provider payload
 * is put in a fingerprint or observable error.
 */
export function customerFingerprint(parts: readonly (string | number)[]) {
  const values = parts.map(String);
  if (values.some(value => !/^[\x20-\x7e]*$/.test(value))) throw new Error("square_customer_contract_denied");
  return `sha256:${createHash("sha256").update(values.map(value => `${value.length}:${value}`).join(""), "utf8").digest("hex")}`;
}

function denied(): never { throw new Error("square_customer_consent_requires_reconciliation"); }

/** This is a separate customer authority from migration 25's one-seller
 * permit. SQL owns live session, owner, entity, generation and replay checks;
 * this layer never converts caller-supplied IDs into database authority.
 */
export function createProductionCustomerOAuth(input: Readonly<{
  applicationId: string; rpc: CustomerRpc; exchange(command: CustomerExchange): Promise<unknown>; now?: () => Date;
}>) {
  createSquareOAuthPolicy({ environment: "production", applicationId: input.applicationId,
    redirectUri: callbackUri, returnPath });
  return Object.freeze({
    async callback(request: { method: string; url: string; rawHeaders: string[] }) {
      try {
        const parsed = parseSquareProductionCallbackHandoff(request);
        const stateHash = oauthStateHash(parsed.state);
        const state = StateSchema.parse(await input.rpc("lookup_state", { stateHash }));
        if (!state.accepted || state.applicationId !== input.applicationId) denied();
        if (parsed.kind === "denied") {
          DeniedSchema.parse(await input.rpc("deny_state", { stateHash }));
          return Object.freeze({ status: "denied" as const });
        }
        const consumed = ConsumedSchema.parse(await input.rpc("consume_state", { stateHash,
          requestFingerprint: customerFingerprint(["square-production-customer-consume-v1", state.stateId, stateHash, state.generation]) }));
        if (consumed.status !== "acquired" || consumed.stateId !== state.stateId ||
          consumed.connectionId !== state.connectionId || consumed.generation !== state.generation) denied();
        let result: z.infer<typeof SellerSchema>;
        try {
          result = SellerSchema.parse(await input.exchange({ stateId: state.stateId, connectionId: state.connectionId,
            generation: state.generation, actorId: state.actorId, sessionId: state.sessionId, workspaceId: state.workspaceId,
            businessEntityId: state.businessEntityId, applicationId: state.applicationId,
            configurationFingerprint: state.configurationFingerprint, authorizationCode: parsed.authorizationCode }));
        } catch {
          // After a failed or lost broker acknowledgement, only the checked
          // state fence runs. A committed credential is not undone; an
          // exchanging state becomes recovery_required. Never exchange again.
          try { await input.rpc("authorization_failed", { stateId: state.stateId }); } catch { /* Keep fixed outward error. */ }
          denied();
        }
        return Object.freeze(result);
      } catch { return denied(); }
    }
  });
}

/** A broker request is only sent by the authenticated OAuth service after the
 * callback's atomic state consumption. Its own SQL acquisition is a second
 * one-shot latch before any provider call. The broker never trusts the request
 * as seller authority: authenticated Square token status and discovery prove
 * the merchant and active location before an encrypted-only commit.
 */
export function createProductionCustomerBroker(input: Readonly<{
  applicationId: string; rpc: CustomerBrokerRpc; transport(authorize: () => Promise<void>): SquareOAuthTransport;
  applicationSecret(): Promise<ProviderApplicationSecret>;
  kms: Pick<CredentialKms, "encrypt">; now?: () => Date;
}>) {
  const policy = createSquareOAuthPolicy({ environment: "production", applicationId: input.applicationId,
    redirectUri: callbackUri, returnPath });
  const now = input.now ?? (() => new Date());
  return Object.freeze({ async exchange(raw: CustomerExchange) {
    let stage: "acquire" | "provider" | "commit" = "acquire";
    try {
      const command = z.object({ stateId: uuid, connectionId: uuid, generation: positive,
        actorId: uuid, sessionId: uuid, workspaceId: uuid, businessEntityId: uuid,
        applicationId: z.string(), configurationFingerprint: fingerprint,
        authorizationCode: z.string().min(1).max(191).regex(/^[\x21-\x7e]+$/) }).strict().parse(raw);
      if (command.applicationId !== input.applicationId) denied();
      const acquired = AcquiredSchema.parse(await input.rpc("acquire_exchange", { stateId: command.stateId,
        requestFingerprint: customerFingerprint(["square-production-customer-acquire-v1",
          command.stateId, command.connectionId, command.generation]) }));
      if (acquired.status !== "acquired" || acquired.stateId !== command.stateId ||
        acquired.connectionId !== command.connectionId || acquired.generation !== command.generation ||
        acquired.actorId !== command.actorId || acquired.sessionId !== command.sessionId ||
        acquired.workspaceId !== command.workspaceId || acquired.businessEntityId !== command.businessEntityId ||
        acquired.applicationId !== input.applicationId ||
        acquired.configurationFingerprint !== command.configurationFingerprint) denied();
      stage = "provider";
      const transport = input.transport(async () => {
        const checked = z.object({ authorized: z.literal(true), stateId: uuid,
          connectionId: uuid, generation: positive }).strict().parse(await input.rpc("authorize_exchange", {
          stateId: acquired.stateId, connectionId: acquired.connectionId, generation: acquired.generation,
          requestFingerprint: customerFingerprint(["square-production-customer-acquire-v1",
            acquired.stateId, acquired.connectionId, acquired.generation])
        }));
        if (checked.stateId !== acquired.stateId || checked.connectionId !== acquired.connectionId ||
          checked.generation !== acquired.generation) denied();
      });
      const provider = createSquareOAuthCredentialProvider({ policy, applicationId: input.applicationId,
        transport });
      const credential = CredentialEnvelopeSchema.parse(await provider.exchangeAuthorizationCode({
        applicationSecret: await input.applicationSecret(), authorizationCode: command.authorizationCode,
        requestedScopes: SQUARE_OAUTH_SCOPES, now: now()
      }));
      if (typeof credential.externalAuthorizedEntityReference !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(credential.externalAuthorizedEntityReference)) denied();
      const discovery = createSquareAccountDiscovery({ environment: "production", applicationId: input.applicationId,
        readAuthenticated: request => readSquareAuthenticatedDiscovery({ ...request, transport }), clock: now });
      await discovery.verify({ externalAuthorizedEntityReference: credential.externalAuthorizedEntityReference,
        credential: new ProviderAccessCredential({ providerKey: "square", providerEnvironment: "production",
          accessExpiresAt: credential.accessExpiresAt, grantedScopes: credential.grantedScopes,
          accessToken: credential.accessToken }) });
      const seller = discovery.consumeVerifiedDiscovery();
      if (seller.merchantId !== credential.externalAuthorizedEntityReference ||
        !seller.locations.some(location => location.id === seller.defaultLocationId && location.status === "ACTIVE")) denied();
      const credentialId = randomUUID(), credentialVersion = 1;
      const aadContext = { providerKey: "square", environment: "production", projectId: "vaeroex-integrations-prod",
        workspaceId: acquired.workspaceId, connectionId: acquired.connectionId, generation: acquired.generation,
        credentialId, credentialVersion };
      const aadDigest = customerFingerprint(["square-production-customer-aad-v1", acquired.workspaceId,
        acquired.connectionId, acquired.generation, credentialId, credentialVersion]);
      const plaintext = Buffer.from(canonicalContractJson(credential)), additionalAuthenticatedData = Buffer.from(canonicalContractJson(aadContext));
      let ciphertextBase64: string;
      try { ciphertextBase64 = Buffer.from(await input.kms.encrypt({ keyResource: acquired.kmsKeyResource,
        plaintext, additionalAuthenticatedData })).toString("base64"); }
      finally { plaintext.fill(0); additionalAuthenticatedData.fill(0); }
      stage = "commit";
      const committed = CommittedSchema.parse(await input.rpc("commit_credential", {
        stateId: acquired.stateId, requestFingerprint: customerFingerprint(["square-production-customer-commit-v1",
          acquired.stateId, credentialId, credentialVersion, aadDigest, seller.merchantId]),
        credentialId, credentialVersion, ciphertextBase64, aadContext, aadDigest,
        kmsKeyResource: acquired.kmsKeyResource, merchantId: seller.merchantId,
        merchantLabel: seller.merchantLabel, scopes: credential.grantedScopes,
        providerIssuedAt: credential.issuedAt, accessExpiresAt: credential.accessExpiresAt
      }));
      if (committed.connectionId !== acquired.connectionId || committed.generation !== acquired.generation || committed.replayed) denied();
      return Object.freeze({ status: "stored" as const, nonEconomic: true as const });
    } catch {
      // No code exchange, provider discovery, encrypt or database commit is
      // retried after uncertainty. A distinct checked recovery procedure must
      // reconcile the durable state; outward errors carry no sensitive values.
      throw new Error(`square_customer_${stage}_requires_reconciliation`);
    }
  } });
}
