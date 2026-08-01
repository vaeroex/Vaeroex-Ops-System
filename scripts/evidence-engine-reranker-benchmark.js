const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
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

const {
  NvidiaTextReranker,
  nvidiaTextRerankerShadowEnabled
} = require("../lib/ai/evidence-engine/nvidia-text-reranker.ts");
const { NVIDIA_RERANKER_POC_FIXTURES } = require("../lib/ai/evidence-engine/reranker-poc-fixtures.ts");
const {
  privacySafeRerankerPocReport,
  runNvidiaRerankerPocBenchmark
} = require("../lib/ai/evidence-engine/benchmark.ts");

const baselineOnly = process.argv.includes("--baseline-only");
const detailedReport = process.argv.includes("--detailed");

const baselineOnlyReranker = {
  id: "baseline_only",
  version: "baseline_only_v1",
  provider: "deterministic",
  model: "deterministic",
  async rerank({ candidates, mode }) {
    return {
      version: "rerank_result_v1",
      adapterId: this.id,
      adapterVersion: this.version,
      provider: this.provider,
      model: this.model,
      mode,
      status: "skipped",
      rankings: [],
      inputCount: candidates.length,
      inputTokens: 0,
      inputTokensEstimated: false,
      latencyMs: 0,
      failureCode: "disabled"
    };
  }
};

function assertSafeBenchmarkEnvironment() {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Evidence Engine reranker benchmarks refuse Production.");
  }
  if (baselineOnly) return;
  if (!nvidiaTextRerankerShadowEnabled()) {
    throw new Error(
      "Enable the explicit synthetic POC, shadow, confirmation, and benchmark-mode gates before calling NVIDIA."
    );
  }
  if (!process.env.NVIDIA_RERANK_API_KEY && !process.env.NVIDIA_API_KEY) {
    throw new Error("A server-side NVIDIA_RERANK_API_KEY or NVIDIA_API_KEY is required.");
  }
}

function boundedIterations() {
  const configured = Number.parseInt(process.env.EVIDENCE_ENGINE_RERANK_ITERATIONS || "1", 10);
  return Math.min(20, Math.max(1, Number.isFinite(configured) ? configured : 5));
}

function outputPath() {
  const argument = process.argv.find((value) => value.startsWith("--output="));
  if (!argument) return null;
  const resolved = path.resolve(argument.slice("--output=".length));
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolved.startsWith(temporaryRoot)) {
    throw new Error("Benchmark reports may be written only beneath the operating-system temporary directory.");
  }
  return resolved;
}

async function main() {
  assertSafeBenchmarkEnvironment();
  const iterations = boundedIterations();
  const fixtures = Array.from({ length: iterations }, () => NVIDIA_RERANKER_POC_FIXTURES).flat();
  const report = await runNvidiaRerankerPocBenchmark({
    reranker: baselineOnly ? baselineOnlyReranker : new NvidiaTextReranker(),
    fixtures
  });
  const privacySafeReport = privacySafeRerankerPocReport(report);
  const { runs, ...aggregateReport } = privacySafeReport;
  const safeReport = {
    executionMode: baselineOnly ? "baseline_only" : "nvidia_shadow",
    model: baselineOnly ? "deterministic" : "nvidia/llama-nemotron-rerank-1b-v2",
    syntheticFixtureSet: true,
    iterations,
    detailedReport,
    ...aggregateReport,
    ...(detailedReport ? { runs } : {})
  };
  const serialized = `${JSON.stringify(safeReport, null, 2)}\n`;
  const destination = outputPath();
  if (destination) fs.writeFileSync(destination, serialized, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(serialized);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Evidence Engine benchmark failed.");
  process.exitCode = 1;
});
