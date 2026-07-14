const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const sourcesPage = read("app/app/sources/page.tsx");
const sourceDetailRoute = read("app/app/sources/[fileId]/page.tsx");
const legacyFilesPage = read("app/app/files/page.tsx");
const fileActions = read("app/app/files/actions.ts");
const sourceImportReview = read("components/evidence/SourceImportReview.tsx");
const navigation = read("components/app/AppNavigation.tsx");

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
assert.match(fileActions, /requireToolExecution[\s\S]*approve_kpi_import/, "import approval must retain the Tool Execution Gateway");
assert.match(fileActions, /safeFileReturnPath[\s\S]*startsWith\(`\$\{SOURCES_PATH\}\//, "server actions must safely return to nested source routes");
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
