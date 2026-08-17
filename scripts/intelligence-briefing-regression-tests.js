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

const { buildIntelligenceSnapshotV1, foundationSnapshotBuildInput, foundationEvidenceManifest } = require("../lib/intelligence/snapshot/v1/index.ts");
const { projectIntelligenceBriefingV1 } = require("../lib/intelligence/snapshot/v1/briefing-projection.ts");
const { buildIntelligenceBriefingEvidence } = require("../lib/ai/intelligence-briefing/evidence.ts");
const { intelligenceBriefingKpiEvidenceKey } = require("../lib/ai/intelligence-briefing/identity.ts");
const { intelligenceBriefingPeriod } = require("../lib/ai/intelligence-briefing/period.ts");
const { validateIntelligenceBriefingOutput } = require("../lib/ai/intelligence-briefing/validation.ts");
const { parseIntelligenceBriefingArtifact, briefingStateFromPackage } = require("../lib/ai/intelligence-briefing/storage.ts");
const {
  INTELLIGENCE_BRIEFING_GPT56_POLICY_ID,
  INTELLIGENCE_BRIEFING_POLICY_SELECTOR,
  resolveIntelligenceBriefingGenerationPolicy
} = require("../lib/ai/providers/workflow-provider-policy.ts");

const workspaceId = "workspace-foundation-a";
const asOf = "2026-07-28T12:00:00.000Z";
const hash = "a".repeat(64);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function manifest(overrides = {}) {
  const value = clone(foundationEvidenceManifest());
  value.manifestId = overrides.manifestId || hash;
  Object.assign(value, overrides);
  return value;
}

function project({ snapshot = buildIntelligenceSnapshotV1(foundationSnapshotBuildInput()).snapshot, evidence = manifest(), type = "monthly", period = intelligenceBriefingPeriod(type, new Date(asOf)), previousBriefing = null, maps = true } = {}) {
  return projectIntelligenceBriefingV1({
    snapshot,
    briefingType: type,
    period,
    manifest: evidence,
    citationIdsByMetric: maps
      ? new Map(snapshot.kpis.map((kpi) => [intelligenceBriefingKpiEvidenceKey(kpi.identity), [1]]))
      : new Map(),
    citationIdsByFinding: maps ? new Map([["finding-checkout-wait", [1]], ["finding-revenue", [1]]]) : new Map(),
    hrefByCandidateId: new Map([["candidate-original", "/app/sources/source-original"]]),
    sourceLabelByCandidateId: new Map([["candidate-original", "Operations workbook"]]),
    previousBriefing
  });
}

const weekly = intelligenceBriefingPeriod("weekly", new Date(asOf));
const monthly = intelligenceBriefingPeriod("monthly", new Date(asOf));
assert.deepEqual(weekly, { start: "2026-07-22", end: "2026-07-28", cutoff: asOf, dayCount: 7, timeZone: "UTC" });
assert.deepEqual(monthly, { start: "2026-06-29", end: "2026-07-28", cutoff: asOf, dayCount: 30, timeZone: "UTC" });
assert.notEqual(
  intelligenceBriefingKpiEvidenceKey({ canonicalName: "gross_margin", unit: "%", scale: 1, metricRole: "actual" }),
  intelligenceBriefingKpiEvidenceKey({ canonicalName: "gross_margin", unit: "USD", scale: 1000, metricRole: "actual" }),
  "same-name KPIs with different unit and scale must never share briefing evidence"
);

function findingEvidence(date) {
  return {
    id: `finding-${date}`,
    type: "Risk",
    title: "Delivery risk",
    summary: "A measured delivery condition warrants review.",
    why: "The eligible source record is within the selected period.",
    impact: "Leadership visibility may be useful.",
    recommendedAction: "Review the supporting evidence.",
    confidence: "Medium",
    evidence: ["Measured delivery condition"],
    evidenceCount: 1,
    supportingRecords: [{
      id: `record-${date}`,
      title: "Delivery record",
      recordType: "Operational record",
      date,
      value: "Delivery condition recorded",
      support: "Original business evidence",
      href: "/app/sources",
      classification: "Original",
      sourceKey: `source:${date}`
    }],
    independentSourceCount: 1,
    contradictoryEvidence: [],
    missingEvidence: [],
    sourceTypes: ["Operational record"],
    sourceHref: "/app/sources",
    priority: "High",
    lastUpdated: date,
    affectedArea: "Operations",
    timePeriod: date,
    limitation: "One source is available.",
    fingerprint: `fingerprint-${date}`
  };
}

const periodEvidence = buildIntelligenceBriefingEvidence({
  workspaceId,
  period: weekly,
  kpiRows: [],
  kpiSettings: [],
  insights: [findingEvidence("2026-07-27"), findingEvidence("2026-06-01")],
  sourceLabelsById: {},
  generatedAt: asOf
});
assert.equal(periodEvidence.manifest.evidence.length, 1, "finding evidence outside the exact rolling period is excluded");
assert.match(periodEvidence.manifest.evidence[0].candidateId, /2026-07-27|IB-FINDING/);

const limited = project();
assert.equal(limited.eligibility, "limited", "one independent source must remain explicitly limited");
assert.ok(limited.sections.length > 0 && limited.sections.length < 7, "only sections with deterministic supporting signals are emitted");
assert.ok(limited.signals.every((signal) => signal.authority !== "reported_context" || signal.citationIds.length === 0));
assert.equal(limited.manifest.workspaceId, limited.workspaceId);
assert.match(limited.evidenceFingerprint, /^[a-f0-9]{64}$/);
assert.match(limited.materialStateFingerprint, /^[a-f0-9]{64}$/);
assert.throws(
  () => project({ evidence: { ...manifest(), workspaceId: "foreign-workspace" } }),
  /another workspace/,
  "cross-workspace evidence manifests fail closed before synthesis"
);

const emptyEvidence = manifest({
  manifestId: "b".repeat(64),
  evidence: [],
  sourceRegistry: {
    ...manifest().sourceRegistry,
    entries: [],
    candidateToSourceOrdinal: {},
    independentOriginalSourceCount: 0
  }
});
const unavailable = project({ evidence: emptyEvidence, maps: false });
assert.equal(unavailable.eligibility, "no_eligible_evidence", "no eligible evidence must block model eligibility deterministically");
assert.equal(briefingStateFromPackage({ briefingPackage: unavailable, current: null }).status, "unavailable");

const staleEvidence = manifest({
  evidence: manifest().evidence.map((entry) => ({
    ...entry,
    recordedAt: "2026-06-28T00:00:00.000Z",
    indexedAt: "2026-06-28T00:00:00.000Z"
  }))
});
assert.equal(
  project({ evidence: staleEvidence }).evidenceCoverage.freshness,
  "stale",
  "briefing freshness is derived from the exact evidence period rather than an unrelated age threshold"
);

const secondOriginal = {
  ...clone(manifest().evidence[0]),
  citationId: 3,
  candidateId: "candidate-original-two",
  sourceOrdinal: "S3",
  title: "Customer workbook"
};
const sufficientManifest = manifest({
  manifestId: "c".repeat(64),
  evidence: [...manifest().evidence, secondOriginal],
  sourceRegistry: {
    ...manifest().sourceRegistry,
    entries: [...manifest().sourceRegistry.entries, {
      ...clone(manifest().sourceRegistry.entries[0]),
      sourceOrdinal: "S3",
      canonicalSourceKey: `${workspaceId}:file:customers`,
      independentSourceKey: `${workspaceId}:file:customers`,
      sourceId: "source-customers",
      sourceFileId: "source-customers",
      candidateIds: ["candidate-original-two"]
    }],
    candidateToSourceOrdinal: { ...manifest().sourceRegistry.candidateToSourceOrdinal, "candidate-original-two": "S3" },
    independentOriginalSourceCount: 2
  }
});
assert.equal(project({ evidence: sufficientManifest }).eligibility, "sufficient", "two independent original sources plus strong canonical coverage allow normal synthesis");

const identical = project();
assert.equal(identical.generationKey, limited.generationKey, "identical deterministic inputs reuse one generation key");
assert.equal(identical.materialStateFingerprint, limited.materialStateFingerprint);

const nextDaySnapshot = clone(buildIntelligenceSnapshotV1(foundationSnapshotBuildInput()).snapshot);
nextDaySnapshot.scope.asOf = "2026-07-29T12:00:00.000Z";
const shifted = project({
  snapshot: nextDaySnapshot,
  period: intelligenceBriefingPeriod("monthly", new Date(nextDaySnapshot.scope.asOf))
});
assert.equal(shifted.materialStateFingerprint, limited.materialStateFingerprint, "a rolling cutoff shift alone is nonmaterial");
assert.equal(shifted.generationKey, limited.generationKey, "a rolling cutoff shift alone must not call the model again");

const citationOnlyManifest = manifest({ manifestId: "d".repeat(64) });
const citationOnly = project({ evidence: citationOnlyManifest });
assert.notEqual(citationOnly.effectiveEvidenceFingerprint, limited.effectiveEvidenceFingerprint, "new eligible evidence identity is observable");
assert.equal(citationOnly.materialStateFingerprint, limited.materialStateFingerprint, "citation-only evidence churn is nonmaterial");
assert.equal(citationOnly.generationKey, limited.generationKey);

const changedSnapshot = clone(buildIntelligenceSnapshotV1(foundationSnapshotBuildInput()).snapshot);
const changedKpi = changedSnapshot.kpis.find((kpi) => kpi.id === "kpi-revenue");
changedKpi.observations.current.value += 20;
const changed = project({ snapshot: changedSnapshot });
assert.notEqual(changed.materialStateFingerprint, limited.materialStateFingerprint, "an authoritative KPI value change is material");
assert.notEqual(changed.generationKey, limited.generationKey);

function validOutput(input) {
  const sectionClaims = input.sections.map((section) => ({
    section_id: section.id,
    summary: "The supplied deterministic signals in this area warrant bounded leadership awareness.",
    support_refs: section.signalRefs,
    claims: [{
      text: "The measured evidence remains within the application-owned confidence and evidence boundaries.",
      support_refs: section.signalRefs
    }]
  }));
  return {
    executive_summary: {
      text: "The supplied deterministic business signals warrant leadership review within the stated evidence and confidence limits.",
      support_refs: input.requiredSignalRefs
    },
    sections: sectionClaims,
    leadership_considerations: [{
      text: "Leadership can review the supported signals and investigate their context without asserting causation.",
      support_refs: input.requiredSignalRefs
    }],
    limitation_refs: input.limitations.map((limitation) => limitation.ref)
  };
}

const valid = validOutput(limited);
assert.equal(validateIntelligenceBriefingOutput(valid, limited).ok, true, "a fully bounded structured briefing passes strict validation");
const badCitation = clone(valid);
badCitation.executive_summary.support_refs = ["UNKNOWN"];
assert.equal(validateIntelligenceBriefingOutput(badCitation, limited).ok, false, "unknown support references fail closed");
const fabricatedNumber = clone(valid);
fabricatedNumber.executive_summary.text += " The unsupported value is 999999.";
assert.equal(validateIntelligenceBriefingOutput(fabricatedNumber, limited).ok, false, "invented numeric facts fail closed");
const firstKpiSignal = limited.signals.find((signal) => signal.ref === "K1");
const secondKpiSignal = limited.signals.find((signal) => signal.ref === "K2");
assert.ok(firstKpiSignal && secondKpiSignal, "the fixture exposes two independently bound KPI signals");
const ownNumber = firstKpiSignal.fact.match(/-?\d+(?:\.\d+)?/)?.[0];
const foreignNumber = secondKpiSignal.fact.match(/-?\d+(?:\.\d+)?/)?.[0];
assert.ok(ownNumber && foreignNumber && ownNumber !== foreignNumber, "the claim-level grounding fixture has distinct numeric facts");
const groundedNumber = clone(valid);
groundedNumber.executive_summary = {
  text: `The cited deterministic signal records ${ownNumber}, which warrants bounded leadership review within the available evidence.`,
  support_refs: [firstKpiSignal.ref]
};
assert.equal(validateIntelligenceBriefingOutput(groundedNumber, limited).ok, true, "a number present in the claim's cited signal remains valid");
const crossBoundNumber = clone(groundedNumber);
crossBoundNumber.executive_summary.text = `The cited deterministic signal records ${foreignNumber}, which warrants bounded leadership review within the available evidence.`;
assert.equal(validateIntelligenceBriefingOutput(crossBoundNumber, limited).ok, false, "a number borrowed from an uncited signal fails closed");
const omittedLimitation = clone(valid);
omittedLimitation.limitation_refs = omittedLimitation.limitation_refs.slice(1);
assert.equal(validateIntelligenceBriefingOutput(omittedLimitation, limited).ok, false, "application-owned limitations cannot be omitted");
const causal = clone(valid);
causal.leadership_considerations[0].text = "The metric caused the business result and should be reviewed immediately.";
assert.equal(validateIntelligenceBriefingOutput(causal, limited).ok, false, "unsupported causation fails closed");

const contextSnapshot = clone(buildIntelligenceSnapshotV1(foundationSnapshotBuildInput()).snapshot);
contextSnapshot.contextualEvidence = [{
  contractVersion: "business_note_context_record_v1",
  snapshotAdapterVersion: "business_note_context_snapshot_adapter_v1",
  id: "context-record-1",
  workspaceId,
  releaseChannel: "development",
  sourceNoteId: "11111111-1111-4111-8111-111111111112",
  sourceVersion: 1,
  sourceTextHash: "e".repeat(64),
  authorityRole: "supporting_context",
  originalEvidenceEligible: false,
  lifecycle: "active",
  validationState: "approved_review",
  title: "Pricing update",
  summary: "Leadership reported a pricing update during the period.",
  noteType: "business_update",
  sourceClassification: "leadership_reported_context",
  departments: ["Sales"],
  topics: ["Pricing"],
  entities: [],
  statements: [],
  userAddedContext: [],
  applicability: { start: "2026-07-22", end: null, source: "user_review", temporalStatus: "applicable" },
  extractionConfidence: 0.9,
  approvedAt: "2026-07-27T09:00:00.000Z",
  observedAt: "2026-07-26",
  provenance: {
    sourceNoteId: "11111111-1111-4111-8111-111111111112",
    sourceVersion: 1,
    sourceTextHash: "e".repeat(64),
    extractionId: "context-extraction-1",
    approvalId: "context-approval-1"
  }
}];
const contextual = project({ snapshot: contextSnapshot });
const contextRef = contextual.signals.find((signal) => signal.authority === "reported_context")?.ref;
assert.ok(contextRef && contextual.sections.some((section) => section.id === "business_updates_context"), "approved applicable Business Notes enter only the context section");
assert.equal(contextual.signals.find((signal) => signal.ref === contextRef).citationIds.length, 0, "reported context never becomes original measured evidence");
const contextualOutput = validOutput(contextual);
for (const section of contextualOutput.sections) {
  if (section.support_refs.includes(contextRef)) {
    section.summary = "An approved Business Note reports a pricing update; this reported context does not establish causation or replace measured evidence.";
  }
}
for (const claim of [
  contextualOutput.executive_summary,
  ...contextualOutput.sections.flatMap((section) => section.claims),
  ...contextualOutput.leadership_considerations
]) {
  if (claim.support_refs.includes(contextRef)) {
    claim.text = "An approved Business Note reports a pricing update; this reported context does not establish causation or replace measured evidence.";
  }
}
assert.equal(validateIntelligenceBriefingOutput(contextualOutput, contextual).ok, true, "attributed, explicitly non-causal Business Note context passes");
const unboundedContext = clone(contextualOutput);
const contextClaim = unboundedContext.sections.find((section) => section.section_id === "business_updates_context").claims[0];
contextClaim.text = "A pricing update happened during the period and warrants leadership review.";
assert.equal(validateIntelligenceBriefingOutput(unboundedContext, contextual).ok, false, "Business Note context without attribution and a non-causal boundary fails closed");

const artifact = {
  contractId: limited.contractId,
  contractVersion: limited.contractVersion,
  schemaVersion: limited.schemaVersion,
  validatorVersion: limited.validatorVersion,
  promptVersion: limited.promptVersion,
  generationPolicyVersion: limited.generationPolicyVersion,
  materialityVersion: limited.materialityVersion,
  workspaceId: "11111111-1111-4111-8111-111111111111",
  briefingType: "monthly",
  period: limited.period,
  eligibility: "limited",
  confidence: limited.confidence,
  evidenceCoverage: limited.evidenceCoverage,
  evidenceFingerprint: limited.evidenceFingerprint,
  effectiveEvidenceFingerprint: limited.effectiveEvidenceFingerprint,
  materialStateFingerprint: limited.materialStateFingerprint,
  generationKey: limited.generationKey,
  snapshotFingerprint: limited.snapshotFingerprint,
  generatedAt: asOf,
  businessHealth: limited.businessHealth,
  analysis: valid,
  sections: limited.sections,
  signals: limited.signals,
  limitations: limited.limitations,
  citations: limited.citations,
  contextReferences: limited.contextReferences,
  providerAttribution: { provider: "openai", model: "gpt-5.6-sol", fallbackUsed: false, providerPolicyId: INTELLIGENCE_BRIEFING_GPT56_POLICY_ID },
  provenance: { snapshotContract: "intelligence_snapshot_v1", snapshotFingerprint: limited.snapshotFingerprint, evidenceManifestId: limited.manifest.manifestId, previousBriefingRunId: null }
};
assert.ok(parseIntelligenceBriefingArtifact(artifact), "a complete immutable artifact round-trips through strict storage validation");
assert.equal(parseIntelligenceBriefingArtifact({ ...artifact, workspaceId: "foreign-workspace" }), null, "stored artifacts reject invalid workspace identity");
assert.equal(parseIntelligenceBriefingArtifact({ ...artifact, providerAttribution: { ...artifact.providerAttribution, provider: "nvidia" } }), null, "briefing storage cannot switch to NVIDIA");

const previous = { runId: "11111111-1111-4111-8111-111111111111", artifact };
assert.equal(briefingStateFromPackage({ briefingPackage: identical, current: previous }).status, "current");
assert.equal(briefingStateFromPackage({ briefingPackage: citationOnly, current: previous }).status, "unchanged");
assert.equal(briefingStateFromPackage({ briefingPackage: changed, current: previous }).status, "ready");

const originalSelector = process.env.VAEROEX_INTELLIGENCE_BRIEFING_POLICY;
process.env.VAEROEX_INTELLIGENCE_BRIEFING_POLICY = INTELLIGENCE_BRIEFING_POLICY_SELECTOR;
const policy = resolveIntelligenceBriefingGenerationPolicy({
  startedAtMs: Date.now(),
  structuredOutput: { name: "intelligence_briefing_v1", strict: true, schema: { type: "object" } }
});
assert.equal(policy.providerPolicy.id, INTELLIGENCE_BRIEFING_GPT56_POLICY_ID);
assert.deepEqual(policy.providerPolicy.steps.map((step) => [step.provider, step.model, step.workflowConfiguration.reasoning.effort]), [
  ["openai", "gpt-5.6-sol", "medium"],
  ["openai", "gpt-5.6-terra", "medium"]
]);
assert.ok(policy.providerPolicy.steps.every((step) => step.workflowConfiguration.maxAttempts === 1 && step.workflowConfiguration.store === false));
if (originalSelector === undefined) delete process.env.VAEROEX_INTELLIGENCE_BRIEFING_POLICY;
else process.env.VAEROEX_INTELLIGENCE_BRIEFING_POLICY = originalSelector;

const action = read("app/app/intelligence/briefings/actions.ts");
const claim = read("lib/ai/intelligence-briefing/generation-claim.ts");
const migration = read("supabase/migrations/20260817185529_intelligence_briefing_storage_contract.sql");
const viewer = read("components/intelligence/IntelligenceBriefingViewer.tsx");
const cards = read("components/intelligence/IntelligenceBriefingCards.tsx");
const intelligencePage = read("app/app/intelligence/page.tsx");
const briefingPage = read("app/app/intelligence/briefings/page.tsx");
assert.match(action, /buildWorkspaceIntelligenceBriefingPackage/);
assert.doesNotMatch(action, /workspaceId:\s*input|evidence:\s*input|snapshot:\s*input/, "client input cannot supply workspace or evidence authority");
assert.match(action, /intelligenceBriefingStateAllowsGeneration\(state\)/, "the provider path must use the typed briefing-state eligibility guard");
assert.ok(
  action.indexOf("intelligenceBriefingStateAllowsGeneration(state)") >= 0
    && action.indexOf("intelligenceBriefingStateAllowsGeneration(state)") < action.indexOf("generateIntelligenceBriefing({"),
  "eligibility and materiality must run before provider execution"
);
assert.match(claim, /insertError\?\.code !== "23505"/);
assert.match(migration, /create unique index if not exists ai_agent_runs_intelligence_briefing_generation_claim_uidx/);
assert.match(migration, /status in \('processing', 'completed'\)/);
assert.match(migration, /ai_agent_runs_intelligence_briefing_evidence_period_idx/);
assert.match(viewer, /SaveAnalysisButton/);
assert.match(viewer, /Supporting evidence/);
assert.match(viewer, /Evidence, confidence & limitations/);
assert.match(viewer, /Limited-evidence briefing/);
assert.match(viewer, /Approved reported context/);
assert.match(cards, /Generate Weekly Briefing/);
assert.match(cards, /Generate Monthly Briefing/);
assert.match(cards, /Add business information/);
assert.match(cards, /Last 7 days/);
assert.match(cards, /Last 30 days/);
assert.match(cards, /View Current Briefing/);
assert.match(cards, /Generation unavailable/);
assert.match(cards, /Evidence verification unavailable/);
assert.match(cards, /No eligible evidence/);
assert.match(cards, /Limited evidence/);
assert.match(cards, /Ready to generate/);
assert.match(cards, /Generating/);
assert.match(cards, /No new information/);
assert.match(cards, /No significant change/);
assert.match(cards, /Generation failed/);
assert.match(cards, /disabled=\{!canGenerate \|\| pending\}/, "generation remains visibly disabled when the server policy is off");
assert.match(cards, /generateIntelligenceBriefingAction\(\{ briefingType: type \}\)/, "enabled controls reach the authenticated server action");
assert.doesNotMatch(cards, /VAEROEX_INTELLIGENCE_BRIEFING_POLICY|gpt-5\.6|provider policy/, "customer UI must not expose provider configuration");
assert.match(intelligencePage, /import \{ IntelligenceBriefingCards \}/);
assert.match(intelligencePage, /<h2 id="intelligence-briefings-heading"[^>]*>Intelligence Briefings<\/h2>/);
assert.match(intelligencePage, /<IntelligenceBriefingCards[\s\S]*states=\{briefingStates\}[\s\S]*generationEnabled=\{isIntelligenceBriefingEnabled\(\)\}/, "the main Intelligence route must mount briefing cards without a feature-gate conditional");
assert.doesNotMatch(intelligencePage, /isIntelligenceBriefingEnabled\(\)\s*&&\s*<IntelligenceBriefingCards/, "the default-off policy must not hide the interface");
assert.match(briefingPage, /<IntelligenceBriefingCards[\s\S]*generationEnabled=\{isIntelligenceBriefingEnabled\(\)\}/, "the dedicated briefing route must preserve visible disabled-state behavior");
assert.doesNotMatch(`${action}\n${viewer}`, /app\/briefings|executive_brief/);

console.log("Intelligence Briefing regressions passed.");
