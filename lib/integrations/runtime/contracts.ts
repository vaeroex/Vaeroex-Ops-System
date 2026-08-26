import { z } from "zod";

import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import {
  BoundedIdentifierSchema,
  IsoTimestampSchema,
  ProviderKeySchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";

export const RUNTIME_CONTRACT_VERSIONS = {
  task: "integration_sync_task_v1",
  checkpoint: "integration_sync_checkpoint_v1",
  webhookEvent: "integration_webhook_event_v1",
  circuit: "integration_runtime_circuit_v1",
  rateLimit: "integration_rate_limit_state_v1",
  cloudTaskProtocol: "integration_cloud_task_protocol_v1",
  providerPage: "integration_provider_page_v1",
  durableCommit: "integration_durable_page_commit_v1"
} as const;

export const PHASE_6_MODEL_CALL_COUNT = 0 as const;
export const PHASE_6_PROMOTION_AUTHORIZED = false as const;

export const RuntimeQueueClassSchema = z.enum([
  "integration_control",
  "provider_interactive",
  "provider_bulk",
  "deterministic_intelligence"
]);

export const RuntimeTaskKindSchema = z.enum([
  "initial_historical",
  "incremental",
  "webhook_targeted_read",
  "scheduled_recovery",
  "manual_sync",
  "retry_recovery",
  "full_reconciliation",
  "deterministic_shadow"
]);

export const RUNTIME_NON_TERMINAL_TASK_STATES = [
  "pending",
  "dispatched",
  "leased",
  "retry_wait"
] as const;

export const RUNTIME_TERMINAL_TASK_STATES = [
  "succeeded",
  "failed",
  "dead_letter",
  "cancelled"
] as const;

export const RuntimeNonTerminalTaskStateSchema = z.enum(
  RUNTIME_NON_TERMINAL_TASK_STATES
);

export const RuntimeTerminalTaskStateSchema = z.enum(
  RUNTIME_TERMINAL_TASK_STATES
);

export const RuntimeTaskStateSchema = z.enum([
  ...RUNTIME_NON_TERMINAL_TASK_STATES,
  ...RUNTIME_TERMINAL_TASK_STATES
]);

export const RuntimeWorkerKindSchema = z.enum([
  "provider_runtime",
  "deterministic_runtime"
]);

export const RuntimeFailureCategorySchema = z.enum([
  "authorization",
  "rate_limit",
  "availability",
  "timeout",
  "contract",
  "data_anomaly",
  "integrity",
  "cancelled",
  "unknown"
]);

export const RuntimeControlMetadataSchema = z
  .object({
    checkpointId: UuidSchema.nullable(),
    mappingId: UuidSchema.nullable(),
    eventId: UuidSchema.nullable(),
    pageOrdinal: z.number().int().nonnegative().max(1_000_000),
    cursorVersion: z.number().int().nonnegative().max(1_000_000_000),
    windowStartAt: IsoTimestampSchema.nullable(),
    windowEndAt: IsoTimestampSchema.nullable(),
    reasonCode: BoundedIdentifierSchema,
    recordHintCount: z.number().int().nonnegative().max(100_000_000),
    coalescedEventCount: z.number().int().positive().max(100_000_000)
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.windowStartAt === null) !== (value.windowEndAt === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Runtime windows require both bounds"
      });
    }
    if (
      value.windowStartAt !== null &&
      value.windowEndAt !== null &&
      Date.parse(value.windowEndAt) < Date.parse(value.windowStartAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Runtime window end cannot precede its start"
      });
    }
    if (Buffer.byteLength(canonicalContractJson(value), "utf8") > 4_096) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Runtime control metadata exceeds its bounded ledger envelope"
      });
    }
  });

export const CreateRuntimeTaskCommandSchema = z
  .object({
    contractVersion: z.literal(RUNTIME_CONTRACT_VERSIONS.task),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    syncRunId: UuidSchema,
    parentTaskId: UuidSchema.nullable(),
    providerKey: ProviderKeySchema,
    providerEnvironment: BoundedIdentifierSchema,
    queueClass: RuntimeQueueClassSchema,
    taskKind: RuntimeTaskKindSchema,
    streamKey: BoundedIdentifierSchema,
    priority: z.number().int().min(0).max(100),
    controlMetadata: RuntimeControlMetadataSchema,
    idempotencyFingerprint: Sha256FingerprintSchema,
    coalescingFingerprint: Sha256FingerprintSchema,
    maximumAttempts: z.number().int().min(1).max(20),
    availableAt: IsoTimestampSchema,
    retentionExpiresAt: IsoTimestampSchema,
    createdAt: IsoTimestampSchema
  })
  .strict()
  .refine(
    (value) => Date.parse(value.retentionExpiresAt) > Date.parse(value.createdAt),
    "Runtime task retention must extend beyond task creation"
  );

export const CloudTaskEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(RUNTIME_CONTRACT_VERSIONS.cloudTaskProtocol),
    taskId: UuidSchema
  })
  .strict();

export const CloudTaskDeliveryMetadataSchema = z
  .object({
    taskName: z.string().min(1).max(1_024),
    queueName: z.string().min(1).max(1_024),
    retryCount: z.number().int().nonnegative().max(100),
    executionCount: z.number().int().nonnegative().max(100)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.executionCount > value.retryCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Cloud Tasks execution count cannot exceed retry count"
      });
    }
  });

export const VerifiedGoogleOidcClaimsSchema = z
  .object({
    signatureVerified: z.literal(true),
    issuer: z.enum(["accounts.google.com", "https://accounts.google.com"]),
    audience: z.string().url().max(2_048),
    subject: z.string().min(1).max(255),
    email: z.string().email().max(320),
    emailVerified: z.literal(true),
    issuedAt: z.number().int().nonnegative().safe(),
    expiresAt: z.number().int().positive().safe()
  })
  .strict();

export const RuntimeCheckpointLifecycleSchema = z.enum([
  "active",
  "invalidated",
  "rebuilding",
  "closed"
]);

export const RuntimeCheckpointKindSchema = z.enum([
  "cursor",
  "watermark_time",
  "window",
  "full_reconciliation"
]);

export const RuntimeCheckpointCursorSchema = z
  .object({
    protocolVersion: z.literal(RUNTIME_CONTRACT_VERSIONS.checkpoint),
    cursorKind: RuntimeCheckpointKindSchema,
    cursorValue: z.string().max(1_024),
    windowStartAt: IsoTimestampSchema.nullable(),
    windowEndAt: IsoTimestampSchema.nullable()
  })
  .strict()
  .refine(
    (value) => (value.windowStartAt === null) === (value.windowEndAt === null),
    "Checkpoint windows require both bounds"
  );

export const RuntimeCheckpointCommitSchema = z
  .object({
    checkpointId: UuidSchema,
    expectedCheckpointVersion: z.number().int().nonnegative().safe(),
    streamKey: BoundedIdentifierSchema,
    checkpointKind: RuntimeCheckpointKindSchema,
    cursorVersion: z.number().int().positive().safe(),
    cursor: RuntimeCheckpointCursorSchema,
    cursorFingerprint: Sha256FingerprintSchema,
    providerWatermarkAt: IsoTimestampSchema.nullable(),
    overlapSeconds: z.number().int().nonnegative().max(2_592_000),
    fullReconciliation: z.boolean(),
    downstreamCommitFingerprint: Sha256FingerprintSchema
  })
  .strict();

export const RuntimeCircuitScopeSchema = z.enum([
  "provider_api",
  "credentials",
  "queue_runtime",
  "data_anomaly",
  "deterministic_integrity"
]);

export const RuntimeCircuitLevelSchema = z.enum([
  "global",
  "provider",
  "workspace",
  "connection"
]);

export const RuntimeCircuitStateSchema = z.enum(["closed", "open", "half_open"]);

export const ProviderRateLimitObservationSchema = z
  .object({
    policyVersion: BoundedIdentifierSchema,
    category: z.enum(["none", "rate_limit", "availability", "authorization"]),
    retryAfterMs: z.number().int().nonnegative().max(86_400_000).nullable(),
    safeCode: BoundedIdentifierSchema,
    observedAt: IsoTimestampSchema
  })
  .strict();

export const ProviderRuntimeRecordSchema = z
  .object({
    sourceIdentityFingerprint: Sha256FingerprintSchema,
    sourceFingerprint: Sha256FingerprintSchema,
    changeKind: z.enum(["created", "updated", "deleted", "voided"]),
    normalizedProjection: z.record(z.unknown()).nullable()
  })
  .strict();

export const ProviderRuntimePageSchema = z
  .object({
    contractVersion: z.literal(RUNTIME_CONTRACT_VERSIONS.providerPage),
    records: ProviderRuntimeRecordSchema.array().max(10_000),
    nextCursor: RuntimeCheckpointCursorSchema.nullable(),
    providerWatermarkAt: IsoTimestampSchema.nullable(),
    rateLimit: ProviderRateLimitObservationSchema
  })
  .strict();

export const DurablePageCommitResultSchema = z
  .object({
    contractVersion: z.literal(RUNTIME_CONTRACT_VERSIONS.durableCommit),
    durableEffectFingerprint: Sha256FingerprintSchema,
    sourceVersionsCommitted: z.number().int().nonnegative().max(10_000),
    factsAccepted: z.number().int().nonnegative().max(10_000),
    contributionsChanged: z.number().int().nonnegative().max(10_000),
    deterministicDirtyNodes: z.number().int().nonnegative().max(100_000),
    promotionAuthorized: z.literal(false)
  })
  .strict();

export type RuntimeQueueClass = z.infer<typeof RuntimeQueueClassSchema>;
export type RuntimeTaskKind = z.infer<typeof RuntimeTaskKindSchema>;
export type RuntimeTaskState = z.infer<typeof RuntimeTaskStateSchema>;
export type RuntimeNonTerminalTaskState = z.infer<
  typeof RuntimeNonTerminalTaskStateSchema
>;
export type RuntimeTerminalTaskState = z.infer<
  typeof RuntimeTerminalTaskStateSchema
>;
export type RuntimeWorkerKind = z.infer<typeof RuntimeWorkerKindSchema>;
export type RuntimeControlMetadata = z.infer<typeof RuntimeControlMetadataSchema>;
export type CreateRuntimeTaskCommand = z.infer<typeof CreateRuntimeTaskCommandSchema>;
export type CloudTaskEnvelope = z.infer<typeof CloudTaskEnvelopeSchema>;
export type RuntimeCheckpointCommit = z.infer<typeof RuntimeCheckpointCommitSchema>;
export type ProviderRuntimePage = z.infer<typeof ProviderRuntimePageSchema>;
export type DurablePageCommitResult = z.infer<typeof DurablePageCommitResultSchema>;
