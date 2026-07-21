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

process.env.SUPABASE_SERVICE_ROLE_KEY = "local-executive-brief-regression-secret";

const { buildExecutiveBriefPackage } = require("../lib/ai/executive-brief/context.ts");
const {
  executiveBriefSemanticOverlap,
  validateExecutiveBriefOutput
} = require("../lib/ai/executive-brief/validation.ts");
const {
  openExecutiveBriefPackage,
  sealExecutiveBriefPackage
} = require("../lib/ai/executive-brief/token.ts");
const {
  parseExecutiveBriefArtifact,
  resolveExecutiveBriefStateFromRuns
} = require("../lib/ai/executive-brief/storage.ts");
const {
  EXECUTIVE_BRIEF_QUALIFICATION_PROFILE_IDS,
  getExecutiveBriefQualificationFixtures
} = require("../lib/ai/executive-brief/qualification.ts");
const { verifyEvidenceManifestCitations } = require("../lib/ai/evidence-engine/citation-verification.ts");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-07-19T12:00:00.000Z");

function evidenceRecord(overrides = {}) {
  return {
    id: "kpi:revenue-june",
    title: "Monthly Revenue",
    recordType: "KPI record",
    date: "2026-07-18T00:00:00.000Z",
    value: "Actual $92,000; target $100,000",
    support: "The latest eligible value is below its explicit target.",
    href: "/app/kpis",
    classification: "Original",
    sourceKey: "source-file:retail-workbook",
    groupHint: "Financials",
    ...overrides
  };
}

function insight(overrides = {}) {
  return {
    id: "risk-revenue",
    type: "Risk",
    title: "Monthly Revenue is below target",
    summary: "Monthly Revenue is below its explicit target.",
    why: "The latest eligible value is lower than the recorded target.",
    impact: "The gap requires context before an impact can be established.",
    recommendedAction: "Review the next reporting period.",
    confidence: "Medium",
    evidence: ["Actual: $92,000", "Target: $100,000"],
    evidenceCount: 1,
    supportingRecords: [evidenceRecord()],
    independentSourceCount: 1,
    contradictoryEvidence: [],
    missingEvidence: ["Evidence explaining the change"],
    sourceTypes: ["KPIs"],
    sourceHref: "/app/kpis",
    priority: "High",
    lastUpdated: "2026-07-18T00:00:00.000Z",
    affectedArea: "Financials",
    timePeriod: "2026-07",
    limitation: "The KPI gap does not establish a cause.",
    fingerprint: "risk:revenue:performance-gap:2026-07",
    ...overrides
  };
}

const opportunity = insight({
  id: "opportunity-retention",
  type: "Opportunity",
  title: "Customer Retention is above target",
  summary: "Customer Retention is above its explicit target.",
  why: "The latest eligible value meets the recorded target.",
  recommendedAction: "Preserve visibility into the next reporting period.",
  priority: "Medium",
  affectedArea: "Customer experience",
  limitation: "The result does not establish what caused it.",
  fingerprint: "opportunity:retention:positive-performance:2026-07",
  supportingRecords: [evidenceRecord({
    id: "kpi:retention-june",
    title: "Customer Retention",
    value: "Actual 94%; target 90%",
    support: "The latest eligible value is above its explicit target.",
    sourceKey: "source-file:customer-workbook"
  })]
});

function intelligence(overrides = {}) {
  const risk = insight();
  return {
    executiveSummary: "Revenue needs attention while retention remains supported.",
    businessHealth: { available: true, score: 52, status: "Watch", trend: "Holding steady" },
    dataQuality: { score: 60, label: "Developing", confidence: "Medium", reason: "Eligible source coverage remains developing.", suggestedNextData: [] },
    forecastReadiness: {},
    topRisk: risk,
    topOpportunity: opportunity,
    topRecommendation: risk,
    insights: [risk, opportunity],
    memorySummary: { profileSignals: 2, sourceRecords: 2, kpiHistoryRecords: 8, reports: 0, vaeroexRuns: 0, decisions: 0, recommendationOutcomes: 0 },
    ...overrides
  };
}

function homepage(overrides = {}) {
  return {
    health: {
      available: true,
      score: 52,
      status: "Watch",
      trend: "Holding steady",
      trendDelta: 0,
      summary: "Revenue is below target while retention remains above target.",
      driver: "Monthly Revenue is below its explicit target.",
      confidence: "Medium",
      memorySignals: 10,
      ...overrides
    },
    priorities: [],
    changes: {
      state: "available",
      items: [{ id: "change-revenue", title: "Monthly Revenue", detail: "Monthly Revenue moved below its explicit target.", tone: "negative" }],
      message: ""
    },
    readiness: {}
  };
}

function build(overrides = {}) {
  return buildExecutiveBriefPackage({
    workspaceId,
    intelligence: overrides.intelligence || intelligence(),
    homepage: overrides.homepage || homepage(),
    businessHealthPresentation: overrides.businessHealthPresentation,
    sourceLabelsByKey: overrides.sourceLabelsByKey || {
      "source-file:retail-workbook": "Retail Performance Workbook",
      "source-file:customer-workbook": "Customer Experience Workbook"
    },
    now: overrides.now || now
  });
}

const analysisPackage = build();
assert.equal(analysisPackage.contractId, "executive_brief_v1");
assert.equal(analysisPackage.contractVersion, "executive_brief_v1");
assert.equal(analysisPackage.validatorVersion, "executive_brief_validator_v6");
assert.equal(analysisPackage.facts.businessHealth.score, 52, "the model package must preserve the application-owned score");
assert.ok(analysisPackage.signals.length <= 5, "the signal plan must remain bounded");
assert.ok(analysisPackage.manifest.evidence.length <= 10, "the EvidenceManifest must remain bounded");
assert.equal(analysisPackage.primaryConcernOrdinal, 1, "the application must select the primary concern");
assert.ok(analysisPackage.positiveSignalOrdinal, "the application must select an established positive signal");
assert.ok(analysisPackage.requiredSignalOrdinals.length <= 3, "required coverage must remain focused on the executive story");
assert.equal(analysisPackage.manifest.policy.citationsApplicationGenerated, true);
assert.equal(analysisPackage.manifest.policy.derivedOutputsExcludedFromOriginalEvidence, true);
assert.ok(analysisPackage.manifest.evidence.every((entry) => entry.evidenceRole !== "derived"));
assert.equal(verifyEvidenceManifestCitations({
  manifest: analysisPackage.manifest,
  citationIds: analysisPackage.requiredCitationIds,
  requiredCitationIds: analysisPackage.requiredCitationIds
}).valid, true, "centralized Evidence Engine citation verification must pass");
assert.ok(analysisPackage.citations.some((citation) => citation.sourceLabel === "Retail Performance Workbook"), "human-readable source lineage must be retained");

const laterPackage = build({ now: new Date("2026-07-19T12:10:00.000Z") });
assert.equal(laterPackage.fingerprint, analysisPackage.fingerprint, "generated timestamps must not alter the fingerprint");

const derivedContext = insight({
  id: "generated-context",
  type: "Recommendation",
  fingerprint: "generated:context",
  supportingRecords: [evidenceRecord({ id: "derived:1", title: "Generated report", classification: "Derived", sourceKey: "generated:report" })]
});
const withDerived = build({ intelligence: intelligence({ insights: [insight(), opportunity, derivedContext] }) });
assert.equal(withDerived.fingerprint, analysisPackage.fingerprint, "derived-ineligible output must not invalidate the brief");
assert.ok(withDerived.manifest.evidence.every((entry) => entry.title !== "Generated report"));

const changedRisk = insight({
  supportingRecords: [evidenceRecord({ value: "Actual $88,000; target $100,000" })]
});
const changedPackage = build({ intelligence: intelligence({
  topRisk: changedRisk,
  topRecommendation: changedRisk,
  insights: [changedRisk, opportunity]
}) });
assert.notEqual(changedPackage.fingerprint, analysisPackage.fingerprint, "a relevant fact change must invalidate the brief");

const noConcern = build({ intelligence: intelligence({
  topRisk: null,
  topOpportunity: opportunity,
  topRecommendation: opportunity,
  insights: [opportunity]
}) });
assert.equal(noConcern.primaryConcernOrdinal, null, "the application must support no established concern");
const noPositive = build({ intelligence: intelligence({
  topOpportunity: null,
  topRecommendation: insight(),
  insights: [insight()]
}) });
assert.equal(noPositive.positiveSignalOrdinal, null, "the application must support no established positive signal");
assert.equal(build({ now: new Date("2027-01-19T12:00:00.000Z") }).submode, "evidence_stale");
assert.equal(build({ homepage: homepage({ available: false, score: null }) }).submode, "insufficient_evidence");

const validOutput = {
  executive_summary: "The business has a mixed picture: Monthly Revenue needs attention, but Customer Retention provides a positive counterpoint.",
  why_it_matters: "Customer Retention does not remove the need to examine Monthly Revenue before the next review.",
  primary_concern: "Monthly Revenue is the first issue to examine because the application ranks it as the primary concern.",
  positive_signal: "Customer Retention is the clearest positive fact in the approved evidence.",
  leadership_focus: "Keep attention on Monthly Revenue during the next reporting-period review.",
  uncertainty: "The current evidence does not explain why these metrics moved.",
  provisional_hypothesis: null
};
assert.equal(validateExecutiveBriefOutput(validOutput, analysisPackage).ok, true, "grounded final-contract wording must validate");
assert.equal(executiveBriefSemanticOverlap(validOutput, analysisPackage), null, "a synthesized business story must remain distinct from Business Health");
const repeatedBusinessHealth = {
  ...validOutput,
  executive_summary: "Revenue is below target while retention remains above target, so the current business picture is mixed."
};
const repeatedBusinessHealthResult = validateExecutiveBriefOutput(repeatedBusinessHealth, analysisPackage);
assert.equal(repeatedBusinessHealthResult.diagnostic.reasonCode, "contextual_validation_failed");
assert.equal(executiveBriefSemanticOverlap(repeatedBusinessHealth, analysisPackage)?.kind, "business_health");
const repeatedBriefField = {
  ...validOutput,
  why_it_matters: "Monthly Revenue is the first issue to examine because the application ranks it as the primary concern."
};
assert.equal(executiveBriefSemanticOverlap(repeatedBriefField, analysisPackage)?.kind, "brief_field", "near-verbatim brief fields must be flagged");
assert.equal(
  validateExecutiveBriefOutput({ ...validOutput, why_it_matters: "The approved facts indicate operational pressure across the business." }, analysisPackage).diagnostic.expectedField,
  "why_it_matters",
  "vague consultant shorthand must be rejected"
);
assert.equal(
  validateExecutiveBriefOutput({
    ...validOutput,
    executive_summary: "Monthly Revenue and Customer Retention are both present in the current review.",
    why_it_matters: "Monthly Revenue and Customer Retention require continued review."
  }, analysisPackage).diagnostic.expectedField,
  "why_it_matters",
  "an established positive signal must be placed in the broader business context"
);
const shortUncertainty = validateExecutiveBriefOutput({ ...validOutput, uncertainty: "Unknown." }, analysisPackage);
assert.equal(shortUncertainty.diagnostic.reasonCode, "uncertainty_invalid", "short uncertainty must have a precise safe reason code");
assert.equal(shortUncertainty.diagnostic.expectedField, "uncertainty");
assert.equal(shortUncertainty.diagnostic.expectedCount, 15);
assert.equal(shortUncertainty.diagnostic.observedCount, 8);
assert.equal(validateExecutiveBriefOutput({ ...validOutput, executive_summary: "Monthly Revenue is 42 while Customer Retention remains visible." }, analysisPackage).diagnostic.reasonCode, "numeric_integrity_failed");
assert.equal(validateExecutiveBriefOutput({ ...validOutput, why_it_matters: "See [2] for supporting evidence." }, analysisPackage).diagnostic.reasonCode, "invalid_citation_id");
const unsupportedInference = validateExecutiveBriefOutput({ ...validOutput, why_it_matters: "Monthly Revenue was caused by weak execution." }, analysisPackage);
assert.equal(unsupportedInference.diagnostic.reasonCode, "unsupported_inference");
assert.equal(unsupportedInference.diagnostic.expectedField, "why_it_matters", "safe diagnostics must locate the rejected field without logging content");
const missingRiskOutput = {
  ...validOutput,
  executive_summary: "Customer Retention remains above target in the current evidence.",
  why_it_matters: "The approved customer signal remains visible in the current review.",
  primary_concern: "The current evidence does not establish an additional concern.",
  leadership_focus: "Keep attention on Customer Retention during the next reporting-period review."
};
assert.equal(validateExecutiveBriefOutput(missingRiskOutput, analysisPackage).diagnostic.reasonCode, "missing_required_signal");
assert.equal(validateExecutiveBriefOutput({ ...validOutput, primary_concern: "Monthly Revenue is concerning." }, noConcern).diagnostic.reasonCode, "unsupported_inference");
assert.equal(validateExecutiveBriefOutput({ ...validOutput, positive_signal: "Customer Retention is positive." }, noPositive).diagnostic.reasonCode, "unsupported_inference");

const token = sealExecutiveBriefPackage({ analysisPackage, workspaceId, userId, nowMs: now.getTime() });
assert.doesNotMatch(token, /Monthly Revenue|11111111|22222222/, "the browser handoff must encrypt facts and internal identifiers");
assert.equal(openExecutiveBriefPackage(token, { workspaceId, userId }, now.getTime()).ok, true);
assert.equal(openExecutiveBriefPackage(token, { workspaceId: "33333333-3333-4333-8333-333333333333", userId }, now.getTime()).ok, false);
assert.equal(openExecutiveBriefPackage(token, { workspaceId, userId }, now.getTime() + 16 * 60 * 1000).reason, "expired");

const artifact = {
  contractId: analysisPackage.contractId,
  contractVersion: analysisPackage.contractVersion,
  validatorVersion: analysisPackage.validatorVersion,
  fingerprint: analysisPackage.fingerprint,
  generatedAt: now.toISOString(),
  analysis: validOutput,
  facts: analysisPackage.facts,
  signals: analysisPackage.signals,
  citations: analysisPackage.citations,
  providerAttribution: { provider: "openai", model: "qualification-model", fallbackUsed: false, providerPolicyId: "test-policy" }
};
const completedRun = {
  id: "run-current",
  status: "completed",
  input_json: { fingerprint: analysisPackage.fingerprint },
  output_json: artifact,
  error_message: null,
  created_at: now.toISOString(),
  updated_at: now.toISOString()
};
assert.equal(resolveExecutiveBriefStateFromRuns({ runs: [completedRun], analysisPackage, requestTokenAvailable: true }).status, "current");
assert.equal(resolveExecutiveBriefStateFromRuns({ runs: [completedRun], analysisPackage: changedPackage, requestTokenAvailable: true }).status, "stale", "a previous valid artifact must be preserved after relevant evidence changes");
const failedChangedRun = {
  ...completedRun,
  id: "run-failed-current",
  status: "failed",
  input_json: { fingerprint: changedPackage.fingerprint },
  output_json: {},
  error_message: "Executive Brief generation failed.",
  created_at: new Date(now.getTime() + 60_000).toISOString(),
  updated_at: new Date(now.getTime() + 60_000).toISOString()
};
const preservedAfterFailure = resolveExecutiveBriefStateFromRuns({
  runs: [failedChangedRun, completedRun],
  analysisPackage: changedPackage,
  requestTokenAvailable: true
});
assert.equal(preservedAfterFailure.status, "stale", "two-provider failure must preserve the last valid brief as stale");
assert.equal(preservedAfterFailure.artifact.fingerprint, analysisPackage.fingerprint);
assert.notEqual(preservedAfterFailure.artifact.fingerprint, changedPackage.fingerprint, "a mismatched prior artifact must never appear as current");
assert.equal(parseExecutiveBriefArtifact({ ...artifact, validatorVersion: "executive_brief_validator_v1" }), null, "artifacts from the superseded validator must not appear current");
assert.equal(resolveExecutiveBriefStateFromRuns({ runs: [], analysisPackage, requestTokenAvailable: true }).status, "available");
assert.equal(resolveExecutiveBriefStateFromRuns({ runs: [], analysisPackage: build({ homepage: homepage({ available: false, score: null }) }), requestTokenAvailable: true }).status, "insufficient_evidence");

const qualificationFixtures = getExecutiveBriefQualificationFixtures();
assert.deepEqual(EXECUTIVE_BRIEF_QUALIFICATION_PROFILE_IDS, ["gpt56-sol", "gpt56-terra"]);
assert.equal(qualificationFixtures.length, 12, "the final benchmark must cover all 12 approved operating states");
assert.ok(qualificationFixtures.some((fixture) => fixture.id === "brief-no-established-concern" && fixture.analysisPackage.primaryConcernOrdinal === null));
assert.ok(qualificationFixtures.some((fixture) => fixture.id === "brief-no-established-opportunity" && fixture.analysisPackage.positiveSignalOrdinal === null));
assert.ok(qualificationFixtures.some((fixture) => fixture.analysisPackage.permittedHypothesis !== null));
assert.ok(qualificationFixtures.every((fixture) => fixture.analysisPackage.contractId === "executive_brief_v1"));
assert.ok(qualificationFixtures.every((fixture) => verifyEvidenceManifestCitations({
  manifest: fixture.analysisPackage.manifest,
  citationIds: fixture.analysisPackage.requiredCitationIds,
  requiredCitationIds: fixture.analysisPackage.requiredCitationIds
}).valid), "every frozen package must pass centralized citation verification");

const pageSource = read("app/app/page.tsx");
const actionSource = read("app/app/executive-brief/actions.ts");
const serviceSource = read("lib/ai/executive-brief/service.ts");
const contractSource = read("lib/ai/executive-brief/contracts.ts");
const policySource = read("lib/ai/providers/workflow-provider-policy.ts");
const homepageSource = read("components/intelligence/ExecutiveHomepage.tsx");
const panelSource = read("components/intelligence/ExecutiveBriefPanel.tsx");
const qualificationSource = read("lib/ai/executive-brief/qualification.ts");
const qualificationRouteSource = read("app/api/internal/executive-brief-qualification/route.ts");
assert.match(pageSource, /buildExecutiveBriefPackage/, "Overview must build the bounded deterministic package");
assert.doesNotMatch(pageSource, /generateExecutiveBrief\(/, "server rendering must never invoke a generation provider");
assert.match(actionSource, /getWorkspaceContext/, "the action must reauthorize active workspace membership");
assert.match(actionSource, /verifyEvidenceManifestCitations/, "the action must reverify centralized citations");
assert.match(actionSource, /evidence_classification:\s*"derived_analysis"/, "saved briefs must remain derived and original-evidence-ineligible");
assert.match(actionSource, /original_evidence_eligible:\s*false/);
assert.match(actionSource, /\.eq\("workspace_id", workspaceId\)/, "all run mutations must remain explicitly workspace scoped");
assert.match(actionSource, /action:\s*"executive_brief\.generate"[\s\S]*limit:\s*1[\s\S]*identifiers:\s*\[analysisPackage\.fingerprint\]/, "duplicate generation must be fingerprint-limited");
assert.match(serviceSource, /runStructuredAI/, "the workflow must use the provider-neutral manager");
assert.match(serviceSource, /uncertainty must be one complete 15-420 character sentence/, "the provider contract must match the canonical uncertainty validator");
assert.match(serviceSource, /use neutral "does not establish" wording and never use caused by, results in, leads to, drives, proves, forecasts, predicts, correlated, associated, linked, co-moving, or moves with/, "the prompt must keep uncertainty wording inside the unchanged inference and relationship boundary");
assert.match(serviceSource, /Use numeric values only when they appear in approved_fact or immutable_business_state/, "the prompt must keep narrative numbers inside the unchanged numeric-integrity boundary");
assert.match(serviceSource, /Write for an intelligent small-business owner in plain, direct English/, "the brief must use plain business language");
assert.match(serviceSource, /Business Health separately explains why its score has that value/, "the brief must preserve the Business Health presentation boundary");
assert.match(serviceSource, /operational pressure, execution quality, growth quality/, "the provider contract must explicitly reject vague consultant shorthand");
assert.match(serviceSource, /When permitted_relationships is empty, do not describe signals as correlated, associated, linked, co-moving, or moving with one another/, "the prompt must make the empty relationship boundary explicit");
assert.match(serviceSource, /no_relationship_language_when_unpermitted: analysisPackage\.permittedRelationships\.length === 0/, "the bounded model input must carry the empty relationship rule deterministically");
assert.match(contractSource, /EXECUTIVE_BRIEF_VALIDATOR_VERSION = "executive_brief_validator_v6"/, "prompt-boundary changes must invalidate pre-correction artifacts");
assert.match(policySource, /BUSINESS_HEALTH_GPT56_SOL_MODEL = "gpt-5\.6-sol"[\s\S]*BUSINESS_HEALTH_GPT56_TERRA_MODEL = "gpt-5\.6-terra"/, "the Preview policy must pin Sol and Terra model IDs");
assert.match(policySource, /resolveExecutiveBriefGenerationPolicy[\s\S]*model: BUSINESS_HEALTH_GPT56_SOL_MODEL[\s\S]*model: BUSINESS_HEALTH_GPT56_TERRA_MODEL/, "the Executive Brief policy must route Sol before Terra");
assert.match(policySource, /isExecutiveBriefPreviewEnabled[\s\S]*VERCEL_ENV === "preview"/, "the provider experiment must remain Preview-only");
assert.match(homepageSource, /xl:grid-cols-\[minmax\(0,3fr\)_minmax\(320px,2fr\)\]/, "desktop must preserve the approved 60/40 opening hierarchy");
assert.ok(homepageSource.indexOf("<ExecutiveBriefPanel") < homepageSource.indexOf('aria-labelledby="business-health-heading"'), "mobile source order must place the Executive Brief first");
assert.match(panelSource, />\s*Read full brief\s*</, "the approved executive action copy must render");
assert.match(panelSource, /sm:max-w-3xl/, "desktop must open a bounded side panel");
assert.match(panelSource, /absolute inset-0 flex w-full/, "mobile must open a full-screen sheet");
assert.match(panelSource, /event\.key !== "Tab"/, "keyboard focus must remain inside the open sheet");
assert.doesNotMatch(panelSource, /providerAttribution|provider_policy|runtimeModel|token usage/, "normal users must not see provider metadata");
assert.doesNotMatch(panelSource, /workspace_id|source_file_id|raw_data_json|manifest_id|candidate_id/, "normal users must not see internal serialization labels");
assert.match(panelSource, /artifact \? \([\s\S]*Executive summary/, "only a validated artifact may render the Executive summary section");
assert.doesNotMatch(panelSource, />What the evidence shows</, "the successful Executive Brief must not repeat the Business Health evidence section");
assert.match(panelSource, />Current executive facts</, "provider failure must retain a concise validated-facts fallback");
assert.match(panelSource, /Executive facts remain available while the validated brief is unavailable\./, "the unavailable card must use a concise polished status");
assert.doesNotMatch(panelSource, /artifact\?\.analysis\.executive_summary \|\| facts\.deterministicReadout\[0\]/, "legacy deterministic copy must not masquerade as a generated Executive Summary");
assert.match(qualificationSource, /EXECUTIVE_BRIEF_SYSTEM_PROMPT/, "qualification must use the final workflow prompt");
assert.match(qualificationSource, /executiveBriefModelInput/, "qualification must use the final bounded input serializer");
assert.match(qualificationSource, /validateExecutiveBriefOutput/, "qualification must use the final contextual validator");
assert.doesNotMatch(qualificationSource, /nvidia|NVIDIA/i, "the final Sol/Terra comparison must not activate NVIDIA synthesis");
assert.match(qualificationRouteSource, /VERCEL_ENV === "preview"[\s\S]*VAEROEX_AI_SMOKE_TEST_ENABLED/, "the frozen benchmark endpoint must remain Preview-only");
assert.match(qualificationRouteSource, /isVaeroexAdminUser/, "the frozen benchmark endpoint must require Vaeroex admin access");
assert.match(qualificationRouteSource, /forceTerraFallback/, "Preview qualification must support one controlled Terra fallback verification");
assert.match(qualificationSource, /timeoutMs: 1[\s\S]*BUSINESS_HEALTH_GPT56_TERRA_MODEL/, "the controlled fallback probe must fail Sol transport before invoking Terra");
assert.match(qualificationRouteSource, /const \{ blindOutput: _blindOutput, \.\.\.safeTelemetry \} = result/, "logs must remove synthetic output content");

const malformedPackage = build({
  homepage: homepage({ summary: "Gross margin declined from 52.1% to 49.8%. revenue is on or above target idk" }),
  intelligence: intelligence({
    topOpportunity: insight({
      id: "opportunity-revenue",
      type: "Opportunity",
      title: "revenue is on or above target idk",
      affectedArea: "idk",
      fingerprint: "opportunity:revenue:target",
      supportingRecords: [evidenceRecord({ id: "kpi:revenue-target" })]
    })
  })
});
assert.match(malformedPackage.facts.deterministicReadout[0], /52\.1% to 49\.8%\./, "decimal values and units must remain complete");
assert.doesNotMatch(JSON.stringify(malformedPackage.facts), /\bidk\b/i, "placeholder text must not enter executive-facing facts");
assert.ok(malformedPackage.signals.every((signal) => /^[A-Z]/.test(signal.label)), "signal labels must use normalized capitalization");
assert.ok(malformedPackage.signals.every((signal) => !/\b\d+[.]$/.test(signal.approvedFact)), "incomplete numeric sentences must not render");

process.stdout.write("Executive Brief regressions passed.\n");
