import { randomUUID } from "node:crypto";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  CreateRuntimeTaskCommandSchema,
  RuntimeCheckpointCommitSchema,
  RuntimeCircuitStateSchema,
  RuntimeFailureCategorySchema,
  RuntimeWorkerKindSchema,
  type CreateRuntimeTaskCommand,
  type RuntimeCheckpointCommit,
  type RuntimeQueueClass,
  type RuntimeTaskState,
  type RuntimeWorkerKind
} from "@/lib/integrations/runtime/contracts";

type ConnectionAuthority = Readonly<{
  workspaceId: string;
  businessEntityId: string;
  connectionId: string;
  connectionGeneration: number;
  providerKey: string;
  providerEnvironment: string;
  status: "initializing" | "active" | "degraded" | "disconnecting" | "disconnected" | "deleting" | "deleted";
}>;

export type RuntimeTaskRecord = CreateRuntimeTaskCommand & {
  state: RuntimeTaskState;
  attemptCount: number;
  dispatchGeneration: number;
  dispatcherTaskName: string | null;
  leaseId: string | null;
  leaseOwnerFingerprint: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  deliveryAttributionState: RuntimeDeliveryAttributionState;
  lastDeliveryDispatchGeneration: number | null;
  lastDeliveryRetryCount: number | null;
  lastDeliveryExecutionCount: number | null;
  lastDeliveryAttemptFingerprint: string | null;
  failureCategory: string | null;
  failureCode: string | null;
  durableEffectFingerprint: string | null;
  cancelRequestedAt: string | null;
  completedAt: string | null;
  rowVersion: number;
  updatedAt: string;
};

export type RuntimeDeliveryAttributionState =
  | "none"
  | "attributed"
  | "legacy_unattributed";

export function assertRuntimeDeliveryAttributionLeaseable(
  state: RuntimeDeliveryAttributionState
) {
  if (state === "legacy_unattributed") {
    throw new Error("integration_sync_task_delivery_attribution_unresolved");
  }
}

export type RuntimeCheckpointRecord = RuntimeCheckpointCommit & {
  workspaceId: string;
  businessEntityId: string;
  connectionId: string;
  connectionGeneration: number;
  providerKey: string;
  providerEnvironment: string;
  checkpointVersion: number;
  lifecycle: "active" | "invalidated" | "rebuilding" | "closed";
  lastTaskId: string;
  lastSyncRunId: string;
  lastFullReconciliationAt: string | null;
  updatedAt: string;
};

export type RuntimeWebhookEvent = Readonly<{
  id: string;
  providerKey: string;
  providerEnvironment: string;
  specificationVersion: string;
  eventType: string;
  providerEventFingerprint: string;
  deliveryHash: string;
  providerAccountReferenceFingerprint: string;
  providerEntityType: string;
  providerEntityReferenceFingerprint: string;
  verifiedAt: string;
}>;

type StoredWebhookEvent = RuntimeWebhookEvent & {
  workspaceId: string | null;
  businessEntityId: string | null;
  connectionId: string | null;
  connectionGeneration: number | null;
  mappingId: string | null;
  verificationState: "verified" | "rejected";
  processingState: "pending" | "coalesced" | "processed" | "rejected";
  replayOfEventId: string | null;
  resultingTaskId: string | null;
  failureCode: string | null;
};

type CircuitRecord = {
  key: string;
  state: "closed" | "open" | "half_open";
  rowVersion: number;
  failureCount: number;
  successCount: number;
  reasonCode: string;
  openUntil: string | null;
  updatedAt: string;
};

export type RuntimeLedgerMetrics = Readonly<{
  databaseWrites: number;
  taskCreates: number;
  idempotentTaskCreates: number;
  taskLeases: number;
  durableEffects: number;
  checkpointAdvances: number;
  duplicateDeliveries: number;
  webhookDeliveries: number;
  coalescedWebhookDeliveries: number;
  deadLetters: number;
  sweeperRecoveries: number;
}>;

const activeConnectionStates = new Set(["initializing", "active", "degraded"]);

function taskIdempotencyKey(command: CreateRuntimeTaskCommand) {
  return [
    command.workspaceId,
    command.businessEntityId,
    command.connectionId,
    command.idempotencyFingerprint
  ].join(":");
}

function copyTask(task: RuntimeTaskRecord): RuntimeTaskRecord {
  return structuredClone(task);
}

export class SyntheticDurableRuntimeLedger {
  readonly #tasks = new Map<string, RuntimeTaskRecord>();
  readonly #taskIdempotency = new Map<string, string>();
  readonly #connections = new Map<string, ConnectionAuthority>();
  readonly #checkpoints = new Map<string, RuntimeCheckpointRecord>();
  readonly #webhookEvents = new Map<string, StoredWebhookEvent>();
  readonly #webhookDeliveries = new Map<string, string>();
  readonly #circuits = new Map<string, CircuitRecord>();
  readonly #lastWorkspaceByQueue = new Map<RuntimeQueueClass, string>();
  readonly #durableEffects = new Set<string>();
  readonly #limits: { workspace: number; connection: number; provider: number };
  readonly #metrics = {
    databaseWrites: 0,
    taskCreates: 0,
    idempotentTaskCreates: 0,
    taskLeases: 0,
    durableEffects: 0,
    checkpointAdvances: 0,
    duplicateDeliveries: 0,
    webhookDeliveries: 0,
    coalescedWebhookDeliveries: 0,
    deadLetters: 0,
    sweeperRecoveries: 0
  };

  constructor(input: {
    maximumActiveTasksPerWorkspace?: number;
    maximumActiveTasksPerConnection?: number;
    maximumActiveTasksPerProvider?: number;
  } = {}) {
    this.#limits = {
      workspace: input.maximumActiveTasksPerWorkspace ?? 4,
      connection: input.maximumActiveTasksPerConnection ?? 2,
      provider: input.maximumActiveTasksPerProvider ?? 32
    };
  }

  registerConnection(connection: ConnectionAuthority) {
    this.#connections.set(connection.connectionId, structuredClone(connection));
  }

  transitionConnection(connectionId: string, input: {
    status: ConnectionAuthority["status"];
    connectionGeneration?: number;
  }) {
    const current = this.#connections.get(connectionId);
    if (!current) throw new Error("integration_runtime_connection_missing");
    this.#connections.set(connectionId, {
      ...current,
      status: input.status,
      connectionGeneration: input.connectionGeneration ?? current.connectionGeneration
    });
  }

  createTask(input: unknown) {
    const command = CreateRuntimeTaskCommandSchema.parse(input);
    this.#assertTaskAuthority(command);
    const key = taskIdempotencyKey(command);
    const existingId = this.#taskIdempotency.get(key);
    if (existingId) {
      const existing = this.#requiredTask(existingId);
      if (existing.id !== command.id) {
        throw new Error("integration_sync_task_idempotency_conflict");
      }
      this.#metrics.idempotentTaskCreates += 1;
      return { task: copyTask(existing), idempotent: true } as const;
    }
    if (this.#tasks.has(command.id)) {
      throw new Error("integration_sync_task_identity_conflict");
    }
    const task: RuntimeTaskRecord = {
      ...structuredClone(command),
      state: "pending",
      attemptCount: 0,
      dispatchGeneration: 0,
      dispatcherTaskName: null,
      leaseId: null,
      leaseOwnerFingerprint: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      deliveryAttributionState: "none",
      lastDeliveryDispatchGeneration: null,
      lastDeliveryRetryCount: null,
      lastDeliveryExecutionCount: null,
      lastDeliveryAttemptFingerprint: null,
      failureCategory: null,
      failureCode: null,
      durableEffectFingerprint: null,
      cancelRequestedAt: null,
      completedAt: null,
      rowVersion: 1,
      updatedAt: command.createdAt
    };
    this.#tasks.set(task.id, task);
    this.#taskIdempotency.set(key, task.id);
    this.#metrics.databaseWrites += 1;
    this.#metrics.taskCreates += 1;
    return { task: copyTask(task), idempotent: false } as const;
  }

  nextDispatchable(queueClass: RuntimeQueueClass, now: Date, limit = 1) {
    const byWorkspace = new Map<string, RuntimeTaskRecord[]>();
    for (const task of this.#tasks.values()) {
      if (
        task.queueClass !== queueClass ||
        task.state !== "pending" ||
        task.deliveryAttributionState === "legacy_unattributed" ||
        Date.parse(task.availableAt) > now.getTime()
      ) continue;
      const values = byWorkspace.get(task.workspaceId) ?? [];
      values.push(task);
      byWorkspace.set(task.workspaceId, values);
    }
    for (const values of byWorkspace.values()) {
      values.sort((left, right) =>
        right.priority - left.priority ||
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        left.id.localeCompare(right.id)
      );
    }
    const workspaces = [...byWorkspace.keys()].sort();
    const last = this.#lastWorkspaceByQueue.get(queueClass);
    if (last && workspaces.includes(last)) {
      const index = workspaces.indexOf(last);
      workspaces.push(...workspaces.splice(0, index + 1));
    }
    const selected: RuntimeTaskRecord[] = [];
    while (selected.length < limit && workspaces.length > 0) {
      for (const workspaceId of [...workspaces]) {
        const values = byWorkspace.get(workspaceId);
        const task = values?.shift();
        if (task) {
          selected.push(copyTask(task));
          this.#lastWorkspaceByQueue.set(queueClass, workspaceId);
        }
        if (!values || values.length === 0) {
          workspaces.splice(workspaces.indexOf(workspaceId), 1);
        }
        if (selected.length >= limit) break;
      }
    }
    return selected;
  }

  markDispatched(taskId: string, dispatcherTaskName: string, now: Date) {
    const task = this.#requiredTask(taskId);
    assertRuntimeDeliveryAttributionLeaseable(task.deliveryAttributionState);
    if (task.state === "dispatched" && task.dispatcherTaskName === dispatcherTaskName) {
      return { task: copyTask(task), idempotent: true } as const;
    }
    if (task.state !== "pending") throw new Error("integration_sync_task_dispatch_invalid");
    task.state = "dispatched";
    task.dispatchGeneration += 1;
    task.dispatcherTaskName = dispatcherTaskName;
    this.#bump(task, now);
    return { task: copyTask(task), idempotent: false } as const;
  }

  leaseTask(input: {
    taskId: string;
    workerKind: RuntimeWorkerKind;
    leaseId: string;
    ownerFingerprint: string;
    leaseSeconds: number;
    expectedConnectionGeneration: number;
    deliveryDispatchGeneration: number;
    deliveryRetryCount: number;
    deliveryExecutionCount: number;
    deliveryAttemptFingerprint: string;
    now: Date;
  }) {
    const workerKind = RuntimeWorkerKindSchema.parse(input.workerKind);
    const task = this.#requiredTask(input.taskId);
    const connection = this.#requiredConnection(task.connectionId);
    if (!this.#workerMayLease(workerKind, task.queueClass)) {
      throw new Error("integration_sync_task_worker_authority_denied");
    }
    assertRuntimeDeliveryAttributionLeaseable(task.deliveryAttributionState);
    if (
      task.state === "succeeded" ||
      (task.state === "leased" &&
        task.deliveryAttributionState === "attributed" &&
        task.lastDeliveryDispatchGeneration === task.dispatchGeneration &&
        input.deliveryRetryCount === task.lastDeliveryRetryCount &&
        input.deliveryExecutionCount === task.lastDeliveryExecutionCount &&
        input.deliveryAttemptFingerprint === task.lastDeliveryAttemptFingerprint)
    ) {
      this.#metrics.duplicateDeliveries += 1;
      return { acquired: false, reasonCode: "delivery_replayed", task: copyTask(task) } as const;
    }
    if (
      task.state !== "dispatched" ||
      Date.parse(task.availableAt) > input.now.getTime() ||
      task.connectionGeneration !== input.expectedConnectionGeneration ||
      connection.connectionGeneration !== task.connectionGeneration ||
      !activeConnectionStates.has(connection.status) ||
      this.#circuitOpen(task, input.now)
    ) {
      return { acquired: false, reasonCode: "task_not_leaseable", task: copyTask(task) } as const;
    }
    if (
      !Number.isInteger(input.deliveryExecutionCount) ||
      input.deliveryExecutionCount < 0 ||
      input.deliveryExecutionCount > 100 ||
      !Number.isInteger(input.deliveryRetryCount) ||
      input.deliveryRetryCount < 0 ||
      input.deliveryRetryCount > 100 ||
      input.deliveryExecutionCount > input.deliveryRetryCount ||
      input.deliveryDispatchGeneration !== task.dispatchGeneration ||
      ((task.deliveryAttributionState === "none" ||
        task.lastDeliveryDispatchGeneration !== task.dispatchGeneration) &&
        (input.deliveryRetryCount !== 0 || input.deliveryExecutionCount !== 0)) ||
      (task.deliveryAttributionState === "attributed" &&
        task.lastDeliveryDispatchGeneration === task.dispatchGeneration &&
        task.lastDeliveryRetryCount === null) ||
      (task.deliveryAttributionState === "attributed" &&
        task.lastDeliveryDispatchGeneration === task.dispatchGeneration &&
        task.lastDeliveryRetryCount !== null &&
        task.lastDeliveryExecutionCount !== null &&
        (input.deliveryRetryCount <= task.lastDeliveryRetryCount ||
          input.deliveryExecutionCount < task.lastDeliveryExecutionCount ||
          input.deliveryAttemptFingerprint === task.lastDeliveryAttemptFingerprint))
    ) {
      this.#metrics.duplicateDeliveries += 1;
      return { acquired: false, reasonCode: "delivery_replayed", task: copyTask(task) } as const;
    }
    if (!Number.isInteger(input.leaseSeconds) || input.leaseSeconds < 30 || input.leaseSeconds > 900) {
      throw new Error("integration_sync_task_lease_duration_invalid");
    }
    if (!this.#withinConcurrency(task)) {
      return { acquired: false, reasonCode: "backpressure", task: copyTask(task) } as const;
    }
    task.state = "leased";
    task.attemptCount += 1;
    task.leaseId = input.leaseId;
    task.leaseOwnerFingerprint = input.ownerFingerprint;
    task.leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000).toISOString();
    task.heartbeatAt = input.now.toISOString();
    task.deliveryAttributionState = "attributed";
    task.lastDeliveryDispatchGeneration = task.dispatchGeneration;
    task.lastDeliveryRetryCount = input.deliveryRetryCount;
    task.lastDeliveryExecutionCount = input.deliveryExecutionCount;
    task.lastDeliveryAttemptFingerprint = input.deliveryAttemptFingerprint;
    this.#bump(task, input.now);
    this.#metrics.taskLeases += 1;
    return { acquired: true, reasonCode: "leased", task: copyTask(task) } as const;
  }

  heartbeat(input: {
    taskId: string;
    leaseId: string;
    ownerFingerprint: string;
    extendSeconds: number;
    now: Date;
  }) {
    const task = this.#requiredTask(input.taskId);
    this.#assertLease(task, input.leaseId, input.ownerFingerprint, input.now);
    if (!Number.isInteger(input.extendSeconds) || input.extendSeconds < 30 || input.extendSeconds > 900) {
      throw new Error("integration_sync_task_heartbeat_duration_invalid");
    }
    task.heartbeatAt = input.now.toISOString();
    task.leaseExpiresAt = new Date(input.now.getTime() + input.extendSeconds * 1_000).toISOString();
    this.#bump(task, input.now);
    return copyTask(task);
  }

  complete(input: {
    taskId: string;
    leaseId: string;
    ownerFingerprint: string;
    durableEffectFingerprint: string;
    checkpoint: RuntimeCheckpointCommit | null;
    childTask: CreateRuntimeTaskCommand | null;
    now: Date;
  }) {
    const task = this.#requiredTask(input.taskId);
    if (task.state === "succeeded") {
      if (task.durableEffectFingerprint !== input.durableEffectFingerprint) {
        throw new Error("integration_sync_task_effect_conflict");
      }
      this.#metrics.duplicateDeliveries += 1;
      return { task: copyTask(task), checkpoint: this.checkpoint(input.checkpoint?.checkpointId), idempotent: true } as const;
    }
    this.#assertLease(task, input.leaseId, input.ownerFingerprint, input.now);
    const checkpoint = input.checkpoint
      ? this.#prepareCheckpoint(task, RuntimeCheckpointCommitSchema.parse(input.checkpoint), input.now)
      : null;
    if (
      checkpoint &&
      checkpoint.downstreamCommitFingerprint !== input.durableEffectFingerprint
    ) {
      throw new Error("integration_checkpoint_commit_boundary_invalid");
    }
    let childResult: ReturnType<SyntheticDurableRuntimeLedger["createTask"]> | null = null;
    if (input.childTask) {
      if (input.childTask.parentTaskId !== task.id) {
        throw new Error("integration_sync_task_child_scope_invalid");
      }
      childResult = this.createTask(input.childTask);
    }
    const firstEffect = !this.#durableEffects.has(input.durableEffectFingerprint);
    this.#durableEffects.add(input.durableEffectFingerprint);
    if (firstEffect) {
      this.#metrics.durableEffects += 1;
    } else {
      this.#metrics.duplicateDeliveries += 1;
    }
    if (checkpoint) {
      this.#checkpoints.set(checkpoint.checkpointId, checkpoint);
      this.#metrics.databaseWrites += 1;
      this.#metrics.checkpointAdvances += 1;
    }
    task.state = task.cancelRequestedAt ? "cancelled" : "succeeded";
    task.durableEffectFingerprint = input.durableEffectFingerprint;
    task.completedAt = input.now.toISOString();
    task.failureCategory = null;
    task.failureCode = null;
    this.#clearLease(task);
    this.#bump(task, input.now);
    const eventId = task.controlMetadata.eventId;
    if (eventId) {
      const event = this.#webhookEvents.get(eventId);
      if (event) {
        event.processingState = "processed";
        event.resultingTaskId = task.id;
        this.#metrics.databaseWrites += 1;
      }
    }
    return {
      task: copyTask(task),
      checkpoint: checkpoint ? structuredClone(checkpoint) : null,
      childTask: childResult?.task ?? null,
      idempotent: !firstEffect
    } as const;
  }

  fail(input: {
    taskId: string;
    leaseId: string;
    ownerFingerprint: string;
    category: string;
    safeCode: string;
    retryable: boolean;
    retryAfterMs: number | null;
    now: Date;
  }) {
    const task = this.#requiredTask(input.taskId);
    this.#assertLease(task, input.leaseId, input.ownerFingerprint, input.now);
    const category = RuntimeFailureCategorySchema.parse(input.category);
    task.failureCategory = category;
    task.failureCode = input.safeCode;
    this.#clearLease(task);
    if (input.retryable && task.attemptCount < task.maximumAttempts) {
      const exponentialMs = Math.min(3_600_000, 1_000 * (2 ** Math.min(task.attemptCount, 12)));
      task.state = "retry_wait";
      task.dispatcherTaskName = null;
      task.availableAt = new Date(
        input.now.getTime() + Math.max(input.retryAfterMs ?? 0, exponentialMs)
      ).toISOString();
    } else if (input.retryable) {
      task.state = "dead_letter";
      task.completedAt = input.now.toISOString();
      this.#metrics.deadLetters += 1;
    } else {
      task.state = "failed";
      task.completedAt = input.now.toISOString();
    }
    this.#bump(task, input.now);
    return copyTask(task);
  }

  cancel(taskId: string, now: Date) {
    const task = this.#requiredTask(taskId);
    if (["succeeded", "failed", "dead_letter", "cancelled"].includes(task.state)) {
      return { task: copyTask(task), idempotent: task.state === "cancelled" } as const;
    }
    task.cancelRequestedAt = now.toISOString();
    task.state = "cancelled";
    task.completedAt = now.toISOString();
    task.dispatcherTaskName = null;
    this.#clearLease(task);
    this.#bump(task, now);
    return { task: copyTask(task), idempotent: false } as const;
  }

  sweep(now: Date, input: { dispatchStaleAfterMs: number }) {
    if (!Number.isSafeInteger(input.dispatchStaleAfterMs) || input.dispatchStaleAfterMs <= 0) {
      throw new Error("integration_runtime_sweep_configuration_invalid");
    }
    const recovered: RuntimeTaskRecord[] = [];
    for (const task of this.#tasks.values()) {
      if (task.deliveryAttributionState === "legacy_unattributed") continue;
      let changed = false;
      if (
        task.state === "leased" &&
        task.leaseExpiresAt &&
        Date.parse(task.leaseExpiresAt) <= now.getTime()
      ) {
        this.#clearLease(task);
        task.dispatcherTaskName = null;
        if (task.attemptCount >= task.maximumAttempts) {
          task.state = "dead_letter";
          task.failureCategory = "availability";
          task.failureCode = "lease_exhausted";
          task.completedAt = now.toISOString();
          this.#metrics.deadLetters += 1;
        } else {
          task.state = "retry_wait";
          task.failureCategory = "availability";
          task.failureCode = "lease_expired";
          task.availableAt = now.toISOString();
        }
        changed = true;
      } else if (task.state === "retry_wait" && Date.parse(task.availableAt) <= now.getTime()) {
        task.state = "pending";
        task.failureCategory = null;
        task.failureCode = null;
        changed = true;
      }
      if (changed) {
        this.#bump(task, now);
        this.#metrics.sweeperRecoveries += 1;
        recovered.push(copyTask(task));
      }
    }
    return recovered;
  }

  ingestWebhook(input: {
    event: RuntimeWebhookEvent;
    resolveAuthority: (event: RuntimeWebhookEvent) => (ConnectionAuthority & { mappingId: string }) | null;
  }) {
    this.#metrics.webhookDeliveries += 1;
    const duplicateId = this.#webhookDeliveries.get(input.event.deliveryHash);
    if (duplicateId) {
      this.#metrics.coalescedWebhookDeliveries += 1;
      return { event: structuredClone(this.#webhookEvents.get(duplicateId)!), idempotent: true } as const;
    }
    const authority = input.resolveAuthority(input.event);
    const canonical = [...this.#webhookEvents.values()].find((event) =>
      event.providerKey === input.event.providerKey &&
      event.providerEnvironment === input.event.providerEnvironment &&
      event.providerEventFingerprint === input.event.providerEventFingerprint &&
      event.connectionId === authority?.connectionId
    );
    const stored: StoredWebhookEvent = {
      ...structuredClone(input.event),
      workspaceId: authority?.workspaceId ?? null,
      businessEntityId: authority?.businessEntityId ?? null,
      connectionId: authority?.connectionId ?? null,
      connectionGeneration: authority?.connectionGeneration ?? null,
      mappingId: authority?.mappingId ?? null,
      verificationState: authority ? "verified" : "rejected",
      processingState: authority ? "pending" : "rejected",
      replayOfEventId: canonical?.id ?? null,
      resultingTaskId: null,
      failureCode: authority ? null : "trusted_mapping_missing"
    };
    this.#webhookEvents.set(stored.id, stored);
    this.#webhookDeliveries.set(stored.deliveryHash, stored.id);
    this.#metrics.databaseWrites += 1;
    if (canonical) this.#metrics.coalescedWebhookDeliveries += 1;
    return { event: structuredClone(stored), idempotent: false } as const;
  }

  coalesceWebhookTask(eventId: string, command: CreateRuntimeTaskCommand) {
    const event = this.#webhookEvents.get(eventId);
    if (!event || event.verificationState !== "verified" || !event.connectionId) {
      throw new Error("integration_webhook_event_not_verified");
    }
    if (
      command.workspaceId !== event.workspaceId ||
      command.businessEntityId !== event.businessEntityId ||
      command.connectionId !== event.connectionId ||
      command.connectionGeneration !== event.connectionGeneration ||
      command.controlMetadata.eventId !== event.id
    ) {
      throw new Error("integration_webhook_event_scope_denied");
    }
    const result = this.createTask(command);
    event.processingState = "coalesced";
    event.resultingTaskId = result.task.id;
    this.#metrics.databaseWrites += 1;
    if (result.idempotent) this.#metrics.coalescedWebhookDeliveries += 1;
    return result;
  }

  transitionCircuit(input: {
    key: string;
    expectedRowVersion: number;
    targetState: "closed" | "open" | "half_open";
    reasonCode: string;
    openUntil: string | null;
    now: Date;
  }) {
    const targetState = RuntimeCircuitStateSchema.parse(input.targetState);
    const existing = this.#circuits.get(input.key);
    if (!existing) {
      if (input.expectedRowVersion !== 0 || targetState !== "closed") {
        throw new Error("integration_runtime_circuit_cas_stale");
      }
      const created: CircuitRecord = {
        key: input.key,
        state: "closed",
        rowVersion: 1,
        failureCount: 0,
        successCount: 0,
        reasonCode: input.reasonCode,
        openUntil: null,
        updatedAt: input.now.toISOString()
      };
      this.#circuits.set(input.key, created);
      this.#metrics.databaseWrites += 1;
      return structuredClone(created);
    }
    if (existing.rowVersion !== input.expectedRowVersion) {
      throw new Error("integration_runtime_circuit_cas_stale");
    }
    const allowed =
      (existing.state === "closed" && targetState === "open") ||
      (existing.state === "open" && targetState === "half_open") ||
      (existing.state === "half_open" && ["closed", "open"].includes(targetState)) ||
      existing.state === targetState;
    if (!allowed) throw new Error("integration_runtime_circuit_transition_invalid");
    existing.state = targetState;
    existing.reasonCode = input.reasonCode;
    existing.openUntil = targetState === "open" ? input.openUntil : null;
    existing.failureCount += targetState === "open" ? 1 : 0;
    existing.successCount += targetState === "closed" ? 1 : 0;
    existing.rowVersion += 1;
    existing.updatedAt = input.now.toISOString();
    this.#metrics.databaseWrites += 1;
    return structuredClone(existing);
  }

  task(taskId: string) {
    const task = this.#tasks.get(taskId);
    return task ? copyTask(task) : null;
  }

  checkpoint(checkpointId: string | undefined) {
    if (!checkpointId) return null;
    const checkpoint = this.#checkpoints.get(checkpointId);
    return checkpoint ? structuredClone(checkpoint) : null;
  }

  event(eventId: string) {
    const event = this.#webhookEvents.get(eventId);
    return event ? structuredClone(event) : null;
  }

  metrics(): RuntimeLedgerMetrics {
    return { ...this.#metrics };
  }

  allTasks() {
    return [...this.#tasks.values()].map(copyTask);
  }

  #assertTaskAuthority(command: CreateRuntimeTaskCommand) {
    const connection = this.#requiredConnection(command.connectionId);
    if (
      connection.workspaceId !== command.workspaceId ||
      connection.businessEntityId !== command.businessEntityId ||
      connection.connectionGeneration !== command.connectionGeneration ||
      connection.providerKey !== command.providerKey ||
      connection.providerEnvironment !== command.providerEnvironment ||
      !activeConnectionStates.has(connection.status)
    ) {
      throw new Error("integration_sync_task_scope_denied");
    }
  }

  #requiredConnection(connectionId: string) {
    const connection = this.#connections.get(connectionId);
    if (!connection) throw new Error("integration_runtime_connection_missing");
    return connection;
  }

  #requiredTask(taskId: string) {
    const task = this.#tasks.get(taskId);
    if (!task) throw new Error("integration_sync_task_missing");
    return task;
  }

  #workerMayLease(worker: RuntimeWorkerKind, queueClass: RuntimeQueueClass) {
    return queueClass === "deterministic_intelligence"
      ? worker === "deterministic_runtime"
      : worker === "provider_runtime";
  }

  #withinConcurrency(task: RuntimeTaskRecord) {
    const leased = [...this.#tasks.values()].filter(
      (candidate) =>
        candidate.state === "leased" &&
        candidate.deliveryAttributionState === "attributed"
    );
    return (
      leased.filter((candidate) => candidate.workspaceId === task.workspaceId).length < this.#limits.workspace &&
      leased.filter((candidate) => candidate.connectionId === task.connectionId).length < this.#limits.connection &&
      leased.filter((candidate) => candidate.providerKey === task.providerKey).length < this.#limits.provider
    );
  }

  #circuitOpen(task: RuntimeTaskRecord, now: Date) {
    for (const circuit of this.#circuits.values()) {
      if (!circuit.key.includes(task.providerKey)) continue;
      if (
        circuit.state === "open" &&
        (circuit.openUntil === null || Date.parse(circuit.openUntil) > now.getTime())
      ) return true;
    }
    return false;
  }

  #assertLease(
    task: RuntimeTaskRecord,
    leaseId: string,
    ownerFingerprint: string,
    now: Date
  ) {
    if (
      task.state !== "leased" ||
      task.leaseId !== leaseId ||
      task.leaseOwnerFingerprint !== ownerFingerprint ||
      !task.leaseExpiresAt ||
      Date.parse(task.leaseExpiresAt) <= now.getTime()
    ) {
      throw new Error("integration_sync_task_lease_stale");
    }
    this.#assertTaskAuthority(task);
  }

  #prepareCheckpoint(
    task: RuntimeTaskRecord,
    commit: RuntimeCheckpointCommit,
    now: Date
  ): RuntimeCheckpointRecord {
    if (commit.downstreamCommitFingerprint.length === 0) {
      throw new Error("integration_checkpoint_downstream_commit_required");
    }
    const existing = this.#checkpoints.get(commit.checkpointId);
    if (!existing && commit.expectedCheckpointVersion !== 0) {
      throw new Error("integration_sync_checkpoint_cas_stale");
    }
    if (existing) {
      if (
        existing.checkpointVersion !== commit.expectedCheckpointVersion ||
        existing.workspaceId !== task.workspaceId ||
        existing.businessEntityId !== task.businessEntityId ||
        existing.connectionId !== task.connectionId ||
        existing.streamKey !== commit.streamKey ||
        commit.cursorVersion <= existing.cursorVersion
      ) {
        throw new Error("integration_sync_checkpoint_cas_stale");
      }
    }
    return {
      ...structuredClone(commit),
      workspaceId: task.workspaceId,
      businessEntityId: task.businessEntityId,
      connectionId: task.connectionId,
      connectionGeneration: task.connectionGeneration,
      providerKey: task.providerKey,
      providerEnvironment: task.providerEnvironment,
      checkpointVersion: (existing?.checkpointVersion ?? 0) + 1,
      lifecycle: "active",
      lastTaskId: task.id,
      lastSyncRunId: task.syncRunId,
      lastFullReconciliationAt: commit.fullReconciliation ? now.toISOString() : existing?.lastFullReconciliationAt ?? null,
      updatedAt: now.toISOString()
    };
  }

  #clearLease(task: RuntimeTaskRecord) {
    task.leaseId = null;
    task.leaseOwnerFingerprint = null;
    task.leaseExpiresAt = null;
    task.heartbeatAt = null;
  }

  #bump(task: RuntimeTaskRecord, now: Date) {
    task.rowVersion += 1;
    task.updatedAt = now.toISOString();
    this.#metrics.databaseWrites += 1;
  }
}

export function runtimeTaskFingerprint(input: {
  workspaceId: string;
  businessEntityId: string;
  connectionId: string;
  taskKind: string;
  streamKey: string;
  logicalWindow: string;
}) {
  return contractSha256({
    fingerprintPurpose: "integration_runtime_task",
    fingerprintVersion: "integration_runtime_task_fingerprint_v1",
    payload: input
  });
}

export function syntheticLeaseIdentity(seed: string) {
  return {
    leaseId: randomUUID(),
    ownerFingerprint: contractSha256({
      fingerprintPurpose: "integration_runtime_lease_owner",
      fingerprintVersion: "integration_runtime_lease_owner_fingerprint_v1",
      seed
    })
  } as const;
}
