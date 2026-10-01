import { z } from "zod";

import { canonicalFactFingerprint, contractSha256, externalSourceFingerprint } from "@/lib/integrations/contracts/canonical";
import { CurrencyCodeSchema, IsoDateSchema, IsoTimestampSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { CanonicalBusinessFactVersionSchema, ExternalSourceRecordVersionSchema,
  type CanonicalBusinessFactVersion, type ExternalSourceRecordVersion } from "@/lib/integrations/contracts/source-facts";
import { addCanonicalDecimals, negateCanonicalDecimal } from "@/lib/integrations/deterministic/decimal";
import { externalSourceIdentityFingerprint } from "@/lib/integrations/persistence/identity";
import { buildQboRevenueCandidate, type QboFactIdentity, type QboRevenueCandidate } from "@/lib/integrations/provider-runtime/qbo/canonical-mapping";
import { QBO_PRODUCTION_VALIDATOR_VERSION } from "@/lib/integrations/provider-runtime/qbo/production-validation";
import { QBO_ACCOUNTING_MINIMIZATION_VERSION, QBO_MASTER_RECORD_TYPES, QBO_REPORT_CONTRACT_VERSION, QBO_TRANSACTION_RECORD_TYPES,
  QboMinimizedSourceRecordSchema, QboReportControlObservationSchema,
  type QboMinimizedSourceRecord } from "@/lib/integrations/providers/qbo/contracts";
import { qboReportProviderRecordId } from "@/lib/integrations/providers/qbo/source-records";

export const QBO_PRODUCTION_ACCOUNTING_MAPPING_VERSION = "qbo_production_accounting_mapping_v1" as const;

/** Supplied by checked owner/policy resolution, never derived from item defaults or request fields. */
export const QboProductionAccountingContextSchema = z.object({
  workspaceId: UuidSchema,
  businessEntityId: UuidSchema,
  connectionId: UuidSchema,
  realmId: z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
  providerEnvironment: z.literal("production"),
  sourceAuthorityPolicyVersionId: UuidSchema,
  policyEffectiveFrom: IsoTimestampSchema,
  accountingBasis: z.literal("accrual"),
  reportingCurrency: CurrencyCodeSchema,
  postingDateFrom: IsoDateSchema,
  postingDateThrough: IsoDateSchema,
  revenueAccountRefs: z.array(z.string().min(1).max(128)).min(1).max(10_000)
}).strict().superRefine((value, context) => {
  if (value.postingDateFrom > value.postingDateThrough ||
    new Set(value.revenueAccountRefs).size !== value.revenueAccountRefs.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Accounting scope dates and account references must be unambiguous" });
  }
});

export type QboProductionAccountingContext = Readonly<z.infer<typeof QboProductionAccountingContextSchema>>;
export type QboProductionAccountingMappingInput = Readonly<{
  sourceVersion: unknown;
  sourceIdentityFingerprint: string;
  context: QboProductionAccountingContext;
  accountSourceVersions: readonly unknown[];
  mappedAt: string;
  // Native read RPC signals only. Immutable pending deletion rows remain intact.
  effectiveValidationState?: "valid";
  priorEffectiveValidationState?: "valid";
  // The caller must load the complete prior fact set, including removed lines.
  priorSourceVersion: unknown | null;
  priorFacts: readonly unknown[];
  identityForFact: (factKey: string, ordinal: number) => QboFactIdentity;
  representationIdForFact: (factKey: string, ordinal: number) => string;
}>;

export type QboProductionAccountingMappingResult = Readonly<{
  contractVersion: typeof QBO_PRODUCTION_ACCOUNTING_MAPPING_VERSION;
  disposition: "mapped_partial" | "non_contributing" | "review_required" | "retraction_required";
  sourceRecordVersionId: string;
  sourceFingerprint: string;
  sourceIdentityFingerprint: string;
  sourceAuthorityPolicyVersionId: string;
  mappingContextFingerprint: string;
  accountEvidence: readonly Readonly<{ sourceRecordVersionId: string; sourceFingerprint: string }>[];
  candidates: readonly QboRevenueCandidate[];
  lifecycle: Readonly<{
    action: "replace_fact_set" | "retract_fact_set" | "hold" | "none";
    priorFactVersionIds: readonly string[];
  }>;
  reasonCodes: readonly string[];
  coverage: "not_assessed";
  fullPostedRevenue: false;
}>;

const salesTypes = new Set(["Invoice", "SalesReceipt", "CreditMemo", "RefundReceipt"]);
const masterTypes = new Set<string>(QBO_MASTER_RECORD_TYPES);
const deletableTypes = new Set<string>(["Account", "Customer", "Vendor", "Item", ...QBO_TRANSACTION_RECORD_TYPES]);

function denied(reason: string): never {
  throw new Error(`qbo_production_accounting_${reason}`);
}

function nativeValidatedDeletion(source: ExternalSourceRecordVersion, effectiveValidationState?: "valid") {
  return effectiveValidationState === "valid" && source.validation.state === "pending" &&
    source.validation.validatorVersion === "qbo_phase_7_contract_validator_v1" &&
    source.changeKind === "deleted" && source.normalizedProjection === null &&
    ["qbo_minimizer_v1", QBO_ACCOUNTING_MINIMIZATION_VERSION, "qbo_cdc_tombstone_v1"].includes(source.normalizedSchemaVersion) &&
    source.source.kind === "provider" && deletableTypes.has(source.source.providerRecordType) &&
    source.recordKind === `qbo_${source.source.providerRecordType.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}` &&
    source.temporal.basis === "event" && source.temporal.periodStart === null && source.temporal.periodEnd === null &&
    source.temporal.providerUpdatedAt !== null &&
    Date.parse(source.temporal.providerUpdatedAt) <= Date.parse(source.temporal.observedAt) &&
    (source.temporal.providerCreatedAt === null || Date.parse(source.temporal.providerCreatedAt) <= Date.parse(source.temporal.providerUpdatedAt)) &&
    (source.temporal.postingDate === null || validDate(source.temporal.postingDate)) &&
    source.temporal.effectiveAt === (source.temporal.postingDate ? `${source.temporal.postingDate}T00:00:00.000Z` : null);
}

function checkedSource(value: unknown, context: QboProductionAccountingContext, mappedAt: string,
  effectiveValidationState?: "valid") {
  const source = ExternalSourceRecordVersionSchema.parse(value);
  const validated = source.validation.state === "valid" && source.validation.validatorVersion === QBO_PRODUCTION_VALIDATOR_VERSION;
  if (source.workspaceId !== context.workspaceId || source.businessEntityId !== context.businessEntityId ||
    source.connectionId !== context.connectionId || source.source.kind !== "provider" ||
    source.source.providerKey !== "quickbooks_online" || (!validated && !nativeValidatedDeletion(source, effectiveValidationState)) ||
    source.validation.issues.some((issue) => issue.severity === "error") ||
    source.sourceFingerprint !== externalSourceFingerprint(source) ||
    Date.parse(source.temporal.observedAt) > Date.parse(mappedAt) || Date.parse(source.receivedAt) > Date.parse(mappedAt)) {
    denied("source_binding_denied");
  }
  return source;
}

function validDate(value: string) {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function checkedRecord(source: ExternalSourceRecordVersion, context: QboProductionAccountingContext) {
  const record = QboMinimizedSourceRecordSchema.parse(source.normalizedProjection);
  if (source.source.kind !== "provider" || record.provider.realmId !== context.realmId ||
    record.provider.sourceEnvironment !== "production" || record.id !== source.source.providerRecordId ||
    record.recordType !== source.source.providerRecordType || record.providerVersionReference !== source.source.providerVersionReference ||
    record.minimizationVersion !== source.normalizedSchemaVersion || record.accounting.sourceCurrency !== source.accounting.currency ||
    record.accounting.basis !== source.accounting.basis || record.temporal.postingDate !== source.temporal.postingDate ||
    record.metadata.providerCreatedAt !== source.temporal.providerCreatedAt ||
    record.metadata.providerUpdatedAt !== source.temporal.providerUpdatedAt ||
    source.temporal.basis !== "event" || source.temporal.effectiveAt !==
      (record.temporal.postingDate ? `${record.temporal.postingDate}T00:00:00.000Z` : null) ||
    (record.temporal.postingDate !== null && !validDate(record.temporal.postingDate))) {
    denied("projection_binding_denied");
  }
  return record;
}

function checkedPriorFacts(input: QboProductionAccountingMappingInput, source: ExternalSourceRecordVersion,
  context: QboProductionAccountingContext) {
  const facts = CanonicalBusinessFactVersionSchema.array().max(500).parse(input.priorFacts);
  if (input.priorSourceVersion === null) {
    if (facts.length) denied("prior_source_required");
    return facts;
  }
  const prior = checkedSource(input.priorSourceVersion, context, input.mappedAt, input.priorEffectiveValidationState);
  if (externalSourceIdentityFingerprint(prior) !== externalSourceIdentityFingerprint(source) ||
    prior.immutableVersion > source.immutableVersion ||
    (prior.immutableVersion === source.immutableVersion && prior.id !== source.id)) denied("prior_source_binding_denied");
  if (prior.normalizedProjection !== null) checkedRecord(prior, context);
  if (new Set(facts.map((fact) => fact.factKey)).size !== facts.length ||
    new Set(facts.map((fact) => fact.id)).size !== facts.length) denied("prior_fact_identity_ambiguous");
  for (const fact of facts) {
    if (fact.workspaceId !== context.workspaceId || fact.businessEntityId !== context.businessEntityId ||
      fact.factKind !== "recognized_revenue" || fact.validationState !== "valid" || fact.reconciliationState !== "accepted" ||
      fact.factFingerprint !== canonicalFactFingerprint(fact) || !fact.sources.some((edge) =>
        edge.sourceRole === "primary" && edge.sourceRecordVersionId === prior.id && edge.sourceFingerprint === prior.sourceFingerprint)) {
      denied("prior_fact_binding_denied");
    }
  }
  return facts;
}

function accountEvidence(input: QboProductionAccountingMappingInput, context: QboProductionAccountingContext) {
  if (input.accountSourceVersions.length > 10_000) denied("account_evidence_limit");
  const accounts = new Map<string, { source: ExternalSourceRecordVersion; record: QboMinimizedSourceRecord }>();
  for (const value of input.accountSourceVersions) {
    const source = checkedSource(value, context, input.mappedAt);
    const record = checkedRecord(source, context);
    if (record.recordType !== "Account" || accounts.has(record.id) || !["active", "inactive"].includes(record.status)) {
      denied("account_evidence_denied");
    }
    accounts.set(record.id, { source, record });
  }
  return accounts;
}

function ambiguousRecordAmounts(record: QboMinimizedSourceRecord) {
  const evidence = record.accountingEvidence;
  if (!evidence || evidence.sparse) return "qbo_full_transaction_required";
  if (evidence.hasDiscountDetail) return "qbo_discount_semantics_unproven";
  if ((evidence.globalTaxCalculation !== null && !["TaxExcluded", "NotApplicable"].includes(evidence.globalTaxCalculation)) ||
    evidence.hasTaxLines || (evidence.hasTaxDetail && evidence.totalTax === null) ||
    (evidence.totalTax !== null && (evidence.totalTax.amount !== "0" || evidence.totalTax.currency !== record.accounting.sourceCurrency))) {
    return "qbo_tax_semantics_unproven";
  }
  return null;
}

/** Pure accounting eligibility; it grants no database authority and never certifies complete revenue. */
export function mapProductionQboAccountingSource(input: QboProductionAccountingMappingInput): QboProductionAccountingMappingResult {
  const context = QboProductionAccountingContextSchema.parse(input.context);
  IsoTimestampSchema.parse(input.mappedAt);
  z.literal("valid").optional().parse(input.effectiveValidationState);
  z.literal("valid").optional().parse(input.priorEffectiveValidationState);
  if (Date.parse(input.mappedAt) < Date.parse(context.policyEffectiveFrom) ||
    !validDate(context.postingDateFrom) || !validDate(context.postingDateThrough) ||
    context.postingDateThrough > input.mappedAt.slice(0, 10)) denied("context_not_effective");
  const source = checkedSource(input.sourceVersion, context, input.mappedAt, input.effectiveValidationState);
  if (input.sourceIdentityFingerprint !== externalSourceIdentityFingerprint(source)) denied("source_identity_denied");
  const priorFacts = checkedPriorFacts(input, source, context);
  let accountReferences: QboProductionAccountingMappingResult["accountEvidence"] = [];
  const result = (disposition: QboProductionAccountingMappingResult["disposition"], reasonCodes: string[],
    action: QboProductionAccountingMappingResult["lifecycle"]["action"] = "hold",
    candidates: readonly QboRevenueCandidate[] = []): QboProductionAccountingMappingResult => ({
    contractVersion: QBO_PRODUCTION_ACCOUNTING_MAPPING_VERSION, disposition,
    sourceRecordVersionId: source.id, sourceFingerprint: source.sourceFingerprint!,
    sourceIdentityFingerprint: input.sourceIdentityFingerprint,
    sourceAuthorityPolicyVersionId: context.sourceAuthorityPolicyVersionId,
    mappingContextFingerprint: contractSha256({ ...context, revenueAccountRefs: [...context.revenueAccountRefs].sort() }),
    accountEvidence: accountReferences,
    candidates, lifecycle: { action, priorFactVersionIds: priorFacts.map((fact) => fact.id).sort() },
    reasonCodes, coverage: "not_assessed", fullPostedRevenue: false
  });
  if (source.changeKind === "deleted") {
    return result("retraction_required", ["qbo_deleted_source_requires_atomic_retraction"], "retract_fact_set");
  }
  if (source.normalizedProjection?.contractVersion === QBO_REPORT_CONTRACT_VERSION) {
    const report = QboReportControlObservationSchema.parse(source.normalizedProjection);
    if (source.source.kind !== "provider" || report.provider.realmId !== context.realmId ||
      report.provider.sourceEnvironment !== "production" || report.reportType !== source.source.providerRecordType ||
      qboReportProviderRecordId(report) !== source.source.providerRecordId) denied("report_binding_denied");
    return result("non_contributing", ["qbo_report_nonadditive_no_reconciliation_inferred"], "none");
  }
  const record = checkedRecord(source, context);
  if (record.status === "voided" || source.changeKind === "voided") {
    // Validation appends an "unchanged" version of a verified void projection.
    if (record.status !== "voided" || !["voided", "unchanged"].includes(source.changeKind)) denied("void_binding_denied");
    return result("retraction_required", ["qbo_voided_source_requires_atomic_retraction"], "retract_fact_set");
  }
  if (masterTypes.has(record.recordType)) return result("non_contributing", ["qbo_master_is_evidence_only"], "none");
  if (record.minimizationVersion !== QBO_ACCOUNTING_MINIMIZATION_VERSION) {
    return result("review_required", ["qbo_legacy_projection_accounting_evidence_insufficient"]);
  }
  if (record.status !== "active") return result("review_required", ["qbo_transaction_status_unproven"]);
  const journal = record.recordType === "JournalEntry";
  if (!salesTypes.has(record.recordType) && !journal) {
    return result("review_required", ["qbo_transaction_posted_revenue_effect_unproven"]);
  }
  if (record.temporal.postingDate === null || record.temporal.postingDate < context.postingDateFrom ||
    record.temporal.postingDate < new Date(context.policyEffectiveFrom).toISOString().slice(0, 10) ||
    record.temporal.postingDate > context.postingDateThrough) return result("review_required", ["qbo_posting_date_outside_authorized_scope"]);
  if (record.accounting.sourceCurrency !== context.reportingCurrency ||
    (record.accounting.homeCurrency !== null && record.accounting.homeCurrency !== context.reportingCurrency) ||
    (record.accounting.exchangeRate !== null && record.accounting.exchangeRate !== "1") ||
    Object.values(record.amounts).some((amount) => amount.currency !== context.reportingCurrency) ||
    record.lines.some((line) => line.amount !== null && line.amount.currency !== context.reportingCurrency)) {
    return result("review_required", ["qbo_accounting_currency_unsupported"]);
  }
  const amountIssue = ambiguousRecordAmounts(record);
  if (amountIssue) return result("review_required", [amountIssue]);
  const lineIds = record.lines.flatMap((line) => line.lineId === null ? [] : [line.lineId]);
  if (new Set(lineIds).size !== lineIds.length) return result("review_required", ["qbo_revenue_line_identity_ambiguous"]);
  const accounts = accountEvidence(input, context);
  accountReferences = [...accounts.values()].map(({ source: evidence }) => ({
    sourceRecordVersionId: evidence.id, sourceFingerprint: evidence.sourceFingerprint!
  })).sort((left, right) => left.sourceRecordVersionId.localeCompare(right.sourceRecordVersionId));
  const revenueRefs = new Set(context.revenueAccountRefs);
  for (const ref of revenueRefs) {
    const account = accounts.get(ref);
    if (!account || !["Income", "Other Income"].includes(account.record.relationships.AccountType?.value ?? "")) {
      return result("review_required", ["qbo_authorized_revenue_account_evidence_missing"]);
    }
  }
  const eligible: { line: QboMinimizedSourceRecord["lines"][number]; amount: string; accountSource: ExternalSourceRecordVersion }[] = [];
  const documentAmounts: string[] = [];
  const journalBalance: string[] = [];
  for (const line of record.lines) {
    const evidence = line.accountingEvidence;
    if (!evidence) return result("review_required", ["qbo_line_accounting_evidence_missing"]);
    if (evidence.hasGroupDetail) return result("review_required", ["qbo_group_postings_unproven"]);
    if (!journal && (line.detailType === "DescriptionOnly" || line.detailType === "SubTotalLineDetail" ||
      (line.detailType === "SalesItemLineDetail" && line.itemRef === null))) continue;
    if (evidence.hasDiscountDetail) return result("review_required", ["qbo_discount_semantics_unproven"]);
    if (evidence.hasTaxDetail || evidence.taxInclusiveAmount !== null ||
      (evidence.taxCodeRef !== null && evidence.taxCodeRef.value !== "NON")) {
      return result("review_required", ["qbo_tax_semantics_unproven"]);
    }
    if (line.detailType !== (journal ? "JournalEntryLineDetail" : "SalesItemLineDetail")) {
      return result("review_required", ["qbo_economic_line_kind_unproven"]);
    }
    if (line.lineId === null || line.amount === null) return result("review_required", ["qbo_economic_line_incomplete"]);
    if (line.accountRef === null || evidence.accountReferenceKind !== (journal ? "account_ref" : "item_account_ref")) {
      return result("review_required", ["qbo_transaction_posting_account_unproven"]);
    }
    const account = accounts.get(line.accountRef.value);
    if (!account) return result("review_required", ["qbo_transaction_account_evidence_missing"]);
    let amount = line.amount.amount;
    if (journal) {
      if (amount.startsWith("-") || (line.postingType !== "credit" && line.postingType !== "debit")) {
        return result("review_required", ["qbo_journal_posting_sign_unproven"]);
      }
      amount = line.postingType === "debit" ? negateCanonicalDecimal(amount) : amount;
      journalBalance.push(amount);
    } else {
      documentAmounts.push(amount);
      if (record.recordType === "CreditMemo" || record.recordType === "RefundReceipt") amount = negateCanonicalDecimal(amount);
    }
    if (revenueRefs.has(line.accountRef.value)) eligible.push({ line, amount, accountSource: account.source });
  }
  if (journal ? journalBalance.length < 2 || addCanonicalDecimals(journalBalance) !== "0"
    : !record.amounts.total || addCanonicalDecimals(documentAmounts) !== record.amounts.total.amount) {
    return result("review_required", [journal ? "qbo_journal_not_balanced" : "qbo_document_amounts_not_reconciled"]);
  }
  const priorFactByKey: Record<string, CanonicalBusinessFactVersion> = Object.fromEntries(priorFacts.map((fact) => [fact.factKey, fact]));
  const candidates = eligible.map(({ line, amount, accountSource }, ordinal) => buildQboRevenueCandidate({
    ...input, source, record, line, amount, ordinal, reportingCurrency: context.reportingCurrency, priorFactByKey,
    mappingVersion: QBO_PRODUCTION_ACCOUNTING_MAPPING_VERSION, accountingSources: [accountSource],
    reasonCodes: [journal ? "qbo_explicit_journal_revenue_posting" : "qbo_explicit_sales_revenue_posting"]
  }));
  if (new Set(candidates.map(({ fact }) => fact.id)).size !== candidates.length ||
    new Set(candidates.map(({ representation }) => representation.representationId)).size !== candidates.length) {
    denied("candidate_identity_ambiguous");
  }
  return result(candidates.length ? "mapped_partial" : "non_contributing",
    [candidates.length ? "qbo_supported_postings_only_coverage_unassessed" : "qbo_no_postings_in_authorized_revenue_accounts"],
    "replace_fact_set", candidates);
}
