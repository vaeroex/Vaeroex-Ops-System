const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const route = read("app/api/search/route.ts");
const workflow = read("lib/ai/vaeroex-workflows.ts");
const outputContracts = read("lib/ai/output-contracts.ts");
const reasoning = read("lib/ai/executive-intelligence.ts");
const renderer = read("components/app/ExecutiveIntelligenceAnswer.tsx");
const globalSearch = read("components/app/GlobalSearch.tsx");
const queryPlanner = read("lib/ai/query-depth-planner.ts");
const client = read("lib/ai/vaeroex-client.ts");

assert.match(route, /getVaeroexWorkflow\("executive_intelligence"\)/, "generated Search or Ask answers must use the executive workflow");
assert.match(route, /buildExecutiveReasoningContext/, "Search or Ask must build the explicit reasoning manifest before generation");
assert.match(route, /outputValidator:\s*\(value\) => validateExecutiveEvidenceReferences/, "executive citations and source independence must be validated inside the provider contract");
assert.match(route, /explicit_reasoning_stage:\s*true/, "usage telemetry must record the executive reasoning path without recording its content");
assert.match(route, /runVaeroexCompletionWithUsage/, "executive reasoning must remain behind the provider-neutral Vaeroex client");
assert.match(client, /runStructuredAI/, "the Vaeroex client must continue to use the provider manager");
assert.match(workflow, /reasoning_must_precede_writing|Complete all five reasoning stages before writing executive_summary/, "the workflow must reason before it writes");
assert.match(workflow, /what_is_happening[\s\S]*why_it_is_happening[\s\S]*why_leadership_should_care[\s\S]*what_should_happen_next[\s\S]*priority_logic/, "the five executive reasoning decisions must be explicit and ordered");
assert.match(outputContracts, /workflow === "executive_intelligence"/, "executive responses must use a dedicated structured contract");
assert.match(reasoning, /businessImpact \* 0\.3[\s\S]*confidence \* 0\.25[\s\S]*freshness \* 0\.15[\s\S]*directRelevance \* 0\.25[\s\S]*historicalImportance \* 0\.05/, "evidence ranking must use all required factors");
assert.match(reasoning, /business_memory_is_supporting_context_not_an_independent_source:\s*true/, "Business Memory must not inflate independent-source confidence");
assert.match(reasoning, /derived_reports_cannot_establish_current_business_facts:\s*true/, "derived reports must not establish new business facts");
assert.match(queryPlanner, /EXECUTIVE_LEADERSHIP_DOMAINS/, "broad executive questions must load bounded cross-business domains");
assert.match(globalSearch, /answer\.executiveBriefing/, "the Search or Ask UI must recognize structured executive answers");
assert.match(globalSearch, /<ExecutiveIntelligenceAnswer/, "the Search or Ask UI must render the executive briefing component");
assert.doesNotMatch(renderer, /reasoning_stage|what_is_happening|priority_logic/, "the internal reasoning stage must never be exposed in the UI");

for (const heading of [
  "Executive Summary",
  "Key Findings",
  "Root Cause Analysis",
  "Business Impact",
  "Recommended Actions",
  "Supporting Evidence",
  "Confidence Assessment",
  "Leadership Brief"
]) {
  assert.match(renderer, new RegExp(heading), `${heading} must be rendered`);
}

const {
  executiveAnswerFromOutput,
  validateExecutiveEvidenceReferences,
  validateExecutiveIntelligenceContract
} = require("../lib/ai/executive-output.ts");
const { rankExecutiveEvidence } = require("../lib/ai/executive-intelligence.ts");
const { planVaeroexQuery } = require("../lib/ai/query-depth-planner.ts");

const ref = (citationId, support = `Citation ${citationId} supports this conclusion.`) => ({
  citation_id: citationId,
  support
});

const validOutput = {
  title: "Executive performance brief",
  reasoning_stage: {
    what_is_happening: [
      { finding_id: "F1", conclusion: "Revenue and inventory are moving in opposite directions.", evidence_references: [ref(1), ref(2)] }
    ],
    why_it_is_happening: [
      { cause_id: "C1", conclusion: "Demand and inventory movement are no longer aligned.", status: "Supported", evidence_references: [ref(1), ref(2)] }
    ],
    why_leadership_should_care: {
      conclusion: "The relationship may constrain cash and operating flexibility.",
      evidence_references: [ref(1), ref(2)]
    },
    what_should_happen_next: [
      { action_id: "A1", action: "Review inventory commitments against current demand.", evidence_references: [ref(2)] },
      { action_id: "A2", action: "Confirm the revenue trend with the latest transaction period.", evidence_references: [ref(1)] },
      { action_id: "A3", action: "Resolve the conflicting customer signal before changing the plan.", evidence_references: [ref(3)] }
    ],
    priority_logic: {
      ordered_action_ids: ["A1", "A2", "A3"],
      explanation: "Inventory exposure comes first because it is the most immediate verified operating constraint."
    }
  },
  executive_summary: "Inventory growth is outpacing current revenue movement, making inventory exposure the first leadership concern.",
  key_findings: [
    { reasoning_finding_id: "F1", finding: "Inventory and revenue are moving out of alignment.", business_impact: "Working capital flexibility may narrow.", confidence: "High", evidence_references: [ref(1), ref(2)] }
  ],
  root_cause_analysis: [
    { reasoning_cause_id: "C1", finding: "Demand and inventory movement are misaligned.", analysis: "Two independent sources support the relationship, but no unsupported financial amount is inferred.", status: "Supported", evidence_references: [ref(1), ref(2)] }
  ],
  business_impact: {
    financial: "The amount is not established, but more cash may remain committed to inventory.",
    operational: "Inventory decisions may lag demand changes.",
    customer: "Customer impact is not established from current evidence.",
    strategic: "Leadership has less flexibility if the pattern persists.",
    if_ignored: "The verified inventory exposure may continue while the revenue trend remains unresolved.",
    evidence_references: [ref(1), ref(2)]
  },
  recommended_actions: [
    { reasoning_action_id: "A1", action: "Review inventory commitments against current demand.", priority: "Critical", expected_business_impact: "Reduce avoidable inventory exposure.", urgency: "The inventory signal is current.", expected_outcome: "A demand-aligned inventory decision.", time_horizon: "Immediate", confidence: "High", why_prioritized: "This addresses the most immediate verified exposure.", evidence_references: [ref(2)] },
    { reasoning_action_id: "A2", action: "Confirm the revenue trend with the latest transaction period.", priority: "High", expected_business_impact: "Improve confidence in the demand decision.", urgency: "The decision depends on current demand.", expected_outcome: "A current revenue baseline.", time_horizon: "30 Days", confidence: "Medium", why_prioritized: "This verifies whether the pattern is persisting.", evidence_references: [ref(1)] },
    { reasoning_action_id: "A3", action: "Resolve the conflicting customer signal before changing the plan.", priority: "Medium", expected_business_impact: "Avoid acting on incomplete customer context.", urgency: "The conflict limits certainty.", expected_outcome: "A clearer customer-demand interpretation.", time_horizon: "30 Days", confidence: "Medium", why_prioritized: "It improves the next decision without displacing the immediate inventory review.", evidence_references: [ref(3)] }
  ],
  supporting_evidence: {
    kpis: [ref(1)],
    business_memory: [ref(4)],
    reports: [ref(5)],
    documents: [ref(2)],
    historical_trends: [ref(3)]
  },
  confidence_assessment: {
    level: "High",
    explanation: "Three independent original sources align on the operating pattern.",
    supporting_source_count: 3,
    evidence_agreement: "Aligned",
    conflicts: [],
    uncertainty: []
  },
  missing_information: [],
  leadership_brief: {
    priorities: ["Review inventory exposure.", "Confirm current revenue movement.", "Resolve the customer evidence conflict."],
    first_leadership_meeting: "The first leadership meeting should focus on inventory commitments and current demand.",
    biggest_decision: "The biggest decision that cannot wait is whether inventory commitments should change.",
    biggest_opportunity: "The biggest opportunity this week is restoring alignment between demand and inventory.",
    biggest_unknown: "The biggest unknown preventing a better decision is the unresolved customer-demand signal."
  }
};

const catalog = [
  { citationId: 1, title: "Revenue KPI", sourceType: "KPI", independentSourceKey: "kpi:1", evidenceRole: "original" },
  { citationId: 2, title: "Inventory workbook", sourceType: "Document", independentSourceKey: "file:2", evidenceRole: "original" },
  { citationId: 3, title: "Customer history", sourceType: "Historical trend", independentSourceKey: "customer:3", evidenceRole: "original" },
  { citationId: 4, title: "Learned context", sourceType: "Business Memory", independentSourceKey: null, evidenceRole: "supporting" },
  { citationId: 5, title: "Prior briefing", sourceType: "Report", independentSourceKey: null, evidenceRole: "derived" }
];

assert.equal(validateExecutiveIntelligenceContract(validOutput).ok, true, "a complete reason-first executive response must satisfy the contract");
assert.equal(validateExecutiveEvidenceReferences(validOutput, catalog).ok, true, "bounded citations and independent sources must validate");

const summaryBeforeReasoning = {
  title: validOutput.title,
  executive_summary: validOutput.executive_summary,
  reasoning_stage: validOutput.reasoning_stage,
  ...Object.fromEntries(Object.entries(validOutput).filter(([key]) => !["title", "executive_summary", "reasoning_stage"].includes(key)))
};
assert.equal(validateExecutiveIntelligenceContract(summaryBeforeReasoning).ok, false, "the response must not be written before the reasoning stage");

const unreasonedFinding = structuredClone(validOutput);
unreasonedFinding.key_findings[0].reasoning_finding_id = "F2";
assert.equal(validateExecutiveIntelligenceContract(unreasonedFinding).ok, false, "visible findings must be produced by the reasoning stage");

const missingConfidenceInput = structuredClone(validOutput);
missingConfidenceInput.confidence_assessment.level = "Low";
missingConfidenceInput.missing_information = [];
assert.equal(validateExecutiveIntelligenceContract(missingConfidenceInput).ok, false, "low confidence must identify missing information");

const sameSourceCatalog = catalog.map((item) => item.citationId <= 3 ? { ...item, independentSourceKey: "file:one" } : item);
assert.equal(validateExecutiveEvidenceReferences(validOutput, sameSourceCatalog).ok, false, "multiple records from one source must not establish a root cause");

const conflicting = structuredClone(validOutput);
conflicting.confidence_assessment.evidence_agreement = "Conflicting";
conflicting.confidence_assessment.conflicts = ["Revenue and customer evidence point in different directions."];
const conflictingAnswer = executiveAnswerFromOutput({
  output: conflicting,
  catalog,
  fallback: { kind: "business_answer", directAnswer: "Fallback" }
});
assert.equal(conflictingAnswer.recommendationConfidence, "Medium", "conflicting evidence must cap recommendation confidence below High");
assert.deepEqual(conflictingAnswer.executiveBriefing.confidenceAssessment.conflicts, conflicting.confidence_assessment.conflicts, "evidence conflicts must remain visible");
assert.equal(conflictingAnswer.executiveBriefing.keyFindings[0].confidence, "Medium", "finding confidence must reflect only the independent sources cited by that finding");
assert.equal(conflictingAnswer.executiveBriefing.recommendedActions[0].confidence, "Low", "action confidence must reflect only the independent sources cited by that action");
assert.equal("reasoningStage" in conflictingAnswer.executiveBriefing, false, "internal reasoning must not be returned to the UI");

const now = new Date().toISOString();
const ranked = rankExecutiveEvidence([
  { key: "operations-current", domain: "operations", title: "Current margin risk", sourceType: "Metric", excerpt: "Margin and cash risk increased this month.", sourceId: null, sourceFileId: null, independentSourceKey: "one", evidenceRole: "original", confidenceScore: 90, recordedAt: now },
  { key: "operations-second", domain: "operations", title: "Inventory growth", sourceType: "Metric", excerpt: "Inventory increased while sales declined.", sourceId: null, sourceFileId: null, independentSourceKey: "two", evidenceRole: "original", confidenceScore: 85, recordedAt: now },
  { key: "operations-third", domain: "operations", title: "Another operations record", sourceType: "Metric", excerpt: "Current operating record.", sourceId: null, sourceFileId: null, independentSourceKey: "three", evidenceRole: "original", confidenceScore: 80, recordedAt: now },
  { key: "customers", domain: "customers", title: "Customer complaints", sourceType: "Document", excerpt: "Customer complaints increased this quarter.", sourceId: null, sourceFileId: null, independentSourceKey: "four", evidenceRole: "original", confidenceScore: 75, recordedAt: now },
  { key: "stale", domain: "reports", title: "Old note", sourceType: "Report", excerpt: "Unrelated note.", sourceId: null, sourceFileId: null, independentSourceKey: null, evidenceRole: "derived", confidenceScore: 20, recordedAt: "2020-01-01T00:00:00.000Z" }
], "Why are margin and customer complaints changing?", 3);
assert.equal(ranked.length, 3, "ranked evidence must respect its bounded limit");
assert.equal(ranked[0].key, "operations-current", "high-impact, current, relevant evidence must rank first");
assert.ok(ranked.some((item) => item.domain === "customers"), "representative ranking must preserve cross-domain evidence");
assert.ok(ranked.every((item) => Number.isFinite(item.rankScore)), "every evidence item must receive a deterministic rank score");

const executivePlan = planVaeroexQuery({ query: "What should leadership focus on this week?" });
assert.equal(executivePlan.classification, "cross_business_reasoning", "explicit leadership questions must use bounded cross-business reasoning");
for (const domain of ["kpis", "financials", "operations", "customers", "people", "risks", "reports", "files", "business_memory", "business_signals"]) {
  assert.ok(executivePlan.domains.includes(domain), `executive reasoning must include the bounded ${domain} domain`);
}

const navigationPlan = planVaeroexQuery({ query: "Show the revenue KPI" });
assert.equal(navigationPlan.classification, "search_navigation", "record navigation must remain deterministic search");
assert.equal(navigationPlan.requiresOpenAI, false, "navigation must not invoke executive generation");

const kpiPlan = planVaeroexQuery({ query: "Give me a KPI overview" });
assert.equal(kpiPlan.classification, "structured_answer", "simple KPI overviews must remain on the direct structured path");
assert.equal(kpiPlan.requiresOpenAI, false, "simple KPI overviews must not invoke the cross-business engine");

console.log("Executive Intelligence regression tests passed.");
