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
  areConsecutiveBusinessHealthDates,
  businessHealthTrendRangeStart,
  filterStoredBusinessHealthTrendPoints
} = require("../lib/intelligence/business-health-trend.ts");
const { buildIntelligenceLayer } = require("../lib/intelligence/layer.ts");

const asOfDate = "2026-07-31";
const storedPoints = [
  { snapshotDate: "2025-12-31", score: 40, status: "At Risk", trend: "Declining" },
  { snapshotDate: "2026-01-01", score: 42, status: "At Risk", trend: "Holding steady" },
  { snapshotDate: "2026-01-31", score: 44, status: "At Risk", trend: "Holding steady" },
  { snapshotDate: "2026-04-30", score: 50, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-06-30", score: 54, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-07-25", score: 55, status: "Watch", trend: "Holding steady" },
  { snapshotDate: "2026-07-27", score: 57, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-07-31", score: 60, status: "Watch", trend: "Improving" },
  { snapshotDate: "2026-08-01", score: 99, status: "Strong", trend: "Improving" }
];

assert.equal(businessHealthTrendRangeStart("7D", asOfDate), "2026-07-25");
assert.equal(businessHealthTrendRangeStart("1M", asOfDate), "2026-06-30");
assert.equal(businessHealthTrendRangeStart("3M", asOfDate), "2026-04-30");
assert.equal(businessHealthTrendRangeStart("6M", asOfDate), "2026-01-31");
assert.equal(businessHealthTrendRangeStart("YTD", asOfDate), "2026-01-01");

assert.deepEqual(
  filterStoredBusinessHealthTrendPoints(storedPoints, "7D", asOfDate).map((point) => point.snapshotDate),
  ["2026-07-25", "2026-07-27", "2026-07-31"],
  "the 7-day range must retain only actual stored dates"
);
assert.deepEqual(
  filterStoredBusinessHealthTrendPoints(storedPoints, "1M", asOfDate).map((point) => point.snapshotDate),
  ["2026-06-30", "2026-07-25", "2026-07-27", "2026-07-31"]
);
assert.deepEqual(
  filterStoredBusinessHealthTrendPoints(storedPoints, "3M", asOfDate).map((point) => point.snapshotDate),
  ["2026-04-30", "2026-06-30", "2026-07-25", "2026-07-27", "2026-07-31"]
);
assert.deepEqual(
  filterStoredBusinessHealthTrendPoints(storedPoints, "6M", asOfDate).map((point) => point.snapshotDate),
  ["2026-01-31", "2026-04-30", "2026-06-30", "2026-07-25", "2026-07-27", "2026-07-31"]
);
assert.deepEqual(
  filterStoredBusinessHealthTrendPoints(storedPoints, "YTD", asOfDate).map((point) => point.snapshotDate),
  ["2026-01-01", "2026-01-31", "2026-04-30", "2026-06-30", "2026-07-25", "2026-07-27", "2026-07-31"]
);
assert.equal(areConsecutiveBusinessHealthDates("2026-07-30", "2026-07-31"), true);
assert.equal(areConsecutiveBusinessHealthDates("2026-07-25", "2026-07-27"), false, "missing dates must break the visible line");
assert.equal(filterStoredBusinessHealthTrendPoints([], "7D", asOfDate).length, 0, "no current or synthetic point may be inserted");

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
assert.doesNotMatch(chartSource, /currentScore|average\(|buildMonthlyPoints|linearGradient/, "the chart must not add current values, aggregate snapshots, or visually smooth missing history");
assert.match(chartSource, /areConsecutiveBusinessHealthDates/, "missing stored dates must break the plotted line");
assert.match(chartSource, /Business Health score[\s\S]*onPointerEnter[\s\S]*onFocus/, "stored points must expose matching hover and keyboard details");
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
