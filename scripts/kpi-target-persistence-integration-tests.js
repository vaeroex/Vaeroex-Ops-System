const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const ts = require("typescript");
const { renderToStaticMarkup } = require("react-dom/server");

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
  color_source: "automatic",
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
  const matchingRows = () => persistedRows.filter((candidate) => Object.entries(filters).every(([column, value]) => candidate[column] === value));
  const query = {
    select() { return query; },
    eq(column, value) { filters[column] = value; return query; },
    limit() { return query; },
    async maybeSingle() {
      const row = matchingRows()[0];
      return { data: row || null, error: null };
    },
    then(resolve) {
      return Promise.resolve({ data: matchingRows(), error: null }).then(resolve);
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
      },
      update(payload) {
        const filters = {};
        const updateQuery = {
          eq(column, value) { filters[column] = value; return updateQuery; },
          select() {
            return {
              maybeSingle: async () => {
                const row = persistedRows.find((candidate) => Object.entries(filters).every(([column, value]) => candidate[column] === value));
                if (!row) return { data: null, error: null };
                Object.assign(row, payload);
                return { data: { id: row.id }, error: null };
              }
            };
          }
        };
        return updateQuery;
      }
    };
  }
};

function loadTypescriptModule(relativePath, mocks = {}, sourceOverride) {
  const file = path.join(root, relativePath);
  const output = ts.transpileModule(sourceOverride ?? fs.readFileSync(file, "utf8"), {
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

// Render the actual form inputs, including the dedicated settings page's local
// default initializer, so this check cannot pass with a test-only fallback.
function yAxisInputRenderers(relativePath, expectedCount) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  const ast = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const inputs = [];
  let yAxisInitializer;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "yAxisLabel") {
      yAxisInitializer = node.initializer.getText(ast);
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "input" && node.attributes.properties.some((attribute) => (
      ts.isJsxAttribute(attribute) && attribute.name.text === "name" && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "y_axis_label"
    ))) inputs.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.equal(inputs.length, expectedCount, `${relativePath} must exercise every Y-axis input.`);
  return inputs.map((input) => {
    const component = loadTypescriptModule(relativePath, {}, `
      export function renderInput(metricName, setting) {
        const metric = metricName;
        ${yAxisInitializer ? `const yAxisLabel = ${yAxisInitializer};` : ""}
        return (${input});
      }
    `).renderInput;
    return (metricName, setting) => {
      const html = renderToStaticMarkup(component(metricName, setting));
      const value = html.match(/\bvalue="([^"]*)"/);
      assert.ok(value, "The actual input must serialize a form value.");
      return value[1];
    };
  });
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
  "@/lib/kpis/settings": {
    allocateAutomaticKpiColors: (_workspaceId, identities) => new Map(identities.map((identity, index) => [String(identity).trim().toLowerCase(), index % 2 ? "#10B981" : "#38BDF8"])),
    approvedKpiColor: (value) => value,
    automaticKpiColorForIdentity: () => "#10B981",
    isLegacySystemDefaultKpiColor: (value) => ["#1E6BFF", "#38BDF8", "#10B981"].includes(value),
    normalizeKpiName: (value) => String(value || "").trim().toLowerCase(),
    KPI_COLOR_PALETTE: [
      { value: "#10B981", label: "Emerald" },
      { value: "#38BDF8", label: "Electric Blue" },
      { value: "#EF4444", label: "Red" }
    ]
  },
  "@/lib/kpis/semantics": {
    deterministicKpiSemantics: () => semanticDefaults,
    KPI_DESIRED_DIRECTIONS: ["maximize", "minimize", "target_range", "exact_target", "maintain", "unknown"],
    KPI_SEMANTIC_VERSION: "kpi_semantics_v1",
    KPI_TARGET_BEHAVIORS: ["minimum_goal", "maximum_limit", "acceptable_range", "exact_threshold", "stability_goal", "unknown"],
    validateKpiSemanticSelection: () => ({ ok: true })
  },
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

async function submitAction(action, formData) {
  try {
    await action(formData);
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
  assert.equal(persistedSetting().color_source, "user", "a full administrator settings save must make its selected color authoritative");
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
  assert.equal(persistedSetting().color_source, "user", "target recommendation updates must preserve existing color provenance");
  assertSingleCanonicalRow();

  const settings = loadTypescriptModule("lib/kpis/settings.ts", {
    "@/lib/kpis/semantics": { resolveKpiSemantics: () => semanticDefaults }
  });
  const persisted = persistedSetting();
  const rebuiltRows = settings.applyKpiSettingsToRows([{ name: kpiName, target: null, category: "Operations" }], persistedRows);
  assert.equal(settings.kpiSettingForName(persistedRows, kpiName).id, persisted.id, "The page loader must resolve the exact row written by every action.");
  assert.equal(settings.configuredKpiTarget(kpiName, persistedRows), 3.75, "KPI detail must read the persisted recommended target.");
  assert.equal(rebuiltRows[0].target, 3.75, "KPI Overview must rebuild the KPI with the same target.");
  for (const expectedPath of ["/app", "/app/kpis", "/app/kpis/settings"]) {
    assert.ok(revalidatedPaths.includes(expectedPath), `The action must revalidate ${expectedPath}.`);
  }

  persistedRows.push(
    { id: "legacy-one", workspace_id: workspaceId, kpi_name: "Legacy One", color: "#1E6BFF", color_source: "legacy_unclassified" },
    { id: "legacy-two", workspace_id: workspaceId, kpi_name: "Legacy Two", color: "#38BDF8", color_source: "legacy_unclassified" },
    { id: "manual-color", workspace_id: workspaceId, kpi_name: "Manual Color", color: "#EF4444", color_source: "user" }
  );
  const legacyForm = new FormData();
  legacyForm.set("return_path", "/app/kpis/settings");
  legacyForm.append("legacy_kpi_setting_id", "legacy-one");
  legacyForm.append("legacy_kpi_setting_id", "legacy-two");
  const legacyRedirect = await submitAction(actions.assignLegacyKpiColorsAction, legacyForm);
  assert.match(legacyRedirect, /message=2\+legacy\+KPI\+colors\+assigned\./);
  assert.equal(persistedRows.find((row) => row.id === "legacy-one").color_source, "automatic");
  assert.equal(persistedRows.find((row) => row.id === "legacy-two").color_source, "automatic");
  assert.equal(persistedRows.find((row) => row.id === "manual-color").color, "#EF4444", "legacy assignment must not overwrite a manual color");
  assert.equal(persistedRows.find((row) => row.id === "manual-color").color_source, "user");

  const manualSelectionForm = new FormData();
  manualSelectionForm.set("return_path", "/app/kpis/settings");
  manualSelectionForm.append("legacy_kpi_setting_id", "manual-color");
  const manualSelectionRedirect = await submitAction(actions.assignLegacyKpiColorsAction, manualSelectionForm);
  assert.match(manualSelectionRedirect, /error=One\+or\+more\+selected\+KPI\+colors\+are\+no\+longer\+eligible/);
  assert.equal(persistedRows.find((row) => row.id === "manual-color").color, "#EF4444", "caller selection must not promote a user color back to automatic");
  assert.equal(persistedRows.find((row) => row.id === "manual-color").color_source, "user");

  const longMetricName = "Google Sheets Test Orders Shipped - Google Sheets Test Business Entity - North Location - test0001";
  assert.ok(longMetricName.length > 80 && longMetricName.length <= 160);
  const generatedLabels = [
    [longMetricName, longMetricName.slice(0, 80)],
    ["A".repeat(79) + "😀", "A".repeat(79)],
    ["A".repeat(78) + "😀", "A".repeat(78) + "😀"]
  ];
  const renderers = [
    ...yAxisInputRenderers("app/app/kpis/page.tsx", 2),
    ...yAxisInputRenderers("app/app/kpis/settings/page.tsx", 1)
  ];
  for (const renderInput of renderers) {
    for (const unset of [undefined, { y_axis_label: null }]) {
      for (const [metricName, expectedLabel] of generatedLabels) {
        const label = renderInput(metricName, unset);
        assert.equal(label, expectedLabel, "Generated labels must retain complete Unicode characters within the unchanged server limit.");
        assert.ok(label.length <= 80);
        assert.equal(label.isWellFormed(), true, "The generated default must never contain a lone surrogate.");
      }
      assert.equal(renderInput("Orders shipped", unset), "Orders shipped", "Short generated labels stay unchanged.");
    }
    for (const savedLabel of ["Orders shipped", "", "A".repeat(81), "A".repeat(79) + "😀"]) {
      assert.equal(renderInput(longMetricName, { y_axis_label: savedLabel }), savedLabel, "Explicit stored labels are not rewritten.");
    }
    for (const [metricName, expectedLabel] of generatedLabels) {
      const directionForm = formDataFor({
        kpi_name: metricName,
        canonical_name: "google_sheets_test_orders_shipped",
        display_name: metricName,
        unit_type: "count",
        display_unit: "orders",
        semantic_unit: "count",
        target: "150",
        desired_direction: "maximize",
        target_behavior: "minimum_goal",
        y_axis_label: renderInput(metricName, undefined)
      });
      const longNameRedirect = await submit(directionForm);
      assert.match(longNameRedirect, /message=KPI\+settings\+updated\./, "Each actual form default must allow direction confirmation for long or Unicode metric names.");
      const saved = persistedRows.find((row) => row.workspace_id === workspaceId && row.kpi_name === metricName);
      assert.equal(saved.display_name, metricName, "Bounding the chart label must preserve full metric identity.");
      assert.equal(saved.y_axis_label, expectedLabel.trim(), "Form submission must persist the intact label without replacement characters.");
      assert.equal(saved.target, 150);
      assert.equal(saved.desired_direction, "maximize");
      assert.equal(saved.classification_confirmed, true);
      assert.equal(saved.classification_source, "user");
    }
  }
  for (const [metricName] of generatedLabels) {
    assert.equal(persistedRows.filter((row) => row.workspace_id === workspaceId && row.kpi_name === metricName).length, 1);
  }
  const countBeforeInvalidLabel = submittedPayloads.length;
  const invalidLabelRedirect = await submit(formDataFor({ y_axis_label: "A".repeat(81) }));
  assert.match(invalidLabelRedirect, /error=Y-axis\+label\+must\+be\+80\+characters\+or\+fewer/);
  assert.equal(submittedPayloads.length, countBeforeInvalidLabel, "An explicit overlong label must still be rejected before persistence.");

  console.log("KPI target, direction, recommendation, legacy color, and long-name chart label persistence integration passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
