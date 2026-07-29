const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const peoplePage = read("app/app/people/page.tsx");
const appShell = read("components/app/AppShell.tsx");
const helpContent = read("lib/help/content.ts");
const searchRoute = read("app/api/search/route.ts");
const searchTypes = read("lib/search/types.ts");
const operationsActions = read("app/app/operations/actions.ts");
const recordActions = read("app/app/operations/record-management-actions.ts");
const accountabilityActions = read("app/app/accountability/actions.ts");
const accountabilityForms = read("components/accountability/AccountabilityForms.tsx");
const kpisPage = read("app/app/kpis/page.tsx");
const overviewPage = read("app/app/page.tsx");
const workspaceContext = read("lib/workspaces/current.ts");
const adminAccess = read("lib/admin/admin-emails.ts");
const databaseTypes = read("lib/supabase/types.ts");

assert.match(peoplePage, /await requireWorkspacePage\(\)/, "People retirement redirect must preserve authenticated workspace authorization");
assert.match(peoplePage, /dynamic = "force-dynamic"/, "People redirect must not be prerendered before workspace authorization");
assert.match(peoplePage, /permanentRedirect\("\/app"\)/, "People must redirect to Overview");
assert.doesNotMatch(peoplePage, /CreateDrawer|ManagedRecordList|buildPrestigeIntelligence|from\("people"\)/, "People page-specific UI and data loading must be retired");
assert.equal(fs.existsSync(path.join(root, "app/app/people/loading.tsx")), false, "People loading UI must be removed");

for (const [name, source] of [
  ["App sidebar", appShell],
  ["Help", helpContent],
  ["Global Search", searchRoute]
]) {
  assert.doesNotMatch(source, /\/app\/people/, `${name} must not expose a People destination`);
}
assert.doesNotMatch(helpContent, /Organization Context|Workspace Roles/, "People-specific Help entries must be removed");
assert.doesNotMatch(searchRoute, /from\("people"\)|sourceType:\s*"Person"/, "Global Search must not query or return People records");
assert.doesNotMatch(searchTypes, /\| "People"/, "Global Search must not retain the retired People group");
assert.doesNotMatch(operationsActions, /createPersonAction|Person added\./, "No dedicated People create action may remain reachable");
assert.doesNotMatch(recordActions, /\| "people"|people:\s*\{[\s\S]*?path:\s*"\/app\/people"/, "Generic record mutations must not retain a People collection");

assert.match(accountabilityActions, /from\("people"\)/, "Accountability must preserve optional person-recipient label lookup");
assert.match(accountabilityActions, /from\("operational_assignments"\)\.insert/, "Assignment creation must remain active");
assert.match(accountabilityActions, /from\("record_shares"\)\.insert/, "KPI sharing must remain active");
assert.match(accountabilityForms, /export function AssignmentPanel/, "Assignment UI must remain available");
assert.match(accountabilityForms, /export function ShareRecordPanel/, "Sharing UI must remain available");
assert.match(kpisPage, /from\("people"\)[\s\S]*ShareRecordPanel/, "KPI Records must preserve optional person recipients and sharing UI");
assert.match(overviewPage, /from\("people"\)/, "Executive Overview must preserve optional people-context reads");
assert.match(overviewPage, /from\("operational_assignments"\)/, "Executive Overview must preserve assignment history reads");
assert.match(overviewPage, /from\("record_shares"\)/, "Executive Overview must preserve sharing history reads");
assert.doesNotMatch(overviewPage, /buildPrestigeIntelligence/, "Executive Overview must not require the retired People-adjacent intelligence producer");
assert.doesNotMatch(kpisPage, /buildPrestigeIntelligence/, "KPI Records must not require the retired People-adjacent intelligence producer");

assert.match(workspaceContext, /from\("workspace_members"\)/, "Workspace selection must remain membership-based");
assert.doesNotMatch(workspaceContext, /from\("people"\)/, "Workspace selection must remain independent from People records");
assert.match(adminAccess, /VAEROEX_ADMIN_EMAILS/, "Admin access must preserve its server-side allowlist");
assert.doesNotMatch(adminAccess, /from\("people"\)/, "Admin access must remain independent from People records");
assert.match(databaseTypes, /people:\s*\{/, "Generated public.people types must remain intact");
assert.match(databaseTypes, /assigned_person_id:/, "Person-attributed assignment compatibility must remain intact");
assert.match(databaseTypes, /recipient_person_id:/, "Person-attributed sharing compatibility must remain intact");

console.log("People page retirement regression tests passed.");
