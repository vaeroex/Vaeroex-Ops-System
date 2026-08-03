import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertBenchmarkDocument,
  type BenchmarkDocument,
  type NormalizedDocumentPage
} from "@/lib/ai/document-intelligence-poc/contracts";

type FixtureManifestEntry = Readonly<{
  documentId: string;
  title: string;
  inputFormat: BenchmarkDocument["inputFormat"];
  sourceFile: string;
  renderedPageFiles: readonly string[];
  documentClasses: BenchmarkDocument["documentClasses"];
  groundTruth: readonly NormalizedDocumentPage[];
}>;

const FIXTURE_ROOT = path.join(process.cwd(), "lib", "ai", "document-intelligence-poc", "fixtures");
const GENERATED_ROOT = path.join(FIXTURE_ROOT, "generated");

function fixturePath(fileName: string) {
  if (!/^synthetic-doc-[a-z0-9-]+(?:-page-\d+)?\.(?:pdf|png|jpg)$/.test(fileName)) {
    throw new Error("The document intelligence fixture path is not approved.");
  }
  return path.join(GENERATED_ROOT, fileName);
}
function imageMimeType(fileName: string) {
  return fileName.endsWith(".jpg") ? "image/jpeg" as const : "image/png" as const;
}

export function validBenchmarkImageBytes(bytes: Buffer, mimeType: "image/png" | "image/jpeg") {
  if (mimeType === "image/png") {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

export async function loadDocumentIntelligenceFixtureManifest() {
  const raw = await readFile(path.join(FIXTURE_ROOT, "ground-truth.json"), "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.length) {
    throw new Error("The document intelligence ground-truth manifest is missing.");
  }
  return parsed as readonly FixtureManifestEntry[];
}

export async function loadDocumentIntelligenceFixtures(): Promise<readonly BenchmarkDocument[]> {
  const manifest = await loadDocumentIntelligenceFixtureManifest();
  const documents: BenchmarkDocument[] = [];

  for (const fixture of manifest) {
    const sourceBytes = await readFile(fixturePath(fixture.sourceFile));
    const renderedPages = await Promise.all(fixture.renderedPageFiles.map(async (fileName, pageIndex) => {
      const bytes = await readFile(fixturePath(fileName));
      const mimeType = imageMimeType(fileName);
      if (!validBenchmarkImageBytes(bytes, mimeType)) {
        throw new Error("A rendered benchmark page is not a valid approved image.");
      }
      const truth = fixture.groundTruth[pageIndex];
      if (!truth) throw new Error("Rendered benchmark page has no ground truth.");
      return {
        pageNumber: pageIndex + 1,
        width: truth.width,
        height: truth.height,
        rotation: truth.rotation,
        mimeType,
        bytes
      };
    }));
    const document: BenchmarkDocument = {
      documentId: fixture.documentId,
      title: fixture.title,
      inputFormat: fixture.inputFormat,
      documentClasses: fixture.documentClasses,
      sourceBytes,
      renderedPages,
      groundTruth: fixture.groundTruth
    };
    assertBenchmarkDocument(document);
    documents.push(document);
  }
  return documents;
}

export async function documentIntelligenceFixtureMetadata() {
  const manifest = await loadDocumentIntelligenceFixtureManifest();
  return manifest.map((fixture) => ({
    documentId: fixture.documentId,
    inputFormat: fixture.inputFormat,
    pageCount: fixture.groundTruth.length,
    documentClasses: fixture.documentClasses
  }));
}
