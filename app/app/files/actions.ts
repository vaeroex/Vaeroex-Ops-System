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
type ImportType = "kpi" | "crm" | "metrics";
type JsonRecord = Record<string, unknown>;

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

function cellText(row: ImportRow, candidates: string[], fallback = "") {
  const value = cell(row, candidates);
  return value === null || value === undefined ? fallback : String(value).trim();
}

function cellNumber(row: ImportRow, candidates: string[]) {
  const value = cell(row, candidates);

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number(String(value ?? "").replace(/[$,%\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function cellDate(row: ImportRow, candidates: string[]) {
  const value = cell(row, candidates);

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

function buildKpiRecords(rows: ImportRow[], workspaceId: string, userId: string, sourceFile: FileUploadRow) {
  return rows
    .map((row) => ({
      workspace_id: workspaceId,
      name: cellText(row, ["name", "kpi", "kpi name", "metric", "metric name", "metric_name"]),
      category: cellText(row, ["category", "type", "department"], "Imported"),
      target: cellNumber(row, ["target", "goal"]),
      actual_value: cellNumber(row, ["actual value", "actual_value", "actual", "value", "result", "amount", "total", "count"]),
      metric_date: cellDate(row, ["date", "metric date", "metric_date", "day", "period"]),
      owner: cellText(row, ["owner", "assigned", "manager"]),
      notes: cellText(row, ["notes", "description", "comment", "comments"]),
      source: cellText(row, ["source"], `Uploaded file: ${sourceFile.display_name}`),
      created_by: userId
    }))
    .filter((row) => row.name);
}

function buildCrmLeadRecords(rows: ImportRow[], workspaceId: string, userId: string, sourceFile: FileUploadRow) {
  return rows
    .map((row) => ({
      workspace_id: workspaceId,
      source_file_id: sourceFile.id,
      lead_name: cellText(row, ["lead", "lead name", "lead_name", "contact", "name", "customer", "client"]),
      company: cellText(row, ["company", "business", "organization"]),
      email: cellText(row, ["email", "email address", "email_address"]),
      phone: cellText(row, ["phone", "phone number", "phone_number", "mobile"]),
      status: cellText(row, ["status", "stage"], "New"),
      estimated_value: cellNumber(row, ["estimated value", "estimated_value", "value", "deal value", "deal_value", "revenue"]),
      owner: cellText(row, ["owner", "sales owner", "manager", "assigned"]),
      notes: cellText(row, ["notes", "description", "comment", "comments"]),
      raw_data_json: rowJson(row),
      created_by: userId
    }))
    .filter((row) => row.lead_name);
}

function buildOperationalMetricRecords(rows: ImportRow[], workspaceId: string, userId: string, sourceFile: FileUploadRow) {
  return rows
    .map((row) => ({
      workspace_id: workspaceId,
      source_file_id: sourceFile.id,
      metric_name: cellText(row, ["metric", "metric name", "metric_name", "name", "kpi", "measure"]),
      category: cellText(row, ["category", "type", "department"], "Operations"),
      value: cellNumber(row, ["value", "actual", "actual value", "actual_value", "result", "amount", "total", "count"]),
      metric_date: cellDate(row, ["date", "metric date", "metric_date", "day", "period"]),
      owner: cellText(row, ["owner", "manager", "assigned"]),
      notes: cellText(row, ["notes", "description", "comment", "comments"]),
      raw_data_json: rowJson(row),
      created_by: userId
    }))
    .filter((row) => row.metric_name);
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

  const { data: importRecord, error: importError } = await supabase
    .from("file_imports")
    .insert({
      workspace_id: workspaceId,
      file_upload_id: file.id,
      import_type: importType,
      rows_total: rows.length,
      rows_imported: 0,
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
    status: "imported"
  }));
  const importRowsResult = await supabase.from("file_import_rows").insert(importRows);

  if (importRowsResult.error) {
    redirectWithError(importRowsResult.error.message);
  }

  let importedRowCount = 0;
  let insertResult: { error: { message: string } | null };

  if (importType === "kpi") {
    const targetRows = buildKpiRecords(rows, workspaceId, user.id, file);
    importedRowCount = targetRows.length;
    insertResult = importedRowCount ? await supabase.from("kpis").insert(targetRows) : { error: null };
  } else if (importType === "crm") {
    const targetRows = buildCrmLeadRecords(rows, workspaceId, user.id, file);
    importedRowCount = targetRows.length;
    insertResult = importedRowCount ? await supabase.from("crm_leads").insert(targetRows) : { error: null };
  } else {
    const targetRows = buildOperationalMetricRecords(rows, workspaceId, user.id, file);
    importedRowCount = targetRows.length;
    insertResult = importedRowCount ? await supabase.from("operational_metrics").insert(targetRows) : { error: null };
  }

  if (!importedRowCount) {
    await supabase.from("file_imports").update({ status: "failed" }).eq("id", importRecord.id).eq("workspace_id", workspaceId);
    await supabase.from("file_uploads").update({ import_status: "failed" }).eq("id", file.id).eq("workspace_id", workspaceId);
    redirectWithError("No rows matched the selected import type. Check that the spreadsheet has recognizable column names.");
  }

  if (insertResult.error) {
    await supabase.from("file_imports").update({ status: "failed", errors_json: [{ message: insertResult.error.message }] }).eq("id", importRecord.id);
    await supabase.from("file_uploads").update({ import_status: "failed" }).eq("id", file.id).eq("workspace_id", workspaceId);
    redirectWithError(insertResult.error.message);
  }

  await supabase
    .from("file_imports")
    .update({ rows_imported: importedRowCount })
    .eq("id", importRecord.id)
    .eq("workspace_id", workspaceId);

  await supabase
    .from("file_uploads")
    .update({
      import_type: importType,
      import_status: "imported",
      imported_rows: importedRowCount,
      metadata_json: {
        ...(isRecord(file.metadata_json) ? file.metadata_json : {}),
        last_import: {
          import_id: importRecord.id,
          import_type: importType,
          rows_total: rows.length,
          rows_imported: importedRowCount,
          imported_at: new Date().toISOString()
        },
        preview_rows: previewRows(rows, 5)
      } satisfies Json
    })
    .eq("id", file.id)
    .eq("workspace_id", workspaceId);

  revalidatePath(FILES_PATH);
  revalidatePath("/app/kpis");
  revalidatePath("/app/reports");
  redirectWithMessage(`${importedRowCount} row${importedRowCount === 1 ? "" : "s"} imported.`, file.id);
}

export async function analyzeFileAction(formData: FormData) {
  const { supabase, user, workspaceId } = await requireWorkspace();
  const file = await getFileForWorkspace(text(formData, "file_id"), workspaceId);
  const prompt =
    text(formData, "analysis_prompt") ||
    "Review this spreadsheet and explain trends, useful KPIs, operational problems, and an executive summary.";

  if (!isSpreadsheet(file)) {
    redirectWithError("Vaeroex can analyze CSV and XLSX files right now.");
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
    const buffer = await downloadFileBuffer(file);
    const rows = parseSpreadsheetRows({ fileName: file.original_name, buffer });
    const workspaceSnapshot = (await buildWorkspaceSnapshot(supabase, workspaceId)) as Json;
    const extraInputs = {
      file: {
        id: file.id,
        name: file.display_name,
        extension: file.file_extension,
        rows_detected: rows.length
      },
      spreadsheet_preview: previewRows(rows, 30)
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
          latest_analysis_at: new Date().toISOString()
        } satisfies Json
      })
      .eq("id", file.id)
      .eq("workspace_id", workspaceId);

    revalidatePath(FILES_PATH);
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
