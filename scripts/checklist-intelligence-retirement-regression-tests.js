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
const { buildPrestigeIntelligence } = require("../lib/intelligence/prestige.ts");

const coreFiles = [
  "app/app/page.tsx",
  "app/app/intelligence/page.tsx",
  "app/app/kpis/page.tsx",
  "lib/intelligence/coverage.ts",
  "lib/intelligence/layer.ts",
  "lib/intelligence/operational-evidence.ts",
  "lib/intelligence/prestige.ts",
  "components/intelligence/PrestigeOperationsPanel.tsx"
];

for (const file of coreFiles) {
  const source = read(file);
  assert.doesNotMatch(source, /\.from\("checklists"\)|\.from\("checklist_runs"\)/, `${file} must not query Checklist storage for active intelligence`);
  assert.doesNotMatch(source, /href:\s*"\/app\/checklists|href:\s*"\/app\/checklist-runs/, `${file} must not emit an active Checklist destination`);
  assert.doesNotMatch(source, /Run checklists?|Review (?:failed )?checklists?/i, `${file} must not emit a Checklist action`);
}

const demoCounts = read("lib/demo/workspace-demo.ts").match(/export async function getDemoWorkspaceCounts[\s\S]*?\n}\n/)?.[0] || "";
assert.doesNotMatch(demoCounts, /from\("checklists"\)|checklists:\s*countValue/, "Executive Overview demo counts must not query or expose Checklist configuration");

assert.match(read("app/app/checklists/page.tsx"), /requireWorkspacePage/, "Checklist route remains available for the later UI-retirement PR");
assert.match(read("app/app/checklist-runs/page.tsx"), /requireWorkspacePage/, "Checklist Runs route remains available for the later UI-retirement PR");
assert.match(read("app/app/operations/actions.ts"), /createChecklistAction/, "historical Checklist CRUD remains preserved in this prerequisite PR");

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

const prestigeInput = {
  workspaceName: "Checklist-independent baseline",
  isDemoWorkspace: false,
  periodLabel: "Monthly",
  range: {
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    previousStartDate: "2026-06-01",
    previousEndDate: "2026-06-30"
  },
  kpis: [
    kpi(),
    kpi({ id: "kpi-conversion", name: "Conversion Rate", actual_value: 5, target: 10 }),
    kpi({ id: "kpi-satisfaction", name: "Customer Satisfaction", actual_value: 82, target: 85, category: "Customer" })
  ],
  issues: [
    { id: "issue-1", title: "Open issue 1", status: "Open", severity: "High", created_at: date, assigned_to: null, assigned_person_id: null, assigned_role: null, assigned_department: null },
    { id: "issue-2", title: "Open issue 2", status: "Open", severity: "Medium", created_at: date, assigned_to: "Owner" }
  ],
  assets: [],
  sops: [{ id: "sop-1", title: "SOP", created_at: date, updated_at: date }],
  files: [
    { id: "file-1", display_name: "Workbook.xlsx", analysis_summary: "Validated facts", created_at: date, deleted_at: null, archived_at: null },
    { id: "file-2", display_name: "Notes.pdf", analysis_summary: null, created_at: date, deleted_at: null, archived_at: null }
  ],
  imports: [],
  crmLeads: [
    { id: "lead-1", lead_name: "Lead 1", status: "Open", last_activity_at: null, created_at: date },
    { id: "lead-2", lead_name: "Lead 2", status: "Won", last_activity_at: date, created_at: date }
  ],
  reports: [{ id: "report-1", title: "Report", created_at: date }],
  vaeroexRuns: [],
  operationalMetrics: [],
  assignments: [{ id: "assignment-1", title: "Review", status: "Done", created_at: date }],
  shares: [],
  people: [
    { id: "person-1", full_name: "A", role_title: "Owner", department: "Leadership" },
    { id: "person-2", full_name: "B", role_title: "Manager", department: "Operations" }
  ],
  decisions: [],
  recommendationOutcomes: []
};

const prestigeBaseline = buildPrestigeIntelligence(prestigeInput);
const prestigeWithRetiredInputs = buildPrestigeIntelligence({
  ...prestigeInput,
  kpis: [...prestigeInput.kpis, checklistKpi],
  issues: [...prestigeInput.issues, { id: "issue-checklist", title: "Completion declined", issue_type: "Checklist", status: "Open", created_at: date }],
  checklists: [{ id: "checklist-1", created_at: date }],
  checklistRuns: [{ id: "run-1", checklist_id: "checklist-1", status: "Complete", assigned_department: "Operations", assigned_role: "Manager", created_at: date }],
  assignments: [
    ...prestigeInput.assignments,
    { id: "assignment-checklist", source_type: "checklist_run", source_id: "run-1", title: "Review run", status: "Done", created_at: date }
  ],
  decisions: [{ id: "decision-checklist", title: "Review completion", related_kpi: "Checklist Completion Rate", status: "open", created_at: date }],
  recommendationOutcomes: [{ id: "outcome-checklist", title: "Review completion", source_type: "checklist_review", related_module: "Checklists", status: "completed", created_at: date }]
});
assert.deepEqual(prestigeWithRetiredInputs, prestigeBaseline, "Checklist definitions, runs, and KPI identities cannot affect Prestige");
assert.equal(prestigeBaseline.businessHealth.score, 77, "the checklist-independent Prestige fixture has a stable score of 77");
assert.equal(prestigeBaseline.businessHealth.categories.find((item) => item.name === "Operational Intelligence Health")?.score, 82, "operational health depends only on the two remaining open issues");
assert.equal(prestigeBaseline.businessHealth.categories.find((item) => item.name === "Source Visibility")?.score, 92, "source visibility remains unchanged");
assert.equal(prestigeBaseline.toolSprawl.score, 86, "tool-sprawl readiness is normalized across the seven remaining source modules");
assert.equal(prestigeBaseline.focusPriorities.some((item) => /checklist/i.test(`${item.title} ${item.action} ${item.href}`)), false, "Prestige produces no Checklist priority or action");
assert.equal(prestigeBaseline.profitLeaks.some((item) => /checklist/i.test(`${item.title} ${item.action} ${item.href}`)), false, "Prestige produces no Checklist risk or recommendation");

const legacyOperationalScoreWithNinetyPercentCompletion = Math.round(88 - 2 * 3 + (90 - 85) / 2);
assert.equal(legacyOperationalScoreWithNinetyPercentCompletion, 85, "the retired fixture previously received a three-point Checklist bonus after rounding");
assert.equal(88 - 2 * 3, 82, "the corrected operational formula removes only the Checklist bonus");
assert.equal(Math.round(88 + (100 - 80) / 3), 95, "a completed department Checklist previously raised its score from 88 to 95 after rounding");
assert.equal(prestigeBaseline.departmentScorecards.find((item) => item.department === "Operations")?.score, 88, "department scoring now preserves only assignments, issues, and KPI performance");
assert.equal(90 + 2 * 2, 94, "two completed assignments, including a Checklist assignment, previously raised Source Visibility to 94");
assert.equal(Math.round((7 / 8) * 100), 88, "the old tool-sprawl denominator scored seven used modules including Checklists at 88");
assert.equal(Math.round((6 / 8) * 100), 75, "the old tool-sprawl denominator penalized the same workspace without Checklists at 75");
assert.equal(Math.round((6 / 7) * 100), prestigeBaseline.toolSprawl.score, "the corrected denominator scores only the seven remaining source modules");

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
