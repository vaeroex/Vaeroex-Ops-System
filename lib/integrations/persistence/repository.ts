import "server-only";

import { z } from "zod";

import { BusinessEntitySchema } from "@/lib/integrations/contracts/control-plane";
import {
  BoundedIdentifierSchema,
  BoundedLabelSchema,
  CurrencyCodeSchema,
  TimeZoneSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import {
  prepareCanonicalFactVersionCommit,
  prepareExternalSourceVersionCommit
} from "@/lib/integrations/persistence/serializers";

type RpcResult = Readonly<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;

export type ExternalIntegrationsRpcClient = Readonly<{
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}>;

const CreateBusinessEntityInputSchema = z
  .object({
    workspaceId: UuidSchema,
    parentBusinessEntityId: UuidSchema.nullable().default(null),
    entityKey: BoundedIdentifierSchema,
    entityType: z.enum(["operating_company", "holding_company", "division", "consolidated_group"]),
    displayName: BoundedLabelSchema,
    legalName: BoundedLabelSchema.nullable().default(null),
    baseCurrency: CurrencyCodeSchema,
    reportingCurrency: CurrencyCodeSchema.nullable().default(null),
    timeZone: TimeZoneSchema,
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    consolidationPolicyVersion: BoundedIdentifierSchema.nullable().default(null)
  })
  .strict();

const UpdateBusinessEntityPatchSchema = z
  .object({
    parentBusinessEntityId: UuidSchema.nullable().optional(),
    entityType: z.enum(["operating_company", "holding_company", "division", "consolidated_group"]).optional(),
    displayName: BoundedLabelSchema.optional(),
    legalName: BoundedLabelSchema.nullable().optional(),
    baseCurrency: CurrencyCodeSchema.optional(),
    reportingCurrency: CurrencyCodeSchema.nullable().optional(),
    timeZone: TimeZoneSchema.optional(),
    fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
    status: z.enum(["active", "inactive", "archived"]).optional(),
    consolidationPolicyVersion: BoundedIdentifierSchema.nullable().optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "A Business Entity patch cannot be empty");

const CommitResultSchema = z
  .object({
    immutableVersion: z.number().int().positive(),
    currentVersionId: UuidSchema,
    idempotent: z.boolean()
  })
  .passthrough();

function checkedRpcClient(client: ExternalIntegrationsRpcClient | undefined) {
  if (!client) throw new Error("external_integrations_checked_rpc_client_required");
  return client;
}

async function rpc(
  name: string,
  args: Record<string, unknown>,
  client: ExternalIntegrationsRpcClient
) {
  const result = await checkedRpcClient(client).rpc(name, args);
  if (result.error) {
    const disposition = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`external_integrations_rpc_${disposition}:${name}`);
  }
  return result.data;
}

export async function createBusinessEntity(
  input: unknown,
  client: ExternalIntegrationsRpcClient
) {
  const value = CreateBusinessEntityInputSchema.parse(input);
  const data = await rpc("create_business_entity_v1", {
    p_workspace_id: value.workspaceId,
    p_parent_business_entity_id: value.parentBusinessEntityId,
    p_entity_key: value.entityKey,
    p_entity_type: value.entityType,
    p_display_name: value.displayName,
    p_legal_name: value.legalName,
    p_base_currency: value.baseCurrency,
    p_reporting_currency: value.reportingCurrency,
    p_time_zone: value.timeZone,
    p_fiscal_year_start_month: value.fiscalYearStartMonth,
    p_consolidation_policy_version: value.consolidationPolicyVersion
  }, client);
  return BusinessEntitySchema.parse(data);
}

export async function updateBusinessEntity(
  entityId: string,
  expectedRowVersion: number,
  patch: unknown,
  client: ExternalIntegrationsRpcClient
) {
  const id = UuidSchema.parse(entityId);
  const rowVersion = z.number().int().positive().safe().parse(expectedRowVersion);
  const validatedPatch = UpdateBusinessEntityPatchSchema.parse(patch);
  const data = await rpc("update_business_entity_v1", {
    p_entity_id: id,
    p_expected_row_version: rowVersion,
    p_patch: validatedPatch
  }, client);
  return BusinessEntitySchema.parse(data);
}

export async function commitExternalSourceRecordVersion(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const prepared = prepareExternalSourceVersionCommit(input);
  const data = await rpc("commit_external_source_record_version_v1", {
    p_source_identity_fingerprint: prepared.sourceIdentityFingerprint,
    p_version: prepared.version,
    p_request_id: BoundedIdentifierSchema.parse(requestId),
    p_actor_id: BoundedIdentifierSchema.parse(actorId)
  }, client);
  return CommitResultSchema.extend({
    sourceRecordId: UuidSchema,
    sourceVersionId: UuidSchema,
    sourceIdentityFingerprint: z.literal(prepared.sourceIdentityFingerprint),
    sourceFingerprint: z.literal(prepared.sourceFingerprint)
  }).parse(data);
}

export async function commitCanonicalBusinessFactVersion(
  input: unknown,
  requestId: string,
  actorId: string,
  client: ExternalIntegrationsRpcClient
) {
  const prepared = prepareCanonicalFactVersionCommit(input);
  const data = await rpc("commit_canonical_business_fact_version_v2", {
    p_identity_fingerprint: prepared.identityFingerprint,
    p_version: prepared.version,
    p_request_id: BoundedIdentifierSchema.parse(requestId),
    p_actor_id: BoundedIdentifierSchema.parse(actorId)
  }, client);
  return CommitResultSchema.extend({
    factId: UuidSchema,
    factVersionId: UuidSchema,
    identityFingerprint: z.literal(prepared.identityFingerprint),
    factFingerprint: z.literal(prepared.factFingerprint),
    sourceCount: z.number().int().positive()
  }).parse(data);
}
