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

const {
  buildBusinessHealthTrendBuckets,
  buildBusinessHealthTrendDisplayPoints,
  businessHealthTrendRangeStart,
  filterStoredBusinessHealthTrendPoints
} = require("../lib/intelligence/business-health-trend.ts");
const { buildIntelligenceLayer } = require("../lib/intelligence/layer.ts");

const asOfDate = "2026-07-31";
const storedPoints = [
  { snapshotDate: "2025-12-31", score: 40, status: "At Risk", trend: "Declining" },
  { snapshotDate: "2026-01-01", score: 42, status: "At Risk", trend: "Holding steady" },
  { snapshotDate: "2026-01-31", score: 20, status: "At Risk", trend: "Holding steady" },
  { snapshotDate: "2026-02-13", score: 40, status: "At Risk", trend: "Holding steady" },
  { snapshotDate: "2026-04-30", score: 50, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-05-02", score: 20, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-05-08", score: 40, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-05-09", score: 60, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-06-30", score: 54, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-07-02", score: 52, status: "Watch", trend: "Holding steady" },
  { snapshotDate: "2026-07-25", score: 55, status: "Watch", trend: "Holding steady" },
  { snapshotDate: "2026-07-27", score: 57, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-07-31", score: 80, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-08-01", score: 99, status: "Strong", trend: "Improving" }
];

assert.equal(businessHealthTrendRangeStart("7D", asOfDate), "2026-07-25");
assert.equal(businessHealthTrendRangeStart("1M", asOfDate), "2026-07-02");
assert.equal(businessHealthTrendRangeStart("3M", asOfDate), "2026-05-02");
assert.equal(businessHealthTrendRangeStart("6M", asOfDate), "2026-01-31");
assert.equal(businessHealthTrendRangeStart("YTD", asOfDate), "2026-01-01");

assert.equal(buildBusinessHealthTrendBuckets("7D", asOfDate).length, 7, "7 Days must expose seven calendar-day slots");
assert.equal(buildBusinessHealthTrendBuckets("1M", asOfDate).length, 30, "1 Month must expose thirty calendar-day slots");
assert.equal(buildBusinessHealthTrendBuckets("3M", asOfDate).length, 13, "3 Months must expose thirteen weekly slots");
assert.equal(buildBusinessHealthTrendBuckets("6M", asOfDate).length, 13, "6 Months must expose thirteen two-week slots");
assert.equal(buildBusinessHealthTrendBuckets("YTD", asOfDate).length, 7, "YTD must expose every calendar month through July");
assert.deepEqual(
  buildBusinessHealthTrendBuckets("3M", asOfDate).at(-1),
  { key: "2026-07-25:2026-07-31", startDate: "2026-07-25", endDate: "2026-07-31", kind: "weekly_average" },
  "the latest date must remain in the final weekly period"
);
assert.deepEqual(
  buildBusinessHealthTrendBuckets("6M", asOfDate).at(-1),
  { key: "2026-07-18:2026-07-31", startDate: "2026-07-18", endDate: "2026-07-31", kind: "biweekly_average" },
  "the latest date must remain in the final two-week period"
);

assert.deepEqual(
  filterStoredBusinessHealthTrendPoints(storedPoints, "7D", asOfDate).map((point) => point.snapshotDate),
  ["2026-07-25", "2026-07-27", "2026-07-31"],
  "the 7-day range must retain only actual stored dates"
);
assert.deepEqual(
  filterStoredBusinessHealthTrendPoints(storedPoints, "1M", asOfDate).map((point) => point.snapshotDate),
  ["2026-07-02", "2026-07-25", "2026-07-27", "2026-07-31"]
);
assert.deepEqual(
  filterStoredBusinessHealthTrendPoints(storedPoints, "3M", asOfDate).map((point) => point.snapshotDate),
  ["2026-05-02", "2026-05-08", "2026-05-09", "2026-06-30", "2026-07-02", "2026-07-25", "2026-07-27", "2026-07-31"]
);
assert.equal(filterStoredBusinessHealthTrendPoints([], "7D", asOfDate).length, 0, "no current or synthetic point may be inserted");

const dailyPoints = buildBusinessHealthTrendDisplayPoints(storedPoints, "7D", asOfDate);
assert.deepEqual(dailyPoints.map((point) => point.startDate), ["2026-07-25", "2026-07-27", "2026-07-31"]);
assert.ok(dailyPoints.every((point) => point.kind === "daily" && point.sampleCount === 1), "daily views must not aggregate or invent dates");
assert.deepEqual(dailyPoints.map((point) => point.bucketIndex), [0, 2, 6], "missing daily slots must remain empty rather than carried forward");

const monthlyDailyPoints = buildBusinessHealthTrendDisplayPoints(storedPoints, "1M", asOfDate);
assert.deepEqual(monthlyDailyPoints.map((point) => point.startDate), ["2026-07-02", "2026-07-25", "2026-07-27", "2026-07-31"]);
assert.ok(monthlyDailyPoints.every((point) => point.kind === "daily"), "the 30-day view must retain every stored daily point");

const weeklyPoints = buildBusinessHealthTrendDisplayPoints(storedPoints, "3M", asOfDate);
assert.deepEqual(weeklyPoints[0], {
  key: "2026-05-02:2026-05-08:method-0",
  startDate: "2026-05-02",
  endDate: "2026-05-08",
  kind: "weekly_average",
  bucketIndex: 0,
  score: 30,
  sampleCount: 2,
  sourceDates: ["2026-05-02", "2026-05-08"],
  calculationVersion: "business_health_calculation_v1",
  methodSegment: 0
}, "weekly points must average only stored daily scores within their period");
assert.equal(weeklyPoints.at(-1).bucketIndex, 12, "the latest available score must be represented in the final weekly period");
assert.equal(weeklyPoints.at(-1).score, 64, "the final weekly average must use every stored score in that week");

const biweeklyPoints = buildBusinessHealthTrendDisplayPoints(storedPoints, "6M", asOfDate);
assert.equal(biweeklyPoints[0].score, 30, "two-week periods must average only their stored daily scores");
assert.equal(biweeklyPoints[0].sampleCount, 2);
assert.equal(biweeklyPoints.at(-1).bucketIndex, 12, "the latest score must be represented in the final two-week period");

const ytdPoints = buildBusinessHealthTrendDisplayPoints(storedPoints, "YTD", asOfDate);
assert.equal(ytdPoints[0].kind, "monthly_average");
assert.equal(ytdPoints[0].score, 31, "monthly periods must average only the stored daily scores in that calendar month");
assert.equal(ytdPoints.at(-1).startDate, "2026-07-01");
assert.ok(!ytdPoints.some((point) => point.startDate === "2026-03-01"), "months without history must remain missing");

const formulaBoundaryPoints = buildBusinessHealthTrendDisplayPoints([
  { snapshotDate: "2026-07-25", score: 70, status: "Watch", trend: "Holding steady", calculationVersion: "business_health_calculation_v1" },
  { snapshotDate: "2026-07-27", score: 72, status: "Watch", trend: "Improving", calculationVersion: "business_health_calculation_v1" },
  { snapshotDate: "2026-07-29", score: 40, status: "At Risk", trend: "Declining", calculationVersion: "business_health_calculation_v2" },
  { snapshotDate: "2026-07-31", score: 42, status: "At Risk", trend: "Holding steady", calculationVersion: "business_health_calculation_v2" }
], "3M", asOfDate);
const boundaryBucket = formulaBoundaryPoints.filter((point) => point.bucketIndex === 12);
assert.equal(boundaryBucket.length, 2, "one aggregate period crossing V1 and V2 must be split at the scoring-method boundary");
assert.deepEqual(boundaryBucket.map((point) => point.score), [71, 41], "V1 and V2 scores must never be averaged together");
assert.notEqual(boundaryBucket[0].methodSegment, boundaryBucket[1].methodSegment, "the chart must expose a disconnected formula segment");

const intelligence = buildIntelligenceLayer({
  files: [
    { id: "active-file", display_name: "Operations.csv", archived_at: null, deleted_at: null, created_at: "2026-07-30T00:00:00.000Z" },
    { id: "archived-file", display_name: "Old.csv", archived_at: "2026-07-30T00:00:00.000Z", deleted_at: null, created_at: "2026-07-20T00:00:00.000Z" },
    { id: "deleted-file", display_name: "Removed.csv", archived_at: null, deleted_at: "2026-07-30T00:00:00.000Z", created_at: "2026-07-20T00:00:00.000Z" }
  ]
});
const categories = intelligence.memorySummary.eligibleSignalCategories;
const categoryTotal = categories.reduce((total, category) => total + category.count, 0);
assert.equal(categoryTotal, intelligence.memorySummary.sourceRecords + intelligence.memorySummary.kpiHistoryRecords, "signal categories must equal the authoritative displayed total");
assert.equal(categories.find((category) => category.id === "files").count, 1, "archived and deleted records must be excluded by canonical eligibility");
assert.ok(categories.every((category) => !category.label.includes("_")), "signal labels must remain customer-friendly");

const chartSource = fs.readFileSync(path.join(root, "components/intelligence/BusinessHealthTrendChart.tsx"), "utf8");
const signalsSource = fs.readFileSync(path.join(root, "components/intelligence/EligibleBusinessSignals.tsx"), "utf8");
const homepageSource = fs.readFileSync(path.join(root, "components/intelligence/ExecutiveHomepage.tsx"), "utf8");
const historySource = fs.readFileSync(path.join(root, "lib/intelligence/business-health-history.ts"), "utf8");
const historyMigration = fs.readFileSync(path.join(root, "supabase/migrations/202607080001_business_health_snapshots.sql"), "utf8");

for (const label of ["7 Days", "1 Month", "3 Months", "6 Months", "YTD"]) assert.match(chartSource, new RegExp(label));
assert.doesNotMatch(chartSource, /currentScore|linearGradient/, "the chart must not inject current or synthetic Business Health values");
assert.match(chartSource, /Y_AXIS_VALUES = \[100, 75, 50, 25, 0\]/, "the fixed Business Health axis must label every 25-point interval");
assert.match(chartSource, /buildBusinessHealthTrendBuckets/, "X-axis periods must come from the selected calendar range rather than sparse stored points");
assert.match(chartSource, /buildBusinessHealthTrendDisplayPoints/, "plotted data must use the canonical stored-history projection");
assert.match(chartSource, /Scoring method updated/, "the chart must label a V1 to V2 boundary");
assert.doesNotMatch(chartSource, /Formula V1 history remains visible/, "the chart must not expose the internal Formula V1 migration explanation");
assert.match(chartSource, /point\.methodSegment !== previous\.methodSegment/, "the chart must not connect V1 and V2 scores");
assert.match(chartSource, /methodOffset/, "V1 and V2 points sharing one aggregate period must remain visually distinct");
assert.match(chartSource, /strokeDasharray=\{crossesMissingPeriod/, "missing periods must remain visually distinguishable without becoming zero");
for (const tooltipLabel of ["Daily score", "Weekly average", "Two-week average", "Monthly average", "Average Business Health"]) {
  assert.match(chartSource, new RegExp(tooltipLabel), `tooltips must include ${tooltipLabel}`);
}
assert.match(chartSource, /onPointerEnter[\s\S]*onFocus[\s\S]*onClick/, "stored and averaged points must support hover, keyboard focus, and click details");
assert.match(chartSource, /More stored Business Health history is needed/, "insufficient history must have an explicit empty state");
assert.match(historySource, /\.eq\("workspace_id", workspaceId\)/, "history reads must remain workspace-scoped");
assert.match(historyMigration, /unique \(workspace_id, snapshot_date\)/, "one stored daily snapshot must remain the canonical selection rule");

assert.match(signalsSource, /Eligible Business Signals are the approved pieces of business information/, "the approved explanation must render");
assert.match(signalsSource, /aria-haspopup="dialog"[\s\S]*aria-expanded/, "the breakdown trigger must expose accessible state");
assert.match(signalsSource, /event\.key !== "Escape"/, "Escape must close the breakdown");
assert.match(signalsSource, /category\.count > 0/, "zero-count categories must be omitted");
assert.match(signalsSource, /onClick/, "the breakdown and explanation must support click and tap");
assert.match(homepageSource, /Highest Impact Driver/, "the approved driver label must replace Main Driver");
assert.doesNotMatch(homepageSource, />Main driver</, "the old presentation label must be retired");

for (const source of [chartSource, signalsSource]) {
  assert.doesNotMatch(source, /generate|provider|openai|nvidia/i, "Overview interactions must not invoke AI providers");
}

process.stdout.write("Overview insight regressions passed.\n");
