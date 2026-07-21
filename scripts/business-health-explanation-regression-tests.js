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

process.env.SUPABASE_SERVICE_ROLE_KEY = "local-business-health-regression-secret";

const { buildBusinessHealthExplanationPackage } = require("../lib/ai/business-health-explanation/context.ts");
const { validateBusinessHealthExplanationOutput } = require("../lib/ai/business-health-explanation/validation.ts");
const {
  openBusinessHealthExplanationPackage,
  sealBusinessHealthExplanationPackage
} = require("../lib/ai/business-health-explanation/token.ts");
const { verifyEvidenceManifestCitations } = require("../lib/ai/evidence-engine/citation-verification.ts");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-07-19T12:00:00.000Z");

function evidenceRecord(overrides = {}) {
  return {
    id: "kpi:revenue-june",
    title: "Monthly Revenue",
    recordType: "KPI record",
    date: "2026-07-18T00:00:00.000Z",
    value: "Actual $92,000; target $100,000",
    support: "The latest eligible value is below its explicit target.",
    href: "/app/kpis",
    classification: "Original",
    sourceKey: "source-file:retail-workbook",
    groupHint: "Financials",
    ...overrides
  };
}

function insight(overrides = {}) {
  return {
    id: "risk-revenue",
    type: "Risk",
    title: "Monthly Revenue is below target",
    summary: "Monthly Revenue is below its explicit target.",
    why: "The latest eligible value is lower than the recorded target.",
    impact: "The gap requires context before an impact can be established.",
    recommendedAction: "Review the next reporting period.",
    confidence: "Medium",
    evidence: ["Actual: $92,000", "Target: $100,000"],
    evidenceCount: 1,
    supportingRecords: [evidenceRecord()],
    independentSourceCount: 1,
    contradictoryEvidence: [],
    missingEvidence: ["Evidence explaining the change"],
    sourceTypes: ["KPIs"],
    sourceHref: "/app/kpis",
    priority: "High",
    lastUpdated: "2026-07-18T00:00:00.000Z",
    affectedArea: "Financials",
    timePeriod: "2026-07",
    limitation: "The KPI gap does not establish a cause.",
    fingerprint: "risk:revenue:performance-gap:2026-07",
    ...overrides
  };
}

const opportunity = insight({
  id: "opportunity-retention",
  type: "Opportunity",
  title: "Customer Retention is above target",
  summary: "Customer Retention is above its explicit target.",
  why: "The latest eligible value meets the recorded target.",
  priority: "Medium",
  affectedArea: "Customer experience",
  limitation: "The result does not establish what caused it.",
  fingerprint: "opportunity:retention:positive-performance:2026-07",
  supportingRecords: [evidenceRecord({
    id: "kpi:retention-june",
    title: "Customer Retention",
    value: "Actual 94%; target 90%",
    support: "The latest eligible value is above its explicit target.",
    sourceKey: "source-file:customer-workbook"
  })]
});

function intelligence(overrides = {}) {
  const risk = insight();
  return {
    executiveSummary: "Revenue needs attention while retention remains supported.",
    businessHealth: { available: true, score: 52, status: "Watch", trend: "Holding steady" },
    dataQuality: { score: 60, label: "Developing", confidence: "Medium", reason: "Eligible source coverage remains developing.", suggestedNextData: [] },
    forecastReadiness: {},
    topRisk: risk,
    topOpportunity: opportunity,
    topRecommendation: risk,
    insights: [risk, opportunity],
    memorySummary: { profileSignals: 2, sourceRecords: 2, kpiHistoryRecords: 8, reports: 0, vaeroexRuns: 0, decisions: 0, recommendationOutcomes: 0 },
    ...overrides
  };
}

function homepage(overrides = {}) {
  return {
    health: {
      available: true,
      score: 52,
      status: "Watch",
      trend: "Holding steady",
      trendDelta: 0,
      summary: "Revenue is below target while retention remains above target.",
      driver: "Monthly Revenue is below its explicit target.",
      confidence: "Medium",
      memorySignals: 10,
      ...overrides
    },
    priorities: [],
    changes: { state: "none", items: [], message: "" },
    readiness: {}
  };
}

const snapshots = [
  { snapshot_date: "2026-07-18", score: 52 },
  { snapshot_date: "2026-07-11", score: 52 }
];

function build(overrides = {}) {
  return buildBusinessHealthExplanationPackage({
    workspaceId,
    intelligence: overrides.intelligence || intelligence(),
    homepage: overrides.homepage || homepage(),
    snapshots: overrides.snapshots || snapshots,
    sourceLabelsByKey: overrides.sourceLabelsByKey || {},
    now: overrides.now || now
  });
}

const analysisPackage = build();
assert.equal(analysisPackage.contractId, "business_health_explanation_v1");
assert.equal(analysisPackage.facts.score, 52, "the contract must preserve the application-owned score");
assert.equal(analysisPackage.facts.riskPenalty, 12, "the contract must preserve the deterministic risk penalty");
assert.equal(analysisPackage.facts.opportunityAdjustment, 4, "the contract must preserve the deterministic opportunity adjustment");
assert.equal(analysisPackage.facts.drivers.length, 2, "the bounded package must retain the top risk and opportunity");
assert.ok(analysisPackage.requiredCitationIds.length >= 2, "the package must attach application-generated citations");
assert.equal(analysisPackage.manifest.policy.citationsApplicationGenerated, true);
assert.equal(analysisPackage.manifest.policy.derivedOutputsExcludedFromOriginalEvidence, true);
assert.ok(analysisPackage.manifest.evidence.every((entry) => entry.evidenceRole !== "derived"), "derived evidence must not enter this fixed contract");
assert.equal(verifyEvidenceManifestCitations({
  manifest: analysisPackage.manifest,
  citationIds: analysisPackage.requiredCitationIds,
  requiredCitationIds: analysisPackage.requiredCitationIds
}).valid, true, "centralized Evidence Engine citation verification must pass");

const laterPackage = build({ now: new Date("2026-07-19T12:10:00.000Z") });
assert.equal(laterPackage.fingerprint, analysisPackage.fingerprint, "generated timestamps must not affect the relevant evidence fingerprint");

const labeledPackage = build({ sourceLabelsByKey: {
  "source-file:retail-workbook": "Retail Performance Workbook",
  "source-file:customer-workbook": "Customer Experience Workbook"
} });
assert.ok(labeledPackage.citations.some((citation) => citation.sourceLabel === "Retail Performance Workbook"), "human-readable source lineage must be preserved");
const renamedSourcePackage = build({ sourceLabelsByKey: {
  "source-file:retail-workbook": "Renamed Retail Performance Workbook",
  "source-file:customer-workbook": "Customer Experience Workbook"
} });
assert.notEqual(renamedSourcePackage.fingerprint, labeledPackage.fingerprint, "a relevant source-lineage label change must invalidate the fingerprint");

const unrelatedInsight = insight({
  id: "recommendation-unrelated",
  type: "Recommendation",
  title: "Review a process document",
  fingerprint: "recommendation:process:review:2026-07",
  supportingRecords: [evidenceRecord({ id: "sop:unrelated", title: "Unrelated SOP", sourceKey: "sop:unrelated" })]
});
const unrelatedPackage = build({ intelligence: intelligence({ insights: [insight(), opportunity, unrelatedInsight] }) });
assert.equal(unrelatedPackage.fingerprint, analysisPackage.fingerprint, "unrelated evidence must not invalidate this contract fingerprint");

const changedRisk = insight({
  supportingRecords: [evidenceRecord({ value: "Actual $88,000; target $100,000" })]
});
const changedPackage = build({ intelligence: intelligence({
  topRisk: changedRisk,
  topRecommendation: changedRisk,
  insights: [changedRisk, opportunity]
}) });
assert.notEqual(changedPackage.fingerprint, analysisPackage.fingerprint, "a relevant evidence change must invalidate the fingerprint");

const inactiveSourcePackage = build({ intelligence: intelligence({
  insights: [insight({ supportingRecords: [evidenceRecord({ classification: "Derived" })] }), opportunity]
}) });
assert.notEqual(inactiveSourcePackage.fingerprint, analysisPackage.fingerprint, "a relevant eligibility change must invalidate the fingerprint");
assert.ok(inactiveSourcePackage.manifest.evidence.every((entry) => entry.title !== "Monthly Revenue"), "ineligible derived evidence must be excluded");

assert.equal(build({ homepage: homepage({ status: "Healthy", trend: "Improving", trendDelta: 3 }) }).submode, "healthy_improving");
assert.equal(build({ homepage: homepage({ status: "Critical", trend: "Declining", trendDelta: -4 }) }).submode, "at_risk_worsening");
assert.equal(build({ now: new Date("2027-01-19T12:00:00.000Z") }).submode, "evidence_stale");
assert.equal(build({ homepage: homepage({ available: false, score: null }) }).submode, "evidence_limited");

const validOutput = {
  executive_interpretation: "Monthly Revenue remains the main negative score driver, while Customer Retention provides a smaller positive counterweight.",
  why_it_matters: "Leadership has a mixed operating picture rather than one uniformly positive or negative signal.",
  leadership_consideration: "Review the Revenue gap while preserving visibility into the supported Retention result.",
  provisional_hypothesis: null
};
assert.equal(validateBusinessHealthExplanationOutput(validOutput, analysisPackage).ok, true, "grounded fixed-contract wording must validate");
const numericFailure = validateBusinessHealthExplanationOutput({ ...validOutput, executive_interpretation: "Monthly Revenue is 42 points and Customer Retention remains visible." }, analysisPackage);
assert.equal(numericFailure.ok, false, "invented numbers must be rejected");
assert.equal(numericFailure.diagnostic.reasonCode, "numeric_integrity_failed", "numeric failures must remain distinguishable for the bounded fallback allowlist");
assert.equal(validateBusinessHealthExplanationOutput({ ...validOutput, provisional_hypothesis: "Revenue was caused by customer behavior." }, analysisPackage).ok, false, "unauthorized hypotheses must be rejected");
assert.equal(validateBusinessHealthExplanationOutput({ ...validOutput, executive_interpretation: "Monthly Revenue was caused by weak execution while Customer Retention remains visible." }, analysisPackage).ok, false, "unsupported causation must be rejected");
assert.equal(validateBusinessHealthExplanationOutput({
  executive_interpretation: "Customer Retention is the only visible driver in this assessment.",
  why_it_matters: "Leadership has one supported customer signal to monitor in the current evidence.",
  leadership_consideration: "Preserve visibility into the supported Retention result during the next review.",
  provisional_hypothesis: null
}, analysisPackage).ok, false, "required top-driver omissions must be rejected");
assert.equal(validateBusinessHealthExplanationOutput({ ...validOutput, why_it_matters: "See [9] for the evidence." }, analysisPackage).ok, false, "providers must not generate citation IDs");

const token = sealBusinessHealthExplanationPackage({ analysisPackage, workspaceId, userId, nowMs: now.getTime() });
assert.doesNotMatch(token, /Monthly Revenue|11111111|22222222/, "the client handoff must encrypt facts and internal identifiers");
assert.equal(openBusinessHealthExplanationPackage(token, { workspaceId, userId }, now.getTime()).ok, true, "the authorized user and workspace must open the package");
assert.equal(openBusinessHealthExplanationPackage(token, { workspaceId: "33333333-3333-4333-8333-333333333333", userId }, now.getTime()).ok, false, "another workspace must not open the package");
assert.equal(openBusinessHealthExplanationPackage(token, { workspaceId, userId }, now.getTime() + 16 * 60 * 1000).reason, "expired", "stale page tokens must expire safely");

const pageSource = read("app/app/page.tsx");
const actionSource = read("app/app/business-health-analysis/actions.ts");
const serviceSource = read("lib/ai/business-health-explanation/service.ts");
const workflowPolicySource = read("lib/ai/providers/workflow-provider-policy.ts");
const panelSource = read("components/intelligence/BusinessHealthAnalysisPanel.tsx");
assert.match(pageSource, /buildBusinessHealthExplanationPackage/, "Overview must build the deterministic package during server rendering");
assert.doesNotMatch(pageSource, /generateBusinessHealthExplanation\(/, "server rendering must never invoke a generation provider");
assert.match(actionSource, /getWorkspaceContext/, "the generation action must reauthorize the active workspace");
assert.match(actionSource, /verifyEvidenceManifestCitations/, "the action must reverify centralized citations before generation");
assert.match(actionSource, /evidence_classification:\s*"derived_analysis"/, "saved analysis must remain derived and ineligible as original evidence");
assert.match(actionSource, /\.eq\("workspace_id", workspaceId\)/, "run mutations must remain explicitly workspace scoped");
assert.match(workflowPolicySource, /process\.env\.VERCEL_ENV === "preview"/, "workflow-specific experimental routing must remain Preview-specific");
assert.match(workflowPolicySource, /VAEROEX_EXECUTIVE_SYNTHESIS_POLICY === BUSINESS_HEALTH_GPT56_POLICY_SELECTOR/, "the GPT-5.6 experiment must require its exact Preview selector");
assert.match(workflowPolicySource, /business_health_preview_nvidia_primary_v1/, "selector absence must preserve the existing Preview provider policy");
assert.match(workflowPolicySource, /business_health_openai_primary_v1/, "non-Preview routing must remain explicit and isolated");
assert.match(workflowPolicySource, /gpt-5\.6-sol[\s\S]*gpt-5\.6-terra/, "the Preview experiment must use code-owned Sol then Terra model IDs");
assert.match(serviceSource, /runStructuredAI/, "the fixed workflow must use the provider-neutral manager");
assert.match(actionSource, /loadBusinessHealthAnalysisState/, "a failed refresh must reload and preserve the last valid stale artifact");
assert.match(actionSource, /action:\s*"business_health_explanation\.generate"[\s\S]*limit:\s*1[\s\S]*windowSeconds:\s*60[\s\S]*identifiers:\s*\[analysisPackage\.fingerprint\]/, "duplicate generation must remain rate-limited by the contract fingerprint");
assert.match(panelSource, />\s*View analysis\s*</, "Overview must expose the approved executive action label");
assert.match(panelSource, /sm:max-w-2xl/, "desktop must use a bounded right-side panel");
assert.match(panelSource, /absolute inset-0 flex w-full/, "mobile must use a full-screen analysis sheet");
assert.match(panelSource, /hasOpenedRef\.current/, "the trigger must regain focus only after the panel has opened");
assert.match(panelSource, /event\.key !== "Tab"/, "keyboard focus must remain within the open analysis panel");
assert.doesNotMatch(panelSource, /providerAttribution|provider_policy|model:/, "normal users must not see model-routing details");
assert.doesNotMatch(panelSource, /stableKey|source_file_id|workspaceId|UUID/, "the executive view must not render internal identifiers");

process.stdout.write("Business Health explanation regressions passed.\n");
