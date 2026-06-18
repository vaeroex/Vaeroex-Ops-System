import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import {
  analyzeFileAction,
  attachFileToReportAction,
  createReportFromFileAction,
  importFileAction,
  saveExtractedImportAction,
  uploadFileAction
} from "@/app/app/files/actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { ModuleTabs } from "@/components/operations/ModuleTabs";
import { PageHeader } from "@/components/operations/PageHeader";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { SectionCard } from "@/components/operations/SectionCard";
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
  }>;
};

type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type FileImportDataRow = Database["public"]["Tables"]["file_import_rows"]["Row"];
type FolderRow = Database["public"]["Tables"]["record_folders"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type ImportType = "kpi" | "crm" | "metrics";
type JsonRecord = Record<string, unknown>;

const DEFAULT_FILE_FOLDERS = ["KPI Files", "Reports", "SOPs", "CRM", "Operations"];
const IMPORT_TYPES = [
  { value: "kpi", label: "KPI data" },
  { value: "crm", label: "CRM leads" },
  { value: "metrics", label: "Operational metrics" }
];
const SUGGESTED_PROMPTS = [
  "What trends do you see?",
  "What KPIs should I track?",
  "What problems stand out?",
  "Create an executive summary.",
  "Create recommended actions."
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
  { name: "analysis_summary", label: "Analysis summary", type: "textarea", rows: 5 }
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

  return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>;
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
      body: "CSV and XLSX files can be analyzed, imported after review, and used to create reports from parsed rows."
    };
  }

  if (file.file_extension === "pdf") {
    return {
      title: "PDF text extraction ready",
      body: "Vaeroex can analyze and report on text-based PDFs. If a PDF is scanned or image-only, Vaeroex will show a clear extraction error instead of creating an empty report."
    };
  }

  if (file.file_extension === "docx") {
    return {
      title: "DOCX text extraction ready",
      body: "Vaeroex can extract readable text from DOCX files for analysis and report creation."
    };
  }

  if (isImageFile(file)) {
    return {
      title: "Image OCR and analysis ready",
      body: "Vaeroex can analyze PNG and JPG files for readable text, visible issues, KPIs, risks, and recommended actions."
    };
  }

  return {
    title: "Stored reference file",
    body: "This file can be stored and attached to reports, but content analysis is not available for this file type yet."
  };
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
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
  return value || "Staged";
}

function mappingValue(mappingJson: unknown, key: string) {
  if (!isRecord(mappingJson)) {
    return "";
  }

  const value = mappingJson[key];
  return typeof value === "string" ? value : "";
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
  return Array.isArray(value) ? value.map((item) => stringValue(item)).filter(Boolean) : [];
}

function latestAnalysisResult(file: FileUploadRow) {
  if (!isRecord(file.metadata_json)) {
    return null;
  }

  const result = file.metadata_json.latest_analysis_output;
  return isRecord(result) ? result : null;
}

function AnalysisSection({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section className="rounded-lg border border-line bg-slate-50 p-4">
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

function AnalysisResultCard({ file }: { file: FileUploadRow }) {
  const result = latestAnalysisResult(file);

  if (!result) {
    return null;
  }

  const summary = stringValue(result.executive_summary, file.analysis_summary || "Vaeroex analyzed this file and prepared recommendations.");

  return (
    <section className="rounded-lg border border-blue-100 bg-white p-4 shadow-panel">
      <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Latest Vaeroex analysis</p>
        <h4 className="mt-2 text-base font-semibold text-ink">Clean analysis result</h4>
        <p className="mt-2 text-sm leading-6 text-slate-700">{summary}</p>
        <p className="mt-3 text-xs leading-5 text-muted">
          Source file: {stringValue(result.source_file_name, file.display_name)} · Status: {fileStatusLabel(file)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AnalysisSection title="Extracted Findings" items={stringList(result.extracted_findings)} empty="No specific findings were saved from this analysis." />
        <AnalysisSection title="KPIs Found" items={stringList(result.kpis_found)} empty="No KPI suggestions were found yet." />
        <AnalysisSection title="Risks" items={stringList(result.risks)} empty="No clear risks were identified." />
        <AnalysisSection title="Operational Issues" items={stringList(result.operational_issues)} empty="No operational issues were identified." />
        <div className="lg:col-span-2">
          <AnalysisSection title="Recommended Actions" items={stringList(result.recommended_actions)} empty="No recommended actions were returned." />
        </div>
      </div>
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
      : "rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-blue disabled:cursor-not-allowed disabled:opacity-50";

  return <PendingSubmitButton disabled={disabled} className={classes} pendingLabel={pendingLabel}>{children}</PendingSubmitButton>;
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
      <ActionButton pendingLabel="Importing...">{label}</ActionButton>
    </form>
  );
}

function FileActionCenter({
  file,
  reports,
  compact = false
}: {
  file: FileUploadRow;
  reports: Pick<ReportRow, "id" | "title" | "report_type" | "created_at">[];
  compact?: boolean;
}) {
  const canImport = isSpreadsheet(file);
  const canAnalyze = canAnalyzeFile(file);
  const support = fileSupportNotice(file);

  if (compact) {
    return (
      <>
        <Link href={`/app/files?file=${file.id}`} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
          View File Details
        </Link>
        {canImport ? <ImportActionForm file={file} importType="kpi" label="Import as KPI Data" /> : null}
        {canAnalyze ? (
          <form action={createReportFromFileAction}>
            <input type="hidden" name="file_id" value={file.id} />
            <ActionButton pendingLabel="Creating report...">Create Report from File</ActionButton>
          </form>
        ) : null}
      </>
    );
  }

  return (
    <div id={`file-${file.id}-actions`} className="space-y-5">
      <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink">File actions for {file.display_name}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Analyze the file, stage imports for review, create a report, attach it to an existing report, or inspect details.
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-700">{support.title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{support.body}</p>
          </div>
          <span className="rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-slate-700">{fileStatusLabel(file)}</span>
        </div>
      </div>

      <section className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-ink">Analyze with Vaeroex</h4>
            <p className="mt-1 text-xs leading-5 text-muted">
              Ask a question about this file. CSV/XLSX files use parsed rows, PDF/DOCX files use extracted readable text, and images use OCR plus visual analysis.
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
                    className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-vaeroex-blue"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
            <ActionButton tone="primary" pendingLabel="Analyzing...">Analyze with Vaeroex</ActionButton>
          </form>
        ) : (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
            {support.body} Upload CSV/XLSX, text-based PDF/DOCX, PNG, or JPG files for analysis and report creation.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-line bg-white p-4">
        <h4 className="text-sm font-semibold text-ink">Import data after review</h4>
        <p className="mt-1 text-xs leading-5 text-muted">
          These actions extract rows and show a mapping review first. Nothing is saved to KPI, CRM, or operations history until you approve it.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ImportActionForm file={file} importType="kpi" label="Import as KPI Data" />
          <ImportActionForm file={file} importType="crm" label="Import as CRM Leads" />
          <ImportActionForm file={file} importType="metrics" label="Import as Operational Metrics" />
        </div>
        {!canImport ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
            CSV and XLSX files can be imported into structured KPI, CRM, or operational metric records. PDF, DOCX, PNG, and JPG files can still be analyzed, attached to reports, and organized in the file library.
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-line bg-white p-4">
          <h4 className="text-sm font-semibold text-ink">Create Report from File</h4>
          {canAnalyze ? (
            <form action={createReportFromFileAction} className="space-y-3">
              <input type="hidden" name="file_id" value={file.id} />
              <TextInput label="Report title" name="report_title" defaultValue={`File Report - ${file.display_name}`} />
              <TextInput label="Report type" name="report_type" defaultValue="File Review" />
              <TextArea label="Report focus" name="report_focus" rows={3} placeholder="Optional: what should this report focus on?" />
              <ActionButton tone="primary" pendingLabel="Creating report...">Create Report from File</ActionButton>
            </form>
          ) : (
            <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
              {support.body} Vaeroex will not create a file-content report until it can read real file content.
            </p>
          )}
        </div>

        <form action={attachFileToReportAction} className="space-y-3 rounded-lg border border-line bg-white p-4">
          <input type="hidden" name="file_id" value={file.id} />
          <h4 className="text-sm font-semibold text-ink">Attach to Existing Report</h4>
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

      <details className="rounded-lg border border-line bg-white p-4">
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
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Rows imported</p>
            <p className="mt-1 text-ink">{file.imported_rows}</p>
          </div>
        </div>
        {!canImport ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
            Rows imported stays at 0 for PDFs, documents, and images because structured imports currently support CSV/XLSX rows only. PDF/DOCX analysis uses extracted text, and image analysis uses OCR plus visual context.
          </p>
        ) : null}
      </details>
    </div>
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
        <div className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Preview rows</div>
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
  reports
}: {
  file: FileUploadRow;
  imports: FileImportRow[];
  importRows: FileImportDataRow[];
  reports: Pick<ReportRow, "id" | "title" | "report_type" | "created_at">[];
}) {
  const lines = analysisLines(file.analysis_summary);
  const hasCleanAnalysis = Boolean(latestAnalysisResult(file));
  const latestImport = imports[0];
  const latestImportRows = latestImport ? rowsForImport(importRows, latestImport.id) : [];
  const needsReview = latestImport && (latestImport.status === "needs_review" || latestImport.status === "extracted");

  return (
    <div className="space-y-5">
      <FileActionCenter file={file} reports={reports} />
      {file.processing_error ? (
        <section className="rounded-lg border border-red-200 bg-red-50 p-4">
          <h4 className="text-sm font-semibold text-red-900">Could not process this file</h4>
          <p className="mt-2 text-sm leading-6 text-red-800">{file.processing_error}</p>
        </section>
      ) : null}
      <AnalysisResultCard file={file} />
      {needsReview ? <MappingReview file={file} importRecord={latestImport} rows={latestImportRows} /> : null}
      <ImportHistory imports={imports} />

      {lines.length && !hasCleanAnalysis ? (
        <section className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
          <h4 className="text-sm font-semibold text-ink">Latest Vaeroex analysis</h4>
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

  const [fileResult, folderResult, importResult, importRowResult, reportResult] = await Promise.all([
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "files"),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("file_import_rows").select("*").eq("workspace_id", workspaceId).order("row_number", { ascending: true }).limit(2000),
    supabase.from("reports").select("id,title,report_type,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50)
  ]);
  const files = (fileResult.data || []) as FileUploadRow[];
  const imports = (importResult.data || []) as FileImportRow[];
  const importRows = (importRowResult.data || []) as FileImportDataRow[];
  const reports = (reportResult.data || []) as ReportRow[];
  const folderOptions = folderResult.folders;
  const importedRows = files.reduce((sum, file) => sum + file.imported_rows, 0);
  const spreadsheetCount = files.filter(isSpreadsheet).length;
  const analyzedCount = files.filter((file) => Boolean(file.analysis_summary)).length;
  const pendingReviewCount = imports.filter((item) => item.status === "needs_review" || item.status === "extracted").length;
  const selectedFile = files.find((file) => file.id === params?.file) || files[0] || null;
  const errorMessage = cleanNoticeMessage(
    params?.error || fileResult.error?.message || folderResult.error?.message || importResult.error?.message || importRowResult.error?.message || reportResult.error?.message,
    "Vaeroex could not complete that file action. Please try again."
  );
  const successMessage = cleanNoticeMessage(params?.message, "File action completed.");
  const managedFiles = files.map((file) => {
    const management = managedValues(file);
    const fileImports = importsForFile(imports, file.id);
    const fileImportRows = importRows.filter((row) => row.file_upload_id === file.id);

    return {
      id: file.id,
      title: file.display_name,
      type: file.file_extension.toUpperCase(),
      status: fileStatusLabel(file),
      owner: "Workspace",
      category: file.import_type === "none" ? file.file_extension.toUpperCase() : file.import_type.toUpperCase(),
      createdAt: file.created_at,
      updatedAt: management.updatedAt || file.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(file.analysis_summary, `${file.original_name} · ${fileSizeLabel(file.file_size_bytes)}`),
      meta: [
        { label: "Original name", value: file.original_name },
        { label: "Processing", value: fileStatusLabel(file) },
        { label: "Import status", value: importStatusLabel(file.import_status) },
        { label: "Rows imported", value: file.imported_rows },
        { label: "Extractions", value: fileImports.length },
        { label: "File size", value: fileSizeLabel(file.file_size_bytes) }
      ],
      quickActions: <FileActionCenter file={file} reports={reports} compact />,
      editFields: fileEditFields,
      editValues: {
        display_name: file.display_name,
        import_type: file.import_type,
        analysis_summary: file.analysis_summary
      },
      children: <FileDetails file={file} imports={fileImports} importRows={fileImportRows} reports={reports} />
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Files"
        title="Files and imports"
        description="Use files when you already have existing data to bring into Vaeroex. This is optional: KPIs, CRM leads, tasks, checklists, SOPs, and reports can also be created manually."
      />
      <ModuleTabs
        tabs={[
          { label: "All Files", href: "/app/files", active: !params?.status && !params?.folder },
          { label: "Imports", href: "/app/files?status=Imported" as Route, active: params?.status === "Imported" },
          { label: "Analyses", href: "/app/files?status=Ready" as Route, active: params?.status === "Ready" },
          { label: "Folders", href: "/app/files?folder=unfiled" as Route, active: Boolean(params?.folder) }
        ]}
      />

      <ErrorNotice message={errorMessage} />
      <SuccessNotice message={successMessage} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Files stored</p>
          <p className="mt-2 text-3xl font-semibold">{files.length}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Import-ready files</p>
          <p className="mt-2 text-3xl font-semibold">{spreadsheetCount}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Rows imported</p>
          <p className="mt-2 text-3xl font-semibold">{importedRows}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Pending review</p>
          <p className="mt-2 text-3xl font-semibold">{pendingReviewCount}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Vaeroex analyses</p>
          <p className="mt-2 text-3xl font-semibold">{analyzedCount}</p>
        </article>
      </section>

      {selectedFile ? (
        <SectionCard title="Selected file actions" description="Choose what to do next with the uploaded file. Imports always go to review before anything is saved.">
          <FileActionCenter file={selectedFile} reports={reports} />
        </SectionCard>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <SectionCard title="Upload file" description="Files are stored privately for the active workspace. CSV/XLSX files can be imported after review. PDF/DOCX files can be analyzed from extracted text, and PNG/JPG files can be analyzed with OCR and visual context.">
            <form action={uploadFileAction} encType="multipart/form-data" className="space-y-4">
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
              <ActionButton tone="primary" pendingLabel="Uploading file...">Upload file</ActionButton>
            </form>
          </SectionCard>

          <SectionCard title="Default folders" description="Use these starter folders or create custom folders in the file list.">
            <div className="flex flex-wrap gap-2">
              {DEFAULT_FILE_FOLDERS.map((folder) => (
                <span key={folder} className="rounded-full border border-line bg-slate-50 px-3 py-1.5 text-sm font-medium text-slate-700">
                  {folder}
                </span>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="File library" description="Files are collapsed by default and can be renamed, moved, duplicated, archived, deleted, searched, filtered, and managed in bulk.">
          <ManagedRecordList
            collection="files"
            records={managedFiles}
            folders={folderOptions}
            title="Workspace files"
            description="Use folders for KPI files, reports, SOPs, CRM files, operations files, and custom collections."
            emptyTitle="No files uploaded yet"
            emptyDescription="Upload a CSV, XLSX, PDF, image, or DOCX file to start building a workspace file library."
            returnPath="/app/files"
            searchParams={params}
          />
        </SectionCard>
      </section>
    </div>
  );
}
