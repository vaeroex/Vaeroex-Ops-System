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

const { compareDocumentExtraction } = require("../lib/ai/document-intelligence-poc/comparison.ts");
const { recommendDocumentClass } = require("../lib/ai/document-intelligence-poc/benchmark.ts");
const { loadDocumentIntelligenceFixtures } = require("../lib/ai/document-intelligence-poc/fixtures.ts");
const {
  extractWithNvidiaMultimodalClient,
  NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION,
  NVIDIA_MULTIMODAL_EXTRACTION_MODEL,
  nvidiaDocumentIntelligenceBenchmarkAllowed,
  privacySafeNvidiaMultimodalTelemetry
} = require("../lib/ai/document-intelligence-poc/nvidia-multimodal-extraction.ts");
const { extractWithCurrentVaeroexPath } = require("../lib/ai/document-intelligence-poc/vaeroex-current.ts");

function officialOutput(documents, mutateText = (text) => text) {
  return {
    contractVersion: "vaeroex_nemo_retriever_bridge_v1",
    clientRevision: NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION,
    clientVersion: "official-client-test",
    model: NVIDIA_MULTIMODAL_EXTRACTION_MODEL,
    contractProfile: "hosted_tool_call",
    documents: documents.map((document) => ({
      documentId: document.documentId,
      status: "success",
      pages: document.groundTruth.map((page) => ({
        pageNumber: page.pageNumber,
        text: page.elements.map((element) => mutateText(element.rawText)).join("\n\n"),
        tables: [],
        charts: [],
        infographics: []
      })),
      latencyMs: 10,
      requestCount: document.renderedPages.length,
      retryCount: 0,
      failureCode: null,
      statusCode: null,
      retryAfterPresent: false
    }))
  };
}

async function main() {
  const originalEnv = { ...process.env };
  try {
    const fixtures = await loadDocumentIntelligenceFixtures();
    assert.equal(fixtures.length, 12);
    assert.equal(fixtures.reduce((sum, fixture) => sum + fixture.renderedPages.length, 0), 13);
    assert.ok(fixtures.every((fixture) => fixture.documentId.startsWith("synthetic-doc-")));
    assert.ok(fixtures.every((fixture) => fixture.groundTruth.every((page) => page.elements.every((element) => element.provenance.synthetic && element.provenance.benchmarkOnly))));

    process.env.VERCEL_ENV = "production";
    assert.equal(nvidiaDocumentIntelligenceBenchmarkAllowed(true), false, "Production must remain hard-disabled");
    let runnerCalls = 0;
    const disabled = await extractWithNvidiaMultimodalClient([fixtures[0]], {
      enabled: true,
      runner: async () => {
        runnerCalls += 1;
        throw new Error("unreachable");
      }
    });
    assert.equal(disabled.results[0].status, "skipped");
    assert.equal(disabled.results[0].failureCode, "disabled");
    assert.equal(runnerCalls, 0);

    process.env.VERCEL_ENV = "preview";
    delete process.env.NVIDIA_API_KEY;
    assert.equal(nvidiaDocumentIntelligenceBenchmarkAllowed(true), true);
    const fixture = fixtures.find((item) => item.documentId === "synthetic-doc-executive-kpi-review");
    assert.ok(fixture);

    let observedManifest;
    const extraction = await extractWithNvidiaMultimodalClient([fixture], {
      enabled: true,
      runner: async (manifest) => {
        runnerCalls += 1;
        observedManifest = manifest;
        assert.equal(manifest.documents.length, 1);
        assert.ok(manifest.documents[0].pagePaths.every((pagePath) => fs.existsSync(pagePath)));
        return officialOutput([fixture]);
      }
    });
    assert.equal(extraction.results[0].status, "success");
    assert.equal(extraction.results[0].requestCount, 1);
    assert.equal(extraction.results[0].retryCount, 0);
    assert.equal(extraction.results[0].pages.length, 1);
    assert.equal(extraction.parserQualification.outputContractObserved, true);
    assert.equal(extraction.parserQualification.requestCount, 0, "Parser qualification reuses extraction and adds no provider request");
    const serializedManifest = JSON.stringify(observedManifest);
    assert.doesNotMatch(serializedManifest, /workspace|customer|email|user_id|workspace_id/i);
    assert.doesNotMatch(serializedManifest, /base64|authorization|api[_-]?key/i);

    const comparison = compareDocumentExtraction(fixture, extraction.results[0]);
    assert.equal(comparison.metrics.exactNumericAccuracy, 1);
    assert.equal(comparison.metrics.signAccuracy, 1);
    assert.equal(comparison.metrics.pageAssociationAccuracy, 1);
    assert.deepEqual(comparison.catastrophicErrors, []);

    const second = await extractWithNvidiaMultimodalClient([fixture], {
      enabled: true,
      runner: async () => officialOutput([fixture])
    });
    assert.equal(second.results[0].idempotencyKey, extraction.results[0].idempotencyKey, "Identical fixture and official-client inputs must remain idempotent");

    const unavailable = await extractWithNvidiaMultimodalClient([fixture], {
      enabled: true,
      runner: async () => { throw new Error("provider response intentionally unavailable"); }
    });
    assert.equal(unavailable.results[0].failureCode, "client_unavailable");
    const unavailableComparison = compareDocumentExtraction(fixture, unavailable.results[0]);
    assert.ok(Object.values(unavailableComparison.metrics).every((metric) => metric === null));
    assert.deepEqual(unavailableComparison.catastrophicErrors, [], "Client failures remain unscored");
    assert.equal(recommendDocumentClass({
      documentClass: "clean_digital_pdf",
      current: unavailableComparison.metrics,
      nvidia: unavailableComparison.metrics,
      nvidiaComparisons: [unavailableComparison]
    }), "BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE");

    const malformed = await extractWithNvidiaMultimodalClient([fixture], {
      enabled: true,
      runner: async () => ({ ...officialOutput([fixture]), contractProfile: "legacy_prompt" })
    });
    assert.equal(malformed.results[0].failureCode, "client_unavailable", "Unexpected official-client contracts fail closed");

    const corrupted = fixtures.find((item) => item.documentId === "synthetic-doc-corrupted-image");
    assert.ok(corrupted);
    let corruptedCalls = 0;
    const corruptedResult = await extractWithNvidiaMultimodalClient([corrupted], {
      enabled: true,
      runner: async () => {
        corruptedCalls += 1;
        throw new Error("unreachable");
      }
    });
    assert.equal(corruptedResult.results[0].failureCode, "validation_failed");
    assert.equal(corruptedCalls, 0);
    const corruptedComparison = compareDocumentExtraction(corrupted, corruptedResult.results[0]);
    assert.ok(Object.values(corruptedComparison.metrics).every((metric) => metric === null));
    assert.equal(recommendDocumentClass({
      documentClass: "corrupted_page",
      current: corruptedComparison.metrics,
      nvidia: corruptedComparison.metrics,
      nvidiaComparisons: [corruptedComparison]
    }), "REJECT FOR THIS DOCUMENT CLASS");

    const signChanged = await extractWithNvidiaMultimodalClient([fixture], {
      enabled: true,
      runner: async () => officialOutput([fixture], (text) => text.replace("-42", "42"))
    });
    assert.ok(compareDocumentExtraction(fixture, signChanged.results[0]).catastrophicErrors.includes("numeric_sign_changed"));

    const telemetry = privacySafeNvidiaMultimodalTelemetry(extraction.results[0]);
    const serializedTelemetry = JSON.stringify(telemetry);
    assert.doesNotMatch(serializedTelemetry, /Executive KPI|1-Star Reviews|base64|authorization|workspace|customer|email/i);
    assert.equal(telemetry.status, "success");
    assert.equal(telemetry.endpointCategory, "hosted_multimodal_extraction");

    const baseline = await extractWithCurrentVaeroexPath(fixture);
    assert.equal(baseline.provider, "vaeroex");
    assert.equal(baseline.requestCount, 0);
    assert.equal(baseline.estimatedCostUsd, 0);

    const requirements = fs.readFileSync(path.join(root, "scripts/requirements-nvidia-document-intelligence-poc.txt"), "utf8");
    assert.match(requirements, new RegExp(NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION));
    assert.match(requirements, /NVIDIA\/NeMo-Retriever\.git/);
    const installer = fs.readFileSync(path.join(root, "scripts/install-nvidia-document-intelligence-poc-client.sh"), "utf8");
    assert.match(installer, /Python 3\.12/);
    assert.match(installer, /--require-virtualenv/);
    assert.match(installer, /SOURCE_DATE_EPOCH=/);
    assert.match(installer, /RETRIEVER_BUILD_NUMBER=/);
    assert.match(installer, new RegExp(NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION));
    const bridge = fs.readFileSync(path.join(root, "scripts/nvidia-document-intelligence-official-client.py"), "utf8");
    assert.match(bridge, /from nemo_retriever import create_ingestor/);
    assert.match(bridge, /ExtractParams/);
    assert.match(bridge, /method="nemotron_parse"/);
    assert.match(bridge, /nvidia\/nemotron-parse/);
    assert.match(bridge, /hosted_tool_call/);
    assert.doesNotMatch(bridge, /\b(?:requests|httpx|urllib)\b/);

    assert.equal(fs.existsSync(path.join(root, "lib/ai/document-intelligence-poc/nvidia-ocr.ts")), false);
    assert.equal(fs.existsSync(path.join(root, "lib/ai/document-intelligence-poc/nvidia-document-parser.ts")), false);
    const activeFiles = [
      "app/app/files/actions.ts",
      "lib/ai/evidence-index.ts",
      "lib/intelligence/snapshot/v1/builder.ts",
      "lib/intelligence/business-health.ts"
    ].filter((file) => fs.existsSync(path.join(root, file)));
    for (const file of activeFiles) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /document-intelligence-poc|nvidia-multimodal-extraction/);
    }
    const pocSources = fs.readdirSync(path.join(root, "lib/ai/document-intelligence-poc")).filter((file) => file.endsWith(".ts"));
    const combined = pocSources.map((file) => fs.readFileSync(path.join(root, "lib/ai/document-intelligence-poc", file), "utf8")).join("\n");
    assert.doesNotMatch(combined, /createSupabase|supabase\.from\(|\.upsert\(|\.insert\(|@\/lib\/ai\/business-notes|@\/lib\/intelligence\/snapshot/);
    assert.match(combined, /writesBusinessMemory:\s*false/);
    assert.match(combined, /entersSnapshot:\s*false/);
    assert.doesNotMatch(combined, /console\.(?:log|error).*raw|Authorization.*console/i);
    assert.doesNotMatch(combined, /VAEROEX_NVIDIA_DOCUMENT_INTELLIGENCE|DOCUMENT_INTELLIGENCE_SHADOW_CONFIRM/);
    assert.equal(fs.existsSync(path.join(root, "app/api/internal/nvidia-document-intelligence-poc/route.ts")), false);

    console.log("NVIDIA document intelligence POC regressions passed.");
  } finally {
    process.env = originalEnv;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
