const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypescriptModule(relativePath) {
  const file = path.join(root, relativePath);
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file
  }).outputText;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  loaded._compile(output, file);
  return loaded.exports;
}

const semantics = loadTypescriptModule("lib/kpis/semantics.ts");

function configured(label, direction, extras = {}) {
  return {
    ...semantics.deterministicKpiSemantics(label),
    desiredDirection: direction,
    targetBehavior: "unknown",
    ...extras
  };
}

function evaluate(values, semantic, target = null) {
  return semantics.evaluateKpiPerformance({
    observations: values.map((actual_value) => ({ actual_value })),
    semantics: semantic,
    target
  });
}

assert.equal(evaluate([10, 12], configured("Sales", "maximize")).latestPerformanceEffect, "favorable");
assert.equal(evaluate([12, 10], configured("Sales", "maximize")).latestPerformanceEffect, "unfavorable");
assert.equal(evaluate([10, 12], configured("Defects", "minimize")).latestPerformanceEffect, "unfavorable");
assert.equal(evaluate([12, 10], configured("Defects", "minimize")).latestPerformanceEffect, "favorable");

const oneStar = semantics.deterministicKpiSemantics("1-Star Reviews");
assert.equal(oneStar.desiredDirection, "minimize");
assert.equal(oneStar.idealValue, 0);

const targetRange = configured("Staff Utilization", "target_range", { idealRangeMin: 70, idealRangeMax: 85 });
assert.equal(evaluate([60, 75], targetRange).latestPerformanceEffect, "favorable");
assert.equal(evaluate([75, 92], targetRange).latestPerformanceEffect, "unfavorable");
assert.equal(evaluate([75], targetRange).targetStatus, "within_range");

const exact = configured("Inventory variance", "exact_target");
assert.equal(evaluate([20, 12], exact, 10).latestPerformanceEffect, "favorable");
assert.equal(evaluate([20, 12], exact, 10).targetStatus, "moving_toward_target");

const unknown = semantics.deterministicKpiSemantics("Staff Utilization");
assert.equal(unknown.desiredDirection, "unknown");
assert.equal(evaluate([70, 80], unknown, 85).latestPerformanceEffect, "indeterminate");
assert.equal(evaluate([70, 80], unknown, 85).targetStatus, "direction_unknown");

const recentRecovery = evaluate([10, 20, 15], configured("Wait time", "minimize"));
assert.equal(recentRecovery.latestPerformanceEffect, "favorable");
assert.equal(recentRecovery.selectedRangeTrend, "unfavorable");
const recentPullback = evaluate([10, 20, 15], configured("Revenue", "maximize"));
assert.equal(recentPullback.latestPerformanceEffect, "unfavorable");
assert.equal(recentPullback.selectedRangeTrend, "favorable");

const minimizeRecommendation = semantics.recommendKpiTarget({
  observations: [10, 9, 8, 8].map((actual_value) => ({ actual_value })),
  semantics: oneStar
});
assert.ok(minimizeRecommendation.value <= 8, "Minimize recommendation must not exceed the latest value.");
assert.ok(minimizeRecommendation.value >= 0, "Theoretical ideal zero must remain a floor, not force a negative target.");

const maximizeRecommendation = semantics.recommendKpiTarget({
  observations: [100, 105, 110, 108].map((actual_value) => ({ actual_value })),
  semantics: semantics.deterministicKpiSemantics("Revenue")
});
assert.ok(maximizeRecommendation.value >= 108, "Maximize recommendation must not be below the latest value.");
assert.equal(semantics.recommendKpiTarget({ observations: [1, 2, 3].map((actual_value) => ({ actual_value })), semantics: unknown }).value, null);

const revenue = semantics.deterministicKpiSemantics("Revenue");
const lowercaseRevenue = semantics.deterministicKpiSemantics("revenue");
const millionRevenue = semantics.deterministicKpiSemantics("Revenue ($M)");
const targetRevenue = semantics.deterministicKpiSemantics("Target Revenue");
assert.equal(revenue.canonicalName, lowercaseRevenue.canonicalName);
assert.equal(millionRevenue.canonicalName, revenue.canonicalName);
assert.equal(millionRevenue.scale, 1_000_000);
assert.equal(targetRevenue.metricRole, "target");
assert.notEqual(targetRevenue.canonicalName, revenue.canonicalName);

const duplicateGroups = semantics.potentialKpiDuplicateGroups(["Revenue", "revenue", "Revenue ($M)", "Target Revenue"], []);
assert.equal(duplicateGroups.length, 1);
assert.equal(duplicateGroups[0].requiresScaleReview, true);
assert.ok(!duplicateGroups[0].labels.includes("Target Revenue"));

const operationsActions = fs.readFileSync(path.join(root, "app/app/operations/actions.ts"), "utf8");
const fileActions = fs.readFileSync(path.join(root, "app/app/files/actions.ts"), "utf8");
const lifecycleService = fs.readFileSync(path.join(root, "lib/ai/kpi-semantics/service.ts"), "utf8");
const overview = fs.readFileSync(path.join(root, "app/app/page.tsx"), "utf8");
const prestige = fs.readFileSync(path.join(root, "lib/intelligence/prestige.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/202607270002_kpi_semantic_direction.sql"), "utf8");

assert.match(operationsActions, /classifyAndPersistKpiSemantics/);
assert.doesNotMatch(lifecycleService, /gpt-5\.6-sol/i);
assert.match(lifecycleService, /KPI_SEMANTIC_CLASSIFICATION_LUNA_MODEL/);
assert.match(lifecycleService, /ACCEPTANCE_CONFIDENCE = 0\.92/);
assert.match(lifecycleService, /classification_confirmed/);
assert.match(lifecycleService, /\.eq\("workspace_id", workspaceId\)/);
assert.match(overview, /evaluateKpiPerformance/);
assert.match(prestige, /evaluateKpiPerformance/);
assert.match(migration, /alter table public\.kpi_settings/);
assert.doesNotMatch(migration, /\b(delete from|update public\.kpis|drop table|truncate)\b/i);
assert.doesNotMatch(lifecycleService, /\.from\("kpis"\)\.update/);
assert.doesNotMatch(lifecycleService, /\btarget\s*:/, "Classification must not write a KPI target.");
assert.match(operationsActions, /target_change_context/);
assert.match(operationsActions, /Previous target restored\./);
assert.match(fileActions, /persistedSetting\?\.classification_confirmed/);
assert.match(fileActions, /persistedSetting\?\.classification_source === "luna"/);
assert.match(fileActions, /persistedSetting\?\.kpi_name \|\| row\.record\.name/);

console.log("KPI semantic direction regressions passed.");
