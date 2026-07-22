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

const { buildPrestigeIntelligence } = require("../lib/intelligence/prestige.ts");
const taskFreeInput = {
  workspaceName: "Task-free baseline",
  isDemoWorkspace: false,
  periodLabel: "Monthly",
  range: {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    previousStartDate: "2026-06-01",
    previousEndDate: "2026-06-30"
  },
  kpis: [
    { id: "k1", name: "Revenue", actual_value: 80_000, target: 100_000, metric_date: "2026-07-01", created_at: "2026-07-01", updated_at: "2026-07-01", category: "Sales" },
    { id: "k2", name: "Conversion Rate", actual_value: 5, target: 10, metric_date: "2026-07-01", created_at: "2026-07-01", updated_at: "2026-07-01", category: "Sales" },
    { id: "k3", name: "Customer Satisfaction", actual_value: 82, target: 85, metric_date: "2026-07-01", created_at: "2026-07-01", updated_at: "2026-07-01", category: "Customer" },
    { id: "k4", name: "Checklist Completion Rate", actual_value: 90, target: 95, metric_date: "2026-07-01", created_at: "2026-07-01", updated_at: "2026-07-01", category: "Operations" }
  ],
  issues: [
    { id: "i1", title: "Open issue 1", status: "Open", severity: "High", created_at: "2026-07-01", assigned_to: null, assigned_person_id: null, assigned_role: null, assigned_department: null },
    { id: "i2", title: "Open issue 2", status: "Open", severity: "Medium", created_at: "2026-07-01", assigned_to: "Owner" }
  ],
  assets: [],
  checklists: [{ id: "c1", created_at: "2026-07-01" }],
  checklistRuns: [{ id: "cr1", checklist_id: "c1", status: "Complete", created_at: "2026-07-01" }],
  sops: [{ id: "s1", title: "SOP", created_at: "2026-07-01", updated_at: "2026-07-01" }],
  files: [
    { id: "f1", display_name: "Workbook.xlsx", analysis_summary: "Validated facts", created_at: "2026-07-01", deleted_at: null, archived_at: null },
    { id: "f2", display_name: "Notes.pdf", analysis_summary: null, created_at: "2026-07-01", deleted_at: null, archived_at: null }
  ],
  imports: [],
  crmLeads: [
    { id: "l1", lead_name: "Lead 1", status: "Open", last_activity_at: null, created_at: "2026-07-01" },
    { id: "l2", lead_name: "Lead 2", status: "Won", last_activity_at: "2026-07-02", created_at: "2026-07-01" }
  ],
  reports: [{ id: "r1", title: "Report", created_at: "2026-07-01" }],
  vaeroexRuns: [],
  operationalMetrics: [],
  notifications: [],
  assignments: [{ id: "a1", title: "Review", status: "Done", created_at: "2026-07-01" }],
  shares: [],
  people: [
    { id: "p1", full_name: "A", role_title: "Owner", department: "Leadership" },
    { id: "p2", full_name: "B", role_title: "Manager", department: "Operations" }
  ],
  decisions: [],
  recommendationOutcomes: []
};

const taskFreeResult = buildPrestigeIntelligence(taskFreeInput);
const sourceVisibility = taskFreeResult.businessHealth.categories.find((category) => category.name === "Source Visibility");
assert.equal(taskFreeResult.businessHealth.score, 78, "identical non-task evidence must preserve the pre-retirement Business Health score");
assert.equal(sourceVisibility?.score, 92, "Source Visibility must preserve the pre-retirement task-free baseline");
assert.equal(taskFreeResult.businessHealth.dataQualityWarning, null, "complete task-free inputs must retain the previous missing-data behavior");

const withoutReports = buildPrestigeIntelligence({ ...taskFreeInput, reports: [] });
assert.match(withoutReports.businessHealth.dataQualityWarning || "", /reports/, "reports must remain part of the established missing-data check");

const withRetiredTaskPayload = buildPrestigeIntelligence({
  ...taskFreeInput,
  tasks: [{ id: "retired-task", title: "Retired signal", status: "To Do", created_at: "2026-07-01" }]
});
assert.deepEqual(withRetiredTaskPayload.businessHealth, taskFreeResult.businessHealth, "retired task payloads must not influence Business Health");

console.log("Business Signals full-retirement regressions passed.");
