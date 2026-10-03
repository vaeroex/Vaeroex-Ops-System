import {
  canonicalFactFingerprint,
  contractSha256,
  externalSourceFingerprint
} from "@/lib/integrations/contracts/canonical";
import {
  CanonicalBusinessFactVersionSchema,
  ExternalSourceRecordVersionSchema,
  type CanonicalBusinessFactVersion,
  type ExternalSourceRecordVersion
} from "@/lib/integrations/contracts/source-facts";
import {
  PersistedFactDecimalSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import { externalSourceIdentityFingerprint } from "@/lib/integrations/persistence/identity";
import { EXTERNAL_INTEGRATION_CONTRACT_VERSIONS } from "@/lib/integrations/contracts/versions";
import { negateCanonicalDecimal } from "@/lib/integrations/deterministic/decimal";
import {
  QBO_PROVIDER_KEY,
  QBO_REPORT_CONTRACT_VERSION,
  QBO_SOURCE_RECORD_CONTRACT_VERSION,
  QboMinimizedSourceRecordSchema,
  QboReportControlObservationSchema,
  type QboMinimizedSourceRecord,
  type QboReportControlObservation
} from "@/lib/integrations/providers/qbo/contracts";
import {
  ReconciliationRepresentationSchema,
  type ReconciliationRepresentation
} from "@/lib/integrations/reconciliation/contracts";
import {
  QboProviderEnvironmentSchema,
  type QboProviderEnvironment
} from "@/lib/integrations/provider-runtime/qbo/client";
import { z } from "zod";

export const QBO_CANONICAL_MAPPING_VERSION =
  "qbo_recognized_revenue_mapping_v1" as const;
export const QBO_RECOGNIZED_REVENUE_FAMILY_KEY =
  "recognized_revenue_transactions" as const;
export const QBO_REPORT_CONTROL_FAMILY_KEY =
  "recognized_revenue_report_control" as const;
export const QBO_REVENUE_MAPPING_AUTHORITY_VERSION =
  "qbo_revenue_mapping_authority_v1" as const;

const QboRevenueMappingAuthoritySchema = z
  .object({
    contractVersion: z.literal(QBO_REVENUE_MAPPING_AUTHORITY_VERSION),
    providerKey: z.literal(QBO_PROVIDER_KEY),
    providerEnvironment: QboProviderEnvironmentSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    realmId: z.string().min(1).max(64).regex(/^[A-Za-z0-9._:-]+$/),
    incomeAccountRefs: z.array(z.string().min(1).max(128)).max(10_000),
    revenueItemRefs: z.array(z.string().min(1).max(128)).max(100_000),
    sourceVersionFingerprints: z.array(Sha256FingerprintSchema).min(1).max(10_000),
    authorityFingerprint: Sha256FingerprintSchema
  })
  .strict()
  .superRefine((value, context) => {
    for (const key of ["incomeAccountRefs", "revenueItemRefs", "sourceVersionFingerprints"] as const) {
      if (new Set(value[key]).size !== value[key].length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: "QBO revenue authority sets must be unique"
        });
      }
    }
  });

export type QboFactIdentity = Readonly<{
  id: string;
  immutableVersion: number;
  priorVersionId: string | null;
}>;

export type QboRevenueCandidate = Readonly<{
  fact: CanonicalBusinessFactVersion;
  representation: ReconciliationRepresentation;
}>;

type FactIdentity = QboFactIdentity;
type Candidate = QboRevenueCandidate;

const eligibleRevenueTypes = new Set([
  "Invoice",
  "SalesReceipt",
  "CreditMemo",
  "RefundReceipt"
]);
const incomeAccountTypes = new Set(["Income", "Other Income"]);

function authorityFingerprintInput(
  authority: Omit<z.infer<typeof QboRevenueMappingAuthoritySchema>, "authorityFingerprint">
) {
  return {
    fingerprintPurpose: "qbo_revenue_mapping_authority",
    fingerprintVersion: QBO_REVENUE_MAPPING_AUTHORITY_VERSION,
    payload: authority
  } as const;
}

export function deriveQboRevenueMappingAuthority(input: {
  sourceVersions: readonly unknown[];
  expectedRealmId: string;
  providerEnvironment?: QboProviderEnvironment;
}) {
  const providerEnvironment = QboProviderEnvironmentSchema.parse(
    input.providerEnvironment ?? "sandbox"
  );
  const records = input.sourceVersions.flatMap((value) => {
    const source = ExternalSourceRecordVersionSchema.parse(value);
    const projection = sourceProjection(source);
    if (projection.contractVersion !== QBO_SOURCE_RECORD_CONTRACT_VERSION) return [];
    const record = QboMinimizedSourceRecordSchema.parse(projection);
    if (
      record.provider.realmId !== input.expectedRealmId ||
      record.provider.sourceEnvironment !== providerEnvironment
    ) {
      throw new Error("qbo_revenue_authority_provider_binding_denied");
    }
    return [{ source, record }];
  });
  const first = records[0]?.source;
  if (!first || first.connectionId === null || records.some(({ source }) => source.workspaceId !== first.workspaceId
    || source.businessEntityId !== first.businessEntityId || source.connectionId !== first.connectionId)) {
    throw new Error("qbo_revenue_authority_scope_denied");
  }
  const incomeAccountRefs = records
    .filter(
      ({ record }) =>
        record.recordType === "Account" &&
        record.status === "active" &&
        incomeAccountTypes.has(record.relationships.AccountType?.value ?? "")
    )
    .map(({ record }) => record.id)
    .sort();
  const incomeAccounts = new Set(incomeAccountRefs);
  const revenueItemRefs = records
    .filter(
      ({ record }) =>
        record.recordType === "Item" &&
        record.status === "active" &&
        incomeAccounts.has(record.relationships.IncomeAccountRef?.value ?? "")
    )
    .map(({ record }) => record.id)
    .sort();
  const sourceVersionFingerprints = records
    .filter(({ record }) => record.recordType === "Account" || record.recordType === "Item")
    .map(({ source }) => Sha256FingerprintSchema.parse(source.sourceFingerprint))
    .sort();
  const draft = {
    contractVersion: QBO_REVENUE_MAPPING_AUTHORITY_VERSION,
    providerKey: QBO_PROVIDER_KEY,
    providerEnvironment,
    workspaceId: first.workspaceId,
    businessEntityId: first.businessEntityId,
    connectionId: first.connectionId,
    realmId: input.expectedRealmId,
    incomeAccountRefs,
    revenueItemRefs,
    sourceVersionFingerprints
  };
  return QboRevenueMappingAuthoritySchema.parse({
    ...draft,
    authorityFingerprint: contractSha256(authorityFingerprintInput(draft))
  });
}

function checkedRevenueAuthority(
  input: unknown,
  realmId: string,
  providerEnvironment: QboProviderEnvironment,
  source: ExternalSourceRecordVersion
) {
  const authority = QboRevenueMappingAuthoritySchema.parse(input);
  const { authorityFingerprint, ...draft } = authority;
  if (
    authority.realmId !== realmId ||
    authority.providerEnvironment !== providerEnvironment ||
    authority.workspaceId !== source.workspaceId ||
    authority.businessEntityId !== source.businessEntityId ||
    authority.connectionId !== source.connectionId ||
    authorityFingerprint !== contractSha256(authorityFingerprintInput(draft))
  ) {
    throw new Error("qbo_revenue_mapping_authority_denied");
  }
  return authority;
}

function sourceProjection(version: ExternalSourceRecordVersion) {
  if (
    version.source.kind !== "provider" ||
    version.source.providerKey !== QBO_PROVIDER_KEY ||
    version.validation.state !== "valid" ||
    version.sourceFingerprint === undefined ||
    version.sourceFingerprint !== externalSourceFingerprint(version)
  ) {
    throw new Error("qbo_canonical_mapping_source_denied");
  }
  if (version.normalizedProjection === null) {
    throw new Error("qbo_canonical_mapping_projection_missing");
  }
  return version.normalizedProjection;
}

function stableFactKey(input: {
  realmId: string;
  recordType: string;
  recordId: string;
  lineIdentity: string;
  measure: string;
  providerEnvironment?: "production";
}) {
  const fingerprint = contractSha256({
    fingerprintPurpose: "qbo_canonical_fact_identity",
    fingerprintVersion: input.providerEnvironment ? "qbo_canonical_fact_identity_v2" : "qbo_canonical_fact_identity_v1",
    ...input
  }).slice("sha256:".length);
  return `qbo_${input.measure}/${input.recordType.toLowerCase()}/${fingerprint}`;
}

function factWithFingerprint(draft: CanonicalBusinessFactVersion) {
  const parsed = CanonicalBusinessFactVersionSchema.parse(draft);
  return CanonicalBusinessFactVersionSchema.parse({
    ...parsed,
    factFingerprint: canonicalFactFingerprint(parsed)
  });
}

function representation(input: {
  fact: CanonicalBusinessFactVersion;
  source: ExternalSourceRecordVersion;
  sourceIdentityFingerprint: string;
  representationId: string;
  familyKind: "additive_transaction" | "non_additive_control";
  familyKey: string;
  transactionIdentity: string | null;
  value: string;
  lineage: ReconciliationRepresentation["lineage"];
}) {
  const fingerprint = Sha256FingerprintSchema.parse(input.fact.factFingerprint);
  return ReconciliationRepresentationSchema.parse({
    representationId: input.representationId,
    workspaceId: input.fact.workspaceId,
    businessEntityId: input.fact.businessEntityId,
    canonicalFactVersionId: input.fact.id,
    canonicalFactFingerprint: fingerprint,
    factKind: input.fact.factKind,
    factKey: input.fact.factKey,
    sourceRecordVersionId: input.source.id,
    sourceVersionFingerprint: input.source.sourceFingerprint,
    sourceIdentityFingerprint: input.sourceIdentityFingerprint,
    sourceImmutableVersion: input.source.immutableVersion,
    sourceClass: "connected_system",
    sourceAuthorityKey: QBO_PROVIDER_KEY,
    economicIdentity: {
      domain: "posted_revenue",
      contributionFamilyKey: input.familyKey,
      contributionFamilyKind: input.familyKind,
      measureKey: "recognized_revenue",
      aggregateKey: "recognized_revenue_actual",
      transactionIdentity: input.transactionIdentity,
      effectiveTime: {
        effectiveAt: input.fact.temporal.effectiveAt,
        postingDate: input.fact.temporal.postingDate,
        periodStart: input.fact.temporal.periodStart,
        periodEnd: input.fact.temporal.periodEnd
      },
      dimensions: input.fact.dimensions,
      accountingBasis: input.fact.accounting.basis,
      currency: input.fact.accounting.sourceCurrency
    },
    value: input.value,
    validationState: input.fact.validationState,
    reconciliationState: input.fact.reconciliationState,
    lineage: input.lineage,
    similarityHints: []
  });
}

function sourceReference(
  source: ExternalSourceRecordVersion,
  sourceRole: "primary" | "control_observation" = "primary"
) {
  if (!source.sourceFingerprint) throw new Error("qbo_source_fingerprint_missing");
  return {
    sourceRecordVersionId: source.id,
    sourceFingerprint: source.sourceFingerprint,
    sourceRole,
    contributionWeight: "1"
  };
}

function lineAmount(record: QboMinimizedSourceRecord, amount: string) {
  const value = PersistedFactDecimalSchema.parse(amount);
  return record.recordType === "CreditMemo" || record.recordType === "RefundReceipt"
    ? negateCanonicalDecimal(value)
    : value;
}

/** Pure candidate construction. Eligibility and durable authority belong to the caller. */
export function buildQboRevenueCandidate(input: {
  source: ExternalSourceRecordVersion;
  record: QboMinimizedSourceRecord;
  line: QboMinimizedSourceRecord["lines"][number];
  amount: string;
  sourceIdentityFingerprint: string;
  reportingCurrency: string;
  mappedAt: string;
  mappingVersion: string;
  reasonCodes: string[];
  ordinal: number;
  identityForFact: (factKey: string, ordinal: number) => FactIdentity;
  representationIdForFact: (factKey: string, ordinal: number) => string;
  priorFactByKey?: Readonly<Record<string, CanonicalBusinessFactVersion>>;
  accountingSources?: readonly ExternalSourceRecordVersion[];
}): Candidate {
  const { source, record, line } = input;
  const postingDate = record.temporal.postingDate;
  const sourceCurrency = record.accounting.sourceCurrency;
  if (line.lineId === null || postingDate === null || sourceCurrency === null) {
    throw new Error("qbo_revenue_candidate_context_missing");
  }
  const factKey = stableFactKey({
    realmId: record.provider.realmId, recordType: record.recordType, recordId: record.id,
    lineIdentity: line.lineId, measure: "recognized_revenue",
    ...(record.provider.sourceEnvironment === "production" ? { providerEnvironment: "production" as const } : {})
  });
  const identity = input.identityForFact(factKey, input.ordinal);
  const prior = input.priorFactByKey?.[factKey];
  if (prior && (prior.workspaceId !== source.workspaceId || prior.businessEntityId !== source.businessEntityId ||
    prior.factKey !== factKey || prior.factKind !== "recognized_revenue" ||
    prior.factFingerprint !== canonicalFactFingerprint(prior) || identity.priorVersionId !== prior.id ||
    identity.immutableVersion !== prior.immutableVersion + 1 || identity.id === prior.id)) {
    throw new Error("qbo_revenue_prior_fact_binding_denied");
  }
  const dimensions = [
    line.itemRef ? { key: "item_ref", value: line.itemRef.value } : null,
    line.accountRef ? { key: "account_ref", value: line.accountRef.value } : null,
    line.entityRef ? { key: "entity_ref", value: line.entityRef.value } : null
  ].filter((value): value is { key: string; value: string } => value !== null);
  const fact = factWithFingerprint({
    contractVersion: EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.canonicalFact,
    id: identity.id, workspaceId: source.workspaceId, businessEntityId: source.businessEntityId,
    immutableVersion: identity.immutableVersion, factKind: "recognized_revenue", factKey, dimensions,
    temporal: { effectiveAt: `${postingDate}T00:00:00.000Z`, postingDate, periodStart: null, periodEnd: null,
      fiscalYear: null, fiscalPeriod: null, sourceTimeZone: null, closedPeriod: false },
    accounting: { basis: "accrual", sourceCurrency, reportingCurrency: input.reportingCurrency,
      exchangeRate: null, exchangeRateSource: null },
    value: { kind: "money", amount: input.amount, currency: sourceCurrency },
    reconciliationState: "accepted", validationState: "valid",
    sources: [sourceReference(source), ...(input.accountingSources ?? []).map((evidence) => ({
      ...sourceReference(evidence), sourceRole: "corroborating" as const, contributionWeight: "0"
    }))],
    decision: { authority: "deterministic_policy", policyVersion: input.mappingVersion, actorId: null,
      decidedAt: input.mappedAt, reasonCodes: input.reasonCodes },
    normalizationVersion: input.mappingVersion, transformationVersion: input.mappingVersion,
    sourceObservedAt: source.temporal.observedAt, createdAt: input.mappedAt
  });
  return { fact, representation: representation({
    fact, source, sourceIdentityFingerprint: input.sourceIdentityFingerprint,
    representationId: input.representationIdForFact(factKey, input.ordinal), familyKind: "additive_transaction",
    familyKey: QBO_RECOGNIZED_REVENUE_FAMILY_KEY, transactionIdentity: factKey, value: input.amount,
    lineage: prior ? { kind: "correction", priorSourceRecordVersionId: null, priorCanonicalFactVersionId: prior.id }
      : { kind: "none" }
  }) };
}

export function mapValidatedQboRevenueSource(input: {
  sourceVersion: unknown;
  sourceIdentityFingerprint: string;
  reportingCurrency: string;
  accountingBasis: "accrual" | "cash" | "unknown";
  revenueAuthority: unknown;
  mappedAt: string;
  identityForFact: (factKey: string, ordinal: number) => FactIdentity;
  representationIdForFact: (factKey: string, ordinal: number) => string;
  priorFactByKey?: Readonly<Record<string, CanonicalBusinessFactVersion>>;
}) {
  const source = ExternalSourceRecordVersionSchema.parse(input.sourceVersion);
  const projection = sourceProjection(source);
  if (input.sourceIdentityFingerprint !== externalSourceIdentityFingerprint(source)) {
    throw new Error("qbo_canonical_mapping_source_identity_denied");
  }
  if (projection.contractVersion !== QBO_SOURCE_RECORD_CONTRACT_VERSION) {
    return { disposition: "not_applicable" as const, candidates: [] as Candidate[], reasonCodes: ["qbo_not_transaction_source"] };
  }
  const record = QboMinimizedSourceRecordSchema.parse(projection);
  if (record.provider.sourceEnvironment !== "sandbox") {
    return { disposition: "quarantined" as const, candidates: [] as Candidate[],
      reasonCodes: ["qbo_production_accounting_normalizer_required"] };
  }
  if (!eligibleRevenueTypes.has(record.recordType)) {
    return { disposition: "not_applicable" as const, candidates: [] as Candidate[], reasonCodes: ["qbo_no_v1_revenue_mapping"] };
  }
  if (record.status !== "active") {
    return { disposition: "quarantined" as const, candidates: [] as Candidate[], reasonCodes: ["qbo_revenue_status_requires_prior_lineage"] };
  }
  if (
    input.accountingBasis !== "accrual" ||
    record.temporal.postingDate === null ||
    record.accounting.sourceCurrency === null ||
    record.accounting.sourceCurrency !== input.reportingCurrency
  ) {
    return { disposition: "quarantined" as const, candidates: [] as Candidate[], reasonCodes: ["qbo_revenue_accounting_context_unsupported"] };
  }
  const providerEnvironment = QboProviderEnvironmentSchema.parse(
    record.provider.sourceEnvironment
  );
  const authority = checkedRevenueAuthority(
    input.revenueAuthority,
    record.provider.realmId,
    providerEnvironment,
    source
  );
  const incomeAccountRefs = new Set(authority.incomeAccountRefs);
  const revenueItemRefs = new Set(authority.revenueItemRefs);
  const lineIds = record.lines.flatMap((line) => line.lineId === null ? [] : [line.lineId]);
  if (new Set(lineIds).size !== lineIds.length) {
    return { disposition: "quarantined" as const, candidates: [] as Candidate[], reasonCodes: ["qbo_revenue_line_identity_ambiguous"] };
  }
  const eligibleLines = record.lines
    .map((line) => ({ line }))
    .filter(
      ({ line }) =>
        line.detailType === "SalesItemLineDetail" &&
        line.amount !== null &&
        line.lineId !== null &&
        line.itemRef !== null &&
        (
          line.accountRef !== null
            ? incomeAccountRefs.has(line.accountRef.value)
            : revenueItemRefs.has(line.itemRef.value)
        )
    );
  const eligibleLineIds = new Set(eligibleLines.map(({ line }) => line.lineId));
  const unsupportedEconomicLine = record.lines.some(
    (line) =>
      line.amount !== null &&
      line.amount.amount !== "0" &&
      line.detailType !== "SubTotalLineDetail" &&
      !(line.detailType === "SalesItemLineDetail" && line.itemRef === null) &&
      !eligibleLineIds.has(line.lineId)
  );
  if (unsupportedEconomicLine) {
    return {
      disposition: "quarantined" as const,
      candidates: [] as Candidate[],
      reasonCodes: ["qbo_revenue_line_authority_unproven"]
    };
  }
  if (eligibleLines.length === 0) {
    return { disposition: "quarantined" as const, candidates: [] as Candidate[], reasonCodes: ["qbo_revenue_line_mapping_unavailable"] };
  }
  const candidates = eligibleLines.map(({ line }, ordinal): Candidate => {
    if (!line.amount) throw new Error("qbo_revenue_line_amount_missing");
    return buildQboRevenueCandidate({ ...input, source, record, line, ordinal,
      amount: lineAmount(record, line.amount.amount), mappingVersion: QBO_CANONICAL_MAPPING_VERSION,
      reasonCodes: ["qbo_exact_sales_line_mapping"] });
  });
  return { disposition: "mapped" as const, candidates, reasonCodes: ["qbo_exact_sales_line_mapping"] };
}

function reportRows(report: QboReportControlObservation) {
  const rows: QboReportControlObservation["rows"] = [];
  const visit = (values: QboReportControlObservation["rows"]) => {
    for (const row of values) {
      rows.push(row);
      visit(row.children as QboReportControlObservation["rows"]);
    }
  };
  visit(report.rows);
  return rows;
}

export function extractQboProfitAndLossIncomeControl(input: unknown) {
  const report = QboReportControlObservationSchema.parse(input);
  if (report.contractVersion !== QBO_REPORT_CONTRACT_VERSION || report.reportType !== "ProfitAndLoss") {
    return null;
  }
  const matches = reportRows(report).filter((row) =>
    row.cells.some((cell) => cell.value?.trim().toLowerCase() === "total income")
  );
  if (matches.length !== 1) return null;
  const numeric = matches[0].cells
    .map((cell) => cell.value?.replace(/,/g, "").trim() ?? null)
    .filter((value): value is string => value !== null && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value));
  if (numeric.length !== 1) return null;
  return PersistedFactDecimalSchema.parse(
    numeric[0].includes(".")
      ? numeric[0].replace(/0+$/, "").replace(/\.$/, "")
      : numeric[0]
  );
}

export function mapValidatedQboProfitAndLossControl(input: {
  sourceVersion: unknown;
  sourceIdentityFingerprint: string;
  mappedAt: string;
  factIdentity: FactIdentity;
  representationId: string;
}) {
  const source = ExternalSourceRecordVersionSchema.parse(input.sourceVersion);
  const projection = sourceProjection(source);
  if (input.sourceIdentityFingerprint !== externalSourceIdentityFingerprint(source)) {
    throw new Error("qbo_canonical_mapping_source_identity_denied");
  }
  if (projection.contractVersion !== QBO_REPORT_CONTRACT_VERSION) {
    return { disposition: "not_applicable" as const, candidate: null };
  }
  const report = QboReportControlObservationSchema.parse(projection);
  if (report.provider.sourceEnvironment !== "sandbox") {
    return { disposition: "quarantined" as const, candidate: null,
      reasonCodes: ["qbo_production_report_control_requires_explicit_semantics"] };
  }
  const value = extractQboProfitAndLossIncomeControl(report);
  if (
    value === null ||
    report.reportBasis !== "accrual" ||
    report.periodStart === null ||
    report.periodEnd === null ||
    report.sourceCurrency === null
  ) {
    return {
      disposition: "quarantined" as const,
      candidate: null,
      reasonCodes: ["qbo_report_control_mapping_unavailable"]
    };
  }
  const factKey = stableFactKey({
    realmId: report.provider.realmId,
    recordType: report.reportType,
    recordId: `${report.periodStart}:${report.periodEnd}:${report.reportBasis}`,
    lineIdentity: "total_income",
    measure: "recognized_revenue_control"
  });
  const fact = factWithFingerprint({
    contractVersion: EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.canonicalFact,
    id: input.factIdentity.id,
    workspaceId: source.workspaceId,
    businessEntityId: source.businessEntityId,
    immutableVersion: input.factIdentity.immutableVersion,
    factKind: "recognized_revenue_control",
    factKey,
    dimensions: [],
    temporal: {
      effectiveAt: null,
      postingDate: null,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      fiscalYear: null,
      fiscalPeriod: null,
      sourceTimeZone: null,
      closedPeriod: false
    },
    accounting: {
      basis: report.reportBasis,
      sourceCurrency: report.sourceCurrency,
      reportingCurrency: report.sourceCurrency,
      exchangeRate: null,
      exchangeRateSource: null
    },
    value: { kind: "money", amount: value, currency: report.sourceCurrency },
    reconciliationState: "accepted",
    validationState: "valid",
    sources: [sourceReference(source, "control_observation")],
    decision: {
      authority: "deterministic_policy",
      policyVersion: QBO_CANONICAL_MAPPING_VERSION,
      actorId: null,
      decidedAt: input.mappedAt,
      reasonCodes: ["qbo_exact_profit_and_loss_total_income_control"]
    },
    normalizationVersion: QBO_CANONICAL_MAPPING_VERSION,
    transformationVersion: QBO_CANONICAL_MAPPING_VERSION,
    sourceObservedAt: source.temporal.observedAt,
    createdAt: input.mappedAt,
    factFingerprint: undefined
  });
  return {
    disposition: "mapped" as const,
    candidate: {
      fact,
      representation: representation({
        fact,
        source,
        sourceIdentityFingerprint: input.sourceIdentityFingerprint,
        representationId: input.representationId,
        familyKind: "non_additive_control",
        familyKey: QBO_REPORT_CONTROL_FAMILY_KEY,
        transactionIdentity: null,
        value,
        lineage: { kind: "none" }
      })
    },
    reasonCodes: ["qbo_exact_profit_and_loss_total_income_control"]
  };
}
