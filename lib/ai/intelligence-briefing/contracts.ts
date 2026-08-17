import type { EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";
import type { TrustProjectionBindingV1 } from "@/lib/ai/trust/contracts";
import type { Json } from "@/lib/supabase/types";

export const INTELLIGENCE_BRIEFING_CONTRACT_ID = "intelligence_briefing_v1" as const;
export const INTELLIGENCE_BRIEFING_CONTRACT_VERSION = "intelligence_briefing_v1" as const;
export const INTELLIGENCE_BRIEFING_SCHEMA_VERSION = "intelligence_briefing_schema_v1" as const;
export const INTELLIGENCE_BRIEFING_VALIDATOR_VERSION = "intelligence_briefing_validator_v1" as const;
export const INTELLIGENCE_BRIEFING_PROMPT_VERSION = "intelligence_briefing_prompt_v1" as const;
export const INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION = "intelligence_briefing_generation_policy_v1" as const;
export const INTELLIGENCE_BRIEFING_MATERIALITY_VERSION = "intelligence_briefing_materiality_v1" as const;

export const INTELLIGENCE_BRIEFING_TYPES = ["weekly", "monthly"] as const;
export type IntelligenceBriefingType = (typeof INTELLIGENCE_BRIEFING_TYPES)[number];

export const INTELLIGENCE_BRIEFING_SECTION_IDS = [
  "revenue_growth",
  "financial_performance",
  "operations_delivery",
  "customers_market",
  "workforce_organizational_performance",
  "quality_risk_compliance",
  "business_updates_context"
] as const;
export type IntelligenceBriefingSectionId = (typeof INTELLIGENCE_BRIEFING_SECTION_IDS)[number];

export const INTELLIGENCE_BRIEFING_SECTION_LABELS: Record<IntelligenceBriefingSectionId, string> = {
  revenue_growth: "Revenue & Growth",
  financial_performance: "Financial Performance",
  operations_delivery: "Operations & Delivery",
  customers_market: "Customers & Market",
  workforce_organizational_performance: "Workforce & Organizational Performance",
  quality_risk_compliance: "Quality, Risk & Compliance",
  business_updates_context: "Business Updates & Context"
};

export type IntelligenceBriefingEligibilityState = "no_eligible_evidence" | "limited" | "sufficient";
export type IntelligenceBriefingConfidence = "High" | "Medium" | "Low";
export type IntelligenceBriefingFreshness = "current" | "stale" | "unavailable";

export type IntelligenceBriefingEvidencePeriod = Readonly<{
  start: string;
  end: string;
  cutoff: string;
  dayCount: 7 | 30;
  timeZone: "UTC";
}>;

export type IntelligenceBriefingCitation = Readonly<{
  citationId: number;
  title: string;
  sourceLabel: string;
  sourceType: string;
  excerpt: string;
  recordedAt: string | null;
  href: `/app/${string}`;
}>;

export type IntelligenceBriefingSignalKind = "business_health" | "kpi" | "finding" | "reported_context";
export type IntelligenceBriefingSignalAuthority = "deterministic_result" | "measured_evidence" | "reported_context";

export type IntelligenceBriefingSignal = Readonly<{
  ref: string;
  stableKey: string;
  kind: IntelligenceBriefingSignalKind;
  authority: IntelligenceBriefingSignalAuthority;
  sectionId: IntelligenceBriefingSectionId | null;
  label: string;
  fact: string;
  confidence: IntelligenceBriefingConfidence;
  citationIds: readonly number[];
  evidenceReferenceIds: readonly string[];
  limitation: string | null;
  periodRelation: "new_or_changed" | "continuing" | "current_state" | "reported_context";
  semanticState?: Readonly<{
    desiredDirection: string;
    targetStatus: string;
    performanceEffect: string;
    metricRole: string;
  }>;
}>;

export type IntelligenceBriefingSectionInput = Readonly<{
  id: IntelligenceBriefingSectionId;
  label: string;
  signalRefs: readonly string[];
}>;

export type IntelligenceBriefingEvidenceCoverage = Readonly<{
  supportingRecordCount: number;
  independentSourceCount: number;
  freshness: IntelligenceBriefingFreshness;
  latestEvidenceAt: string | null;
  overallCoverage: number | null;
  coverageLabel: string;
  includedDomains: readonly string[];
  missingOrWeakDomains: readonly string[];
}>;

export type IntelligenceBriefingContextReference = Readonly<{
  ref: string;
  sourceNoteId: string;
  sourceVersion: number;
  title: string;
  summary: string;
  approvedAt: string;
  observedAt: string | null;
  applicabilityStart: string | null;
  applicabilityEnd: string | null;
}>;

export type IntelligenceBriefingPackage = Readonly<{
  contractId: typeof INTELLIGENCE_BRIEFING_CONTRACT_ID;
  contractVersion: typeof INTELLIGENCE_BRIEFING_CONTRACT_VERSION;
  schemaVersion: typeof INTELLIGENCE_BRIEFING_SCHEMA_VERSION;
  validatorVersion: typeof INTELLIGENCE_BRIEFING_VALIDATOR_VERSION;
  promptVersion: typeof INTELLIGENCE_BRIEFING_PROMPT_VERSION;
  generationPolicyVersion: typeof INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION;
  materialityVersion: typeof INTELLIGENCE_BRIEFING_MATERIALITY_VERSION;
  workspaceId: string;
  briefingType: IntelligenceBriefingType;
  period: IntelligenceBriefingEvidencePeriod;
  eligibility: IntelligenceBriefingEligibilityState;
  confidence: IntelligenceBriefingConfidence;
  evidenceCoverage: IntelligenceBriefingEvidenceCoverage;
  evidenceFingerprint: string;
  effectiveEvidenceFingerprint: string;
  materialStateFingerprint: string;
  generationKey: string;
  snapshotFingerprint: string;
  businessHealth: Readonly<{
    available: boolean;
    score: number | null;
    status: string;
    trajectory: string | null;
    confidence: IntelligenceBriefingConfidence;
  }>;
  signals: readonly IntelligenceBriefingSignal[];
  sections: readonly IntelligenceBriefingSectionInput[];
  contextReferences: readonly IntelligenceBriefingContextReference[];
  limitations: readonly Readonly<{ ref: string; text: string }>[];
  manifest: EvidenceManifest;
  citations: readonly IntelligenceBriefingCitation[];
  requiredSignalRefs: readonly string[];
  previousBriefing: Readonly<{
    runId: string;
    generatedAt: string;
    materialStateFingerprint: string;
  }> | null;
  trustBinding: TrustProjectionBindingV1;
}>;

export type IntelligenceBriefingClaim = Readonly<{
  text: string;
  support_refs: readonly string[];
}>;

export type IntelligenceBriefingModelOutput = Readonly<{
  executive_summary: IntelligenceBriefingClaim;
  sections: readonly Readonly<{
    section_id: IntelligenceBriefingSectionId;
    summary: string;
    support_refs: readonly string[];
    claims: readonly IntelligenceBriefingClaim[];
  }>[];
  leadership_considerations: readonly IntelligenceBriefingClaim[];
  limitation_refs: readonly string[];
}>;

const CLAIM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text", "support_refs"],
  properties: {
    text: { type: "string" },
    support_refs: { type: "array", items: { type: "string" } }
  }
} as const;

export const INTELLIGENCE_BRIEFING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["executive_summary", "sections", "leadership_considerations", "limitation_refs"],
  properties: {
    executive_summary: CLAIM_SCHEMA,
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section_id", "summary", "support_refs", "claims"],
        properties: {
          section_id: { type: "string", enum: INTELLIGENCE_BRIEFING_SECTION_IDS },
          summary: { type: "string" },
          support_refs: { type: "array", items: { type: "string" } },
          claims: { type: "array", items: CLAIM_SCHEMA }
        }
      }
    },
    leadership_considerations: { type: "array", items: CLAIM_SCHEMA },
    limitation_refs: { type: "array", items: { type: "string" } }
  }
} as const;

export type IntelligenceBriefingProviderAttribution = Readonly<{
  provider: "openai";
  model: string;
  fallbackUsed: boolean;
  providerPolicyId: string;
}>;

export type IntelligenceBriefingArtifact = Readonly<{
  contractId: typeof INTELLIGENCE_BRIEFING_CONTRACT_ID;
  contractVersion: typeof INTELLIGENCE_BRIEFING_CONTRACT_VERSION;
  schemaVersion: typeof INTELLIGENCE_BRIEFING_SCHEMA_VERSION;
  validatorVersion: typeof INTELLIGENCE_BRIEFING_VALIDATOR_VERSION;
  promptVersion: typeof INTELLIGENCE_BRIEFING_PROMPT_VERSION;
  generationPolicyVersion: typeof INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION;
  materialityVersion: typeof INTELLIGENCE_BRIEFING_MATERIALITY_VERSION;
  workspaceId: string;
  briefingType: IntelligenceBriefingType;
  period: IntelligenceBriefingEvidencePeriod;
  eligibility: Exclude<IntelligenceBriefingEligibilityState, "no_eligible_evidence">;
  confidence: IntelligenceBriefingConfidence;
  evidenceCoverage: IntelligenceBriefingEvidenceCoverage;
  evidenceFingerprint: string;
  effectiveEvidenceFingerprint: string;
  materialStateFingerprint: string;
  generationKey: string;
  snapshotFingerprint: string;
  generatedAt: string;
  businessHealth: IntelligenceBriefingPackage["businessHealth"];
  analysis: IntelligenceBriefingModelOutput;
  sections: IntelligenceBriefingPackage["sections"];
  signals: IntelligenceBriefingPackage["signals"];
  limitations: IntelligenceBriefingPackage["limitations"];
  citations: readonly IntelligenceBriefingCitation[];
  contextReferences: readonly IntelligenceBriefingContextReference[];
  providerAttribution: IntelligenceBriefingProviderAttribution;
  provenance: Readonly<{
    snapshotContract: "intelligence_snapshot_v1";
    snapshotFingerprint: string;
    evidenceManifestId: string;
    previousBriefingRunId: string | null;
  }>;
}>;

export type IntelligenceBriefingViewArtifact = IntelligenceBriefingArtifact;

export type IntelligenceBriefingGenerationStatus =
  | "unavailable"
  | "ready"
  | "current"
  | "unchanged"
  | "generating"
  | "failed";

export type IntelligenceBriefingState = Readonly<{
  status: IntelligenceBriefingGenerationStatus;
  briefingType: IntelligenceBriefingType;
  period: IntelligenceBriefingEvidencePeriod;
  eligibility: IntelligenceBriefingEligibilityState;
  confidence: IntelligenceBriefingConfidence;
  artifact: IntelligenceBriefingViewArtifact | null;
  message: string | null;
}>;

export function isIntelligenceBriefingType(value: unknown): value is IntelligenceBriefingType {
  return typeof value === "string" && INTELLIGENCE_BRIEFING_TYPES.includes(value as IntelligenceBriefingType);
}

export function briefingTypeLabel(type: IntelligenceBriefingType) {
  return type === "weekly" ? "Weekly Intelligence Briefing" : "Monthly Intelligence Briefing";
}

export function intelligenceBriefingArtifactAsJson(artifact: IntelligenceBriefingArtifact): Json {
  return artifact as unknown as Json;
}
