const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const retiredOrphans = [
  "app/app/contextual-ask/actions.ts",
  "app/app/executive-brief/actions.ts",
  "app/app/generated/actions.ts",
  "app/app/report-subscriptions/actions.ts",
  "app/app/reports/actions.ts",
  "app/app/sources/actions.ts",
  "components/ai/AskVaeroexNotice.tsx",
  "components/ai/ContextualAskVaeroex.tsx",
  "components/ai/CopyVaeroexResultButton.tsx",
  "components/app/OnboardingChecklist.tsx",
  "components/generated/GeneratedOutputControls.tsx",
  "components/intelligence/BusinessIntelligenceCoverage.tsx",
  "components/intelligence/ExecutiveBriefPanel.tsx",
  "components/motion/ScrollStory.tsx",
  "components/operations/ArchivedFilesBulkActions.tsx",
  "components/operations/GeneratedInsightsPanel.tsx",
  "components/reports/ReportLifecycleMenu.tsx",
  "components/reports/ReportExportActions.tsx",
  "lib/ai/workspace-snapshot.ts",
  "lib/ai/openai-resilience.ts",
  "lib/intelligence/generated-output.ts",
  "lib/reports/scheduled-generator.ts",
  "lib/reports/subscriptions.ts",
  "lib/reports/generation-policy.ts",
  "lib/reports/legacy-executive-brief-artifact.ts",
  "lib/reports/presentation.ts",
  "lib/supabase/client.ts"
];

for (const file of retiredOrphans) {
  assert.equal(fs.existsSync(path.join(root, file)), false, `${file} must stay deleted`);
}

const operations = read("app/app/operations/actions.ts");
for (const symbol of ["updateKpiAction", "deleteKpiAction", "createCrmLeadAction", "createReportAction"]) {
  assert.doesNotMatch(operations, new RegExp(`export async function ${symbol}\\b`), `${symbol} must stay deleted`);
}

const fileActions = read("app/app/files/actions.ts");
for (const symbol of ["saveFileAnalysisToMemoryAction", "createReportFromFileAction", "attachFileToReportAction"]) {
  assert.doesNotMatch(fileActions, new RegExp(`export async function ${symbol}\\b`), `${symbol} must stay deleted`);
}

const accountabilityActions = read("app/app/accountability/actions.ts");
const accountabilityForms = read("components/accountability/AccountabilityForms.tsx");
assert.doesNotMatch(accountabilityActions, /export async function createAssignmentAction\b/);
assert.doesNotMatch(accountabilityForms, /export function AssignmentPanel\b|AssignmentTargetFields/);
assert.match(accountabilityActions, /\.from\("record_shares"\)\.insert/, "KPI sharing must remain active");
assert.match(accountabilityForms, /export function ShareRecordPanel\b/, "KPI sharing UI must remain active");
assert.match(accountabilityActions, /\.from\("people"\)/, "historical person-recipient labels must remain readable");

const teamOptions = read("lib/team/options.ts");
assert.doesNotMatch(teamOptions, /OPERATIONAL_ROLES|TEAM_DEPARTMENTS|ASSIGNMENT_STATUSES|suggestOperationalRole/);

const boundedContext = read("lib/ai/bounded-context.ts");
assert.doesNotMatch(boundedContext, /buildFocusedExplanationContext|buildDeterministicFocusedExplanation/);
assert.match(boundedContext, /buildBoundedWorkspaceContext/, "the active bounded conversational context must remain");

const projections = read("lib/intelligence/snapshot/v1/projections.ts");
assert.doesNotMatch(projections, /projectKpiOverviewV1|projectExecutiveReasoningV1/);

for (const route of [
  "app/app/people/page.tsx",
  "app/app/checklists/page.tsx",
  "app/app/checklist-runs/page.tsx",
  "app/app/notifications/page.tsx",
  "app/app/tasks/page.tsx"
]) {
  const source = read(route);
  const authorization = source.indexOf("requireWorkspacePage()");
  const redirect = source.indexOf("permanentRedirect(");
  assert.ok(authorization >= 0 && redirect > authorization, `${route} must authorize before redirecting`);
}

assert.match(read("app/app/reports/[id]/page.tsx"), /parseSavedAnalysisEnvelope/,
  "current Saved Analyses must retain their strict reader");
assert.doesNotMatch(read("app/app/reports/[id]/page.tsx"), /Legacy|legacy generated report/,
  "historical report presentation must stay retired");
assert.match(read("app/app/agents/page.tsx"), /\.eq\("workspace_id", workspaceId\)/,
  "historical agent-run rendering must remain workspace scoped");
assert.equal(fs.existsSync(path.join(root, "app/api/cron/report-subscriptions/route.ts")), false,
  "the retired report subscription endpoint must stay absent");

const databaseTypes = read("lib/supabase/types.ts");
for (const historicalTable of ["people", "checklists", "checklist_runs", "operational_assignments", "reports", "notifications"]) {
  assert.match(databaseTypes, new RegExp(`${historicalTable}:\\s*\\{`), `${historicalTable} compatibility types must remain`);
}

console.log("Structural v1 cleanup regressions passed.");
