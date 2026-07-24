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

process.env.SUPABASE_SERVICE_ROLE_KEY = "local-executive-kpi-analysis-secret";
const { buildExecutiveKpiAnalysisPackage } = require("../lib/ai/executive-kpi-analysis/context.ts");
const { EXECUTIVE_KPI_ANALYSIS_JSON_SCHEMA } = require("../lib/ai/executive-kpi-analysis/contracts.ts");
const { validateExecutiveKpiAnalysisOutput } = require("../lib/ai/executive-kpi-analysis/validation.ts");
const { sealExecutiveKpiAnalysisPackage, openExecutiveKpiAnalysisPackage } = require("../lib/ai/executive-kpi-analysis/token.ts");
const {
  BUSINESS_HEALTH_GPT56_POLICY_SELECTOR,
  BUSINESS_HEALTH_GPT56_SOL_MODEL,
  BUSINESS_HEALTH_GPT56_TERRA_MODEL,
  EXECUTIVE_KPI_ANALYSIS_GPT56_POLICY_ID,
  isExecutiveKpiAnalysisEnabled,
  resolveExecutiveKpiAnalysisGenerationPolicy
} = require("../lib/ai/providers/workflow-provider-policy.ts");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
function trend(name, values, directionality = null, sourceFileId = "33333333-3333-4333-8333-333333333333") {
  return {
    name,
    directionality,
    rows: values.map((actualValue, index) => ({
      id: `${name.toLowerCase().replace(/\s+/g, "-")}-${index}`,
      actualValue,
      targetValue: null,
      observedAt: `2026-0${index + 1}-15`,
      sourceFileId,
      sourceLabel: "Retail Performance workbook"
    }))
  };
}
function build(overrides = {}) {
  return buildExecutiveKpiAnalysisPackage({
    workspaceId,
    trends: [trend("Checkout Wait", [3.5, 4.8, 6.2], "lower"), trend("Revenue", [7000, 6900, 6800], "higher")],
    mode: "normalized",
    timeframe: "Last 90 days",
    startDate: "2026-01-01",
    endDate: "2026-03-31",
    confidenceLabel: "Moderate",
    confidenceScore: 64,
    limitations: ["Historical coverage is limited."],
    now: new Date("2026-03-31T12:00:00.000Z"),
    ...overrides
  });
}

const analysisPackage = build();
assert.equal(analysisPackage.facts.metrics[0].trendDirection, "up");
assert.equal(analysisPackage.facts.metrics[0].directionality, "lower_is_better");
assert.equal(analysisPackage.facts.metrics[1].trendDirection, "down");
assert.equal(analysisPackage.facts.relationships[0].movement, "opposite_direction");
assert.equal(analysisPackage.facts.relationships[0].status, "observed_movement_only");
assert.equal(analysisPackage.facts.relationships[0].correlationCoefficient, null, "correlation must remain unavailable");
assert.equal(analysisPackage.facts.relationships[0].causationEstablished, false);
assert.equal(analysisPackage.citations.length, 1, "shared source lineage should be deduplicated");
assert.equal(build().fingerprint, analysisPackage.fingerprint, "identical KPI packages must be stable");
assert.notEqual(build({ mode: "actual" }).fingerprint, analysisPackage.fingerprint, "mode changes must invalidate cache");
assert.notEqual(build({ trends: [trend("Checkout Wait", [3.5, 4.8, 7.1], "lower"), trend("Revenue", [7000, 6900, 6800], "higher")] }).fingerprint, analysisPackage.fingerprint, "value changes must invalidate cache");
assert.notEqual(build({ trends: [trend("Checkout Wait", [3.5, 4.8, 6.2], "higher"), trend("Revenue", [7000, 6900, 6800], "higher")] }).fingerprint, analysisPackage.fingerprint, "directionality changes must invalidate cache");

const validOutput = {
  executive_summary: "Checkout Wait increased while Revenue declined across the selected period, so leadership has an opposing movement to investigate without assuming a cause.",
  significant_trends: [
    { metric_ordinals: [1], statement: "Checkout Wait moved upward across the selected period and its explicit direction makes that movement less favorable." },
    { metric_ordinals: [2], statement: "Revenue moved downward across the selected period and its explicit direction makes that movement less favorable." }
  ],
  potential_kpi_relationships: [{
    metric_ordinals: [1, 2],
    status: "Possible relationship",
    statement: "The measures moved in opposite directions during the same selected period, but the available evidence does not establish why."
  }],
  possible_business_drivers: [{ metric_ordinals: [], statement: "The available evidence does not establish the underlying driver." }],
  leadership_considerations: ["Leadership should review the underlying business records before making a decision based on this movement alone."],
  analysis_limitations: ["The comparison does not establish statistical correlation, significance, or causation between the selected measures."]
};
const validResult = validateExecutiveKpiAnalysisOutput(validOutput, analysisPackage);
assert.equal(validResult.ok, true, `grounded output should pass: ${JSON.stringify(validResult)}`);
assert.equal(validateExecutiveKpiAnalysisOutput({ ...validOutput, executive_summary: `${validOutput.executive_summary} The value will be 999.` }, analysisPackage).diagnostic?.reasonCode, "numeric_integrity_failed", "unsupported numbers must fail");
assert.equal(validateExecutiveKpiAnalysisOutput({ ...validOutput, executive_summary: `${validOutput.executive_summary} Churn Rate also declined.` }, analysisPackage).diagnostic?.reasonCode, "unknown_signal_id", "invented KPI names must fail");
assert.equal(validateExecutiveKpiAnalysisOutput({ ...validOutput, executive_summary: "Checkout Wait caused Revenue to decline, which proves the business impact is established." }, analysisPackage).diagnostic?.reasonCode, "unsupported_inference", "causation must fail");
assert.equal(validateExecutiveKpiAnalysisOutput({ ...validOutput, potential_kpi_relationships: [{ ...validOutput.potential_kpi_relationships[0], status: "Supported correlation" }] }, analysisPackage).diagnostic?.reasonCode, "unsupported_relationship", "unavailable correlation must not be upgraded");
assert.equal(validateExecutiveKpiAnalysisOutput({ ...validOutput, significant_trends: [validOutput.significant_trends[0]] }, analysisPackage).diagnostic?.reasonCode, "missing_required_signal", "required KPI coverage must be enforced");
assert.equal(validateExecutiveKpiAnalysisOutput({ ...validOutput, potential_kpi_relationships: [{ ...validOutput.potential_kpi_relationships[0], metric_ordinals: [1, 1] }] }, analysisPackage).diagnostic?.reasonCode, "unknown_signal_id", "duplicate KPI ordinals must remain rejected contextually");
assert.doesNotMatch(JSON.stringify(EXECUTIVE_KPI_ANALYSIS_JSON_SCHEMA), /uniqueItems/, "provider schema must use only supported strict-schema keywords");

const token = sealExecutiveKpiAnalysisPackage({ analysisPackage, workspaceId, userId, nowMs: 1000 });
assert.equal(openExecutiveKpiAnalysisPackage(token, { workspaceId, userId }, 2000).ok, true);
assert.equal(openExecutiveKpiAnalysisPackage(token, { workspaceId: "44444444-4444-4444-8444-444444444444", userId }, 2000).ok, false, "cross-workspace tokens must fail");

process.env.VERCEL_ENV = "preview";
process.env.VAEROEX_EXECUTIVE_SYNTHESIS_POLICY = BUSINESS_HEALTH_GPT56_POLICY_SELECTOR;
assert.equal(isExecutiveKpiAnalysisEnabled(), true);
const policy = resolveExecutiveKpiAnalysisGenerationPolicy({ startedAtMs: 1000, structuredOutput: { name: "test", strict: true, schema: {} } });
assert.equal(policy.providerPolicy.id, EXECUTIVE_KPI_ANALYSIS_GPT56_POLICY_ID);
assert.deepEqual(policy.providerPolicy.steps.map((step) => step.model), [BUSINESS_HEALTH_GPT56_SOL_MODEL, BUSINESS_HEALTH_GPT56_TERRA_MODEL]);
process.env.VERCEL_ENV = "production";
assert.equal(isExecutiveKpiAnalysisEnabled(), false, "generation must remain Preview-only");

const pageSource = read("app/app/kpis/page.tsx");
const componentSource = read("components/intelligence/ExecutiveKpiAnalysis.tsx");
const actionSource = read("app/app/kpis/executive-analysis/actions.ts");
const storageSource = read("lib/ai/executive-kpi-analysis/storage.ts");
assert.match(pageSource, /<OverlayTrendChart trends=\{trends\} mode=\{mode\} \/>/, "the existing chart must remain mounted unchanged");
assert.doesNotMatch(pageSource, />Comparison summary</, "the old visible comparison summary must be retired");
assert.match(componentSource, /Generate Executive Analysis/);
assert.doesNotMatch(componentSource, /useEffect\(/, "page render must not trigger generation");
assert.match(componentSource, /onClick=\{generate\}/, "generation must require an explicit click");
assert.match(componentSource, /Validated KPI facts/, "deterministic fallback must remain visible on failure");
assert.match(actionSource, /isExecutiveKpiAnalysisEnabled\(\)/, "the action must fail closed outside Preview policy");
assert.match(actionSource, /workspaceId, fingerprint: analysisPackage\.fingerprint/, "cache lookup must be workspace and fingerprint scoped");
assert.match(actionSource, /original_evidence_eligible: false/, "derived analysis must never become original evidence");
assert.match(storageSource, /\.eq\("workspace_id", workspaceId\)/, "persisted artifact selection must be workspace scoped");
assert.match(storageSource, /record\(run\.input_json\)\.fingerprint === fingerprint/, "cached artifacts must match the current fingerprint");

console.log("Executive KPI Analysis regressions passed.");
