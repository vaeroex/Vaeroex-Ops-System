import "server-only";

import { createHash } from "node:crypto";
import {
  DOCUMENT_AGREEMENT_VERSION,
  type DocumentCriticalField,
  type DocumentExtractionAgreementV1,
  type DocumentFieldAgreement,
  type ProviderNeutralDocumentExtractionV1
} from "@/lib/ai/document-intelligence-poc/pilot-contracts";

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/[,\s]+/g, " ")
    .trim();
}

function fieldKey(field: DocumentCriticalField) {
  return `${field.type}:${normalize(field.identity)}`;
}

function identityHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function exactFieldMatch(left: DocumentCriticalField, right: DocumentCriticalField) {
  return left.value === right.value && left.page === right.page && JSON.stringify(left.sourceCoordinates) === JSON.stringify(right.sourceCoordinates);
}

function normalizedFieldMatch(left: DocumentCriticalField, right: DocumentCriticalField) {
  return normalize(left.value) === normalize(right.value) && left.page === right.page;
}

export function compareDocumentExtractions(
  nativeExtraction: ProviderNeutralDocumentExtractionV1,
  nvidiaExtraction: ProviderNeutralDocumentExtractionV1
): DocumentExtractionAgreementV1 {
  if (nativeExtraction.status !== "success" && nvidiaExtraction.status !== "success") {
    return {
      version: DOCUMENT_AGREEMENT_VERSION,
      classification: "both_unreliable",
      fieldsCompared: 0,
      criticalDisagreements: 0,
      reviewRequired: true,
      fieldResults: [],
      establishesBusinessTruth: false
    };
  }

  const nativeByKey = new Map(nativeExtraction.criticalFields.map((field) => [fieldKey(field), field]));
  const nvidiaByKey = new Map(nvidiaExtraction.criticalFields.map((field) => [fieldKey(field), field]));
  const keys = Array.from(new Set([...nativeByKey.keys(), ...nvidiaByKey.keys()])).sort();
  const fieldResults: DocumentFieldAgreement[] = keys.map((key) => {
    const nativeField = nativeByKey.get(key);
    const nvidiaField = nvidiaByKey.get(key);
    const field = nativeField || nvidiaField;
    if (!field) throw new Error("Agreement comparison encountered an empty field identity.");
    const result = !nativeField
      ? "missing_native"
      : !nvidiaField
        ? "missing_nvidia"
        : exactFieldMatch(nativeField, nvidiaField)
          ? "exact"
          : normalizedFieldMatch(nativeField, nvidiaField)
            ? "normalized"
            : "different";
    return {
      identityHash: identityHash(key),
      fieldType: field.type,
      result,
      critical: field.critical || nativeField?.critical === true || nvidiaField?.critical === true
    };
  });
  const criticalDisagreements = fieldResults.filter((field) => field.critical && field.result !== "exact" && field.result !== "normalized").length;
  const missing = fieldResults.some((field) => field.result === "missing_native" || field.result === "missing_nvidia");
  const noncriticalDifference = fieldResults.some((field) => !field.critical && field.result !== "exact" && field.result !== "normalized");
  const normalizedDifference = fieldResults.some((field) => field.result === "normalized");
  const classification = criticalDisagreements
    ? "critical_disagreement"
    : missing
      ? "one_parser_missing"
      : noncriticalDifference
        ? "noncritical_disagreement"
        : normalizedDifference
          ? "normalized_agreement"
          : "exact_agreement";
  return {
    version: DOCUMENT_AGREEMENT_VERSION,
    classification,
    fieldsCompared: fieldResults.length,
    criticalDisagreements,
    reviewRequired: classification !== "exact_agreement" && classification !== "normalized_agreement",
    fieldResults,
    establishesBusinessTruth: false
  };
}
