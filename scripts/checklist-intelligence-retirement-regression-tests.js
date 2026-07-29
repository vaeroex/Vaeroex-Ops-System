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

const { buildBusinessIntelligenceCoverage } = require("../lib/intelligence/coverage.ts");
const { buildIntelligenceLayer } = require("../lib/intelligence/layer.ts");
const { buildOperationalEvidenceInsights } = require("../lib/intelligence/operational-evidence.ts");

const coreFiles = [
  "app/app/page.tsx",
  "app/app/intelligence/page.tsx",
  "app/app/kpis/page.tsx",
  "lib/intelligence/coverage.ts",
  "lib/intelligence/layer.ts",
  "lib/intelligence/operational-evidence.ts"
];

for (const file of coreFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /\.from\("checklists"\)|\.from\("checklist_runs"\)/, `${file} must not query Checklist storage for active intelligence`);
  assert.doesNotMatch(source, /href:\s*"\/app\/checklists|href:\s*"\/app\/checklist-runs/, `${file} must not emit an active Checklist destination`);
  assert.doesNotMatch(source, /Run checklists?|Review (?:failed )?checklists?/i, `${file} must not emit a Checklist action`);
}

const demoCounts = read("lib/demo/workspace-demo.ts").match(/export async function getDemoWorkspaceCounts[\s\S]*?\n}\n/)?.[0] || "";
assert.doesNotMatch(demoCounts, /from\("checklists"\)|checklists:\s*countValue/, "Executive Overview demo counts must not query or expose Checklist configuration");

for (const route of ["app/app/checklists/page.tsx", "app/app/checklist-runs/page.tsx"]) {
  const source = read(route);
  assert.match(source, /await requireWorkspacePage\(\)/, `${route} must authorize the workspace before redirecting`);
  assert.match(source, /permanentRedirect\("\/app"\)/, `${route} must redirect to Executive Overview`);
}
assert.doesNotMatch(read("app/app/operations/actions.ts"), /createChecklistAction|runChecklistAction/, "retired Checklist UI mutations must not remain reachable");

const date = "2026-07-01T00:00:00Z";
const kpi = (overrides = {}) => ({
  id: "kpi-revenue",
  name: "Revenue",
  actual_value: 80_000,
  target: 100_000,
  metric_date: "2026-07-01",
  created_at: date,
  updated_at: date,
  category: "Sales",
  archived_at: null,
  deleted_at: null,
  ...overrides
});
const checklistKpi = kpi({
  id: "kpi-checklist",
  name: "Checklist Completion Rate",
  actual_value: 90,
  target: 95,
  category: "Operations"
});
const checklistMetric = {
  id: "metric-checklist",
  metric_name: "Checklist Completion Rate",
  metric_value: 90,
  metric_date: "2026-07-01",
  category: "Operations",
  created_at: date,
  updated_at: date,
  archived_at: null,
  deleted_at: null
};

const layerBaseline = buildIntelligenceLayer({ kpis: [kpi()] });
const layerWithChecklist = buildIntelligenceLayer({
  kpis: [kpi(), checklistKpi],
  issues: [{ id: "issue-checklist", title: "Completion declined", issue_type: "Checklist", status: "Open", created_at: date }]
});
assert.deepEqual(layerWithChecklist, layerBaseline, "Checklist KPI rows cannot affect Business Health, findings, opportunities, or priorities");
assert.equal(layerWithChecklist.insights.some((item) => /checklist/i.test(`${item.title} ${item.summary}`)), false, "the deterministic layer produces no Checklist finding");

const coverageBaseline = buildBusinessIntelligenceCoverage({ kpis: [kpi()] });
const coverageWithChecklist = buildBusinessIntelligenceCoverage({
  kpis: [kpi(), checklistKpi],
  operationalMetrics: [checklistMetric],
  checklists: [{ id: "checklist-1", created_at: date }],
  checklistRuns: [{ id: "run-1", checklist_id: "checklist-1", created_at: date }],
  vaeroexRuns: [{ id: "run-checklist", agent_type: "checklist_builder", status: "completed", created_at: date }],
  decisions: [{ id: "decision-checklist", title: "Review completion", related_kpi: "Checklist Completion Rate", created_at: date }],
  recommendationOutcomes: [{ id: "outcome-checklist", source_type: "checklist_review", related_module: "Checklists", created_at: date }]
});
assert.deepEqual(coverageWithChecklist, coverageBaseline, "Checklist absence cannot reduce readiness or coverage");

const sourceFile = { id: "file-1", display_name: "Workbook.xlsx", created_at: date, processed_at: date, archived_at: null, deleted_at: null };
const sourceImport = { id: "import-1", file_upload_id: sourceFile.id, created_at: date, archived_at: null, deleted_at: null };
const imported = (row) => ({
  ...row,
  source_file_id: sourceFile.id,
  import_id: sourceImport.id,
  import_row_id: row.id,
  raw_data_json: { original_evidence_eligible: true }
});
const operationalBaseline = buildOperationalEvidenceInsights({
  kpis: [imported(kpi())],
  files: [sourceFile],
  imports: [sourceImport]
});
const operationalWithChecklist = buildOperationalEvidenceInsights({
  kpis: [imported(kpi()), imported(checklistKpi)],
  operationalMetrics: [imported(checklistMetric)],
  files: [sourceFile],
  imports: [sourceImport]
});
assert.deepEqual(operationalWithChecklist, operationalBaseline, "Checklist-derived measurements cannot create operational evidence findings");

process.stdout.write("Checklist intelligence dependency retirement regressions passed.\n");
