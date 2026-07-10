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
  | "Business Memory";

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

export type GlobalSearchAnswer = {
  kind: "business_answer" | "navigation_answer" | "security_response";
  directAnswer: string;
  recommendationConfidence?: "High" | "Medium" | "Low" | "Insufficient";
  evidenceNote?: string;
  relevantDestinations?: GlobalSearchDestination[];
};

export type GlobalSearchResponse = {
  query: string;
  groups: GlobalSearchGroup[];
  answer?: GlobalSearchAnswer | null;
};
