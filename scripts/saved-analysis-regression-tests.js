const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const reportsPage = read("app/app/reports/page.tsx");
const reportDetail = read("app/app/reports/[id]/page.tsx");
const actions = read("app/app/reports/saved-analysis-actions.ts");
const contracts = read("lib/reports/saved-analysis.ts");
const list = read("components/reports/SavedAnalysisList.tsx");
const renderer = read("components/reports/SavedAnalysisRenderer.tsx");
const saveButton = read("components/reports/SaveAnalysisButton.tsx");
const executiveBrief = read("components/intelligence/ExecutiveBriefPanel.tsx");
const businessHealth = read("components/intelligence/BusinessHealthAnalysisPanel.tsx");
const findingExplanation = read("components/intelligence/IntelligenceSignalInbox.tsx");
const reportsNew = read("app/app/reports/new/page.tsx");
const generatedNew = read("app/app/generated/new/page.tsx");
const agentPage = read("app/app/agents/page.tsx");
const agentActions = read("app/app/agents/actions.ts");
const home = read("app/app/page.tsx");
const prestige = read("components/intelligence/PrestigeOperationsPanel.tsx");
const cronRoute = read("app/api/cron/report-subscriptions/route.ts");
const generationPolicy = read("lib/reports/generation-policy.ts");
const legacyReportAction = read("app/app/reports/actions.ts");
const legacyGeneratedAction = read("app/app/generated/actions.ts");
const vercel = read("vercel.json");
const migration = read("supabase/migrations/20260721220519_saved_analysis_uniqueness.sql");

assert.match(`${reportsPage}\n${list}`, /Saved Analyses/);
assert.doesNotMatch(reportsPage, /Generate report|Generate Report|ReportLifecycleMenu/);
assert.match(reportsPage, /\.eq\("workspace_id", workspaceId\)/);
assert.match(reportsPage, /Legacy Reports/);
assert.match(reportsPage, /remain unchanged and read-only/);
assert.match(reportDetail, /parseSavedAnalysisEnvelope/);
assert.match(reportDetail, /SavedAnalysisRenderer/);
assert.doesNotMatch(renderer, /dangerouslySetInnerHTML|provider-manager|vaeroex-client|OpenAI|NVIDIA_API_KEY/);
assert.doesNotMatch(actions, /provider-manager|vaeroex-client|runExecutive|generateExecutive|NVIDIA_API_KEY|OPENAI_API_KEY/);

for (const field of [
  "record_kind", "envelope_version", "workspace_id", "analysis_type", "source_artifact",
  "provider_attribution", "generated_at", "saved_at", "confidence", "evidence_fingerprint",
  "citations", "evidence_lineage", "release_channel", "artifact", "saved_analysis_key"
]) assert.match(contracts, new RegExp(field), `saved-analysis envelope must preserve ${field}`);

assert.match(actions, /artifact: completed\.artifact/);
assert.match(actions, /artifact\.generatedAt === generatedAt/);
assert.match(actions, /source_data_json: envelope/);
assert.match(actions, /created_by: user\.id/);
assert.match(saveButton, /getSavedAnalysisState\(\{ analysisType, fingerprint, generatedAt \}\)/);
assert.match(saveButton, /saveAnalysisAction\(\{ analysisType, fingerprint, generatedAt \}\)/);
assert.match(saveButton, /Already saved/);

assert.match(executiveBrief, /SaveAnalysisButton analysisType="executive_brief"/);
assert.match(businessHealth, /SaveAnalysisButton analysisType="business_health"/);
assert.match(findingExplanation, /SaveAnalysisButton analysisType="finding_explanation"/);
for (const source of [executiveBrief, businessHealth, findingExplanation]) {
  assert.match(source, /generatedAt=\{(?:state\.)?artifact\.generatedAt\}/);
}

assert.match(actions, /\.contains\("source_data_json", \{ record_kind: "saved_analysis", saved_analysis_key: key \}\)/);
assert.match(actions, /error\?\.code === "23505"/);
assert.match(migration, /create unique index(?: if not exists)? reports_saved_analysis_active_key_idx/i);
assert.match(migration, /where deleted_at is null[\s\S]+record_kind[\s\S]+saved_analysis/i);

assert.match(list, /Search saved analyses/);
for (const label of ["All", "Executive Briefs", "Business Health", "Finding Explanations"]) assert.match(list, new RegExp(label));
assert.match(list, /Select all visible/);
assert.match(list, /Clear selection/);
assert.match(list, /Delete selected/);
assert.match(list, /window\.confirm/);
assert.match(list, /deleteSavedAnalysesAction\(ids\)/);
assert.doesNotMatch(reportsPage, /legacy[\s\S]{0,900}type="checkbox"/i, "legacy reports must not enter saved-analysis selection");

assert.match(actions, /new Set\(ids\)/);
assert.match(actions, /\.eq\("workspace_id", workspaceId\)[\s\S]+\.in\("id", uniqueIds\)[\s\S]+\.is\("deleted_at", null\)/);
assert.match(actions, /valid\.length !== uniqueIds\.length/);
assert.match(actions, /Nothing was deleted/);
assert.match(actions, /toolName: "bulk_manage_records"/);
assert.equal((actions.match(/\.update\(\{ deleted_at:/g) || []).length, 1, "bulk deletion must use one server-side update");
assert.doesNotMatch(actions, /from\("ai_agent_runs"\)[\s\S]{0,240}\.update\(|from\("kpis"\)[\s\S]{0,240}\.delete\(/, "deletion must not mutate source artifacts or evidence");

assert.match(reportsNew, /permanentRedirect\("\/app\/reports"\)/);
assert.match(generatedNew, /permanentRedirect\("\/app\/reports"\)/);
for (const source of [reportsPage, home, prestige, findingExplanation, agentPage]) {
  assert.doesNotMatch(source, /Create report|Generate report|Generate Improvement Plan|Generate Investigation Summary|Generate Executive Briefing/);
}
assert.match(agentActions, /Secondary report generation is no longer available/);
assert.match(generationPolicy, /return true/);
assert.match(legacyReportAction, /legacyReportGenerationDisabled\(\)/);
assert.match(legacyGeneratedAction, /legacyReportGenerationDisabled\(\)/);
assert.match(cronRoute, /status: 410/);
assert.doesNotMatch(vercel, /report-subscriptions|crons/);

console.log("Saved-analysis regressions passed.");
