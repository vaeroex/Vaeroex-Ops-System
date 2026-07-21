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

const decimalSummary = buildExecutiveHomepageModel({
  intelligence: intelligence({
    topRisk: insight({
      summary: "Gross margin declined from 52.1% to 49.8%. Revenue remains below target."
    })
  }),
  coverage: coverage(),
  snapshots: [],
  kpiTrends: [],
  sourceDataAvailable: true
});
assert.equal(
  decimalSummary.health.summary,
  "Gross margin declined from 52.1% to 49.8%. Revenue remains below target.",
  "sentence compaction must not split decimal values"
);

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
const appShellSource = fs.readFileSync(path.join(root, "components/app/AppShell.tsx"), "utf8");
const navigationSource = fs.readFileSync(path.join(root, "components/app/AppNavigation.tsx"), "utf8");
const sourcesPageSource = fs.readFileSync(path.join(root, "app/app/sources/page.tsx"), "utf8");
const intelligencePageSource = fs.readFileSync(path.join(root, "app/app/intelligence/page.tsx"), "utf8");
const healthTrendSource = fs.readFileSync(path.join(root, "components/intelligence/BusinessHealthTrendChart.tsx"), "utf8");
const kpiPageSource = fs.readFileSync(path.join(root, "app/app/kpis/page.tsx"), "utf8");
assert.match(loadingSource, /animate-pulse/, "homepage route must retain a visible loading state");
assert.match(homepageSource, /lg:grid-cols-\[1fr_1fr_\.78fr\]/, "executive focus and readiness cards must use horizontal space without forcing mobile columns");
assert.match(homepageSource, /Needs Attention/, "risk and leadership decision must be consolidated into one focus card");
assert.match(homepageSource, /Positive Signal/, "the positive signal must remain distinct");
assert.match(homepageSource, /Business Health needs more eligible evidence/, "homepage must include a calm insufficient-evidence state");
assert.match(homepageSource, /Validated executive interpretation/, "the Version 1 homepage must label the visible validated interpretation correctly");
assert.match(homepageSource, /lg:grid-cols-\[minmax\(220px,\.62fr\)_minmax\(0,1\.38fr\)\]/, "the Version 1 Business Health snapshot must retain its score and interpretation columns");
assert.match(homepageSource, /sm:text-right/, "the Version 1 snapshot must keep confidence aligned opposite the main driver");
assert.doesNotMatch(homepageSource, /<ExecutiveBriefPanel/, "the Version 1 homepage must keep Business Health as the cohesive opening snapshot");
assert.doesNotMatch(homepageSource, /GlobalSearchTrigger|Ask Vaeroex|Help/, "executive header must not duplicate global navigation actions");
assert.match(homepageSource, /trendDelta !== null && healthHistory\.length >= 2/, "the trend chart must require valid historical depth");
assert.doesNotMatch(healthTrendSource, /buildDemoTrendPoints|Sample demo trend/, "Business Health must not fabricate a demo trend when history is insufficient");
assert.doesNotMatch(homepageSource, /View full intelligence|Executive Brief/, "Overview must not expose redundant page actions or report generation");
assert.doesNotMatch(intelligencePageSource, /Business Health|Business Intelligence Coverage|What leadership should know/, "Intelligence must start with findings instead of repeating Overview");
for (const label of ["Overview", "Intelligence", "Performance", "Evidence", "Reports", "Settings"]) {
  assert.match(appShellSource, new RegExp(`label: "${label}"`), `authenticated navigation must expose ${label} as a primary concept`);
}
assert.match(appShellSource, /label: "Primary",\s*collapsible: false/, "primary navigation must not be hidden in a workspace accordion");
assert.match(appShellSource, /label: "Business Memory"/, "Business Signals must sit under the Business Memory label");
assert.match(navigationSource, /pathname\.startsWith\(`\$\{href\}\//, "nested report draft routes must keep Reports active");
assert.doesNotMatch(appShellSource, /href: "\/app", label: "Home"/, "authenticated navigation must use Overview instead of Home");
assert.match(sourcesPageSource, />Evidence<\//, "the Sources workspace must present the broader Evidence purpose");
assert.match(sourcesPageSource, /update_source_file_lifecycle|manageSourceFileAction/, "evidence presentation changes must retain lifecycle controls");
assert.match(sourcesPageSource, /\["queued", "pending", "running", "processing"\]\.includes\(latestRun\.status\)/, "Analyzing must require a current active run");
assert.doesNotMatch(sourcesPageSource, /processing_status \|\| ""\) === "processing"\) return "Analyzing"/, "a stale file processing field must not display Analyzing without an active run");
assert.match(sourcesPageSource, /hasCompletedAnalysis[\s\S]*if \(hasCompletedAnalysis\) return "Needs Review";/, "completed analysis must remain visible after processing finishes");
assert.match(sourcesPageSource, /tab\.key !== "knowledge"[\s\S]*memoryChunks\.some/, "zero-count Learned Knowledge must be hidden");
assert.match(kpiPageSource, /function explicitKpiDirection/, "KPI directionality must come from explicit existing metadata");
assert.match(kpiPageSource, /actual === null \|\| target === null \|\| !direction/, "KPI status must remain neutral without explicit direction");
assert.match(kpiPageSource, /if \(tone === "neutral"\) return null/, "neutral KPIs must not show favorable or unfavorable status badges");
assert.match(kpiPageSource, /!\(key === "status" && value === "all"\)/, "the KPI URL builder must preserve show=all while omitting the default status");
assert.match(kpiPageSource, /showAllTiles \? filteredLatestKpiRows : filteredLatestKpiRows\.slice\(0, INITIAL_KPI_CARD_COUNT\)/, "expanded KPI rendering must use the full filtered result set");
assert.match(kpiPageSource, /showAllTiles \? "Show fewer KPIs" : `Show all \$\{filteredLatestKpiRows\.length\} KPIs`/, "the KPI expansion control must expose both expanded and collapsed labels");
assert.doesNotMatch(kpiPageSource, /Loading Compare/, "Compare must not retain a stale loading label");
assert.doesNotMatch(kpiPageSource, /Biggest positive movement|Biggest risk signal/, "comparison summaries must not assign business meaning without directionality");

process.stdout.write("Executive homepage regressions passed.\n");
