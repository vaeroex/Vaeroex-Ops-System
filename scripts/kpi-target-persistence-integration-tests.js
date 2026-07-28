const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const workspaceId = "preview-workspace";
const userId = "preview-owner";
const kpiName = "Average Checkout Wait";
const revalidatedPaths = [];
const submittedPayloads = [];

const persistedRows = [{
  id: "setting-checkout-wait",
  workspace_id: workspaceId,
  kpi_name: kpiName,
  category: "Operations",
  target: null,
  weight: 1,
  definition: "Average customer checkout wait.",
  color: "#10B981",
  is_visible: true,
  sort_order: 0,
  unit_type: "minutes",
  display_unit: "minutes",
  value_format: "decimal",
  x_axis_label: "Date",
  y_axis_label: "Minutes",
  preferred_chart_type: "line",
  canonical_name: "average_checkout_wait",
  display_name: kpiName,
  original_source_label: kpiName,
  semantic_unit: "minutes",
  aggregation_basis: null,
  period_basis: null,
  desired_direction: "unknown",
  target_behavior: "unknown",
  ideal_value: null,
  ideal_range_min: null,
  ideal_range_max: null,
  metric_role: "actual",
  classification_source: "user",
  classification_confidence: null,
  classification_version: "kpi_semantics_v1",
  classification_rationale: "Direction has not been confirmed.",
  classification_confirmed: false,
  created_by: userId
}];

function settingsQuery() {
  const filters = {};
  const query = {
    select() { return query; },
    eq(column, value) { filters[column] = value; return query; },
    limit() { return query; },
    async maybeSingle() {
      const row = persistedRows.find((candidate) => Object.entries(filters).every(([column, value]) => candidate[column] === value));
      return { data: row || null, error: null };
    }
  };
  return query;
}

const supabase = {
  auth: { getUser: async () => ({ data: { user: { id: userId, email: "preview-owner@example.test" } } }) },
  from(table) {
    assert.equal(table, "kpi_settings");
    return {
      select: () => settingsQuery(),
      upsert(payload, options) {
        submittedPayloads.push(payload);
        assert.deepEqual(options, { onConflict: "workspace_id,kpi_name" });
        const index = persistedRows.findIndex((row) => row.workspace_id === payload.workspace_id && row.kpi_name === payload.kpi_name);
        const saved = { ...(index >= 0 ? persistedRows[index] : { id: "new-setting" }), ...payload };
        if (index >= 0) persistedRows[index] = saved;
        else persistedRows.push(saved);
        return {
          select(columns) {
            assert.equal(columns, "id,workspace_id,kpi_name,target");
            return {
              single: async () => ({
                data: { id: saved.id, workspace_id: saved.workspace_id, kpi_name: saved.kpi_name, target: saved.target },
                error: null
              })
            };
          }
        };
      }
    };
  }
};

function loadTypescriptModule(relativePath, mocks = {}) {
  const file = path.join(root, relativePath);
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
    fileName: file
  }).outputText;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = module.paths;
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(mocks, request)) return mocks[request];
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    loaded._compile(output, file);
  } finally {
    Module._load = originalLoad;
  }
  return loaded.exports;
}

const redirect = (location) => {
  const error = new Error(`redirect:${location}`);
  error.location = location;
  throw error;
};

const semanticDefaults = {
  canonicalName: "average_checkout_wait",
  displayName: kpiName,
  originalSourceLabel: kpiName,
  unit: "minutes",
  desiredDirection: "minimize",
  targetBehavior: "maximum_limit",
  idealValue: null,
  idealRangeMin: null,
  idealRangeMax: null,
  metricRole: "actual",
  classificationSource: "deterministic",
  classificationConfidence: 1,
  rationale: "Lower checkout wait is better."
};

const actions = loadTypescriptModule("app/app/operations/actions.ts", {
  "next/cache": { revalidatePath: (value) => revalidatedPaths.push(value) },
  "next/navigation": { redirect },
  "@/lib/ai/prompts/vaeroex-system-prompt": { VAEROEX_SYSTEM_PROMPT: "" },
  "@/lib/ai/kpi-semantics/service": { classifyAndPersistKpiSemantics: async () => null, KPI_SEMANTIC_ACCEPTANCE_CONFIDENCE: 0.92 },
  "@/lib/billing/require-active-subscription": { requireActiveSubscription: async () => undefined },
  "@/lib/kpis/settings": { approvedKpiColor: (value) => value, KPI_COLOR_PALETTE: [{ value: "#10B981", label: "Emerald" }] },
  "@/lib/kpis/semantics": {
    deterministicKpiSemantics: () => semanticDefaults,
    KPI_DESIRED_DIRECTIONS: ["maximize", "minimize", "target_range", "exact_target", "maintain", "unknown"],
    KPI_SEMANTIC_VERSION: "kpi_semantics_v1",
    KPI_TARGET_BEHAVIORS: ["minimum_goal", "maximum_limit", "acceptable_range", "exact_threshold", "stability_goal", "unknown"],
    validateKpiSemanticSelection: () => ({ ok: true })
  },
  "@/lib/reports/generation-policy": { legacyReportGenerationDisabled: () => true },
  "@/lib/security/tool-execution-gateway": { requireToolExecution: async () => undefined },
  "@/lib/supabase/server": { createSupabaseServerClient: async () => supabase },
  "@/lib/workspaces/current": {
    getWorkspaceContext: async () => ({ activeWorkspace: { id: workspaceId }, membership: { workspace_id: workspaceId, role: "owner", status: "active" } })
  }
});

function formDataFor(overrides = {}) {
  const formData = new FormData();
  const fields = {
    return_path: "/app/kpis?metric=Average%20Checkout%20Wait&section=detail",
    kpi_name: kpiName,
    category: "Operations",
    target: "",
    weight: "1",
    definition: "Average customer checkout wait.",
    color: "#10B981",
    is_visible: "true",
    sort_order: "0",
    unit_type: "minutes",
    display_unit: "minutes",
    value_format: "decimal",
    x_axis_label: "Date",
    y_axis_label: "Minutes",
    preferred_chart_type: "line",
    semantic_update: "true",
    canonical_name: "average_checkout_wait",
    display_name: kpiName,
    semantic_unit: "minutes",
    aggregation_basis: "",
    period_basis: "",
    desired_direction: "unknown",
    target_behavior: "unknown",
    ideal_value: "",
    ideal_range_min: "",
    ideal_range_max: "",
    metric_role: "actual",
    ...overrides
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) formData.set(key, value);
  }
  return formData;
}

async function submit(formData) {
  try {
    await actions.updateKpiSettingAction(formData);
  } catch (error) {
    return error.location || "";
  }
  assert.fail("The server action should complete through its redirect contract.");
}

function persistedSetting() {
  return persistedRows.find((row) => row.workspace_id === workspaceId && row.kpi_name === kpiName);
}

function assertSingleCanonicalRow() {
  assert.equal(
    persistedRows.filter((row) => row.workspace_id === workspaceId && row.kpi_name === kpiName).length,
    1,
    "Every write path must reuse the workspace_id,kpi_name conflict key."
  );
}

(async () => {
  const targetRedirect = await submit(formDataFor({ target: "4" }));
  assert.match(targetRedirect, /message=KPI\+settings\+updated\./);
  assert.equal(submittedPayloads[0].target, 4, "The target save must submit numeric target 4.");
  assert.equal(submittedPayloads[0].workspace_id, workspaceId);
  assert.equal(submittedPayloads[0].kpi_name, kpiName);
  assert.equal(persistedSetting().target, 4, "Reloading persistence after the target save must return target 4.");
  assert.equal(persistedSetting().desired_direction, "unknown", "Saving a target must not invent directional meaning.");
  assert.equal(persistedSetting().classification_confirmed, false, "Unknown semantics must remain fail-closed.");
  assertSingleCanonicalRow();

  const directionRedirect = await submit(formDataFor({
    target: "4",
    desired_direction: "minimize",
    target_behavior: "maximum_limit"
  }));
  assert.match(directionRedirect, /message=KPI\+settings\+updated\./);
  assert.equal(submittedPayloads[1].target, 4, "Confirming direction must preserve the manual target.");
  assert.equal(submittedPayloads[1].desired_direction, "minimize", "The direction save must submit lower-is-better semantics.");
  assert.equal(persistedSetting().target, 4, "Reloading after direction confirmation must still return target 4.");
  assert.equal(persistedSetting().desired_direction, "minimize", "Reloading persistence must return the confirmed direction.");
  assert.equal(persistedSetting().target_behavior, "maximum_limit");
  assert.equal(persistedSetting().classification_confirmed, true);
  assertSingleCanonicalRow();

  const recommendationRedirect = await submit(formDataFor({
    target: "3.75",
    semantic_update: undefined,
    desired_direction: undefined,
    target_behavior: undefined,
    canonical_name: undefined,
    display_name: undefined,
    semantic_unit: undefined,
    aggregation_basis: undefined,
    period_basis: undefined,
    ideal_value: undefined,
    ideal_range_min: undefined,
    ideal_range_max: undefined,
    metric_role: undefined,
    target_change_context: "recommended",
    previous_target: "4"
  }));
  assert.match(recommendationRedirect, /message=Recommended\+target\+applied\./);
  assert.match(recommendationRedirect, /target_applied=true/);
  assert.equal(submittedPayloads[2].target, 3.75, "Applying the recommendation must update the canonical target field.");
  assert.equal(submittedPayloads[2].desired_direction, "minimize", "Applying a recommendation must preserve confirmed semantics.");
  assert.equal(persistedSetting().target, 3.75, "Reloading persistence must return the recommended target.");
  assert.equal(persistedSetting().desired_direction, "minimize");
  assertSingleCanonicalRow();

  const settings = loadTypescriptModule("lib/kpis/settings.ts", {
    "@/lib/kpis/semantics": { resolveKpiSemantics: () => semanticDefaults }
  });
  const persisted = persistedSetting();
  const rebuiltRows = settings.applyKpiSettingsToRows([{ name: kpiName, target: null, category: "Operations" }], persistedRows);
  assert.equal(settings.kpiSettingForName(persistedRows, kpiName).id, persisted.id, "The page loader must resolve the exact row written by every action.");
  assert.equal(settings.configuredKpiTarget(kpiName, persistedRows), 3.75, "KPI detail must read the persisted recommended target.");
  assert.equal(rebuiltRows[0].target, 3.75, "KPI Overview must rebuild the KPI with the same target.");
  for (const expectedPath of ["/app", "/app/kpis", "/app/kpis/settings", "/app/reports"]) {
    assert.ok(revalidatedPaths.includes(expectedPath), `The action must revalidate ${expectedPath}.`);
  }

  console.log("KPI target, direction, and recommendation persistence integration passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
