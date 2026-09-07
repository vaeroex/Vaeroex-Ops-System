import "server-only";

import { randomUUID } from "node:crypto";
import { isProxy } from "node:util/types";
import { z } from "zod";
import { IsoTimestampSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import {
  IntegrationCredentialBroker,
  type CredentialBrokerStore,
  type ProviderSecretStore
} from "@/lib/integrations/credentials/broker";
import {
  CreateOAuthStateCommandSchema,
  CredentialRefreshResultSchema,
  OAuthStateConsumeResultSchema,
  type CredentialRefreshResult
} from "@/lib/integrations/credentials/contracts";
import type { CredentialKms } from "@/lib/integrations/credentials/kms";
import { oauthStateHash } from "@/lib/integrations/credentials/oauth-state";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { createSquareAccountDiscovery } from "@/lib/integrations/providers/square/account-discovery";
import { createSquareAccountMapping } from "@/lib/integrations/providers/square/account-mapping";
import {
  createSquareAccountBrokerStore,
  squareAccountRpc
} from "@/lib/integrations/providers/square/account-connection-broker";
import {
  SquareAccountContextSchema,
  SquareConnectionViewSchema,
  type SquareAccountContext,
  type SquareConnectionActor,
  type SquareConnectionService,
  type SquareConnectionView
} from "@/lib/integrations/providers/square/account-connection-contracts";
import {
  createSquareOAuthCredentialProvider,
  createSquareOAuthPolicy,
  readSquareAuthenticatedDiscovery,
  revokeSquareMerchant,
  squareAuthorizationUrl,
  SQUARE_OAUTH_SCOPES,
  verifySquareRevocationNotification,
  type SquareOAuthTransport
} from "@/lib/integrations/providers/square/account-connection-oauth";
import {
  snapshotSquareDurableJson,
  type SquareDurableJsonLimits
} from "@/lib/integrations/providers/square/durable-contracts";

const RETURN_PATH = "/app/settings/integrations/square";
const SMALL_LIMITS: SquareDurableJsonLimits = Object.freeze({
  containers: 16, values: 96, bytes: 16_384, depth: 5,
  arrayLength: 5, properties: 24, stringLength: 2_048
});
const INPUT_LIMITS: SquareDurableJsonLimits = Object.freeze({
  containers: 2, values: 505, bytes: 32_768, depth: 2,
  arrayLength: 500, properties: 4, stringLength: 191
});
const VersionSchema = z.number().int().positive().safe();
const ConnectionIdSchema = z.object({ connectionId: UuidSchema }).strict();
const InitiateSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("connect"), businessEntityId: UuidSchema }).strict(),
  z.object({ operation: z.literal("reauthorize"), businessEntityId: UuidSchema, connectionId: UuidSchema }).strict()
]);
const CallbackSchema = z.union([
  z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    code: z.string().min(1).max(191).refine(value => !/[\u0000-\u0020\u007f]/.test(value)) }).strict(),
  z.object({ state: z.string().regex(/^[A-Za-z0-9_-]{43}$/), error: z.literal("access_denied") }).strict()
]);
const PreparedSchema = z.object({
  connectionId: UuidSchema, businessEntityId: UuidSchema, generation: VersionSchema, rowVersion: VersionSchema
}).strict();
const LookupSchema = z.discriminatedUnion("accepted", [
  z.object({ accepted: z.literal(true), command: CreateOAuthStateCommandSchema, rowVersion: VersionSchema }).strict(),
  z.object({ accepted: z.literal(false), reasonCode: z.enum(["state_missing", "state_invalid", "state_expired", "state_replayed"]) }).strict()
]);
const DeniedStateSchema = z.object({ accepted: z.literal(true) }).strict();
const MappingResultSchema = z.object({ confirmed: z.literal(true), generation: VersionSchema }).strict();
const EnrolledSchema = z.object({ enrolled: z.literal(true), generation: VersionSchema, idempotent: z.boolean() }).strict();
const DisconnectSchema = z.object({ connectionId: UuidSchema, confirmation: z.literal("disconnect") }).strict();
const FencedSchema = z.object({ fenced: z.literal(true) }).strict();
const EmptySchema = z.object({}).strict();
const RevocationLeaseSchema = z.discriminatedUnion("acquired", [
  z.object({ acquired: z.literal(false) }).strict(),
  z.object({ acquired: z.literal(true), connectionId: UuidSchema, generation: VersionSchema,
    rowVersion: VersionSchema, merchantId: z.string().min(1).max(191).regex(/^[A-Za-z0-9._:-]+$/),
    leaseId: UuidSchema, expiresAt: IsoTimestampSchema }).strict()
]);
const MetadataSchema = z.object({ connectionId: UuidSchema, businessEntityId: UuidSchema,
  generation: VersionSchema, credentialId: UuidSchema, credentialVersion: VersionSchema }).strict();
const NotificationResultSchema = z.object({ accepted: z.literal(true), replayed: z.boolean() }).strict();

function denied(): never { throw new Error("square_account_connection_denied"); }
function checkSignal(signal?: AbortSignal) { if (signal?.aborted) denied(); }
function checked<T>(schema: z.ZodType<T>, value: unknown, limits = SMALL_LIMITS): T {
  const safe = snapshotSquareDurableJson(value, limits);
  schema.parse(safe);
  // These schemas have no transforms/defaults. Preserve the bounded, deeply frozen
  // snapshot rather than exposing a second mutable object graph produced by Zod.
  return safe as T;
}
function property(value: unknown, name: string): unknown {
  if (!value || typeof value !== "object" || isProxy(value)) denied();
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !("value" in descriptor)) denied();
  return descriptor.value;
}

/** The enrollment and webhook LOGIN capabilities are intentionally separate from
 * account persistence. This helper permits only those two fixed checked RPCs and
 * never exposes raw SQL/provider errors or traverses an unbounded result for Zod.
 */
async function separateRpc(client: ExternalIntegrationsRpcClient | undefined,
  name: "enroll_square_verified_connection_v1" | "record_square_account_revocation_v1",
  args: Record<string, unknown>): Promise<unknown> {
  if (!client || isProxy(client) || typeof client.rpc !== "function" || isProxy(client.rpc)) denied();
  const bounded = snapshotSquareDurableJson(args, SMALL_LIMITS) as Record<string, unknown>;
  const result = await client.rpc(name, bounded);
  if (property(result, "error") !== null) denied();
  return snapshotSquareDurableJson(property(result, "data"), SMALL_LIMITS);
}

export type SquareAccountConnectionService = SquareConnectionService & Readonly<{
  refresh(actor: SquareConnectionActor, connectionId: string, signal?: AbortSignal): Promise<CredentialRefreshResult>;
  retryRevocation(actor: SquareConnectionActor, connectionId: string, signal?: AbortSignal): Promise<void>;
  handleRevocationNotification(input: Readonly<{
    rawBody: Uint8Array | string; signature: string; notificationUrl: string; signatureKey: string;
  }>): Promise<void>;
}>;

/** Dormant, injection-only orchestration. No fetch, default secret/DB client,
 * deployment gate override, credential purge, business sync or automatic task
 * creation lives here. Every callback gets a fresh verifier and broker store.
 */
export function createSquareAccountConnectionService(input: Readonly<{
  client: ExternalIntegrationsRpcClient;
  enrollmentClient: ExternalIntegrationsRpcClient;
  webhookClient?: ExternalIntegrationsRpcClient;
  environment: "sandbox" | "production";
  applicationId: string;
  redirectUri: string;
  secrets: ProviderSecretStore;
  kms: CredentialKms;
  kmsKeyResource: string;
  transport: SquareOAuthTransport;
  clock?: () => Date;
}>): SquareAccountConnectionService {
  const { client, enrollmentClient, webhookClient, environment, applicationId, redirectUri,
    secrets, kms, kmsKeyResource, transport } = input;
  const clock = input.clock ?? (() => new Date());
  let policy: ReturnType<typeof createSquareOAuthPolicy>;
  try { policy = createSquareOAuthPolicy({ environment, applicationId, redirectUri, returnPath: RETURN_PATH }); }
  catch { return denied(); }
  const contextFor = (actor: SquareConnectionActor): SquareAccountContext =>
    checked(SquareAccountContextSchema, { actor, environment, applicationId, redirectUri });
  const brokerFor = (store: CredentialBrokerStore, signal?: AbortSignal,
    verifier?: ReturnType<typeof createSquareAccountDiscovery>) => new IntegrationCredentialBroker({
    store, kms, kmsKeyResource, secrets, clock, providerOAuthPolicy: policy,
    provider: createSquareOAuthCredentialProvider({ policy, applicationId, transport, signal }),
    ...(verifier ? { authorizedEntityVerifier: verifier } : {})
  });

  async function retry(context: SquareAccountContext, connectionId: string, signal?: AbortSignal) {
    const lease = checked(RevocationLeaseSchema, await squareAccountRpc(client, context, "acquire_revocation", { connectionId }));
    if (!lease.acquired) return;
    if (lease.connectionId !== connectionId) denied();
    let outcome: "succeeded" | "failed" = "failed";
    try {
      checkSignal(signal);
      const applicationSecret = await secrets.access("square", environment);
      checkSignal(signal);
      await revokeSquareMerchant({ environment, applicationId, merchantId: lease.merchantId,
        applicationSecret, transport, signal });
      outcome = "succeeded";
    } catch {
      // Revocation failure/cancellation does not reopen local authority or purge
      // ciphertext. Persist the bounded retry outcome even if the request aborted.
    }
    checked(EmptySchema, await squareAccountRpc(client, context, "complete_revocation", {
      connectionId, generation: lease.generation, rowVersion: lease.rowVersion, leaseId: lease.leaseId, outcome
    }));
  }

  return Object.freeze({
    async initiate(actor, value, signal) {
      try {
        checkSignal(signal);
        const context = contextFor(actor), command = checked(InitiateSchema, value, INPUT_LIMITS);
        const connectionId = command.operation === "connect" ? randomUUID() : command.connectionId;
        const prepared = checked(PreparedSchema, await squareAccountRpc(client, context, "prepare", {
          connectionId, businessEntityId: command.businessEntityId, operation: command.operation
        }));
        if (prepared.connectionId !== connectionId || prepared.businessEntityId !== command.businessEntityId) denied();
        checkSignal(signal);
        const broker = brokerFor(createSquareAccountBrokerStore({ client, context }), signal);
        const authorization = await broker.beginAuthorization({
          workspaceId: context.actor.workspaceId, businessEntityId: prepared.businessEntityId,
          connectionId, connectionGeneration: prepared.generation, providerKey: "square",
          providerEnvironment: environment, initiatedBy: context.actor.actorId,
          requestedScopes: SQUARE_OAUTH_SCOPES, returnIntent: RETURN_PATH, requestId: randomUUID()
        });
        checkSignal(signal);
        return Object.freeze({ authorizationUrl: squareAuthorizationUrl({ policy, applicationId, state: authorization.state }) });
      } catch { return denied(); }
    },

    async complete(actor, value, signal) {
      try {
        checkSignal(signal);
        const context = contextFor(actor), callback = checked(CallbackSchema, value, INPUT_LIMITS);
        const stateHash = oauthStateHash(callback.state);
        const lookup = checked(LookupSchema, await squareAccountRpc(client, context, "lookup_state", { stateHash }));
        if (!lookup.accepted) denied();
        const command = lookup.command;
        if (command.workspaceId !== context.actor.workspaceId || command.initiatedBy !== context.actor.actorId ||
          command.providerKey !== "square" || command.providerEnvironment !== environment || command.stateHash !== stateHash ||
          command.returnIntent !== RETURN_PATH || command.requestedScopes.length !== SQUARE_OAUTH_SCOPES.length ||
          command.requestedScopes.some((scope, index) => scope !== SQUARE_OAUTH_SCOPES[index])) denied();
        checkSignal(signal);
        if ("error" in callback) {
          checked(DeniedStateSchema, await squareAccountRpc(client, context, "deny_state", { stateHash }));
          return;
        }
        const discovery = createSquareAccountDiscovery({ environment, applicationId, clock, signal,
          readAuthenticated: request => readSquareAuthenticatedDiscovery({ ...request, transport }) });
        const baseStore = createSquareAccountBrokerStore({ client, context,
          consumeVerifiedDiscovery: () => discovery.consumeVerifiedDiscovery() });
        let consumedHere = false;
        const store: CredentialBrokerStore = Object.freeze({ ...baseStore,
          async consumeOAuthState(consume, requestId) {
            checkSignal(signal);
            const result = checked(OAuthStateConsumeResultSchema, await baseStore.consumeOAuthState(consume, requestId));
            consumedHere = result.accepted;
            return result;
          },
          async storeCredential(credential, requestId) {
            checkSignal(signal);
            return baseStore.storeCredential(credential, requestId);
          }
        });
        try {
          await brokerFor(store, signal, discovery).completeAuthorization({
            state: callback.state, authorizationCode: callback.code,
            workspaceId: command.workspaceId, businessEntityId: command.businessEntityId,
            connectionId: command.connectionId, connectionGeneration: command.connectionGeneration,
            expectedConnectionRowVersion: lookup.rowVersion, providerKey: "square", providerEnvironment: environment,
            initiatedBy: command.initiatedBy, requestedScopes: command.requestedScopes, returnIntent: RETURN_PATH,
            consumeRequestId: randomUUID(), storeRequestId: randomUUID()
          });
        } catch {
          // A losing concurrent callback cannot mark the winning attempt uncertain.
          // SQL additionally fences this exact state, actor/session and generation;
          // a committed store or a newer generation is never undone after a lost ACK.
          if (consumedHere) {
            try { checked(EmptySchema, await squareAccountRpc(client, context, "authorization_failed", {
              connectionId: command.connectionId, connectionGeneration: command.connectionGeneration, oauthStateId: command.id
            })); } catch { /* State remains closed; never retry the authorization code. */ }
          }
          denied();
        }
      } catch { return denied(); }
    },

    async snapshot(actor): Promise<SquareConnectionView> {
      try {
        // The shared RPC applies the derived full view bound before this schema.
        const value = await squareAccountRpc(client, contextFor(actor), "status", {});
        SquareConnectionViewSchema.parse(value);
        return value as SquareConnectionView;
      } catch { return denied(); }
    },

    async confirmMapping(actor, value) {
      try {
        const context = contextFor(actor);
        const command = snapshotSquareDurableJson(value, INPUT_LIMITS) as Parameters<SquareConnectionService["confirmMapping"]>[1];
        const mapped = checked(MappingResultSchema, await createSquareAccountMapping({ client, context }).confirm(command));
        // No synthetic enrollment flag or ordinary broker LOGIN can satisfy this
        // separate capability. Mapping confirmation alone never creates authority.
        const enrolled = checked(EnrolledSchema, await separateRpc(enrollmentClient, "enroll_square_verified_connection_v1", {
          p_context: context, p_command: { connectionId: command.connectionId, generation: mapped.generation }
        }));
        if (enrolled.generation !== mapped.generation) denied();
      } catch { return denied(); }
    },

    async disconnect(actor, value, signal) {
      try {
        const context = contextFor(actor), command = checked(DisconnectSchema, value, INPUT_LIMITS);
        // Always finish the local merchant-wide fence before accessing a provider
        // secret. Even cancellation/provider failure leaves local reads closed.
        checked(FencedSchema, await squareAccountRpc(client, context, "disconnect", command));
        await retry(context, command.connectionId, signal);
      } catch { return denied(); }
    },

    async retryRevocation(actor, connectionId, signal) {
      try {
        const context = contextFor(actor), command = checked(ConnectionIdSchema, { connectionId });
        await retry(context, command.connectionId, signal);
      } catch { return denied(); }
    },

    async refresh(actor, connectionId, signal) {
      try {
        checkSignal(signal);
        const context = contextFor(actor), command = checked(ConnectionIdSchema, { connectionId });
        const metadata = checked(MetadataSchema, await squareAccountRpc(client, context, "credential_metadata", command));
        if (metadata.connectionId !== command.connectionId) denied();
        const baseStore = createSquareAccountBrokerStore({ client, context });
        const store: CredentialBrokerStore = Object.freeze({ ...baseStore,
          async rotateCredential(credential, requestId) {
            checkSignal(signal);
            return baseStore.rotateCredential(credential, requestId);
          }
        });
        const result = await brokerFor(store, signal).refreshCredential({
          workspaceId: context.actor.workspaceId, businessEntityId: metadata.businessEntityId,
          connectionId: metadata.connectionId, connectionGeneration: metadata.generation,
          credentialId: metadata.credentialId, expectedCredentialVersion: metadata.credentialVersion,
          requiredScopes: SQUARE_OAUTH_SCOPES, workerId: randomUUID(), acquireRequestId: randomUUID(),
          rotateRequestId: randomUUID(), failureRequestId: randomUUID()
        });
        return checked(CredentialRefreshResultSchema, result);
      } catch { return denied(); }
    },

    async handleRevocationNotification(notification) {
      try {
        // The ephemeral key and raw body never enter persistence. SQL accepts only
        // minimized authenticated evidence, deduplicates it and fences matching uses.
        const event = verifySquareRevocationNotification({ ...notification, environment, applicationId });
        checked(NotificationResultSchema, await separateRpc(webhookClient, "record_square_account_revocation_v1", {
          p_environment: environment, p_application_id: applicationId, p_event: event
        }));
      } catch { return denied(); }
    }
  });
}
