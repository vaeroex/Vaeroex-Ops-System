import type { VaeroexQueryClass, VaeroexEvidenceDomain } from "@/lib/ai/query-depth-planner";

export type VaeroexAnswerBenchmarkFixture = {
  id: string;
  name: string;
  prompt: string;
  contextType?: string;
  hasSelectedContext?: boolean;
  expectedClass: VaeroexQueryClass;
  expectedDomains: VaeroexEvidenceDomain[];
  lowEvidence?: boolean;
  evidence: string[];
  deterministicAnswer: string;
  relevanceTerms: string[];
};

export const VAEROEX_ANSWER_BENCHMARK_FIXTURES: VaeroexAnswerBenchmarkFixture[] = [
  {
    id: "kpi-overview",
    name: "KPI overview",
    prompt: "How are my KPIs doing?",
    expectedClass: "structured_answer",
    expectedDomains: ["kpis"],
    evidence: ["Revenue: 112 against a target of 100", "Response time: 14 minutes against a target of 10 minutes"],
    deterministicAnswer: "Revenue is above target, while response time needs attention because it is four minutes slower than target.",
    relevanceTerms: ["revenue", "response time", "target"]
  },
  {
    id: "explain-kpi",
    name: "Explain one KPI",
    prompt: "Explain this KPI.",
    contextType: "kpi_detail",
    hasSelectedContext: true,
    expectedClass: "focused_explanation",
    expectedDomains: ["kpis"],
    evidence: ["Customer satisfaction is 86 against a target of 90", "The prior value was 88"],
    deterministicAnswer: "Customer satisfaction is below target and declined from its prior reading, so the current direction warrants attention.",
    relevanceTerms: ["customer satisfaction", "target", "declined"]
  },
  {
    id: "explain-risk",
    name: "Explain one risk",
    prompt: "Explain why this risk matters.",
    contextType: "intelligence_risk",
    hasSelectedContext: true,
    expectedClass: "focused_explanation",
    expectedDomains: ["risks"],
    evidence: ["Three weekly service reports show response delays", "The newest report was recorded two days ago"],
    deterministicAnswer: "Repeated response delays matter because the same condition appears in three recent service reports, making it more than a one-time event.",
    relevanceTerms: ["response delays", "three", "reports"]
  },
  {
    id: "explain-business-health",
    name: "Explain Business Health",
    prompt: "Explain this Business Health change.",
    contextType: "business_health_change",
    hasSelectedContext: true,
    expectedClass: "focused_explanation",
    expectedDomains: ["business_health"],
    evidence: ["Business Health moved from 72 to 68", "Two current KPIs moved below target"],
    deterministicAnswer: "Business Health declined by four points as two current KPIs moved below target.",
    relevanceTerms: ["business health", "four", "kpis"]
  },
  {
    id: "summarize-file",
    name: "Summarize one file",
    prompt: "Summarize this file for leadership.",
    contextType: "file",
    hasSelectedContext: true,
    expectedClass: "focused_explanation",
    expectedDomains: ["files"],
    evidence: ["The source is a monthly inventory report", "Eight items are below the stated reorder level"],
    deterministicAnswer: "The monthly inventory report shows eight items below their stated reorder levels.",
    relevanceTerms: ["inventory", "eight", "reorder"]
  },
  {
    id: "explain-briefing",
    name: "Explain one briefing",
    prompt: "Explain this briefing.",
    contextType: "briefing",
    hasSelectedContext: true,
    expectedClass: "focused_explanation",
    expectedDomains: ["reports"],
    evidence: ["The briefing identifies slower customer response as the leading risk", "It cites two reports and one KPI"],
    deterministicAnswer: "The briefing centers on slower customer response because two reports and one KPI support that risk.",
    relevanceTerms: ["customer response", "reports", "kpi"]
  },
  {
    id: "changed-this-week",
    name: "What changed this week",
    prompt: "What changed across the business this week?",
    expectedClass: "cross_business_reasoning",
    expectedDomains: ["risks", "priorities", "business_memory"],
    evidence: ["Revenue moved from 100 to 108", "Response time moved from 11 to 14 minutes", "A service report noted higher request volume"],
    deterministicAnswer: "Revenue improved this week, while response time slowed as request volume increased; the evidence does not establish whether volume was the only cause.",
    relevanceTerms: ["revenue", "response time", "request volume"]
  },
  {
    id: "revenue-profit",
    name: "Revenue up and profit down",
    prompt: "Why did revenue rise while profitability fell?",
    expectedClass: "cross_business_reasoning",
    expectedDomains: ["financials"],
    evidence: ["Revenue increased 9 percent", "Gross margin decreased 4 percentage points", "No cost-category detail is available"],
    deterministicAnswer: "Revenue rose while profitability fell because gross margin declined, but the available evidence does not show which costs caused the margin change.",
    relevanceTerms: ["revenue", "profitability", "margin"]
  },
  {
    id: "low-evidence",
    name: "Low-evidence question",
    prompt: "Explain why this source matters.",
    contextType: "file",
    hasSelectedContext: true,
    expectedClass: "focused_explanation",
    expectedDomains: ["files"],
    lowEvidence: true,
    evidence: ["The file title is Regional Notes", "No readable analysis summary is available"],
    deterministicAnswer: "This source cannot yet be interpreted reliably because it has no readable analysis summary.",
    relevanceTerms: ["source", "cannot", "summary"]
  },
  {
    id: "contradictory-evidence",
    name: "Contradictory evidence",
    prompt: "Why does the KPI show improvement while the weekly report says performance declined?",
    expectedClass: "cross_business_reasoning",
    expectedDomains: ["kpis", "reports"],
    evidence: ["The KPI increased from 81 to 86", "The weekly report says service performance declined", "The report does not identify the KPI or measurement period"],
    deterministicAnswer: "The KPI and report cannot be reconciled yet because the report does not identify the metric or period behind its decline statement.",
    relevanceTerms: ["kpi", "report", "period"]
  }
];

export const VAEROEX_ANSWER_QUALITY_RUBRIC = [
  "Directly answered the question",
  "Used relevant evidence",
  "Avoided unsupported claims",
  "Used plain executive language",
  "Stayed concise",
  "Clearly communicated uncertainty",
  "Suggested only evidence-supported next considerations"
] as const;
