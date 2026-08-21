import { z } from "zod";

import {
  BoundedIdentifierSchema,
  CurrencyCodeSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  PersistedFactDecimalSchema,
  ProviderKeySchema,
  Sha256FingerprintSchema,
  UuidSchema,
  uniqueStringArray
} from "@/lib/integrations/contracts/primitives";
import {
  CanonicalDimensionsSchema,
  ReconciliationClassificationSchema,
  ReconciliationMatchingTierSchema
} from "@/lib/integrations/reconciliation/contracts";

export const Phase2DecisionSchema = z
  .object({
    authority: z.enum(["deterministic_policy", "customer_authorized_user", "operator"]),
    policyVersion: BoundedIdentifierSchema.nullable(),
    actorId: UuidSchema.nullable(),
    decidedAt: IsoTimestampSchema,
    reasonCodes: uniqueStringArray(BoundedIdentifierSchema, 32)
  })
  .strict()
  .superRefine((decision, context) => {
    const deterministic = decision.authority === "deterministic_policy";
    if (deterministic !== (decision.policyVersion !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policyVersion"],
        message: "Only deterministic decisions require a policy version"
      });
    }
    if (deterministic === (decision.actorId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["actorId"],
        message: "Only human decisions require an actor"
      });
    }
  });

const authorityRuleSchema = z
  .object({
    sourceKind: z.enum(["provider", "upload", "manual"]),
    providerKey: ProviderKeySchema.nullable(),
    sourceClass: z.enum([
      "transaction_detail",
      "report_control",
      "manual_entry",
      "upload_observation"
    ]),
    authorityRole: z.enum(["authoritative", "supplemental", "control_only", "excluded"]),
    authorityRank: z.number().int().positive().max(1_000_000),
    contributionMode: z.enum(["additive_transaction", "non_additive_control", "both"])
  })
  .strict()
  .superRefine((rule, context) => {
    if ((rule.sourceKind === "provider") !== (rule.providerKey !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["providerKey"],
        message: "Only provider rules carry a provider key"
      });
    }
  });

export const SourceAuthorityPolicyCommitSchema = z
  .object({
    contractVersion: z.literal("source_authority_policy_v1"),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    domainKey: BoundedIdentifierSchema,
    policyKey: BoundedIdentifierSchema,
    immutableVersion: z.number().int().positive().safe(),
    supersedesPolicyVersionId: UuidSchema.nullable(),
    effectiveFrom: IsoTimestampSchema,
    effectiveThrough: IsoTimestampSchema.nullable(),
    conflictBehavior: z.enum(["hold_all", "allow_authoritative_and_flag"]),
    fallbackMode: z.enum(["manual_upload_when_unowned", "review_required"]),
    rules: z.array(authorityRuleSchema).min(1).max(100),
    decision: Phase2DecisionSchema,
    policyFingerprint: Sha256FingerprintSchema
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.decision.authority === "deterministic_policy") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision", "authority"],
        message: "Authority policy changes require human or operator provenance"
      });
    }
    if (policy.effectiveThrough && policy.effectiveThrough <= policy.effectiveFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveThrough"],
        message: "Policy end must follow its start"
      });
    }
  });

export const ContributionFamilyCommitSchema = z
  .object({
    contractVersion: z.literal("contribution_family_v1"),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    familyKey: BoundedIdentifierSchema,
    immutableVersion: z.number().int().positive().safe(),
    supersedesFamilyVersionId: UuidSchema.nullable(),
    domainKey: BoundedIdentifierSchema,
    measureKey: BoundedIdentifierSchema,
    aggregateKey: BoundedIdentifierSchema,
    contributionMode: z.enum(["additive_transaction", "non_additive_control"]),
    allowedFactKinds: z.array(BoundedIdentifierSchema).min(1).max(100),
    registryVersion: BoundedIdentifierSchema,
    effectiveFrom: IsoTimestampSchema,
    decision: Phase2DecisionSchema,
    familyFingerprint: Sha256FingerprintSchema
  })
  .strict();

const reconciliationFeaturesSchema = z
  .object({
    sourceIdentityMatch: z.boolean(),
    explicitLineageMatch: z.boolean(),
    economicIdentityMatch: z.boolean(),
    valueMatch: z.boolean(),
    accountingBasisMatch: z.boolean(),
    currencyMatch: z.boolean(),
    periodMatch: z.boolean(),
    dimensionsMatch: z.boolean(),
    fuzzyProposalOnly: z.boolean()
  })
  .strict();

const reconciliationMemberSchema = z
  .object({
    factVersionId: UuidSchema,
    sourceRecordVersionId: UuidSchema,
    sourceFingerprint: Sha256FingerprintSchema,
    economicIdentityFingerprint: Sha256FingerprintSchema,
    memberRole: z.enum([
      "candidate",
      "winner",
      "excluded",
      "correction_prior",
      "correction_current",
      "control_observation"
    ]),
    authorityRank: z.number().int().positive().max(1_000_000),
    additiveCandidate: z.boolean(),
    canonicalValue: PersistedFactDecimalSchema.nullable()
  })
  .strict();

export const ReconciliationCaseCommitSchema = z
  .object({
    contractVersion: z.literal("reconciliation_case_v1"),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    sourceAuthorityPolicyVersionId: UuidSchema,
    supersedesCaseId: UuidSchema.nullable(),
    caseFingerprint: Sha256FingerprintSchema,
    evaluatedAt: IsoTimestampSchema,
    effectiveAt: IsoTimestampSchema,
    matchRuleVersion: BoundedIdentifierSchema,
    matchTier: ReconciliationMatchingTierSchema,
    classification: ReconciliationClassificationSchema,
    caseState: z.enum(["resolved", "review_required"]),
    winningFactVersionId: UuidSchema.nullable(),
    deterministicFeatures: reconciliationFeaturesSchema,
    decision: Phase2DecisionSchema,
    members: z.array(reconciliationMemberSchema).min(2).max(100)
  })
  .strict();

const contributionEventSchema = z
  .object({
    contractVersion: z.literal("fact_contribution_event_v1"),
    id: UuidSchema,
    eventKind: z.enum(["establish", "retract", "control_observation"]),
    factVersionId: UuidSchema,
    targetContributionEventId: UuidSchema.nullable(),
    contributionIdentityFingerprint: Sha256FingerprintSchema,
    economicIdentityFingerprint: Sha256FingerprintSchema,
    effectiveAt: IsoTimestampSchema.nullable(),
    periodStart: IsoDateSchema.nullable(),
    periodEnd: IsoDateSchema.nullable(),
    dimensions: CanonicalDimensionsSchema,
    accountingBasis: z.enum(["accrual", "cash", "not_applicable", "unknown"]),
    currency: CurrencyCodeSchema.nullable(),
    valueCanonical: PersistedFactDecimalSchema,
    registryVersion: BoundedIdentifierSchema,
    eventFingerprint: Sha256FingerprintSchema
  })
  .strict()
  .superRefine((event, context) => {
    if ((event.eventKind === "retract") !== (event.targetContributionEventId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetContributionEventId"],
        message: "Only retractions reference a prior contribution event"
      });
    }
    if ((event.periodStart === null) !== (event.periodEnd === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["periodStart"],
        message: "Contribution period bounds must be both present or both absent"
      });
    }
  });

export const FactContributionBatchCommitSchema = z
  .object({
    contractVersion: z.literal("fact_contribution_batch_v1"),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    reconciliationCaseId: UuidSchema,
    sourceAuthorityPolicyVersionId: UuidSchema,
    contributionFamilyVersionId: UuidSchema,
    batchFingerprint: Sha256FingerprintSchema,
    decision: Phase2DecisionSchema,
    events: z.array(contributionEventSchema).min(1).max(100)
  })
  .strict();

export type SourceAuthorityPolicyCommit = Readonly<z.infer<typeof SourceAuthorityPolicyCommitSchema>>;
export type ContributionFamilyCommit = Readonly<z.infer<typeof ContributionFamilyCommitSchema>>;
export type ReconciliationCaseCommit = Readonly<z.infer<typeof ReconciliationCaseCommitSchema>>;
export type FactContributionBatchCommit = Readonly<z.infer<typeof FactContributionBatchCommitSchema>>;
