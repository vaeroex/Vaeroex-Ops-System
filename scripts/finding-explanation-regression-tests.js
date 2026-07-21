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
  if (request.startsWith("@/")) return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
const originalLoad = Module._load;
Module._load = function loadPatched(request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

process.env.SUPABASE_SERVICE_ROLE_KEY = "local-finding-explanation-regression-secret";

const { buildFindingExplanationPackage } = require("../lib/ai/finding-explanation/context.ts");
const { validateFindingExplanationOutput } = require("../lib/ai/finding-explanation/validation.ts");
const { openFindingExplanationPackage, sealFindingExplanationPackage } = require("../lib/ai/finding-explanation/token.ts");
const { verifyEvidenceManifestCitations } = require("../lib/ai/evidence-engine/citation-verification.ts");
const {
  BUSINESS_HEALTH_GPT56_POLICY_SELECTOR,
  FINDING_EXPLANATION_GPT56_POLICY_ID,
  isFindingExplanationPreviewEnabled,
  resolveFindingExplanationGenerationPolicy
} = require("../lib/ai/providers/workflow-provider-policy.ts");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";

function record(overrides = {}) {
  return {
    id: "kpi:revenue:2026-07",
    title: "Retail Performance workbook",
    recordType: "KPI",
    date: "2026-07-15T00:00:00.000Z",
    value: "Revenue moved from $100,000 to $92,000",
    support: "The latest reporting period records lower revenue.",
    href: "/app/kpis?metric=Revenue",
    classification: "Original",
    sourceKey: "source-file:retail-workbook",
    groupHint: "Sales",
    ...overrides
  };
}

function insight(overrides = {}) {
  return {
    id: "finding-revenue-returns",
    type: "Risk",
    title: "Revenue and returns require review",
    summary: "Revenue weakened while returns increased in the latest period.",
    why: "The same reporting period records lower revenue and higher returns, but it does not establish a cause.",
    impact: "Leadership needs to determine whether the shift is isolated or continuing before setting priorities.",
    recommendedAction: "Compare the next reporting period and review return reasons by product.",
    confidence: "Medium",
    evidence: [],
    evidenceCount: 2,
    supportingRecords: [
      record(),
      record({ id: "kpi:returns:2026-07", value: "Returns moved from 4.1% to 6.2%", support: "The latest reporting period records higher returns." }),
      record({ id: "derived:brief", classification: "Derived", title: "Generated brief", sourceKey: "run:generated" })
    ],
    independentSourceCount: 1,
    contradictoryEvidence: [],
    missingEvidence: ["Product-level return reasons are not available."],
    sourceTypes: ["KPI"],
    sourceHref: "/app/kpis",
    priority: "High",
    lastUpdated: "2026-07-15T00:00:00.000Z",
    affectedArea: "Sales",
    timePeriod: "Jun-Jul 2026",
    limitation: "The evidence does not establish why revenue fell or returns increased.",
    fingerprint: "finding-fingerprint-v1",
    ...overrides
  };
}

const analysisPackage = buildFindingExplanationPackage({ workspaceId, insight: insight(), now: new Date("2026-07-20T00:00:00.000Z") });
assert.equal(analysisPackage.contractId, "finding_explanation_v1");
assert.equal(analysisPackage.manifest.evidence.length, 2, "derived output must be excluded from the finding evidence package");
assert.equal(analysisPackage.manifest.policy.derivedOutputsExcludedFromOriginalEvidence, true);
assert.equal(analysisPackage.manifest.policy.citationsApplicationGenerated, true);
assert.equal(verifyEvidenceManifestCitations({
  manifest: analysisPackage.manifest,
  citationIds: analysisPackage.requiredCitationIds,
  requiredCitationIds: analysisPackage.requiredCitationIds
}).valid, true, "centralized citation verification must accept the application-generated citation set");

const samePackage = buildFindingExplanationPackage({ workspaceId, insight: insight(), now: new Date("2026-07-21T00:00:00.000Z") });
assert.equal(samePackage.fingerprint, analysisPackage.fingerprint, "generation time must not change the finding fingerprint");
const changedPackage = buildFindingExplanationPackage({
  workspaceId,
  insight: insight({ supportingRecords: [record({ value: "Revenue moved from $100,000 to $88,000" })] }),
  now: new Date("2026-07-20T00:00:00.000Z")
});
assert.notEqual(changedPackage.fingerprint, analysisPackage.fingerprint, "a relevant evidence change must invalidate the finding explanation");

const validOutput = {
  what_happened: "The finding reflects a combined shift in revenue and returns rather than one isolated record.",
  why_evidence_suggests: "The reporting-period evidence records both movements, which may reflect an issue that still needs confirmation.",
  why_leadership_should_care: "Leadership needs to know whether this shift is isolated or continuing before setting priorities.",
  investigate_next: "Compare the next reporting period and review return reasons by product before drawing a conclusion.",
  what_evidence_does_not_prove: "The evidence does not establish why revenue fell or returns increased."
};
assert.equal(validateFindingExplanationOutput(validOutput, analysisPackage).ok, true, "a bounded, grounded explanation must validate");
assert.equal(validateFindingExplanationOutput({ ...validOutput, why_evidence_suggests: "Weak execution caused the decline in revenue." }, analysisPackage).diagnostic.reasonCode, "unsupported_inference");
assert.equal(validateFindingExplanationOutput({ ...validOutput, what_happened: "Revenue fell by 47% during the latest reporting period, which requires leadership review." }, analysisPackage).diagnostic.reasonCode, "numeric_integrity_failed");
assert.equal(validateFindingExplanationOutput({ ...validOutput, investigate_next: "Inspect source_file_id within the approved reporting records before proceeding." }, analysisPackage).diagnostic.reasonCode, "invalid_citation_id");
assert.equal(validateFindingExplanationOutput({ ...validOutput, what_happened: "My hidden reasoning shows a revenue issue." }, analysisPackage).diagnostic.reasonCode, "contextual_validation_failed");

const token = sealFindingExplanationPackage({ analysisPackage, workspaceId, userId, nowMs: Date.parse("2026-07-20T00:00:00.000Z") });
assert.doesNotMatch(token, /Revenue|retail-workbook|11111111/, "the browser token must encrypt business facts and workspace identity");
assert.equal(openFindingExplanationPackage(token, { workspaceId, userId }, Date.parse("2026-07-20T00:01:00.000Z")).ok, true);
assert.equal(openFindingExplanationPackage(token, { workspaceId, userId: "different-user" }, Date.parse("2026-07-20T00:01:00.000Z")).ok, false);

const originalVercelEnv = process.env.VERCEL_ENV;
const originalSelector = process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY;
try {
  process.env.VERCEL_ENV = "preview";
  process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY = BUSINESS_HEALTH_GPT56_POLICY_SELECTOR;
  assert.equal(isFindingExplanationPreviewEnabled(), true);
  const policy = resolveFindingExplanationGenerationPolicy({
    startedAtMs: Date.now(),
    structuredOutput: { name: "finding_explanation_v1", strict: true, schema: { type: "object" } }
  });
  assert.equal(policy.providerPolicy.id, FINDING_EXPLANATION_GPT56_POLICY_ID);
  assert.deepEqual(policy.providerPolicy.steps.map((step) => step.model), ["gpt-5.6-sol", "gpt-5.6-terra"]);
  assert.ok(policy.providerPolicy.steps.every((step) => step.workflowConfiguration.maxAttempts === 1), "Sol and Terra receive one attempt each");
  process.env.VERCEL_ENV = "production";
  assert.equal(isFindingExplanationPreviewEnabled(), false, "the new synthesis path must not activate in Production");
} finally {
  if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = originalVercelEnv;
  if (originalSelector === undefined) delete process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY;
  else process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY = originalSelector;
}

const actionSource = read("app/app/finding-explanation/actions.ts");
const serviceSource = read("lib/ai/finding-explanation/service.ts");
const pageSource = read("app/app/intelligence/page.tsx");
assert.match(actionSource, /getWorkspaceContext/);
assert.match(actionSource, /verifyEvidenceManifestCitations/);
assert.match(actionSource, /original_evidence_eligible: false/, "derived explanations must not become original evidence");
assert.match(serviceSource, /Do not summarize or restate them/);
assert.match(serviceSource, /BUSINESS_HEALTH_GPT56_TERRA_MODEL/);
assert.match(pageSource, /filterEligibleMemoryRowsByLifecycle[\s\S]+buildFindingExplanationPackage/, "finding packages must be built only after existing lifecycle filtering");
assert.doesNotMatch(`${actionSource}\n${serviceSource}`, /console\.(?:log|error)\([^)]*(?:approvedDevelopment|excerpt|requestToken)/, "telemetry must not log evidence or encrypted request tokens");

process.stdout.write("Finding explanation regressions passed.\n");
