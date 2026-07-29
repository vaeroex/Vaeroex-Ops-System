const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
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

const runtimeFiles = [
  "app/api/search/route.ts",
  "app/app/page.tsx",
  "app/app/operations/actions.ts",
  "app/app/operations/record-management-actions.ts",
  "app/app/accountability/actions.ts",
  "app/app/intelligence/actions.ts",
  "app/app/intelligence/page.tsx",
  "app/app/kpis/page.tsx",
  "app/app/people/page.tsx",
  "app/app/reports/actions.ts",
  "components/app/AppShell.tsx",
  "components/app/GlobalSearch.tsx",
  "lib/ai/bounded-context.ts",
  "lib/ai/workspace-snapshot.ts",
  "lib/intelligence/layer.ts",
  "lib/intelligence/coverage.ts",
  "lib/reports/scheduled-generator.ts"
];

for (const file of runtimeFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /\.from\("tasks"\)|public\.tasks|update_business_signal_lifecycle/, `${file} must not access retired Business Signal storage`);
  assert.doesNotMatch(source, /\/app\/tasks|Business Signals?/, `${file} must not expose retired Business Signals`);
}

const tasksPage = read("app/app/tasks/page.tsx");
assert.match(tasksPage, /permanentRedirect\("\/app\/sources"\)/, "old task URLs must permanently redirect to Evidence");
assert.doesNotMatch(tasksPage, /from\("tasks"\)|Business Signals?/, "the retired route must not read or render historical task rows");

const appShell = read("components/app/AppShell.tsx");
const searchRoute = read("app/api/search/route.ts");
const help = read("lib/help/content.ts");
assert.doesNotMatch(appShell, /\/app\/tasks|Business Signals?/);
assert.doesNotMatch(searchRoute, /\.from\("tasks"\)|Business Signals?|group:\s*"Business Signals"/);
assert.doesNotMatch(help, /\/app\/tasks|Business Signals?/);

const setupActions = read("app/app/setup/actions.ts");
const setupPage = read("app/app/setup/page.tsx");
const workspaceCreationForm = read("components/setup/WorkspaceCreationForm.tsx");
assert.doesNotMatch(setupActions, /\.from\("tasks"\)\.insert|Business Signals?/);
assert.match(setupActions, /redirect\(`\/app\/sources\?message=/, "workspace onboarding must continue into the existing Evidence upload flow");
assert.doesNotMatch(setupPage, /Business Signals?|\/app\/tasks/);
assert.doesNotMatch(workspaceCreationForm, /Business Signals?|\/app\/tasks/);
assert.equal(fs.existsSync(path.join(root, "components/setup/SetupWizard.tsx")), false, "the retired questionnaire wizard must not remain");

const demo = read("lib/demo/workspace-demo.ts");
const seed = read("supabase/seed.sql");
assert.doesNotMatch(demo, /from\("tasks"\)\.insert|seedTasks/, "demo population must not create task fixtures");
assert.match(demo, /"tasks"/, "demo reset may retain the legacy table cleanup entry");
assert.doesNotMatch(seed, /insert into public\.tasks|Business Signals?/, "database seed must not create or describe Business Signals");

const evidenceIndex = read("lib/ai/evidence-index.ts");
assert.match(evidenceIndex, /source_type === "business_signal" \|\| row\.source_type === "task"/, "legacy task-backed memory must fail closed");

const sourcesPage = read("app/app/sources/page.tsx");
const fileActions = read("app/app/files/actions.ts");
assert.match(sourcesPage, /UploadSourceDrawer/, "the approved Evidence upload surface must remain available");
assert.match(sourcesPage, /LearnedKnowledgeView/, "the approved Evidence learned-knowledge surface must remain available");
assert.match(fileActions, /uploadFileAction/, "the existing Evidence upload action must remain available");

assert.equal(fs.existsSync(path.join(root, "lib/business-signals/retirement.ts")), false, "retirement-only helper must be removed");
assert.equal(fs.existsSync(path.join(root, "lib/intelligence/business-signal-evidence.ts")), false, "Business Signal evidence utility must be removed");

console.log("Business Signals full-retirement regressions passed.");
