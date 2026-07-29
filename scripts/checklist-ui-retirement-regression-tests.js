const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

for (const route of ["app/app/checklists/page.tsx", "app/app/checklist-runs/page.tsx"]) {
  const source = read(route);
  assert.match(source, /dynamic = "force-dynamic"/, `${route} must not be prerendered before authorization`);
  assert.match(source, /await requireWorkspacePage\(\)/, `${route} must preserve authenticated workspace authorization`);
  assert.match(source, /permanentRedirect\("\/app"\)/, `${route} must redirect to Executive Overview`);
  assert.doesNotMatch(source, /\.from\("checklists?(_runs)?"\)|CreateDrawer|ManagedRecordList|AssignmentPanel/, `${route} must not load or render Checklist UI`);
}

assert.equal(fs.existsSync(path.join(root, "app/app/checklists/loading.tsx")), false, "Checklist loading UI must be removed");
assert.equal(fs.existsSync(path.join(root, "app/app/checklist-runs/loading.tsx")), false, "Checklist Runs loading UI must be removed");

const searchRoute = read("app/api/search/route.ts");
const searchTypes = read("lib/search/types.ts");
assert.doesNotMatch(searchRoute, /\.from\("checklists"\)|"Checklists"|\/app\/checklists/, "Global Search must not query or return Checklist destinations");
assert.doesNotMatch(searchTypes, /\| "Checklists"/, "Global Search must not retain the Checklist group");
assert.match(searchRoute, /\.from\("operational_assignments"\)/, "non-Checklist Review Signals must remain searchable");
assert.match(searchRoute, /excludeChecklistDerivedRecords\(rows\)/, "historical Checklist-derived assignments must not expose retired destinations");

const helpContent = read("lib/help/content.ts");
assert.doesNotMatch(helpContent, /\/app\/checklists|\["checklists", "Checklists"|issues, checklists,/, "Help must not expose Checklist-specific entries or links");

const operationsActions = read("app/app/operations/actions.ts");
const recordActions = read("app/app/operations/record-management-actions.ts");
const managedList = read("components/operations/ManagedRecordList.tsx");
assert.doesNotMatch(operationsActions, /createChecklistAction|runChecklistAction/, "Checklist create and run actions must be removed");
assert.doesNotMatch(recordActions, /\| "checklists"|\| "checklist_runs"|checklists:\s*\{|checklist_runs:\s*\{/, "generic mutations must not expose retired Checklist collections");
assert.doesNotMatch(managedList, /\| "checklists"|\| "checklist_runs"|checklists:\s*"checklists"|checklist_runs:\s*"checklist runs"/, "page-only managed-list configuration must be removed");

const databaseTypes = read("lib/supabase/types.ts");
const reportDetail = read("app/app/reports/[id]/page.tsx");
assert.match(databaseTypes, /checklists:\s*\{/, "generated Checklist table types must remain intact");
assert.match(databaseTypes, /checklist_runs:\s*\{/, "generated Checklist Runs table types must remain intact");
assert.match(reportDetail, /SavedAnalysisRenderer|body_markdown/, "historical Reports must remain readable without retired generation code");
assert.equal(fs.existsSync(path.join(root, "app/app/reports/actions.ts")), false, "retired report generation actions must stay deleted");
assert.equal(fs.existsSync(path.join(root, "lib/reports/scheduled-generator.ts")), false, "retired scheduled report generation must stay deleted");
assert.equal(fs.existsSync(path.join(root, "supabase/migrations/202606170001_phase_1_schema_rls.sql")), true, "historical Checklist schema migration must remain intact");

const accountabilityActions = read("app/app/accountability/actions.ts");
assert.doesNotMatch(accountabilityActions, /createAssignmentAction/, "retired assignment creation UI must not remain reachable");
assert.match(accountabilityActions, /from\("record_shares"\)\.insert/, "KPI sharing must remain available");
assert.match(databaseTypes, /operational_assignments:\s*\{/, "historical assignment compatibility must remain intact");

process.stdout.write("Checklist UI retirement regressions passed.\n");
