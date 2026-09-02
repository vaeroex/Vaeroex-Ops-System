import "server-only";

import { z } from "zod";

import {
  BoundedIdentifierSchema,
  ContractJsonObjectSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import { ExternalSourceRecordVersionSchema } from "@/lib/integrations/contracts/source-facts";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";

export const PROVIDER_SOURCE_STATE_READ_CONTRACT_VERSION =
  "integration_provider_source_state_read_v1" as const;
export const PROVIDER_SOURCE_VALIDATION_CONTRACT_VERSION =
  "integration_provider_source_validation_v1" as const;
export const PROVIDER_PENDING_SOURCE_READ_CONTRACT_VERSION =
  "integration_provider_pending_source_read_v1" as const;
export const PROVIDER_CURRENT_VALID_SOURCE_READ_CONTRACT_VERSION =
  "integration_provider_current_valid_source_read_v1" as const;

export const ReadProviderSourceStateCommandSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_SOURCE_STATE_READ_CONTRACT_VERSION),
    taskId: UuidSchema,
    leaseId: UuidSchema,
    leaseOwnerFingerprint: Sha256FingerprintSchema,
    mappingId: UuidSchema,
    providerRecordType: BoundedIdentifierSchema,
    providerRecordId: BoundedIdentifierSchema
  })
  .strict();

export const ProviderSourceStateResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("missing") }).strict(),
  z
    .object({
      state: z.literal("available"),
      sourceRecordId: UuidSchema,
      currentVersionId: UuidSchema,
      immutableVersion: z.number().int().positive().safe(),
      sourceFingerprint: Sha256FingerprintSchema,
      validationState: z.enum(["pending", "valid", "invalid", "quarantined"]),
      changeKind: z.enum(["created", "updated", "corrected", "voided", "deleted", "unchanged"]),
      providerVersionReference: BoundedIdentifierSchema.nullable(),
      normalizedProjection: ContractJsonObjectSchema.nullable()
    })
    .strict()
]);

export const ReadPendingProviderSourcesCommandSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_PENDING_SOURCE_READ_CONTRACT_VERSION),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    mappingId: UuidSchema,
    maximumResults: z.number().int().min(1).max(500).safe()
  })
  .strict();

export const ReadCurrentValidProviderSourcesCommandSchema =
  ReadPendingProviderSourcesCommandSchema.extend({
    contractVersion: z.literal(PROVIDER_CURRENT_VALID_SOURCE_READ_CONTRACT_VERSION)
  }).strict();

export const PendingProviderSourceSchema = z
  .object({
    sourceRecordId: UuidSchema,
    sourceIdentityFingerprint: Sha256FingerprintSchema,
    pendingVersion: ExternalSourceRecordVersionSchema
  })
  .strict();

export const CurrentValidProviderSourceSchema = z
  .object({
    sourceRecordId: UuidSchema,
    sourceIdentityFingerprint: Sha256FingerprintSchema,
    sourceVersion: ExternalSourceRecordVersionSchema
  })
  .strict();

export const ValidateProviderSourceCommandSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_SOURCE_VALIDATION_CONTRACT_VERSION),
    pendingSourceVersionId: UuidSchema,
    expectedPendingSourceFingerprint: Sha256FingerprintSchema,
    validatedVersion: ExternalSourceRecordVersionSchema
  })
  .strict();

export const ProviderSourceValidationResultSchema = z
  .object({
    sourceRecordId: UuidSchema,
    sourceVersionId: UuidSchema,
    immutableVersion: z.number().int().positive().safe(),
    sourceFingerprint: Sha256FingerprintSchema,
    validationState: z.enum(["valid", "quarantined"]),
    idempotent: z.boolean()
  })
  .strict();

export async function readProviderExternalSourceRecordState(
  input: unknown,
  client: ExternalIntegrationsRpcClient
) {
  const result = await client.rpc(
    "read_provider_external_source_record_state_v1",
    { p_command: ReadProviderSourceStateCommandSchema.parse(input) }
  );
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`provider_source_state_read_rpc_${disposition}`);
  }
  return ProviderSourceStateResultSchema.parse(result.data);
}

export async function validateProviderExternalSourceRecordVersion(
  input: unknown,
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  const result = await client.rpc(
    "validate_provider_external_source_record_version_v1",
    {
      p_command: ValidateProviderSourceCommandSchema.parse(input),
      p_request_id: BoundedIdentifierSchema.parse(requestId)
    }
  );
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`provider_source_validation_rpc_${disposition}`);
  }
  return ProviderSourceValidationResultSchema.parse(result.data);
}

export async function readPendingProviderExternalSourceRecordVersions(
  input: unknown,
  client: ExternalIntegrationsRpcClient
) {
  const result = await client.rpc(
    "read_qbo_sandbox_pending_source_versions_v1",
    { p_command: ReadPendingProviderSourcesCommandSchema.parse(input) }
  );
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`provider_pending_source_read_rpc_${disposition}`);
  }
  return z.array(PendingProviderSourceSchema).max(500).parse(result.data);
}

export async function readCurrentValidProviderExternalSourceRecordVersions(
  input: unknown,
  client: ExternalIntegrationsRpcClient
) {
  const result = await client.rpc(
    "read_qbo_sandbox_current_valid_source_versions_v1",
    { p_command: ReadCurrentValidProviderSourcesCommandSchema.parse(input) }
  );
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`provider_current_valid_source_read_rpc_${disposition}`);
  }
  return z.array(CurrentValidProviderSourceSchema).max(500).parse(result.data);
}
