import "server-only";

import { z } from "zod";

import { BoundedIdentifierSchema } from "@/lib/integrations/contracts/primitives";
import {
  AcquireRuntimeRatePermitCommandSchema,
  BindWebhookEventTaskCommandSchema,
  CancelRuntimeTaskCommandSchema,
  CompleteRuntimeTaskCommandSchema,
  FailRuntimeTaskCommandSchema,
  HeartbeatRuntimeTaskCommandSchema,
  LeaseRuntimeTaskCommandSchema,
  MarkRuntimeTaskDispatchedCommandSchema,
  TransitionRuntimeCircuitCommandSchema,
  VerifiedWebhookEventCommandSchema
} from "@/lib/integrations/persistence/runtime-commands";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { CreateRuntimeTaskCommandSchema } from "@/lib/integrations/runtime/contracts";

async function runtimeRpc(
  name: string,
  args: Record<string, unknown>,
  client: ExternalIntegrationsRpcClient
) {
  if (!client) throw new Error("integration_runtime_checked_rpc_client_required");
  const result = await client.rpc(name, args);
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`integration_runtime_rpc_${disposition}:${name}`);
  }
  return result.data;
}

export function createRuntimeTask(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "create_integration_sync_task_v1",
    {
      p_command: CreateRuntimeTaskCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}
export function markRuntimeTaskDispatched(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "mark_integration_sync_task_dispatched_v1",
    {
      p_command: MarkRuntimeTaskDispatchedCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}

export function leaseRuntimeTask(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "lease_integration_sync_task_v1",
    {
      p_command: LeaseRuntimeTaskCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}

export function heartbeatRuntimeTask(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "heartbeat_integration_sync_task_v1",
    {
      p_command: HeartbeatRuntimeTaskCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}

export function completeRuntimeTask(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "complete_integration_sync_task_v1",
    {
      p_command: CompleteRuntimeTaskCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}

export function failRuntimeTask(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "fail_integration_sync_task_v1",
    {
      p_command: FailRuntimeTaskCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}

export function cancelRuntimeTask(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "cancel_integration_sync_task_v1",
    {
      p_command: CancelRuntimeTaskCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}

export function recordVerifiedWebhookEvent(
  input: unknown,
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "record_integration_webhook_event_v1",
    {
      p_event: VerifiedWebhookEventCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId)
    },
    client
  );
}

export function bindWebhookEventTask(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "bind_integration_webhook_event_task_v1",
    {
      p_command: BindWebhookEventTaskCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}

export function transitionRuntimeCircuit(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "transition_integration_runtime_circuit_v1",
    {
      p_command: TransitionRuntimeCircuitCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}

export function acquireRuntimeRatePermit(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "acquire_integration_runtime_rate_permit_v1",
    {
      p_command: AcquireRuntimeRatePermitCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}

export function sweepRuntimeTasks(
  limit: number,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  return runtimeRpc(
    "sweep_integration_sync_tasks_v1",
    {
      p_limit: z.number().int().positive().max(1_000).parse(limit),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
}
