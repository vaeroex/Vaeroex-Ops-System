import "server-only";

import { performance } from "node:perf_hooks";
import {
  DOCUMENT_EXTRACTION_RESULT_VERSION,
  DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION,
  DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION,
  documentExtractionIdempotencyKey,
  hashDocument,
  type BenchmarkDocument,
  type DocumentExtractionResult
} from "@/lib/ai/document-intelligence-poc/contracts";
import { normalizedElementFromText } from "@/lib/ai/document-intelligence-poc/normalization";
import { cleanExtractedText, extractPdfText } from "@/lib/imports/document-text";

export const VAEROEX_CURRENT_DOCUMENT_PARSER_VERSION = "vaeroex_current_document_parser_20260801";

export async function extractWithCurrentVaeroexPath(document: BenchmarkDocument): Promise<DocumentExtractionResult> {
  const startedAt = performance.now();
  const documentHash = hashDocument(document.sourceBytes);
  const idempotencyKey = documentExtractionIdempotencyKey({
    documentHash,
    parser: "vaeroex_current",
    model: "deterministic_local_document_text",
    parserVersion: VAEROEX_CURRENT_DOCUMENT_PARSER_VERSION
  });
  const isPdf = document.inputFormat === "digital_pdf" || document.inputFormat === "image_pdf";
  const text = isPdf ? cleanExtractedText(extractPdfText(document.sourceBytes)) : "";
  const supported = Boolean(text);
  const pieces = text ? text.split(/\n+/).map((value) => value.trim()).filter(Boolean) : [];
  const pages = supported ? [{
    pageNumber: 1,
    width: document.groundTruth[0]?.width || 1,
    height: document.groundTruth[0]?.height || 1,
    rotation: document.groundTruth[0]?.rotation || 0,
    elements: pieces.map((rawText, index) => normalizedElementFromText({
      documentId: document.documentId,
      parser: "vaeroex_current",
      pageNumber: 1,
      elementIndex: index,
      rawText,
      confidence: null,
      boundingBox: null,
      warnings: ["current_parser_has_no_page_or_coordinate_contract"]
    }))
  }] : [];
  return {
    version: DOCUMENT_EXTRACTION_RESULT_VERSION,
    parser: "vaeroex_current",
    parserVersion: VAEROEX_CURRENT_DOCUMENT_PARSER_VERSION,
    provider: "vaeroex",
    model: supported ? "deterministic_local_document_text" : "current_multimodal_path_not_invoked",
    benchmarkVersion: DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION,
    normalizationVersion: DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION,
    documentId: document.documentId,
    documentHash,
    idempotencyKey,
    status: supported ? "success" : "skipped",
    pages,
    latencyMs: Math.round((performance.now() - startedAt) * 100) / 100,
    requestCount: 0,
    retryCount: 0,
    inputPageCount: document.renderedPages.length,
    inputBytes: document.sourceBytes.length,
    estimatedCostUsd: 0,
    failureCode: supported ? null : "unsupported_input",
    failureMetadata: null,
    supportedCapabilities: supported ? ["text"] : [],
    unsupportedCapabilities: ["confidence", "bounding_boxes", "reading_order", "headings", "sections", "tables", "merged_cells", "charts", "page_metadata"]
  };
}
