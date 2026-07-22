const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

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
  "lib/intelligence/prestige.ts",
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
const setupWizard = read("components/setup/SetupWizard.tsx");
assert.doesNotMatch(setupActions, /\.from\("tasks"\)\.insert|Business Signals?/);
assert.match(setupActions, /redirect\("\/app\/sources"\)/, "workspace onboarding must continue into the existing Evidence upload flow");
assert.doesNotMatch(setupPage, /Business Signals?|\/app\/tasks/);
assert.doesNotMatch(setupWizard, /Business Signals?|\/app\/tasks/);

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
