const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

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
  if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const deterministic = require("../lib/integrations/deterministic/index.ts");
const commands = require("../lib/integrations/persistence/deterministic-commands.ts");

let assertionCount = 0;
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepEqual(actual, expected, message);
}
function throws(callback, matcher, message) {
  assertionCount += 1;
  assert.throws(callback, matcher, message);
}

function id(value) {
  const hex = value.toString(16).padStart(32, "0").slice(-32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}
function hash(value) {
  return `sha256:${crypto.createHash("sha256").update(String(value)).digest("hex")}`;
}

const ids = { workspace: id(1), entity: id(2), otherEntity: id(3) };

function contribution(number, overrides = {}) {
  return {
    id: id(10_000 + number),
    eventFingerprint: hash(`event:${number}`),
    sourceFactFingerprint: hash(`fact:${number}`),
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    contributionFamilyKey: "recognized_revenue_transactions",
    contributionFamilyKind: "additive_transaction",
    measureKey: "recognized_revenue",
    aggregateKey: "recognized_revenue_actual",
    valueCanonical: "100",
    economicDate: "2026-01-15",
    periodStart: null,
    periodEnd: null,
    dimensions: [{ key: "department", value: "Operations" }],
    accountingBasis: "accrual",
    currency: "USD",
    observationKind: "active_additive",
    ...overrides
  };
}

function mutation(number, prior, next, label = "change") {
  return {
    mutationKey: `${label}_${number}`,
    prior,
    next,
    causeContributionEventIds: [next?.id || prior?.id || id(90_000 + number)]
  };
}

function aggregateDefinition({
  nodeKey,
  familyKey = "recognized_revenue_transactions",
  familyKind = "additive_transaction",
  measureKey = "recognized_revenue",
  aggregateKey = "recognized_revenue_actual",
  reducer = "additive_sum",
  correctionStrategy = "subtract_readd",
  periodGranularity = "month",
  groupByDimensions = [],
  allowedAccountingBases = ["accrual"],
  currencyMode = "required"
}) {
  return {
    nodeKind: "aggregate",
    nodeKey,
    contribution: {
      contributionFamilyKeys: [familyKey],
      contributionFamilyKinds: [familyKind],
      measureKeys: [measureKey],
      aggregateKeys: [aggregateKey]
    },
    reducer,
    correctionStrategy,
    periodGranularity,
    groupByDimensions,
    allowedAccountingBases,
    currencyMode,
    calculationVersion: `${nodeKey}_v1`,
    freshnessDependencyKeys: [`${nodeKey}_source`]
  };
}

function kpiDefinition({
  nodeKey,
  dependencies,
  calculation = "identity",
  dependencyWindow = { kind: "same_period" },
  missingInput = "zero"
}) {
  return {
    nodeKind: "kpi",
    nodeKey,
    dependencies,
    calculation,
    dependencyWindow,
    missingInput,
    divisionScale: calculation === "ratio" ? 4 : null,
    divisionRounding: calculation === "ratio" ? "half_away_from_zero" : null,
    calculationVersion: `${nodeKey}_v1`,
    targetDependencyKeys: [`${nodeKey}_target`],
    freshnessDependencyKeys: [`${nodeKey}_source`]
  };
}

function registry({ aggregates, kpis = [], downstream = [], version = "phase_3_test_registry_v1" }) {
  return deterministic.createDependencyRegistry({
    contractVersion: deterministic.DETERMINISTIC_CONTRACT_VERSIONS.dependencyRegistry,
    registryVersion: version,
    calculationPolicyVersion: deterministic.DETERMINISTIC_CALCULATION_POLICY_VERSION,
    aggregates,
    kpis,
    downstream
  });
}

function stateValue(snapshot, nodeKey, periodStart = null, dimensionValue = null) {
  return snapshot.states.find((state) =>
    state.nodeKey === nodeKey &&
    (periodStart === null || state.scope.periodStart === periodStart) &&
    (dimensionValue === null || state.scope.dimensions.some((dimension) => dimension.value === dimensionValue))
  )?.valueCanonical;
}

const defaultRegistry = deterministic.PHASE_3_DEPENDENCY_REGISTRY;
ok(defaultRegistry.registryFingerprint.startsWith("sha256:"), "the code-defined registry has a deterministic SHA-256 fingerprint");
deepEqual(
  deterministic.deterministicDependencyOrder(defaultRegistry),
  [
    "recognized_revenue_month_total",
    "revenue",
    "business_health_revenue_invalidation",
    "deterministic_revenue_opportunity_invalidation",
    "deterministic_revenue_risk_invalidation",
    "snapshot_revenue_invalidation"
  ],
  "the default graph has a stable topological order"
);
equal(deterministic.PHASE_3_MODEL_CALL_COUNT, 0, "Phase 3 invokes no model");

throws(
  () => registry({
    aggregates: [aggregateDefinition({ nodeKey: "base" })],
    kpis: [kpiDefinition({ nodeKey: "unknown_child", dependencies: ["missing"] })]
  }),
  /deterministic_dependency_unknown/,
  "unknown dependencies fail closed"
);
throws(
  () => registry({
    aggregates: [aggregateDefinition({ nodeKey: "base" })],
    kpis: [
      kpiDefinition({ nodeKey: "cycle_a", dependencies: ["cycle_b"] }),
      kpiDefinition({ nodeKey: "cycle_b", dependencies: ["cycle_a"] })
    ]
  }),
  /deterministic_dependency_cycle/,
  "dependency cycles fail closed"
);
throws(
  () => registry({
    aggregates: [aggregateDefinition({ nodeKey: "base" })],
    kpis: [kpiDefinition({ nodeKey: "duplicate_edge", dependencies: ["base", "base"], calculation: "sum" })]
  }),
  /unique/i,
  "duplicate dependency edges are rejected"
);
throws(
  () => deterministic.assertDependencyRegistry({ ...defaultRegistry, registryFingerprint: hash("forged") }),
  /fingerprint_mismatch/,
  "forged registry fingerprints are rejected"
);
throws(
  () => deterministic.assertDependencyRegistry({ ...defaultRegistry, calculationPolicyVersion: "stale_policy_v0" }),
  /./,
  "stale calculation-policy vocabularies are rejected"
);
const registryV2 = registry({
  aggregates: [aggregateDefinition({ nodeKey: "base" })],
  version: "phase_3_test_registry_v2"
});
ok(registryV2.registryFingerprint !== defaultRegistry.registryFingerprint, "a registry version change changes deterministic lineage");

equal(deterministic.addCanonicalDecimals(["100.25", "-0.25", "0"]), "100", "canonical decimal addition is exact");
equal(deterministic.subtractCanonicalDecimals("10", "2.5"), "7.5", "canonical decimal subtraction is exact");
equal(
  deterministic.divideCanonicalDecimals({ numerator: "1", denominator: "8", scale: 3, rounding: "half_away_from_zero" }),
  "0.125",
  "ratio arithmetic uses an explicit deterministic rounding contract"
);
throws(
  () => deterministic.divideCanonicalDecimals({ numerator: "1", denominator: "0", scale: 2, rounding: "half_away_from_zero" }),
  /division_by_zero/,
  "division by zero fails closed"
);

const first = contribution(1);
const firstClean = deterministic.cleanFullRecompute({
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  contributions: [first],
  registry: defaultRegistry,
  asOfDate: "2026-12-31"
});
equal(stateValue(firstClean.snapshot, "recognized_revenue_month_total"), "100", "one contribution produces one exact aggregate");
equal(stateValue(firstClean.snapshot, "revenue"), "100", "one aggregate produces its dependent KPI through the shared identity formula");
equal(firstClean.metrics.contributionsScanned, 1, "the clean oracle scans the complete accepted contribution state");

const second = contribution(2, { valueCanonical: "200" });
const addition = deterministic.runIncrementalFullEquivalence({
  prior: firstClean.snapshot,
  contributions: [first, second],
  mutations: [mutation(2, null, second, "add")],
  registry: defaultRegistry,
  asOfDate: "2026-12-31"
});
equal(addition.status, "completed", "incremental addition matches clean full recomputation");
equal(stateValue(addition.safeSnapshot, "revenue"), "300", "incremental addition preserves exact accounting truth");
equal(addition.incremental.metrics.contributionsScanned, 1, "an additive increment scans only the changed contribution");
equal(addition.clean.metrics.contributionsScanned, 2, "the clean oracle independently scans all current contributions");
ok(addition.incremental.dirtyNodes.some((node) => node.nodeKey === "snapshot_revenue_invalidation"), "snapshot eligibility is invalidated without producing a snapshot");
ok(addition.incremental.dirtyNodes.some((node) => node.nodeKey === "business_health_revenue_invalidation"), "Business Health receives invalidation only");

const replay = deterministic.runIncrementalFullEquivalence({
  prior: addition.safeSnapshot,
  contributions: [first, second],
  mutations: [mutation(2, null, second, "add")],
  registry: defaultRegistry,
  asOfDate: "2026-12-31"
});
equal(replay.status, "completed", "a repeated accepted change set remains equivalent");
ok(replay.incremental.idempotent, "a repeated input watermark is idempotent");
equal(replay.incremental.dirtyNodes.length, 0, "idempotent replay creates no duplicate dirty nodes");

const multiRegistry = registry({
  aggregates: [
    aggregateDefinition({ nodeKey: "revenue_total" }),
    aggregateDefinition({ nodeKey: "revenue_secondary_rollup" })
  ],
  kpis: [
    kpiDefinition({ nodeKey: "revenue_kpi", dependencies: ["revenue_total"] }),
    kpiDefinition({ nodeKey: "revenue_secondary_kpi", dependencies: ["revenue_secondary_rollup"] })
  ]
});
const multi = deterministic.runIncrementalFullEquivalence({
  prior: deterministic.emptyDeterministicStateSnapshot({ workspaceId: ids.workspace, businessEntityId: ids.entity }),
  contributions: [first],
  mutations: [mutation(1, null, first, "multi")],
  registry: multiRegistry,
  asOfDate: "2026-12-31"
});
equal(multi.status, "completed", "one contribution can deterministically affect multiple registered aggregates and KPIs");
deepEqual(
  multi.incremental.dirtyNodes.map((node) => node.nodeKey).sort(),
  ["revenue_kpi", "revenue_secondary_kpi", "revenue_secondary_rollup", "revenue_total"],
  "only the registered dependency fan-out becomes dirty"
);

const isolatedRegistry = registry({
  aggregates: [
    aggregateDefinition({ nodeKey: "revenue_total" }),
    aggregateDefinition({
      nodeKey: "cash_total",
      familyKey: "cash_transactions",
      measureKey: "cash",
      aggregateKey: "cash_actual"
    })
  ],
  kpis: [
    kpiDefinition({ nodeKey: "revenue_kpi", dependencies: ["revenue_total"] }),
    kpiDefinition({ nodeKey: "cash_kpi", dependencies: ["cash_total"] })
  ]
});
const cash = contribution(3, {
  contributionFamilyKey: "cash_transactions",
  measureKey: "cash",
  aggregateKey: "cash_actual",
  valueCanonical: "500"
});
const isolatedPrior = deterministic.cleanFullRecompute({
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  contributions: [cash],
  registry: isolatedRegistry,
  asOfDate: "2026-12-31"
});
const isolated = deterministic.runIncrementalFullEquivalence({
  prior: isolatedPrior.snapshot,
  contributions: [cash, first],
  mutations: [mutation(1, null, first, "isolated")],
  registry: isolatedRegistry,
  asOfDate: "2026-12-31"
});
ok(!isolated.incremental.dirtyNodes.some((node) => node.nodeKey === "cash_kpi"), "an unrelated KPI is not recalculated");
equal(stateValue(isolated.safeSnapshot, "cash_kpi"), "500", "unrelated deterministic state remains unchanged");

const stormContributions = Array.from({ length: 200 }, (_, index) => contribution(100 + index, { valueCanonical: "1" }));
const storm = deterministic.runIncrementalFullEquivalence({
  prior: deterministic.emptyDeterministicStateSnapshot({ workspaceId: ids.workspace, businessEntityId: ids.entity }),
  contributions: stormContributions,
  mutations: stormContributions.map((value, index) => mutation(index, null, value, "storm")),
  registry: registry({
    aggregates: [aggregateDefinition({ nodeKey: "storm_total" })],
    kpis: [kpiDefinition({ nodeKey: "storm_kpi", dependencies: ["storm_total"] })]
  }),
  asOfDate: "2026-12-31"
});
equal(storm.status, "completed", "an event-storm-like batch remains equivalent");
equal(storm.incremental.dirtyNodes.filter((node) => node.nodeKey === "storm_total").length, 1, "many changes coalesce into one aggregate dirty node");
equal(storm.incremental.dirtyNodes.find((node) => node.nodeKey === "storm_total").causeCount, 200, "coalescing preserves the complete bounded cause count");
equal(storm.incremental.dirtyNodes.find((node) => node.nodeKey === "storm_total").boundedCauseContributionEventIds.length, 32, "dirty-node cause identifiers remain bounded");

function correctionCase(label, priorContribution, nextContribution, currentContributions, expectedPeriods) {
  const prior = deterministic.cleanFullRecompute({
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    contributions: priorContribution ? [priorContribution] : [],
    registry: defaultRegistry,
    asOfDate: "2027-12-31"
  });
  const result = deterministic.runIncrementalFullEquivalence({
    prior: prior.snapshot,
    contributions: currentContributions,
    mutations: [mutation(500 + assertionCount, priorContribution, nextContribution, label)],
    registry: defaultRegistry,
    asOfDate: "2027-12-31"
  });
  equal(result.status, "completed", `${label} matches the clean oracle`);
  deepEqual(
    [...new Set(result.incremental.dirtyNodes
      .filter((node) => node.nodeKey === "recognized_revenue_month_total")
      .map((node) => node.scope.periodStart))].sort(),
    expectedPeriods.sort(),
    `${label} invalidates the exact old/new aggregate periods`
  );
  return result;
}

const amountPrior = contribution(400, { valueCanonical: "10000" });
const amountNext = contribution(401, { valueCanonical: "8000" });
const amountCorrection = correctionCase("amount_correction", amountPrior, amountNext, [amountNext], ["2026-01-01"]);
equal(stateValue(amountCorrection.safeSnapshot, "revenue"), "8000", "amount correction subtracts and re-adds exactly");
const voidResult = correctionCase("void", amountPrior, null, [], ["2026-01-01"]);
equal(stateValue(voidResult.safeSnapshot, "revenue"), "0", "void leaves an auditable zero state for the affected period");

const january = contribution(410, { economicDate: "2026-01-15", valueCanonical: "10000" });
const february = contribution(411, { economicDate: "2026-02-15", valueCanonical: "8000" });
correctionCase("backdate_forward", january, february, [february], ["2026-01-01", "2026-02-01"]);
correctionCase("forward_date_back", february, january, [january], ["2026-01-01", "2026-02-01"]);

const dimensionRegistry = registry({
  aggregates: [aggregateDefinition({ nodeKey: "department_revenue", groupByDimensions: ["department"] })],
  kpis: [kpiDefinition({ nodeKey: "department_revenue_kpi", dependencies: ["department_revenue"] })]
});
const operations = contribution(420);
const sales = contribution(421, { dimensions: [{ key: "department", value: "Sales" }] });
const dimensionPrior = deterministic.cleanFullRecompute({
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  contributions: [operations],
  registry: dimensionRegistry,
  asOfDate: "2026-12-31"
});
const dimensionMove = deterministic.runIncrementalFullEquivalence({
  prior: dimensionPrior.snapshot,
  contributions: [sales],
  mutations: [mutation(420, operations, sales, "dimension_reassignment")],
  registry: dimensionRegistry,
  asOfDate: "2026-12-31"
});
equal(dimensionMove.status, "completed", "dimension reassignment matches full recomputation");
equal(stateValue(dimensionMove.safeSnapshot, "department_revenue", "2026-01-01", "Operations"), "0", "old dimension path is invalidated");
equal(stateValue(dimensionMove.safeSnapshot, "department_revenue", "2026-01-01", "Sales"), "100", "new dimension path is established");

const accountRegistry = registry({
  aggregates: [
    aggregateDefinition({ nodeKey: "revenue_account", aggregateKey: "recognized_revenue_actual" }),
    aggregateDefinition({ nodeKey: "cash_account", aggregateKey: "cash_actual" })
  ],
  kpis: [
    kpiDefinition({ nodeKey: "revenue_account_kpi", dependencies: ["revenue_account"] }),
    kpiDefinition({ nodeKey: "cash_account_kpi", dependencies: ["cash_account"] })
  ]
});
const oldAccount = contribution(430);
const newAccount = contribution(431, { aggregateKey: "cash_actual" });
const accountPrior = deterministic.cleanFullRecompute({
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  contributions: [oldAccount],
  registry: accountRegistry,
  asOfDate: "2026-12-31"
});
const accountMove = deterministic.runIncrementalFullEquivalence({
  prior: accountPrior.snapshot,
  contributions: [newAccount],
  mutations: [mutation(430, oldAccount, newAccount, "account_reassignment")],
  registry: accountRegistry,
  asOfDate: "2026-12-31"
});
equal(accountMove.status, "completed", "account reassignment matches full recomputation");
equal(stateValue(accountMove.safeSnapshot, "revenue_account"), "0", "old account aggregate is retracted");
equal(stateValue(accountMove.safeSnapshot, "cash_account"), "100", "new account aggregate is established");

correctionCase("authority_policy_retraction", amountPrior, null, [], ["2026-01-01"]);
correctionCase("reconciliation_resolution_change", amountPrior, amountNext, [amountNext], ["2026-01-01"]);
correctionCase("tombstone_delete", amountPrior, null, [], ["2026-01-01"]);
correctionCase("restore_new_version", null, amountNext, [amountNext], ["2026-01-01"]);

const controlRegistry = registry({
  aggregates: [aggregateDefinition({
    nodeKey: "revenue_control_latest",
    familyKey: "recognized_revenue_control",
    familyKind: "non_additive_control",
    aggregateKey: "recognized_revenue_control_actual",
    reducer: "control_latest",
    correctionStrategy: "latest_reselect"
  })],
  kpis: [kpiDefinition({ nodeKey: "revenue_control_kpi", dependencies: ["revenue_control_latest"] })]
});
const controlA = contribution(440, {
  contributionFamilyKey: "recognized_revenue_control",
  contributionFamilyKind: "non_additive_control",
  aggregateKey: "recognized_revenue_control_actual",
  observationKind: "control_observation",
  valueCanonical: "1000",
  economicDate: "2026-01-01"
});
const controlB = contribution(441, {
  contributionFamilyKey: "recognized_revenue_control",
  contributionFamilyKind: "non_additive_control",
  aggregateKey: "recognized_revenue_control_actual",
  observationKind: "control_observation",
  valueCanonical: "900",
  economicDate: "2026-01-31"
});
const controlPrior = deterministic.cleanFullRecompute({
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  contributions: [controlA],
  registry: controlRegistry,
  asOfDate: "2026-12-31"
});
const controlResult = deterministic.runIncrementalFullEquivalence({
  prior: controlPrior.snapshot,
  contributions: [controlA, controlB],
  mutations: [mutation(441, null, controlB, "control_observation")],
  registry: controlRegistry,
  asOfDate: "2026-12-31"
});
equal(controlResult.status, "completed", "non-additive control reselection matches the clean oracle");
equal(stateValue(controlResult.safeSnapshot, "revenue_control_latest"), "900", "control observations do not sum into additive truth");

throws(
  () => deterministic.cleanFullRecompute({
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    contributions: [contribution(450, { accountingBasis: "cash" })],
    registry: defaultRegistry,
    asOfDate: "2026-12-31"
  }),
  /accounting_basis_mismatch/,
  "cash and accrual bases cannot be mixed"
);
throws(
  () => deterministic.cleanFullRecompute({
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    contributions: [contribution(451, { currency: null })],
    registry: defaultRegistry,
    asOfDate: "2026-12-31"
  }),
  /currency_required/,
  "currency-required aggregates fail closed without currency"
);
throws(
  () => deterministic.cleanFullRecompute({
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    contributions: [contribution(452, { businessEntityId: ids.otherEntity })],
    registry: defaultRegistry,
    asOfDate: "2026-12-31"
  }),
  /scope_mismatch/,
  "Business Entity substitution is denied"
);
throws(
  () => deterministic.cleanFullRecompute({
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    contributions: [contribution(453, { periodStart: "2026-01-01", periodEnd: "2026-02-28" })],
    registry: defaultRegistry,
    asOfDate: "2026-12-31"
  }),
  /allocation_policy_required/,
  "multi-period values require an explicit allocation policy"
);
throws(
  () => deterministic.ActiveContributionSchema.parse(contribution(454, { valueCanonical: "1234567890123456789012" })),
  /./,
  "out-of-bounds decimals are rejected before hashing or calculation"
);

const periodRegistry = registry({
  aggregates: [aggregateDefinition({ nodeKey: "period_total" })],
  kpis: [
    kpiDefinition({ nodeKey: "mtd", dependencies: ["period_total"] }),
    kpiDefinition({ nodeKey: "trailing_three", dependencies: ["period_total"], calculation: "sum", dependencyWindow: { kind: "trailing_periods", count: 3 } }),
    kpiDefinition({ nodeKey: "qtd", dependencies: ["period_total"], calculation: "sum", dependencyWindow: { kind: "quarter_to_date" } }),
    kpiDefinition({ nodeKey: "ytd", dependencies: ["period_total"], calculation: "sum", dependencyWindow: { kind: "year_to_date" } }),
    kpiDefinition({ nodeKey: "prior_period", dependencies: ["period_total"], calculation: "difference", dependencyWindow: { kind: "prior_period_comparison" } }),
    kpiDefinition({ nodeKey: "yoy", dependencies: ["period_total"], calculation: "difference", dependencyWindow: { kind: "year_over_year_comparison" } }),
    kpiDefinition({ nodeKey: "trend", dependencies: ["period_total"], calculation: "sum", dependencyWindow: { kind: "trend_periods", count: 3 } })
  ]
});
const historical = contribution(460, { economicDate: "2025-01-10", valueCanonical: "50" });
const currentJanuary = contribution(461, { economicDate: "2026-01-10", valueCanonical: "100" });
const periodPrior = deterministic.cleanFullRecompute({
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  contributions: [historical, currentJanuary],
  registry: periodRegistry,
  asOfDate: "2027-12-31"
});
const correctedJanuary = contribution(462, { economicDate: "2026-01-10", valueCanonical: "80" });
const periodResult = deterministic.runIncrementalFullEquivalence({
  prior: periodPrior.snapshot,
  contributions: [historical, correctedJanuary],
  mutations: [mutation(461, currentJanuary, correctedJanuary, "historical_correction")],
  registry: periodRegistry,
  asOfDate: "2027-12-31"
});
equal(periodResult.status, "completed", "MTD/QTD/YTD/window/comparison/trend invalidation remains equivalent");
for (const nodeKey of ["mtd", "trailing_three", "qtd", "ytd", "prior_period", "yoy", "trend"]) {
  ok(periodResult.incremental.dirtyNodes.some((node) => node.nodeKey === nodeKey), `${nodeKey} is invalidated by the historical correction`);
}
equal(periodResult.incremental.dirtyNodes.filter((node) => node.nodeKey === "trailing_three").length, 3, "a historical month invalidates exactly its three trailing windows");
equal(periodResult.incremental.dirtyNodes.filter((node) => node.nodeKey === "qtd").length, 3, "a January correction invalidates QTD through quarter end");
equal(periodResult.incremental.dirtyNodes.filter((node) => node.nodeKey === "ytd").length, 12, "a January correction invalidates YTD through year end");
equal(periodResult.incremental.dirtyNodes.filter((node) => node.nodeKey === "prior_period").length, 2, "prior-period comparison invalidates the changed and following periods");
equal(periodResult.incremental.dirtyNodes.filter((node) => node.nodeKey === "yoy").length, 2, "YoY comparison invalidates the changed and following-year periods");

const mismatchPrior = deterministic.cleanFullRecompute({
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  contributions: [first],
  registry: defaultRegistry,
  asOfDate: "2026-12-31"
});
const actualReplacement = contribution(470, { valueCanonical: "200" });
const forgedReplacement = contribution(471, { valueCanonical: "999" });
const mismatch = deterministic.runIncrementalFullEquivalence({
  prior: mismatchPrior.snapshot,
  contributions: [actualReplacement],
  mutations: [mutation(470, first, forgedReplacement, "incorrect_delta")],
  registry: defaultRegistry,
  asOfDate: "2026-12-31"
});
equal(mismatch.status, "quarantined", "incremental/full mismatch is quarantined");
equal(mismatch.safeSnapshot.watermark.stateFingerprint, mismatchPrior.snapshot.watermark.stateFingerprint, "mismatch preserves the prior known-safe state");
ok(mismatch.integrityFailure?.failureFingerprint.startsWith("sha256:"), "mismatch emits a redacted deterministic-integrity fingerprint");
equal(mismatch.modelCallCount, 0, "mismatched state is never sent to a model");

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const RANDOM_SEED = 0x5a3e2026;
const RANDOM_MUTATIONS = 250;
const random = lcg(RANDOM_SEED);
const randomizedRegistry = registry({
  aggregates: [aggregateDefinition({ nodeKey: "random_total", groupByDimensions: ["department"] })],
  kpis: [kpiDefinition({ nodeKey: "random_kpi", dependencies: ["random_total"] })],
  version: "randomized_equivalence_registry_v1"
});
let randomizedSnapshot = deterministic.emptyDeterministicStateSnapshot({ workspaceId: ids.workspace, businessEntityId: ids.entity });
const active = new Map();
let nextRandomId = 1_000;
const operationCounts = new Map();
function randomizedSuccessor(prior, overrides = {}) {
  const {
    id: _id,
    eventFingerprint: _eventFingerprint,
    sourceFactFingerprint: _sourceFactFingerprint,
    ...semantics
  } = prior;
  void _id;
  void _eventFingerprint;
  void _sourceFactFingerprint;
  return contribution(nextRandomId++, { ...semantics, ...overrides });
}
for (let index = 0; index < RANDOM_MUTATIONS; index += 1) {
  const existing = [...active.values()];
  const roll = random();
  let prior = null;
  let next = null;
  let operation;
  if (existing.length === 0 || roll < 0.3) {
    operation = existing.length === 0 ? "add_fact" : "restore_new_version";
    next = contribution(nextRandomId++, {
      valueCanonical: String(1 + Math.floor(random() * 10000)),
      economicDate: `2026-${String(1 + Math.floor(random() * 12)).padStart(2, "0")}-15`,
      dimensions: [{ key: "department", value: random() < 0.5 ? "Operations" : "Sales" }]
    });
    active.set(next.id, next);
  } else {
    prior = existing[Math.floor(random() * existing.length)];
    active.delete(prior.id);
    if (roll < 0.45) {
      operation = "void_fact";
    } else if (roll < 0.58) {
      operation = "change_period";
      next = randomizedSuccessor(prior, { economicDate: `2026-${String(1 + Math.floor(random() * 12)).padStart(2, "0")}-15` });
    } else if (roll < 0.7) {
      operation = "change_dimension";
      const current = prior.dimensions[0].value;
      next = randomizedSuccessor(prior, { dimensions: [{ key: "department", value: current === "Sales" ? "Operations" : "Sales" }] });
    } else if (roll < 0.82) {
      operation = "authority_result_change";
    } else if (roll < 0.9) {
      operation = "reconciliation_outcome_change";
    } else {
      operation = "correct_fact";
      next = randomizedSuccessor(prior, { valueCanonical: String(1 + Math.floor(random() * 10000)) });
    }
    if (next) active.set(next.id, next);
  }
  operationCounts.set(operation, (operationCounts.get(operation) || 0) + 1);
  const result = deterministic.runIncrementalFullEquivalence({
    prior: randomizedSnapshot,
    contributions: [...active.values()],
    mutations: [mutation(2_000 + index, prior, next, operation)],
    registry: randomizedRegistry,
    asOfDate: "2026-12-31"
  });
  equal(
    result.status,
    "completed",
    `randomized mutation ${index + 1} (${operation}) remains equivalent`
  );
  randomizedSnapshot = result.safeSnapshot;
}
for (const operation of ["add_fact", "correct_fact", "void_fact", "restore_new_version", "change_period", "change_dimension", "authority_result_change", "reconciliation_outcome_change"]) {
  ok((operationCounts.get(operation) || 0) > 0, `randomized seed covers ${operation}`);
}

const largeContributions = Array.from({ length: 10_000 }, (_, index) => contribution(20_000 + index, {
  valueCanonical: "1",
  economicDate: `2026-${String(1 + (index % 12)).padStart(2, "0")}-15`
}));
const largePrior = deterministic.cleanFullRecompute({
  workspaceId: ids.workspace,
  businessEntityId: ids.entity,
  contributions: largeContributions,
  registry: defaultRegistry,
  asOfDate: "2026-12-31"
});
const largeOld = largeContributions[5_000];
const largeNew = contribution(40_001, { ...largeOld, id: id(50_001), eventFingerprint: hash("large-new"), sourceFactFingerprint: hash("large-fact-new"), valueCanonical: "2" });
const largeCurrent = [...largeContributions];
largeCurrent[5_000] = largeNew;
const largeResult = deterministic.runIncrementalFullEquivalence({
  prior: largePrior.snapshot,
  contributions: largeCurrent,
  mutations: [mutation(40_001, largeOld, largeNew, "large_correction")],
  registry: defaultRegistry,
  asOfDate: "2026-12-31"
});
equal(largeResult.status, "completed", "a large historical correction remains equivalent");
equal(largeResult.incremental.metrics.contributionsScanned, 2, "large additive correction scans only old and new contributions incrementally");
equal(largeResult.clean.metrics.contributionsScanned, 10_000, "large clean oracle scans the full accepted contribution set");
ok(largeResult.incremental.metrics.nodesRecalculated < largeResult.clean.metrics.nodesRecalculated, "incremental node work remains proportional to affected scope");

const shadow = deterministic.buildLegacyKpiShadowProducerV1({
  workspaceId: ids.workspace,
  nodeKey: "revenue",
  metricName: "Revenue",
  states: addition.safeSnapshot.states,
  settings: [],
  asOf: "2026-12-31T23:59:59.000Z"
});
ok(shadow.shadowOnly && !shadow.promotionAuthorized, "the legacy KPI adapter is structurally shadow-only and unpromoted");
equal(shadow.producer.length, 1, "shadow aggregate series reuses the existing canonical KPI producer");
equal(shadow.exactValues.at(-1).valueCanonical, "300", "legacy number projection retains exact canonical accounting truth alongside it");

throws(() => commands.DeterministicChangeSetCommitSchema.parse({}), /./, "database change-set commands reject incomplete payloads");
throws(() => commands.DependencyDirtyNodeCommitSchema.parse({}), /./, "database dirty-node commands reject incomplete payloads");
throws(() => commands.DeterministicChangeSetResultSchema.parse({}), /./, "database finalization commands reject incomplete payloads");

const migrationPath = path.join(
  root,
  "supabase/migrations/20260821172015_external_integrations_phase_3_deterministic_dependencies.sql"
);
const databaseTestPath = path.join(
  root,
  "supabase/tests/external_integrations_phase_3_deterministic_dependencies.test.sql"
);
const migration = fs.readFileSync(migrationPath, "utf8");
const databaseTest = fs.readFileSync(databaseTestPath, "utf8");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const phase3Source = fs
  .readdirSync(path.join(root, "lib/integrations/deterministic"))
  .filter((name) => name.endsWith(".ts"))
  .map((name) => fs.readFileSync(path.join(root, "lib/integrations/deterministic", name), "utf8"))
  .join("\n");

equal(
  crypto.createHash("sha256").update(migration).digest("hex"),
  "864243f09995be7b76d0b62775f5bcf32eb4359fc50a980c5da00667c4ea7731",
  "the runtime-verified Phase 3 migration is byte-for-byte pinned"
);
equal(
  (migration.match(/create table private\./g) ?? []).length,
  3,
  "Phase 3 creates only the three approved private persistence tables"
);
ok(
  /create role deterministic_calculation_authority nologin noinherit/.test(migration),
  "the deterministic authority is non-login and no-inherit"
);
ok(
  /force row level security[\s\S]{0,240}revoke all on table private\.%I from public, anon, authenticated, service_role, external_integrations_authority, deterministic_calculation_authority/.test(migration),
  "all Phase 3 tables are forced-RLS and deny direct runtime authority"
);
ok(
  /lock table private\.fact_contribution_events in share mode/.test(migration),
  "final publication serializes against concurrent Phase 2 contribution inserts"
);
ok(
  /phase_3_state_fingerprint_v1[\s\S]+phase_3_watermark_fingerprint_v1[\s\S]+phase_3_failure_fingerprint_v1/.test(migration),
  "state, watermark, and integrity-failure payloads are canonically re-hashed at the database boundary"
);
ok(
  /deterministic_change_sets_input_idempotency_key[\s\S]{0,300}execution_mode/.test(migration),
  "idempotency is stable within execution mode while allowing recorded clean-full recovery"
);
ok(
  /dependency_dirty_node_cause_conflict/.test(migration),
  "conflicting dirty-node retries cannot replace earlier causal coverage"
);
ok(
  /fb4ad433246fcd58a9edb9029a72058c21b354514e93b804e7b0b0234c5a23c5/.test(migration),
  "the database boundary pins the code registry fingerprint"
);
ok(
  /deterministic_state_snapshot_incomplete/.test(migration) &&
    /deterministic_state_identity_invalid/.test(migration) &&
    /deterministic_watermark_fingerprint_invalid/.test(migration),
  "incomplete, substituted, and watermark-tampered state fails closed"
);
ok(
  /external_integrations_phase_3_deterministic_dependencies\.test\.sql/.test(workflow),
  "CI registers the complete Phase 3 database suite"
);
ok(
  /security_high_findings_remediation\.test\.sql[\s\S]+customer_1_billing_entitlement\.test\.sql[\s\S]+external_integrations_phase_1_canonical_foundation\.test\.sql[\s\S]+external_integrations_phase_2_reconciliation\.test\.sql[\s\S]+external_integrations_phase_3_deterministic_dependencies\.test\.sql/.test(workflow),
  "Phase 3 remains gated by the complete HIGH-security, billing, Phase 1, and Phase 2 database suites"
);
ok(
  /quarantine preserves the prior known-safe deterministic state/.test(databaseTest) &&
    /separate clean-full fallback is permitted/.test(databaseTest),
  "database regressions preserve mismatch evidence and prove bounded clean recovery"
);
ok(
  !/business_state_delta|ai_analysis_claim|integration_connection|provider_mapping|sync_run|oauth|webhook|cloud_tasks|cloud_run|secret_manager|quickbooks|cake_pos/i.test(migration),
  "Phase 4 provider, queue, OAuth, cloud, and Business State Delta persistence is absent"
);
ok(
  !/openai|anthropic|embedding|reranker|language model|\bllm\b/i.test(phase3Source),
  "Phase 3 deterministic code has no model integration"
);

process.stdout.write(
  `External integrations Phase 3 deterministic dependency regressions passed (${assertionCount} assertions; registry ${defaultRegistry.registryFingerprint}; randomized seed ${RANDOM_SEED}; ${RANDOM_MUTATIONS} mutations; performance 2 incremental scans vs 10000 clean scans).\n`
);
