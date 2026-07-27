const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const overview = read("app/app/admin/page.tsx");
const customers = read("app/app/admin/customers/page.tsx");
const companyDetail = read("app/app/admin/customers/[workspaceId]/page.tsx");
const workspaces = read("app/app/admin/workspaces/page.tsx");
const workspaceActions = read("app/app/admin/workspaces/actions.ts");
const subscriptions = read("app/app/admin/subscriptions/page.tsx");
const subscriptionActions = read("app/app/admin/subscriptions/actions.ts");
const companyDirectory = read("lib/admin/company-directory.ts");
const actionRedirect = read("lib/admin/action-redirect.ts");
const migration = read("supabase/migrations/202607270001_admin_workspace_lifecycle.sql");
const filters = read("components/admin/AdminCompanyFilters.tsx");
const companyTable = read("components/admin/AdminCompanyTable.tsx");
const workspaceFilters = read("components/admin/AdminWorkspaceFilters.tsx");
const workspaceTable = read("components/admin/AdminWorkspaceQueueTable.tsx");
const workspacePagination = read("components/admin/AdminWorkspacePagination.tsx");
const tabs = read("components/admin/AdminCompanyTabs.tsx");
const lifecycleBadge = read("components/admin/AdminLifecycleBadge.tsx");
const workspaceForm = read("components/admin/AdminWorkspaceAccessForm.tsx");
const subscriptionEditor = read("components/admin/AdminSubscriptionEditor.tsx");
const manualActivation = read("components/admin/AdminManualActivationForm.tsx");
const requestReview = read("components/admin/AdminActivationRequestReview.tsx");
const lifecycleActions = read("components/admin/AdminWorkspaceLifecycleActions.tsx");
const eventDetails = read("components/admin/AdminSubscriptionEventDetails.tsx");
const appShell = read("components/app/AppShell.tsx");
const adminNav = read("components/admin/AdminNav.tsx");
const appNavigation = read("components/app/AppNavigation.tsx");
const globals = read("app/globals.css");

for (const [name, source] of [
  ["Overview", overview],
  ["Customers", customers],
  ["company detail", companyDetail],
  ["Workspaces", workspaces],
  ["Subscriptions", subscriptions]
]) {
  assert.match(source, /requireVaeroexAdmin\("\/app"\)/, `${name} must authorize server-side before reading Admin data`);
}

for (const file of [
  "app/app/admin/loading.tsx",
  "app/app/admin/customers/loading.tsx",
  "app/app/admin/customers/[workspaceId]/loading.tsx",
  "app/app/admin/workspaces/loading.tsx",
  "app/app/admin/subscriptions/loading.tsx"
]) {
  assert.equal(exists(file), true, `${file} must provide an explicit loading state`);
  assert.match(read(file), /ModuleLoading/, `${file} must use the established loading surface`);
}

for (const label of ["Total companies", "Active", "Pending activation", "Inactive", "Archived", "Active subscriptions", "Missing agreements", "Open support"]) {
  assert.match(overview, new RegExp(label), `Overview must retain the ${label} operational total`);
}
assert.doesNotMatch(overview, /Legal and trust readiness|Impersonation placeholder/, "Overview must not retain unrelated long-form panels");

assert.match(companyDirectory, /ADMIN_COMPANY_PAGE_SIZE = 25/, "company lists must use 25-row pages");
assert.match(companyDirectory, /\.range\(offset, offset \+ ADMIN_COMPANY_PAGE_SIZE - 1\)/, "company pagination must execute server-side");
assert.match(companyDirectory, /company_name\.ilike[\s\S]+primary_contact_email\.ilike/, "company search must cover company name and contact email");
assert.match(companyDirectory, /filters\.lifecycle === "current"[\s\S]+\.neq\("lifecycle_status", "archived"\)/, "archived companies must be excluded by default");
assert.match(companyDirectory, /\.eq\("subscription_status", filters\.subscription\)/, "subscription filtering must execute server-side");
assert.match(companyDirectory, /\.eq\("agreement_status", filters\.agreement\)/, "agreement filtering must execute server-side");
assert.match(companyDirectory, /\.order\("company_name_sort"[\s\S]+\.order\("workspace_id"/, "default company ordering must be stable by company and workspace ID");
assert.match(companyDirectory, /view: workspaceViews\.has\(view\)[\s\S]+: "attention"/, "workspace filtering must default to Needs attention");
assert.match(companyDirectory, /filters\.view === "attention"[\s\S]+\.eq\("attention_required", true\)/, "the default workspace queue must filter exceptions server-side");
for (const lifecycle of ["pending_activation", "inactive", "archived"]) {
  assert.match(companyDirectory, new RegExp(`filters\\.view[\\s\\S]+\\.eq\\(\"lifecycle_status\", filters\\.view\\)`), `${lifecycle} must use the explicit lifecycle view filter`);
}
assert.match(companyDirectory, /filters\.view === "all"[\s\S]+All workspaces is intentional/, "All workspaces must remain an explicit operational view");

for (const label of ["Company or contact", "Lifecycle", "Subscription", "Agreement", "Sort"]) {
  assert.match(filters, new RegExp(label), `company filters must expose ${label}`);
}
for (const column of ["Company", "Primary contact", "Lifecycle", "Subscription", "Agreement", "Last workspace update", "Attention", "Manage"]) {
  assert.match(companyTable, new RegExp(`>${column}<`), `company directory must expose the ${column} column`);
}
assert.match(companyTable, /company\.company_name/, "company name must remain the primary visible identity");
for (const label of ["Needs attention", "Pending activation", "Inactive", "Archived", "All workspaces"]) {
  assert.match(workspaceFilters, new RegExp(label), `workspace operations must expose the ${label} filter`);
}
for (const column of ["Workspace", "Operational attention", "Access state", "Agreement", "Last update", "Manage"]) {
  assert.match(workspaceTable, new RegExp(`>${column}<`), `workspace operations must expose the ${column} column`);
}
assert.match(workspaces, /loadAdminWorkspacePage/, "Workspaces must use its dedicated operational queue loader");
assert.match(workspaces, /Normal active companies remain in Customers/, "Workspaces must explain its exception-queue responsibility");
assert.doesNotMatch(workspaces, /AdminCompanyTable|AdminCompanyFilters|AdminPagination/, "Workspaces must not render a second general company directory");
assert.match(workspacePagination, /filters\.view !== "attention"/, "workspace pagination must preserve the intentional queue filter");
assert.doesNotMatch(companyTable + workspaceTable + workspaces, /Last login/, "Admin surfaces must not claim to display an unavailable last-login value");
assert.match(customers, /admin_unlinked_customer_records_v1/, "unlinked profiles, subscriptions, and activation requests must remain visible");
assert.match(customers, /Unlinked customer records/, "unlinked records must be clearly separated from company rows");
assert.match(migration, /from public\.manual_activation_requests as request;?[\s\S]+not exists \([\s\S]+public\.workspaces[\s\S]+primary_contact_email[\s\S]+not exists \([\s\S]+public\.customer_subscriptions[\s\S]+workspace_id is not null/, "linked activation requests must not be mislabeled as unlinked customer records");

for (const tab of ["overview", "workspace", "subscription", "agreement"]) {
  assert.match(tabs, new RegExp(`value: "${tab}"`), `company detail must include the ${tab} tab`);
  assert.match(companyDetail, new RegExp(`tab === "${tab}"`), `company detail must render the ${tab} content`);
}
for (const [href, label] of [
  ["/app/admin", "Admin Dashboard"],
  ["/app/admin/customers", "Customers"],
  ["/app/admin/ai-usage", "Vaeroex Usage"],
  ["/app/admin/support-requests", "Support Requests"],
  ["/app/admin/audit-logs", "Audit Logs"]
]) {
  const linkPattern = new RegExp(`href: "${href}"[\\s\\S]+?label: "${label}"`);
  assert.match(appShell, linkPattern, `${label} must remain in the persistent Admin navigation`);
  assert.match(adminNav, linkPattern, `${label} must remain in the Admin page navigation`);
}
for (const href of ["/app/admin/workspaces", "/app/admin/workspace-agreements", "/app/admin/subscriptions"]) {
  assert.doesNotMatch(appShell, new RegExp(`href: "${href}"`), `${href} must be retired from the persistent Admin navigation`);
  assert.doesNotMatch(adminNav, new RegExp(`href: "${href}"`), `${href} must be retired from the Admin page navigation`);
}
for (const route of [
  "app/app/admin/workspaces/page.tsx",
  "app/app/admin/subscriptions/page.tsx",
  "app/app/admin/workspace-agreements/page.tsx",
  "app/app/admin/workspace-agreements/[agreementId]/page.tsx"
]) {
  assert.equal(exists(route), true, `${route} must remain available as a standalone deep route`);
}
assert.match(appNavigation, /href === "\/app" \|\| href === "\/app\/admin"/, "Admin Dashboard must use exact active-path matching");
assert.match(companyDetail, /WorkspaceAgreementActions[\s\S]+agreementId=\{agreement\.id\} admin/, "company detail must reuse secure agreement PDF actions");
assert.match(companyDetail, /\/app\/admin\/workspace-agreements\/\$\{agreement\.id\}/, "company detail must preserve the existing agreement route");
assert.match(companyDetail, /No agreement/, "company detail must expose the no-agreement state");
assert.doesNotMatch(companyDetail + workspaces, /Onboarding progress/, "retired onboarding progress must not return");

for (const [source, action] of [
  [workspaceForm, "updateWorkspaceAccessAction"],
  [subscriptionEditor, "updateSubscriptionAction"],
  [manualActivation, "createManualSubscriptionAction"],
  [requestReview, "reviewActivationRequestAction"],
  [lifecycleActions, "transitionWorkspaceLifecycleAction"]
]) {
  assert.match(source, new RegExp(action), `${action} must remain wired to its server form`);
  assert.match(source, /PendingSubmitButton|ConfirmSubmitButton/, `${action} must suppress repeated submissions while pending`);
}
for (const label of ["Access status", "Plan", "Required access", "Manual unlock", "Update access"]) {
  assert.match(workspaceForm, new RegExp(label), `workspace detail must preserve ${label}`);
}
assert.match(subscriptions + companyDetail, /New Activation/, "manual activation must remain discoverable");
assert.match(subscriptions + companyDetail, /stripe_customer_id[\s\S]+stripe_subscription_id/, "Stripe provider identifiers must remain available");
assert.match(eventDetails, /<details[\s\S]+View event[\s\S]+JsonPreview/, "raw subscription events must remain available behind a disclosure control");
assert.match(eventDetails, /processing_error/, "Stripe processing errors must remain visible");

assert.match(actionRedirect, /COMPANY_DETAIL_PATTERN/, "moved mutation forms must use an allowlisted return path");
assert.doesNotMatch(actionRedirect, /startsWith\(requested\)/, "return paths must not rely on a broad prefix check");
for (const actions of [workspaceActions, subscriptionActions]) {
  assert.match(actions, /requireVaeroexAdmin/, "every Admin mutation must retain trusted server authorization");
  assert.match(actions, /logSecurityAuditEvent/, "every Admin mutation must retain security audit events");
}
assert.match(subscriptionActions, /rpc\("review_manual_activation_request"/, "activation approval must retain the transactional entitlement RPC");

assert.match(migration, /create table if not exists public\.workspace_admin_lifecycle/, "the additive lifecycle table must be created");
assert.match(migration, /workspace_id uuid primary key references public\.workspaces\(id\) on delete restrict/, "lifecycle rows must use a restrictive workspace foreign key");
for (const field of ["archived_at", "archived_by", "restored_at", "restored_by", "created_at", "updated_at"]) {
  assert.match(migration, new RegExp(field), `lifecycle records must retain ${field}`);
}
assert.match(migration, /alter table public\.workspace_admin_lifecycle enable row level security/, "lifecycle RLS must be enabled");
assert.match(migration, /revoke all privileges on table public\.workspace_admin_lifecycle[\s\S]+from public, anon, authenticated, service_role/, "lifecycle privileges must start denied");
assert.match(migration, /grant select, insert, update on table public\.workspace_admin_lifecycle[\s\S]+to service_role/, "service role must receive only SELECT, INSERT, and UPDATE");
assert.doesNotMatch(migration, /grant\s+(?:delete|truncate|references|trigger)[\s\S]+workspace_admin_lifecycle/i, "lifecycle storage must not grant destructive or ownership-like privileges");

const transitionStart = migration.indexOf("create or replace function public.transition_workspace_admin_lifecycle");
const transitionEnd = migration.indexOf("revoke all on function public.transition_workspace_admin_lifecycle", transitionStart);
const transition = migration.slice(transitionStart, transitionEnd);
assert.match(transition, /security invoker[\s\S]+set search_path = ''/, "the lifecycle transition must be SECURITY INVOKER with an empty search path");
assert.match(transition, /from public\.workspaces[\s\S]+for update/, "the transition must lock the workspace before lifecycle validation");
assert.match(transition, /from public\.workspace_admin_lifecycle[\s\S]+for update/, "the transition must lock the lifecycle record");
assert.match(transition, /Workspace must be inactive before it can be archived/, "active workspaces must fail closed");
assert.match(transition, /Pending activation workspaces cannot be archived/, "pending activation must fail closed");
assert.match(transition, /'changed', false/g, "repeated archive and restore requests must be idempotent");
assert.doesNotMatch(transition, /update public\.workspaces|update public\.customer_subscriptions|delete from/, "archive and restore must not mutate access, billing, or historical records");
assert.match(migration, /revoke all on function public\.transition_workspace_admin_lifecycle[\s\S]+from public, anon, authenticated, service_role/, "transition execution must start denied");
assert.match(migration, /grant execute on function public\.transition_workspace_admin_lifecycle[\s\S]+to service_role/, "only service role may invoke the lifecycle transition");
assert.match(migration, /end as attention_required/, "the company view must expose a deterministic operational-attention flag");
assert.match(migration, /lifecycle_status in \('pending_activation', 'inactive'\)/, "pending and inactive workspaces must enter the attention queue");
assert.match(migration, /agreement_status = 'missing'/, "missing agreements must enter the attention queue");
assert.match(migration, /manually_unlocked = true/, "manual unlocks must remain visible as operational exceptions");

for (const view of ["admin_company_directory_v1", "admin_unlinked_customer_records_v1"]) {
  assert.match(migration, new RegExp(`create or replace view public\\.${view}[\\s\\S]+security_invoker = true`), `${view} must execute with caller privileges`);
  assert.match(migration, new RegExp(`revoke all privileges on table public\\.${view}[\\s\\S]+from public, anon, authenticated, service_role`), `${view} must start denied`);
  assert.match(migration, new RegExp(`grant select on table public\\.${view}[\\s\\S]+to service_role`), `${view} must be server-only`);
}

for (const [state, tone] of [["active", "emerald"], ["pending_activation", "amber"], ["inactive", "slate"], ["archived", "blue"]]) {
  assert.match(lifecycleBadge, new RegExp(`${state}: "[^"]*${tone}`), `${state} must retain its approved visual distinction`);
}
assert.doesNotMatch(filters, /<option value="(?:trial|demo)"/, "trial and demo must not become intended lifecycle filters");

for (const tableSource of [companyTable, workspaceTable, subscriptions]) {
  assert.match(tableSource, /vaeroex-admin-data-row/, "Customers, Workspaces, and Subscriptions must share the accessible Admin row states");
  assert.doesNotMatch(tableSource, /hover:bg-slate-50\/80/, "Admin tables must not retain the unreadable bright hover treatment");
}
for (const selector of [
  ".vaeroex-admin-data-row:hover",
  ".vaeroex-admin-data-row:focus-within",
  ".vaeroex-admin-data-row[aria-selected=\"true\"]",
  ".vaeroex-admin-data-row[data-active=\"true\"]",
  ".vaeroex-admin-data-row[aria-disabled=\"true\"]",
  ".pulsar .vaeroex-app-shell .vaeroex-admin-data-row:hover"
]) {
  assert.ok(globals.includes(selector), `Admin row styling must define ${selector}`);
}
assert.match(globals, /focus-within[\s\S]+outline: 2px solid/, "keyboard focus must use a visible outline in addition to color");

process.stdout.write("Admin company-management regressions passed.\n");
