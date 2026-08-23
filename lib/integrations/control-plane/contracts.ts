import { z } from "zod";

import {
  IntegrationConnectionSchema,
  IntegrationConnectionStatusSchema
} from "@/lib/integrations/contracts/control-plane";
import {
  FreshnessBlockingLevelSchema,
  FreshnessStateSchema,
  FreshnessStatusSchema
} from "@/lib/integrations/contracts/intelligence";
import {
  BoundedIdentifierSchema,
  BoundedLabelSchema,
  IsoTimestampSchema,
  ProviderKeySchema,
  Sha256FingerprintSchema,
  UuidSchema,
  uniqueStringArray
} from "@/lib/integrations/contracts/primitives";
import { ProviderDescriptorSchema } from "@/lib/integrations/contracts/provider-adapter";

export const CONTROL_PLANE_CONTRACT_VERSIONS = {
  providerRegistry: "provider_descriptor_registry_v1",
  connectionControl: "integration_connection_control_v1",
  entityMapping: "provider_entity_mapping_v1",
  syncRun: "integration_sync_run_v1",
  workspacePolicy: "integration_workspace_policy_v1",
  connectionSummary: "integration_connection_summary_v1",
  freshnessSummary: "integration_freshness_summary_v1"
} as const;

export const CONTROL_PLANE_REGISTRY_VERSION =
  "vaeroex_provider_descriptors_v1" as const;

export const PHASE_4_MODEL_CALL_COUNT = 0 as const;

const identifiers = (maximum: number) =>
  uniqueStringArray(BoundedIdentifierSchema, maximum);

export const ProviderDescriptorRegistryEntrySchema = z
  .object({
    descriptor: ProviderDescriptorSchema,
    descriptorFingerprint: Sha256FingerprintSchema
  })
  .strict();

export const ProviderDescriptorRegistrySchema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_CONTRACT_VERSIONS.providerRegistry),
    registryVersion: z.literal(CONTROL_PLANE_REGISTRY_VERSION),
    descriptors: z.array(ProviderDescriptorRegistryEntrySchema).min(1).max(64),
    registryFingerprint: Sha256FingerprintSchema
  })
  .strict()
  .superRefine((registry, context) => {
    const keys = registry.descriptors.map((entry) => entry.descriptor.providerKey);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["descriptors"],
        message: "Provider descriptor keys must be unique"
      });
    }
  });

export type ProviderDescriptorRegistry = Readonly<
  z.infer<typeof ProviderDescriptorRegistrySchema>
>;

export const SafeCapabilitySnapshotSchema = z
  .object({
    operations: identifiers(64),
    domains: identifiers(64),
    requiredStreamKeys: identifiers(64),
    supportsBackfill: z.boolean(),
    webhookMode: z.enum(["none", "change_hints", "verified_events"]),
    incrementalMode: z.enum(["none", "cursor", "change_token", "notification_hint"])
  })
  .strict();

export const ConnectionSafeReasonCodeSchema = z.enum([
  "authorization_pending",
  "authorization_completed",
  "mapping_required",
  "initial_sync_pending",
  "healthy",
  "freshness_warning",
  "control_plane_error",
  "authorization_required",
  "customer_disconnect_requested",
  "disconnected",
  "deletion_requested",
  "deleted"
]);

export const IntegrationConnectionControlSchema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_CONTRACT_VERSIONS.connectionControl),
    connection: IntegrationConnectionSchema,
    safeDisplayName: BoundedLabelSchema,
    providerDescriptorRegistryVersion: z.literal(CONTROL_PLANE_REGISTRY_VERSION),
    providerDescriptorRegistryFingerprint: Sha256FingerprintSchema,
    providerDescriptorFingerprint: Sha256FingerprintSchema,
    adapterVersion: BoundedIdentifierSchema,
    capabilitySnapshot: SafeCapabilitySnapshotSchema,
    connectionSeriesId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    replacesConnectionId: UuidSchema.nullable(),
    stateReasonCode: ConnectionSafeReasonCodeSchema,
    authorizedAt: IsoTimestampSchema.nullable(),
    disconnectedAt: IsoTimestampSchema.nullable(),
    deletedAt: IsoTimestampSchema.nullable(),
    rowVersion: z.number().int().positive().safe()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.connectionGeneration === 1 && value.connectionSeriesId !== value.connection.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["connectionSeriesId"],
        message: "The first connection generation establishes its series identity"
      });
    }
    if (value.connectionGeneration === 1 && value.replacesConnectionId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replacesConnectionId"],
        message: "The first connection generation cannot replace another connection"
      });
    }
    if (value.connectionGeneration > 1 && value.replacesConnectionId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replacesConnectionId"],
        message: "Replacement generations require the prior connection identity"
      });
    }
    if (
      value.connection.status === "authorized_unmapped" &&
      (value.authorizedAt === null ||
        value.connection.providerTenantReferenceFingerprint === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizedAt"],
        message: "Authorized connections require provider authorization evidence"
      });
    }
    if (
      [
        "initializing",
        "active",
        "degraded",
        "reauthorization_required"
      ].includes(value.connection.status) &&
      (value.authorizedAt === null ||
        value.connection.providerTenantReferenceFingerprint === null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizedAt"],
        message: "Post-authorization lifecycle states preserve authorization evidence"
      });
    }
    if (
      value.connection.status === "disconnected" &&
      value.disconnectedAt === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["disconnectedAt"],
        message: "Disconnected connections require a disconnected timestamp"
      });
    }
    if (value.connection.status === "deleted" && value.deletedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["deletedAt"],
        message: "Deleted connections require a deleted timestamp"
      });
    }
  });

export type IntegrationConnectionControl = Readonly<
  z.infer<typeof IntegrationConnectionControlSchema>
>;

export const ProviderEntityMappingStatusSchema = z.enum([
  "pending_verification",
  "active",
  "inactive",
  "replaced"
]);

export const ProviderEntityMappingSchema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_CONTRACT_VERSIONS.entityMapping),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    providerKey: ProviderKeySchema,
    providerEnvironment: BoundedIdentifierSchema,
    providerEntityType: BoundedIdentifierSchema,
    providerEntityReferenceFingerprint: Sha256FingerprintSchema,
    safeDisplayName: BoundedLabelSchema,
    mappingSeriesId: UuidSchema,
    mappingRole: z.enum(["primary", "subsidiary", "location", "operating_unit"]),
    status: ProviderEntityMappingStatusSchema,
    verificationMode: z.enum(["synthetic_phase_4", "qbo_realm_mapping_v1"]),
    verificationFingerprint: Sha256FingerprintSchema.nullable(),
    verifiedAt: IsoTimestampSchema.nullable(),
    mappedBy: UuidSchema.nullable(),
    mappedAt: IsoTimestampSchema,
    replacesMappingId: UuidSchema.nullable(),
    mappingVersion: z.number().int().positive().safe(),
    rowVersion: z.number().int().positive().safe()
  })
  .strict()
  .superRefine((mapping, context) => {
    const verified =
      mapping.verificationFingerprint !== null && mapping.verifiedAt !== null;
    if (mapping.status === "active" && !verified) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verificationFingerprint"],
        message: "Active mappings require provider verification evidence"
      });
    }
    if (mapping.mappingVersion === 1 && mapping.replacesMappingId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replacesMappingId"],
        message: "The first mapping version cannot replace another mapping"
      });
    }
    if (mapping.mappingVersion === 1 && mapping.mappingSeriesId !== mapping.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["mappingSeriesId"],
        message: "The first mapping version establishes its series identity"
      });
    }
    if (mapping.mappingVersion > 1 && mapping.replacesMappingId === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["replacesMappingId"],
        message: "Replacement mappings require the prior mapping identity"
      });
    }
  });

export type ProviderEntityMapping = Readonly<
  z.infer<typeof ProviderEntityMappingSchema>
>;

export const IntegrationSyncRunStateSchema = z.enum([
  "created",
  "running",
  "succeeded",
  "partially_succeeded",
  "failed",
  "cancelled"
]);

export const IntegrationSyncRunCountsSchema = z
  .object({
    recordsObserved: z.number().int().nonnegative().max(1_000_000_000).safe(),
    recordsAccepted: z.number().int().nonnegative().max(1_000_000_000).safe(),
    recordsRejected: z.number().int().nonnegative().max(1_000_000_000).safe(),
    factsAccepted: z.number().int().nonnegative().max(1_000_000_000).safe(),
    contributionsChanged: z.number().int().nonnegative().max(1_000_000_000).safe()
  })
  .strict()
  .superRefine((counts, context) => {
    if (counts.recordsAccepted + counts.recordsRejected > counts.recordsObserved) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recordsAccepted"],
        message: "Accepted and rejected records cannot exceed observed records"
      });
    }
  });

export const IntegrationSyncRunSchema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_CONTRACT_VERSIONS.syncRun),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    mappingId: UuidSchema.nullable(),
    connectionGeneration: z.number().int().positive().safe(),
    trigger: z.enum([
      "synthetic_verification",
      "provider_initialization",
      "manual",
      "recovery"
    ]),
    mode: z.enum(["initialization", "incremental", "backfill", "verification"]),
    state: IntegrationSyncRunStateSchema,
    idempotencyFingerprint: Sha256FingerprintSchema,
    windowStartAt: IsoTimestampSchema.nullable(),
    windowEndAt: IsoTimestampSchema.nullable(),
    providerContractVersion: BoundedIdentifierSchema,
    adapterVersion: BoundedIdentifierSchema,
    policyVersion: BoundedIdentifierSchema,
    counts: IntegrationSyncRunCountsSchema,
    errorCategory: z
      .enum(["authorization", "rate_limit", "availability", "contract", "data", "unknown"])
      .nullable(),
    errorCode: BoundedIdentifierSchema.nullable(),
    createdAt: IsoTimestampSchema,
    startedAt: IsoTimestampSchema.nullable(),
    finishedAt: IsoTimestampSchema.nullable(),
    rowVersion: z.number().int().positive().safe()
  })
  .strict()
  .superRefine((run, context) => {
    if ((run.windowStartAt === null) !== (run.windowEndAt === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["windowEndAt"],
        message: "Sync windows require both bounds"
      });
    }
    if (
      run.windowStartAt !== null &&
      run.windowEndAt !== null &&
      Date.parse(run.windowEndAt) < Date.parse(run.windowStartAt)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["windowEndAt"],
        message: "Sync window end must not precede its start"
      });
    }
    const terminal = [
      "succeeded",
      "partially_succeeded",
      "failed",
      "cancelled"
    ].includes(run.state);
    if ((run.state === "running" || terminal) && run.startedAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["startedAt"],
        message: "Started and terminal sync runs require a start timestamp"
      });
    }
    if (terminal !== (run.finishedAt !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["finishedAt"],
        message: "Only terminal sync runs carry a finish timestamp"
      });
    }
    const hasError = run.errorCategory !== null && run.errorCode !== null;
    if ((run.state === "failed") !== hasError) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["errorCategory"],
        message: "Only failed runs carry a redacted error category and code"
      });
    }
  });

export type IntegrationSyncRun = Readonly<
  z.infer<typeof IntegrationSyncRunSchema>
>;

export const IntegrationWorkspacePolicySchema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_CONTRACT_VERSIONS.workspacePolicy),
    id: UuidSchema,
    workspaceId: UuidSchema,
    providerKey: ProviderKeySchema,
    providerEnvironment: BoundedIdentifierSchema,
    state: z.enum(["enabled", "paused", "disabled"]),
    syncEnabled: z.boolean(),
    historyHorizonDays: z.number().int().min(1).max(3_650).safe(),
    maximumConcurrency: z.number().int().min(1).max(32).safe(),
    freshnessPolicyVersion: BoundedIdentifierSchema,
    retentionPolicyVersion: BoundedIdentifierSchema,
    rowVersion: z.number().int().positive().safe()
  })
  .strict()
  .superRefine((policy, context) => {
    if ((policy.state === "enabled") !== policy.syncEnabled) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["syncEnabled"],
        message: "Only enabled integration policies permit synchronization"
      });
    }
  });

export type IntegrationWorkspacePolicy = Readonly<
  z.infer<typeof IntegrationWorkspacePolicySchema>
>;

export const PersistedIntegrationFreshnessSchema = z
  .object({
    id: UuidSchema,
    providerKey: ProviderKeySchema,
    state: FreshnessStateSchema,
    stateFingerprint: Sha256FingerprintSchema
  })
  .strict();

export type PersistedIntegrationFreshness = Readonly<
  z.infer<typeof PersistedIntegrationFreshnessSchema>
>;

export const IntegrationConnectionSummarySchema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_CONTRACT_VERSIONS.connectionSummary),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    providerKey: ProviderKeySchema,
    providerEnvironment: BoundedIdentifierSchema,
    safeDisplayName: BoundedLabelSchema,
    status: IntegrationConnectionStatusSchema,
    stateReasonCode: ConnectionSafeReasonCodeSchema,
    requestedScopes: identifiers(64),
    grantedScopes: identifiers(64),
    capabilitySnapshot: SafeCapabilitySnapshotSchema,
    adapterVersion: BoundedIdentifierSchema,
    configurationVersion: z.number().int().positive().safe(),
    connectionGeneration: z.number().int().positive().safe(),
    statusChangedAt: IsoTimestampSchema,
    disconnectedAt: IsoTimestampSchema.nullable(),
    rowVersion: z.number().int().positive().safe()
  })
  .strict();

export const IntegrationFreshnessSummarySchema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_CONTRACT_VERSIONS.freshnessSummary),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    providerKey: ProviderKeySchema,
    domain: BoundedIdentifierSchema,
    scopeKey: BoundedIdentifierSchema,
    lastAttemptAt: IsoTimestampSchema.nullable(),
    lastSuccessfulSyncAt: IsoTimestampSchema.nullable(),
    lastReconciledAt: IsoTimestampSchema.nullable(),
    observedLagSeconds: z.number().int().nonnegative().safe().nullable(),
    status: FreshnessStatusSchema,
    blockingLevel: FreshnessBlockingLevelSchema,
    reasonCode: BoundedIdentifierSchema.nullable(),
    policyVersion: BoundedIdentifierSchema,
    calculatedAt: IsoTimestampSchema,
    rowVersion: z.number().int().positive().safe()
  })
  .strict();

export type IntegrationConnectionSummary = Readonly<
  z.infer<typeof IntegrationConnectionSummarySchema>
>;
export type IntegrationFreshnessSummary = Readonly<
  z.infer<typeof IntegrationFreshnessSummarySchema>
>;
