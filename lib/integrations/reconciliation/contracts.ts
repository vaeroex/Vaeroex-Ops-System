import { z } from "zod";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  BoundedIdentifierSchema,
  ContractVersionSchema,
  CurrencyCodeSchema,
  IsoDateSchema,
  IsoTimestampSchema,
  PersistedFactDecimalSchema,
  PersistedUnitIntervalDecimalSchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";
import { EXTERNAL_INTEGRATION_LIMITS } from "@/lib/integrations/contracts/versions";

export const RECONCILIATION_CONTRACT_VERSIONS = {
  sourceAuthorityPolicy: "source_authority_policy_v1",
  reconciliationCase: "reconciliation_case_v1",
  contributionFamily: "contribution_family_v1",
  factContributionBatch: "fact_contribution_batch_v1",
  shadowCandidate: "shadow_reconciliation_candidate_v1"
} as const;

export const RECONCILIATION_CLASSIFIER_VERSION = "deterministic_reconciliation_classifier_v1" as const;
export const RECONCILIATION_FINGERPRINT_VERSION = "reconciliation_fingerprint_v1" as const;

export const SourceClassSchema = z.enum(["connected_system", "upload", "manual"]);
export const SourceAuthorityRoleSchema = z.enum([
  "authoritative",
  "supplemental",
  "control_only",
  "excluded"
]);
export const ReconciliationConflictBehaviorSchema = z.enum([
  "hold_all",
  "allow_authoritative_and_flag"
]);

export const ReconciliationMatchingTierSchema = z.enum([
  "exact_source_identity_version",
  "explicit_known_lineage",
  "exact_canonical_economic_identity",
  "ambiguous_review"
]);

export const ReconciliationClassificationSchema = z.enum([
  "same_fact_represented_twice",
  "duplicate_evidence",
  "independent_facts",
  "source_correction",
  "authority_excluded_representation",
  "manual_override",
  "conflicting_sources",
  "ambiguous_review",
  "control_observation_vs_additive_detail"
]);

export const ContributionFamilyKindSchema = z.enum([
  "additive_transaction",
  "non_additive_control"
]);

export const FactContributionEventKindSchema = z.enum([
  "establish",
  "retract",
  "control_observation"
]);

export const CanonicalDimensionSchema = z
  .object({
    key: BoundedIdentifierSchema,
    value: z.string().trim().min(1).max(200)
  })
  .strict();

export const CanonicalDimensionsSchema = z
  .array(CanonicalDimensionSchema)
  .max(EXTERNAL_INTEGRATION_LIMITS.dimensionsPerFact)
  .superRefine((dimensions, context) => {
    const keys = dimensions.map((dimension) => dimension.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Canonical dimension keys must be unique"
      });
    }
  });

export const EconomicEffectiveTimeSchema = z
  .object({
    effectiveAt: IsoTimestampSchema.nullable(),
    postingDate: IsoDateSchema.nullable(),
    periodStart: IsoDateSchema.nullable(),
    periodEnd: IsoDateSchema.nullable()
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.periodStart === null) !== (value.periodEnd === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Economic period bounds must be both present or both absent"
      });
    }
    if (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Economic period start must not follow its end"
      });
    }
    if (
      value.effectiveAt === null &&
      value.postingDate === null &&
      value.periodStart === null
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Economic identity requires an effective time, posting date, or period"
      });
    }
  });

export const CanonicalEconomicIdentitySchema = z
  .object({
    domain: BoundedIdentifierSchema,
    contributionFamilyKey: BoundedIdentifierSchema,
    contributionFamilyKind: ContributionFamilyKindSchema,
    measureKey: BoundedIdentifierSchema,
    aggregateKey: BoundedIdentifierSchema,
    transactionIdentity: BoundedIdentifierSchema.nullable(),
    effectiveTime: EconomicEffectiveTimeSchema,
    dimensions: CanonicalDimensionsSchema,
    accountingBasis: z.enum(["accrual", "cash", "not_applicable", "unknown"]),
    currency: CurrencyCodeSchema.nullable()
  })
  .strict();

export type CanonicalEconomicIdentity = Readonly<z.infer<typeof CanonicalEconomicIdentitySchema>>;

const reasonCodesSchema = z
  .array(BoundedIdentifierSchema)
  .min(1)
  .max(32)
  .superRefine((reasonCodes, context) => {
    if (new Set(reasonCodes).size !== reasonCodes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Reason codes must be unique"
      });
    }
  });

export const SourceAuthorityRuleSchema = z
  .object({
    ruleId: BoundedIdentifierSchema,
    ruleVersion: ContractVersionSchema,
    domain: BoundedIdentifierSchema,
    sourceClass: SourceClassSchema,
    sourceAuthorityKey: BoundedIdentifierSchema,
    authorityRole: SourceAuthorityRoleSchema,
    priority: z.number().int().positive().safe()
  })
  .strict();

const sourceAuthorityDecisionSchema = z
  .object({
    authority: z.enum(["customer_authorized_user", "operator"]),
    actorId: UuidSchema,
    decidedAt: IsoTimestampSchema,
    reasonCodes: reasonCodesSchema
  })
  .strict();

export const SourceAuthorityPolicySchema = z
  .object({
    contractVersion: z.literal(RECONCILIATION_CONTRACT_VERSIONS.sourceAuthorityPolicy),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    policyVersion: ContractVersionSchema,
    domain: BoundedIdentifierSchema,
    effectiveFrom: IsoTimestampSchema,
    effectiveTo: IsoTimestampSchema.nullable(),
    conflictBehavior: ReconciliationConflictBehaviorSchema,
    rules: z.array(SourceAuthorityRuleSchema).min(1).max(100),
    decision: sourceAuthorityDecisionSchema,
    policyFingerprint: Sha256FingerprintSchema.optional()
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.effectiveTo !== null && policy.effectiveTo <= policy.effectiveFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveTo"],
        message: "Authority policy end must follow its start"
      });
    }

    const ruleIds = policy.rules.map((rule) => rule.ruleId);
    if (new Set(ruleIds).size !== ruleIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rules"],
        message: "Authority rule identifiers must be unique"
      });
    }

    const selectors = policy.rules.map(
      (rule) => `${rule.sourceClass}\u0000${rule.sourceAuthorityKey}`
    );
    if (new Set(selectors).size !== selectors.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rules"],
        message: "Authority source selectors must be unique within a policy version"
      });
    }

    for (const [index, rule] of policy.rules.entries()) {
      if (rule.domain !== policy.domain) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["rules", index, "domain"],
          message: "Authority rules must use their policy domain"
        });
      }
    }
  });

export type SourceAuthorityPolicyV1 = Readonly<z.infer<typeof SourceAuthorityPolicySchema>>;

export const ReconciliationLineageSchema = z.union([
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("known_lineage"),
      sourceRecordVersionIds: z.array(UuidSchema).max(100),
      canonicalFactVersionIds: z.array(UuidSchema).max(100)
    })
    .strict()
    .superRefine((value, context) => {
      if (value.sourceRecordVersionIds.length === 0 && value.canonicalFactVersionIds.length === 0) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Known lineage requires at least one exact immutable reference"
        });
      }
      if (new Set(value.sourceRecordVersionIds).size !== value.sourceRecordVersionIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sourceRecordVersionIds"],
          message: "Known source lineage references must be unique"
        });
      }
      if (new Set(value.canonicalFactVersionIds).size !== value.canonicalFactVersionIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["canonicalFactVersionIds"],
          message: "Known fact lineage references must be unique"
        });
      }
    }),
  z
    .object({
      kind: z.literal("correction"),
      priorSourceRecordVersionId: UuidSchema.nullable(),
      priorCanonicalFactVersionId: UuidSchema.nullable()
    })
    .strict()
    .superRefine((value, context) => {
      if (value.priorSourceRecordVersionId === null && value.priorCanonicalFactVersionId === null) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Corrections require an exact prior immutable reference"
        });
      }
    }),
  z
    .object({
      kind: z.literal("manual_override"),
      overriddenCanonicalFactVersionId: UuidSchema,
      actorId: UuidSchema
    })
    .strict()
]);

export const SimilarityHintSchema = z
  .object({
    kind: z.enum(["label_similarity", "amount_similarity", "temporal_proximity"]),
    score: PersistedUnitIntervalDecimalSchema,
    hintVersion: ContractVersionSchema
  })
  .strict();

export const ReconciliationRepresentationSchema = z
  .object({
    representationId: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    canonicalFactVersionId: UuidSchema,
    canonicalFactFingerprint: Sha256FingerprintSchema,
    factKind: BoundedIdentifierSchema,
    factKey: BoundedIdentifierSchema,
    sourceRecordVersionId: UuidSchema,
    sourceVersionFingerprint: Sha256FingerprintSchema,
    sourceIdentityFingerprint: Sha256FingerprintSchema,
    sourceImmutableVersion: z.number().int().positive().safe(),
    sourceClass: SourceClassSchema,
    sourceAuthorityKey: BoundedIdentifierSchema,
    economicIdentity: CanonicalEconomicIdentitySchema,
    value: PersistedFactDecimalSchema,
    validationState: z.enum(["valid", "invalid"]),
    reconciliationState: z.enum([
      "accepted",
      "excluded_duplicate",
      "excluded_authority",
      "conflicted",
      "tombstone"
    ]),
    lineage: ReconciliationLineageSchema,
    similarityHints: z.array(SimilarityHintSchema).max(32)
  })
  .strict();

export type ReconciliationRepresentation = Readonly<
  z.infer<typeof ReconciliationRepresentationSchema>
>;

export const SourceAuthoritySelectionSchema = z
  .object({
    policyId: UuidSchema,
    policyVersion: ContractVersionSchema,
    policyFingerprint: Sha256FingerprintSchema,
    selectedRepresentationId: UuidSchema.nullable(),
    rankedRepresentationIds: z.array(UuidSchema),
    excludedRepresentationIds: z.array(UuidSchema),
    ruleByRepresentationId: z.record(
      z.object({
        ruleId: BoundedIdentifierSchema,
        authorityRole: SourceAuthorityRoleSchema,
        priority: z.number().int().positive().safe()
      }).strict()
    ),
    conflictBehavior: ReconciliationConflictBehaviorSchema
  })
  .strict();

export type SourceAuthoritySelection = Readonly<z.infer<typeof SourceAuthoritySelectionSchema>>;

export const ReconciliationCaseMemberDispositionSchema = z.enum([
  "selected",
  "duplicate",
  "independent",
  "excluded",
  "held",
  "control",
  "superseded"
]);

export const ReconciliationCaseMemberSchema = z
  .object({
    representation: ReconciliationRepresentationSchema,
    authorityRuleId: BoundedIdentifierSchema,
    authorityRole: SourceAuthorityRoleSchema,
    authorityPriority: z.number().int().positive().safe(),
    disposition: ReconciliationCaseMemberDispositionSchema
  })
  .strict();

const reconciliationDecisionSchema = z
  .object({
    selectedRepresentationIds: z.array(UuidSchema),
    reasonCodes: reasonCodesSchema
  })
  .strict();

export const ReconciliationCaseSchema = z
  .object({
    contractVersion: z.literal(RECONCILIATION_CONTRACT_VERSIONS.reconciliationCase),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    domain: BoundedIdentifierSchema,
    classifierVersion: z.literal(RECONCILIATION_CLASSIFIER_VERSION),
    policyId: UuidSchema,
    policyVersion: ContractVersionSchema,
    policyFingerprint: Sha256FingerprintSchema,
    conflictBehavior: ReconciliationConflictBehaviorSchema,
    matchingTier: ReconciliationMatchingTierSchema,
    classification: ReconciliationClassificationSchema,
    matchFeatures: z
      .object({
        exactSourceIdentityVersion: z.boolean(),
        explicitKnownLineage: z.boolean(),
        exactCanonicalEconomicIdentity: z.boolean(),
        independentTransactionIdentities: z.boolean(),
        similarityHintsPresent: z.boolean()
      })
      .strict(),
    members: z.array(ReconciliationCaseMemberSchema).min(2).max(100),
    decision: reconciliationDecisionSchema,
    classifiedAt: IsoTimestampSchema,
    caseFingerprint: Sha256FingerprintSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    const memberIds = value.members.map((member) => member.representation.representationId);
    if (new Set(memberIds).size !== memberIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["members"],
        message: "Reconciliation members must be unique"
      });
    }

    for (const [index, member] of value.members.entries()) {
      if (
        member.representation.workspaceId !== value.workspaceId ||
        member.representation.businessEntityId !== value.businessEntityId ||
        member.representation.economicIdentity.domain !== value.domain
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["members", index],
          message: "Reconciliation members must share the case workspace, entity, and domain"
        });
      }
    }

    const selected = value.decision.selectedRepresentationIds;
    if (new Set(selected).size !== selected.length || selected.some((id) => !memberIds.includes(id))) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision", "selectedRepresentationIds"],
        message: "Selected representations must be a unique subset of case members"
      });
    }

    const mustHold =
      value.classification === "ambiguous_review" ||
      (value.classification === "conflicting_sources" && value.conflictBehavior === "hold_all");
    if (mustHold && selected.length !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decision", "selectedRepresentationIds"],
        message: "Review-required or held conflicts cannot select numerical contributions"
      });
    }

    if (
      value.matchFeatures.similarityHintsPresent &&
      (value.matchingTier !== "ambiguous_review" || value.classification !== "ambiguous_review")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["matchFeatures", "similarityHintsPresent"],
        message: "Similarity hints are review-only and cannot establish deterministic identity"
      });
    }
  });

export type ReconciliationCaseV1 = Readonly<z.infer<typeof ReconciliationCaseSchema>>;

export const ContributionFamilySchema = z
  .object({
    contractVersion: z.literal(RECONCILIATION_CONTRACT_VERSIONS.contributionFamily),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    registryVersion: ContractVersionSchema,
    familyVersion: ContractVersionSchema,
    domain: BoundedIdentifierSchema,
    familyKey: BoundedIdentifierSchema,
    familyKind: ContributionFamilyKindSchema,
    measureKey: BoundedIdentifierSchema,
    aggregateKey: BoundedIdentifierSchema,
    allowedAccountingBases: z
      .array(z.enum(["accrual", "cash", "not_applicable", "unknown"]))
      .min(1)
      .max(4),
    currencyMode: z.enum(["required", "forbidden", "optional"]),
    effectiveFrom: IsoTimestampSchema,
    effectiveTo: IsoTimestampSchema.nullable(),
    familyFingerprint: Sha256FingerprintSchema.optional()
  })
  .strict()
  .superRefine((family, context) => {
    if (new Set(family.allowedAccountingBases).size !== family.allowedAccountingBases.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowedAccountingBases"],
        message: "Allowed accounting bases must be unique"
      });
    }
    if (family.effectiveTo !== null && family.effectiveTo <= family.effectiveFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveTo"],
        message: "Contribution family end must follow its start"
      });
    }
  });

export type ContributionFamilyV1 = Readonly<z.infer<typeof ContributionFamilySchema>>;

const contributionFamilyReferenceSchema = z
  .object({
    id: UuidSchema,
    familyFingerprint: Sha256FingerprintSchema,
    registryVersion: ContractVersionSchema,
    familyVersion: ContractVersionSchema,
    domain: BoundedIdentifierSchema,
    familyKey: BoundedIdentifierSchema,
    familyKind: ContributionFamilyKindSchema,
    measureKey: BoundedIdentifierSchema,
    aggregateKey: BoundedIdentifierSchema
  })
  .strict();

export const FactContributionEventSchema = z
  .object({
    eventFingerprint: Sha256FingerprintSchema,
    eventKind: FactContributionEventKindSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    canonicalFactVersionId: UuidSchema,
    canonicalFactFingerprint: Sha256FingerprintSchema,
    sourceRecordVersionIds: z.array(UuidSchema).min(1).max(100),
    reconciliationCaseId: UuidSchema,
    reconciliationCaseFingerprint: Sha256FingerprintSchema,
    policyId: UuidSchema,
    policyVersion: ContractVersionSchema,
    policyFingerprint: Sha256FingerprintSchema,
    contributionFamily: contributionFamilyReferenceSchema,
    value: PersistedFactDecimalSchema,
    effectiveTime: EconomicEffectiveTimeSchema,
    dimensions: CanonicalDimensionsSchema,
    accountingBasis: z.enum(["accrual", "cash", "not_applicable", "unknown"]),
    currency: CurrencyCodeSchema.nullable(),
    retractsEventFingerprint: Sha256FingerprintSchema.nullable(),
    reasonCode: ReconciliationClassificationSchema
  })
  .strict()
  .superRefine((event, context) => {
    if (new Set(event.sourceRecordVersionIds).size !== event.sourceRecordVersionIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceRecordVersionIds"],
        message: "Contribution source provenance must be unique"
      });
    }
    if ((event.eventKind === "retract") !== (event.retractsEventFingerprint !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["retractsEventFingerprint"],
        message: "Only retract events must reference the event they retract"
      });
    }
    if (
      event.eventKind === "control_observation" &&
      event.contributionFamily.familyKind !== "non_additive_control"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contributionFamily", "familyKind"],
        message: "Control observations require a non-additive control family"
      });
    }
    if (
      event.eventKind !== "control_observation" &&
      event.contributionFamily.familyKind !== "additive_transaction"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contributionFamily", "familyKind"],
        message: "Establish and retract events require an additive transaction family"
      });
    }
  });

export type FactContributionEvent = Readonly<z.infer<typeof FactContributionEventSchema>>;

export const FactContributionBatchSchema = z
  .object({
    contractVersion: z.literal(RECONCILIATION_CONTRACT_VERSIONS.factContributionBatch),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    reconciliationCaseId: UuidSchema,
    reconciliationCaseFingerprint: Sha256FingerprintSchema,
    policyId: UuidSchema,
    policyVersion: ContractVersionSchema,
    policyFingerprint: Sha256FingerprintSchema,
    registryVersion: ContractVersionSchema,
    events: z.array(FactContributionEventSchema).max(200),
    plannedAt: IsoTimestampSchema,
    batchFingerprint: Sha256FingerprintSchema.optional()
  })
  .strict()
  .superRefine((batch, context) => {
    const eventFingerprints = batch.events.map((event) => event.eventFingerprint);
    if (new Set(eventFingerprints).size !== eventFingerprints.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["events"],
        message: "Contribution events must be unique within a batch"
      });
    }
    for (const [index, event] of batch.events.entries()) {
      if (
        event.workspaceId !== batch.workspaceId ||
        event.businessEntityId !== batch.businessEntityId ||
        event.reconciliationCaseId !== batch.reconciliationCaseId ||
        event.reconciliationCaseFingerprint !== batch.reconciliationCaseFingerprint ||
        event.policyId !== batch.policyId ||
        event.policyVersion !== batch.policyVersion ||
        event.policyFingerprint !== batch.policyFingerprint ||
        event.contributionFamily.registryVersion !== batch.registryVersion
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["events", index],
          message: "Contribution events must share their batch scope and policy lineage"
        });
      }
    }
  });

export type FactContributionBatchV1 = Readonly<z.infer<typeof FactContributionBatchSchema>>;

export const LegacyKpiProvenanceSchema = z.discriminatedUnion("sourceKind", [
  z
    .object({
      sourceKind: z.literal("upload"),
      sourceFileId: UuidSchema,
      sourceFileFingerprint: Sha256FingerprintSchema,
      importId: UuidSchema,
      importRowId: UuidSchema,
      rowNumber: z.number().int().positive().safe()
    })
    .strict(),
  z
    .object({
      sourceKind: z.literal("manual"),
      sourceFileId: z.null(),
      sourceFileFingerprint: z.null(),
      importId: z.null(),
      importRowId: z.null(),
      rowNumber: z.null(),
      manualRecordId: UuidSchema,
      actorId: UuidSchema
    })
    .strict()
]);

export const ShadowReconciliationCandidateSchema = z
  .object({
    contractVersion: z.literal(RECONCILIATION_CONTRACT_VERSIONS.shadowCandidate),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    legacyKpiId: UuidSchema,
    kpiKey: BoundedIdentifierSchema,
    exactValue: PersistedFactDecimalSchema,
    economicIdentity: CanonicalEconomicIdentitySchema,
    provenance: LegacyKpiProvenanceSchema,
    shadowOnly: z.literal(true),
    promotionAuthorized: z.literal(false),
    projectedAt: IsoTimestampSchema,
    candidateFingerprint: Sha256FingerprintSchema.optional()
  })
  .strict();

export type ShadowReconciliationCandidateV1 = Readonly<
  z.infer<typeof ShadowReconciliationCandidateSchema>
>;

function semanticSort<T>(values: readonly T[]) {
  return [...values].sort((left, right) => {
    const leftFingerprint = contractSha256(left);
    const rightFingerprint = contractSha256(right);
    return leftFingerprint < rightFingerprint ? -1 : leftFingerprint > rightFingerprint ? 1 : 0;
  });
}

function reconciliationFingerprintEnvelope(
  fingerprintPurpose: string,
  fingerprintVersion: string,
  payload: unknown
) {
  return {
    fingerprintPurpose,
    fingerprintVersion,
    payload
  } as const;
}

export function canonicalizeDimensions(
  dimensions: z.infer<typeof CanonicalDimensionsSchema>
) {
  return semanticSort(CanonicalDimensionsSchema.parse(dimensions));
}

export function sourceAuthorityPolicyFingerprintInput(input: unknown) {
  const policy = SourceAuthorityPolicySchema.parse(input);
  return reconciliationFingerprintEnvelope(
    "source_authority_policy",
    RECONCILIATION_FINGERPRINT_VERSION,
    {
      contractVersion: policy.contractVersion,
      id: policy.id,
      workspaceId: policy.workspaceId,
      businessEntityId: policy.businessEntityId,
      policyVersion: policy.policyVersion,
      domain: policy.domain,
      effectiveFrom: policy.effectiveFrom,
      effectiveTo: policy.effectiveTo,
      conflictBehavior: policy.conflictBehavior,
      rules: semanticSort(policy.rules),
      decision: {
        authority: policy.decision.authority,
        actorId: policy.decision.actorId,
        reasonCodes: semanticSort(policy.decision.reasonCodes)
      }
    }
  );
}

export function sourceAuthorityPolicyFingerprint(input: unknown) {
  return contractSha256(sourceAuthorityPolicyFingerprintInput(input));
}

export function contributionFamilyFingerprintInput(input: unknown) {
  const family = ContributionFamilySchema.parse(input);
  return reconciliationFingerprintEnvelope(
    "contribution_family",
    RECONCILIATION_FINGERPRINT_VERSION,
    {
      contractVersion: family.contractVersion,
      id: family.id,
      workspaceId: family.workspaceId,
      businessEntityId: family.businessEntityId,
      registryVersion: family.registryVersion,
      familyVersion: family.familyVersion,
      domain: family.domain,
      familyKey: family.familyKey,
      familyKind: family.familyKind,
      measureKey: family.measureKey,
      aggregateKey: family.aggregateKey,
      allowedAccountingBases: semanticSort(family.allowedAccountingBases),
      currencyMode: family.currencyMode,
      effectiveFrom: family.effectiveFrom,
      effectiveTo: family.effectiveTo
    }
  );
}

export function contributionFamilyFingerprint(input: unknown) {
  return contractSha256(contributionFamilyFingerprintInput(input));
}
