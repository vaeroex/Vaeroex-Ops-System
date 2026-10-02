import { z } from "zod";
import { parseWorksheetPeriod } from "@/lib/imports/worksheet-types";

export const GOOGLE_SHEETS_READ_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly" as const;
export const GOOGLE_SHEETS_CALLBACK_PATH = "/api/integrations/google-sheets/callback" as const;
export const GOOGLE_SHEETS_SETTINGS_PATH = "/app/settings/integrations/google-sheets" as const;
export const GOOGLE_SHEETS_MAX_ROWS = 10_000;
export const GOOGLE_SHEETS_MAX_FACTS = 15_000;
export const GOOGLE_SHEETS_READ_BATCH_ROWS = 500;
export const SpreadsheetIdSchema = z.string().regex(/^[A-Za-z0-9_-]{20,200}$/);
export const SheetIdSchema = z.number().int().min(0).safe();
export const HeaderRowSchema = z.number().int().min(1).max(25);
const column = z.number().int().min(0).max(99);
const prohibited = /\b(patients?|medical|health|diagnos(?:is|es)|treatments?|prescriptions?|insurance\s*(?:ids?|numbers?)|social\s*security|ssns?|mrns?|ephis?|phis?|dates?\s*of\s*birth|dobs?)\b/i;
function isProhibitedField(value: string) {
  // Sheet labels commonly use snake_case, punctuation, and camelCase/acronyms.
  // Preserve acronym plurals (IDs, SSNs) and whole words such as "patiently".
  const words = value.normalize("NFKC")
    .replace(/([A-Z]+)([A-Z](?!s(?:[^a-z]|$))[a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/gi, " ");
  return prohibited.test(words);
}
const label = z.string().trim().min(1).max(80).refine(value => !isProhibitedField(value), "Restricted business field");
export const FieldMappingSchema = z.object({
  dateColumn: column,
  dateFormat: z.enum(["iso", "serial"]),
  rowKeyColumn: column,
  locationColumn: column.nullable(),
  metrics: z.array(z.object({
    column,
    name: label,
    unit: z.enum(["number", "percent", "percent_fraction", "currency", "count"]),
    category: label,
    target: z.number().finite().min(-1e15).max(1e15).nullable()
  }).strict()).min(1).max(12)
}).strict().superRefine((value, context) => {
  const columns = [value.dateColumn, value.rowKeyColumn, value.locationColumn, ...value.metrics.map(metric => metric.column)].filter(v => v !== null);
  if (new Set(columns).size !== columns.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Each mapped field needs its own column." });
  if (new Set(value.metrics.map(metric => metric.name.toLowerCase())).size !== value.metrics.length) context.addIssue({ code: z.ZodIssueCode.custom, message: "Metric names must be distinct." });
});
export type FieldMapping = z.infer<typeof FieldMappingSchema>;

export function assertBusinessLabel(value: string) {
  const result = z.string().trim().min(1).max(120).parse(value);
  if (isProhibitedField(result)) throw new Error("google_sheets_sensitive_label_denied");
  return result;
}
export function spreadsheetIdFromUrl(value: string) {
  const url = new URL(z.string().max(2048).parse(value));
  if (url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.username || url.password || url.port) throw new Error("google_sheets_url_invalid");
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,200})(?:\/edit)?\/?$/.exec(url.pathname);
  if (!match) throw new Error("google_sheets_url_invalid");
  return SpreadsheetIdSchema.parse(match[1]);
}
export function safeHeaders(raw: unknown) {
  return z.array(z.unknown()).max(100).parse(raw).map(value => {
    const text = String(value ?? "").trim();
    return isProhibitedField(text) ? "[restricted column]" : text.slice(0, 120);
  });
}
export function mappedColumnIndexes(mapping: FieldMapping) {
  return [mapping.rowKeyColumn, mapping.dateColumn, ...(mapping.locationColumn === null ? [] : [mapping.locationColumn]), ...mapping.metrics.map(metric => metric.column)];
}
export function assertMapping(headers: string[], input: unknown) {
  const mapping = FieldMappingSchema.parse(input);
  if (mappedColumnIndexes(mapping).some(index => !headers[index] || headers[index] === "[restricted column]" || isProhibitedField(headers[index]))) throw new Error("google_sheets_mapping_invalid");
  return mapping;
}
export function sheetColumn(index: number) {
  let number = column.parse(index) + 1;
  let result = "";
  while (number > 0) { number -= 1; result = String.fromCharCode(65 + number % 26) + result; number = Math.floor(number / 26); }
  return result;
}
export function sheetRange(title: string, columnName: string, from: number, to: number) {
  return `'${title.replaceAll("'", "''")}'!${columnName}${from}:${columnName}${to}`;
}
export function parseNumericCell(value: unknown) {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value.trim() : "";
  if (!/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,9})?$/.test(text) || !Number.isFinite(Number(text))) throw new Error("google_sheets_numeric_cell_invalid");
  return text.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1").replace(/^-0$/, "0");
}
export function parseDateCell(value: unknown, format: "iso" | "serial" = "iso") {
  if (value === undefined || value === null || value === "") return null;
  // Share workbook serial conversion, while rejecting ambiguous text dates and fractional days.
  const text = format === "serial" && typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 2_958_465
    ? parseWorksheetPeriod(value)
    : format === "iso" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  if (!text) throw new Error("google_sheets_date_cell_invalid");
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) throw new Error("google_sheets_date_cell_invalid");
  return text;
}

export type SheetsNormalizedRow = {
  identity: string;
  fingerprint: string;
  rowNumber: number;
  rowKey: string;
  date: string | null;
  location: string | null;
  validationState: "valid" | "invalid";
  issues: string[];
  metrics: Array<{ column: number; name: string; value: string; unit: FieldMapping["metrics"][number]["unit"]; category: string; target: number | null }>;
};
