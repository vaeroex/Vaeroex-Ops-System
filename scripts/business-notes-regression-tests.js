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
  BUSINESS_NOTE_EXTRACTION_JSON_SCHEMA,
  BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION,
  BUSINESS_NOTE_MAX_CHARACTERS
} = require("../lib/ai/business-notes/contracts.ts");
const {
  applyBusinessNoteReviewCorrections,
  businessNoteSourceSpans,
  validateBusinessNoteExtraction
} = require("../lib/ai/business-notes/validation.ts");
const {
  filterEligibleMemoryRows,
  SupabasePgvectorCandidateRetriever
} = require("../lib/ai/evidence-index.ts");
const { AIProviderExecutionError, runStructuredAI } = require("../lib/ai/providers/provider-manager.ts");
const { resolveBusinessNoteExtractionGenerationPolicy } = require("../lib/ai/providers/workflow-provider-policy.ts");

function extraction(overrides = {}) {
  return {
    schemaVersion: BUSINESS_NOTE_EXTRACTION_SCHEMA_VERSION,
    extractionDisposition: "extractable",
    title: "Business note",
    summary: "Revenue was 7000 in June.",
    noteType: "observation",
    sourceClassification: "manager_observation",
    departments: ["Sales"],
    topics: ["Revenue"],
    peopleMentioned: [],
    customersMentioned: [],
    vendorsMentioned: [],
    projectsMentioned: [],
    explicitFacts: [{ statement: "Revenue was 7000 in June.", sourceQuote: "Revenue was 7000 in June.", confidence: 0.9 }],
    opinionsOrAssumptions: [],
    risks: [],
    opportunities: [],
    decisions: [],
    mentionedMetrics: [{ name: "Revenue", value: 7000, unit: "USD", sourceQuote: "Revenue was 7000 in June.", confidence: 0.9 }],
    reportingPeriod: { start: null, end: null, inferred: false, sourceQuote: null },
    evidenceTreatment: "potentially_supporting",
    extractionConfidence: 0.72,
    missingContext: [],
    ...overrides
  };
}

function expectValid(note, value, label) {
  const result = validateBusinessNoteExtraction(value, note);
  assert.equal(result.ok, true, `${label}: ${result.ok ? "" : result.reason}`);
  return result.value;
}

function memoryRow(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    source_type: "business_note",
    source_id: "22222222-2222-4222-8222-222222222222",
    source_file_id: null,
    source_title: "Staffing concern",
    source_excerpt: "Operations staffing was short on Friday.",
    summary: "Operations staffing was short on Friday.",
    chunk_index: 0,
    content_hash: "hash",
    embedding: null,
    embedding_model: null,
    source_metadata: {
      evidence_classification: "business_evidence",
      evidence_lifecycle: "active",
      evidence_role: "supporting",
      original_evidence_eligible: false,
      departments: ["Operations"],
      topics: ["staffing"]
    },
    source_quality: "medium",
    confidence_score: 45,
    token_estimate: 12,
    indexed_at: "2026-07-25T00:00:00.000Z",
    archived_at: null,
    deleted_at: null,
    ...overrides
  };
}

function noteParent(overrides = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    release_channel: "preview",
    status: "approved",
    evidence_lifecycle_status: "active",
    archived_at: null,
    deleted_at: null,
    ...overrides
  };
}

function queryBuilder(result) {
  const builder = {};
  for (const method of ["select", "eq", "is", "or", "order"]) builder[method] = () => builder;
  builder.range = async () => result;
  builder.in = async () => result;
  return builder;
}

function providerResult(content, model) {
  return {
    content,
    requestId: `request-${model}`,
    latencyMs: 5,
    usage: { inputTokens: 20, outputTokens: 30, totalTokens: 50 },
    finishReason: "stop",
    truncationDetected: false,
    runtimeModel: model
  };
}

async function providerRoute({ originalNote, luna, terra }) {
  const calls = [];
  const provider = {
    name: "openai",
    supportsAttachments: false,
    isConfigured: () => true,
    async generate(request) {
      calls.push(request.model);
      return request.model === "gpt-5.6-luna" ? luna(request) : terra(request);
    }
  };
  const resolved = resolveBusinessNoteExtractionGenerationPolicy({
    startedAtMs: Date.now(),
    structuredOutput: {
      name: "business_note_extraction_v1",
      schema: BUSINESS_NOTE_EXTRACTION_JSON_SCHEMA,
      strict: true
    }
  });
  const run = runStructuredAI({
    primaryProvider: "openai",
    primaryModel: "gpt-5.6-luna",
    fallbackModel: "gpt-5.6-terra",
    providerPolicy: resolved.providerPolicy,
    executionBudget: resolved.executionBudget,
    systemPrompt: "test",
    userContent: [{ type: "text", text: originalNote }],
    settings: {
      timeoutMs: 100,
      maxRetries: 0,
      retryBaseDelayMs: 1,
      circuitFailureThreshold: 5,
      circuitOpenMs: 10000
    },
    validate: (value) => validateBusinessNoteExtraction(value, originalNote),
    providers: { openai: provider, nvidia: provider }
  });
  return { calls, run };
}

async function main() {
  process.env.VERCEL_ENV = "preview";
  assert.equal(BUSINESS_NOTE_MAX_CHARACTERS, 20000);

  const simple = "Sales reported: Revenue was 7000 in June.";
  expectValid(simple, extraction(), "simple factual note");

  const mixed = "Sales reported: Revenue was 7000 in June. I think the campaign caused it.";
  expectValid(mixed, extraction({
    summary: "Revenue was 7000 in June.",
    opinionsOrAssumptions: [{ statement: "The campaign caused revenue.", sourceQuote: "I think the campaign caused it.", confidence: 0.35 }]
  }), "mixed fact and opinion");

  const misclassifiedAssumption = extraction({
    explicitFacts: [{ statement: "The campaign caused revenue.", sourceQuote: "I think the campaign caused it.", confidence: 0.8 }],
    mentionedMetrics: []
  });
  assert.equal(validateBusinessNoteExtraction(misclassifiedAssumption, mixed).ok, false, "an assumption cannot be accepted as an explicit fact");

  const vaguePeriod = "Sales reported: Revenue was 7000 recently.";
  expectValid(vaguePeriod, extraction({
    summary: "Revenue was 7000 recently.",
    explicitFacts: [{ statement: "Revenue was 7000 recently.", sourceQuote: "Revenue was 7000 recently.", confidence: 0.65 }],
    mentionedMetrics: [{ name: "Revenue", value: 7000, unit: "USD", sourceQuote: "Revenue was 7000 recently.", confidence: 0.65 }],
    reportingPeriod: { start: null, end: null, inferred: true, sourceQuote: null },
    missingContext: ["The reporting date is not specified."]
  }), "vague reporting period");

  const explicitDate = "Sales reported: Revenue was 7000 on 2026-07-18.";
  expectValid(explicitDate, extraction({
    summary: "Revenue was 7000 on 2026-07-18.",
    explicitFacts: [{ statement: "Revenue was 7000 on 2026-07-18.", sourceQuote: "Revenue was 7000 on 2026-07-18.", confidence: 0.95 }],
    mentionedMetrics: [{ name: "Revenue", value: 7000, unit: "USD", sourceQuote: "Revenue was 7000 on 2026-07-18.", confidence: 0.95 }],
    reportingPeriod: { start: "2026-07-18", end: "2026-07-18", inferred: false, sourceQuote: "2026-07-18" }
  }), "explicit reporting date");

  const departments = "Sales and Operations reported: Revenue was 7000 in June.";
  expectValid(departments, extraction({ departments: ["Sales", "Operations"] }), "multiple departments");

  const quantities = "Sales reported: Revenue was 7000 and returns were 12 in June.";
  expectValid(quantities, extraction({
    summary: "Revenue was 7000 and returns were 12 in June.",
    explicitFacts: [{ statement: "Revenue was 7000 and returns were 12 in June.", sourceQuote: "Revenue was 7000 and returns were 12 in June.", confidence: 0.9 }],
    topics: ["Revenue", "returns"],
    mentionedMetrics: [
      { name: "Revenue", value: 7000, unit: "USD", sourceQuote: "Revenue was 7000 and returns were 12 in June.", confidence: 0.9 },
      { name: "returns", value: 12, unit: "count", sourceQuote: "Revenue was 7000 and returns were 12 in June.", confidence: 0.9 }
    ]
  }), "multiple quantities");

  const contradictory = "Sales reported: Revenue increased in June. Sales also reported: Revenue decreased in June.";
  expectValid(contradictory, extraction({
    summary: "Revenue increased and revenue decreased in June.",
    explicitFacts: [
      { statement: "Revenue increased in June.", sourceQuote: "Revenue increased in June.", confidence: 0.7 },
      { statement: "Revenue decreased in June.", sourceQuote: "Revenue decreased in June.", confidence: 0.7 }
    ],
    mentionedMetrics: [],
    missingContext: ["The note contains conflicting revenue statements."]
  }), "contradictory statements remain separate");

  const meeting = "Operations meeting notes: The team decided to move the inventory count to Friday.";
  expectValid(meeting, extraction({
    title: "Inventory count meeting outcome",
    summary: "The team decided to move the inventory count to Friday.",
    noteType: "meeting_outcome",
    sourceClassification: "meeting_notes",
    departments: ["Operations"],
    topics: ["inventory"],
    explicitFacts: [],
    decisions: [{ description: "Move the inventory count to Friday.", sourceQuote: "The team decided to move the inventory count to Friday.", confidence: 0.9 }],
    mentionedMetrics: []
  }), "meeting minutes");

  const incident = "Operations incident note: Three technicians called out Friday.";
  expectValid(incident, extraction({
    title: "Technician call-outs",
    summary: "Three technicians called out Friday.",
    noteType: "incident",
    sourceClassification: "incident_note",
    departments: ["Operations"],
    topics: ["technicians"],
    explicitFacts: [{ statement: "Three technicians called out Friday.", sourceQuote: "Three technicians called out Friday.", confidence: 0.85 }],
    mentionedMetrics: [{ name: "technician call-outs", value: 3, unit: "people", sourceQuote: "Three technicians called out Friday.", confidence: 0.85 }]
  }), "incident-style note");

  const emotional = "Sales note: I am frustrated and believe returns are getting worse.";
  expectValid(emotional, extraction({
    title: "Concern about returns",
    summary: "The note says returns are getting worse.",
    noteType: "concern",
    departments: ["Sales"],
    topics: ["returns"],
    explicitFacts: [],
    opinionsOrAssumptions: [{ statement: "Returns are getting worse.", sourceQuote: "I am frustrated and believe returns are getting worse.", confidence: 0.4 }],
    mentionedMetrics: []
  }), "emotional language remains opinion");

  const noContext = "Remember to buy coffee.";
  expectValid(noContext, extraction({
    extractionDisposition: "no_business_context",
    title: "No business context",
    summary: "Remember to buy coffee.",
    noteType: "mixed",
    sourceClassification: "general_business_note",
    departments: [],
    topics: [],
    explicitFacts: [],
    mentionedMetrics: [],
    evidenceTreatment: "context_only",
    extractionConfidence: 0.2,
    missingContext: ["No useful business evidence is present."]
  }), "note containing no useful business evidence");

  const lowConfidence = extraction({ extractionConfidence: 0.05 });
  expectValid(simple, lowConfidence, "low confidence remains reviewable and must not trigger fallback");
  const ambiguous = validateBusinessNoteExtraction(extraction({ extractionDisposition: "too_ambiguous" }), simple);
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.diagnostic.reasonCode, "ambiguous_extraction");
  assert.equal(validateBusinessNoteExtraction({ ...extraction(), sourceClassification: "unsupported" }, simple).ok, false);
  assert.equal(validateBusinessNoteExtraction({ ...extraction(), explicitFacts: [{ statement: "Revenue was 7000 in June.", sourceQuote: "", confidence: 0.9 }] }, simple).ok, false);
  assert.equal(validateBusinessNoteExtraction({ ...extraction(), summary: "Revenue was 9000 in June." }, simple).ok, false);

  const reviewed = applyBusinessNoteReviewCorrections(extraction(), {
    title: "June revenue note",
    noteType: "concern",
    departments: ["Sales"],
    topics: ["Revenue"],
    reportingPeriod: { start: "2026-06-01", end: "2026-06-30" },
    removedItemPaths: ["mentionedMetrics.0"]
  });
  assert.equal(reviewed.title, "June revenue note");
  assert.equal(reviewed.mentionedMetrics.length, 0);
  assert.equal(reviewed.reportingPeriod.inferred, false);
  assert.ok(businessNoteSourceSpans(extraction(), simple).some((span) => span.path === "departments.0"));

  const eligible = filterEligibleMemoryRows({ rows: [memoryRow()], files: [], runs: [], notes: [noteParent()], workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  assert.equal(eligible.length, 1);
  assert.equal(filterEligibleMemoryRows({ rows: [memoryRow()], files: [], runs: [], notes: [noteParent({ status: "rejected" })] }).length, 0);
  assert.equal(filterEligibleMemoryRows({ rows: [memoryRow()], files: [], runs: [], notes: [noteParent({ release_channel: "production" })] }).length, 0);
  assert.equal(filterEligibleMemoryRows({ rows: [memoryRow({ workspace_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })], files: [], runs: [], notes: [noteParent()], workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }).length, 0);

  const rows = [memoryRow()];
  const notes = [noteParent()];
  const supabase = {
    from(table) {
      if (table === "business_memory_chunks") return queryBuilder({ data: rows, error: null });
      if (table === "business_notes") return queryBuilder({ data: notes, error: null });
      return queryBuilder({ data: [], error: null });
    }
  };
  const retriever = new SupabasePgvectorCandidateRetriever({ supabase });
  const query = (text) => ({
    version: "evidence_query_v1",
    workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    text,
    requestedDomains: ["business_memory"],
    strategy: "keyword_only",
    candidateLimit: 10,
    resultLimit: 5,
    minimumSourceDiversity: 1,
    freshnessAfter: null
  });
  const relevant = await retriever.retrieve(query("Operations staffing"));
  assert.equal(relevant.candidates.length, 1, "relevant approved Business Note must be retrievable");
  assert.equal(relevant.candidates[0].evidenceRole, "supporting");
  assert.equal(relevant.candidates[0].eligibility.originalEvidenceEligible, false);
  const irrelevant = await retriever.retrieve(query("monthly revenue"));
  assert.equal(irrelevant.candidates.length, 0, "irrelevant Business Note must not enter downstream analysis");

  process.env.VAEROEX_BUSINESS_NOTES_POLICY = "gpt56_luna_terra_v1";
  const acceptedJson = JSON.stringify(lowConfidence);
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    const lowConfidenceRoute = await providerRoute({
      originalNote: simple,
      luna: (request) => providerResult(acceptedJson, request.model),
      terra: (request) => providerResult(acceptedJson, request.model)
    });
    const lowConfidenceRun = await lowConfidenceRoute.run;
    assert.deepEqual(lowConfidenceRoute.calls, ["gpt-5.6-luna"], "valid low-confidence Luna output must not invoke Terra");
    assert.equal(lowConfidenceRun.fallbackUsed, false);

    const schemaFallbackRoute = await providerRoute({
      originalNote: simple,
      luna: (request) => providerResult("{}", request.model),
      terra: (request) => providerResult(acceptedJson, request.model)
    });
    const schemaFallbackRun = await schemaFallbackRoute.run;
    assert.deepEqual(schemaFallbackRoute.calls, ["gpt-5.6-luna", "gpt-5.6-terra"]);
    assert.equal(schemaFallbackRun.fallbackUsed, true);
    assert.equal(schemaFallbackRun.attempts[0].fallbackReason, "schema_failure");

    const timeoutFallbackRoute = await providerRoute({
      originalNote: simple,
      luna: async () => {
        const error = new Error("Luna request timed out.");
        error.name = "AbortError";
        throw error;
      },
      terra: (request) => providerResult(acceptedJson, request.model)
    });
    const timeoutFallbackRun = await timeoutFallbackRoute.run;
    assert.deepEqual(timeoutFallbackRoute.calls, ["gpt-5.6-luna", "gpt-5.6-terra"]);
    assert.equal(timeoutFallbackRun.attempts[0].fallbackReason, "timeout");

    const ambiguousFallbackRoute = await providerRoute({
      originalNote: simple,
      luna: (request) => providerResult(JSON.stringify(extraction({ extractionDisposition: "too_ambiguous" })), request.model),
      terra: (request) => providerResult(acceptedJson, request.model)
    });
    const ambiguousFallbackRun = await ambiguousFallbackRoute.run;
    assert.deepEqual(ambiguousFallbackRoute.calls, ["gpt-5.6-luna", "gpt-5.6-terra"]);
    assert.equal(ambiguousFallbackRun.attempts[0].fallbackReason, "ambiguous_extraction");

    const failedRoute = await providerRoute({
      originalNote: simple,
      luna: (request) => providerResult("not-json", request.model),
      terra: (request) => providerResult("not-json", request.model)
    });
    await assert.rejects(failedRoute.run, (error) => {
      assert.ok(error instanceof AIProviderExecutionError);
      assert.equal(error.attempts.length, 2);
      return true;
    });
    assert.deepEqual(failedRoute.calls, ["gpt-5.6-luna", "gpt-5.6-terra"], "both-provider failure must stop after one fallback");
  } finally {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
  }

  const policy = read("lib/ai/providers/workflow-provider-policy.ts");
  assert.match(policy, /BUSINESS_NOTE_EXTRACTION_LUNA_MODEL = "gpt-5\.6-luna"/);
  assert.match(policy, /BUSINESS_NOTE_EXTRACTION_TERRA_MODEL = "gpt-5\.6-terra"/);
  assert.match(policy, /BUSINESS_NOTE_EXTRACTION_FALLBACK_REASONS[\s\S]*"ambiguous_extraction"/);
  assert.doesNotMatch(policy.match(/BUSINESS_NOTE_EXTRACTION_FALLBACK_REASONS[\s\S]*?\] as const/)?.[0] || "", /low_confidence/);
  const service = read("lib/ai/business-notes/service.ts");
  assert.doesNotMatch(service, /gpt-5\.6-sol/i);
  assert.match(service, /maxRetries: 0/);
  const actions = read("app/app/sources/business-notes/actions.ts");
  assert.match(actions, /source_text_hash/);
  assert.match(actions, /This unchanged Business Note already has an extraction/);
  assert.match(actions, /indexApprovedBusinessNote/);
  const panel = read("components/evidence/BusinessNotesPanel.tsx");
  assert.match(panel, /Add Note for Review/);
  assert.match(panel, /Original note/);
  assert.doesNotMatch(panel, /gpt-5\.6|Luna|Terra/);

  const migration = read("supabase/migrations/202607250001_business_notes_evidence.sql");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /source_type in \([\s\S]*'business_note'/);
  assert.match(migration, /status = 'approved'[\s\S]*evidence_lifecycle_status = 'active'/);
  assert.match(migration, /source_type <> 'business_note'/);
  assert.match(migration, /Business Note source identity is immutable/);
  assert.match(migration, /auth\.role\(\)[\s\S]*service_role/);

  console.log("Business Notes regression checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
