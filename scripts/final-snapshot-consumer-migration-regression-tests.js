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

process.env.SUPABASE_SERVICE_ROLE_KEY = "local-final-snapshot-consumer-regression-secret";
process.env.VERCEL_ENV = "preview";

const { buildFindingExplanationPackage } = require("../lib/ai/finding-explanation/context.ts");
const { findingExplanationModelInput } = require("../lib/ai/finding-explanation/service.ts");
const { buildFindingExplanationFromSnapshotV1 } = require("../lib/ai/finding-explanation/snapshot-context.ts");
const { buildExecutiveHomepageModel } = require("../lib/intelligence/executive-homepage.ts");
const { buildIntelligenceSnapshotFromProducersV1 } = require("../lib/intelligence/snapshot/v1/composition.ts");
const { buildExecutiveHomepageFromSnapshotV1 } = require("../lib/intelligence/snapshot/v1/consumers/executive-overview.ts");
const { buildIntelligenceInboxFromSnapshotV1 } = require("../lib/intelligence/snapshot/v1/consumers/intelligence-inbox.ts");
const {
  buildKpiCompareStatesFromSnapshotV1,
  buildKpiPageStatesFromSnapshotV1,
  materializeKpiPageStateV1
} = require("../lib/intelligence/snapshot/v1/consumers/kpi-pages.ts");
const {
  projectExecutiveOverviewV1,
  projectFindingExplanationV1,
  projectIntelligenceInboxV1,
  projectKpiCompareV1,
  projectKpiDetailV1,
  projectKpiPageV1
} = require("../lib/intelligence/snapshot/v1/projections.ts");
const {
  FOUNDATION_FIXTURE_AS_OF,
  FOUNDATION_FIXTURE_WORKSPACE_ID,
  foundationCoverageOutput,
  foundationIntelligenceLayerOutput,
  foundationKpiProducerOutput
} = require("../lib/intelligence/snapshot/v1/fixtures.ts");
const { buildCanonicalKpiProducerOutputV1 } = require("../lib/kpis/snapshot-producer.ts");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function averageRuntimeMs(run, iterations = 25) {
  run();
  const startedAt = process.hrtime.bigint();
  for (let index = 0; index < iterations; index += 1) run();
  return Number(process.hrtime.bigint() - startedAt) / 1e6 / iterations;
}

const intelligence = foundationIntelligenceLayerOutput();
const coverage = foundationCoverageOutput();
const intelligenceBuild = buildIntelligenceSnapshotFromProducersV1({
  workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
  asOf: FOUNDATION_FIXTURE_AS_OF,
  intelligence,
  coverage
});

const inbox = buildIntelligenceInboxFromSnapshotV1({
  projection: projectIntelligenceInboxV1(intelligenceBuild.snapshot),
  intelligence
});
assert.deepEqual(inbox.insights, intelligence.insights, "Intelligence Inbox must retain the complete legacy presentation payload");
assert.equal(inbox.parity.status, "exact");
assert.equal(inbox.parity.classification, "exact");

const reorderedIntelligence = { ...intelligence, insights: [...intelligence.insights].reverse() };
const reorderedBuild = buildIntelligenceSnapshotFromProducersV1({
  workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
  asOf: FOUNDATION_FIXTURE_AS_OF,
  intelligence: reorderedIntelligence
});
const reorderedInbox = buildIntelligenceInboxFromSnapshotV1({
  projection: projectIntelligenceInboxV1(reorderedBuild.snapshot),
  intelligence: reorderedIntelligence
});
assert.deepEqual(
  reorderedInbox.insights.map((item) => item.id),
  reorderedIntelligence.insights.map((item) => item.id),
  "canonical ordering tie-breakers must not change customer-facing Inbox order"
);
assert.equal(reorderedInbox.parity.classification, "ordering_only");

const malformedInboxProjection = clone(projectIntelligenceInboxV1(intelligenceBuild.snapshot));
malformedInboxProjection.findings[0].title = "Changed outside the producer";
assert.throws(
  () => buildIntelligenceInboxFromSnapshotV1({ projection: malformedInboxProjection, intelligence }),
  /disagrees/,
  "malformed projected findings must fail closed"
);

const finding = intelligence.topRisk;
assert.ok(finding, "fixture requires a selected finding");
const findingNow = new Date(FOUNDATION_FIXTURE_AS_OF);
const legacyFindingPackage = buildFindingExplanationPackage({
  workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
  insight: finding,
  now: findingNow
});
const migratedFinding = buildFindingExplanationFromSnapshotV1({
  workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
  insight: finding,
  snapshot: intelligenceBuild.snapshot,
  now: findingNow
});
assert.deepEqual(migratedFinding.analysisPackage, legacyFindingPackage, "Explain Finding package and cache fingerprint must remain exact");
assert.deepEqual(
  findingExplanationModelInput(migratedFinding.analysisPackage),
  findingExplanationModelInput(legacyFindingPackage),
  "Explain Finding provider request payload must remain exact"
);
assert.equal(migratedFinding.parity.status, "exact");
assert.equal(migratedFinding.analysisPackage.fingerprint, legacyFindingPackage.fingerprint);
assert.equal(projectFindingExplanationV1(intelligenceBuild.snapshot, "missing-finding").finding.state, "unavailable");
assert.throws(
  () => buildFindingExplanationFromSnapshotV1({
    workspaceId: "foreign-workspace",
    insight: finding,
    snapshot: intelligenceBuild.snapshot,
    now: findingNow
  }),
  /another workspace/,
  "Explain Finding must enforce workspace isolation before projection"
);

const malformedFindingSnapshot = clone(intelligenceBuild.snapshot);
malformedFindingSnapshot.findings.find((item) => item.id === finding.id).title = "Changed outside the producer";
const originalVercelEnvironment = process.env.VERCEL_ENV;
process.env.VERCEL_ENV = "production";
assert.throws(
  () => buildFindingExplanationFromSnapshotV1({
    workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
    insight: finding,
    snapshot: malformedFindingSnapshot,
    now: findingNow
  }),
  /disagrees/,
  "Explain Finding must reject malformed snapshot input in Production"
);
process.env.VERCEL_ENV = originalVercelEnvironment;

const executiveOverview = buildExecutiveHomepageFromSnapshotV1({
  projection: projectExecutiveOverviewV1(intelligenceBuild.snapshot),
  intelligence,
  coverage,
  snapshots: [],
  kpiTrends: [],
  sourceDataAvailable: true
});
const legacyExecutiveOverview = buildExecutiveHomepageModel({
  intelligence,
  coverage,
  snapshots: [],
  kpiTrends: [],
  sourceDataAvailable: true
});
assert.equal(executiveOverview.parity.status, "exact");
assert.deepEqual(executiveOverview.model, legacyExecutiveOverview, "Executive Overview must preserve its complete legacy rendered model");
assert.equal(executiveOverview.model.health.score, intelligence.businessHealth.score);
assert.equal(executiveOverview.model.health.confidence, intelligence.dataQuality.confidence);

const malformedExecutiveProjection = clone(projectExecutiveOverviewV1(intelligenceBuild.snapshot));
malformedExecutiveProjection.businessHealth.value.score += 1;
process.env.VERCEL_ENV = "production";
assert.throws(
  () => buildExecutiveHomepageFromSnapshotV1({
    projection: malformedExecutiveProjection,
    intelligence,
    coverage,
    snapshots: [],
    kpiTrends: [],
    sourceDataAvailable: true
  }),
  /disagrees/,
  "Executive Overview must reject malformed snapshot input in Production"
);
process.env.VERCEL_ENV = "preview";
const originalConsoleError = console.error;
console.error = () => {};
try {
  const executiveFallback = buildExecutiveHomepageFromSnapshotV1({
    projection: malformedExecutiveProjection,
    intelligence,
    coverage,
    snapshots: [],
    kpiTrends: [],
    sourceDataAvailable: true
  });
  assert.equal(executiveFallback.parity.status, "fallback");
  const findingFallback = buildFindingExplanationFromSnapshotV1({
    workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
    insight: finding,
    snapshot: malformedFindingSnapshot,
    now: findingNow
  });
  assert.equal(findingFallback.parity.status, "fallback");
} finally {
  console.error = originalConsoleError;
  process.env.VERCEL_ENV = originalVercelEnvironment;
}

const fixtureMetrics = foundationKpiProducerOutput();
const kpiRows = [];
const kpiSettings = [];
for (const metric of fixtureMetrics) {
  const semantics = metric.semantics;
  const points = metric.observations.selectedRange.boundedObservations;
  points.forEach((point, index) => {
    kpiRows.push({
      id: index === points.length - 1 ? metric.id : `${metric.id}:row:${index + 1}`,
      workspace_id: FOUNDATION_FIXTURE_WORKSPACE_ID,
      name: semantics.displayName,
      category: "Fixture",
      target: metric.manualTarget,
      actual_value: point.value,
      metric_date: point.observedAt,
      created_at: `${point.observedAt}T00:00:00.000Z`,
      updated_at: `${point.observedAt}T00:00:00.000Z`,
      archived_at: null,
      deleted_at: null
    });
  });
  kpiSettings.push({
    id: `setting:${metric.id}`,
    workspace_id: FOUNDATION_FIXTURE_WORKSPACE_ID,
    kpi_name: semantics.displayName,
    target: metric.manualTarget,
    weight: 1,
    category: "Fixture",
    definition: null,
    color: "#10B981",
    is_visible: true,
    sort_order: 0,
    unit_type: null,
    display_unit: semantics.unit,
    value_format: null,
    x_axis_label: "Date",
    y_axis_label: semantics.displayName,
    preferred_chart_type: "line",
    canonical_name: semantics.canonicalName,
    display_name: semantics.displayName,
    original_source_label: semantics.originalSourceLabel,
    semantic_unit: semantics.unit,
    semantic_scale: semantics.scale,
    aggregation_basis: semantics.aggregationBasis,
    period_basis: semantics.periodBasis,
    desired_direction: semantics.desiredDirection,
    target_behavior: semantics.targetBehavior,
    ideal_value: semantics.idealValue,
    ideal_range_min: semantics.idealRangeMin,
    ideal_range_max: semantics.idealRangeMax,
    metric_role: semantics.metricRole,
    classification_source: semantics.classificationSource,
    classification_confidence: semantics.classificationConfidence,
    classification_confirmed: semantics.classificationConfirmed,
    classification_rationale: semantics.classificationRationale,
    created_at: FOUNDATION_FIXTURE_AS_OF,
    updated_at: FOUNDATION_FIXTURE_AS_OF
  });
}

const kpiProducer = buildCanonicalKpiProducerOutputV1({
  workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
  rows: kpiRows,
  settings: kpiSettings,
  asOf: FOUNDATION_FIXTURE_AS_OF
});
const kpiBuildStartedAt = process.hrtime.bigint();
const kpiBuild = buildIntelligenceSnapshotFromProducersV1({
  workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
  asOf: FOUNDATION_FIXTURE_AS_OF,
  kpis: kpiProducer
});
const kpiBuildMs = Number(process.hrtime.bigint() - kpiBuildStartedAt) / 1e6;
const kpiProjection = projectKpiPageV1(kpiBuild.snapshot);
const kpiStates = buildKpiPageStatesFromSnapshotV1({
  projection: kpiProjection,
  rows: kpiRows,
  settings: kpiSettings
});
assert.equal(kpiStates.states.length, 6);
assert.equal(kpiStates.byName.get("revenue").semantics.desiredDirection, "maximize");
assert.equal(kpiStates.byName.get("average checkout wait").semantics.desiredDirection, "minimize");
assert.equal(kpiStates.byName.get("average checkout wait").manualTarget, 4, "manual target remains authoritative");
assert.equal(kpiStates.byName.get("staff utilization").semantics.desiredDirection, "target_range");
assert.equal(kpiStates.byName.get("inventory variance").semantics.desiredDirection, "exact_target");
assert.equal(kpiStates.byName.get("staffing coverage").semantics.desiredDirection, "maintain");
assert.equal(kpiStates.byName.get("operational index").semantics.desiredDirection, "unknown");
assert.equal(kpiStates.byName.get("operational index").evaluation.targetStatus, "direction_unknown");
assert.equal(kpiStates.byName.get("operational index").recommendation.confidence, "Unavailable");
assert.ok(kpiProjection.kpis.every((kpi) => kpi.observations.selectedRange.boundedObservations.length <= 6));
assert.ok(JSON.stringify(kpiProjection).length < 100_000, "KPI page projection must remain bounded");

const checkout = kpiStates.byName.get("average checkout wait");
const detailProjection = projectKpiDetailV1(kpiBuild.snapshot, checkout.kpiId);
assert.equal(detailProjection.kpi.state, "available");
assert.deepEqual(
  materializeKpiPageStateV1({ snapshot: detailProjection.kpi.value, rows: kpiRows, settings: kpiSettings }),
  checkout,
  "KPI Detail must materialize the same canonical interpretation as KPI Overview"
);

const compareProjection = projectKpiCompareV1(kpiBuild.snapshot, [
  kpiStates.byName.get("revenue").kpiId,
  checkout.kpiId
]);
const compareStates = buildKpiCompareStatesFromSnapshotV1({
  projection: compareProjection,
  rows: kpiRows,
  settings: kpiSettings
});
assert.equal(compareStates.states.length, 2);
assert.equal(compareStates.byName.get("revenue").evaluation.selectedRangeTrend, "favorable");
assert.equal(compareStates.byName.get("average checkout wait").evaluation.selectedRangeTrend, "favorable");

const malformedKpi = clone(kpiProjection.kpis.find((kpi) => kpi.id === checkout.kpiId));
malformedKpi.semantics.value.desiredDirection = "maximize";
assert.throws(
  () => materializeKpiPageStateV1({ snapshot: malformedKpi, rows: kpiRows, settings: kpiSettings }),
  /semantics disagree/,
  "KPI projection disagreement must fail closed"
);
assert.throws(
  () => buildCanonicalKpiProducerOutputV1({
    workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
    rows: [{ ...kpiRows[0], workspace_id: "foreign-workspace" }],
    settings: kpiSettings,
    asOf: FOUNDATION_FIXTURE_AS_OF
  }),
  /another workspace/,
  "KPI snapshot production must reject cross-workspace rows"
);

const snapshotRuntimeSource = [
  read("lib/intelligence/snapshot/v1/composition.ts"),
  read("lib/intelligence/snapshot/v1/consumers/intelligence-inbox.ts"),
  read("lib/intelligence/snapshot/v1/consumers/executive-overview.ts"),
  read("lib/intelligence/snapshot/v1/consumers/kpi-pages.ts"),
  read("lib/ai/finding-explanation/snapshot-context.ts")
].join("\n");
assert.doesNotMatch(snapshotRuntimeSource, /runStructuredAI|runProvider|createClient\(|\.from\(/, "snapshot construction and projection must not call a provider or database");
assert.doesNotMatch(
  JSON.stringify(findingExplanationModelInput(migratedFinding.analysisPackage)),
  /snapshotFingerprint|IntelligenceSnapshotV1|fingerprints/,
  "the full snapshot and its diagnostics must never enter the provider request"
);

const overviewPage = read("app/app/page.tsx");
const intelligencePage = read("app/app/intelligence/page.tsx");
const kpiPage = read("app/app/kpis/page.tsx");
assert.match(overviewPage, /projectExecutiveOverviewV1/);
assert.match(overviewPage, /buildExecutiveHomepageFromSnapshotV1/);
assert.match(intelligencePage, /projectIntelligenceInboxV1/);
assert.match(intelligencePage, /buildFindingExplanationFromSnapshotV1/);
assert.match(kpiPage, /projectKpiPageV1/);
assert.match(kpiPage, /projectKpiDetailV1/);
assert.match(kpiPage, /projectKpiCompareV1/);
assert.match(kpiPage, /metricNames\.length > INTELLIGENCE_SNAPSHOT_LIMITS\.kpis/);
assert.match(kpiPage, /snapshot_v1_consumer_left_on_legacy/, "out-of-contract KPI cardinality must remain wholly on legacy");
assert.doesNotMatch(read("app/app/people/page.tsx"), /IntelligenceSnapshotV1|projectPeoplePrestigeV1/, "People retirement remains a separate PR");
assert.match(read("app/api/search/route.ts"), /buildBoundedWorkspaceContext/, "Executive reasoning remains on its legacy bounded context until V1 can prove exact provider parity");
assert.match(read("lib/ai/kpi-overview.ts"), /recent_values: metric\.history/, "raw conversational KPI context remains legacy because V1 omits per-point targets");
assert.match(read("docs/architecture/adr-004-final-snapshot-consumer-migration.md"), /cannot prove exact parity/);

const performance = {
  intelligence_snapshot_build_ms: averageRuntimeMs(() => buildIntelligenceSnapshotFromProducersV1({
    workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
    asOf: FOUNDATION_FIXTURE_AS_OF,
    intelligence,
    coverage
  })),
  intelligence_inbox_projection_ms: averageRuntimeMs(() => buildIntelligenceInboxFromSnapshotV1({
    projection: projectIntelligenceInboxV1(intelligenceBuild.snapshot),
    intelligence
  })),
  executive_overview_projection_ms: averageRuntimeMs(() => buildExecutiveHomepageFromSnapshotV1({
    projection: projectExecutiveOverviewV1(intelligenceBuild.snapshot),
    intelligence,
    coverage,
    snapshots: [],
    kpiTrends: [],
    sourceDataAvailable: true
  })),
  finding_explanation_projection_ms: averageRuntimeMs(() => buildFindingExplanationFromSnapshotV1({
    workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
    insight: finding,
    snapshot: intelligenceBuild.snapshot,
    now: findingNow
  })),
  kpi_snapshot_build_ms: kpiBuildMs,
  kpi_page_projection_ms: averageRuntimeMs(() => buildKpiPageStatesFromSnapshotV1({
    projection: projectKpiPageV1(kpiBuild.snapshot),
    rows: kpiRows,
    settings: kpiSettings
  }))
};

console.log("Final snapshot consumer migration regressions passed.");
console.log(JSON.stringify(Object.fromEntries(
  Object.entries(performance).map(([key, value]) => [key, Number(value.toFixed(3))])
), null, 2));
