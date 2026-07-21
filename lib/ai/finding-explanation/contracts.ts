import type { EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";

export const FINDING_EXPLANATION_CONTRACT_ID = "finding_explanation_v1" as const;
export const FINDING_EXPLANATION_CONTRACT_VERSION = "finding_explanation_v1" as const;
export const FINDING_EXPLANATION_VALIDATOR_VERSION = "finding_explanation_validator_v1" as const;

export const FINDING_EXPLANATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "what_happened",
    "why_evidence_suggests",
    "why_leadership_should_care",
    "investigate_next",
    "what_evidence_does_not_prove"
  ],
  properties: {
    what_happened: { type: "string", description: "A concise explanation of the development without repeating the supplied facts." },
    why_evidence_suggests: { type: "string", description: "A cautious explanation grounded only in the approved evidence basis." },
    why_leadership_should_care: { type: "string", description: "A concise explanation limited to the approved leadership relevance." },
    investigate_next: { type: "string", description: "A concise next investigation step limited to the approved investigation boundary." },
    what_evidence_does_not_prove: { type: "string", description: "A concise statement of the supplied limitation or missing evidence." }
  }
} as const;

export type FindingExplanationModelOutput = Readonly<{
  what_happened: string;
  why_evidence_suggests: string;
  why_leadership_should_care: string;
  investigate_next: string;
  what_evidence_does_not_prove: string;
}>;

export type FindingExplanationFacts = Readonly<{
  findingKey: string;
  findingType: string;
  title: string;
  priority: "High" | "Medium" | "Low";
  confidence: "High" | "Medium" | "Low";
  timePeriod: string;
  approvedDevelopment: string;
  approvedEvidenceBasis: string;
  approvedLeadershipRelevance: string;
  approvedInvestigationNext: string;
  approvedLimitations: readonly string[];
  freshness: "current" | "stale" | "unavailable";
  independentSourceCount: number;
}>;

export type FindingExplanationCitationView = Readonly<{
  citationId: number;
  title: string;
  sourceLabel: string;
  sourceType: string;
  excerpt: string;
  recordedAt: string | null;
}>;

export type FindingExplanationPackage = Readonly<{
  contractId: typeof FINDING_EXPLANATION_CONTRACT_ID;
  contractVersion: typeof FINDING_EXPLANATION_CONTRACT_VERSION;
  validatorVersion: typeof FINDING_EXPLANATION_VALIDATOR_VERSION;
  fingerprint: string;
  facts: FindingExplanationFacts;
  manifest: EvidenceManifest;
  requiredCitationIds: readonly number[];
  citations: readonly FindingExplanationCitationView[];
}>;

export type FindingExplanationArtifact = Readonly<{
  contractId: typeof FINDING_EXPLANATION_CONTRACT_ID;
  contractVersion: typeof FINDING_EXPLANATION_CONTRACT_VERSION;
  validatorVersion: typeof FINDING_EXPLANATION_VALIDATOR_VERSION;
  fingerprint: string;
  generatedAt: string;
  analysis: FindingExplanationModelOutput;
  facts: FindingExplanationFacts;
  citations: readonly FindingExplanationCitationView[];
  providerAttribution: Readonly<{
    provider: "openai" | "nvidia";
    model: string;
    fallbackUsed: boolean;
    providerPolicyId: string;
  }>;
}>;

export type FindingExplanationViewArtifact = Omit<FindingExplanationArtifact, "providerAttribution">;

export type FindingExplanationState = Readonly<{
  status: "available" | "current" | "loading" | "failed" | "unavailable" | "insufficient_evidence";
  artifact: FindingExplanationViewArtifact | null;
  message: string | null;
}>;
