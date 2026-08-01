import "server-only";

import { performance } from "node:perf_hooks";
import {
  DOCUMENT_EXTRACTION_RESULT_VERSION,
  DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION,
  DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION,
  documentExtractionIdempotencyKey,
  hashDocument,
  type BenchmarkDocument,
  type DocumentBoundingBox,
  type DocumentExtractionFailureCode,
  type DocumentExtractionResult,
  type PrivacySafeProviderTelemetry
} from "@/lib/ai/document-intelligence-poc/contracts";
import { validBenchmarkImageBytes } from "@/lib/ai/document-intelligence-poc/fixtures";
import { normalizedElementFromText } from "@/lib/ai/document-intelligence-poc/normalization";

export const NVIDIA_OCR_MODEL = "nvidia/nemotron-ocr-v2";
export const NVIDIA_OCR_ADAPTER_VERSION = "nvidia_nemotron_ocr_v2_adapter_v1";
export const NVIDIA_OCR_ENDPOINT = "https://ai.api.nvidia.com/v1/cv/nvidia/nemotron-ocr-v2";
export const NVIDIA_OCR_MAX_REQUESTS = 16;
export const NVIDIA_OCR_MAX_PAGES = 16;
const NVIDIA_OCR_MAX_PAGE_BYTES = 1_000_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type NvidiaPoint = { x?: unknown; y?: unknown };
type NvidiaDetection = {
  text_prediction?: { text?: unknown; confidence?: unknown };
  bounding_box?: { points?: unknown };
};
type NvidiaOcrPayload = {
  model?: unknown;
  data?: Array<{ index?: unknown; text_detections?: unknown }>;
  usage?: { images_size_mb?: unknown };
};

function boundedBox(points: unknown): DocumentBoundingBox | null {
  if (!Array.isArray(points) || points.length < 4) return null;
  const normalized = points as NvidiaPoint[];
  const xs = normalized.map((point) => Number(point.x));
  const ys = normalized.map((point) => Number(point.y));
  if (![...xs, ...ys].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) return null;
  const xMin = Math.min(...xs);
  const yMin = Math.min(...ys);
  const xMax = Math.max(...xs);
  const yMax = Math.max(...ys);
  return xMax > xMin && yMax > yMin ? { xMin, yMin, xMax, yMax } : null;
}

function failureCode(status: number): Exclude<DocumentExtractionFailureCode, null> {
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "provider_unavailable";
  return "transport_failure";
}

function transportFailure(error: unknown): Exclude<DocumentExtractionFailureCode, null> {
  const value = `${error instanceof Error ? error.name : ""} ${error instanceof Error ? error.message : ""}`;
  return /abort|timeout|timed out/i.test(value) ? "timeout" : "transport_failure";
}

export function nvidiaDocumentIntelligencePocEnabled() {
  if (process.env.VERCEL_ENV === "production") return false;
  return process.env.VERCEL_ENV === "preview" &&
    process.env.VAEROEX_NVIDIA_DOCUMENT_INTELLIGENCE_POC === "true" &&
    process.env.VAEROEX_NVIDIA_DOCUMENT_INTELLIGENCE_SHADOW === "true" &&
    process.env.VAEROEX_DOCUMENT_INTELLIGENCE_SHADOW_CONFIRM === "synthetic_benchmark" &&
    process.env.VAEROEX_DOCUMENT_INTELLIGENCE_BENCHMARK_MODE === "synthetic";
}

export function buildNvidiaOcrRequest(document: BenchmarkDocument) {
  return {
    input: document.renderedPages.map((page) => ({
      type: "image_url" as const,
      url: `data:${page.mimeType};base64,${page.bytes.toString("base64")}`
    })),
    merge_levels: document.renderedPages.map(() => "paragraph" as const)
  };
}

function emptyResult({
  document,
  status,
  code,
  latencyMs,
  requestCount,
  retryCount,
  statusCode,
  retryAfterPresent
}: {
  document: BenchmarkDocument;
  status: "failed" | "skipped";
  code: Exclude<DocumentExtractionFailureCode, null>;
  latencyMs: number;
  requestCount: number;
  retryCount: number;
  statusCode: number | null;
  retryAfterPresent: boolean;
}): DocumentExtractionResult {
  const documentHash = hashDocument(document.sourceBytes);
  return {
    version: DOCUMENT_EXTRACTION_RESULT_VERSION,
    parser: "nvidia_ocr",
    parserVersion: NVIDIA_OCR_ADAPTER_VERSION,
    provider: "nvidia",
    model: NVIDIA_OCR_MODEL,
    benchmarkVersion: DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION,
    normalizationVersion: DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION,
    documentId: document.documentId,
    documentHash,
    idempotencyKey: documentExtractionIdempotencyKey({ documentHash, parser: "nvidia_ocr", model: NVIDIA_OCR_MODEL, parserVersion: NVIDIA_OCR_ADAPTER_VERSION }),
    status,
    pages: [],
    latencyMs,
    requestCount,
    retryCount,
    inputPageCount: document.renderedPages.length,
    inputBytes: document.renderedPages.reduce((sum, page) => sum + page.bytes.length, 0),
    estimatedCostUsd: null,
    failureCode: code,
    failureMetadata: { statusCode, retryAfterPresent },
    supportedCapabilities: ["text", "confidence", "bounding_boxes", "page_metadata"],
    unsupportedCapabilities: ["reading_order", "headings", "sections", "tables", "merged_cells", "charts"]
  };
}

export class NvidiaOcrBenchmarkAdapter {
  private requestCount = 0;
  private pageCount = 0;

  constructor(private readonly options: {
    apiKey?: string;
    endpoint?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  } = {}) {}

  async extract(document: BenchmarkDocument): Promise<DocumentExtractionResult> {
    if (!nvidiaDocumentIntelligencePocEnabled()) {
      return emptyResult({ document, status: "skipped", code: "disabled", latencyMs: 0, requestCount: 0, retryCount: 0, statusCode: null, retryAfterPresent: false });
    }
    if (!/^synthetic-doc-[a-z0-9-]+$/.test(document.documentId)) {
      return emptyResult({ document, status: "failed", code: "unsafe_benchmark_input", latencyMs: 0, requestCount: 0, retryCount: 0, statusCode: null, retryAfterPresent: false });
    }
    if (
      !document.renderedPages.length ||
      ((document.inputFormat === "png" || document.inputFormat === "jpeg") && !validBenchmarkImageBytes(
        document.sourceBytes,
        document.inputFormat === "jpeg" ? "image/jpeg" : "image/png"
      )) ||
      document.renderedPages.some((page) => page.bytes.length > NVIDIA_OCR_MAX_PAGE_BYTES || !validBenchmarkImageBytes(page.bytes, page.mimeType))
    ) {
      return emptyResult({ document, status: "failed", code: "validation_failed", latencyMs: 0, requestCount: 0, retryCount: 0, statusCode: null, retryAfterPresent: false });
    }
    if (this.requestCount + 1 > NVIDIA_OCR_MAX_REQUESTS || this.pageCount + document.renderedPages.length > NVIDIA_OCR_MAX_PAGES) {
      return emptyResult({ document, status: "failed", code: "unsafe_benchmark_input", latencyMs: 0, requestCount: 0, retryCount: 0, statusCode: null, retryAfterPresent: false });
    }
    const apiKey = this.options.apiKey || process.env.NVIDIA_API_KEY;
    if (!apiKey) {
      return emptyResult({ document, status: "skipped", code: "missing_credentials", latencyMs: 0, requestCount: 0, retryCount: 0, statusCode: null, retryAfterPresent: false });
    }
    const fetchImpl = this.options.fetchImpl || fetch;
    const endpoint = this.options.endpoint || NVIDIA_OCR_ENDPOINT;
    const timeoutMs = Math.min(Math.max(this.options.timeoutMs || 30_000, 1_000), 60_000);
    const startedAt = performance.now();
    let retryCount = 0;
    let lastStatusCode: number | null = null;
    let retryAfterPresent = false;
    this.requestCount += 1;
    this.pageCount += document.renderedPages.length;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify(buildNvidiaOcrRequest(document)),
          signal: controller.signal
        });
        lastStatusCode = response.status;
        retryAfterPresent = response.headers.has("retry-after");
        const responseText = await response.text();
        if (!response.ok) {
          const code = failureCode(response.status);
          if (attempt === 0 && code === "rate_limit") {
            retryCount += 1;
            this.requestCount += 1;
            continue;
          }
          return emptyResult({ document, status: "failed", code, latencyMs: Math.round(performance.now() - startedAt), requestCount: attempt + 1, retryCount, statusCode: response.status, retryAfterPresent });
        }
        let payload: NvidiaOcrPayload;
        try {
          payload = JSON.parse(responseText) as NvidiaOcrPayload;
        } catch {
          return emptyResult({ document, status: "failed", code: "malformed_response", latencyMs: Math.round(performance.now() - startedAt), requestCount: attempt + 1, retryCount, statusCode: response.status, retryAfterPresent });
        }
        if (payload.model !== NVIDIA_OCR_MODEL || !Array.isArray(payload.data) || payload.data.length !== document.renderedPages.length) {
          return emptyResult({ document, status: "failed", code: "malformed_response", latencyMs: Math.round(performance.now() - startedAt), requestCount: attempt + 1, retryCount, statusCode: response.status, retryAfterPresent });
        }
        const pages = payload.data.map((item, pageIndex) => {
          if (item.index !== pageIndex || !Array.isArray(item.text_detections)) {
            throw new Error("malformed_response");
          }
          const detections = (item.text_detections as NvidiaDetection[]).map((detection, originalIndex) => ({
            originalIndex,
            rawText: typeof detection.text_prediction?.text === "string" ? detection.text_prediction.text : "",
            confidence: typeof detection.text_prediction?.confidence === "number" ? detection.text_prediction.confidence : null,
            boundingBox: boundedBox(detection.bounding_box?.points)
          })).filter((detection) => detection.rawText.trim());
          if (detections.some((detection) => detection.confidence === null || detection.confidence < 0 || detection.confidence > 1 || !detection.boundingBox)) {
            throw new Error("malformed_response");
          }
          detections.sort((left, right) => (left.boundingBox?.yMin || 0) - (right.boundingBox?.yMin || 0) || (left.boundingBox?.xMin || 0) - (right.boundingBox?.xMin || 0));
          const truth = document.groundTruth[pageIndex];
          return {
            pageNumber: pageIndex + 1,
            width: truth.width,
            height: truth.height,
            rotation: truth.rotation,
            elements: detections.map((detection, elementIndex) => normalizedElementFromText({
              documentId: document.documentId,
              parser: "nvidia_ocr",
              pageNumber: pageIndex + 1,
              elementIndex,
              rawText: detection.rawText,
              confidence: detection.confidence,
              boundingBox: detection.boundingBox,
              warnings: ["standalone_ocr_does_not_provide_semantic_layout_or_table_structure"]
            }))
          };
        });
        const documentHash = hashDocument(document.sourceBytes);
        return {
          version: DOCUMENT_EXTRACTION_RESULT_VERSION,
          parser: "nvidia_ocr",
          parserVersion: NVIDIA_OCR_ADAPTER_VERSION,
          provider: "nvidia",
          model: NVIDIA_OCR_MODEL,
          benchmarkVersion: DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION,
          normalizationVersion: DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION,
          documentId: document.documentId,
          documentHash,
          idempotencyKey: documentExtractionIdempotencyKey({ documentHash, parser: "nvidia_ocr", model: NVIDIA_OCR_MODEL, parserVersion: NVIDIA_OCR_ADAPTER_VERSION }),
          status: "success",
          pages,
          latencyMs: Math.round(performance.now() - startedAt),
          requestCount: attempt + 1,
          retryCount,
          inputPageCount: document.renderedPages.length,
          inputBytes: document.renderedPages.reduce((sum, page) => sum + page.bytes.length, 0),
          estimatedCostUsd: null,
          failureCode: null,
          failureMetadata: null,
          supportedCapabilities: ["text", "confidence", "bounding_boxes", "page_metadata"],
          unsupportedCapabilities: ["reading_order", "headings", "sections", "tables", "merged_cells", "charts"]
        };
      } catch (error) {
        const code = error instanceof Error && error.message === "malformed_response" ? "malformed_response" : transportFailure(error);
        if (attempt === 0 && (code === "timeout" || code === "transport_failure")) {
          retryCount += 1;
          this.requestCount += 1;
          continue;
        }
        return emptyResult({ document, status: "failed", code, latencyMs: Math.round(performance.now() - startedAt), requestCount: attempt + 1, retryCount, statusCode: lastStatusCode, retryAfterPresent });
      } finally {
        clearTimeout(timeout);
      }
    }
    return emptyResult({ document, status: "failed", code: "transport_failure", latencyMs: Math.round(performance.now() - startedAt), requestCount: 2, retryCount, statusCode: lastStatusCode, retryAfterPresent });
  }
}

export function privacySafeNvidiaOcrTelemetry(result: DocumentExtractionResult): PrivacySafeProviderTelemetry {
  return {
    parser: result.parser,
    provider: result.provider,
    model: result.model,
    endpointCategory: "hosted_ocr",
    status: result.status,
    inputPageCount: result.inputPageCount,
    inputBytes: result.inputBytes,
    requestCount: result.requestCount,
    retryCount: result.retryCount,
    latencyMs: result.latencyMs,
    failureCode: result.failureCode,
    statusCode: result.failureMetadata?.statusCode || null,
    retryAfterPresent: result.failureMetadata?.retryAfterPresent || false
  };
}
