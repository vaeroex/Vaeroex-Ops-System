import { z } from "zod";

import { IntegrationConnectionStatusSchema } from "@/lib/integrations/contracts/control-plane";
import {
  BoundedIdentifierSchema,
  BoundedLabelSchema,
  IsoTimestampSchema,
  ProviderKeySchema,
  Sha256FingerprintSchema,
  UuidSchema,
  uniqueStringArray
} from "@/lib/integrations/contracts/primitives";
import {
  CONTROL_PLANE_CONTRACT_VERSIONS,
  CONTROL_PLANE_REGISTRY_VERSION,
  ConnectionSafeReasonCodeSchema,
  IntegrationSyncRunCountsSchema,
  IntegrationSyncRunStateSchema,
  IntegrationWorkspacePolicySchema,
  ProviderEntityMappingStatusSchema,
  SafeCapabilitySnapshotSchema
} from "@/lib/integrations/control-plane/contracts";

const ScopeSetSchema = uniqueStringArray(BoundedIdentifierSchema, 64);

export const CreateIntegrationConnectionIntentSchema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_CONTRACT_VERSIONS.connectionControl),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    providerKey: ProviderKeySchema,
    providerEnvironment: BoundedIdentifierSchema,
    safeDisplayName: BoundedLabelSchema,
    requestedScopes: ScopeSetSchema,
    providerDescriptorRegistryVersion: z.literal(CONTROL_PLANE_REGISTRY_VERSION),
    providerDescriptorRegistryFingerprint: Sha256FingerprintSchema,
    providerDescriptorFingerprint: Sha256FingerprintSchema,
    adapterVersion: BoundedIdentifierSchema,
    capabilitySnapshot: SafeCapabilitySnapshotSchema,
    configurationVersion: z.number().int().positive().safe(),
    requestedAt: IsoTimestampSchema
  })
  .strict();

export const TransitionIntegrationConnectionSchema = z
  .object({
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    expectedRowVersion: z.number().int().positive().safe(),
    expectedGeneration: z.number().int().positive().safe(),
    targetStatus: IntegrationConnectionStatusSchema,
    stateReasonCode: ConnectionSafeReasonCodeSchema,
    providerTenantReferenceFingerprint: Sha256FingerprintSchema.nullable(),
    grantedScopes: ScopeSetSchema,
    transitionedAt: IsoTimestampSchema
  })
  .strict();

export const ReplaceIntegrationConnectionGenerationSchema = z
  .object({
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    priorConnectionId: UuidSchema,
    expectedPriorRowVersion: z.number().int().positive().safe(),
    replacementConnectionId: UuidSchema,
    safeDisplayName: BoundedLabelSchema,
    requestedScopes: ScopeSetSchema,
    configurationVersion: z.number().int().positive().safe(),
    requestedAt: IsoTimestampSchema
  })
  .strict();

export const CreateProviderEntityMappingSchema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_CONTRACT_VERSIONS.entityMapping),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    providerEntityType: BoundedIdentifierSchema,
    providerEntityReferenceFingerprint: Sha256FingerprintSchema,
    safeDisplayName: BoundedLabelSchema,
    mappingRole: z.enum(["primary", "subsidiary", "location", "operating_unit"]),
    mappedAt: IsoTimestampSchema,
    replacesMappingId: UuidSchema.nullable()
  })
  .strict();

export const TransitionProviderEntityMappingSchema = z
  .object({
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    mappingId: UuidSchema,
    expectedRowVersion: z.number().int().positive().safe(),
    targetStatus: ProviderEntityMappingStatusSchema,
    verificationFingerprint: Sha256FingerprintSchema.nullable(),
    transitionedAt: IsoTimestampSchema
  })
  .strict();

export const CreateIntegrationSyncRunSchema = z
  .object({
    contractVersion: z.literal(CONTROL_PLANE_CONTRACT_VERSIONS.syncRun),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    mappingId: UuidSchema.nullable(),
    trigger: z.enum([
      "synthetic_verification",
      "provider_initialization",
      "manual",
      "recovery"
    ]),
    mode: z.enum(["initialization", "incremental", "backfill", "verification"]),
    idempotencyFingerprint: Sha256FingerprintSchema,
    windowStartAt: IsoTimestampSchema.nullable(),
    windowEndAt: IsoTimestampSchema.nullable(),
    providerContractVersion: BoundedIdentifierSchema,
    adapterVersion: BoundedIdentifierSchema,
    policyVersion: BoundedIdentifierSchema,
    createdAt: IsoTimestampSchema
  })
  .strict()
  .refine(
    (run) => (run.windowStartAt === null) === (run.windowEndAt === null),
    "Sync windows require both bounds"
  )
  .refine(
    (run) =>
      run.windowStartAt === null ||
      run.windowEndAt === null ||
      Date.parse(run.windowEndAt) >= Date.parse(run.windowStartAt),
    "Sync window end must not precede its start"
  );

export const TransitionIntegrationSyncRunSchema = z
  .object({
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    syncRunId: UuidSchema,
    expectedRowVersion: z.number().int().positive().safe(),
    targetState: IntegrationSyncRunStateSchema,
    counts: IntegrationSyncRunCountsSchema,
    errorCategory: z
      .enum(["authorization", "rate_limit", "availability", "contract", "data", "unknown"])
      .nullable(),
    errorCode: BoundedIdentifierSchema.nullable(),
    transitionedAt: IsoTimestampSchema
  })
  .strict();

export const UpsertIntegrationFreshnessSchema = z
  .object({
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    mappingId: UuidSchema.nullable(),
    domain: BoundedIdentifierSchema,
    scopeKey: BoundedIdentifierSchema,
    providerWatermarkAt: IsoTimestampSchema.nullable(),
    lastAttemptAt: IsoTimestampSchema.nullable(),
    lastSuccessfulSyncAt: IsoTimestampSchema.nullable(),
    lastReconciledAt: IsoTimestampSchema.nullable(),
    observedLagSeconds: z.number().int().nonnegative().safe().nullable(),
    policyVersion: BoundedIdentifierSchema,
    currentMaxAgeSeconds: z.number().int().positive().safe(),
    staleAfterSeconds: z.number().int().positive().safe(),
    staleBlockingLevel: z.enum(["current_intelligence", "all_derived"]),
    calculatedAt: IsoTimestampSchema,
    expectedRowVersion: z.number().int().positive().safe().nullable()
  })
  .strict()
  .refine(
    (value) => value.currentMaxAgeSeconds < value.staleAfterSeconds,
    "The stale threshold must exceed the current threshold"
  );

export const UpsertIntegrationWorkspacePolicySchema =
  IntegrationWorkspacePolicySchema;

export type CreateIntegrationConnectionIntent = Readonly<
  z.infer<typeof CreateIntegrationConnectionIntentSchema>
>;
export type TransitionIntegrationConnection = Readonly<
  z.infer<typeof TransitionIntegrationConnectionSchema>
>;
export type ReplaceIntegrationConnectionGeneration = Readonly<
  z.infer<typeof ReplaceIntegrationConnectionGenerationSchema>
>;
export type CreateProviderEntityMapping = Readonly<
  z.infer<typeof CreateProviderEntityMappingSchema>
>;
export type TransitionProviderEntityMapping = Readonly<
  z.infer<typeof TransitionProviderEntityMappingSchema>
>;
export type CreateIntegrationSyncRun = Readonly<
  z.infer<typeof CreateIntegrationSyncRunSchema>
>;
export type TransitionIntegrationSyncRun = Readonly<
  z.infer<typeof TransitionIntegrationSyncRunSchema>
>;
export type UpsertIntegrationFreshness = Readonly<
  z.infer<typeof UpsertIntegrationFreshnessSchema>
>;
