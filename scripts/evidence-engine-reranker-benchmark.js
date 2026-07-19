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

const { NvidiaTextReranker } = require("../lib/ai/evidence-engine/nvidia-text-reranker.ts");
const { EVIDENCE_ENGINE_FROZEN_FIXTURES } = require("../lib/ai/evidence-engine/benchmark-fixtures.ts");
const { runEvidenceEngineRerankerBenchmark } = require("../lib/ai/evidence-engine/benchmark.ts");

function assertSafeBenchmarkEnvironment() {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Evidence Engine reranker benchmarks refuse Production.");
  }
  if (process.env.VAEROEX_EVIDENCE_ENGINE_BENCHMARK_CONFIRM !== "preview") {
    throw new Error("Set VAEROEX_EVIDENCE_ENGINE_BENCHMARK_CONFIRM=preview to run frozen-fixture shadow evaluation.");
  }
  if (!process.env.NVIDIA_RERANK_API_KEY && !process.env.NVIDIA_API_KEY) {
    throw new Error("A server-side NVIDIA_RERANK_API_KEY or NVIDIA_API_KEY is required.");
  }
}

function boundedIterations() {
  const configured = Number.parseInt(process.env.EVIDENCE_ENGINE_RERANK_ITERATIONS || "5", 10);
  return Math.min(20, Math.max(1, Number.isFinite(configured) ? configured : 5));
}

async function main() {
  assertSafeBenchmarkEnvironment();
  const iterations = boundedIterations();
  const fixtures = Array.from({ length: iterations }, () => EVIDENCE_ENGINE_FROZEN_FIXTURES).flat();
  const report = await runEvidenceEngineRerankerBenchmark({
    reranker: new NvidiaTextReranker(),
    fixtures
  });
  const safeRuns = report.runs.map((run) => ({
    fixtureId: run.fixtureId,
    status: run.rerankResult.status,
    failureCode: run.rerankResult.failureCode,
    latencyMs: run.rerankResult.latencyMs,
    inputCount: run.rerankResult.inputCount,
    inputTokens: run.rerankResult.inputTokens,
    inputTokensEstimated: run.rerankResult.inputTokensEstimated,
    fallbackCorrect: run.fallbackCorrect
  }));

  console.log(JSON.stringify({
    benchmarkVersion: report.benchmarkVersion,
    model: "nvidia/llama-nemotron-rerank-1b-v2",
    mode: "shadow",
    frozenFixtureSet: true,
    iterations,
    fixtureRuns: report.fixtureCount,
    baseline: report.baseline,
    reranked: report.reranked,
    latency: report.latency,
    cost: report.cost,
    adapterFailures: report.adapterFailures,
    fallbackCorrectness: report.fallbackCorrectness,
    lifecycleExclusionAccuracy: report.lifecycleExclusionAccuracy,
    workspaceIsolationAccuracy: report.workspaceIsolationAccuracy,
    qualification: report.qualification,
    downstreamAnswerEvaluationRequiredBeforePromotion: true,
    readyForPromotion: false,
    runs: safeRuns
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Evidence Engine benchmark failed.");
  process.exitCode = 1;
});
