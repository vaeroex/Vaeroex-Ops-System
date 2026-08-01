const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

const route = read("app/app/agents/page.tsx");
const askRoute = read("app/app/ask/page.tsx");
const search = read("app/api/search/route.ts");
const searchTypes = read("lib/search/types.ts");
const overview = read("app/app/page.tsx");
const overviewCompatibility = read("lib/intelligence/overview-run-compatibility.ts");
const intelligence = read("app/app/intelligence/page.tsx");
const workflows = read("lib/ai/vaeroex-workflows.ts");
const contracts = read("lib/ai/output-contracts.ts");
const managedActions = read("app/app/operations/record-management-actions.ts");
const managedList = read("components/operations/ManagedRecordList.tsx");
const gateway = read("lib/security/tool-execution-gateway.ts");
const adminUsage = read("app/app/admin/ai-usage/page.tsx");
const adminHome = read("app/app/admin/page.tsx");
const adminAudit = read("app/app/admin/audit-logs/page.tsx");
const activeTypes = read("lib/ai/active-agent-artifacts.ts");
const businessHealthActions = read("app/app/business-health-analysis/actions.ts");
const businessHealthGenerationClaim = read("lib/ai/business-health-explanation/generation-claim.ts");
const findingActions = read("app/app/finding-explanation/actions.ts");
const fileActions = read("app/app/files/actions.ts");
const savedAnalyses = read("app/app/reports/saved-analysis-actions.ts");
const evidenceIndex = read("lib/ai/evidence-index.ts");
const usageLimits = read("lib/billing/usage-limits.ts");

const authorization = route.indexOf("requireWorkspacePage()");
const redirect = route.indexOf('permanentRedirect("/app/intelligence")');
assert.match(route, /dynamic = "force-dynamic"/, "the authenticated redirect must not be prerendered as a static route");
assert.ok(authorization >= 0 && redirect > authorization, "all Agents URLs must authorize before redirecting to Intelligence");
assert.equal(exists("app/app/agents/actions.ts"), false, "the page-specific Agents server actions must be deleted");
assert.equal(exists("app/app/agents/loading.tsx"), false, "the page-specific Agents loading UI must be deleted");
assert.doesNotMatch(route, /searchParams|ai_agent_runs|runVaeroexAction|output_json|ManagedRecordList/, "run IDs and debug payloads must not render");
assert.match(askRoute, /params\.run[\s\S]*requireWorkspacePage\(\)[\s\S]*redirect\("\/app\/intelligence"\)/, "old Ask result links must authorize and redirect");
assert.doesNotMatch(askRoute, /\/app\/agents/, "Ask must not link back to Agents");

for (const source of [search, searchTypes]) {
  assert.doesNotMatch(source, /\/app\/agents|"Diagnostics"|Diagnostic Run/, "Global Search must not expose Agents diagnostics");
}
assert.doesNotMatch(search, /from\("ai_agent_runs"\)/, "deterministic Search must not query historical run payloads");

assert.match(overview, /buildOverviewRunCompatibility/, "Overview must retain its isolated compatibility aggregate");
assert.match(overview, /agent_type,input_json,output_json,status,error_message,created_at,updated_at,archived_at,deleted_at/, "Overview must select only compatibility fields");
assert.doesNotMatch(overview, /Vaeroex insights|Recent Vaeroex decision support|businessEvidenceRuns/, "Overview must not render the retired run panel");
for (const field of ["derivedFindingCount", "latestEvidenceUpdate", "snapshotSourceCount"]) {
  assert.match(overviewCompatibility, new RegExp(field), `Overview compatibility must preserve ${field}`);
}
assert.doesNotMatch(intelligence, /from\("ai_agent_runs"\)|vaeroexRuns|eligibleRuns/, "Intelligence must not perform the discarded run query");

for (const active of ["executive_intelligence", "file_analysis"]) assert.match(workflows, new RegExp(`key: "${active}"`));
for (const retired of [
  "ask_vaeroex",
  "operations_audit",
  "sop_generator",
  "bottleneck_detector",
  "form_builder",
  "checklist_builder",
  "ceo_mode",
  "focus_priorities",
  "risk_simulation",
  "weekly_management_meeting"
]) assert.doesNotMatch(workflows, new RegExp(`key: "${retired}"`), `${retired} must stay retired`);
assert.match(workflows, /Unsupported Vaeroex workflow/, "unknown workflow keys must fail closed");
assert.doesNotMatch(workflows, /saveTargets|VaeroexSaveTarget/, "legacy generated-output save targets must be absent");
assert.match(contracts, /workflow === "executive_intelligence"/);
assert.match(contracts, /fileAnalysisOutputSchema\.safeParse/);

for (const source of [managedActions, managedList]) assert.doesNotMatch(source, /ai_agent_runs|\/app\/agents/);
assert.doesNotMatch(gateway, /save_vaeroex_output_sop/);
assert.doesNotMatch(fileActions, /revalidatePath\("\/app\/agents"\)/);

for (const type of ["business_health_explanation_v1", "finding_explanation_v1", "file_analysis"]) {
  assert.match(activeTypes, new RegExp(`"${type}"`), `${type} must remain an active diagnostic artifact`);
}
for (const adminSource of [adminUsage, adminHome, adminAudit]) {
  assert.match(adminSource, /ACTIVE_AI_AGENT_RUN_TYPES/, "admin diagnostics must scope run rows to current supported artifacts");
}
assert.doesNotMatch(adminUsage, /Ask Vaeroex|Operations audit|ask_vaeroex|operations_audit/);
assert.match(adminAudit, /security_audit_events/);
assert.match(adminAudit, /audit_logs/);

assert.match(businessHealthActions, /claimBusinessHealthGeneration/, "Business Health generation must delegate the atomic run claim before provider execution");
assert.match(businessHealthGenerationClaim, /\.from\("ai_agent_runs"\)[\s\S]*\.insert\(\{[\s\S]*agent_type: BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID/, "the durable generation claim helper must own the active Business Health run insert");
assert.match(businessHealthGenerationClaim, /\.eq\("workspace_id", workspaceId\)[\s\S]*\.eq\("agent_type", BUSINESS_HEALTH_EXPLANATION_CONTRACT_ID\)/, "conflict resolution must remain workspace- and workflow-scoped");
assert.match(findingActions, /agent_type: FINDING_EXPLANATION_CONTRACT_ID/);
assert.match(fileActions, /getVaeroexWorkflow\("file_analysis"\)[\s\S]*agent_type: workflow\.key/);
assert.match(savedAnalyses, /from\("ai_agent_runs"\)/, "Saved Analysis creation must still validate its source artifact");
assert.match(evidenceIndex, /from\("ai_agent_runs"\)/, "file-analysis lineage must still validate source runs");
assert.match(usageLimits, /from\("ai_agent_runs"\)/, "monthly usage accounting must retain active run storage");

for (const file of [
  "app/app/admin/nvidia-qualification/page.tsx",
  "app/api/internal/nvidia-qualification/route.ts",
  "lib/ai/qualification/types.ts"
]) assert.equal(exists(file), true, `${file} must remain independent and active`);
assert.match(read("lib/supabase/types.ts"), /ai_agent_runs:\s*\{/);
assert.equal(exists("supabase/migrations/202607080002_ai_tool_execution_security.sql"), true);

console.log("Agents retirement regressions passed.");
