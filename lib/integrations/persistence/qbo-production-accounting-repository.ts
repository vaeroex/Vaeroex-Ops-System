import "server-only";

import { z } from "zod";
import { canonicalFactFingerprint, contractSha256, externalSourceFingerprint } from "@/lib/integrations/contracts/canonical";
import { BoundedIdentifierSchema, IsoTimestampSchema, Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { CanonicalBusinessFactVersionSchema, ExternalSourceRecordVersionSchema,
  type ExternalSourceRecordVersion } from "@/lib/integrations/contracts/source-facts";
import { externalSourceIdentityFingerprint } from "@/lib/integrations/persistence/identity";
import type { ExternalIntegrationsRpcClient } from "@/lib/integrations/persistence/repository";
import { QBO_PRODUCTION_ACCOUNTING_MAPPING_VERSION, QboProductionAccountingContextSchema,
  mapProductionQboAccountingSource } from "@/lib/integrations/provider-runtime/qbo/production-canonical-mapping";
import { QBO_PRODUCTION_VALIDATOR_VERSION } from "@/lib/integrations/provider-runtime/qbo/production-validation";
import { QboMinimizedSourceRecordSchema } from "@/lib/integrations/providers/qbo/contracts";

const pageLimit = z.number().int().min(1).max(25);
const versionNumber = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1);
const factHeadSchema = z.object({ factKey: BoundedIdentifierSchema, id: UuidSchema,
  immutableVersion: versionNumber }).strict();
// Return the exact native account-context rows, not only their versions: SQL
// hashes logical IDs as well. factHeads must include current tombstones.
const accountSchema = z.object({ sourceRecordId: UuidSchema, sourceVersionId: UuidSchema,
  sourceFingerprint: Sha256FingerprintSchema, version: ExternalSourceRecordVersionSchema }).strict();
const sourceSchema = z.object({ sourceRecordId: UuidSchema, sourceIdentityFingerprint: Sha256FingerprintSchema,
  sourceVersion: ExternalSourceRecordVersionSchema, priorSourceVersion: ExternalSourceRecordVersionSchema.nullable(),
  priorFacts: z.array(CanonicalBusinessFactVersionSchema).max(500), factHeads: z.array(factHeadSchema).max(500),
  effectiveValidationState: z.literal("valid").optional(),
  priorEffectiveValidationState: z.literal("valid").nullable().optional() }).strict();
const pageSchema = z.object({ authorityId: UuidSchema, connectionGeneration: versionNumber, mappingId: UuidSchema,
  mappedAt: IsoTimestampSchema, accountContextFingerprint: Sha256FingerprintSchema,
  context: QboProductionAccountingContextSchema, accountSources: z.array(accountSchema).min(1).max(2000),
  sources: z.array(sourceSchema).max(25) }).strict();
const commitResultSchema = z.discriminatedUnion("idempotent", [
  z.object({ applicationId: UuidSchema, factVersionIds: z.array(UuidSchema).max(500),
    retractedCount: z.number().int().nonnegative().safe(), idempotent: z.literal(false) }).strict(),
  z.object({ applicationId: UuidSchema, factVersionIds: z.array(UuidSchema).max(500),
    retractedCount: z.number().int().nonnegative().safe().optional(), idempotent: z.literal(true) }).strict()
]);

type AccountingPage = z.infer<typeof pageSchema>;
type AccountingSource = z.infer<typeof sourceSchema>;
type RpcName = "discover_qbo_accounting_connections_v1" | "read_qbo_accounting_page_v1" | "commit_qbo_accounting_source_v1";

function denied(reason: string): never { throw new Error(`qbo_accounting_${reason}`); }

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown, reason: string): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) denied(reason);
  return result.data;
}

async function rpc(client: ExternalIntegrationsRpcClient, name: RpcName, args: Record<string, unknown>) {
  let result;
  try { result = await client.rpc(name, args); }
  catch { denied("rpc_failed"); }
  if (!result || typeof result !== "object" || !("data" in result) || !("error" in result)) denied("rpc_failed");
  if (result.error) {
    if (result.error.code === "42501") denied("authority_denied");
    if (result.error.code === "40001") denied("snapshot_stale");
    denied("rpc_failed");
  }
  return result.data;
}

function unique(values: readonly string[], reason: string) {
  if (new Set(values).size !== values.length) denied(reason);
}

function orderedAfter(values: readonly string[], after: string | null, reason: string) {
  let previous = after;
  for (const value of values) {
    if (value !== value.toLowerCase() || (previous !== null && value <= previous)) denied(reason);
    previous = value;
  }
}

function checkSourceScope(version: ExternalSourceRecordVersion, page: AccountingPage, effectiveValid = false) {
  const context = page.context;
  if (version.workspaceId !== context.workspaceId || version.businessEntityId !== context.businessEntityId ||
    version.connectionId !== context.connectionId || version.source.kind !== "provider" ||
    version.source.providerKey !== "quickbooks_online" || version.sourceFingerprint !== externalSourceFingerprint(version) ||
    Date.parse(version.temporal.observedAt) > Date.parse(page.mappedAt) || Date.parse(version.receivedAt) > Date.parse(page.mappedAt)) {
    denied("source_binding_denied");
  }
  const validated = version.validation.state === "valid" &&
    version.validation.validatorVersion === QBO_PRODUCTION_VALIDATOR_VERSION &&
    !version.validation.issues.some((issue) => issue.severity === "error");
  const nativeDeletion = effectiveValid && version.changeKind === "deleted" && version.normalizedProjection === null &&
    version.validation.state === "pending";
  if (!validated && !nativeDeletion) denied("source_validation_required");
}

function checkPage(page: AccountingPage, connectionId: string, maximum: number, after: string | null) {
  if (page.context.connectionId !== connectionId || page.sources.length > maximum ||
    Date.parse(page.context.policyEffectiveFrom) > Date.parse(page.mappedAt)) denied("page_binding_denied");
  orderedAfter(page.sources.map((source) => source.sourceRecordId), after, "source_cursor_invalid");
  unique(page.sources.map((source) => source.sourceVersion.id), "source_version_duplicate");
  unique(page.sources.map((source) => source.sourceIdentityFingerprint), "source_identity_duplicate");
  orderedAfter(page.accountSources.map((account) => account.sourceRecordId), null, "account_order_invalid");
  unique(page.accountSources.map((account) => account.sourceVersionId), "account_version_duplicate");
  const accountRefs: string[] = [], revenueRefs: string[] = [];
  for (const account of page.accountSources) {
    checkSourceScope(account.version, page);
    const record = parse(QboMinimizedSourceRecordSchema, account.version.normalizedProjection, "account_projection_invalid");
    if (account.sourceVersionId !== account.version.id || account.sourceFingerprint !== account.version.sourceFingerprint ||
      account.version.source.kind !== "provider" || account.version.source.providerRecordType !== "Account" ||
      account.version.source.providerRecordId !== record.id || record.recordType !== "Account" ||
      record.provider.sourceEnvironment !== "production" || record.provider.realmId !== page.context.realmId ||
      !["active", "inactive"].includes(record.status)) denied("account_binding_denied");
    accountRefs.push(record.id);
    if (["Income", "Other Income"].includes(record.relationships.AccountType?.value ?? "")) revenueRefs.push(record.id);
  }
  unique(accountRefs, "account_identity_duplicate");
  if (contractSha256(page.accountSources) !== page.accountContextFingerprint ||
    contractSha256(revenueRefs.sort()) !== contractSha256([...page.context.revenueAccountRefs].sort())) {
    denied("account_context_fingerprint_mismatch");
  }
  for (const source of page.sources) {
    checkSourceScope(source.sourceVersion, page, source.effectiveValidationState === "valid");
    if (externalSourceIdentityFingerprint(source.sourceVersion) !== source.sourceIdentityFingerprint) denied("source_identity_denied");
    unique(source.factHeads.map((head) => head.factKey), "fact_head_duplicate");
    unique(source.factHeads.map((head) => head.id), "fact_head_duplicate");
    unique(source.priorFacts.map((fact) => fact.factKey), "prior_fact_duplicate");
    unique(source.priorFacts.map((fact) => fact.id), "prior_fact_duplicate");
    if (source.priorSourceVersion !== null) {
      checkSourceScope(source.priorSourceVersion, page, source.priorEffectiveValidationState === "valid");
      if (externalSourceIdentityFingerprint(source.priorSourceVersion) !== source.sourceIdentityFingerprint ||
        source.priorSourceVersion.immutableVersion > source.sourceVersion.immutableVersion ||
        (source.priorSourceVersion.immutableVersion === source.sourceVersion.immutableVersion &&
          source.priorSourceVersion.id !== source.sourceVersion.id)) denied("prior_source_binding_denied");
    } else if (source.priorFacts.length || source.factHeads.length) denied("prior_source_required");
    for (const fact of source.priorFacts) {
      const head = source.factHeads.find((candidate) => candidate.factKey === fact.factKey);
      if (!head || head.id !== fact.id || head.immutableVersion !== fact.immutableVersion ||
        fact.workspaceId !== page.context.workspaceId || fact.businessEntityId !== page.context.businessEntityId ||
        fact.factKind !== "recognized_revenue" || fact.reconciliationState !== "accepted" || fact.validationState !== "valid" ||
        fact.factFingerprint !== canonicalFactFingerprint(fact)) denied("prior_fact_head_binding_denied");
    }
  }
}

// Content-addressed IDs keep an identical native snapshot replay independent
// of process randomness. The database still owns CAS and financial authority.
function identity(page: AccountingPage, source: AccountingSource, factKey: string, purpose: "fact" | "representation") {
  const head = source.factHeads.find((candidate) => candidate.factKey === factKey);
  const hex = contractSha256({ contract: "qbo_accounting_persistence_identity_v1", purpose,
    authorityId: page.authorityId, connectionGeneration: page.connectionGeneration, mappingId: page.mappingId,
    contextFingerprint: contractSha256({ ...page.context, revenueAccountRefs: [...page.context.revenueAccountRefs].sort() }),
    accountContextFingerprint: page.accountContextFingerprint, sourceRecordId: source.sourceRecordId,
    sourceVersionId: source.sourceVersion.id, sourceIdentityFingerprint: source.sourceIdentityFingerprint,
    mappingVersion: QBO_PRODUCTION_ACCOUNTING_MAPPING_VERSION, factKey,
    immutableVersion: (head?.immutableVersion ?? 0) + 1, priorVersionId: head?.id ?? null }).slice(7);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function prepareSource(page: AccountingPage, source: AccountingSource) {
  let result;
  try {
    result = mapProductionQboAccountingSource({ sourceVersion: source.sourceVersion,
      sourceIdentityFingerprint: source.sourceIdentityFingerprint, context: page.context,
      accountSourceVersions: page.accountSources.map((account) => account.version), mappedAt: page.mappedAt,
      priorSourceVersion: source.priorSourceVersion, priorFacts: source.priorFacts,
      ...(source.effectiveValidationState === "valid" ? { effectiveValidationState: "valid" as const } : {}),
      ...(source.priorEffectiveValidationState === "valid" ? { priorEffectiveValidationState: "valid" as const } : {}),
      identityForFact: (factKey) => {
        const head = source.factHeads.find((candidate) => candidate.factKey === factKey);
        return { id: identity(page, source, factKey, "fact"), immutableVersion: (head?.immutableVersion ?? 0) + 1,
          priorVersionId: head?.id ?? null };
      }, representationIdForFact: (factKey) => identity(page, source, factKey, "representation") });
  } catch { denied("mapping_denied"); }
  if (result.contractVersion !== QBO_PRODUCTION_ACCOUNTING_MAPPING_VERSION || result.sourceRecordVersionId !== source.sourceVersion.id ||
    result.sourceFingerprint !== source.sourceVersion.sourceFingerprint || result.sourceIdentityFingerprint !== source.sourceIdentityFingerprint ||
    result.sourceAuthorityPolicyVersionId !== page.context.sourceAuthorityPolicyVersionId ||
    result.mappingContextFingerprint !== contractSha256({ ...page.context, revenueAccountRefs: [...page.context.revenueAccountRefs].sort() }) ||
    result.fullPostedRevenue !== false || result.coverage !== "not_assessed") denied("mapping_binding_denied");
  return { source, result, facts: result.candidates.map((candidate) => candidate.fact) };
}

/** The caller must persist nextConnectionId across bounded worker cycles. */
export async function discoverQboProductionAccountingConnections(input: {
  afterConnectionId: string | null; maximumConnections: number;
}, client: ExternalIntegrationsRpcClient) {
  const after = parse(UuidSchema.nullable(), input.afterConnectionId, "cursor_invalid");
  const maximum = parse(pageLimit, input.maximumConnections, "limit_invalid");
  const connectionIds = parse(z.array(UuidSchema).max(maximum), await rpc(client, "discover_qbo_accounting_connections_v1", {
    p_after_connection_id: after, p_maximum_results: maximum
  }), "discovery_invalid");
  orderedAfter(connectionIds, after, "discovery_cursor_invalid");
  return { connectionIds, nextConnectionId: connectionIds.length === maximum ? connectionIds.at(-1)! : null,
    scanComplete: connectionIds.length < maximum };
}

/** Native source authority only; no provider access or automatic retry. */
export async function applyQboProductionAccountingPage(input: {
  connectionId: string; afterSourceId: string | null; maximumSources: number; requestId: string;
}, client: ExternalIntegrationsRpcClient) {
  const connectionId = parse(UuidSchema, input.connectionId, "connection_invalid");
  const after = parse(UuidSchema.nullable(), input.afterSourceId, "cursor_invalid");
  const maximum = parse(pageLimit, input.maximumSources, "limit_invalid");
  const requestId = parse(BoundedIdentifierSchema, input.requestId, "request_invalid");
  const page = parse(pageSchema, await rpc(client, "read_qbo_accounting_page_v1", {
    p_connection_id: connectionId, p_after_source_id: after, p_maximum_results: maximum
  }), "page_invalid");
  checkPage(page, connectionId, maximum, after);
  // Validate and map the whole page before its first mutation. Commits remain
  // separate, atomic source operations; a later failure is never auto-retried.
  const plans = page.sources.map((source) => prepareSource(page, source));
  const applications = [];
  for (const { source, result, facts } of plans) {
    const committed = parse(commitResultSchema, await rpc(client, "commit_qbo_accounting_source_v1", {
      p_connection_id: connectionId, p_source_record_id: source.sourceRecordId, p_source_version_id: source.sourceVersion.id,
      p_authority_id: page.authorityId, p_account_context_fingerprint: page.accountContextFingerprint,
      p_disposition: result.disposition, p_reason_codes: [...result.reasonCodes], p_facts: facts, p_request_id: requestId
    }), "commit_result_invalid");
    unique(committed.factVersionIds, "commit_fact_duplicate");
    // Native intake may retain the exact accepted head for unchanged content
    // (including reconsent). No unrelated or merely same-key ID is acceptable.
    const expectedIds = facts.map((fact) => source.priorFacts.find((prior) => prior.factKey === fact.factKey &&
      prior.factFingerprint === fact.factFingerprint && prior.factFingerprint === canonicalFactFingerprint(fact))?.id ?? fact.id);
    if (contractSha256([...committed.factVersionIds].sort()) !== contractSha256(expectedIds.sort())) {
      denied("commit_fact_binding_denied");
    }
    applications.push({ sourceRecordId: source.sourceRecordId, sourceVersionId: source.sourceVersion.id,
      applicationId: committed.applicationId, disposition: result.disposition, reasonCodes: [...result.reasonCodes],
      factVersionIds: committed.factVersionIds, retractedCount: committed.retractedCount ?? null, idempotent: committed.idempotent });
  }
  return { connectionId, applications, nextSourceId: page.sources.length === maximum ? page.sources.at(-1)!.sourceRecordId : null,
    fullPage: page.sources.length === maximum, coverage: "not_assessed" as const, fullPostedRevenue: false as const };
}

/** At most 25 connections x 25 sources. No schedules or cursor storage owned here. */
export async function drainQboProductionAccounting(input: {
  afterConnectionId: string | null; maximumConnections: number; maximumSourcesPerConnection: number; requestId: string;
}, client: ExternalIntegrationsRpcClient) {
  const maximumSources = parse(pageLimit, input.maximumSourcesPerConnection, "limit_invalid");
  const requestId = parse(BoundedIdentifierSchema, input.requestId, "request_invalid");
  const discovery = await discoverQboProductionAccountingConnections(input, client);
  const connections = [];
  for (const connectionId of discovery.connectionIds) {
    // Applied versions are excluded by native discovery. Each cycle starts at
    // the beginning so newly eligible/changed lower source IDs cannot starve.
    connections.push(await applyQboProductionAccountingPage({ connectionId, afterSourceId: null, maximumSources, requestId }, client));
  }
  return { connections, nextConnectionId: discovery.nextConnectionId, scanComplete: discovery.scanComplete,
    coverage: "not_assessed" as const, fullPostedRevenue: false as const };
}
