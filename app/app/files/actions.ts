"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { redirect } from "next/navigation";
import { runVaeroexCompletion } from "@/lib/ai/vaeroex-client";
import { getVaeroexWorkflow } from "@/lib/ai/vaeroex-workflows";
import { buildWorkspaceSnapshot } from "@/lib/ai/workspace-snapshot";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { isUsageLimitReached } from "@/lib/billing/usage-limits";
import { parseSpreadsheetRows, previewRows, type ImportCellValue, type ImportRow } from "@/lib/imports/spreadsheets";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/lib/supabase/types";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_import_rows"]["Row"];
type ImportType = "kpi" | "crm" | "metrics";
type JsonRecord = Record<string, unknown>;
type JsonObject = { [key: string]: Json | undefined };
type ImportMapping = Record<string, string>;
type ImportField = {
  key: string;
  label: string;
  required?: boolean;
  candidates: string[];
};

const FILES_PATH = "/app/files";
const STORAGE_BUCKET = "workspace-files";
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["csv", "xlsx", "pdf", "png", "jpg", "jpeg", "docx"];
const MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
};
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
    { key: "owner", label: "Owner", candidates: ["owner", "assigned", "manager"] },
    { key: "notes", label: "Notes", candidates: ["notes", "description", "comment", "comments"] },
    { key: "source", label: "Source", candidates: ["source"] }
  ],
  crm: [
    { key: "lead_name", label: "Lead name", required: true, candidates: ["lead", "lead name", "lead_name", "contact", "name", "customer", "client"] },
    { key: "company", label: "Company", candidates: ["company", "business", "organization"] },
    { key: "email", label: "Email", candidates: ["email", "email address", "email_address"] },
    { key: "phone", label: "Phone", candidates: ["phone", "phone number", "phone_number", "mobile"] },
    { key: "status", label: "Status", candidates: ["status", "stage"] },
    { key: "estimated_value", label: "Estimated value", candidates: ["estimated value", "estimated_value", "value", "deal value", "deal_value", "revenue"] },
    { key: "owner", label: "Owner", candidates: ["owner", "sales owner", "manager", "assigned"] },
    { key: "notes", label: "Notes", candidates: ["notes", "description", "comment", "comments"] }
  ],
  metrics: [
    { key: "metric_name", label: "Metric name", required: true, candidates: ["metric", "metric name", "metric_name", "name", "kpi", "measure"] },
    { key: "category", label: "Category", candidates: ["category", "type", "department"] },
    { key: "value", label: "Value", required: true, candidates: ["value", "actual", "actual value", "actual_value", "result", "amount", "total", "count"] },
    { key: "metric_date", label: "Date", candidates: ["date", "metric date", "metric_date", "day", "period"] },
    { key: "owner", label: "Owner", candidates: ["owner", "manager", "assigned"] },
    { key: "notes", label: "Notes", candidates: ["notes", "description", "comment", "comments"] }
  ]
};

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirectWithError(message: string): never {
  redirect(`${FILES_PATH}?error=${encodeURIComponent(message)}` as Route);
}

function redirectWithMessage(message: string, fileId?: string): never {
  redirect(`${FILES_PATH}?${fileId ? `file=${encodeURIComponent(fileId)}&` : ""}message=${encodeURIComponent(message)}` as Route);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function safeFileName(value: string) {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

  return cleaned || `upload-${Date.now()}`;
}

function validImportType(value: string): ImportType {
  if (value === "kpi" || value === "crm" || value === "metrics") {
    return value;
  }

  redirectWithError("Choose KPI data, CRM leads, or operational metrics before importing.");
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

  await requireActiveSubscription({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId: context.activeWorkspace.id
  });

  return {
    supabase,
    user,
    workspaceId: context.activeWorkspace.id
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
  const importLabel = importType === "kpi" ? "KPI history" : importType === "crm" ? "CRM leads" : "operational metrics";

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

function buildCrmLeadRecords(
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
          lead_name: mappedText(row, mapping, field("crm", "lead_name")),
          company: mappedText(row, mapping, field("crm", "company")),
          email: mappedText(row, mapping, field("crm", "email")),
          phone: mappedText(row, mapping, field("crm", "phone")),
          status: mappedText(row, mapping, field("crm", "status"), "New"),
          estimated_value: mappedNumber(row, mapping, field("crm", "estimated_value")),
          owner: mappedText(row, mapping, field("crm", "owner")),
          notes: mappedText(row, mapping, field("crm", "notes")),
          raw_data_json: rowJson(row),
          last_activity_at: new Date().toISOString(),
          created_by: userId
        }
      };
    })
    .filter(({ record }) => record.lead_name);
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
          category: mappedText(row, mapping, field("metrics", "category"), "Operations"),
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

async function saveCrmLeadRows({
  supabase,
  rows,
  workspaceId,
  userId,
  sourceFile,
  importId
}: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  rows: ReturnType<typeof buildCrmLeadRecords>;
  workspaceId: string;
  userId: string;
  sourceFile: FileUploadRow;
  importId: string;
}) {
  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  let savedCount = 0;

  for (const row of rows) {
    const email = row.record.email.trim();
    let existingLeadId: string | null = null;

    if (email) {
      const { data, error } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("email", email)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      existingLeadId = data?.id ?? null;
    }

    if (!existingLeadId && row.record.company) {
      const { data, error } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("lead_name", row.record.lead_name)
        .eq("company", row.record.company)
        .is("deleted_at", null)
        .maybeSingle();

      if (error) {
        throw new Error(error.message);
      }

      existingLeadId = data?.id ?? null;
    }

    const eventType = existingLeadId ? "updated" : "created";
    const leadResult = existingLeadId
      ? await supabase
          .from("crm_leads")
          .update({
            source_file_id: sourceFile.id,
            import_id: importId,
            import_row_id: row.importRowId,
            lead_name: row.record.lead_name,
            company: row.record.company || null,
            email: row.record.email || null,
            phone: row.record.phone || null,
            status: row.record.status || "New",
            estimated_value: row.record.estimated_value,
            owner: row.record.owner || null,
            notes: row.record.notes || null,
            raw_data_json: row.record.raw_data_json,
            last_activity_at: row.record.last_activity_at
          })
          .eq("id", existingLeadId)
          .eq("workspace_id", workspaceId)
          .select("id")
          .single()
      : await supabase
          .from("crm_leads")
          .insert(row.record)
          .select("id")
          .single();

    if (leadResult.error || !leadResult.data) {
      throw new Error(leadResult.error?.message || "CRM lead could not be saved.");
    }

    const { error: historyError } = await supabase.from("crm_lead_history").insert({
      workspace_id: workspaceId,
      lead_id: leadResult.data.id,
      source_file_id: sourceFile.id,
      import_id: importId,
      import_row_id: row.importRowId,
      event_type: eventType,
      status: row.record.status || "New",
      estimated_value: row.record.estimated_value,
      owner: row.record.owner || null,
      notes: row.record.notes || null,
      raw_data_json: row.record.raw_data_json,
      created_by: userId
    });

    if (historyError) {
      throw new Error(historyError.message);
    }

    savedCount += 1;
  }

  return savedCount;
}

function summarizeVaeroexOutput(outputJson: Json) {
  const output = isRecord(outputJson) ? outputJson : {};
  const summary = str(output.executive_summary) || str(output.summary) || str(output.response_markdown);

  if (summary) {
    return summary.replace(/^#+\s*/gm, "").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 4).join("\n");
  }

  const problems = asArray(output.problems_identified).map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  return problems.slice(0, 4).join("\n") || "Vaeroex completed the spreadsheet analysis.";
}

function fileReportBody({
  file,
  importRows,
  analysisSummary,
  prompt
}: {
  file: FileUploadRow;
  importRows: Array<Pick<Database["public"]["Tables"]["file_imports"]["Row"], "import_type" | "status" | "rows_total" | "rows_imported" | "extraction_summary" | "created_at" | "imported_at">>;
  analysisSummary: string | null;
  prompt?: string;
}) {
  const imports = importRows.length
    ? importRows
        .map((item) => `- ${item.import_type}: ${item.rows_imported} of ${item.rows_total} rows saved (${item.status})`)
        .join("\n")
    : "- No imports have been saved from this file yet.";

  return `# File Report - ${file.display_name}

## Executive Summary
${analysisSummary || "This file is stored in Vaeroex and is ready for review, analysis, import, or attachment to an operations report."}

## File Details
- Original name: ${file.original_name}
- File type: ${file.file_extension.toUpperCase()}
- Import status: ${file.import_status.replace(/_/g, " ")}
- Imported rows: ${file.imported_rows}
- Uploaded: ${file.created_at}

## Analysis Question
${prompt || file.analysis_prompt || "No specific file question was provided."}

## Import History
${imports}

## Recommended Next Actions
- Review file mappings before saving spreadsheet data into KPIs, CRM leads, or operational metrics.
- Use the saved analysis and imported history in the next management report.
- Confirm any Vaeroex recommendations before creating or changing operational records.`;
}

export async function uploadFileAction(formData: FormData) {
  const { supabase, user, workspaceId } = await requireWorkspace();
  const uploadedFile = formData.get("file");

  if (!(uploadedFile instanceof File) || uploadedFile.size === 0) {
    redirectWithError("Choose a file to upload.");
  }

  if (uploadedFile.size > MAX_FILE_SIZE_BYTES) {
    redirectWithError("Files must be 25 MB or smaller.");
  }

  const extension = fileExtension(uploadedFile.name);

  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    redirectWithError("Supported file types are CSV, XLSX, PDF, PNG, JPG, and DOCX.");
  }

  const folderId = await validateFolder(workspaceId, text(formData, "folder_id"));
  const buffer = Buffer.from(await uploadedFile.arrayBuffer());
  const safeName = safeFileName(uploadedFile.name);
  const storagePath = `${workspaceId}/${randomUUID()}/${safeName}`;
  const mimeType = uploadedFile.type || MIME_BY_EXTENSION[extension] || "application/octet-stream";
  const upload = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: false
  });

  if (upload.error) {
    redirectWithError(upload.error.message);
  }

  const displayName = text(formData, "display_name") || uploadedFile.name;
  const { data, error } = await supabase
    .from("file_uploads")
    .insert({
      workspace_id: workspaceId,
      folder_id: folderId,
      original_name: uploadedFile.name,
      display_name: displayName,
      file_extension: extension === "jpeg" ? "jpg" : extension,
      mime_type: mimeType,
      file_size_bytes: uploadedFile.size,
      storage_bucket: STORAGE_BUCKET,
      storage_path: storagePath,
      import_status: extension === "csv" || extension === "xlsx" ? "ready" : "not_imported",
      metadata_json: {
        upload_method: "files_module",
        can_import: extension === "csv" || extension === "xlsx",
        supported_import_types: extension === "csv" || extension === "xlsx" ? ["kpi", "crm", "metrics"] : []
      },
      created_by: user.id
    })
    .select("id")
    .single();

  if (error || !data) {
    redirectWithError(error?.message || "File metadata could not be saved.");
  }

  revalidatePath(FILES_PATH);
  revalidatePath("/app/reports");
  redirectWithMessage("File uploaded.", data.id);
}

export async function importFileAction(formData: FormData) {
  const { supabase, user, workspaceId } = await requireWorkspace();
  const importType = validImportType(text(formData, "import_type"));
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);

  if (!isSpreadsheet(file)) {
    redirectWithError("Only CSV and XLSX files can be imported.");
  }

  const buffer = await downloadFileBuffer(file);
  let rows: ImportRow[] = [];

  try {
    rows = parseSpreadsheetRows({ fileName: file.original_name, buffer });
  } catch (error) {
    await supabase.from("file_uploads").update({ import_status: "failed" }).eq("id", file.id).eq("workspace_id", workspaceId);
    redirectWithError(error instanceof Error ? error.message : "The spreadsheet could not be read.");
  }

  if (!rows.length) {
    await supabase.from("file_uploads").update({ import_status: "failed" }).eq("id", file.id).eq("workspace_id", workspaceId);
    redirectWithError("No data rows were found. Make sure the first row contains column names.");
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
    redirectWithError(importError?.message || "Import record could not be created.");
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
    redirectWithError(importRowsResult.error.message);
  }

  await supabase
    .from("file_uploads")
    .update({
      import_type: importType,
      import_status: "extracted",
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
  redirectWithMessage("Data extracted. Review the mappings before saving records.", file.id);
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
  const { supabase, user, workspaceId } = await requireWorkspace();
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const importId = text(formData, "import_id");

  if (!importId) {
    redirectWithError("Choose an extracted import to save.");
  }

  const { data: importRecord, error: importError } = await supabase
    .from("file_imports")
    .select("*")
    .eq("id", importId)
    .eq("workspace_id", workspaceId)
    .eq("file_upload_id", file.id)
    .maybeSingle();

  if (importError || !importRecord) {
    redirectWithError(importError?.message || "Extraction not found for this workspace.");
  }

  const importType = validImportType(text(formData, "import_type") || importRecord.import_type);
  const mapping = mappingFromForm(formData, importType, importRecord.mapping_json);
  const { data: stagedRows, error: rowsError } = await supabase
    .from("file_import_rows")
    .select("id,data_json,row_number")
    .eq("workspace_id", workspaceId)
    .eq("file_upload_id", file.id)
    .eq("import_id", importId)
    .order("row_number", { ascending: true })
    .limit(1000);

  if (rowsError) {
    redirectWithError(rowsError.message);
  }

  if (!stagedRows?.length) {
    redirectWithError("No extracted rows were found to save.");
  }

  let importedRowCount = 0;

  try {
    if (importType === "kpi") {
      const targetRows = buildKpiRecords(stagedRows, workspaceId, user.id, file, importId, mapping);
      importedRowCount = targetRows.length;

      if (targetRows.length) {
        const { error } = await supabase.from("kpis").insert(targetRows.map((row) => row.record));

        if (error) {
          throw new Error(error.message);
        }
      }
    } else if (importType === "crm") {
      const targetRows = buildCrmLeadRecords(stagedRows, workspaceId, user.id, file, importId, mapping);
      importedRowCount = await saveCrmLeadRows({
        supabase,
        rows: targetRows,
        workspaceId,
        userId: user.id,
        sourceFile: file,
        importId
      });
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

    if (!importedRowCount) {
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

    await supabase
      .from("file_import_rows")
      .update({
        status: "imported"
      })
      .eq("workspace_id", workspaceId)
      .eq("import_id", importId);

    await supabase
      .from("file_imports")
      .update({
        status: "completed",
        rows_imported: importedRowCount,
        mapping_json: mapping,
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
        metadata_json: appendImportHistory(file.metadata_json, importEntry)
      })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Imported data could not be saved.";

    await supabase
      .from("file_imports")
      .update({ status: "failed", errors_json: [{ message }] })
      .eq("id", importId)
      .eq("workspace_id", workspaceId);

    await supabase.from("file_uploads").update({ import_status: "failed" }).eq("id", file.id).eq("workspace_id", workspaceId);
    redirectWithError(message);
  }

  revalidatePath(FILES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/kpis");
  revalidatePath("/app/reports");
  redirectWithMessage(`${importedRowCount} approved row${importedRowCount === 1 ? "" : "s"} saved to history.`, file.id);
}

export async function createReportFromFileAction(formData: FormData) {
  const { supabase, user, workspaceId } = await requireWorkspace();
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const reportTitle = text(formData, "report_title") || `File Report - ${file.display_name}`;
  const reportType = text(formData, "report_type") || "File Review";
  const reportFocus = text(formData, "report_focus");
  const { data: importRows, error: importError } = await supabase
    .from("file_imports")
    .select("import_type,status,rows_total,rows_imported,extraction_summary,created_at,imported_at")
    .eq("workspace_id", workspaceId)
    .eq("file_upload_id", file.id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (importError) {
    redirectWithError(importError.message);
  }

  const bodyMarkdown = fileReportBody({
    file,
    importRows: importRows || [],
    analysisSummary: file.analysis_summary,
    prompt: reportFocus
  });
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
      analysis_summary: file.analysis_summary,
      analysis_prompt: file.analysis_prompt,
      metadata_json: file.metadata_json
    },
    import_history: importRows || [],
    report_focus: reportFocus || null
  } satisfies Json;

  const { error } = await supabase.from("reports").insert({
    workspace_id: workspaceId,
    report_type: reportType,
    title: reportTitle,
    date_range_start: file.created_at.slice(0, 10),
    date_range_end: new Date().toISOString().slice(0, 10),
    body_markdown: bodyMarkdown,
    source_data_json: sourceData,
    created_by: user.id
  });

  if (error) {
    redirectWithError(error.message);
  }

  revalidatePath(FILES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/reports");
  redirectWithMessage("Report created from file.", file.id);
}

export async function attachFileToReportAction(formData: FormData) {
  const { supabase, workspaceId } = await requireWorkspace();
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const reportId = text(formData, "report_id");

  if (!reportId) {
    redirectWithError("Choose a report before attaching this file.");
  }

  const { data: report, error: reportError } = await supabase
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (reportError || !report) {
    redirectWithError(reportError?.message || "Report not found for this workspace.");
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
  const bodyNote = `\n\n## Attached File\n- ${file.display_name} (${file.file_extension.toUpperCase()})\n- Import status: ${file.import_status.replace(/_/g, " ")}\n- Imported rows: ${file.imported_rows}\n${file.analysis_summary ? `- Latest Vaeroex analysis: ${file.analysis_summary.split("\n")[0]}` : "- Latest Vaeroex analysis: Not completed yet."}`;

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
    redirectWithError(error.message);
  }

  revalidatePath(FILES_PATH);
  revalidatePath("/app");
  revalidatePath("/app/reports");
  redirectWithMessage("File attached to report.", file.id);
}

export async function analyzeFileAction(formData: FormData) {
  const { supabase, user, workspaceId } = await requireWorkspace();
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const prompt =
    text(formData, "suggested_prompt") ||
    text(formData, "analysis_prompt") ||
    "Review this spreadsheet and explain trends, useful KPIs, operational problems, and an executive summary.";

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
    let rows: ImportRow[] = [];
    let contentNote = "File content was not parsed. Vaeroex can review the file metadata, prior imports, saved analysis, and workspace context.";

    if (isSpreadsheet(file)) {
      const buffer = await downloadFileBuffer(file);
      rows = parseSpreadsheetRows({ fileName: file.original_name, buffer });
      contentNote = "Spreadsheet rows were parsed for preview and trend analysis.";
    }

    const [workspaceSnapshot, fileImports, fileReports] = await Promise.all([
      buildWorkspaceSnapshot(supabase, workspaceId),
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
        .limit(10)
    ]);
    const extraInputs = {
      file: {
        id: file.id,
        name: file.display_name,
        extension: file.file_extension,
        rows_detected: rows.length,
        metadata: file.metadata_json,
        analysis_summary: file.analysis_summary,
        content_note: contentNote
      },
      import_history: fileImports.data ?? [],
      related_reports: fileReports.data ?? [],
      spreadsheet_preview: rows.length ? previewRows(rows, 30) : []
    } satisfies Json;
    inputJson = {
      workflow: workflow.key,
      user_prompt: prompt,
      extra_inputs: extraInputs,
      workspace_snapshot: workspaceSnapshot
    } satisfies Json;

    const limit = await isUsageLimitReached({
      supabase,
      userId: user.id,
      email: user.email,
      workspaceId,
      limit: "ai_runs_this_month"
    });

    if (limit.reached) {
      throw new Error("You’ve reached the limit for your current Vaeroex Ops System plan.");
    }

    const outputJson = await runVaeroexCompletion({
      workflow,
      userPrompt: prompt,
      workspaceSnapshot,
      extraInputs
    });
    const summary = summarizeVaeroexOutput(outputJson);
    const { data, error } = await supabase
      .from("ai_agent_runs")
      .insert({
        workspace_id: workspaceId,
        agent_type: workflow.key,
        input_json: inputJson,
        output_json: outputJson,
        status: "completed",
        created_by: user.id
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new Error(error?.message || "Vaeroex analysis could not be saved.");
    }

    await supabase.from("ai_usage").insert({
      workspace_id: workspaceId,
      user_id: user.id,
      agent_type: workflow.key,
      tokens_used: 0,
      estimated_cost_cents: 0
    });

    await supabase
      .from("file_uploads")
      .update({
        analysis_prompt: prompt,
        analysis_summary: summary,
        metadata_json: {
          ...(isRecord(file.metadata_json) ? file.metadata_json : {}),
          latest_analysis_run_id: data.id,
          latest_analysis_at: new Date().toISOString(),
          latest_analysis_prompt: prompt
        } satisfies Json
      })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);

    revalidatePath(FILES_PATH);
    revalidatePath("/app");
    revalidatePath("/app/agents");
    revalidatePath("/app/reports");
    redirectWithMessage("Vaeroex file analysis completed.", file.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Vaeroex could not analyze the file.";

    await supabase.from("ai_agent_runs").insert({
      workspace_id: workspaceId,
      agent_type: workflow.key,
      input_json: inputJson,
      output_json: {} satisfies Json,
      status: "failed",
      error_message: message,
      created_by: user.id
    });

    revalidatePath(FILES_PATH);
    redirectWithError(message);
  }
}
