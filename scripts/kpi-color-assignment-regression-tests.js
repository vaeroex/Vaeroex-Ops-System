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

console.log("Persistent deterministic KPI color assignment regression passed.");
