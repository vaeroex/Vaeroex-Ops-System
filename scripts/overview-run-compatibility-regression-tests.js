const assert = require("node:assert/strict");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = require("node:fs").readFileSync(filename, "utf8");
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

const { excludeChecklistDerivedRecords } = require("../lib/intelligence/checklist-retirement.ts");
const { buildBusinessIntelligenceCoverage } = require("../lib/intelligence/coverage.ts");
const { filterBusinessEvidence } = require("../lib/intelligence/evidence-eligibility.ts");
const {
  buildOverviewRunCompatibility,
  eligibleOverviewCompatibilityRuns,
  latestOverviewEvidenceUpdate
} = require("../lib/intelligence/overview-run-compatibility.ts");
const {
  buildIntelligenceSnapshotV1,
  foundationSnapshotBuildInput
} = require("../lib/intelligence/snapshot/v1/index.ts");

const createdAt = "2026-07-20T12:00:00.000Z";
const completedRun = (overrides = {}) => ({
  id: "run-current",
  workspace_id: "workspace-foundation",
  folder_id: null,
  agent_type: "ask_vaeroex",
  input_json: {},
  output_json: { summary: "Historical result." },
  status: "completed",
  error_message: null,
  created_by: null,
  created_at: createdAt,
  updated_at: createdAt,
  archived_at: null,
  deleted_at: null,
  ...overrides
});
const runs = [
  completedRun(),
  completedRun({ id: "run-newer", updated_at: "2026-07-21T12:00:00.000Z" }),
  completedRun({ id: "run-failed", status: "failed", error_message: "Provider timeout." }),
  completedRun({ id: "run-archived", archived_at: "2026-07-22T12:00:00.000Z" }),
  completedRun({ id: "run-checklist", agent_type: "checklist_builder" })
];

const legacyEligibleRuns = excludeChecklistDerivedRecords(
  filterBusinessEvidence(runs, { sourceKind: "platform_run" })
);
const compatibility = buildOverviewRunCompatibility(runs);

assert.deepEqual(eligibleOverviewCompatibilityRuns(runs), legacyEligibleRuns);
assert.deepEqual(Object.keys(compatibility).sort(), ["derivedFindingCount", "latestEvidenceUpdate", "snapshotSourceCount"]);
assert.equal(compatibility.derivedFindingCount, legacyEligibleRuns.length);
assert.equal(compatibility.snapshotSourceCount, legacyEligibleRuns.length);
assert.equal(compatibility.latestEvidenceUpdate, "2026-07-21T12:00:00.000Z");
assert.doesNotMatch(JSON.stringify(compatibility), /Historical result|ask_vaeroex|run-current/);

const decision = {
  id: "decision-current",
  status: "active",
  created_at: "2026-07-19T12:00:00.000Z",
  updated_at: "2026-07-19T12:00:00.000Z",
  archived_at: null,
  deleted_at: null
};
const legacyCoverage = buildBusinessIntelligenceCoverage({ decisions: [decision] });
legacyCoverage.evidenceSummary.derivedFindingCount = legacyEligibleRuns.length + 1;
const compatibilityCoverage = buildBusinessIntelligenceCoverage({
  decisions: [decision],
  overviewRunCompatibility: compatibility
});
assert.deepEqual(compatibilityCoverage, legacyCoverage, "coverage output must remain byte-for-byte equivalent");

const evidenceDates = ["2026-07-18T12:00:00.000Z", "2026-07-23T12:00:00.000Z"];
const legacyLatestUpdate = [...evidenceDates, ...legacyEligibleRuns.map((run) => run.updated_at || run.created_at)].sort().at(-1);
assert.equal(latestOverviewEvidenceUpdate(evidenceDates, compatibility), legacyLatestUpdate);

const legacySnapshotInput = foundationSnapshotBuildInput();
legacySnapshotInput.coverage.output.evidenceSummary.derivedFindingCount = legacyCoverage.evidenceSummary.derivedFindingCount;
const compatibilitySnapshotInput = foundationSnapshotBuildInput();
compatibilitySnapshotInput.coverage.output.evidenceSummary.derivedFindingCount = compatibilityCoverage.evidenceSummary.derivedFindingCount;
const legacySnapshot = buildIntelligenceSnapshotV1(legacySnapshotInput).snapshot;
const compatibilitySnapshot = buildIntelligenceSnapshotV1(compatibilitySnapshotInput).snapshot;
assert.equal(compatibilitySnapshot.fingerprints.input, legacySnapshot.fingerprints.input);
assert.equal(compatibilitySnapshot.fingerprints.snapshot, legacySnapshot.fingerprints.snapshot);
assert.deepEqual(compatibilitySnapshot.readiness.coverage, legacySnapshot.readiness.coverage);

process.stdout.write("Overview run compatibility regressions passed.\n");
