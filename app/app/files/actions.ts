"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { assessFileAnalysisEvidence, buildWorkspaceEvidenceContext, evidenceContextAsJson, indexFileAnalysisEvidence } from "@/lib/ai/evidence-index";
import { cleanVaeroexErrorMessage } from "@/lib/ai/errors";
import { runVaeroexCompletionWithUsage, type VaeroexFileAttachment, type VaeroexRequestSizeMetrics } from "@/lib/ai/vaeroex-client";
import { recordVaeroexAiUsage } from "@/lib/ai/usage";
import { getVaeroexWorkflow } from "@/lib/ai/vaeroex-workflows";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { cleanExtractedText, extractDocxText, extractPdfText } from "@/lib/imports/document-text";
import { parseSpreadsheetRows, previewRows, type ImportCellValue, type ImportRow } from "@/lib/imports/spreadsheets";
import { approvedKpiColor } from "@/lib/kpis/settings";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { validateUploadFileSafety } from "@/lib/security/file-upload-safety";
import { requireToolExecution, type RegisteredToolName } from "@/lib/security/tool-execution-gateway";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_import_rows"]["Row"];
type ImportType = "kpi" | "metrics";
type JsonRecord = Record<string, unknown>;
type JsonObject = { [key: string]: Json | undefined };
type SupabaseServerClient = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;
type ImportMapping = Record<string, string>;
type KpiImportChartType = "line" | "bar" | "mixed";
type KpiImportInterpretation = {
  unit_type: string | null;
  display_unit: string | null;
  value_format: string | null;
  x_axis_label: string | null;
  y_axis_label: string | null;
  color: string;
  preferred_chart_type: KpiImportChartType;
};
type FileContentKind = "spreadsheet" | "pdf_text" | "docx_text" | "image_vision" | "unsupported";
type FileContentExtraction = {
  supported: boolean;
  kind: FileContentKind;
  rows: ImportRow[];
  preview: Json;
  rowText: string;
  columns: string[];
  textContent: string;
  textPreview: string;
  contentNote: string;
  extractionFailureReason?: string;
  fileAttachment?: VaeroexFileAttachment;
};
type FileAnalysisConfidenceLabel = "High" | "Medium" | "Low";
type FileAnalysisEvidenceQuality = "strong" | "moderate" | "weak";
type FileAnalysisBusinessImpact = "low" | "medium" | "high";
type FileAnalysisRiskLevel = "low" | "medium" | "high";
type FileAnalysisLearningDecision = {
  status: "auto_learned" | "needs_review";
  confidenceLabel: FileAnalysisConfidenceLabel;
  trustLevel: "trusted" | "tentative" | "needs_review";
  evidenceQuality: FileAnalysisEvidenceQuality;
  businessImpact: FileAnalysisBusinessImpact;
  riskLevel: FileAnalysisRiskLevel;
  reviewRequired: boolean;
  reviewReasons: string[];
  learningMode: "automatic" | "review_required";
};
type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  candidates: string[];
};

class FileAnalysisEvidenceError extends Error {
  readonly inputJson: Json;
  readonly outputJson: Json;
  readonly extractionOutcome: FileAnalysisEvidenceAssessment["extractionOutcome"];

  constructor(message: string, details: { inputJson: Json; outputJson: Json; extractionOutcome: FileAnalysisEvidenceAssessment["extractionOutcome"] }) {
    super(message);
    this.name = "FileAnalysisEvidenceError";
    this.inputJson = details.inputJson;
    this.outputJson = details.outputJson;
    this.extractionOutcome = details.extractionOutcome;
  }
}

type FileAnalysisEvidenceAssessment = ReturnType<typeof assessFileAnalysisEvidence>;

const FILES_PATH = "/app/files";
const SOURCES_PATH = "/app/sources";
const STORAGE_BUCKET = "workspace-files";
const MAX_ANALYSIS_ROWS = 60;
const MAX_REPORT_ROWS = 100;
const MAX_EXTRACTED_TEXT_CHARS = 18_000;
const MAX_TEXT_PREVIEW_CHARS = 4_000;
const KPI_IMPORT_CHART_TYPES = ["line", "bar", "mixed"] as const;
const IMPORT_FIELDS: Record<ImportType, ImportField[]> = {
  kpi: [
    { key: "name", label: "KPI name", required: true, candidates: ["name", "kpi", "kpi name", "metric", "metric name", "metric_name"] },
    { key: "category", label: "Category", candidates: ["category", "type", "department"] },
    { key: "target", label: "Target", candidates: ["target", "goal"] },
    {
      key: "actual_value",
      label: "Actual value",
      required: true,
      candidates: ["actual value", "actual_value", "actual", "value", "result", "amount", "total", "count"]
    },
    { key: "metric_date", label: "Date", candidates: ["date", "metric date", "metric_date", "day", "period"] },
    { key: "owner", label: "Source/context", candidates: ["owner", "manager", "source", "team"] },
    { key: "notes", label: "Notes", candidates: ["notes", "description", "comment", "comments"] },
    { key: "source", label: "Source", candidates: ["source"] }
  ],
  metrics: [
    { key: "metric_name", label: "Metric name", required: true, candidates: ["metric", "metric name", "metric_name", "name", "kpi", "measure"] },
    { key: "category", label: "Category", candidates: ["category", "type", "department"] },
    { key: "value", label: "Value", required: true, candidates: ["value", "actual", "actual value", "actual_value", "result", "amount", "total", "count"] },
    { key: "metric_date", label: "Date", candidates: ["date", "metric date", "metric_date", "day", "period"] },
    { key: "owner", label: "Source/context", candidates: ["owner", "manager", "source", "team"] },
    { key: "notes", label: "Notes", candidates: ["notes", "description", "comment", "comments"] }
  ]
};

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function cleanNoticeMessage(message: string, fallback: string) {
  return cleanVaeroexErrorMessage(message, fallback);
}

function redirectWithError(message: string): never {
  redirect(`${FILES_PATH}?error=${encodeURIComponent(cleanNoticeMessage(message, "Vaeroex could not complete that action. Please try again."))}` as Route);
}

function safeFileReturnPath(value: string) {
  if (value === SOURCES_PATH || value.startsWith(`${SOURCES_PATH}?`)) {
    return value;
  }

  return FILES_PATH;
}

function redirectWithPathError(path: string, message: string, fileId?: string): never {
  const [pathname, existingQuery = ""] = path.split("?");
  const query = new URLSearchParams();
  new URLSearchParams(existingQuery).forEach((value, key) => query.set(key, value));

  if (fileId) {
    query.set("file", fileId);
  }

  query.set("error", cleanNoticeMessage(message, "Vaeroex could not complete that action. Please try again."));
  redirect(`${pathname}?${query.toString()}` as Route);
}

function redirectWithPathMessage(path: string, message: string, fileId?: string): never {
  const [pathname, existingQuery = ""] = path.split("?");
  const query = new URLSearchParams();
  new URLSearchParams(existingQuery).forEach((value, key) => query.set(key, value));

  if (fileId) {
    query.set("file", fileId);
  }

  query.set("message", cleanNoticeMessage(message, "Done."));
  redirect(`${pathname}?${query.toString()}` as Route);
}

function redirectWithFileError(message: string, fileId?: string): never {
  redirect(
    `${FILES_PATH}?${fileId ? `file=${encodeURIComponent(fileId)}&` : ""}error=${encodeURIComponent(cleanNoticeMessage(message, "Vaeroex could not process this file. Please try again."))}` as Route
  );
}

function redirectWithMessage(message: string, fileId?: string): never {
  redirect(`${FILES_PATH}?${fileId ? `file=${encodeURIComponent(fileId)}&` : ""}message=${encodeURIComponent(cleanNoticeMessage(message, "Done."))}` as Route);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNextRedirectError(error: unknown) {
  if (error instanceof Error && error.message === "NEXT_REDIRECT") {
    return true;
  }

  if (isRecord(error) && typeof error.digest === "string") {
    return error.digest.startsWith("NEXT_REDIRECT");
  }

  return false;
}

function actionErrorMessage(error: unknown, fallback: string) {
  if (isNextRedirectError(error)) {
    throw error;
  }

  const message = error instanceof Error ? error.message : "";
  return cleanNoticeMessage(message || fallback, fallback);
}

function fileActionErrorMessage(error: unknown, fallback: string, file: Pick<FileUploadRow, "file_extension">) {
  const message = actionErrorMessage(error, fallback);

  if (/too large for a single Vaeroex analysis|direct visual analysis needs|direct document analysis needs/i.test(message)) {
    return message.replace(
      "This request is too large for a single Vaeroex analysis. Reduce the file size or narrow the question.",
      "Vaeroex uploaded this file successfully, but the assembled analysis request included more context than one pass can safely process. The file remains available in Sources; retry with a narrower question or review a smaller section."
    );
  }

  if (
    file.file_extension === "pdf" &&
    /extract|readable text|pdf|file_data|unsupported file|invalid file|could not read/i.test(message) &&
    !/api key|connected|rate limit|temporarily busy|usage limit/i.test(message)
  ) {
    return unsupportedFileContentMessage(file);
  }

  return message;
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : value ? [value] : [];
}

function fileExtension(fileName: string) {
  return fileName.toLowerCase().split(".").pop()?.replace(/[^a-z0-9]/g, "") || "";
}

function isSpreadsheet(file: Pick<FileUploadRow, "file_extension">) {
  return file.file_extension === "csv" || file.file_extension === "xlsx";
}

function isTextDocument(file: Pick<FileUploadRow, "file_extension">) {
  return file.file_extension === "pdf" || file.file_extension === "docx";
}

function isImageFile(file: Pick<FileUploadRow, "file_extension">) {
  return file.file_extension === "png" || file.file_extension === "jpg" || file.file_extension === "jpeg";
}

function canExtractFileContent(file: Pick<FileUploadRow, "file_extension">) {
  return isSpreadsheet(file) || isTextDocument(file) || isImageFile(file);
}

function unsupportedFileContentMessage(file: Pick<FileUploadRow, "file_extension">) {
  if (file.file_extension === "pdf") {
    return "Vaeroex could not extract readable text from this PDF. It may be scanned, image-based, locked, corrupted, or encoded without a selectable text layer.";
  }

  if (file.file_extension === "docx") {
    return "No readable text could be extracted from this DOCX file. Upload a document with selectable text, or upload CSV/XLSX for data import.";
  }

  if (isImageFile(file)) {
    return "Vaeroex could not read this image. Make sure it is a clear PNG or JPG with readable text or visible business context, then try again.";
  }

  return "This file type cannot be reviewed yet. Upload CSV/XLSX for data import, or text-based PDF/DOCX files for Vaeroex review.";
}

function safeFileName(value: string) {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || `upload-${Date.now()}`;
}

function validImportType(value: string): ImportType {
  if (value === "crm") {
    redirectWithError("Customer record imports have been retired. Upload the file as source evidence, analyze it with Vaeroex, or import only KPI/business metric history.");
  }

  if (value === "kpi" || value === "metrics") {
    return value;
  }

  redirectWithError("Choose KPI data or business metrics before importing.");
}

async function requireWorkspace() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectWithError("Supabase is not configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const context = await getWorkspaceContext();

  if (!context.activeWorkspace) {
    redirect("/app/setup");
  }

  if (!context.membership || context.membership.workspace_id !== context.activeWorkspace.id || context.membership.status !== "active") {
    redirect("/app/setup?error=Workspace access is required.");
  }

  await requireActiveSubscription({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId: context.activeWorkspace.id
  });

  return {
    supabase,
    user,
    workspaceId: context.activeWorkspace.id,
    membership: context.membership
  };
}

async function validateFolder(workspaceId: string, folderId: string) {
  if (!folderId) {
    return null;
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectWithError("Supabase is not configured.");
  }

  const { data, error } = await supabase
    .from("record_folders")
    .select("id")
    .eq("id", folderId)
    .eq("workspace_id", workspaceId)
    .eq("collection_type", "files")
    .is("archived_at", null)
    .maybeSingle();

  if (error || !data) {
    redirectWithError(error?.message || "Folder not found for this workspace.");
  }

  return folderId;
}

async function getFileForWorkspace(fileId: string, workspaceId: string) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectWithError("Supabase is not configured.");
  }

  const { data, error } = await supabase.from("file_uploads").select("*").eq("id", fileId).eq("workspace_id", workspaceId).maybeSingle();

  if (error || !data) {
    redirectWithError(error?.message || "File not found for this workspace.");
  }

  return data;
}

async function downloadFileBuffer(file: FileUploadRow) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    redirectWithError("Supabase is not configured.");
  }

  const { data, error } = await supabase.storage.from(file.storage_bucket).download(file.storage_path);

  if (error || !data) {
    redirectWithError(error?.message || "The stored file could not be downloaded.");
  }

  return Buffer.from(await data.arrayBuffer());
}

async function updateFileProcessingStatus({
  supabase,
  file,
  status,
  error
}: {
  supabase: SupabaseServerClient;
  file: FileUploadRow;
  status: "uploaded" | "processing" | "ready" | "failed";
  error?: string | null;
}) {
  await supabase
    .from("file_uploads")
    .update({
      processing_status: status,
      processing_error: error || null,
      processed_at: status === "ready" || status === "failed" ? new Date().toISOString() : null
    })
    .eq("id", file.id)
    .eq("workspace_id", file.workspace_id);
}

async function archiveFileAnalysisMemoryChunks({
  supabase,
  workspaceId,
  fileId,
  archivedAt
}: {
  supabase: SupabaseServerClient;
  workspaceId: string;
  fileId: string;
  archivedAt: string;
}) {
  const { error } = await supabase
    .from("business_memory_chunks")
    .update({
      archived_at: archivedAt,
      deleted_at: archivedAt,
      updated_at: archivedAt
    })
    .eq("workspace_id", workspaceId)
    .eq("source_type", "file_analysis")
    .eq("source_file_id", fileId)
    .is("deleted_at", null);

  if (error) {
    throw new Error(error.message);
  }
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function cell(row: ImportRow, candidates: string[]) {
  const normalizedCandidates = candidates.map(normalizeKey);
  const match = Object.entries(row).find(([key]) => normalizedCandidates.includes(normalizeKey(key)));
  return match?.[1] ?? null;
}

function importHeaders(rows: ImportRow[]) {
  return Object.keys(rows[0] || {}).filter(Boolean);
}

function inferMapping(importType: ImportType, rows: ImportRow[]) {
  const headers = importHeaders(rows);

  return IMPORT_FIELDS[importType].reduce<ImportMapping>((mapping, field) => {
    const normalizedCandidates = field.candidates.map(normalizeKey);
    const exact = headers.find((header) => normalizedCandidates.includes(normalizeKey(header)));
    const loose = headers.find((header) => normalizedCandidates.some((candidate) => normalizeKey(header).includes(candidate)));
    const matchedHeader = exact || loose;

    if (matchedHeader) {
      mapping[field.key] = matchedHeader;
    }

    return mapping;
  }, {});
}

function mappingFromForm(formData: FormData, importType: ImportType, fallback: Json) {
  const storedMapping = isRecord(fallback) ? fallback : {};

  return IMPORT_FIELDS[importType].reduce<ImportMapping>((mapping, field) => {
    const storedValue = storedMapping[field.key];
    const value = text(formData, `map_${field.key}`) || (typeof storedValue === "string" ? storedValue : "");

    if (value) {
      mapping[field.key] = value;
    }

    return mapping;
  }, {});
}

function limitedText(formData: FormData, key: string, maxLength: number) {
  const value = text(formData, key);
  return value ? value.slice(0, maxLength) : "";
}

function validKpiImportChartType(value: string): KpiImportChartType {
  return KPI_IMPORT_CHART_TYPES.includes(value as KpiImportChartType) ? (value as KpiImportChartType) : "line";
}

function kpiImportInterpretationFromForm(formData: FormData): KpiImportInterpretation {
  return {
    unit_type: limitedText(formData, "unit_type", 80) || null,
    display_unit: limitedText(formData, "display_unit", 80) || null,
    value_format: limitedText(formData, "value_format", 80) || null,
    x_axis_label: limitedText(formData, "x_axis_label", 80) || null,
    y_axis_label: limitedText(formData, "y_axis_label", 80) || null,
    color: approvedKpiColor(text(formData, "color")),
    preferred_chart_type: validKpiImportChartType(text(formData, "preferred_chart_type"))
  };
}

function mappedCell(row: ImportRow, mapping: ImportMapping, field: ImportField) {
  const mappedHeader = mapping[field.key];

  if (mappedHeader && Object.prototype.hasOwnProperty.call(row, mappedHeader)) {
    return row[mappedHeader];
  }

  return cell(row, field.candidates);
}

function mappedText(row: ImportRow, mapping: ImportMapping, field: ImportField, fallback = "") {
  const value = mappedCell(row, mapping, field);
  return value === null || value === undefined ? fallback : String(value).trim();
}

function mappedNumber(row: ImportRow, mapping: ImportMapping, field: ImportField) {
  const value = mappedCell(row, mapping, field);

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function mappedDate(row: ImportRow, mapping: ImportMapping, field: ImportField) {
  const value = mappedCell(row, mapping, field);

  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + value);
    return excelEpoch.toISOString().slice(0, 10);
  }

  const candidate = String(value ?? "").trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return candidate;
  }

  const parsed = Date.parse(candidate);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function rowJson(row: ImportRow) {
  return row as Record<string, ImportCellValue> as Json;
}

function jsonToImportRow(value: Json): ImportRow {
  if (!isRecord(value)) {
    return {};
  }

  return Object.entries(value).reduce<ImportRow>((row, [key, cellValue]) => {
    if (typeof cellValue === "string" || typeof cellValue === "number" || cellValue === null) {
      row[key] = cellValue;
    } else if (cellValue === undefined) {
      row[key] = null;
    } else {
      row[key] = JSON.stringify(cellValue);
    }

    return row;
  }, {});
}

function mappedRowJson(row: ImportRow, mapping: ImportMapping, importType: ImportType) {
  return IMPORT_FIELDS[importType].reduce<JsonRecord>((mapped, field) => {
    const value = mappedCell(row, mapping, field);

    if (value !== null && value !== undefined && String(value).trim() !== "") {
      mapped[field.key] = value;
    }

    return mapped;
  }, {}) as Json;
}

function extractionSummary(importType: ImportType, rows: ImportRow[], mapping: ImportMapping) {
  const mappedRequired = IMPORT_FIELDS[importType].filter((field) => field.required && mapping[field.key]).length;
  const requiredCount = IMPORT_FIELDS[importType].filter((field) => field.required).length;
  const mappedCount = Object.keys(mapping).length;
  const importLabel = importType === "kpi" ? "KPI history" : "business metrics";

  return `Vaeroex found ${rows.length} data row${rows.length === 1 ? "" : "s"} for ${importLabel}. ${mappedCount} column${mappedCount === 1 ? "" : "s"} were mapped, including ${mappedRequired} of ${requiredCount} required field${requiredCount === 1 ? "" : "s"}. Review the mappings before saving.`;
}

function field(importType: ImportType, key: string) {
  const match = IMPORT_FIELDS[importType].find((candidate) => candidate.key === key);

  if (!match) {
    throw new Error(`Import field "${key}" is not configured.`);
  }

  return match;
}

function buildKpiRecords(
  importRows: Pick<FileImportRow, "id" | "data_json">[],
  workspaceId: string,
  userId: string,
  sourceFile: FileUploadRow,
  importId: string,
  mapping: ImportMapping
) {
  return importRows
    .map((importRow) => {
      const row = jsonToImportRow(importRow.data_json);

      return {
        importRowId: importRow.id,
        record: {
          workspace_id: workspaceId,
          source_file_id: sourceFile.id,
          import_id: importId,
          import_row_id: importRow.id,
          name: mappedText(row, mapping, field("kpi", "name")),
          category: mappedText(row, mapping, field("kpi", "category"), "Imported"),
          target: mappedNumber(row, mapping, field("kpi", "target")),
          actual_value: mappedNumber(row, mapping, field("kpi", "actual_value")),
          metric_date: mappedDate(row, mapping, field("kpi", "metric_date")),
          owner: mappedText(row, mapping, field("kpi", "owner")),
          notes: mappedText(row, mapping, field("kpi", "notes")),
          source: mappedText(row, mapping, field("kpi", "source"), `Uploaded file: ${sourceFile.display_name}`),
          raw_data_json: rowJson(row),
          created_by: userId
        }
      };
    })
    .filter(({ record }) => record.name && record.actual_value !== null);
}

function kpiDedupeKey(name: string, metricDate: string) {
  return `${name.trim().toLowerCase()}::${metricDate}`;
}

async function upsertImportedKpiSettings({
  supabase,
  rows,
  workspaceId,
  userId,
  interpretation
}: {
  supabase: SupabaseServerClient;
  rows: ReturnType<typeof buildKpiRecords>;
  workspaceId: string;
  userId: string;
  interpretation: KpiImportInterpretation;
}): Promise<boolean> {
  const settingsByName = new Map<
    string,
    {
      workspace_id: string;
      kpi_name: string;
      category: string | null;
      target: number | null;
      unit_type: string | null;
      display_unit: string | null;
      value_format: string | null;
      x_axis_label: string | null;
      y_axis_label: string | null;
      color: string;
      preferred_chart_type: KpiImportChartType;
      created_by: string;
    }
  >();

  for (const row of rows) {
    const existing = settingsByName.get(row.record.name);

    if (!existing) {
      settingsByName.set(row.record.name, {
        workspace_id: workspaceId,
        kpi_name: row.record.name,
        category: row.record.category || "Imported",
        target: row.record.target,
        unit_type: interpretation.unit_type,
        display_unit: interpretation.display_unit,
        value_format: interpretation.value_format,
        x_axis_label: interpretation.x_axis_label,
        y_axis_label: interpretation.y_axis_label,
        color: interpretation.color,
        preferred_chart_type: interpretation.preferred_chart_type,
        created_by: userId
      });
      continue;
    }

    if (existing.target === null && row.record.target !== null) {
      existing.target = row.record.target;
    }

    if (!existing.category && row.record.category) {
      existing.category = row.record.category;
    }
  }

  const settings = Array.from(settingsByName.values());

  if (!settings.length) {
    return false;
  }

  const { error } = await supabase.from("kpi_settings").upsert(settings, { onConflict: "workspace_id,kpi_name" });

  if (error) {
    if (/row-level security|permission denied|not authorized|not allowed/i.test(error.message)) {
      return false;
    }

    throw new Error(error.message);
  }

  return true;
}

async function removeDuplicateKpiRows({
  supabase,
  rows,
  workspaceId,
  sourceFileId
}: {
  supabase: SupabaseServerClient;
  rows: ReturnType<typeof buildKpiRecords>;
  workspaceId: string;
  sourceFileId: string;
}) {
  if (!rows.length) {
    const duplicateRows: typeof rows = [];
    return { duplicateRows, rows };
  }

  const { data, error } = await supabase
    .from("kpis")
    .select("id,name,metric_date,source_file_id,import_row_id")
    .eq("workspace_id", workspaceId)
    .eq("source_file_id", sourceFileId)
    .limit(5000);

  if (error) {
    throw new Error(error.message);
  }

  const existingImportRows = new Set((data || []).map((row) => row.import_row_id).filter(Boolean));
  const existingNameDates = new Set((data || []).map((row) => kpiDedupeKey(row.name, row.metric_date)));
  const duplicateRows: typeof rows = [];
  const uniqueRows: typeof rows = [];

  for (const row of rows) {
    const duplicateByImportRow = existingImportRows.has(row.importRowId);
    const duplicateByNameDate = existingNameDates.has(kpiDedupeKey(row.record.name, row.record.metric_date));

    if (duplicateByImportRow || duplicateByNameDate) {
      duplicateRows.push(row);
      continue;
    }

    existingImportRows.add(row.importRowId);
    existingNameDates.add(kpiDedupeKey(row.record.name, row.record.metric_date));
    uniqueRows.push(row);
  }

  return { duplicateRows, rows: uniqueRows };
}

function buildOperationalMetricRecords(
  importRows: Pick<FileImportRow, "id" | "data_json">[],
  workspaceId: string,
  userId: string,
  sourceFile: FileUploadRow,
  importId: string,
  mapping: ImportMapping
) {
  return importRows
    .map((importRow) => {
      const row = jsonToImportRow(importRow.data_json);

      return {
        importRowId: importRow.id,
        record: {
          workspace_id: workspaceId,
          source_file_id: sourceFile.id,
          import_id: importId,
          import_row_id: importRow.id,
          metric_name: mappedText(row, mapping, field("metrics", "metric_name")),
          category: mappedText(row, mapping, field("metrics", "category"), "Business"),
          value: mappedNumber(row, mapping, field("metrics", "value")),
          metric_date: mappedDate(row, mapping, field("metrics", "metric_date")),
          owner: mappedText(row, mapping, field("metrics", "owner")),
          notes: mappedText(row, mapping, field("metrics", "notes")),
          raw_data_json: rowJson(row),
          created_by: userId
        }
      };
    })
    .filter(({ record }) => record.metric_name && record.value !== null);
}

function summarizeVaeroexOutput(outputJson: Json) {
  const output = isRecord(outputJson) ? outputJson : {};
  const summary = str(output.executive_summary) || str(output.summary) || str(output.response_markdown);

  if (summary) {
    return summary.replace(/^#+\s*/gm, "").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 4).join("\n");
  }

  const problems = asArray(output.problems_identified).map((item) => {
    if (typeof item === "string") {
      return item;
    }

    if (isRecord(item)) {
      return (
        str(item.title) ||
        str(item.name) ||
        str(item.description) ||
        Object.values(item)
          .filter((value) => typeof value === "string" || typeof value === "number")
          .map(String)
          .join(" - ")
      );
    }

    return String(item);
  });
  return problems.slice(0, 4).join("\n") || "Vaeroex completed the file analysis.";
}

function outputList(output: JsonRecord, key: string) {
  return asArray(output[key])
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (isRecord(item)) {
        return (
          str(item.title) ||
          str(item.name) ||
          str(item.metric) ||
          str(item.description) ||
          str(item.recommendation) ||
          Object.values(item)
            .filter((value) => typeof value === "string" || typeof value === "number")
            .map(String)
            .join(" - ")
        );
      }

      return String(item);
    })
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractedTextFromOutput(outputJson: Json) {
  const output = isRecord(outputJson) ? outputJson : {};
  const candidates = [
    output.extracted_text,
    output.ocr_text,
    output.document_text,
    output.file_text,
    isRecord(output.extraction) ? output.extraction.text : null
  ];

  return cleanExtractedText(candidates.find((value) => typeof value === "string" && value.trim()) as string | undefined || "");
}

function cleanAnalysisResult(outputJson: Json, file: FileUploadRow, extraction: FileContentExtraction) {
  const output = isRecord(outputJson) ? outputJson : {};
  const summary = str(output.executive_summary) || str(output.summary) || summarizeVaeroexOutput(outputJson);
  const findings = outputList(output, "extracted_findings").concat(outputList(output, "findings")).concat(outputList(output, "problems_identified"));
  const kpis = outputList(output, "kpis_found").concat(outputList(output, "recommended_kpis")).concat(outputList(output, "suggested_metrics"));
  const risks = outputList(output, "risks").concat(outputList(output, "operational_risks"));
  const issues = outputList(output, "operational_issues").concat(outputList(output, "problems_identified"));
  const actions = outputList(output, "recommended_actions").concat(outputList(output, "suggested_tasks"));
  const opportunities = outputList(output, "opportunities").concat(outputList(output, "business_opportunities"));
  const suggestedTasks = outputList(output, "suggested_tasks").concat(outputList(output, "follow_up_tasks")).concat(outputList(output, "tasks"));
  const suggestedReports = outputList(output, "suggested_reports").concat(outputList(output, "reports"));
  const suggestedKpiRecords = outputList(output, "suggested_kpi_records").concat(kpis);
  const suggestedCustomerEvidence = outputList(output, "suggested_crm_records").concat(outputList(output, "crm_records")).concat(outputList(output, "crm_leads"));

  return {
    source_file_name: file.display_name,
    content_kind: extraction.kind,
    extraction_status: "ready",
    extraction_note: extraction.contentNote,
    executive_summary: summary,
    extracted_findings: [...findings, ...suggestedCustomerEvidence].slice(0, 8),
    kpis_found: kpis.slice(0, 8),
    risks: risks.slice(0, 8),
    operational_issues: issues.slice(0, 8),
    recommended_actions: actions.slice(0, 8),
    opportunities: opportunities.slice(0, 8),
    suggested_tasks: suggestedTasks.slice(0, 8),
    suggested_reports: suggestedReports.slice(0, 8),
    suggested_kpi_records: suggestedKpiRecords.slice(0, 8),
    response_markdown: str(output.response_markdown, summary)
  } satisfies JsonRecord;
}

function cleanAnalysisInsightCount(result: JsonRecord) {
  return [
    ...asArray(result.extracted_findings),
    ...asArray(result.kpis_found),
    ...asArray(result.risks),
    ...asArray(result.operational_issues),
    ...asArray(result.recommended_actions),
    ...asArray(result.opportunities),
    ...asArray(result.suggested_tasks),
    ...asArray(result.suggested_reports),
    ...asArray(result.suggested_kpi_records)
  ].length;
}

function hasMeaningfulModelContent(outputJson: Json) {
  const output = isRecord(outputJson) ? outputJson : {};
  const directLists = [
    "extracted_findings",
    "findings",
    "kpis_found",
    "recommended_kpis",
    "risks",
    "operational_risks",
    "operational_issues",
    "recommended_actions"
  ];

  return directLists.some((key) => asArray(output[key]).length > 0) || str(output.response_markdown).length > 120 || str(output.executive_summary).length > 80;
}

function scoreFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value <= 1 ? Math.round(value * 100) : Math.round(value);
  }

  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(/\b(\d{1,3})(?:\.\d+)?\s*%?\b/);
  const score = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null;
}

function confidenceLabelFromAnalysis(outputJson: Json, extraction: FileContentExtraction, cleanResult: JsonRecord): FileAnalysisConfidenceLabel {
  const output = isRecord(outputJson) ? outputJson : {};
  const rawConfidence =
    str(output.recommendation_confidence) ||
    str(output.confidence) ||
    str(output.confidence_level) ||
    str(output.confidence_label) ||
    str(output.analysis_confidence);
  const score =
    scoreFromUnknown(output.confidence_score) ??
    scoreFromUnknown(output.evidence_confidence_score) ??
    scoreFromUnknown(rawConfidence);
  const evidenceText = [
    rawConfidence,
    str(output.executive_summary),
    str(output.summary),
    str(output.response_markdown),
    ...outputList(output, "unclear_fields"),
    ...outputList(output, "needs_confirmation"),
    ...outputList(cleanResult, "unclear_fields")
  ]
    .join(" ")
    .toLowerCase();
  const limitation = /\b(insufficient|not enough|cannot determine|unable to determine|very limited|limited evidence|low confidence|unreadable)\b/.test(evidenceText);

  if (score !== null) {
    if (score >= 78 && !limitation) return "High";
    if (score >= 45) return "Medium";
    return "Low";
  }

  if (/\b(high|strong)\b/i.test(rawConfidence) && !limitation) return "High";
  if (/\b(medium|moderate|developing|directional|partial)\b/i.test(rawConfidence)) return "Medium";
  if (/\b(low|weak|insufficient|limited)\b/i.test(rawConfidence) || limitation) return "Low";

  if (extraction.rows.length >= 10 || extraction.textContent.length >= 1_500) return "Medium";
  if (cleanAnalysisInsightCount(cleanResult) >= 3 && hasMeaningfulModelContent(outputJson)) return "Medium";
  return "Low";
}

function evidenceQualityForAnalysis(outputJson: Json, extraction: FileContentExtraction, cleanResult: JsonRecord): FileAnalysisEvidenceQuality {
  const insightCount = cleanAnalysisInsightCount(cleanResult);

  if (extraction.extractionFailureReason && extraction.textContent.length < 500) {
    return "weak";
  }

  if (extraction.rows.length >= 10 || extraction.textContent.length >= 1_500) {
    return "strong";
  }

  if (extraction.rows.length > 0 || extraction.textContent.length >= 300 || insightCount >= 2 || hasMeaningfulModelContent(outputJson)) {
    return "moderate";
  }

  return "weak";
}

function analysisRiskSignals(outputJson: Json, cleanResult: JsonRecord) {
  const output = isRecord(outputJson) ? outputJson : {};
  return [
    str(output.response_markdown),
    str(output.executive_summary),
    str(output.summary),
    ...outputList(output, "recommended_actions"),
    ...outputList(output, "operational_issues"),
    ...outputList(output, "unclear_fields"),
    ...outputList(output, "needs_confirmation"),
    ...outputList(cleanResult, "recommended_actions"),
    ...outputList(cleanResult, "operational_issues")
  ].join(" ");
}

function businessImpactForAnalysis(outputJson: Json, cleanResult: JsonRecord): FileAnalysisBusinessImpact {
  const textValue = analysisRiskSignals(outputJson, cleanResult);

  if (/\b(critical|urgent|material risk|legal|regulated|compliance|security|billing|permission|customer data|phi|ephi|social security|medical record|insurance id)\b/i.test(textValue)) {
    return "high";
  }

  if (/\b(revenue|financial|invoice|customer|vendor|staffing|inventory|policy|sop|contract|forecast|risk)\b/i.test(textValue)) {
    return "medium";
  }

  return "low";
}

function riskLevelForAnalysis(outputJson: Json, cleanResult: JsonRecord): FileAnalysisRiskLevel {
  const textValue = analysisRiskSignals(outputJson, cleanResult);

  if (/\b(delete|remove records?|drop table|truncate|purge|overwrite|merge customers?|change permissions?|change billing|disable audit|trigger workflow|execute tool|automation|destructive)\b/i.test(textValue)) {
    return "high";
  }

  if (/\b(conflict|conflicting|contradict|discrepancy|corrupt|unreadable|unclear|needs confirmation|low confidence)\b/i.test(textValue)) {
    return "medium";
  }

  return "low";
}

function classifyFileAnalysisLearning({
  outputJson,
  cleanResult,
  extraction,
  existingActiveMemory
}: {
  outputJson: Json;
  cleanResult: JsonRecord;
  extraction: FileContentExtraction;
  existingActiveMemory: boolean;
}): FileAnalysisLearningDecision {
  const evidenceQuality = evidenceQualityForAnalysis(outputJson, extraction, cleanResult);
  let confidenceLabel = confidenceLabelFromAnalysis(outputJson, extraction, cleanResult);
  const businessImpact = businessImpactForAnalysis(outputJson, cleanResult);
  const riskLevel = riskLevelForAnalysis(outputJson, cleanResult);
  const riskSignals = analysisRiskSignals(outputJson, cleanResult);
  const reviewReasons: string[] = [];

  if (confidenceLabel === "High" && evidenceQuality !== "strong") {
    confidenceLabel = "Medium";
  }

  if (confidenceLabel === "Low") {
    reviewReasons.push("Low confidence requires human review.");
  }

  if (evidenceQuality === "weak") {
    reviewReasons.push("Evidence quality is weak or extraction was limited.");
  }

  if (riskLevel === "high") {
    reviewReasons.push("The result may imply destructive, permission, billing, automation, or record-changing activity.");
  }

  if (/\b(conflict|conflicting|contradict|discrepancy|corrupt|unreadable|ocr confidence is weak|weak ocr)\b/i.test(riskSignals)) {
    reviewReasons.push("Evidence appears conflicting, corrupted, unreadable, or weakly extracted.");
  }

  if (businessImpact === "high") {
    reviewReasons.push("The source appears to involve high-impact legal, compliance, security, billing, or regulated context.");
  }

  if (extraction.extractionFailureReason && extraction.textContent.length < 1_000) {
    reviewReasons.push("Extraction had limitations that should be checked.");
  }

  if (existingActiveMemory) {
    reviewReasons.push("This source already has active Business Memory evidence; replacing it requires review.");
  }

  if (reviewReasons.length) {
    return {
      status: "needs_review",
      confidenceLabel: confidenceLabel === "High" ? "Medium" : confidenceLabel,
      trustLevel: "needs_review",
      evidenceQuality,
      businessImpact,
      riskLevel,
      reviewRequired: true,
      reviewReasons,
      learningMode: "review_required"
    };
  }

  return {
    status: "auto_learned",
    confidenceLabel,
    trustLevel: confidenceLabel === "High" && evidenceQuality === "strong" ? "trusted" : "tentative",
    evidenceQuality,
    businessImpact,
    riskLevel,
    reviewRequired: false,
    reviewReasons: [],
    learningMode: "automatic"
  };
}

function spreadsheetRowsAsText(rows: ImportRow[], limit: number) {
  return rows
    .slice(0, limit)
    .map((row, index) => {
      const values = Object.entries(row)
        .filter(([, value]) => value !== null && String(value).trim() !== "")
        .map(([key, value]) => `${key}: ${String(value).slice(0, 180)}`)
        .join("; ");

      return `Row ${index + 1}: ${values || "No values"}`;
    })
    .join("\n");
}

function fileContentStatus(file: FileUploadRow) {
  if (isSpreadsheet(file)) {
    return {
      supported: true,
      label: "CSV/XLSX rows can be parsed, analyzed, and imported after review."
    };
  }

  if (file.file_extension === "pdf") {
    return {
      supported: true,
      label: "Text-based PDF extraction is supported for analysis and report creation."
    };
  }

  if (file.file_extension === "docx") {
    return {
      supported: true,
      label: "DOCX text extraction is supported for analysis and report creation."
    };
  }

  if (isImageFile(file)) {
    return {
      supported: true,
      label: "PNG/JPG OCR and image analysis are supported through Vaeroex."
    };
  }

  return {
    supported: false,
    label: unsupportedFileContentMessage(file)
  };
}

function clippedExtractedText(value: string) {
  return cleanExtractedText(value).slice(0, MAX_EXTRACTED_TEXT_CHARS);
}

function textPreview(value: string) {
  return cleanExtractedText(value).slice(0, MAX_TEXT_PREVIEW_CHARS);
}

function emptyUnsupportedExtraction(file: FileUploadRow): FileContentExtraction {
  return {
    supported: false,
    kind: "unsupported",
    rows: [],
    preview: [] as Json,
    rowText: "",
    columns: [],
    textContent: "",
    textPreview: "",
    contentNote: unsupportedFileContentMessage(file),
    extractionFailureReason: unsupportedFileContentMessage(file)
  };
}

function fileAttachment(file: FileUploadRow, buffer: Buffer, inputType: "image" | "file"): VaeroexFileAttachment {
  return {
    inputType,
    fileName: file.original_name,
    mimeType: file.mime_type,
    base64Data: buffer.toString("base64"),
    detail: inputType === "image" ? (buffer.length > 1_500_000 ? "low" : "auto") : undefined
  };
}

function truncateForAnalysis(value: unknown, max = 700) {
  if (typeof value !== "string") {
    return value;
  }

  return value.length > max ? `${value.slice(0, max).trim()}...` : value;
}

function compactRecordForAnalysis(value: unknown, keys: string[]) {
  if (!isRecord(value)) {
    return {};
  }

  return keys.reduce<JsonObject>((record, key) => {
    const item = value[key];

    if (item !== null && item !== undefined) {
      record[key] = truncateForAnalysis(item) as Json;
    }

    return record;
  }, {});
}

function compactFileMetadataForAnalysis(metadata: Json) {
  if (!isRecord(metadata)) {
    return {};
  }

  return compactRecordForAnalysis(metadata, [
    "business_memory_status",
    "latest_analysis_status",
    "latest_analysis_at",
    "latest_analysis_content_kind",
    "latest_analysis_rows_detected",
    "latest_analysis_characters_detected",
    "index_status",
    "indexed_chunk_count",
    "indexed_at"
  ]);
}

function reportReferencesFile(report: Pick<ReportRow, "source_data_json">, fileId: string) {
  const source = isRecord(report.source_data_json) ? report.source_data_json : {};
  const file = isRecord(source.file) ? source.file : {};
  const attachedFiles = Array.isArray(source.attached_files) ? source.attached_files.filter(isRecord) as JsonRecord[] : [];

  return file.id === fileId || attachedFiles.some((item) => item.id === fileId);
}

function requestMetricsFromUsage(metadata: Json | undefined): VaeroexRequestSizeMetrics | null {
  if (!isRecord(metadata)) {
    return null;
  }

  const requestSize = metadata.request_size;
  return isRecord(requestSize) ? (requestSize as VaeroexRequestSizeMetrics) : null;
}

function spreadsheetExtraction(rows: ImportRow[], rowLimit: number): FileContentExtraction {
  const rowText = spreadsheetRowsAsText(rows, rowLimit);

  return {
    supported: true,
    kind: "spreadsheet",
    rows,
    preview: previewRows(rows, rowLimit) as Json,
    rowText,
    columns: importHeaders(rows),
    textContent: rowText,
    textPreview: textPreview(rowText),
    contentNote: `Vaeroex parsed ${rows.length} spreadsheet row${rows.length === 1 ? "" : "s"} from the file.`
  };
}

function textDocumentExtraction(file: FileUploadRow, kind: "pdf_text" | "docx_text", textContent: string): FileContentExtraction {
  const clippedText = clippedExtractedText(textContent);
  const label = kind === "pdf_text" ? "PDF" : "DOCX";

  if (!clippedText) {
    throw new Error(unsupportedFileContentMessage(file));
  }

  return {
    supported: true,
    kind,
    rows: [],
    preview: {
      text_preview: textPreview(clippedText),
      character_count: clippedText.length
    } as Json,
    rowText: "",
    columns: [],
    textContent: clippedText,
    textPreview: textPreview(clippedText),
    contentNote: `Vaeroex extracted ${clippedText.length} character${clippedText.length === 1 ? "" : "s"} of readable text from this ${label} file.`
  };
}

function hasExtractedContent(extraction: FileContentExtraction) {
  return extraction.rows.length > 0 || extraction.textContent.trim().length > 0 || Boolean(extraction.fileAttachment);
}

async function extractFileContent(file: FileUploadRow, rowLimit: number): Promise<FileContentExtraction> {
  if (!canExtractFileContent(file)) {
    return emptyUnsupportedExtraction(file);
  }

  const buffer = await downloadFileBuffer(file);

  if (!isSpreadsheet(file)) {
    if (file.file_extension === "pdf") {
      const extractedText = extractPdfText(buffer);

      if (cleanExtractedText(extractedText)) {
        return textDocumentExtraction(file, "pdf_text", extractedText);
      }

      return {
        supported: true,
        kind: "pdf_text",
        rows: [],
        preview: {
          text_preview: "",
          extraction_method: "openai_pdf_file_input"
        } as Json,
        rowText: "",
        columns: [],
        textContent: "",
        textPreview: "",
        contentNote: "Local PDF text extraction did not find readable text. Vaeroex will inspect the PDF file directly.",
        extractionFailureReason:
          "No selectable text layer was found by local extraction. The PDF may be scanned, image-based, or encoded in a way the local parser cannot read.",
        fileAttachment: fileAttachment(file, buffer, "file")
      };
    }

    if (file.file_extension === "docx") {
      return textDocumentExtraction(file, "docx_text", extractDocxText(buffer));
    }

    if (isImageFile(file)) {
      return {
        supported: true,
        kind: "image_vision",
        rows: [],
        preview: {
          text_preview: "",
          extraction_method: "openai_image_vision"
        } as Json,
        rowText: "",
        columns: [],
        textContent: "",
        textPreview: "",
        contentNote: "Vaeroex will inspect this image for readable text, visual business context, risks, KPIs, and executive recommendations.",
        fileAttachment: fileAttachment(file, buffer, "image")
      };
    }

    return emptyUnsupportedExtraction(file);
  }

  const rows = parseSpreadsheetRows({ fileName: file.original_name, buffer });

  if (!rows.length) {
    throw new Error("No data rows were found in the spreadsheet. Make sure the first row contains column names.");
  }

  return spreadsheetExtraction(rows, rowLimit);
}

function readableList(value: unknown) {
  return asArray(value)
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }

      if (isRecord(item)) {
        return (
          str(item.title) ||
          str(item.name) ||
          str(item.description) ||
          Object.values(item)
            .filter((value) => typeof value === "string" || typeof value === "number")
            .map(String)
            .join(" - ")
        );
      }

      return String(item);
    })
    .filter(Boolean);
}

function vaeroexReportMarkdown(outputJson: Json, fallback: string) {
  const output = isRecord(outputJson) ? outputJson : {};
  const report = isRecord(output.report) ? output.report : {};
  const body = str(report.body_markdown) || str(output.response_markdown);

  if (body) {
    return body;
  }

  const summary = str(output.executive_summary) || str(output.summary);
  const findings = readableList(output.extracted_findings).concat(readableList(output.findings)).concat(readableList(output.problems_identified));
  const kpis = readableList(output.kpis_found).concat(readableList(output.recommended_kpis)).concat(readableList(output.suggested_metrics));
  const risks = readableList(output.risks).concat(readableList(output.operational_risks));
  const issues = readableList(output.operational_issues).concat(readableList(output.problems_identified));
  const actions = readableList(output.recommended_actions);
  const systems = readableList(output.suggested_systems);

  if (!summary && !findings.length && !kpis.length && !risks.length && !issues.length && !actions.length && !systems.length) {
    return fallback;
  }

  return `# File Report

## Executive Summary
${summary || "Vaeroex reviewed the uploaded file and prepared a practical intelligence summary."}

## Extracted Findings
${findings.length ? findings.map((item) => `- ${item}`).join("\n") : "- No specific findings were identified from the extracted content."}

## KPIs Found
${kpis.length ? kpis.map((item) => `- ${item}`).join("\n") : "- Review this file for metrics that should be tracked in the KPI dashboard."}

## Risks
${risks.length ? risks.map((item) => `- ${item}`).join("\n") : "- No clear risks were found in the extracted content."}

## Issues
${issues.length ? issues.map((item) => `- ${item}`).join("\n") : "- No specific issues were found in the extracted content."}

## Executive Recommendations
${actions.length ? actions.map((item) => `- ${item}`).join("\n") : "- Review the findings and decide what leadership should examine next."}

## Suggested Systems
${systems.length ? systems.map((item) => `- ${item}`).join("\n") : "- Track the key metrics from this file in the KPI dashboard and reports."}`;
}

function ensureFileReportSections(body: string, file: FileUploadRow, extraction: FileContentExtraction) {
  let report = body.trim();
  const preview = extraction.textPreview || extraction.rowText || "No preview text was available.";
  const sections = [
    {
      heading: "Extracted Findings",
      body: "- Vaeroex used extracted file content to create this report. Review the report body above for the detailed findings."
    },
    {
      heading: "KPIs Found",
      body: "- Review the report body for metrics, counts, revenue, customer activity, cost, quality, staffing, or business measures worth tracking."
    },
    {
      heading: "Risks",
      body: "- Review the report body for customer, staffing, revenue, response quality, service quality, or process risks."
    },
    {
      heading: "Issues",
      body: "- Review the report body for bottlenecks, unclear source context, response delays, or repeated process gaps."
    },
    {
      heading: "Executive Recommendations",
      body: "- Identify the highest-priority leadership review items and save approved metrics into Vaeroex history when useful."
    },
    {
      heading: "Source File",
      body: `- ${file.display_name} (${file.file_extension.toUpperCase()})\n- Content used: ${extraction.contentNote}\n- Preview: ${preview.slice(0, 800)}`
    }
  ];

  if (!/^#\s+/m.test(report)) {
    report = `# File Report - ${file.display_name}\n\n${report}`;
  }

  for (const section of sections) {
    const pattern = new RegExp(`^#{2,3}\\s+${section.heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "im");

    if (!pattern.test(report)) {
      report += `\n\n## ${section.heading}\n${section.body}`;
    }
  }

  return report;
}

function fileReportBody({
  file,
  importRows,
  analysisSummary,
  prompt,
  extraction
}: {
  file: FileUploadRow;
  importRows: Array<Pick<Database["public"]["Tables"]["file_imports"]["Row"], "import_type" | "status" | "rows_total" | "rows_imported" | "extraction_summary" | "created_at" | "imported_at">>;
  analysisSummary: string | null;
  prompt?: string;
  extraction: FileContentExtraction;
}) {
  const imports = importRows.length
    ? importRows
        .map((item) => `- ${item.import_type}: ${item.rows_imported} of ${item.rows_total} rows saved (${item.status})`)
        .join("\n")
    : "- No imports have been saved from this file yet.";
  const contentStatus = fileContentStatus(file);
  const rowCount = extraction.rows.length;
  const columns = extraction.columns.length ? extraction.columns.slice(0, 12).join(", ") : "No spreadsheet columns parsed.";
  const contentPreview = extraction.rowText || extraction.textPreview || "No extracted content preview was available.";

  return `# File Report - ${file.display_name}

## Executive Summary
${analysisSummary || "Vaeroex reviewed this file and prepared a report from the available file content and workspace context."}

## File Content Used
- Content support: ${contentStatus.label}
- Extraction result: ${extraction.contentNote}
- Parsed rows: ${rowCount}
- Columns detected: ${columns}

## Extracted Findings
- Vaeroex reviewed the extracted content shown in the preview below and used it with workspace context to prepare this report.

## KPIs Found
- Review the extracted content for metrics that should be saved into KPI history, customer activity history, or business metrics.

## Risks
- Confirm any high-impact findings before leadership relies on the conclusion.

## Issues
- Look for repeated delays, response gaps, unclear source context, missing checklists, or untracked metrics.

## File Details
- Original name: ${file.original_name}
- File type: ${file.file_extension.toUpperCase()}
- Import status: ${file.import_status.replace(/_/g, " ")}
- Imported rows: ${file.imported_rows}
- Uploaded: ${file.created_at}

## Analysis Question
${prompt || file.analysis_prompt || "Review this file for findings, trends, KPIs, risks, and executive recommendations."}

## Import History
${imports}

## File Data Preview
${contentPreview}

## Recommended Leadership Review
- Review the findings before saving or using any recommended output.
- Import approved spreadsheet rows into KPI, customer activity, or business metrics history when appropriate.
- Use this file in the next management review so trends are tracked over time.`;
}

async function runFileVaeroexAnalysis({
  supabase,
  userId,
  email,
  workspaceId,
  file,
  prompt,
  rowLimit
}: {
  supabase: SupabaseServerClient;
  userId: string;
  email: string | undefined;
  workspaceId: string;
  file: FileUploadRow;
  prompt: string;
  rowLimit: number;
}) {
  const workflow = getVaeroexWorkflow("file_analysis");
  await updateFileProcessingStatus({ supabase, file, status: "processing" });
  const extraction = await extractFileContent(file, rowLimit);

  if (!extraction.supported) {
    throw new Error(extraction.contentNote);
  }

  if (!hasExtractedContent(extraction)) {
    throw new Error(unsupportedFileContentMessage(file));
  }

  const [fileImports, fileReports, evidenceContext] = await Promise.all([
    supabase
      .from("file_imports")
      .select("id,import_type,status,rows_total,rows_imported,extraction_summary,created_at,imported_at")
      .eq("workspace_id", workspaceId)
      .eq("file_upload_id", file.id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("reports")
      .select("id,title,report_type,created_at,source_data_json")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    buildWorkspaceEvidenceContext({
      supabase,
      workspaceId,
      query: `${prompt}\nFile: ${file.display_name}\nType: ${file.file_extension}`,
      maxChunks: 3,
      retrievalStrategy: "keyword_only"
    })
  ]);
  const workspaceSnapshot = {
    scope: "selected_file_analysis",
    selected_file: {
      id: file.id,
      display_name: file.display_name,
      original_name: file.original_name,
      file_extension: file.file_extension,
      import_type: file.import_type,
      import_status: file.import_status,
      processing_status: file.processing_status,
      index_status: file.index_status,
      indexed_chunk_count: file.indexed_chunk_count,
      previous_analysis_summary: file.analysis_summary,
      created_at: file.created_at,
      updated_at: file.updated_at
    },
    scope_policy: {
      selected_file_only: true,
      full_workspace_snapshot_excluded: true,
      unrelated_workspace_records_excluded: true
    }
  } satisfies Json;
  const relatedReports = (fileReports.data ?? [])
    .filter((report) => reportReferencesFile(report as Pick<ReportRow, "source_data_json">, file.id))
    .slice(0, 5)
    .map((report) => compactRecordForAnalysis(report, ["id", "title", "report_type", "created_at"]));
  const extraInputs = {
    file: {
      id: file.id,
      name: file.display_name,
      original_name: file.original_name,
      extension: file.file_extension,
      content_kind: extraction.kind,
      rows_detected: extraction.rows.length,
      columns_detected: extraction.columns,
      characters_extracted: extraction.textContent.length,
      attachment_analysis: Boolean(extraction.fileAttachment),
      attachment_bytes: extraction.fileAttachment ? Math.floor((extraction.fileAttachment.base64Data.length * 3) / 4) : 0,
      attachment_detail: extraction.fileAttachment?.detail || null,
      metadata: compactFileMetadataForAnalysis(file.metadata_json),
      previous_analysis_available: Boolean(file.analysis_summary),
      content_note: extraction.contentNote,
      extraction_failure_reason: extraction.extractionFailureReason || null
    },
    import_history: fileImports.data ?? [],
    related_reports: relatedReports,
    spreadsheet_preview: extraction.kind === "spreadsheet" ? extraction.preview : [],
    spreadsheet_row_text: extraction.kind === "spreadsheet" ? extraction.rowText : "",
    extracted_text: extraction.textContent,
    extracted_text_preview: extraction.textPreview,
    evidence_context: evidenceContextAsJson(evidenceContext)
  } satisfies Json;
  const inputJson = {
    workflow: workflow.key,
    user_prompt: prompt,
    extra_inputs: extraInputs,
    workspace_snapshot: workspaceSnapshot
  } satisfies Json;
  const limit = await isUsageLimitReached({
    supabase,
    userId,
    email,
    workspaceId,
    limit: "ai_runs_this_month"
  });

  if (limit.reached) {
    throw new Error("You’ve reached the monthly Vaeroex usage limit for this workspace.");
  }

  const { outputJson, usage } = await runVaeroexCompletionWithUsage({
    workflow,
    userPrompt: prompt,
    workspaceSnapshot,
    extraInputs,
    fileAttachment: extraction.fileAttachment,
    supabase,
    workspaceId,
    modelRoute: "file_analysis",
    executionPath: "focused_file_analysis",
    maxOutputTokens: 1_200
  });
  const requestMetrics = requestMetricsFromUsage(usage.metadata);
  const outputExtractedText = extractedTextFromOutput(outputJson);
  const finalTextContent = extraction.textContent || outputExtractedText;
  const sourceGrounding = extraction.textContent ? "local_extraction" : "model_extraction";
  const finalExtraction = {
    ...extraction,
    textContent: finalTextContent,
    textPreview: textPreview(finalTextContent) || extraction.textPreview,
    preview:
      extraction.kind === "spreadsheet"
        ? extraction.preview
        : ({
            text_preview: textPreview(finalTextContent) || extraction.textPreview,
            character_count: finalTextContent.length,
            extraction_method: extraction.fileAttachment ? "vaeroex_multimodal" : extraction.kind
          } as Json),
    contentNote:
      finalTextContent && extraction.fileAttachment
        ? `Vaeroex extracted readable content using ${extraction.kind === "image_vision" ? "image analysis" : "direct file analysis"}.`
        : extraction.contentNote,
    extractionFailureReason: finalTextContent && extraction.fileAttachment ? undefined : extraction.extractionFailureReason
  } satisfies FileContentExtraction;
  const evidenceAssessment = assessFileAnalysisEvidence({
    outputJson,
    extractedSourceText: finalExtraction.textContent,
    extractedRowCount: finalExtraction.rows.length,
    extractionFailureReason: finalExtraction.extractionFailureReason,
    sourceGrounding
  });
  const evidenceLineage = {
    source_record_type: "file_upload",
    source_record_id: file.id,
    source_file_id: file.id,
    evidence_classification: evidenceAssessment.classification,
    extraction_outcome: evidenceAssessment.extractionOutcome,
    source_grounding: evidenceAssessment.sourceGrounding,
    invalidation_reason: evidenceAssessment.reason
  } satisfies JsonObject;
  const classifiedInputJson = {
    ...(isRecord(inputJson) ? inputJson : {}),
    evidence_lineage: evidenceLineage
  } satisfies Json;
  const classifiedOutputJson = {
    ...(isRecord(outputJson) ? outputJson : {}),
    evidence_classification: evidenceAssessment.classification,
    extraction_outcome: evidenceAssessment.extractionOutcome,
    source_grounding: evidenceAssessment.sourceGrounding,
    evidence_lineage: evidenceLineage
  } satisfies Json;

  if (!evidenceAssessment.eligible) {
    throw new FileAnalysisEvidenceError(
      "Vaeroex could not find usable business information in this file. Try a clearer source or confirm that the file contains readable business details.",
      {
        inputJson: classifiedInputJson,
        outputJson: classifiedOutputJson,
        extractionOutcome: evidenceAssessment.extractionOutcome
      }
    );
  }
  const summary = summarizeVaeroexOutput(outputJson);
  const cleanResult = cleanAnalysisResult(outputJson, file, finalExtraction);
  const fileMetadata = isRecord(file.metadata_json) ? file.metadata_json : {};
  const existingActiveMemory =
    file.index_status === "ready" ||
    str(fileMetadata.latest_analysis_status) === "auto_learned" ||
    str(fileMetadata.latest_analysis_status) === "approved" ||
    str(fileMetadata.analysis_review_status) === "auto_learned" ||
    str(fileMetadata.analysis_review_status) === "approved";
  let learningDecision = classifyFileAnalysisLearning({
    outputJson,
    cleanResult,
    extraction: finalExtraction,
    existingActiveMemory
  });

  if (evidenceAssessment.requiresReview && learningDecision.status === "auto_learned") {
    learningDecision = {
      ...learningDecision,
      status: "needs_review",
      confidenceLabel: learningDecision.confidenceLabel === "High" ? "Medium" : learningDecision.confidenceLabel,
      trustLevel: "needs_review",
      reviewRequired: true,
      reviewReasons: [...learningDecision.reviewReasons, "Direct visual extraction requires review before it becomes Business Memory."],
      learningMode: "review_required"
    };
  }

  if (extraction.fileAttachment && !finalTextContent && !hasMeaningfulModelContent(outputJson)) {
    throw new Error(
      finalExtraction.extractionFailureReason ||
        `Vaeroex could not extract readable content from ${file.display_name}. The file may be scanned, blurry, locked, corrupted, or unsupported.`
    );
  }

  const { data, error } = await supabase
    .from("ai_agent_runs")
    .insert({
      workspace_id: workspaceId,
      agent_type: workflow.key,
      input_json: classifiedInputJson,
      output_json: classifiedOutputJson,
      status: "completed",
      created_by: userId
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Vaeroex analysis could not be saved.");
  }

  await recordVaeroexAiUsage({
    supabase,
    workspaceId,
    userId,
    agentType: workflow.key,
    usage: {
      ...usage,
      metadata: {
        ...(isRecord(usage.metadata) ? usage.metadata : {}),
        evidence_retrieval_mode: evidenceContext.retrievalMode,
        evidence_chunks: evidenceContext.chunks.length,
        evidence_confidence_score: evidenceContext.confidenceScore,
        source_file_id: file.id,
        fallback_chunking_used: false
      }
    }
  });

  let indexResult: Awaited<ReturnType<typeof indexFileAnalysisEvidence>> = { indexedChunks: 0, error: undefined };
  const analysisUpdatedAt = new Date().toISOString();

  if (learningDecision.status === "auto_learned") {
    await archiveFileAnalysisMemoryChunks({ supabase, workspaceId, fileId: file.id, archivedAt: analysisUpdatedAt });
    indexResult = await indexFileAnalysisEvidence({
      supabase,
      workspaceId,
      userId,
      file,
      runId: data.id,
      extractedText: finalExtraction.textContent || extractedTextFromOutput(outputJson) || summary,
      summary,
      metadata: {
        analysis_run_id: data.id,
        source_run_id: data.id,
        source_file_id: file.id,
        source_record_type: "file_upload",
        source_record_id: file.id,
        evidence_classification: evidenceAssessment.classification,
        extraction_outcome: evidenceAssessment.extractionOutcome,
        source_grounding: evidenceAssessment.sourceGrounding,
        analysis_output: classifiedOutputJson,
        extracted_row_count: finalExtraction.rows.length,
        extraction_failure_reason: finalExtraction.extractionFailureReason || null,
        learning_mode: learningDecision.learningMode,
        review_status: learningDecision.status,
        trust_level: learningDecision.trustLevel,
        confidence_label: learningDecision.confidenceLabel,
        evidence_quality: learningDecision.evidenceQuality,
        business_impact: learningDecision.businessImpact,
        risk_level: learningDecision.riskLevel,
        review_required: learningDecision.reviewRequired,
        auto_learned_at: analysisUpdatedAt
      } satisfies Json
    });

    if (!indexResult.indexedChunks && indexResult.error) {
      learningDecision = {
        ...learningDecision,
        status: "needs_review",
        trustLevel: "needs_review",
        reviewRequired: true,
        reviewReasons: [...learningDecision.reviewReasons, indexResult.error],
        learningMode: "review_required"
      };
    }
  } else {
    indexResult = {
      indexedChunks: 0,
      error: learningDecision.reviewReasons[0] || "Needs review before Business Memory can use this analysis."
    };
  }

  await supabase
    .from("file_uploads")
    .update({
      analysis_prompt: prompt,
      analysis_summary: summary,
      processing_status: "ready",
      processing_error: null,
      processed_at: analysisUpdatedAt,
      metadata_json: {
        ...fileMetadata,
        latest_analysis_run_id: data.id,
        latest_analysis_status: learningDecision.status,
        evidence_classification: evidenceAssessment.classification,
        extraction_outcome: evidenceAssessment.extractionOutcome,
        source_grounding: evidenceAssessment.sourceGrounding,
        invalidated_at: null,
        invalidation_reason: null,
        latest_analysis_lineage: {
          ...evidenceLineage,
          source_run_id: data.id,
          derived_from: [{ source_record_type: "file_upload", source_record_id: file.id }]
        },
        analysis_review_status: learningDecision.status,
        analysis_review_updated_at: analysisUpdatedAt,
        analysis_review_note:
          learningDecision.status === "auto_learned"
            ? learningDecision.trustLevel === "trusted"
              ? "Vaeroex automatically learned from this source because evidence quality and confidence were strong."
              : "Vaeroex automatically learned from this source as a medium-confidence directional observation."
            : "This analysis needs human review before it becomes active Business Memory.",
        analysis_learning_decision: learningDecision as unknown as Json,
        business_memory_trust_level: learningDecision.trustLevel,
        latest_analysis_at: analysisUpdatedAt,
        latest_analysis_prompt: prompt,
        latest_analysis_content_kind: finalExtraction.kind,
        latest_analysis_rows_detected: finalExtraction.rows.length,
        latest_analysis_characters_detected: finalExtraction.textContent.length,
        latest_analysis_indexed_chunks: indexResult.indexedChunks,
        latest_analysis_index_error: indexResult.error || null,
        latest_analysis_request_metrics: (requestMetrics || {}) as Json,
        latest_analysis_fallback: {
          used: false,
          reason: null
        },
        latest_analysis_preview: finalExtraction.preview,
        latest_analysis_output: {
          ...cleanResult,
          recommendation_confidence: learningDecision.confidenceLabel,
          learning_status: learningDecision.status,
          trust_level: learningDecision.trustLevel,
          evidence_quality: learningDecision.evidenceQuality,
          review_required: learningDecision.reviewRequired
        } satisfies JsonRecord,
        latest_text_extraction: {
          kind: finalExtraction.kind,
          extracted_at: analysisUpdatedAt,
          rows_detected: finalExtraction.rows.length,
          columns_detected: finalExtraction.columns,
          character_count: finalExtraction.textContent.length,
          preview: finalExtraction.textPreview,
          extracted_text: finalExtraction.textContent,
          extraction_note: finalExtraction.contentNote
        }
      } satisfies Json
    })
    .eq("id", file.id)
    .eq("workspace_id", workspaceId);

  return {
    workflow,
    inputJson: classifiedInputJson,
    outputJson: classifiedOutputJson,
    cleanResult,
    summary,
    extraction: finalExtraction,
    indexResult,
    learningDecision,
    runId: data.id
  };
}

export async function uploadFileAction(formData: FormData) {
  const { supabase, user, workspaceId } = await requireWorkspace();
  const returnPath = safeFileReturnPath(text(formData, "return_path"));
  const uploadedFile = formData.get("file");
  const allowDuplicateUpload = formData.get("allow_duplicate") === "on";

  if (!(uploadedFile instanceof File) || uploadedFile.size === 0) {
    redirectWithPathError(returnPath, "Choose a file to upload.");
  }

  const rateLimit = await enforceRateLimit({
    action: "file.upload",
    limit: 20,
    windowSeconds: 10 * 60,
    userId: user.id,
    workspaceId,
    identifiers: [user.email],
    metadata: { source: "file_upload" }
  });

  if (!rateLimit.allowed) {
    redirectWithPathError(returnPath, rateLimitMessage(rateLimit));
  }

  const fileLimit = await isUsageLimitReached({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId,
    limit: "files"
  });

  if (fileLimit.reached) {
    redirectWithPathError(returnPath, `This workspace has reached the file upload limit for the current Vaeroex plan (${fileLimit.limitValue} files).`);
  }

  const buffer = Buffer.from(await uploadedFile.arrayBuffer());
  const validation = validateUploadFileSafety({
    fileName: uploadedFile.name,
    browserMimeType: uploadedFile.type,
    size: uploadedFile.size,
    buffer
  });

  if (!validation.ok) {
    redirectWithPathError(returnPath, validation.error);
  }

  const extension = validation.extension;
  const storedExtension = validation.storedExtension;
  const folderId = await validateFolder(workspaceId, text(formData, "folder_id"));
  const safeName = safeFileName(uploadedFile.name);
  const storagePath = `${workspaceId}/${randomUUID()}/${safeName}`;
  const mimeType = validation.mimeType;
  const { data: possibleDuplicate } = await supabase
    .from("file_uploads")
    .select("id,display_name,created_at")
    .eq("workspace_id", workspaceId)
    .eq("original_name", uploadedFile.name)
    .eq("file_size_bytes", uploadedFile.size)
    .eq("file_extension", storedExtension)
    .is("deleted_at", null)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (possibleDuplicate && !allowDuplicateUpload) {
    redirectWithPathError(
      returnPath,
      `This looks like a duplicate of "${possibleDuplicate.display_name}". Check "Upload anyway" if you intentionally want another copy.`
    );
  }

  const upload = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: false
  });

  if (upload.error) {
    redirectWithPathError(returnPath, upload.error.message);
  }

  const displayName = text(formData, "display_name") || uploadedFile.name;
  const { data, error } = await supabase
    .from("file_uploads")
    .insert({
      workspace_id: workspaceId,
      folder_id: folderId,
      original_name: uploadedFile.name,
      display_name: displayName,
      file_extension: storedExtension,
      mime_type: mimeType,
      file_size_bytes: uploadedFile.size,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      import_status: extension === "csv" || extension === "xlsx" ? "ready" : "not_imported",
      processing_status: "uploaded",
      processing_error: null,
      processed_at: null,
      metadata_json: {
        upload_method: "files_module",
        can_import: extension === "csv" || extension === "xlsx",
        can_analyze:
          storedExtension === "csv" ||
          storedExtension === "xlsx" ||
          storedExtension === "pdf" ||
          storedExtension === "docx" ||
          storedExtension === "png" ||
          storedExtension === "jpg",
        supported_import_types: extension === "csv" || extension === "xlsx" ? ["kpi", "metrics"] : [],
        extraction_support:
          storedExtension === "csv" || storedExtension === "xlsx"
            ? "Spreadsheet rows can be parsed, analyzed, and imported after review."
            : storedExtension === "pdf" || storedExtension === "docx"
              ? "Text can be extracted for analysis and report creation when the document contains readable text."
              : "Image OCR and visual analysis are supported through Vaeroex."
      },
      created_by: user.id
    })
    .select("id")
    .single();

  if (error || !data) {
    redirectWithPathError(returnPath, error?.message || "File metadata could not be saved.");
  }

  await supabase.from("file_processing_jobs").insert({
    workspace_id: workspaceId,
    file_upload_id: data.id,
    job_type: "extract",
    status: "queued",
    created_by: user.id,
    metadata_json: {
      source: "upload",
      file_name: displayName,
      file_extension: storedExtension,
      file_size_bytes: uploadedFile.size
    }
  });

  revalidatePath(FILES_PATH);
  revalidatePath(SOURCES_PATH);
  revalidatePath("/app/reports");
  redirectWithPathMessage(
    returnPath,
    storedExtension === "csv" || storedExtension === "xlsx"
      ? "File uploaded. Next: analyze it with Vaeroex, import rows for review, or create a report from the spreadsheet."
      : storedExtension === "pdf" || storedExtension === "docx"
        ? "File uploaded. Next: analyze it with Vaeroex or create a report from extracted document text."
        : "File uploaded. Next: analyze it with Vaeroex for image text, visible issues, KPIs, and recommendations.",
    data.id
  );
}

export async function manageSourceFileAction(formData: FormData) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const returnPath = safeFileReturnPath(text(formData, "return_path") || SOURCES_PATH);
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const action = text(formData, "source_action");

  if (action !== "archive" && action !== "restore" && action !== "delete") {
    redirectWithPathError(returnPath, "Source action is not supported.", file.id);
  }

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: action === "delete" ? "delete_record" : action === "archive" ? "archive_record" : "manage_record",
        args: {
          recordId: file.id,
          collection: "files",
          action
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: file.id,
        metadata: {
          source: "source_file_action",
          file_id: file.id
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithPathError(returnPath, error instanceof Error ? error.message : "Source action was blocked by Vaeroex security policy.", file.id);
  }

  const lifecycleClient = supabase as unknown as {
    rpc: (name: string, args: Record<string, string>) => Promise<{ data: Array<{ file_id: string }> | null; error: { message: string } | null }>;
  };
  const { data: updatedFile, error } = await lifecycleClient.rpc("update_source_file_lifecycle", {
    p_workspace_id: workspaceId,
    p_file_id: file.id,
    p_action: action
  });

  if (error || !updatedFile?.length) {
    redirectWithPathError(returnPath, error?.message || "Source could not be changed. Refresh and try again.", file.id);
  }

  revalidatePath(FILES_PATH);
  revalidatePath(SOURCES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/intelligence");
  revalidatePath("/app/reports");
  redirectWithPathMessage(
    returnPath,
    action === "archive"
      ? "Source archived. Its learned evidence is excluded from future Vaeroex answers until it is analyzed again."
      : action === "delete"
        ? "Source deleted from active views. Its learned evidence is excluded from future Vaeroex answers."
        : "Source restored. Its eligible learned evidence is active again.",
    file.id
  );
}

export async function manageLearnedKnowledgeAction(formData: FormData) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const returnPath = safeFileReturnPath(text(formData, "return_path") || `${SOURCES_PATH}?tab=knowledge`);
  const chunkId = text(formData, "knowledge_id");
  const action = text(formData, "knowledge_action");
  const now = new Date().toISOString();

  if (!chunkId) {
    redirectWithPathError(returnPath, "Choose a learned knowledge item.");
  }

  if (action !== "archive" && action !== "delete" && action !== "restore") {
    redirectWithPathError(returnPath, "Knowledge action is not supported.");
  }

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: action === "delete" ? "delete_record" : action === "archive" ? "archive_record" : "manage_record",
        args: {
          recordId: chunkId,
          collection: "learned_knowledge",
          action
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: chunkId,
        metadata: {
          source: "learned_knowledge_action"
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithPathError(returnPath, error instanceof Error ? error.message : "Knowledge action was blocked by Vaeroex security policy.");
  }

  const update =
    action === "archive"
      ? { archived_at: now, updated_at: now }
      : action === "delete"
        ? { archived_at: now, deleted_at: now, updated_at: now }
        : { archived_at: null, deleted_at: null, updated_at: now };

  const { data: updatedKnowledge, error } = await supabase
    .from("business_memory_chunks")
    .update(update)
    .eq("id", chunkId)
    .eq("workspace_id", workspaceId)
    .select("id")
    .maybeSingle();

  if (error || !updatedKnowledge) {
    redirectWithPathError(returnPath, error?.message || "Learned knowledge could not be changed. Refresh and try again.");
  }

  revalidatePath(SOURCES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/intelligence");
  revalidatePath("/app/reports");
  redirectWithPathMessage(
    returnPath,
    action === "delete"
      ? "Learned knowledge deleted and excluded from future Vaeroex answers."
      : action === "archive"
        ? "Learned knowledge archived and excluded from future Vaeroex answers."
        : "Learned knowledge restored."
  );
}

export async function saveFileAnalysisToMemoryAction(formData: FormData) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const runId = text(formData, "run_id");
  const summary = text(formData, "summary") || file.analysis_summary || "Saved file analysis.";
  const confidence = text(formData, "confidence") || "Context saved";
  const evidence = text(formData, "evidence");
  let latestRunOutput: Json | null = null;
  let latestRunEligible = false;

  if (runId) {
    const { data: latestRun } = await supabase
      .from("ai_agent_runs")
      .select("output_json,status,deleted_at,archived_at")
      .eq("id", runId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    latestRunOutput = latestRun?.output_json || null;
    latestRunEligible = Boolean(latestRun?.status === "completed" && !latestRun.deleted_at && !latestRun.archived_at);
  }

  const extractedText = latestExtractedText(file) || extractedTextFromOutput(latestRunOutput) || evidence || summary;
  const fileMetadata = isRecord(file.metadata_json) ? file.metadata_json : {};
  const evidenceAssessment = assessFileAnalysisEvidence({
    outputJson: latestRunOutput || {},
    extractedSourceText: extractedText,
    sourceGrounding: fileMetadata.source_grounding === "model_extraction" ? "model_extraction" : "local_extraction"
  });

  if (!runId || !latestRunEligible || !evidenceAssessment.eligible) {
    redirectWithFileError("This analysis did not produce eligible source-grounded business facts and cannot be added to Business Memory.", file.id);
  }

  const savedAt = new Date().toISOString();
  const metadata = isRecord(file.metadata_json) ? file.metadata_json : {};
  const businessMemoryEntry = {
    saved: true,
    saved_at: savedAt,
    saved_by: user.id,
    source: "file_analysis",
    source_file_id: file.id,
    source_file_name: file.display_name,
    run_id: runId || null,
    summary,
    confidence,
    evidence: evidence
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12),
    source_references: {
      file_id: file.id,
      original_name: file.original_name,
      storage_path: file.storage_path,
      latest_analysis_at: savedAt
    },
    latest_output_json: latestRunOutput
  } satisfies JsonObject;

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "save_file_analysis_business_memory",
        args: {
          fileId: file.id,
          ...(runId ? { runId } : {}),
          summary
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: file.id,
        metadata: {
          source: "file_analysis_save",
          confidence
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithFileError(error instanceof Error ? error.message : "Saving analysis was blocked by Vaeroex security policy.", file.id);
  }

  await archiveFileAnalysisMemoryChunks({ supabase, workspaceId, fileId: file.id, archivedAt: savedAt });
  const indexResult = await indexFileAnalysisEvidence({
    supabase,
    workspaceId,
    userId: user.id,
    file,
    runId: runId || null,
    extractedText,
    summary,
    metadata: {
      analysis_run_id: runId || null,
      source_run_id: runId,
      source_file_id: file.id,
      source_record_type: "file_upload",
      source_record_id: file.id,
      evidence_classification: "business_evidence",
      extraction_outcome: "facts_extracted",
      analysis_output: latestRunOutput,
      review_status: "approved",
      trust_level: "trusted",
      learning_mode: "manual_approval",
      approved_at: savedAt,
      approved_by: user.id
    } satisfies Json
  });

  const { error } = await supabase
    .from("file_uploads")
    .update({
      metadata_json: {
        ...metadata,
        business_memory: businessMemoryEntry,
        business_memory_history: [
          businessMemoryEntry,
          ...(Array.isArray(metadata.business_memory_history) ? metadata.business_memory_history.filter(isRecord).slice(0, 9) : [])
        ],
        latest_analysis_status: "approved",
        analysis_review_status: "approved",
        business_memory_trust_level: "trusted",
        analysis_review_updated_at: savedAt,
        analysis_approved_at: savedAt,
        analysis_approved_by: user.id,
        latest_analysis_indexed_chunks: indexResult.indexedChunks
      } satisfies Json,
      updated_at: savedAt
    })
    .eq("id", file.id)
    .eq("workspace_id", workspaceId);

  if (error) {
    redirectWithFileError(error.message, file.id);
  }

  revalidatePath(FILES_PATH);
  revalidatePath(SOURCES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/intelligence");
  revalidatePath("/app/reports");
  redirectWithMessage("Findings approved and added to Business Memory for future Vaeroex context.", file.id);
}

function latestAnalysisRunId(file: FileUploadRow) {
  const metadata = isRecord(file.metadata_json) ? file.metadata_json : {};
  return str(metadata.latest_analysis_run_id);
}

function latestAnalysisOutput(file: FileUploadRow) {
  const metadata = isRecord(file.metadata_json) ? file.metadata_json : {};
  return isRecord(metadata.latest_analysis_output) ? metadata.latest_analysis_output : {};
}

function latestExtractedText(file: FileUploadRow) {
  const metadata = isRecord(file.metadata_json) ? file.metadata_json : {};
  const extraction = isRecord(metadata.latest_text_extraction) ? metadata.latest_text_extraction : {};
  return str(extraction.extracted_text) || str(extraction.preview) || "";
}

export async function approveFileAnalysisAction(formData: FormData) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const returnPath = safeFileReturnPath(text(formData, "return_path"));
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const metadata = isRecord(file.metadata_json) ? file.metadata_json : {};
  const runId = text(formData, "run_id") || latestAnalysisRunId(file);
  const summary = text(formData, "summary") || file.analysis_summary || "Approved file analysis.";

  if (!runId) {
    redirectWithPathError(returnPath, "Analyze this file before approving findings.", file.id);
  }

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "save_file_analysis_business_memory",
        args: {
          fileId: file.id,
          runId,
          summary
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: file.id,
        metadata: {
          source: "file_analysis_approval",
          review_status: "approved"
        } satisfies Json
      }
    );

    const { data: latestRun } = await supabase
      .from("ai_agent_runs")
      .select("output_json,status,deleted_at,archived_at")
      .eq("id", runId)
      .eq("workspace_id", workspaceId)
      .eq("agent_type", "file_analysis")
      .maybeSingle();
    const runOutput = latestRun?.output_json || latestAnalysisOutput(file);
    const approvedAt = new Date().toISOString();
    const extractedText = latestExtractedText(file) || extractedTextFromOutput(runOutput) || summary;
    const sourceMetadata = isRecord(file.metadata_json) ? file.metadata_json : {};
    const evidenceAssessment = assessFileAnalysisEvidence({
      outputJson: runOutput,
      extractedSourceText: extractedText,
      sourceGrounding: sourceMetadata.source_grounding === "model_extraction" ? "model_extraction" : "local_extraction"
    });

    if (!latestRun || latestRun.status !== "completed" || latestRun.deleted_at || latestRun.archived_at || !evidenceAssessment.eligible) {
      throw new Error("This analysis did not produce eligible source-grounded business facts and cannot be approved as Business Memory.");
    }

    await archiveFileAnalysisMemoryChunks({ supabase, workspaceId, fileId: file.id, archivedAt: approvedAt });
    const indexResult = await indexFileAnalysisEvidence({
      supabase,
      workspaceId,
      userId: user.id,
      file,
      runId,
      extractedText,
      summary,
      metadata: {
        analysis_run_id: runId,
        source_run_id: runId,
        source_file_id: file.id,
        source_record_type: "file_upload",
        source_record_id: file.id,
        evidence_classification: "business_evidence",
        extraction_outcome: "facts_extracted",
        analysis_output: runOutput,
        review_status: "approved",
        trust_level: "trusted",
        learning_mode: "manual_approval",
        approved_at: approvedAt,
        approved_by: user.id
      } satisfies Json
    });

    if (!indexResult.indexedChunks && indexResult.error) {
      throw new Error(indexResult.error);
    }

    await supabase
      .from("file_uploads")
      .update({
        metadata_json: {
          ...metadata,
          latest_analysis_status: "approved",
          analysis_review_status: "approved",
          business_memory_trust_level: "trusted",
          analysis_review_updated_at: approvedAt,
          analysis_approved_at: approvedAt,
          analysis_approved_by: user.id,
          business_memory: {
            saved: true,
            saved_at: approvedAt,
            saved_by: user.id,
            source: "file_analysis_approval",
            source_file_id: file.id,
            source_file_name: file.display_name,
            run_id: runId,
            summary,
            indexed_chunk_count: indexResult.indexedChunks
          } satisfies JsonObject
        } satisfies Json,
        processing_status: "ready",
        processing_error: null,
        processed_at: approvedAt,
        updated_at: approvedAt
      })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);
  } catch (error) {
    redirectWithPathError(returnPath, error instanceof Error ? error.message : "Findings could not be approved.", file.id);
  }

  revalidatePath(FILES_PATH);
  revalidatePath(SOURCES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/intelligence");
  revalidatePath("/app/agents");
  redirectWithPathMessage(returnPath, "Findings approved. This source is now available to Business Memory and Search or Ask.", file.id);
}

export async function discardFileAnalysisAction(formData: FormData) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const returnPath = safeFileReturnPath(text(formData, "return_path"));
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const metadata = isRecord(file.metadata_json) ? file.metadata_json : {};
  const runId = text(formData, "run_id") || latestAnalysisRunId(file);

  if (!runId) {
    redirectWithPathError(returnPath, "No analysis result was available to discard.", file.id);
  }

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "delete_generated_insights",
        args: {
          runIds: [runId]
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: runId,
        metadata: {
          source: "file_analysis_discard",
          file_id: file.id
        } satisfies Json
      }
    );

    const discardedAt = new Date().toISOString();
    await archiveFileAnalysisMemoryChunks({ supabase, workspaceId, fileId: file.id, archivedAt: discardedAt });
    await supabase
      .from("ai_agent_runs")
      .update({
        deleted_at: discardedAt,
        status: "failed",
        error_message: "Analysis discarded by user."
      })
      .eq("id", runId)
      .eq("workspace_id", workspaceId)
      .eq("agent_type", "file_analysis");
    await supabase
      .from("file_uploads")
      .update({
        metadata_json: {
          ...metadata,
          latest_analysis_status: "discarded",
          analysis_review_status: "discarded",
          analysis_review_updated_at: discardedAt,
          analysis_discarded_at: discardedAt,
          analysis_discarded_by: user.id,
          excluded_analysis_run_ids: Array.from(
            new Set([
              runId,
              ...(Array.isArray(metadata.excluded_analysis_run_ids)
                ? metadata.excluded_analysis_run_ids.filter((item): item is string => typeof item === "string")
                : [])
            ])
          )
        } satisfies Json,
        processing_status: "uploaded",
        processing_error: null,
        updated_at: discardedAt
      })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);
  } catch (error) {
    redirectWithPathError(returnPath, error instanceof Error ? error.message : "Analysis could not be discarded.", file.id);
  }

  revalidatePath(FILES_PATH);
  revalidatePath(SOURCES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/intelligence");
  revalidatePath("/app/agents");
  redirectWithPathMessage(returnPath, "Analysis discarded. It will not be used in future Vaeroex answers.", file.id);
}

export async function importFileAction(formData: FormData) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const importType = validImportType(text(formData, "import_type"));
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const rateLimit = await enforceRateLimit({
    action: "file.import_stage",
    limit: 15,
    windowSeconds: 10 * 60,
    userId: user.id,
    workspaceId,
    identifiers: [file.id, importType],
    metadata: { source: "file_import_stage", file_id: file.id, import_type: importType }
  });

  if (!rateLimit.allowed) {
    redirectWithFileError(rateLimitMessage(rateLimit), file.id);
  }

  if (!isSpreadsheet(file)) {
    redirectWithFileError("Only CSV and XLSX files can be imported into KPI or business metric history.", file.id);
  }

  await updateFileProcessingStatus({ supabase, file, status: "processing" });
  const buffer = await downloadFileBuffer(file);
  let rows: ImportRow[] = [];

  try {
    rows = parseSpreadsheetRows({ fileName: file.original_name, buffer });
  } catch (error) {
    const message = actionErrorMessage(error, "The spreadsheet could not be read.");

    await supabase
      .from("file_uploads")
      .update({ import_status: "failed", processing_status: "failed", processing_error: message, processed_at: new Date().toISOString() })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);
    redirectWithFileError(message, file.id);
  }

  if (!rows.length) {
    await supabase
      .from("file_uploads")
      .update({
        import_status: "failed",
        processing_status: "failed",
        processing_error: "No data rows were found. Make sure the first row contains column names.",
        processed_at: new Date().toISOString()
      })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);
    redirectWithFileError("No data rows were found. Make sure the first row contains column names.", file.id);
  }

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "stage_file_import",
        args: {
          fileId: file.id,
          importType,
          rowsDetected: rows.length
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: file.id,
        metadata: {
          source: "file_import_extraction",
          file_extension: file.file_extension
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithFileError(error instanceof Error ? error.message : "File import was blocked by Vaeroex security policy.", file.id);
  }

  const mapping = inferMapping(importType, rows);
  const summary = extractionSummary(importType, rows, mapping);
  const { data: importRecord, error: importError } = await supabase
    .from("file_imports")
    .insert({
      workspace_id: workspaceId,
      file_upload_id: file.id,
      import_type: importType,
      status: "needs_review",
      rows_total: rows.length,
      rows_imported: 0,
      mapping_json: mapping,
      extraction_summary: summary,
      created_by: user.id
    })
    .select("id")
    .single();

  if (importError || !importRecord) {
    await updateFileProcessingStatus({
      supabase,
      file,
      status: "failed",
      error: importError?.message || "Import record could not be created."
    });
    redirectWithFileError(importError?.message || "Import record could not be created.", file.id);
  }

  const importRows = rows.slice(0, 1000).map((row, index) => ({
    workspace_id: workspaceId,
    file_upload_id: file.id,
    import_id: importRecord.id,
    import_type: importType,
    row_number: index + 1,
    data_json: rowJson(row),
    mapped_data_json: mappedRowJson(row, mapping, importType),
    status: "staged"
  }));
  const importRowsResult = await supabase.from("file_import_rows").insert(importRows);

  if (importRowsResult.error) {
    await updateFileProcessingStatus({ supabase, file, status: "failed", error: importRowsResult.error.message });
    redirectWithFileError(importRowsResult.error.message, file.id);
  }

  await supabase
    .from("file_uploads")
    .update({
      import_type: importType,
      import_status: "extracted",
      processing_status: "ready",
      processing_error: null,
      processed_at: new Date().toISOString(),
      metadata_json: {
        ...(isRecord(file.metadata_json) ? file.metadata_json : {}),
        latest_extraction: {
          import_id: importRecord.id,
          import_type: importType,
          rows_total: rows.length,
          mapping,
          extracted_at: new Date().toISOString(),
          summary
        },
        preview_rows: previewRows(rows, 5)
      } satisfies Json
    })
    .eq("id", file.id)
    .eq("workspace_id", workspaceId);

  revalidatePath(FILES_PATH);
  revalidatePath("/app/kpis");
  revalidatePath("/app/reports");
  redirectWithMessage(`Data extracted from ${rows.length} row${rows.length === 1 ? "" : "s"}. Review the mappings before saving records.`, file.id);
}

function appendImportHistory(metadataJson: Json, entry: JsonObject) {
  const metadata = (isRecord(metadataJson) ? metadataJson : {}) as JsonObject;
  const history = Array.isArray(metadata.import_history)
    ? metadata.import_history.filter(isRecord).map((item) => item as JsonObject)
    : [];

  return {
    ...metadata,
    last_import: entry,
    import_history: [entry, ...history].slice(0, 20)
  } satisfies JsonObject;
}

export async function saveExtractedImportAction(formData: FormData) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const importId = text(formData, "import_id");

  if (!importId) {
    redirectWithFileError("Choose an extracted import to save.", file.id);
  }

  const { data: importRecord, error: importError } = await supabase
    .from("file_imports")
    .select("*")
    .eq("id", importId)
    .eq("workspace_id", workspaceId)
    .eq("file_upload_id", file.id)
    .maybeSingle();

  if (importError || !importRecord) {
    redirectWithFileError(importError?.message || "Extraction not found for this workspace.", file.id);
  }

  const importType = validImportType(text(formData, "import_type") || importRecord.import_type);
  const rateLimit = await enforceRateLimit({
    action: "file.import_approve",
    limit: 15,
    windowSeconds: 10 * 60,
    userId: user.id,
    workspaceId,
    identifiers: [file.id, importId, importType],
    metadata: { source: "file_import_approval", file_id: file.id, import_id: importId, import_type: importType }
  });

  if (!rateLimit.allowed) {
    redirectWithFileError(rateLimitMessage(rateLimit), file.id);
  }

  const mapping = mappingFromForm(formData, importType, importRecord.mapping_json);
  const kpiInterpretation = importType === "kpi" ? kpiImportInterpretationFromForm(formData) : null;
  const savedMappingJson = (
    kpiInterpretation
      ? {
          ...mapping,
          kpi_interpretation: kpiInterpretation
        }
      : mapping
  ) as Json;
  const { data: stagedRows, error: rowsError } = await supabase
    .from("file_import_rows")
    .select("id,data_json,row_number")
    .eq("workspace_id", workspaceId)
    .eq("file_upload_id", file.id)
    .eq("import_id", importId)
    .order("row_number", { ascending: true })
    .limit(1000);

  if (rowsError) {
    redirectWithFileError(rowsError.message, file.id);
  }

  if (!stagedRows?.length) {
    redirectWithFileError("No extracted rows were found to save.", file.id);
  }

  const importToolByType: Record<ImportType, RegisteredToolName> = {
    kpi: "approve_kpi_import",
    metrics: "approve_operational_metrics_import"
  };

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: importToolByType[importType],
        args: {
          fileId: file.id,
          importId,
          importType,
          rowsApproved: stagedRows.length
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: importId,
        metadata: {
          source: "file_import_approval",
          file_id: file.id
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithFileError(error instanceof Error ? error.message : "Import approval was blocked by Vaeroex security policy.", file.id);
  }

  let importedRowCount = 0;
  let duplicateKpiRowCount = 0;
  let importedKpiImportRowIds: string[] = [];
  let duplicateKpiImportRowIds: string[] = [];
  let kpiSettingsSkippedForPermission = false;

  try {
    await updateFileProcessingStatus({ supabase, file, status: "processing" });

    if (importType === "kpi") {
      const targetRows = buildKpiRecords(stagedRows, workspaceId, user.id, file, importId, mapping);
      const deduped = await removeDuplicateKpiRows({
        supabase,
        rows: targetRows,
        workspaceId,
        sourceFileId: file.id
      });
      duplicateKpiRowCount = deduped.duplicateRows.length;
      importedRowCount = deduped.rows.length;
      importedKpiImportRowIds = deduped.rows.map((row) => row.importRowId);
      duplicateKpiImportRowIds = deduped.duplicateRows.map((row) => row.importRowId);

      if (deduped.rows.length) {
        const { error } = await supabase.from("kpis").insert(deduped.rows.map((row) => row.record));

        if (error) {
          throw new Error(error.message);
        }
      }

      if (targetRows.length && kpiInterpretation) {
        const kpiSettingsSaved = await upsertImportedKpiSettings({
          supabase,
          rows: targetRows,
          workspaceId,
          userId: user.id,
          interpretation: kpiInterpretation
        });
        kpiSettingsSkippedForPermission = !kpiSettingsSaved;
      }
    } else {
      const targetRows = buildOperationalMetricRecords(stagedRows, workspaceId, user.id, file, importId, mapping);
      importedRowCount = targetRows.length;

      if (targetRows.length) {
        const { error } = await supabase.from("operational_metrics").insert(targetRows.map((row) => row.record));

        if (error) {
          throw new Error(error.message);
        }
      }
    }

    if (!importedRowCount && !duplicateKpiRowCount) {
      throw new Error("No rows matched the selected mappings. Check the required fields and try again.");
    }

    const importedAt = new Date().toISOString();
    const importEntry = {
      import_id: importId,
      import_type: importType,
      rows_total: importRecord.rows_total,
      rows_imported: importedRowCount,
      imported_at: importedAt,
      source_file_id: file.id
    } satisfies JsonObject;

    if (importType === "kpi") {
      if (importedKpiImportRowIds.length) {
        await supabase
          .from("file_import_rows")
          .update({
            status: "imported"
          })
          .eq("workspace_id", workspaceId)
          .eq("import_id", importId)
          .in("id", importedKpiImportRowIds);
      }

      if (duplicateKpiImportRowIds.length) {
        await supabase
          .from("file_import_rows")
          .update({
            status: "skipped_duplicate"
          })
          .eq("workspace_id", workspaceId)
          .eq("import_id", importId)
          .in("id", duplicateKpiImportRowIds);
      }
    } else {
      await supabase
        .from("file_import_rows")
        .update({
          status: "imported"
        })
        .eq("workspace_id", workspaceId)
        .eq("import_id", importId);
    }

    await supabase
      .from("file_imports")
      .update({
        status: "completed",
        rows_imported: importedRowCount,
        mapping_json: savedMappingJson,
        reviewed_at: importedAt,
        imported_at: importedAt,
        extraction_summary: extractionSummary(importType, stagedRows.map((row) => jsonToImportRow(row.data_json)), mapping)
      })
      .eq("id", importId)
      .eq("workspace_id", workspaceId);

    await supabase
      .from("file_uploads")
      .update({
        import_type: importType,
        import_status: "imported",
        imported_rows: file.imported_rows + importedRowCount,
        processing_status: "ready",
        processing_error: null,
        processed_at: new Date().toISOString(),
        metadata_json: appendImportHistory(file.metadata_json, importEntry)
      })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);
  } catch (error) {
    const message = actionErrorMessage(error, "Imported data could not be saved.");

    await supabase
      .from("file_imports")
      .update({ status: "failed", errors_json: [{ message }] })
      .eq("id", importId)
      .eq("workspace_id", workspaceId);

    await supabase
      .from("file_uploads")
      .update({ import_status: "failed", processing_status: "failed", processing_error: message, processed_at: new Date().toISOString() })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);
    redirectWithFileError(message, file.id);
  }

  revalidatePath(FILES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/kpis");
  revalidatePath("/app/reports");
  if (importType === "kpi") {
    const duplicateNote = duplicateKpiRowCount
      ? ` ${duplicateKpiRowCount} duplicate row${duplicateKpiRowCount === 1 ? "" : "s"} skipped.`
      : "";
    const settingsNote = kpiSettingsSkippedForPermission
      ? " KPI display settings were not changed because only workspace owners/admins can manage KPI settings."
      : "";

    redirectWithMessage(
      importedRowCount
        ? `KPI history updated. Dashboard and reports now include this data. ${importedRowCount} approved row${importedRowCount === 1 ? "" : "s"} saved.${duplicateNote}${settingsNote}`
        : `KPI history already included this data. No duplicate KPI rows were saved.${duplicateNote}${settingsNote}`,
      file.id
    );
  }

  redirectWithMessage(`${importedRowCount} approved row${importedRowCount === 1 ? "" : "s"} saved to history.`, file.id);
}

export async function createReportFromFileAction(formData: FormData) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const reportTitle = text(formData, "report_title") || `File Report - ${file.display_name}`;
  const reportType = text(formData, "report_type") || "File Review";
  const reportFocus = text(formData, "report_focus");
  const rateLimit = await enforceRateLimit({
    action: "file.create_report",
    limit: 12,
    windowSeconds: 10 * 60,
    userId: user.id,
    workspaceId,
    identifiers: [file.id],
    metadata: { source: "file_report_generation", file_id: file.id }
  });

  if (!rateLimit.allowed) {
    redirectWithFileError(rateLimitMessage(rateLimit), file.id);
  }

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "create_report_from_file",
        args: {
          fileId: file.id,
          title: reportTitle,
          reportType
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: file.id,
        metadata: {
          source: "file_report_generation",
          report_focus_present: Boolean(reportFocus)
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithFileError(error instanceof Error ? error.message : "Report creation was blocked by Vaeroex security policy.", file.id);
  }

  const { data: importRows, error: importError } = await supabase
    .from("file_imports")
    .select("import_type,status,rows_total,rows_imported,extraction_summary,created_at,imported_at")
    .eq("workspace_id", workspaceId)
    .eq("file_upload_id", file.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (importError) {
    redirectWithFileError(importError.message, file.id);
  }

  let analysis: Awaited<ReturnType<typeof runFileVaeroexAnalysis>>;

  try {
    analysis = await runFileVaeroexAnalysis({
      supabase,
      userId: user.id,
      email: user.email,
      workspaceId,
      file,
      prompt:
        reportFocus ||
        "Create a customer-ready intelligence report from this uploaded file. Include an executive summary, extracted findings, KPIs found, risks, issues, recommendations, and practical next actions.",
      rowLimit: MAX_REPORT_ROWS
    });
  } catch (error) {
    const message = fileActionErrorMessage(error, "Vaeroex could not create a report from this file.", file);

    await updateFileProcessingStatus({ supabase, file, status: "failed", error: message });
    redirectWithFileError(message, file.id);
  }

  const fallbackBody = fileReportBody({
    file,
    importRows: importRows || [],
    analysisSummary: analysis.summary,
    prompt: reportFocus,
    extraction: analysis.extraction
  });
  const bodyMarkdown = ensureFileReportSections(vaeroexReportMarkdown(analysis.outputJson, fallbackBody), file, analysis.extraction);
  const sourceData = {
    generated_from: "file",
    file: {
      id: file.id,
      display_name: file.display_name,
      original_name: file.original_name,
      file_extension: file.file_extension,
      import_type: file.import_type,
      import_status: file.import_status,
      imported_rows: file.imported_rows,
      analysis_summary: analysis.summary,
      analysis_prompt: reportFocus || file.analysis_prompt,
      metadata_json: file.metadata_json
    },
    vaeroex_analysis_run_id: analysis.runId,
    vaeroex_output: analysis.outputJson,
    vaeroex_analysis_result: analysis.cleanResult,
    extracted_content: {
      supported: analysis.extraction.supported,
      content_kind: analysis.extraction.kind,
      rows_detected: analysis.extraction.rows.length,
      columns_detected: analysis.extraction.columns,
      characters_detected: analysis.extraction.textContent.length,
      preview_rows: analysis.extraction.kind === "spreadsheet" ? analysis.extraction.preview : [],
      text_preview: analysis.extraction.textPreview
    },
    import_history: importRows || [],
    report_focus: reportFocus || null
  } satisfies Json;

  const { data: report, error } = await supabase
    .from("reports")
    .insert({
      workspace_id: workspaceId,
      report_type: reportType,
      title: reportTitle,
      date_range_start: file.created_at.slice(0, 10),
      date_range_end: new Date().toISOString().slice(0, 10),
      body_markdown: bodyMarkdown,
      source_data_json: sourceData,
      created_by: user.id
    })
    .select("id,title")
    .single();

  if (error || !report) {
    const message = error?.message || "Report could not be created from this file.";

    await updateFileProcessingStatus({ supabase, file, status: "failed", error: message });
    redirectWithFileError(message, file.id);
  }

  revalidatePath(FILES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/reports");
  redirect(
    `/app/reports?message=${encodeURIComponent(`Report created from Vaeroex review of ${file.display_name}.`)}&q=${encodeURIComponent(report.title)}` as Route
  );
}

export async function attachFileToReportAction(formData: FormData) {
  const { supabase, user, workspaceId, membership } = await requireWorkspace();
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const reportId = text(formData, "report_id");

  if (!reportId) {
    redirectWithFileError("Choose a report before attaching this file.", file.id);
  }

  const { data: report, error: reportError } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (reportError || !report) {
    redirectWithFileError(reportError?.message || "Report not found for this workspace.", file.id);
  }

  try {
    await requireToolExecution(
      {
        supabase,
        workspaceId,
        userId: user.id,
        userRole: membership.role
      },
      {
        toolName: "attach_file_to_report",
        args: {
          fileId: file.id,
          reportId: report.id
        },
        initiatedBy: "user",
        confirmationReceived: true,
        targetRecordId: report.id,
        metadata: {
          source: "file_report_attachment"
        } satisfies Json
      }
    );
  } catch (error) {
    redirectWithFileError(error instanceof Error ? error.message : "File attachment was blocked by Vaeroex security policy.", file.id);
  }

  const sourceData = (isRecord(report.source_data_json) ? report.source_data_json : {}) as JsonObject;
  const existingFiles = Array.isArray(sourceData.attached_files) ? sourceData.attached_files.filter(isRecord).map((item) => item as JsonObject) : [];
  const attachment = {
    id: file.id,
    display_name: file.display_name,
    original_name: file.original_name,
    file_extension: file.file_extension,
    import_status: file.import_status,
    imported_rows: file.imported_rows,
    analysis_summary: file.analysis_summary,
    attached_at: new Date().toISOString()
  } satisfies JsonObject;
  const withoutDuplicate = existingFiles.filter((item) => item.id !== file.id);
  const bodyNote = `\n\n## Attached File\n- ${file.display_name} (${file.file_extension.toUpperCase()})\n- Import status: ${file.import_status.replace(/_/g, " ")}\n- Imported rows: ${file.imported_rows}\n${file.analysis_summary ? `- Latest Vaeroex review: ${file.analysis_summary.split("\n")[0]}` : "- Latest Vaeroex review: Not completed yet."}`;

  const { error } = await supabase
    .from("reports")
    .update({
      source_data_json: {
        ...sourceData,
        attached_files: [attachment, ...withoutDuplicate].slice(0, 20)
      } satisfies Json,
      body_markdown: `${report.body_markdown || ""}${bodyNote}`
    })
    .eq("id", report.id)
    .eq("workspace_id", workspaceId);

  if (error) {
    redirectWithFileError(error.message, file.id);
  }

  revalidatePath(FILES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/reports");
  redirectWithMessage("File attached to report.", file.id);
}

export async function analyzeFileAction(formData: FormData) {
  const { supabase, user, workspaceId } = await requireWorkspace();
  const returnPath = safeFileReturnPath(text(formData, "return_path"));
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const prompt =
    text(formData, "suggested_prompt") ||
    text(formData, "analysis_prompt") ||
    "Analyze only this source file. Extract source-specific facts, readable text, quantities, status signals, risks, opportunities, possible KPIs, unclear fields, and a concise leadership summary. For inventory images, identify item names, readable quantities, possible shortages, possible overstock, and fields that need confirmation. Do not add generic business advice that is not supported by the file.";

  if ((file.processing_status || "") === "processing") {
    redirectWithPathMessage(returnPath, "Analysis is already running for this source. Refresh shortly to review the result.", file.id);
  }

  const rateLimit = await enforceRateLimit({
    action: "file.analysis",
    limit: 12,
    windowSeconds: 10 * 60,
    userId: user.id,
    workspaceId,
    identifiers: [file.id],
    metadata: { source: "file_analysis", file_id: file.id }
  });

  if (!rateLimit.allowed) {
    redirectWithPathError(returnPath, rateLimitMessage(rateLimit), file.id);
  }

  const workflow = getVaeroexWorkflow("file_analysis");
  let inputJson: Json = {
    workflow: workflow.key,
    user_prompt: prompt,
    extra_inputs: {
      file: {
        id: file.id,
        name: file.display_name,
        extension: file.file_extension
      }
    },
    workspace_snapshot: {}
  } satisfies Json;

  try {
    const result = await runFileVaeroexAnalysis({
      supabase,
      userId: user.id,
      email: user.email,
      workspaceId,
      file,
      prompt,
      rowLimit: MAX_ANALYSIS_ROWS
    });
    inputJson = result.inputJson;

    revalidatePath(FILES_PATH);
    revalidatePath("/app");
    revalidatePath("/app/agents");
    revalidatePath("/app/reports");
    const insightCount = cleanAnalysisInsightCount(result.cleanResult);
    const limitedContent = result.extraction.kind !== "spreadsheet" && result.extraction.kind !== "image_vision" && result.extraction.textContent.length < 250;
    const message =
      result.learningDecision.status === "auto_learned"
        ? insightCount
          ? `Analysis complete. Vaeroex learned ${insightCount} finding${insightCount === 1 ? "" : "s"} from ${file.display_name} with ${result.learningDecision.confidenceLabel.toLowerCase()} confidence.`
          : `Analysis complete. Vaeroex added this source to Business Memory with ${result.learningDecision.confidenceLabel.toLowerCase()} confidence.`
        : insightCount
          ? `Analysis needs review. Vaeroex found ${insightCount} finding${insightCount === 1 ? "" : "s"}, but confidence or risk requires a human check.`
          : limitedContent
            ? "Analysis needs review because only limited text was found."
            : "Analysis needs review before Business Memory uses it.";

    redirectWithPathMessage(returnPath, message, file.id);
  } catch (error) {
    const message = fileActionErrorMessage(error, "Vaeroex could not analyze the file.", file);
    const evidenceFailure = error instanceof FileAnalysisEvidenceError ? error : null;
    const failureInputJson = evidenceFailure?.inputJson || inputJson;
    const failureOutputJson = evidenceFailure?.outputJson || ({} satisfies Json);
    const failedAt = new Date().toISOString();

    await updateFileProcessingStatus({ supabase, file, status: "failed", error: message });
    await supabase
      .from("file_uploads")
      .update({
        metadata_json: {
          ...(isRecord(file.metadata_json) ? file.metadata_json : {}),
          latest_analysis_status: "failed",
          latest_analysis_at: failedAt,
          latest_analysis_prompt: prompt,
          latest_analysis_error: message,
          latest_analysis_failure: {
            stage: /too large|direct visual analysis|direct document analysis/i.test(message) ? "request_size_preflight" : "analysis",
            type: /too large|direct visual analysis|direct document analysis/i.test(message) ? "request_size" : "analysis_failed",
            retry_eligible: true,
            user_message: message,
            evidence_classification: evidenceFailure ? "invalid_evidence" : "user_failure_state",
            extraction_outcome: evidenceFailure?.extractionOutcome || "technical_failure",
            source_record_type: "file_upload",
            source_record_id: file.id,
            source_file_id: file.id
          }
        } satisfies Json
      })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);
    await supabase.from("ai_agent_runs").insert({
      workspace_id: workspaceId,
      agent_type: workflow.key,
      input_json: failureInputJson,
      output_json: failureOutputJson,
      status: "failed",
      error_message: message,
      created_by: user.id
    });

    revalidatePath(FILES_PATH);
    redirectWithPathError(returnPath, message, file.id);
  }
}
