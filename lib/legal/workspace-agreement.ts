import { LEGAL_DOCUMENT_VERSIONS } from "@/lib/legal/content";

export const WORKSPACE_AGREEMENT_VERSION = "2026-07-25.1";
export const WORKSPACE_AGREEMENT_RECORD_CLASS = "legal_agreement" as const;
export const WORKSPACE_AGREEMENT_STORAGE_BUCKET = "workspace-agreements";

export const BUSINESS_TYPE_SUGGESTIONS = [
  "Retail",
  "Restaurant",
  "Construction",
  "Healthcare",
  "Logistics",
  "Manufacturing",
  "Professional Services",
  "Software",
  "Automotive",
  "Government",
  "Security",
  "Education"
] as const;

export const WORKSPACE_AGREEMENT_ELIGIBILITY = {
  business_memory_eligible: false,
  evidence_eligible: false,
  embedding_eligible: false,
  executive_intelligence_eligible: false,
  retrieval_eligible: false
} as const;

export const WORKSPACE_AGREEMENT_SECTIONS = [
  {
    id: "authority",
    title: "Authority",
    text: "I confirm that I am authorized to create and administer this workspace and to upload, connect, manage, and process information for this organization.",
    details: []
  },
  {
    id: "information_processing",
    title: "Information Processing",
    text: "I authorize Vaeroex to securely receive, store, organize, retrieve, index, analyze, and process information submitted to this workspace in order to provide Executive Intelligence and related platform functionality.",
    details: [
      "Documents",
      "Reports",
      "Spreadsheets",
      "Business Notes",
      "Connected-system data",
      "Operational information"
    ]
  },
  {
    id: "ai_decision_support",
    title: "AI Decision Support",
    text: "I understand that Vaeroex provides decision-support tools only. AI-generated summaries, explanations, classifications, predictions, recommendations, perspectives, and analyses may be incomplete or inaccurate and must always be reviewed using human judgment.",
    details: [
      "Vaeroex is not legal, accounting, financial, tax, employment, cybersecurity, regulatory, medical, or professional advice."
    ]
  },
  {
    id: "business_responsibility",
    title: "Business Responsibility",
    text: "I understand that Vaeroex does not guarantee business outcomes including profitability, compliance, growth, operational performance, cost savings, security, or any specific result. My organization remains responsible for all business decisions and actions.",
    details: []
  },
  {
    id: "terms",
    title: "Terms",
    text: "I have read and agree to the Terms of Service and Privacy Policy.",
    details: []
  }
] as const;

export const WORKSPACE_AGREEMENT_SIGNATURE_INTENT =
  "By typing my name and selecting Create Workspace, I intend to electronically sign this Workspace Agreement.";

export const WORKSPACE_AGREEMENT_POLICY_VERSIONS = {
  terms: LEGAL_DOCUMENT_VERSIONS.terms,
  privacy: LEGAL_DOCUMENT_VERSIONS.privacy
} as const;

export function workspaceAgreementExactText() {
  const sections = WORKSPACE_AGREEMENT_SECTIONS.map((section) => {
    const details = section.details.length ? `\n${section.details.map((detail) => `- ${detail}`).join("\n")}` : "";
    return `${section.title}\n${section.text}${details}`;
  }).join("\n\n");

  return `${sections}\n\nElectronic Signature\n${WORKSPACE_AGREEMENT_SIGNATURE_INTENT}`;
}

export function normalizeLegalName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function signatureReasonablyMatches(ownerLegalName: string, typedSignature: string) {
  const owner = normalizeLegalName(ownerLegalName);
  const signature = normalizeLegalName(typedSignature);
  return owner.length >= 3 && owner === signature;
}

export type WorkspaceAgreementSection = (typeof WORKSPACE_AGREEMENT_SECTIONS)[number];

export type WorkspaceAgreementSnapshot = {
  agreementId: string;
  workspaceId: string;
  agreementVersion: string;
  termsVersion: string;
  privacyVersion: string;
  organizationName: string;
  owner: {
    legalName: string;
    jobTitle: string;
    businessEmail: string;
  };
  businessType: string;
  teamSize: string | null;
  numberOfLocations: string | null;
  agreementText: string;
  sections: Array<{
    id: string;
    title: string;
    text: string;
    details: string[];
  }>;
  signatureIntent: string;
  typedSignature: string;
  signedAt: string;
  authenticatedUserId: string;
  applicationVersion: string;
  recordClass: typeof WORKSPACE_AGREEMENT_RECORD_CLASS;
  eligibility: typeof WORKSPACE_AGREEMENT_ELIGIBILITY;
};
