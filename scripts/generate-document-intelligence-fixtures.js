const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const fixtureRoot = path.join(root, "lib", "ai", "document-intelligence-poc", "fixtures");
const generatedRoot = path.join(fixtureRoot, "generated");

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
  DOCUMENT_INTELLIGENCE_FIXTURE_SPECS
} = require("../lib/ai/document-intelligence-poc/fixture-specs.ts");

function rotatedBox(box, rotation) {
  const [xMin, yMin, xMax, yMax] = box;
  if (rotation === 90) return [1 - yMax, xMin, 1 - yMin, xMax];
  if (rotation === 180) return [1 - xMax, 1 - yMax, 1 - xMin, 1 - yMin];
  if (rotation === 270) return [yMin, 1 - xMax, yMax, 1 - xMin];
  return box;
}

function normalizedText(value) {
  return value.normalize("NFKC").replace(/[\u2012\u2013\u2014\u2212]/g, "-").replace(/\s+/g, " ").trim();
}

function groundTruthForSpec(spec) {
  return spec.pages.map((page, pageIndex) => {
    const rotated = page.rotation === 90 || page.rotation === 270;
    return {
      pageNumber: pageIndex + 1,
      width: rotated ? page.height : page.width,
      height: rotated ? page.width : page.height,
      rotation: page.rotation,
      elements: page.elements.map((element, readingOrderIndex) => {
        const [xMin, yMin, xMax, yMax] = rotatedBox(element.box, page.rotation);
        return {
          elementId: element.id,
          elementType: element.type,
          rawText: element.text,
          normalizedText: normalizedText(element.text),
          boundingBox: { xMin, yMin, xMax, yMax },
          confidence: 1,
          readingOrderIndex,
          sectionIdentity: element.section || null,
          headingLevel: element.headingLevel || null,
          paragraphIdentity: element.type === "paragraph" ? element.id : null,
          tableId: element.tableId || null,
          tableTitle: element.tableTitle || null,
          rowIndex: Number.isInteger(element.rowIndex) ? element.rowIndex : null,
          columnIndex: Number.isInteger(element.columnIndex) ? element.columnIndex : null,
          rowSpan: element.rowSpan || null,
          columnSpan: element.columnSpan || null,
          headerAssociation: element.headerAssociation || null,
          displayedNumericText: element.numericText || null,
          normalizedNumericValue: Number.isFinite(element.numericValue) ? element.numericValue : null,
          sign: element.sign || null,
          decimalPrecision: Number.isInteger(element.decimalPrecision) ? element.decimalPrecision : null,
          currency: element.currency || null,
          percentage: Number.isFinite(element.percentage) ? element.percentage : null,
          unit: element.unit || null,
          date: element.date || null,
          reportingPeriod: element.reportingPeriod || null,
          kpiName: element.kpiName || null,
          kpiValue: Number.isFinite(element.kpiValue) ? element.kpiValue : null,
          kpiTarget: Number.isFinite(element.kpiTarget) ? element.kpiTarget : null,
          chartOrFigureReference: element.chartReference || null,
          sourceCoordinates: { xMin, yMin, xMax, yMax },
          extractionWarnings: [],
          provenance: {
            benchmarkDocumentId: spec.documentId,
            benchmarkOnly: true,
            synthetic: true,
            sourcePage: pageIndex + 1,
            sourceElementId: element.id,
            parser: "ground_truth"
          }
        };
      })
    };
  });
}

function pythonBinary() {
  const argument = process.argv.find((value) => value.startsWith("--python="));
  return argument ? argument.slice("--python=".length) : process.env.VAEROEX_FIXTURE_PYTHON || "python3";
}

function main() {
  process.stderr.write("Preparing deterministic document fixtures.\n");
  const specsOutput = process.argv.find((value) => value.startsWith("--specs-output="));
  if (specsOutput) {
    fs.writeFileSync(path.resolve(specsOutput.slice("--specs-output=".length)), JSON.stringify(DOCUMENT_INTELLIGENCE_FIXTURE_SPECS));
    return;
  }
  fs.mkdirSync(generatedRoot, { recursive: true });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-document-fixtures-"));
  try {
    const specPath = path.join(temporaryRoot, "fixture-specs.json");
    fs.writeFileSync(specPath, JSON.stringify(DOCUMENT_INTELLIGENCE_FIXTURE_SPECS));
    execFileSync(pythonBinary(), [
      path.join(__dirname, "render-document-intelligence-fixtures.py"),
      specPath,
      generatedRoot,
      temporaryRoot
    ], { stdio: "inherit" });
    process.stderr.write("Rendered deterministic document fixtures.\n");

    const manifest = DOCUMENT_INTELLIGENCE_FIXTURE_SPECS.map((spec) => ({
      documentId: spec.documentId,
      title: spec.title,
      inputFormat: spec.inputFormat,
      sourceFile: `${spec.documentId}.${spec.sourceMode === "jpeg" ? "jpg" : spec.sourceMode === "png" || spec.sourceMode === "corrupted_png" ? "png" : "pdf"}`,
      renderedPageFiles: spec.pages.map((_, pageIndex) => `${spec.documentId}-page-${pageIndex + 1}.png`),
      documentClasses: spec.documentClasses,
      groundTruth: groundTruthForSpec(spec)
    }));
    fs.writeFileSync(path.join(fixtureRoot, "ground-truth.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ fixtureCount: manifest.length, pageCount: manifest.reduce((sum, item) => sum + item.groundTruth.length, 0) })}\n`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Fixture generation failed.");
  process.exitCode = 1;
}
