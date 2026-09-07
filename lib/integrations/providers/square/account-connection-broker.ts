import "server-only";

import { isProxy } from "node:util/types";
import { z } from "zod";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { Sha256FingerprintSchema } from "@/lib/integrations/contracts/primitives";
import type { CredentialBrokerStore } from "@/lib/integrations/credentials/broker";
import {
  AcquireRefreshLeaseCommandSchema,
  AuthorizationAuditEventSchema,
  CompleteRefreshFailureCommandSchema,
  ConsumeOAuthStateCommandSchema,
  CreateOAuthStateCommandSchema,
  CredentialMutationResultSchema,
  CredentialRefreshBoundaryEventSchema,
  OAuthStateConsumeResultSchema,
  ProviderCredentialReadFailureEvidenceResultSchema,
  ProviderCredentialReadResultSchema,
  ReadProviderCredentialCommandSchema,
  RecordProviderCredentialReadFailureCommandSchema,
  RefreshLeaseResultSchema,
  RotateCredentialCommandSchema,
  StoreCredentialCommandSchema
} from "@/lib/integrations/credentials/contracts";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import {
  SquareAccountContextSchema,
  SquareVerifiedDiscoverySchema,
  type SquareAccountContext,
  type SquareVerifiedDiscovery
} from "@/lib/integrations/providers/square/account-connection-contracts";
import {
  snapshotSquareDurableJson,
  type SquareDurableJsonLimits
} from "@/lib/integrations/providers/square/durable-contracts";

const OperationSchema = z.enum([
  "status", "prepare", "create_state", "lookup_state", "consume_state", "deny_state",
  "store_credential", "authorization_failed", "confirm_mapping", "disconnect",
  "acquire_revocation", "complete_revocation", "credential_metadata", "acquire_refresh",
  "rotate_credential", "fail_refresh", "audit", "refresh_boundary", "read_credential", "read_failure"
]);
export type SquareAccountOperation = z.infer<typeof OperationSchema>;

const CONTEXT_LIMITS: SquareDurableJsonLimits = Object.freeze({
  containers: 2, values: 9, bytes: 16_384, depth: 2, arrayLength: 0, properties: 4, stringLength: 2_048
});
/** Store wrapper + credential/scopes + discovery/locations + <=500 location
 * objects fit these conservative schema bounds. 500 labels at six escaped bytes
 * per UTF16 unit, 32-character IDs, fixed metadata and maximum ciphertext131072
 * together fit below2MiB, even though ordinary ciphertext/discovery is much smaller.
 * Ciphertext strings use the existing131,072-character contract, not cursor limits.
 */
const COMMAND_LIMITS: SquareDurableJsonLimits = Object.freeze({
  containers: 1_050, values: 5_000, bytes: 2_097_152, depth: 8,
  arrayLength: 1_000, properties: 64, stringLength: 131_072
});
const RESULT_LIMITS: SquareDurableJsonLimits = Object.freeze({ ...COMMAND_LIMITS, bytes: 2_097_152 });
/** Let E<=1000 entities,C<=32 connections,L<=500 locations and mapped IDs each.
 * Containers:3+E+C*(3+L)<=17099. Values:4+3E+C*(9+4L)<=67292.
 * Even six escaped bytes per255-unit label,32-character IDs/mapping copies and
 * fixed metadata fit below32MiB. No credential/cursor fields exist in this view.
 */
const STATUS_LIMITS: SquareDurableJsonLimits = Object.freeze({
  containers: 17_100, values: 68_000, bytes: 32 * 1_024 * 1_024, depth: 8,
  arrayLength: 1_000, properties: 16, stringLength: 255
});

class AccountRpcFailure extends Error {
  readonly uncertain: boolean;
  constructor(uncertain = false) {
    super("square_account_rpc_failed"); this.name = "Error"; this.uncertain = uncertain;
  }
}
function denied(): never { throw new Error("square_account_broker_denied"); }

/** Representation bridge only, not a bearer capability. The generic credential
 * broker's unchanged lease contract uses UUIDs; Square's durable lease uses a
 * SHA256 fingerprint. Derive an RFC9562 version8 UUID with120 retained hash bits.
 * Checked SQL independently derives the same value from the CURRENT full durable
 * lease and still verifies task/login/owner/workspace/generation/deadline bindings.
 * A caller-supplied UUID or this helper alone never establishes read authority.
 */
export function squareCredentialReadLeaseId(durableLeaseFingerprint: string): string {
  try {
    const digest = contractSha256({
      fingerprintPurpose: "square_credential_read_lease_reference",
      fingerprintVersion: "square_credential_read_lease_reference_v1",
      durableLeaseFingerprint: Sha256FingerprintSchema.parse(durableLeaseFingerprint)
    }).slice("sha256:".length);
    return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-8${digest.slice(13, 16)}-8${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
  } catch { return denied(); }
}

function contextSnapshot(value: unknown): SquareAccountContext {
  return snapshotSquareDurableJson(SquareAccountContextSchema.parse(snapshotSquareDurableJson(value, CONTEXT_LIMITS)), CONTEXT_LIMITS) as SquareAccountContext;
}
function dataProperty(value: unknown, name: string): unknown {
  if (!value || typeof value !== "object" || isProxy(value)) throw new AccountRpcFailure();
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (!descriptor || !("value" in descriptor)) throw new AccountRpcFailure();
  return descriptor.value;
}

/** Dedicated checked dispatch only; never calls a generic/QBO credential RPC.
 * Context and commands are copied before the asynchronous boundary. Errors contain
 * no database message, SQL text, ciphertext, provider payload or credential material.
 * No operation is automatically retried here.
 */
export async function squareAccountRpc(
  client: ExternalIntegrationsRpcClient,
  context: SquareAccountContext,
  operation: SquareAccountOperation,
  command: unknown
): Promise<unknown> {
  try {
    const checkedContext = contextSnapshot(context), checkedOperation = OperationSchema.parse(operation);
    const checkedCommand = snapshotSquareDurableJson(command, COMMAND_LIMITS);
    if (!client || isProxy(client) || typeof client.rpc !== "function" || isProxy(client.rpc)) throw new AccountRpcFailure();
    let result: unknown;
    try {
      result = await client.rpc("square_account_connection_v1", {
        p_context: checkedContext, p_operation: checkedOperation, p_command: checkedCommand
      });
    } catch { throw new AccountRpcFailure(true); }
    // An explicit SQL error is a rejection, not proof of an uncertain acknowledgement.
    if (dataProperty(result, "error") !== null) throw new AccountRpcFailure();
    const value = dataProperty(result, "data");
    if (value === null || value === undefined) throw new AccountRpcFailure();
    return snapshotSquareDurableJson(value, checkedOperation === "status" ? STATUS_LIMITS : RESULT_LIMITS);
  } catch (error) {
    if (error instanceof AccountRpcFailure) throw error;
    throw new AccountRpcFailure();
  }
}

/** Request-scoped broker store. The verifier callback is the one-use authenticated
 * discovery handoff, not a caller-supplied ID-to-authority converter. SQL independently
 * enforces current login/session/application/generation and the durable callback receipt.
 */
export function createSquareAccountBrokerStore(input: Readonly<{
  client: ExternalIntegrationsRpcClient;
  context: SquareAccountContext;
  consumeVerifiedDiscovery?: () => SquareVerifiedDiscovery;
}>): CredentialBrokerStore {
  let context: SquareAccountContext;
  try { context = contextSnapshot(input.context); } catch { return denied(); }
  const { client, consumeVerifiedDiscovery } = input;
  let storeStarted = false;
  const checked = <T>(schema: z.ZodType<T>, value: unknown): T => schema.parse(snapshotSquareDurableJson(value, COMMAND_LIMITS));
  const run = async <T>(operation: SquareAccountOperation, schema: z.ZodType<T>, value: unknown, resultSchema?: z.ZodTypeAny) => {
    try {
      const command = checked(schema, value);
      const result = await squareAccountRpc(client, context, operation, command);
      return resultSchema ? resultSchema.parse(result) : result;
    } catch { return denied(); }
  };
  const unavailable = async (): Promise<never> => denied();
  return Object.freeze({
    createOAuthState: command => run("create_state", CreateOAuthStateCommandSchema, command),
    consumeOAuthState: command => run("consume_state", ConsumeOAuthStateCommandSchema, command, OAuthStateConsumeResultSchema),
    async storeCredential(value) {
      try {
        const command = checked(StoreCredentialCommandSchema, value);
        if (storeStarted || !consumeVerifiedDiscovery) return denied();
        storeStarted = true;
        const discovery = checked(SquareVerifiedDiscoverySchema, consumeVerifiedDiscovery());
        if (discovery.environment !== context.environment || discovery.applicationId !== context.applicationId) return denied();
        // Exactly one frozen payload is retained until this call settles. The second
        // attempt, if needed, reuses the same authenticated discovery and ciphertext;
        // it never consumes another state, calls a provider, or exchanges another code.
        const payload = snapshotSquareDurableJson({ command, discovery }, COMMAND_LIMITS);
        let result: unknown;
        try { result = await squareAccountRpc(client, context, "store_credential", payload); }
        catch (error) {
          if (!(error instanceof AccountRpcFailure) || !error.uncertain) throw error;
          result = await squareAccountRpc(client, context, "store_credential", payload);
        }
        return CredentialMutationResultSchema.parse(result);
      } catch { return denied(); }
    },
    readProviderCredential: command => run("read_credential", ReadProviderCredentialCommandSchema, command, ProviderCredentialReadResultSchema),
    recordProviderCredentialReadFailure: command => run("read_failure", RecordProviderCredentialReadFailureCommandSchema, command, ProviderCredentialReadFailureEvidenceResultSchema),
    acquireRefreshLease: command => run("acquire_refresh", AcquireRefreshLeaseCommandSchema, command, RefreshLeaseResultSchema),
    rotateCredential: command => run("rotate_credential", RotateCredentialCommandSchema, command, CredentialMutationResultSchema),
    completeRefreshFailure: command => run("fail_refresh", CompleteRefreshFailureCommandSchema, command, CredentialMutationResultSchema),
    recordAuthorizationEvent: command => run("audit", AuthorizationAuditEventSchema, command),
    recordRefreshBoundaryEvent: command => run("refresh_boundary", CredentialRefreshBoundaryEventSchema, command),
    // Square reauthorization starts fresh state in a fenced new generation. Merchant
    // revocation uses separate local-fence/retry operations; no purge is authorized.
    createReauthorizationState: unavailable, consumeReauthorizationState: unavailable,
    storeReauthorizedCredential: unavailable, reclaimExpiredRefreshLease: unavailable,
    revokeCredential: unavailable, completeCredentialRevocation: unavailable, destroyCredential: unavailable
  });
}
