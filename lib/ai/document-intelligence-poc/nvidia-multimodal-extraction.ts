import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  DOCUMENT_EXTRACTION_RESULT_VERSION,
  DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION,
  DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION,
  documentExtractionIdempotencyKey,
  hashDocument,
  validBoundingBox,
  type BenchmarkDocument,
  type DocumentBoundingBox,
  type DocumentExtractionFailureCode,
  type DocumentExtractionResult,
  type NormalizedDocumentElement,
  type PrivacySafeProviderTelemetry
} from "@/lib/ai/document-intelligence-poc/contracts";
import { validBenchmarkImageBytes } from "@/lib/ai/document-intelligence-poc/fixtures";
import { normalizedElementFromText } from "@/lib/ai/document-intelligence-poc/normalization";

export const NVIDIA_MULTIMODAL_EXTRACTION_MODEL = "nvidia/nemotron-parse";
export const NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION = "52886112cafab4c4bca1cda0d4f588785adfe4d3";
export const NVIDIA_MULTIMODAL_EXTRACTION_ADAPTER_VERSION = "nemo_retriever_multimodal_extraction_v1";
export const NVIDIA_MULTIMODAL_EXTRACTION_MAX_PAGES = 16;
const BRIDGE_CONTRACT_VERSION = "vaeroex_nemo_retriever_bridge_v1";
const MAX_BRIDGE_OUTPUT_BYTES = 8_000_000;

type OfficialElement = Readonly<{
  text: string;
  boundingBox: readonly [number, number, number, number] | null;
}>;

type OfficialPage = Readonly<{
  pageNumber: number;
  text: string;
  tables: readonly OfficialElement[];
  charts: readonly OfficialElement[];
  infographics: readonly OfficialElement[];
}>;

type OfficialDocumentResult = Readonly<{
  documentId: string;
  status: "success" | "failed";
  pages: readonly OfficialPage[];
  latencyMs: number;
  requestCount: number;
  retryCount: number;
  failureCode: Exclude<DocumentExtractionFailureCode, "disabled" | "missing_credentials" | "unsafe_benchmark_input" | null> | null;
  statusCode: number | null;
  retryAfterPresent: boolean;
}>;

export type OfficialClientBridgeOutput = Readonly<{
  contractVersion: typeof BRIDGE_CONTRACT_VERSION;
  clientRevision: typeof NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION;
  clientVersion: string;
  model: typeof NVIDIA_MULTIMODAL_EXTRACTION_MODEL;
  contractProfile: "hosted_tool_call";
  documents: readonly OfficialDocumentResult[];
}>;

type OfficialClientRunner = (input: Readonly<{
  benchmarkVersion: typeof DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION;
  documents: readonly Readonly<{
    documentId: string;
    pagePaths: readonly string[];
  }>[];
}>) => Promise<OfficialClientBridgeOutput>;

export type NvidiaDocumentParserQualification = Readonly<{
  provider: "nvidia";
  model: typeof NVIDIA_MULTIMODAL_EXTRACTION_MODEL;
  endpointCategory: "hosted_multimodal_extraction";
  status: "available" | "blocked" | "failed" | "skipped";
  requestCount: 0;
  latencyMs: number;
  statusCode: number | null;
  failureCode: DocumentExtractionFailureCode;
  outputContractObserved: boolean;
  officialClientRevision: typeof NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION;
  supportedCapabilities: readonly ["text", "bounding_boxes", "reading_order", "headings", "sections", "tables", "charts"];
  unqualifiedCapabilities: readonly ["merged_cells"];
}>;

export function nvidiaDocumentIntelligenceBenchmarkAllowed(enabled: boolean) {
  return enabled && process.env.VERCEL_ENV !== "production";
}

function failureResult(
  document: BenchmarkDocument,
  status: "failed" | "skipped",
  failureCode: Exclude<DocumentExtractionFailureCode, null>,
  fields: Readonly<{
    latencyMs?: number;
    requestCount?: number;
    retryCount?: number;
    statusCode?: number | null;
    retryAfterPresent?: boolean;
  }> = {}
): DocumentExtractionResult {
  const documentHash = hashDocument(document.sourceBytes);
  return {
    version: DOCUMENT_EXTRACTION_RESULT_VERSION,
    parser: "nvidia_multimodal_extraction",
    parserVersion: NVIDIA_MULTIMODAL_EXTRACTION_ADAPTER_VERSION,
    provider: "nvidia",
    model: NVIDIA_MULTIMODAL_EXTRACTION_MODEL,
    benchmarkVersion: DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION,
    normalizationVersion: DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION,
    documentId: document.documentId,
    documentHash,
    idempotencyKey: documentExtractionIdempotencyKey({
      documentHash,
      parser: "nvidia_multimodal_extraction",
      model: NVIDIA_MULTIMODAL_EXTRACTION_MODEL,
      parserVersion: NVIDIA_MULTIMODAL_EXTRACTION_ADAPTER_VERSION
    }),
    status,
    pages: [],
    latencyMs: fields.latencyMs || 0,
    requestCount: fields.requestCount || 0,
    retryCount: fields.retryCount || 0,
    inputPageCount: document.renderedPages.length,
    inputBytes: document.renderedPages.reduce((sum, page) => sum + page.bytes.length, 0),
    estimatedCostUsd: null,
    failureCode,
    failureMetadata: {
      statusCode: fields.statusCode ?? null,
      retryAfterPresent: fields.retryAfterPresent === true
    },
    supportedCapabilities: ["text", "bounding_boxes", "reading_order", "headings", "sections", "tables", "charts", "page_metadata"],
    unsupportedCapabilities: ["confidence", "merged_cells"]
  };
}

function validatedBoundingBox(value: OfficialElement["boundingBox"]): DocumentBoundingBox | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const box = { xMin: value[0], yMin: value[1], xMax: value[2], yMax: value[3] };
  return validBoundingBox(box) ? box : null;
}

function tableCells(text: string) {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|") && line.endsWith("|"))
    .map((line) => line.slice(1, -1).split("|").map((cell) => cell.trim()))
    .filter((row) => row.some(Boolean))
    .filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
  return rows.length >= 2 ? rows : [];
}

function normalizePageElements(document: BenchmarkDocument, page: OfficialPage): readonly NormalizedDocumentElement[] {
  const elements: NormalizedDocumentElement[] = [];
  const pushText = (
    rawText: string,
    elementType: "paragraph" | "table" | "table_cell" | "chart",
    boundingBox: DocumentBoundingBox | null,
    overrides: Partial<NormalizedDocumentElement> = {}
  ) => {
    if (!rawText.trim()) return;
    const element = normalizedElementFromText({
      documentId: document.documentId,
      parser: "nvidia_multimodal_extraction",
      pageNumber: page.pageNumber,
      elementIndex: elements.length,
      rawText,
      confidence: null,
      boundingBox,
      elementType,
      warnings: ["official_nemo_retriever_hosted_parse_does_not_return_element_confidence"]
    });
    elements.push({ ...element, ...overrides });
  };

  for (const block of page.text.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean)) {
    pushText(block, "paragraph", null);
  }
  page.tables.forEach((table, tableIndex) => {
    const box = validatedBoundingBox(table.boundingBox);
    const rows = tableCells(table.text);
    const tableId = `${document.documentId}-page-${page.pageNumber}-table-${tableIndex + 1}`;
    if (!rows.length) {
      pushText(table.text, "table", box, { tableId });
      return;
    }
    rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
      pushText(cell, "table_cell", box, {
        tableId,
        rowIndex,
        columnIndex,
        rowSpan: 1,
        columnSpan: 1,
        headerAssociation: rowIndex > 0 ? rows[0]?.[columnIndex] || null : null
      });
    }));
  });
  page.charts.forEach((chart) => pushText(chart.text, "chart", validatedBoundingBox(chart.boundingBox)));
  page.infographics.forEach((graphic) => pushText(graphic.text, "chart", validatedBoundingBox(graphic.boundingBox), {
    extractionWarnings: ["official_nemo_retriever_infographic_normalized_as_chart_for_benchmark_v1"]
  }));
  return elements;
}

function successfulResult(document: BenchmarkDocument, official: OfficialDocumentResult): DocumentExtractionResult {
  const documentHash = hashDocument(document.sourceBytes);
  return {
    version: DOCUMENT_EXTRACTION_RESULT_VERSION,
    parser: "nvidia_multimodal_extraction",
    parserVersion: NVIDIA_MULTIMODAL_EXTRACTION_ADAPTER_VERSION,
    provider: "nvidia",
    model: NVIDIA_MULTIMODAL_EXTRACTION_MODEL,
    benchmarkVersion: DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION,
    normalizationVersion: DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION,
    documentId: document.documentId,
    documentHash,
    idempotencyKey: documentExtractionIdempotencyKey({
      documentHash,
      parser: "nvidia_multimodal_extraction",
      model: NVIDIA_MULTIMODAL_EXTRACTION_MODEL,
      parserVersion: NVIDIA_MULTIMODAL_EXTRACTION_ADAPTER_VERSION
    }),
    status: "success",
    pages: official.pages.map((page) => {
      const truth = document.groundTruth[page.pageNumber - 1];
      if (!truth) throw new Error("The official client returned an out-of-range page.");
      return {
        pageNumber: page.pageNumber,
        width: truth.width,
        height: truth.height,
        rotation: truth.rotation,
        elements: normalizePageElements(document, page)
      };
    }),
    latencyMs: official.latencyMs,
    requestCount: official.requestCount,
    retryCount: official.retryCount,
    inputPageCount: document.renderedPages.length,
    inputBytes: document.renderedPages.reduce((sum, page) => sum + page.bytes.length, 0),
    estimatedCostUsd: null,
    failureCode: null,
    failureMetadata: null,
    supportedCapabilities: ["text", "bounding_boxes", "reading_order", "headings", "sections", "tables", "charts", "page_metadata"],
    unsupportedCapabilities: ["confidence", "merged_cells"]
  };
}

function validOfficialElement(value: unknown): value is OfficialElement {
  if (!value || typeof value !== "object") return false;
  const element = value as Partial<OfficialElement>;
  return typeof element.text === "string" && (
    element.boundingBox === null || (
      Array.isArray(element.boundingBox) &&
      element.boundingBox.length === 4 &&
      element.boundingBox.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate))
    )
  );
}

function validOfficialDocument(value: unknown): value is OfficialDocumentResult {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<OfficialDocumentResult>;
  const validFailureCode = document.failureCode === null || [
    "authentication_failed",
    "rate_limit",
    "timeout",
    "transport_failure",
    "provider_unavailable",
    "client_unavailable",
    "malformed_response",
    "validation_failed",
    "unsupported_input"
  ].includes(document.failureCode || "");
  return (
    typeof document.documentId === "string" &&
    /^synthetic-doc-[a-z0-9-]+$/.test(document.documentId) &&
    (document.status === "success" || document.status === "failed") &&
    Array.isArray(document.pages) &&
    document.pages.length <= NVIDIA_MULTIMODAL_EXTRACTION_MAX_PAGES &&
    document.pages.every((page) => (
      page &&
      typeof page === "object" &&
      Number.isInteger(page.pageNumber) &&
      page.pageNumber > 0 &&
      typeof page.text === "string" &&
      Array.isArray(page.tables) && page.tables.every(validOfficialElement) &&
      Array.isArray(page.charts) && page.charts.every(validOfficialElement) &&
      Array.isArray(page.infographics) && page.infographics.every(validOfficialElement)
    )) &&
    typeof document.latencyMs === "number" && Number.isFinite(document.latencyMs) && document.latencyMs >= 0 &&
    typeof document.requestCount === "number" && Number.isInteger(document.requestCount) && document.requestCount >= 0 &&
    typeof document.retryCount === "number" && Number.isInteger(document.retryCount) && document.retryCount >= 0 &&
    validFailureCode &&
    (document.statusCode === null || (
      typeof document.statusCode === "number" &&
      Number.isInteger(document.statusCode) &&
      document.statusCode >= 100 &&
      document.statusCode <= 599
    )) &&
    typeof document.retryAfterPresent === "boolean"
  );
}

function validateBridgeOutput(value: unknown): asserts value is OfficialClientBridgeOutput {
  const output = value as Partial<OfficialClientBridgeOutput>;
  if (
    !output ||
    output.contractVersion !== BRIDGE_CONTRACT_VERSION ||
    output.clientRevision !== NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION ||
    output.model !== NVIDIA_MULTIMODAL_EXTRACTION_MODEL ||
    output.contractProfile !== "hosted_tool_call" ||
    typeof output.clientVersion !== "string" ||
    !output.clientVersion ||
    !Array.isArray(output.documents) ||
    output.documents.length > 12 ||
    !output.documents.every(validOfficialDocument) ||
    new Set(output.documents.map((document) => document.documentId)).size !== output.documents.length
  ) {
    throw new Error("The official NeMo Retriever bridge returned an invalid contract.");
  }
}

async function executeOfficialClient(input: Parameters<OfficialClientRunner>[0]): Promise<OfficialClientBridgeOutput> {
  const python = process.env.NEMO_RETRIEVER_PYTHON || "python3";
  const script = path.join(process.cwd(), "scripts", "nvidia-document-intelligence-official-client.py");
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "ignore"]
    });
    const chunks: Buffer[] = [];
    let size = 0;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("The official NeMo Retriever benchmark client timed out."));
    }, 10 * 60_000);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BRIDGE_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        reject(new Error("The official NeMo Retriever benchmark output exceeded its bound."));
        return;
      }
      chunks.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error("The official NeMo Retriever benchmark client failed closed."));
        return;
      }
      try {
        const output = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
        validateBridgeOutput(output);
        resolve(output);
      } catch {
        reject(new Error("The official NeMo Retriever benchmark client returned malformed output."));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function parserQualification(results: readonly DocumentExtractionResult[], latencyMs: number): NvidiaDocumentParserQualification {
  const successful = results.filter((result) => result.status === "success");
  const firstFailure = results.find((result) => result.status === "failed");
  const disabled = results.every((result) => result.status === "skipped" && result.failureCode === "disabled");
  const missingCredentials = results.every((result) => result.status === "skipped" && result.failureCode === "missing_credentials");
  return {
    provider: "nvidia",
    model: NVIDIA_MULTIMODAL_EXTRACTION_MODEL,
    endpointCategory: "hosted_multimodal_extraction",
    status: successful.length ? "available" : disabled ? "skipped" : missingCredentials ? "blocked" : "failed",
    requestCount: 0,
    latencyMs,
    statusCode: firstFailure?.failureMetadata?.statusCode ?? null,
    failureCode: successful.length ? null : firstFailure?.failureCode || (disabled ? "disabled" : "missing_credentials"),
    outputContractObserved: successful.length > 0,
    officialClientRevision: NVIDIA_MULTIMODAL_EXTRACTION_CLIENT_REVISION,
    supportedCapabilities: ["text", "bounding_boxes", "reading_order", "headings", "sections", "tables", "charts"],
    unqualifiedCapabilities: ["merged_cells"]
  };
}

export async function extractWithNvidiaMultimodalClient(
  documents: readonly BenchmarkDocument[],
  options: Readonly<{ enabled?: boolean; runner?: OfficialClientRunner }> = {}
) {
  if (!nvidiaDocumentIntelligenceBenchmarkAllowed(options.enabled === true)) {
    const results = documents.map((document) => failureResult(document, "skipped", "disabled"));
    return { results, parserQualification: parserQualification(results, 0) };
  }
  if (!process.env.NVIDIA_API_KEY && !options.runner) {
    const results = documents.map((document) => failureResult(document, "skipped", "missing_credentials"));
    return { results, parserQualification: parserQualification(results, 0) };
  }
  if (documents.reduce((sum, document) => sum + document.renderedPages.length, 0) > NVIDIA_MULTIMODAL_EXTRACTION_MAX_PAGES) {
    const results = documents.map((document) => failureResult(document, "failed", "unsafe_benchmark_input"));
    return { results, parserQualification: parserQualification(results, 0) };
  }

  const invalid = new Map<string, DocumentExtractionResult>();
  const eligible = documents.filter((document) => {
    const validIdentity = /^synthetic-doc-[a-z0-9-]+$/.test(document.documentId);
    const validSource = !(["png", "jpeg"] as const).includes(document.inputFormat as "png" | "jpeg") || validBenchmarkImageBytes(
      document.sourceBytes,
      document.inputFormat === "jpeg" ? "image/jpeg" : "image/png"
    );
    const validPages = document.renderedPages.length > 0 && document.renderedPages.every((page) =>
      page.bytes.length <= 1_000_000 && validBenchmarkImageBytes(page.bytes, page.mimeType)
    );
    if (validIdentity && validSource && validPages) return true;
    invalid.set(document.documentId, failureResult(document, "failed", validIdentity ? "validation_failed" : "unsafe_benchmark_input"));
    return false;
  });

  if (!eligible.length) {
    const results = documents.map((document) => invalid.get(document.documentId) || failureResult(
      document,
      "failed",
      "validation_failed"
    ));
    return { results, parserQualification: parserQualification(results, 0) };
  }

  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "vaeroex-nemo-retriever-"));
  const startedAt = performance.now();
  try {
    const manifest = await Promise.all(eligible.map(async (document) => ({
      documentId: document.documentId,
      pagePaths: await Promise.all(document.renderedPages.map(async (page) => {
        const extension = page.mimeType === "image/jpeg" ? "jpg" : "png";
        const destination = path.join(temporaryRoot, `${document.documentId}-page-${page.pageNumber}.${extension}`);
        await writeFile(destination, page.bytes, { mode: 0o600 });
        return destination;
      }))
    })));
    let output: OfficialClientBridgeOutput;
    try {
      output = await (options.runner || executeOfficialClient)({
        benchmarkVersion: DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION,
        documents: manifest
      });
      validateBridgeOutput(output);
    } catch {
      const results = documents.map((document) => invalid.get(document.documentId) || failureResult(
        document,
        "failed",
        "client_unavailable",
        { latencyMs: Math.round(performance.now() - startedAt) }
      ));
      return { results, parserQualification: parserQualification(results, Math.round(performance.now() - startedAt)) };
    }

    const results = documents.map((document) => {
      const invalidResult = invalid.get(document.documentId);
      if (invalidResult) return invalidResult;
      const official = output.documents.find((item) => item.documentId === document.documentId);
      if (!official) return failureResult(document, "failed", "malformed_response");
      if (official.status === "failed" || official.pages.length !== document.renderedPages.length) {
        return failureResult(document, "failed", official.failureCode || "malformed_response", {
          latencyMs: official.latencyMs,
          requestCount: official.requestCount,
          retryCount: official.retryCount,
          statusCode: official.statusCode,
          retryAfterPresent: official.retryAfterPresent
        });
      }
      return successfulResult(document, official);
    });
    return { results, parserQualification: parserQualification(results, Math.round(performance.now() - startedAt)) };
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export function privacySafeNvidiaMultimodalTelemetry(result: DocumentExtractionResult): PrivacySafeProviderTelemetry {
  return {
    parser: result.parser,
    provider: result.provider,
    model: result.model,
    endpointCategory: "hosted_multimodal_extraction",
    status: result.status,
    inputPageCount: result.inputPageCount,
    inputBytes: result.inputBytes,
    requestCount: result.requestCount,
    retryCount: result.retryCount,
    latencyMs: result.latencyMs,
    failureCode: result.failureCode,
    statusCode: result.failureMetadata?.statusCode ?? null,
    retryAfterPresent: result.failureMetadata?.retryAfterPresent === true
  };
}
