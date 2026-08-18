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
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const {
  buildWorkspaceIntelligenceBriefingPackage,
  loadIntelligenceBriefingCrmHistory,
  loadWorkspaceIntelligenceBriefingStates
} = require("../lib/ai/intelligence-briefing/workspace-context.ts");
const {
  intelligenceBriefingStateAllowsGeneration,
  intelligenceBriefingVerificationUnavailableState
} = require("../lib/ai/intelligence-briefing/state.ts");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const sourceFileId = "22222222-2222-4222-8222-222222222222";
const asOf = "2026-08-17T12:00:00.000Z";

function createSupabaseFixture({ tables = {}, errors = {} } = {}) {
  const calls = [];

  class Query {
    constructor(table) {
      this.table = table;
      this.rangeStart = null;
      this.rangeEnd = null;
    }

    record(operation, ...args) {
      calls.push({ table: this.table, operation, args });
      return this;
    }

    select(...args) { return this.record("select", ...args); }
    eq(...args) { return this.record("eq", ...args); }
    in(...args) { return this.record("in", ...args); }
    contains(...args) { return this.record("contains", ...args); }
    lte(...args) { return this.record("lte", ...args); }
    order(...args) { return this.record("order", ...args); }
    limit(...args) { return this.record("limit", ...args); }
    is(column, value) {
      if (this.table === "crm_lead_history" && column === "deleted_at") {
        throw new Error("42703: crm_lead_history.deleted_at does not exist in the Production schema");
      }
      return this.record("is", column, value);
    }
    range(start, end) {
      this.rangeStart = start;
      this.rangeEnd = end;
      return this.record("range", start, end);
    }
    maybeSingle() {
      const data = this.result().data;
      return Promise.resolve({ data: data[0] || null, error: this.result().error });
    }
    result() {
      const error = errors[this.table] ? { message: errors[this.table] } : null;
      const rows = tables[this.table] || [];
      const data = this.rangeStart === null ? rows : rows.slice(this.rangeStart, this.rangeEnd + 1);
      return { data, error };
    }
    then(resolve, reject) {
      return Promise.resolve(this.result()).then(resolve, reject);
    }
  }

  return {
    calls,
    client: { from: (table) => new Query(table) }
  };
}

const typesSource = read("lib/supabase/types.ts");
const historyType = typesSource.match(/crm_lead_history:\s*\{[\s\S]*?Relationships:/)?.[0] || "";
assert.ok(historyType, "the generated Production-shaped CRM history contract must be present");
assert.doesNotMatch(historyType, /deleted_at/, "crm_lead_history genuinely has no deleted_at column");

const historyMigration = read("supabase/migrations/202606180005_file_kpi_historical_memory.sql");
const historyTable = historyMigration.match(/create table if not exists public\.crm_lead_history \([\s\S]*?\n\);/)?.[0] || "";
assert.ok(historyTable, "the canonical CRM history table migration must be present");
assert.doesNotMatch(historyTable, /deleted_at|archived_at/, "CRM history has no row lifecycle column silently bypassed by the briefing query");
assert.match(historyTable, /lead_id uuid not null references public\.crm_leads\(id\) on delete cascade/, "CRM history retains its canonical parent relationship");

for (const consumer of ["app/app/page.tsx", "app/app/crm/page.tsx"]) {
  const source = read(consumer);
  assert.match(source, /from\("crm_lead_history"\)\.select\("\*"\)\.eq\("workspace_id", workspaceId\)\.order\("created_at"/, `${consumer} must use the canonical workspace-scoped history query`);
  assert.doesNotMatch(source, /from\("crm_lead_history"\)[^\n]*\.is\("deleted_at"/, `${consumer} must not invent a CRM history lifecycle column`);
}

const historyRow = {
  id: "33333333-3333-4333-8333-333333333333",
  workspace_id: workspaceId,
  lead_id: "44444444-4444-4444-8444-444444444444",
  source_file_id: null,
  import_id: null,
  import_row_id: null,
  event_type: "updated",
  status: "active",
  estimated_value: 100,
  owner: null,
  notes: null,
  raw_data_json: {},
  created_by: null,
  created_at: "2026-08-15T12:00:00.000Z"
};

async function main() {
  const historyFixture = createSupabaseFixture({ tables: { crm_lead_history: [historyRow] } });
  const historyResult = await loadIntelligenceBriefingCrmHistory({ supabase: historyFixture.client, workspaceId });
  assert.equal(historyResult.error, null);
  assert.deepEqual(historyResult.data, [historyRow], "Production-shaped CRM history must load successfully without a deleted_at predicate");
  assert.equal(
    historyFixture.calls.some((call) => call.table === "crm_lead_history" && call.operation === "is"),
    false,
    "the briefing query must not apply a nonexistent CRM history lifecycle filter"
  );

  const zeroFixture = createSupabaseFixture({ tables: { crm_lead_history: [historyRow] } });
  const zeroStates = await loadWorkspaceIntelligenceBriefingStates({
    supabase: zeroFixture.client,
    workspaceId,
    workspace: { name: "Production-shaped workspace" },
    asOf
  });
  assert.equal(zeroStates.weekly.eligibility, "no_eligible_evidence", "a successful zero-evidence weekly query returns no eligible evidence");
  assert.equal(zeroStates.monthly.eligibility, "no_eligible_evidence", "CRM history alone does not manufacture measured briefing evidence");

  const failureFixture = createSupabaseFixture({ errors: { issues: "read failed" } });
  const failedStates = await loadWorkspaceIntelligenceBriefingStates({
    supabase: failureFixture.client,
    workspaceId,
    workspace: { name: "Production-shaped workspace" },
    asOf
  });
  assert.equal(failedStates.weekly.eligibility, "verification_unavailable", "query failure must remain distinct from verified zero evidence");
  assert.equal(failedStates.monthly.eligibility, "verification_unavailable");
  assert.equal(failedStates.weekly.status, "unavailable");

  const file = {
    id: sourceFileId,
    workspace_id: workspaceId,
    display_name: "Production-shaped KPI workbook.xlsx",
    original_name: "Production-shaped KPI workbook.xlsx",
    file_extension: "xlsx",
    import_type: "spreadsheet",
    analysis_summary: null,
    metadata_json: {},
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    processed_at: "2026-08-01T00:00:00.000Z",
    archived_at: null,
    deleted_at: null
  };
  const kpis = Array.from({ length: 47 }, (_, index) => ({
    id: `kpi-production-shaped-${index + 1}`,
    workspace_id: workspaceId,
    folder_id: null,
    name: `Production Metric ${String(index + 1).padStart(2, "0")}`,
    category: "Operations",
    target: 100,
    actual_value: 90 + index,
    metric_date: "2026-08-01",
    owner: null,
    notes: null,
    source: file.display_name,
    source_file_id: sourceFileId,
    import_id: null,
    import_row_id: null,
    raw_data_json: {},
    created_by: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    archived_at: null,
    deleted_at: null
  }));
  const settings = kpis.map((row, index) => ({
    id: `setting-production-shaped-${index + 1}`,
    workspace_id: workspaceId,
    kpi_name: row.name,
    category: row.category,
    target: 100,
    weight: 1,
    definition: null,
    color: "#38BDF8",
    color_source: "automatic",
    is_visible: true,
    sort_order: index,
    unit_type: "percentage",
    display_unit: "%",
    value_format: "number",
    x_axis_label: null,
    y_axis_label: null,
    preferred_chart_type: "line",
    canonical_name: `production_metric_${index + 1}`,
    display_name: row.name,
    original_source_label: row.name,
    aliases: [],
    semantic_unit: "%",
    semantic_scale: 1,
    aggregation_basis: null,
    period_basis: "monthly",
    desired_direction: "maximize",
    target_behavior: "minimum_goal",
    ideal_value: 100,
    ideal_range_min: null,
    ideal_range_max: null,
    metric_role: "actual",
    classification_source: "user",
    classification_confidence: 1,
    classification_version: "production-shaped-fixture-v1",
    classification_rationale: "Reviewed KPI target contract.",
    classification_confirmed: true,
    created_by: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z"
  }));
  const productionFixture = createSupabaseFixture({
    tables: {
      crm_lead_history: [historyRow],
      file_uploads: [file],
      kpis,
      kpi_settings: settings
    }
  });
  const productionStates = await loadWorkspaceIntelligenceBriefingStates({
    supabase: productionFixture.client,
    workspaceId,
    workspace: { name: "Production-shaped workspace" },
    asOf
  });
  assert.equal(productionStates.weekly.eligibility, "no_eligible_evidence", "August 1 observations are outside the rolling August 11-17 weekly period");
  assert.equal(productionStates.weekly.status, "unavailable");
  assert.equal(productionStates.monthly.eligibility, "limited", "one eligible independent source remains limited evidence");

  const weekly = await buildWorkspaceIntelligenceBriefingPackage({
    supabase: productionFixture.client,
    workspaceId,
    workspace: { name: "Production-shaped workspace" },
    briefingType: "weekly",
    asOf
  });
  const monthly = await buildWorkspaceIntelligenceBriefingPackage({
    supabase: productionFixture.client,
    workspaceId,
    workspace: { name: "Production-shaped workspace" },
    briefingType: "monthly",
    asOf
  });
  assert.equal(kpis.length, 47, "the Production-shaped fixture retains 47 parent-eligible observations and distinct metrics");
  assert.equal(new Set(kpis.map((row) => row.name)).size, 47);
  assert.equal(weekly.briefingPackage.businessHealth.available, true, "the fixture retains deterministic Business Health context");
  assert.equal(weekly.briefingPackage.eligibility, "no_eligible_evidence", "Business Health context cannot independently satisfy measured-evidence eligibility");
  assert.equal(
    monthly.briefingPackage.manifest.evidence.filter((entry) => entry.candidateId.startsWith("IB-KPI-")).length,
    24,
    "the bounded preflight selects 24 KPI evidence candidates"
  );
  assert.equal(monthly.briefingPackage.signals.filter((signal) => signal.kind === "kpi").length, 12, "the existing projection cap presents 12 KPI signals");
  assert.equal(monthly.briefingPackage.evidenceCoverage.independentSourceCount, 1);
  assert.equal(monthly.briefingPackage.eligibility, "limited");

  const verificationUnavailable = intelligenceBriefingVerificationUnavailableState({ briefingType: "weekly" });
  let providerInvocationCount = 0;
  for (const state of [verificationUnavailable, zeroStates.weekly]) {
    if (intelligenceBriefingStateAllowsGeneration(state)) providerInvocationCount += 1;
  }
  assert.equal(providerInvocationCount, 0, "verification failure and verified zero evidence must never enter provider execution");
  assert.equal(intelligenceBriefingStateAllowsGeneration(productionStates.monthly), true, "limited evidence remains eligible when provider policy is independently enabled");

  const cards = read("components/intelligence/IntelligenceBriefingCards.tsx");
  const action = read("app/app/intelligence/briefings/actions.ts");
  assert.match(cards, /if \(!generationEnabled\) return "Generation unavailable"/);
  assert.match(cards, /state\.eligibility === "verification_unavailable"/);
  assert.match(cards, /return "Evidence verification unavailable"/);
  assert.ok(cards.indexOf("Generation unavailable") !== cards.indexOf("Evidence verification unavailable"), "provider and evidence states remain independently represented");
  assert.ok(
    action.indexOf("intelligenceBriefingStateAllowsGeneration(state)") < action.indexOf("generateIntelligenceBriefing({"),
    "fail-closed evidence state validation must precede provider invocation"
  );
  assert.doesNotMatch(cards, /VAEROEX_INTELLIGENCE_BRIEFING_POLICY|gpt-5\.6|database|PostgREST|stack trace/i, "customer status text must not expose internals");

  console.log("Intelligence Briefing preflight regressions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
