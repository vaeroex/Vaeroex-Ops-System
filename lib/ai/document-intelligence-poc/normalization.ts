import "server-only";

import { createHash } from "node:crypto";
import {
  normalizeDocumentText,
  type DocumentBoundingBox,
  type DocumentElementProvenance,
  type DocumentElementType,
  type NormalizedDocumentElement
} from "@/lib/ai/document-intelligence-poc/contracts";

const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12"
};

function numericToken(value: string) {
  const afterColon = value.includes(":") ? value.slice(value.indexOf(":") + 1) : value;
  const match = afterColon.match(/(?:[$€£]\s*)?\(?-?\d[\d,]*(?:\.\d+)?\)?%?/);
  if (!match) return null;
  const displayed = match[0].trim();
  const parenthesesNegative = /^\(.*\)$/.test(displayed.replace(/^[$€£]\s*/, ""));
  const normalized = displayed.replace(/[$€£,%()\s]/g, "");
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  const valueNumber = parenthesesNegative ? -Math.abs(parsed) : parsed;
  const decimalPart = displayed.match(/\.(\d+)/)?.[1] || "";
  return {
    displayed,
    value: valueNumber,
    sign: valueNumber < 0 ? "negative" as const : valueNumber > 0 ? "positive" as const : "zero" as const,
    decimalPrecision: decimalPart.length,
    currency: displayed.includes("$") ? "USD" : displayed.includes("€") ? "EUR" : displayed.includes("£") ? "GBP" : null,
    percentage: displayed.includes("%") ? valueNumber : null
  };
}
function reportingPeriod(value: string) {
  const quarter = value.match(/\bQ([1-4])\s+(20\d{2})\b/i);
  if (quarter) return `${quarter[2]}-Q${quarter[1]}`;
  const month = value.match(new RegExp(`\\b(${Object.keys(MONTHS).join("|")})\\s+(20\\d{2})\\b`, "i"));
  if (month) return `${month[2]}-${MONTHS[month[1].toLowerCase()]}`;
  return null;
}

function calendarDate(value: string) {
  const match = value.match(new RegExp(`\\b(${Object.keys(MONTHS).join("|")})\\s+(\\d{1,2}),\\s*(20\\d{2})\\b`, "i"));
  if (!match) return null;
  return `${match[3]}-${MONTHS[match[1].toLowerCase()]}-${match[2].padStart(2, "0")}`;
}

function inferredKpiName(value: string) {
  const match = value.match(/^([^:|]{2,80}):/);
  if (!match) return null;
  const candidate = normalizeDocumentText(match[1]);
  return /invoice|date|subtotal|tax|total due|prior period/i.test(candidate) ? null : candidate;
}

function inferredTarget(value: string) {
  const match = value.match(/\bTarget(?:\s+[A-Za-z]+)?\s*:\s*(?:[$€£]\s*)?\(?(-?\d[\d,]*(?:\.\d+)?)\)?/i);
  if (!match) return null;
  const parsed = Number.parseFloat(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function inferredUnit(value: string) {
  if (/%/.test(value)) return "percent";
  if (/\bmin(?:ute)?s?\b/i.test(value)) return "minutes";
  if (/\bhours?\b/i.test(value)) return "hours";
  if (/\borders?\b/i.test(value)) return "orders";
  if (/\bunits?\b/i.test(value)) return "units";
  if (/\breviews?\b/i.test(value)) return "reviews";
  if (/\(\$M\)|million USD/i.test(value)) return "million USD";
  if (/\(\$K\)|thousand USD/i.test(value)) return "thousand USD";
  return null;
}

export function normalizedElementFromText({
  documentId,
  parser,
  pageNumber,
  elementIndex,
  rawText,
  confidence,
  boundingBox,
  elementType = "paragraph",
  warnings = []
}: {
  documentId: string;
  parser: DocumentElementProvenance["parser"];
  pageNumber: number;
  elementIndex: number;
  rawText: string;
  confidence: number | null;
  boundingBox: DocumentBoundingBox | null;
  elementType?: DocumentElementType;
  warnings?: readonly string[];
}): NormalizedDocumentElement {
  const normalizedText = normalizeDocumentText(rawText);
  const numeric = numericToken(normalizedText);
  const kpiName = inferredKpiName(normalizedText);
  const target = inferredTarget(normalizedText);
  const elementId = createHash("sha256")
    .update(`${documentId}:${parser}:${pageNumber}:${elementIndex}:${normalizedText}`)
    .digest("hex")
    .slice(0, 24);
  const sourceElementId = `page-${pageNumber}-element-${elementIndex}`;
  return {
    elementId,
    elementType,
    rawText,
    normalizedText,
    boundingBox,
    confidence,
    readingOrderIndex: elementIndex,
    sectionIdentity: null,
    headingLevel: null,
    paragraphIdentity: elementType === "paragraph" ? elementId : null,
    tableId: null,
    tableTitle: null,
    rowIndex: null,
    columnIndex: null,
    rowSpan: null,
    columnSpan: null,
    headerAssociation: null,
    displayedNumericText: numeric?.displayed || null,
    normalizedNumericValue: numeric?.value ?? null,
    sign: numeric?.sign || null,
    decimalPrecision: numeric?.decimalPrecision ?? null,
    currency: numeric?.currency || null,
    percentage: numeric?.percentage ?? null,
    unit: inferredUnit(normalizedText),
    date: calendarDate(normalizedText),
    reportingPeriod: reportingPeriod(normalizedText),
    kpiName,
    kpiValue: kpiName ? numeric?.value ?? null : null,
    kpiTarget: target,
    chartOrFigureReference: null,
    sourceCoordinates: boundingBox,
    extractionWarnings: warnings,
    provenance: {
      benchmarkDocumentId: documentId,
      benchmarkOnly: true,
      synthetic: true,
      sourcePage: pageNumber,
      sourceElementId,
      parser
    }
  };
}
