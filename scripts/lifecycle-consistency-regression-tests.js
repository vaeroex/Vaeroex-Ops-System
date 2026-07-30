const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();

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

const {
  filterActiveLifecycleRecords,
  filterOriginalBusinessEvidence,
  independentOriginalEvidenceKeys
} = require("../lib/intelligence/evidence-eligibility.ts");
const {
  buildSourceParentEligibility,
  filterBySourceParentEligibility
} = require("../lib/intelligence/source-parent-eligibility.ts");

const activeKpi = { id: "kpi-active", name: "Revenue", source_file_id: null, import_id: null, archived_at: null, deleted_at: null };
const archivedKpi = { ...activeKpi, id: "kpi-archived", archived_at: "2026-07-12T00:00:00.000Z" };
const deletedKpi = { ...activeKpi, id: "kpi-deleted", deleted_at: "2026-07-12T00:00:00.000Z" };
assert.deepEqual(filterActiveLifecycleRecords([activeKpi, archivedKpi, deletedKpi]).map((row) => row.id), ["kpi-active"]);

const sourceFile = { id: "file-1", archived_at: null, deleted_at: null };
const importedKpi = { ...activeKpi, id: "kpi-imported", source_file_id: "file-1" };
const secondImportedKpi = { ...importedKpi, id: "kpi-imported-2", name: "Margin" };
const independent = independentOriginalEvidenceKeys([
  { kind: "file", values: [sourceFile] },
  { kind: "kpi", values: [importedKpi, secondImportedKpi] },
  { kind: "issue", values: [{ id: "issue-1", archived_at: null, deleted_at: null }] }
]);
assert.equal(independent.size, 2, "one upload and its imported KPI rows must count as one independent source");
assert.equal(independent.size >= 3, false, "a Board Report must remain blocked below three independent sources");
assert.equal(
  independentOriginalEvidenceKeys([{ kind: "kpi", values: [activeKpi, { ...activeKpi, id: "kpi-2" }] }]).size,
  1,
  "repeated history for one KPI must count as one independent source"
);

const setupSignal = { id: "setup", title: "Customize starter forms", category: "Setup", archived_at: null, deleted_at: null };
const platformFailure = {
  id: "failure",
  title: "Vaeroex run failed: ask vaeroex",
  source_data_json: { generated_from: "platform_run", evidence_classification: "platform_telemetry" },
  archived_at: null,
  deleted_at: null
};
assert.equal(filterOriginalBusinessEvidence([setupSignal, platformFailure]).length, 0, "setup rows and technical failures cannot become original evidence");

const sourceParentEligibility = buildSourceParentEligibility({
  files: [
    { id: "file-active", archived_at: null, deleted_at: null },
    { id: "file-archived", archived_at: "2026-07-12T00:00:00.000Z", deleted_at: null },
    { id: "file-deleted", archived_at: null, deleted_at: "2026-07-12T00:00:00.000Z" }
  ],
  imports: [
    { id: "import-active", file_upload_id: "file-active" },
    { id: "import-archived", file_upload_id: "file-archived" },
    { id: "import-deleted", file_upload_id: "file-deleted" }
  ]
});
const parentEligibleRecords = filterBySourceParentEligibility([
  { id: "manual", source_file_id: null, import_id: null },
  { id: "active-file-child", source_file_id: "file-active", import_id: null },
  { id: "archived-file-child", source_file_id: "file-archived", import_id: null },
  { id: "deleted-file-child", source_file_id: "file-deleted", import_id: null },
  { id: "missing-file-child", source_file_id: "file-missing", import_id: null },
  { id: "active-import-child", source_file_id: null, import_id: "import-active" },
  { id: "archived-import-child", source_file_id: null, import_id: "import-archived" },
  { id: "deleted-import-child", source_file_id: null, import_id: "import-deleted" },
  { id: "missing-import-child", source_file_id: null, import_id: "import-missing" }
], sourceParentEligibility);
assert.deepEqual(
  parentEligibleRecords.map((row) => row.id),
  ["manual", "active-file-child", "active-import-child"],
  "source-linked children require an active workspace-scoped Source parent"
);

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const kpiPage = read("app/app/kpis/page.tsx");
const searchRoute = read("app/api/search/route.ts");
const boundedContext = read("lib/ai/bounded-context.ts");
const reportPage = read("app/app/reports/page.tsx");
const sourcesPage = read("app/app/sources/page.tsx");
const sourceParentEligibilityHelper = read("lib/intelligence/source-parent-eligibility.ts");
const recordActions = read("app/app/operations/record-management-actions.ts");
const intelligenceLayer = read("lib/intelligence/layer.ts");
const coverage = read("lib/intelligence/coverage.ts");
const homepage = read("app/app/page.tsx");
const formSubmissionsPage = read("app/app/form-submissions/page.tsx");
const checklistRunsPage = read("app/app/checklist-runs/page.tsx");

const activeQuery = (table) => new RegExp(`from\\("${table}"\\)[\\s\\S]{0,520}\\.eq\\("workspace_id", workspaceId\\)[\\s\\S]{0,180}\\.is\\("(?:archived_at|deleted_at)", null\\)[\\s\\S]{0,180}\\.is\\("(?:archived_at|deleted_at)", null\\)`);

assert.match(kpiPage, activeQuery("kpis"), "KPI charts and trends must query active rows only");
for (const table of ["reports", "issues", "sops"]) {
  assert.match(searchRoute, activeQuery(table), `global search must exclude inactive ${table} before limiting`);
}
assert.match(searchRoute, /filterOriginalBusinessEvidence<IssueRow>/, "search reasoning must exclude setup-only issues");
assert.match(searchRoute, /filterOriginalBusinessEvidence<SopRow>/, "search must exclude setup-only SOPs from active results");
assert.match(searchRoute, /"Saved Analyses"/, "Search must label the supported copied analysis surface explicitly");
assert.match(searchRoute, /record_kind: "saved_analysis", release_channel: savedAnalysisChannel/, "Search must query only current channel-scoped Saved Analyses");
assert.match(boundedContext, activeQuery("issues"), "bounded Ask context must exclude inactive issues before limiting");
assert.match(boundedContext, activeQuery("sops"), "bounded Ask context must exclude inactive SOPs before limiting");
assert.match(boundedContext, /filterOriginalBusinessEvidence\(issues\)/, "bounded Ask must apply original-evidence rules to issues");
assert.match(boundedContext, /filterOriginalBusinessEvidence\(rows\)\.slice\(0, 8\)/, "bounded Ask must remove setup-only rows before its final result limit");

assert.match(reportPage, /parseSavedAnalysisEnvelope/, "Reports must render copied saved analyses instead of rebuilding them from evidence");
assert.match(reportPage, /envelope\.workspace_id === workspaceId/, "saved analyses must retain explicit workspace lineage");
assert.equal(fs.existsSync(path.join(root, "app/app/reports/actions.ts")), false, "retired report generation actions must stay deleted");
assert.equal(fs.existsSync(path.join(root, "lib/reports/scheduled-generator.ts")), false, "retired scheduled report generation must stay deleted");

assert.match(sourcesPage, /filterEligibleMemoryRowsByLifecycle\([\s\S]{0,180}rows: rawMemoryChunks\.filter/, "Learned Knowledge must validate active parent lineage");
assert.match(sourcesPage, /chunk\.archived_at && !chunk\.deleted_at/, "the archive view may show archived, but not deleted, knowledge");

assert.equal(fs.existsSync(path.join(root, "lib/ai/workspace-snapshot.ts")), false, "the superseded broad workspace snapshot must stay deleted");
assert.match(sourceParentEligibilityHelper, /\.eq\("workspace_id", workspaceId\)/, "parent lifecycle lookups must remain workspace-scoped");
for (const source of [searchRoute, boundedContext]) {
  assert.match(source, /(?:loadSourceParentEligibility|filterBySourceParentEligibility)/, "source-linked structured evidence must validate its parent Source lifecycle");
}
assert.match(recordActions, /update_source_file_lifecycle/, "generic Source lifecycle controls must update parent and learned evidence together");
assert.doesNotMatch(intelligenceLayer, /ReportRow|input\.reports|const reports/, "Intelligence must not accept report rows as deterministic inputs");
assert.doesNotMatch(coverage, /ReportRow|input\.reports|reports: \[\]/, "report rows must not increase coverage");
assert.doesNotMatch(coverage, /checklists|checklistRuns|activeChecklistIds/, "retired Checklist inputs cannot affect active intelligence coverage");
assert.match(coverage, /activeFormIds\.has\(submission\.form_id\)/, "form submissions require an active form parent");
assert.match(coverage, /activeCrmLeadIds\.has\(history\.lead_id\)/, "customer history requires active eligible customer evidence");
assert.match(coverage, /activeSourceFileIds\.has\(item\.file_upload_id\)/, "imports require an active Source parent");
assert.match(intelligenceLayer, /activeFormIds\.has\(submission\.form_id\)/, "Intelligence submissions require an active form parent");
assert.match(homepage, /const intelligenceLayer = buildIntelligenceLayer\(/, "Executive Overview must delegate Business Health to the canonical layer that excludes derived reports");
assert.doesNotMatch(boundedContext, /\.from\("reports"\)|context\.reports|body_markdown[\s\S]{0,500}report/, "saved analysis conclusions must not feed new reasoning");
assert.doesNotMatch(searchRoute, /Derived report|Legacy report|truncate\(report\.body_markdown\)/, "Search navigation must not surface stale report conclusions as current evidence");
assert.match(formSubmissionsPage, /activeFormIds\.has\(submission\.form_id\)/, "orphaned submissions must not remain visible");
assert.match(checklistRunsPage, /await requireWorkspacePage\(\)/, "retired Checklist Runs must authorize before redirecting");
assert.match(checklistRunsPage, /permanentRedirect\("\/app"\)/, "retired Checklist Runs must not expose historical rows");

for (const source of [searchRoute, boundedContext, reportPage, sourcesPage]) {
  assert.match(source, /eq\("workspace_id", workspaceId\)/, "every corrected surface must remain explicitly workspace-scoped");
}

process.stdout.write("Lifecycle consistency regressions passed.\n");
