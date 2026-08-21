import "server-only";

import { z } from "zod";

import {
  BoundedIdentifierSchema,
  IsoTimestampSchema,
  UuidSchema,
  uniqueStringArray
} from "@/lib/integrations/contracts/primitives";
import {
  IntegrationConnectionSummarySchema,
  IntegrationFreshnessSummarySchema,
  IntegrationSyncRunStateSchema,
  ProviderEntityMappingStatusSchema
} from "@/lib/integrations/control-plane/contracts";
import {
  PHASE_4_PROVIDER_REGISTRY,
  providerDescriptor,
  safeCapabilitySnapshot
} from "@/lib/integrations/control-plane/provider-registry";
import {
  CreateIntegrationConnectionIntentSchema,
  CreateIntegrationSyncRunSchema,
  CreateProviderEntityMappingSchema,
  ReplaceIntegrationConnectionGenerationSchema,
  TransitionIntegrationConnectionSchema,
  TransitionIntegrationSyncRunSchema,
  TransitionProviderEntityMappingSchema,
  UpsertIntegrationFreshnessSchema,
  UpsertIntegrationWorkspacePolicySchema
} from "@/lib/integrations/persistence/control-plane-commands";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

async function controlPlaneRpc(
  name: string,
  args: Record<string, unknown>,
  client: ExternalIntegrationsRpcClient
) {
  if (!client) throw new Error("integration_control_plane_checked_rpc_client_required");
  const result = await client.rpc(name, args);
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`integration_control_plane_rpc_${disposition}:${name}`);
  }
  return result.data;
}

const ConnectionResultSchema = z
  .object({
    connection: IntegrationConnectionSummarySchema,
    idempotent: z.boolean()
  })
  .strict();

export async function createIntegrationConnectionIntent(
  input: {
    id: string;
    workspaceId: string;
    businessEntityId: string;
    providerKey: string;
    providerEnvironment: string;
    safeDisplayName: string;
    requestedScopes: readonly string[];
    configurationVersion?: number;
    requestedAt: string;
  },
  client: ExternalIntegrationsRpcClient
) {
  const entry = providerDescriptor(input.providerKey, input.providerEnvironment);
  const requestedScopes = uniqueStringArray(BoundedIdentifierSchema, 64).parse([
    ...input.requestedScopes
  ]);
  const allowedScopes = new Set([
    ...entry.descriptor.minimumScopes,
    ...entry.descriptor.optionalScopes
  ]);
  if (
    entry.descriptor.minimumScopes.some((scope) => !requestedScopes.includes(scope)) ||
    requestedScopes.some((scope) => !allowedScopes.has(scope))
  ) {
    throw new Error("integration_connection_scope_set_invalid");
  }
  const command = CreateIntegrationConnectionIntentSchema.parse({
    contractVersion: "integration_connection_control_v1",
    id: input.id,
    workspaceId: input.workspaceId,
    businessEntityId: input.businessEntityId,
    providerKey: input.providerKey,
    providerEnvironment: input.providerEnvironment,
    safeDisplayName: input.safeDisplayName,
    requestedScopes,
    providerDescriptorRegistryVersion: PHASE_4_PROVIDER_REGISTRY.registryVersion,
    providerDescriptorRegistryFingerprint:
      PHASE_4_PROVIDER_REGISTRY.registryFingerprint,
    providerDescriptorFingerprint: entry.descriptorFingerprint,
    adapterVersion: entry.descriptor.adapterVersion,
    capabilitySnapshot: safeCapabilitySnapshot(entry.descriptor),
    configurationVersion: input.configurationVersion ?? 1,
    requestedAt: input.requestedAt
  });
  const data = await controlPlaneRpc(
    "create_integration_connection_intent_v1",
    { p_command: command },
    client
  );
  return ConnectionResultSchema.parse(data);
}

export async function requestIntegrationDisconnect(
  input: {
    connectionId: string;
    expectedRowVersion: number;
    requestId: string;
  },
  client: ExternalIntegrationsRpcClient
) {
  const data = await controlPlaneRpc(
    "request_integration_disconnect_v1",
    {
      p_connection_id: UuidSchema.parse(input.connectionId),
      p_expected_row_version: z.number().int().positive().parse(input.expectedRowVersion),
      p_request_id: BoundedIdentifierSchema.parse(input.requestId)
    },
    client
  );
  return ConnectionResultSchema.parse(data);
}

export async function transitionIntegrationConnection(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const command = TransitionIntegrationConnectionSchema.parse(input);
  const data = await controlPlaneRpc(
    "transition_integration_connection_v1",
    {
      p_command: command,
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return ConnectionResultSchema.parse(data);
}

export async function replaceIntegrationConnectionGeneration(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const command = ReplaceIntegrationConnectionGenerationSchema.parse(input);
  const data = await controlPlaneRpc(
    "replace_integration_connection_generation_v1",
    {
      p_command: command,
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return ConnectionResultSchema.parse(data);
}

const MappingResultSchema = z
  .object({
    mappingId: UuidSchema,
    status: ProviderEntityMappingStatusSchema,
    rowVersion: z.number().int().positive(),
    idempotent: z.boolean()
  })
  .strict();

export async function createProviderEntityMapping(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const command = CreateProviderEntityMappingSchema.parse(input);
  return MappingResultSchema.parse(
    await controlPlaneRpc(
      "create_provider_entity_mapping_v1",
      {
        p_command: command,
        p_request_id: BoundedIdentifierSchema.parse(requestId),
        p_actor_id: BoundedIdentifierSchema.parse(actorId)
      },
      client
    )
  );
}

export async function transitionProviderEntityMapping(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const command = TransitionProviderEntityMappingSchema.parse(input);
  return MappingResultSchema.parse(
    await controlPlaneRpc(
      "transition_provider_entity_mapping_v1",
      {
        p_command: command,
        p_request_id: BoundedIdentifierSchema.parse(requestId),
        p_actor_id: BoundedIdentifierSchema.parse(actorId)
      },
      client
    )
  );
}

const SyncRunResultSchema = z
  .object({
    syncRunId: UuidSchema,
    state: IntegrationSyncRunStateSchema,
    rowVersion: z.number().int().positive(),
    idempotent: z.boolean()
  })
  .strict();

export async function createIntegrationSyncRun(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const command = CreateIntegrationSyncRunSchema.parse(input);
  return SyncRunResultSchema.parse(
    await controlPlaneRpc(
      "create_integration_sync_run_v1",
      {
        p_command: command,
        p_request_id: BoundedIdentifierSchema.parse(requestId),
        p_actor_id: BoundedIdentifierSchema.parse(actorId)
      },
      client
    )
  );
}

export async function transitionIntegrationSyncRun(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const command = TransitionIntegrationSyncRunSchema.parse(input);
  return SyncRunResultSchema.parse(
    await controlPlaneRpc(
      "transition_integration_sync_run_v1",
      {
        p_command: command,
        p_request_id: BoundedIdentifierSchema.parse(requestId),
        p_actor_id: BoundedIdentifierSchema.parse(actorId)
      },
      client
    )
  );
}

export async function upsertIntegrationFreshness(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const command = UpsertIntegrationFreshnessSchema.parse(input);
  const data = await controlPlaneRpc(
    "upsert_integration_freshness_v1",
    {
      p_command: command,
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return z
    .object({ freshness: IntegrationFreshnessSummarySchema, idempotent: z.boolean() })
    .strict()
    .parse(data);
}

export async function upsertIntegrationWorkspacePolicy(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const command = UpsertIntegrationWorkspacePolicySchema.parse(input);
  const data = await controlPlaneRpc(
    "upsert_integration_workspace_policy_v1",
    {
      p_command: command,
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return z
    .object({
      policyId: UuidSchema,
      rowVersion: z.number().int().positive(),
      idempotent: z.boolean(),
      updatedAt: IsoTimestampSchema
    })
    .strict()
    .parse(data);
}
