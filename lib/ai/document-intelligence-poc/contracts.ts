import "server-only";

import { createHash } from "node:crypto";

export const DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION = "document_intelligence_benchmark_v1" as const;
export const DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION = "document_intelligence_normalization_v1" as const;
export const DOCUMENT_EXTRACTION_RESULT_VERSION = "document_extraction_result_v1" as const;

export type DocumentBenchmarkParser = "vaeroex_current" | "nvidia_ocr" | "nvidia_document_parser";
export type DocumentInputFormat = "digital_pdf" | "image_pdf" | "png" | "jpeg";
export type DocumentIntelligenceCapability =
  | "text"
  | "confidence"
  | "bounding_boxes"
  | "reading_order"
  | "headings"
  | "sections"
  | "tables"
  | "merged_cells"
  | "charts"
  | "page_metadata";
export type DocumentElementType =
  | "heading"
  | "paragraph"
  | "table"
  | "table_cell"
  | "chart"
  | "chart_label"
  | "header"
  | "footer"
  | "annotation"
  | "unknown";

export type DocumentBoundingBox = Readonly<{
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}>;

export type DocumentElementProvenance = Readonly<{
  benchmarkDocumentId: string;
  benchmarkOnly: true;
  synthetic: true;
  sourcePage: number;
  sourceElementId: string;
  parser: DocumentBenchmarkParser | "ground_truth";
}>;

export type NormalizedDocumentElement = Readonly<{
  elementId: string;
  elementType: DocumentElementType;
  rawText: string;
  normalizedText: string;
  boundingBox: DocumentBoundingBox | null;
  confidence: number | null;
  readingOrderIndex: number;
  sectionIdentity: string | null;
  headingLevel: number | null;
  paragraphIdentity: string | null;
  tableId: string | null;
  tableTitle: string | null;
  rowIndex: number | null;
  columnIndex: number | null;
  rowSpan: number | null;
  columnSpan: number | null;
  headerAssociation: string | null;
  displayedNumericText: string | null;
  normalizedNumericValue: number | null;
  sign: "positive" | "negative" | "zero" | null;
  decimalPrecision: number | null;
  currency: string | null;
  percentage: number | null;
  unit: string | null;
  date: string | null;
  reportingPeriod: string | null;
  kpiName: string | null;
  kpiValue: number | null;
  kpiTarget: number | null;
  chartOrFigureReference: string | null;
  sourceCoordinates: DocumentBoundingBox | null;
  extractionWarnings: readonly string[];
  provenance: DocumentElementProvenance;
}>;

export type NormalizedDocumentPage = Readonly<{
  pageNumber: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  elements: readonly NormalizedDocumentElement[];
}>;

export type DocumentExtractionFailureCode =
  | "disabled"
  | "missing_credentials"
  | "unsafe_benchmark_input"
  | "authentication_failed"
  | "rate_limit"
  | "timeout"
  | "transport_failure"
  | "provider_unavailable"
  | "malformed_response"
  | "validation_failed"
  | "unsupported_input"
  | null;

export type DocumentExtractionResult = Readonly<{
  version: typeof DOCUMENT_EXTRACTION_RESULT_VERSION;
  parser: DocumentBenchmarkParser;
  parserVersion: string;
  provider: "vaeroex" | "nvidia";
  model: string;
  benchmarkVersion: typeof DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION;
  normalizationVersion: typeof DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION;
  documentId: string;
  documentHash: string;
  idempotencyKey: string;
  status: "success" | "failed" | "skipped";
  pages: readonly NormalizedDocumentPage[];
  latencyMs: number;
  requestCount: number;
  retryCount: number;
  inputPageCount: number;
  inputBytes: number;
  estimatedCostUsd: number | null;
  failureCode: DocumentExtractionFailureCode;
  failureMetadata: Readonly<{ statusCode: number | null; retryAfterPresent: boolean }> | null;
  supportedCapabilities: readonly DocumentIntelligenceCapability[];
  unsupportedCapabilities: readonly DocumentIntelligenceCapability[];
}>;

export type BenchmarkDocumentClass =
  | "clean_digital_pdf"
  | "scanned_pdf"
  | "image_only_pdf"
  | "rotated_page"
  | "skewed_scan"
  | "low_resolution_image"
  | "poor_contrast_scan"
  | "two_column_report"
  | "three_column_report"
  | "dense_financial_table"
  | "merged_cell_table"
  | "multi_page_table"
  | "spreadsheet_rendered_as_pdf"
  | "invoice"
  | "profit_and_loss_statement"
  | "kpi_dashboard_export"
  | "operational_report"
  | "screenshot"
  | "chart_with_labels"
  | "mixed_text_image_page"
  | "repeated_headers_and_footers"
  | "negative_values"
  | "decimals"
  | "currencies"
  | "percentages"
  | "parentheses_negative_values"
  | "conflicting_footnotes"
  | "reporting_period_changes"
  | "handwritten_annotation"
  | "empty_page"
  | "corrupted_page"
  | "prompt_injection_text";

export type BenchmarkRenderedPage = Readonly<{
  pageNumber: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
  mimeType: "image/png" | "image/jpeg";
  bytes: Buffer;
}>;

export type BenchmarkDocument = Readonly<{
  documentId: string;
  title: string;
  inputFormat: DocumentInputFormat;
  documentClasses: readonly BenchmarkDocumentClass[];
  sourceBytes: Buffer;
  renderedPages: readonly BenchmarkRenderedPage[];
  groundTruth: readonly NormalizedDocumentPage[];
}>;

export type CatastrophicBusinessErrorCode =
  | "numeric_sign_changed"
  | "decimal_shift"
  | "currency_magnitude_changed"
  | "wrong_kpi_assignment"
  | "reporting_period_merged"
  | "current_target_confusion"
  | "fabricated_business_value"
  | "fabricated_table_row"
  | "critical_page_omitted"
  | "wrong_source_coordinates";

export type DocumentComparisonMetric = number | null;

export type DocumentComparisonMetrics = Readonly<{
  characterErrorRate: DocumentComparisonMetric;
  wordErrorRate: DocumentComparisonMetric;
  exactNumericAccuracy: DocumentComparisonMetric;
  signAccuracy: DocumentComparisonMetric;
  decimalAccuracy: DocumentComparisonMetric;
  currencyAccuracy: DocumentComparisonMetric;
  percentageAccuracy: DocumentComparisonMetric;
  dateAccuracy: DocumentComparisonMetric;
  reportingPeriodAccuracy: DocumentComparisonMetric;
  kpiNameAccuracy: DocumentComparisonMetric;
  kpiValueAccuracy: DocumentComparisonMetric;
  kpiTargetAccuracy: DocumentComparisonMetric;
  unitAccuracy: DocumentComparisonMetric;
  rowReconstructionAccuracy: DocumentComparisonMetric;
  columnReconstructionAccuracy: DocumentComparisonMetric;
  mergedCellReconstructionAccuracy: DocumentComparisonMetric;
  readingOrderAccuracy: DocumentComparisonMetric;
  pageAssociationAccuracy: DocumentComparisonMetric;
  boundingBoxCoverage: DocumentComparisonMetric;
  boundingBoxCorrectness: DocumentComparisonMetric;
  headingAccuracy: DocumentComparisonMetric;
  sectionAssociationAccuracy: DocumentComparisonMetric;
  hallucinatedTextRate: DocumentComparisonMetric;
  omittedTextRate: DocumentComparisonMetric;
  duplicatedTextRate: DocumentComparisonMetric;
  catastrophicBusinessErrorRate: DocumentComparisonMetric;
}>;

export type DocumentBenchmarkComparison = Readonly<{
  documentId: string;
  documentClasses: readonly BenchmarkDocumentClass[];
  parser: DocumentBenchmarkParser;
  status: DocumentExtractionResult["status"];
  metrics: DocumentComparisonMetrics;
  catastrophicErrors: readonly CatastrophicBusinessErrorCode[];
  latencyMs: number;
  requestCount: number;
  retryCount: number;
  failureCode: DocumentExtractionFailureCode;
  supportedCapabilities: readonly DocumentIntelligenceCapability[];
  unsupportedCapabilities: readonly DocumentIntelligenceCapability[];
}>;

export type DocumentClassRecommendation =
  | "QUALIFIED FOR SPECIALIST PILOT"
  | "QUALIFIED FOR CONDITIONAL FALLBACK"
  | "REMAIN SHADOW ONLY"
  | "REJECT FOR THIS DOCUMENT CLASS"
  | "BLOCKED - NVIDIA CAPABILITY NOT AVAILABLE";

export type PrivacySafeProviderTelemetry = Readonly<{
  parser: DocumentBenchmarkParser;
  provider: "vaeroex" | "nvidia";
  model: string;
  endpointCategory: "local" | "hosted_ocr" | "hosted_document_parser";
  status: DocumentExtractionResult["status"];
  inputPageCount: number;
  inputBytes: number;
  requestCount: number;
  retryCount: number;
  latencyMs: number;
  failureCode: DocumentExtractionFailureCode;
  statusCode: number | null;
  retryAfterPresent: boolean;
}>;

export function normalizeDocumentText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function hashDocument(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function documentExtractionIdempotencyKey({
  documentHash,
  parser,
  model,
  parserVersion
}: {
  documentHash: string;
  parser: DocumentBenchmarkParser;
  model: string;
  parserVersion: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify({
      documentHash,
      parser,
      model,
      parserVersion,
      benchmarkVersion: DOCUMENT_INTELLIGENCE_BENCHMARK_VERSION,
      normalizationVersion: DOCUMENT_INTELLIGENCE_NORMALIZATION_VERSION
    }))
    .digest("hex");
}

export function validBoundingBox(value: DocumentBoundingBox | null) {
  if (!value) return false;
  return [value.xMin, value.yMin, value.xMax, value.yMax].every(Number.isFinite)
    && value.xMin >= 0
    && value.yMin >= 0
    && value.xMax <= 1
    && value.yMax <= 1
    && value.xMax > value.xMin
    && value.yMax > value.yMin;
}

export function assertBenchmarkDocument(document: BenchmarkDocument) {
  if (!/^synthetic-doc-[a-z0-9-]+$/.test(document.documentId)) {
    throw new Error("The document intelligence POC accepts only approved synthetic benchmark document IDs.");
  }
  if (!document.sourceBytes.length || !document.renderedPages.length || !document.groundTruth.length) {
    throw new Error("The synthetic benchmark document is incomplete.");
  }
  if (document.renderedPages.length !== document.groundTruth.length) {
    throw new Error("Rendered page count and ground-truth page count must match.");
  }
  for (const page of document.groundTruth) {
    if (page.pageNumber < 1 || page.width < 1 || page.height < 1) {
      throw new Error("Ground-truth page provenance is invalid.");
    }
    for (const element of page.elements) {
      if (
        element.provenance.benchmarkDocumentId !== document.documentId ||
        !element.provenance.synthetic ||
        element.provenance.benchmarkOnly !== true ||
        element.provenance.parser !== "ground_truth" ||
        element.provenance.sourcePage !== page.pageNumber ||
        element.provenance.sourceElementId !== element.elementId
      ) {
        throw new Error("Ground-truth provenance must remain synthetic and document-bound.");
      }
      if (!element.normalizedText || element.normalizedText !== normalizeDocumentText(element.rawText)) {
        throw new Error("Ground-truth text normalization is invalid.");
      }
      if (!Number.isInteger(element.readingOrderIndex) || element.readingOrderIndex < 0) {
        throw new Error("Ground-truth reading order is invalid.");
      }
      if (element.sourceCoordinates && !validBoundingBox(element.sourceCoordinates)) {
        throw new Error("Ground-truth source coordinates are invalid.");
      }
    }
  }
}
