import "server-only";

import { createHash } from "node:crypto";
import {
  DOCUMENT_EXTRACTION_CONTRACT_VERSION,
  DOCUMENT_EXTRACTION_NORMALIZATION_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_MAX_PAGES,
  type DocumentExtractionCriticalFieldKind,
  type DocumentExtractionCriticalFieldManifestV1,
  type DocumentExtractionCriticalFieldManifestV2,
  type DocumentExtractionCriticalFieldValueType,
  type DocumentExtractionDocumentClass,
  type DocumentExtractionReviewProvenanceV1,
  type DocumentExtractionRoute,
  type DocumentSourceCoordinatesV1,
  type NormalizedDocumentExtractionArtifactV1
} from "@/lib/document-extraction/contracts";

const MAX_ARTIFACT_BYTES = 8_000_000;
const MAX_BLOCKS = 4_000;
const MAX_CRITICAL_FIELDS = 500;
const MAX_FINDINGS = 1_000;
const BLOCK_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const REASON_CODE = /^[a-z0-9._:-]{1,100}$/;
const CRITICAL_FIELD_KINDS = new Set<DocumentExtractionCriticalFieldKind>([
  "kpi_name",
  "current_value",
  "target",
  "sign",
  "decimal",
  "currency",
  "percentage",
  "unit",
  "reporting_period",
  "page",
  "source_coordinates"
]);

type JsonPrimitive = string | number | boolean | null;

export type NormalizedDocumentExtractionArtifactDraftV1 = Omit<
  NormalizedDocumentExtractionArtifactV1,
  "contractVersion" | "normalizationVersion" | "artifactFingerprint"
>;

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}.`);
  }
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string) {
  const expected = new Set(keys);
  if (Object.keys(value).length !== expected.size || Object.keys(value).some((key) => !expected.has(key))) {
    throw new Error(`Invalid ${label}.`);
  }
}

function normalizedCoordinates(
  value: unknown,
  pageCount: number,
  expectedPage?: number
): DocumentSourceCoordinatesV1 | null {
  if (value === null) return null;
  assertRecord(value, "normalized source coordinates");
  assertExactKeys(value, ["page", "x", "y", "width", "height"], "normalized source coordinates");
  const { page, x, y, width, height } = value;
  if (
    typeof page !== "number" ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > pageCount ||
    (expectedPage !== undefined && page !== expectedPage) ||
    ![x, y, width, height].every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate)) ||
    (x as number) < 0 ||
    (y as number) < 0 ||
    (width as number) <= 0 ||
    (height as number) <= 0 ||
    (x as number) + (width as number) > 1 ||
    (y as number) + (height as number) > 1
  ) {
    throw new Error("Invalid normalized source coordinates.");
  }
  return {
    page,
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number
  };
}

function assertPrimitive(value: unknown): asserts value is JsonPrimitive {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e15) return;
  throw new Error("Invalid normalized critical-field value.");
}

function assertRoute(route: DocumentExtractionRoute) {
  if (route !== "nvidia_primary" && route !== "nvidia_fallback") {
    throw new Error("The private worker may complete only NVIDIA extraction routes.");
  }
}

function assertDocumentClass(value: DocumentExtractionDocumentClass) {
  if (![
    "digital_pdf",
    "digital_docx",
    "scanned_pdf",
    "image_only_pdf",
    "png",
    "jpeg",
    "screenshot",
    "phone_photo"
  ].includes(value)) {
    throw new Error("Invalid normalized document class.");
  }
}

export function buildNormalizedDocumentExtractionArtifact(
  draft: NormalizedDocumentExtractionArtifactDraftV1
): NormalizedDocumentExtractionArtifactV1 {
  const candidate = draft as unknown;
  assertRecord(candidate, "normalized extraction artifact");
  assertExactKeys(
    candidate,
    ["route", "documentClass", "pageCount", "pages", "criticalFields", "validationFindings"],
    "normalized extraction artifact"
  );
  assertRoute(candidate.route as DocumentExtractionRoute);
  assertDocumentClass(candidate.documentClass as DocumentExtractionDocumentClass);
  if (
    !Number.isInteger(candidate.pageCount)
    || (candidate.pageCount as number) < 1
    || (candidate.pageCount as number) > NVIDIA_DOCUMENT_EXTRACTION_MAX_PAGES
  ) {
    throw new Error("Invalid normalized page count.");
  }
  const pageCount = candidate.pageCount as number;
  if (!Array.isArray(candidate.pages) || candidate.pages.length !== pageCount) {
    throw new Error("Every normalized page must be represented exactly once.");
  }
  const seenPages = new Set<number>();
  const seenBlocks = new Set<string>();
  const pages: NormalizedDocumentExtractionArtifactV1["pages"] = [];
  let blockCount = 0;
  for (const page of candidate.pages) {
    assertRecord(page, "normalized page");
    assertExactKeys(page, ["page", "blocks"], "normalized page");
    if (!Number.isInteger(page.page) || (page.page as number) < 1 || (page.page as number) > pageCount
      || seenPages.has(page.page as number)) {
      throw new Error("Invalid or duplicate normalized page identity.");
    }
    const pageNumber = page.page as number;
    seenPages.add(pageNumber);
    if (!Array.isArray(page.blocks)) throw new Error("Invalid normalized page blocks.");
    const blocks: NormalizedDocumentExtractionArtifactV1["pages"][number]["blocks"] = [];
    for (const block of page.blocks) {
      assertRecord(block, "normalized extraction block");
      assertExactKeys(block, ["id", "kind", "text", "coordinates"], "normalized extraction block");
      blockCount += 1;
      if (
        typeof block.id !== "string" ||
        !BLOCK_ID.test(block.id) ||
        seenBlocks.has(block.id) ||
        typeof block.kind !== "string" ||
        !["text", "table", "heading", "key_value"].includes(block.kind) ||
        typeof block.text !== "string" ||
        !block.text.trim() ||
        block.text.length > 100_000 ||
        /\u0000/.test(block.text)
      ) {
        throw new Error("Invalid normalized extraction block.");
      }
      seenBlocks.add(block.id);
      blocks.push({
        id: block.id,
        kind: block.kind as "text" | "table" | "heading" | "key_value",
        text: block.text,
        coordinates: normalizedCoordinates(block.coordinates, pageCount, pageNumber)
      });
    }
    pages.push({ page: pageNumber, blocks });
  }
  if (blockCount > MAX_BLOCKS) throw new Error("The normalized extraction contains too many blocks.");

  if (!Array.isArray(candidate.criticalFields) || candidate.criticalFields.length > MAX_CRITICAL_FIELDS) {
    throw new Error("Invalid normalized critical fields.");
  }
  const fieldIds = new Set<string>();
  const criticalFields: NormalizedDocumentExtractionArtifactV1["criticalFields"] = [];
  for (const field of candidate.criticalFields) {
    assertRecord(field, "normalized critical field");
    assertExactKeys(
      field,
      ["id", "kind", "value", "normalizedValue", "page", "coordinates", "confidence", "validationReasonCodes"],
      "normalized critical field"
    );
    const fieldPage = field.page;
    const fieldConfidence = field.confidence;
    if (
      typeof field.id !== "string" ||
      !BLOCK_ID.test(field.id) ||
      fieldIds.has(field.id) ||
      typeof field.kind !== "string" ||
      !CRITICAL_FIELD_KINDS.has(field.kind as DocumentExtractionCriticalFieldKind) ||
      typeof fieldPage !== "number" ||
      !Number.isInteger(fieldPage) ||
      fieldPage < 1 ||
      fieldPage > pageCount ||
      (fieldConfidence !== null && (
        typeof fieldConfidence !== "number"
        || !Number.isFinite(fieldConfidence)
        || fieldConfidence < 0
        || fieldConfidence > 1
      )) ||
      !Array.isArray(field.validationReasonCodes) ||
      field.validationReasonCodes.length > 20 ||
      !field.validationReasonCodes.every((code) => typeof code === "string" && REASON_CODE.test(code))
    ) {
      throw new Error("Invalid normalized critical-field identity.");
    }
    fieldIds.add(field.id);
    assertPrimitive(field.value);
    assertPrimitive(field.normalizedValue);
    criticalFields.push({
      id: field.id,
      kind: field.kind as DocumentExtractionCriticalFieldKind,
      value: field.value,
      normalizedValue: field.normalizedValue,
      page: fieldPage,
      coordinates: normalizedCoordinates(field.coordinates, pageCount, fieldPage),
      confidence: fieldConfidence as number | null,
      validationReasonCodes: [...field.validationReasonCodes] as string[]
    });
  }

  if (!Array.isArray(candidate.validationFindings) || candidate.validationFindings.length > MAX_FINDINGS) {
    throw new Error("Invalid extraction validation findings.");
  }
  const validationFindings: NormalizedDocumentExtractionArtifactV1["validationFindings"] = [];
  for (const finding of candidate.validationFindings) {
    assertRecord(finding, "extraction validation finding");
    assertExactKeys(finding, ["code", "severity", "fieldId", "page"], "extraction validation finding");
    const findingPage = finding.page;
    if (
      typeof finding.code !== "string" ||
      !REASON_CODE.test(finding.code) ||
      typeof finding.severity !== "string" ||
      !["info", "warning", "error"].includes(finding.severity) ||
      (finding.fieldId !== null && (typeof finding.fieldId !== "string" || !fieldIds.has(finding.fieldId))) ||
      (findingPage !== null && (
        typeof findingPage !== "number"
        || !Number.isInteger(findingPage)
        || findingPage < 1
        || findingPage > pageCount
      ))
    ) {
      throw new Error("Invalid extraction validation finding.");
    }
    validationFindings.push({
      code: finding.code,
      severity: finding.severity as "info" | "warning" | "error",
      fieldId: finding.fieldId as string | null,
      page: findingPage as number | null
    });
  }

  const fingerprintInput = {
    contractVersion: DOCUMENT_EXTRACTION_CONTRACT_VERSION,
    normalizationVersion: DOCUMENT_EXTRACTION_NORMALIZATION_VERSION,
    route: candidate.route as DocumentExtractionRoute,
    documentClass: candidate.documentClass as DocumentExtractionDocumentClass,
    pageCount,
    pages: pages.sort((left, right) => left.page - right.page),
    criticalFields,
    validationFindings
  };
  const serialized = canonicalJson(fingerprintInput);
  if (Buffer.byteLength(serialized, "utf8") > MAX_ARTIFACT_BYTES) {
    throw new Error("The normalized extraction artifact exceeds its size boundary.");
  }
  return {
    ...fingerprintInput,
    artifactFingerprint: createHash("sha256").update(serialized).digest("hex")
  };
}

export function parseNormalizedDocumentExtractionArtifact(
  value: unknown
): NormalizedDocumentExtractionArtifactV1 {
  assertRecord(value, "decrypted extraction artifact");
  assertExactKeys(
    value,
    [
      "contractVersion",
      "normalizationVersion",
      "route",
      "documentClass",
      "pageCount",
      "pages",
      "criticalFields",
      "validationFindings",
      "artifactFingerprint"
    ],
    "decrypted extraction artifact"
  );
  if (
    value.contractVersion !== DOCUMENT_EXTRACTION_CONTRACT_VERSION
    || value.normalizationVersion !== DOCUMENT_EXTRACTION_NORMALIZATION_VERSION
    || typeof value.artifactFingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(value.artifactFingerprint)
  ) {
    throw new Error("The decrypted extraction artifact is malformed.");
  }
  const artifact = buildNormalizedDocumentExtractionArtifact({
    route: value.route as DocumentExtractionRoute,
    documentClass: value.documentClass as DocumentExtractionDocumentClass,
    pageCount: value.pageCount as number,
    pages: value.pages as NormalizedDocumentExtractionArtifactV1["pages"],
    criticalFields: value.criticalFields as NormalizedDocumentExtractionArtifactV1["criticalFields"],
    validationFindings: value.validationFindings as NormalizedDocumentExtractionArtifactV1["validationFindings"]
  });
  if (artifact.artifactFingerprint !== value.artifactFingerprint) {
    throw new Error("The decrypted extraction artifact fingerprint is invalid.");
  }
  return artifact;
}

function fieldValueType(kind: DocumentExtractionCriticalFieldKind, value: JsonPrimitive): DocumentExtractionCriticalFieldValueType {
  if (kind === "source_coordinates") return "coordinates";
  if (kind === "page" || typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
}

export function criticalFieldManifestForArtifact(
  artifact: NormalizedDocumentExtractionArtifactV1
): DocumentExtractionCriticalFieldManifestV1 {
  return {
    manifest_version: "document_extraction_critical_fields_v1",
    artifact_fingerprint: artifact.artifactFingerprint,
    extraction_contract_version: DOCUMENT_EXTRACTION_CONTRACT_VERSION,
    fields: artifact.criticalFields.map((field) => ({
      id: field.id,
      kind: field.kind,
      value_type: fieldValueType(field.kind, field.normalizedValue)
    }))
  };
}

export function criticalFieldManifestForArtifactWithProvenance(
  artifact: NormalizedDocumentExtractionArtifactV1,
  provenance: DocumentExtractionReviewProvenanceV1,
  reviewProvenanceFingerprint: string
): DocumentExtractionCriticalFieldManifestV2 {
  if (
    provenance.content_fingerprint !== artifact.artifactFingerprint
    || !/^[0-9a-f]{64}$/.test(reviewProvenanceFingerprint)
  ) {
    throw new Error("The review provenance does not match the normalized extraction artifact.");
  }
  const historicalManifest = criticalFieldManifestForArtifact(artifact);
  return {
    manifest_version: "document_extraction_critical_fields_v2",
    artifact_fingerprint: artifact.artifactFingerprint,
    extraction_contract_version: DOCUMENT_EXTRACTION_CONTRACT_VERSION,
    review_provenance_fingerprint: reviewProvenanceFingerprint,
    review_provenance: provenance,
    fields: historicalManifest.fields
  };
}

export function canonicalDocumentExtractionJson(value: unknown) {
  return canonicalJson(value);
}
