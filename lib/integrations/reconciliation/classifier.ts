import { z } from "zod";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { IsoTimestampSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import {
  CanonicalEconomicIdentitySchema,
  RECONCILIATION_CLASSIFIER_VERSION,
  RECONCILIATION_CONTRACT_VERSIONS,
  RECONCILIATION_FINGERPRINT_VERSION,
  ReconciliationCaseSchema,
  ReconciliationRepresentationSchema,
  SourceAuthorityPolicySchema,
  SourceAuthoritySelectionSchema,
  canonicalizeDimensions,
  sourceAuthorityPolicyFingerprint,
  type ReconciliationCaseV1,
  type ReconciliationRepresentation,
  type SourceAuthorityPolicyV1,
  type SourceAuthoritySelection
} from "@/lib/integrations/reconciliation/contracts";

export const SelectSourceAuthorityInputSchema = z
  .object({
    policy: SourceAuthorityPolicySchema,
    representations: z.array(ReconciliationRepresentationSchema).min(1).max(100),
    evaluatedAt: IsoTimestampSchema
  })
  .strict();

export const ClassifyReconciliationCaseInputSchema = z
  .object({
    id: UuidSchema,
    policy: SourceAuthorityPolicySchema,
    representations: z.array(ReconciliationRepresentationSchema).min(2).max(100),
    classifiedAt: IsoTimestampSchema
  })
  .strict();

function timestampMillis(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("invalid_reconciliation_timestamp");
  return parsed;
}

function assertPolicyFingerprint(policy: SourceAuthorityPolicyV1) {
  const fingerprint = sourceAuthorityPolicyFingerprint(policy);
  if (policy.policyFingerprint && policy.policyFingerprint !== fingerprint) {
    throw new Error("source_authority_policy_fingerprint_mismatch");
  }
  return fingerprint;
}

function assertPolicyApplicability(
  policy: SourceAuthorityPolicyV1,
  representations: readonly ReconciliationRepresentation[],
  evaluatedAt: string
) {
  const instant = timestampMillis(evaluatedAt);
  if (
    instant < timestampMillis(policy.effectiveFrom) ||
    (policy.effectiveTo !== null && instant >= timestampMillis(policy.effectiveTo))
  ) {
    throw new Error("source_authority_policy_not_effective");
  }

  for (const representation of representations) {
    if (
      representation.workspaceId !== policy.workspaceId ||
      representation.businessEntityId !== policy.businessEntityId
    ) {
      throw new Error("source_authority_scope_mismatch");
    }
    if (representation.economicIdentity.domain !== policy.domain) {
      throw new Error("source_authority_domain_mismatch");
    }
  }
}

const authorityRoleOrder = {
  authoritative: 0,
  supplemental: 1,
  control_only: 2,
  excluded: 3
} as const;

export function selectSourceAuthority(input: unknown): SourceAuthoritySelection {
  const parsed = SelectSourceAuthorityInputSchema.parse(input);
  const policyFingerprint = assertPolicyFingerprint(parsed.policy);
  assertPolicyApplicability(parsed.policy, parsed.representations, parsed.evaluatedAt);

  const ranked = parsed.representations.map((representation) => {
    const rule = parsed.policy.rules.find(
      (candidate) =>
        candidate.domain === representation.economicIdentity.domain &&
        candidate.sourceClass === representation.sourceClass &&
        candidate.sourceAuthorityKey === representation.sourceAuthorityKey
    );
    if (!rule) throw new Error("source_authority_rule_not_found");
    return { representation, rule };
  });

  ranked.sort((left, right) => {
    const roleDifference =
      authorityRoleOrder[left.rule.authorityRole] - authorityRoleOrder[right.rule.authorityRole];
    if (roleDifference !== 0) return roleDifference;
    if (left.rule.priority !== right.rule.priority) return left.rule.priority - right.rule.priority;
    if (left.representation.sourceAuthorityKey !== right.representation.sourceAuthorityKey) {
      return left.representation.sourceAuthorityKey < right.representation.sourceAuthorityKey ? -1 : 1;
    }
    if (left.representation.canonicalFactFingerprint !== right.representation.canonicalFactFingerprint) {
      return left.representation.canonicalFactFingerprint < right.representation.canonicalFactFingerprint
        ? -1
        : 1;
    }
    return left.representation.representationId < right.representation.representationId ? -1 : 1;
  });

  const selected = ranked.find(
    ({ rule }) => rule.authorityRole === "authoritative" || rule.authorityRole === "supplemental"
  );
  const ruleByRepresentationId = Object.fromEntries(
    ranked.map(({ representation, rule }) => [
      representation.representationId,
      {
        ruleId: rule.ruleId,
        authorityRole: rule.authorityRole,
        priority: rule.priority
      }
    ])
  );

  return SourceAuthoritySelectionSchema.parse({
    policyId: parsed.policy.id,
    policyVersion: parsed.policy.policyVersion,
    policyFingerprint,
    selectedRepresentationId: selected?.representation.representationId ?? null,
    rankedRepresentationIds: ranked.map(({ representation }) => representation.representationId),
    excludedRepresentationIds: ranked
      .filter(({ rule }) => rule.authorityRole === "excluded" || rule.authorityRole === "control_only")
      .map(({ representation }) => representation.representationId),
    ruleByRepresentationId,
    conflictBehavior: parsed.policy.conflictBehavior
  });
}

function economicIdentityPayload(input: unknown, mode: "exact" | "transaction_agnostic" | "control_comparison") {
  const identity = CanonicalEconomicIdentitySchema.parse(input);
  return {
    domain: identity.domain,
    contributionFamilyKey: mode === "control_comparison" ? null : identity.contributionFamilyKey,
    contributionFamilyKind: mode === "control_comparison" ? null : identity.contributionFamilyKind,
    measureKey: identity.measureKey,
    aggregateKey: identity.aggregateKey,
    transactionIdentity: mode === "exact" ? identity.transactionIdentity : null,
    effectiveTime: identity.effectiveTime,
    dimensions: canonicalizeDimensions(identity.dimensions),
    accountingBasis: identity.accountingBasis,
    currency: identity.currency
  };
}

export function canonicalEconomicIdentityFingerprintInput(input: unknown) {
  return {
    fingerprintPurpose: "canonical_economic_identity",
    fingerprintVersion: RECONCILIATION_FINGERPRINT_VERSION,
    payload: economicIdentityPayload(input, "exact")
  } as const;
}

export function canonicalEconomicIdentityFingerprint(input: unknown) {
  return contractSha256(canonicalEconomicIdentityFingerprintInput(input));
}

function comparisonFingerprint(
  representation: ReconciliationRepresentation,
  mode: "exact" | "transaction_agnostic" | "control_comparison"
) {
  return contractSha256({
    fingerprintPurpose: `canonical_economic_identity_${mode}`,
    fingerprintVersion: RECONCILIATION_FINGERPRINT_VERSION,
    payload: economicIdentityPayload(representation.economicIdentity, mode)
  });
}

function valuesAreIdentical(representations: readonly ReconciliationRepresentation[]) {
  return new Set(representations.map((representation) => representation.value)).size === 1;
}

function allFingerprintsMatch(
  representations: readonly ReconciliationRepresentation[],
  fingerprint: (representation: ReconciliationRepresentation) => string
) {
  return new Set(representations.map(fingerprint)).size === 1;
}

function hasDirectLineage(
  source: ReconciliationRepresentation,
  target: ReconciliationRepresentation
) {
  switch (source.lineage.kind) {
    case "none":
      return false;
    case "known_lineage":
      return (
        source.lineage.sourceRecordVersionIds.includes(target.sourceRecordVersionId) ||
        source.lineage.canonicalFactVersionIds.includes(target.canonicalFactVersionId)
      );
    case "correction":
      return (
        source.lineage.priorSourceRecordVersionId === target.sourceRecordVersionId ||
        source.lineage.priorCanonicalFactVersionId === target.canonicalFactVersionId
      );
    case "manual_override":
      return source.lineage.overriddenCanonicalFactVersionId === target.canonicalFactVersionId;
  }
}

function hasConnectedExplicitLineage(representations: readonly ReconciliationRepresentation[]) {
  const visited = new Set<number>([0]);
  const pending = [0];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) break;
    for (let index = 0; index < representations.length; index += 1) {
      if (visited.has(index)) continue;
      if (
        hasDirectLineage(representations[current], representations[index]) ||
        hasDirectLineage(representations[index], representations[current])
      ) {
        visited.add(index);
        pending.push(index);
      }
    }
  }
  return visited.size === representations.length;
}

function eligibleForNumericalContribution(representation: ReconciliationRepresentation) {
  return representation.validationState === "valid" && representation.reconciliationState === "accepted";
}

function correctionSuccessor(representations: readonly ReconciliationRepresentation[]) {
  return representations.find(
    (representation) =>
      representation.lineage.kind === "correction" &&
      representations.some((candidate) => hasDirectLineage(representation, candidate))
  );
}

function manualOverrideSuccessor(representations: readonly ReconciliationRepresentation[]) {
  return representations.find(
    (representation) =>
      representation.lineage.kind === "manual_override" &&
      representations.some((candidate) => hasDirectLineage(representation, candidate))
  );
}

function semanticSort<T>(values: readonly T[]) {
  return [...values].sort((left, right) => {
    const leftHash = contractSha256(left);
    const rightHash = contractSha256(right);
    return leftHash < rightHash ? -1 : leftHash > rightHash ? 1 : 0;
  });
}

export function reconciliationCaseFingerprintInput(input: unknown) {
  const reconciliationCase = ReconciliationCaseSchema.parse(input);
  return {
    fingerprintPurpose: "reconciliation_case",
    fingerprintVersion: RECONCILIATION_FINGERPRINT_VERSION,
    payload: {
      contractVersion: reconciliationCase.contractVersion,
      id: reconciliationCase.id,
      workspaceId: reconciliationCase.workspaceId,
      businessEntityId: reconciliationCase.businessEntityId,
      domain: reconciliationCase.domain,
      classifierVersion: reconciliationCase.classifierVersion,
      policyId: reconciliationCase.policyId,
      policyVersion: reconciliationCase.policyVersion,
      policyFingerprint: reconciliationCase.policyFingerprint,
      conflictBehavior: reconciliationCase.conflictBehavior,
      matchingTier: reconciliationCase.matchingTier,
      classification: reconciliationCase.classification,
      matchFeatures: reconciliationCase.matchFeatures,
      members: semanticSort(reconciliationCase.members),
      decision: {
        selectedRepresentationIds: semanticSort(
          reconciliationCase.decision.selectedRepresentationIds
        ),
        reasonCodes: semanticSort(reconciliationCase.decision.reasonCodes)
      }
    }
  } as const;
}

export function reconciliationCaseFingerprint(input: unknown) {
  return contractSha256(reconciliationCaseFingerprintInput(input));
}

export function classifyReconciliationCase(input: unknown): ReconciliationCaseV1 {
  const parsed = ClassifyReconciliationCaseInputSchema.parse(input);
  const representations = parsed.representations;
  const authority = selectSourceAuthority({
    policy: parsed.policy,
    representations,
    evaluatedAt: parsed.classifiedAt
  });

  const hintsPresent = representations.some(
    (representation) => representation.similarityHints.length > 0
  );
  const exactSourceIdentityVersion = allFingerprintsMatch(
    representations,
    (representation) =>
      `${representation.sourceIdentityFingerprint}:${representation.sourceImmutableVersion}:${representation.sourceVersionFingerprint}`
  );
  const explicitKnownLineage = hasConnectedExplicitLineage(representations);
  const exactCanonicalEconomicIdentity = allFingerprintsMatch(
    representations,
    (representation) => comparisonFingerprint(representation, "exact")
  );
  const transactionAgnosticIdentity = allFingerprintsMatch(
    representations,
    (representation) => comparisonFingerprint(representation, "transaction_agnostic")
  );
  const transactionIdentities = representations.map(
    (representation) => representation.economicIdentity.transactionIdentity
  );
  const independentTransactionIdentities =
    transactionAgnosticIdentity &&
    transactionIdentities.every((identity): identity is string => identity !== null) &&
    new Set(transactionIdentities).size === transactionIdentities.length;
  const controlComparison = allFingerprintsMatch(
    representations,
    (representation) => comparisonFingerprint(representation, "control_comparison")
  );
  const familyKinds = new Set(
    representations.map((representation) => representation.economicIdentity.contributionFamilyKind)
  );
  const controlVersusAdditive =
    controlComparison &&
    familyKinds.has("additive_transaction") &&
    familyKinds.has("non_additive_control");
  const allValidAccepted = representations.every(eligibleForNumericalContribution);
  const correction = correctionSuccessor(representations);
  const manualOverride = manualOverrideSuccessor(representations);
  const authorityExcluded = representations.some(
    (representation) =>
      authority.ruleByRepresentationId[representation.representationId]?.authorityRole === "excluded"
  );
  const sameValue = valuesAreIdentical(representations);

  let matchingTier: z.infer<typeof ReconciliationCaseSchema>["matchingTier"];
  let classification: z.infer<typeof ReconciliationCaseSchema>["classification"];
  const reasonCodes: string[] = [];

  if (hintsPresent || !allValidAccepted) {
    matchingTier = "ambiguous_review";
    classification = "ambiguous_review";
    reasonCodes.push(hintsPresent ? "similarity_hints_review_only" : "ineligible_fact_state");
  } else if (manualOverride) {
    matchingTier = "explicit_known_lineage";
    classification = "manual_override";
    reasonCodes.push("exact_manual_override_lineage");
  } else if (correction) {
    matchingTier = "explicit_known_lineage";
    classification = "source_correction";
    reasonCodes.push("exact_correction_lineage");
  } else if (controlVersusAdditive) {
    matchingTier = "exact_canonical_economic_identity";
    classification = "control_observation_vs_additive_detail";
    reasonCodes.push("non_additive_control_separated");
  } else if (independentTransactionIdentities) {
    matchingTier = "exact_canonical_economic_identity";
    classification = "independent_facts";
    reasonCodes.push("distinct_explicit_transaction_identities");
  } else if (exactSourceIdentityVersion) {
    matchingTier = "exact_source_identity_version";
    classification =
      sameValue && exactCanonicalEconomicIdentity ? "duplicate_evidence" : "conflicting_sources";
    reasonCodes.push(
      sameValue && exactCanonicalEconomicIdentity
        ? "same_immutable_source_version"
        : "source_version_semantic_conflict"
    );
  } else if (explicitKnownLineage) {
    matchingTier = "explicit_known_lineage";
    classification =
      sameValue && exactCanonicalEconomicIdentity ? "duplicate_evidence" : "conflicting_sources";
    reasonCodes.push(
      sameValue && exactCanonicalEconomicIdentity
        ? "known_lineage_duplicate"
        : "known_lineage_semantic_conflict"
    );
  } else if (exactCanonicalEconomicIdentity) {
    matchingTier = "exact_canonical_economic_identity";
    if (authorityExcluded) {
      classification = "authority_excluded_representation";
      reasonCodes.push("domain_authority_rule_excluded_source");
    } else if (!sameValue) {
      classification = "conflicting_sources";
      reasonCodes.push("exact_identity_value_conflict");
    } else if (
      new Set(representations.map((representation) => representation.canonicalFactVersionId)).size === 1
    ) {
      classification = "duplicate_evidence";
      reasonCodes.push("same_fact_version_duplicate_evidence");
    } else {
      classification = "same_fact_represented_twice";
      reasonCodes.push("exact_identity_duplicate_representation");
    }
  } else {
    matchingTier = "ambiguous_review";
    classification = "ambiguous_review";
    reasonCodes.push("no_deterministic_identity_proof");
  }

  let selectedRepresentationIds: string[] = [];
  if (classification === "independent_facts") {
    selectedRepresentationIds = authority.rankedRepresentationIds.filter((id) => {
      const representation = representations.find((candidate) => candidate.representationId === id);
      const role = authority.ruleByRepresentationId[id]?.authorityRole;
      return (
        representation?.economicIdentity.contributionFamilyKind === "additive_transaction" &&
        role !== "excluded" &&
        role !== "control_only"
      );
    });
  } else if (classification === "control_observation_vs_additive_detail") {
    selectedRepresentationIds = authority.rankedRepresentationIds.filter((id) => {
      const representation = representations.find((candidate) => candidate.representationId === id);
      const role = authority.ruleByRepresentationId[id]?.authorityRole;
      return (
        representation?.economicIdentity.contributionFamilyKind === "additive_transaction" &&
        role !== "excluded" &&
        role !== "control_only"
      );
    });
  } else if (classification === "source_correction" && correction) {
    const role = authority.ruleByRepresentationId[correction.representationId]?.authorityRole;
    if (role !== "excluded" && role !== "control_only") {
      selectedRepresentationIds = [correction.representationId];
    }
  } else if (classification === "manual_override" && manualOverride) {
    const role = authority.ruleByRepresentationId[manualOverride.representationId]?.authorityRole;
    if (role !== "excluded" && role !== "control_only") {
      selectedRepresentationIds = [manualOverride.representationId];
    }
  } else if (
    classification !== "ambiguous_review" &&
    (classification !== "conflicting_sources" ||
      parsed.policy.conflictBehavior === "allow_authoritative_and_flag") &&
    authority.selectedRepresentationId !== null
  ) {
    selectedRepresentationIds = [authority.selectedRepresentationId];
  }

  const members = authority.rankedRepresentationIds.map((representationId) => {
    const representation = representations.find(
      (candidate) => candidate.representationId === representationId
    );
    if (!representation) throw new Error("reconciliation_representation_missing");
    const rule = authority.ruleByRepresentationId[representationId];
    if (!rule) throw new Error("source_authority_rule_result_missing");

    let disposition: z.infer<typeof ReconciliationCaseSchema>["members"][number]["disposition"];
    if (rule.authorityRole === "excluded") {
      disposition = "excluded";
    } else if (representation.economicIdentity.contributionFamilyKind === "non_additive_control") {
      disposition = "control";
    } else if (classification === "source_correction" && representation !== correction) {
      disposition = "superseded";
    } else if (classification === "manual_override" && representation !== manualOverride) {
      disposition = "superseded";
    } else if (selectedRepresentationIds.includes(representationId)) {
      disposition = classification === "independent_facts" ? "independent" : "selected";
    } else if (
      classification === "same_fact_represented_twice" ||
      classification === "duplicate_evidence" ||
      classification === "authority_excluded_representation"
    ) {
      disposition = "duplicate";
    } else {
      disposition = "held";
    }

    return {
      representation,
      authorityRuleId: rule.ruleId,
      authorityRole: rule.authorityRole,
      authorityPriority: rule.priority,
      disposition
    };
  });

  const withoutFingerprint = ReconciliationCaseSchema.parse({
    contractVersion: RECONCILIATION_CONTRACT_VERSIONS.reconciliationCase,
    id: parsed.id,
    workspaceId: parsed.policy.workspaceId,
    businessEntityId: parsed.policy.businessEntityId,
    domain: parsed.policy.domain,
    classifierVersion: RECONCILIATION_CLASSIFIER_VERSION,
    policyId: parsed.policy.id,
    policyVersion: parsed.policy.policyVersion,
    policyFingerprint: authority.policyFingerprint,
    conflictBehavior: parsed.policy.conflictBehavior,
    matchingTier,
    classification,
    matchFeatures: {
      exactSourceIdentityVersion,
      explicitKnownLineage,
      exactCanonicalEconomicIdentity,
      independentTransactionIdentities,
      similarityHintsPresent: hintsPresent
    },
    members,
    decision: {
      selectedRepresentationIds,
      reasonCodes
    },
    classifiedAt: parsed.classifiedAt
  });
  const caseFingerprint = reconciliationCaseFingerprint(withoutFingerprint);

  return ReconciliationCaseSchema.parse({
    ...withoutFingerprint,
    caseFingerprint
  });
}
