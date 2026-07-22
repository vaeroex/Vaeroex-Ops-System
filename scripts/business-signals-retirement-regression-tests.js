const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function exportedAction(source, name, nextName) {
  const start = source.indexOf(`export async function ${name}`);
  assert.notEqual(start, -1, `${name} must remain exported for compatibility`);
  const end = nextName ? source.indexOf(`export async function ${nextName}`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

const operations = read("app/app/operations/actions.ts");
const recordManagement = read("app/app/operations/record-management-actions.ts");
const accountability = read("app/app/accountability/actions.ts");
const intelligenceActions = read("app/app/intelligence/actions.ts");
const tasksPage = read("app/app/tasks/page.tsx");
const formSubmissions = read("app/app/form-submissions/page.tsx");
const formDetail = read("app/app/forms/[id]/page.tsx");
const formsPage = read("app/app/forms/page.tsx");
const setupActions = read("app/app/setup/actions.ts");
const setupPage = read("app/app/setup/page.tsx");
const setupWizard = read("components/setup/SetupWizard.tsx");
const help = read("lib/help/content.ts");
const demo = read("lib/demo/workspace-demo.ts");
const appShell = read("components/app/AppShell.tsx");
const searchRoute = read("app/api/search/route.ts");
const sourcesPage = read("app/app/sources/page.tsx");
const fileActions = read("app/app/files/actions.ts");
const retirement = read("lib/business-signals/retirement.ts");

assert.match(retirement, /Business Signals are retired and existing records are read-only/);

for (const [name, nextName] of [
  ["convertSubmissionToTaskAction", "createChecklistAction"],
  ["createTaskAction", "createBusinessSignalAction"],
  ["createBusinessSignalAction", "updateTaskStatusAction"],
  ["updateTaskStatusAction", "deleteBusinessSignalAction"],
  ["deleteBusinessSignalAction", "createKpiAction"],
  ["convertIssueToTaskAction", "createAssetAction"]
]) {
  const action = exportedAction(operations, name, nextName);
  assert.match(action, /await requireWorkspace\(path\)/, `${name} must retain authentication and workspace checks`);
  assert.match(action, /redirectWithError\(path, BUSINESS_SIGNALS_RETIRED_MESSAGE\)/, `${name} must fail closed`);
  assert.doesNotMatch(action, /\.from\("tasks"\)|update_business_signal_lifecycle/, `${name} must not reach task persistence`);
}

const recommendationConversion = exportedAction(intelligenceActions, "acceptPrestigeRecommendationAction", "dismissPrestigeRecommendationAction");
assert.match(recommendationConversion, /await requireWorkspace\(path\)/);
assert.match(recommendationConversion, /redirectWithError\(path, BUSINESS_SIGNALS_RETIRED_MESSAGE\)/);
assert.doesNotMatch(recommendationConversion, /\.from\("tasks"\)|vaeroex_recommendation_outcomes/);

assert.match(recordManagement, /if \(collection === "tasks"\) \{\s*redirectWithError\(path, BUSINESS_SIGNALS_RETIRED_MESSAGE\)/);
assert.ok(
  recordManagement.indexOf('if (collection === "tasks")') < recordManagement.indexOf('if (collection === "crm_leads")'),
  "generic task mutations must fail closed before other collection handling"
);
assert.match(accountability, /if \(sourceType === "task"\) \{\s*redirectWithError\(path, BUSINESS_SIGNALS_RETIRED_MESSAGE\)/);

assert.match(tasksPage, /\.from\("tasks"\)\s*\.select\("\*"\)\s*\.eq\("workspace_id", workspaceId\)/, "historical rows must remain workspace-scoped and readable");
assert.match(tasksPage, /BusinessSignalViewAction/);
assert.match(tasksPage, /Existing records are read-only compatibility data/);
assert.match(tasksPage, /href="\/app\/sources"/);
assert.doesNotMatch(tasksPage, /New Business Signal|Save Business Signal|Edit Business Signal/);
assert.doesNotMatch(tasksPage, /createBusinessSignalAction|deleteBusinessSignalAction|updateManagedRecordAction|manageRecordAction/);
assert.doesNotMatch(tasksPage, /record_action|bulk_action|BusinessSignalEditForm/);

for (const source of [formSubmissions, formDetail]) {
  assert.doesNotMatch(source, /convertSubmissionToTaskAction|Create Business Signal/);
}
assert.doesNotMatch(formsPage, /Submissions can become Business Signals|business signal/);

assert.doesNotMatch(setupActions, /\.from\("tasks"\)\.insert|Missing Business Signals|Capture the first Business Signals/);
assert.match(setupActions, /redirect\("\/app\/sources"\)/);
assert.doesNotMatch(setupPage, /Business Signals/);
assert.doesNotMatch(setupWizard, /Business Signals/);
assert.match(help, /Uploading your first Evidence source/);
assert.match(help, /"\/app\/sources"/);

assert.match(demo, /async function seedTasksAndIssues/);
assert.match(demo, /supabase\.from\("tasks"\)\.insert/, "demo task rows remain until intelligence is decoupled");
assert.match(appShell, /href: "\/app\/tasks"/, "historical deep links remain available in PR 1");
assert.match(searchRoute, /\.from\("tasks"\)/, "historical search compatibility remains active in PR 1");

assert.match(sourcesPage, /UploadSourceDrawer/, "the existing Evidence upload surface must remain available");
assert.match(sourcesPage, /LearnedKnowledgeView/, "the existing Evidence learned-knowledge surface must remain available");
assert.match(fileActions, /uploadFileAction/, "the existing Evidence upload action must remain available");

console.log("Business Signals retirement regressions passed.");
