import Link from "next/link";
import type { Route } from "next";
import {
  analyzeFileAction,
  createReportFromFileAction,
  importFileAction,
  uploadFileAction
} from "@/app/app/files/actions";
import { ArchivedFilesBulkActions } from "@/components/operations/ArchivedFilesBulkActions";
import { GeneratedInsightsPanel, type GeneratedInsightItem } from "@/components/operations/GeneratedInsightsPanel";
import { manageRecordAction } from "@/app/app/operations/record-management-actions";
import { LegalSafetyNotice } from "@/components/legal/LegalSafetyNotice";
import { AnalysisProgressSubmit } from "@/components/operations/AnalysisProgressSubmit";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { TextInput } from "@/components/operations/FormControls";
import { LoadingLink } from "@/components/operations/LoadingLink";
import { PageHeader } from "@/components/operations/PageHeader";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { createFileAccessLinkMap, type FileAccessLinks } from "@/lib/files/storage-links";
import { getRecordFolders } from "@/lib/records/management";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type SourcesPageProps = {
  searchParams?: Promise<{
    error?: string;
    message?: string;
    status?: string;
    q?: string;
    file?: string;
    view?: string;
  }>;
};

type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type FolderRow = Database["public"]["Tables"]["record_folders"]["Row"];
type JsonRecord = Record<string, unknown>;

const ANALYSIS_PROGRESS_STEPS = ["Reading file", "Extracting key information", "Identifying business signals", "Checking KPI/import opportunities", "Saving analysis", "Done"];
const IMPORT_PROGRESS_STEPS = ["Parsing file", "Detecting columns", "Preparing mapping review", "Saving staged rows", "Ready for approval"];
const REPORT_PROGRESS_STEPS = ["Reading source evidence", "Preparing findings", "Creating report", "Saving report", "Done"];
const UPLOAD_PROGRESS_STEPS = ["Uploading file", "Saving securely", "Preparing source record", "Refreshing Sources", "Complete"];
const fileStatusTabs = [
  { label: "All Files", href: "/app/sources" },
  { label: "Recent Uploads", href: "/app/sources?status=Recent%20Uploads" },
  { label: "Pending Review", href: "/app/sources?status=Pending%20Review" },
  { label: "Analyzed", href: "/app/sources?status=Analyzed" },
  { label: "Imported Data", href: "/app/sources?status=Imported" },
  { label: "Archived Files", href: "/app/sources?view=hidden" }
] as const;

function cleanNoticeMessage(message: string | null | undefined, fallback: string) {
  const trimmed = (message || "").trim();

  if (!trimmed || trimmed === "NEXT_REDIRECT" || trimmed.includes("NEXT_REDIRECT;")) {
    return trimmed ? fallback : null;
  }

  return trimmed;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Not available";
  }

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

function fileSizeLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isSpreadsheet(file: FileUploadRow) {
  return file.file_extension === "csv" || file.file_extension === "xlsx";
}

function runFileId(run: VaeroexRunRow) {
  const input = isRecord(run.input_json) ? run.input_json : {};
  const extraInputs = isRecord(input.extra_inputs) ? input.extra_inputs : {};
  const file = isRecord(extraInputs.file) ? extraInputs.file : {};
  return typeof file.id === "string" ? file.id : "";
}

function runSummary(run: VaeroexRunRow) {
  const output = isRecord(run.output_json) ? run.output_json : {};
  return stringValue(output.executive_summary) || stringValue(output.summary) || stringValue(output.response_markdown) || run.error_message || "No summary was saved.";
}

function confidenceFromScore(score: number) {
  if (score >= 80) return `High (${score}%)`;
  if (score >= 60) return `Medium (${score}%)`;
  if (score >= 35) return `Developing (${score}%)`;
  return `Low (${score}%)`;
}

function runConfidence(run: VaeroexRunRow) {
  const output = isRecord(run.output_json) ? run.output_json : {};
  const confidence =
    stringValue(output.confidence) ||
    stringValue(output.confidence_level) ||
    stringValue(output.confidence_label) ||
    stringValue(output.analysis_confidence);

  if (confidence) {
    return confidence;
  }

  const score = output.confidence_score ?? output.evidence_confidence_score;

  if (typeof score === "number" && Number.isFinite(score)) {
    return confidenceFromScore(Math.round(score <= 1 ? score * 100 : score));
  }

  return "";
}

function reportsForFile(reports: ReportRow[], fileId: string) {
  return reports.filter((report) => {
    const source = isRecord(report.source_data_json) ? report.source_data_json : {};
    const file = isRecord(source.file) ? source.file : {};
    const attachedFiles = Array.isArray(source.attached_files) ? source.attached_files.filter(isRecord) : [];

    return file.id === fileId || attachedFiles.some((item) => isRecord(item) && item.id === fileId);
  });
}

function latestAnalysisAt(file: FileUploadRow) {
  if (!isRecord(file.metadata_json)) {
    return file.analysis_summary ? file.processed_at || file.updated_at : null;
  }

  return stringValue(file.metadata_json.latest_analysis_at) || (file.analysis_summary ? file.processed_at || file.updated_at : null);
}

function analysisStatus(file: FileUploadRow, runs: VaeroexRunRow[]) {
  const latestRun = runs[0];

  if ((file.processing_status || "") === "processing") return "Analyzing";
  if ((file.processing_status || "") === "failed" || latestRun?.status === "failed") return "Error";
  if (latestRun?.status === "completed" || file.analysis_summary || latestAnalysisAt(file)) return "Analyzed";
  return "Not reviewed";
}

function importStatusLabel(value: string) {
  if (value === "ready") return "Import Ready";
  if (value === "extracted" || value === "needs_review") return "Pending Review";
  if (value === "imported") return "Imported";
  if (value === "failed") return "Error";
  return "Not imported";
}

function fileStatus(file: FileUploadRow, runs: VaeroexRunRow[]) {
  if (file.deleted_at) return "Deleted";
  if (file.archived_at) return "Archived";
  if ((file.processing_status || "") === "processing") return "Analyzing";
  if ((file.processing_status || "") === "failed" || file.import_status === "failed") return "Error";
  if (file.import_status === "extracted" || file.import_status === "needs_review") return "Pending Review";
  if (file.import_status === "imported") return "Imported";
  if (analysisStatus(file, runs) === "Analyzed") return "Analyzed";
  if (isSpreadsheet(file) && file.import_status === "ready") return "Import Ready";
  return "Uploaded";
}

function fileCategory(file: FileUploadRow, folders: Pick<FolderRow, "id" | "name">[]) {
  const folder = folders.find((item) => item.id === file.folder_id)?.name;

  if (folder) return folder;
  if (file.import_type && file.import_type !== "none") return file.import_type.toUpperCase();
  return `${file.file_extension.toUpperCase()} source`;
}

function fileMatchesStatus(file: FileUploadRow, status: string, runs: VaeroexRunRow[]) {
  const label = fileStatus(file, runs);

  if (!status) return true;
  if (status === "Recent Uploads") return true;
  return label === status;
}

function filteredFiles({
  files,
  status,
  query,
  view,
  fileId,
  runsByFile
}: {
  files: FileUploadRow[];
  status?: string;
  query?: string;
  view?: string;
  fileId?: string;
  runsByFile: Map<string, VaeroexRunRow[]>;
}) {
  const normalizedQuery = (query || "").trim().toLowerCase();
  const includeHidden = view === "hidden";

  return files
    .filter((file) => (fileId ? file.id === fileId : true))
    .filter((file) => (includeHidden ? Boolean(file.archived_at && !file.deleted_at) : !file.deleted_at && !file.archived_at))
    .filter((file) => fileMatchesStatus(file, status || "", runsByFile.get(file.id) || []))
    .filter((file) => {
      if (!normalizedQuery) return true;

      return [file.display_name, file.original_name, file.file_extension, file.import_type, file.analysis_summary]
        .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => {
      if (status === "Recent Uploads") return b.created_at.localeCompare(a.created_at);
      return b.updated_at.localeCompare(a.updated_at);
    });
}

type SourceMetric = {
  label: string;
  value: number;
  href: Route;
  detail: string;
  emptyDetail: string;
};

function SourceMetricCard({ label, value, href, detail, emptyDetail }: SourceMetric) {
  const explanation = value ? detail : emptyDetail;

  return (
    <LoadingLink
      href={href}
      className="group block rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel transition hover:border-cyan-300/40 hover:bg-blue-950/25 focus:outline-none focus:ring-2 focus:ring-vaeroex-accent/50"
      loadingLabel={label === "Archived Files" ? "Loading archived files..." : label === "Insights Generated" ? "Loading generated insights..." : "Loading source view..."}
      aria-label={`${label}: ${value}. ${explanation}`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-semibold text-white">{label}</p>
        <span className="text-xs font-semibold text-vaeroex-accent opacity-80 transition group-hover:opacity-100">Open</span>
      </div>
      <p className="mt-3 text-3xl font-semibold text-white">{value}</p>
      <p className={`mt-2 text-xs leading-5 ${value ? "text-slate-300" : "text-slate-400"}`}>{explanation}</p>
    </LoadingLink>
  );
}

function SourceMetricGroup({ title, description, metrics }: { title: string; description: string; metrics: SourceMetric[] }) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#07101f] p-4 text-slate-100 shadow-panel">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">{title}</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {metrics.map((metric) => (
          <SourceMetricCard key={metric.label} {...metric} />
        ))}
      </div>
    </section>
  );
}

function FolderSelect({ folders }: { folders: Pick<FolderRow, "id" | "name">[] }) {
  return (
    <label className="block text-sm font-medium text-slate-200">
      Folder
      <select name="folder_id" className="mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-vaeroex-accent">
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

function UploadSourceDrawer({ folders }: { folders: Pick<FolderRow, "id" | "name">[] }) {
  return (
    <CreateDrawer
      title="Upload source file"
      description="Upload reports, KPI spreadsheets, SOPs, meeting notes, financial exports, or operational documents. CSV/XLSX imports always go through review before saving."
      triggerLabel="Upload Source"
    >
      <form action={uploadFileAction} encType="multipart/form-data" className="grid gap-4 text-slate-100">
        <input type="hidden" name="return_path" value="/app/sources" />
        <label className="block text-sm font-medium text-slate-200">
          File
          <input
            name="file"
            type="file"
            accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,.docx"
            required
            className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm outline-none file:mr-3 file:rounded-md file:border-0 file:bg-vaeroex-blue file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white focus:border-vaeroex-accent"
          />
        </label>
        <TextInput label="Display name" name="display_name" placeholder="Optional name shown in Vaeroex" />
        <FolderSelect folders={folders} />
        <p className="rounded-lg border border-white/10 bg-slate-950/45 p-3 text-xs leading-5 text-slate-400">
          Do not upload patient data, Social Security numbers, insurance IDs, or regulated healthcare data.
        </p>
        <AnalysisProgressSubmit className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" pendingLabel="Uploading file..." steps={UPLOAD_PROGRESS_STEPS}>
          Upload file
        </AnalysisProgressSubmit>
      </form>
    </CreateDrawer>
  );
}

function SourceActionButton({
  children,
  pendingLabel,
  steps
}: {
  children: string;
  pendingLabel: string;
  steps: string[];
}) {
  return (
    <AnalysisProgressSubmit className="rounded-md bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" pendingLabel={pendingLabel} steps={steps}>
      {children}
    </AnalysisProgressSubmit>
  );
}

function SourceFileActions({
  file,
  access,
  linkedKpis,
  linkedRuns
}: {
  file: FileUploadRow;
  access?: FileAccessLinks | null;
  linkedKpis: KpiRow[];
  linkedRuns: VaeroexRunRow[];
}) {
  const referenceWarning = linkedKpis.length || linkedRuns.length
    ? ` This file is linked to ${linkedKpis.length} KPI record${linkedKpis.length === 1 ? "" : "s"} and ${linkedRuns.length} generated insight${linkedRuns.length === 1 ? "" : "s"}.`
    : "";

  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/app/files?file=${file.id}#file-details`} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">
        View
      </Link>
      <form action={analyzeFileAction}>
        <input type="hidden" name="file_id" value={file.id} />
        <input
          type="hidden"
          name="analysis_prompt"
          value="What trends do you see? What KPIs should I track? What problems stand out? Create an executive summary and recommended actions."
        />
        <SourceActionButton pendingLabel="Analyzing file..." steps={ANALYSIS_PROGRESS_STEPS}>
          Analyze
        </SourceActionButton>
      </form>
      <Link href={`/app/files?file=${file.id}#analysis-result`} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">
        Review Analysis
      </Link>
      {isSpreadsheet(file) ? (
        <form action={importFileAction}>
          <input type="hidden" name="file_id" value={file.id} />
          <input type="hidden" name="import_type" value="kpi" />
          <SourceActionButton pendingLabel="Preparing import review..." steps={IMPORT_PROGRESS_STEPS}>
            Review KPI Import
          </SourceActionButton>
        </form>
      ) : null}
      <form action={createReportFromFileAction}>
        <input type="hidden" name="file_id" value={file.id} />
        <input type="hidden" name="report_title" value={`File Report - ${file.display_name}`} />
        <SourceActionButton pendingLabel="Creating report..." steps={REPORT_PROGRESS_STEPS}>
          Create Report
        </SourceActionButton>
      </form>
      {access?.downloadUrl ? (
        <a href={access.downloadUrl} download={file.original_name} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">
          Download Original
        </a>
      ) : null}
      <form action={manageRecordAction}>
        <input type="hidden" name="collection" value="files" />
        <input type="hidden" name="record_id" value={file.id} />
        <input type="hidden" name="record_action" value={file.archived_at ? "restore" : "archive"} />
        <input type="hidden" name="return_path" value="/app/sources" />
        <ConfirmSubmitButton
          message={file.archived_at ? `Restore "${file.display_name}" to current Sources?` : `Archive "${file.display_name}"? It will leave current views but remain available as historical context.`}
          pendingLabel={file.archived_at ? "Restoring..." : "Archiving..."}
          className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30"
        >
          {file.archived_at ? "Restore" : "Archive"}
        </ConfirmSubmitButton>
      </form>
      <form action={manageRecordAction}>
        <input type="hidden" name="collection" value="files" />
        <input type="hidden" name="record_id" value={file.id} />
        <input type="hidden" name="record_action" value="delete" />
        <input type="hidden" name="return_path" value="/app/sources" />
        <ConfirmSubmitButton
          message={`Delete this file from current Sources? This uses a workspace-safe soft delete and may remove supporting evidence from active views.${referenceWarning}`}
          pendingLabel="Deleting file..."
          className="rounded-md border border-red-400/35 bg-red-950/35 px-3 py-2 text-xs font-semibold text-red-100 hover:border-red-300/60 hover:bg-red-950/55"
        >
          Delete File
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}

function SourceFileDetails({
  file,
  fileImports,
  linkedKpis,
  linkedRuns,
  linkedReports
}: {
  file: FileUploadRow;
  fileImports: FileImportRow[];
  linkedKpis: KpiRow[];
  linkedRuns: VaeroexRunRow[];
  linkedReports: ReportRow[];
}) {
  return (
    <details className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
      <summary className="cursor-pointer text-xs font-semibold text-cyan-100">View details, analysis, imports, KPIs, and intelligence links</summary>
      <div className="mt-4 grid gap-3 text-sm lg:grid-cols-2">
        <section className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Analysis summary</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{file.analysis_summary || "No analysis summary has been saved yet."}</p>
        </section>
        <section className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Imports created</p>
          {fileImports.length ? (
            <div className="mt-2 space-y-2">
              {fileImports.slice(0, 4).map((item) => (
                <p key={item.id} className="text-sm text-slate-300">
                  {item.import_type.toUpperCase()} · {item.status.replace(/_/g, " ")} · {item.rows_imported}/{item.rows_total} rows
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-400">No structured import has been created from this file.</p>
          )}
        </section>
        <section className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">KPIs using this source</p>
          {linkedKpis.length ? (
            <div className="mt-2 space-y-2">
              {linkedKpis.slice(0, 5).map((kpi) => (
                <Link key={kpi.id} href={`/app/kpis?section=detail&metric=${encodeURIComponent(kpi.name)}` as Route} className="block text-sm font-semibold text-cyan-100 hover:text-white">
                  {kpi.name} · {formatDate(kpi.metric_date)}
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-400">No KPI records currently reference this file.</p>
          )}
        </section>
        <section className="rounded-lg border border-white/10 bg-[#08111f] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Insights using this file</p>
          {linkedRuns.length || linkedReports.length ? (
            <div className="mt-2 space-y-2">
              {linkedRuns.slice(0, 4).map((run) => (
                <p key={run.id} className="line-clamp-2 text-sm text-slate-300">{runSummary(run)}</p>
              ))}
              {linkedReports.slice(0, 4).map((report) => (
                <Link key={report.id} href="/app/briefings" className="block text-sm font-semibold text-cyan-100 hover:text-white">
                  {report.title}
                </Link>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-slate-400">No saved insight references this file yet.</p>
          )}
        </section>
      </div>
      <details className="mt-3 rounded-lg border border-white/10 bg-[#08111f] p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-300">Source evidence and technical details</summary>
        <div className="mt-3 grid gap-2 text-xs text-slate-400 sm:grid-cols-2 lg:grid-cols-4">
          <p>Original: {file.original_name}</p>
          <p>Type: {file.file_extension.toUpperCase()}</p>
          <p>Size: {fileSizeLabel(file.file_size_bytes)}</p>
          <p>Uploaded: {formatDateTime(file.created_at)}</p>
          <p>Processing: {(file.processing_status || "uploaded").replace(/_/g, " ")}</p>
          <p>Import: {importStatusLabel(file.import_status)}</p>
          <p>Rows imported: {file.imported_rows}</p>
          <p>Last updated: {formatDateTime(file.updated_at)}</p>
        </div>
      </details>
    </details>
  );
}

function SourceFileRow({
  file,
  folders,
  imports,
  reports,
  kpis,
  runs,
  access,
  selectable = false
}: {
  file: FileUploadRow;
  folders: Pick<FolderRow, "id" | "name">[];
  imports: FileImportRow[];
  reports: ReportRow[];
  kpis: KpiRow[];
  runs: VaeroexRunRow[];
  access?: FileAccessLinks | null;
  selectable?: boolean;
}) {
  const linkedKpis = kpis.filter((kpi) => kpi.source_file_id === file.id);
  const linkedRuns = runs.filter((run) => runFileId(run) === file.id);
  const linkedReports = reportsForFile(reports, file.id);
  const fileImports = imports.filter((item) => item.file_upload_id === file.id);
  const status = fileStatus(file, linkedRuns);

  return (
    <article id={`file-${file.id}`} className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      {selectable ? (
        <label className="mb-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100">
          <input
            type="checkbox"
            name="record_id"
            value={file.id}
            className="h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent"
          />
          Select file
        </label>
      ) : null}
      <div className="grid gap-4 xl:grid-cols-[minmax(220px,1.2fr)_110px_120px_130px_130px_minmax(220px,1fr)] xl:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-sm font-semibold text-white">{file.display_name}</h3>
            <StatusBadge value={status} />
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">{file.original_name} · {fileSizeLabel(file.file_size_bytes)}</p>
          <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{file.analysis_summary || "No Vaeroex analysis summary yet."}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Type</p>
          <p className="mt-1 text-sm font-semibold text-slate-200">{file.file_extension.toUpperCase()}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Uploaded</p>
          <p className="mt-1 text-sm font-semibold text-slate-200">{formatDate(file.created_at)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Category</p>
          <p className="mt-1 text-sm font-semibold text-slate-200">{fileCategory(file, folders)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Import</p>
          <p className="mt-1 text-sm font-semibold text-slate-200">{importStatusLabel(file.import_status)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Used by</p>
          <p className="mt-1 text-sm font-semibold text-slate-200">
            {linkedKpis.length} KPI{linkedKpis.length === 1 ? "" : "s"} · {linkedRuns.length} generated insight{linkedRuns.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {isSpreadsheet(file) && file.import_status === "ready" ? (
        <div className="mt-3 rounded-lg border border-cyan-400/30 bg-cyan-950/30 p-3 text-xs leading-5 text-cyan-50">
          Vaeroex found structured data in this file. You can import it as KPI data after review.
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        <SourceFileActions file={file} access={access} linkedKpis={linkedKpis} linkedRuns={linkedRuns} />
        <SourceFileDetails file={file} fileImports={fileImports} linkedKpis={linkedKpis} linkedRuns={linkedRuns} linkedReports={linkedReports} />
      </div>
    </article>
  );
}

export default async function SourcesPage({ searchParams }: SourcesPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [filesResult, foldersResult, importsResult, reportsResult, kpisResult, runsResult] = await Promise.all([
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "files"),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("metric_date", { ascending: false }).limit(500),
    supabase
      .from("ai_agent_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("agent_type", "file_analysis")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
  ]);

  const files = (filesResult.data || []) as FileUploadRow[];
  const folders = foldersResult.folders as Pick<FolderRow, "id" | "name">[];
  const imports = (importsResult.data || []) as FileImportRow[];
  const reports = (reportsResult.data || []) as ReportRow[];
  const kpis = (kpisResult.data || []) as KpiRow[];
  const runs = (runsResult.data || []) as VaeroexRunRow[];
  const accessByFileId = await createFileAccessLinkMap(supabase, files);
  const runsByFile = new Map<string, VaeroexRunRow[]>();

  runs.forEach((run) => {
    const fileId = runFileId(run);
    if (!fileId) return;
    runsByFile.set(fileId, [...(runsByFile.get(fileId) || []), run]);
  });

  const errors = [filesResult.error, foldersResult.error, importsResult.error, reportsResult.error, kpisResult.error, runsResult.error].filter(Boolean);
  const visibleFiles = filteredFiles({
    files,
    status: params?.status,
    query: params?.q,
    view: params?.view,
    fileId: params?.file,
    runsByFile
  });
  const currentFiles = files.filter((file) => !file.deleted_at && !file.archived_at);
  const hiddenFiles = files.filter((file) => file.archived_at && !file.deleted_at);
  const analyzedFiles = files.filter((file) => fileStatus(file, runsByFile.get(file.id) || []) === "Analyzed");
  const importReadyFiles = files.filter((file) => fileStatus(file, runsByFile.get(file.id) || []) === "Import Ready");
  const pendingReviewFiles = files.filter((file) => fileStatus(file, runsByFile.get(file.id) || []) === "Pending Review");
  const linkedFile = params?.file ? files.find((file) => file.id === params.file) : null;
  const activeFilterLabel = linkedFile?.display_name || params?.status || (params?.view === "hidden" ? "Archived Files" : "") || params?.q || "";
  const isArchivedView = params?.view === "hidden";
  const insightItems: GeneratedInsightItem[] = runs.map((run) => {
    const fileId = runFileId(run);
    const file = files.find((item) => item.id === fileId);

    return {
      id: run.id,
      title: file?.display_name || "File analysis",
      summary: runSummary(run),
      createdAt: formatDateTime(run.created_at),
      confidence: runConfidence(run) || undefined,
      evidenceHref: file ? (`/app/files?file=${file.id}#analysis-result` as Route) : undefined
    };
  });
  const metricGroups = [
    {
      title: "Business Evidence",
      description: "Source files Vaeroex can analyze, import, or preserve as business context.",
      metrics: [
        {
          label: "Files",
          value: currentFiles.length,
          href: "/app/sources" as Route,
          detail: "Uploaded business evidence available in this workspace.",
          emptyDetail: "No business evidence uploaded yet."
        },
        {
          label: "Analyzed Evidence",
          value: analyzedFiles.length,
          href: "/app/sources?status=Analyzed" as Route,
          detail: "Files Vaeroex has reviewed for leadership context.",
          emptyDetail: "No files have been analyzed yet."
        },
        {
          label: "Import Ready",
          value: importReadyFiles.length,
          href: "/app/sources?status=Import%20Ready" as Route,
          detail: "Structured files ready for review-gated import.",
          emptyDetail: "No files are waiting for import."
        },
        {
          label: "Pending Review",
          value: pendingReviewFiles.length,
          href: "/app/sources?status=Pending%20Review" as Route,
          detail: "Imported rows waiting for approval before saving.",
          emptyDetail: "No pending reviews."
        }
      ]
    },
    {
      title: "Executive Intelligence",
      description: "Leadership-ready insights and archived evidence from source material.",
      metrics: [
        {
          label: "Insights Generated",
          value: runs.length,
          href: "/app/sources#source-insights" as Route,
          detail: "Generated file insights available for leadership review.",
          emptyDetail: "No insights have been generated yet."
        },
        {
          label: "Archived Files",
          value: hiddenFiles.length,
          href: "/app/sources?view=hidden" as Route,
          detail: "Archived evidence kept out of active views.",
          emptyDetail: "No archived files."
        }
      ]
    }
  ];
  const successMessage = cleanNoticeMessage(params?.message, "File action completed.");
  const errorMessage = cleanNoticeMessage(params?.error || errors[0]?.message, "Source data could not be loaded.");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sources"
        title="Sources"
        description="Manage the information Vaeroex uses to understand the business. Upload, review, analyze, import, and organize business evidence from one place."
        actions={<UploadSourceDrawer folders={folders} />}
      />

      <LegalSafetyNotice tone="sensitive" compact />
      <ErrorNotice message={errorMessage} />
      {successMessage ? (
        <div className="rounded-lg border border-emerald-400/35 bg-emerald-950/30 p-3 text-sm text-emerald-100">
          {successMessage}
        </div>
      ) : null}

      <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Upload</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Upload business evidence.</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
              Upload reports, KPI spreadsheets, SOPs, meeting notes, financial exports, or operational documents. After upload, choose whether Vaeroex should analyze it, stage an import for review, create a report, or keep it as business memory.
            </p>
          </div>
          <UploadSourceDrawer folders={folders} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {metricGroups.map((group) => (
          <SourceMetricGroup key={group.title} {...group} />
        ))}
      </section>

      <section className="space-y-3">
        <nav className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto rounded-lg border border-white/10 bg-[#08111f] p-2 shadow-sm" aria-label="Source file views">
          {fileStatusTabs.map((tab) => {
            const active =
              (!params?.status && !params?.view && tab.href === "/app/sources") ||
              (params?.status && tab.href.includes(`status=${encodeURIComponent(params.status).replace(/%20/g, "%20")}`)) ||
              (params?.view && tab.href.includes(`view=${params.view}`));

            return (
              <LoadingLink
                key={tab.href}
                href={tab.href as Route}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold ${active ? "bg-vaeroex-blue text-white" : "border border-white/10 bg-white/[0.04] text-slate-100 hover:border-vaeroex-accent/40 hover:bg-cyan-950/30"}`}
                loadingLabel={tab.label === "Archived Files" ? "Loading archived files..." : `Loading ${tab.label.toLowerCase()}...`}
              >
                {tab.label}
              </LoadingLink>
            );
          })}
        </nav>

        <form method="get" className="grid gap-3 rounded-lg border border-white/10 bg-[#08111f] p-3 sm:grid-cols-[1fr_auto]">
          <input
            name="q"
            defaultValue={params?.q || ""}
            placeholder="Search files..."
            className="min-h-11 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
          />
          <PendingSubmitButton pendingLabel="Searching files..." className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Search files
          </PendingSubmitButton>
        </form>

        {activeFilterLabel ? (
          <div className="flex flex-col gap-2 rounded-lg border border-cyan-400/25 bg-cyan-950/30 p-3 text-sm text-cyan-50 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing: <span className="font-semibold">{activeFilterLabel}</span>
            </p>
            <Link href="/app/sources" className="w-fit rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-50 hover:bg-cyan-900/40">
              Clear filter
            </Link>
          </div>
        ) : null}

        <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Files</h2>
              <p className="mt-1 text-sm text-slate-400">Upload, analyze, import, archive, delete, and inspect source evidence directly from Sources.</p>
            </div>
            <StatusBadge value={`${visibleFiles.length} showing`} />
          </div>
          <div className="mt-4 space-y-3">
            {visibleFiles.length ? (
              isArchivedView ? (
                <ArchivedFilesBulkActions fileCount={visibleFiles.length} returnPath="/app/sources?view=hidden">
                  <div className="space-y-3">
                    {visibleFiles.map((file) => (
                      <SourceFileRow
                        key={file.id}
                        file={file}
                        folders={folders}
                        imports={imports}
                        reports={reports}
                        kpis={kpis}
                        runs={runs}
                        access={accessByFileId.get(file.id)}
                        selectable
                      />
                    ))}
                  </div>
                </ArchivedFilesBulkActions>
              ) : (
                visibleFiles.map((file) => (
                  <SourceFileRow
                    key={file.id}
                    file={file}
                    folders={folders}
                    imports={imports}
                    reports={reports}
                    kpis={kpis}
                    runs={runs}
                    access={accessByFileId.get(file.id)}
                  />
                ))
              )
            ) : (
              <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/45 p-8 text-center">
                <h3 className="text-lg font-semibold text-white">{isArchivedView ? "No archived files." : files.length ? "No files match this filter" : "No source files yet"}</h3>
                <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
                  {isArchivedView
                    ? "Archived source files will appear here after you archive them."
                    : files.length
                      ? "Clear filters to view all files, or open Archived Files if the file was archived."
                      : "Upload a CSV, XLSX, PDF, DOCX, PNG, or JPG so Vaeroex can start building source evidence."}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  {files.length && !isArchivedView ? (
                    <Link href="/app/sources" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
                      Clear filters
                    </Link>
                  ) : null}
                  <UploadSourceDrawer folders={folders} />
                  {files.length && !isArchivedView ? (
                    <Link href="/app/sources?view=hidden" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">
                      Show archived files
                    </Link>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <GeneratedInsightsPanel insights={insightItems} />

        <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
          <h2 className="text-base font-semibold text-white">Imports</h2>
          <p className="mt-1 text-sm text-slate-400">Structured rows staged or saved from reviewed CSV/XLSX files.</p>
          <div className="mt-4 space-y-3">
            {imports.slice(0, 5).map((item) => {
              const file = files.find((source) => source.id === item.file_upload_id);

              return (
                <Link key={item.id} href={file ? (`/app/files?file=${file.id}#file-import-actions` as Route) : "/app/files"} className="block rounded-lg border border-white/10 bg-slate-950/45 p-3 transition hover:border-cyan-300/40 hover:bg-cyan-950/30">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-white">{file?.display_name || "Imported source"}</p>
                    <StatusBadge value={importStatusLabel(item.status)} />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {item.import_type.toUpperCase()} · {item.rows_imported}/{item.rows_total} rows saved
                  </p>
                </Link>
              );
            })}
            {!imports.length ? <p className="text-sm leading-6 text-slate-400">No structured imports have been staged yet.</p> : null}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
        <h2 className="text-base font-semibold text-white">What Vaeroex Has Learned</h2>
        <p className="mt-1 text-sm leading-6 text-slate-400">
          Sources currently support {kpis.filter((kpi) => kpi.source_file_id).length} KPI evidence record{kpis.filter((kpi) => kpi.source_file_id).length === 1 ? "" : "s"}, {runs.length} generated file insight{runs.length === 1 ? "" : "s"}, and {reports.filter((report) => isRecord(report.source_data_json)).length} report source connection{reports.filter((report) => isRecord(report.source_data_json)).length === 1 ? "" : "s"}.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/app/intelligence" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Review Intelligence
          </Link>
          <Link href="/app/kpis" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">
            View KPI Evidence
          </Link>
          <Link href="/app/briefings" className="rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-cyan-950/30">
            View Briefings
          </Link>
        </div>
      </section>
    </div>
  );
}
