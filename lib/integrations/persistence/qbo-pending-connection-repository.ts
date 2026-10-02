import "server-only";

import { z } from "zod";
import { BoundedIdentifierSchema, IsoTimestampSchema, Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { IntegrationConnectionSummarySchema } from "@/lib/integrations/control-plane/contracts";
import { integrationConnectionIntentCommand } from "@/lib/integrations/persistence/control-plane-repository";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

const OAuthInputSchema = z.object({
  stateId: UuidSchema,
  stateHash: Sha256FingerprintSchema,
  redirectUri: z.string().url().startsWith("https://"),
  returnIntent: z.string().startsWith("/"),
  requestedAt: IsoTimestampSchema,
  expiresAt: IsoTimestampSchema
}).strict();
const StateResultSchema = z.object({
  stateId: UuidSchema,
  connectionId: UuidSchema,
  connectionGeneration: z.number().int().positive().safe(),
  expiresAt: IsoTimestampSchema,
  idempotent: z.boolean()
}).strict();
const BeginResultSchema = z.discriminatedUnion("disposition", [
  z.object({ connection: IntegrationConnectionSummarySchema, oauthState: StateResultSchema,
    disposition: z.literal("started"), idempotent: z.boolean() }).strict(),
  z.object({ connection: IntegrationConnectionSummarySchema, oauthState: z.null(),
    disposition: z.literal("pending"), idempotent: z.literal(true) }).strict()
]);

async function rpc(name: string, args: Record<string, unknown>, client: ExternalIntegrationsRpcClient) {
  if (!client) throw new Error("qbo_pending_checked_client_required");
  const result = await client.rpc(name, args);
  if (result.error) throw new Error(`qbo_pending_rpc_${result.error.code === "42501" ? "denied" : "failed"}:${name}`);
  return result.data;
}

export async function beginQboCustomerConnection(
  input: {
    connection: Parameters<typeof integrationConnectionIntentCommand>[0];
    oauthState: z.input<typeof OAuthInputSchema>;
    requestId: string;
  },
  client: ExternalIntegrationsRpcClient
) {
  const connection = integrationConnectionIntentCommand(input.connection);
  if (connection.providerKey !== "quickbooks_online" || connection.providerEnvironment !== "production") {
    throw new Error("qbo_pending_provider_invalid");
  }
  const state = OAuthInputSchema.parse(input.oauthState);
  const result = BeginResultSchema.parse(await rpc("begin_qbo_customer_connection_v1", {
    p_connection: connection,
    p_oauth_state: {
      ...state,
      contractVersion: "qbo_customer_oauth_state_v2",
      connectionId: connection.id,
      expectedConnectionGeneration: 1,
      expectedConnectionRowVersion: 1,
      requestedScopes: connection.requestedScopes
    },
    p_request_id: BoundedIdentifierSchema.parse(input.requestId)
  }, client));
  if (result.connection.workspaceId !== connection.workspaceId ||
    result.connection.businessEntityId !== connection.businessEntityId ||
    result.connection.providerKey !== "quickbooks_online" || result.connection.providerEnvironment !== "production" ||
    (result.disposition === "started" && (result.connection.id !== connection.id ||
      result.oauthState.stateId !== state.stateId || result.oauthState.connectionId !== result.connection.id ||
      result.oauthState.connectionGeneration !== result.connection.connectionGeneration))) {
    throw new Error("qbo_pending_result_binding_invalid");
  }
  return result;
}

export async function cancelQboCustomerPendingConnection(
  input: { workspaceId: string; connectionId: string; expectedRowVersion: number; requestId: string },
  client: ExternalIntegrationsRpcClient
) {
  const result = z.object({ connection: IntegrationConnectionSummarySchema, idempotent: z.boolean() }).strict()
    .parse(await rpc("cancel_qbo_customer_pending_connection_v1", {
      p_workspace_id: UuidSchema.parse(input.workspaceId),
      p_connection_id: UuidSchema.parse(input.connectionId),
      p_expected_row_version: z.number().int().positive().safe().parse(input.expectedRowVersion),
      p_request_id: BoundedIdentifierSchema.parse(input.requestId)
    }, client));
  if (result.connection.workspaceId !== input.workspaceId || result.connection.id !== input.connectionId ||
    result.connection.providerKey !== "quickbooks_online" || result.connection.providerEnvironment !== "production" ||
    result.connection.status !== "disconnected") throw new Error("qbo_pending_result_binding_invalid");
  return result;
}
