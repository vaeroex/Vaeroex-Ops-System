import "server-only";

import { z } from "zod";

import { contractSha256, externalSourceFingerprint } from "@/lib/integrations/contracts/canonical";
import { IsoTimestampSchema, Sha256FingerprintSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import { ExternalSourceRecordVersionSchema, type ExternalSourceRecordVersion } from "@/lib/integrations/contracts/source-facts";
import { externalSourceIdentityFingerprint } from "@/lib/integrations/persistence/identity";
import {
  QBO_REPORT_CONTRACT_VERSION,
  QBO_SOURCE_RECORD_CONTRACT_VERSION,
  QBO_TRANSACTION_RECORD_TYPES,
  QboMinimizedSourceRecordSchema,
  QboReportControlObservationSchema
} from "@/lib/integrations/providers/qbo/contracts";
import { qboReportProviderRecordId } from "@/lib/integrations/providers/qbo/source-records";
import { validatePendingQboSourceVersion } from "@/lib/integrations/provider-runtime/qbo/validation";

export const QBO_PRODUCTION_VALIDATOR_VERSION = "qbo_production_source_validator_v1" as const;

export const QboProductionValidationClaimSchema = z.object({
  sourceVersionId: UuidSchema,
  sourceRecordId: UuidSchema,
  taskId: UuidSchema,
  workspaceId: UuidSchema,
  businessEntityId: UuidSchema,
  connectionId: UuidSchema,
  connectionGeneration: z.number().int().positive().safe(),
  mappingId: UuidSchema,
  syncRunId: UuidSchema,
  streamKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  sourceIdentityFingerprint: Sha256FingerprintSchema,
  realmFingerprint: Sha256FingerprintSchema,
  claimId: UuidSchema,
  claimExpiresAt: IsoTimestampSchema,
  validatedVersionId: UuidSchema,
  validatedAt: IsoTimestampSchema,
  pendingVersion: ExternalSourceRecordVersionSchema
}).strict();

export type QboProductionValidationClaim = z.infer<typeof QboProductionValidationClaimSchema>;

type Issue = ExternalSourceRecordVersion["validation"]["issues"][number];
const issue = (code: string): Issue => ({ code, severity: "error", field: null, detail: "Production source contract validation failed." });
const streams: Readonly<Record<string, string>> = {
  CompanyInfo: "company_info", Preferences: "preferences", Account: "accounts", Customer: "customers_minimized",
  Vendor: "vendors_minimized", Item: "items_minimized", Invoice: "qbo_invoice", SalesReceipt: "qbo_salesreceipt",
  Payment: "qbo_payment", CreditMemo: "qbo_creditmemo", RefundReceipt: "qbo_refundreceipt", Bill: "qbo_bill",
  BillPayment: "qbo_billpayment", Purchase: "qbo_purchase", VendorCredit: "qbo_vendorcredit", Deposit: "qbo_deposit",
  JournalEntry: "qbo_journalentry", Transfer: "qbo_transfer", ProfitAndLoss: "qbo_profitandloss",
  BalanceSheet: "qbo_balancesheet", CashFlow: "qbo_cashflow", ARAgingSummary: "qbo_aragingsummary",
  APAgingSummary: "qbo_apagingsummary", TrialBalance: "qbo_trialbalance"
};
const inactiveReferenceTypes = new Set(["Account", "Customer", "Vendor", "Item"]);

function realmFingerprint(realm: string) {
  return contractSha256({ fingerprintPurpose: "provider_authorized_entity_reference",
    fingerprintVersion: "provider_authorized_entity_reference_fingerprint_v1", value: realm });
}

function validDate(value: string | null) {
  if (value === null) return true;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

/** Validity permits stored-data display, never financial contribution or KPI authority. */
export function validateProductionQboSourceClaim(input: unknown) {
  const claim = QboProductionValidationClaimSchema.parse(input);
  const pending = claim.pendingVersion;
  if (pending.id !== claim.sourceVersionId || pending.workspaceId !== claim.workspaceId
    || pending.businessEntityId !== claim.businessEntityId || pending.connectionId !== claim.connectionId
    || pending.source.kind !== "provider" || pending.source.providerKey !== "quickbooks_online"
    || pending.validation.state !== "pending" || pending.trust !== "untrusted_external_input"
    || pending.sourceFingerprint !== externalSourceFingerprint(pending)
    || claim.sourceIdentityFingerprint !== externalSourceIdentityFingerprint(pending)
    || Date.parse(claim.validatedAt) < Date.parse(pending.receivedAt)) {
    throw new Error("qbo_production_validation_binding_denied");
  }
  const issues: Issue[] = [];
  if (![pending.temporal.postingDate, pending.temporal.periodStart, pending.temporal.periodEnd].every(validDate)
    || (pending.temporal.providerCreatedAt !== null && pending.temporal.providerUpdatedAt !== null
      && Date.parse(pending.temporal.providerCreatedAt) > Date.parse(pending.temporal.providerUpdatedAt))) {
    issues.push(issue("qbo_source_time_invalid"));
  }
  const expectedStream = streams[pending.source.providerRecordType];
  const cdcAllowed = claim.streamKey === "qbo_cdc" && projectionCanBeCdc(pending);
  if (!expectedStream || (claim.streamKey !== expectedStream && !cdcAllowed)) {
    issues.push(issue("qbo_stream_binding_mismatch"));
  }
  let realm = "";
  const projection = pending.normalizedProjection;
  const boundDeletion = pending.changeKind === "deleted" && projection === null
    && (["qbo_minimizer_v1", "qbo_minimizer_v2"].includes(pending.normalizedSchemaVersion)
      || (pending.normalizedSchemaVersion === "qbo_cdc_tombstone_v1" && claim.streamKey === "qbo_cdc"))
    && (inactiveReferenceTypes.has(pending.source.providerRecordType)
      || (QBO_TRANSACTION_RECORD_TYPES as readonly string[]).includes(pending.source.providerRecordType))
    && pending.recordKind === `qbo_${pending.source.providerRecordType.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`
    && pending.temporal.providerUpdatedAt !== null && pending.temporal.basis === "event"
    && pending.temporal.periodStart === null && pending.temporal.periodEnd === null;
  if (projection?.contractVersion === QBO_SOURCE_RECORD_CONTRACT_VERSION) {
    const result = QboMinimizedSourceRecordSchema.safeParse(projection);
    if (result.success) {
      const record = result.data;
      realm = record.provider.realmId;
      if (record.provider.sourceEnvironment !== "production") issues.push(issue("qbo_environment_binding_mismatch"));
      if (record.id !== pending.source.providerRecordId || record.recordType !== pending.source.providerRecordType
        || record.providerVersionReference !== pending.source.providerVersionReference
        || pending.recordKind !== `qbo_${record.recordType.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase()}`) {
        issues.push(issue("qbo_record_identity_mismatch"));
      }
      if (record.accounting.sourceCurrency !== pending.accounting.currency || record.accounting.basis !== pending.accounting.basis
        || record.temporal.postingDate !== pending.temporal.postingDate
        || record.metadata.providerCreatedAt !== pending.temporal.providerCreatedAt
        || record.metadata.providerUpdatedAt !== pending.temporal.providerUpdatedAt) issues.push(issue("qbo_metadata_binding_mismatch"));
      const inactiveReference = inactiveReferenceTypes.has(record.recordType) && record.active === false && record.status === "inactive";
      const explicitVoid = (QBO_TRANSACTION_RECORD_TYPES as readonly string[]).includes(record.recordType)
        && record.status === "voided" && pending.changeKind === "voided" && record.active !== false;
      if (((record.status === "inactive" || record.active === false) && !inactiveReference)
        || ((record.status === "voided" || pending.changeKind === "voided") && !explicitVoid)
        || record.status === "deleted") issues.push(issue("qbo_inactive_source_requires_review"));
      if ((QBO_TRANSACTION_RECORD_TYPES as readonly string[]).includes(record.recordType)
        && (pending.accounting.currency === null || pending.temporal.postingDate === null)) {
        issues.push(issue("qbo_transaction_metadata_incomplete"));
      }
      if (!validDate(record.temporal.postingDate)
        || pending.temporal.effectiveAt !== (record.temporal.postingDate ? `${record.temporal.postingDate}T00:00:00.000Z` : null)
        || pending.temporal.basis !== "event") issues.push(issue("qbo_source_time_invalid"));
      if (Object.values(record.amounts).some((amount) => amount.currency !== record.accounting.sourceCurrency)
        || record.lines.some((line) => line.amount !== null && line.amount.currency !== record.accounting.sourceCurrency)) {
        issues.push(issue("qbo_source_currency_inconsistent"));
      }
    }
  } else if (projection?.contractVersion === QBO_REPORT_CONTRACT_VERSION) {
    const result = QboReportControlObservationSchema.safeParse(projection);
    if (result.success) {
      const report = result.data;
      realm = report.provider.realmId;
      if (report.provider.sourceEnvironment !== "production") issues.push(issue("qbo_environment_binding_mismatch"));
      if (report.reportType !== pending.source.providerRecordType || qboReportProviderRecordId(report) !== pending.source.providerRecordId
        || pending.recordKind !== `qbo_report_${report.reportType.toLowerCase()}`) {
        issues.push(issue("qbo_report_identity_mismatch"));
      }
      if (report.sourceCurrency !== pending.accounting.currency || report.reportBasis !== pending.accounting.basis) {
        issues.push(issue("qbo_metadata_binding_mismatch"));
      }
      if (report.sourceCurrency === null) issues.push(issue("qbo_report_currency_missing"));
      if (![report.periodStart, report.periodEnd].every(validDate)) issues.push(issue("qbo_source_time_invalid"));
      if (report.periodStart !== null && report.periodEnd !== null) {
        if (pending.temporal.basis !== "period" || pending.temporal.periodStart !== report.periodStart
          || pending.temporal.periodEnd !== report.periodEnd) issues.push(issue("qbo_report_time_binding_mismatch"));
      } else {
        const asOf = report.periodEnd ?? report.periodStart;
        if (!["ARAgingSummary", "APAgingSummary"].includes(report.reportType) || asOf === null
          || pending.temporal.basis !== "point_in_time" || pending.temporal.effectiveAt !== `${asOf}T00:00:00.000Z`) {
          issues.push(issue("qbo_report_time_binding_mismatch"));
        }
      }
    }
  }
  if (projection !== null && realmFingerprint(realm) !== claim.realmFingerprint) issues.push(issue("qbo_realm_binding_mismatch"));
  const canonical = validatePendingQboSourceVersion({ pendingVersion: pending, validatedVersionId: claim.validatedVersionId,
    expectedRealmId: realm, validatedAt: claim.validatedAt });
  // The native completion RPC independently serializes tombstones/voids against
  // provenance promotion and requires zero downstream effects. This is not a
  // financial-authority decision and never restores the prior source version.
  const canonicalIssues = boundDeletion
    ? canonical.issues.filter((entry) => entry.code !== "qbo_deleted_source_requires_review") : canonical.issues;
  const allIssues = [...canonicalIssues, ...issues];
  const version = ExternalSourceRecordVersionSchema.parse({ ...canonical.version,
    validation: { state: allIssues.length ? "quarantined" : "valid", validatorVersion: QBO_PRODUCTION_VALIDATOR_VERSION, issues: allIssues } });
  return { ...claim, validatedVersion: { ...version, sourceFingerprint: externalSourceFingerprint(version) },
    economicPromotionAllowed: false as const };
}

function projectionCanBeCdc(version: ExternalSourceRecordVersion) {
  return version.normalizedProjection?.contractVersion !== QBO_REPORT_CONTRACT_VERSION
    && version.source.kind === "provider" && !["CompanyInfo", "Preferences"].includes(version.source.providerRecordType);
}
