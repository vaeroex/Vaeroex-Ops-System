import "server-only";

import { z } from "zod";

import {
  BoundedIdentifierSchema,
  IsoTimestampSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import {
  CiphertextBase64Schema,
  CredentialAadContextSchema,
  KmsCryptoKeyResourceSchema
} from "@/lib/integrations/credentials/contracts";
import { CompleteRuntimeTaskCommandSchema } from "@/lib/integrations/persistence/runtime-commands";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { RuntimeQueueClassSchema, RuntimeTaskStateSchema } from "@/lib/integrations/runtime/contracts";

export const QboSandboxCloudTaskNameSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const QBO_SANDBOX_AUTHORIZATION_RECOVERY_CONTRACT_VERSION =
  "qbo_sandbox_authorization_recovery_v1" as const;
export const QBO_SANDBOX_SCOPED_DISPATCH_DISCOVERY_CONTRACT_VERSION =
  "qbo_sandbox_scoped_dispatch_discovery_v1" as const;
export const QBO_SANDBOX_SCOPED_DISPATCH_RECOVERY_CONTRACT_VERSION =
  "qbo_sandbox_scoped_dispatch_recovery_v1" as const;
export const QBO_SANDBOX_DUE_RETRY_PROMOTION_CONTRACT_VERSION =
  "qbo_sandbox_due_retry_promotion_v1" as const;
export const QBO_SANDBOX_SCOPED_DISPATCH_RESERVATION_CONTRACT_VERSION =
  "qbo_sandbox_scoped_dispatch_reservation_v1" as const;
export const QBO_SANDBOX_EXPIRED_CREDENTIAL_RECOVERY_CONTRACT_VERSION =
  "qbo_sandbox_expired_credential_recovery_v1" as const;
export const QBO_SANDBOX_ZERO_BASED_DELIVERY_RECOVERY_CONTRACT_VERSION =
  "qbo_sandbox_zero_based_delivery_recovery_v1" as const;
export const QBO_SANDBOX_DELIVERY_RETRY_COMPATIBILITY_CONTRACT_VERSION =
  "qbo_sandbox_delivery_retry_compatibility_v1" as const;
export const QBO_SANDBOX_REAUTHORIZED_PURCHASE_RECOVERY_CONTRACT_VERSION =
  "qbo_sandbox_reauthorized_purchase_recovery_v1" as const;

export const ReadQboSandboxAuthorizationRecoveryCommandSchema = z
  .object({
    contractVersion: z.literal(QBO_SANDBOX_AUTHORIZATION_RECOVERY_CONTRACT_VERSION),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    mappingId: UuidSchema
  })
  .strict();

const QboSandboxAuthorizationRecoverySchema = z
  .object({
    connectionStatus: z.enum(["authorized_unmapped", "initializing"]),
    connectionRowVersion: z.number().int().positive().safe(),
    credential: z
      .object({
        credentialId: UuidSchema,
        credentialVersion: z.number().int().positive().safe(),
        ciphertextBase64: CiphertextBase64Schema,
        aadDigest: Sha256FingerprintSchema,
        kmsKeyResource: KmsCryptoKeyResourceSchema,
        aadContext: CredentialAadContextSchema,
        accessExpiresAt: IsoTimestampSchema,
        grantedScopes: z.tuple([z.literal("com.intuit.quickbooks.accounting")]),
        externalEntityReferenceFingerprint: Sha256FingerprintSchema,
        authorizedAt: IsoTimestampSchema
      })
      .strict(),
    mapping: z.discriminatedUnion("state", [
      z.object({ state: z.literal("missing") }).strict(),
      z
        .object({
          state: z.literal("available"),
          mappingId: UuidSchema,
          status: z.enum(["pending_verification", "active"]),
          rowVersion: z.number().int().positive().safe(),
          providerEntityReferenceFingerprint: Sha256FingerprintSchema,
          verificationFingerprint: Sha256FingerprintSchema.nullable()
        })
        .strict()
    ])
  })
  .strict();

export const QboSandboxDispatchCandidateSchema = z
  .object({
    taskId: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    queueClass: RuntimeQueueClassSchema,
    streamKey: BoundedIdentifierSchema,
    rowVersion: z.number().int().positive().safe(),
    dispatchGeneration: z.number().int().nonnegative().safe()
  })
  .strict();

export const ReadQboSandboxScopedDispatchCandidatesCommandSchema = z
  .object({
    contractVersion: z.literal(
      QBO_SANDBOX_SCOPED_DISPATCH_DISCOVERY_CONTRACT_VERSION
    ),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    maximumTasks: z.number().int().min(1).max(100)
  })
  .strict();

export const SweepQboSandboxScopedDispatchTasksCommandSchema = z
  .object({
    contractVersion: z.literal(
      QBO_SANDBOX_SCOPED_DISPATCH_RECOVERY_CONTRACT_VERSION
    ),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    maximumTasks: z.number().int().min(1).max(100)
  })
  .strict();

export const PromoteQboSandboxDueRetryTasksCommandSchema = z
  .object({
    contractVersion: z.literal(
      QBO_SANDBOX_DUE_RETRY_PROMOTION_CONTRACT_VERSION
    ),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    maximumTasks: z.number().int().min(1).max(100)
  })
  .strict();

export const ReserveQboSandboxScopedDispatchTaskCommandSchema = z
  .object({
    contractVersion: z.literal(
      QBO_SANDBOX_SCOPED_DISPATCH_RESERVATION_CONTRACT_VERSION
    ),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    taskId: UuidSchema,
    expectedRowVersion: z.number().int().positive().safe(),
    dispatcherTaskName: QboSandboxCloudTaskNameSchema
  })
  .strict();

export const QboSandboxTrustedRuntimeScopeSchema = z
  .object({
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe()
  })
  .strict();

export const RecoverQboSandboxExpiredCredentialTasksCommandSchema = z
  .object({
    contractVersion: z.literal(
      QBO_SANDBOX_EXPIRED_CREDENTIAL_RECOVERY_CONTRACT_VERSION
    ),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    credentialId: UuidSchema,
    expectedCredentialVersion: z.number().int().positive().safe(),
    taskIds: z.array(UuidSchema).min(1).max(100),
    retryAfterSeconds: z.number().int().min(1).max(3_600)
  })
  .strict()
  .superRefine((command, context) => {
    if (new Set(command.taskIds).size !== command.taskIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Recovery task identities must be unique"
      });
    }
  });

export const QboSandboxZeroBasedDeliveryObservationSchema = z
  .object({
    taskId: UuidSchema,
    expectedRowVersion: z.number().int().positive().safe(),
    dispatcherTaskName: QboSandboxCloudTaskNameSchema,
    deliveryExecutionCount: z.literal(0),
    deliveryAttemptFingerprint: Sha256FingerprintSchema,
    externalEvidenceFingerprint: Sha256FingerprintSchema
  })
  .strict();

export const RecoverQboSandboxZeroBasedDeliveriesCommandSchema = z
  .object({
    contractVersion: z.literal(
      QBO_SANDBOX_ZERO_BASED_DELIVERY_RECOVERY_CONTRACT_VERSION
    ),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    observations: z
      .array(QboSandboxZeroBasedDeliveryObservationSchema)
      .min(1)
      .max(100)
  })
  .strict()
  .superRefine((command, context) => {
    if (
      new Set(command.observations.map((observation) => observation.taskId)).size !==
      command.observations.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delivery recovery task identities must be unique"
      });
    }
  });

export const QboSandboxDeliveryRetryCompatibilityObservationSchema = z
  .object({
    taskId: UuidSchema,
    expectedRowVersion: z.number().int().positive().safe(),
    dispatcherTaskName: QboSandboxCloudTaskNameSchema,
    deliveryDispatchGeneration: z.number().int().positive().safe(),
    observedDeliveryRetryCount: z.number().int().nonnegative().max(100),
    observedDeliveryExecutionCount: z.number().int().nonnegative().max(100),
    externalEvidenceFingerprint: Sha256FingerprintSchema
  })
  .strict()
  .superRefine((observation, context) => {
    if (observation.observedDeliveryExecutionCount > observation.observedDeliveryRetryCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cloud Tasks execution count cannot exceed retry count"
      });
    }
  });

export const RecoverQboSandboxDeliveryRetryCompatibilityCommandSchema = z
  .object({
    contractVersion: z.literal(
      QBO_SANDBOX_DELIVERY_RETRY_COMPATIBILITY_CONTRACT_VERSION
    ),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    observations: z
      .array(QboSandboxDeliveryRetryCompatibilityObservationSchema)
      .min(1)
      .max(100)
  })
  .strict()
  .superRefine((command, context) => {
    if (
      new Set(command.observations.map((observation) => observation.taskId)).size !==
      command.observations.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Delivery compatibility task identities must be unique"
      });
    }
  });

export const RecoverQboSandboxReauthorizedPurchaseTaskCommandSchema = z
  .object({
    contractVersion: z.literal(
      QBO_SANDBOX_REAUTHORIZED_PURCHASE_RECOVERY_CONTRACT_VERSION
    ),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    credentialId: UuidSchema,
    expectedCredentialVersion: z.number().int().positive().safe(),
    expectedCredentialRowVersion: z.number().int().positive().safe(),
    mappingId: UuidSchema,
    expectedMappingRowVersion: z.number().int().positive().safe(),
    taskId: UuidSchema,
    expectedTaskRowVersion: z.number().int().positive().safe(),
    retryAfterSeconds: z.number().int().min(1).max(3_600)
  })
  .strict();

export const QboSandboxRuntimeTaskContinuationSchema = z
  .object({
    kind: z.literal("next_page"),
    childTaskId: UuidSchema
  })
  .strict();

export const CompleteQboSandboxRuntimeTaskCommandSchema = z
  .object({
    completion: CompleteRuntimeTaskCommandSchema,
    continuation: QboSandboxRuntimeTaskContinuationSchema.nullable()
  })
  .strict();

const QboSandboxRuntimeTaskDeliverySchema = z
  .object({
    taskId: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    credentialId: UuidSchema,
    credentialVersion: z.number().int().positive().safe(),
    dispatchGeneration: z.number().int().positive().safe(),
    state: RuntimeTaskStateSchema,
    rowVersion: z.number().int().positive().safe()
  })
  .strict();

const QboSandboxRuntimeCompletionResultSchema = z
  .object({
    taskId: UuidSchema,
    state: RuntimeTaskStateSchema,
    rowVersion: z.number().int().positive().safe(),
    idempotent: z.boolean(),
    continuationTaskId: UuidSchema.nullable(),
    continuationCreated: z.boolean(),
    continuationState: RuntimeTaskStateSchema.optional(),
    continuationRowVersion: z.number().int().positive().safe().optional()
  })
  .passthrough();

const QboSandboxScopedDispatchRecoveryResultSchema = z
  .object({
    recoveredTaskCount: z.number().int().nonnegative().safe(),
    sweptAt: IsoTimestampSchema
  })
  .strict();

const QboSandboxDueRetryPromotionResultSchema = z
  .object({
    promotedTaskCount: z.number().int().nonnegative().safe(),
    promotedAt: IsoTimestampSchema
  })
  .strict();

const QboSandboxScopedDispatchReservationResultSchema = z
  .object({
    taskId: UuidSchema,
    state: z.literal("dispatched"),
    rowVersion: z.number().int().positive().safe(),
    idempotent: z.boolean()
  })
  .passthrough();

const QboSandboxExpiredCredentialRecoveryResultSchema = z
  .object({
    recoveredTaskCount: z.number().int().positive().max(100),
    recoveryGeneration: z.number().int().positive().safe(),
    recoveredAt: IsoTimestampSchema,
    idempotent: z.boolean()
  })
  .strict();

const QboSandboxZeroBasedDeliveryRecoveryResultSchema = z
  .object({
    recoveredTaskCount: z.number().int().positive().max(100),
    recoveredAt: IsoTimestampSchema,
    idempotent: z.boolean()
  })
  .strict();

const QboSandboxReauthorizedPurchaseRecoveryResultSchema = z
  .object({
    taskId: UuidSchema,
    recoveredAt: IsoTimestampSchema,
    state: z.literal("retry_wait"),
    rowVersion: z.number().int().positive().safe(),
    idempotent: z.boolean()
  })
  .strict();

export const QboSandboxRuntimeLeaseResultSchema = z.discriminatedUnion("acquired", [
  z
    .object({
      acquired: z.literal(true),
      terminalReplay: z.literal(false),
      taskId: UuidSchema,
      workspaceId: UuidSchema,
      businessEntityId: UuidSchema,
      connectionId: UuidSchema,
      connectionGeneration: z.number().int().positive().safe(),
      syncRunId: UuidSchema,
      streamKey: BoundedIdentifierSchema,
      taskKind: BoundedIdentifierSchema,
      controlMetadata: z.record(z.unknown()),
      rowVersion: z.number().int().positive().safe()
    })
    .passthrough(),
  z
    .object({
      acquired: z.literal(false),
      terminalReplay: z.boolean(),
      taskId: UuidSchema,
      state: RuntimeTaskStateSchema,
      rowVersion: z.number().int().positive().safe(),
      reasonCode: BoundedIdentifierSchema.optional()
    })
    .passthrough()
]);

async function checkedRpc(
  name: string,
  args: Record<string, unknown>,
  client: ExternalIntegrationsRpcClient
) {
  const result = await client.rpc(name, args);
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`qbo_sandbox_runtime_rpc_${disposition}:${name}`);
  }
  return result.data;
}

export async function readQboSandboxRuntimeTaskDelivery(
  taskId: string,
  dispatcherTaskName: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await checkedRpc(
    "read_qbo_sandbox_runtime_task_delivery_v1",
    {
      p_task_id: UuidSchema.parse(taskId),
      p_dispatcher_task_name: QboSandboxCloudTaskNameSchema.parse(dispatcherTaskName)
    },
    client
  );
  return QboSandboxRuntimeTaskDeliverySchema.parse(data);
}

export async function readQboSandboxAuthorizationRecovery(
  input: unknown,
  client: ExternalIntegrationsRpcClient
) {
  const data = await checkedRpc(
    "read_qbo_sandbox_authorization_recovery_v1",
    { p_command: ReadQboSandboxAuthorizationRecoveryCommandSchema.parse(input) },
    client
  );
  return QboSandboxAuthorizationRecoverySchema.parse(data);
}

export async function readQboSandboxScopedDispatchCandidates(
  input: unknown,
  client: ExternalIntegrationsRpcClient
) {
  const command = ReadQboSandboxScopedDispatchCandidatesCommandSchema.parse(input);
  const data = await checkedRpc(
    "read_qbo_sandbox_scoped_dispatch_candidates_v1",
    { p_command: command },
    client
  );
  return z.array(QboSandboxDispatchCandidateSchema).max(100).parse(data);
}

export async function sweepQboSandboxScopedDispatchTasks(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await checkedRpc(
    "sweep_qbo_sandbox_scoped_dispatch_tasks_v1",
    {
      p_command: SweepQboSandboxScopedDispatchTasksCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return QboSandboxScopedDispatchRecoveryResultSchema.parse(data);
}

export async function promoteQboSandboxDueRetryTasks(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await checkedRpc(
    "promote_qbo_sandbox_due_retry_tasks_v1",
    {
      p_command: PromoteQboSandboxDueRetryTasksCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return QboSandboxDueRetryPromotionResultSchema.parse(data);
}

export async function reserveQboSandboxScopedDispatchTask(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await checkedRpc(
    "reserve_qbo_sandbox_scoped_dispatch_task_v1",
    {
      p_command: ReserveQboSandboxScopedDispatchTaskCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return QboSandboxScopedDispatchReservationResultSchema.parse(data);
}

export function assertQboSandboxRuntimeTaskDeliveryScope(
  delivery: unknown,
  trustedScope: unknown
) {
  const checkedDelivery = QboSandboxRuntimeTaskDeliverySchema.parse(delivery);
  const checkedScope = QboSandboxTrustedRuntimeScopeSchema.parse(trustedScope);
  if (
    checkedDelivery.workspaceId !== checkedScope.workspaceId ||
    checkedDelivery.businessEntityId !== checkedScope.businessEntityId ||
    checkedDelivery.connectionId !== checkedScope.connectionId ||
    checkedDelivery.connectionGeneration !== checkedScope.connectionGeneration
  ) {
    throw new Error("qbo_sandbox_runtime_delivery_scope_mismatch");
  }
  return checkedDelivery;
}

export async function completeQboSandboxRuntimeTask(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await checkedRpc(
    "complete_qbo_sandbox_runtime_task_v1",
    {
      p_command: CompleteQboSandboxRuntimeTaskCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return QboSandboxRuntimeCompletionResultSchema.parse(data);
}

export async function recoverQboSandboxExpiredCredentialTasks(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await checkedRpc(
    "recover_qbo_sandbox_expired_credential_tasks_v1",
    {
      p_command: RecoverQboSandboxExpiredCredentialTasksCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return QboSandboxExpiredCredentialRecoveryResultSchema.parse(data);
}

export async function recoverQboSandboxZeroBasedDeliveries(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await checkedRpc(
    "recover_qbo_sandbox_zero_based_deliveries_v1",
    {
      p_command: RecoverQboSandboxZeroBasedDeliveriesCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return QboSandboxZeroBasedDeliveryRecoveryResultSchema.parse(data);
}

export async function recoverQboSandboxDeliveryRetryCompatibility(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await checkedRpc(
    "recover_qbo_sandbox_delivery_retry_compatibility_v1",
    {
      p_command: RecoverQboSandboxDeliveryRetryCompatibilityCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return QboSandboxZeroBasedDeliveryRecoveryResultSchema.parse(data);
}

export async function recoverQboSandboxReauthorizedPurchaseTask(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const data = await checkedRpc(
    "recover_qbo_sandbox_reauthorized_purchase_task_v1",
    {
      p_command: RecoverQboSandboxReauthorizedPurchaseTaskCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId),
      p_actor_id: BoundedIdentifierSchema.parse(actorId)
    },
    client
  );
  return QboSandboxReauthorizedPurchaseRecoveryResultSchema.parse(data);
}
