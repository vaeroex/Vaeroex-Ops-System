import "server-only";

import { z } from "zod";

import {
  BoundedIdentifierSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import { ExternalSourceRecordVersionSchema } from "@/lib/integrations/contracts/source-facts";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { prepareExternalSourceVersionCommit } from "@/lib/integrations/persistence/serializers";

export const PROVIDER_SOURCE_AUTHORITY_CONTRACT_VERSION =
  "integration_provider_source_commit_v1" as const;

export const ProviderSourceCommitCommandSchema = z
  .object({
    contractVersion: z.literal(PROVIDER_SOURCE_AUTHORITY_CONTRACT_VERSION),
    taskId: UuidSchema,
    leaseId: UuidSchema,
    leaseOwnerFingerprint: Sha256FingerprintSchema,
    mappingId: UuidSchema,
    sourceIdentityFingerprint: Sha256FingerprintSchema,
    version: ExternalSourceRecordVersionSchema
  })
  .strict();

const ProviderSourceCommitResultSchema = z
  .object({
    sourceRecordId: UuidSchema,
    sourceVersionId: UuidSchema,
    immutableVersion: z.number().int().positive().safe(),
    sourceIdentityFingerprint: Sha256FingerprintSchema,
    sourceFingerprint: Sha256FingerprintSchema,
    currentVersionId: UuidSchema,
    idempotent: z.boolean(),
    validationState: z.literal("pending"),
    trust: z.literal("untrusted_external_input")
  })
  .strict();

export async function commitProviderExternalSourceRecordVersion(
  input: {
    taskId: string;
    leaseId: string;
    leaseOwnerFingerprint: string;
    mappingId: string;
    version: unknown;
  },
  requestId: string,
  client: ExternalIntegrationsRpcClient
) {
  const prepared = prepareExternalSourceVersionCommit(input.version);
  if (prepared.version.source.kind !== "provider") {
    throw new Error("provider_source_commit_requires_provider_source");
  }
  const command = ProviderSourceCommitCommandSchema.parse({
    contractVersion: PROVIDER_SOURCE_AUTHORITY_CONTRACT_VERSION,
    taskId: input.taskId,
    leaseId: input.leaseId,
    leaseOwnerFingerprint: input.leaseOwnerFingerprint,
    mappingId: input.mappingId,
    sourceIdentityFingerprint: prepared.sourceIdentityFingerprint,
    version: prepared.version
  });
  const result = await client.rpc("commit_provider_external_source_record_version_v1", {
    p_command: command,
    p_request_id: BoundedIdentifierSchema.parse(requestId)
  });
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`provider_source_commit_rpc_${disposition}`);
  }
  return ProviderSourceCommitResultSchema.parse(result.data);
}
