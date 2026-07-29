const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
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

function sourceFiles(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(relative);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [relative] : [];
  });
}

assert.equal(fs.existsSync(path.join(root, "lib/intelligence/prestige.ts")), false, "the retired producer must be deleted");
assert.equal(fs.existsSync(path.join(root, "components/intelligence/PrestigeOperationsPanel.tsx")), false, "the retired presentation must be deleted");

for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
  const source = read(file);
  assert.doesNotMatch(source, /buildPrestigeIntelligence|PrestigeOperationsPanel|projectPeoplePrestigeV1/, `${file} must not import or construct retired intelligence`);
}

const overview = read("app/app/page.tsx");
const kpis = read("app/app/kpis/page.tsx");
const decisionJournal = read("components/intelligence/LeadershipDecisionJournal.tsx");
const intelligenceActions = read("app/app/intelligence/actions.ts");
const search = read("app/api/search/route.ts");
const help = read("lib/help/content.ts");
const billing = read("lib/billing/plans.ts");
const demo = read("lib/demo/workspace-demo.ts");
const projections = read("lib/intelligence/snapshot/v1/projections.ts");
const databaseTypes = read("lib/supabase/types.ts");
const activeRecommendationReaders = [
  "app/api/search/route.ts",
  "app/app/page.tsx",
  "app/app/intelligence/page.tsx",
  "lib/ai/bounded-context.ts",
  "lib/intelligence/coverage.ts",
  "lib/intelligence/layer.ts"
];
assert.equal(fs.existsSync(path.join(root, "lib/ai/workspace-snapshot.ts")), false, "the superseded broad workspace snapshot must stay deleted");

assert.doesNotMatch(overview, /Advanced Intelligence|Risk Simulation|Benchmark Mode|Profit Leak Detector/);
assert.match(overview, /LeadershipDecisionJournal/);
assert.match(overview, /from\("business_decisions"\)[\s\S]*\.eq\("workspace_id", workspaceId\)/, "Decision Journal reads must remain workspace scoped");
assert.match(overview, /buildIntelligenceLayer/, "Executive Overview must retain the canonical Intelligence Layer");
assert.match(overview, /buildIntelligenceSnapshotFromProducersV1/, "Executive Overview must retain its canonical snapshot path");

assert.match(decisionJournal, /createBusinessDecisionAction/);
assert.match(decisionJournal, /Decision title/);
assert.match(decisionJournal, /Responsible leader/);
assert.match(decisionJournal, /Expected outcome/);
assert.match(decisionJournal, /decisions\.slice\(0, 6\)/, "the preserved journal must keep the bounded recent-decision list");
assert.match(intelligenceActions, /from\("business_decisions"\)\.insert/);
assert.doesNotMatch(intelligenceActions, /from\("vaeroex_recommendation_outcomes"\)\.insert|createBusinessReviewPackageAction/);
assert.match(search, /Decision Journal[\s\S]*Intelligence%20View#decision-journal/);

assert.match(kpis, /buildCanonicalKpiProducerOutputV1/);
assert.match(kpis, /projectKpiPageV1/);
assert.match(kpis, /projectKpiDetailV1/);
assert.match(kpis, /projectKpiCompareV1/);
assert.match(kpis, /ComparisonAnalysis/);
assert.match(kpis, /ManagedRecordList/);
assert.doesNotMatch(kpis, /comparisonConfidence|businessMemoryCoverage|Benchmarks and data quality|Benchmark comparisons/);
assert.doesNotMatch(kpis, /from\("issues"\)|from\("crm_leads"\)|from\("reports"\)/, "KPI pages must not load retired diagnostic-only sources");

assert.match(help, /Profit Leakage Review/);
assert.match(help, /\/app\/kpis\/profit-leakage/);
assert.doesNotMatch(help, /Profit Leak Detector/);
assert.match(billing, /Profit Leakage Review/);
assert.doesNotMatch(billing, /Profit Leak Detector/);
assert.equal(fs.existsSync(path.join(root, "app/app/kpis/profit-leakage/page.tsx")), true, "the independent Profit Leakage route must remain");
assert.equal(fs.existsSync(path.join(root, "lib/intelligence/profit-leakage.ts")), true, "the independent Profit Leakage calculator must remain");

assert.match(demo, /seedLeadershipDecisionExamples/);
assert.doesNotMatch(demo, /seedPrestigeIntelligenceExamples|prestige_demo/);
assert.doesNotMatch(demo, /from\("vaeroex_recommendation_outcomes"\)\.insert/, "new demo data must not seed retired recommendations");
assert.doesNotMatch(projections, /PeoplePrestigeProjectionV1|projectPeoplePrestigeV1/);

assert.match(databaseTypes, /business_decisions:\s*\{/);
assert.match(databaseTypes, /vaeroex_recommendation_outcomes:\s*\{/);
for (const file of activeRecommendationReaders) {
  assert.doesNotMatch(read(file), /from\("vaeroex_recommendation_outcomes"\)|input\.recommendationOutcomes/, `${file} must not use the retired recommendation ledger as active intelligence`);
}

const { buildBusinessIntelligenceCoverage } = require("../lib/intelligence/coverage.ts");
const coverageWithoutRetiredOutcomes = buildBusinessIntelligenceCoverage({});
const coverageWithRetiredOutcomes = buildBusinessIntelligenceCoverage({
  recommendationOutcomes: [{ id: "legacy-prestige-outcome", source_type: "prestige_intelligence", created_at: "2026-01-01T00:00:00.000Z" }]
});
assert.equal(coverageWithRetiredOutcomes.overallCoverage, coverageWithoutRetiredOutcomes.overallCoverage);
assert.equal(coverageWithRetiredOutcomes.evidenceSummary.derivedFindingCount, coverageWithoutRetiredOutcomes.evidenceSummary.derivedFindingCount);

for (const file of sourceFiles("lib/ai")) {
  assert.doesNotMatch(read(file), /prestige/i, `${file} provider or AI context must not depend on retired intelligence`);
}

const contract = require("../lib/intelligence/snapshot/v1/index.ts");
const snapshot = contract.buildIntelligenceSnapshotV1(contract.foundationSnapshotBuildInput()).snapshot;
assert.equal(snapshot.businessHealth.state, "available");
assert.equal(snapshot.businessHealth.value.score, 78, "canonical Business Health remains at the parity fixture baseline");
assert.equal(snapshot.businessHealth.value.status, "Strong", "canonical Business Health status remains unchanged");
assert.equal(snapshot.readiness.coverage.state, "available");
assert.equal(snapshot.readiness.coverage.value.overallCoverage, 89, "canonical readiness remains at the parity fixture baseline");
assert.equal(snapshot.findings.length, 2, "canonical findings remain unchanged");
assert.equal(snapshot.priorities.length, 3, "canonical priorities remain unchanged");

console.log("Prestige retirement regressions passed.");
