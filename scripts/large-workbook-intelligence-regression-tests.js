const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadTypeScriptModule(relativePath, stubs = {}) {
  const filePath = path.join(root, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    },
    fileName: filePath
  }).outputText;
  const module = { exports: {} };
  const localRequire = (id) => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id);
  Function("require", "module", "exports", compiled)(localRequire, module, module.exports);
  return module.exports;
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const worksheetTypes = loadTypeScriptModule("lib/imports/worksheet-types.ts");
const targets = loadTypeScriptModule("lib/imports/workbook-kpi-targets.ts");
const domains = ["Finance", "Sales", "Operations", "Customers", "People", "Inventory", "Digital"];
const months = Array.from({ length: 20 }, (_, index) => {
  const date = new Date(Date.UTC(2025, index, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
});

const worksheets = domains.map((domain, domainIndex) => {
  const metricColumns = Array.from({ length: 25 }, (_, metricIndex) =>
    metricIndex === 0 ? "Shared Margin %" : `${domain} Metric ${metricIndex}`
  );
  const rows = months.map((month, monthIndex) => ({
    values: Object.fromEntries([
      ["Month", month],
      ["Year", Number(month.slice(0, 4))],
      ...metricColumns.map((column, metricIndex) => [column, (domainIndex + 1) * 1_000 + metricIndex * 10 + monthIndex])
    ])
  }));
  return { name: domain, columns: ["Month", "Year", ...metricColumns], rows };
});

const metrics = worksheets.flatMap((worksheet) => {
  assert.strictEqual(worksheetTypes.detectWorksheetType(worksheet), "wide_time_series", `${worksheet.name} must remain a wide time series`);
  const inferred = worksheetTypes.inferWideTimeSeriesMetricColumns(worksheet, "Month");
  assert.strictEqual(inferred.length, 25, `${worksheet.name} must retain its 25 business measures`);
  assert(!inferred.includes("Year"), `${worksheet.name} must not promote the Year helper to a KPI`);
  return inferred.map((metricColumn) => ({ worksheetName: worksheet.name, metricColumn }));
});
assert.strictEqual(metrics.length, 175, "the stress fixture must contain more than 150 numeric business/helper candidates");

const targetInputs = [];
for (const domain of domains) {
  targetInputs.push({
    importRowId: `target-${targetInputs.length + 1}`,
    domain,
    kpiName: "Shared Margin %",
    target: 42,
    unit: "%",
    direction: "maximize"
  });
}
for (const metric of metrics.filter((candidate) => candidate.metricColumn !== "Shared Margin %").slice(0, 41)) {
  const index = targetInputs.length;
  const unit = ["$000", "%", "count", "hours"][index % 4];
  targetInputs.push({
    importRowId: `target-${index + 1}`,
    domain: metric.worksheetName,
    kpiName: metric.metricColumn,
    target: index + 100,
    unit,
    direction: index % 2 ? "minimize" : "maximize"
  });
}
assert.strictEqual(targetInputs.length, 48, "the stress fixture must contain the exact 48-row KPI target contract");

const targetWorksheet = {
  name: "KPI Targets",
  columns: ["Domain", "KPI Name", "Target", "Unit", "Direction"],
  rows: targetInputs.map((target) => ({ values: target }))
};
assert.strictEqual(worksheetTypes.detectWorksheetType(targetWorksheet), "kpi_targets", "the target contract must be recognized before generic KPI detection");

const registry = targets.buildWorkbookKpiTargetRegistry({ targets: targetInputs, metrics, hasTargetContract: true });
assert.deepStrictEqual(registry.errors, [], "all exact target/domain/metric identities must bind without ambiguity");
assert.strictEqual(registry.bindings.length, 48, "only the 48 target-declared KPI identities may become authoritative KPI series");
assert.strictEqual(registry.targetRowIds.length, 48, "every target row must retain import lineage");
assert.strictEqual(metrics.filter((metric) => !targets.workbookKpiTargetBindingForMetric(registry, metric.worksheetName, metric.metricColumn)).length, 127, "supporting numeric columns must remain outside the KPI contract");

const sharedBindings = registry.bindings.filter((binding) => binding.metricColumn === "Shared Margin %");
assert.strictEqual(sharedBindings.length, 7, "same-label KPIs in distinct domains must remain distinct");
assert(sharedBindings.every((binding) => binding.storageName.includes(" · ")), "cross-domain label collisions must receive stable domain-qualified storage identities");
assert.strictEqual(new Set(registry.bindings.map((binding) => binding.canonicalName)).size, 48, "canonical KPI identities must remain unique across scale and metric role");
for (const binding of registry.bindings) {
  assert.strictEqual(binding.targetBehavior, binding.direction === "maximize" ? "minimum_goal" : "maximum_limit", "target direction must bind deterministically");
  assert(Number.isFinite(binding.target), "authoritative targets must remain finite");
}

const aliasRegistry = targets.buildWorkbookKpiTargetRegistry({
  targets: [{ importRowId: "alias-1", domain: "Operations", kpiName: "Response Time", target: 4, unit: "hours", direction: "minimize" }],
  metrics: [{ worksheetName: "Operations", metricColumn: "Avg Response Hrs" }],
  hasTargetContract: true
});
assert.deepStrictEqual(aliasRegistry.errors, [], "bounded average/time/unit label normalization must bind equivalent target metadata");
assert.strictEqual(aliasRegistry.bindings[0].targetBehavior, "maximum_limit");

const perUnitRegistry = targets.buildWorkbookKpiTargetRegistry({
  targets: [{ importRowId: "alias-2", domain: "Sales", kpiName: "Sales per Sq Ft", target: 200, unit: "$ / Sq Ft", direction: "maximize" }],
  metrics: [{ worksheetName: "Sales", metricColumn: "Sales / Sq Ft" }],
  hasTargetContract: true
});
assert.deepStrictEqual(perUnitRegistry.errors, [], "per-unit slash labels must normalize without losing their currency display contract");
assert.strictEqual(perUnitRegistry.bindings[0].valueFormat, "currency");

const grossMarginMetrics = [
  { worksheetName: "Sales & Merchandising", metricColumn: "Gross Margin %" },
  { worksheetName: "Sales & Merchandising", metricColumn: "Gross Margin $000" },
  { worksheetName: "Finance", metricColumn: "Gross Margin %" }
];
const grossMarginTargets = [
  { importRowId: "sales-margin-target", domain: "Sales & Merchandising", kpiName: "Gross Margin", target: 38.5, unit: "%", direction: "maximize" },
  { importRowId: "finance-margin-target", domain: "Finance", kpiName: "Gross Margin", target: 38.5, unit: "%", direction: "maximize" }
];
const grossMarginRegistry = targets.buildWorkbookKpiTargetRegistry({
  targets: grossMarginTargets,
  metrics: grossMarginMetrics,
  hasTargetContract: true
});
const retriedGrossMarginRegistry = targets.buildWorkbookKpiTargetRegistry({
  targets: grossMarginTargets,
  metrics: grossMarginMetrics,
  hasTargetContract: true
});
assert.deepStrictEqual(grossMarginRegistry.errors, [], "domain plus compatible unit/scale must resolve qualified gross-margin targets without ambiguity");
assert.deepStrictEqual(retriedGrossMarginRegistry, grossMarginRegistry, "retrying the same reviewed target contract must resolve idempotently");
assert.deepStrictEqual(
  grossMarginRegistry.bindings.map((binding) => [binding.worksheetName, binding.metricColumn, binding.canonicalName]),
  [
    ["Sales & Merchandising", "Gross Margin %", "sales_and_merchandising_gross_margin"],
    ["Finance", "Gross Margin %", "finance_gross_margin"]
  ],
  "each reviewed percentage target must bind to the exact percentage measure in its own domain"
);
assert.strictEqual(
  targets.workbookKpiTargetBindingForMetric(grossMarginRegistry, "Sales & Merchandising", "Gross Margin $000"),
  null,
  "the dollar gross-margin measure must remain supporting evidence rather than inherit the percentage target"
);
assert.strictEqual(
  targets.workbookKpiTargetBindingForMetric(grossMarginRegistry, "Sales & Merchandising", "Gross Margin %").sourceUnit,
  "%",
  "the selected Sales binding must retain the reviewed percent scale"
);
assert.strictEqual(
  targets.workbookKpiTargetBindingForMetric(grossMarginRegistry, "Finance", "Gross Margin %").sourceUnit,
  "%",
  "the Finance target must remain isolated from the Sales domain"
);

const conflictingUnitRegistry = targets.buildWorkbookKpiTargetRegistry({
  targets: [{ importRowId: "wrong-unit", domain: "Sales & Merchandising", kpiName: "Gross Margin", target: 38.5, unit: "%", direction: "maximize" }],
  metrics: [{ worksheetName: "Sales & Merchandising", metricColumn: "Gross Margin $000" }],
  hasTargetContract: true
});
assert.strictEqual(conflictingUnitRegistry.bindings.length, 0, "an explicitly incompatible metric unit must fail closed");
assert.match(conflictingUnitRegistry.errors[0], /compatible unit %/, "the unit conflict must remain explicit and reviewable");

const exactBeforeAliasRegistry = targets.buildWorkbookKpiTargetRegistry({
  targets: [{ importRowId: "exact-before-alias", domain: "Operations", kpiName: "Response Time", target: 4, unit: "hours", direction: "minimize" }],
  metrics: [
    { worksheetName: "Operations", metricColumn: "Response Time Hours" },
    { worksheetName: "Operations", metricColumn: "Avg Response Hrs" }
  ],
  hasTargetContract: true
});
assert.deepStrictEqual(exactBeforeAliasRegistry.errors, [], "a qualified exact label must outrank a bounded alias");
assert.strictEqual(exactBeforeAliasRegistry.bindings[0].metricColumn, "Response Time Hours", "an alias must not compete with an exact qualified match");

const unmatched = targets.buildWorkbookKpiTargetRegistry({
  targets: [{ importRowId: "bad-1", domain: "Finance", kpiName: "Not Present", target: 1, unit: "count", direction: "maximize" }],
  metrics,
  hasTargetContract: true
});
assert.strictEqual(unmatched.bindings.length, 0);
assert.match(unmatched.errors[0], /does not match a metric column/, "unmatched authoritative metadata must fail closed");
assert.strictEqual(targets.parseWorkbookKpiTargetDirection("increase"), null, "unsupported target direction must never be guessed");

const businessNotesSheet = {
  name: "Business Notes",
  columns: ["Date", "Topic", "Note", "Owner"],
  rows: months.slice(0, 14).map((month) => ({ values: { Date: month, Topic: "Context", Note: "Synthetic supporting context", Owner: "Founder" } }))
};
assert.notStrictEqual(worksheetTypes.detectWorksheetType(businessNotesSheet), "kpi_targets", "Business Notes must not become target authority");
assert.notStrictEqual(worksheetTypes.detectWorksheetType(businessNotesSheet), "wide_time_series", "Business Notes must not become KPI observations");

const blockedState = loadTypeScriptModule("lib/intelligence/blocked-state.ts", {
  "@/lib/kpis/settings": {
    normalizeKpiName: (value) => value.trim().toLowerCase(),
    kpiSemantics: (name, settings) => ({ desiredDirection: settings.find((setting) => setting.kpi_name === name)?.desired_direction || "unknown" })
  }
});
const unavailableIntelligence = { businessHealth: { available: false, unavailableReason: "no_evaluable_performance_outcome" } };
assert.strictEqual(blockedState.buildIntelligenceBlockedState({
  intelligence: unavailableIntelligence,
  kpis: registry.bindings.map((binding) => ({ name: binding.storageName, target: binding.target })),
  settings: []
}).code, "kpi_semantics_unconfirmed", "the UI must distinguish unconfirmed KPI meaning from missing source data");
assert.strictEqual(blockedState.buildIntelligenceBlockedState({
  intelligence: unavailableIntelligence,
  kpis: [{ name: "Revenue", target: null }],
  settings: [{ kpi_name: "Revenue", desired_direction: "maximize" }]
}).code, "targets_unavailable", "the UI must distinguish missing targets from missing source data");

const Module = require("node:module");
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
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { buildIntelligenceLayer } = require("../lib/intelligence/layer.ts");
const stressFile = {
  id: "stress-file",
  display_name: "Synthetic retail stress workbook.xlsx",
  original_name: "Synthetic retail stress workbook.xlsx",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  archived_at: null,
  deleted_at: null,
  metadata_json: {}
};
const stressImport = { id: "stress-import", file_upload_id: stressFile.id };
const stressKpis = registry.bindings.flatMap((binding, bindingIndex) => months.map((month, monthIndex) => {
  const favorableDelta = Math.max(1, Math.abs(binding.target) * 0.05);
  return {
    id: `stress-kpi-${bindingIndex}-${monthIndex}`,
    name: binding.storageName,
    category: binding.category,
    actual_value: binding.direction === "maximize" ? binding.target + favorableDelta : binding.target - favorableDelta,
    target: binding.target,
    metric_date: `${month}-01`,
    source: "Synthetic retail stress workbook.xlsx",
    source_file_id: stressFile.id,
    import_id: stressImport.id,
    import_row_id: `stress-row-${bindingIndex}-${monthIndex}`,
    created_at: `${month}-01T00:00:00.000Z`,
    updated_at: `${month}-01T00:00:00.000Z`,
    archived_at: null,
    deleted_at: null
  };
}));
const stressSettings = registry.bindings.map((binding, index) => ({
  id: `stress-setting-${index}`,
  kpi_name: binding.storageName,
  canonical_name: binding.canonicalName,
  display_name: binding.displayName,
  original_source_label: binding.metricColumn,
  semantic_unit: binding.semanticUnit,
  semantic_scale: binding.semanticScale,
  desired_direction: binding.direction,
  target_behavior: binding.targetBehavior,
  ideal_value: null,
  ideal_range_min: null,
  ideal_range_max: null,
  metric_role: "actual",
  classification_source: "user",
  classification_confidence: 1,
  classification_confirmed: true,
  classification_rationale: "Reviewed KPI Targets worksheet.",
  definition: null,
  target: binding.target,
  is_visible: true
}));
const stressIntelligence = buildIntelligenceLayer({
  asOf: "2026-08-31T12:00:00.000Z",
  kpis: stressKpis,
  kpiSettings: stressSettings,
  files: [stressFile],
  imports: [stressImport],
  sops: [{
    id: "stress-sop",
    title: "Synthetic operating procedure",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    archived_at: null,
    deleted_at: null
  }]
});
assert.strictEqual(stressKpis.length, 960, "48 canonical KPIs must retain all 20 historical observations");
assert.strictEqual(stressIntelligence.businessHealth.available, true, "confirmed target-bound stress data must become Business Health eligible");
assert.strictEqual(stressIntelligence.businessHealth.components.driverImpacts.length, 5, "Formula V2 must retain its intentional five-achievement positive score cap");
assert.strictEqual(stressIntelligence.insights.filter((insight) => insight.businessHealthEffect).length, 48, "all eligible KPI outcomes must remain represented before presentation limits");

const stressRiskIntelligence = buildIntelligenceLayer({
  asOf: "2026-08-31T12:00:00.000Z",
  kpis: stressKpis.map((row) => {
    const setting = stressSettings.find((candidate) => candidate.kpi_name === row.name);
    return {
      ...row,
      actual_value: setting.desired_direction === "maximize" ? row.target * 0.8 : row.target * 1.2
    };
  }),
  kpiSettings: stressSettings,
  files: [stressFile],
  imports: [stressImport],
  sops: [{
    id: "stress-sop",
    title: "Synthetic operating procedure",
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    archived_at: null,
    deleted_at: null
  }]
});
const stressKpiRisks = stressRiskIntelligence.insights.filter((insight) => insight.type === "Risk" && insight.fingerprint.startsWith("kpi:"));
assert.strictEqual(stressKpiRisks.length, 48, "all material KPI target misses must reach Formula V2 before its risk cap");
assert.strictEqual(new Set(stressKpiRisks.map((insight) => insight.fingerprint)).size, 48, "generic domain topics must not collapse distinct canonical KPI findings");

const actions = read("app/app/files/actions.ts");
const loader = read("lib/kpis/load-workspace-kpis.ts");
const kpiPage = read("app/app/kpis/page.tsx");
assert.match(actions, /targetRegistry\.hasTargetContract\s*&&\s*!targetBinding\) continue/, "target-declared workbooks must not promote undeclared numeric fields");
assert.match(actions, /targetRegistry\.errors\.length/, "ambiguous or unmatched KPI target metadata must fail the workbook import closed");
assert.match(actions, /classification_confirmed:[\s\S]{0,100}true/, "reviewed target metadata must persist confirmed deterministic performance meaning");
assert.match(actions, /preserveConfirmedSemantics = Boolean\(existing\?\.classification_confirmed && existing\.desired_direction !== "unknown"\)/, "existing manually confirmed KPI semantics must remain authoritative");
assert.match(actions, /target: existing\?\.target \?\? binding\.target/, "an existing manual KPI target must remain authoritative over imported target metadata");
assert.match(actions, /Vaeroex target metadata row/, "KPI observations must retain target-metadata lineage");
assert.match(actions, /const evidenceWorksheets = enabledPlans\.flatMap/, "every approved worksheet must remain eligible for source-evidence indexing");
assert.match(actions, /indexWorksheetImportEvidence\([\s\S]{0,180}worksheets: evidenceWorksheets/, "supporting measures must remain retrievable through indexed workbook evidence");
assert.match(loader, /WORKSPACE_KPI_PAGE_SIZE = 1_000/);
assert.match(loader, /WORKSPACE_KPI_LOAD_LIMIT = 20_000/);
assert.match(loader, /\.range\(from, from \+ WORKSPACE_KPI_PAGE_SIZE - 1\)/, "large KPI history must use explicit deterministic pagination");
assert.match(loader, /exceeds the supported/, "history overflow must fail closed instead of silently truncating");
for (const route of ["app/app/page.tsx", "app/app/kpis/page.tsx", "app/app/intelligence/page.tsx"]) {
  const source = read(route);
  assert.match(source, /loadActiveWorkspaceKpis/, `${route} must share the bounded complete-history loader`);
  assert.doesNotMatch(source, /from\("kpis"\)[\s\S]{0,260}\.limit\(500\)/, `${route} must not silently cap KPI input at 500 observations`);
}
assert.match(kpiPage, /Manage or deactivate this series/, "KPI detail must expose the existing reviewed records lifecycle");
assert.match(kpiPage, /section=records&q=/, "series management must route through the existing record-level archive workflow");
assert.doesNotMatch(kpiPage, /deactivateKpiSeriesAction/, "series management must not add a parallel bulk-destructive mutation path");

const sourceEligibility = loadTypeScriptModule("lib/intelligence/source-parent-eligibility.ts");
const importedRows = [
  { id: "direct", source_file_id: "source-a", import_id: null },
  { id: "imported", source_file_id: null, import_id: "import-a" }
];
const activeEligibility = sourceEligibility.buildSourceParentEligibility({
  files: [{ id: "source-a", archived_at: null, deleted_at: null }],
  imports: [{ id: "import-a", file_upload_id: "source-a" }]
});
assert.deepStrictEqual(sourceEligibility.filterBySourceParentEligibility(importedRows, activeEligibility).map((row) => row.id), ["direct", "imported"]);
const archivedEligibility = sourceEligibility.buildSourceParentEligibility({
  files: [{ id: "source-a", archived_at: "2026-08-10T00:00:00.000Z", deleted_at: null }],
  imports: [{ id: "import-a", file_upload_id: "source-a" }]
});
assert.deepStrictEqual(sourceEligibility.filterBySourceParentEligibility(importedRows, archivedEligibility), [], "archiving a source must make both direct and import-linked KPI observations parent-ineligible for future intelligence");

function paginatedSupabase(totalRows) {
  const ranges = [];
  return {
    ranges,
    client: {
      from(table) {
        assert.strictEqual(table, "kpis");
        let selected = "";
        let requestedFrom = 0;
        const query = {
          select(columns) {
            selected = columns;
            return query;
          },
          eq() { return query; },
          is() { return query; },
          order() { return query; },
          range(from, to) {
            requestedFrom = from;
            ranges.push([from, to]);
            if (selected === "*") {
              const size = Math.max(0, Math.min(to + 1, totalRows) - from);
              return Promise.resolve({
                data: Array.from({ length: size }, (_, index) => ({ id: `kpi-${from + index}`, name: "Revenue" })),
                error: null
              });
            }
            return query;
          },
          maybeSingle() {
            return Promise.resolve({ data: requestedFrom < totalRows ? { id: `kpi-${requestedFrom}` } : null, error: null });
          }
        };
        return query;
      }
    }
  };
}

async function verifyPagination() {
  const workspaceKpis = loadTypeScriptModule("lib/kpis/load-workspace-kpis.ts");
  const bounded = paginatedSupabase(2_005);
  const boundedResult = await workspaceKpis.loadActiveWorkspaceKpis({ supabase: bounded.client, workspaceId: "workspace-stress" });
  assert.strictEqual(boundedResult.complete, true);
  assert.strictEqual(boundedResult.data.length, 2_005, "all observations across more than two PostgREST pages must reach intelligence consumers");
  assert.deepStrictEqual(bounded.ranges, [[0, 999], [1000, 1999], [2000, 2999]], "pagination must be deterministic and contiguous");

  const overflow = paginatedSupabase(20_001);
  const overflowResult = await workspaceKpis.loadActiveWorkspaceKpis({ supabase: overflow.client, workspaceId: "workspace-overflow" });
  assert.strictEqual(overflowResult.complete, false);
  assert.strictEqual(overflowResult.data.length, 0, "bounded overflow must fail closed without returning a partial history");
  assert.match(overflowResult.error.message, /exceeds the supported 20,000-observation workspace bound/);
}

verifyPagination()
  .then(() => console.log("Large workbook intelligence regression checks passed (7 domains, 20 months, 175 measures, 48 authoritative KPIs)."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
