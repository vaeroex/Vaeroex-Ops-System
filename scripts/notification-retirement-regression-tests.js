const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const activeRuntimeFiles = [
  "app/api/search/route.ts",
  "app/app/layout.tsx",
  "app/app/page.tsx",
  "app/app/kpis/page.tsx",
  "app/app/people/page.tsx",
  "app/app/accountability/actions.ts",
  "app/app/intelligence/actions.ts",
  "app/app/report-subscriptions/actions.ts",
  "components/accountability/AccountabilityForms.tsx",
  "components/app/AppNavigation.tsx",
  "components/app/AppShell.tsx",
  "components/intelligence/PrestigeOperationsPanel.tsx",
  "lib/intelligence/prestige.ts",
  "lib/reports/scheduled-generator.ts"
];

for (const file of activeRuntimeFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /\.from\("notifications"\)/, `${file} must not read or write notification rows`);
  assert.doesNotMatch(source, /\.from\("kpi_alert_rules"\)|\.from\("kpi_alert_events"\)/, `${file} must not read or write KPI alert rows`);
  assert.doesNotMatch(source, /\/app\/notifications/, `${file} must not expose the retired destination`);
}

const retiredPage = read("app/app/notifications/page.tsx");
assert.match(retiredPage, /requireWorkspacePage\(\)/, "the retired URL must remain authenticated");
assert.match(retiredPage, /permanentRedirect\("\/app"\)/, "the retired URL must redirect to the Executive Overview");
assert.doesNotMatch(retiredPage, /\.from\("notifications"\)|Notification Center/, "the retired URL must not read or render notification data");

const shell = read("components/app/AppShell.tsx");
const navigation = read("components/app/AppNavigation.tsx");
for (const source of [shell, navigation]) {
  assert.doesNotMatch(source, /NotificationBadge|notificationUnreadCount|Notifications|Alerts/);
}

const accountabilityActions = read("app/app/accountability/actions.ts");
assert.match(accountabilityActions, /\.from\("record_shares"\)\.insert/, "record sharing must remain available");
assert.match(accountabilityActions, /\.from\("operational_assignments"\)\.insert/, "assignment creation must remain available");
assert.match(accountabilityActions, /\.from\("issues"\)[\s\S]+\.update\(/, "assignment-driven issue updates must remain available");
for (const action of [
  "createKpiAlertRuleAction",
  "evaluateKpiAlertsAction",
  "markNotificationReadAction",
  "openNotificationAction",
  "markAllNotificationsReadAction",
  "archiveReadNotificationsAction",
  "clearResolvedNotificationsAction"
]) {
  assert.doesNotMatch(accountabilityActions, new RegExp(`export async function ${action}\\b`), `${action} must be retired`);
}

const accountabilityForms = read("components/accountability/AccountabilityForms.tsx");
assert.match(accountabilityForms, /export function ShareRecordPanel/, "record sharing UI must remain available");
assert.match(accountabilityForms, /export function AssignmentPanel/, "assignment UI must remain available");
assert.doesNotMatch(accountabilityForms, /KpiAlertRulePanel|Add KPI alert|Create KPI alert/);

const intelligenceActions = read("app/app/intelligence/actions.ts");
const prestigePanel = read("components/intelligence/PrestigeOperationsPanel.tsx");
assert.doesNotMatch(intelligenceActions, /createKpiAlertFromPrestigeAction/);
assert.doesNotMatch(prestigePanel, /createKpiAlertFromPrestigeAction|Add KPI alert|showAlert/);

const scheduledGenerator = read("lib/reports/scheduled-generator.ts");
assert.doesNotMatch(scheduledGenerator, /scheduled_report_ready|last_notified_at|\.from\("notifications"\)/);

const search = read("app/api/search/route.ts");
assert.doesNotMatch(search, /return "\/app\/notifications"/);

const help = read("lib/help/content.ts");
assert.doesNotMatch(help, /Understanding notifications|KPI Alerts|\/app\/notifications|quiet-kpi-alerts/);

const generatedTypes = read("lib/supabase/types.ts");
assert.match(generatedTypes, /notifications:/, "historical notification table types must remain available for compatibility");
assert.match(generatedTypes, /kpi_alert_rules:/, "historical KPI alert rule types must remain available for compatibility");
assert.match(generatedTypes, /kpi_alert_events:/, "historical KPI alert event types must remain available for compatibility");

console.log("Notification retirement regressions passed.");
