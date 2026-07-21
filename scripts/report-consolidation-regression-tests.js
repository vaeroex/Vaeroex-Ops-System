const fs = require("node:fs");
const assert = require("node:assert/strict");

const read = (path) => fs.readFileSync(path, "utf8");
const shell = read("components/app/AppShell.tsx");
const reports = read("app/app/reports/page.tsx");
const savedList = read("components/reports/SavedAnalysisList.tsx");
const reportDetail = read("app/app/reports/[id]/page.tsx");
const generatedDraft = read("app/app/reports/new/page.tsx");
const legacyGeneratedDraft = read("app/app/generated/new/page.tsx");

assert.match(shell, /href: "\/app\/reports", label: "Reports"/);
assert.match(`${reports}\n${savedList}`, /Saved Analyses/);
assert.match(reports, /Legacy Reports/);
assert.match(reports, /previous report-generation system/);
assert.match(reports, /<SavedAnalysisList analyses=\{saved\}/);
assert.doesNotMatch(reports, /Generate report|Board Report|Improvement Plan|Investigation Summary|ReportLifecycleMenu/);
assert.match(reportDetail, /SavedAnalysisRenderer/);
assert.match(reportDetail, /Legacy generated report/);
assert.match(reportDetail, /Read-only/);
assert.doesNotMatch(reportDetail, /ReportLifecycleMenu/);
assert.match(generatedDraft, /permanentRedirect\("\/app\/reports"\)/);
assert.match(legacyGeneratedDraft, /permanentRedirect\("\/app\/reports"\)/);
assert.doesNotMatch(`${generatedDraft}\n${legacyGeneratedDraft}`, /Save report|saveGeneratedOutputToReportsAction|from\("ai_agent_runs"\)/);

console.log("Report saved-analysis consolidation regression tests passed.");
