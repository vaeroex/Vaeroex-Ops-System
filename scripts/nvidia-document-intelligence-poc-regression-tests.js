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
const { loadDocumentIntelligenceFixtures } = require("../lib/ai/document-intelligence-poc/fixtures.ts");
const {
  buildNvidiaOcrRequest,
  NvidiaOcrBenchmarkAdapter,
  NVIDIA_OCR_MODEL,
  nvidiaDocumentIntelligencePocEnabled,
  privacySafeNvidiaOcrTelemetry
} = require("../lib/ai/document-intelligence-poc/nvidia-ocr.ts");
const { extractWithCurrentVaeroexPath } = require("../lib/ai/document-intelligence-poc/vaeroex-current.ts");

function withPreviewGates() {
  process.env.VERCEL_ENV = "preview";
  process.env.VAEROEX_NVIDIA_DOCUMENT_INTELLIGENCE_POC = "true";
  process.env.VAEROEX_NVIDIA_DOCUMENT_INTELLIGENCE_SHADOW = "true";
  process.env.VAEROEX_DOCUMENT_INTELLIGENCE_SHADOW_CONFIRM = "synthetic_benchmark";
  process.env.VAEROEX_DOCUMENT_INTELLIGENCE_BENCHMARK_MODE = "synthetic";
}

function fakeOcrResponse(document, mutateText) {
  return {
    model: NVIDIA_OCR_MODEL,
    data: document.groundTruth.map((page, pageIndex) => ({
      index: pageIndex,
      text_detections: page.elements.map((element) => ({
        text_prediction: { text: mutateText ? mutateText(element.rawText) : element.rawText, confidence: 0.99 },
        bounding_box: {
          points: [
            { x: element.boundingBox.xMin, y: element.boundingBox.yMin },
            { x: element.boundingBox.xMax, y: element.boundingBox.yMin },
            { x: element.boundingBox.xMax, y: element.boundingBox.yMax },
            { x: element.boundingBox.xMin, y: element.boundingBox.yMax }
          ]
        }
      }))
    })),
    usage: { images_size_mb: 0.1 }
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
    process.env.VAEROEX_NVIDIA_DOCUMENT_INTELLIGENCE_POC = "true";
    process.env.VAEROEX_NVIDIA_DOCUMENT_INTELLIGENCE_SHADOW = "true";
    process.env.VAEROEX_DOCUMENT_INTELLIGENCE_SHADOW_CONFIRM = "synthetic_benchmark";
    process.env.VAEROEX_DOCUMENT_INTELLIGENCE_BENCHMARK_MODE = "synthetic";
    assert.equal(nvidiaDocumentIntelligencePocEnabled(), false, "Production must remain hard-disabled");
    let providerCalls = 0;
    const disabled = await new NvidiaOcrBenchmarkAdapter({ apiKey: "test", fetchImpl: async () => { providerCalls += 1; throw new Error("unreachable"); } }).extract(fixtures[0]);
    assert.equal(disabled.status, "skipped");
    assert.equal(disabled.failureCode, "disabled");
    assert.equal(providerCalls, 0);

    withPreviewGates();
    assert.equal(nvidiaDocumentIntelligencePocEnabled(), true);
    const fixture = fixtures.find((item) => item.documentId === "synthetic-doc-executive-kpi-review");
    assert.ok(fixture);
    const request = buildNvidiaOcrRequest(fixture);
    assert.equal(request.input.length, 1);
    assert.ok(request.input[0].url.startsWith("data:image/png;base64,"));
    const serializedRequest = JSON.stringify(request);
    assert.doesNotMatch(serializedRequest, /workspace|customer|email|user_id|workspace_id/i);

    providerCalls = 0;
    const adapter = new NvidiaOcrBenchmarkAdapter({
      apiKey: "test",
      fetchImpl: async () => {
        providerCalls += 1;
        return new Response(JSON.stringify(fakeOcrResponse(fixture)), { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    const result = await adapter.extract(fixture);
    assert.equal(result.status, "success");
    assert.equal(providerCalls, 1);
    assert.equal(result.requestCount, 1);
    assert.equal(result.retryCount, 0);
    assert.equal(result.pages.length, 1);
    const comparison = compareDocumentExtraction(fixture, result);
    assert.equal(comparison.metrics.exactNumericAccuracy, 1);
    assert.equal(comparison.metrics.signAccuracy, 1);
    assert.equal(comparison.metrics.pageAssociationAccuracy, 1);
    assert.equal(comparison.metrics.boundingBoxCoverage, 1);
    assert.equal(comparison.metrics.boundingBoxCorrectness, 1);
    assert.deepEqual(comparison.catastrophicErrors, []);
    assert.equal(comparison.metrics.rowReconstructionAccuracy, null, "Standalone OCR must not claim table reconstruction");

    const firstKey = result.idempotencyKey;
    const second = await new NvidiaOcrBenchmarkAdapter({ apiKey: "test", fetchImpl: async () => new Response(JSON.stringify(fakeOcrResponse(fixture)), { status: 200 }) }).extract(fixture);
    assert.equal(second.idempotencyKey, firstKey, "Identical fixture and parser inputs must remain idempotent");

    let retryCalls = 0;
    const retried = await new NvidiaOcrBenchmarkAdapter({
      apiKey: "test",
      fetchImpl: async () => {
        retryCalls += 1;
        return retryCalls === 1 ? new Response("rate limited", { status: 429, headers: { "retry-after": "1" } }) : new Response(JSON.stringify(fakeOcrResponse(fixture)), { status: 200 });
      }
    }).extract(fixture);
    assert.equal(retried.status, "success");
    assert.equal(retryCalls, 2);
    assert.equal(retried.retryCount, 1);

    let malformedCalls = 0;
    const malformed = await new NvidiaOcrBenchmarkAdapter({
      apiKey: "test",
      fetchImpl: async () => { malformedCalls += 1; return new Response("{}", { status: 200 }); }
    }).extract(fixture);
    assert.equal(malformed.failureCode, "malformed_response");
    assert.equal(malformedCalls, 1, "Validation failures must not retry");

    const corrupted = fixtures.find((item) => item.documentId === "synthetic-doc-corrupted-image");
    assert.ok(corrupted);
    let corruptedCalls = 0;
    const corruptedResult = await new NvidiaOcrBenchmarkAdapter({ apiKey: "test", fetchImpl: async () => { corruptedCalls += 1; throw new Error("unreachable"); } }).extract(corrupted);
    assert.equal(corruptedResult.failureCode, "validation_failed");
    assert.equal(corruptedCalls, 0);

    const signChanged = await new NvidiaOcrBenchmarkAdapter({
      apiKey: "test",
      fetchImpl: async () => new Response(JSON.stringify(fakeOcrResponse(fixture, (text) => text.replace("-42", "42"))), { status: 200 })
    }).extract(fixture);
    assert.ok(compareDocumentExtraction(fixture, signChanged).catastrophicErrors.includes("numeric_sign_changed"));

    const telemetry = privacySafeNvidiaOcrTelemetry(result);
    const serializedTelemetry = JSON.stringify(telemetry);
    assert.doesNotMatch(serializedTelemetry, /Executive KPI|1-Star Reviews|base64|authorization|test/i);
    assert.equal(telemetry.status, "success");

    const baseline = await extractWithCurrentVaeroexPath(fixture);
    assert.equal(baseline.provider, "vaeroex");
    assert.equal(baseline.requestCount, 0);
    assert.equal(baseline.estimatedCostUsd, 0);

    const activeFiles = [
      "app/app/files/actions.ts",
      "lib/ai/evidence-index.ts",
      "lib/intelligence/snapshot/v1/builder.ts",
      "lib/intelligence/business-health.ts"
    ].filter((file) => fs.existsSync(path.join(root, file)));
    for (const file of activeFiles) {
      assert.doesNotMatch(fs.readFileSync(path.join(root, file), "utf8"), /document-intelligence-poc|NvidiaOcrBenchmarkAdapter/);
    }
    const pocSources = fs.readdirSync(path.join(root, "lib/ai/document-intelligence-poc")).filter((file) => file.endsWith(".ts"));
    const combined = pocSources.map((file) => fs.readFileSync(path.join(root, "lib/ai/document-intelligence-poc", file), "utf8")).join("\n");
    assert.doesNotMatch(combined, /createSupabase|supabase\.from\(|\.upsert\(|\.insert\(|@\/lib\/ai\/business-notes|@\/lib\/intelligence\/snapshot/);
    assert.match(combined, /writesBusinessMemory:\s*false/);
    assert.match(combined, /entersSnapshot:\s*false/);
    assert.doesNotMatch(combined, /console\.(?:log|error).*raw|Authorization.*console/i);

    console.log("NVIDIA document intelligence POC regressions passed.");
  } finally {
    process.env = originalEnv;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
