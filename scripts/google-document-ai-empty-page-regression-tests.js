const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const loaded = new Map();

function loadTypeScriptModule(relative) {
  if (loaded.has(relative)) return loaded.get(relative);
  const output = ts.transpileModule(
    fs.readFileSync(path.join(root, relative), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText;
  const module = { exports: {} };
  loaded.set(relative, module.exports);
  const localRequire = (specifier) => {
    if (specifier === "server-only") return {};
    if (specifier.startsWith("@/")) return loadTypeScriptModule(`${specifier.slice(2)}.ts`);
    return require(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  loaded.set(relative, module.exports);
  return module.exports;
}

const {
  buildNormalizedDocumentExtractionArtifactV2,
  parseAnyNormalizedDocumentExtractionArtifact
} = loadTypeScriptModule(
  "lib/document-extraction/artifact.ts"
);

function emptyPageDraft() {
  return {
    route: "google_primary",
    documentClass: "image_only_pdf",
    pageCount: 1,
    pages: [{
      page: 1,
      blocks: [],
      structure: {
        structureVersion: "provider_neutral_document_structure_v1",
        pageLayout: {
          text: "",
          textSegments: [],
          confidence: null,
          orientation: "PAGE_UP",
          coordinates: { page: 1, x: 0, y: 0, width: 1, height: 1 },
          polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 }
          ]
        },
        detectedLanguages: [],
        blocks: [],
        paragraphs: [],
        lines: [],
        tokens: [],
        tables: [],
        selectionMarks: [],
        imageQuality: { qualityScore: 1, detectedDefects: [] }
      }
    }],
    criticalFields: [],
    validationFindings: []
  };
}

function nonEmptyPageDraft() {
  const layout = () => ({
    text: "A",
    textSegments: [{ start: 0, end: 1 }],
    confidence: 1,
    orientation: "PAGE_UP",
    coordinates: { page: 1, x: 0, y: 0, width: 1, height: 1 },
    polygon: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ]
  });
  const element = (kind) => ({
    id: `page-1-${kind}-1`,
    kind,
    layout: layout(),
    detectedLanguages: []
  });
  return {
    route: "google_primary",
    documentClass: "image_only_pdf",
    pageCount: 1,
    pages: [{
      page: 1,
      blocks: [{
        id: "page-1-element-1",
        kind: "text",
        text: "A",
        coordinates: { page: 1, x: 0, y: 0, width: 1, height: 1 }
      }],
      structure: {
        structureVersion: "provider_neutral_document_structure_v1",
        pageLayout: layout(),
        detectedLanguages: [],
        blocks: [element("block")],
        paragraphs: [element("paragraph")],
        lines: [element("line")],
        tokens: [{ ...element("token"), detectedBreak: null }],
        tables: [],
        selectionMarks: [],
        imageQuality: { qualityScore: 1, detectedDefects: [] }
      }
    }],
    criticalFields: [],
    validationFindings: []
  };
}

const accepted = buildNormalizedDocumentExtractionArtifactV2(emptyPageDraft());
assert.equal(accepted.pages[0].blocks.length, 0);
assert.equal(accepted.pages[0].structure.pageLayout.text, "");
assert.deepEqual(parseAnyNormalizedDocumentExtractionArtifact(accepted), accepted);

const nonEmpty = buildNormalizedDocumentExtractionArtifactV2(nonEmptyPageDraft());
assert.equal(nonEmpty.pages[0].blocks[0].text, "A");
assert.deepEqual(parseAnyNormalizedDocumentExtractionArtifact(nonEmpty), nonEmpty);

for (const mutate of [
  (draft) => { draft.pages[0].structure.pageLayout.text = "conflict"; },
  (draft) => { draft.pages[0].structure.detectedLanguages = [{ languageCode: "en", confidence: 1 }]; },
  (draft) => { draft.pages[0].structure.blocks = [{}]; },
  (draft) => { draft.pages[0].structure.tables = [{}]; }
]) {
  const draft = emptyPageDraft();
  mutate(draft);
  assert.throws(() => buildNormalizedDocumentExtractionArtifactV2(draft));
}

console.log("Google Document AI blank-page and non-empty artifact regressions passed.");
