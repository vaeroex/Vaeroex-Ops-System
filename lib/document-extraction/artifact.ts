import "server-only";

import { createHash } from "node:crypto";
import {
  DOCUMENT_EXTRACTION_CONTRACT_VERSION,
  DOCUMENT_EXTRACTION_CONTRACT_VERSION_V2,
  DOCUMENT_EXTRACTION_NORMALIZATION_VERSION,
  DOCUMENT_EXTRACTION_NORMALIZATION_VERSION_V2,
  GOOGLE_DOCUMENT_EXTRACTION_MAX_PAGES,
  NVIDIA_DOCUMENT_EXTRACTION_MAX_PAGES,
  type DocumentExtractionCriticalFieldKind,
  type DocumentExtractionCriticalFieldManifestV1,
  type DocumentExtractionCriticalFieldManifestV2,
  type DocumentExtractionCriticalFieldManifestV3,
  type DocumentExtractionCriticalFieldValueType,
  type DocumentExtractionDocumentClass,
  type DocumentExtractionReviewProvenanceV1,
  type DocumentExtractionReviewProvenanceV2,
  type DocumentExtractionRoute,
  type DocumentExtractionPageStructureV1,
  type DocumentSourceCoordinatesV1,
  type NormalizedDocumentExtractionArtifact,
  type NormalizedDocumentExtractionArtifactV1,
  type NormalizedDocumentExtractionArtifactV2
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

export type NormalizedDocumentExtractionArtifactDraftV2 = Omit<
  NormalizedDocumentExtractionArtifactV2,
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
    route: candidate.route as NormalizedDocumentExtractionArtifactV1["route"],
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

const STRUCTURAL_ID = /^page-[1-9][0-9]*-(?:block|paragraph|line|token|table|table-[1-9][0-9]*-(?:header|body)-row|table-[1-9][0-9]*-(?:header|body)-row-[1-9][0-9]*-cell)-[1-9][0-9]*$/;
const LANGUAGE_CODE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
const ORIENTATIONS = new Set([
  "ORIENTATION_UNSPECIFIED",
  "PAGE_DOWN",
  "PAGE_LEFT",
  "PAGE_RIGHT",
  "PAGE_UP"
]);
const DETECTED_BREAKS = new Set(["TYPE_UNSPECIFIED", "SPACE", "WIDE_SPACE", "HYPHEN"]);
const IMAGE_QUALITY_DEFECTS = new Set([
  "quality/defect_blurry",
  "quality/defect_noisy",
  "quality/defect_dark",
  "quality/defect_faint",
  "quality/defect_text_too_small",
  "quality/defect_document_cutoff",
  "quality/defect_text_cutoff",
  "quality/defect_glare"
]);

function confidence(value: unknown, label: string, required = false) {
  if (value === null && !required) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid ${label}.`);
  }
  return value;
}

function detectedLanguages(value: unknown) {
  if (!Array.isArray(value) || value.length > 64) throw new Error("Invalid detected languages.");
  const seen = new Set<string>();
  return value.map((item) => {
    assertRecord(item, "detected language");
    assertExactKeys(item, ["languageCode", "confidence"], "detected language");
    if (
      typeof item.languageCode !== "string"
      || !LANGUAGE_CODE.test(item.languageCode)
      || seen.has(item.languageCode)
    ) {
      throw new Error("Invalid detected language.");
    }
    seen.add(item.languageCode);
    return {
      languageCode: item.languageCode,
      confidence: confidence(item.confidence, "detected-language confidence")
    };
  });
}

function structuralLayout(
  value: unknown,
  pageCount: number,
  expectedPage: number,
  allowEmptyText = false
) {
  assertRecord(value, "document structure layout");
  assertExactKeys(
    value,
    ["text", "textSegments", "confidence", "orientation", "coordinates", "polygon"],
    "document structure layout"
  );
  if (
    typeof value.text !== "string"
    || value.text.length > 100_000
    || /\u0000/.test(value.text)
    || !Array.isArray(value.textSegments)
    || (!allowEmptyText && value.textSegments.length < 1)
    || value.textSegments.length > 64
    || (allowEmptyText && value.text === "" && value.textSegments.length !== 0)
    || (allowEmptyText && value.text !== "" && value.textSegments.length < 1)
  ) {
    throw new Error("Invalid document structure text.");
  }
  let priorEnd = -1;
  const textSegments = value.textSegments.map((segment) => {
    assertRecord(segment, "document structure text segment");
    assertExactKeys(segment, ["start", "end"], "document structure text segment");
    if (
      !Number.isSafeInteger(segment.start)
      || !Number.isSafeInteger(segment.end)
      || (segment.start as number) < 0
      || (segment.end as number) <= (segment.start as number)
      || (segment.start as number) < priorEnd
    ) {
      throw new Error("Invalid document structure text segment.");
    }
    priorEnd = segment.end as number;
    return { start: segment.start as number, end: segment.end as number };
  });
  if (
    value.orientation !== null
    && (typeof value.orientation !== "string" || !ORIENTATIONS.has(value.orientation))
  ) {
    throw new Error("Invalid document structure orientation.");
  }
  const coordinates = normalizedCoordinates(value.coordinates, pageCount, expectedPage);
  if (coordinates === null || !Array.isArray(value.polygon) || value.polygon.length !== 4) {
    throw new Error("Invalid document structure geometry.");
  }
  const polygon = value.polygon.map((point) => {
    assertRecord(point, "document structure polygon point");
    assertExactKeys(point, ["x", "y"], "document structure polygon point");
    if (
      typeof point.x !== "number"
      || typeof point.y !== "number"
      || !Number.isFinite(point.x)
      || !Number.isFinite(point.y)
      || point.x < 0
      || point.x > 1
      || point.y < 0
      || point.y > 1
    ) {
      throw new Error("Invalid document structure polygon point.");
    }
    return { x: point.x, y: point.y };
  });
  const minX = Math.min(...polygon.map((point) => point.x));
  const minY = Math.min(...polygon.map((point) => point.y));
  const maxX = Math.max(...polygon.map((point) => point.x));
  const maxY = Math.max(...polygon.map((point) => point.y));
  if (
    Math.abs(coordinates.x - minX) > Number.EPSILON
    || Math.abs(coordinates.y - minY) > Number.EPSILON
    || Math.abs(coordinates.width - (maxX - minX)) > Number.EPSILON
    || Math.abs(coordinates.height - (maxY - minY)) > Number.EPSILON
  ) {
    throw new Error("Document structure polygon and coordinates do not agree.");
  }
  return {
    text: value.text,
    textSegments,
    confidence: confidence(value.confidence, "document structure confidence"),
    orientation: value.orientation as DocumentExtractionPageStructureV1["pageLayout"]["orientation"],
    coordinates,
    polygon
  };
}

function structuralElements(
  value: unknown,
  expectedKind: "block" | "paragraph" | "line" | "token",
  pageCount: number,
  page: number,
  limit: number,
  seenIds: Set<string>
) {
  if (!Array.isArray(value) || value.length < 1 || value.length > limit) {
    throw new Error(`Invalid document structure ${expectedKind}s.`);
  }
  return value.map((element) => {
    assertRecord(element, `document structure ${expectedKind}`);
    const keys = expectedKind === "token"
      ? ["id", "kind", "layout", "detectedLanguages", "detectedBreak"]
      : ["id", "kind", "layout", "detectedLanguages"];
    assertExactKeys(element, keys, `document structure ${expectedKind}`);
    if (
      typeof element.id !== "string"
      || !STRUCTURAL_ID.test(element.id)
      || !element.id.startsWith(`page-${page}-${expectedKind}-`)
      || seenIds.has(element.id)
      || element.kind !== expectedKind
    ) {
      throw new Error(`Invalid document structure ${expectedKind} identity.`);
    }
    seenIds.add(element.id);
    if (
      expectedKind === "token"
      && element.detectedBreak !== null
      && (typeof element.detectedBreak !== "string" || !DETECTED_BREAKS.has(element.detectedBreak))
    ) {
      throw new Error("Invalid document structure token break.");
    }
    return {
      id: element.id,
      kind: expectedKind,
      layout: structuralLayout(element.layout, pageCount, page),
      detectedLanguages: detectedLanguages(element.detectedLanguages),
      ...(expectedKind === "token"
        ? { detectedBreak: element.detectedBreak as "TYPE_UNSPECIFIED" | "SPACE" | "WIDE_SPACE" | "HYPHEN" | null }
        : {})
    };
  });
}

function tables(
  value: unknown,
  pageCount: number,
  page: number,
  seenIds: Set<string>
) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Invalid document structure tables.");
  let cellCount = 0;
  return value.map((table) => {
    assertRecord(table, "document structure table");
    assertExactKeys(
      table,
      ["id", "kind", "layout", "detectedLanguages", "headerRows", "bodyRows"],
      "document structure table"
    );
    if (
      typeof table.id !== "string"
      || !STRUCTURAL_ID.test(table.id)
      || !table.id.startsWith(`page-${page}-table-`)
      || seenIds.has(table.id)
      || table.kind !== "table"
      || !Array.isArray(table.headerRows)
      || !Array.isArray(table.bodyRows)
      || table.headerRows.length + table.bodyRows.length < 1
      || table.headerRows.length + table.bodyRows.length > 1_000
    ) {
      throw new Error("Invalid document structure table identity.");
    }
    seenIds.add(table.id);
    const rows = (rawRows: unknown[], kind: "header" | "body") => rawRows.map((row) => {
      assertRecord(row, "document structure table row");
      assertExactKeys(row, ["id", "cells"], "document structure table row");
      if (
        typeof row.id !== "string"
        || !STRUCTURAL_ID.test(row.id)
        || !row.id.startsWith(`${table.id}-${kind}-row-`)
        || seenIds.has(row.id)
        || !Array.isArray(row.cells)
        || row.cells.length < 1
        || row.cells.length > 1_000
      ) {
        throw new Error("Invalid document structure table row.");
      }
      seenIds.add(row.id);
      return {
        id: row.id,
        cells: row.cells.map((cell) => {
          assertRecord(cell, "document structure table cell");
          assertExactKeys(
            cell,
            ["id", "layout", "rowSpan", "colSpan", "detectedLanguages"],
            "document structure table cell"
          );
          cellCount += 1;
          if (
            cellCount > 5_000
            || typeof cell.id !== "string"
            || !STRUCTURAL_ID.test(cell.id)
            || !cell.id.startsWith(`${row.id}-cell-`)
            || seenIds.has(cell.id)
            || !Number.isInteger(cell.rowSpan)
            || !Number.isInteger(cell.colSpan)
            || (cell.rowSpan as number) < 1
            || (cell.rowSpan as number) > 100
            || (cell.colSpan as number) < 1
            || (cell.colSpan as number) > 100
          ) {
            throw new Error("Invalid document structure table cell.");
          }
          seenIds.add(cell.id);
          return {
            id: cell.id,
            layout: structuralLayout(cell.layout, pageCount, page, true),
            rowSpan: cell.rowSpan as number,
            colSpan: cell.colSpan as number,
            detectedLanguages: detectedLanguages(cell.detectedLanguages)
          };
        })
      };
    });
    return {
      id: table.id,
      kind: "table" as const,
      layout: structuralLayout(table.layout, pageCount, page),
      detectedLanguages: detectedLanguages(table.detectedLanguages),
      headerRows: rows(table.headerRows, "header"),
      bodyRows: rows(table.bodyRows, "body")
    };
  });
}

function pageStructure(
  value: unknown,
  pageCount: number,
  page: number,
  seenIds: Set<string>
): DocumentExtractionPageStructureV1 {
  assertRecord(value, "provider-neutral document structure");
  assertExactKeys(
    value,
    [
      "structureVersion",
      "pageLayout",
      "detectedLanguages",
      "blocks",
      "paragraphs",
      "lines",
      "tokens",
      "tables",
      "selectionMarks",
      "imageQuality"
    ],
    "provider-neutral document structure"
  );
  if (value.structureVersion !== "provider_neutral_document_structure_v1") {
    throw new Error("Invalid provider-neutral document structure version.");
  }
  if (!Array.isArray(value.selectionMarks) || value.selectionMarks.length !== 0) {
    throw new Error("Selection marks are not enabled for this provider profile.");
  }
  assertRecord(value.imageQuality, "document image quality");
  assertExactKeys(value.imageQuality, ["qualityScore", "detectedDefects"], "document image quality");
  if (!Array.isArray(value.imageQuality.detectedDefects) || value.imageQuality.detectedDefects.length > 8) {
    throw new Error("Invalid document image quality defects.");
  }
  const seenDefects = new Set<string>();
  const detectedDefects = value.imageQuality.detectedDefects.map((defect) => {
    assertRecord(defect, "document image quality defect");
    assertExactKeys(defect, ["type", "confidence"], "document image quality defect");
    if (
      typeof defect.type !== "string"
      || !IMAGE_QUALITY_DEFECTS.has(defect.type)
      || seenDefects.has(defect.type)
    ) {
      throw new Error("Invalid document image quality defect.");
    }
    seenDefects.add(defect.type);
    return {
      type: defect.type,
      confidence: confidence(defect.confidence, "document image quality defect confidence")
    };
  });
  return {
    structureVersion: "provider_neutral_document_structure_v1",
    pageLayout: structuralLayout(value.pageLayout, pageCount, page),
    detectedLanguages: detectedLanguages(value.detectedLanguages),
    blocks: structuralElements(value.blocks, "block", pageCount, page, 1_000, seenIds),
    paragraphs: structuralElements(value.paragraphs, "paragraph", pageCount, page, 2_000, seenIds),
    lines: structuralElements(value.lines, "line", pageCount, page, 4_000, seenIds),
    tokens: structuralElements(value.tokens, "token", pageCount, page, 20_000, seenIds),
    tables: tables(value.tables, pageCount, page, seenIds),
    selectionMarks: [],
    imageQuality: {
      qualityScore: confidence(
        value.imageQuality.qualityScore,
        "document image quality score",
        true
      ) as number,
      detectedDefects
    }
  };
}

export function buildNormalizedDocumentExtractionArtifactV2(
  draft: NormalizedDocumentExtractionArtifactDraftV2
): NormalizedDocumentExtractionArtifactV2 {
  const candidate = draft as unknown;
  assertRecord(candidate, "normalized extraction artifact v2");
  assertExactKeys(
    candidate,
    ["route", "documentClass", "pageCount", "pages", "criticalFields", "validationFindings"],
    "normalized extraction artifact v2"
  );
  if (candidate.route !== "google_primary" && candidate.route !== "google_fallback") {
    throw new Error("The Google profile may complete only Google extraction routes.");
  }
  if (![
    "digital_pdf",
    "scanned_pdf",
    "image_only_pdf",
    "printed_document_photo",
    "typed_form",
    "invoice_like",
    "receipt_like",
    "printed_table_document"
  ].includes(candidate.documentClass as string)) {
    throw new Error("Invalid Google document class.");
  }
  const documentClass = candidate.documentClass as DocumentExtractionDocumentClass;
  if (
    !Number.isInteger(candidate.pageCount)
    || (candidate.pageCount as number) < 1
    || (candidate.pageCount as number) > GOOGLE_DOCUMENT_EXTRACTION_MAX_PAGES
  ) {
    throw new Error("Invalid normalized page count.");
  }
  const pageCount = candidate.pageCount as number;
  if (!Array.isArray(candidate.pages) || candidate.pages.length !== pageCount) {
    throw new Error("Every normalized page must be represented exactly once.");
  }
  const seenPages = new Set<number>();
  const seenIds = new Set<string>();
  let summaryBlockCount = 0;
  const pages: NormalizedDocumentExtractionArtifactV2["pages"] = candidate.pages.map((page) => {
    assertRecord(page, "normalized page v2");
    assertExactKeys(page, ["page", "blocks", "structure"], "normalized page v2");
    if (
      !Number.isInteger(page.page)
      || (page.page as number) < 1
      || (page.page as number) > pageCount
      || seenPages.has(page.page as number)
      || !Array.isArray(page.blocks)
      || page.blocks.length < 1
      || page.blocks.length > 1_000
    ) {
      throw new Error("Invalid or duplicate normalized page identity.");
    }
    const pageNumber = page.page as number;
    seenPages.add(pageNumber);
    const blocks = page.blocks.map((block) => {
      assertRecord(block, "normalized extraction block v2");
      assertExactKeys(block, ["id", "kind", "text", "coordinates"], "normalized extraction block v2");
      summaryBlockCount += 1;
      if (
        summaryBlockCount > MAX_BLOCKS
        || typeof block.id !== "string"
        || !BLOCK_ID.test(block.id)
        || !block.id.startsWith(`page-${pageNumber}-element-`)
        || seenIds.has(block.id)
        || (block.kind !== "text" && block.kind !== "table")
        || typeof block.text !== "string"
        || !block.text.trim()
        || block.text.length > 100_000
        || /\u0000/.test(block.text)
      ) {
        throw new Error("Invalid normalized extraction block v2.");
      }
      seenIds.add(block.id);
      return {
        id: block.id,
        kind: block.kind as "text" | "table",
        text: block.text,
        coordinates: normalizedCoordinates(block.coordinates, pageCount, pageNumber)
      };
    });
    return {
      page: pageNumber,
      blocks,
      structure: pageStructure(page.structure, pageCount, pageNumber, seenIds)
    };
  });

  const historicalShape = buildNormalizedDocumentExtractionArtifact({
    route: "nvidia_primary",
    documentClass: "scanned_pdf",
    pageCount,
    pages: pages.map((page) => ({ page: page.page, blocks: page.blocks })),
    criticalFields: candidate.criticalFields as NormalizedDocumentExtractionArtifactV1["criticalFields"],
    validationFindings: candidate.validationFindings as NormalizedDocumentExtractionArtifactV1["validationFindings"]
  });
  const fingerprintInput = {
    contractVersion: DOCUMENT_EXTRACTION_CONTRACT_VERSION_V2,
    normalizationVersion: DOCUMENT_EXTRACTION_NORMALIZATION_VERSION_V2,
    route: candidate.route,
    documentClass,
    pageCount,
    pages: pages.sort((left, right) => left.page - right.page),
    criticalFields: historicalShape.criticalFields,
    validationFindings: historicalShape.validationFindings
  } as const;
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
    route: value.route as NormalizedDocumentExtractionArtifactV1["route"],
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

export function parseNormalizedDocumentExtractionArtifactV2(
  value: unknown
): NormalizedDocumentExtractionArtifactV2 {
  assertRecord(value, "decrypted extraction artifact v2");
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
    "decrypted extraction artifact v2"
  );
  if (
    value.contractVersion !== DOCUMENT_EXTRACTION_CONTRACT_VERSION_V2
    || value.normalizationVersion !== DOCUMENT_EXTRACTION_NORMALIZATION_VERSION_V2
    || typeof value.artifactFingerprint !== "string"
    || !/^[0-9a-f]{64}$/.test(value.artifactFingerprint)
  ) {
    throw new Error("The decrypted extraction artifact v2 is malformed.");
  }
  const artifact = buildNormalizedDocumentExtractionArtifactV2({
    route: value.route as NormalizedDocumentExtractionArtifactV2["route"],
    documentClass: value.documentClass as DocumentExtractionDocumentClass,
    pageCount: value.pageCount as number,
    pages: value.pages as NormalizedDocumentExtractionArtifactV2["pages"],
    criticalFields: value.criticalFields as NormalizedDocumentExtractionArtifactV2["criticalFields"],
    validationFindings: value.validationFindings as NormalizedDocumentExtractionArtifactV2["validationFindings"]
  });
  if (artifact.artifactFingerprint !== value.artifactFingerprint) {
    throw new Error("The decrypted extraction artifact v2 fingerprint is invalid.");
  }
  return artifact;
}

export function parseAnyNormalizedDocumentExtractionArtifact(
  value: unknown
): NormalizedDocumentExtractionArtifact {
  assertRecord(value, "decrypted extraction artifact");
  return value.contractVersion === DOCUMENT_EXTRACTION_CONTRACT_VERSION_V2
    ? parseNormalizedDocumentExtractionArtifactV2(value)
    : parseNormalizedDocumentExtractionArtifact(value);
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

export function criticalFieldManifestForArtifactV2WithProvenance(
  artifact: NormalizedDocumentExtractionArtifactV2,
  provenance: DocumentExtractionReviewProvenanceV2,
  reviewProvenanceFingerprint: string
): DocumentExtractionCriticalFieldManifestV3 {
  if (
    provenance.content_fingerprint !== artifact.artifactFingerprint
    || provenance.artifact_normalization_version !== DOCUMENT_EXTRACTION_NORMALIZATION_VERSION_V2
    || !/^[0-9a-f]{64}$/.test(reviewProvenanceFingerprint)
  ) {
    throw new Error("The review provenance does not match the normalized extraction artifact v2.");
  }
  return {
    manifest_version: "document_extraction_critical_fields_v3",
    artifact_fingerprint: artifact.artifactFingerprint,
    extraction_contract_version: DOCUMENT_EXTRACTION_CONTRACT_VERSION_V2,
    review_provenance_fingerprint: reviewProvenanceFingerprint,
    review_provenance: provenance,
    fields: artifact.criticalFields.map((field) => ({
      id: field.id,
      kind: field.kind,
      value_type: fieldValueType(field.kind, field.normalizedValue)
    }))
  };
}

export function canonicalDocumentExtractionJson(value: unknown) {
  return canonicalJson(value);
}
