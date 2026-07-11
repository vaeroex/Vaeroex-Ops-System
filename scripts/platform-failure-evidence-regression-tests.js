const assert = require("node:assert/strict");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();

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

const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const { assessFileAnalysisEvidence, filterEligibleMemoryRows, rebuildEvidenceContext } = require("../lib/ai/evidence-index.ts");
const { classifyEvidenceEligibility, sanitizeBusinessEvidenceText } = require("../lib/intelligence/evidence-eligibility.ts");
const { KNOWN_CONTAMINATION, offlinePlan } = require("./inspect-platform-failure-contamination.js");

function chunk(overrides = {}) {
  return {
    id: "chunk-1",
    source_type: "file_analysis",
    source_id: "file-1",
    source_file_id: "file-1",
    source_metadata: {
      run_id: "run-1",
      evidence_classification: "business_evidence",
      extraction_outcome: "facts_extracted"
    },
    deleted_at: null,
    archived_at: null,
    ...overrides
  };
}

function file(overrides = {}) {
  return {
    id: "file-1",
    deleted_at: null,
    archived_at: null,
    metadata_json: { evidence_classification: "business_evidence", extraction_outcome: "facts_extracted" },
    ...overrides
  };
}

function run(overrides = {}) {
  return {
    id: "run-1",
    status: "completed",
    deleted_at: null,
    archived_at: null,
    input_json: { evidence_classification: "business_evidence" },
    output_json: { evidence_classification: "business_evidence", extraction_outcome: "facts_extracted" },
    ...overrides
  };
}

const softFailure = assessFileAnalysisEvidence({
  outputJson: {
    executive_summary: "Image extraction failed. The company may lack visibility.",
    recommended_actions: ["Implement KPI tracking and improve operational visibility."]
  },
  extractedSourceText: "Image extraction failed",
  extractionFailureReason: "Unable to extract readable image data"
});
assert.equal(softFailure.eligible, false, "soft extraction failures must not become business evidence");
assert.equal(softFailure.classification, "invalid_evidence");

const noReadableData = assessFileAnalysisEvidence({
  outputJson: { response_markdown: "No readable data was found. Create a dashboard to improve visibility." },
  extractedSourceText: ""
});
assert.equal(noReadableData.eligible, false, "no-readable-data output must be a failure state");

const recommendationOnly = assessFileAnalysisEvidence({
  outputJson: { recommended_actions: ["Establish KPI tracking and reporting."] },
  extractedSourceText: "A source was supplied but no actual facts were identified from its contents."
});
assert.equal(recommendationOnly.eligible, false, "ungrounded recommendations are not business facts");

const validEvidence = assessFileAnalysisEvidence({
  outputJson: {
    extracted_findings: ["June on-time delivery was 91%, compared with the 95% target."],
    kpis_found: [{ name: "On-time delivery", actual: "91%", target: "95%" }]
  },
  extractedSourceText: "Period: June. On-time delivery: 91%. Target: 95%. Orders shipped: 428.",
  extractedRowCount: 1
});
assert.equal(validEvidence.eligible, true, "source-grounded business facts must continue to work");

const validNarrativeEvidence = assessFileAnalysisEvidence({
  outputJson: {
    executive_summary: "The purchasing policy requires department owners to approve invoices before payment, with finance completing the final status review each Friday."
  },
  extractedSourceText: "Purchasing policy: Department owners approve every vendor invoice before payment. Finance reviews approved invoice status each Friday and records exceptions in the monthly purchasing report."
});
assert.equal(validNarrativeEvidence.eligible, true, "grounded narrative facts must not require a particular structured list key");

const unsupportedFinding = assessFileAnalysisEvidence({
  outputJson: { extracted_findings: ["Customer churn increased to 42% after a pricing change."] },
  extractedSourceText: "June inventory counted 428 units. On-time delivery was 91% against a 95% target."
});
assert.equal(unsupportedFinding.eligible, false, "model findings must overlap independently extracted source evidence");

const modelGroundedEvidence = assessFileAnalysisEvidence({
  outputJson: { extracted_findings: ["On-time delivery was 91% against a 95% target."] },
  extractedSourceText: "June operations report. On-time delivery was 91% against a 95% target across 428 shipped orders. The reporting period closed June 30.",
  sourceGrounding: "model_extraction"
});
assert.equal(modelGroundedEvidence.eligible, true, "valid direct visual extraction may proceed to review");
assert.equal(modelGroundedEvidence.requiresReview, true, "model-only extraction must not auto-learn without review");

assert.equal(filterEligibleMemoryRows({ rows: [chunk()], files: [file()], runs: [run()] }).length, 1, "active eligible lineage should retrieve");
assert.equal(filterEligibleMemoryRows({ rows: [chunk()], files: [file({ deleted_at: "2026-07-01" })], runs: [run()] }).length, 0, "deleted source files must invalidate active chunks");
assert.equal(filterEligibleMemoryRows({ rows: [chunk()], files: [file()], runs: [run({ status: "failed" })] }).length, 0, "failed source runs must invalidate active chunks");
assert.equal(filterEligibleMemoryRows({ rows: [chunk()], files: [file()], runs: [run({ archived_at: "2026-07-01" })] }).length, 0, "archived source runs must invalidate active chunks");
assert.equal(filterEligibleMemoryRows({ rows: [chunk({ source_metadata: {} })], files: [file()], runs: [run()] }).length, 0, "unclassified file-analysis chunks without run lineage must not retrieve");
assert.equal(
  filterEligibleMemoryRows({
    rows: [chunk({ source_metadata: { evidence_classification: "business_evidence", review_status: "approved" } })],
    files: [file()],
    runs: []
  }).length,
  1,
  "trusted legacy evidence may remain eligible when optional run lineage is unavailable"
);
assert.equal(filterEligibleMemoryRows({ rows: [chunk({ source_metadata: { run_id: "run-1", evidence_classification: "invalid_evidence" } })], files: [file()], runs: [run()] }).length, 0, "legacy contaminated classifications must not retrieve before cleanup");

assert.equal(
  classifyEvidenceEligibility({ body_markdown: "OpenAI service error interrupted our customer support provider." }).eligible,
  true,
  "legitimate business incident evidence must not be rejected solely because it discusses a provider outage"
);
assert.equal(
  sanitizeBusinessEvidenceText("OpenAI service error interrupted our customer support provider."),
  "OpenAI service error interrupted our customer support provider.",
  "generic provider incidents must not be erased without platform-failure provenance"
);
assert.equal(
  classifyEvidenceEligibility({ source_data_json: { generated_from: "period_report" }, body_markdown: "Vaeroex run failed: ask vaeroex" }).eligible,
  false,
  "generated briefing telemetry must be excluded before cleanup"
);
assert.equal(
  classifyEvidenceEligibility({ source_summary: { evidence_classification: "business_evidence", evidence_lineage: { source_type: "business_health_snapshot" }, top_risk: "OpenAI service error: model request timed out." } }).eligible,
  false,
  "legacy contaminated Business Health snapshots must be excluded before cleanup"
);

const rebuiltContext = rebuildEvidenceContext(
  {
    available: true,
    retrievalMode: "keyword",
    chunks: [],
    maxChunks: 8,
    confidenceScore: 91,
    confidenceLabel: "High Confidence",
    limitations: [],
    dataGaps: [],
    policy: []
  },
  []
);
assert.equal(rebuiltContext.available, false, "sanitized empty evidence must not remain available");
assert.equal(rebuiltContext.confidenceScore, 12, "context confidence must be recomputed after evidence is removed");
assert.equal(rebuiltContext.retrievalMode, "none");

const plan = offlinePlan();
assert.equal(plan.mode, "offline_dry_run");
assert.equal(plan.readOnly, true);
assert.equal(plan.productionMutationAttempted, false);
assert.equal(plan.records.length, Object.values(KNOWN_CONTAMINATION).flat().length, "dry run must report every known contaminated ID");
assert.ok(plan.records.every((record) => record.proposedRemediation && record.found === "not_queried"));

const fileActionsSource = require("node:fs").readFileSync(path.join(root, "app/app/files/actions.ts"), "utf8");
const searchRouteSource = require("node:fs").readFileSync(path.join(root, "app/api/search/route.ts"), "utf8");
const cleanupSource = require("node:fs").readFileSync(path.join(root, "scripts/inspect-platform-failure-contamination.js"), "utf8");
const evidenceIndexSource = require("node:fs").readFileSync(path.join(root, "lib/ai/evidence-index.ts"), "utf8");
const retrievalMigration = require("node:fs").readFileSync(path.join(root, "supabase/migrations/202607110001_business_memory_evidence_eligibility.sql"), "utf8");
const boundedContextSource = require("node:fs").readFileSync(path.join(root, "lib/ai/bounded-context.ts"), "utf8");
const reportActionsSource = require("node:fs").readFileSync(path.join(root, "app/app/reports/actions.ts"), "utf8");
const scheduledReportsSource = require("node:fs").readFileSync(path.join(root, "lib/reports/scheduled-generator.ts"), "utf8");
const homePageSource = require("node:fs").readFileSync(path.join(root, "app/app/page.tsx"), "utf8");
const packageJson = require("../package.json");
assert.match(fileActionsSource, /extractionFailureReason: finalTextContent && extraction\.fileAttachment \? undefined/, "successful direct file analysis must clear stale local-parser failure state");
assert.doesNotMatch(fileActionsSource, /latest_analysis_status: "failed",\s*evidence_classification:/, "failed re-analysis must not invalidate previously approved file evidence");
assert.match(searchRouteSource, /business_memory_chunks[\s\S]+\.limit\(24\)/, "search must fetch bounded extra candidates before lifecycle filtering");
assert.match(searchRouteSource, /while \(learnedKnowledge\.length < 6/, "search must continue paging when invalid rows crowd out eligible evidence");
assert.match(searchRouteSource, /learnedKnowledgePages < 10/, "search lifecycle pagination must have a total request bound");
assert.match(evidenceIndexSource, /while \(eligibleRows\.length < limit/, "keyword retrieval must continue paging until it has eligible evidence or exhausts matches");
assert.match(evidenceIndexSource, /pagesScanned < 10/, "keyword lifecycle pagination must have a total request bound");
assert.match(retrievalMigration, /left join public\.file_uploads source_file[\s\S]+left join public\.ai_agent_runs source_run/, "vector retrieval must validate source lifecycle before its result limit");
assert.match(retrievalMigration, /source_run\.status = 'completed'[\s\S]+order by bmc\.embedding[\s\S]+limit/, "vector eligibility must be applied before limiting results");
assert.match(retrievalMigration, /source_run\.output_json #>> '\{metadata,evidence_classification\}'/, "vector retrieval must honor nested source-run classifications");
assert.match(retrievalMigration, /vaeroex \(run\|request\|generation\|analysis\)/, "vector retrieval must reject narrow legacy Vaeroex failure outputs without broad provider keyword blocking");
assert.doesNotMatch(cleanupSource, /NEXT_PUBLIC_SUPABASE_ANON_KEY/, "live cleanup inspection must never fall back to an anonymous key");
assert.match(cleanupSource, /business_health_snapshots"\)\.select\("id,source_summary,created_at"\)/, "cleanup inspector must query the current Business Health snapshot schema");
assert.match(boundedContextSource, /filterEligibleMemoryRowsByLifecycle\(\{ supabase, workspaceId, rows: \[data\] \}\)/, "focused Learned Knowledge must pass through source-lineage validation");
assert.match(boundedContextSource, /file_uploads[\s\S]+\.is\("archived_at", null\)/, "focused source files must exclude archived records");
assert.match(reportActionsSource, /sourceErrors[\s\S]+No report was created/, "manual reports must not persist when required source queries fail");
assert.match(scheduledReportsSource, /sourceErrors[\s\S]+No report was created/, "scheduled reports must not persist when required source queries fail");
assert.match(homePageSource, /items=\{businessEvidenceRuns\.slice\(0, 5\)\}/, "Home must not render platform telemetry as recent business insight");
assert.match(packageJson.scripts["security:check"], /platform-failure-evidence-regression-tests/, "evidence-boundary regressions must be release-gated by the security check");

process.stdout.write("Platform-failure evidence regressions passed.\n");
