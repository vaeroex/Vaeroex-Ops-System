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
    supportingRecords: [{
      id: "kpi:revenue-1",
      title: "Revenue",
      recordType: "KPI record",
      date: "2026-07-11",
      value: "Actual $7,000 · Target $8,000",
      support: "The latest recorded value is below target.",
      href: "/app/kpis?metric=Revenue&section=detail",
      classification: "Original",
      sourceKey: "manual-kpi:revenue"
    }],
    sourceTypes: ["KPIs"],
    sourceHref: "/app/kpis",
    priority: "High",
    lastUpdated: "2026-07-11T10:00:00.000Z",
    affectedArea: "Revenue",
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
    memorySummary: {
      profileSignals: 2,
      sourceRecords: 7,
      kpiHistoryRecords: 8,
      vaeroexRuns: 1,
      decisions: 0,
      recommendationOutcomes: 0,
      eligibleSignalCategories: [
        { id: "kpi_observations", label: "KPI observations", count: 8 },
        { id: "kpi_series", label: "KPI series", count: 2 },
        { id: "files", label: "Files", count: 5 }
      ]
    },
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
    source_summary: { business_health_calculation_version: "business_health_calculation_v2" },
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
assert.equal(populated.health.status, "Watch", "the customer-visible status must use the authoritative Formula V2 label");
assert.equal(populated.health.trendDelta, -4, "stored snapshots must drive the visible change");
assert.equal(populated.health.displayTitle, "Revenue is below target", "the executive takeaway must use the deterministic finding title");
assert.deepEqual(populated.health.driverPresentation, {
  identity: "Revenue",
  details: ["Actual: $7,000", "Target: $8,000"]
}, "KPI drivers must show their identity before applicable actual and target values");
assert.equal(populated.health.summary, "Revenue is below its current target.", "the existing deterministic summary contract must remain unchanged");
assert.equal(populated.health.driver, "Actual: $7,000", "the existing deterministic driver contract must remain unchanged");
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

const operationalDriver = buildExecutiveHomepageModel({
  intelligence: intelligence({
    topRisk: insight({
      title: "Delayed orders remain elevated",
      summary: "Fourteen active delays remain open.",
      affectedArea: "Delayed Orders",
      sourceTypes: ["Issues"],
      evidence: ["14 active delays"],
      supportingRecords: []
    })
  }),
  coverage: coverage(), snapshots: [], kpiTrends: [], sourceDataAvailable: true
});
assert.equal(operationalDriver.health.displayTitle, "Delayed orders remain elevated");
assert.deepEqual(operationalDriver.health.driverPresentation, {
  identity: "Delayed Orders",
  details: ["14 active delays"]
}, "non-KPI drivers must show an understandable identity with only applicable detail");

const valueOnlyTitle = buildExecutiveHomepageModel({
  intelligence: intelligence({
    topRisk: insight({
      title: "Actual 37 vs target 0",
      affectedArea: "1-Star Reviews",
      evidence: ["Actual: 37", "Target: 0"],
      supportingRecords: [{
        id: "kpi:reviews-1",
        title: "1-Star Reviews",
        recordType: "KPI record",
        date: "2026-07-11",
        value: "Actual 37 · Target 0",
        support: "The latest recorded value is above target.",
        href: "/app/kpis?metric=1-Star%20Reviews&section=detail",
        classification: "Original",
        sourceKey: "manual-kpi:1-star-reviews"
      }]
    })
  }),
  coverage: coverage(), snapshots: [], kpiTrends: [], sourceDataAvailable: true
});
assert.equal(valueOnlyTitle.health.displayTitle, "1-Star Reviews requires attention", "value-only titles must fall back to the authoritative driver identity");
assert.deepEqual(valueOnlyTitle.health.driverPresentation, {
  identity: "1-Star Reviews",
  details: ["Actual: 37", "Target: 0"]
});
assert.doesNotMatch(valueOnlyTitle.health.displayTitle, /^(?:Actual|Value)\b|^\d+(?:[.,]\d+)?\s+(?:above|below|over|under|vs\.?|versus)\b/i, "value-only titles must never render");

const businessNoteBoundary = buildExecutiveHomepageModel({
  intelligence: intelligence({
    topRisk: insight({
      title: "Leadership note says a customer is unhappy",
      summary: "A Business Note reports an unhappy customer.",
      affectedArea: "Leadership context",
      sourceTypes: ["Business Notes"],
      evidence: ["Business Note: customer concern"],
      supportingRecords: []
    })
  }),
  coverage: coverage(), snapshots: [], kpiTrends: [], sourceDataAvailable: true
});
assert.doesNotMatch(businessNoteBoundary.health.displayTitle, /note|customer is unhappy/i, "Business Notes must not become the Overview headline");
assert.doesNotMatch(businessNoteBoundary.health.driverPresentation.identity, /note|customer/i, "Business Notes must not become the Highest Impact Driver");

const dismissedPresentation = buildExecutiveHomepageModel({
  intelligence: intelligence({ topRisk: insight({ lifecycleState: "dismissed" }) }),
  coverage: coverage(), snapshots: [], kpiTrends: [], sourceDataAvailable: true
});
assert.equal(dismissedPresentation.health.displayTitle, populated.health.displayTitle, "presentation lifecycle metadata must not alter the deterministic title");

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

const formulaBoundaryReview = buildExecutiveHomepageModel({
  intelligence: intelligence(),
  coverage: coverage(),
  snapshots: [snapshot({
    source_summary: { business_health_calculation_version: "business_health_calculation_v1" },
    score: 92
  })],
  kpiTrends: [],
  sourceDataAvailable: true
});
assert.equal(formulaBoundaryReview.health.trendDelta, null, "V1 history must not produce a continuous delta against Formula V2");
assert.equal(formulaBoundaryReview.changes.state, "first_review", "the first V2 review begins a new comparison series");

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
const homepageModelSource = fs.readFileSync(path.join(root, "lib/intelligence/executive-homepage.ts"), "utf8");
const businessHealthContextSource = fs.readFileSync(path.join(root, "lib/ai/business-health-explanation/context.ts"), "utf8");
const snapshotFingerprintSource = fs.readFileSync(path.join(root, "lib/intelligence/snapshot/v1/fingerprints.ts"), "utf8");
assert.match(loadingSource, /animate-pulse/, "homepage route must retain a visible loading state");
assert.match(homepageSource, /lg:grid-cols-\[1fr_1fr_\.78fr\]/, "executive focus and readiness cards must use horizontal space without forcing mobile columns");
assert.match(homepageSource, /Needs Attention/, "risk and leadership decision must be consolidated into one focus card");
assert.match(homepageSource, /Top Opportunity/, "the opportunity must remain distinct without being presented as a positive signal");
assert.match(homepageSource, /Business Health needs more eligible evidence/, "homepage must include a calm insufficient-evidence state");
assert.match(homepageSource, /Validated executive interpretation/, "the Version 1 homepage must label the visible validated interpretation correctly");
assert.match(homepageSource, /lg:grid-cols-\[minmax\(220px,\.62fr\)_minmax\(0,1\.38fr\)\]/, "the Version 1 Business Health snapshot must retain its score and interpretation columns");
assert.match(homepageSource, />Executive Overview<\//, "Overview must use a stable executive heading instead of a time-based greeting");
assert.doesNotMatch(homepageSource, /Good morning|Good afternoon|Good evening/, "Overview must not contain time-of-day greetings");
for (const label of ["Current state", "Since previous review", "Confidence"]) {
  assert.match(homepageSource, new RegExp(`>${label}<`), `the compact Business Health summary must expose ${label}`);
}
assert.match(homepageSource, /No previous review available\./, "the compact summary must handle a missing prior review cleanly");
assert.match(homepageSource, /trendDelta === 0[\s\S]*\? "Unchanged"/, "an unchanged review must use concise deterministic wording");
assert.equal((homepageSource.match(/>Highest Impact Driver<\//g) || []).length, 1, "Highest Impact Driver must not be duplicated");
assert.doesNotMatch(homepageModelSource, /runStructuredAI|OpenAIProvider|NvidiaProvider|createAI|fetch\(/, "Overview presentation must make zero provider calls");
assert.match(businessHealthContextSource, /deterministicSummary:\s*homepage\.health\.summary/, "Business Health provider context must keep the existing deterministic summary field");
assert.doesNotMatch(businessHealthContextSource, /displayTitle|driverPresentation/, "presentation-only fields must not enter Business Health provider context");
assert.doesNotMatch(snapshotFingerprintSource, /displayTitle|driverPresentation/, "presentation-only fields must not affect snapshot fingerprints");
assert.doesNotMatch(homepageSource, /<ExecutiveBriefPanel/, "the Version 1 homepage must keep Business Health as the cohesive opening snapshot");
assert.doesNotMatch(homepageSource, /GlobalSearchTrigger|Ask Vaeroex|Help/, "executive header must not duplicate global navigation actions");
assert.match(homepageSource, /model\.health\.available[\s\S]*<BusinessHealthTrendChart/, "the stored-history chart must own its insufficient-history state whenever Business Health is available");
assert.doesNotMatch(healthTrendSource, /buildDemoTrendPoints|Sample demo trend/, "Business Health must not fabricate a demo trend when history is insufficient");
assert.doesNotMatch(homepageSource, /View full intelligence|Executive Brief/, "Overview must not expose redundant page actions or report generation");
assert.doesNotMatch(intelligencePageSource, /Business Health|Business Intelligence Coverage|What leadership should know/, "Intelligence must start with findings instead of repeating Overview");
for (const label of ["Overview", "Intelligence", "Performance", "Evidence", "Saved Analyses", "Settings"]) {
  assert.match(appShellSource, new RegExp(`label: "${label}"`), `authenticated navigation must expose ${label} as a primary concept`);
}
assert.match(appShellSource, /label: "Primary",\s*collapsible: false/, "primary navigation must not be hidden in a workspace accordion");
assert.doesNotMatch(appShellSource, /Business Signals?|href: "\/app\/tasks"/, "retired Business Signals must not remain in authenticated navigation");
assert.match(navigationSource, /pathname\.startsWith\(`\$\{href\}\//, "nested Saved Analysis routes must keep their navigation item active");
assert.doesNotMatch(appShellSource, /href: "\/app", label: "Home"/, "authenticated navigation must use Overview instead of Home");
assert.match(sourcesPageSource, />Evidence<\//, "the Sources workspace must present the broader Evidence purpose");
assert.match(sourcesPageSource, /update_source_file_lifecycle|manageSourceFileAction/, "evidence presentation changes must retain lifecycle controls");
assert.match(sourcesPageSource, /\["queued", "pending", "running", "processing"\]\.includes\(latestRun\.status\)/, "Analyzing must require a current active run");
assert.doesNotMatch(sourcesPageSource, /processing_status \|\| ""\) === "processing"\) return "Analyzing"/, "a stale file processing field must not display Analyzing without an active run");
assert.match(sourcesPageSource, /hasCompletedAnalysis[\s\S]*if \(hasCompletedAnalysis\) return "Needs Review";/, "completed analysis must remain visible after processing finishes");
assert.match(sourcesPageSource, /tab\.key !== "knowledge"[\s\S]*activeKnowledgeRows\.length > 0/, "zero-count Learned Knowledge must be hidden");
assert.match(kpiPageSource, /kpiSemantics\(name, settings\)\.desiredDirection/, "KPI directionality must come from validated semantic metadata");
assert.match(kpiPageSource, /actual === null \|\| semantics\.desiredDirection === "unknown"/, "KPI status must remain neutral without confirmed semantics");
assert.match(kpiPageSource, /resolveKpiTargetReference\(semantics, row\.target\)\.kind === "none"/, "target availability must include canonical semantic targets and ranges");
assert.match(kpiPageSource, /if \(semantics\.desiredDirection === "unknown"\) return "Direction not set"/, "KPIs without a confirmed direction must remain neutral");
assert.match(kpiPageSource, /!\(key === "status" && value === "all"\)/, "the KPI URL builder must preserve show=all while omitting the default status");
assert.match(kpiPageSource, /showAllTiles \? filteredLatestKpiRows : filteredLatestKpiRows\.slice\(0, INITIAL_KPI_CARD_COUNT\)/, "expanded KPI rendering must use the full filtered result set");
assert.match(kpiPageSource, /showAllTiles \? "Show fewer KPIs" : `Show all \$\{filteredLatestKpiRows\.length\} KPIs`/, "the KPI expansion control must expose both expanded and collapsed labels");
assert.doesNotMatch(kpiPageSource, /Loading Compare/, "Compare must not retain a stale loading label");
assert.doesNotMatch(kpiPageSource, /Biggest positive movement|Biggest risk signal/, "comparison summaries must not assign business meaning without directionality");

process.stdout.write("Executive homepage regressions passed.\n");
