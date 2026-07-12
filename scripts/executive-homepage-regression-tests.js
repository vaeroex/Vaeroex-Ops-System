const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();

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

const { buildExecutiveHomepageModel } = require("../lib/intelligence/executive-homepage.ts");

function snapshotDate(daysAgo = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function insight(overrides = {}) {
  return {
    id: "risk-1",
    type: "Risk",
    title: "Revenue is below target",
    summary: "Revenue is below its current target.",
    why: "The latest eligible KPI is below target.",
    impact: "Leadership may need to review the underlying driver.",
    recommendedAction: "Review revenue performance with leadership.",
    confidence: "High",
    evidence: ["Actual: $7,000", "Target: $8,000"],
    evidenceCount: 2,
    sourceTypes: ["KPIs"],
    sourceHref: "/app/kpis",
    priority: "High",
    lastUpdated: "2026-07-11T10:00:00.000Z",
    ...overrides
  };
}

function intelligence(overrides = {}) {
  const risk = insight();
  const opportunity = insight({
    id: "opportunity-1",
    type: "Opportunity",
    title: "Customer retention is above target",
    summary: "Customer retention remains above its current target.",
    recommendedAction: "Review the practices supporting customer retention.",
    priority: "Medium"
  });

  return {
    executiveSummary: "Revenue needs attention while customer retention remains healthy.",
    businessHealth: { score: 68, status: "Watch", trend: "Holding steady" },
    dataQuality: { score: 71, label: "Strong", confidence: "High", reason: "Multiple sources", suggestedNextData: [] },
    forecastReadiness: {
      state: "directional",
      label: "Directional",
      reason: "Some history is available.",
      ready: false,
      directional: true,
      currentKpiCount: 2,
      totalMeasurementCount: 8,
      readyKpiCount: 0,
      directionalKpiCount: 2,
      historicalDepthLabel: "3 months",
      freshnessLabel: "Current"
    },
    topRisk: risk,
    topOpportunity: opportunity,
    topRecommendation: risk,
    insights: [risk, opportunity],
    memorySummary: { profileSignals: 2, sourceRecords: 7, kpiHistoryRecords: 8, reports: 2, vaeroexRuns: 1, decisions: 0, recommendationOutcomes: 0 },
    ...overrides
  };
}

function coverage(overrides = {}) {
  const categories = [
    { id: "operations", label: "Operations", coverage: 69, recommendedNextUpload: "Add another operating report." },
    { id: "financials", label: "Financials", coverage: 31, recommendedNextUpload: "Add two more months of financial history." }
  ];

  return {
    overallCoverage: 61,
    overallConfidenceLabel: "Partial",
    overallReason: "Useful context is available with material gaps.",
    categories,
    confidenceOverTime: [],
    sourceMix: [],
    dataGaps: [],
    recommendedNextUpload: "Add more history.",
    forecastReadiness: {},
    ...overrides
  };
}

function snapshot(overrides = {}) {
  return {
    id: "snapshot-1",
    workspace_id: "workspace-1",
    snapshot_date: snapshotDate(1),
    score: 72,
    status: "Watch",
    trend: "Holding steady",
    data_confidence: "Medium",
    data_quality_score: 60,
    memory_signal_count: 10,
    source_summary: {},
    created_at: "2026-07-10T10:00:00.000Z",
    updated_at: "2026-07-10T10:00:00.000Z",
    ...overrides
  };
}

const populated = buildExecutiveHomepageModel({
  intelligence: intelligence(),
  coverage: coverage(),
  snapshots: [snapshot(), snapshot({ id: "snapshot-2", snapshot_date: snapshotDate(), score: 68, data_confidence: "High" })],
  kpiTrends: [{ name: "Revenue", changePercent: -4.2 }],
  sourceDataAvailable: true
});
assert.equal(populated.health.score, 68, "valid Business Health must render");
assert.equal(populated.health.trendDelta, -4, "stored snapshots must drive the visible change");
assert.equal(populated.priorities.length, 3, "exactly three priorities must render");
assert.doesNotMatch(populated.priorities[0].title, /may indicate a pattern/i, "homepage titles must state the supported issue directly");
assert.equal(populated.changes.state, "changes");

const longOutput = buildExecutiveHomepageModel({
  intelligence: intelligence({
    topRisk: insight({
      title: "A".repeat(500),
      summary: "B".repeat(700),
      recommendedAction: "C".repeat(700)
    })
  }),
  coverage: coverage(), snapshots: [], kpiTrends: [], sourceDataAvailable: true
});
assert.ok(longOutput.priorities[0].title.length <= 364, "priority titles must be safely length-bounded");
assert.ok(longOutput.priorities[0].summary.length <= 364, "priority summaries must be safely length-bounded");

const firstReview = buildExecutiveHomepageModel({
  intelligence: intelligence(), coverage: coverage(), snapshots: [], kpiTrends: [], sourceDataAvailable: true
});
assert.equal(firstReview.changes.state, "first_review");
assert.equal(firstReview.health.trend, null, "insufficient history must not claim a trend");

const noFindings = buildExecutiveHomepageModel({
  intelligence: intelligence({ topRisk: undefined, topOpportunity: undefined, topRecommendation: undefined, insights: [] }),
  coverage: coverage(), snapshots: [], kpiTrends: [], sourceDataAvailable: true
});
assert.equal(noFindings.priorities[0].empty, true, "missing risk must use an intentional empty state");
assert.equal(noFindings.priorities[1].empty, true, "missing opportunity must use an intentional empty state");

const unavailable = buildExecutiveHomepageModel({
  intelligence: intelligence(), coverage: coverage(), snapshots: [], kpiTrends: [], sourceDataAvailable: false
});
assert.equal(unavailable.health.score, null, "failed required queries must suppress Business Health");
assert.equal(unavailable.changes.state, "unavailable");
assert.equal(unavailable.readiness.available, false, "failed required queries must suppress readiness conclusions");
assert.ok(unavailable.priorities.every((item) => item.empty), "failed source queries must not create homepage findings");

const onePriorReview = buildExecutiveHomepageModel({
  intelligence: intelligence(), coverage: coverage(), snapshots: [snapshot()], kpiTrends: [], sourceDataAvailable: true
});
assert.equal(onePriorReview.changes.state, "changes", "a prior-day snapshot must be the comparison baseline");

const partial = buildExecutiveHomepageModel({
  intelligence: intelligence(), coverage: coverage({ overallCoverage: 55 }), snapshots: [], kpiTrends: [], sourceDataAvailable: true
});
assert.equal(partial.readiness.label, "Partial");
assert.equal(partial.readiness.largestGap, "Financials");

const loadingSource = fs.readFileSync(path.join(root, "app/app/loading.tsx"), "utf8");
const homepageSource = fs.readFileSync(path.join(root, "components/intelligence/ExecutiveHomepage.tsx"), "utf8");
assert.match(loadingSource, /animate-pulse/, "homepage route must retain a visible loading state");
assert.match(homepageSource, /md:grid-cols-2 xl:grid-cols-3/, "priority cards must stack responsively");
assert.match(homepageSource, /grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3/, "priority cards must not stretch to the tallest sibling");
assert.match(homepageSource, /Business Health needs more eligible evidence/, "homepage must include a calm insufficient-evidence state");
assert.doesNotMatch(homepageSource, /GlobalSearchTrigger|Ask Vaeroex|Help/, "executive header must not duplicate global navigation actions");

process.stdout.write("Executive homepage regressions passed.\n");
