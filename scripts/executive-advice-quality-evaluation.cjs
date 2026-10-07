const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs, target: ts.ScriptTarget.ES2022 },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { buildIntelligenceLayer } = require("../lib/intelligence/layer.ts");
const { kpiRiskInvestigation } = require("../lib/intelligence/kpi-investigation.ts");
const { buildFindingExplanationPackage } = require("../lib/ai/finding-explanation/context.ts");
const { findingExplanationModelInput } = require("../lib/ai/finding-explanation/service.ts");
const { validateFindingExplanationOutput } = require("../lib/ai/finding-explanation/validation.ts");
const { businessHealthProviderRequestPayload } = require("../lib/ai/business-health-explanation/service.ts");
const { validateBusinessHealthExplanationOutput } = require("../lib/ai/business-health-explanation/validation.ts");
const { parseBusinessHealthExplanationArtifact } = require("../lib/ai/business-health-explanation/storage.ts");

const asOf = "2026-07-15T00:00:00.000Z";
function kpi(name, date, actual, target, overrides = {}) {
  return {
    id: `${name}-${date}`, workspace_id: "11111111-1111-4111-8111-111111111111", name,
    actual_value: actual, target, metric_date: date, category: null, owner: null, notes: null,
    source: "Synthetic source", source_file_id: null, import_id: null, import_row_id: null,
    raw_data_json: {}, ai_generated: false, archived_at: null, deleted_at: null,
    created_at: `${date}T00:00:00.000Z`, updated_at: `${date}T00:00:00.000Z`,
    ...overrides
  };
}
const dates = ["2026-06-01", "2026-05-01", "2026-04-01", "2026-03-01", "2026-02-01", "2026-01-01"];
const reviewRows = dates.map((date) => kpi("1-Star Reviews", date, 37, 0));
const reviewFinding = buildIntelligenceLayer({ asOf, kpis: reviewRows }).insights.find((item) => item.id.startsWith("kpi-risk-"));
assert.ok(reviewFinding, "the review KPI must produce a live-style finding");
assert.match(reviewFinding.title, /6 periods/);
assert.match(reviewFinding.recommendedAction, /examine the underlying reviews.*group recurring complaint themes.*assign an owner/i);
assert.match(reviewFinding.recommendedAction, /No review text accompanies this KPI record/);
assert.match(reviewFinding.recommendedAction, /before treating its value as unique reviews/);
assert.doesNotMatch(reviewFinding.recommendedAction, /37 unique reviews|caused/i);
assert.ok(reviewFinding.recommendedAction.length <= 420, "the approved review action must fit the Explain Finding input without truncation");
const reviewPackage = buildFindingExplanationPackage({ workspaceId: reviewRows[0].workspace_id, insight: reviewFinding, now: new Date(asOf) });
assert.equal(findingExplanationModelInput(reviewPackage).finding.approved_investigation_next, reviewFinding.recommendedAction);
assert.equal(reviewPackage.requiredCitationIds.length > 0, true, "approved investigation retains source citations");
const reviewExplanation = {
  what_happened: "The review KPI remained above its configured target across the recorded periods.",
  why_evidence_suggests: "The latest recorded value is above target under the confirmed KPI direction; the source record does not explain why.",
  why_leadership_should_care: "The measured gap deserves leadership review, while any business impact still needs evidence.",
  investigate_next: reviewFinding.recommendedAction,
  what_evidence_does_not_prove: "The KPI history does not establish a cause or how many unique reviews the value represents."
};
assert.equal(validateFindingExplanationOutput(reviewExplanation, reviewPackage).ok, true, "a specific bounded review explanation validates");
assert.equal(validateFindingExplanationOutput({ ...reviewExplanation, investigate_next: "Review source records and decide whether to continue monitoring the KPI." }, reviewPackage).ok, false, "the former generic step must fail quality validation");

const withReviewText = kpiRiskInvestigation(kpi("1-Star Reviews", "2026-06-01", 37, 0, {
  raw_data_json: { "Review Text": "Synthetic review text for fixture only." }
}), asOf);
assert.match(withReviewText.action, /source row includes review text/);
assert.doesNotMatch(withReviewText.action, /No review text accompanies/);
assert.doesNotMatch(withReviewText.action, /Synthetic review text/, "review contents are not copied into advice");

const receivingRows = ["2026-06-01", "2026-05-01", "2026-04-01"].map((date) => kpi("Receiving Delay (hrs)", date, 5.9, 4.97));
const receivingSetting = {
  kpi_name: "Receiving Delay (hrs)", canonical_name: "receiving_delay", display_name: "Receiving Delay (hrs)",
  original_source_label: "Receiving Delay (hrs)", semantic_unit: "hours", semantic_scale: 1,
  desired_direction: "minimize", target_behavior: "maximum_limit", ideal_value: null,
  ideal_range_min: null, ideal_range_max: null, metric_role: "actual", classification_source: "user",
  classification_confidence: 1, classification_confirmed: true, classification_rationale: "Confirmed fixture semantics.",
  target: 4.97, definition: "Elapsed receiving time in hours", weight: 1, sort_order: 0, is_visible: true
};
const receivingFinding = buildIntelligenceLayer({ asOf, kpis: receivingRows, kpiSettings: [receivingSetting] }).insights.find((item) => item.id.startsWith("kpi-risk-"));
assert.ok(receivingFinding, "the receiving KPI must produce a live-style finding");
assert.match(receivingFinding.recommendedAction, /receiving transactions.*arrival and completion timestamps.*supplier, site, and shift/i);
assert.match(receivingFinding.recommendedAction, /only after matching period, site, and source records/i);
assert.doesNotMatch(receivingFinding.recommendedAction, /receiving delays caused.*customer|customer complaints caused.*delay/i);
assert.ok(receivingFinding.recommendedAction.length <= 420, "the approved receiving action must fit the Explain Finding input without truncation");
const receivingPackage = buildFindingExplanationPackage({ workspaceId: receivingRows[0].workspace_id, insight: receivingFinding, now: new Date(asOf) });
assert.equal(findingExplanationModelInput(receivingPackage).finding.approved_investigation_next, receivingFinding.recommendedAction);
const receivingExplanation = {
  ...reviewExplanation,
  what_happened: "Receiving Delay (hrs) remained above its configured maximum across the recorded periods.",
  why_evidence_suggests: "The recorded delay was above the confirmed KPI target; the source does not identify a cause.",
  why_leadership_should_care: "The gap needs context before it can be tied to a cause or business impact.",
  investigate_next: receivingFinding.recommendedAction,
  what_evidence_does_not_prove: "The aggregate does not establish a supplier cause or a link to customer exceptions."
};
const receivingValidation = validateFindingExplanationOutput(receivingExplanation, receivingPackage);
assert.equal(receivingValidation.ok, true, `the source-specific receiving explanation validates: ${JSON.stringify(receivingValidation)}`);
assert.equal(validateFindingExplanationOutput({ ...receivingExplanation, investigate_next: "Decide whether to investigate the cause now or continue monitoring." }, receivingPackage).ok, false, "generic receiving advice must fail quality validation");
const unrelatedCustomerSignal = {
  id: "synthetic-customer-exception", type: "Risk", title: "Customer exceptions need review",
  summary: "A separate source records customer exceptions in February.", why: "That source records exceptions.",
  impact: "No business outcome has been established.", recommendedAction: "Review those customer records separately.",
  confidence: "Medium", evidence: [], evidenceCount: 1,
  supportingRecords: [{ id: "synthetic-customer-row", title: "Customer exception", recordType: "Customer record", date: "2026-02-01", value: "Exception recorded", support: "Separate source and period.", href: "/app/sources", classification: "Original", sourceKey: "source-file:unrelated-customer-source" }],
  independentSourceCount: 1, contradictoryEvidence: [], missingEvidence: ["Confirmed outcome"], sourceTypes: ["Customer Evidence"], sourceHref: "/app/sources", priority: "High",
  lastUpdated: "2026-02-01", affectedArea: "Customers", timePeriod: "2026-02", limitation: "No link to receiving records is established.", fingerprint: "synthetic-customer-exception"
};
const withSeparateSignal = buildIntelligenceLayer({ asOf, kpis: receivingRows, kpiSettings: [receivingSetting], operationalInsights: [unrelatedCustomerSignal] });
const stillSeparate = withSeparateSignal.insights.find((item) => item.id === receivingFinding.id);
assert.equal(stillSeparate.recommendedAction, receivingFinding.recommendedAction, "unrelated customer data must not change the receiving investigation or establish a link");

const staleReview = kpiRiskInvestigation(reviewRows[0], "2026-10-06T00:00:00.000Z");
assert.match(staleReview.action, /^Refresh the review KPI and source records now/);
assert.ok(staleReview.action.length <= 420, "stale review action must fit without truncation");
const healthPayload = businessHealthProviderRequestPayload({
  contractId: "business_health_explanation_v1", submode: "evidence_stale", hypothesisAllowed: false,
  facts: {
    score: 50, status: "Watch", trajectory: "Holding steady", comparison: "Unchanged", dataQualityBase: 50,
    riskPenalty: 18, opportunityAdjustment: 18, confidence: "Medium", freshness: "stale", limitations: ["The newest supporting evidence is older than 45 days."],
    drivers: [{ kind: "risk", label: reviewFinding.title, fact: reviewFinding.summary, scoreImpact: -18, citationIds: [1], limitation: reviewFinding.limitation, investigationNext: staleReview.action }]
  },
  citations: [{ citationId: 1, sourceLabel: "Synthetic workbook", recordedAt: "2026-06-01T00:00:00.000Z", excerpt: "A review KPI value was recorded." }]
});
assert.equal(healthPayload.required_drivers[0].approved_next_investigation, staleReview.action);
assert.equal(healthPayload.immutable_facts.freshness, "stale");
const healthContext = { ...healthPayload, facts: {
  score: 50, status: "Watch", trajectory: "Holding steady", comparison: "Unchanged",
  dataQualityBase: 50, riskPenalty: 18, opportunityAdjustment: 18, confidence: "Medium", freshness: "stale",
  limitations: ["The newest supporting evidence is older than 45 days."],
  drivers: [{ kind: "risk", label: reviewFinding.title, fact: reviewFinding.summary, scoreImpact: -18, citationIds: [1], limitation: reviewFinding.limitation, investigationNext: staleReview.action }],
  available: true, comparisonDelta: 0, latestEvidenceAt: "2026-06-01T00:00:00.000Z",
  deterministicSummary: "The score is watch and the review KPI is a negative driver."
} };
const healthExplanation = {
  executive_interpretation: "1-Star Reviews is the main negative driver of the current Business Health score.",
  why_it_matters: "Leadership should prioritize the review KPI while treating the stale score as a historical signal.",
  leadership_consideration: staleReview.action,
  provisional_hypothesis: null
};
assert.equal(validateBusinessHealthExplanationOutput(healthExplanation, healthContext).ok, true, "a stale, specific Health action validates");
assert.equal(validateBusinessHealthExplanationOutput({ ...healthExplanation, leadership_consideration: "Decide whether to investigate the cause now or continue monitoring the score." }, healthContext).ok, false, "generic stale Health advice fails validation");
assert.equal(validateBusinessHealthExplanationOutput({ ...healthExplanation,
  executive_interpretation: "1-Star Reviews is a negative score driver, but the KPI does not establish its cause.",
  why_it_matters: "Leadership should review 1-Star Reviews, but the available KPI does not establish its cause."
}, healthContext).ok, false, "the same causal caveat cannot fill multiple Health sections");
const storedHealth = {
  contractId: "business_health_explanation_v1", contractVersion: "business_health_explanation_v1",
  validatorVersion: "business_health_explanation_validator_v1", fingerprint: "a".repeat(64), generatedAt: asOf,
  analysis: healthExplanation, facts: healthContext.facts, citations: [],
  providerAttribution: { provider: "openai", model: "fixture-model", fallbackUsed: false, providerPolicyId: "fixture-policy" }
};
assert.ok(parseBusinessHealthExplanationArtifact(storedHealth), "new Health artifacts remain readable");
const historicalHealth = JSON.parse(JSON.stringify(storedHealth));
delete historicalHealth.facts.drivers[0].investigationNext;
assert.ok(parseBusinessHealthExplanationArtifact(historicalHealth), "historical Health artifacts without the new action remain readable");

console.log("Executive advice evaluation passed: review text present/missing, receiving delay, stale Health, and no unsupported cross-signal link.");
