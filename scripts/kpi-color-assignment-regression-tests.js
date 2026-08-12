const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function loadTypeScriptModule(relativePath, stubs = {}) {
  const filePath = path.join(root, relativePath);
  const compiled = ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filePath
  }).outputText;
  const loaded = { exports: {} };
  const localRequire = (id) => Object.prototype.hasOwnProperty.call(stubs, id) ? stubs[id] : require(id);
  Function("require", "module", "exports", compiled)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

const colors = loadTypeScriptModule("lib/kpis/settings.ts", {
  "@/lib/kpis/semantics": { resolveKpiSemantics: () => ({}) }
});
const workspaceId = "workspace-color-regression";
const palette = colors.AUTO_KPI_COLOR_PALETTE.map((entry) => entry.value);

function names(count, offset = 0) {
  return Array.from({ length: count }, (_, index) => `Domain ${Math.floor((index + offset) / 12) + 1} / KPI ${index + offset + 1}`);
}

function assignmentsFor(count) {
  return colors.allocateAutomaticKpiColors(workspaceId, names(count), []);
}

function histogram(assignments) {
  const counts = new Map(palette.map((color) => [color, 0]));
  for (const color of assignments.values()) counts.set(color, (counts.get(color) || 0) + 1);
  return [...counts.values()];
}

for (const count of [1, 10, 48, 160]) {
  const assigned = assignmentsFor(count);
  assert.equal(assigned.size, count, `${count} canonical KPI identities must receive one assignment each`);
  assert([...assigned.values()].every((color) => palette.includes(color)), "automatic assignments must use only the approved high-contrast palette");
  const counts = histogram(assigned);
  assert(Math.max(...counts) - Math.min(...counts) <= 1, `${count} KPI assignments must remain evenly distributed`);
}

const ordered = colors.allocateAutomaticKpiColors(workspaceId, names(48), []);
const reversed = colors.allocateAutomaticKpiColors(workspaceId, [...names(48)].reverse(), []);
assert.deepStrictEqual([...ordered.entries()].sort(), [...reversed.entries()].sort(), "assignment must not depend on request or query order");

const persistedAutomatic = [...ordered.entries()].map(([identity, color]) => ({
  kpi_name: identity,
  color,
  color_source: "automatic"
}));
const added = colors.allocateAutomaticKpiColors(workspaceId, names(24, 48), persistedAutomatic);
assert.equal(added.size, 24, "a later upload must assign only its new KPI identities");
for (const setting of persistedAutomatic) {
  assert.equal(colors.kpiColor(setting.kpi_name, [setting]), setting.color, "later uploads must not change existing automatic colors");
}

const manual = { kpi_name: "Finance / Net Margin %", color: "#EF4444", color_source: "user" };
assert.equal(colors.kpiColor(manual.kpi_name, [manual]), "#EF4444", "manual color customization must remain authoritative");
assert.equal(
  colors.kpiColor("Stable fallback KPI", [], 0),
  colors.kpiColor("Stable fallback KPI", [], 999),
  "an unpersisted fallback must be identity-based rather than array-index based"
);

const fileActions = read("app/app/files/actions.ts");
const operationsActions = read("app/app/operations/actions.ts");
const settingsPage = read("app/app/kpis/settings/page.tsx");
const performancePage = read("app/app/kpis/page.tsx");
const executiveOverview = read("app/app/page.tsx");
const sourceImportReview = read("components/evidence/SourceImportReview.tsx");
const snapshotProducer = read("lib/kpis/snapshot-producer.ts");
const migration = read("supabase/migrations/20260812051159_persistent_kpi_colors.sql");
const initializationMigration = read("supabase/migrations/20260812060853_initialize_existing_kpi_colors.sql");
const repairMigration = read("supabase/migrations/20260812064259_repair_existing_kpi_color_initialization.sql");

assert.match(fileActions, /persistedSetting\?\.color[\s\S]{0,220}color_source/, "source reprocessing must preserve an existing KPI color and its provenance");
assert.match(fileActions, /upsertWorkbookKpiTargetSettings[\s\S]{0,2200}allocateAutomaticKpiColors/, "new workbook KPI settings must receive persisted automatic colors");
assert.match(sourceImportReview, /Automatic \(distributed palette\)/, "ordinary KPI imports must default to automatic allocation instead of one shared color");
assert.match(operationsActions, /color_source: colorSource/, "manual KPI settings saves must persist authoritative color provenance");
assert.match(operationsActions, /color_source", "legacy_unclassified"/, "legacy assignment must use an optimistic provenance guard");
assert.match(operationsActions, /getAll\("legacy_kpi_setting_id"\)/, "legacy assignment must require explicit administrator selection");
assert.match(settingsPage, /Assign selected automatic colors/, "unclassified legacy colors must have one explicit administrator allocation action");
assert.match(performancePage, /kpiColor\(/, "Performance views must resolve the persisted shared KPI color");
assert.match(executiveOverview, /kpiColor\(/, "Executive Overview must resolve the persisted shared KPI color");
assert(!snapshotProducer.includes("color_source") && !snapshotProducer.includes("allocateAutomaticKpiColors"), "presentation color must not enter IntelligenceSnapshotV1 truth production");
assert.match(migration, /color_source[\s\S]*legacy_unclassified[\s\S]*automatic[\s\S]*user/, "the migration must add bounded color provenance without claiming ambiguous legacy rows are automatic");
assert.match(migration, /updated_at = created_at/, "legacy classification must use untouched-row evidence rather than color alone");
assert(!/set\s+color\s*=/i.test(migration), "the forward migration must not silently rewrite existing colors");
assert(!/source_file_id|import_id|archived_at|deleted_at/.test(migration), "color provenance must remain independent of source lifecycle and KPI truth");
assert.match(initializationMigration, /color_source = 'user'[\s\S]*color = '#38BDF8'/, "the initializer must recognize the historical workbook-import default missed by the provenance migration");
assert.equal((initializationMigration.match(/updated_at = setting\.created_at/g) || []).length, 2, "eligibility and the final write must both require a never-updated setting");
assert.match(initializationMigration, /row_number\(\) over \([\s\S]*partition by eligible\.workspace_id[\s\S]*md5\(lower\(/, "existing assignment must be deterministic per workspace and independent of query order");
assert.match(initializationMigration, /% 8 \+ 1[\s\S]*#38BDF8[\s\S]*#D1D5DB/, "existing assignments must be evenly distributed across the approved automatic palette");
assert.match(initializationMigration, /set[\s\S]*color = assigned\.color,[\s\S]*color_source = 'automatic'/, "initialized historical rows must persist both color and automatic provenance");
assert(!/\b(?:kpis|evidence|findings|business_health|intelligence_snapshot|saved_analyses)\b/i.test(initializationMigration), "the initializer must remain presentation-only");
assert.match(repairMigration, /having count\(\*\) = 48[\s\S]*= 47[\s\S]*= 1[\s\S]*count\(distinct setting\.updated_at\) = 1/, "the repair must remain bounded to the verified 48-setting workspace shape");
assert.match(repairMigration, /bool_and\(setting\.updated_at > setting\.created_at\)/, "the repair must require the provenance migration trigger fingerprint");
assert.match(repairMigration, /color_source = 'user'[\s\S]*color = '#38BDF8'/, "the repair must target only the verified historical workbook default");
assert.match(repairMigration, /row_number\(\) over \([\s\S]*partition by eligible\.workspace_id[\s\S]*md5\(lower\(/, "the repair assignment must remain deterministic per workspace");
assert.match(repairMigration, /set[\s\S]*color = assigned\.color,[\s\S]*color_source = 'automatic'/, "the repair must persist both color and automatic provenance");
assert(!/\b(?:kpis|evidence|findings|business_health|intelligence_snapshot|saved_analyses)\b/i.test(repairMigration), "the repair must remain presentation-only");

const historicalStressRows = [
  ...names(47).map((kpi_name) => ({
    kpi_name,
    color: "#38BDF8",
    color_source: "user",
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-12T06:39:43Z"
  })),
  {
    kpi_name: "Manually customized KPI",
    color: "#1E6BFF",
    color_source: "user",
    created_at: "2026-08-11T00:00:00Z",
    updated_at: "2026-08-12T06:39:43Z"
  }
];
const originallyEligibleHistoricalRows = historicalStressRows.filter(
  (row) => row.color === "#38BDF8" && row.color_source === "user" && row.updated_at === row.created_at
);
assert.equal(originallyEligibleHistoricalRows.length, 0, "the regression must reproduce the trigger-induced initializer miss");
assert.equal(new Set(historicalStressRows.map((row) => row.updated_at)).size, 1, "the provenance migration trigger must leave one shared update timestamp fingerprint");
const repairableStressShape = historicalStressRows.length === 48
  && historicalStressRows.filter((row) => row.color === "#38BDF8" && row.color_source === "user").length === 47
  && historicalStressRows.filter((row) => row.color !== "#38BDF8" && row.color_source === "user").length === 1
  && historicalStressRows.every((row) => row.updated_at > row.created_at);
assert(repairableStressShape, "the verified stress-workbook shape must qualify for the bounded repair");
const eligibleHistoricalRows = historicalStressRows.filter(
  (row) => row.color === "#38BDF8" && row.color_source === "user"
);
assert.equal(eligibleHistoricalRows.length, 47, "the bounded repair must include all untouched historical workbook defaults");
assert.equal(historicalStressRows.filter((row) => row.color === "#1E6BFF").length, 1, "the manually changed KPI must remain excluded from repair");
const historicalAssignments = colors.allocateAutomaticKpiColors(
  workspaceId,
  eligibleHistoricalRows.map((row) => row.kpi_name),
  []
);
const historicalCounts = histogram(historicalAssignments);
assert(Math.max(...historicalCounts) - Math.min(...historicalCounts) <= 1, "the 47 eligible historical KPIs must receive a balanced palette");

console.log("Persistent deterministic KPI color assignment regression passed.");
