const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
  });
  module._compile(output.outputText, filename);
};
const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  return originalResolveFilename.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};

const {
  calculateBusinessHealthPerformance,
  calculateIntelligenceReadiness
} = require("../lib/intelligence/business-health-formula.ts");
const {
  BUSINESS_HEALTH_CALCULATION_VERSION,
  BUSINESS_HEALTH_CALCULATION_VERSION_V1,
  DATA_QUALITY_CALCULATION_VERSION,
  DATA_QUALITY_CALCULATION_VERSION_V1
} = require("../lib/intelligence/snapshot/v1/versions.ts");
const {
  buildBusinessHealthTrendDisplayPoints
} = require("../lib/intelligence/business-health-trend.ts");
const {
  businessHealthCalculationVersionFromSourceSummary
} = require("../lib/intelligence/business-health-history.ts");
const { evidenceEngineHash } = require("../lib/ai/evidence-engine/hash.ts");

function signals(kind, entries) {
  return entries.map(([identity, points], index) => ({ identity, points, findingId: `${kind}-${index + 1}` }));
}

function health({ eligible = true, positive = [], negative = [] }) {
  return calculateBusinessHealthPerformance({
    evidenceEligible: eligible,
    positiveSignals: signals("positive", positive),
    negativeSignals: signals("negative", negative)
  });
}

const scenarios = [
  ["ineligible workspace", health({ eligible: false }), 0, "Insufficient Data"],
  ["eligible workspace without outcomes", health({}), 0, "Insufficient Data"],
  ["limited evidence with one healthy metric", health({ positive: [["kpi:one", 10]] }), 60, "Watch"],
  ["high-confidence healthy workspace", health({ positive: [["kpi:1", 10], ["kpi:2", 10], ["kpi:3", 10], ["kpi:4", 10]] }), 90, "Strong"],
  ["one high risk", health({ negative: [["risk:1", 18]] }), 32, "At Risk"],
  ["several high risks", health({ negative: [["risk:1", 18], ["risk:2", 18], ["risk:3", 18]] }), 0, "At Risk"],
  ["mixed performance", health({ positive: [["kpi:1", 10], ["kpi:2", 10], ["kpi:3", 10]], negative: [["risk:1", 18], ["risk:2", 10]] }), 52, "Watch"],
  ["theoretical maximum", health({ positive: [["kpi:1", 10], ["kpi:2", 10], ["kpi:3", 10], ["kpi:4", 10], ["kpi:5", 10]] }), 100, "Strong"],
  ["theoretical minimum", health({ negative: [["risk:1", 18], ["risk:2", 18], ["risk:3", 18]] }), 0, "At Risk"]
];
for (const [name, result, expectedScore, expectedStatus] of scenarios) {
  assert.equal(result.score, expectedScore, `${name} score`);
  assert.equal(result.status, expectedStatus, `${name} status`);
}

const duplicatePositive = calculateBusinessHealthPerformance({
  evidenceEligible: true,
  positiveSignals: [
    { identity: "revenue|actual|1|usd", findingId: "trend", points: 8 },
    { identity: "revenue|actual|1|usd", findingId: "target", points: 10 }
  ],
  negativeSignals: []
});
assert.equal(duplicatePositive.components.opportunityAdjustment, 10, "one canonical KPI cannot receive target and trend points");
assert.deepEqual(duplicatePositive.components.driverImpacts.map((impact) => impact.findingId), ["target"]);

const duplicateRisk = calculateBusinessHealthPerformance({
  evidenceEligible: true,
  positiveSignals: [],
  negativeSignals: [
    { identity: "kpi:checkout-wait|performance-gap", findingId: "risk-copy", points: 10 },
    { identity: "kpi:checkout-wait|performance-gap", findingId: "risk-primary", points: 18 }
  ]
});
assert.equal(duplicateRisk.components.riskPenalty, 18, "duplicate manifestations of one condition count once");
assert.deepEqual(duplicateRisk.components.driverImpacts.map((impact) => impact.findingId), ["risk-primary"]);

const maximumReadiness = calculateIntelligenceReadiness({
  hasWorkspaceProfile: true,
  hasOriginalFiles: true,
  hasCanonicalKpis: true,
  hasTraceableCustomerOrOperationalRecords: true,
  independentSourceIdentityCount: 5,
  sourceTypeCount: 4,
  canonicalKpiCount: 5,
  kpisWithHistoricalDepth: 5,
  freshKpiCount: 5
});
assert.equal(maximumReadiness.score, 100);
assert.equal(maximumReadiness.confidence, "High");

const similarFiles = calculateIntelligenceReadiness({
  hasWorkspaceProfile: false,
  hasOriginalFiles: true,
  hasCanonicalKpis: false,
  hasTraceableCustomerOrOperationalRecords: false,
  independentSourceIdentityCount: 6,
  sourceTypeCount: 1,
  canonicalKpiCount: 0,
  kpisWithHistoricalDepth: 0,
  freshKpiCount: 0
});
assert.equal(similarFiles.components.independentSourceDiversity, 10, "six similar files must not produce maximum diversity");
assert.equal(similarFiles.confidence, "Low");

const strongLow = health({ positive: [["kpi:1", 10], ["kpi:2", 10], ["kpi:3", 10], ["kpi:4", 10]] });
assert.equal(strongLow.status, "Strong");
assert.equal(calculateIntelligenceReadiness({
  hasWorkspaceProfile: false,
  hasOriginalFiles: false,
  hasCanonicalKpis: true,
  hasTraceableCustomerOrOperationalRecords: true,
  independentSourceIdentityCount: 1,
  sourceTypeCount: 2,
  canonicalKpiCount: 4,
  kpisWithHistoricalDepth: 0,
  freshKpiCount: 4
}).confidence, "Low", "Strong health can coexist with Low confidence");
assert.equal(maximumReadiness.confidence, "High");
assert.equal(health({ negative: [["risk:1", 18], ["risk:2", 18], ["risk:3", 18]] }).status, "At Risk", "At Risk health can coexist with High confidence");

const scenarioMatrix = {
  minimumEligibleOutcome: {
    health: health({ negative: [["risk:low", 4]] }),
    readiness: calculateIntelligenceReadiness({
      hasWorkspaceProfile: false,
      hasOriginalFiles: true,
      hasCanonicalKpis: false,
      hasTraceableCustomerOrOperationalRecords: true,
      independentSourceIdentityCount: 2,
      sourceTypeCount: 2,
      canonicalKpiCount: 0,
      kpisWithHistoricalDepth: 0,
      freshKpiCount: 0
    })
  },
  fullyPopulatedHealthy: { health: health({ positive: [["kpi:1", 10], ["kpi:2", 10], ["kpi:3", 10], ["kpi:4", 10], ["kpi:5", 10]] }), readiness: maximumReadiness },
  healthyWithMaximumPositivePerformance: { health: health({ positive: [["kpi:1", 10], ["kpi:2", 10], ["kpi:3", 10], ["kpi:4", 10], ["kpi:5", 10], ["kpi:6", 10]] }), readiness: maximumReadiness },
  noFindingsOrOutcomes: { health: health({}), readiness: maximumReadiness },
  strongCoverageNoRisksOrPositiveOutcomes: { health: health({}), readiness: maximumReadiness },
  severeConfirmedRisks: { health: health({ negative: [["risk:1", 18], ["risk:2", 18], ["risk:3", 18]] }), readiness: maximumReadiness },
  strongHealthLowConfidence: {
    health: strongLow,
    readiness: calculateIntelligenceReadiness({
      hasWorkspaceProfile: false,
      hasOriginalFiles: false,
      hasCanonicalKpis: true,
      hasTraceableCustomerOrOperationalRecords: true,
      independentSourceIdentityCount: 1,
      sourceTypeCount: 2,
      canonicalKpiCount: 4,
      kpisWithHistoricalDepth: 0,
      freshKpiCount: 4
    })
  }
};
assert.equal(scenarioMatrix.minimumEligibleOutcome.health.score, 46);
assert.equal(scenarioMatrix.fullyPopulatedHealthy.health.score, 100);
assert.equal(scenarioMatrix.fullyPopulatedHealthy.readiness.confidence, "High");
assert.equal(scenarioMatrix.healthyWithMaximumPositivePerformance.health.score, 100, "the positive cap is 50");
assert.equal(scenarioMatrix.noFindingsOrOutcomes.health.status, "Insufficient Data", "absence of findings is not proof of health");
assert.equal(scenarioMatrix.strongCoverageNoRisksOrPositiveOutcomes.health.status, "Insufficient Data", "documentation and readiness alone cannot create health");
assert.equal(scenarioMatrix.severeConfirmedRisks.health.status, "At Risk");
assert.equal(scenarioMatrix.severeConfirmedRisks.readiness.confidence, "High");
assert.equal(scenarioMatrix.strongHealthLowConfidence.health.status, "Strong");
assert.equal(scenarioMatrix.strongHealthLowConfidence.readiness.confidence, "Low");

const deterministicInput = {
  evidenceEligible: true,
  positiveSignals: signals("positive", [["kpi:1", 10], ["kpi:2", 8]]),
  negativeSignals: signals("negative", [["risk:1", 18], ["risk:2", 10]])
};
assert.deepEqual(calculateBusinessHealthPerformance(deterministicInput), calculateBusinessHealthPerformance(deterministicInput), "Formula V2 must be repeatable");

const fingerprintFacts = { score: 42, status: "At Risk", confidence: "High" };
const v1Fingerprint = evidenceEngineHash({
  generationPolicyVersion: "business_health_generation_policy_v2",
  packageFingerprintInput: { calculationVersions: { businessHealth: BUSINESS_HEALTH_CALCULATION_VERSION_V1, dataQuality: DATA_QUALITY_CALCULATION_VERSION_V1 }, facts: fingerprintFacts }
});
const v2Fingerprint = evidenceEngineHash({
  generationPolicyVersion: "business_health_generation_policy_v2",
  packageFingerprintInput: { calculationVersions: { businessHealth: BUSINESS_HEALTH_CALCULATION_VERSION, dataQuality: DATA_QUALITY_CALCULATION_VERSION }, facts: fingerprintFacts }
});
assert.notEqual(v1Fingerprint, v2Fingerprint, "Formula V2 must make existing explanation artifacts stale once");
assert.equal(businessHealthCalculationVersionFromSourceSummary({}), BUSINESS_HEALTH_CALCULATION_VERSION_V1, "unversioned historical trend rows remain Formula V1");
assert.equal(
  businessHealthCalculationVersionFromSourceSummary({ business_health_calculation_version: BUSINESS_HEALTH_CALCULATION_VERSION }),
  BUSINESS_HEALTH_CALCULATION_VERSION,
  "new history rows retain Formula V2 provenance"
);

const boundaryPoints = buildBusinessHealthTrendDisplayPoints([
  { snapshotDate: "2026-07-27", score: 70, status: "Watch", trend: "Holding steady", calculationVersion: BUSINESS_HEALTH_CALCULATION_VERSION_V1 },
  { snapshotDate: "2026-07-28", score: 72, status: "Watch", trend: "Improving", calculationVersion: BUSINESS_HEALTH_CALCULATION_VERSION_V1 },
  { snapshotDate: "2026-07-29", score: 40, status: "At Risk", trend: "Declining", calculationVersion: BUSINESS_HEALTH_CALCULATION_VERSION },
  { snapshotDate: "2026-07-31", score: 42, status: "At Risk", trend: "Holding steady", calculationVersion: BUSINESS_HEALTH_CALCULATION_VERSION }
], "3M", "2026-07-31");
const transitionBucket = boundaryPoints.filter((point) => point.bucketIndex === boundaryPoints.at(-1).bucketIndex);
assert.equal(transitionBucket.length, 2, "a period crossing the formula boundary must split into two plotted segments");
assert.deepEqual(transitionBucket.map((point) => point.score), [71, 41], "V1 and V2 scores must never share one period average");
assert.notEqual(transitionBucket[0].methodSegment, transitionBucket[1].methodSegment);

const formulaSource = fs.readFileSync(path.join(root, "lib/intelligence/business-health-formula.ts"), "utf8");
const layerSource = fs.readFileSync(path.join(root, "lib/intelligence/layer.ts"), "utf8");
assert.doesNotMatch(formulaSource, /provider|openai|nvidia|business.?note/i, "Formula construction must not call providers or depend on Business Notes");
assert.match(layerSource, /const decisions: DecisionRow\[\] = \[\]/, "leadership decisions remain excluded from score authority");
assert.match(layerSource, /businessHealthEffect\?/, "only explicitly typed deterministic positive performance may add points");

console.log("Business Health Formula V2 regression tests passed.");
console.log(JSON.stringify({
  scenarioMatrix: Object.fromEntries(Object.entries(scenarioMatrix).map(([name, result]) => [name, {
    score: result.health.score,
    status: result.health.status,
    readiness: result.readiness.score,
    confidence: result.readiness.confidence
  }]))
}, null, 2));
