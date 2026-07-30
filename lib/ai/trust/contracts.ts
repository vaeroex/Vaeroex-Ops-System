export const TRUST_RESULT_CONTRACT_VERSION_V1 = "trust_result_v1" as const;
export const TRUST_RULESET_VERSION_V1 = "business_health_trust_rules_v1" as const;
export const TRUST_CLAIM_EXTRACTOR_VERSION_V1 = "deterministic_claim_extractor_v1" as const;

export type ClaimTypeV1 =
  | "deterministic_fact"
  | "supported_evidence_fact"
  | "contextual_business_note_fact"
  | "comparison"
  | "inference"
  | "causal_claim"
  | "recommendation"
  | "prediction"
  | "assumption"
  | "limitation"
  | "uncertainty_statement"
  | "citation_bearing_claim"
  | "connective_language"
  | "unknown_material_claim"
  | "non_material_language";

export type ValidationOutcomeV1 = "accepted" | "qualifier_required" | "unresolved" | "would_omit" | "would_reject";
export type UserVisibleTrustStatusV1 = "validated" | "qualified" | "limited" | "unavailable";

export type TrustProjectionBindingV1 = Readonly<{
  version: "trust_projection_binding_v1";
  snapshotFingerprint: string;
  projectionFingerprint: string;
  projectionAsOf: string;
}>;

export type ReferencedValueV1 = Readonly<{
  raw: string;
  normalized: string;
  kind: "number" | "percentage" | "currency" | "date" | "reporting_period" | "target" | "unknown";
  canonicalPath: string | null;
  role: "actual" | "target" | "comparison" | "score" | "component" | "unknown";
  sign: "positive" | "negative" | "unsigned";
  unit: string | null;
  precision: number | null;
  asOf: string | null;
}>;

export type RuleResultV1 = Readonly<{
  ruleId: string;
  ruleVersion: typeof TRUST_RULESET_VERSION_V1;
  outcome: ValidationOutcomeV1;
  reasonCodes: readonly string[];
  claimIds: readonly string[];
  deterministicReferences: readonly string[];
  qualifierRequirements: readonly string[];
}>;

export type ClaimV1 = Readonly<{
  claimId: string;
  sectionId: string;
  ordinal: number;
  text: string;
  textHash: string;
  claimType: ClaimTypeV1;
  claimTypes: readonly ClaimTypeV1[];
  supportingEvidenceIds: readonly string[];
  citationIds: readonly number[];
  deterministicReferences: readonly string[];
  referencedValues: readonly ReferencedValueV1[];
  kpiReferences: readonly string[];
  assumptions: readonly string[];
  limitations: readonly string[];
  qualifierRequirements: readonly string[];
  ruleOutcomes: readonly ValidationOutcomeV1[];
  rejectedReasonCodes: readonly string[];
}>;

export type TrustResultV1 = Readonly<{
  contractVersion: typeof TRUST_RESULT_CONTRACT_VERSION_V1;
  rulesetVersion: typeof TRUST_RULESET_VERSION_V1;
  claimExtractorVersion: typeof TRUST_CLAIM_EXTRACTOR_VERSION_V1;
  workflowId: string;
  mode: "shadow";
  outputContractVersion: string;
  validatorVersion: string;
  workspaceScopeRef: string;
  releaseChannel: "production" | "preview" | "development";
  snapshotFingerprint: string | null;
  projectionFingerprint: string | null;
  manifestIdentity: string;
  provider: string;
  model: string;
  requestId: string | null;
  generationTimestamp: string;
  repairCount: 0;
  additionalProviderCalls: 0;
  responseHash: string;
  sections: readonly Readonly<{ sectionId: string; claimIds: readonly string[] }>[];
  claims: readonly ClaimV1[];
  rules: readonly RuleResultV1[];
  overallShadowStatus: ValidationOutcomeV1;
  userVisibleStatus: UserVisibleTrustStatusV1;
  saveEligibility: Readonly<{ wouldBeEligible: boolean; enforced: false; reasonCodes: readonly string[] }>;
  trustFingerprint: string;
}>;

export type TrustShadowExecutionV1 = Readonly<{
  cacheState: "hit" | "miss" | "not_applicable";
  fallbackUsed: boolean;
  stale: boolean;
}>;
