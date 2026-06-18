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
import { AnalysisProgressSubmit } from "@/components/operations/AnalysisProgressSubmit";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { ModuleTabs } from "@/components/operations/ModuleTabs";
import { PageHeader } from "@/components/operations/PageHeader";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
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
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
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
const ANALYSIS_PROGRESS_STEPS = ["Reading file", "Extracting content", "Sending to Vaeroex", "Generating insights", "Saving analysis", "Done"];
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

function runQuestion(run: VaeroexRunRow, fallback = "Review this file and recommend next actions.") {
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

  return "Not analyzed";
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
    ...sections.tasks,
    ...sections.reports,
    ...sections.kpiRecords,
    ...sections.crmRecords
  ].length;
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

  if (!result && !file.processing_error && latestRun?.status !== "failed") {
    return (
      <section id="analysis-result" className="rounded-lg border border-dashed border-line bg-white p-4">
        <p className="text-sm font-semibold text-ink">No analysis result yet</p>
        <p className="mt-2 text-sm leading-6 text-muted">
          Analyze this selected file to see Vaeroex findings, KPIs, risks, opportunities, and recommended next actions here.
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
    <section id="analysis-result" className="rounded-lg border border-blue-100 bg-white p-4 shadow-panel">
      <div className="rounded-lg border border-blue-100 bg-blue-50/60 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Latest Vaeroex analysis</p>
            <h4 className="mt-2 text-base font-semibold text-ink">
              {insightCount
                ? `Vaeroex found ${insightCount} insight${insightCount === 1 ? "" : "s"}`
                : "Vaeroex completed the analysis"}
            </h4>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              {sections.executiveSummary ||
                "Vaeroex could not find enough readable business data in this file to generate a useful analysis."}
            </p>
          </div>
          <StatusBadge value="Completed" />
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">
          Source file: {file.display_name} · Analysis date: {formatDateTime(analysisDate)} · Status: {fileStatusLabel(file)}
        </p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <AnalysisSection title="Key Findings" items={sections.findings} empty="No specific findings were saved from this analysis." />
        <AnalysisSection title="KPIs Detected" items={sections.kpis} empty="No KPI suggestions were found yet." />
        <AnalysisSection title="Operational Risks" items={sections.risks} empty="No clear risks were identified." />
        <AnalysisSection title="Opportunities" items={sections.opportunities} empty="No clear opportunities were identified." />
        <AnalysisSection title="Recommended Actions" items={sections.actions} empty="No recommended actions were returned." />
        <AnalysisSection title="Suggested Tasks" items={sections.tasks} empty="No task drafts were suggested." />
        <AnalysisSection title="Suggested Reports" items={sections.reports} empty="No additional reports were suggested." />
        <AnalysisSection title="Suggested KPI Records" items={sections.kpiRecords} empty="No KPI records were suggested." />
        <div className="lg:col-span-2">
          <AnalysisSection title="Suggested CRM Records" items={sections.crmRecords} empty="No CRM records were suggested from this file." />
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
      : "rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-blue disabled:cursor-not-allowed disabled:opacity-50";

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
      className="rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-vaeroex-blue disabled:cursor-not-allowed disabled:opacity-50"
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
      className="rounded-md border border-line bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:border-vaeroex-blue disabled:cursor-not-allowed disabled:opacity-50"
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
      <ActionButton pendingLabel="Importing...">{label}</ActionButton>
    </form>
  );
}

function FileInlineActions({
  file,
  analysisRuns
}: {
  file: FileUploadRow;
  analysisRuns: VaeroexRunRow[];
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
      {canAnalyze ? (
        <form action={analyzeFileAction}>
          <input type="hidden" name="file_id" value={file.id} />
          <input
            type="hidden"
            name="analysis_prompt"
            value="What trends do you see? What KPIs should I track? What problems stand out? Create an executive summary and recommended actions."
          />
          <CompactProgressActionButton pendingLabel="Analyzing...">Analyze</CompactProgressActionButton>
        </form>
      ) : null}
      {canImport ? (
        <form action={importFileAction}>
          <input type="hidden" name="file_id" value={file.id} />
          <input type="hidden" name="import_type" value="kpi" />
          <CompactActionButton pendingLabel="Importing...">Import</CompactActionButton>
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
  compact = false
}: {
  file: FileUploadRow;
  reports: ReportRow[];
  analysisRuns?: VaeroexRunRow[];
  compact?: boolean;
}) {
  const canImport = isSpreadsheet(file);
  const canAnalyze = canAnalyzeFile(file);
  const support = fileSupportNotice(file);
  const latestStatus = analysisStatus(file, analysisRuns);
  const hasCompletedAnalysis = latestStatus === "Completed";

  if (compact) {
    return (
      <>
        <Link href={`/app/files?file=${file.id}`} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
          Select {file.display_name}
        </Link>
        <Link href={`/app/files?file=${file.id}#analysis-result`} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-blue">
          View latest analysis
        </Link>
      </>
    );
  }

  return (
    <div id={`file-${file.id}-actions`} className="space-y-5">
      <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Selected File</p>
            <h3 className="mt-1 text-base font-semibold text-ink">{file.display_name}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              Analyze {file.display_name}, stage imports for review, create a report, attach it to an existing report, or inspect details.
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-700">{support.title}</p>
            <p className="mt-1 text-xs leading-5 text-slate-600">{support.body}</p>
          </div>
          <span className="rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold text-slate-700">{fileStatusLabel(file)}</span>
        </div>
      </div>

      <section id="file-analysis-form" className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-ink">Analyze {file.display_name} with Vaeroex</h4>
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
            <ProgressActionButton pendingLabel={`Analyzing ${file.display_name}...`}>Analyze {file.display_name}</ProgressActionButton>
          </form>
        ) : (
          <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
            {support.body} Upload CSV/XLSX, text-based PDF/DOCX, PNG, or JPG files for analysis and report creation.
          </p>
        )}
      </section>

      <section id="file-import-actions" className="rounded-lg border border-line bg-white p-4">
        <h4 className="text-sm font-semibold text-ink">Import data from {file.display_name} after review</h4>
        <p className="mt-1 text-xs leading-5 text-muted">
          These actions extract rows and show a mapping review first. Nothing is saved to KPI, CRM, or operations history until you approve it.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <ImportActionForm file={file} importType="kpi" label={`Import ${file.display_name} as KPI Data`} />
          <ImportActionForm file={file} importType="crm" label={`Import ${file.display_name} as CRM Leads`} />
          <ImportActionForm file={file} importType="metrics" label={`Import ${file.display_name} as Operational Metrics`} />
        </div>
        {!canImport ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
            CSV and XLSX files can be imported into structured KPI, CRM, or operational metric records. PDF, DOCX, PNG, and JPG files can still be analyzed, attached to reports, and organized in the file library.
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
                    Vaeroex will extract readable content, generate findings, then create the report from that analysis. If no useful content is found, no empty report will be created.
                  </p>
                </div>
              ) : (
                <p className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-muted">
                  This report will use the saved Vaeroex analysis, extracted findings, risks, KPIs, and recommended actions for {file.display_name}.
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
            Rows imported stays at 0 for PDFs, documents, and images because structured imports currently support CSV/XLSX rows only. PDF/DOCX analysis uses extracted text, and image analysis uses OCR plus visual context.
          </p>
        ) : null}
      </details>
    </div>
  );
}

function DisabledActionPill({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      disabled
      className="rounded-lg border border-line bg-slate-100 px-3 py-2 text-sm font-semibold text-muted opacity-70"
    >
      {children}
    </button>
  );
}

function NoSelectedFilePanel() {
  return (
    <div className="rounded-lg border border-dashed border-line bg-white p-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Selected File</p>
          <h3 className="mt-1 text-base font-semibold text-ink">No file selected.</h3>
          <p className="mt-2 text-sm leading-6 text-muted">
            No file selected. Choose a file from the list to analyze, import, or create a report.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DisabledActionPill>Analyze</DisabledActionPill>
          <DisabledActionPill>Import</DisabledActionPill>
          <DisabledActionPill>Create Report</DisabledActionPill>
        </div>
      </div>
    </div>
  );
}

function SelectedFileBanner({
  file,
  folders,
  reports,
  analysisRuns
}: {
  file: FileUploadRow;
  folders: Pick<FolderRow, "id" | "name">[];
  reports: ReportRow[];
  analysisRuns: VaeroexRunRow[];
}) {
  const fileReports = reportsForFile(reports, file.id);
  const status = analysisStatus(file, analysisRuns);
  const latestDate = latestAnalysisAt(file) || analysisRuns[0]?.created_at || null;

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/70 p-4">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Selected File</p>
            <h3 className="mt-1 break-words text-base font-semibold text-ink">{file.display_name}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              This is the file Vaeroex will use for analysis, imports, reports, and attachments.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="#file-analysis-form" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">
              Analyze with Vaeroex
            </Link>
            <Link href="#file-import-actions" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-blue">
              Import data
            </Link>
            <Link href="#file-report-actions" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-blue">
              Create report
            </Link>
            <Link href="#analysis-history" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-blue">
              View analysis history
            </Link>
            <Link href="#file-details" className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:border-vaeroex-blue">
              View file details
            </Link>
            <Link href="/app/files" className="rounded-lg border border-line bg-white px-3 py-2 text-center text-sm font-semibold text-slate-700 hover:border-vaeroex-blue">
              Change Selection
            </Link>
          </div>
        </div>
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
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Last analysis status</p>
            <p className="mt-1 text-sm font-semibold text-ink">{status}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Last analysis date</p>
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

function AnalysisHistory({
  runs,
  files,
  reports,
  selectedFileId
}: {
  runs: VaeroexRunRow[];
  files: FileUploadRow[];
  reports: ReportRow[];
  selectedFileId?: string | null;
}) {
  const fileById = new Map(files.map((file) => [file.id, file]));
  const visibleRuns = selectedFileId ? runs.filter((run) => runFileId(run) === selectedFileId) : runs;

  if (!visibleRuns.length) {
    return (
      <div id="analysis-history" className="rounded-lg border border-dashed border-line bg-white p-4">
        <p className="text-sm font-semibold text-ink">No analysis history yet</p>
        <p className="mt-2 text-sm leading-6 text-muted">
          Analyze a file and Vaeroex will save the result here so you can review it later, create reports, or confirm follow-up work.
        </p>
      </div>
    );
  }

  return (
    <div id="analysis-history" className="space-y-3">
      {visibleRuns.map((run) => {
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
                  {run.status === "failed" ? run.error_message || "Analysis failed." : runSummary(run)}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {file ? (
                <>
                  <Link href={`/app/files?file=${file.id}#analysis-result`} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
                    View result
                  </Link>
                  <form action={createReportFromFileAction}>
                    <input type="hidden" name="file_id" value={file.id} />
                    <input type="hidden" name="report_title" value={`File Report - ${file.display_name}`} />
                    <CompactActionButton pendingLabel="Creating report...">Create report</CompactActionButton>
                  </form>
                </>
              ) : null}
              <Link href={`/app/agents?run=${run.id}` as Route} className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-vaeroex-blue">
                Create tasks
              </Link>
              {hasKpis ? (
                <Link href="/app/kpis" className="rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-vaeroex-blue">
                  Create KPIs
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
  latestRun
}: {
  file: FileUploadRow;
  imports: FileImportRow[];
  importRows: FileImportDataRow[];
  latestRun?: VaeroexRunRow | null;
}) {
  const lines = analysisLines(file.analysis_summary);
  const hasCleanAnalysis = Boolean(latestAnalysisResult(file) || latestRun?.status === "completed");
  const latestImport = imports[0];
  const latestImportRows = latestImport ? rowsForImport(importRows, latestImport.id) : [];
  const needsReview = latestImport && (latestImport.status === "needs_review" || latestImport.status === "extracted");

  return (
    <div className="space-y-5">
      <FileAnalysisResult file={file} latestRun={latestRun} />
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
  const folderOptions = folderResult.folders;
  const importedRows = files.reduce((sum, file) => sum + file.imported_rows, 0);
  const spreadsheetCount = files.filter(isSpreadsheet).length;
  const analyzedCount = files.filter((file) => Boolean(file.analysis_summary)).length;
  const pendingReviewCount = imports.filter((item) => item.status === "needs_review" || item.status === "extracted").length;
  const selectedFile = params?.file ? files.find((file) => file.id === params.file) || null : null;
  const selectedFileRuns = selectedFile ? analysisRuns.filter((run) => runFileId(run) === selectedFile.id) : [];
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
      status: fileStatusLabel(file),
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
      inlineActions: <FileInlineActions file={file} analysisRuns={fileAnalysisRuns} />,
      meta: [
        { label: "Original name", value: file.original_name },
        { label: "Processing", value: fileStatusLabel(file) },
        { label: "Analysis status", value: analysisStatus(file, fileAnalysisRuns) },
        { label: "Last analysis", value: formatDateTime(latestAnalysisAt(file) || fileAnalysisRuns[0]?.created_at || null) },
        { label: "Import status", value: importStatusLabel(file.import_status) },
        { label: "Rows imported", value: file.imported_rows },
        { label: "Extractions", value: fileImports.length },
        { label: "Analyses", value: fileAnalysisRuns.length },
        { label: "Reports from file", value: fileReports.length },
        { label: "File size", value: fileSizeLabel(file.file_size_bytes) }
      ],
      quickActions: <FileActionCenter file={file} reports={reports} analysisRuns={fileAnalysisRuns} compact />,
      editFields: fileEditFields,
      editValues: {
        display_name: file.display_name,
        import_type: file.import_type,
        analysis_summary: file.analysis_summary
      },
      children: <FileDetails file={file} imports={fileImports} importRows={fileImportRows} latestRun={fileAnalysisRuns[0]} />
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

      <SectionCard title="Selected file actions" description="Choose what to do next with the uploaded file. Imports always go to review before anything is saved.">
        {selectedFile ? (
          <div className="space-y-4">
            <SelectedFileBanner file={selectedFile} folders={folderOptions} reports={reports} analysisRuns={selectedFileRuns} />
            <FileAnalysisResult file={selectedFile} latestRun={selectedFileRuns[0]} />
            <FileActionCenter file={selectedFile} reports={reports} analysisRuns={selectedFileRuns} />
          </div>
        ) : (
          <NoSelectedFilePanel />
        )}
      </SectionCard>

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
            activeRecordId={selectedFile?.id}
          />
        </SectionCard>
      </section>

      <SectionCard
        title="Analysis history"
        description={selectedFile ? `Saved Vaeroex analysis runs for ${selectedFile.display_name}.` : "Recent file analyses saved for this workspace."}
      >
        <AnalysisHistory runs={analysisRuns} files={files} reports={reports} selectedFileId={selectedFile?.id} />
      </SectionCard>
    </div>
  );
}
