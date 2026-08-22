import { z } from "zod";

import {
  BoundedIdentifierSchema,
  IsoTimestampSchema,
  ProviderKeySchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import {
  CreateRuntimeTaskCommandSchema,
  RuntimeCheckpointCommitSchema,
  RuntimeCircuitLevelSchema,
  RuntimeCircuitScopeSchema,
  RuntimeCircuitStateSchema,
  RuntimeFailureCategorySchema,
  RuntimeWorkerKindSchema
} from "@/lib/integrations/runtime/contracts";

const TaskScopeSchema = z
  .object({
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    taskId: UuidSchema,
    expectedRowVersion: z.number().int().positive().safe()
  })
  .strict();

export const MarkRuntimeTaskDispatchedCommandSchema = TaskScopeSchema.extend({
  dispatcherTaskName: z.string().min(1).max(1_024)
}).strict();

export const LeaseRuntimeTaskCommandSchema = TaskScopeSchema.extend({
  workerKind: RuntimeWorkerKindSchema,
  leaseId: UuidSchema,
  leaseOwnerFingerprint: Sha256FingerprintSchema,
  leaseSeconds: z.number().int().min(30).max(900),
  dispatcherTaskName: z.string().min(1).max(1_024),
  deliveryExecutionCount: z.number().int().nonnegative().max(100),
  deliveryAttemptFingerprint: Sha256FingerprintSchema
}).strict();

export const HeartbeatRuntimeTaskCommandSchema = TaskScopeSchema.extend({
  leaseId: UuidSchema,
  leaseOwnerFingerprint: Sha256FingerprintSchema,
  extendSeconds: z.number().int().min(30).max(900)
}).strict();

export const CompleteRuntimeTaskCommandSchema = TaskScopeSchema.extend({
  leaseId: UuidSchema,
  leaseOwnerFingerprint: Sha256FingerprintSchema,
  durableEffectFingerprint: Sha256FingerprintSchema,
  checkpoint: RuntimeCheckpointCommitSchema.nullable()
}).strict();

export const FailRuntimeTaskCommandSchema = TaskScopeSchema.extend({
  leaseId: UuidSchema,
  leaseOwnerFingerprint: Sha256FingerprintSchema,
  failureCategory: RuntimeFailureCategorySchema,
  failureCode: BoundedIdentifierSchema,
  retryable: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative().max(86_400).nullable()
}).strict();

export const CancelRuntimeTaskCommandSchema = TaskScopeSchema;

export const VerifiedWebhookEventCommandSchema = z
  .object({
    id: UuidSchema,
    providerKey: ProviderKeySchema,
    providerEnvironment: BoundedIdentifierSchema,
    specificationVersion: BoundedIdentifierSchema,
    eventType: BoundedIdentifierSchema,
    providerEventFingerprint: Sha256FingerprintSchema,
    deliveryHash: Sha256FingerprintSchema,
    providerAccountReferenceFingerprint: Sha256FingerprintSchema,
    providerEntityType: BoundedIdentifierSchema,
    providerEntityReferenceFingerprint: Sha256FingerprintSchema,
    verifiedAt: IsoTimestampSchema
  })
  .strict();

export const BindWebhookEventTaskCommandSchema = z
  .object({
    eventId: UuidSchema,
    task: CreateRuntimeTaskCommandSchema
  })
  .strict();

export const TransitionRuntimeCircuitCommandSchema = z
  .object({
    id: UuidSchema,
    circuitScope: RuntimeCircuitScopeSchema,
    circuitLevel: RuntimeCircuitLevelSchema,
    providerKey: ProviderKeySchema.nullable(),
    providerEnvironment: BoundedIdentifierSchema.nullable(),
    workspaceId: UuidSchema.nullable(),
    businessEntityId: UuidSchema.nullable(),
    connectionId: UuidSchema.nullable(),
    expectedRowVersion: z.number().int().nonnegative().safe(),
    targetState: RuntimeCircuitStateSchema,
    reasonCode: BoundedIdentifierSchema,
    openSeconds: z.number().int().positive().max(86_400).nullable()
  })
  .strict();

export const AcquireRuntimeRatePermitCommandSchema = z
  .object({
    id: UuidSchema,
    providerKey: ProviderKeySchema,
    providerEnvironment: BoundedIdentifierSchema,
    workspaceId: UuidSchema.nullable(),
    connectionId: UuidSchema.nullable(),
    expectedRowVersion: z.number().int().nonnegative().safe(),
    capacityMilli: z.number().int().min(1_000).max(1_000_000),
    refillMilliPerSecond: z.number().int().min(1).max(1_000_000),
    costMilli: z.number().int().min(1).max(1_000_000),
    maximumConcurrency: z.number().int().min(1).max(1_000),
    observedRetryAfterSeconds: z.number().int().nonnegative().max(86_400).nullable(),
    observationCategory: z.enum(["none", "rate_limit", "availability", "authorization"]),
    policyVersion: BoundedIdentifierSchema
  })
  .strict();

export type CreateRuntimeTaskCommand = z.infer<typeof CreateRuntimeTaskCommandSchema>;
export type MarkRuntimeTaskDispatchedCommand = z.infer<typeof MarkRuntimeTaskDispatchedCommandSchema>;
export type LeaseRuntimeTaskCommand = z.infer<typeof LeaseRuntimeTaskCommandSchema>;
export type HeartbeatRuntimeTaskCommand = z.infer<typeof HeartbeatRuntimeTaskCommandSchema>;
export type CompleteRuntimeTaskCommand = z.infer<typeof CompleteRuntimeTaskCommandSchema>;
export type FailRuntimeTaskCommand = z.infer<typeof FailRuntimeTaskCommandSchema>;
export type VerifiedWebhookEventCommand = z.infer<typeof VerifiedWebhookEventCommandSchema>;
