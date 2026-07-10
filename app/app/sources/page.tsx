import Link from "next/link";
import type { Route } from "next";
import {
  analyzeFileAction,
  approveFileAnalysisAction,
  createReportFromFileAction,
  discardFileAnalysisAction,
  importFileAction,
  uploadFileAction
} from "@/app/app/files/actions";
import { ArchivedFilesBulkActions } from "@/components/operations/ArchivedFilesBulkActions";
import { manageRecordAction } from "@/app/app/operations/record-management-actions";
import { LegalSafetyNotice } from "@/components/legal/LegalSafetyNotice";
import { AnalysisProgressSubmit } from "@/components/operations/AnalysisProgressSubmit";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { TextInput } from "@/components/operations/FormControls";
import { LoadingLink } from "@/components/operations/LoadingLink";
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
  { label: "Needs Review", href: "/app/sources?status=Needs%20Review" },
  { label: "Learned", href: "/app/sources?status=Learned" },
  { label: "Archived", href: "/app/sources?view=hidden" }
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

function fileMetadata(file: FileUploadRow) {
  return isRecord(file.metadata_json) ? file.metadata_json : {};
}

function fileAnalysisOutput(file: FileUploadRow) {
  const metadata = fileMetadata(file);
  return isRecord(metadata.latest_analysis_output) ? metadata.latest_analysis_output : {};
}

function outputList(output: JsonRecord, key: string) {
  const value = output[key];

  return Array.isArray(value)
    ? value
        .map((item) => {
          if (typeof item === "string") return item;
          if (isRecord(item)) {
            return stringValue(item.title) || stringValue(item.name) || stringValue(item.description) || stringValue(item.summary) || stringValue(item.recommendation);
          }

          return String(item || "");
        })
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function analysisReviewStatus(file: FileUploadRow) {
  const metadata = fileMetadata(file);
  return stringValue(metadata.analysis_review_status) || stringValue(metadata.latest_analysis_status);
}

function analysisLearningDecision(file: FileUploadRow) {
  const metadata = fileMetadata(file);
  return isRecord(metadata.analysis_learning_decision) ? metadata.analysis_learning_decision : {};
}

function fileConfidence(file: FileUploadRow, runs: VaeroexRunRow[]) {
  const output = fileAnalysisOutput(file);
  const decision = analysisLearningDecision(file);
  return (
    stringValue(decision.confidenceLabel) ||
    stringValue(output.recommendation_confidence) ||
    stringValue(output.confidence) ||
    stringValue(output.confidence_level) ||
    stringValue(output.analysis_confidence) ||
    (runs[0] ? runConfidence(runs[0]) : "") ||
    (file.analysis_summary ? "Needs confirmation" : "")
  );
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
  if ((file.processing_status || "") === "failed" || latestRun?.status === "failed") return "Failed";
  if (latestRun?.status === "completed" || file.analysis_summary || latestAnalysisAt(file)) return "Needs Review";
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
  const reviewStatus = analysisReviewStatus(file);

  if (file.deleted_at) return "Deleted";
  if (file.archived_at) return "Archived";
  if ((file.processing_status || "") === "processing") return "Analyzing";
  if ((file.processing_status || "") === "failed" || file.import_status === "failed" || reviewStatus === "failed") return "Failed";
  if (reviewStatus === "discarded" || reviewStatus === "excluded") return "Uploaded";
  if (reviewStatus === "approved" || reviewStatus === "auto_learned" || file.index_status === "ready") return "Learned";
  if (reviewStatus === "needs_review" || reviewStatus === "ready_for_review" || reviewStatus === "completed" || analysisStatus(file, runs) === "Needs Review") return "Needs Review";
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
  runsByFile
}: {
  files: FileUploadRow[];
  status?: string;
  query?: string;
  view?: string;
  runsByFile: Map<string, VaeroexRunRow[]>;
}) {
  const normalizedQuery = (query || "").trim().toLowerCase();
  const includeHidden = view === "hidden";

  return files
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

function UploadSourceForm({ folders }: { folders: Pick<FolderRow, "id" | "name">[] }) {
  return (
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
  );
}

function UploadSourceDrawer({ folders, compact = false }: { folders: Pick<FolderRow, "id" | "name">[]; compact?: boolean }) {
  if (compact) {
    return (
      <details className="group relative">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center justify-center rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/60">
          Upload Source
        </summary>
        <div className="absolute right-0 z-30 mt-2 w-[min(34rem,calc(100vw-2rem))] rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-2xl shadow-black/40">
          <div className="mb-4">
            <p className="text-sm font-semibold text-white">Upload Source</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">Reports, spreadsheets, SOPs, notes, and operational files.</p>
          </div>
          <UploadSourceForm folders={folders} />
        </div>
      </details>
    );
  }

  return (
    <CreateDrawer
      title="Upload source file"
      description="Upload reports, KPI spreadsheets, SOPs, meeting notes, financial exports, or operational documents. CSV/XLSX imports always go through review before saving."
      triggerLabel="Upload Source"
    >
      <UploadSourceForm folders={folders} />
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

function SourceFilePrimaryActions({ file, status, selected }: { file: FileUploadRow; status: string; selected: boolean }) {
  if (status === "Analyzing") {
    return (
      <div className="flex shrink-0 items-center justify-end">
        <button disabled className="rounded-md border border-cyan-300/30 bg-cyan-950/35 px-3 py-2 text-xs font-semibold text-cyan-100 opacity-80">
          Analyzing...
        </button>
      </div>
    );
  }

  if (status === "Needs Review") {
    return (
      <div className="flex shrink-0 items-center justify-end">
        <LoadingLink href={`/app/sources?file=${file.id}` as Route} className="rounded-md bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white" loadingLabel="Opening review...">
          Review
        </LoadingLink>
      </div>
    );
  }

  if (status === "Learned") {
    return (
      <div className="flex shrink-0 items-center justify-end">
        <LoadingLink href={`/app/sources?file=${file.id}` as Route} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30" loadingLabel="Opening source...">
          View
        </LoadingLink>
      </div>
    );
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
      <form action={analyzeFileAction}>
        <input type="hidden" name="file_id" value={file.id} />
        <input type="hidden" name="return_path" value="/app/sources" />
        <input
          type="hidden"
          name="analysis_prompt"
          value="Analyze only this source file. Extract source-specific facts, readable text, quantities, status signals, risks, opportunities, possible KPIs, unclear fields, and a concise leadership summary. For inventory images, identify item names, readable quantities, possible shortages, possible overstock, and fields that need confirmation. Do not add generic business advice that is not supported by the file."
        />
        <SourceActionButton pendingLabel="Analyzing file..." steps={ANALYSIS_PROGRESS_STEPS}>
          {status === "Failed" ? "Retry" : "Analyze"}
        </SourceActionButton>
      </form>
      <LoadingLink
        href={`/app/sources?file=${file.id}` as Route}
        className={`rounded-md border px-3 py-2 text-xs font-semibold ${selected ? "border-cyan-300/40 bg-cyan-950/35 text-cyan-50" : "border-white/10 bg-white/[0.04] text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30"}`}
        loadingLabel="Opening file details..."
      >
        {selected ? "Selected" : "View"}
      </LoadingLink>
    </div>
  );
}

function SourceFileActions({
  file,
  access,
  linkedKpis,
  linkedRuns,
  status
}: {
  file: FileUploadRow;
  access?: FileAccessLinks | null;
  linkedKpis: KpiRow[];
  linkedRuns: VaeroexRunRow[];
  status: string;
}) {
  const referenceWarning = linkedKpis.length || linkedRuns.length
    ? ` This file is linked to ${linkedKpis.length} KPI record${linkedKpis.length === 1 ? "" : "s"} and ${linkedRuns.length} generated insight${linkedRuns.length === 1 ? "" : "s"}.`
    : "";

  return (
    <div className="flex flex-wrap gap-2">
      <Link href={`/app/files?file=${file.id}#file-details`} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">
        View Original
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
      {status !== "Uploaded" && status !== "Analyzing" ? (
        <form action={analyzeFileAction}>
          <input type="hidden" name="file_id" value={file.id} />
          <input type="hidden" name="return_path" value="/app/sources" />
          <input
            type="hidden"
            name="analysis_prompt"
            value="Analyze only this source file. Extract source-specific facts, readable text, quantities, status signals, risks, opportunities, possible KPIs, unclear fields, and a concise leadership summary. For inventory images, identify item names, readable quantities, possible shortages, possible overstock, and fields that need confirmation. Do not add generic business advice that is not supported by the file."
          />
          <SourceActionButton pendingLabel="Analyzing again..." steps={ANALYSIS_PROGRESS_STEPS}>
            Analyze Again
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

function SourceFileDetailPanel({
  file,
  access,
  folders,
  fileImports,
  linkedKpis,
  linkedRuns,
  linkedReports,
  actionError
}: {
  file: FileUploadRow;
  access?: FileAccessLinks | null;
  folders: Pick<FolderRow, "id" | "name">[];
  fileImports: FileImportRow[];
  linkedKpis: KpiRow[];
  linkedRuns: VaeroexRunRow[];
  linkedReports: ReportRow[];
  actionError?: string | null;
}) {
  const status = fileStatus(file, linkedRuns);
  const output = fileAnalysisOutput(file);
  const summary = stringValue(output.executive_summary) || stringValue(output.summary) || file.analysis_summary || "No analysis result is available yet.";
  const findings = [
    ...outputList(output, "extracted_findings"),
    ...outputList(output, "findings")
  ].slice(0, 5);
  const risks = outputList(output, "risks").slice(0, 3);
  const opportunities = outputList(output, "opportunities").slice(0, 3);
  const unclearFields = [
    ...outputList(output, "unclear_fields"),
    ...outputList(output, "needs_confirmation")
  ].slice(0, 3);
  const learningDecision = analysisLearningDecision(file);
  const trustLevel = stringValue(learningDecision.trustLevel) || stringValue(fileMetadata(file).business_memory_trust_level);
  const reviewReasons = Array.isArray(learningDecision.reviewReasons) ? learningDecision.reviewReasons.filter((item): item is string => typeof item === "string") : [];
  const latestRunId = stringValue(fileMetadata(file).latest_analysis_run_id) || linkedRuns[0]?.id || "";
  const confidence = fileConfidence(file, linkedRuns);
  const memoryStatus =
    status === "Learned"
      ? trustLevel === "tentative"
        ? "Available to Intelligence as a medium-confidence, directional observation."
        : "Available to Intelligence and Business Memory."
      : status === "Needs Review"
        ? "Not yet available. Review is needed before Business Memory uses it."
        : status === "Failed"
          ? "Not available because analysis failed."
          : "Not yet available in Business Memory.";

  return (
    <aside className="rounded-lg border border-cyan-300/20 bg-[#08111f] p-4 text-slate-100 shadow-panel xl:sticky xl:top-24">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Selected Source</p>
          <h2 className="mt-2 break-words text-lg font-semibold text-white">{file.display_name}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">{file.original_name}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge value={status} />
          <StatusBadge value={file.file_extension.toUpperCase()} />
          {confidence ? <StatusBadge value={`Confidence: ${confidence}`} /> : null}
        </div>
      </div>

      {actionError ? (
        <div className="mt-4 rounded-lg border border-red-400/35 bg-red-950/30 p-3 text-sm leading-6 text-red-100">
          {actionError}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 text-sm">
        <section className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">File preview</p>
          <div className="mt-3 flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-950/25 text-sm font-semibold text-cyan-100">
              {file.file_extension.toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{fileCategory(file, folders)}</p>
              <p className="text-xs text-slate-400">{fileSizeLabel(file.file_size_bytes)} · Uploaded {formatDate(file.created_at)}</p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Analysis Summary</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{summary}</p>
            </div>
          </div>

          {findings.length || risks.length || opportunities.length || unclearFields.length ? (
            <div className="mt-3 grid gap-2">
              {findings.length ? (
                <div>
                  <p className="text-xs font-semibold text-slate-400">Findings</p>
                  <ul className="mt-1 space-y-1 text-xs leading-5 text-slate-300">
                    {findings.map((item) => <li key={item}>- {item}</li>)}
                  </ul>
                </div>
              ) : null}
              {risks.length ? <p className="text-xs leading-5 text-amber-100">Risks: {risks.join("; ")}</p> : null}
              {opportunities.length ? <p className="text-xs leading-5 text-emerald-100">Opportunities: {opportunities.join("; ")}</p> : null}
              {unclearFields.length ? <p className="text-xs leading-5 text-slate-300">Needs confirmation: {unclearFields.join("; ")}</p> : null}
            </div>
          ) : null}

          <p className="mt-3 text-xs text-slate-500">Last analyzed: {formatDateTime(latestAnalysisAt(file))}</p>
        </section>

        <section className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Business Memory</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{memoryStatus}</p>
          {reviewReasons.length ? (
            <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-100">
              {reviewReasons.slice(0, 3).map((reason) => <li key={reason}>- {reason}</li>)}
            </ul>
          ) : null}
          {status === "Needs Review" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={approveFileAnalysisAction}>
                <input type="hidden" name="file_id" value={file.id} />
                <input type="hidden" name="run_id" value={latestRunId} />
                <input type="hidden" name="summary" value={summary} />
                <input type="hidden" name="return_path" value="/app/sources" />
                <PendingSubmitButton pendingLabel="Approving..." className="rounded-md bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
                  Approve Learning
                </PendingSubmitButton>
              </form>
              <LoadingLink href={`/app/files?file=${file.id}#analysis-result` as Route} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30" loadingLabel="Opening correction view...">
                Correct Findings
              </LoadingLink>
              <form action={discardFileAnalysisAction}>
                <input type="hidden" name="file_id" value={file.id} />
                <input type="hidden" name="run_id" value={latestRunId} />
                <input type="hidden" name="return_path" value="/app/sources" />
                <ConfirmSubmitButton
                  message={`Discard the current analysis for "${file.display_name}"? It will not be used in future Vaeroex answers.`}
                  pendingLabel="Discarding..."
                  className="rounded-md border border-red-400/35 bg-red-950/35 px-3 py-2 text-xs font-semibold text-red-100 hover:border-red-300/60 hover:bg-red-950/55"
                >
                  Discard
                </ConfirmSubmitButton>
              </form>
            </div>
          ) : null}
          {status === "Learned" && latestRunId ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <form action={discardFileAnalysisAction}>
                <input type="hidden" name="file_id" value={file.id} />
                <input type="hidden" name="run_id" value={latestRunId} />
                <input type="hidden" name="return_path" value="/app/sources" />
                <ConfirmSubmitButton
                  message={`Remove the current analysis for "${file.display_name}" from active Business Memory? It will not be used in future Vaeroex answers.`}
                  pendingLabel="Removing..."
                  className="rounded-md border border-red-400/35 bg-red-950/35 px-3 py-2 text-xs font-semibold text-red-100 hover:border-red-300/60 hover:bg-red-950/55"
                >
                  Remove from Memory
                </ConfirmSubmitButton>
              </form>
            </div>
          ) : null}
        </section>

        <section className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Actions</p>
          {status === "Uploaded" ? (
            <p className="mt-2 text-sm leading-6 text-slate-400">Use Analyze in the file list to start review.</p>
          ) : null}
          {status === "Analyzing" ? (
            <p className="mt-2 text-sm leading-6 text-cyan-100">Vaeroex is analyzing this source. You can leave and return; the source will keep its processing state.</p>
          ) : null}
          <div className="mt-3">
            <SourceFileActions file={file} access={access} linkedKpis={linkedKpis} linkedRuns={linkedRuns} status={status} />
          </div>
        </section>

        <SourceFileDetails file={file} fileImports={fileImports} linkedKpis={linkedKpis} linkedRuns={linkedRuns} linkedReports={linkedReports} />
      </div>
    </aside>
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
  runs,
  access,
  selectable = false,
  selected = false
}: {
  file: FileUploadRow;
  folders: Pick<FolderRow, "id" | "name">[];
  runs: VaeroexRunRow[];
  access?: FileAccessLinks | null;
  selectable?: boolean;
  selected?: boolean;
}) {
  const linkedRuns = runs.filter((run) => runFileId(run) === file.id);
  const status = fileStatus(file, linkedRuns);

  return (
    <article id={`file-${file.id}`} className={`rounded-lg border p-4 text-slate-100 shadow-panel transition ${selected ? "border-cyan-300/35 bg-cyan-950/20" : "border-white/10 bg-[#08111f] hover:border-cyan-300/25"}`}>
      <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
        {selectable ? (
          <label className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100">
            <input
              type="checkbox"
              name="record_id"
              value={file.id}
              className="h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent"
            />
            <span className="lg:hidden">Select file</span>
          </label>
        ) : null}
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words text-sm font-semibold text-white">{file.display_name}</h3>
            <StatusBadge value={status} />
            <StatusBadge value={file.file_extension.toUpperCase()} />
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            {file.original_name} · {fileSizeLabel(file.file_size_bytes)} · Uploaded {formatDate(file.created_at)}
          </p>
          <p className="mt-2 line-clamp-1 text-xs leading-5 text-slate-400">
            {status === "Needs Review"
              ? "Analysis needs a human check before Business Memory uses it."
              : status === "Learned"
                ? "This source is available to Vaeroex intelligence."
                : file.analysis_summary || fileCategory(file, folders)}
          </p>
        </div>
        <SourceFilePrimaryActions file={file} status={status} selected={selected} />
      </div>

      {isSpreadsheet(file) && file.import_status === "ready" && status === "Uploaded" ? (
        <div className="mt-3 rounded-lg border border-cyan-400/30 bg-cyan-950/30 p-3 text-xs leading-5 text-cyan-50">
          Vaeroex found structured data in this file. You can import it as KPI data after review.
        </div>
      ) : null}
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
    runsByFile
  });
  const linkedFile = params?.file ? files.find((file) => file.id === params.file) : null;
  const selectedFile = linkedFile || visibleFiles[0] || null;
  const activeFilterLabel = params?.status || (params?.view === "hidden" ? "Archived" : "") || params?.q || "";
  const isArchivedView = params?.view === "hidden";
  const successMessage = cleanNoticeMessage(params?.message, "File action completed.");
  const loadErrorMessage = cleanNoticeMessage(errors[0]?.message, "Source data could not be loaded.");
  const actionErrorMessage = cleanNoticeMessage(params?.error, "Source data could not be loaded.");
  const errorMessage = loadErrorMessage || (linkedFile ? null : actionErrorMessage);
  const selectedFileActionError = linkedFile ? actionErrorMessage : null;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-white">Sources</h1>
            <p className="mt-1 text-sm leading-6 text-slate-300">Upload, analyze, and organize business evidence.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="max-w-sm text-xs leading-5 text-slate-400">Reports, spreadsheets, SOPs, notes, and operational files.</p>
            <UploadSourceDrawer folders={folders} compact />
          </div>
        </div>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          <details className="rounded-lg border border-white/10 bg-slate-950/35 px-3 py-2">
            <summary className="cursor-pointer list-none text-xs font-semibold text-cyan-100">
              What is this?
            </summary>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              Sources are business evidence Vaeroex can analyze, reference in briefings, or preserve as Business Memory. Strong evidence is learned automatically; structured imports still require review before records change.
            </p>
          </details>
          <details className="rounded-lg border border-amber-300/25 bg-amber-950/15 px-3 py-2">
            <summary className="cursor-pointer list-none text-xs font-semibold text-amber-100">
              Sensitive information reminder
            </summary>
            <div className="mt-2">
              <LegalSafetyNotice tone="sensitive" compact />
            </div>
          </details>
        </div>
      </section>

      <ErrorNotice message={errorMessage} />
      {successMessage ? (
        <div className="rounded-lg border border-emerald-400/35 bg-emerald-950/30 p-3 text-sm text-emerald-100">
          {successMessage}
        </div>
      ) : null}

      <section className="space-y-3">
        <nav className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto rounded-lg border border-white/10 bg-[#08111f] p-2 shadow-sm" aria-label="Source file views">
          {fileStatusTabs.map((tab) => {
            const active =
              (!params?.status && !params?.view && tab.href === "/app/sources") ||
              (params?.status && tab.href.toLowerCase().includes(`status=${encodeURIComponent(params.status).replace(/%20/g, "%20")}`.toLowerCase())) ||
              (params?.view && tab.href.includes(`view=${params.view}`));

            return (
              <LoadingLink
                key={tab.href}
                href={tab.href as Route}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold ${active ? "bg-vaeroex-blue text-white" : "border border-white/10 bg-white/[0.04] text-slate-100 hover:border-vaeroex-accent/40 hover:bg-cyan-950/30"}`}
                loadingLabel={tab.label === "Archived" ? "Loading archived files..." : `Loading ${tab.label.toLowerCase()}...`}
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

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(24rem,0.85fr)]">
          <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-white">Files</h2>
                <p className="mt-1 text-sm text-slate-400">Select a source to inspect details, analysis status, and available actions.</p>
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
                          runs={runs}
                          access={accessByFileId.get(file.id)}
                          selectable
                          selected={selectedFile?.id === file.id}
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
                      runs={runs}
                      access={accessByFileId.get(file.id)}
                      selected={selectedFile?.id === file.id}
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

          {selectedFile ? (() => {
            const linkedKpis = kpis.filter((kpi) => kpi.source_file_id === selectedFile.id);
            const linkedRuns = runs.filter((run) => runFileId(run) === selectedFile.id);
            const linkedReports = reportsForFile(reports, selectedFile.id);
            const fileImports = imports.filter((item) => item.file_upload_id === selectedFile.id);

            return (
              <SourceFileDetailPanel
                file={selectedFile}
                folders={folders}
                fileImports={fileImports}
                linkedKpis={linkedKpis}
                linkedRuns={linkedRuns}
                linkedReports={linkedReports}
                access={accessByFileId.get(selectedFile.id)}
                actionError={selectedFileActionError}
              />
            );
          })() : (
            <aside className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-sm leading-6 text-slate-400 shadow-panel">
              Select a source to view analysis status, evidence, and actions.
            </aside>
          )}
        </div>
      </section>

    </div>
  );
}
