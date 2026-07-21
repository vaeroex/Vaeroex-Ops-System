import "server-only";

export const AI_VALIDATION_REASON_CODES = [
  "response_not_json",
  "root_not_object",
  "missing_analysis",
  "invalid_analysis_shape",
  "missing_findings",
  "findings_not_array",
  "insufficient_required_findings",
  "unknown_signal_id",
  "duplicate_signal_id",
  "missing_required_signal",
  "invalid_relationship",
  "unsupported_relationship",
  "invalid_action",
  "invalid_citation_id",
  "missing_summary_signal_ids",
  "invalid_summary_signal_ids",
  "executive_summary_missing",
  "executive_summary_signal_coverage_failed",
  "invalid_overall_confidence",
  "confidence_ceiling_exceeded",
  "evidence_sufficiency_invalid",
  "agreement_invalid",
  "uncertainty_invalid",
  "schema_field_type_mismatch",
  "unexpected_truncation",
  "unsupported_inference",
  "numeric_integrity_failed",
  "contextual_validation_failed",
  "unknown_validation_failure"
] as const;

export type AIValidationReasonCode = (typeof AI_VALIDATION_REASON_CODES)[number];

export type AIValidationStage =
  | "json_parsing"
  | "canonical_schema"
  | "ranked_signal_coverage"
  | "citation_provenance"
  | "confidence"
  | "relationship_support"
  | "numeric_integrity"
  | "contextual_validation";

export type AIValidationValueType =
  | "undefined"
  | "null"
  | "boolean"
  | "number"
  | "string"
  | "array"
  | "object";

export type SafeAIValidationDiagnostic = {
  reasonCode: AIValidationReasonCode;
  stage: AIValidationStage;
  expectedField?: string;
  expectedType?: AIValidationValueType;
  observedType?: AIValidationValueType;
  expectedCount?: number;
  observedCount?: number;
  fieldPresent?: boolean;
  truncationDetected?: boolean;
};

export type StructuredOutputValidation<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; diagnostic?: SafeAIValidationDiagnostic };

export function validationValueType(value: unknown): AIValidationValueType {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "object";
}

export function validationFailure(
  reason: string,
  diagnostic: SafeAIValidationDiagnostic
): StructuredOutputValidation<never> {
  return { ok: false, reason, diagnostic };
}
