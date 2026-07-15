import Link from "next/link";
import type { Route } from "next";
import { permanentRedirect } from "next/navigation";
import {
  analyzeFileAction,
  approveFileAnalysisAction,
  discardFileAnalysisAction,
  manageLearnedKnowledgeAction,
  manageSourceFileAction,
  uploadFileAction
} from "@/app/app/files/actions";
import { LegalSafetyNotice } from "@/components/legal/LegalSafetyNotice";
import { AnalysisProgressSubmit } from "@/components/operations/AnalysisProgressSubmit";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { filterEligibleMemoryRowsByLifecycle } from "@/lib/ai/evidence-index";
import { TextInput } from "@/components/operations/FormControls";
import { LoadingLink } from "@/components/operations/LoadingLink";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { SourceImportReview } from "@/components/evidence/SourceImportReview";
import { createFileAccessLinkMap, type FileAccessLinks } from "@/lib/files/storage-links";
import { getRecordFolders } from "@/lib/records/management";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type SourceSearchParams = {
  error?: string;
  message?: string;
  status?: string;
  q?: string;
  file?: string;
  view?: string;
  tab?: string;
  trust?: string;
  source_type?: string;
  sort?: string;
  section?: string;
  panel?: string;
};

type SourcesPageProps = {
  searchParams?: Promise<SourceSearchParams>;
};

type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type FileImportDataRow = Database["public"]["Tables"]["file_import_rows"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type FolderRow = Database["public"]["Tables"]["record_folders"]["Row"];
type MemoryChunkRow = Database["public"]["Tables"]["business_memory_chunks"]["Row"];
type JsonRecord = Record<string, unknown>;
type SourcesTab = "files" | "knowledge" | "archived";
type SourceDetailSection = "summary" | "findings" | "imported" | "history";

const ANALYSIS_PROGRESS_STEPS = ["Reading file", "Extracting key information", "Identifying business signals", "Checking KPI/import opportunities", "Saving analysis", "Done"];
const UPLOAD_PROGRESS_STEPS = ["Uploading file", "Saving securely", "Preparing source record", "Refreshing Sources", "Complete"];
const sourceTabs: Array<{ key: SourcesTab; label: string; href: Route }> = [
  { key: "files", label: "Active Sources", href: "/app/sources" },
  { key: "knowledge", label: "Learned Knowledge", href: "/app/sources?tab=knowledge" },
  { key: "archived", label: "Archived", href: "/app/sources?tab=archived" }
];

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

function normalizeSourcesTab(tab?: string | null, legacyView?: string | null): SourcesTab {
  if (tab === "knowledge" || tab === "learned") return "knowledge";
  if (tab === "archived" || legacyView === "hidden") return "archived";
  return "files";
}

function normalizeSourceDetailSection(value?: string | null): SourceDetailSection {
  if (value === "findings" || value === "analysis-result" || value === "intelligence") return "findings";
  if (value === "imported" || value === "import" || value === "mapping-review") return "imported";
  if (value === "history") return "history";
  return "summary";
}

function sourceDetailHref(fileId: string, section: SourceDetailSection = "summary") {
  const suffix = section === "summary" ? "" : `?section=${section}`;
  return `/app/sources/${encodeURIComponent(fileId)}${suffix}` as Route;
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

function latestAnalysisFailure(file: FileUploadRow) {
  const metadata = fileMetadata(file);
  return isRecord(metadata.latest_analysis_failure) ? metadata.latest_analysis_failure : {};
}

function latestAnalysisFailureMessage(file: FileUploadRow) {
  const metadata = fileMetadata(file);
  const failure = latestAnalysisFailure(file);
  return stringValue(failure.user_message) || stringValue(metadata.latest_analysis_error) || file.processing_error || "";
}

function failedAnalysisStatus(file: FileUploadRow) {
  const failureType = stringValue(latestAnalysisFailure(file).type);

  if (failureType === "blank_template" || failureType === "no_usable_data") return "No usable data found";
  if (failureType === "needs_clearer_file") return "Needs clearer file";
  return "Analysis failed";
}

function analysisStatus(file: FileUploadRow, runs: VaeroexRunRow[]) {
  const latestRun = runs[0];
  const runIsActive = latestRun && ["queued", "pending", "running", "processing"].includes(latestRun.status);
  const hasCompletedAnalysis = latestRun?.status === "completed" || Boolean(file.analysis_summary || latestAnalysisAt(file));

  if (runIsActive) return "Analyzing";
  if ((file.processing_status || "") === "failed" || latestRun?.status === "failed") return failedAnalysisStatus(file);
  if (hasCompletedAnalysis) return "Needs Review";
  return "Not reviewed";
}

function importStatusLabel(value: string) {
  if (value === "ready") return "Import Review";
  if (value === "extracted" || value === "needs_review") return "Import Review";
  if (value === "imported") return "Imported";
  if (value === "failed") return "Error";
  return "Not imported";
}

function fileStatus(file: FileUploadRow, runs: VaeroexRunRow[]) {
  const reviewStatus = analysisReviewStatus(file);
  const latestRun = runs[0];
  const runIsActive = latestRun && ["queued", "pending", "running", "processing"].includes(latestRun.status);
  const hasUsableAnalysis = Boolean(file.analysis_summary) || ["approved", "auto_learned", "needs_review", "ready_for_review", "completed"].includes(reviewStatus);

  if (file.deleted_at) return "Deleted";
  if (file.archived_at) return "Archived";
  if (runIsActive) return "Analyzing";
  if (file.import_status === "failed" && latestRun?.status !== "failed" && reviewStatus !== "failed" && !hasUsableAnalysis) return "Import failed";
  if ((file.import_status !== "failed" && (file.processing_status || "") === "failed") || latestRun?.status === "failed" || reviewStatus === "failed") return failedAnalysisStatus(file);
  if (reviewStatus === "discarded" || reviewStatus === "excluded") return "Uploaded";
  if (reviewStatus === "approved" || reviewStatus === "auto_learned" || file.index_status === "ready") return "Learned";
  if (reviewStatus === "needs_review" || reviewStatus === "ready_for_review") return "Needs Review";
  if (file.import_status === "extracted" || file.import_status === "needs_review" || (isSpreadsheet(file) && file.import_status === "ready")) return "Import Review";
  if (reviewStatus === "completed" || analysisStatus(file, runs) === "Needs Review") return "Ready";
  if (file.import_status === "failed") return "Import failed";
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
      <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-slate-950/45 p-3 text-xs leading-5 text-slate-300">
        <input name="allow_duplicate" type="checkbox" className="mt-0.5 h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent" />
        <span>
          Upload anyway if this is a duplicate source. Vaeroex warns when the file name, type, and size match an existing active source.
        </span>
      </label>
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

function SourceFilePrimaryActions({ file }: { file: FileUploadRow }) {
  return (
    <div className="flex w-full shrink-0 sm:w-auto sm:justify-end">
      <LoadingLink
        href={sourceDetailHref(file.id)}
        className="inline-flex min-h-11 w-full min-w-32 items-center justify-center whitespace-nowrap rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 sm:w-auto"
        loadingLabel="Opening source..."
      >
        Open source
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
      {access?.viewUrl ? <a href={access.viewUrl} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">Preview original</a> : null}
      {access?.downloadUrl ? <a href={access.downloadUrl} download={file.original_name} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">Download original</a> : null}
      {status !== "Archived" && isSpreadsheet(file) ? (
        <LoadingLink href={sourceDetailHref(file.id, "imported")} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30" loadingLabel="Opening imported data...">Review imported data</LoadingLink>
      ) : null}
      {status !== "Archived" && status !== "Analyzing" && !isSpreadsheet(file) ? (
        <form action={analyzeFileAction}>
          <input type="hidden" name="file_id" value={file.id} />
          <input type="hidden" name="return_path" value="/app/sources" />
          <input
            type="hidden"
            name="analysis_prompt"
            value="Analyze only this source file. Extract source-specific facts, readable text, quantities, status signals, risks, opportunities, possible KPIs, unclear fields, and a concise leadership summary. For inventory images, identify item names, readable quantities, possible shortages, possible overstock, and fields that need confirmation. Do not add generic business advice that is not supported by the file."
          />
          <SourceActionButton pendingLabel="Analyzing source..." steps={ANALYSIS_PROGRESS_STEPS}>
            {status === "Uploaded"
              ? "Analyze source"
              : ["Analysis failed", "Import failed", "No usable data found", "Needs clearer file"].includes(status)
                ? "Retry analysis"
                : "Analyze again"}
          </SourceActionButton>
        </form>
      ) : null}
      <details className="relative">
        <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">More</summary>
        <div className="absolute right-0 z-20 mt-2 grid min-w-52 gap-2 rounded-lg border border-white/10 bg-[#08111f] p-3 shadow-2xl">
          <form action={manageSourceFileAction}>
            <input type="hidden" name="file_id" value={file.id} />
            <input type="hidden" name="source_action" value={file.archived_at ? "restore" : "archive"} />
            <input type="hidden" name="return_path" value={file.archived_at ? sourceDetailHref(file.id) : "/app/sources?tab=archived"} />
            <ConfirmSubmitButton message={file.archived_at ? `Restore "${file.display_name}" to current Sources?` : `Archive "${file.display_name}"? It will leave current views but remain available as historical context.`} pendingLabel={file.archived_at ? "Restoring..." : "Archiving..."} className="w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-slate-100 hover:bg-cyan-950/30">
              {file.archived_at ? "Restore" : "Archive"}
            </ConfirmSubmitButton>
          </form>
          <form action={manageSourceFileAction}>
            <input type="hidden" name="file_id" value={file.id} />
            <input type="hidden" name="source_action" value="delete" />
            <input type="hidden" name="return_path" value={file.archived_at ? "/app/sources?tab=archived" : "/app/sources"} />
            <ConfirmSubmitButton message={`Delete this file from current Sources? This uses a workspace-safe soft delete and may remove supporting evidence from active views.${referenceWarning}`} pendingLabel="Deleting file..." className="w-full rounded-md px-3 py-2 text-left text-xs font-semibold text-red-200 hover:bg-red-950/35">
              Delete File
            </ConfirmSubmitButton>
          </form>
        </div>
      </details>
    </div>
  );
}

function SourceFileDetailPanel({
  file,
  access,
  folders,
  fileImports,
  fileImportRows,
  linkedKpis,
  linkedRuns,
  linkedReports,
  actionError,
  activeSection = "summary"
}: {
  file: FileUploadRow;
  access?: FileAccessLinks | null;
  folders: Pick<FolderRow, "id" | "name">[];
  fileImports: FileImportRow[];
  fileImportRows: FileImportDataRow[];
  linkedKpis: KpiRow[];
  linkedRuns: VaeroexRunRow[];
  linkedReports: ReportRow[];
  actionError?: string | null;
  activeSection?: SourceDetailSection;
}) {
  const status = fileStatus(file, linkedRuns);
  const output = fileAnalysisOutput(file);
  const failureMessage = latestAnalysisFailureMessage(file);
  const summary =
    ["Analysis failed", "Import failed", "No usable data found", "Needs clearer file"].includes(status) && failureMessage
      ? failureMessage
      : stringValue(output.executive_summary) || stringValue(output.summary) || file.analysis_summary || "No analysis result is available yet.";
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
        : "Available to Intelligence and Learned Knowledge."
      : status === "Needs Review"
        ? "Not yet available. Review is needed before Vaeroex uses it."
        : status === "No usable data found"
          ? "Not available because no supported business records were found."
          : status === "Needs clearer file"
            ? "Not available because the source could not be read reliably."
            : status === "Analysis failed" || status === "Import failed"
          ? status === "Import failed"
            ? "Not available because no structured rows were approved."
            : "Not available because analysis failed."
          : "Not yet available in Learned Knowledge.";
  const visibleActionError = actionError && actionError !== failureMessage ? actionError : null;

  const sections: Array<{ key: SourceDetailSection; label: string }> = [
    { key: "summary", label: "Summary" },
    ...(findings.length || risks.length || opportunities.length || unclearFields.length ? [{ key: "findings" as const, label: "Findings" }] : []),
    ...(isSpreadsheet(file) || fileImports.length ? [{ key: "imported" as const, label: "Imported Data" }] : []),
    ...(linkedRuns.length || fileImports.length || linkedReports.length ? [{ key: "history" as const, label: "History" }] : [])
  ];
  const visibleSection = sections.some((section) => section.key === activeSection) ? activeSection : "summary";
  const returnPath = sourceDetailHref(file.id, visibleSection);

  return (
    <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel sm:p-5">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="break-words text-xl font-semibold text-white sm:text-2xl">{file.display_name}</h1>
            <StatusBadge value={status} />
          </div>
          <p className="mt-2 break-all text-sm leading-6 text-slate-400">{file.original_name}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {file.file_extension.toUpperCase()} · {fileSizeLabel(file.file_size_bytes)} · Uploaded {formatDate(file.created_at)}
          </p>
        </div>
        {confidence ? <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-300">Confidence: {confidence}</span> : null}
      </div>

      <nav className="vaeroex-mobile-safe-scroll mt-4 flex gap-2 overflow-x-auto" aria-label="Source detail views">
        {sections.map((section) => (
          <LoadingLink
            key={section.key}
            href={sourceDetailHref(file.id, section.key)}
            className={`inline-flex min-h-10 items-center whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold ${visibleSection === section.key ? "bg-vaeroex-blue text-white" : "border border-white/10 bg-white/[0.04] text-slate-200 hover:border-cyan-300/40 hover:bg-cyan-950/30"}`}
            loadingLabel={`Opening ${section.label.toLowerCase()}...`}
          >
            {section.label}
          </LoadingLink>
        ))}
      </nav>

      {visibleActionError ? (
        <div className="mt-4 rounded-lg border border-red-400/35 bg-red-950/30 p-3 text-sm leading-6 text-red-100">
          {visibleActionError}
        </div>
      ) : null}

      {visibleSection === "summary" ? (
        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div className="space-y-4">
            <section className={`rounded-lg border p-4 ${status === "Analysis failed" || status === "Import failed" ? "border-red-400/30 bg-red-950/20" : status === "No usable data found" || status === "Needs clearer file" ? "border-amber-300/25 bg-amber-950/15" : "border-white/10 bg-slate-950/40"}`}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {["Analysis failed", "Import failed", "No usable data found", "Needs clearer file"].includes(status) ? (status === "Import failed" ? "Import result" : "Analysis result") : "Analysis summary"}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{summary}</p>
              <p className="mt-3 text-xs text-slate-500">Last analyzed: {formatDateTime(latestAnalysisAt(file))}</p>
            </section>
            <section className="rounded-lg border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Business Memory status</p>
              <p className="mt-2 text-sm leading-6 text-slate-300">{memoryStatus}</p>
              {reviewReasons.length ? <ul className="mt-2 space-y-1 text-xs leading-5 text-amber-100">{reviewReasons.slice(0, 3).map((reason) => <li key={reason}>- {reason}</li>)}</ul> : null}
              {status === "Needs Review" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <form action={approveFileAnalysisAction}>
                    <input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="run_id" value={latestRunId} /><input type="hidden" name="summary" value={summary} /><input type="hidden" name="return_path" value={returnPath} />
                    <PendingSubmitButton pendingLabel="Approving..." className="rounded-md bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">Approve learning</PendingSubmitButton>
                  </form>
                  <form action={discardFileAnalysisAction}>
                    <input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="run_id" value={latestRunId} /><input type="hidden" name="return_path" value={returnPath} />
                    <ConfirmSubmitButton message={`Discard the current analysis for "${file.display_name}"? It will not be used in future Vaeroex answers.`} pendingLabel="Discarding..." className="rounded-md border border-red-400/35 bg-red-950/35 px-3 py-2 text-xs font-semibold text-red-100">Discard analysis</ConfirmSubmitButton>
                  </form>
                </div>
              ) : null}
            </section>
          </div>
          <div>
            <section className="rounded-lg border border-white/10 bg-slate-950/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Source actions</p>
              <p className="mt-2 text-sm font-semibold text-white">{fileCategory(file, folders)}</p>
              {status === "Analyzing" ? <p className="mt-2 text-sm leading-6 text-cyan-100">Vaeroex is analyzing this source.</p> : null}
              <div className="mt-3"><SourceFileActions file={file} access={access} linkedKpis={linkedKpis} linkedRuns={linkedRuns} status={status} /></div>
              {!access?.viewUrl ? <p className="mt-3 text-xs leading-5 text-slate-400">Original file preview is unavailable.{access?.downloadUrl ? " Download the file to review it." : " View source details below or retry later."}</p> : null}
              <details className="mt-3 border-t border-white/10 pt-3"><summary className="cursor-pointer text-xs font-semibold text-cyan-100">View source details</summary><div className="mt-3 grid gap-2 text-xs text-slate-400"><p>Processing: {(file.processing_status || "uploaded").replace(/_/g, " ")}</p><p>Import: {importStatusLabel(file.import_status)}</p><p>Rows imported: {file.imported_rows}</p><p>Updated: {formatDateTime(file.updated_at)}</p></div></details>
            </section>
          </div>
        </div>
      ) : null}

      {visibleSection === "findings" ? (
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <section className="rounded-lg border border-white/10 bg-slate-950/40 p-4"><h2 className="text-sm font-semibold text-white">Findings</h2>{findings.length ? <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">{findings.map((item) => <li key={item}>- {item}</li>)}</ul> : <p className="mt-2 text-sm text-slate-400">No supported findings were saved.</p>}</section>
          <section className="rounded-lg border border-white/10 bg-slate-950/40 p-4"><h2 className="text-sm font-semibold text-white">Intelligence created</h2>{risks.length ? <p className="mt-3 text-sm leading-6 text-amber-100">Risks: {risks.join("; ")}</p> : null}{opportunities.length ? <p className="mt-3 text-sm leading-6 text-emerald-100">Opportunities: {opportunities.join("; ")}</p> : null}{unclearFields.length ? <p className="mt-3 text-sm leading-6 text-slate-300">Needs confirmation: {unclearFields.join("; ")}</p> : null}</section>
        </div>
      ) : null}

      {visibleSection === "imported" ? (
        <div className="mt-5">
          {status === "Archived" ? (
            <div className="rounded-lg border border-white/10 bg-slate-950/45 p-4 text-sm leading-6 text-slate-400">Restore this source before preparing or approving imported data.</div>
          ) : (
            <SourceImportReview file={file} imports={fileImports} rows={fileImportRows} />
          )}
        </div>
      ) : null}

      {visibleSection === "history" ? <div className="mt-5"><SourceFileDetails file={file} fileImports={fileImports} linkedKpis={linkedKpis} linkedRuns={linkedRuns} linkedReports={linkedReports} /></div> : null}
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
                <Link key={report.id} href={`/app/reports/${report.id}` as Route} className="block text-sm font-semibold text-cyan-100 hover:text-white">
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
  selectable = false
}: {
  file: FileUploadRow;
  folders: Pick<FolderRow, "id" | "name">[];
  runs: VaeroexRunRow[];
  selectable?: boolean;
}) {
  const linkedRuns = runs.filter((run) => runFileId(run) === file.id);
  const status = fileStatus(file, linkedRuns);

  return (
    <article id={`file-${file.id}`} className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel transition hover:border-cyan-300/25">
      <div className={`grid gap-4 sm:items-center ${selectable ? "sm:grid-cols-[auto_minmax(0,1fr)_auto]" : "sm:grid-cols-[minmax(0,1fr)_auto]"}`}>
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
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            {file.original_name} · {fileSizeLabel(file.file_size_bytes)} · Uploaded {formatDate(file.created_at)}
          </p>
          <p className="mt-2 line-clamp-1 text-xs leading-5 text-slate-400">
            {status === "Needs Review"
              ? "Analysis needs a human check before Vaeroex uses it."
              : status === "Learned"
                ? "This source is available to Vaeroex intelligence."
                : file.analysis_summary || fileCategory(file, folders)}
          </p>
        </div>
        <SourceFilePrimaryActions file={file} />
      </div>

      {isSpreadsheet(file) && file.import_status === "ready" && status === "Import Review" ? (
        <div className="mt-3 rounded-lg border border-cyan-400/30 bg-cyan-950/30 p-3 text-xs leading-5 text-cyan-50">
          Vaeroex found structured data in this file. You can import it as KPI data after review.
        </div>
      ) : null}
    </article>
  );
}

function knowledgeMetadata(chunk: MemoryChunkRow) {
  return isRecord(chunk.source_metadata) ? chunk.source_metadata : {};
}

function knowledgeTrustStatus(chunk: MemoryChunkRow) {
  if (chunk.deleted_at || chunk.archived_at) return "Archived";

  const metadata = knowledgeMetadata(chunk);
  const trustLevel = stringValue(metadata.trust_level);
  const reviewStatus = stringValue(metadata.review_status);
  const confidenceLabel = stringValue(metadata.confidence_label).toLowerCase();

  if (reviewStatus === "needs_review" || trustLevel === "needs_review") return "Needs Review";
  if (trustLevel === "trusted" || confidenceLabel === "high" || chunk.confidence_score >= 80) return "Trusted";
  if (trustLevel === "tentative" || confidenceLabel === "medium" || chunk.confidence_score >= 45) return "Directional";
  return "Needs Review";
}

function knowledgeStatement(chunk: MemoryChunkRow) {
  return stringValue(chunk.summary) || stringValue(chunk.source_excerpt) || "Learned business context from source evidence.";
}

function knowledgeSourceType(chunk: MemoryChunkRow) {
  const metadata = knowledgeMetadata(chunk);
  const extension = stringValue(metadata.file_extension).toUpperCase();
  if (extension) return extension;
  return chunk.source_type.replace(/_/g, " ");
}

function sourceFileForKnowledge(chunk: MemoryChunkRow, files: FileUploadRow[]) {
  return files.find((file) => file.id === chunk.source_file_id || file.id === chunk.source_id) || null;
}

function filterKnowledgeItems({
  chunks,
  files,
  query,
  trust,
  sourceType,
  sort,
  archivedOnly = false
}: {
  chunks: MemoryChunkRow[];
  files: FileUploadRow[];
  query?: string;
  trust?: string;
  sourceType?: string;
  sort?: string;
  archivedOnly?: boolean;
}) {
  const normalizedQuery = (query || "").trim().toLowerCase();
  const normalizedSourceType = (sourceType || "").trim().toLowerCase();

  return chunks
    .filter((chunk) => (archivedOnly ? Boolean(chunk.archived_at && !chunk.deleted_at) : !chunk.archived_at && !chunk.deleted_at))
    .filter((chunk) => !trust || knowledgeTrustStatus(chunk) === trust)
    .filter((chunk) => !normalizedSourceType || knowledgeSourceType(chunk).toLowerCase() === normalizedSourceType)
    .filter((chunk) => {
      if (!normalizedQuery) return true;
      const file = sourceFileForKnowledge(chunk, files);
      return [knowledgeStatement(chunk), chunk.source_title, chunk.source_excerpt, file?.display_name, file?.original_name, knowledgeSourceType(chunk)]
        .some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
    })
    .sort((a, b) => {
      if (sort === "oldest") return a.indexed_at.localeCompare(b.indexed_at);
      return b.indexed_at.localeCompare(a.indexed_at);
    });
}

function KnowledgeActions({
  item,
  sourceFile,
  archived = false
}: {
  item: MemoryChunkRow;
  sourceFile?: FileUploadRow | null;
  archived?: boolean;
}) {
  const returnPath = archived ? "/app/sources?tab=archived" : "/app/sources?tab=knowledge";

  return (
    <div className="flex flex-wrap gap-2">
      {sourceFile ? (
        <LoadingLink href={sourceDetailHref(sourceFile.id)} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30" loadingLabel="Opening source...">
          View Source
        </LoadingLink>
      ) : null}
      {sourceFile ? (
        <LoadingLink href={sourceDetailHref(sourceFile.id, "findings")} className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30" loadingLabel="Opening findings...">
          Correct
        </LoadingLink>
      ) : null}
      <details className="relative">
        <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">
          View Details
        </summary>
        <div className="absolute right-0 z-20 mt-2 w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-white/10 bg-[#08111f] p-4 text-xs leading-5 text-slate-300 shadow-2xl shadow-black/40">
          <p className="font-semibold text-white">Evidence excerpt</p>
          <p className="mt-2">{item.source_excerpt}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <p>Trust: {knowledgeTrustStatus(item)}</p>
            <p>Source: {item.source_title}</p>
            <p>Created: {formatDateTime(item.created_at)}</p>
            <p>Updated: {formatDateTime(item.updated_at)}</p>
          </div>
        </div>
      </details>
      {archived ? (
        <form action={manageLearnedKnowledgeAction}>
          <input type="hidden" name="knowledge_id" value={item.id} />
          <input type="hidden" name="knowledge_action" value="restore" />
          <input type="hidden" name="return_path" value={returnPath} />
          <PendingSubmitButton pendingLabel="Restoring..." className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30">
            Restore
          </PendingSubmitButton>
        </form>
      ) : (
        <form action={manageLearnedKnowledgeAction}>
          <input type="hidden" name="knowledge_id" value={item.id} />
          <input type="hidden" name="knowledge_action" value="archive" />
          <input type="hidden" name="return_path" value={returnPath} />
          <ConfirmSubmitButton
            message="Archive this learned knowledge? It will be excluded from future Vaeroex answers."
            pendingLabel="Archiving..."
            className="rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30"
          >
            Archive
          </ConfirmSubmitButton>
        </form>
      )}
      <form action={manageLearnedKnowledgeAction}>
        <input type="hidden" name="knowledge_id" value={item.id} />
        <input type="hidden" name="knowledge_action" value="delete" />
        <input type="hidden" name="return_path" value={returnPath} />
        <ConfirmSubmitButton
          message="Delete this learned knowledge? This removes it from future Vaeroex answers."
          pendingLabel="Deleting..."
          className="rounded-md border border-red-400/35 bg-red-950/35 px-3 py-2 text-xs font-semibold text-red-100 hover:border-red-300/60 hover:bg-red-950/55"
        >
          Delete
        </ConfirmSubmitButton>
      </form>
    </div>
  );
}

function LearnedKnowledgeView({
  items,
  files,
  params,
  archived = false
}: {
  items: MemoryChunkRow[];
  files: FileUploadRow[];
  params?: SourceSearchParams;
  archived?: boolean;
}) {
  const sourceTypes = Array.from(new Set(items.map(knowledgeSourceType))).sort((a, b) => a.localeCompare(b));
  const visibleItems = filterKnowledgeItems({
    chunks: items,
    files,
    query: params?.q,
    trust: params?.trust,
    sourceType: params?.source_type,
    sort: params?.sort,
    archivedOnly: archived
  });

  return (
    <section className="space-y-4 rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">{archived ? "Archived Knowledge" : "Learned Knowledge"}</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
            {archived
              ? "Learned knowledge that is no longer active in Vaeroex answers."
              : "Everything Vaeroex has learned from your business information."}
          </p>
        </div>
        <StatusBadge value={`${visibleItems.length} showing`} />
      </div>

      <form method="get" className="grid gap-2 lg:grid-cols-[minmax(14rem,1fr)_170px_170px_150px_auto]">
        <input type="hidden" name="tab" value={archived ? "archived" : "knowledge"} />
        <input
          name="q"
          defaultValue={params?.q || ""}
          placeholder="Search learned knowledge..."
          className="min-h-11 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
        />
        <select name="trust" defaultValue={params?.trust || ""} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
          <option value="">All trust levels</option>
          {["Trusted", "Directional", "Needs Review", "Archived"].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select name="source_type" defaultValue={params?.source_type || ""} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
          <option value="">All source types</option>
          {sourceTypes.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <select name="sort" defaultValue={params?.sort || "newest"} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="recently_used">Recently used</option>
        </select>
        <PendingSubmitButton pendingLabel="Filtering..." className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
          Apply
        </PendingSubmitButton>
      </form>

      <div className="space-y-3">
        {visibleItems.length ? (
          visibleItems.map((item) => {
            const sourceFile = sourceFileForKnowledge(item, files);
            const trust = knowledgeTrustStatus(item);

            return (
              <article key={item.id} className="rounded-lg border border-white/10 bg-slate-950/35 p-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge value={trust} />
                      <StatusBadge value={knowledgeSourceType(item)} />
                      {item.archived_at || item.deleted_at ? <StatusBadge value="Inactive" /> : <StatusBadge value="Active" />}
                    </div>
                    <p className="mt-3 text-sm font-semibold leading-6 text-white">{knowledgeStatement(item)}</p>
                    <p className="mt-2 text-xs leading-5 text-slate-400">
                      Source: {sourceFile?.display_name || item.source_title} · Created {formatDateTime(item.created_at)} · Updated {formatDateTime(item.updated_at)}
                    </p>
                  </div>
                  <KnowledgeActions item={item} sourceFile={sourceFile} archived={archived || Boolean(item.archived_at || item.deleted_at)} />
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/45 p-8 text-center">
            <h3 className="text-lg font-semibold text-white">{archived ? "No archived knowledge." : "No learned knowledge yet."}</h3>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
              {archived
                ? "Archived knowledge appears here with restore and delete actions. Deleted knowledge is removed from this view."
                : "Analyze a trusted source and Vaeroex will add supported findings here automatically when confidence is high or directional."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export async function renderSourcesPage(params: SourceSearchParams = {}, options: { sourceDetail?: boolean } = {}) {
  const { supabase, workspaceId } = await requireWorkspacePage();
  const activeTab = options.sourceDetail ? "files" : normalizeSourcesTab(params.tab, params.view);
  const importRowsQuery = options.sourceDetail && params.file
    ? supabase
        .from("file_import_rows")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("file_upload_id", params.file)
        .eq("status", "staged")
        .order("row_number", { ascending: true })
        .limit(2000)
    : Promise.resolve({ data: [], error: null });
  const [filesResult, foldersResult, importsResult, importRowsResult, reportsResult, kpisResult, runsResult, memoryResult] = await Promise.all([
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "files"),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    importRowsQuery,
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(300),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("metric_date", { ascending: false }).limit(500),
    supabase
      .from("ai_agent_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("agent_type", "file_analysis")
      .is("deleted_at", null)
      .is("archived_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("business_memory_chunks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("indexed_at", { ascending: false })
      .limit(300)
  ]);

  const files = (filesResult.data || []) as FileUploadRow[];
  const folders = foldersResult.folders as Pick<FolderRow, "id" | "name">[];
  const imports = (importsResult.data || []) as FileImportRow[];
  const importRows = (importRowsResult.data || []) as FileImportDataRow[];
  const reports = (reportsResult.data || []) as ReportRow[];
  const kpis = (kpisResult.data || []) as KpiRow[];
  const runs = (runsResult.data || []) as VaeroexRunRow[];
  const rawMemoryChunks = (memoryResult.data || []) as MemoryChunkRow[];
  const activeMemoryChunks = await filterEligibleMemoryRowsByLifecycle({
    supabase,
    workspaceId,
    rows: rawMemoryChunks.filter((chunk) => !chunk.deleted_at && !chunk.archived_at)
  }) as MemoryChunkRow[];
  const memoryChunks = [
    ...activeMemoryChunks,
    ...rawMemoryChunks.filter((chunk) => chunk.archived_at && !chunk.deleted_at)
  ];
  const accessByFileId = await createFileAccessLinkMap(supabase, options.sourceDetail && params.file ? files.filter((file) => file.id === params.file) : []);
  const runsByFile = new Map<string, VaeroexRunRow[]>();

  runs.forEach((run) => {
    const fileId = runFileId(run);
    if (!fileId) return;
    runsByFile.set(fileId, [...(runsByFile.get(fileId) || []), run]);
  });

  const errors = [filesResult.error, foldersResult.error, importsResult.error, importRowsResult.error, reportsResult.error, kpisResult.error, runsResult.error, memoryResult.error].filter(Boolean);
  const visibleFiles = filteredFiles({
    files,
    status: params.status,
    query: params.q,
    view: activeTab === "archived" ? "hidden" : params.view,
    runsByFile
  });
  const linkedFile = params.file ? files.find((file) => file.id === params.file && !file.deleted_at) : null;
  const activeFilterLabel = params.status || (activeTab === "archived" ? "Archived" : "") || params.q || params.trust || params.source_type || "";
  const isArchivedView = activeTab === "archived";
  const successMessage = cleanNoticeMessage(params.message, "File action completed.");
  const loadErrorMessage = cleanNoticeMessage(errors[0]?.message, "Source data could not be loaded.");
  const actionErrorMessage = cleanNoticeMessage(params.error, "Source data could not be loaded.");
  const errorMessage = loadErrorMessage || (linkedFile ? null : actionErrorMessage);
  const selectedFileActionError = linkedFile ? actionErrorMessage : null;

  if (options.sourceDetail) {
    const activeSection = normalizeSourceDetailSection(params.section);
    const linkedKpis = linkedFile ? kpis.filter((kpi) => kpi.source_file_id === linkedFile.id) : [];
    const linkedRuns = linkedFile ? runs.filter((run) => runFileId(run) === linkedFile.id) : [];
    const linkedReports = linkedFile ? reportsForFile(reports, linkedFile.id) : [];
    const fileImports = linkedFile ? imports.filter((item) => item.file_upload_id === linkedFile.id) : [];
    const fileImportRows = linkedFile ? importRows.filter((item) => item.file_upload_id === linkedFile.id) : [];

    return (
      <div className="evidence-workspace space-y-4">
        <nav className="flex min-w-0 items-center gap-2 overflow-hidden text-sm text-slate-400" aria-label="Breadcrumb">
          <LoadingLink href="/app/sources" className="shrink-0 font-semibold text-cyan-100 hover:text-white" loadingLabel="Opening Evidence...">Evidence</LoadingLink>
          <span aria-hidden="true">/</span>
          <span className="truncate text-slate-300">{linkedFile?.display_name || "Source unavailable"}</span>
        </nav>
        {successMessage ? <div className="rounded-lg border border-emerald-400/35 bg-emerald-950/30 p-3 text-sm text-emerald-100">{successMessage}</div> : null}
        {!linkedFile ? (
          <div className="rounded-lg border border-white/10 bg-[#08111f] p-6 text-slate-100 shadow-panel">
            <h1 className="text-xl font-semibold text-white">Source unavailable</h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">This source does not exist in the current workspace or has been deleted from active lifecycle views.</p>
            <LoadingLink href="/app/sources" className="mt-4 inline-flex min-h-11 items-center rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white" loadingLabel="Opening Evidence...">Back to Evidence</LoadingLink>
          </div>
        ) : (
          <SourceFileDetailPanel
            file={linkedFile}
            folders={folders}
            fileImports={fileImports}
            fileImportRows={fileImportRows}
            linkedKpis={linkedKpis}
            linkedRuns={linkedRuns}
            linkedReports={linkedReports}
            access={accessByFileId.get(linkedFile.id)}
            actionError={selectedFileActionError}
            activeSection={activeSection}
          />
        )}
      </div>
    );
  }

  return (
    <div className="evidence-workspace space-y-6">
      <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-normal text-white">Evidence</h1>
            <p className="mt-1 text-sm leading-6 text-slate-300">Upload, analyze, and organize the information Vaeroex can use.</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="max-w-sm text-xs leading-5 text-slate-400">Reports, spreadsheets, SOPs, notes, and operational files.</p>
            <UploadSourceDrawer folders={folders} compact />
          </div>
        </div>
        <div className="mt-3">
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

      <section className="space-y-4">
        <nav className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto rounded-lg border border-white/10 bg-[#08111f] p-2 shadow-sm" aria-label="Sources views">
          {sourceTabs.filter((tab) => tab.key !== "knowledge" || activeTab === "knowledge" || memoryChunks.some((chunk) => !chunk.archived_at && !chunk.deleted_at)).map((tab) => {
            const active = activeTab === tab.key;
            const count =
              tab.key === "files"
                ? files.filter((file) => !file.archived_at && !file.deleted_at).length
                : tab.key === "knowledge"
                  ? memoryChunks.filter((chunk) => !chunk.archived_at && !chunk.deleted_at).length
                  : files.filter((file) => file.archived_at && !file.deleted_at).length + memoryChunks.filter((chunk) => chunk.archived_at && !chunk.deleted_at).length;

            return (
              <LoadingLink
                key={tab.key}
                href={tab.href}
                className={`inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-xs font-semibold ${active ? "bg-vaeroex-blue text-white" : "border border-white/10 bg-white/[0.04] text-slate-100 hover:border-vaeroex-accent/40 hover:bg-cyan-950/30"}`}
                loadingLabel={`Loading ${tab.label.toLowerCase()}...`}
              >
                <span>{tab.label}</span>
                <span className="rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[11px]">{count}</span>
              </LoadingLink>
            );
          })}
        </nav>

        {activeTab === "files" ? (
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
        ) : null}

        {activeFilterLabel && activeTab === "files" ? (
          <div className="flex flex-col gap-2 rounded-lg border border-cyan-400/25 bg-cyan-950/30 p-3 text-sm text-cyan-50 sm:flex-row sm:items-center sm:justify-between">
            <p>
              Showing: <span className="font-semibold">{activeFilterLabel}</span>
            </p>
            <Link href="/app/sources" className="w-fit rounded-lg border border-cyan-300/30 px-3 py-2 text-xs font-semibold text-cyan-50 hover:bg-cyan-900/40">
              Clear filter
            </Link>
          </div>
        ) : null}

        {activeTab === "knowledge" ? (
          <LearnedKnowledgeView items={memoryChunks} files={files} params={params} />
        ) : activeTab === "archived" ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">Archived Files</h2>
                  <p className="mt-1 text-sm text-slate-400">Source files removed from current views.</p>
                </div>
                <StatusBadge value={`${visibleFiles.length} showing`} />
              </div>
              <div className="mt-4 space-y-3">
                {visibleFiles.length ? (
                  visibleFiles.map((file) => (
                    <SourceFileRow
                      key={file.id}
                      file={file}
                      folders={folders}
                      runs={runs}
                    />
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/45 p-8 text-center">
                    <h3 className="text-lg font-semibold text-white">No archived files.</h3>
                    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">Archived source files will appear here after you archive them.</p>
                  </div>
                )}
              </div>
            </section>
            <LearnedKnowledgeView items={memoryChunks} files={files} params={params} archived />
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-white">Source Files</h2>
                  <p className="mt-1 text-sm text-slate-400">Open a source to review its analysis, imported data, history, and lifecycle.</p>
                </div>
                <StatusBadge value={`${visibleFiles.length} showing`} />
              </div>
              <div className="mt-4 space-y-3">
                {visibleFiles.length ? (
                  visibleFiles.map((file) => (
                    <SourceFileRow
                      key={file.id}
                      file={file}
                      folders={folders}
                      runs={runs}
                    />
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-white/15 bg-slate-950/45 p-8 text-center">
                    <h3 className="text-lg font-semibold text-white">{files.length ? "No files match this search" : "No source files yet"}</h3>
                    <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-400">
                      {files.length
                        ? "Clear search to view all current files."
                        : "Upload a CSV, XLSX, PDF, DOCX, PNG, or JPG so Vaeroex can start building source evidence."}
                    </p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      {files.length ? (
                        <Link href="/app/sources" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
                          Clear search
                        </Link>
                      ) : null}
                      <UploadSourceDrawer folders={folders} />
                    </div>
                  </div>
                )}
              </div>
          </div>
        )}
      </section>

    </div>
  );
}

export default async function SourcesPage({ searchParams }: SourcesPageProps) {
  const params = (await searchParams) || {};

  if (params.file) {
    const section = normalizeSourceDetailSection(params.section || (params.panel === "import" ? "imported" : params.panel));
    const query = new URLSearchParams();
    if (section !== "summary") query.set("section", section);
    if (params.error) query.set("error", params.error);
    if (params.message) query.set("message", params.message);
    permanentRedirect(`/app/sources/${encodeURIComponent(params.file)}${query.size ? `?${query.toString()}` : ""}` as Route);
  }

  return renderSourcesPage(params);
}
