import type { EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";

export const BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID = "business_health_explanation_v1" as const;
export const BUSINESS_HEALTH_EXPLANATION_CONTRACT_VERSION = "business_health_explanation_v1" as const;
export const BUSINESS_HEALTH_EXPLANATION_VALIDATOR_VERSION = "business_health_explanation_validator_v1" as const;

export const BUSINESS_HEALTH_EXPLANATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "executive_interpretation",
    "why_it_matters",
    "leadership_consideration",
    "provisional_hypothesis"
  ],
  properties: {
    executive_interpretation: { type: "string" },
    why_it_matters: { type: "string" },
    leadership_consideration: { type: "string" },
    provisional_hypothesis: { type: ["string", "null"] }
  }
} as const;

export type BusinessHealthExplanationSubmode =
  | "healthy_improving"
  | "healthy_slowing"
  | "stable"
  | "watch_recovering"
  | "at_risk_worsening"
  | "evidence_limited"
  | "evidence_stale";

export type BusinessHealthConfidence = "High" | "Medium" | "Low";

export type BusinessHealthExplanationModelOutput = Readonly<{
  executive_interpretation: string;
  why_it_matters: string;
  leadership_consideration: string;
  provisional_hypothesis: string | null;
}>;

export type BusinessHealthExplanationDriver = Readonly<{
  kind: "risk" | "opportunity";
  label: string;
  fact: string;
  scoreImpact: number;
  citationIds: readonly number[];
  limitation: string | null;
}>;

export type BusinessHealthExplanationFacts = Readonly<{
  available: boolean;
  score: number | null;
  status: string;
  trajectory: string | null;
  comparison: string;
  comparisonDelta: number | null;
  dataQualityBase: number;
  riskPenalty: number;
  opportunityAdjustment: number;
  confidence: BusinessHealthConfidence;
  freshness: "current" | "stale" | "unavailable";
  latestEvidenceAt: string | null;
  deterministicSummary: string;
  drivers: readonly BusinessHealthExplanationDriver[];
  limitations: readonly string[];
}>;

export type BusinessHealthCitationView = Readonly<{
  citationId: number;
  title: string;
  sourceLabel: string;
  sourceType: string;
  excerpt: string;
  recordedAt: string | null;
}>;

export type BusinessHealthExplanationPackage = Readonly<{
  contractId: typeof BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID;
  contractVersion: typeof BUSINESS_HEALTH_EXPLANATION_CONTRACT_VERSION;
  validatorVersion: typeof BUSINESS_HEALTH_EXPLANATION_VALIDATOR_VERSION;
  fingerprint: string;
  submode: BusinessHealthExplanationSubmode;
  facts: BusinessHealthExplanationFacts;
  manifest: EvidenceManifest;
  requiredCitationIds: readonly number[];
  citations: readonly BusinessHealthCitationView[];
  hypothesisAllowed: false;
}>;

export type BusinessHealthProviderAttribution = Readonly<{
  provider: "openai" | "nvidia";
  model: string;
  fallbackUsed: boolean;
  providerPolicyId: string;
}>;

export type BusinessHealthExplanationArtifact = Readonly<{
  contractId: typeof BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID;
  contractVersion: typeof BUSINESS_HEALTH_EXPLANATION_CONTRACT_VERSION;
  validatorVersion: typeof BUSINESS_HEALTH_EXPLANATION_VALIDATOR_VERSION;
  fingerprint: string;
  generatedAt: string;
  analysis: BusinessHealthExplanationModelOutput;
  facts: BusinessHealthExplanationFacts;
  citations: readonly BusinessHealthCitationView[];
  providerAttribution: BusinessHealthProviderAttribution;
}>;

export type BusinessHealthExplanationViewArtifact = Omit<BusinessHealthExplanationArtifact, "providerAttribution">;

export type BusinessHealthAnalysisStatus =
  | "available"
  | "current"
  | "stale"
  | "loading"
  | "failed"
  | "unavailable"
  | "insufficient_evidence";

export type BusinessHealthAnalysisState = Readonly<{
  status: BusinessHealthAnalysisStatus;
  artifact: BusinessHealthExplanationViewArtifact | null;
  message: string | null;
}>;
