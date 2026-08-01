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
  if (request === "server-only") return request;
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};
require.cache["server-only"] = { id: "server-only", filename: "server-only", loaded: true, exports: {} };

const {
  BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION
} = require("../lib/ai/business-notes/contracts.ts");
const {
  buildBusinessNoteContextRecordV1
} = require("../lib/ai/business-notes/contextual-contract.ts");
const {
  collapseBusinessNoteKnowledgeRows
} = require("../lib/ai/business-notes/knowledge-projection.ts");
const {
  loadApprovedBusinessNoteContextV1
} = require("../lib/ai/business-notes/contextual-evidence.ts");
const {
  validateBusinessNoteExtraction
} = require("../lib/ai/business-notes/validation.ts");
const {
  businessHealthExplanationSystemPrompt,
  businessHealthProviderRequestPayload
} = require("../lib/ai/business-health-explanation/service.ts");
const {
  validateBusinessHealthExplanationOutput
} = require("../lib/ai/business-health-explanation/validation.ts");
const {
  buildBusinessHealthExplanationFromSnapshotV1
} = require("../lib/ai/business-health-explanation/snapshot-context.ts");
const {
  findingExplanationModelInput,
  findingExplanationSystemPrompt
} = require("../lib/ai/finding-explanation/service.ts");
const {
  validateFindingExplanationOutput
} = require("../lib/ai/finding-explanation/validation.ts");
const {
  buildFindingExplanationFromSnapshotV1
} = require("../lib/ai/finding-explanation/snapshot-context.ts");
const contract = require("../lib/intelligence/snapshot/v1/index.ts");
const { snapshotHash } = require("../lib/intelligence/snapshot/v1/canonical.ts");
const {
  buildIntelligenceSnapshotFromProducersV1
} = require("../lib/intelligence/snapshot/v1/composition.ts");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const originalNote = "Average Checkout Wait rose to 6.2 minutes during the warehouse move. Management expects the disruption to be temporary.";
const extraction = {
  schemaVersion: BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION,
  extractionDisposition: "extractable",
  title: "Temporary warehouse move disruption",
  summary: "Average Checkout Wait rose to 6.2 minutes during the warehouse move.",
  noteType: "observation",
  sourceClassification: "manager_observation",
  departments: ["Operations"],
  topics: ["Average Checkout Wait", "warehouse move"],
  peopleMentioned: [],
  customersMentioned: [],
  vendorsMentioned: [],
  projectsMentioned: [{ name: "warehouse move", sourceQuote: "warehouse move" }],
  explicitFacts: [{
    statement: "Average Checkout Wait rose to 6.2 minutes during the warehouse move.",
    sourceQuote: "Average Checkout Wait rose to 6.2 minutes during the warehouse move.",
    confidence: 0.96
  }],
  opinionsOrAssumptions: [{
    statement: "Management expects the disruption to be temporary.",
    sourceQuote: "Management expects the disruption to be temporary.",
    confidence: 0.78
  }],
  risks: [],
  opportunities: [],
  decisions: [],
  mentionedMetrics: [{
    name: "Average Checkout Wait",
    value: 6.2,
    unit: "minutes",
    sourceQuote: "Average Checkout Wait rose to 6.2 minutes during the warehouse move.",
    confidence: 0.96
  }],
  reportingPeriod: { start: "2026-07-01", end: null, inferred: false, sourceQuote: "during the warehouse move" },
  evidenceTreatment: "context_only",
  extractionConfidence: 0.91,
  missingContext: []
};

const validated = validateBusinessNoteExtraction(extraction, originalNote);
assert.equal(validated.ok, true, validated.ok ? "" : validated.reason);

function note(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
    source_version: 1,
    source_text_hash: "a".repeat(64),
    release_channel: "preview",
    evidence_lifecycle_status: "active",
    status: "approved",
    deleted_at: null,
    archived_at: null,
    user_observation_date: "2026-07-20",
    user_reporting_period_start: null,
    user_reporting_period_end: null,
    extraction_version: "business_note_extraction_v1",
    validator_version: "business_note_extraction_validator_v2",
    policy_version: "business_note_gpt56_luna_terra_v2",
    provider_name: "openai",
    model_used: "gpt-5.6-luna",
    fallback_used: false,
    approved_at: "2026-07-20T12:00:00.000Z",
    ...overrides
  };
}

const userAddedContext = [{
  field: "location",
  label: "Location",
  value: "North warehouse",
  provenance: "supplied_during_review",
  userProvided: true,
  partOfOriginalNoteQuotation: false,
  evidenceTreatment: "contextual_metadata"
}];
const contextRecord = buildBusinessNoteContextRecordV1({
  note: note(),
  extraction: validated.value,
  userAddedContext,
  reviewedExtractionHash: snapshotHash(validated.value),
  evaluationDate: contract.FOUNDATION_FIXTURE_EVALUATION_DATE
});
assert.ok(contextRecord, "approved, active, unexpired context must produce a structured record");
assert.equal(contextRecord.authorityRole, "supporting_context");
assert.equal(contextRecord.originalEvidenceEligible, false);
assert.equal(contextRecord.validationState, "approved_review");
assert.equal(contextRecord.userAddedContext[0].partOfOriginalNoteQuotation, false);
assert.equal(contextRecord.statements[0].sourceQuote, extraction.explicitFacts[0].sourceQuote);
assert.equal(contextRecord.provenance.extractionVersion, "business_note_extraction_v1");

function memoryChunk(overrides = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    workspace_id: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
    source_type: "business_note",
    source_id: note().id,
    source_title: extraction.title,
    source_excerpt: "Business Note retrieval chunk",
    summary: extraction.summary,
    chunk_index: 0,
    indexed_at: "2026-07-20T12:01:00.000Z",
    created_at: "2026-07-20T12:01:00.000Z",
    updated_at: "2026-07-20T12:01:00.000Z",
    archived_at: null,
    deleted_at: null,
    ...overrides
  };
}

const repeatedNoteChunks = [
  memoryChunk({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    chunk_index: 1,
    source_excerpt: "Second retrieval chunk"
  }),
  memoryChunk()
];
const projectedKnowledge = collapseBusinessNoteKnowledgeRows(repeatedNoteChunks);
assert.equal(projectedKnowledge.length, 1, "one Business Note must render as one Learned Knowledge record regardless of chunk count");
assert.equal(projectedKnowledge[0].chunk_index, 0, "the canonical first chunk must represent a Business Note in Learned Knowledge");
assert.equal(repeatedNoteChunks.length, 2, "the display projection must not mutate or delete persisted retrieval chunks");

const secondNoteId = "22222222-2222-4222-8222-222222222222";
assert.equal(collapseBusinessNoteKnowledgeRows([
  ...repeatedNoteChunks,
  memoryChunk({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", source_id: secondNoteId })
]).length, 2, "distinct Business Notes must remain distinct Learned Knowledge records");
assert.equal(collapseBusinessNoteKnowledgeRows([
  memoryChunk({ source_type: "file_upload", source_id: "file-1", chunk_index: 0 }),
  memoryChunk({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", source_type: "file_upload", source_id: "file-1", chunk_index: 1 })
]).length, 2, "non-Business-Note retrieval chunks must preserve their existing presentation");

function queryResult(result) {
  const query = {
    select: () => query,
    eq: () => query,
    is: () => query,
    lte: () => query,
    order: () => query,
    limit: () => query,
    in: () => query,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject)
  };
  return query;
}

async function assertContextLoaderIdempotency() {
  const approvedNote = note({
    original_note_text: originalNote,
    extraction_json: validated.value,
    reviewed_extraction_json: validated.value,
    user_corrections_json: { userAddedContext }
  });
  const supabase = {
    from(table) {
      if (table === "business_notes") return queryResult({ data: [approvedNote], error: null });
      if (table === "business_memory_chunks") {
        return queryResult({
          data: [{ source_id: approvedNote.id }, { source_id: approvedNote.id }],
          error: null
        });
      }
      throw new Error(`Unexpected table ${table}`);
    }
  };
  const loaded = await loadApprovedBusinessNoteContextV1({
    supabase,
    workspaceId: approvedNote.workspace_id,
    releaseChannel: approvedNote.release_channel,
    asOf: "2026-07-20T13:00:00.000Z"
  });
  assert.equal(loaded.error, null);
  assert.equal(loaded.records.length, 1, "multiple indexed chunks must produce one BusinessNoteContextRecordV1");
  assert.equal(loaded.records[0].sourceNoteId, approvedNote.id);
}

assert.equal(buildBusinessNoteContextRecordV1({
  note: note({ status: "review_required" }),
  extraction: validated.value,
  userAddedContext: [],
  reviewedExtractionHash: snapshotHash(validated.value),
  evaluationDate: contract.FOUNDATION_FIXTURE_EVALUATION_DATE
}), null, "unapproved notes must fail closed");
assert.equal(buildBusinessNoteContextRecordV1({
  note: note({ user_reporting_period_end: "2026-07-01" }),
  extraction: validated.value,
  userAddedContext: [],
  reviewedExtractionHash: snapshotHash(validated.value),
  evaluationDate: contract.FOUNDATION_FIXTURE_EVALUATION_DATE
}), null, "expired context must not enter a later snapshot");

const revenueRecord = {
  ...contextRecord,
  id: "business-note-context:22222222-2222-4222-8222-222222222222:v1",
  sourceNoteId: "22222222-2222-4222-8222-222222222222",
  title: "Marketing pause",
  summary: "Management reported that the July marketing campaign was intentionally paused.",
  topics: ["Revenue", "marketing"],
  statements: [{
    id: "22222222-2222-4222-8222-222222222222:reported_decision:1",
    kind: "reported_decision",
    text: "The July marketing campaign was intentionally paused.",
    sourceQuote: "marketing campaign was intentionally paused",
    confidence: 0.88,
    provenance: "original_note_extraction"
  }],
  userAddedContext: [],
  approvedAt: "2026-07-21T12:00:00.000Z"
};
const contextualEvidence = { releaseChannel: "preview", records: [contextRecord, revenueRecord] };

const producerInput = contract.foundationSnapshotBuildInput();
producerInput.contextualEvidence = {
  producerId: contract.CONTEXTUAL_EVIDENCE_PRODUCER_ID,
  producerVersion: contract.CONTEXTUAL_EVIDENCE_PRODUCER_VERSION,
  workspaceId: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
  asOf: contract.FOUNDATION_FIXTURE_AS_OF,
  semanticInputFingerprint: snapshotHash(contextualEvidence),
  output: contextualEvidence
};
const baseline = contract.buildIntelligenceSnapshotV1(contract.foundationSnapshotBuildInput()).snapshot;
const contextual = contract.buildIntelligenceSnapshotV1(producerInput).snapshot;
const emptyContextInput = contract.foundationSnapshotBuildInput();
emptyContextInput.contextualEvidence = {
  ...producerInput.contextualEvidence,
  semanticInputFingerprint: snapshotHash({ releaseChannel: "preview", records: [] }),
  output: { releaseChannel: "preview", records: [] }
};
const emptyContextSnapshot = contract.buildIntelligenceSnapshotV1(emptyContextInput).snapshot;
assert.equal(emptyContextSnapshot.contextualEvidence, undefined, "an empty optional context producer must preserve the legacy snapshot shape");
assert.equal(emptyContextSnapshot.fingerprints.input, baseline.fingerprints.input);
assert.equal(emptyContextSnapshot.fingerprints.snapshot, baseline.fingerprints.snapshot);

for (const field of ["businessHealth", "dataQuality", "readiness", "kpis", "findings", "findingIndex", "priorities", "evidence", "limitations"]) {
  assert.deepEqual(contextual[field], baseline[field], `${field} must remain deterministically identical`);
}
assert.equal(contextual.contextualEvidence.length, 2);
assert.equal(contextual.evidence.references.some((reference) => reference.recordId === contextRecord.sourceNoteId), false);
assert.notEqual(contextual.fingerprints.snapshot, baseline.fingerprints.snapshot, "relevant optional context must be fingerprinted");

const healthProjection = contract.projectBusinessHealthExplanationV1(contextual);
assert.equal(healthProjection.contextualEvidence.length, 2, "both relevant operating and revenue context records should be bounded into Business Health reasoning");
assert.equal(healthProjection.contextAuthority.deterministicIntelligenceWins, true);
assert.equal(healthProjection.contextAuthority.automaticReconciliation, false);
const findingProjection = contract.projectFindingExplanationV1(contextual, "finding-checkout-wait");
assert.equal(findingProjection.contextualEvidence.length, 1, "finding projection must exclude unrelated context");
assert.equal(findingProjection.contextualEvidence[0].title, "Temporary warehouse move disruption");
const denseContextRecords = Array.from({ length: 6 }, (_, recordIndex) => ({
  ...contextRecord,
  id: `business-note-context:33333333-3333-4333-8333-${String(recordIndex + 1).padStart(12, "0")}:v1`,
  sourceNoteId: `33333333-3333-4333-8333-${String(recordIndex + 1).padStart(12, "0")}`,
  approvedAt: `2026-07-${String(10 + recordIndex).padStart(2, "0")}T12:00:00.000Z`,
  entities: Array.from({ length: 6 }, (_, entityIndex) => ({
    id: `dense:${recordIndex}:project:${entityIndex}`,
    kind: "project",
    name: `Checkout project ${entityIndex}`,
    sourceQuote: `Checkout project ${entityIndex} was discussed during the warehouse move.`,
    provenance: "original_note_extraction"
  })),
  statements: Array.from({ length: 8 }, (_, statementIndex) => ({
    id: `dense:${recordIndex}:reported_fact:${statementIndex}`,
    kind: "reported_fact",
    text: `Checkout wait context statement ${statementIndex} during the warehouse move.`,
    sourceQuote: `Checkout wait context statement ${statementIndex} during the warehouse move.`,
    confidence: 0.8,
    provenance: "original_note_extraction"
  }))
}));
const denseContextSnapshot = buildIntelligenceSnapshotFromProducersV1({
  workspaceId: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
  asOf: contract.FOUNDATION_FIXTURE_AS_OF,
  intelligence: contract.foundationIntelligenceLayerOutput(),
  contextualEvidence: { releaseChannel: "preview", records: denseContextRecords }
}).snapshot;
const denseFindingProjection = contract.projectFindingExplanationV1(denseContextSnapshot, "finding-checkout-wait");
assert.equal(denseFindingProjection.contextualEvidence.length, 4, "reasoning context must enforce its record bound");
assert.ok(denseFindingProjection.contextualEvidence.every((record) => record.statements.length === 4));
assert.ok(denseFindingProjection.contextualEvidence.every((record) => record.entities.length === 2));
assert.ok(Buffer.byteLength(JSON.stringify(denseFindingProjection.contextualEvidence)) < 40_000, "the bounded projection must remain safe for the existing encrypted action token");

const reorderedComposition = buildIntelligenceSnapshotFromProducersV1({
  workspaceId: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
  asOf: contract.FOUNDATION_FIXTURE_AS_OF,
  intelligence: contract.foundationIntelligenceLayerOutput(),
  coverage: contract.foundationCoverageOutput(),
  evidenceManifests: [contract.foundationEvidenceManifest()],
  kpis: contract.foundationKpiProducerOutput(),
  contextualEvidence: { releaseChannel: "preview", records: [revenueRecord, contextRecord] }
});
const orderedComposition = buildIntelligenceSnapshotFromProducersV1({
  workspaceId: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
  asOf: contract.FOUNDATION_FIXTURE_AS_OF,
  intelligence: contract.foundationIntelligenceLayerOutput(),
  coverage: contract.foundationCoverageOutput(),
  evidenceManifests: [contract.foundationEvidenceManifest()],
  kpis: contract.foundationKpiProducerOutput(),
  contextualEvidence
});
assert.equal(reorderedComposition.snapshot.fingerprints.input, orderedComposition.snapshot.fingerprints.input, "context input fingerprint must be order-stable");
assert.equal(reorderedComposition.snapshot.fingerprints.snapshot, orderedComposition.snapshot.fingerprints.snapshot, "context snapshot fingerprint must be order-stable");

const intelligence = contract.foundationIntelligenceLayerOutput();
const homepage = {
  health: {
    available: true,
    score: intelligence.businessHealth.score,
    status: intelligence.businessHealth.status,
    trend: intelligence.businessHealth.trend,
    trendDelta: null,
    summary: intelligence.executiveSummary,
    driver: intelligence.topRisk.title,
    confidence: intelligence.dataQuality.confidence,
    memorySignals: 0
  },
  priorities: [],
  changes: { state: "none", items: [], message: "" },
  readiness: {}
};
process.env.VERCEL_ENV = "preview";
const healthWithoutContext = buildBusinessHealthExplanationFromSnapshotV1({
  workspaceId: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
  intelligence,
  homepage,
  snapshots: [],
  coverage: contract.foundationCoverageOutput(),
  asOf: contract.FOUNDATION_FIXTURE_AS_OF
});
const healthWithContext = buildBusinessHealthExplanationFromSnapshotV1({
  workspaceId: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
  intelligence,
  homepage,
  snapshots: [],
  coverage: contract.foundationCoverageOutput(),
  contextualEvidence,
  asOf: contract.FOUNDATION_FIXTURE_AS_OF
});
assert.equal(healthWithContext.parity.status, "exact");
assert.deepEqual(healthWithContext.analysisPackage.facts, healthWithoutContext.analysisPackage.facts);
assert.deepEqual(healthWithContext.analysisPackage.manifest, healthWithoutContext.analysisPackage.manifest);
assert.deepEqual(healthWithContext.analysisPackage.citations, healthWithoutContext.analysisPackage.citations);
assert.notEqual(healthWithContext.analysisPackage.fingerprint, healthWithoutContext.analysisPackage.fingerprint, "reasoning cache key must change only when relevant context is projected");
const legacyHealthPayload = businessHealthProviderRequestPayload(healthWithoutContext.analysisPackage);
assert.equal("reported_context" in legacyHealthPayload, false, "no-context provider payload shape must remain unchanged");
assert.equal("context_authority" in legacyHealthPayload.application_owned, false);
assert.doesNotMatch(businessHealthExplanationSystemPrompt(healthWithoutContext.analysisPackage), /reported_context/);
const healthPayload = businessHealthProviderRequestPayload(healthWithContext.analysisPackage);
assert.equal(healthPayload.reported_context.length, 2);
assert.equal(healthPayload.application_owned.context_authority.role, "supporting_context");
const healthContextPrompt = businessHealthExplanationSystemPrompt(healthWithContext.analysisPackage);
assert.match(healthContextPrompt, /reported_context/);
assert.match(healthContextPrompt, /An approved Business Note reports/);
assert.match(healthContextPrompt, /Leadership reported/);
assert.match(healthContextPrompt, /According to approved Business Note context/);
assert.match(healthContextPrompt, /may provide context/);
assert.match(healthContextPrompt, /could be relevant/);
assert.match(healthContextPrompt, /does not establish causation/);
assert.match(healthContextPrompt, /Never present reported_context as independently observed, established, confirmed, validated, or verified fact/);
assert.match(healthContextPrompt, /In why_it_matters, do not use Business Note-only language unless that field contains both explicit attribution and bounded interpretation/);
assert.doesNotMatch(JSON.stringify(healthPayload.reported_context), /business-note-context:/, "internal note IDs must not enter the provider request");
const healthContextOutput = {
  executive_interpretation: "Checkout wait remains the required top risk while revenue remains the required opportunity. The Business Note reports a temporary warehouse move that may help explain the checkout wait.",
  why_it_matters: "The current combination deserves leadership awareness while the approved evidence remains authoritative.",
  leadership_consideration: "Leadership can review the approved operating evidence without changing the deterministic score.",
  provisional_hypothesis: null
};
assert.equal(validateBusinessHealthExplanationOutput(healthContextOutput, healthWithContext.analysisPackage).ok, true, "explicitly attributed context must remain available to reasoning");
const healthAttributedWhyItMatters = validateBusinessHealthExplanationOutput({
  ...healthContextOutput,
  executive_interpretation: "Checkout wait remains the required top risk while revenue remains the required opportunity.",
  why_it_matters: "An approved Business Note reports a temporary warehouse move. This reported context may provide context for checkout wait and does not establish causation."
}, healthWithContext.analysisPackage);
assert.equal(healthAttributedWhyItMatters.ok, true, "attributed and bounded Business Note context must remain valid in why_it_matters");
const healthUnattributedWhyItMatters = validateBusinessHealthExplanationOutput({
  ...healthContextOutput,
  executive_interpretation: "Checkout wait remains the required top risk while revenue remains the required opportunity.",
  why_it_matters: "A temporary warehouse move may provide context for checkout wait, but it does not establish causation."
}, healthWithContext.analysisPackage);
assert.equal(healthUnattributedWhyItMatters.ok, false, "Business Note-only terms must still fail when why_it_matters omits attribution");
assert.equal(healthUnattributedWhyItMatters.diagnostic.reasonCode, "unsupported_relationship");
assert.equal(healthUnattributedWhyItMatters.diagnostic.expectedField, "why_it_matters");
const healthDeterministicOnly = validateBusinessHealthExplanationOutput({
  ...healthContextOutput,
  executive_interpretation: "Checkout wait remains the required top risk while revenue remains the required opportunity.",
  why_it_matters: "The approved checkout wait and revenue evidence may be stated directly because both are deterministic score drivers."
}, healthWithContext.analysisPackage);
assert.equal(healthDeterministicOnly.ok, true, "deterministic evidence must remain directly stateable when optional Business Note context is available");
const healthUnattributed = validateBusinessHealthExplanationOutput({
  ...healthContextOutput,
  executive_interpretation: "Checkout wait remains the required top risk while revenue remains the required opportunity. A temporary warehouse move may help explain the checkout wait."
}, healthWithContext.analysisPackage);
assert.equal(healthUnattributed.ok, false, "context must never be presented as an unattributed deterministic fact");
assert.equal(healthUnattributed.diagnostic.reasonCode, "unsupported_relationship");

const finding = intelligence.insights.find((item) => item.id === "finding-checkout-wait");
assert.ok(finding);
const findingWithoutContext = buildFindingExplanationFromSnapshotV1({
  workspaceId: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
  insight: finding,
  snapshot: baseline,
  now: new Date(contract.FOUNDATION_FIXTURE_AS_OF)
});
const findingWithContext = buildFindingExplanationFromSnapshotV1({
  workspaceId: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
  insight: finding,
  snapshot: contextual,
  now: new Date(contract.FOUNDATION_FIXTURE_AS_OF)
});
assert.equal(findingWithContext.parity.status, "exact");
assert.deepEqual(findingWithContext.analysisPackage.facts, findingWithoutContext.analysisPackage.facts);
assert.deepEqual(findingWithContext.analysisPackage.manifest, findingWithoutContext.analysisPackage.manifest);
assert.deepEqual(findingWithContext.analysisPackage.citations, findingWithoutContext.analysisPackage.citations);
assert.notEqual(findingWithContext.analysisPackage.fingerprint, findingWithoutContext.analysisPackage.fingerprint);
const legacyFindingPayload = findingExplanationModelInput(findingWithoutContext.analysisPackage);
assert.equal("reported_context" in legacyFindingPayload, false);
assert.equal("context_authority" in legacyFindingPayload.application_owned_controls, false);
assert.doesNotMatch(findingExplanationSystemPrompt(findingWithoutContext.analysisPackage), /reported_context/);
const findingPayload = findingExplanationModelInput(findingWithContext.analysisPackage);
assert.equal(findingPayload.reported_context.length, 1);
assert.equal(findingPayload.application_owned_controls.context_authority.originalEvidenceEligible, false);
assert.match(findingExplanationSystemPrompt(findingWithContext.analysisPackage), /reported_context/);
assert.doesNotMatch(JSON.stringify(findingPayload.reported_context), /11111111-1111-4111-8111-111111111111/);
const findingContextOutput = {
  what_happened: "Checkout wait remains above the manual target in the current deterministic finding.",
  why_evidence_suggests: "The Business Note reports a temporary warehouse move that may help explain the checkout wait pattern.",
  why_leadership_should_care: "Leadership should review the affected operating area described by the approved finding.",
  investigate_next: "Review the source evidence and decide the next operating step for checkout wait.",
  what_evidence_does_not_prove: "The available evidence does not establish causation beyond the recorded facts."
};
assert.equal(validateFindingExplanationOutput(findingContextOutput, findingWithContext.analysisPackage).ok, true);
const findingUnattributed = validateFindingExplanationOutput({
  ...findingContextOutput,
  why_evidence_suggests: "A temporary warehouse move may help explain the checkout wait pattern in the same period."
}, findingWithContext.analysisPackage);
assert.equal(findingUnattributed.ok, false);
assert.equal(findingUnattributed.diagnostic.reasonCode, "unsupported_inference");

const conflictingRecord = {
  ...contextRecord,
  title: "Manager-reported checkout improvement",
  summary: "Management reported that checkout wait improved during the same period.",
  topics: ["checkout wait"],
  statements: [{
    ...contextRecord.statements[0],
    text: "Checkout wait improved during the same period.",
    sourceQuote: "checkout wait improved"
  }]
};
const conflictingBuild = buildIntelligenceSnapshotFromProducersV1({
  workspaceId: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
  asOf: contract.FOUNDATION_FIXTURE_AS_OF,
  intelligence,
  contextualEvidence: { releaseChannel: "preview", records: [conflictingRecord] }
});
const conflictingProjection = contract.projectFindingExplanationV1(conflictingBuild.snapshot, "finding-checkout-wait");
assert.equal(conflictingProjection.finding.value.title, "Checkout wait remains above the manual target");
assert.equal(conflictingProjection.contextualEvidence[0].summary, conflictingRecord.summary, "conflicting context must remain visible in its separate authority lane");
assert.equal(conflictingProjection.contextAuthority.automaticReconciliation, false);

const foreignInput = clone(producerInput);
foreignInput.contextualEvidence.output.records[0].workspaceId = "foreign-workspace";
assert.throws(() => contract.buildIntelligenceSnapshotV1(foreignInput), /another workspace/);
const channelInput = clone(producerInput);
channelInput.contextualEvidence.output.records[0].releaseChannel = "production";
assert.throws(() => contract.buildIntelligenceSnapshotV1(channelInput), /another release channel/);
const malformedInput = clone(producerInput);
malformedInput.contextualEvidence.output.records[0].originalEvidenceEligible = true;
assert.throws(() => contract.buildIntelligenceSnapshotV1(malformedInput), /expected false|invariant validation failed/);

const contextLoaderSource = read("lib/ai/business-notes/contextual-evidence.ts");
assert.match(contextLoaderSource, /\.eq\("workspace_id", workspaceId\)/);
assert.match(contextLoaderSource, /\.eq\("release_channel", releaseChannel\)/);
assert.match(contextLoaderSource, /\.eq\("status", "approved"\)/);
assert.match(contextLoaderSource, /\.eq\("evidence_lifecycle_status", "active"\)/);
assert.match(contextLoaderSource, /\.lte\("indexed_at", asOf\)/);
assert.match(contextLoaderSource, /\.is\("archived_at", null\)/);
assert.match(contextLoaderSource, /\.is\("deleted_at", null\)/);
assert.match(contextLoaderSource, /const indexedNoteIds = new Set/, "multiple retrieval chunks must only mark one source note as indexed");
assert.match(contextLoaderSource, /for \(const note of notes\)/, "context records must be produced from unique source notes, not retrieval chunks");
const indexingSource = read("lib/ai/business-notes/indexing.ts");
assert.match(indexingSource, /content_hash: hash\(`\$\{note\.id\}:\$\{note\.source_version\}:\$\{index\}:\$\{chunk\}`\)/);
assert.match(indexingSource, /onConflict: "workspace_id,source_type,source_id,content_hash,chunk_index"/, "repeated indexing must upsert the same deterministic chunk identities");
assert.match(
  read("supabase/migrations/202607060001_business_memory_evidence_index.sql"),
  /create unique index if not exists business_memory_chunks_source_hash_idx[\s\S]*workspace_id, source_type, source_id, content_hash, chunk_index/,
  "the database must enforce the same deterministic chunk identity"
);
const approvalSource = read("app/app/sources/business-notes/actions.ts");
assert.match(approvalSource, /note\.status !== "review_required"/, "a completed approval must not be approved again");
assert.match(approvalSource, /\.eq\("status", "review_required"\)/, "approval persistence must remain conditional on the review state");
const sourcesPageSource = read("app/app/sources/page.tsx");
assert.match(sourcesPageSource, /collapseBusinessNoteKnowledgeRows\(matchingChunks\)/, "Learned Knowledge must project one customer-visible record per Business Note");
assert.match(sourcesPageSource, /tab\.key === "knowledge"[\s\S]*\? activeKnowledgeRows\.length/, "the Learned Knowledge tab count must use the same record projection as the list");
assert.doesNotMatch(read("lib/intelligence/snapshot/v1/builder.ts"), /runStructuredAI|generateBusinessHealthExplanation|generateFindingExplanation/);
assert.match(indexingSource, /evidence_role: "supporting_context"/);
assert.doesNotMatch(read("app/app/reports/saved-analysis-actions.ts"), /contextualEvidence|business_notes/, "Saved Analysis storage must remain unchanged");

const startedAt = performance.now();
for (let index = 0; index < 100; index += 1) {
  buildIntelligenceSnapshotFromProducersV1({
    workspaceId: contract.FOUNDATION_FIXTURE_WORKSPACE_ID,
    asOf: contract.FOUNDATION_FIXTURE_AS_OF,
    intelligence,
    contextualEvidence
  });
}
const averageBuildMs = (performance.now() - startedAt) / 100;
assert.ok(averageBuildMs < 20, `bounded contextual snapshot construction averaged ${averageBuildMs.toFixed(3)}ms`);

assertContextLoaderIdempotency()
  .then(() => console.log(`Business Notes contextual integration regression tests passed (average snapshot build ${averageBuildMs.toFixed(3)}ms).`))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
