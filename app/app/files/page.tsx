import { analyzeFileAction, importFileAction, uploadFileAction } from "@/app/app/files/actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
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
type FolderRow = Database["public"]["Tables"]["record_folders"]["Row"];

const DEFAULT_FILE_FOLDERS = ["KPI Files", "Reports", "SOPs", "CRM", "Operations"];
const IMPORT_TYPES = [
  { value: "kpi", label: "KPI data" },
  { value: "crm", label: "CRM leads" },
  { value: "metrics", label: "Operational metrics" }
];
const fileEditFields: ManagedRecordEditField[] = [
  { name: "display_name", label: "File name", required: true },
  { name: "import_type", label: "Import type", type: "select", options: ["none", "kpi", "crm", "metrics"] },
  { name: "analysis_summary", label: "Analysis summary", type: "textarea", rows: 5 }
];

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
  if (file.deleted_at) return "Deleted";
  if (file.archived_at) return "Archived";
  if (file.import_status === "imported") return "Imported";
  if (file.import_status === "failed") return "Import failed";
  if (file.import_status === "ready") return "Ready to import";
  return "Stored";
}

function isSpreadsheet(file: FileUploadRow) {
  return file.file_extension === "csv" || file.file_extension === "xlsx";
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

function ImportTypeSelect() {
  return (
    <label className="block text-sm font-medium">
      Import as
      <select name="import_type" required className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue">
        <option value="">Choose...</option>
        {IMPORT_TYPES.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FileDetails({ file }: { file: FileUploadRow }) {
  const canImport = isSpreadsheet(file);
  const lines = analysisLines(file.analysis_summary);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 text-sm md:grid-cols-3">
        <div className="rounded-lg border border-line bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">File type</p>
          <p className="mt-1 font-medium text-ink">{file.file_extension.toUpperCase()}</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Size</p>
          <p className="mt-1 font-medium text-ink">{fileSizeLabel(file.file_size_bytes)}</p>
        </div>
        <div className="rounded-lg border border-line bg-white p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Uploaded</p>
          <p className="mt-1 font-medium text-ink">{formatDate(file.created_at)}</p>
        </div>
      </div>

      {canImport ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={importFileAction} className="space-y-3 rounded-lg border border-line bg-white p-4">
            <input type="hidden" name="file_id" value={file.id} />
            <div>
              <p className="text-sm font-semibold text-ink">Import spreadsheet rows</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Vaeroex will read the first row as column names and create workspace records from the matching rows.
              </p>
            </div>
            <ImportTypeSelect />
            <PrimaryButton>Import rows</PrimaryButton>
          </form>

          <form action={analyzeFileAction} className="space-y-3 rounded-lg border border-line bg-white p-4">
            <input type="hidden" name="file_id" value={file.id} />
            <div>
              <p className="text-sm font-semibold text-ink">Ask Vaeroex about this file</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                Use this for trends, KPIs to track, problems that stand out, and executive summaries.
              </p>
            </div>
            <TextArea
              label="Question"
              name="analysis_prompt"
              rows={4}
              defaultValue="What trends do you see? What KPIs should I track? What problems stand out? Create an executive summary."
            />
            <PrimaryButton>Analyze file</PrimaryButton>
          </form>
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-white p-4 text-sm leading-6 text-muted">
          This file is stored in the workspace. Spreadsheet import and Vaeroex file analysis are available for CSV and XLSX files.
        </div>
      )}

      {lines.length ? (
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

  const [fileResult, folderResult] = await Promise.all([
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "files")
  ]);
  const files = (fileResult.data || []) as FileUploadRow[];
  const folderOptions = folderResult.folders;
  const importedRows = files.reduce((sum, file) => sum + file.imported_rows, 0);
  const spreadsheetCount = files.filter(isSpreadsheet).length;
  const analyzedCount = files.filter((file) => Boolean(file.analysis_summary)).length;
  const managedFiles = files.map((file) => {
    const management = managedValues(file);

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
        { label: "Import status", value: fileStatusLabel(file) },
        { label: "Rows imported", value: file.imported_rows },
        { label: "File size", value: fileSizeLabel(file.file_size_bytes) }
      ],
      editFields: fileEditFields,
      editValues: {
        display_name: file.display_name,
        import_type: file.import_type,
        analysis_summary: file.analysis_summary
      },
      children: <FileDetails file={file} />
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Files"
        title="Files and data import"
        description="Upload workspace files, organize them into folders, import spreadsheet rows into KPIs, CRM leads, and operational metrics, and ask Vaeroex for a plain-language file analysis."
      />

      <ErrorNotice message={params?.error || fileResult.error?.message || folderResult.error?.message} />
      <SuccessNotice message={params?.message} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Files stored</p>
          <p className="mt-2 text-3xl font-semibold">{files.length}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Spreadsheets</p>
          <p className="mt-2 text-3xl font-semibold">{spreadsheetCount}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Rows imported</p>
          <p className="mt-2 text-3xl font-semibold">{importedRows}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Vaeroex analyses</p>
          <p className="mt-2 text-3xl font-semibold">{analyzedCount}</p>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <div className="space-y-6">
          <SectionCard title="Upload file" description="Files are stored privately for the active workspace. Spreadsheet imports use CSV or XLSX with column names in the first row.">
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
              <PrimaryButton>Upload file</PrimaryButton>
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
