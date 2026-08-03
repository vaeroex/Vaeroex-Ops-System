import "server-only";

import {
  DOCUMENT_ASSESSMENT_VERSION,
  type DocumentAssessmentInputV1,
  type DocumentAssessmentReasonCode,
  type DocumentAssessmentState,
  type DocumentAssessmentV1,
  type DocumentMagicByteAssessment,
  type DocumentPilotFileKind
} from "@/lib/ai/document-intelligence-poc/pilot-contracts";

const MIME_BY_KIND: Record<Exclude<DocumentPilotFileKind, "unsupported">, readonly string[]> = {
  csv: ["text/csv", "application/csv", "text/plain"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpeg: ["image/jpeg", "image/jpg"]
};

const HIGH_SEVERITY = new Set<DocumentAssessmentReasonCode>([
  "no_meaningful_native_text",
  "image_only_document",
  "severe_invalid_character_ratio",
  "severe_repeated_garbage",
  "reading_order_corrupt",
  "table_reconstruction_failed",
  "critical_numbers_without_labels",
  "conflicting_reporting_periods",
  "critical_page_provenance_missing",
  "unsupported_document_layout",
  "native_validator_failed"
]);

const SCORE_PENALTIES: Partial<Record<DocumentAssessmentReasonCode, number>> = {
  declared_type_mismatch: 15,
  no_meaningful_native_text: 100,
  low_characters_per_page: 35,
  severe_invalid_character_ratio: 35,
  elevated_invalid_character_ratio: 15,
  severe_repeated_garbage: 30,
  elevated_repeated_garbage: 15,
  reading_order_corrupt: 35,
  reading_order_degraded: 15,
  table_reconstruction_failed: 35,
  critical_numbers_without_labels: 30,
  conflicting_reporting_periods: 35,
  critical_page_provenance_missing: 30,
  unsupported_document_layout: 40,
  native_validator_failed: 50,
  page_limit_exceeded: 30,
  file_size_limit_exceeded: 30
};

function boundedRatio(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizedExtension(value: string) {
  return value.trim().toLowerCase().replace(/^\./, "");
}

export function documentFileKind(extension: string): DocumentPilotFileKind {
  const value = normalizedExtension(extension);
  if (value === "csv") return "csv";
  if (value === "xlsx" || value === "xls") return "xlsx";
  if (value === "docx") return "docx";
  if (value === "pdf") return "pdf";
  if (value === "png") return "png";
  if (value === "jpg" || value === "jpeg") return "jpeg";
  return "unsupported";
}

function detectedMagic(bytes: Buffer): DocumentMagicByteAssessment["detected"] {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) return "zip_container";
  if (bytes.length && !bytes.subarray(0, Math.min(bytes.length, 64)).includes(0)) return "plain_text";
  return "unknown";
}

function magicAssessment(input: DocumentAssessmentInputV1, kind: DocumentPilotFileKind): DocumentMagicByteAssessment {
  const detected = detectedMagic(input.magicBytes);
  const extensionMatches = kind === "unsupported"
    ? detected === "unknown"
    : kind === "xlsx" || kind === "docx"
      ? detected === "zip_container"
      : kind === "csv"
        ? detected === "plain_text"
        : detected === kind;
  const declared = input.declaredMimeType.trim().toLowerCase();
  const declaredTypeMatches = kind !== "unsupported" && MIME_BY_KIND[kind].includes(declared);
  return { detected, declaredTypeMatches, extensionMatches };
}

function invalidCharacterRatio(text: string) {
  if (!text.length) return 0;
  let invalid = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (character === "\uFFFD" || (code < 32 && character !== "\n" && character !== "\r" && character !== "\t")) invalid += 1;
  }
  return boundedRatio(invalid / text.length);
}

function repeatedGarbageRatio(text: string) {
  if (!text.length) return 0;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const repeatedLineChars = lines.reduce((sum, line, index) => sum + (lines.indexOf(line) < index ? line.length : 0), 0);
  const garbageChars = (text.match(/(?:[^\p{L}\p{N}\s.,:%$()\-+/]){3,}/gu) || []).join("").length;
  return boundedRatio((repeatedLineChars + garbageChars) / text.length);
}

function numericTokens(text: string) {
  return text.match(/(?<![\p{L}\p{N}])[-+]?\(?\d[\d,.]*(?:%|\))?/gu) || [];
}

function labeledNumericFields(text: string) {
  return text.split(/\r?\n/).reduce((count, line) => {
    const hasNumber = /[-+]?\(?\d[\d,.]*(?:%|\))?/.test(line);
    const hasLabel = /\p{L}{2,}/u.test(line);
    return count + (hasNumber && hasLabel ? 1 : 0);
  }, 0);
}

function tableDetected(text: string) {
  const rows = text.split(/\r?\n/).filter((line) => /\t|\s\|\s|,{2,}/.test(line));
  return rows.length >= 2;
}

function periodState(text: string, conflicting: boolean | undefined): DocumentAssessmentV1["reportingPeriodDetection"] {
  if (conflicting) return "conflicting";
  return /\b(?:Q[1-4]\s+20\d{2}|20\d{2}|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\b/i.test(text)
    ? "detected"
    : "not_detected";
}

function assessmentState({
  kind,
  reasons,
  score,
  imageOnlyPages,
  pageCount,
  visualClass
}: {
  kind: DocumentPilotFileKind;
  reasons: readonly DocumentAssessmentReasonCode[];
  score: number;
  imageOnlyPages: number | null;
  pageCount: number | null;
  visualClass: DocumentAssessmentInputV1["visualDocumentClass"];
}): DocumentAssessmentState {
  if (kind === "unsupported") return "unsupported";
  if (kind === "csv" || kind === "xlsx") return "native_clean";
  if (kind === "png" || kind === "jpeg" || visualClass) return "visual_specialist_required";
  if (kind === "pdf" && pageCount && imageOnlyPages !== null && imageOnlyPages >= pageCount) return "image_only";
  if (reasons.includes("critical_numbers_without_labels") || reasons.includes("conflicting_reporting_periods") || reasons.includes("critical_page_provenance_missing")) {
    return "review_required";
  }
  if (reasons.some((reason) => HIGH_SEVERITY.has(reason)) || score < 60) return "native_low_quality";
  if (score < 90 || reasons.length) return "native_acceptable";
  return "native_clean";
}

export function assessDocumentForPilot(input: DocumentAssessmentInputV1): DocumentAssessmentV1 {
  const kind = documentFileKind(input.extension);
  const magicBytes = magicAssessment(input, kind);
  const text = input.native.text || "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  const pageCount = input.native.pageCount && input.native.pageCount > 0 ? Math.floor(input.native.pageCount) : null;
  const imageOnlyPages = input.native.imageOnlyPageEstimate === undefined
    ? null
    : Math.max(0, Math.floor(input.native.imageOnlyPageEstimate));
  const extractedCharacterCount = cleaned.length;
  const charactersPerPage = pageCount ? Math.round(extractedCharacterCount / pageCount) : null;
  const textLayerCoverage = pageCount && input.native.nativeTextPageCount !== undefined
    ? boundedRatio(input.native.nativeTextPageCount / pageCount)
    : null;
  const invalidRatio = invalidCharacterRatio(text);
  const garbageRatio = repeatedGarbageRatio(text);
  const detectedTable = input.native.tableDetected ?? tableDetected(text);
  const numberCount = numericTokens(text).length;
  const labeledCount = input.native.criticalFieldsWithLabels ?? labeledNumericFields(text);
  const criticalCount = input.native.criticalFieldCount ?? numberCount;
  const reasons: DocumentAssessmentReasonCode[] = [];

  if (kind === "unsupported") reasons.push("unsupported_file_type");
  if (kind === "csv" || kind === "xlsx") reasons.push("structured_native_required");
  if (!magicBytes.declaredTypeMatches || !magicBytes.extensionMatches) reasons.push("declared_type_mismatch");
  if (kind === "png" || kind === "jpeg" || input.visualDocumentClass) reasons.push("image_input_requires_visual_extraction");
  if (kind === "pdf" && pageCount && imageOnlyPages !== null && imageOnlyPages >= pageCount) reasons.push("image_only_document");
  if ((kind === "pdf" || kind === "docx") && extractedCharacterCount < 20) reasons.push("no_meaningful_native_text");
  else if ((kind === "pdf" || kind === "docx") && charactersPerPage !== null && charactersPerPage < 80) reasons.push("low_characters_per_page");
  if (invalidRatio >= 0.05) reasons.push("severe_invalid_character_ratio");
  else if (invalidRatio >= 0.015) reasons.push("elevated_invalid_character_ratio");
  if (garbageRatio >= 0.35) reasons.push("severe_repeated_garbage");
  else if (garbageRatio >= 0.18) reasons.push("elevated_repeated_garbage");
  if (input.native.readingOrderQuality === "corrupt") reasons.push("reading_order_corrupt");
  else if (input.native.readingOrderQuality === "degraded") reasons.push("reading_order_degraded");
  if (detectedTable && input.native.tableReconstructionSuccess === false) reasons.push("table_reconstruction_failed");
  if (criticalCount > 0 && labeledCount / criticalCount < 0.6) reasons.push("critical_numbers_without_labels");
  if (input.native.conflictingReportingPeriods) reasons.push("conflicting_reporting_periods");
  if (criticalCount > 0 && (input.native.criticalFieldsWithPageProvenance ?? criticalCount) < criticalCount) reasons.push("critical_page_provenance_missing");
  if (input.native.unsupportedLayout) reasons.push("unsupported_document_layout");
  if (input.native.validatorPassed === false) reasons.push("native_validator_failed");

  const uniqueReasons = Array.from(new Set(reasons)).sort() as DocumentAssessmentReasonCode[];
  const score = Math.max(0, Math.min(100, 100 - uniqueReasons.reduce((sum, reason) => sum + (SCORE_PENALTIES[reason] || 0), 0)));
  const state = assessmentState({ kind, reasons: uniqueReasons, score, imageOnlyPages, pageCount, visualClass: input.visualDocumentClass });
  if ((state === "native_clean" || state === "native_acceptable") && !uniqueReasons.includes("structured_native_required")) {
    uniqueReasons.push(state === "native_clean" ? "native_text_clean" : "native_text_acceptable");
  }

  return {
    version: DOCUMENT_ASSESSMENT_VERSION,
    mimeType: input.declaredMimeType.trim().toLowerCase(),
    extension: normalizedExtension(input.extension),
    fileKind: kind,
    magicBytes,
    pageCount,
    fileSizeBytes: Math.max(0, Math.floor(input.fileSizeBytes)),
    nativeTextAvailable: extractedCharacterCount > 0,
    extractedCharacterCount,
    charactersPerPage,
    imageOnlyPageEstimate: imageOnlyPages,
    textLayerCoverage,
    invalidCharacterRatio: invalidRatio,
    repeatedGarbageRatio: garbageRatio,
    readingOrderQuality: input.native.readingOrderQuality || "unknown",
    numericTokenCount: numberCount,
    labeledNumericFieldCount: labeledCount,
    currencyTokenCount: (text.match(/(?:(?:\$|\u00a3|\u20ac)\s*[-+]?\d|\b(?:USD|CAD|EUR|GBP)\b)/gi) || []).length,
    percentageTokenCount: (text.match(/[-+]?\d+(?:\.\d+)?\s*%/g) || []).length,
    dateTokenCount: (text.match(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g) || []).length,
    reportingPeriodDetection: periodState(text, input.native.conflictingReportingPeriods),
    tableDetection: detectedTable,
    tableReconstructionSuccess: input.native.tableReconstructionSuccess ?? (detectedTable ? null : true),
    pageAssociationAvailable: input.native.pageAssociationAvailable === true,
    orientation: input.native.orientation || "unknown",
    rotation: input.native.rotation ?? "unknown",
    skewIndicators: [...(input.native.skewIndicators || [])],
    lowResolutionIndicators: [...(input.native.lowResolutionIndicators || [])],
    contrastIndicators: [...(input.native.contrastIndicators || [])],
    extractionWarnings: [...(input.native.extractionWarnings || [])],
    assessmentScore: score,
    state,
    reasonCodes: uniqueReasons
  };
}
