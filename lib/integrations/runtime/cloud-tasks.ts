import { createHash } from "node:crypto";
import { z } from "zod";

import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import {
  CloudTaskEnvelopeSchema,
  RUNTIME_CONTRACT_VERSIONS,
  RuntimeQueueClassSchema,
  type RuntimeQueueClass
} from "@/lib/integrations/runtime/contracts";

const CloudResourceIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/);
const QueueStringMapSchema = z
  .object({
    integration_control: CloudResourceIdSchema,
    provider_interactive: CloudResourceIdSchema,
    provider_bulk: CloudResourceIdSchema,
    deterministic_intelligence: CloudResourceIdSchema
  })
  .strict();
const QueueUrlMapSchema = z
  .object({
    integration_control: z.string().url().startsWith("https://"),
    provider_interactive: z.string().url().startsWith("https://"),
    provider_bulk: z.string().url().startsWith("https://"),
    deterministic_intelligence: z.string().url().startsWith("https://")
  })
  .strict();
const QueueEmailMapSchema = z
  .object({
    integration_control: z.string().email(),
    provider_interactive: z.string().email(),
    provider_bulk: z.string().email(),
    deterministic_intelligence: z.string().email()
  })
  .strict();
const QueuePositiveIntegerMapSchema = z
  .object({
    integration_control: z.number().int().positive().max(1_000),
    provider_interactive: z.number().int().positive().max(1_000),
    provider_bulk: z.number().int().positive().max(1_000),
    deterministic_intelligence: z.number().int().positive().max(1_000)
  })
  .strict();

export const RuntimeCloudTopologySchema = z
  .object({
    projectId: CloudResourceIdSchema,
    region: CloudResourceIdSchema,
    queueNames: QueueStringMapSchema,
    handlerUrls: QueueUrlMapSchema,
    audiences: QueueUrlMapSchema,
    oidcServiceAccounts: QueueEmailMapSchema,
    maximumDispatchesPerSecond: QueuePositiveIntegerMapSchema,
    maximumConcurrentDispatches: QueuePositiveIntegerMapSchema
  })
  .strict();

export type RuntimeCloudTopology = z.infer<typeof RuntimeCloudTopologySchema>;

export type PlannedCloudTask = Readonly<{
  name: string;
  queue: string;
  scheduleTime: string | null;
  httpRequest: {
    method: "POST";
    url: string;
    headers: Readonly<Record<string, string>>;
    bodyBase64: string;
    oidcToken: {
      serviceAccountEmail: string;
      audience: string;
    };
  };
}>;

export type CloudTasksCreateClient = Readonly<{
  createTask(request: PlannedCloudTask): PromiseLike<{ name: string }>;
}>;

export const RUNTIME_SERVICE_BOUNDARIES = {
  connectorBroker: {
    receives: ["opaque_task_id", "provider_credential_handle"],
    may: ["lease_provider_task", "call_credential_broker", "read_provider", "commit_source_page"],
    mustNot: ["arbitrary_private_dml", "model_credentials", "direct_kpi_mutation"]
  },
  deterministicRuntime: {
    receives: ["opaque_task_id", "durable_contribution_scope"],
    may: ["lease_deterministic_task", "invoke_checked_deterministic_rpc"],
    mustNot: ["provider_credential_decrypt", "provider_secret_access", "provider_egress", "model_credentials"]
  },
  ingressRuntime: {
    receives: ["verified_minimized_event_metadata"],
    may: ["record_verified_event"],
    mustNot: ["credential_decrypt", "source_fact_mutation", "workspace_claim_authority"]
  },
  dueWorkRuntime: {
    receives: ["authenticated_due_work_signal"],
    may: ["discover_due_work", "create_durable_tasks"],
    mustNot: ["provider_sync", "credential_decrypt", "customer_specific_scheduler"]
  }
} as const;

function taskName(taskId: string) {
  return createHash("sha256").update(taskId, "utf8").digest("hex");
}

export function planCloudTask(input: {
  topology: RuntimeCloudTopology;
  queueClass: RuntimeQueueClass;
  taskId: string;
  availableAt: string;
  now: string;
}): PlannedCloudTask {
  const topology = RuntimeCloudTopologySchema.parse(input.topology);
  const queueClass = RuntimeQueueClassSchema.parse(input.queueClass);
  const envelope = CloudTaskEnvelopeSchema.parse({
    protocolVersion: RUNTIME_CONTRACT_VERSIONS.cloudTaskProtocol,
    taskId: input.taskId
  });
  const body = canonicalContractJson(envelope);
  const queue = `projects/${topology.projectId}/locations/${topology.region}/queues/${topology.queueNames[queueClass]}`;
  const name = `${queue}/tasks/${taskName(envelope.taskId)}`;
  const availableAtMs = Date.parse(input.availableAt);
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(availableAtMs) || !Number.isFinite(nowMs)) {
    throw new Error("integration_cloud_task_schedule_invalid");
  }
  return {
    name,
    queue,
    scheduleTime: availableAtMs > nowMs ? new Date(availableAtMs).toISOString() : null,
    httpRequest: {
      method: "POST",
      url: topology.handlerUrls[queueClass],
      headers: {
        "content-type": "application/json",
        "x-vaeroex-runtime-protocol": RUNTIME_CONTRACT_VERSIONS.cloudTaskProtocol
      },
      bodyBase64: Buffer.from(body, "utf8").toString("base64"),
      oidcToken: {
        serviceAccountEmail: topology.oidcServiceAccounts[queueClass],
        audience: topology.audiences[queueClass]
      }
    }
  };
}

export class CloudTasksDispatcher {
  readonly #client: CloudTasksCreateClient;
  readonly #topology: RuntimeCloudTopology;
  readonly #clock: () => Date;

  constructor(input: {
    client: CloudTasksCreateClient;
    topology: RuntimeCloudTopology;
    clock?: () => Date;
  }) {
    this.#client = input.client;
    this.#topology = RuntimeCloudTopologySchema.parse(input.topology);
    this.#clock = input.clock ?? (() => new Date());
  }

  async dispatch(input: {
    queueClass: RuntimeQueueClass;
    taskId: string;
    availableAt: string;
  }) {
    const request = planCloudTask({
      topology: this.#topology,
      queueClass: input.queueClass,
      taskId: input.taskId,
      availableAt: input.availableAt,
      now: this.#clock().toISOString()
    });
    const result = await this.#client.createTask(request);
    if (result.name !== request.name) {
      throw new Error("integration_cloud_task_dispatch_reference_mismatch");
    }
    return { taskName: result.name, request } as const;
  }
}
