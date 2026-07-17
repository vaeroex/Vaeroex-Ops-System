export type GlobalSearchGroupLabel =
  | "KPIs"
  | "Reports"
  | "Files"
  | "Issues"
  | "Business Signals"
  | "Review Signals"
  | "Customer Evidence"
  | "SOPs"
  | "Checklists"
  | "People"
  | "Learned Knowledge"
  | "Diagnostics";

export type GlobalSearchResult = {
  id: string;
  title: string;
  sourceType: string;
  preview: string;
  href: string;
  meta?: string;
};

export type GlobalSearchGroup = {
  label: GlobalSearchGroupLabel;
  results: GlobalSearchResult[];
};

export type GlobalSearchDestination = {
  label: string;
  href: string;
  context?: string;
};

export type ExecutiveConfidence = "High" | "Medium" | "Low" | "Insufficient";

export type ExecutiveEvidenceReference = {
  citationId: number;
  title: string;
  sourceType: string;
  support: string;
};

export type ExecutiveIntelligenceBriefing = {
  executiveSummary: string;
  keyFindings: Array<{
    finding: string;
    businessImpact: string;
    confidence: ExecutiveConfidence;
    evidence: ExecutiveEvidenceReference[];
  }>;
  rootCauseAnalysis: Array<{
    finding: string;
    analysis: string;
    status: "Supported" | "Possible" | "Not established";
    evidence: ExecutiveEvidenceReference[];
  }>;
  businessImpact: {
    financial: string;
    operational: string;
    customer: string;
    strategic: string;
    ifIgnored: string;
  };
  recommendedActions: Array<{
    action: string;
    priority: "Critical" | "High" | "Medium" | "Low";
    expectedBusinessImpact: string;
    urgency: string;
    expectedOutcome: string;
    timeHorizon: "Immediate" | "30 Days" | "90 Days" | "Long-Term";
    confidence: ExecutiveConfidence;
    whyPrioritized: string;
    evidence: ExecutiveEvidenceReference[];
  }>;
  supportingEvidence: Array<{
    category: "KPIs" | "Business Memory" | "Reports" | "Documents" | "Historical Trends";
    items: ExecutiveEvidenceReference[];
  }>;
  confidenceAssessment: {
    level: ExecutiveConfidence;
    explanation: string;
    supportingSourceCount: number;
    evidenceAgreement: "Aligned" | "Mixed" | "Conflicting" | "Insufficient";
    conflicts: string[];
    uncertainty: string[];
  };
  missingInformation: string[];
  leadershipBrief: {
    priorities: string[];
    firstLeadershipMeeting: string;
    biggestDecision: string;
    biggestOpportunity: string;
    biggestUnknown: string;
  };
};

export type GlobalSearchAnswer = {
  kind: "business_answer" | "navigation_answer" | "security_response";
  directAnswer: string;
  recommendationConfidence?: ExecutiveConfidence;
  evidenceNote?: string;
  relevantDestinations?: GlobalSearchDestination[];
  executiveBriefing?: ExecutiveIntelligenceBriefing;
};

export type GlobalSearchResponse = {
  query: string;
  groups: GlobalSearchGroup[];
  answer?: GlobalSearchAnswer | null;
};
