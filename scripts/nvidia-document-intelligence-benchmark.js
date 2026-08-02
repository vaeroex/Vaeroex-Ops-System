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
  privacySafeDocumentIntelligenceReport,
  runDocumentIntelligencePocBenchmark
} = require("../lib/ai/document-intelligence-poc/benchmark.ts");
const nvidiaMode = process.argv.includes("--nvidia");

function outputPath() {
  const argument = process.argv.find((value) => value.startsWith("--output="));
  if (!argument) return null;
  const resolved = path.resolve(argument.slice("--output=".length));
  const temporaryRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  if (!resolved.startsWith(temporaryRoot)) {
    throw new Error("Document benchmark reports may be written only beneath the operating-system temporary directory.");
  }
  return resolved;
}

function assertExecutionBoundary() {
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("The NVIDIA document intelligence benchmark refuses Production.");
  }
  if (!nvidiaMode) return;
  if (!process.env.NVIDIA_API_KEY) {
    throw new Error("A non-Production NVIDIA_API_KEY is required for the explicit --nvidia benchmark.");
  }
}

async function main() {
  assertExecutionBoundary();
  const report = privacySafeDocumentIntelligenceReport(await runDocumentIntelligencePocBenchmark({ enableNvidia: nvidiaMode }));
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const destination = outputPath();
  if (destination) fs.writeFileSync(destination, serialized, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(serialized);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Document intelligence benchmark failed.");
  process.exitCode = 1;
});
