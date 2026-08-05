import {
  GOOGLE_DOCUMENT_EXTRACTION_MAX_FILE_BYTES,
  GOOGLE_DOCUMENT_EXTRACTION_MAX_PAGES,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER,
  type DocumentExtractionAssessedSourceClass,
  type DocumentExtractionDocumentClass,
  type DocumentExtractionRoute
} from "@/lib/document-extraction/contracts";

export type DocumentExtractionSourceKind = "csv" | "xlsx" | "pdf" | "docx" | "png" | "jpeg";
export type NativeTextAssessment = "reliable" | "low_quality" | "missing" | "not_applicable";

export type DocumentExtractionRoutingDecision = {
  eligible: boolean;
  route: DocumentExtractionRoute | null;
  documentClass: DocumentExtractionDocumentClass | null;
  provider: "deterministic_spreadsheet" | "native" | typeof GOOGLE_DOCUMENT_EXTRACTION_PROVIDER | null;
  reason:
    | "deterministic_spreadsheet"
    | "native_text_reliable"
    | "google_printed_primary"
    | "google_native_fallback"
    | "qualification_scope_required"
    | "future_visual_provider_required"
    | "source_bounds_exceeded"
    | "unsupported_source_class"
    | "source_class_mismatch";
};

const GOOGLE_PRINTED_CLASSES = new Set<DocumentExtractionDocumentClass>([
  "digital_pdf",
  "scanned_pdf",
  "image_only_pdf",
  "printed_document_photo",
  "typed_form",
  "invoice_like",
  "receipt_like",
  "printed_table_document"
]);

const FUTURE_VISUAL_CLASSES = new Set<DocumentExtractionAssessedSourceClass>([
  "screenshot",
  "phone_photo",
  "whiteboard",
  "highly_handwritten_note",
  "mixed_scene_photo"
]);

function denied(
  reason: Exclude<DocumentExtractionRoutingDecision["reason"],
    "deterministic_spreadsheet" | "native_text_reliable" | "google_printed_primary" | "google_native_fallback">
): DocumentExtractionRoutingDecision {
  return { eligible: false, route: null, documentClass: null, provider: null, reason };
}

export function routeDocumentExtraction(input: {
  sourceKind: DocumentExtractionSourceKind;
  assessedClass: DocumentExtractionAssessedSourceClass;
  nativeTextAssessment: NativeTextAssessment;
  googleQualificationScopeApproved: boolean;
  sourceByteLength: number;
  pageCount: number;
}): DocumentExtractionRoutingDecision {
  if (input.sourceKind === "csv" || input.sourceKind === "xlsx") {
    if (input.assessedClass !== input.sourceKind) return denied("source_class_mismatch");
    return {
      eligible: true,
      route: null,
      documentClass: null,
      provider: "deterministic_spreadsheet",
      reason: "deterministic_spreadsheet"
    };
  }

  const validPdfClass = input.assessedClass === "digital_pdf"
    || input.assessedClass === "scanned_pdf"
    || input.assessedClass === "image_only_pdf"
    || input.assessedClass === "typed_form"
    || input.assessedClass === "invoice_like"
    || input.assessedClass === "receipt_like"
    || input.assessedClass === "printed_table_document";
  const validDocxClass = input.assessedClass === "digital_docx"
    || input.assessedClass === "typed_form"
    || input.assessedClass === "invoice_like"
    || input.assessedClass === "receipt_like"
    || input.assessedClass === "printed_table_document";

  if (input.sourceKind === "pdf" && input.nativeTextAssessment === "reliable") {
    if (!validPdfClass) return denied("source_class_mismatch");
    return {
      eligible: true,
      route: "native",
      documentClass: input.assessedClass as DocumentExtractionDocumentClass,
      provider: "native",
      reason: "native_text_reliable"
    };
  }
  if (input.sourceKind === "docx") {
    if (!validDocxClass) return denied("source_class_mismatch");
    if (input.nativeTextAssessment === "reliable") {
      return {
        eligible: true,
        route: "native",
        documentClass: input.assessedClass as DocumentExtractionDocumentClass,
        provider: "native",
        reason: "native_text_reliable"
      };
    }
    // The isolated renderer accepts PDF, PNG, and JPEG only. A DOCX fallback
    // needs a separately qualified conversion path before Google is eligible.
    return denied("unsupported_source_class");
  }

  if (FUTURE_VISUAL_CLASSES.has(input.assessedClass)) {
    return denied("future_visual_provider_required");
  }
  if (!GOOGLE_PRINTED_CLASSES.has(input.assessedClass as DocumentExtractionDocumentClass)) {
    return denied("unsupported_source_class");
  }
  if (
    (input.sourceKind === "png" || input.sourceKind === "jpeg")
    && input.assessedClass !== "printed_document_photo"
    && input.assessedClass !== "typed_form"
    && input.assessedClass !== "invoice_like"
    && input.assessedClass !== "receipt_like"
    && input.assessedClass !== "printed_table_document"
  ) {
    return denied("source_class_mismatch");
  }
  if (
    input.sourceKind === "pdf"
    && input.assessedClass !== "digital_pdf"
    && input.assessedClass !== "scanned_pdf"
    && input.assessedClass !== "image_only_pdf"
    && input.assessedClass !== "typed_form"
    && input.assessedClass !== "invoice_like"
    && input.assessedClass !== "receipt_like"
    && input.assessedClass !== "printed_table_document"
  ) {
    return denied("source_class_mismatch");
  }
  if (
    input.sourceKind === "pdf"
    && input.assessedClass === "digital_pdf"
    && input.nativeTextAssessment !== "low_quality"
    && input.nativeTextAssessment !== "missing"
  ) return denied("unsupported_source_class");
  if (
    !Number.isSafeInteger(input.sourceByteLength)
    || input.sourceByteLength < 1
    || input.sourceByteLength > GOOGLE_DOCUMENT_EXTRACTION_MAX_FILE_BYTES
    || !Number.isSafeInteger(input.pageCount)
    || input.pageCount < 1
    || input.pageCount > GOOGLE_DOCUMENT_EXTRACTION_MAX_PAGES
    || ((input.sourceKind === "png" || input.sourceKind === "jpeg") && input.pageCount !== 1)
  ) return denied("source_bounds_exceeded");
  if (!input.googleQualificationScopeApproved) {
    return denied("qualification_scope_required");
  }

  const nativeFallback = input.sourceKind === "pdf"
    && (input.nativeTextAssessment === "low_quality" || input.nativeTextAssessment === "missing")
    && input.assessedClass !== "scanned_pdf"
    && input.assessedClass !== "image_only_pdf";
  return {
    eligible: true,
    route: nativeFallback ? "google_fallback" : "google_primary",
    documentClass: input.assessedClass as DocumentExtractionDocumentClass,
    provider: GOOGLE_DOCUMENT_EXTRACTION_PROVIDER,
    reason: nativeFallback ? "google_native_fallback" : "google_printed_primary"
  };
}

// This module deliberately has no model or provider call. Provider selection is
// a deterministic consequence of trusted source assessment and qualification scope.
