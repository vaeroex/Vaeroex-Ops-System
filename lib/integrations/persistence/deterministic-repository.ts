import "server-only";

import { z } from "zod";

import {
  ActiveContributionSchema,
  DeterministicStateSnapshotSchema
} from "@/lib/integrations/deterministic/contracts";
import {
  DependencyDirtyNodeCommitSchema,
  DeterministicChangeSetCommitSchema,
  DeterministicChangeSetResultSchema
} from "@/lib/integrations/persistence/deterministic-commands";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

async function deterministicRpc(
  name: string,
  args: Record<string, unknown>,
  client: ExternalIntegrationsRpcClient
) {
  if (!client) throw new Error("deterministic_checked_rpc_client_required");
  const result = await client.rpc(name, args);
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`deterministic_rpc_${disposition}:${name}`);
  }
  return result.data;
}

export async function readCurrentContributionState(
  workspaceId: string,
  businessEntityId: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await deterministicRpc("read_current_contribution_state_v1", {
    p_workspace_id: workspaceId,
    p_business_entity_id: businessEntityId
  }, client);
  return z.array(ActiveContributionSchema).max(100_000).parse(data);
}

export async function readCurrentDeterministicState(
  workspaceId: string,
  businessEntityId: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await deterministicRpc("read_current_deterministic_state_v1", {
    p_workspace_id: workspaceId,
    p_business_entity_id: businessEntityId
  }, client);
  return DeterministicStateSnapshotSchema.parse(data);
}

export async function beginDeterministicChangeSet(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const changeSet = DeterministicChangeSetCommitSchema.parse(input);
  const data = await deterministicRpc("begin_deterministic_change_set_v1", {
    p_change_set: changeSet,
    p_request_id: requestId,
    p_actor_id: actorId
  }, client);
  return z.object({
    changeSetId: z.string().uuid(),
    state: z.enum(["running", "completed", "quarantined", "failed"]),
    rowVersion: z.number().int().positive(),
    idempotent: z.boolean()
  }).strict().parse(data);
}

export async function coalesceDependencyDirtyNodes(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const nodes = z.array(DependencyDirtyNodeCommitSchema).min(1).max(10_000).parse(input);
  const data = await deterministicRpc("coalesce_dependency_dirty_nodes_v1", {
    p_nodes: nodes,
    p_request_id: requestId,
    p_actor_id: actorId
  }, client);
  return z.object({
    changeSetId: z.string().uuid(),
    dirtyNodeCount: z.number().int().nonnegative(),
    coalescedInputCount: z.number().int().nonnegative(),
    idempotent: z.boolean()
  }).strict().parse(data);
}

export async function finalizeDeterministicChangeSet(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const result = DeterministicChangeSetResultSchema.parse(input);
  const data = await deterministicRpc("finalize_deterministic_change_set_v1", {
    p_result: result,
    p_request_id: requestId,
    p_actor_id: actorId
  }, client);
  return z.object({
    changeSetId: z.literal(result.changeSetId),
    state: z.enum(["completed", "quarantined"]),
    publishedStateCount: z.number().int().nonnegative(),
    rowVersion: z.number().int().positive(),
    idempotent: z.boolean()
  }).strict().parse(data);
}
