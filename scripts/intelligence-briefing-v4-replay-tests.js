const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

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

const {
  INTELLIGENCE_BRIEFING_CLAIM_ACCEPTANCE_VERSION,
  INTELLIGENCE_BRIEFING_CONTRACT_ID,
  INTELLIGENCE_BRIEFING_CONTRACT_VERSION,
  INTELLIGENCE_BRIEFING_FILTERED_CONTENT_LIMITATION,
  INTELLIGENCE_BRIEFING_DEFAULT_LOCALE,
  INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION,
  INTELLIGENCE_BRIEFING_MATERIALITY_VERSION,
  INTELLIGENCE_BRIEFING_MINIMUM_MEASURED_CLAIMS,
  INTELLIGENCE_BRIEFING_PROMPT_VERSION,
  INTELLIGENCE_BRIEFING_PLAIN_LANGUAGE_VERSION,
  INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
  INTELLIGENCE_BRIEFING_VALIDATOR_VERSION
} = require("../lib/ai/intelligence-briefing/contracts.ts");
const {
  filterIntelligenceBriefingPackageForAcceptedCandidate
} = require("../lib/ai/intelligence-briefing/service.ts");
const { parseIntelligenceBriefingArtifact } = require("../lib/ai/intelligence-briefing/storage.ts");
const { validateIntelligenceBriefingOutput } = require("../lib/ai/intelligence-briefing/validation.ts");
const { runStructuredAI, AIProviderExecutionError } = require("../lib/ai/providers/provider-manager.ts");

const workspaceId = "11111111-1111-4111-8111-111111111111";
const hash = "a".repeat(64);
const snapshotHash = `sha256:${"b".repeat(64)}`;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function signal(ref, sectionId, authority, fact, citationIds, kind = "kpi") {
  return {
    ref,
    stableKey: "c".repeat(64),
    kind,
    authority,
    sectionId,
    label: `Signal ${ref}`,
    fact,
    confidence: "Medium",
    citationIds,
    evidenceReferenceIds: citationIds.map((id) => `evidence-${id}`),
    limitation: null,
    periodRelation: authority === "reported_context" ? "reported_context" : "new_or_changed",
    periodContext: "briefing_period"
  };
}

function briefingPackage(eligibility = "limited") {
  const signals = [
    signal("K1", "customers_market", "measured_evidence", "Customer retention was 91%.", [1]),
    signal("K2", "customers_market", "measured_evidence", "Market demand was 12%.", [2]),
    signal("K3", "customers_market", "measured_evidence", "Customer churn was 5%.", [3]),
    signal("F1", "operations_delivery", "deterministic_result", "On-time delivery was 88%.", [4], "finding"),
    signal("R1", "customers_market", "deterministic_result", "Customer retention of 91% was higher than market demand of 12%.", [5], "finding"),
    signal("N1", "business_updates_context", "reported_context", "Leadership reported a pricing review during the period.", [], "reported_context")
  ];
  return {
    contractId: INTELLIGENCE_BRIEFING_CONTRACT_ID,
    contractVersion: INTELLIGENCE_BRIEFING_CONTRACT_VERSION,
    schemaVersion: INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
    validatorVersion: INTELLIGENCE_BRIEFING_VALIDATOR_VERSION,
    promptVersion: INTELLIGENCE_BRIEFING_PROMPT_VERSION,
    generationPolicyVersion: INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION,
    materialityVersion: INTELLIGENCE_BRIEFING_MATERIALITY_VERSION,
    language: { locale: INTELLIGENCE_BRIEFING_DEFAULT_LOCALE, standardVersion: INTELLIGENCE_BRIEFING_PLAIN_LANGUAGE_VERSION },
    workspaceId,
    briefingType: "monthly",
    period: { start: "2026-07-20", end: "2026-08-18", cutoff: "2026-08-18T12:00:00.000Z", dayCount: 30, timeZone: "UTC" },
    eligibility,
    confidence: "Medium",
    evidenceCoverage: {
      supportingRecordCount: 5,
      independentSourceCount: eligibility === "sufficient" ? 2 : 1,
      freshness: "current",
      latestEvidenceAt: "2026-08-18T10:00:00.000Z",
      overallCoverage: eligibility === "sufficient" ? 80 : 40,
      coverageLabel: eligibility === "sufficient" ? "Good" : "Limited",
      includedDomains: ["Customers & Market", "Operations & Delivery"],
      missingOrWeakDomains: ["Workforce"]
    },
    evidenceFingerprint: hash,
    effectiveEvidenceFingerprint: hash,
    materialStateFingerprint: hash,
    generationKey: hash,
    snapshotFingerprint: snapshotHash,
    businessHealth: { available: false, score: null, status: "Unavailable", trajectory: null, confidence: "Low" },
    signals,
    sections: [
      { id: "customers_market", label: "Customers & Market", signalRefs: ["K1", "K2", "K3", "R1"] },
      { id: "operations_delivery", label: "Operations & Delivery", signalRefs: ["F1"] },
      { id: "business_updates_context", label: "Business Updates", signalRefs: ["N1"] }
    ],
    contextReferences: [{
      ref: "N1",
      sourceNoteId: "22222222-2222-4222-8222-222222222222",
      sourceVersion: 1,
      title: "Pricing review",
      summary: "Leadership reported a pricing review.",
      approvedAt: "2026-08-18T09:00:00.000Z",
      observedAt: "2026-08-18",
      applicabilityStart: "2026-08-18",
      applicabilityEnd: null
    }],
    limitations: [{ ref: "L1", text: "Evidence coverage is limited." }],
    manifest: { manifestId: hash, workspaceId },
    citations: [1, 2, 3, 4, 5].map((id) => ({
      citationId: id,
      title: `Evidence ${id}`,
      sourceLabel: `Source ${id}`,
      sourceType: "Business evidence",
      excerpt: `Eligible evidence ${id}`,
      recordedAt: "2026-08-18T10:00:00.000Z",
      href: "/app/sources"
    })),
    requiredSignalRefs: ["K1", "F1"],
    previousBriefing: null,
    trustBinding: { snapshotFingerprint: snapshotHash, projectionFingerprint: hash }
  };
}

const claims = {
  k1: { text: "Customer retention was 91% in the cited measured evidence for this reporting period.", support_refs: ["K1"] },
  k2: { text: "Market demand was 12% in the cited measured evidence for this reporting period.", support_refs: ["K2"] },
  f1: { text: "On-time delivery was 88% in the cited business evidence for this reporting period.", support_refs: ["F1"] },
  causal: { text: "Customer churn of 5% caused the customer retention result during this reporting period.", support_refs: ["K3"] },
  comparison: { text: "Market demand was 12% higher than customer retention during this reporting period.", support_refs: ["K2"] },
  relationship: { text: "Customer retention of 91% was higher than market demand of 12%.", support_refs: ["R1"] },
  context: { text: "An approved Business Note reports a pricing review. This reported context does not establish causation.", support_refs: ["N1"] },
  contextCausal: { text: "An approved Business Note reports a pricing review that drove customer retention of 91%.", support_refs: ["N1"] },
  leadership: { text: "Review customer retention using the available measured evidence.", support_refs: ["K1"] }
};

function candidate({
  customerSummary = claims.k1,
  customerClaims = [claims.k2],
  operation = true,
  context = false,
  executive = claims.k1,
  leadership = [claims.leadership]
} = {}) {
  const sections = [{
    section_id: "customers_market",
    summary: customerSummary.text,
    support_refs: customerSummary.support_refs,
    claims: customerClaims
  }];
  if (operation) {
    sections.push({
      section_id: "operations_delivery",
      summary: claims.f1.text,
      support_refs: claims.f1.support_refs,
      claims: [claims.f1]
    });
  }
  if (context) {
    sections.push({
      section_id: "business_updates_context",
      summary: claims.context.text,
      support_refs: claims.context.support_refs,
      claims: [claims.context]
    });
  }
  return {
    executive_summary: { text: executive.text, support_refs: executive.support_refs },
    sections,
    leadership_considerations: leadership,
    limitation_refs: ["L1"]
  };
}

function accepted(value, context = briefingPackage("limited")) {
  const result = validateIntelligenceBriefingOutput(value, context);
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  return result.value;
}

function insufficient(value, context) {
  const result = validateIntelligenceBriefingOutput(value, context);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostic?.reasonCode, "missing_required_signal");
  return result;
}

function invalidOnlyCandidate() {
  return candidate({
    customerSummary: claims.causal,
    customerClaims: [claims.comparison],
    operation: false,
    executive: claims.causal,
    leadership: [claims.contextCausal]
  });
}

function providerResult(value, model) {
  return {
    content: JSON.stringify(value),
    requestId: `request-${model}`,
    latencyMs: 5,
    usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200, cachedInputTokens: 0, reasoningTokens: 0 },
    finishReason: "stop",
    truncationDetected: false,
    runtimeModel: model
  };
}

class QueuedProvider {
  constructor(values) {
    this.name = "openai";
    this.supportsAttachments = true;
    this.values = [...values];
    this.calls = [];
  }
  isConfigured() { return true; }
  async generate(request) {
    this.calls.push(request.model);
    const value = this.values.shift();
    if (!value) throw new Error("Unexpected provider invocation.");
    return providerResult(value, request.model);
  }
}

async function route(values, context = briefingPackage("limited")) {
  const provider = new QueuedProvider(values);
  const result = await runStructuredAI({
    primaryProvider: "openai",
    primaryModel: "gpt-5.6-sol",
    fallbackModel: "gpt-5.6-terra",
    providerPolicy: {
      id: "v4-replay",
      fallbackOn: ["missing_required_signal", "schema_failure", "malformed_response", "unsupported_relationship"],
      steps: [
        { provider: "openai", model: "gpt-5.6-sol", workflowConfiguration: { maxAttempts: 1 } },
        { provider: "openai", model: "gpt-5.6-terra", workflowConfiguration: { maxAttempts: 1 } }
      ]
    },
    systemPrompt: "offline deterministic replay",
    userContent: [{ type: "text", text: "sanitized fixture" }],
    settings: { timeoutMs: 1_000, maxRetries: 0, retryBaseDelayMs: 1 },
    validate: (value) => validateIntelligenceBriefingOutput(value, context),
    providers: { openai: provider, nvidia: provider }
  });
  return { result, provider };
}

(async () => {
  assert.deepEqual(INTELLIGENCE_BRIEFING_MINIMUM_MEASURED_CLAIMS, { limited: 1, sufficient: 2 });

  const fullCandidate = candidate({ context: true });
  const fullyAccepted = accepted(fullCandidate, briefingPackage("sufficient"));
  assert.deepEqual(fullyAccepted.analysis, fullCandidate, "1. a fully valid provider candidate is preserved exactly");

  const unsupportedCausalText = claims.causal.text;
  const filtered = accepted(candidate({ customerClaims: [claims.k2, claims.causal] }));
  assert.equal(JSON.stringify(filtered.analysis).includes(unsupportedCausalText), false, "2. an isolated unsupported causal claim is excluded");
  assert.ok(filtered.acceptance.rejectedClaimCount >= 1);

  const oneValidOneBad = candidate({
    customerClaims: [claims.comparison],
    operation: false,
    executive: claims.causal,
    leadership: [claims.contextCausal]
  });
  assert.equal(accepted(oneValidOneBad, briefingPackage("limited")).acceptance.acceptedMeasuredClaimCount, 1, "3. limited evidence accepts one valid measured claim");
  insufficient(oneValidOneBad, briefingPackage("sufficient"));

  insufficient(invalidOnlyCandidate(), briefingPackage("limited"));

  const solViable = await route([candidate({ customerClaims: [claims.k2, claims.causal] })]);
  assert.deepEqual(solViable.provider.calls, ["gpt-5.6-sol"], "5. viable filtered Sol output prevents Terra invocation");
  assert.equal(solViable.result.fallbackUsed, false);

  const terraFallback = await route([invalidOnlyCandidate(), candidate()]);
  assert.deepEqual(terraFallback.provider.calls, ["gpt-5.6-sol", "gpt-5.6-terra"], "6. insufficient Sol invokes Terra exactly once");
  assert.equal(terraFallback.result.fallbackUsed, true);

  const bothInsufficientProvider = new QueuedProvider([invalidOnlyCandidate(), invalidOnlyCandidate()]);
  let bothError;
  try {
    await runStructuredAI({
      primaryProvider: "openai",
      primaryModel: "gpt-5.6-sol",
      fallbackModel: "gpt-5.6-terra",
      providerPolicy: {
        id: "v4-both-insufficient",
        fallbackOn: ["missing_required_signal"],
        steps: [
          { provider: "openai", model: "gpt-5.6-sol", workflowConfiguration: { maxAttempts: 1 } },
          { provider: "openai", model: "gpt-5.6-terra", workflowConfiguration: { maxAttempts: 1 } }
        ]
      },
      systemPrompt: "offline deterministic replay",
      userContent: [{ type: "text", text: "sanitized fixture" }],
      settings: { timeoutMs: 1_000, maxRetries: 0, retryBaseDelayMs: 1 },
      validate: (value) => validateIntelligenceBriefingOutput(value, briefingPackage("limited")),
      providers: { openai: bothInsufficientProvider, nvidia: bothInsufficientProvider }
    });
  } catch (error) {
    bothError = error;
  }
  assert.ok(bothError instanceof AIProviderExecutionError, "7. two insufficient candidates fail closed");
  assert.equal(bothError.attempts.length, 2);

  const crossClaimNumber = { text: "Customer retention was 12% in the cited measured evidence for this period.", support_refs: ["K1"] };
  const numericFiltered = accepted(candidate({ customerClaims: [crossClaimNumber], operation: false }));
  assert.equal(JSON.stringify(numericFiltered.analysis).includes(crossClaimNumber.text), false, "8. a number supported only by another claim is rejected");

  const combinedRelationship = {
    text: "Customer retention was 91% higher than market demand of 12% during this period.",
    support_refs: ["K1", "K2"]
  };
  const relationshipFiltered = accepted(candidate({ customerClaims: [combinedRelationship], operation: false }));
  assert.equal(JSON.stringify(relationshipFiltered.analysis).includes(combinedRelationship.text), false, "9. separately supported facts do not authorize a relationship");

  const canonicalRelationship = accepted(candidate({ customerClaims: [claims.relationship], operation: false }));
  assert.ok(JSON.stringify(canonicalRelationship.analysis).includes(claims.relationship.text), "10. exact canonical relationship support is accepted");

  const contextAccepted = accepted(candidate({ context: true }));
  assert.ok(JSON.stringify(contextAccepted.analysis).includes(claims.context.text), "11. neutrally attributed Business Note context is accepted");

  const contextRejected = accepted(candidate({
    context: true,
    leadership: [claims.contextCausal]
  }));
  assert.equal(JSON.stringify(contextRejected.analysis).includes(claims.contextCausal.text), false, "12. Business Notes cannot authorize KPI causation");

  const onlyBadContext = clone(candidate());
  onlyBadContext.sections.push({
    section_id: "business_updates_context",
    summary: claims.contextCausal.text,
    support_refs: claims.contextCausal.support_refs,
    claims: [claims.contextCausal]
  });
  const omittedContext = accepted(onlyBadContext);
  assert.equal(omittedContext.analysis.sections.some((section) => section.section_id === "business_updates_context"), false, "13. empty sections are omitted after filtering");

  const badSummary = { text: "Customer churn of 5% caused all current business performance outcomes in this reporting period.", support_refs: ["K3"] };
  const summaryDerived = accepted(candidate({ executive: badSummary }));
  assert.equal(summaryDerived.analysis.executive_summary.text, claims.k1.text, "14. the summary is assembled only from an accepted claim without rewriting it");

  const projected = filterIntelligenceBriefingPackageForAcceptedCandidate(briefingPackage("limited"), filtered);
  const acceptedSurface = JSON.stringify({ analysis: filtered.analysis, ...projected });
  assert.equal(acceptedSurface.includes(unsupportedCausalText), false, "15. rejected prose cannot leak into artifacts or Saved Briefing inputs");
  assert.equal(projected.signals.some((entry) => entry.ref === "K3"), false, "rejected-only signals and citations are removed");
  assert.ok(projected.limitations.some((limitation) => limitation.text === INTELLIGENCE_BRIEFING_FILTERED_CONTENT_LIMITATION));

  const minimalLimited = accepted(oneValidOneBad, briefingPackage("limited"));
  assert.equal(minimalLimited.analysis.sections.length, 1, "16. limited evidence produces a narrow artifact with its one validated measured claim");

  const hiddenTrendPackage = briefingPackage("limited");
  hiddenTrendPackage.signals.find((entry) => entry.ref === "K1").fact = "Customer retention increased from 90% to 91% across two recorded dates.";
  const hiddenTrend = { text: "Customer retention increased from 90% to 91% across two recorded dates during this briefing period.", support_refs: ["K1"] };
  const visibleClaim = { text: "Market demand was 12% in the cited measured evidence for this reporting period.", support_refs: ["K2"] };
  const boundedTrend = accepted(candidate({
    customerSummary: hiddenTrend,
    customerClaims: [visibleClaim],
    operation: false,
    executive: visibleClaim,
    leadership: [{ text: "Review market demand using the available measured evidence.", support_refs: ["K2"] }]
  }), hiddenTrendPackage);
  assert.equal(JSON.stringify(boundedTrend.analysis).includes(hiddenTrend.text), false, "trend wording cannot exceed visible temporal citation lineage");

  assert.equal(INTELLIGENCE_BRIEFING_PROMPT_VERSION, "intelligence_briefing_prompt_v5");
  assert.equal(INTELLIGENCE_BRIEFING_VALIDATOR_VERSION, "intelligence_briefing_validator_v5");
  assert.equal(INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION, "intelligence_briefing_generation_policy_v5");
  assert.equal(INTELLIGENCE_BRIEFING_CLAIM_ACCEPTANCE_VERSION, "intelligence_briefing_claim_acceptance_v1");

  const artifact = {
    contractId: INTELLIGENCE_BRIEFING_CONTRACT_ID,
    contractVersion: INTELLIGENCE_BRIEFING_CONTRACT_VERSION,
    schemaVersion: INTELLIGENCE_BRIEFING_SCHEMA_VERSION,
    validatorVersion: INTELLIGENCE_BRIEFING_VALIDATOR_VERSION,
    promptVersion: INTELLIGENCE_BRIEFING_PROMPT_VERSION,
    generationPolicyVersion: INTELLIGENCE_BRIEFING_GENERATION_POLICY_VERSION,
    materialityVersion: INTELLIGENCE_BRIEFING_MATERIALITY_VERSION,
    language: briefingPackage().language,
    workspaceId,
    briefingType: "monthly",
    period: briefingPackage().period,
    eligibility: "limited",
    confidence: "Medium",
    evidenceCoverage: briefingPackage().evidenceCoverage,
    evidenceFingerprint: hash,
    effectiveEvidenceFingerprint: hash,
    materialStateFingerprint: hash,
    generationKey: hash,
    snapshotFingerprint: snapshotHash,
    generatedAt: "2026-08-18T12:05:00.000Z",
    businessHealth: briefingPackage().businessHealth,
    analysis: filtered.analysis,
    ...projected,
    providerAttribution: { provider: "openai", model: "gpt-5.6-sol", fallbackUsed: false, providerPolicyId: "gpt56_sol_terra_v1" },
    provenance: {
      snapshotContract: "intelligence_snapshot_v1",
      snapshotFingerprint: snapshotHash,
      evidenceManifestId: hash,
      previousBriefingRunId: null,
      claimAcceptance: { ...filtered.acceptance, providerModel: "gpt-5.6-sol" }
    }
  };
  assert.ok(parseIntelligenceBriefingArtifact(artifact), "17. the filtered V4 artifact remains valid for immutable current and Saved Briefing storage");
  const legacyArtifact = clone(artifact);
  delete legacyArtifact.language;
  legacyArtifact.promptVersion = "intelligence_briefing_prompt_v4";
  legacyArtifact.validatorVersion = "intelligence_briefing_validator_v4";
  legacyArtifact.generationPolicyVersion = "intelligence_briefing_generation_policy_v4";
  legacyArtifact.provenance.claimAcceptance.promptVersion = legacyArtifact.promptVersion;
  legacyArtifact.provenance.claimAcceptance.validatorVersion = legacyArtifact.validatorVersion;
  legacyArtifact.provenance.claimAcceptance.generationPolicyVersion = legacyArtifact.generationPolicyVersion;
  legacyArtifact.signals.forEach((entry) => {
    delete entry.periodContext;
    delete entry.temporalLineage;
  });
  const immutableLegacyInput = clone(legacyArtifact);
  assert.ok(parseIntelligenceBriefingArtifact(legacyArtifact), "stored V4 artifacts remain readable after the V5 plain-language presentation upgrade");
  assert.deepEqual(legacyArtifact, immutableLegacyInput, "parsing and presentation compatibility never rewrites an existing Saved Briefing artifact");

  for (let index = 1; index <= 100; index += 1) {
    const propertyPackage = briefingPackage("limited");
    propertyPackage.signals.find((entry) => entry.ref === "K1").fact = `Customer retention was ${index}%.`;
    const supported = { text: `Customer retention was ${index}% in the cited measured evidence for this reporting period.`, support_refs: ["K1"] };
    const unsupported = { text: `Customer retention was ${index + 100}% in the cited measured evidence for this reporting period.`, support_refs: ["K1"] };
    const propertyResult = accepted(candidate({ customerSummary: supported, customerClaims: [unsupported], operation: false, executive: supported }), propertyPackage);
    assert.ok(JSON.stringify(propertyResult.analysis).includes(supported.text));
    assert.equal(JSON.stringify(propertyResult.analysis).includes(unsupported.text), false);
  }

  for (const phrase of ["caused", "correlated with", "higher than", "offset", "explains"]) {
    const unsupported = { text: `Customer retention of 91% ${phrase} market demand of 12% during this period.`, support_refs: ["K1", "K2"] };
    const result = accepted(candidate({ customerClaims: [unsupported], operation: false }));
    assert.equal(JSON.stringify(result.analysis).includes(unsupported.text), false, `unsupported ${phrase} relationships remain excluded`);
  }

  console.log("Intelligence Briefing V4 deterministic replay/property regressions passed (17 cases + 105 property cases). ");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
