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

const { assessDocumentForPilot } = require("../lib/ai/document-intelligence-poc/pilot-assessment.ts");
const { compareDocumentExtractions } = require("../lib/ai/document-intelligence-poc/pilot-agreement.ts");
const {
  DocumentPilotCircuitBreaker,
  DocumentPilotExtractionCoordinator,
  MemoryDocumentPilotCache,
  documentPilotCacheKey
} = require("../lib/ai/document-intelligence-poc/pilot-cache.ts");
const { runDocumentIngestionPilot } = require("../lib/ai/document-intelligence-poc/pilot-orchestrator.ts");
const { documentPilotConfigFromEnv } = require("../lib/ai/document-intelligence-poc/pilot-router.ts");
const { aggregateDocumentPilotTelemetry } = require("../lib/ai/document-intelligence-poc/pilot-telemetry.ts");
const { validateUploadFileSafety } = require("../lib/security/file-upload-safety.ts");

const TELEMETRY_KEY = "preview-only-test-telemetry-key-0000000000000000";
const PDF_MAGIC = Buffer.from("%PDF-1.7");
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

function config(mode = "shadow_extraction", overrides = {}) {
  return {
    ...documentPilotConfigFromEnv({
      VERCEL_ENV: "preview",
      VAEROEX_DOCUMENT_ROUTER_PILOT: "true",
      VAEROEX_NVIDIA_DOCUMENT_PILOT: "true",
      VAEROEX_NVIDIA_DOCUMENT_SHADOW_CONFIRMATION: "true",
      VAEROEX_NVIDIA_DOCUMENT_PLANNING_COST_PER_PAGE_USD: "0.01"
    }, mode),
    ...overrides
  };
}

function assessmentInput(kind, native = {}) {
  const definitions = {
    csv: { declaredMimeType: "text/csv", extension: "csv", magicBytes: Buffer.from("name,value\nRevenue,42") },
    xlsx: { declaredMimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx", magicBytes: ZIP_MAGIC },
    docx: { declaredMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx", magicBytes: ZIP_MAGIC },
    pdf: { declaredMimeType: "application/pdf", extension: "pdf", magicBytes: PDF_MAGIC },
    png: { declaredMimeType: "image/png", extension: "png", magicBytes: PNG_MAGIC },
    jpeg: { declaredMimeType: "image/jpeg", extension: "jpeg", magicBytes: JPEG_MAGIC }
  };
  return {
    ...definitions[kind],
    fileSizeBytes: 8_000,
    native
  };
}

function cleanNativeText() {
  return [
    "Executive KPI Review for Q2 2026",
    "Revenue: $120,000",
    "Revenue target: $110,000",
    "Customer retention: 94%",
    "Reporting date: 2026-06-30",
    "Operations remained within the approved service target."
  ].join("\n");
}

function nativeObservations(overrides = {}) {
  return {
    text: cleanNativeText(),
    pageCount: 1,
    nativeTextPageCount: 1,
    imageOnlyPageEstimate: 0,
    readingOrderQuality: "good",
    tableDetected: false,
    tableReconstructionSuccess: true,
    pageAssociationAvailable: true,
    validatorPassed: true,
    criticalFieldCount: 4,
    criticalFieldsWithLabels: 4,
    criticalFieldsWithPageProvenance: 4,
    ...overrides
  };
}

function field(identity, type, value, critical = true) {
  return { identity, type, value: String(value), page: 1, sourceCoordinates: [0.1, 0.1, 0.4, 0.2], critical };
}

function extraction(source, fields = [], overrides = {}) {
  return {
    contractVersion: "document_router_pilot_v1",
    normalizationVersion: "document_pilot_normalization_v1",
    source,
    provider: source === "nvidia" ? "nvidia" : "vaeroex",
    model: source === "nvidia" ? "nvidia/nemotron-parse" : "native",
    clientRevision: source === "nvidia" ? "52886112cafab4c4bca1cda0d4f588785adfe4d3" : "native-v1",
    status: "success",
    pageCount: 1,
    outputElementCount: 8,
    criticalFields: fields,
    validationResult: fields.some((item) => item.critical) ? "review_required" : "valid",
    failureCode: null,
    latencyMs: source === "nvidia" ? 25 : 0,
    providerCalls: source === "nvidia" ? 1 : 0,
    successfulCalls: source === "nvidia" ? 1 : 0,
    failedCalls: 0,
    retries: 0,
    ...overrides
  };
}

function runOptions({ input, bytes, native, nvidiaExtractor, pilotConfig, workspace = "workspace-a", coordinator, circuitBreaker, synthetic = true, authorized = true }) {
  return {
    config: pilotConfig || config(),
    assessmentInput: input,
    documentBytes: bytes,
    workspaceScope: workspace,
    telemetryHashKey: TELEMETRY_KEY,
    authorizedForWorkspace: authorized,
    syntheticDocument: synthetic,
    nativeExtraction: native,
    nvidiaExtractor,
    coordinator,
    circuitBreaker
  };
}

async function main() {
  assert.equal(validateUploadFileSafety({
    fileName: "evidence.pdf",
    browserMimeType: "application/pdf",
    size: PDF_MAGIC.length,
    buffer: PDF_MAGIC
  }).ok, true);
  assert.equal(validateUploadFileSafety({
    fileName: "evidence.exe.pdf",
    browserMimeType: "application/pdf",
    size: PDF_MAGIC.length,
    buffer: PDF_MAGIC
  }).ok, false, "Existing compound-extension safety runs before any routing pilot");
  assert.equal(validateUploadFileSafety({
    fileName: "evidence.csv",
    browserMimeType: "text/csv",
    size: 4,
    buffer: Buffer.from([0, 1, 2, 3])
  }).ok, false, "Binary data cannot enter the deterministic CSV parser");

  const csvAssessment = assessDocumentForPilot(assessmentInput("csv", { text: "name,value\nRevenue,42" }));
  assert.equal(csvAssessment.fileKind, "csv");
  let calls = 0;
  const csv = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("csv", { text: "name,value\nRevenue,42" }),
    bytes: Buffer.from("name,value\nRevenue,42"),
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.equal(csv.routed.decision.path, "deterministic_structured_parser");
  assert.equal(csv.routed.decision.nvidiaExecutionAllowed, false);
  assert.equal(calls, 0, "CSV must never call NVIDIA");

  const xlsx = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("xlsx"),
    bytes: ZIP_MAGIC,
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.equal(xlsx.routed.decision.path, "deterministic_structured_parser");
  assert.equal(calls, 0, "XLSX must never call NVIDIA");

  const nativeFields = [field("Revenue", "kpi_name", "Revenue"), field("Revenue", "kpi_value", "120000")];
  const native = extraction("native", nativeFields, { validationResult: "valid" });
  const cleanPdf = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("pdf", nativeObservations()),
    bytes: Buffer.concat([PDF_MAGIC, Buffer.from(cleanNativeText())]),
    native,
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.equal(cleanPdf.routed.assessment.state, "native_clean");
  assert.equal(cleanPdf.routed.decision.path, "native_document_extraction");
  assert.equal(cleanPdf.selectedExtraction.source, "native");
  assert.equal(calls, 0, "High-quality native PDF extraction must bypass NVIDIA");

  const cleanDocx = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("docx", nativeObservations()),
    bytes: Buffer.concat([ZIP_MAGIC, Buffer.from(cleanNativeText())]),
    native,
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.equal(cleanDocx.routed.decision.path, "native_document_extraction");
  assert.equal(calls, 0);

  const imageCoordinator = new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache());
  const image = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("png", { pageCount: 1, imageOnlyPageEstimate: 1 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("synthetic-image")]),
    coordinator: imageCoordinator,
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia", [field("Revenue", "kpi_value", "120000")]); }
  }));
  assert.equal(image.routed.decision.path, "nvidia_direct");
  assert.equal(image.routed.decision.nvidiaExecutionAllowed, true);
  assert.equal(image.reviewRequired, true, "NVIDIA critical fields always require review");
  assert.equal(calls, 1);

  const phonePhoto = await runDocumentIngestionPilot(runOptions({
    input: { ...assessmentInput("jpeg", { pageCount: 1, imageOnlyPageEstimate: 1 }), visualDocumentClass: "phone_photo" },
    bytes: Buffer.concat([JPEG_MAGIC, Buffer.from("synthetic-phone-photo")]),
    coordinator: new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache()),
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.equal(phonePhoto.routed.assessment.state, "visual_specialist_required");
  assert.equal(phonePhoto.routed.decision.path, "nvidia_direct");
  assert.equal(calls, 2);

  const imageOnlyPdf = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("pdf", { pageCount: 2, nativeTextPageCount: 0, imageOnlyPageEstimate: 2 }),
    bytes: Buffer.concat([PDF_MAGIC, Buffer.from("synthetic-image-only-pdf")]),
    coordinator: new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache()),
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia", [], { pageCount: 2 }); }
  }));
  assert.equal(imageOnlyPdf.routed.assessment.state, "image_only");
  assert.equal(imageOnlyPdf.routed.decision.path, "nvidia_direct");
  assert.equal(calls, 3);

  const overLimit = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("png", { pageCount: 17, imageOnlyPageEstimate: 17 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("over-page-limit")]),
    coordinator: new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache()),
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.ok(overLimit.routed.decision.reasonCodes.includes("page_limit_exceeded"));
  assert.equal(overLimit.routed.decision.nvidiaExecutionAllowed, false);
  assert.equal(calls, 3);

  const mismatchedImage = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("png", { pageCount: 1, imageOnlyPageEstimate: 1 }),
    bytes: Buffer.concat([PDF_MAGIC, Buffer.from("declared-as-png")]),
    coordinator: new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache()),
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.ok(mismatchedImage.routed.decision.reasonCodes.includes("declared_type_mismatch"));
  assert.equal(mismatchedImage.routed.decision.nvidiaExecutionAllowed, false, "MIME/extension/magic mismatch fails before provider execution");
  assert.equal(calls, 3);

  const lowQualityInput = assessmentInput("pdf", {
    text: "37\n23\nQ2 2026\nQ3 2026",
    pageCount: 2,
    nativeTextPageCount: 1,
    imageOnlyPageEstimate: 1,
    readingOrderQuality: "corrupt",
    tableDetected: true,
    tableReconstructionSuccess: false,
    pageAssociationAvailable: false,
    validatorPassed: false,
    criticalFieldCount: 2,
    criticalFieldsWithLabels: 0,
    criticalFieldsWithPageProvenance: 0,
    conflictingReportingPeriods: true
  });
  const lowAssessment = assessDocumentForPilot(lowQualityInput);
  assert.equal(lowAssessment.state, "review_required");
  assert.ok(lowAssessment.reasonCodes.includes("critical_numbers_without_labels"));
  assert.ok(lowAssessment.reasonCodes.includes("conflicting_reporting_periods"));
  const lowQuality = await runDocumentIngestionPilot(runOptions({
    input: lowQualityInput,
    bytes: Buffer.concat([PDF_MAGIC, Buffer.from("low-quality")]),
    native,
    coordinator: new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache()),
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia", nativeFields); }
  }));
  assert.equal(lowQuality.routed.decision.path, "nvidia_fallback");
  assert.equal(calls, 4);

  const deterministicAgain = assessDocumentForPilot(lowQualityInput);
  assert.deepEqual(deterministicAgain.reasonCodes, lowAssessment.reasonCodes, "Routing reason codes must be deterministic");
  assert.equal(deterministicAgain.assessmentScore, lowAssessment.assessmentScore);

  const productionConfig = documentPilotConfigFromEnv({
    VERCEL_ENV: "production",
    VAEROEX_DOCUMENT_ROUTER_PILOT: "true",
    VAEROEX_NVIDIA_DOCUMENT_PILOT: "true",
    VAEROEX_NVIDIA_DOCUMENT_SHADOW_CONFIRMATION: "true"
  }, "shadow_extraction");
  assert.equal(productionConfig.nvidiaExecutionAllowed, false);
  const production = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("png", { pageCount: 1 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("production-disabled")]),
    pilotConfig: productionConfig,
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.equal(production.routed.decision.execution, "pilot_disabled");
  assert.equal(calls, 4, "Production must be hard-disabled regardless of flags");

  const unauthorized = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("png", { pageCount: 1 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("unauthorized")]),
    authorized: false,
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.equal(unauthorized.routed.decision.nvidiaExecutionAllowed, false);
  assert.ok(unauthorized.routed.decision.reasonCodes.includes("authorized_file_required"));
  assert.equal(calls, 4);

  const nonsynthetic = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("png", { pageCount: 1 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("customer-file")]),
    synthetic: false,
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.ok(nonsynthetic.routed.decision.reasonCodes.includes("synthetic_pilot_only"));
  assert.equal(calls, 4, "Initial pilot cannot send customer documents");

  const baselineCoordinator = new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache());
  let failureCalls = 0;
  const fallback = await runDocumentIngestionPilot(runOptions({
    input: lowQualityInput,
    bytes: Buffer.concat([PDF_MAGIC, Buffer.from("failed-provider")]),
    native,
    coordinator: baselineCoordinator,
    nvidiaExtractor: async () => {
      failureCalls += 1;
      return extraction("nvidia", [], { status: "failed", validationResult: "invalid", failureCode: "validation_failure", providerCalls: 1, successfulCalls: 0, failedCalls: 1 });
    }
  }));
  assert.equal(failureCalls, 1, "Validation failures must not retry");
  assert.equal(fallback.selectedExtraction.source, "native");
  assert.equal(fallback.nativeExtractionPreserved, true);
  assert.equal(fallback.reviewRequired, true);

  let malformedCalls = 0;
  const malformedProvider = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("png", { pageCount: 1 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("malformed-provider-contract")]),
    coordinator: new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache()),
    nvidiaExtractor: async () => {
      malformedCalls += 1;
      return extraction("nvidia", [], { model: "unexpected-model" });
    }
  }));
  assert.equal(malformedCalls, 1);
  assert.equal(malformedProvider.selectedExtraction, null);
  assert.equal(malformedProvider.telemetry.validationResult, "invalid");
  assert.equal(malformedProvider.reviewRequired, true);

  const retryCoordinator = new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache());
  let retryCalls = 0;
  const retried = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("png", { pageCount: 1 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("retry-once")]),
    coordinator: retryCoordinator,
    nvidiaExtractor: async () => {
      retryCalls += 1;
      return retryCalls === 1
        ? extraction("nvidia", [], { status: "failed", validationResult: "invalid", failureCode: "timeout", providerCalls: 1, successfulCalls: 0, failedCalls: 1 })
        : extraction("nvidia", [field("Revenue", "kpi_value", "120000")]);
    }
  }));
  assert.equal(retryCalls, 2);
  assert.equal(retried.selectedExtraction.status, "success");
  assert.equal(retried.telemetry.retries, 1);
  assert.equal(retried.telemetry.successfulCalls, 1);
  assert.equal(retried.telemetry.failedCalls, 1);
  assert.equal(retried.telemetry.pagesSentToNvidia, 2);

  const concurrentCoordinator = new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache());
  let concurrentCalls = 0;
  const concurrentOptions = runOptions({
    input: assessmentInput("png", { pageCount: 1 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("same-document")]),
    coordinator: concurrentCoordinator,
    nvidiaExtractor: async () => {
      concurrentCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return extraction("nvidia", [field("Revenue", "kpi_value", "120000")]);
    }
  });
  const [firstConcurrent, secondConcurrent] = await Promise.all([
    runDocumentIngestionPilot(concurrentOptions),
    runDocumentIngestionPilot(concurrentOptions)
  ]);
  assert.equal(concurrentCalls, 1, "Concurrent duplicate documents must share one provider call");
  assert.equal([firstConcurrent, secondConcurrent].filter((item) => item.duplicateDocumentSkip).length, 1);
  const cached = await runDocumentIngestionPilot(concurrentOptions);
  assert.equal(concurrentCalls, 1);
  assert.equal(cached.cacheHit, true);
  assert.equal(cached.telemetry.providerCalls, 0);
  assert.equal(cached.telemetry.estimatedCostUsd, 0, "Cache hits have zero planning cost");
  const reanalyzed = await runDocumentIngestionPilot({
    ...concurrentOptions,
    qualifiedReanalysisKey: "preview-qualified-reanalysis:123e4567-e89b-12d3-a456-426614174000"
  });
  assert.equal(concurrentCalls, 2, "A reviewed Preview re-analysis key creates one explicit new extraction");
  assert.equal(reanalyzed.cacheHit, false);
  const repeatedReanalysis = await runDocumentIngestionPilot({
    ...concurrentOptions,
    qualifiedReanalysisKey: "preview-qualified-reanalysis:123e4567-e89b-12d3-a456-426614174000"
  });
  assert.equal(concurrentCalls, 2);
  assert.equal(repeatedReanalysis.cacheHit, true, "The same qualified re-analysis remains idempotent");

  let otherWorkspaceCalls = 0;
  await runDocumentIngestionPilot({
    ...concurrentOptions,
    workspaceScope: "workspace-b",
    nvidiaExtractor: async () => { otherWorkspaceCalls += 1; return extraction("nvidia"); }
  });
  assert.equal(otherWorkspaceCalls, 1, "Extraction cache entries remain workspace-scoped");

  const baseIdentity = {
    documentHash: "a".repeat(64),
    provider: "nvidia",
    model: "nvidia/nemotron-parse",
    clientRevision: "revision-a",
    extractionContractVersion: "document_router_pilot_v1",
    normalizationVersion: "document_pilot_normalization_v1",
    routingPolicyVersion: "document_routing_policy_v1"
  };
  const baseKey = documentPilotCacheKey(baseIdentity);
  assert.notEqual(baseKey, documentPilotCacheKey({ ...baseIdentity, clientRevision: "revision-b" }));
  assert.notEqual(baseKey, documentPilotCacheKey({ ...baseIdentity, routingPolicyVersion: "document_routing_policy_v2" }));
  assert.notEqual(baseKey, documentPilotCacheKey({ ...baseIdentity, extractionContractVersion: "document_router_pilot_v2" }));
  assert.notEqual(baseKey, documentPilotCacheKey({ ...baseIdentity, normalizationVersion: "document_pilot_normalization_v2" }));

  const exact = compareDocumentExtractions(native, extraction("nvidia", nativeFields));
  assert.equal(exact.classification, "exact_agreement");
  assert.equal(exact.establishesBusinessTruth, false);
  const mismatch = compareDocumentExtractions(native, extraction("nvidia", [field("Revenue", "kpi_name", "Revenue"), field("Revenue", "kpi_value", "12000")]));
  assert.equal(mismatch.classification, "critical_disagreement");
  assert.equal(mismatch.reviewRequired, true);
  assert.ok(mismatch.fieldResults.every((item) => /^[a-f0-9]{64}$/.test(item.identityHash)), "Agreement output exposes hashes rather than field identities");

  const noncritical = compareDocumentExtractions(
    extraction("native", [field("Revenue", "page", "1", false)]),
    extraction("nvidia", [field("Revenue", "page", "2", false)])
  );
  assert.equal(noncritical.classification, "noncritical_disagreement");

  const dual = await runDocumentIngestionPilot(runOptions({
    input: lowQualityInput,
    bytes: Buffer.concat([PDF_MAGIC, Buffer.from("dual-critical-disagreement")]),
    native,
    pilotConfig: config("dual_extraction_comparison"),
    coordinator: new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache()),
    nvidiaExtractor: async () => extraction("nvidia", [field("Revenue", "kpi_name", "Revenue"), field("Revenue", "kpi_value", "12000")])
  }));
  assert.equal(dual.agreement.classification, "critical_disagreement");
  assert.equal(dual.reviewRequired, true);
  assert.equal(dual.authorityDisposition, "preview_only_no_authoritative_write");

  const breaker = new DocumentPilotCircuitBreaker(1, 60_000);
  let breakerCalls = 0;
  const breakerCoordinator = new DocumentPilotExtractionCoordinator(new MemoryDocumentPilotCache());
  const breakerOptions = runOptions({
    input: assessmentInput("png", { pageCount: 1 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("breaker")]),
    coordinator: breakerCoordinator,
    circuitBreaker: breaker,
    nvidiaExtractor: async () => {
      breakerCalls += 1;
      return extraction("nvidia", [], { status: "failed", validationResult: "invalid", failureCode: "provider_unavailable", providerCalls: 1, successfulCalls: 0, failedCalls: 1 });
    }
  });
  await runDocumentIngestionPilot(breakerOptions);
  await runDocumentIngestionPilot({ ...breakerOptions, documentBytes: Buffer.concat([PNG_MAGIC, Buffer.from("breaker-second")]) });
  assert.equal(breakerCalls, 1, "Open circuit prevents a second provider call");

  const dryRun = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("png", { pageCount: 1 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("dry-run")]),
    pilotConfig: config("routing_dry_run"),
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.equal(dryRun.routed.decision.execution, "pilot_dry_run");
  assert.equal(dryRun.telemetry.providerCalls, 0);
  const costOnly = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("png", { pageCount: 4 }),
    bytes: Buffer.concat([PNG_MAGIC, Buffer.from("cost-only")]),
    pilotConfig: config("cost_only_measurement"),
    nvidiaExtractor: async () => { calls += 1; return extraction("nvidia"); }
  }));
  assert.equal(costOnly.routed.decision.execution, "pilot_cost_only");
  assert.equal(costOnly.telemetry.providerCalls, 0);
  assert.equal(costOnly.telemetry.pagesSentToNvidia, 0);
  assert.equal(costOnly.telemetry.costBasis, "projected_eligible_usage");
  assert.equal(costOnly.telemetry.costBasisPages, 4);
  assert.equal(costOnly.telemetry.estimatedCostUsd, 0.04);

  const telemetryJson = JSON.stringify(image.telemetry);
  assert.doesNotMatch(telemetryJson, /workspace-a|Executive KPI|Revenue|120000|filename|prompt|authorization|apiKey/i);
  assert.equal(image.telemetry.costEstimateKind, "configured_planning_estimate");
  const unknownCost = await runDocumentIngestionPilot(runOptions({
    input: assessmentInput("pdf", nativeObservations()),
    bytes: Buffer.concat([PDF_MAGIC, Buffer.from("unknown-cost")]),
    native,
    pilotConfig: config("routing_dry_run", { planningCostPerPageUsd: null, planningCostPerCallUsd: null })
  }));
  assert.equal(unknownCost.telemetry.costEstimateKind, "unknown");
  assert.equal(unknownCost.telemetry.estimatedCostUsd, null);
  const aggregate = aggregateDocumentPilotTelemetry([image.telemetry, cached.telemetry, cleanPdf.telemetry]);
  assert.equal(aggregate.documents, 3);
  assert.ok(aggregate.uploadsBypassingNvidiaPercent > 0);
  assert.ok(aggregate.cacheHitRate > 0);
  assert.equal(aggregate.estimatedCostPer100PagesUsd, 1);

  for (const outcome of [csv, xlsx, cleanPdf, cleanDocx, image, lowQuality, production, unauthorized, nonsynthetic, fallback, retried, firstConcurrent, secondConcurrent, cached, dryRun, costOnly]) {
    assert.equal(outcome.authorityDisposition, "preview_only_no_authoritative_write");
    assert.equal(outcome.routed.decision.writesAuthoritativeData, false);
  }

  const activeAuthorityFiles = [
    "app/app/files/actions.ts",
    "lib/ai/evidence-index.ts",
    "lib/intelligence/snapshot/v1/builder.ts",
    "lib/intelligence/business-health.ts",
    "lib/ai/business-notes/context.ts"
  ].filter((file) => fs.existsSync(path.join(root, file)));
  for (const file of activeAuthorityFiles) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /pilot-orchestrator|pilot-router|runDocumentIngestionPilot|nvidia-document-intelligence-poc/);
  }
  const activeFileAction = fs.readFileSync(path.join(root, "app/app/files/actions.ts"), "utf8");
  assert.match(activeFileAction, /validateUploadFileSafety/);
  assert.ok(activeFileAction.indexOf("validateUploadFileSafety") < activeFileAction.indexOf("runFileVaeroexAnalysis"), "Upload safety remains upstream of file analysis");
  const pilotFiles = fs.readdirSync(path.join(root, "lib/ai/document-intelligence-poc")).filter((file) => file.startsWith("pilot-") && file.endsWith(".ts"));
  const pilotSource = pilotFiles.map((file) => fs.readFileSync(path.join(root, "lib/ai/document-intelligence-poc", file), "utf8")).join("\n");
  assert.doesNotMatch(pilotSource, /createSupabase|supabase\.from\(|\.insert\(|\.upsert\(|business_memory|IntelligenceSnapshotV1|BusinessHealth/);
  assert.equal(fs.existsSync(path.join(root, "app/api/internal/nvidia-document-router-pilot/route.ts")), false);
  assert.equal(fs.existsSync(path.join(root, "app/app/admin/nvidia-document-router-pilot/page.tsx")), false);
  assert.match(pilotSource, /environment === "preview"/);
  assert.match(pilotSource, /environment === "production"/);
  assert.match(pilotSource, /syntheticOnly: true/);
  assert.match(fs.readFileSync(path.join(root, "lib/ai/document-intelligence-poc/pilot-official-adapter.ts"), "utf8"), /extractWithNvidiaMultimodalClient/);

  console.log("Document ingestion router pilot regressions passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
