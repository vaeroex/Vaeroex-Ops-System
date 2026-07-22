export type VaeroexQueryClass =
  | "search_navigation"
  | "structured_answer"
  | "focused_explanation"
  | "cross_business_reasoning"
  | "unsupported"
  | "security_sensitive";

export type VaeroexEvidenceDomain =
  | "kpis"
  | "business_health"
  | "risks"
  | "priorities"
  | "reports"
  | "files"
  | "business_memory"
  | "financials"
  | "customers"
  | "operations"
  | "people"
  | "compliance"
  | "data_quality"
  | "decisions";

export type VaeroexModelTier = "none" | "current" | "focused" | "reasoning";

export type VaeroexQueryPlan = {
  classification: VaeroexQueryClass;
  tier: 1 | 2 | 3;
  domains: VaeroexEvidenceDomain[];
  retrievalDepth: "none" | "structured" | "focused" | "bounded_cross_domain";
  maxEvidenceChunks: number;
  requiresOpenAI: boolean;
  modelTier: VaeroexModelTier;
  timeoutMs: number;
  contextTokenBudget: number;
  fallback: "deterministic" | "focused_context" | "bounded_summary" | "insufficient_evidence" | "security_response";
  reason: string;
};

type PlanVaeroexQueryInput = {
  query: string;
  contextType?: string | null;
  hasSelectedContext?: boolean;
  securitySensitive?: boolean;
};

const DOMAIN_PATTERNS: Array<[VaeroexEvidenceDomain, RegExp]> = [
  ["kpis", /\b(kpi|kpis|metric|metrics|measurement|measurements|target|targets|performance indicator)\b/i],
  ["business_health", /\b(business health|health score|health trend|overall health)\b/i],
  ["risks", /\b(risk|risks|issue|issues|bottleneck|bottlenecks|anomaly|anomalies|warning|warnings|alert|alerts)\b/i],
  ["priorities", /\b(priority|priorities|focus|attention|most important|leadership review)\b/i],
  ["reports", /\b(report|reports|briefing|briefings|executive brief|board summary)\b/i],
  ["files", /\b(file|files|document|documents|spreadsheet|upload|uploads|source|sources)\b/i],
  ["business_memory", /\b(business memory|learned knowledge|historical context|workspace knowledge|evidence)\b/i],
  ["financials", /\b(revenue|profit|profitability|margin|cash|cost|costs|expense|expenses|financial|financials|invoice|invoices)\b/i],
  ["customers", /\b(customer|customers|retention|complaint|complaints|satisfaction|conversion|engagement|crm|salesforce|hubspot)\b/i],
  ["operations", /\b(operation|operations|operational|process|processes|delay|delays|throughput|inventory|service quality|department)\b/i],
  ["people", /\b(staff|staffing|employee|employees|people|headcount|labor|workforce)\b/i],
  ["compliance", /\b(compliance|policy|policies|regulation|regulations|sop|sops|procedure|procedures)\b/i],
  ["data_quality", /\b(data quality|freshness|stale|missing data|coverage|confidence|last updated)\b/i],
  ["decisions", /\b(decision|decisions|recommendation|recommendations|outcome|outcomes)\b/i]
];

const EXECUTIVE_LEADERSHIP_DOMAINS: VaeroexEvidenceDomain[] = [
  "kpis",
  "business_health",
  "financials",
  "operations",
  "customers",
  "people",
  "risks",
  "priorities",
  "reports",
  "files",
  "business_memory",
  "compliance",
  "data_quality",
  "decisions"
];

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}

function domainsFromContextType(contextType: string) {
  const normalized = contextType.toLowerCase();
  const domains: VaeroexEvidenceDomain[] = [];

  if (normalized.includes("kpi")) domains.push("kpis");
  if (normalized.includes("health")) domains.push("business_health");
  if (normalized.includes("risk") || normalized.includes("intelligence")) domains.push("risks");
  if (normalized.includes("briefing") || normalized.includes("report") || normalized.includes("generated_output")) domains.push("reports");
  if (normalized.includes("file") || normalized.includes("source")) domains.push("files");
  if (normalized.includes("memory") || normalized.includes("knowledge")) domains.push("business_memory");
  if (normalized.includes("signal")) domains.push("operations");

  return domains;
}

export function detectVaeroexEvidenceDomains(query: string, contextType = "") {
  const matched = DOMAIN_PATTERNS.filter(([, pattern]) => pattern.test(query)).map(([domain]) => domain);
  return unique([...domainsFromContextType(contextType), ...matched]);
}

function planFor(
  classification: VaeroexQueryClass,
  domains: VaeroexEvidenceDomain[],
  reason: string
): VaeroexQueryPlan {
  if (classification === "security_sensitive") {
    return {
      classification,
      tier: 1,
      domains: [],
      retrievalDepth: "none",
      maxEvidenceChunks: 0,
      requiresOpenAI: false,
      modelTier: "none",
      timeoutMs: 0,
      contextTokenBudget: 0,
      fallback: "security_response",
      reason
    };
  }

  if (classification === "search_navigation" || classification === "structured_answer") {
    return {
      classification,
      tier: 1,
      domains,
      retrievalDepth: classification === "search_navigation" ? "none" : "structured",
      maxEvidenceChunks: 0,
      requiresOpenAI: false,
      modelTier: "none",
      timeoutMs: 0,
      contextTokenBudget: 2_500,
      fallback: "deterministic",
      reason
    };
  }

  if (classification === "focused_explanation") {
    return {
      classification,
      tier: 2,
      domains,
      retrievalDepth: "focused",
      maxEvidenceChunks: 3,
      requiresOpenAI: true,
      modelTier: "focused",
      timeoutMs: 10_000,
      contextTokenBudget: 6_000,
      fallback: "focused_context",
      reason
    };
  }

  if (classification === "cross_business_reasoning") {
    return {
      classification,
      tier: 3,
      domains,
      retrievalDepth: "bounded_cross_domain",
      maxEvidenceChunks: 6,
      requiresOpenAI: true,
      modelTier: "reasoning",
      timeoutMs: 18_000,
      contextTokenBudget: 16_000,
      fallback: "bounded_summary",
      reason
    };
  }

  return {
    classification: "unsupported",
    tier: 1,
    domains,
    retrievalDepth: "none",
    maxEvidenceChunks: 0,
    requiresOpenAI: false,
    modelTier: "none",
    timeoutMs: 0,
    contextTokenBudget: 1_000,
    fallback: "insufficient_evidence",
    reason
  };
}

export function planVaeroexQuery({
  query,
  contextType = "",
  hasSelectedContext = false,
  securitySensitive = false
}: PlanVaeroexQueryInput): VaeroexQueryPlan {
  const normalized = query.replace(/\s+/g, " ").trim();
  const domains = detectVaeroexEvidenceDomains(normalized, contextType || "");

  if (securitySensitive) {
    return planFor("security_sensitive", [], "Security classification terminated the request before retrieval.");
  }

  if (!normalized) {
    return planFor("unsupported", domains, "No question was provided.");
  }

  if (contextType || hasSelectedContext) {
    return planFor("focused_explanation", domains.length ? domains : ["business_memory"], "The selected page item already defines the retrieval scope.");
  }

  const navigation = /^(show|find|open|take me to|go to|where (is|are)|locate)\b/i.test(normalized);
  const explanatory = /\b(why|explain|cause|caused|causing|relationship|related|affect|affected|impact|behind)\b/i.test(normalized);
  const crossDomainConnector = /\b(while|across|between|versus|vs\.?|and|but|despite)\b/i.test(normalized);
  const withinDomainComparison =
    (/\brevenue\b/i.test(normalized) && /\b(profit|profitability|margin|cost|costs|expense|expenses)\b/i.test(normalized)) ||
    (/\b(retention|satisfaction|conversion)\b/i.test(normalized) && /\b(response|complaint|engagement)\b/i.test(normalized));
  const explicitExecutiveQuestion =
    /\b(what should (i|we|leadership) (focus on|know|do)|what needs leadership attention|what can leadership (responsibly )?conclude|if you were leading|first leadership meeting|based on all available evidence|weakest evidence|executive (summary|briefing)|leadership (summary|briefing)|how (is|are) (my |our |the )?(business|company|organization|we) (doing|performing)|biggest (risk|opportunity|decision))\b/i.test(normalized);
  const broadLeadershipQuestion =
    explicitExecutiveQuestion ||
    (/\b(across the business|this week|overall|company-wide|organization-wide)\b/i.test(normalized) && /\b(focus|priority|risk|changed|summary|briefing)\b/i.test(normalized));
  const structured =
    (/\b(overview|status|current|latest|newest|components?|how many|count|counts|freshness|last updated|which .* need attention|alerts?|priorities|summary|summarize)\b/i.test(normalized) ||
      /\bhow (are|is) .*(kpi|kpis|metric|metrics|performance).*\b(doing|looking|performing)\b/i.test(normalized)) &&
    !explanatory;

  if (navigation && !explanatory) {
    return planFor("search_navigation", domains, "The request asks to locate or open a workspace record.");
  }

  if (broadLeadershipQuestion) {
    return planFor(
      "cross_business_reasoning",
      unique([...domains, ...EXECUTIVE_LEADERSHIP_DOMAINS]),
      "The question requires a bounded executive view across core business domains."
    );
  }

  if (explanatory && crossDomainConnector && (domains.length >= 2 || withinDomainComparison)) {
    return planFor("cross_business_reasoning", domains, "The question connects multiple business domains.");
  }

  if (structured && domains.length) {
    return planFor("structured_answer", domains, "Structured workspace records can answer the question without generation.");
  }

  if (explanatory && domains.length) {
    return planFor("focused_explanation", domains, "The question needs interpretation within a narrow business domain.");
  }

  if (domains.length >= 2) {
    return planFor("cross_business_reasoning", domains, "The question requires a bounded comparison across business domains.");
  }

  if (domains.length === 1) {
    return planFor("focused_explanation", domains, "The question can be answered with one bounded evidence domain.");
  }

  return planFor("unsupported", [], "The request does not identify enough workspace scope for a reliable answer.");
}
