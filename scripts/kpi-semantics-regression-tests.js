const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypescriptModule(relativePath, mocks = {}) {
  const file = path.join(root, relativePath);
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: file
  }).outputText;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  const originalRequire = loaded.require.bind(loaded);
  loaded.require = (request) => Object.prototype.hasOwnProperty.call(mocks, request) ? mocks[request] : originalRequire(request);
  loaded._compile(output, file);
  return loaded.exports;
}

const semantics = loadTypescriptModule("lib/kpis/semantics.ts");
const settings = loadTypescriptModule("lib/kpis/settings.ts", {
  "@/lib/kpis/semantics": semantics
});

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

assert.equal(evaluate([10, 12], configured("Sales", "maximize")).latestPerformanceEffect, "favorable", "Executive Overview receives favorable performance for a maximize KPI increase");
assert.equal(evaluate([12, 10], configured("Sales", "maximize")).latestPerformanceEffect, "unfavorable", "Executive Overview receives unfavorable performance for a maximize KPI decrease");
assert.equal(evaluate([10, 12], configured("Defects", "minimize")).latestPerformanceEffect, "unfavorable", "Executive Overview receives unfavorable performance for a minimize KPI increase");
assert.equal(evaluate([12, 10], configured("Defects", "minimize")).latestPerformanceEffect, "favorable", "Executive Overview receives favorable performance for a minimize KPI decrease");

const oneStar = semantics.deterministicKpiSemantics("1-Star Reviews");
assert.equal(oneStar.desiredDirection, "minimize");
assert.equal(oneStar.idealValue, 0);
const activeDeterministicOneStar = semantics.resolveKpiSemantics("1-Star Reviews");
assert.equal(activeDeterministicOneStar.desiredDirection, "minimize");
assert.equal(activeDeterministicOneStar.classificationConfirmed, false);

const targetRange = configured("Staff Utilization", "target_range", { idealRangeMin: 70, idealRangeMax: 85 });
assert.equal(evaluate([60, 75], targetRange).latestPerformanceEffect, "favorable");
assert.equal(evaluate([75, 92], targetRange).latestPerformanceEffect, "unfavorable");
assert.equal(evaluate([75], targetRange).targetStatus, "within_range");

const exact = configured("Inventory variance", "exact_target");
assert.equal(evaluate([20, 12], exact, 10).latestPerformanceEffect, "favorable");
assert.equal(evaluate([20, 12], exact, 10).targetStatus, "moving_toward_target");
const exactWithSemanticIdeal = configured("Inventory variance", "exact_target", { idealValue: 10 });
assert.equal(evaluate([20, 10], exactWithSemanticIdeal).targetStatus, "achieved", "exact targets use the confirmed semantic ideal when no row target exists");

const maintain = configured("Staffing coverage", "maintain", { idealValue: 12 });
assert.equal(evaluate([12, 15], maintain).latestPerformanceEffect, "unfavorable");
assert.equal(evaluate([15, 12], maintain).latestPerformanceEffect, "favorable");
assert.equal(evaluate([12], maintain).targetStatus, "achieved", "maintain semantics use the confirmed stability value");

const maximizeWithSemanticIdeal = configured("Revenue", "maximize", { idealValue: 100 });
const minimizeWithSemanticIdeal = configured("Checkout wait", "minimize", { idealValue: 5 });
assert.equal(evaluate([110], maximizeWithSemanticIdeal).targetStatus, "achieved", "maximize semantics recognize a confirmed semantic ideal without a row target");
assert.equal(evaluate([4], minimizeWithSemanticIdeal).targetStatus, "achieved", "minimize semantics recognize a confirmed semantic ideal without a row target");
assert.deepEqual(semantics.resolveKpiTargetReference(maximizeWithSemanticIdeal), { kind: "scalar", value: 100, source: "semantic" });
assert.deepEqual(semantics.resolveKpiTargetReference(maximizeWithSemanticIdeal, 120), { kind: "scalar", value: 120, source: "manual" }, "manual targets remain authoritative");
assert.deepEqual(semantics.resolveKpiTargetReference(targetRange), { kind: "range", min: 70, max: 85, source: "semantic" });
assert.deepEqual(semantics.resolveKpiTargetReference(configured("Unknown", "unknown", { idealValue: 10 })), { kind: "none" }, "unknown semantics fail closed even when an ideal value is present");

assert.equal(semantics.isKpiTargetMet("within_range"), true);
assert.equal(semantics.isKpiTargetMet("achieved"), true);
assert.equal(semantics.isKpiTargetMiss("above_acceptable_maximum"), true);
assert.equal(semantics.isKpiTargetMiss("moving_toward_target"), true, "an improving exact-target KPI remains outside target until achieved");
assert.equal(semantics.isKpiTargetMiss("direction_unknown"), false);
assert.ok(semantics.kpiTargetGapRatio({ value: 12, semantics: configured("Wait", "minimize"), target: 10 }) > 0.1);
assert.equal(semantics.kpiTargetGapRatio({ value: 80, semantics: targetRange }), 0);

const unknown = semantics.deterministicKpiSemantics("Staff Utilization");
assert.equal(unknown.desiredDirection, "unknown");
assert.equal(evaluate([70, 80], unknown, 85).latestPerformanceEffect, "indeterminate");
assert.equal(evaluate([70, 80], unknown, 85).targetStatus, "direction_unknown");

function semanticSetting(overrides = {}) {
  return {
    canonical_name: "one_star_reviews",
    display_name: "1-Star Reviews",
    original_source_label: "1-Star Reviews",
    semantic_unit: "count",
    semantic_scale: 1,
    aggregation_basis: null,
    period_basis: null,
    desired_direction: "minimize",
    target_behavior: "maximum_limit",
    ideal_value: 0,
    ideal_range_min: null,
    ideal_range_max: null,
    metric_role: "actual",
    definition: null,
    classification_source: "luna",
    classification_confidence: 0.97,
    classification_confirmed: false,
    classification_rationale: "Lower one-star review counts generally indicate fewer severe customer complaints.",
    ...overrides
  };
}

const advisoryLuna = semantics.resolveKpiSemantics("1-Star Reviews", semanticSetting());
assert.equal(advisoryLuna.desiredDirection, "unknown", "An unconfirmed Luna proposal must remain advisory.");
assert.equal(advisoryLuna.classificationConfidence, 0.97, "Advisory confidence remains visible for review.");
const targetOnlyDeterministicSetting = semantics.resolveKpiSemantics("1-Star Reviews", semanticSetting({
  desired_direction: "minimize",
  classification_source: "deterministic",
  classification_confidence: 1,
  classification_confirmed: false
}));
assert.equal(targetOnlyDeterministicSetting.desiredDirection, "minimize", "Saving a manual target must not discard an active deterministic semantic mapping.");
const explicitlyUnconfirmedUserSetting = semantics.resolveKpiSemantics("1-Star Reviews", semanticSetting({
  desired_direction: "unknown",
  target_behavior: "unknown",
  classification_source: "user",
  classification_confidence: null,
  classification_confirmed: false
}));
assert.equal(explicitlyUnconfirmedUserSetting.desiredDirection, "unknown", "An explicit user decision to leave semantics unknown must fail closed.");
const confirmedLuna = semantics.resolveKpiSemantics("1-Star Reviews", semanticSetting({ classification_confirmed: true }));
assert.equal(confirmedLuna.desiredDirection, "minimize");
assert.equal(evaluate([42, 37], confirmedLuna, 21).latestPerformanceEffect, "favorable");
assert.equal(evaluate([21, 25, 29, 34, 42, 37], confirmedLuna, 21).selectedRangeTrend, "unfavorable");

assert.deepEqual(semantics.validateKpiSemanticSelection({
  desiredDirection: "target_range",
  targetBehavior: "acceptable_range",
  idealValue: null,
  idealRangeMin: 70,
  idealRangeMax: 85
}), { ok: true });
assert.equal(semantics.validateKpiSemanticSelection({
  desiredDirection: "target_range",
  targetBehavior: "acceptable_range",
  idealValue: null,
  idealRangeMin: 90,
  idealRangeMax: 80
}).ok, false);
assert.equal(semantics.validateKpiSemanticSelection({
  desiredDirection: "exact_target",
  targetBehavior: "exact_threshold",
  idealValue: null,
  idealRangeMin: null,
  idealRangeMax: null
}).ok, false);
assert.equal(semantics.validateKpiSemanticSelection({
  desiredDirection: "unknown",
  targetBehavior: "unknown",
  idealValue: 0,
  idealRangeMin: null,
  idealRangeMax: null
}).ok, false);

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

const navigationMetricNames = ["1-Star Reviews", "Average Checkout Wait", "revenue", "Revenue ($M)", "Target Revenue"];
assert.deepEqual(
  settings.resolveSelectedKpiNames("Revenue", navigationMetricNames),
  ["Revenue"],
  "Clicking Revenue must preserve the URL spelling while resolving its normalized KPI identity."
);
assert.deepEqual(settings.resolveSelectedKpiNames("1-Star Reviews", navigationMetricNames), ["1-Star Reviews"]);
assert.deepEqual(
  settings.resolveSelectedKpiNames("Revenue", [...navigationMetricNames].reverse()),
  ["Revenue"],
  "Revenue selection must not depend on KPI array order."
);
assert.deepEqual(
  settings.resolveSelectedKpiNames("Revenue ($M)", navigationMetricNames),
  ["Revenue ($M)"],
  "A scaled Revenue label must retain its exact detail identity."
);
assert.deepEqual(
  settings.resolveSelectedKpiNames(["Revenue", "revenue", "Revenue ($M)"], navigationMetricNames),
  ["Revenue", "Revenue ($M)"],
  "Case aliases must not create duplicate selections or resolve to an unrelated KPI."
);
assert.deepEqual(
  ["Revenue", "1-Star Reviews", "Revenue"].map((metric) => settings.resolveSelectedKpiNames(metric, navigationMetricNames)[0]),
  ["Revenue", "1-Star Reviews", "Revenue"],
  "Back and forward navigation must resolve each URL independently."
);
assert.deepEqual(
  settings.resolveSelectedKpiNames("Revenue", navigationMetricNames),
  settings.resolveSelectedKpiNames("Revenue", navigationMetricNames),
  "Refreshing a Revenue detail URL must preserve Revenue."
);
assert.deepEqual(
  settings.resolveSelectedKpiNames(undefined, navigationMetricNames),
  navigationMetricNames.slice(0, 3),
  "A missing metric parameter may use the safe default selection."
);
assert.deepEqual(
  settings.resolveSelectedKpiNames("Unknown KPI", navigationMetricNames),
  [],
  "An explicit unresolved metric must fail closed instead of selecting the first KPI."
);

const operationsActions = fs.readFileSync(path.join(root, "app/app/operations/actions.ts"), "utf8");
const fileActions = fs.readFileSync(path.join(root, "app/app/files/actions.ts"), "utf8");
const lifecycleService = fs.readFileSync(path.join(root, "lib/ai/kpi-semantics/service.ts"), "utf8");
const classificationContract = fs.readFileSync(path.join(root, "lib/ai/kpi-semantics/contracts.ts"), "utf8");
const kpiPage = fs.readFileSync(path.join(root, "app/app/kpis/page.tsx"), "utf8");
const performanceFields = fs.readFileSync(path.join(root, "components/kpis/KpiPerformanceMeaningFields.tsx"), "utf8");
const overview = fs.readFileSync(path.join(root, "app/app/page.tsx"), "utf8");
const kpiOverview = fs.readFileSync(path.join(root, "lib/ai/kpi-overview.ts"), "utf8");
const kpiSettingsPage = fs.readFileSync(path.join(root, "app/app/kpis/settings/page.tsx"), "utf8");
const prestige = fs.readFileSync(path.join(root, "lib/intelligence/prestige.ts"), "utf8");
const peoplePage = fs.readFileSync(path.join(root, "app/app/people/page.tsx"), "utf8");
const operationalEvidence = fs.readFileSync(path.join(root, "lib/intelligence/operational-evidence.ts"), "utf8");
const dormantReports = fs.readFileSync(path.join(root, "app/app/reports/actions.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/202607270002_kpi_semantic_direction.sql"), "utf8");

assert.match(operationsActions, /classifyAndPersistKpiSemantics/);
assert.doesNotMatch(lifecycleService, /gpt-5\.6-sol/i);
assert.match(lifecycleService, /KPI_SEMANTIC_CLASSIFICATION_LUNA_MODEL/);
assert.match(lifecycleService, /ACCEPTANCE_CONFIDENCE = 0\.92/);
assert.match(lifecycleService, /classification_confirmed/);
assert.match(lifecycleService, /requestLuna = false/);
assert.match(lifecycleService, /requestLuna \? "explicit_user_request" : "kpi_lifecycle"/);
assert.match(lifecycleService, /status: "suggested"/);
assert.match(lifecycleService, /status: "existing_suggestion"/);
assert.doesNotMatch(lifecycleService, /proposal\.confidence >= KPI_SEMANTIC_ACCEPTANCE_CONFIDENCE[^\n]+\? proposal : null/);
assert.match(lifecycleService, /\.eq\("workspace_id", workspaceId\)/);
assert.match(classificationContract, /targetBehaviorForDirection/);
assert.match(overview, /evaluateKpiPerformance/);
assert.match(overview, /trendTone\(trend\.performanceEffect\)/, "Executive Overview colors KPI movement by canonical performance effect");
assert.doesNotMatch(overview, /trendTone\(trend\.change/, "raw movement cannot drive Executive Overview performance color");
assert.match(kpiOverview, /definition: setting\?\.definition\?\.trim\(\) \|\| null/);
assert.match(kpiOverview, /desired_direction: metric\.desiredDirection/);
assert.match(kpiSettingsPage, /resolveKpiSemantics\(metric, setting\)/, "KPI Settings renders the canonical resolved semantic state");
assert.match(kpiSettingsPage, /resolveKpiTargetReference\(semantics, target\)/, "KPI Settings recognizes canonical semantic targets and ranges");
assert.doesNotMatch(kpiSettingsPage, /setting\?\.desired_direction !== "unknown"/, "KPI Settings must not maintain a second nullable direction resolver");
assert.match(kpiSettingsPage, /defaultValue=\{formatNumber\(target\)\}/, "the target editor remains manual-target-only");
assert.match(prestige, /evaluateKpiPerformance/);
assert.match(prestige, /resolveKpiTargetReference/);
assert.doesNotMatch(prestige, /latest\.actual_value\s*>=\s*previous\.actual_value/);
assert.match(peoplePage, /from\("kpi_settings"\)/, "People loads canonical KPI settings for shared intelligence output");
assert.match(peoplePage, /order\("sort_order", \{ ascending: true \}\)\.order\("weight", \{ ascending: false \}\)/, "People orders KPI settings by columns owned by kpi_settings");
assert.doesNotMatch(peoplePage, /from\("kpi_settings"\)[^\n]+order\("metric_name"/, "People must not order KPI settings by the operational-metrics column metric_name");
assert.match(peoplePage, /kpiSettings: kpiSettingsResult\.data \|\| \[\]/);
assert.match(operationalEvidence, /Math\.abs\(revenue\.changePercent \?\? 0\) >= 5/, "operational thresholds measure magnitude after canonical direction is known");
assert.match(dormantReports, /performanceEffect === "favorable"/);
assert.match(dormantReports, /performanceEffect === "unfavorable"/);
assert.doesNotMatch(dormantReports, /is improving fastest|is declining most/);
assert.match(migration, /alter table public\.kpi_settings/);
assert.doesNotMatch(migration, /\b(delete from|update public\.kpis|drop table|truncate)\b/i);
assert.doesNotMatch(lifecycleService, /\.from\("kpis"\)\.update/);
assert.doesNotMatch(lifecycleService, /\btarget\s*:/, "Classification must not write a KPI target.");
assert.match(operationsActions, /target_change_context/);
assert.match(operationsActions, /Previous target restored\./);
assert.match(operationsActions, /export async function requestKpiSemanticSuggestionAction/);
assert.match(operationsActions, /export async function acceptKpiSemanticSuggestionAction/);
assert.match(operationsActions, /requireKpiSettingsAdministrator/);
assert.match(operationsActions, /source: "kpi_semantic_suggestion_request"/);
assert.match(operationsActions, /source: "kpi_semantic_suggestion_acceptance"/);
assert.match(operationsActions, /\.eq\("classification_source", "luna"\)/);
assert.match(operationsActions, /\.eq\("classification_confirmed", false\)/);
const acceptAction = operationsActions.slice(
  operationsActions.indexOf("export async function acceptKpiSemanticSuggestionAction"),
  operationsActions.indexOf("export async function deleteKpiAction")
);
assert.doesNotMatch(acceptAction, /\btarget\s*:/, "Suggestion acceptance must not overwrite the manual target.");
assert.match(kpiPage, /Performance direction is not confirmed\./);
assert.match(kpiPage, /Deterministic performance direction:/);
assert.match(kpiPage, /const resolvedSemantics = semantics;/, "Chart Settings must render the projected canonical semantic state.");
assert.match(kpiPage, /semantics=\{selectedKpiSemantics\}/, "KPI Detail and Chart Settings must consume one projected semantic state.");
assert.match(kpiPage, /Accept suggestion/);
assert.match(kpiPage, /Change manually/);
assert.match(kpiPage, /Leave unconfirmed/);
assert.doesNotMatch(kpiPage, /function ManualTargetForm/, "Recommended Target must not contain a second manual target editor.");
assert.match(kpiPage, /Current manual target/);
assert.match(kpiPage, /Edit manual targets in Chart Settings\./);
assert.match(kpiPage, /const selectedManualTarget = selectedKpiState\?\.manualTarget \?\? null/, "KPI Detail must render the snapshot-projected authoritative manual target.");
assert.match(kpiPage, /resolveSelectedKpiNames\(params\?\.metric, metricNames\)/, "KPI Detail must resolve URL selection through normalized KPI identity.");
assert.doesNotMatch(kpiPage, /function getSelectedMetrics/, "KPI Detail must not retain the case-sensitive first-item fallback.");
assert.match(kpiPage, /resolveKpiTargetReference/);
assert.match(kpiPage, /isKpiTargetMet\(evaluateKpiPerformance/);
assert.doesNotMatch(kpiPage, /target === null && direction !== "target_range"/, "semantic targets cannot be treated as missing by direction-specific UI logic");
assert.match(operationsActions, /target,\n\s+weight,/, "Manual targets must persist through the kpi_settings upsert.");
assert.doesNotMatch(kpiPage, /classifyAndPersistKpiSemantics/, "KPI rendering must not invoke Luna.");
for (const label of ["Performance meaning", "Higher is better", "Lower is better", "Target range", "Exact target", "Maintain stability", "Not determined", "KPI definition"]) {
  assert.match(performanceFields, new RegExp(label));
}
for (const visualField of ["target", "display_unit", "x_axis_label", "y_axis_label", "value_format", "preferred_chart_type", "color"]) {
  assert.match(kpiPage, new RegExp(`name=\\"${visualField}\\"`), `${visualField} must remain in Chart Settings.`);
}
assert.match(fileActions, /persistedSetting\?\.classification_confirmed/);
assert.match(fileActions, /persistedSetting\?\.classification_source === "luna"/);
assert.match(fileActions, /persistedSetting\?\.kpi_name \|\| row\.record\.name/);

console.log("KPI semantic direction regressions passed.");
