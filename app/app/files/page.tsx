import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import {
  analyzeFileAction,
  attachFileToReportAction,
  createReportFromFileAction,
  importFileAction,
  saveFileAnalysisToMemoryAction,
  saveExtractedImportAction,
  uploadFileAction
} from "@/app/app/files/actions";
import { ContextualAskVaeroex } from "@/components/ai/ContextualAskVaeroex";
import { CopyVaeroexResultButton } from "@/components/ai/CopyVaeroexResultButton";
import { LegalSafetyNotice } from "@/components/legal/LegalSafetyNotice";
import { AnalysisProgressSubmit } from "@/components/operations/AnalysisProgressSubmit";
import { CompactSummaryChips } from "@/components/operations/CompactSummaryChips";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { cleanVaeroexErrorMessage } from "@/lib/ai/errors";
import { createFileAccessLinkMap, type FileAccessLinks } from "@/lib/files/storage-links";
import { generatedOutputHref } from "@/lib/intelligence/generated-output";
import { KPI_COLOR_PALETTE, kpiColorMayBeLowContrast } from "@/lib/kpis/settings";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type FilesPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
    file?: string;
    q?: string;
    folder?: string;
    status?: string;
    owner?: string;
    category?: string;
    sort?: string;
    view?: string;
    section?: string;
    panel?: string;
  }>;
};

type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type FileImportDataRow = Database["public"]["Tables"]["file_import_rows"]["Row"];
type FolderRow = Database["public"]["Tables"]["record_folders"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type ImportType = "kpi" | "crm" | "metrics";
type FilePanelKey = "analyze" | "ask" | "intelligence" | "evidence" | "reports" | "import" | "history" | "details";
type JsonRecord = Record<string, unknown>;

const DEFAULT_FILE_FOLDERS = ["KPI Files", "Reports", "SOPs", "CRM", "Business Memory"];
const IMPORT_TYPES = [
  { value: "kpi", label: "KPI data" },
  { value: "crm", label: "CRM leads" },
  { value: "metrics", label: "Business metrics" }
];
const FILE_PANELS: Array<{ key: FilePanelKey; label: string; description: string }> = [
  { key: "intelligence", label: "Intelligence", description: "Latest review, risks, opportunities, and recommendations." },
  { key: "evidence", label: "Evidence", description: "Source file, Business Memory status, and evidence context." },
  { key: "reports", label: "Reports", description: "Create or attach leadership reports." },
  { key: "import", label: "Import", description: "Review structured data before saving." },
  { key: "history", label: "History", description: "Past Vaeroex reviews for this file." },
  { key: "details", label: "Details", description: "File metadata and source links." }
];
const SUGGESTED_PROMPTS = [
  "What trends do you see?",
  "What KPIs should I track?",
  "What problems stand out?",
  "Create an executive summary.",
  "Create executive recommendations."
];
const ANALYSIS_PROGRESS_STEPS = ["Reading file", "Extracting content", "Sending to Vaeroex", "Preparing findings", "Saving review", "Done"];
const UPLOAD_PROGRESS_STEPS = ["Uploading file", "Saving securely", "Preparing source record", "Refreshing file list", "Complete"];
const KPI_IMPORT_CHART_TYPES = [
  { value: "line", label: "Line chart" },
  { value: "bar", label: "Bar chart" },
  { value: "mixed", label: "Mixed chart" }
];
const KPI_VALUE_FORMAT_OPTIONS = [
  { value: "", label: "Standard number" },
  { value: "currency", label: "Currency" },
  { value: "percentage", label: "Percentage" },
  { value: "duration", label: "Duration" },
  { value: "count", label: "Count" },
  { value: "decimal", label: "Decimal" }
];
const IMPORT_FIELDS: Record<ImportType, Array<{ key: string; label: string; required?: boolean }>> = {
  kpi: [
    { key: "name", label: "KPI name", required: true },
    { key: "category", label: "Category" },
    { key: "target", label: "Target" },
    { key: "actual_value", label: "Actual value", required: true },
    { key: "metric_date", label: "Date" },
    { key: "owner", label: "Owner" },
    { key: "notes", label: "Notes" },
    { key: "source", label: "Source" }
  ],
  crm: [
    { key: "lead_name", label: "Lead name", required: true },
    { key: "company", label: "Company" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "status", label: "Status" },
    { key: "estimated_value", label: "Estimated value" },
    { key: "owner", label: "Owner" },
    { key: "notes", label: "Notes" }
  ],
  metrics: [
    { key: "metric_name", label: "Metric name", required: true },
    { key: "category", label: "Category" },
    { key: "value", label: "Value", required: true },
    { key: "metric_date", label: "Date" },
    { key: "owner", label: "Owner" },
    { key: "notes", label: "Notes" }
  ]
};
const fileEditFields: ManagedRecordEditField[] = [
  { name: "display_name", label: "File name", required: true },
  { name: "import_type", label: "Import type", type: "select", options: ["none", "kpi", "crm", "metrics"] },
  { name: "analysis_summary", label: "Vaeroex review summary", type: "textarea", rows: 5 }
];

function cleanNoticeMessage(message: string | null | undefined, fallback: string) {
  const trimmed = (message || "").trim();

  if (!trimmed || trimmed === "NEXT_REDIRECT" || trimmed.includes("NEXT_REDIRECT;")) {
    return trimmed ? fallback : null;
  }

  return trimmed;
}

function SuccessNotice({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  const showKpiLink = message.toLowerCase().includes("kpi history");

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 md:flex-row md:items-center md:justify-between">
      <p>{message}</p>
      {showKpiLink ? (
        <Link href="/app/kpis" className="w-fit rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800">
          View KPIs
        </Link>
      ) : null}
    </div>
  );
}

function normalizeFilePanel(value?: string | null): FilePanelKey | null {
  if (
    value === "analyze" ||
    value === "ask" ||
    value === "intelligence" ||
    value === "evidence" ||
    value === "reports" ||
    value === "import" ||
    value === "history" ||
    value === "details"
  ) {
    return value;
  }

  return null;
}

function selectedFileRoute(fileId: string, panel?: FilePanelKey | null) {
  return (`/app/files?file=${fileId}${panel ? `&panel=${panel}` : ""}`) as Route;
}

function fileSizeLabel(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileStatusLabel(file: FileUploadRow) {
  const processingStatus = file.processing_status || "uploaded";

  if (file.deleted_at) return "Deleted";
  if (file.archived_at) return "Archived";
  if (processingStatus === "processing") return "Processing";
  if (processingStatus === "failed") return "Failed";
  if (processingStatus === "ready") return "Ready";
  if (file.import_status === "imported") return "Imported";
  if (file.import_status === "failed") return "Import failed";
  if (file.import_status === "extracted") return "Needs review";
  if (file.import_status === "ready") return "Ready to import";
  return "Uploaded";
}

function indexStatusLabel(file: FileUploadRow) {
  return indexStatusDetails(file).label;
}

function evidenceChunkText(count: number) {
  return `${count} evidence chunk${count === 1 ? "" : "s"}`;
}

function indexStatusDetails(file: FileUploadRow) {
  const status = file.index_status || "not_indexed";
  const chunkCount = file.indexed_chunk_count || 0;

  if (status === "ready") {
    return {
      label: "Indexed",
      subtext: `${evidenceChunkText(chunkCount)} stored for future intelligence.`,
      detail: "Available for future Vaeroex answers, recommendations, and briefings.",
      tone: "good"
    };
  }

  if (status === "processing") {
    return {
      label: "Indexing evidence...",
      subtext: "Vaeroex is preparing this file for Business Memory.",
      detail: "Indexing evidence...",
      tone: "info"
    };
  }

  if (status === "queued") {
    return {
      label: "Queued",
      subtext: "Vaeroex will index this file after processing.",
      detail: "Indexing evidence is queued.",
      tone: "info"
    };
  }

  if (status === "failed") {
    return {
      label: "Indexing failed",
      subtext: "Indexing failed. Retry indexing.",
      detail: file.index_error || "Retry indexing by running a new Vaeroex review for this file.",
      tone: "error"
    };
  }

  return {
    label: "Not indexed",
    subtext: "Not yet available in Business Memory.",
    detail: "Not yet available in Business Memory.",
    tone: "muted"
  };
}

function memoryStatusClass(tone: string) {
  if (tone === "good") return "border-emerald-400/35 bg-emerald-950/25 text-emerald-100";
  if (tone === "error") return "border-red-400/35 bg-red-950/25 text-red-100";
  if (tone === "info") return "border-cyan-400/35 bg-cyan-950/25 text-cyan-100";

  return "border-white/10 bg-slate-950/30 text-slate-200";
}

function isSpreadsheet(file: FileUploadRow) {
  return file.file_extension === "csv" || file.file_extension === "xlsx";
}

function isTextAnalyzableDocument(file: FileUploadRow) {
  return file.file_extension === "pdf" || file.file_extension === "docx";
}

function isImageFile(file: FileUploadRow) {
  return file.file_extension === "png" || file.file_extension === "jpg" || file.file_extension === "jpeg";
}

function canAnalyzeFile(file: FileUploadRow) {
  return isSpreadsheet(file) || isTextAnalyzableDocument(file) || isImageFile(file);
}

function fileSupportNotice(file: FileUploadRow) {
  if (isSpreadsheet(file)) {
    return {
      title: "Spreadsheet ready",
      body: "CSV and XLSX files can be reviewed, imported after approval, and used to create reports from parsed rows."
    };
  }

  if (file.file_extension === "pdf") {
    return {
      title: "PDF text extraction ready",
      body: "Vaeroex can review and report on text-based PDFs. If a PDF is scanned or image-only, Vaeroex will show a clear extraction error instead of creating an empty report."
    };
  }

  if (file.file_extension === "docx") {
    return {
      title: "DOCX text extraction ready",
      body: "Vaeroex can extract readable text from DOCX files for review and report creation."
    };
  }

  if (isImageFile(file)) {
    return {
      title: "Image OCR and review ready",
      body: "Vaeroex can review PNG and JPG files for readable text, visible issues, KPIs, risks, and executive recommendations."
    };
  }

  return {
    title: "Stored reference file",
    body: "This file can be stored and attached to reports, but content review is not available for this file type yet."
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function analysisLines(value: string | null) {
  return (value || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function importTypeLabel(value: string) {
  return IMPORT_TYPES.find((type) => type.value === value)?.label || value;
}

function importStatusLabel(value: string) {
  if (value === "needs_review" || value === "extracted") return "Needs review";
  if (value === "completed") return "Saved";
  if (value === "failed") return "Failed";
  if (value === "skipped_duplicate") return "Skipped duplicate";
  return value || "Staged";
}

function mappingValue(mappingJson: unknown, key: string) {
  if (!isRecord(mappingJson)) {
    return "";
  }

  const value = mappingJson[key];
  return typeof value === "string" ? value : "";
}

function kpiInterpretationValue(mappingJson: unknown, key: string, fallback = "") {
  if (!isRecord(mappingJson) || !isRecord(mappingJson.kpi_interpretation)) {
    return fallback;
  }

  const value = mappingJson.kpi_interpretation[key];
  return typeof value === "string" ? value : fallback;
}

function rowValues(row: FileImportDataRow) {
  return isRecord(row.data_json) ? row.data_json : {};
}

function columnsForRows(rows: FileImportDataRow[]) {
  return Array.from(
    new Set(
      rows.flatMap((row) => Object.keys(rowValues(row))).filter(Boolean)
    )
  );
}

function kpiMappingConfidence(importRecord: FileImportRow) {
  const nameColumn = mappingValue(importRecord.mapping_json, "name");
  const actualValueColumn = mappingValue(importRecord.mapping_json, "actual_value");
  const dateColumn = mappingValue(importRecord.mapping_json, "metric_date");
  const targetColumn = mappingValue(importRecord.mapping_json, "target");

  if (!nameColumn || !actualValueColumn) {
    return {
      label: "Cannot import",
      tone: "border-red-200 bg-red-50 text-red-700",
      help: "Choose a KPI name column and actual value column before saving approved data.",
      nameColumn,
      actualValueColumn,
      dateColumn,
      targetColumn
    };
  }

  if (!dateColumn || !targetColumn) {
    return {
      label: "Needs review",
      tone: "border-amber-200 bg-amber-50 text-amber-900",
      help: "Required fields were detected. Review optional date and target mappings before saving.",
      nameColumn,
      actualValueColumn,
      dateColumn,
      targetColumn
    };
  }

  return {
    label: "High confidence",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-800",
    help: "Required KPI fields and key optional fields were detected. Review the sample rows before saving.",
    nameColumn,
    actualValueColumn,
    dateColumn,
    targetColumn
  };
}

function DetectedColumnCard({ label, value, required = false }: { label: string; value: string; required?: boolean }) {
  const detected = Boolean(value);

  return (
    <div className={`rounded-lg border p-3 ${detected ? "border-line bg-white" : required ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>
      <p className="mt-1 text-sm font-semibold">{detected ? value : "Not detected"}</p>
    </div>
  );
}

function KpiImportInterpretationControls({ mappingJson }: { mappingJson: unknown }) {
  const color = kpiInterpretationValue(mappingJson, "color", "#10B981");
  const lowContrastColor = kpiColorMayBeLowContrast(color);
  const inputClass =
    "mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent focus:ring-2 focus:ring-vaeroex-accent/20";

  return (
    <div className="space-y-4 rounded-lg border border-vaeroex-blue/30 bg-slate-950 p-4 text-slate-100 shadow-sm shadow-blue-950/30">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-sm font-semibold">KPI interpretation settings</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            These settings shape charts, legends, and Vaeroex summaries after approval. Historical KPI values stay locked as imported records.
          </p>
        </div>
        <span className="w-fit rounded-full border border-cyan-400/30 bg-cyan-950/40 px-3 py-1 text-xs font-semibold text-cyan-100">
          Review before saving
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="block text-sm font-medium text-slate-200">
          Unit/type
          <input
            name="unit_type"
            defaultValue={kpiInterpretationValue(mappingJson, "unit_type")}
            placeholder="Revenue, percentage, count, hours"
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Display unit
          <input
            name="display_unit"
            defaultValue={kpiInterpretationValue(mappingJson, "display_unit")}
            placeholder="$, %, hours, leads"
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Value format
          <select name="value_format" defaultValue={kpiInterpretationValue(mappingJson, "value_format")} className={inputClass}>
            {KPI_VALUE_FORMAT_OPTIONS.map((option) => (
              <option key={option.value || "standard"} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm font-medium text-slate-200">
          X-axis label
          <input
            name="x_axis_label"
            defaultValue={kpiInterpretationValue(mappingJson, "x_axis_label", "Date")}
            placeholder="Date"
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Y-axis label
          <input
            name="y_axis_label"
            defaultValue={kpiInterpretationValue(mappingJson, "y_axis_label")}
            placeholder="Revenue, conversion rate, response time"
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-medium text-slate-200">
          Preferred chart
          <select name="preferred_chart_type" defaultValue={kpiInterpretationValue(mappingJson, "preferred_chart_type", "line")} className={inputClass}>
            {KPI_IMPORT_CHART_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="rounded-lg border border-white/10 bg-slate-900/70 p-3">
        <label className="block text-sm font-medium text-slate-200">
          KPI color
          <select name="color" defaultValue={color} className={inputClass}>
            {KPI_COLOR_PALETTE.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} ({option.value})
              </option>
            ))}
          </select>
        </label>
        <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-3 w-8 rounded-full" style={{ backgroundColor: color }} aria-hidden />
          <span>Auto-selected imports default to a high-contrast Vaeroex color. Deep Navy is kept only when selected intentionally.</span>
        </div>
        {lowContrastColor ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-950/40 p-3 text-xs leading-5 text-amber-100">
            Deep Navy can be low contrast on Pulsar surfaces. Use it only when this KPI has a strong visual reason to keep that historic/manual color.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function rowsForImport(rows: FileImportDataRow[], importId: string) {
  return rows.filter((row) => row.import_id === importId).sort((a, b) => a.row_number - b.row_number);
}

function importsForFile(imports: FileImportRow[], fileId: string) {
  return imports.filter((item) => item.file_upload_id === fileId);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function stringList(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => {
          if (typeof item === "string") {
            return item.trim();
          }

          if (isRecord(item)) {
            return (
              stringValue(item.title) ||
              stringValue(item.name) ||
              stringValue(item.metric) ||
              stringValue(item.action) ||
              stringValue(item.description) ||
              stringValue(item.recommendation) ||
              Object.values(item)
                .filter((value) => typeof value === "string" || typeof value === "number")
                .map(String)
                .join(" - ")
            );
          }

          return String(item || "").trim();
        })
        .filter(Boolean)
    : [];
}

function latestAnalysisResult(file: FileUploadRow) {
  if (!isRecord(file.metadata_json)) {
    return null;
  }

  const result = file.metadata_json.latest_analysis_output;
  return isRecord(result) ? result : null;
}

function parseStructuredText(value: unknown) {
  const text = stringValue(value);

  if (!text) {
    return null;
  }

  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fencedMatch?.[1] || text).trim();

  if (!candidate.startsWith("{") && !candidate.startsWith("[")) {
    return null;
  }

  try {
    const parsed = JSON.parse(candidate) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function displayAnalysisOutput(output: unknown) {
  const record = isRecord(output) ? output : {};
  const parsed = parseStructuredText(record.response_markdown) || parseStructuredText(record.summary);

  return parsed
    ? {
        ...record,
        ...parsed
      }
    : record;
}

function runFileId(run: VaeroexRunRow) {
  const input = isRecord(run.input_json) ? run.input_json : {};
  const extraInputs = isRecord(input.extra_inputs) ? input.extra_inputs : {};
  const file = isRecord(extraInputs.file) ? extraInputs.file : {};
  const id = file.id;

  return typeof id === "string" ? id : "";
}

function runQuestion(run: VaeroexRunRow, fallback = "Review this file and summarize the leadership implications.") {
  const input = isRecord(run.input_json) ? run.input_json : {};
  return stringValue(input.user_prompt, fallback);
}

function runSummary(run: VaeroexRunRow, fallback = "No summary was saved for this analysis.") {
  const output = displayAnalysisOutput(run.output_json);
  return (
    stringValue(output.executive_summary) ||
    stringValue(output.summary) ||
    stringValue(output.response_markdown) ||
    run.error_message ||
    fallback
  );
}

function latestAnalysisAt(file: FileUploadRow) {
  if (!isRecord(file.metadata_json)) {
    return file.analysis_summary ? file.processed_at || file.updated_at : null;
  }

  return stringValue(file.metadata_json.latest_analysis_at) || (file.analysis_summary ? file.processed_at || file.updated_at : null);
}

function analysisStatus(file: FileUploadRow, runs: VaeroexRunRow[]) {
  const latestRun = runs[0];

  if ((file.processing_status || "") === "processing") {
    return "Processing";
  }

  if ((file.processing_status || "") === "failed" || latestRun?.status === "failed") {
    return "Failed";
  }

  if (latestRun?.status === "completed" || file.analysis_summary || latestAnalysisResult(file)) {
    return "Completed";
  }

  if (file.import_status === "extracted" || file.import_status === "needs_review") {
    return "Needs review";
  }

  return "Not reviewed";
}

function fileListStatus(file: FileUploadRow, runs: VaeroexRunRow[]) {
  if (file.deleted_at) return "Deleted";
  if (file.archived_at) return "Archived";
  if ((file.processing_status || "") === "processing") return "Analyzing";
  if ((file.processing_status || "") === "failed" || file.import_status === "failed") return "Error";
  if (file.import_status === "extracted" || file.import_status === "needs_review") return "Pending Review";
  if (file.import_status === "imported") return "Imported";
  if (analysisStatus(file, runs) === "Completed") return "Analyzed";
  if (isSpreadsheet(file) && file.import_status === "ready") return "Import Ready";
  return "Uploaded";
}

function reportsForFile(reports: ReportRow[], fileId: string) {
  return reports.filter((report) => {
    const source = isRecord(report.source_data_json) ? report.source_data_json : {};
    const file = isRecord(source.file) ? source.file : {};
    const attachedFiles = Array.isArray(source.attached_files) ? source.attached_files.filter(isRecord) : [];

    return file.id === fileId || attachedFiles.some((item) => isRecord(item) && item.id === fileId);
  });
}

function folderName(folders: Pick<FolderRow, "id" | "name">[], folderId: string | null) {
  return folders.find((folder) => folder.id === folderId)?.name || "Unfiled";
}

function combineLists(output: JsonRecord, keys: string[]) {
  return Array.from(new Set(keys.flatMap((key) => stringList(output[key])))).slice(0, 8);
}

function cleanAnalysisSections(result: JsonRecord | null, fallbackSummary?: string | null) {
  const output = result ? displayAnalysisOutput(result) : {};
  const executiveSummary =
    stringValue(output.executive_summary) ||
    stringValue(output.summary) ||
    stringValue(output.response_markdown) ||
    stringValue(fallbackSummary) ||
    "";

  return {
    executiveSummary,
    findings: combineLists(output, ["key_findings", "extracted_findings", "findings", "problems_identified"]),
    kpis: combineLists(output, ["kpis_detected", "kpis_found", "recommended_kpis", "suggested_metrics", "suggested_kpi_records"]),
    risks: combineLists(output, ["operational_risks", "risks"]),
    opportunities: combineLists(output, ["opportunities", "business_opportunities", "recommended_opportunities"]),
    actions: combineLists(output, ["recommended_actions", "next_actions", "action_items"]),
    tasks: combineLists(output, ["suggested_tasks", "follow_up_tasks", "tasks"]),
    reports: combineLists(output, ["suggested_reports", "reports", "recommended_reports"]),
    kpiRecords: combineLists(output, ["suggested_kpi_records", "kpi_records", "recommended_kpis"]),
    crmRecords: combineLists(output, ["suggested_crm_records", "crm_records", "crm_leads", "suggested_leads"])
  };
}

function analysisInsightCount(result: JsonRecord | null) {
  const sections = cleanAnalysisSections(result);
  return [
    ...sections.findings,
    ...sections.kpis,
    ...sections.risks,
    ...sections.opportunities,
    ...sections.actions,
    ...sections.reports,
    ...sections.kpiRecords
  ].length;
}

function AnalysisSection({ id, title, items, empty }: { id?: string; title: string; items: string[]; empty: string }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-lg border border-line bg-slate-50 p-4">
      <h5 className="text-sm font-semibold text-ink">{title}</h5>
      <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
        {items.length ? (
          items.map((item, index) => (
            <div key={`${title}-${index}-${item}`} className="flex gap-2">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-vaeroex-blue" />
              <p>{item}</p>
            </div>
          ))
        ) : (
          <p className="text-muted">{empty}</p>
        )}
      </div>
    </section>
  );
}

function analysisConfidence({
  file,
  latestRun,
  result,
  insightCount
}: {
  file: FileUploadRow;
  latestRun?: VaeroexRunRow | null;
  result: JsonRecord | null;
  insightCount: number;
}) {
  const output = result ? displayAnalysisOutput(result) : {};
  const rawConfidence = output.confidence || output.confidence_level || output.confidence_score || output.confidenceScore;
  const rawReason =
    stringValue(output.confidence_reason) ||
    stringValue(output.confidence_explanation) ||
    stringValue(output.limitations);
  const normalized = typeof rawConfidence === "string" ? rawConfidence.toLowerCase() : "";
  const numericConfidence = typeof rawConfidence === "number" ? rawConfidence : Number.parseFloat(String(rawConfidence || ""));
  const indexedChunks = file.indexed_chunk_count || 0;
  const hasIndexedEvidence = file.index_status === "ready" && indexedChunks > 0;

  if (normalized.includes("high") || numericConfidence >= 75) {
    return {
      label: "High",
      reason: rawReason || (hasIndexedEvidence ? "Supported by indexed Business Memory evidence." : "Based on uploaded file evidence only.")
    };
  }

  if (normalized.includes("medium") || normalized.includes("partial") || (numericConfidence >= 45 && numericConfidence < 75)) {
    return {
      label: "Medium",
      reason: rawReason || (hasIndexedEvidence ? "Supported by indexed Business Memory evidence." : "Based on uploaded file evidence only.")
    };
  }

  if (normalized.includes("low") || normalized.includes("limited") || (numericConfidence > 0 && numericConfidence < 45)) {
    return {
      label: "Low",
      reason: rawReason || "Limited historical context available."
    };
  }

  if (!result && latestRun?.status !== "completed") {
    return {
      label: "Developing",
      reason: "No completed Vaeroex review is available yet."
    };
  }

  if (hasIndexedEvidence && indexedChunks >= 4 && insightCount >= 4) {
    return {
      label: "High",
      reason: "Supported by indexed Business Memory evidence."
    };
  }

  if (hasIndexedEvidence || insightCount >= 3) {
    return {
      label: "Medium",
      reason: hasIndexedEvidence ? "Supported by indexed Business Memory evidence." : "Based on uploaded file evidence only."
    };
  }

  return {
    label: "Developing",
    reason: "Limited historical context available."
  };
}

function confidenceClass(label: string) {
  if (label === "High") return "border-emerald-400/35 bg-emerald-950/25 text-emerald-100";
  if (label === "Medium") return "border-cyan-400/35 bg-cyan-950/25 text-cyan-100";
  if (label === "Low") return "border-amber-400/35 bg-amber-950/25 text-amber-100";

  return "border-white/10 bg-slate-950/30 text-slate-200";
}

function fileAnalysisSnapshot(file: FileUploadRow, latestRun?: VaeroexRunRow | null) {
  const metadataResult = latestAnalysisResult(file);
  const runResult = latestRun?.status === "completed" ? displayAnalysisOutput(latestRun.output_json) : null;
  const result = metadataResult || runResult;
  const sections = cleanAnalysisSections(result, file.analysis_summary);
  const insightCount = analysisInsightCount(result);
  const analysisDate = latestAnalysisAt(file) || latestRun?.created_at || null;
  const confidence = analysisConfidence({ file, latestRun, result, insightCount });

  return {
    result,
    sections,
    insightCount,
    analysisDate,
    confidence
  };
}

function insightCategories(sections: ReturnType<typeof cleanAnalysisSections>) {
  return [
    { label: "Risks", count: sections.risks.length, href: "#analysis-risks" },
    { label: "Opportunities", count: sections.opportunities.length, href: "#analysis-opportunities" },
    { label: "KPI Suggestions", count: sections.kpis.length + sections.kpiRecords.length, href: "#analysis-kpis" },
    { label: "Recommendations", count: sections.actions.length, href: "#analysis-recommendations" }
  ];
}

function InsightCategoryLinks({ sections }: { sections: ReturnType<typeof cleanAnalysisSections> }) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {insightCategories(sections).map((category) => (
        <a
          key={category.label}
          href={category.href}
          className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
            category.count
              ? "border-vaeroex-accent/35 bg-white text-slate-800 hover:border-vaeroex-blue hover:text-vaeroex-blue"
              : "border-line bg-white/60 text-slate-400"
          }`}
        >
          {category.label}: <span className="font-bold">{category.count}</span>
        </a>
      ))}
    </div>
  );
}

function EvidenceUsedPanel({
  file,
  analysisDate
}: {
  file: FileUploadRow;
  analysisDate?: string | null;
}) {
  const memory = indexStatusDetails(file);
  const chunkCount = file.indexed_chunk_count || 0;

  return (
    <section className="mt-4 rounded-lg border border-line bg-white p-4">
      <h5 className="text-sm font-semibold text-ink">Evidence Used</h5>
      <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Source file</p>
          <p className="mt-1 break-words font-semibold text-ink">{file.display_name}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Business Memory</p>
          <p className="mt-1 font-semibold text-ink">{memory.label}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Evidence chunks</p>
          <p className="mt-1 font-semibold text-ink">{chunkCount}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Last analyzed</p>
          <p className="mt-1 font-semibold text-ink">{formatDateTime(analysisDate)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted">{memory.detail}</p>
    </section>
  );
}

function fileAskEvidence({
  file,
  sections,
  insightCount,
  confidence,
  analysisDate
}: {
  file: FileUploadRow;
  sections: ReturnType<typeof cleanAnalysisSections>;
  insightCount: number;
  confidence: ReturnType<typeof analysisConfidence>;
  analysisDate?: string | null;
}) {
  const memory = indexStatusDetails(file);

  return [
    `Source file: ${file.display_name}`,
    `File type: ${file.file_extension.toUpperCase()}`,
    `Business Memory status: ${memory.label}`,
    `Evidence chunks stored: ${file.indexed_chunk_count || 0}`,
    `Last analyzed: ${formatDateTime(analysisDate)}`,
    `Review confidence: ${confidence.label} - ${confidence.reason}`,
    `Insights found: ${insightCount}`,
    sections.executiveSummary ? `Executive summary: ${sections.executiveSummary}` : "",
    sections.risks.length ? `Risks: ${sections.risks.slice(0, 4).join("; ")}` : "Risks: none identified in the saved review.",
    sections.opportunities.length ? `Opportunities: ${sections.opportunities.slice(0, 4).join("; ")}` : "Opportunities: none identified in the saved review.",
    sections.kpis.length ? `KPI suggestions: ${sections.kpis.slice(0, 4).join("; ")}` : "KPI suggestions: none identified in the saved review.",
    sections.actions.length ? `Executive recommendations: ${sections.actions.slice(0, 4).join("; ")}` : "Executive recommendations: none identified in the saved review."
  ].filter(Boolean);
}

function FileContextualAskPanel({
  file,
  latestRun
}: {
  file: FileUploadRow;
  latestRun?: VaeroexRunRow | null;
}) {
  const metadataResult = latestAnalysisResult(file);
  const runResult = latestRun?.status === "completed" ? displayAnalysisOutput(latestRun.output_json) : null;
  const result = metadataResult || runResult;
  const sections = cleanAnalysisSections(result, file.analysis_summary);
  const insightCount = analysisInsightCount(result);
  const analysisDate = latestAnalysisAt(file) || latestRun?.created_at || null;
  const confidence = analysisConfidence({ file, latestRun, result, insightCount });
  const evidence = fileAskEvidence({ file, sections, insightCount, confidence, analysisDate });

  return (
    <section id="ask-about-file" className="rounded-lg border border-cyan-400/25 bg-cyan-950/20 p-4 text-cyan-50">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Ask about this file</p>
          <h4 className="mt-2 text-base font-semibold text-white">Ask Vaeroex About This File</h4>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Vaeroex will answer inline using this file’s evidence and relevant workspace Business Memory. If the evidence is limited, it should say so instead of guessing.
          </p>
        </div>
        <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(confidence.label)}`}>
          Confidence: {confidence.label}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {[
          "Summarize this file.",
          "What risks did this file reveal?",
          "What opportunities did this file reveal?",
          "What KPIs should leadership monitor?",
          "What information is missing?",
          "What should leadership review next?"
        ].map((prompt) => (
          <span key={prompt} className="rounded-full border border-cyan-300/20 bg-slate-950/35 px-3 py-1.5 text-xs font-semibold text-cyan-100">
            {prompt}
          </span>
        ))}
      </div>
      <div className="mt-4">
        <ContextualAskVaeroex
          label="Ask Vaeroex About This File"
          prompt={`Answer a leadership question about ${file.display_name}. Use only this file evidence and relevant workspace Business Memory. Cover summary, risks, opportunities, KPI suggestions, missing information, and what leadership should review next. Do not create assignments, CRM records, tasks, distribution schedules, or team workflow.`}
          contextType="file"
          contextId={file.id}
          sourceTitle={`File - ${file.display_name}`}
          sourceSummary={sections.executiveSummary || file.analysis_summary || "No completed Vaeroex review is available for this file yet."}
          evidence={evidence}
          compact
        />
      </div>
    </section>
  );
}

function analysisEvidenceForActions(file: FileUploadRow, sections: ReturnType<typeof cleanAnalysisSections>, insightCount: number) {
  return [
    `Source file: ${file.display_name}`,
    `File type: ${file.file_extension.toUpperCase()}`,
    `Insights found: ${insightCount}`,
    sections.executiveSummary ? `Executive summary: ${sections.executiveSummary}` : "",
    ...sections.findings.slice(0, 4).map((item) => `Finding: ${item}`),
    ...sections.risks.slice(0, 3).map((item) => `Risk: ${item}`),
    ...sections.opportunities.slice(0, 3).map((item) => `Opportunity: ${item}`),
    ...sections.kpis.slice(0, 3).map((item) => `KPI detected: ${item}`)
  ].filter(Boolean);
}

function executiveSummaryText(file: FileUploadRow, sections: ReturnType<typeof cleanAnalysisSections>, insightCount: number) {
  return [
    `Vaeroex analysis: ${file.display_name}`,
    "",
    sections.executiveSummary || "Vaeroex completed this file analysis, but no concise executive summary was saved.",
    "",
    `Insights found: ${insightCount}`,
    sections.findings.length ? `Key findings: ${sections.findings.slice(0, 3).join("; ")}` : "",
    sections.risks.length ? `Risks: ${sections.risks.slice(0, 3).join("; ")}` : "",
    sections.opportunities.length ? `Opportunities: ${sections.opportunities.slice(0, 3).join("; ")}` : "",
    sections.actions.length ? `Executive recommendations: ${sections.actions.slice(0, 3).join("; ")}` : ""
  ].filter(Boolean).join("\n");
}

function FileAnalysisActions({
  file,
  latestRun,
  sections,
  insightCount
}: {
  file: FileUploadRow;
  latestRun?: VaeroexRunRow | null;
  sections: ReturnType<typeof cleanAnalysisSections>;
  insightCount: number;
}) {
  const summary = executiveSummaryText(file, sections, insightCount);
  const evidence = analysisEvidenceForActions(file, sections, insightCount);
  const title = `File analysis - ${file.display_name}`;
  const executiveBriefHref = generatedOutputHref({
    type: "executive_briefing",
    title: `Executive brief - ${file.display_name}`,
    summary: sections.executiveSummary || summary,
    why: sections.findings.slice(0, 4).join("; ") || "Vaeroex analyzed this source file for leadership context.",
    remedy: sections.actions[0] || "Review the evidence and decide whether leadership should preserve this analysis for future briefings.",
    run: latestRun?.id
  });
  const meetingBriefHref = generatedOutputHref({
    type: "meeting_agenda",
    title: `Meeting brief - ${file.display_name}`,
    summary: sections.executiveSummary || summary,
    why: [
      sections.findings.length ? `Findings: ${sections.findings.slice(0, 4).join("; ")}` : "",
      sections.risks.length ? `Risks: ${sections.risks.slice(0, 4).join("; ")}` : "",
      sections.opportunities.length ? `Opportunities: ${sections.opportunities.slice(0, 4).join("; ")}` : ""
    ].filter(Boolean).join("\n"),
    remedy: "Use this meeting brief to guide leadership discussion, not to assign workflow inside Vaeroex.",
    run: latestRun?.id
  });

  return (
    <section className="mt-4 rounded-lg border border-cyan-400/25 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">Analysis Actions</p>
          <h4 className="mt-2 text-base font-semibold text-white">What would you like to do with this intelligence?</h4>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Preserve, export, copy, or review the intelligence Vaeroex generated. These actions support leadership decision-making and do not create assignments, notifications, CRM records, or internal workflows.
          </p>
        </div>
        <StatusBadge value="Leadership intelligence" />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <form action={saveFileAnalysisToMemoryAction}>
          <input type="hidden" name="file_id" value={file.id} />
          <input type="hidden" name="run_id" value={latestRun?.id || ""} />
          <input type="hidden" name="summary" value={sections.executiveSummary || summary} />
          <input type="hidden" name="confidence" value={insightCount >= 6 ? "High" : insightCount >= 3 ? "Medium" : "Limited"} />
          <input type="hidden" name="evidence" value={evidence.join("\n")} />
          <PendingSubmitButton pendingLabel="Saving analysis..." className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-blue-950/70 hover:ring-1 hover:ring-vaeroex-accent/45">
            Save Analysis
          </PendingSubmitButton>
        </form>
        <Link href={executiveBriefHref} className="rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-200 hover:bg-cyan-400/20">
          Export Executive Brief (PDF)
        </Link>
        <CopyVaeroexResultButton
          text={summary}
          label="Copy Executive Summary"
          copiedLabel="Executive summary copied."
          className="rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-200 hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50"
        />
        <Link href={meetingBriefHref} className="rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-200 hover:bg-cyan-400/20">
          Generate Meeting Brief
        </Link>
      </div>

      <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/35 p-3">
        <ContextualAskVaeroex
          label="Ask Vaeroex About This File"
          prompt="Explain this file analysis for leadership. Focus on what happened, why it matters, evidence, confidence, data limitations, and the one leadership discussion this should trigger."
          contextType="file_analysis"
          contextId={latestRun?.id || file.id}
          sourceTitle={title}
          sourceSummary={sections.executiveSummary || summary}
          evidence={evidence}
          compact
        />
      </div>
    </section>
  );
}

function FileAnalysisResult({
  file,
  latestRun
}: {
  file: FileUploadRow;
  latestRun?: VaeroexRunRow | null;
}) {
  const metadataResult = latestAnalysisResult(file);
  const runResult = latestRun?.status === "completed" ? displayAnalysisOutput(latestRun.output_json) : null;
  const result = metadataResult || runResult;
  const sections = cleanAnalysisSections(result, file.analysis_summary);
  const insightCount = analysisInsightCount(result);
  const analysisDate = latestAnalysisAt(file) || latestRun?.created_at || null;
  const confidence = analysisConfidence({ file, latestRun, result, insightCount });

  if (!result && !file.processing_error && latestRun?.status !== "failed") {
    return (
      <section id="analysis-result" className="rounded-lg border border-dashed border-line bg-white p-4">
        <p className="text-sm font-semibold text-ink">No file review yet</p>
        <p className="mt-2 text-sm leading-6 text-muted">
          Analyze this selected file to see Vaeroex findings, KPIs, risks, opportunities, and executive recommendations here.
        </p>
      </section>
    );
  }

  if (file.processing_error || latestRun?.status === "failed") {
    return (
      <section id="analysis-result" className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-semibold text-red-900">Analysis failed</p>
        <p className="mt-2 text-sm leading-6 text-red-800">
          {file.processing_error || latestRun?.error_message || "Vaeroex could not analyze this file. Try a clearer file or a CSV/XLSX export."}
        </p>
      </section>
    );
  }

  return (
    <section id="analysis-result" className="rounded-lg border border-vaeroex-accent/40 bg-white p-4 shadow-panel">
      <div className="rounded-lg border border-vaeroex-accent/40 bg-vaeroex-soft p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Latest Vaeroex review</p>
            <h4 className="mt-2 text-base font-semibold text-ink">
              {insightCount
                ? `Vaeroex found ${insightCount} insight${insightCount === 1 ? "" : "s"}`
                : "Vaeroex completed the review"}
            </h4>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {sections.executiveSummary ||
                "Vaeroex could not find enough readable business data in this file to generate a useful review."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(confidence.label)}`}>
                Confidence: {confidence.label}
              </span>
              <span className="text-xs leading-5 text-muted">{confidence.reason}</span>
            </div>
          </div>
          <StatusBadge value="Completed" />
        </div>
        <InsightCategoryLinks sections={sections} />
        <p className="mt-3 text-xs leading-5 text-muted">
          Source file: {file.display_name} · Review date: {formatDateTime(analysisDate)} · Status: {fileStatusLabel(file)}
        </p>
      </div>
      <EvidenceUsedPanel file={file} analysisDate={analysisDate} />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AnalysisSection id="analysis-findings" title="Key Findings" items={sections.findings} empty="No specific findings were saved from this analysis." />
        <AnalysisSection id="analysis-kpis" title="KPIs Detected" items={sections.kpis} empty="No KPI suggestions were found yet." />
        <AnalysisSection id="analysis-risks" title="Risks" items={sections.risks} empty="No clear risks were identified." />
        <AnalysisSection id="analysis-opportunities" title="Opportunities" items={sections.opportunities} empty="No clear opportunities were identified." />
        <AnalysisSection id="analysis-recommendations" title="Executive Recommendations" items={sections.actions} empty="No executive recommendations were returned." />
        <AnalysisSection title="Possible Leadership Documents" items={sections.reports} empty="No additional leadership documents were suggested." />
        <AnalysisSection id="analysis-kpi-records" title="Suggested KPI Records" items={sections.kpiRecords} empty="No KPI records were suggested." />
      </div>
      <FileAnalysisActions file={file} latestRun={latestRun} sections={sections} insightCount={insightCount} />
    </section>
  );
}

function reportLabel(report: Pick<ReportRow, "title" | "report_type" | "created_at">) {
  return `${report.title} · ${report.report_type} · ${formatDate(report.created_at)}`;
}

function ActionButton({
  children,
  tone = "default",
  disabled = false,
  pendingLabel = "Working..."
}: {
  children: ReactNode;
  tone?: "default" | "primary";
  disabled?: boolean;
  pendingLabel?: string;
}) {
  const classes =
    tone === "primary"
      ? "rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      : "rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-accent disabled:cursor-not-allowed disabled:opacity-50";

  return <PendingSubmitButton disabled={disabled} className={classes} pendingLabel={pendingLabel}>{children}</PendingSubmitButton>;
}

function ProgressActionButton({
  children,
  pendingLabel,
  tone = "primary"
}: {
  children: ReactNode;
  pendingLabel: string;
  tone?: "default" | "primary";
}) {
  const className =
    tone === "primary"
      ? "rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      : "rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-accent disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <AnalysisProgressSubmit className={className} pendingLabel={pendingLabel} steps={ANALYSIS_PROGRESS_STEPS}>
      {children}
    </AnalysisProgressSubmit>
  );
}

function CompactActionButton({
  children,
  pendingLabel = "Working..."
}: {
  children: ReactNode;
  pendingLabel?: string;
}) {
  return (
    <PendingSubmitButton
      className="rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-vaeroex-accent disabled:cursor-not-allowed disabled:opacity-50"
      pendingLabel={pendingLabel}
    >
      {children}
    </PendingSubmitButton>
  );
}

function CompactProgressActionButton({
  children,
  pendingLabel
}: {
  children: ReactNode;
  pendingLabel: string;
}) {
  return (
    <AnalysisProgressSubmit
      className="rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-vaeroex-accent disabled:cursor-not-allowed disabled:opacity-50"
      pendingLabel={pendingLabel}
      steps={ANALYSIS_PROGRESS_STEPS}
    >
      {children}
    </AnalysisProgressSubmit>
  );
}

function ImportActionForm({ file, importType, label }: { file: FileUploadRow; importType: ImportType; label: string }) {
  const canImport = isSpreadsheet(file);

  if (!canImport) {
    return null;
  }

  return (
    <form action={importFileAction}>
      <input type="hidden" name="file_id" value={file.id} />
      <input type="hidden" name="import_type" value={importType} />
      <ActionButton pendingLabel={importType === "kpi" ? "Preparing review..." : "Importing..."}>{label}</ActionButton>
    </form>
  );
}

function FileSourceActions({
  file,
  access,
  compact = false
}: {
  file: FileUploadRow;
  access?: FileAccessLinks | null;
  compact?: boolean;
}) {
  if (!access?.viewUrl && !access?.downloadUrl) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
        {access?.error || "Original file access is unavailable. Try refreshing the page or uploading the file again."}
      </p>
    );
  }

  const buttonClass = compact
    ? "rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-vaeroex-accent"
    : "rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-accent";

  return (
    <div className="flex flex-wrap gap-2">
      {access.viewUrl ? (
        <a href={access.viewUrl} target="_blank" rel="noreferrer" className={buttonClass}>
          View Original
        </a>
      ) : null}
      {access.downloadUrl ? (
        <a href={access.downloadUrl} download={file.original_name} className={buttonClass}>
          Download Source
        </a>
      ) : null}
    </div>
  );
}

function FileInlineActions({
  file,
  analysisRuns,
  access
}: {
  file: FileUploadRow;
  analysisRuns: VaeroexRunRow[];
  access?: FileAccessLinks | null;
}) {
  const canImport = isSpreadsheet(file);
  const canAnalyze = canAnalyzeFile(file);
  const latestStatus = analysisStatus(file, analysisRuns);
  const hasAnalysis = latestStatus === "Completed";

  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/app/files?file=${file.id}`} className="rounded-md bg-vaeroex-blue px-2.5 py-1.5 text-xs font-semibold text-white">
        Select
      </Link>
      <FileSourceActions file={file} access={access} compact />
      {canAnalyze ? (
        <form action={analyzeFileAction}>
          <input type="hidden" name="file_id" value={file.id} />
          <input
            type="hidden"
            name="analysis_prompt"
            value="What trends do you see? What KPIs should I track? What problems stand out? Create an executive summary and executive recommendations."
          />
          <CompactProgressActionButton pendingLabel="Analyzing...">Analyze</CompactProgressActionButton>
        </form>
      ) : null}
      {canImport ? (
        <form action={importFileAction}>
          <input type="hidden" name="file_id" value={file.id} />
          <input type="hidden" name="import_type" value="kpi" />
          <CompactActionButton pendingLabel="Preparing review...">Review KPI Import</CompactActionButton>
        </form>
      ) : null}
      {canAnalyze ? (
        <form action={createReportFromFileAction}>
          <input type="hidden" name="file_id" value={file.id} />
          <CompactProgressActionButton pendingLabel={hasAnalysis ? "Creating..." : "Analyzing..."}>{hasAnalysis ? "Create Report" : "Analyze + Report"}</CompactProgressActionButton>
        </form>
      ) : null}
    </div>
  );
}

function FileActionCenter({
  file,
  reports,
  analysisRuns = [],
  compact = false,
  access
}: {
  file: FileUploadRow;
  reports: ReportRow[];
  analysisRuns?: VaeroexRunRow[];
  compact?: boolean;
  access?: FileAccessLinks | null;
}) {
  const canImport = isSpreadsheet(file);
  const canAnalyze = canAnalyzeFile(file);
  const support = fileSupportNotice(file);
  const latestStatus = analysisStatus(file, analysisRuns);
  const hasCompletedAnalysis = latestStatus === "Completed";
  const memory = indexStatusDetails(file);

  if (compact) {
    return (
      <>
        <Link href={`/app/files?file=${file.id}`} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
          Select {file.display_name}
        </Link>
        <Link href={selectedFileRoute(file.id, "intelligence")} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-accent">
          View latest analysis
        </Link>
        <FileSourceActions file={file} access={access} />
      </>
    );
  }

  return (
    <div id={`file-${file.id}-actions`} className="space-y-5">
      <div className="rounded-lg border border-vaeroex-accent/40 bg-vaeroex-soft p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Selected File</p>
            <h3 className="mt-1 text-base font-semibold text-ink">{file.display_name}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Review {file.display_name}, stage imports for approval, create a report, attach it to an existing report, or inspect details.
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-700">{support.title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{support.body}</p>
            <div className="mt-3">
              <FileSourceActions file={file} access={access} />
            </div>
          </div>
          <span className="rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-slate-700">{fileStatusLabel(file)}</span>
        </div>
      </div>

      {canImport ? (
        <div className="rounded-lg border border-cyan-400/40 bg-cyan-950/70 p-4 text-cyan-50">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold">Vaeroex found structured data in this file.</p>
              <p className="mt-1 text-xs leading-5">
                You can import it as KPI data after review. Vaeroex will stage rows, suggest mappings, and wait for your approval before saving KPI history.
              </p>
            </div>
            <Link href="#file-import-actions" className="w-fit rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Review KPI Import
            </Link>
          </div>
        </div>
      ) : null}

      <section id="file-analysis-form" className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-ink">Analyze {file.display_name} with Vaeroex</h4>
            <p className="mt-1 text-xs leading-5 text-muted">
              Ask a question about this file. CSV/XLSX files use parsed rows, PDF/DOCX files use extracted readable text, and images use OCR plus visual context.
            </p>
          </div>
        </div>
        {canAnalyze ? (
          <form action={analyzeFileAction} className="mt-4 space-y-3">
            <input type="hidden" name="file_id" value={file.id} />
            <TextArea
              label="Question for Vaeroex"
              name="analysis_prompt"
              rows={4}
              defaultValue={file.analysis_prompt || "What trends do you see? What KPIs should I track? What problems stand out? Create an executive summary."}
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Suggested prompts</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    name="suggested_prompt"
                    value={prompt}
                    className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-vaeroex-accent"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
            <ProgressActionButton pendingLabel={`Analyzing ${file.display_name}...`}>Analyze {file.display_name}</ProgressActionButton>
          </form>
        ) : (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
            {support.body} Upload CSV/XLSX, text-based PDF/DOCX, PNG, or JPG files for review and report creation.
          </p>
        )}
      </section>

      <section id="file-import-actions" className="rounded-lg border border-line bg-white p-4">
        <h4 className="text-sm font-semibold text-ink">Import data from {file.display_name} after review</h4>
        <p className="mt-1 text-xs leading-5 text-muted">
          These actions extract rows and show a mapping review first. Nothing is saved to KPI, CRM, or business history until you approve it.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ImportActionForm file={file} importType="kpi" label="Review KPI Import" />
          <ImportActionForm file={file} importType="crm" label={`Import ${file.display_name} as CRM Leads`} />
          <ImportActionForm file={file} importType="metrics" label={`Import ${file.display_name} as Business Metrics`} />
        </div>
        {!canImport ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
            CSV and XLSX files can be imported into structured KPI, CRM, or business metric records. PDF, DOCX, PNG, and JPG files can still be reviewed, attached to reports, and organized in the file library.
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div id="file-report-actions" className="space-y-3 rounded-lg border border-line bg-white p-4">
          <h4 className="text-sm font-semibold text-ink">Create Report from {file.display_name}</h4>
          {canAnalyze ? (
            <div className="space-y-3">
              {!hasCompletedAnalysis ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  <p className="font-semibold">Analyze this file first?</p>
                  <p className="mt-1">
                    Vaeroex will extract readable content, prepare findings, then create the report from that review. If no useful content is found, no empty report will be created.
                  </p>
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
                  This report will use the saved Vaeroex review, extracted findings, risks, KPIs, and executive recommendations for {file.display_name}.
                </p>
              )}
              <form action={createReportFromFileAction} className="space-y-3">
                <input type="hidden" name="file_id" value={file.id} />
                <TextInput label="Report title" name="report_title" defaultValue={`File Report - ${file.display_name}`} />
                <TextInput label="Report type" name="report_type" defaultValue="File Review" />
                <TextArea label="Report focus" name="report_focus" rows={3} placeholder="Optional: what should this report focus on?" />
                <ProgressActionButton pendingLabel={`${hasCompletedAnalysis ? "Creating report" : "Analyzing and creating report"} from ${file.display_name}...`}>
                  {hasCompletedAnalysis ? `Create Report from ${file.display_name}` : "Analyze and create report"}
                </ProgressActionButton>
              </form>
            </div>
          ) : (
            <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
              {support.body} Vaeroex will not create a file-content report until it can read real file content.
            </p>
          )}
        </div>

        <form action={attachFileToReportAction} className="space-y-3 rounded-lg border border-line bg-white p-4">
          <input type="hidden" name="file_id" value={file.id} />
          <h4 className="text-sm font-semibold text-ink">Attach {file.display_name} to Existing Report</h4>
          <label className="block text-sm font-medium">
            Report
            <select
              name="report_id"
              required
              disabled={!reports.length}
              className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue disabled:bg-slate-50 disabled:text-muted"
            >
              <option value="">Choose report...</option>
              {reports.map((report) => (
                <option key={report.id} value={report.id}>
                  {reportLabel(report)}
                </option>
              ))}
            </select>
          </label>
          <ActionButton tone="primary" disabled={!reports.length} pendingLabel="Attaching file...">Attach to Existing Report</ActionButton>
          {!reports.length ? <p className="text-xs leading-5 text-muted">Create a report first, then attach files to it.</p> : null}
        </form>
      </section>

      <details id="file-details" className="rounded-lg border border-line bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">View File Details</summary>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Original name</p>
            <p className="mt-1 break-words text-ink">{file.original_name}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">File type</p>
            <p className="mt-1 text-ink">{file.file_extension.toUpperCase()}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Uploaded</p>
            <p className="mt-1 text-ink">{formatDate(file.created_at)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Size</p>
            <p className="mt-1 text-ink">{fileSizeLabel(file.file_size_bytes)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Import status</p>
            <p className="mt-1 text-ink">{fileStatusLabel(file)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Processing status</p>
            <p className="mt-1 text-ink">{(file.processing_status || "uploaded").replace(/_/g, " ")}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Business Memory Status</p>
            <p className="mt-1 font-semibold text-ink">{memory.label}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{memory.subtext}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Analysis status</p>
            <p className="mt-1 text-ink">{latestStatus}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Last analysis date</p>
            <p className="mt-1 text-ink">{formatDateTime(latestAnalysisAt(file) || analysisRuns[0]?.created_at || null)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Rows imported</p>
            <p className="mt-1 text-ink">{file.imported_rows}</p>
          </div>
        </div>
        {!canImport ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
            Rows imported stays at 0 for PDFs, documents, and images because structured imports currently support CSV/XLSX rows only. PDF/DOCX review uses extracted text, and image review uses OCR plus visual context.
          </p>
        ) : null}
      </details>
    </div>
  );
}

function SelectedFileBanner({
  file,
  folders,
  reports,
  analysisRuns,
  access
}: {
  file: FileUploadRow;
  folders: Pick<FolderRow, "id" | "name">[];
  reports: ReportRow[];
  analysisRuns: VaeroexRunRow[];
  access?: FileAccessLinks | null;
}) {
  const fileReports = reportsForFile(reports, file.id);
  const status = analysisStatus(file, analysisRuns);
  const latestDate = latestAnalysisAt(file) || analysisRuns[0]?.created_at || null;
  const memory = indexStatusDetails(file);

  return (
    <div className="rounded-lg border border-vaeroex-accent/40 bg-vaeroex-soft p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Selected File</p>
            <h3 className="mt-1 break-words text-base font-semibold text-ink">{file.display_name}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              This is the file Vaeroex will use for review, imports, reports, and attachments.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="#file-analysis-form" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              Analyze with Vaeroex
            </Link>
            <Link href="#file-import-actions" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-accent">
              Import data
            </Link>
            <Link href="#file-report-actions" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-accent">
              Create report
            </Link>
            <Link href="#ask-about-file" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-accent">
              Ask about file
            </Link>
            <Link href="#analysis-history" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-accent">
              View review history
            </Link>
            <Link href="#file-details" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-accent">
              View file details
            </Link>
            <Link href="/app/files" className="rounded-lg border border-line bg-white px-3 py-2 text-center text-sm font-semibold text-slate-700 hover:border-vaeroex-accent">
              Back to Files
            </Link>
          </div>
        </div>
        <FileSourceActions file={file} access={access} />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">File type</p>
            <p className="mt-1 text-sm font-semibold text-ink">{file.file_extension.toUpperCase()}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Upload date</p>
            <p className="mt-1 text-sm font-semibold text-ink">{formatDate(file.created_at)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Folder</p>
            <p className="mt-1 text-sm font-semibold text-ink">{folderName(folders, file.folder_id)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Processing status</p>
            <p className="mt-1 text-sm font-semibold text-ink">{fileStatusLabel(file)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Last review status</p>
            <p className="mt-1 text-sm font-semibold text-ink">{status}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Business Memory Status</p>
            <div className={`mt-1 rounded-lg border px-3 py-2 ${memoryStatusClass(memory.tone)}`}>
              <p className="text-sm font-semibold">{memory.label}</p>
              <p className="mt-1 text-xs leading-5 opacity-85">{memory.subtext}</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Last review date</p>
            <p className="mt-1 text-sm font-semibold text-ink">{formatDateTime(latestDate)}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Imported rows</p>
            <p className="mt-1 text-sm font-semibold text-ink">{file.imported_rows}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Reports from file</p>
            <p className="mt-1 text-sm font-semibold text-ink">{fileReports.length}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectedFileSummary({
  file,
  latestRun,
  analysisRuns,
  access,
  activePanel
}: {
  file: FileUploadRow;
  latestRun?: VaeroexRunRow | null;
  analysisRuns: VaeroexRunRow[];
  access?: FileAccessLinks | null;
  activePanel?: FilePanelKey | null;
}) {
  const memory = indexStatusDetails(file);
  const snapshot = fileAnalysisSnapshot(file, latestRun);
  const status = analysisStatus(file, analysisRuns);
  const actionClass = (panel: FilePanelKey, primary = false) =>
    `inline-flex min-h-11 items-center justify-center rounded-lg px-3 py-2 text-sm font-semibold transition ${
      activePanel === panel
        ? "border border-cyan-300/50 bg-cyan-400/15 text-cyan-50 shadow-sm shadow-cyan-950/30"
        : primary
          ? "bg-vaeroex-blue text-white hover:bg-cyan-500"
          : "border border-white/10 bg-white/[0.04] text-slate-100 hover:border-cyan-400/40 hover:bg-cyan-950/40"
    }`;

  return (
    <section className="rounded-xl border border-white/10 bg-[#08111f] p-4 shadow-panel">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Selected File</p>
          <h2 className="mt-2 break-words text-xl font-semibold text-white">{file.display_name}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-200">
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">{file.file_extension.toUpperCase()}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">{fileSizeLabel(file.file_size_bytes)}</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">{status}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <FileSourceActions file={file} access={access} compact />
          <Link href="/app/files" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:border-cyan-400/40 hover:bg-cyan-950/40">
            Back to Files
          </Link>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className={`rounded-lg border p-3 ${memoryStatusClass(memory.tone)}`}>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Business Memory Status</p>
          <p className="mt-1 text-sm font-semibold">{memory.label}</p>
          <p className="mt-1 text-xs leading-5 opacity-90">{memory.subtext}</p>
        </div>
        <div className={`rounded-lg border p-3 ${confidenceClass(snapshot.confidence.label)}`}>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Confidence</p>
          <p className="mt-1 text-sm font-semibold">{snapshot.confidence.label}</p>
          <p className="mt-1 text-xs leading-5 opacity-90">{snapshot.confidence.reason}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3 text-slate-100">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Last Analysis</p>
          <p className="mt-1 text-sm font-semibold text-white">{formatDateTime(snapshot.analysisDate)}</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">
            {snapshot.insightCount ? `${snapshot.insightCount} insights found.` : "No completed review yet."}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link href={selectedFileRoute(file.id, "analyze")} className={actionClass("analyze", true)}>
          Analyze
        </Link>
        <Link href={selectedFileRoute(file.id, "import")} className={actionClass("import")}>
          Import
        </Link>
        <Link href={selectedFileRoute(file.id, "intelligence")} className={actionClass("intelligence")}>
          View Intelligence
        </Link>
        <Link href={selectedFileRoute(file.id, "ask")} className={actionClass("ask")}>
          Ask Vaeroex
        </Link>
      </div>
    </section>
  );
}

function FilePanelNav({ file, activePanel }: { file: FileUploadRow; activePanel?: FilePanelKey | null }) {
  return (
    <nav className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/35 p-2" aria-label="Selected file panels">
      {FILE_PANELS.map((panel) => (
        <Link
          key={panel.key}
          href={selectedFileRoute(file.id, panel.key)}
          title={panel.description}
          className={`inline-flex min-h-10 shrink-0 items-center rounded-lg px-3 py-2 text-xs font-semibold transition ${
            activePanel === panel.key
              ? "bg-vaeroex-blue text-white shadow-sm shadow-blue-950/40"
              : "border border-white/10 bg-white/[0.04] text-slate-100 hover:border-cyan-400/40 hover:bg-cyan-950/35"
          }`}
        >
          {panel.label}
        </Link>
      ))}
    </nav>
  );
}

function FileAnalyzePanel({ file }: { file: FileUploadRow }) {
  const canAnalyze = canAnalyzeFile(file);
  const support = fileSupportNotice(file);

  return (
    <section className="rounded-xl border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Analyze</p>
          <h3 className="mt-2 text-lg font-semibold text-white">Analyze {file.display_name}</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Ask Vaeroex to review this file for leadership context. The result can be saved, copied, exported, or used in future Business Memory.
          </p>
        </div>
        <StatusBadge value={support.title} />
      </div>
      {canAnalyze ? (
        <form action={analyzeFileAction} className="mt-4 space-y-4">
          <input type="hidden" name="file_id" value={file.id} />
          <TextArea
            label="Question for Vaeroex"
            name="analysis_prompt"
            rows={4}
            defaultValue={file.analysis_prompt || "What trends do you see? What KPIs should I track? What problems stand out? Create an executive summary."}
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Suggested prompts</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  name="suggested_prompt"
                  value={prompt}
                  className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-400/40 hover:bg-cyan-950/35"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
          <ProgressActionButton pendingLabel={`Analyzing ${file.display_name}...`}>Analyze {file.display_name}</ProgressActionButton>
        </form>
      ) : (
        <p className="mt-4 rounded-lg border border-amber-400/30 bg-amber-950/30 p-3 text-sm leading-6 text-amber-100">
          {support.body}
        </p>
      )}
    </section>
  );
}

function FileImportPanel({
  file,
  imports,
  importRows
}: {
  file: FileUploadRow;
  imports: FileImportRow[];
  importRows: FileImportDataRow[];
}) {
  const canImport = isSpreadsheet(file);
  const fileImports = importsForFile(imports, file.id);
  const latestImport = fileImports[0];
  const latestImportRows = latestImport ? rowsForImport(importRows, latestImport.id) : [];
  const needsReview = latestImport && (latestImport.status === "needs_review" || latestImport.status === "extracted");

  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Import</p>
        <h3 className="mt-2 text-lg font-semibold text-white">Import structured data after review</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
          Spreadsheet imports are staged first. Vaeroex shows mappings and sample rows before anything is saved into historical records.
        </p>
      </div>
      {canImport ? (
        <div className="rounded-lg border border-cyan-400/30 bg-cyan-950/25 p-4">
          <p className="text-sm font-semibold text-cyan-50">Vaeroex found structured data in this file.</p>
          <p className="mt-1 text-sm leading-6 text-cyan-100">
            Review KPI data, customer records, or operational metrics before saving approved rows.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <ImportActionForm file={file} importType="kpi" label="Review KPI Import" />
            <ImportActionForm file={file} importType="crm" label={`Review customer data import`} />
            <ImportActionForm file={file} importType="metrics" label={`Review operational metrics import`} />
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-white/10 bg-slate-950/35 p-3 text-sm leading-6 text-slate-300">
          CSV and XLSX files can be imported into structured records after review. PDF, DOCX, PNG, and JPG files can still be analyzed, preserved in Business Memory, and used for reports.
        </p>
      )}
      {needsReview ? <MappingReview file={file} importRecord={latestImport} rows={latestImportRows} /> : null}
      <ImportHistory imports={fileImports} />
    </section>
  );
}

function FileReportsPanel({
  file,
  reports,
  analysisRuns
}: {
  file: FileUploadRow;
  reports: ReportRow[];
  analysisRuns: VaeroexRunRow[];
}) {
  const canAnalyze = canAnalyzeFile(file);
  const support = fileSupportNotice(file);
  const hasCompletedAnalysis = analysisStatus(file, analysisRuns) === "Completed";

  return (
    <section className="grid gap-4 rounded-xl border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel lg:grid-cols-2">
      <div className="space-y-3 rounded-lg border border-white/10 bg-slate-950/35 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Reports</p>
        <h3 className="text-lg font-semibold text-white">Create report from file intelligence</h3>
        {canAnalyze ? (
          <form action={createReportFromFileAction} className="space-y-3">
            <input type="hidden" name="file_id" value={file.id} />
            <TextInput label="Report title" name="report_title" defaultValue={`File Report - ${file.display_name}`} />
            <TextInput label="Report type" name="report_type" defaultValue="File Review" />
            <TextArea label="Report focus" name="report_focus" rows={3} placeholder="Optional: what should this report focus on?" />
            <ProgressActionButton pendingLabel={`${hasCompletedAnalysis ? "Creating report" : "Analyzing and creating report"} from ${file.display_name}...`}>
              {hasCompletedAnalysis ? `Create Report` : "Analyze and Create Report"}
            </ProgressActionButton>
          </form>
        ) : (
          <p className="rounded-lg border border-amber-400/30 bg-amber-950/30 p-3 text-sm leading-6 text-amber-100">
            {support.body} Vaeroex will not create a file-content report until it can read real file content.
          </p>
        )}
      </div>

      <form action={attachFileToReportAction} className="space-y-3 rounded-lg border border-white/10 bg-slate-950/35 p-4">
        <input type="hidden" name="file_id" value={file.id} />
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Attach</p>
        <h3 className="text-lg font-semibold text-white">Attach to existing report</h3>
        <label className="block text-sm font-medium text-slate-200">
          Report
          <select
            name="report_id"
            required
            disabled={!reports.length}
            className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-slate-100 outline-none focus:border-vaeroex-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <option value="">Choose report...</option>
            {reports.map((report) => (
              <option key={report.id} value={report.id}>
                {reportLabel(report)}
              </option>
            ))}
          </select>
        </label>
        <ActionButton tone="primary" disabled={!reports.length} pendingLabel="Attaching file...">Attach to Existing Report</ActionButton>
        {!reports.length ? <p className="text-sm leading-6 text-slate-300">Create a report first, then attach files to it.</p> : null}
      </form>
    </section>
  );
}

function FileEvidencePanel({ file, latestRun }: { file: FileUploadRow; latestRun?: VaeroexRunRow | null }) {
  const snapshot = fileAnalysisSnapshot(file, latestRun);
  const memory = indexStatusDetails(file);

  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Evidence</p>
        <h3 className="mt-2 text-lg font-semibold text-white">Evidence used by Vaeroex</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
          This shows why Vaeroex can use this file for future answers, recommendations, and briefings.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Source file</p>
          <p className="mt-1 break-words text-sm font-semibold text-white">{file.display_name}</p>
        </div>
        <div className={`rounded-lg border p-3 ${memoryStatusClass(memory.tone)}`}>
          <p className="text-xs font-semibold uppercase tracking-wide opacity-80">Business Memory</p>
          <p className="mt-1 text-sm font-semibold">{memory.label}</p>
          <p className="mt-1 text-xs leading-5 opacity-90">{memory.detail}</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Evidence chunks</p>
          <p className="mt-1 text-sm font-semibold text-white">{file.indexed_chunk_count || 0}</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">Stored for future intelligence.</p>
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">Last analyzed</p>
          <p className="mt-1 text-sm font-semibold text-white">{formatDateTime(snapshot.analysisDate)}</p>
        </div>
      </div>
      <InsightCategoryLinks sections={snapshot.sections} />
    </section>
  );
}

function FileMetadataPanel({
  file,
  analysisRuns,
  reports,
  folders,
  access
}: {
  file: FileUploadRow;
  analysisRuns: VaeroexRunRow[];
  reports: ReportRow[];
  folders: Pick<FolderRow, "id" | "name">[];
  access?: FileAccessLinks | null;
}) {
  const fileReports = reportsForFile(reports, file.id);
  const memory = indexStatusDetails(file);
  const details = [
    { label: "Original name", value: file.original_name },
    { label: "File type", value: file.file_extension.toUpperCase() },
    { label: "Uploaded", value: formatDate(file.created_at) },
    { label: "Folder", value: folderName(folders, file.folder_id) },
    { label: "Size", value: fileSizeLabel(file.file_size_bytes) },
    { label: "Import status", value: fileStatusLabel(file) },
    { label: "Processing status", value: (file.processing_status || "uploaded").replace(/_/g, " ") },
    { label: "Business Memory Status", value: memory.label },
    { label: "Analysis status", value: analysisStatus(file, analysisRuns) },
    { label: "Last analysis date", value: formatDateTime(latestAnalysisAt(file) || analysisRuns[0]?.created_at || null) },
    { label: "Rows imported", value: file.imported_rows },
    { label: "Reports from file", value: fileReports.length }
  ];

  return (
    <section className="space-y-4 rounded-xl border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Details</p>
          <h3 className="mt-2 text-lg font-semibold text-white">File details</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
            Metadata, source access, and processing context for this workspace file.
          </p>
        </div>
        <FileSourceActions file={file} access={access} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {details.map((item) => (
          <div key={item.label} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-300">{item.label}</p>
            <p className="mt-1 break-words text-sm font-semibold text-white">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function SelectedFilePanel({
  activePanel,
  file,
  reports,
  analysisRuns,
  imports,
  importRows,
  folders,
  files,
  access,
  showAllAnalyses
}: {
  activePanel?: FilePanelKey | null;
  file: FileUploadRow;
  reports: ReportRow[];
  analysisRuns: VaeroexRunRow[];
  imports: FileImportRow[];
  importRows: FileImportDataRow[];
  folders: Pick<FolderRow, "id" | "name">[];
  files: FileUploadRow[];
  access?: FileAccessLinks | null;
  showAllAnalyses?: boolean;
}) {
  if (!activePanel) {
    return (
      <section className="rounded-xl border border-dashed border-white/15 bg-slate-950/25 p-4 text-slate-100">
        <p className="text-sm font-semibold text-white">Choose a next action.</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Start with Analyze for a fresh review, Import for structured spreadsheets, View Intelligence for saved findings, or Ask Vaeroex for a contextual answer about this file.
        </p>
      </section>
    );
  }

  if (activePanel === "analyze") {
    return <FileAnalyzePanel file={file} />;
  }

  if (activePanel === "ask") {
    return <FileContextualAskPanel file={file} latestRun={analysisRuns[0]} />;
  }

  if (activePanel === "intelligence") {
    return <FileAnalysisResult file={file} latestRun={analysisRuns[0]} />;
  }

  if (activePanel === "evidence") {
    return <FileEvidencePanel file={file} latestRun={analysisRuns[0]} />;
  }

  if (activePanel === "reports") {
    return <FileReportsPanel file={file} reports={reports} analysisRuns={analysisRuns} />;
  }

  if (activePanel === "import") {
    return <FileImportPanel file={file} imports={imports} importRows={importRows} />;
  }

  if (activePanel === "history") {
    return <AnalysisHistory runs={analysisRuns} files={files} reports={reports} selectedFileId={file.id} showAll={showAllAnalyses} />;
  }

  return (
    <FileMetadataPanel
      file={file}
      analysisRuns={analysisRuns}
      reports={reports}
      folders={folders}
      access={access}
    />
  );
}

function asImportType(value: string): ImportType {
  if (value === "crm" || value === "metrics") {
    return value;
  }

  return "kpi";
}

function MappingReview({
  file,
  importRecord,
  rows
}: {
  file: FileUploadRow;
  importRecord: FileImportRow;
  rows: FileImportDataRow[];
}) {
  const importType = asImportType(importRecord.import_type);
  const fields = IMPORT_FIELDS[importType];
  const columns = columnsForRows(rows);
  const previewRows = rows.slice(0, 5);
  const kpiConfidence = importType === "kpi" ? kpiMappingConfidence(importRecord) : null;

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-line bg-white p-4 text-sm leading-6 text-muted">
        No extracted rows are available for this import. Extract the spreadsheet again before saving records.
      </div>
    );
  }

  return (
    <form action={saveExtractedImportAction} className="space-y-4 rounded-lg border border-amber-200 bg-amber-50/50 p-4">
      <input type="hidden" name="file_id" value={file.id} />
      <input type="hidden" name="import_id" value={importRecord.id} />
      <input type="hidden" name="import_type" value={importType} />
      <div>
        <p className="text-sm font-semibold text-ink">Review extracted data before saving</p>
        <p className="mt-1 text-xs leading-5 text-muted">
          Vaeroex found {importRecord.rows_total} row{importRecord.rows_total === 1 ? "" : "s"} for {importTypeLabel(importType)}. Nothing is added to your dashboards until you approve these mappings.
        </p>
      </div>

      {kpiConfidence ? (
        <div className="space-y-3 rounded-lg border border-line bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold text-ink">KPI import readiness</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                {rows.length} row{rows.length === 1 ? "" : "s"} staged for review. Vaeroex will not save KPI history until you approve these mappings.
              </p>
            </div>
            <span className={`w-fit rounded-full border px-3 py-1 text-xs font-semibold ${kpiConfidence.tone}`}>{kpiConfidence.label}</span>
          </div>
          <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">{kpiConfidence.help}</p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DetectedColumnCard label="Detected KPI name column" value={kpiConfidence.nameColumn} required />
            <DetectedColumnCard label="Detected actual value column" value={kpiConfidence.actualValueColumn} required />
            <DetectedColumnCard label="Detected date column" value={kpiConfidence.dateColumn} />
            <DetectedColumnCard label="Detected target column" value={kpiConfidence.targetColumn} />
          </div>
        </div>
      ) : null}

      {importType === "kpi" ? <KpiImportInterpretationControls mappingJson={importRecord.mapping_json} /> : null}

      <div className="grid gap-3 md:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className="block text-sm font-medium">
            {field.label}
            {field.required ? <span className="text-red-600"> *</span> : null}
            <select
              name={`map_${field.key}`}
              defaultValue={mappingValue(importRecord.mapping_json, field.key)}
              className="mt-2 w-full rounded-lg border border-line bg-white px-3 py-2 outline-none focus:border-vaeroex-blue"
            >
              <option value="">Do not import</option>
              {columns.map((column) => (
                <option key={column} value={column}>
                  {column}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Sample preview rows
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-muted">
              <tr>
                <th className="px-3 py-2">Row</th>
                {columns.slice(0, 6).map((column) => (
                  <th key={column} className="px-3 py-2">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => {
                const values = rowValues(row);

                return (
                  <tr key={row.id} className="border-t border-line">
                    <td className="px-3 py-2 font-medium">{row.row_number}</td>
                    {columns.slice(0, 6).map((column) => (
                      <td key={column} className="max-w-[180px] truncate px-3 py-2 text-muted">
                        {String(values[column] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <ActionButton tone="primary" pendingLabel="Saving approved data...">Save approved data</ActionButton>
    </form>
  );
}

function ImportHistory({ imports }: { imports: FileImportRow[] }) {
  if (!imports.length) {
    return null;
  }

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h4 className="text-sm font-semibold text-ink">Import history</h4>
      <div className="mt-3 space-y-2">
        {imports.slice(0, 5).map((item) => (
          <div key={item.id} className="grid gap-2 rounded-lg border border-line bg-slate-50 p-3 text-xs text-muted md:grid-cols-[1fr_auto_auto]">
            <p className="font-semibold text-ink">{importTypeLabel(item.import_type)}</p>
            <p>{importStatusLabel(item.status)}</p>
            <p>
              {item.rows_imported} / {item.rows_total} row{item.rows_total === 1 ? "" : "s"}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AnalysisHistory({
  runs,
  files,
  reports,
  selectedFileId,
  showAll = false
}: {
  runs: VaeroexRunRow[];
  files: FileUploadRow[];
  reports: ReportRow[];
  selectedFileId?: string | null;
  showAll?: boolean;
}) {
  const fileById = new Map(files.map((file) => [file.id, file]));
  const visibleRuns = selectedFileId ? runs.filter((run) => runFileId(run) === selectedFileId) : runs;
  const displayedRuns = showAll ? visibleRuns : visibleRuns.slice(0, 8);

  if (!visibleRuns.length) {
    return (
      <div id="analysis-history" className="rounded-lg border border-dashed border-line bg-white p-4">
        <p className="text-sm font-semibold text-ink">No review history yet</p>
        <p className="mt-2 text-sm leading-6 text-muted">
          Analyze a file and Vaeroex will save the result here so you can review it later, create reports, or generate supporting executive documents.
        </p>
      </div>
    );
  }

  return (
    <div id="analysis-history" className="space-y-3">
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-3 text-sm md:flex-row md:items-center md:justify-between">
        <p className="text-muted">
          Showing <span className="font-semibold text-ink">{displayedRuns.length}</span> of{" "}
          <span className="font-semibold text-ink">{visibleRuns.length}</span> analyses
        </p>
        {!showAll && visibleRuns.length > displayedRuns.length ? (
          <Link
            href={selectedFileId ? (`/app/files?file=${selectedFileId}&section=all-analyses#analysis-history` as Route) : "/app/files?section=all-analyses#analysis-history"}
            className="text-sm font-semibold text-vaeroex-blue"
          >
            View All
          </Link>
        ) : null}
      </div>
      {displayedRuns.map((run) => {
        const fileId = runFileId(run);
        const file = fileById.get(fileId);
        const result = displayAnalysisOutput(run.output_json);
        const sections = cleanAnalysisSections(result);
        const insightCount = analysisInsightCount(result);
        const hasKpis = sections.kpis.length > 0 || sections.kpiRecords.length > 0;
        const fileReports = file ? reportsForFile(reports, file.id) : [];

        return (
          <article key={run.id} className="rounded-lg border border-line bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">{file?.display_name || "File unavailable"}</p>
                <p className="mt-1 text-xs text-muted">{formatDateTime(run.created_at)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge value={run.status === "completed" ? "Completed" : run.status === "failed" ? "Failed" : "Processing"} />
                {insightCount ? <StatusBadge value={`${insightCount} insights`} /> : null}
                {fileReports.length ? <StatusBadge value={`${fileReports.length} reports`} /> : null}
              </div>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1.2fr]">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Question asked</p>
                <p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-700">{runQuestion(run)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Short summary</p>
                <p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-700">
                  {run.status === "failed" ? cleanVaeroexErrorMessage(run.error_message || undefined, "Analysis failed.") : runSummary(run)}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {file ? (
                <>
                  <Link href={selectedFileRoute(file.id, "intelligence")} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
                    View result
                  </Link>
                  <form action={createReportFromFileAction}>
                    <input type="hidden" name="file_id" value={file.id} />
                    <input type="hidden" name="report_title" value={`File Report - ${file.display_name}`} />
                    <CompactActionButton pendingLabel="Creating report...">Create file report</CompactActionButton>
                  </form>
                </>
              ) : null}
              <Link
                href={generatedOutputHref({
                  type: "action_plan",
                  title: file ? `File analysis improvement plan - ${file.display_name}` : runQuestion(run),
                  summary: runSummary(run),
                  remedy: "Review the file analysis and decide what leadership should preserve, discuss, or document.",
                  run: run.id
                })}
                className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-vaeroex-accent"
              >
                Generate Improvement Plan
              </Link>
              {hasKpis ? (
                <Link href="/app/kpis" className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-vaeroex-accent">
                  Review KPI Suggestions
                </Link>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

async function ensureDefaultFileFolders(supabase: Awaited<ReturnType<typeof requireWorkspacePage>>["supabase"], workspaceId: string, userId?: string) {
  const { data } = await supabase
    .from("record_folders")
    .select("name")
    .eq("workspace_id", workspaceId)
    .eq("collection_type", "files")
    .is("archived_at", null);
  const existingNames = new Set((data || []).map((folder) => folder.name.toLowerCase()));
  const missingFolders = DEFAULT_FILE_FOLDERS.filter((name) => !existingNames.has(name.toLowerCase()));

  if (!missingFolders.length) {
    return;
  }

  await supabase.from("record_folders").insert(
    missingFolders.map((name) => ({
      workspace_id: workspaceId,
      collection_type: "files",
      name,
      created_by: userId || null
    }))
  );
}

function FolderSelect({ folders }: { folders: Pick<FolderRow, "id" | "name">[] }) {
  return (
    <label className="block text-sm font-medium">
      Folder
      <select name="folder_id" className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue">
        <option value="">No folder</option>
        {folders.map((folder) => (
          <option key={folder.id} value={folder.id}>
            {folder.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function FileDetails({
  file,
  imports,
  importRows,
  latestRun,
  access
}: {
  file: FileUploadRow;
  imports: FileImportRow[];
  importRows: FileImportDataRow[];
  latestRun?: VaeroexRunRow | null;
  access?: FileAccessLinks | null;
}) {
  const lines = analysisLines(file.analysis_summary);
  const hasCleanAnalysis = Boolean(latestAnalysisResult(file) || latestRun?.status === "completed");
  const latestImport = imports[0];
  const latestImportRows = latestImport ? rowsForImport(importRows, latestImport.id) : [];
  const needsReview = latestImport && (latestImport.status === "needs_review" || latestImport.status === "extracted");

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-ink">Original file</h4>
            <p className="mt-1 text-xs leading-5 text-muted">
              Secure links expire automatically. If a link stops working, refresh this page to generate a new one.
            </p>
          </div>
          <FileSourceActions file={file} access={access} />
        </div>
      </section>
      <FileAnalysisResult file={file} latestRun={latestRun} />
      {needsReview ? <MappingReview file={file} importRecord={latestImport} rows={latestImportRows} /> : null}
      <ImportHistory imports={imports} />

      {lines.length && !hasCleanAnalysis ? (
        <section className="rounded-lg border border-vaeroex-accent/40 bg-vaeroex-soft p-4">
          <h4 className="text-sm font-semibold text-ink">Latest Vaeroex review</h4>
          <div className="mt-3 space-y-2 text-sm leading-6 text-slate-700">
            {lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export default async function FilesPage({ searchParams }: FilesPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  await ensureDefaultFileFolders(supabase, workspaceId, user?.id);

  const [fileResult, folderResult, importResult, importRowResult, reportResult, analysisRunResult] = await Promise.all([
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "files"),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("file_import_rows").select("*").eq("workspace_id", workspaceId).order("row_number", { ascending: true }).limit(2000),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase
      .from("ai_agent_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("agent_type", "file_analysis")
      .order("created_at", { ascending: false })
      .limit(120)
  ]);
  const files = (fileResult.data || []) as FileUploadRow[];
  const imports = (importResult.data || []) as FileImportRow[];
  const importRows = (importRowResult.data || []) as FileImportDataRow[];
  const reports = (reportResult.data || []) as ReportRow[];
  const analysisRuns = (analysisRunResult.data || []) as VaeroexRunRow[];
  const fileAccessById = await createFileAccessLinkMap(supabase, files);
  const folderOptions = folderResult.folders;
  const importedRows = files.reduce((sum, file) => sum + file.imported_rows, 0);
  const spreadsheetCount = files.filter(isSpreadsheet).length;
  const analyzedCount = files.filter((file) => Boolean(file.analysis_summary)).length;
  const pendingReviewCount = imports.filter((item) => item.status === "needs_review" || item.status === "extracted").length;
  const selectedFile = params?.file ? files.find((file) => file.id === params.file) || null : null;
  const selectedFileRuns = selectedFile ? analysisRuns.filter((run) => runFileId(run) === selectedFile.id) : [];
  const selectedFileAccess = selectedFile ? fileAccessById.get(selectedFile.id) : null;
  const activeFilePanel = selectedFile ? normalizeFilePanel(params?.panel) : null;
  const errorMessage = cleanNoticeMessage(
    params?.error ||
      fileResult.error?.message ||
      folderResult.error?.message ||
      importResult.error?.message ||
      importRowResult.error?.message ||
      reportResult.error?.message ||
      analysisRunResult.error?.message,
    "Vaeroex could not complete that file action. Please try again."
  );
  const successMessage = cleanNoticeMessage(params?.message, "File action completed.");
  const managedFiles = files.map((file) => {
    const management = managedValues(file);
    const fileImports = importsForFile(imports, file.id);
    const fileImportRows = importRows.filter((row) => row.file_upload_id === file.id);
    const fileAnalysisRuns = analysisRuns.filter((run) => runFileId(run) === file.id);
    const fileReports = reportsForFile(reports, file.id);

    return {
      id: file.id,
      title: file.display_name,
      type: file.file_extension.toUpperCase(),
      status: fileListStatus(file, fileAnalysisRuns),
      owner: "Workspace",
      category: file.import_type === "none" ? file.file_extension.toUpperCase() : file.import_type.toUpperCase(),
      createdAt: file.created_at,
      updatedAt: management.updatedAt || file.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(file.analysis_summary, `${file.original_name} · ${fileSizeLabel(file.file_size_bytes)}`),
      href: `/app/files?file=${file.id}` as Route,
      selectLabel: "Select file",
      inlineActions: <FileInlineActions file={file} analysisRuns={fileAnalysisRuns} access={fileAccessById.get(file.id)} />,
      meta: [
        { label: "Original name", value: file.original_name },
        { label: "File status", value: fileListStatus(file, fileAnalysisRuns) },
        { label: "Processing", value: fileStatusLabel(file) },
        { label: "Analysis status", value: analysisStatus(file, fileAnalysisRuns) },
        { label: "Business Memory Status", value: indexStatusLabel(file) },
        { label: "Last analysis", value: formatDateTime(latestAnalysisAt(file) || fileAnalysisRuns[0]?.created_at || null) },
        { label: "Import status", value: importStatusLabel(file.import_status) },
        { label: "Rows imported", value: file.imported_rows },
        { label: "Extractions", value: fileImports.length },
        { label: "Analyses", value: fileAnalysisRuns.length },
        { label: "Reports from file", value: fileReports.length },
        { label: "File size", value: fileSizeLabel(file.file_size_bytes) }
      ],
      quickActions: <FileActionCenter file={file} reports={reports} analysisRuns={fileAnalysisRuns} access={fileAccessById.get(file.id)} compact />,
      editFields: fileEditFields,
      editValues: {
        display_name: file.display_name,
        import_type: file.import_type,
        analysis_summary: file.analysis_summary
      },
      children: (
        <FileDetails
          file={file}
          imports={fileImports}
          importRows={fileImportRows}
          latestRun={fileAnalysisRuns[0]}
          access={fileAccessById.get(file.id)}
        />
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sources"
        title="Files & Imports"
        description="Source material for Vaeroex intelligence. Upload, analyze, import, and review business evidence before it influences dashboards and reports."
        actions={
          <Link href="/app/sources" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">
            Sources overview
          </Link>
        }
      />
      <LegalSafetyNotice tone="sensitive" compact />

      <nav className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto rounded-lg border border-white/10 bg-[#08111f] p-2 text-sm shadow-sm" aria-label="File views">
        {[
          { label: "All Files", href: "/app/files" },
          { label: "Recent Uploads", href: "/app/files?sort=newest" },
          { label: "Pending Review", href: "/app/files?status=Pending%20Review" },
          { label: "Analyzed", href: "/app/files?status=Analyzed" },
          { label: "Imported Data", href: "/app/files?status=Imported" },
          { label: "Archived Files", href: "/app/files?view=all" }
        ].map((item) => {
          const active =
            (!params?.status && !params?.view && item.href === "/app/files") ||
            (params?.status && item.href.includes(`status=${encodeURIComponent(params.status).replace(/%20/g, "%20")}`)) ||
            (params?.view && item.href.includes(`view=${params.view}`));

          return (
            <Link
              key={item.href}
              href={item.href as Route}
              className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold ${active ? "bg-vaeroex-blue text-white" : "border border-white/10 bg-white/[0.04] text-slate-100 hover:border-vaeroex-accent/40 hover:bg-cyan-950/30"}`}
            >
              {item.label}
            </Link>
          );
        })}
        <Link href="/app/reports?report_type=File%20Review" className="inline-flex min-h-11 items-center whitespace-nowrap rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-vaeroex-accent/40 hover:bg-cyan-950/30">
          Reports from Files
        </Link>
      </nav>

      {params?.status || params?.folder || params?.q || params?.view ? (
        <div className="flex flex-col gap-2 rounded-lg border border-cyan-400/25 bg-cyan-950/30 p-3 text-sm text-cyan-50 sm:flex-row sm:items-center sm:justify-between">
          <p>
            Showing: <span className="font-semibold">{params.status || (params.view === "all" ? "Archived / hidden included" : params.view) || params.folder || params.q}</span>
          </p>
          <Link href="/app/files" className="w-fit rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-50 hover:bg-cyan-900/40">
            Clear filter
          </Link>
        </div>
      ) : null}

      <ErrorNotice message={errorMessage} />
      <SuccessNotice message={successMessage} />

      <CompactSummaryChips
        items={[
          { label: "Files", value: files.length },
          { label: "Import-ready", value: spreadsheetCount },
          { label: "Rows imported", value: importedRows, tone: importedRows ? "good" : "muted" },
          { label: "Pending review", value: pendingReviewCount, tone: pendingReviewCount ? "attention" : "muted" },
          { label: "Analyses", value: analyzedCount, tone: analyzedCount ? "good" : "muted" }
        ]}
      />

      <section className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
        <div className="rounded-xl border border-white/10 bg-[#08111f] p-4 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Upload</p>
          <h2 className="mt-2 text-base font-semibold text-white">Add source material</h2>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Upload files privately to this workspace. Spreadsheet imports always require review before data is saved.
          </p>
          <div className="mt-4">
            <CreateDrawer title="Upload file" description="Files are stored privately for the active workspace. CSV/XLSX imports always go through review before saving." triggerLabel="Upload File">
              <form action={uploadFileAction} encType="multipart/form-data" className="grid gap-4">
                <label className="block text-sm font-medium">
                  File
                  <input
                    name="file"
                    type="file"
                    accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,.docx"
                    required
                    className="mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-semibold focus:border-vaeroex-blue"
                  />
                </label>
                <TextInput label="Display name" name="display_name" placeholder="Optional name shown in Vaeroex" />
                <FolderSelect folders={folderOptions} />
                <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
                  Do not upload patient data, Social Security numbers, insurance IDs, or regulated healthcare data.
                </p>
                <AnalysisProgressSubmit className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" pendingLabel="Uploading file..." steps={UPLOAD_PROGRESS_STEPS}>
                  Upload file
                </AnalysisProgressSubmit>
              </form>
            </CreateDrawer>
          </div>
        </div>

        <div className="min-w-0">
          <ManagedRecordList
            collection="files"
            records={managedFiles}
            folders={folderOptions}
            title="Recent files"
            description="Select one file to review its memory status, confidence, intelligence, evidence, imports, reports, and history."
            emptyTitle="No files uploaded yet"
            emptyDescription="Upload a CSV, XLSX, PDF, image, or DOCX file to start building a workspace file library."
            returnPath="/app/files"
            searchParams={params}
            activeRecordId={selectedFile?.id}
            defaultView="current"
          />
        </div>
      </section>

      {selectedFile ? (
        <section className="mx-auto w-full max-w-7xl space-y-4">
          <SelectedFileSummary
            file={selectedFile}
            latestRun={selectedFileRuns[0]}
            analysisRuns={selectedFileRuns}
            access={selectedFileAccess}
            activePanel={activeFilePanel}
          />
          <FilePanelNav file={selectedFile} activePanel={activeFilePanel} />
          <SelectedFilePanel
            activePanel={activeFilePanel}
            file={selectedFile}
            reports={reports}
            analysisRuns={selectedFileRuns}
            imports={imports}
            importRows={importRows}
            folders={folderOptions}
            files={files}
            access={selectedFileAccess}
            showAllAnalyses={params?.section === "all-analyses"}
          />
        </section>
      ) : null}

      {!selectedFile ? (
        <details className="rounded-lg border border-white/10 bg-[#08111f] p-4">
          <summary className="cursor-pointer text-sm font-semibold text-slate-100">All file analysis history</summary>
          <div className="mt-4">
            <AnalysisHistory runs={analysisRuns} files={files} reports={reports} showAll={params?.section === "all-analyses"} />
          </div>
        </details>
      ) : null}
    </div>
  );
}
