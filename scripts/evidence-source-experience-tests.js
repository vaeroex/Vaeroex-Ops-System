const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadTypeScriptModule(file) {
  const filePath = path.join(root, file);
  const compiled = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filePath
  }).outputText;
  const module = { exports: {} };
  Function("require", "module", "exports", compiled)(require, module, module.exports);
  return module.exports;
}

const sourcesPage = read("app/app/sources/page.tsx");
const sourceDetailRoute = read("app/app/sources/[fileId]/page.tsx");
const legacyFilesPage = read("app/app/files/page.tsx");
const fileActions = read("app/app/files/actions.ts");
const sourceImportReview = read("components/evidence/SourceImportReview.tsx");
const navigation = read("components/app/AppNavigation.tsx");
const importNotices = loadTypeScriptModule("lib/imports/source-import-notices.ts");

assert.match(sourcesPage, /Open source/, "source cards must use the clear Open source action");
assert.match(sourcesPage, /min-w-32[\s\S]{0,180}whitespace-nowrap|whitespace-nowrap[\s\S]{0,180}min-w-32/, "Open source must remain horizontal and keep a usable minimum width");
assert.match(sourcesPage, /w-full[\s\S]{0,180}sm:w-auto/, "the source action must stack safely on mobile");
assert.doesNotMatch(sourcesPage, /xl:grid-cols-\[minmax\(0,1\.25fr\)_minmax\(24rem,0\.85fr\)\]/, "the list must not be compressed by the old selected-source panel");
assert.match(sourceDetailRoute, /renderSourcesPage[\s\S]*sourceDetail: true/, "nested source routes must use the unified Evidence renderer");
assert.match(sourcesPage, /aria-label="Breadcrumb"[\s\S]*>Evidence<\//, "source detail must include an Evidence breadcrumb");
for (const label of ["Summary", "Findings", "Imported Data", "History"]) assert.match(sourcesPage, new RegExp(`label: "${label}"`));
assert.match(sourcesPage, /Original file preview is unavailable\./, "unavailable secure preview must use honest copy");
assert.match(sourcesPage, /Preview original/, "source detail must label preview accurately");
assert.match(sourcesPage, /Download original/, "source detail must label download accurately");
assert.equal((sourcesPage.match(/>Preview original<\/a>/g) || []).length, 1, "source detail must show Preview original only once");
assert.equal((sourcesPage.match(/>Download original<\/a>/g) || []).length, 1, "source detail must show Download original only once");
assert.match(sourcesPage, /View source details/, "source detail must expose metadata progressively");
assert.match(sourceImportReview, /Nothing is added to active KPI or metric history until you approve/, "structured imports must retain explicit review");
assert.match(sourcesPage, /file_import_rows[\s\S]{0,220}\.eq\("workspace_id", workspaceId\)[\s\S]{0,120}\.eq\("file_upload_id", params\.file\)/, "source detail import rows must be scoped to both workspace and selected source before limiting");
assert.match(sourcesPage, /file_import_rows[\s\S]{0,300}\.eq\("status", "staged"\)[\s\S]{0,120}\.limit\(2000\)/, "source detail must load only the current staged workbook generation before limiting");
assert.match(fileActions, /requireToolExecution[\s\S]*approve_kpi_import/, "import approval must retain the Tool Execution Gateway");
assert.match(fileActions, /safeFileReturnPath[\s\S]*startsWith\(`\$\{SOURCES_PATH\}\//, "server actions must safely return to nested source routes");
assert.match(fileActions, /function redirectWithPathMessage[\s\S]{0,520}query\.delete\("error"\)[\s\S]{0,180}query\.set\("message"/, "successful source actions must remove obsolete URL errors");
assert.match(fileActions, /function redirectWithPathError[\s\S]{0,520}query\.delete\("message"\)[\s\S]{0,180}query\.set\("error"/, "current source errors must replace stale success messages");
const staleImportError = "No extracted rows were found to save.";
assert.equal(importNotices.shouldClearSourceImportError({ error: staleImportError, latestImportStatus: "needs_review" }), false, "a current failed attempt must remain visible");
assert.equal(importNotices.shouldClearSourceImportError({ error: staleImportError, successMessage: "Workbook detection updated", latestImportStatus: "needs_review" }), true, "a successful re-prepare must clear the prior failure");
assert.equal(importNotices.shouldClearSourceImportError({ error: staleImportError, latestImportStatus: "completed" }), true, "persisted completion must clear the obsolete failure after refresh");
assert.equal(importNotices.shouldClearSourceImportError({ error: "Storage download failed.", latestImportStatus: "completed" }), false, "a genuine current error must remain visible");
assert.match(sourcesPage, /params\.error && clearSourceImportError[\s\S]{0,160}redirect\(sourceDetailNoticeHref/, "Source Detail must replace stale failure URLs after a successful import or re-prepare");
assert.match(sourcesPage, /params\.error && !params\.message/, "legacy Source URLs must not preserve an error beside a later success message");
assert.match(sourcesPage, /manageSourceFileAction/, "source detail must retain transactional lifecycle controls");
assert.match(sourcesPage, /\.eq\("workspace_id", workspaceId\)/, "Evidence data queries must remain workspace scoped");
assert.match(legacyFilesPage, /permanentRedirect/, "legacy Files URLs must redirect permanently");
assert.match(legacyFilesPage, /DETAIL_SECTION_BY_LEGACY_PANEL/, "legacy source panels must map to the closest Evidence view");
assert.doesNotMatch(legacyFilesPage, /requireWorkspacePage|\.from\(/, "the compatibility route must not recreate a parallel data workspace");
assert.match(navigation, /pathname\.startsWith\(`\$\{href\}\//, "nested Evidence routes must keep Evidence active");

const appFiles = [
  "app/app/page.tsx",
  "app/app/kpis/page.tsx",
  "app/app/kpis/settings/page.tsx",
  "app/app/sops/page.tsx",
  "app/api/search/route.ts",
  "lib/help/content.ts",
  "lib/intelligence/layer.ts",
  "lib/intelligence/prestige.ts"
];
for (const file of appFiles) assert.doesNotMatch(read(file), /\/app\/files(?:\?|"|`)/, `${file} must not generate a legacy Files URL`);

console.log("Evidence source experience regression tests passed.");
