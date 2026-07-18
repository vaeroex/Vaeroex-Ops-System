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
const fallbackSource = read("lib/ai/executive-fallback.ts");
const boundedContextSource = read("lib/ai/bounded-context.ts");
const renderer = read("components/app/ExecutiveIntelligenceAnswer.tsx");
const globalSearch = read("components/app/GlobalSearch.tsx");
const askResponse = read("components/app/AskVaeroexResponse.tsx");
const askWorkspace = read("components/app/AskVaeroexWorkspace.tsx");
const queryPlanner = read("lib/ai/query-depth-planner.ts");
const client = read("lib/ai/vaeroex-client.ts");

assert.match(route, /getVaeroexWorkflow\("executive_intelligence"\)/, "generated Search or Ask answers must use the executive workflow");
assert.match(route, /buildExecutiveReasoningContext/, "Search or Ask must build the explicit reasoning manifest before generation");
assert.match(route, /buildLimitedEvidenceExecutiveAnswer/, "zero-evidence and provider-failure paths must return a structured limited briefing");
assert.doesNotMatch(route, /buildDeterministicBoundedAnswer/, "executive generation must not return the legacy single-sentence fallback");
assert.match(route, /outputValidator:\s*\(value\) => validateExecutiveEvidenceReferences/, "executive citations and source independence must be validated inside the provider contract");
assert.match(route, /explicit_reasoning_stage:\s*true/, "usage telemetry must record the executive reasoning path without recording its content");
assert.match(route, /signal_candidate_count:\s*executiveReasoning\.signalSynthesis\.candidates\.length/, "usage telemetry must record bounded signal counts without logging signal content");
assert.match(route, /maxOutputTokens:\s*EXECUTIVE_CANONICAL_MAX_OUTPUT_TOKENS/, "interactive Executive Analysis must use the compact canonical output budget");
assert.match(route, /generationMode:\s*"interactive_executive"/, "interactive Executive Analysis must request its workflow-specific fast structured mode");
assert.match(route, /workspaceSnapshot:\s*executiveReasoning\.modelWorkspaceSnapshot/, "executive generation must receive the compact model snapshot instead of the full bounded workspace object");
assert.match(route, /maxInputTokens:\s*EXECUTIVE_INTERACTIVE_MAX_INPUT_TOKENS/, "interactive executive generation must enforce a hard input-token ceiling");
assert.doesNotMatch(route, /workspaceSnapshot:\s*boundedContext\.workspaceSnapshot/, "the full bounded retrieval result must never be serialized into the interactive model request");
assert.match(route, /runVaeroexCompletionWithUsage/, "executive reasoning must remain behind the provider-neutral Vaeroex client");
assert.match(client, /runStructuredAI/, "the Vaeroex client must continue to use the provider manager");
assert.match(workflow, /Complete analysis before executive_summary/i, "the workflow must reason before it writes");
assert.match(workflow, /evidence_sufficiency[\s\S]*findings[\s\S]*relationships[\s\S]*actions[\s\S]*uncertainty/, "the canonical executive reasoning decisions must be explicit and ordered");
assert.match(outputContracts, /workflow === "executive_intelligence"/, "executive responses must use a dedicated structured contract");
assert.match(workflow, /minimum distinct findings/, "the executive prompt must honor the deterministic multi-signal plan");
assert.match(workflow, /Include every required signal in executive_summary and summary_signal_ids/i, "the executive prompt must prevent dominant-signal collapse");
assert.match(reasoning, /businessImpact \* 0\.3[\s\S]*confidence \* 0\.25[\s\S]*freshness \* 0\.15[\s\S]*directRelevance \* 0\.25[\s\S]*historicalImportance \* 0\.05/, "evidence ranking must use all required factors");
assert.match(workflow, /Business Memory may support original evidence but is not an independent source/, "Business Memory must not inflate independent-source confidence");
assert.match(workflow, /Derived analysis cannot establish a new fact without eligible original lineage/, "derived reports must not establish new business facts");
assert.match(reasoning, /maximum_evidence_sufficiency/, "the reasoning manifest must cap evidence sufficiency before writing");
assert.match(reasoning, /maximum_finding_confidence/, "each signal must expose its own source-backed finding-confidence ceiling");
assert.match(workflow, /Each finding\.confidence must be at or below that signal's maximum_finding_confidence/i, "the model contract must apply signal-level confidence ceilings to every finding");
assert.match(workflow, /uncertainty contains plain strings, never objects[\s\S]*at least one string whenever evidence_sufficiency is not Sufficient/i, "the model contract must make limited-evidence uncertainty shape explicit");
assert.match(workflow, /systemInstructions:\s*executiveIntelligenceSystemInstructions/, "Executive Intelligence must use its compact workflow-specific system contract");
assert.equal((workflow.match(/systemInstructions:\s*executiveIntelligenceSystemInstructions/g) || []).length, 1, "prompt compaction must remain isolated to Executive Intelligence");
assert.match(client, /workflow\.systemInstructions\?\.trim\(\) \|\| VAEROEX_SYSTEM_PROMPT/, "other workflows must retain the existing base system prompt");
assert.match(client, /workflow\.key === "executive_intelligence"/, "only Executive Intelligence may omit duplicated user-level evidence policy");
assert.match(route, /userPrompt:\s*query/, "Executive Analysis must send the exact question without a repeated reasoning wrapper");
assert.doesNotMatch(route, /extraInputs:\s*\{\s*query_plan:/, "the request must not duplicate the query plan already represented in the reasoning manifest");
assert.match(boundedContextSource, /business_health_score_context/, "Business Health questions must receive the score context used by Vaeroex");
assert.match(boundedContextSource, /filterOriginalOrSourceBackedRows\(kpiData\.rows\)/, "bounded KPI evidence must exclude setup-only rows while preserving active source-backed observations");
assert.match(fallbackSource, /variant:\s*"limited"/, "sparse and failed generations must use the limited-evidence UI variant");
assert.match(queryPlanner, /EXECUTIVE_LEADERSHIP_DOMAINS/, "broad executive questions must load bounded cross-business domains");
assert.doesNotMatch(globalSearch, /ExecutiveIntelligenceAnswer|answer\.executiveBriefing/, "Global Search must not render Executive Intelligence answers");
assert.match(askResponse, /answer\.executiveBriefing/, "dedicated Ask must recognize structured executive answers");
assert.match(askResponse, /<ExecutiveIntelligenceAnswer/, "dedicated Ask must render the executive briefing component");
assert.match(askWorkspace, /<AskVaeroexResponse answer=\{answer\}/, "persistent Ask exchanges must use the validated answer renderer");
assert.doesNotMatch(renderer, /summary_signal_ids|signal_id|relationship_candidates/, "the canonical transport and manifest must never be exposed in the UI");

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
for (const heading of ["Evidence Readiness", "What Can Be Said", "Safe Next Actions", "Decisions To Defer", "Recommendation Confidence"]) {
  assert.match(renderer, new RegExp(heading), `${heading} must be available in the limited-evidence variant`);
}

const {
  EXECUTIVE_CANONICAL_MAX_OUTPUT_TOKENS,
  applyExecutiveConfidenceCeilings,
  executiveAnswerFromOutput,
  validateExecutiveEvidenceReferences,
  validateExecutiveIntelligenceContract
} = require("../lib/ai/executive-output.ts");
const {
  buildExecutiveReasoningContext,
  rankExecutiveEvidence,
  EXECUTIVE_COMPACT_CONTEXT_TARGET_TOKENS,
  EXECUTIVE_FOLLOW_UP_REQUEST_TARGET_TOKENS,
  EXECUTIVE_INITIAL_REQUEST_TARGET_TOKENS,
  EXECUTIVE_INTERACTIVE_MAX_INPUT_TOKENS
} = require("../lib/ai/executive-intelligence.ts");
const { buildLimitedEvidenceExecutiveAnswer } = require("../lib/ai/executive-fallback.ts");
const { buildBusinessHealthDecisionContext } = require("../lib/ai/business-health-context.ts");
const { planVaeroexQuery } = require("../lib/ai/query-depth-planner.ts");
const { estimateVaeroexCompletionRequest } = require("../lib/ai/vaeroex-client.ts");
const { getVaeroexWorkflow } = require("../lib/ai/vaeroex-workflows.ts");
const { estimateTokenCount } = require("../lib/ai/usage.ts");

const validOutput = {
  analysis: {
    evidence_sufficiency: "Sufficient",
    evidence_agreement: "Aligned",
    findings: [
      { id: "F1", signal_id: "S1", finding: "Revenue movement needs review.", impact: "Demand confidence may narrow.", confidence: "Low", citations: [1] },
      { id: "F2", signal_id: "S2", finding: "Inventory movement is a separate concern.", impact: "Operating flexibility may narrow.", confidence: "Low", citations: [2] },
      { id: "F3", signal_id: "S3", finding: "Customer activity adds a distinct signal.", impact: "The demand picture remains mixed.", confidence: "Low", citations: [3] }
    ],
    relationships: [
      { finding_ids: ["F1", "F2"], status: "Supported", assessment: "Revenue and inventory movement are not aligned.", citations: [1, 2] }
    ],
    actions: [
      { id: "A1", action: "Review inventory commitments.", priority: "Critical", why: "It addresses the clearest current exposure.", outcome: "A demand-aligned inventory decision.", horizon: "Immediate", citations: [2] },
      { id: "A2", action: "Confirm the revenue trend.", priority: "High", why: "It tests whether demand movement persists.", outcome: "A current revenue baseline.", horizon: "30 Days", citations: [1] },
      { id: "A3", action: "Resolve the customer signal.", priority: "Medium", why: "It improves the next demand decision.", outcome: "Clearer customer context.", horizon: "30 Days", citations: [3] }
    ],
    uncertainty: []
  },
  executive_summary: "Revenue movement, inventory exposure, and customer activity require a coordinated review, led by inventory commitments.",
  overall_confidence: "High",
  summary_signal_ids: ["S1", "S2", "S3"]
};

const catalog = [
  { citationId: 1, title: "Revenue KPI", sourceType: "KPI", support: "Revenue movement in the current period.", independentSourceKey: "kpi:1", evidenceRole: "original", freshnessScore: 100, directRelevanceScore: 90, signalId: "S1", domain: "financials", findingEligible: true, executiveRank: 1 },
  { citationId: 2, title: "Inventory workbook", sourceType: "Document", support: "Inventory movement in the current period.", independentSourceKey: "file:2", evidenceRole: "original", freshnessScore: 100, directRelevanceScore: 90, signalId: "S2", domain: "operations", findingEligible: true, executiveRank: 2 },
  { citationId: 3, title: "Customer history", sourceType: "Historical trend", support: "Customer activity changed in the current period.", independentSourceKey: "customer:3", evidenceRole: "original", freshnessScore: 80, directRelevanceScore: 75, signalId: "S3", domain: "customers", findingEligible: true, executiveRank: 3 },
  { citationId: 4, title: "Learned context", sourceType: "Business Memory", support: "Supporting learned context.", independentSourceKey: null, evidenceRole: "supporting", freshnessScore: 100, directRelevanceScore: 80, signalId: "S1", domain: "supporting", findingEligible: false, executiveRank: null },
  { citationId: 5, title: "Prior briefing", sourceType: "Report", support: "Prior derived analysis.", independentSourceKey: null, evidenceRole: "derived", freshnessScore: 100, directRelevanceScore: 70, signalId: null, domain: "reports", findingEligible: false, executiveRank: null }
];

assert.equal(validateExecutiveIntelligenceContract(validOutput).ok, true, "a complete reason-first executive response must satisfy the contract");
assert.equal(validateExecutiveEvidenceReferences(validOutput, catalog).ok, true, "bounded citations and independent sources must validate");
assert.deepEqual(Object.keys(validOutput), ["analysis", "executive_summary", "overall_confidence", "summary_signal_ids"], "the provider transport must contain only the compact canonical sections");
assert.ok(estimateTokenCount(JSON.stringify(validOutput)) <= EXECUTIVE_CANONICAL_MAX_OUTPUT_TOKENS, "a valid three-signal canonical response must fit its complete output budget without truncation");

function assertDiagnostic(result, reasonCode, stage) {
  assert.equal(result.ok, false, `${reasonCode} fixture must be rejected`);
  assert.equal(result.diagnostic?.reasonCode, reasonCode, `${reasonCode} must retain its safe reason code`);
  assert.equal(result.diagnostic?.stage, stage, `${reasonCode} must retain its validation stage`);
  assert.doesNotMatch(JSON.stringify(result.diagnostic), /Revenue movement|Inventory movement|Customer activity/, "diagnostics must not contain model output or evidence text");
}

assertDiagnostic(validateExecutiveIntelligenceContract(null), "root_not_object", "canonical_schema");
assertDiagnostic(validateExecutiveIntelligenceContract({}), "missing_analysis", "canonical_schema");
assertDiagnostic(validateExecutiveIntelligenceContract({ analysis: [] }), "invalid_analysis_shape", "canonical_schema");

const missingFindings = structuredClone(validOutput);
delete missingFindings.analysis.findings;
assertDiagnostic(validateExecutiveIntelligenceContract(missingFindings), "missing_findings", "canonical_schema");

const findingsNotArray = structuredClone(validOutput);
findingsNotArray.analysis.findings = {};
assertDiagnostic(validateExecutiveIntelligenceContract(findingsNotArray), "findings_not_array", "canonical_schema");

const noFindings = structuredClone(validOutput);
noFindings.analysis.findings = [];
assertDiagnostic(validateExecutiveIntelligenceContract(noFindings), "insufficient_required_findings", "canonical_schema");

const unknownSignal = structuredClone(validOutput);
unknownSignal.analysis.findings[0].signal_id = "not-a-signal";
assertDiagnostic(validateExecutiveIntelligenceContract(unknownSignal), "unknown_signal_id", "canonical_schema");

const duplicateSignal = structuredClone(validOutput);
duplicateSignal.analysis.findings[1].signal_id = "S1";
assertDiagnostic(validateExecutiveIntelligenceContract(duplicateSignal), "duplicate_signal_id", "canonical_schema");

const invalidRelationshipShape = structuredClone(validOutput);
invalidRelationshipShape.analysis.relationships = {};
assertDiagnostic(validateExecutiveIntelligenceContract(invalidRelationshipShape), "invalid_relationship", "canonical_schema");

const invalidActionShape = structuredClone(validOutput);
invalidActionShape.analysis.actions = [];
assertDiagnostic(validateExecutiveIntelligenceContract(invalidActionShape), "invalid_action", "canonical_schema");

const invalidCitationShape = structuredClone(validOutput);
invalidCitationShape.analysis.findings[0].citations = ["customer-evidence"];
assertDiagnostic(validateExecutiveIntelligenceContract(invalidCitationShape), "invalid_citation_id", "canonical_schema");

const noSummarySignals = structuredClone(validOutput);
delete noSummarySignals.summary_signal_ids;
assertDiagnostic(validateExecutiveIntelligenceContract(noSummarySignals), "missing_summary_signal_ids", "canonical_schema");

const invalidSummarySignals = structuredClone(validOutput);
invalidSummarySignals.summary_signal_ids = "S1";
assertDiagnostic(validateExecutiveIntelligenceContract(invalidSummarySignals), "invalid_summary_signal_ids", "canonical_schema");

const missingExecutiveSummary = structuredClone(validOutput);
missingExecutiveSummary.executive_summary = "";
assertDiagnostic(validateExecutiveIntelligenceContract(missingExecutiveSummary), "executive_summary_missing", "canonical_schema");

const invalidOverallConfidence = structuredClone(validOutput);
invalidOverallConfidence.overall_confidence = "Certain";
assertDiagnostic(validateExecutiveIntelligenceContract(invalidOverallConfidence), "invalid_overall_confidence", "confidence");

const invalidSufficiency = structuredClone(validOutput);
invalidSufficiency.analysis.evidence_sufficiency = "Enough";
assertDiagnostic(validateExecutiveIntelligenceContract(invalidSufficiency), "evidence_sufficiency_invalid", "canonical_schema");

const invalidAgreement = structuredClone(validOutput);
invalidAgreement.analysis.evidence_agreement = "Mostly";
assertDiagnostic(validateExecutiveIntelligenceContract(invalidAgreement), "agreement_invalid", "canonical_schema");

const invalidUncertainty = structuredClone(validOutput);
invalidUncertainty.analysis.uncertainty = "none";
assertDiagnostic(validateExecutiveIntelligenceContract(invalidUncertainty), "uncertainty_invalid", "canonical_schema");

const fieldTypeMismatch = structuredClone(validOutput);
fieldTypeMismatch.analysis.findings[0].finding = 42;
assertDiagnostic(validateExecutiveIntelligenceContract(fieldTypeMismatch), "schema_field_type_mismatch", "canonical_schema");

const truncatedOutput = structuredClone(validOutput);
delete truncatedOutput.summary_signal_ids;
assert.equal(validateExecutiveIntelligenceContract(truncatedOutput).ok, false, "truncated canonical JSON must never be accepted");
const extraTransportField = { ...validOutput, leadership_brief: { priorities: [] } };
assert.equal(validateExecutiveIntelligenceContract(extraTransportField).ok, false, "duplicated presentation fields must not re-enter the provider transport contract");

const signalAwareCatalog = catalog;
const multiSignalOutput = structuredClone(validOutput);
const threeSignalPolicy = {
  minimumDistinctFindings: 3,
  requiredSignalIds: ["S1", "S2", "S3"],
  requireCrossSignalAssessment: true,
  relationships: [{ leftSignalId: "S1", rightSignalId: "S2" }]
};
assert.equal(
  validateExecutiveEvidenceReferences(multiSignalOutput, signalAwareCatalog, threeSignalPolicy).ok,
  true,
  "three distinct supported signals must survive reasoning, synthesis, and visible output"
);

const incompleteExecutiveSummary = structuredClone(multiSignalOutput);
incompleteExecutiveSummary.summary_signal_ids = ["S1", "S2"];
assert.equal(
  validateExecutiveEvidenceReferences(incompleteExecutiveSummary, signalAwareCatalog, threeSignalPolicy).ok,
  false,
  "the executive summary must cover every required top-ranked signal"
);
assertDiagnostic(validateExecutiveEvidenceReferences(incompleteExecutiveSummary, signalAwareCatalog, threeSignalPolicy), "executive_summary_signal_coverage_failed", "ranked_signal_coverage");

const dominantSignalOnly = structuredClone(validOutput);
dominantSignalOnly.analysis.findings = dominantSignalOnly.analysis.findings.slice(0, 1);
dominantSignalOnly.analysis.relationships = [];
dominantSignalOnly.summary_signal_ids = ["S1"];
assert.equal(
  validateExecutiveEvidenceReferences(dominantSignalOnly, signalAwareCatalog, threeSignalPolicy).ok,
  false,
  "one dominant finding must not pass when three distinct supported signals are available"
);
assertDiagnostic(validateExecutiveEvidenceReferences(dominantSignalOnly, signalAwareCatalog, threeSignalPolicy), "insufficient_required_findings", "ranked_signal_coverage");

const repeatedSignal = structuredClone(multiSignalOutput);
repeatedSignal.analysis.findings[1].signal_id = "S1";
repeatedSignal.analysis.findings[1].citations = [1];
assert.equal(
  validateExecutiveEvidenceReferences(repeatedSignal, signalAwareCatalog, threeSignalPolicy).ok,
  false,
  "rephrasing one signal as several findings must not satisfy multi-signal coverage"
);

const outOfPriorityOrder = structuredClone(multiSignalOutput);
[outOfPriorityOrder.analysis.findings[0], outOfPriorityOrder.analysis.findings[1]] = [outOfPriorityOrder.analysis.findings[1], outOfPriorityOrder.analysis.findings[0]];
assert.equal(
  validateExecutiveEvidenceReferences(outOfPriorityOrder, signalAwareCatalog, threeSignalPolicy).ok,
  false,
  "visible findings must retain deterministic executive priority order"
);

const lowerPrioritySubstitutionCatalog = [
  ...signalAwareCatalog,
  { ...signalAwareCatalog[2], citationId: 6, title: "Lower-priority signal", signalId: "S4", executiveRank: 4 }
];
const lowerPrioritySubstitution = structuredClone(multiSignalOutput);
lowerPrioritySubstitution.analysis.findings[2].signal_id = "S4";
lowerPrioritySubstitution.analysis.findings[2].citations = [6];
assert.equal(
  validateExecutiveEvidenceReferences(lowerPrioritySubstitution, lowerPrioritySubstitutionCatalog, threeSignalPolicy).ok,
  false,
  "lower-priority signals must not displace a required higher-priority finding"
);

const unplannedRelationship = structuredClone(multiSignalOutput);
unplannedRelationship.analysis.relationships[0] = {
  finding_ids: ["F1", "F3"],
  status: "Possible",
  assessment: "Revenue and customer activity may move together.",
  citations: [1, 3]
};
assert.equal(
  validateExecutiveEvidenceReferences(unplannedRelationship, signalAwareCatalog, threeSignalPolicy).ok,
  false,
  "the model must not invent a relationship outside the deterministic signal plan"
);
assertDiagnostic(validateExecutiveEvidenceReferences(unplannedRelationship, signalAwareCatalog, threeSignalPolicy), "unsupported_relationship", "relationship_support");

const unknownCitationOutput = structuredClone(multiSignalOutput);
unknownCitationOutput.analysis.findings[0].citations = [999];
assertDiagnostic(validateExecutiveEvidenceReferences(unknownCitationOutput, signalAwareCatalog, threeSignalPolicy), "invalid_citation_id", "citation_provenance");

const excessiveFindingConfidence = structuredClone(multiSignalOutput);
excessiveFindingConfidence.analysis.findings[0].confidence = "High";
assertDiagnostic(validateExecutiveEvidenceReferences(excessiveFindingConfidence, signalAwareCatalog, threeSignalPolicy), "confidence_ceiling_exceeded", "confidence");

const mediumCeilingCatalog = signalAwareCatalog.map((entry) =>
  entry.citationId === 3 ? { ...entry, freshnessScore: 40 } : entry
);
const overconfidentCanonicalOutput = structuredClone(multiSignalOutput);
overconfidentCanonicalOutput.analysis.findings[0].confidence = "High";
const confidenceBoundedOutput = applyExecutiveConfidenceCeilings(overconfidentCanonicalOutput, mediumCeilingCatalog);
assert.equal(confidenceBoundedOutput.analysis.findings[0].confidence, "Low", "finding confidence must be lowered to its cited-source ceiling");
assert.equal(confidenceBoundedOutput.overall_confidence, "Medium", "overall confidence must be lowered to the current independent-source ceiling");
assert.deepEqual(confidenceBoundedOutput.analysis.findings[0].citations, overconfidentCanonicalOutput.analysis.findings[0].citations, "confidence normalization must preserve citations");
assert.deepEqual(confidenceBoundedOutput.summary_signal_ids, overconfidentCanonicalOutput.summary_signal_ids, "confidence normalization must preserve required signal coverage");
assert.deepEqual(confidenceBoundedOutput.analysis.relationships, overconfidentCanonicalOutput.analysis.relationships, "confidence normalization must preserve model-supported relationships");
assert.deepEqual(confidenceBoundedOutput.analysis.actions, overconfidentCanonicalOutput.analysis.actions, "confidence normalization must preserve generated actions");
assert.equal(confidenceBoundedOutput.analysis.uncertainty.length, 1, "a deterministic evidence limitation must keep lowered confidence contract-valid");
assert.equal(validateExecutiveIntelligenceContract(confidenceBoundedOutput).ok, true, "confidence-bounded output must remain canonical-contract valid");
assert.equal(
  validateExecutiveEvidenceReferences(confidenceBoundedOutput, mediumCeilingCatalog, threeSignalPolicy).ok,
  true,
  "deterministically bounded confidence must pass the unchanged contextual validator"
);
assert.deepEqual(applyExecutiveConfidenceCeilings(validOutput, catalog), validOutput, "already supported confidence must remain byte-for-byte equivalent as data");

const appendixInflation = structuredClone(validOutput);
appendixInflation.analysis.findings = appendixInflation.analysis.findings.slice(0, 1);
appendixInflation.analysis.relationships = [];
appendixInflation.analysis.actions = appendixInflation.analysis.actions.slice(0, 1);
appendixInflation.summary_signal_ids = ["S1"];
assert.equal(
  validateExecutiveEvidenceReferences(appendixInflation, catalog).ok,
  false,
  "unused catalog sources must not inflate briefing confidence"
);

const summaryBeforeReasoning = {
  executive_summary: validOutput.executive_summary,
  analysis: validOutput.analysis,
  overall_confidence: validOutput.overall_confidence,
  summary_signal_ids: validOutput.summary_signal_ids
};
assert.equal(validateExecutiveIntelligenceContract(summaryBeforeReasoning).ok, false, "the response must not be written before the reasoning stage");

const unreasonedFinding = structuredClone(validOutput);
unreasonedFinding.analysis.relationships[0].finding_ids = ["F1", "F9"];
assert.equal(validateExecutiveIntelligenceContract(unreasonedFinding).ok, false, "visible findings must be produced by the reasoning stage");

const missingConfidenceInput = structuredClone(validOutput);
missingConfidenceInput.overall_confidence = "Low";
missingConfidenceInput.analysis.uncertainty = [];
assert.equal(validateExecutiveIntelligenceContract(missingConfidenceInput).ok, false, "low confidence must identify missing information");

const sameSourceCatalog = catalog.map((item) => item.citationId <= 3 ? { ...item, independentSourceKey: "file:one" } : item);
assert.equal(validateExecutiveEvidenceReferences(validOutput, sameSourceCatalog).ok, false, "multiple records from one source must not establish a root cause");

const conflicting = structuredClone(validOutput);
conflicting.analysis.evidence_sufficiency = "Conflicting";
conflicting.analysis.evidence_agreement = "Conflicting";
conflicting.analysis.uncertainty = ["Revenue and customer evidence point in different directions."];
conflicting.overall_confidence = "Medium";
const conflictingAnswer = executiveAnswerFromOutput({
  output: conflicting,
  catalog,
  fallback: { kind: "business_answer", directAnswer: "Fallback" }
});
assert.equal(conflictingAnswer.recommendationConfidence, "Medium", "conflicting evidence must cap recommendation confidence below High");
assert.equal(conflictingAnswer.executiveBriefing.variant, "limited", "conflicting evidence must use the limited-evidence briefing");
assert.deepEqual(conflictingAnswer.executiveBriefing.confidenceAssessment.conflicts, conflicting.analysis.uncertainty, "evidence conflicts must remain visible");
assert.equal(conflictingAnswer.executiveBriefing.keyFindings[0].confidence, "Low", "finding confidence must reflect only the independent sources cited by that finding");
assert.equal(conflictingAnswer.executiveBriefing.recommendedActions[0].confidence, "Low", "action confidence must reflect only the independent sources cited by that action");
assert.equal("reasoningStage" in conflictingAnswer.executiveBriefing, false, "internal reasoning must not be returned to the UI");
assert.equal("analysis" in conflictingAnswer.executiveBriefing, false, "the canonical reasoning transport must not be returned to the UI");
assert.doesNotMatch(JSON.stringify(conflictingAnswer), /summary_signal_ids|signal_id|relationship_candidates/, "manifest and transport internals must not leak into the client answer");
assert.equal(conflictingAnswer.executiveBriefing.supportingEvidence.find((group) => group.category === "KPIs").items[0].support, catalog[0].support, "citation presentation must be derived from the eligible catalog rather than model-written support text");

const derivedRecommendation = structuredClone(conflicting);
derivedRecommendation.analysis.actions[0].citations = [5];
assert.equal(
  validateExecutiveEvidenceReferences(derivedRecommendation, catalog).ok,
  false,
  "recommendations must not rely only on derived analysis"
);

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

const previewHealthPlan = planVaeroexQuery({ query: "Why is my Business Health Score 22, and what should leadership do first to improve it?" });
assert.equal(previewHealthPlan.classification, "cross_business_reasoning", "Business Health diagnosis with leadership action must compare the score with current business evidence");
assert.ok(previewHealthPlan.domains.includes("business_health"), "Business Health diagnosis must load the score domain");

for (const question of [
  "Based on all available evidence, identify the three highest-priority operational risks, explain the root cause of each, and recommend the first actions leadership should take.",
  "Which important conclusion in this workspace has the weakest evidence, why is confidence limited, and what additional information would improve the recommendation?",
  "If you were leading this company tomorrow morning, what would your first leadership meeting focus on, what decision cannot wait, and what should happen over the next 30 days?",
  "What can leadership responsibly conclude from the currently available evidence, and which decisions should wait until more information is connected?"
]) {
  const previewPlan = planVaeroexQuery({ query: question });
  assert.equal(previewPlan.classification, "cross_business_reasoning", `Preview question must use executive cross-business reasoning: ${question}`);
  assert.ok(previewPlan.domains.includes("kpis") && previewPlan.domains.includes("operations") && previewPlan.domains.includes("business_memory"), `Preview question must receive the bounded executive domain set: ${question}`);
}

const emptyEvidenceContext = {
  available: false,
  retrievalMode: "none",
  chunks: [],
  maxChunks: 0,
  confidenceScore: 10,
  confidenceLabel: "Very Limited",
  limitations: [],
  dataGaps: [],
  policy: []
};
const makeBoundedContext = (structuredContext, structuredEvidenceCount = 0) => ({
  workspaceSnapshot: {
    scope: "bounded_cross_business_reasoning",
    query: "test",
    requested_domains: executivePlan.domains,
    loaded_domains: executivePlan.domains,
    structured_context: structuredContext,
    scope_policy: {}
  },
  evidenceQuery: "test",
  loadedDomains: executivePlan.domains,
  structuredEvidenceCount,
  limitations: [],
  estimatedContextTokens: 100,
  loadMs: 1
});
const sourceId = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

const emptyBounded = makeBoundedContext({});
const emptyReasoning = buildExecutiveReasoningContext({
  query: "What can leadership responsibly conclude?",
  plan: executivePlan,
  boundedContext: emptyBounded,
  evidenceContext: emptyEvidenceContext
});
const zeroEvidenceAnswer = buildLimitedEvidenceExecutiveAnswer({
  query: "What can leadership responsibly conclude?",
  boundedContext: emptyBounded,
  reasoningContext: emptyReasoning
});
assert.equal(zeroEvidenceAnswer.executiveBriefing.variant, "limited", "zero evidence must return a limited-evidence briefing");
assert.equal(zeroEvidenceAnswer.executiveBriefing.evidenceSufficiency.state, "Insufficient", "zero evidence must be classified as insufficient");
assert.equal(zeroEvidenceAnswer.recommendationConfidence, "Insufficient", "zero evidence cannot produce confident recommendations");
assert.ok(zeroEvidenceAnswer.executiveBriefing.recommendedActions.length >= 2, "zero evidence must still provide safe next actions");
assert.ok(zeroEvidenceAnswer.executiveBriefing.missingInformation.length >= 3, "zero evidence must identify the information needed next");
assert.equal(zeroEvidenceAnswer.executiveBriefing.keyFindings.length, 0, "zero evidence must not fabricate business findings");

const memoryOnlyReasoning = buildExecutiveReasoningContext({
  query: "What should leadership focus on?",
  plan: executivePlan,
  boundedContext: emptyBounded,
  evidenceContext: {
    ...emptyEvidenceContext,
    available: true,
    retrievalMode: "keyword",
    chunks: [{
      id: sourceId(5),
      sourceType: "Source analysis",
      sourceId: sourceId(6),
      sourceFileId: sourceId(7),
      title: "Revenue context",
      excerpt: "Revenue context from an indexed source.",
      summary: "Revenue context",
      quality: "high",
      confidenceScore: 80,
      indexedAt: now,
      similarity: 0.9
    }],
    maxChunks: 1
  }
});
assert.equal(memoryOnlyReasoning.signalSynthesis.candidates.length, 0, "Business Memory alone must not create an executive signal candidate");
assert.equal(memoryOnlyReasoning.signalSynthesis.minimumDistinctFindings, 0, "supporting context must not force a business finding");

const oneSourceBounded = makeBoundedContext({
  sources: [{ id: sourceId(1), display_name: "Current operating review", analysis_summary: "Current operating review available.", updated_at: now }]
}, 1);
const oneSourceReasoning = buildExecutiveReasoningContext({
  query: "What should leadership focus on this week?",
  plan: executivePlan,
  boundedContext: oneSourceBounded,
  evidenceContext: emptyEvidenceContext
});
const oneSourceAnswer = buildLimitedEvidenceExecutiveAnswer({
  query: "What should leadership focus on this week?",
  boundedContext: oneSourceBounded,
  reasoningContext: oneSourceReasoning
});
assert.equal(oneSourceReasoning.independentSourceCount, 1, "one original source must remain one independent source");
assert.equal(oneSourceReasoning.maximumEvidenceSufficiency, "Partial", "one original source cannot establish sufficient company-wide evidence");
assert.equal(oneSourceReasoning.reasoningManifest.signal_synthesis.candidates[0].maximum_finding_confidence, "Low", "one-source signals must tell the provider that finding confidence cannot exceed Low");
assert.equal(oneSourceAnswer.recommendationConfidence, "Low", "one source can support only low-confidence recommendations");
assert.match(oneSourceAnswer.directAnswer, /one narrow evidence base/i, "one-source answers must explain their scope limitation");

const workbookId = sourceId(20);
const sameWorkbookBounded = makeBoundedContext({
  sources: [{ id: workbookId, display_name: "Retail workbook", analysis_summary: "The workbook contains current revenue measurements.", updated_at: now }],
  kpi_records: [1, 2, 3, 4].map((number) => ({
    id: sourceId(20 + number),
    name: "Revenue",
    actual_value: 100 + number,
    metric_date: `2026-0${number}-01`,
    source_file_id: workbookId,
    updated_at: now
  }))
}, 4);
const sameWorkbookReasoning = buildExecutiveReasoningContext({
  query: "Why is revenue changing?",
  plan: planVaeroexQuery({ query: "Why is revenue changing?" }),
  boundedContext: sameWorkbookBounded,
  evidenceContext: emptyEvidenceContext
});
assert.equal(sameWorkbookReasoning.independentSourceCount, 1, "four KPI rows from one workbook must count as one independent source");
assert.equal(sameWorkbookReasoning.maximumEvidenceSufficiency, "Partial", "repeated rows from one workbook cannot establish sufficient corroboration");
assert.equal(sameWorkbookReasoning.signalSynthesis.candidates.length, 1, "repeated measurements for one KPI must merge into one executive signal");
assert.equal(sameWorkbookReasoning.signalSynthesis.minimumDistinctFindings, 1, "one merged KPI signal must not be expanded into repetitive findings");
assert.ok(sameWorkbookReasoning.signalSynthesis.candidates[0].citationIds.length >= 5, "the parent document may support its structured signal without becoming a duplicate finding");

const sameMetricAcrossDomains = makeBoundedContext({
  kpi_records: [{ id: sourceId(31), name: "Revenue", actual_value: 120, metric_date: "2026-07-01", source_file_id: sourceId(32), updated_at: now }],
  operational_metrics: [{ id: sourceId(33), metric_name: "Revenue", value: 120, metric_date: "2026-07-01", source_file_id: sourceId(32), updated_at: now }]
}, 2);
const sameMetricReasoning = buildExecutiveReasoningContext({
  query: "What is happening with revenue?",
  plan: planVaeroexQuery({ query: "What is happening with revenue?" }),
  boundedContext: sameMetricAcrossDomains,
  evidenceContext: emptyEvidenceContext
});
assert.equal(sameMetricReasoning.signalSynthesis.candidates.length, 1, "the same named metric represented in two domains must merge into one signal");
assert.deepEqual(sameMetricReasoning.signalSynthesis.candidates[0].domains, ["kpis", "operations"], "a merged signal must preserve every contributing domain");

const multiSourceBounded = makeBoundedContext({
  sources: [{
    id: sourceId(41),
    display_name: "Current operating review",
    analysis_summary: "Current operating review supports the leadership question.",
    updated_at: now
  }],
  risk_and_priority_evidence: {
    issues: [{
      id: sourceId(42),
      title: "Current operating risk",
      description: "A current risk requires leadership review.",
      updated_at: now
    }]
  },
  operational_metrics: [{
    id: sourceId(43),
    metric_name: "Operating throughput",
    value: 92,
    recorded_at: now,
    updated_at: now
  }]
}, 3);
const multiSourceReasoning = buildExecutiveReasoningContext({
  query: "What should leadership focus on this week?",
  plan: executivePlan,
  boundedContext: multiSourceBounded,
  evidenceContext: emptyEvidenceContext
});
assert.equal(multiSourceReasoning.independentSourceCount, 3, "multiple original files must remain independent sources");
assert.equal(multiSourceReasoning.currentIndependentSourceCount, 3, "current original sources must be identified separately");
assert.equal(multiSourceReasoning.originalSourceTypeCount, 3, "a full briefing must reflect more than one kind of original evidence");
assert.equal(multiSourceReasoning.maximumEvidenceSufficiency, "Sufficient", "multiple current independent sources may support a full briefing");
assert.equal(multiSourceReasoning.signalSynthesis.candidates.length, 3, "distinct original business conditions must become distinct signal candidates");
assert.equal(multiSourceReasoning.signalSynthesis.minimumDistinctFindings, 3, "three meaningful signals must require three distinct findings before writing");
assert.ok(multiSourceReasoning.signalSynthesis.relationships.length >= 1, "cross-domain signal candidates must be evaluated for relationships without assuming causation");
const multiSourceFailureAnswer = buildLimitedEvidenceExecutiveAnswer({
  query: "What should leadership focus on this week?",
  boundedContext: multiSourceBounded,
  reasoningContext: multiSourceReasoning,
  failureReason: "The deeper analysis did not complete."
});
assert.match(multiSourceFailureAnswer.directAnswer, /3 distinct supported signals[\s\S]*deeper synthesis did not complete/i, "provider failure must preserve multiple ranked signals without pretending synthesis completed");
assert.match(multiSourceFailureAnswer.executiveBriefing.limitedEvidence.evidenceReadinessSummary, /3 independent original sources/i, "provider failure must preserve honest source-readiness context");
assert.equal(multiSourceFailureAnswer.executiveBriefing.keyFindings.length, 3, "provider failure must preserve up to three conservative ranked findings");
assert.equal(new Set(multiSourceFailureAnswer.executiveBriefing.keyFindings.map((finding) => finding.finding)).size, 3, "provider fallback findings must remain distinct");

const derivedOnlyBounded = makeBoundedContext({
  reports: [{ id: sourceId(60), title: "Prior executive brief", report_type: "Executive Brief", evidence_lineage_available: false, created_at: now }]
}, 1);
const derivedOnlyReasoning = buildExecutiveReasoningContext({
  query: "What should leadership focus on this week?",
  plan: executivePlan,
  boundedContext: derivedOnlyBounded,
  evidenceContext: emptyEvidenceContext
});
const derivedOnlyAnswer = buildLimitedEvidenceExecutiveAnswer({
  query: "What should leadership focus on this week?",
  boundedContext: derivedOnlyBounded,
  reasoningContext: derivedOnlyReasoning
});
assert.equal(derivedOnlyReasoning.independentSourceCount, 0, "derived reports must not count as original corroboration");
assert.equal(derivedOnlyReasoning.rankedEvidenceCount, 0, "a derived report without explicit original lineage must not enter the citation set");
assert.equal(derivedOnlyAnswer.recommendationConfidence, "Insufficient", "derived-only evidence cannot support a new recommendation");
assert.match(derivedOnlyAnswer.directAnswer, /underlying original evidence/i, "derived-only answers must explain the lineage limitation");

const healthKpiSummary = {
  totalRows: 4,
  metricCount: 2,
  metrics: [],
  counts: { onTrack: 0, nearTarget: 0, needsAttention: 1, missingTargets: 1, missingValues: 0, stale: 1, insufficientHistory: 2 },
  recommendationConfidence: "Low",
  limitations: ["One metric is stale."],
  evidenceUsed: ["Revenue", "Margin"]
};
const healthSnapshot = {
  id: sourceId(70),
  snapshot_date: "2026-07-16",
  score: 22,
  status: "At Risk",
  trend: "Holding steady",
  data_confidence: "Low",
  data_quality_score: 35,
  memory_signal_count: 2,
  source_summary: { kpis: 4, files: 1, issues: 1, crm_leads: 0, reports: 0 }
};
const businessHealthContext = buildBusinessHealthDecisionContext({ snapshots: [healthSnapshot], kpiSummary: healthKpiSummary });
assert.equal(businessHealthContext.current_assessment.score, 22, "Business Health context must preserve the actual recorded score");
assert.equal(businessHealthContext.kpi_readiness.missing_targets, 1, "Business Health context must preserve missing target counts");
assert.match(businessHealthContext.interpretation_policy.boundary, /does not by itself improve real operating performance/i, "score context must separate readiness from performance");
const healthBounded = makeBoundedContext({
  business_health: [healthSnapshot],
  business_health_score_context: businessHealthContext,
  kpi_records: [{ id: sourceId(71), name: "Revenue", metric_date: "2026-07-01", actual_value: 90, target: 100, source_file_id: sourceId(72), updated_at: now }]
}, 2);
const healthPlan = planVaeroexQuery({ query: "Why is my Business Health Score 22, and what should leadership do first to improve it?" });
const healthReasoning = buildExecutiveReasoningContext({
  query: "Why is my Business Health Score 22, and what should leadership do first to improve it?",
  plan: healthPlan,
  boundedContext: healthBounded,
  evidenceContext: emptyEvidenceContext
});
const healthAnswer = buildLimitedEvidenceExecutiveAnswer({
  query: "Why is my Business Health Score 22, and what should leadership do first to improve it?",
  boundedContext: healthBounded,
  reasoningContext: healthReasoning
});
const healthRequest = estimateVaeroexCompletionRequest({
  workflow: getVaeroexWorkflow("executive_intelligence"),
  userPrompt: "Why is my Business Health Score 22, and what should leadership do first to improve it?",
  workspaceSnapshot: healthReasoning.modelWorkspaceSnapshot,
  extraInputs: {
    evidence_context: healthReasoning.evidenceContextJson,
    executive_reasoning_manifest: healthReasoning.reasoningManifest
  },
  maxOutputTokens: EXECUTIVE_CANONICAL_MAX_OUTPUT_TOKENS
});
assert.match(healthAnswer.directAnswer, /22 out of 100/i, "Business Health fallback must answer with the actual score");
assert.match(healthAnswer.executiveBriefing.limitedEvidence.evidenceReadinessSummary, /data-quality base of 35/i, "Business Health fallback must explain the actual data-quality component");
assert.match(healthAnswer.executiveBriefing.limitedEvidence.evidenceReadinessSummary, /subtracts 12 points.*6.*adds 4 points/i, "Business Health fallback must explain the actual scoring rules");
assert.equal(healthAnswer.executiveBriefing.supportingEvidence.flatMap((group) => group.items).length, 2, "Business Health fallback must show the score snapshot and its available original context separately");
assert.ok(healthReasoning.catalog.some((item) => item.domain === "business_health"), "Business Health compaction must preserve the scored snapshot citation and lineage");
assert.ok(healthRequest.estimatedRequestTokens <= EXECUTIVE_INTERACTIVE_MAX_INPUT_TOKENS, `Business Health model input (${healthRequest.estimatedRequestTokens}) must stay within the hard interactive request budget`);
assert.match(JSON.stringify(healthAnswer), /operating performance|operating findings/i, "Business Health guidance must distinguish operating outcomes from assessment readiness");

const staleCatalog = catalog.map((item) => item.evidenceRole === "original" ? { ...item, freshnessScore: 20 } : item);
assert.equal(validateExecutiveEvidenceReferences(validOutput, staleCatalog).ok, false, "stale original evidence cannot support High briefing confidence");

const contradictoryConfidence = structuredClone(conflicting);
contradictoryConfidence.analysis.evidence_sufficiency = "Insufficient";
contradictoryConfidence.overall_confidence = "High";
assert.equal(validateExecutiveIntelligenceContract(contradictoryConfidence).ok, false, "insufficient evidence can never be paired with High briefing confidence");

const weakestEvidenceAnswer = buildLimitedEvidenceExecutiveAnswer({
  query: "Which important conclusion has the weakest evidence?",
  boundedContext: emptyBounded,
  reasoningContext: emptyReasoning
});
assert.match(weakestEvidenceAnswer.directAnswer, /cannot yet make a reliable company-wide conclusion/i, "weakest-evidence questions must accurately state when no conclusion can be ranked");
assert.ok(weakestEvidenceAnswer.executiveBriefing.recommendedActions.length, "weakest-evidence questions must still provide a useful next step");

const morningAnswer = buildLimitedEvidenceExecutiveAnswer({
  query: "If you were leading this company tomorrow morning, what would your first leadership meeting focus on?",
  boundedContext: emptyBounded,
  reasoningContext: emptyReasoning
});
assert.match(morningAnswer.executiveBriefing.leadershipBrief.firstLeadershipMeeting, /decision-readiness review/i, "sparse leadership questions must produce a practical first meeting");

const executiveWorkflow = getVaeroexWorkflow("executive_intelligence");
const scaleQuestion = "What should leadership focus on across revenue, operations, customers, and people this week?";
const scalePlan = planVaeroexQuery({ query: scaleQuestion });
const scaleRecord = (index) => {
  const domainIndex = index % 6;
  const id = sourceId(10_000 + index);
  const sourceFileId = sourceId(900 + domainIndex);
  const common = {
    id,
    source_file_id: sourceFileId,
    updated_at: now,
    metric_date: "2026-07-01",
    notes: `Current source-grounded operating observation ${index}. ${"Evidence detail ".repeat(35)}`
  };
  if (domainIndex === 0) return ["kpi_records", { ...common, name: "Revenue", actual_value: 100 + index }];
  if (domainIndex === 1) return ["operational_metrics", { ...common, metric_name: "Inventory turns", value: 4 + index / 100 }];
  if (domainIndex === 2) return ["issues", { ...common, title: "Returns rate risk", description: "Returns require current leadership review." }];
  if (domainIndex === 3) return ["historical_customer_activity", { ...common, status: "Current", raw_data_json: { summary: "Customer activity changed during the current period." } }];
  if (domainIndex === 4) return ["people_context", { ...common, role_title: "Capacity constraint", department: "Operations", status: "Current" }];
  return ["business_signals", { ...common, title: "Supplier delivery pressure", description: "Supplier delivery timing requires review." }];
};
const buildScaleContext = (recordCount) => {
  const structured = {
    kpi_records: [],
    operational_metrics: [],
    risk_and_priority_evidence: { issues: [] },
    historical_customer_activity: [],
    people_context: [],
    business_signals: []
  };
  for (let index = 0; index < recordCount; index += 1) {
    const [collection, value] = scaleRecord(index);
    if (collection === "issues") structured.risk_and_priority_evidence.issues.push(value);
    else structured[collection].push(value);
  }
  return makeBoundedContext(structured, recordCount);
};
const buildScaleMemory = (recordCount) => ({
  ...emptyEvidenceContext,
  available: true,
  retrievalMode: "hybrid",
  chunks: Array.from({ length: Math.min(recordCount, 200) }, (_, index) => ({
    id: sourceId(800_000 + index),
    sourceType: "Source analysis",
    sourceId: sourceId(700_000 + index),
    sourceFileId: sourceId(900 + (index % 6)),
    title: `Supporting memory ${index}`,
    excerpt: `Supporting context ${index}. ${"Historical detail ".repeat(30)}`,
    summary: `Supporting context ${index}`,
    quality: "high",
    confidenceScore: 75,
    indexedAt: now,
    similarity: 0.35
  })),
  maxChunks: Math.min(recordCount, 200)
});
const deterministicFallbackReasoning = buildExecutiveReasoningContext({
  query: scaleQuestion,
  plan: scalePlan,
  boundedContext: buildScaleContext(120),
  evidenceContext: buildScaleMemory(120)
});
const deterministicMultiSignalFallback = buildLimitedEvidenceExecutiveAnswer({
  query: scaleQuestion,
  boundedContext: buildScaleContext(120),
  reasoningContext: deterministicFallbackReasoning,
  failureReason: "Both bounded provider attempts ended before completion."
});
assert.equal(
  deterministicMultiSignalFallback.executiveBriefing.keyFindings.length,
  Math.min(3, deterministicFallbackReasoning.signalSynthesis.candidates.length),
  "provider failure must preserve up to three conservative ranked findings"
);
assert.ok(
  deterministicMultiSignalFallback.executiveBriefing.keyFindings.length >= 2,
  "multi-signal deterministic fallback must remain useful when several distinct signals are available"
);

const preparationBenchmarks = [
  { label: "small", storedRecords: 120 },
  { label: "medium", storedRecords: 5_000 },
  { label: "large", storedRecords: 25_000 }
].map(({ label, storedRecords }) => {
  const retrievedRecordLimit = 120;
  const bounded = buildScaleContext(Math.min(storedRecords, retrievedRecordLimit));
  const startedAt = process.hrtime.bigint();
  const reasoningContext = buildExecutiveReasoningContext({
    query: scaleQuestion,
    plan: scalePlan,
    boundedContext: bounded,
    evidenceContext: buildScaleMemory(Math.min(storedRecords, retrievedRecordLimit))
  });
  const preparationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  assert.ok(preparationMs < 1_500, `${label} bounded reasoning preparation must stay below 1.5 seconds`);
  assert.ok(reasoningContext.rankedEvidenceCount <= 18, `${label} ranked evidence must stay within its fixed candidate cap`);
  return {
    label,
    stored_records: storedRecords,
    retrieved_records: Math.min(storedRecords, retrievedRecordLimit),
    ranked_evidence: reasoningContext.rankedEvidenceCount,
    preparation_ms: Math.round(preparationMs * 10) / 10
  };
});
assert.equal(new Set(preparationBenchmarks.map((item) => item.retrieved_records)).size, 1, "retrieved preparation input must remain fixed as stored workspace data grows");
assert.equal(new Set(preparationBenchmarks.map((item) => item.ranked_evidence)).size, 1, "ranked preparation output must remain fixed as stored workspace data grows");

const scaleBenchmarks = [
  { label: "small", records: 120 },
  { label: "medium", records: 5_000 },
  { label: "large", records: 25_000 }
].map(({ label, records }) => {
  const bounded = buildScaleContext(records);
  const reasoningContext = buildExecutiveReasoningContext({
    query: scaleQuestion,
    plan: scalePlan,
    boundedContext: bounded,
    evidenceContext: buildScaleMemory(records)
  });
  const extraInputs = {
    evidence_context: reasoningContext.evidenceContextJson,
    executive_reasoning_manifest: reasoningContext.reasoningManifest
  };
  const compactRequest = estimateVaeroexCompletionRequest({
    workflow: executiveWorkflow,
    userPrompt: scaleQuestion,
    workspaceSnapshot: reasoningContext.modelWorkspaceSnapshot,
    extraInputs,
    maxOutputTokens: EXECUTIVE_CANONICAL_MAX_OUTPUT_TOKENS
  });
  const followUpRequest = estimateVaeroexCompletionRequest({
    workflow: executiveWorkflow,
    userPrompt: scaleQuestion,
    workspaceSnapshot: reasoningContext.modelWorkspaceSnapshot,
    extraInputs: {
      ...extraInputs,
      analysis_session_context: {
        follow_up_number: 5,
        original_question: "O".repeat(600),
        compact_session_summary: "S".repeat(2_200),
        immediately_previous_question: "Q".repeat(600),
        immediately_previous_answer_summary: "A".repeat(1_800)
      }
    },
    maxOutputTokens: EXECUTIVE_CANONICAL_MAX_OUTPUT_TOKENS
  });
  const unboundedRequest = estimateVaeroexCompletionRequest({
    workflow: executiveWorkflow,
    userPrompt: scaleQuestion,
    workspaceSnapshot: bounded.workspaceSnapshot,
    extraInputs,
    maxOutputTokens: EXECUTIVE_CANONICAL_MAX_OUTPUT_TOKENS
  });

  assert.ok(reasoningContext.promptCompaction.compactContextTokens <= EXECUTIVE_COMPACT_CONTEXT_TARGET_TOKENS, `${label} compact evidence context must stay within its deterministic context budget`);
  assert.ok(compactRequest.estimatedRequestTokens <= EXECUTIVE_INTERACTIVE_MAX_INPUT_TOKENS, `${label} workspace model input (${compactRequest.estimatedRequestTokens}) must stay within the hard interactive request budget`);
  assert.ok(followUpRequest.estimatedRequestTokens <= EXECUTIVE_INTERACTIVE_MAX_INPUT_TOKENS, `${label} workspace follow-up input (${followUpRequest.estimatedRequestTokens}) must stay within the same hard interactive request budget`);
  assert.ok(compactRequest.estimatedRequestTokens <= EXECUTIVE_INITIAL_REQUEST_TARGET_TOKENS, `${label} initial request (${compactRequest.estimatedRequestTokens}) must meet the complete-input optimization target`);
  assert.ok(followUpRequest.estimatedRequestTokens <= EXECUTIVE_FOLLOW_UP_REQUEST_TARGET_TOKENS, `${label} fifth follow-up (${followUpRequest.estimatedRequestTokens}) must meet the bounded follow-up target`);
  assert.ok(reasoningContext.promptCompaction.retainedSignalCount <= 6, `${label} workspace must retain no more than six ranked signal candidates`);
  assert.ok(reasoningContext.promptCompaction.retainedOriginalEvidenceCount <= 12, `${label} workspace must retain no more than two original records per signal`);
  assert.ok(reasoningContext.promptCompaction.retainedSupportingMemoryCount <= 4, `${label} workspace must retain no more than four supporting-memory entries`);

  return {
    label,
    stored_records: records,
    model_input_tokens: compactRequest.estimatedRequestTokens,
    maximum_follow_up_input_tokens: followUpRequest.estimatedRequestTokens,
    compact_context_tokens: reasoningContext.promptCompaction.compactContextTokens,
    retained_signals: reasoningContext.promptCompaction.retainedSignalCount,
    retained_evidence: reasoningContext.promptCompaction.retainedEvidenceCount,
    estimated_unbounded_tokens: unboundedRequest.estimatedRequestTokens,
    estimated_token_reduction_percent: Math.round((1 - compactRequest.estimatedRequestTokens / unboundedRequest.estimatedRequestTokens) * 1_000) / 10
  };
});
const boundedTokenRange = Math.max(...scaleBenchmarks.map((item) => item.model_input_tokens)) - Math.min(...scaleBenchmarks.map((item) => item.model_input_tokens));
assert.ok(boundedTokenRange <= 250, "model input size must remain effectively constant as stored workspace records grow");

const userFacingFallback = JSON.stringify([zeroEvidenceAnswer, oneSourceAnswer, healthAnswer]);
assert.doesNotMatch(userFacingFallback, /bounded summary|first relevant KPI|reasoning contract|reasoning manifest|internal source index|retrieval tier/i, "executive answers must not expose implementation language");
assert.equal("reasoningStage" in healthAnswer.executiveBriefing, false, "deterministic limited briefings must not expose internal reasoning");

console.log("Executive prompt scale benchmarks:", JSON.stringify(scaleBenchmarks));
console.log("Executive preparation scale benchmarks:", JSON.stringify(preparationBenchmarks));
console.log("Executive Intelligence regression tests passed.");
