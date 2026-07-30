const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));

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
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const retiredFiles = [
  "app/api/cron/report-subscriptions/route.ts",
  "app/app/actions/page.tsx",
  "app/app/briefings/page.tsx",
  "app/app/generated/new/page.tsx",
  "app/app/reports/new/page.tsx",
  "components/reports/ReportExportActions.tsx",
  "lib/reports/generation-policy.ts",
  "lib/reports/legacy-executive-brief-artifact.ts",
  "lib/reports/presentation.ts",
  "scripts/audit-legacy-reports.sql",
  "scripts/executive-brief-regression-tests.js"
];
for (const file of retiredFiles) assert.equal(exists(file), false, `${file} must stay retired`);

const shell = read("components/app/AppShell.tsx");
const reports = read("app/app/reports/page.tsx");
const list = read("components/reports/SavedAnalysisList.tsx");
const detail = read("app/app/reports/[id]/page.tsx");
const actions = read("app/app/reports/saved-analysis-actions.ts");
const search = read("app/api/search/route.ts");
const overview = read("app/app/page.tsx");
const sources = read("app/app/sources/page.tsx");
const fileActions = read("app/app/files/actions.ts");
const boundedContext = read("lib/ai/bounded-context.ts");
const intelligence = read("app/app/intelligence/page.tsx");
const intelligenceLayer = read("lib/intelligence/layer.ts");
const kpiOverview = read("lib/ai/kpi-overview.ts");
const adminCustomer = read("app/app/admin/customers/[workspaceId]/page.tsx");
const memoryEligibility = read("lib/ai/evidence-index.ts");
const workflows = read("lib/ai/vaeroex-workflows.ts");
const agentPage = read("app/app/agents/page.tsx");
const catchAll = read("app/app/[module]/page.tsx");

assert.match(shell, /href: "\/app\/reports", label: "Saved Analyses"/);
assert.match(reports, />Saved Analyses</);
assert.match(reports, /record_kind: "saved_analysis", release_channel: channel/);
assert.match(reports, /envelope\.workspace_id === workspaceId/);
assert.match(reports, /envelope\.release_channel === channel/);
assert.doesNotMatch(`${reports}\n${list}\n${detail}`, /Legacy Reports|Legacy Leadership|Legacy generated report|Read-only report|ReportLifecycleMenu|ReportExportActions/);
assert.match(detail, /parseSavedAnalysisEnvelope/);
assert.match(detail, /savedAnalysis\.workspace_id !== workspaceId/);
assert.match(detail, /savedAnalysis\.release_channel !== channel/);
assert.match(detail, /redirect\("\/app\/reports"\)/);
assert.match(detail, /SavedAnalysisRenderer/);

assert.match(search, /"Saved Analyses"/);
assert.match(search, /record_kind: "saved_analysis", release_channel: savedAnalysisChannel/);
assert.match(search, /parseSavedAnalysisEnvelope/);
assert.doesNotMatch(search, /Derived report|Legacy report/);
assert.match(search, /!row\.source_type\?\.toLowerCase\(\)\.includes\("report"\)/);

for (const [name, source] of [
  ["Executive Overview", overview],
  ["Sources", sources],
  ["file analysis", fileActions],
  ["bounded context", boundedContext],
  ["Intelligence", intelligence]
]) {
  assert.doesNotMatch(source, /\.from\("reports"\)/, `${name} must not query reports`);
}
assert.doesNotMatch(overview, /latestReports|fileGeneratedReports|reportFreshness|reportCount/);
assert.doesNotMatch(sources, /reportsByFile|fileReports|report associations/i);
assert.doesNotMatch(fileActions, /related_reports|suggested_reports/);
assert.doesNotMatch(boundedContext, /context\.reports|body_markdown[\s\S]{0,120}reports/);
assert.match(adminCustomer, /record_kind: "saved_analysis"/);
assert.match(adminCustomer, /release_channel: savedAnalysisChannel/);
assert.match(adminCustomer, /SAVED_ANALYSIS_TYPES/);
assert.match(adminCustomer, /count: "exact", head: true/);
assert.doesNotMatch(intelligenceLayer, /ReportRow|input\.reports|const reports|\breports:\s*0\b/);
assert.doesNotMatch(kpiOverview, /\breports:\s*0\b/);
assert.match(memoryEligibility, /"report", "saved_analysis"/);

assert.doesNotMatch(workflows, /"weekly_report"|"daily_summary"|"business_review_package"|saveTargets: \["report"\]|"report": null/);
assert.doesNotMatch(agentPage, /getReportDrafts|ReportDraftSection|View full report draft|briefing draft/);
assert.equal(exists("app/app/agents/actions.ts"), false, "retired Agents actions must stay deleted");
assert.match(catchAll, /RETIRED_MODULES = new Set\(\["actions", "briefings", "generated"\]\)/);
assert.match(catchAll, /RETIRED_MODULES\.has\(module\)\) notFound\(\)/);

const sourceFiles = [];
function collect(directory) {
  for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(relative);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) sourceFiles.push(relative);
  }
}
for (const directory of ["app", "components", "lib"]) collect(directory);
const reportTableUsers = sourceFiles.filter((file) => /\.from\("reports"\)/.test(read(file))).sort();
assert.deepEqual(reportTableUsers, [
  "app/api/search/route.ts",
  "app/app/admin/customers/[workspaceId]/page.tsx",
  "app/app/reports/[id]/page.tsx",
  "app/app/reports/page.tsx",
  "app/app/reports/saved-analysis-actions.ts"
]);

const { SAVED_ANALYSIS_TYPES, parseSavedAnalysisEnvelope, savedAnalysisListItem } = require("../lib/reports/saved-analysis.ts");
assert.deepEqual([...SAVED_ANALYSIS_TYPES], ["business_health", "finding_explanation"]);
const baseEnvelope = {
  record_kind: "saved_analysis",
  envelope_version: 1,
  saved_analysis_key: "key-1",
  workspace_id: "workspace-1",
  release_channel: "preview",
  analysis_type: "business_health",
  title: "Business Health Analysis",
  source_artifact: {
    id: "run-1",
    workflow: "business_health_explanation_v1",
    contract_id: "business_health_explanation_v1",
    contract_version: "1",
    validator_version: "1",
    policy_id: "approved-policy"
  },
  provider_attribution: { provider: "openai", model: "approved-model", fallback_used: false },
  generated_at: "2026-07-29T12:00:00.000Z",
  saved_at: "2026-07-29T12:01:00.000Z",
  confidence: "High",
  freshness: "current",
  evidence_fingerprint: "a".repeat(64),
  citations: [{ citationId: 1, title: "Revenue", sourceLabel: "KPI", sourceType: "kpi", excerpt: "Revenue is current.", recordedAt: null }],
  evidence_lineage: [{ citationId: 1, title: "Revenue", sourceLabel: "KPI", sourceType: "kpi", excerpt: "Revenue is current.", recordedAt: null }],
  display: { summary_label: "Executive interpretation", summary: "Copied summary", sections: [{ id: "summary", label: "Summary", body: "Copied body" }], evidence_status: "1 supporting citation", date_range: null },
  artifact: { immutable: "copied payload" }
};
for (const analysisType of SAVED_ANALYSIS_TYPES) {
  const parsed = parseSavedAnalysisEnvelope({ ...baseEnvelope, analysis_type: analysisType });
  assert.ok(parsed, `${analysisType} must remain readable`);
  assert.deepEqual(parsed.artifact, { immutable: "copied payload" });
  assert.equal(savedAnalysisListItem("report-1", parsed).analysisType, analysisType);
}
assert.equal(parseSavedAnalysisEnvelope({ ...baseEnvelope, analysis_type: "executive_brief" }), null);
assert.equal(parseSavedAnalysisEnvelope({ ...baseEnvelope, record_kind: "legacy_report" }), null);
assert.equal(parseSavedAnalysisEnvelope({ title: "Ambiguous legacy row" }), null);

assert.match(read("components/intelligence/BusinessHealthAnalysisPanel.tsx"), /SaveAnalysisButton analysisType="business_health"/);
assert.match(read("components/intelligence/IntelligenceSignalInbox.tsx"), /SaveAnalysisButton analysisType="finding_explanation"/);
assert.match(actions, /artifact: completed\.artifact/);
assert.match(actions, /source_data_json: envelope/);
assert.doesNotMatch(actions, /provider-manager|vaeroex-client|OPENAI_API_KEY|NVIDIA_API_KEY/);
assert.match(read("lib/supabase/types.ts"), /reports:\s*\{/);
assert.equal(exists("supabase/migrations/20260721220519_saved_analysis_uniqueness.sql"), true);

console.log("Legacy report retirement regressions passed.");
