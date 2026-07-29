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

const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const {
  LEGACY_EXECUTIVE_BRIEF_VALIDATOR_VERSION,
  parseLegacyExecutiveBriefArtifact
} = require("../lib/reports/legacy-executive-brief-artifact.ts");
const {
  parseSavedAnalysisEnvelope,
  savedAnalysisTypeLabel
} = require("../lib/reports/saved-analysis.ts");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const generatedAt = "2026-07-19T12:00:00.000Z";
const legacyArtifact = {
  contractId: "executive_brief_v1",
  contractVersion: "executive_brief_v1",
  validatorVersion: LEGACY_EXECUTIVE_BRIEF_VALIDATOR_VERSION,
  fingerprint: "a".repeat(64),
  generatedAt,
  analysis: {
    executive_summary: "Revenue needs attention while retention remains supported.",
    why_it_matters: "The approved evidence establishes a performance gap and a positive counter-signal.",
    primary_concern: "Monthly Revenue is below its explicit target.",
    positive_signal: "Customer Retention is above its explicit target.",
    leadership_focus: "Review the next reporting period without inferring a cause.",
    uncertainty: "The available evidence does not establish causation.",
    provisional_hypothesis: null
  },
  facts: {
    available: true,
    businessHealth: { score: 52, status: "Watch", trajectory: "Holding steady", comparisonDelta: 0 },
    materialChanges: [{
      stableKey: "monthly-revenue",
      label: "Monthly Revenue",
      fact: "Monthly Revenue was $92,000 against a $100,000 target.",
      direction: "negative"
    }],
    confidence: "Medium",
    freshness: "current",
    latestEvidenceAt: "2026-07-18T00:00:00.000Z",
    independentSourceCount: 1,
    limitations: ["The KPI gap does not establish a cause."],
    deterministicReadout: ["Monthly Revenue is below target."]
  },
  signals: [{
    ordinal: 1,
    stableKey: "monthly-revenue",
    roles: ["primary_concern"],
    classification: "risk",
    domain: "Finance",
    label: "Monthly Revenue",
    approvedFact: "Monthly Revenue was $92,000 against a $100,000 target.",
    approvedLeadershipFocus: "Review the next reporting period.",
    coverageTerms: ["Monthly Revenue"],
    citationIds: [1]
  }],
  citations: [{
    citationId: 1,
    title: "Monthly Revenue",
    sourceLabel: "Retail workbook",
    sourceType: "KPI record",
    excerpt: "Monthly Revenue was $92,000 against a $100,000 target.",
    recordedAt: "2026-07-18T00:00:00.000Z"
  }],
  providerAttribution: {
    provider: "openai",
    model: "historical-model",
    fallbackUsed: false,
    providerPolicyId: "historical-executive-brief-policy"
  }
};

assert.deepEqual(parseLegacyExecutiveBriefArtifact(legacyArtifact), legacyArtifact, "the exact validator-v6 historical artifact must remain readable");
assert.equal(parseLegacyExecutiveBriefArtifact({ ...legacyArtifact, validatorVersion: "executive_brief_validator_v5" }), null, "ambiguous legacy artifacts must fail closed");
assert.equal(parseLegacyExecutiveBriefArtifact({ ...legacyArtifact, fingerprint: "short" }), null, "malformed historical artifacts must fail closed");

const savedEnvelope = {
  record_kind: "saved_analysis",
  envelope_version: 1,
  saved_analysis_key: "executive-brief-historical-key",
  workspace_id: workspaceId,
  release_channel: "production",
  analysis_type: "executive_brief",
  title: "Historical Leadership Analysis",
  source_artifact: {
    id: "historical-run-id",
    workflow: "executive_brief",
    contract_id: "executive_brief_v1",
    contract_version: "executive_brief_v1",
    validator_version: LEGACY_EXECUTIVE_BRIEF_VALIDATOR_VERSION,
    policy_id: "historical-executive-brief-policy"
  },
  provider_attribution: { provider: "openai", model: "historical-model", fallback_used: false },
  generated_at: generatedAt,
  saved_at: "2026-07-20T12:00:00.000Z",
  confidence: "Medium",
  freshness: "current",
  evidence_fingerprint: legacyArtifact.fingerprint,
  citations: legacyArtifact.citations,
  evidence_lineage: legacyArtifact.citations,
  display: {
    summary_label: "Executive summary",
    summary: legacyArtifact.analysis.executive_summary,
    sections: [{ id: "why-it-matters", label: "Why it matters", body: legacyArtifact.analysis.why_it_matters }],
    evidence_status: "Evidence-backed",
    date_range: "Jul 18, 2026"
  },
  artifact: legacyArtifact
};

const parsedEnvelope = parseSavedAnalysisEnvelope(savedEnvelope);
assert.ok(parsedEnvelope, "historical Executive Brief Saved Analyses must remain readable");
assert.equal(parsedEnvelope.analysis_type, "executive_brief");
assert.equal(parsedEnvelope.display.summary, legacyArtifact.analysis.executive_summary);
assert.equal(savedAnalysisTypeLabel("executive_brief"), "Legacy Leadership Analysis");

const retiredFiles = [
  "app/api/internal/executive-brief-qualification/route.ts",
  "lib/ai/executive-brief/context.ts",
  "lib/ai/executive-brief/contracts.ts",
  "lib/ai/executive-brief/qualification.ts",
  "lib/ai/executive-brief/service.ts",
  "lib/ai/executive-brief/storage.ts",
  "lib/ai/executive-brief/token.ts",
  "lib/ai/executive-brief/validation.ts"
];
for (const file of retiredFiles) {
  assert.equal(fs.existsSync(path.join(root, file)), false, `${file} must remain retired`);
}

const home = read("app/app/page.tsx");
const homepage = read("components/intelligence/ExecutiveHomepage.tsx");
const saveActions = read("app/app/reports/saved-analysis-actions.ts");
const policy = read("lib/ai/providers/workflow-provider-policy.ts");
const stageOneTypes = read("lib/ai/qualification/types.ts");
const stageTwoTypes = read("lib/ai/qualification/stage-two-types.ts");
const stageTwoFixtures = read("lib/ai/qualification/stage-two-fixtures.ts");
const reportDetail = read("app/app/reports/[id]/page.tsx");
const agentPage = read("app/app/agents/page.tsx");

assert.doesNotMatch(home, /buildExecutiveBriefPackage|loadExecutiveBriefState|trySealExecutiveBriefPackage|isExecutiveBriefPreviewEnabled/);
assert.doesNotMatch(`${home}\n${homepage}`, /executiveBrief=/);
assert.doesNotMatch(saveActions, /executive_brief|ExecutiveBrief|parseLegacyExecutiveBriefArtifact/, "retirement must not permit new Executive Brief saves");
assert.doesNotMatch(policy, /resolveExecutiveBriefGenerationPolicy|isExecutiveBriefPreviewEnabled|EXECUTIVE_BRIEF_PROVIDER_POLICY_ID/);
assert.match(policy, /resolveBusinessHealthGenerationPolicy/);
assert.match(policy, /resolveFindingExplanationGenerationPolicy/);
assert.doesNotMatch(stageOneTypes, /executive_brief_benchmark_v1/);
assert.doesNotMatch(stageTwoTypes, /executive_brief_v1/);
assert.doesNotMatch(stageTwoFixtures, /executive_brief_v1|id: "brief-/);

assert.match(reportDetail, /parseSavedAnalysisEnvelope/);
assert.match(reportDetail, /SavedAnalysisRenderer/);
assert.match(reportDetail, /\.eq\("workspace_id", workspaceId\)/, "historical Reports must remain workspace scoped");
assert.match(reportDetail, /Legacy generated report/);
assert.match(agentPage, /\.from\("ai_agent_runs"\)/);
assert.match(agentPage, /\.eq\("workspace_id", workspaceId\)/, "historical agent runs must remain workspace scoped");
assert.match(agentPage, /output_json/);

process.stdout.write("Executive Brief retirement and historical compatibility regressions passed.\n");
