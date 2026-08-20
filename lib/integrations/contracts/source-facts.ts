import { z } from "zod";

import {
  BoundedIdentifierSchema,
  BoundedLabelSchema,
  BoundedTextSchema,
  ContractJsonObjectSchema,
  CurrencyCodeSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  PersistedExchangeRateSchema,
  PersistedFactDecimalSchema,
  PersistedFactIntegerSchema,
  PersistedNonNegativeFactDecimalSchema,
  ProviderKeySchema,
  Sha256FingerprintSchema,
  TimeZoneSchema,
  UuidSchema,
  uniqueStringArray
} from "@/lib/integrations/contracts/primitives";
import {
  EXTERNAL_INTEGRATION_CONTRACT_VERSIONS,
  EXTERNAL_INTEGRATION_LIMITS
} from "@/lib/integrations/contracts/versions";

export const ExternalSourceDescriptorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("provider"),
      providerKey: ProviderKeySchema,
      providerRecordType: BoundedIdentifierSchema,
      providerRecordId: BoundedIdentifierSchema,
      providerVersionReference: BoundedIdentifierSchema.nullable()
    })
    .strict(),
  z
    .object({
      kind: z.literal("upload"),
      artifactFingerprint: Sha256FingerprintSchema,
      rowReference: BoundedIdentifierSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("manual"),
      actorId: UuidSchema,
      entryReference: BoundedIdentifierSchema
    })
    .strict()
]);

export const SourceTemporalContextSchema = z
  .object({
    basis: z.enum(["event", "point_in_time", "period"]),
    providerCreatedAt: IsoTimestampSchema.nullable(),
    providerUpdatedAt: IsoTimestampSchema.nullable(),
    observedAt: IsoTimestampSchema,
    synchronizedAt: IsoTimestampSchema,
    ingestedAt: IsoTimestampSchema,
    effectiveAt: IsoTimestampSchema.nullable(),
    postingDate: IsoDateSchema.nullable(),
    periodStart: IsoDateSchema.nullable(),
    periodEnd: IsoDateSchema.nullable(),
    sourceTimeZone: TimeZoneSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    const hasPeriod = value.periodStart !== null || value.periodEnd !== null;
    if (value.basis === "period" && (value.periodStart === null || value.periodEnd === null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Period sources require both period bounds" });
    }
    if (value.basis !== "period" && hasPeriod) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Only period sources may have period bounds" });
    }
    if (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Source period start must not follow its end" });
    }
  });

export const AccountingContextSchema = z
  .object({
    basis: z.enum(["accrual", "cash", "not_applicable", "unknown"]),
    currency: CurrencyCodeSchema.nullable()
  })
  .strict();

const validationIssueSchema = z
  .object({
    code: BoundedIdentifierSchema,
    severity: z.enum(["error", "warning"]),
    field: BoundedIdentifierSchema.nullable(),
    detail: BoundedTextSchema
  })
  .strict();

export const ExternalSourceRecordVersionSchema = z
  .object({
    contractVersion: z.literal(EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.sourceRecord),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema.nullable(),
    immutableVersion: z.number().int().positive().safe(),
    priorVersionId: UuidSchema.nullable(),
    recordKind: BoundedIdentifierSchema,
    source: ExternalSourceDescriptorSchema,
    temporal: SourceTemporalContextSchema,
    accounting: AccountingContextSchema,
    normalizedSchemaVersion: BoundedIdentifierSchema,
    changeKind: z.enum(["created", "updated", "corrected", "voided", "deleted", "unchanged"]),
    normalizedProjection: ContractJsonObjectSchema.nullable(),
    trust: z.literal("untrusted_external_input"),
    validation: z
      .object({
        state: z.enum(["pending", "valid", "invalid", "quarantined"]),
        validatorVersion: BoundedIdentifierSchema,
        issues: z.array(validationIssueSchema).max(EXTERNAL_INTEGRATION_LIMITS.issuesPerRecord)
      })
      .strict(),
    receivedAt: IsoTimestampSchema,
    sourceFingerprint: Sha256FingerprintSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source.kind === "provider" && value.connectionId === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["connectionId"], message: "Provider sources require a connection" });
    }
    if (value.source.kind !== "provider" && value.connectionId !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["connectionId"], message: "Non-provider sources cannot claim a connection" });
    }
    if (value.changeKind === "deleted" && value.normalizedProjection !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["normalizedProjection"], message: "Deleted source versions cannot contain a projection" });
    }
    if (value.changeKind !== "deleted" && value.normalizedProjection === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["normalizedProjection"], message: "Live source versions require a projection" });
    }
  });

export type ExternalSourceRecordVersion = Readonly<z.infer<typeof ExternalSourceRecordVersionSchema>>;

export const CanonicalFactValueSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("money"), amount: PersistedFactDecimalSchema, currency: CurrencyCodeSchema }).strict(),
  z.object({ kind: z.literal("decimal"), value: PersistedFactDecimalSchema, unit: BoundedIdentifierSchema }).strict(),
  z.object({ kind: z.literal("percentage"), value: PersistedFactDecimalSchema }).strict(),
  z.object({ kind: z.literal("integer"), value: PersistedFactIntegerSchema, unit: BoundedIdentifierSchema.nullable() }).strict(),
  z.object({ kind: z.literal("boolean"), value: z.boolean() }).strict(),
  z.object({ kind: z.literal("date"), value: IsoDateSchema }).strict(),
  z.object({ kind: z.literal("text"), value: BoundedLabelSchema }).strict(),
  z.object({ kind: z.literal("structured"), value: ContractJsonObjectSchema }).strict()
]);

export type CanonicalFactValue = Readonly<z.infer<typeof CanonicalFactValueSchema>>;

export const FactTemporalContextSchema = z
  .object({
    effectiveAt: IsoTimestampSchema.nullable(),
    postingDate: IsoDateSchema.nullable(),
    periodStart: IsoDateSchema.nullable(),
    periodEnd: IsoDateSchema.nullable(),
    fiscalYear: z.number().int().min(1_900).max(9_999).safe().nullable(),
    fiscalPeriod: z.number().int().min(1).max(53).safe().nullable(),
    sourceTimeZone: TimeZoneSchema.nullable(),
    closedPeriod: z.boolean()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Fact period start must not follow its end" });
    }
    if ((value.periodStart === null) !== (value.periodEnd === null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Fact period bounds must be both present or both absent" });
    }
  });

export const FactAccountingContextSchema = z
  .object({
    basis: z.enum(["accrual", "cash", "not_applicable", "unknown"]),
    sourceCurrency: CurrencyCodeSchema.nullable(),
    reportingCurrency: CurrencyCodeSchema.nullable(),
    exchangeRate: PersistedExchangeRateSchema.nullable(),
    exchangeRateSource: BoundedIdentifierSchema.nullable()
  })
  .strict();

const factDimensionSchema = z.object({ key: BoundedIdentifierSchema, value: BoundedLabelSchema }).strict();

export const FactSourceReferenceSchema = z
  .object({
    sourceRecordVersionId: UuidSchema,
    sourceFingerprint: Sha256FingerprintSchema,
    sourceRole: z.enum([
      "primary",
      "corroborating",
      "duplicate_representation",
      "correction",
      "manual_override",
      "control_observation"
    ]),
    contributionWeight: PersistedNonNegativeFactDecimalSchema.nullable()
  })
  .strict();

const factDecisionSchema = z
  .object({
    authority: z.enum(["deterministic_policy", "customer_authorized_user", "operator"]),
    policyVersion: BoundedIdentifierSchema.nullable(),
    actorId: UuidSchema.nullable(),
    decidedAt: IsoTimestampSchema,
    reasonCodes: uniqueStringArray(BoundedIdentifierSchema, 32)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.authority === "deterministic_policy" && value.policyVersion === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["policyVersion"], message: "Deterministic decisions require a policy version" });
    }
    if (value.authority !== "deterministic_policy" && value.actorId === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["actorId"], message: "Human decisions require an actor" });
    }
  });

export const CanonicalBusinessFactVersionSchema = z
  .object({
    contractVersion: z.literal(EXTERNAL_INTEGRATION_CONTRACT_VERSIONS.canonicalFact),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    immutableVersion: z.number().int().positive().safe(),
    factKind: BoundedIdentifierSchema,
    factKey: BoundedIdentifierSchema,
    dimensions: z.array(factDimensionSchema).max(EXTERNAL_INTEGRATION_LIMITS.dimensionsPerFact),
    temporal: FactTemporalContextSchema,
    accounting: FactAccountingContextSchema,
    value: CanonicalFactValueSchema.nullable(),
    reconciliationState: z.enum(["accepted", "excluded_duplicate", "excluded_authority", "conflicted", "tombstone"]),
    validationState: z.enum(["valid", "invalid"]),
    sources: z.array(FactSourceReferenceSchema).min(1).max(EXTERNAL_INTEGRATION_LIMITS.sourceReferencesPerFact),
    decision: factDecisionSchema,
    normalizationVersion: BoundedIdentifierSchema,
    transformationVersion: BoundedIdentifierSchema,
    sourceObservedAt: IsoTimestampSchema,
    createdAt: IsoTimestampSchema,
    factFingerprint: Sha256FingerprintSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    const dimensionKeys = value.dimensions.map((dimension) => dimension.key);
    if (new Set(dimensionKeys).size !== dimensionKeys.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["dimensions"], message: "Fact dimension keys must be unique" });
    }
    const sourceIds = value.sources.map((source) => source.sourceRecordVersionId);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["sources"], message: "Fact source references must be unique" });
    }
    if (value.reconciliationState === "accepted" && value.validationState !== "valid") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Accepted facts must be valid" });
    }
    if (value.reconciliationState === "tombstone" && value.value !== null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Tombstone facts cannot have a value" });
    }
    if (value.reconciliationState !== "tombstone" && value.value === null) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Non-tombstone facts require a value" });
    }
    if (value.value?.kind === "money") {
      if (value.accounting.sourceCurrency !== value.value.currency) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["accounting", "sourceCurrency"], message: "Money value currency must match source currency" });
      }
      if (value.accounting.reportingCurrency === null) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["accounting", "reportingCurrency"], message: "Money facts require a reporting currency" });
      }
      if (
        value.accounting.reportingCurrency !== null &&
        value.accounting.reportingCurrency !== value.accounting.sourceCurrency &&
        (value.accounting.exchangeRate === null || value.accounting.exchangeRateSource === null)
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["accounting"], message: "Currency conversion requires a rate and rate source" });
      }
      if (
        value.accounting.reportingCurrency === value.accounting.sourceCurrency &&
        (value.accounting.exchangeRate !== null || value.accounting.exchangeRateSource !== null)
      ) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["accounting"], message: "Same-currency facts cannot carry conversion metadata" });
      }
    } else if (
      value.accounting.sourceCurrency !== null ||
      value.accounting.reportingCurrency !== null ||
      value.accounting.exchangeRate !== null ||
      value.accounting.exchangeRateSource !== null
    ) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["accounting"], message: "Non-money facts cannot carry currency conversion fields" });
    }
  });

export type CanonicalBusinessFactVersion = Readonly<z.infer<typeof CanonicalBusinessFactVersionSchema>>;
