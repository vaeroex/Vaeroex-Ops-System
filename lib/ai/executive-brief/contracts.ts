import type { EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";

export const EXECUTIVE_BRIEF_CONTRACT_ID = "executive_brief_v1" as const;
export const EXECUTIVE_BRIEF_CONTRACT_VERSION = "executive_brief_v1" as const;
export const EXECUTIVE_BRIEF_VALIDATOR_VERSION = "executive_brief_validator_v1" as const;

export const EXECUTIVE_BRIEF_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "executive_summary",
    "why_it_matters",
    "primary_concern",
    "positive_signal",
    "leadership_focus",
    "uncertainty",
    "provisional_hypothesis"
  ],
  properties: {
    executive_summary: { type: "string" },
    why_it_matters: { type: "string" },
    primary_concern: { type: ["string", "null"] },
    positive_signal: { type: ["string", "null"] },
    leadership_focus: { type: "string" },
    uncertainty: { type: "string" },
    provisional_hypothesis: { type: ["string", "null"] }
  }
} as const;

export type ExecutiveBriefSubmode =
  | "healthy_improving"
  | "healthy_slowing"
  | "stable"
  | "negative_recovering"
  | "negative_worsening"
  | "conflicting_evidence"
  | "evidence_sparse"
  | "evidence_stale"
  | "insufficient_evidence";

export type ExecutiveBriefConfidence = "High" | "Medium" | "Low";
export type ExecutiveBriefFreshness = "current" | "stale" | "unavailable";
export type ExecutiveBriefSignalRole = "primary_concern" | "positive_signal" | "leadership_focus" | "context";

export type ExecutiveBriefModelOutput = Readonly<{
  executive_summary: string;
  why_it_matters: string;
  primary_concern: string | null;
  positive_signal: string | null;
  leadership_focus: string;
  uncertainty: string;
  provisional_hypothesis: string | null;
}>;

export type ExecutiveBriefSignal = Readonly<{
  ordinal: number;
  stableKey: string;
  roles: readonly ExecutiveBriefSignalRole[];
  classification: "risk" | "opportunity" | "neutral";
  domain: string;
  label: string;
  approvedFact: string;
  approvedLeadershipFocus: string | null;
  coverageTerms: readonly string[];
  citationIds: readonly number[];
}>;

export type ExecutiveBriefMaterialChange = Readonly<{
  stableKey: string;
  label: string;
  fact: string;
  direction: "positive" | "negative" | "neutral";
}>;

export type ExecutiveBriefFacts = Readonly<{
  available: boolean;
  businessHealth: Readonly<{
    score: number | null;
    status: string;
    trajectory: string | null;
    comparisonDelta: number | null;
  }>;
  materialChanges: readonly ExecutiveBriefMaterialChange[];
  confidence: ExecutiveBriefConfidence;
  freshness: ExecutiveBriefFreshness;
  latestEvidenceAt: string | null;
  independentSourceCount: number;
  limitations: readonly string[];
  deterministicReadout: readonly string[];
}>;

export type ExecutiveBriefPermittedRelationship = Readonly<{
  signalOrdinals: readonly [number, number];
  statement: string;
}>;

export type ExecutiveBriefCitationView = Readonly<{
  citationId: number;
  title: string;
  sourceLabel: string;
  sourceType: string;
  excerpt: string;
  recordedAt: string | null;
}>;

export type ExecutiveBriefPackage = Readonly<{
  contractId: typeof EXECUTIVE_BRIEF_CONTRACT_ID;
  contractVersion: typeof EXECUTIVE_BRIEF_CONTRACT_VERSION;
  validatorVersion: typeof EXECUTIVE_BRIEF_VALIDATOR_VERSION;
  fingerprint: string;
  submode: ExecutiveBriefSubmode;
  facts: ExecutiveBriefFacts;
  signals: readonly ExecutiveBriefSignal[];
  manifest: EvidenceManifest;
  requiredSignalOrdinals: readonly number[];
  primaryConcernOrdinal: number | null;
  positiveSignalOrdinal: number | null;
  leadershipFocusOrdinals: readonly number[];
  permittedRelationships: readonly ExecutiveBriefPermittedRelationship[];
  permittedHypothesis: string | null;
  requiredCitationIds: readonly number[];
  citations: readonly ExecutiveBriefCitationView[];
}>;

export type ExecutiveBriefProviderAttribution = Readonly<{
  provider: "openai" | "nvidia";
  model: string;
  fallbackUsed: boolean;
  providerPolicyId: string;
}>;

export type ExecutiveBriefArtifact = Readonly<{
  contractId: typeof EXECUTIVE_BRIEF_CONTRACT_ID;
  contractVersion: typeof EXECUTIVE_BRIEF_CONTRACT_VERSION;
  validatorVersion: typeof EXECUTIVE_BRIEF_VALIDATOR_VERSION;
  fingerprint: string;
  generatedAt: string;
  analysis: ExecutiveBriefModelOutput;
  facts: ExecutiveBriefFacts;
  signals: readonly ExecutiveBriefSignal[];
  citations: readonly ExecutiveBriefCitationView[];
  providerAttribution: ExecutiveBriefProviderAttribution;
}>;

export type ExecutiveBriefViewArtifact = Omit<ExecutiveBriefArtifact, "providerAttribution">;

export type ExecutiveBriefStatus =
  | "available"
  | "current"
  | "stale"
  | "loading"
  | "failed"
  | "unavailable"
  | "insufficient_evidence";

export type ExecutiveBriefState = Readonly<{
  status: ExecutiveBriefStatus;
  artifact: ExecutiveBriefViewArtifact | null;
  message: string | null;
}>;
