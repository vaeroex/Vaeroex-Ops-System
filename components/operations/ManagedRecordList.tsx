import Link from "next/link";
import type { ReactNode } from "react";
import type { Route } from "next";
import {
  archiveRecordFolderAction,
  bulkManageRecordsAction,
  createRecordFolderAction,
  manageRecordAction,
  renameRecordFolderAction,
  updateManagedRecordAction
} from "@/app/app/operations/record-management-actions";
import { ContextualAskVaeroex } from "@/components/ai/ContextualAskVaeroex";
import { CompactSummaryChips } from "@/components/operations/CompactSummaryChips";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { EmptyState } from "@/components/operations/EmptyState";
import { RecordDetailDrawer } from "@/components/operations/RecordDetailDrawer";
import { StatusBadge } from "@/components/operations/StatusBadge";

export type ManagedRecordCollection =
  | "sops"
  | "tasks"
  | "checklists"
  | "checklist_runs"
  | "issues"
  | "reports"
  | "kpis"
  | "forms"
  | "form_submissions"
  | "ai_agent_runs"
  | "assets"
  | "asset_checks"
  | "crm_leads"
  | "files"
  | "people"
  | "support_requests";

export type ManagedRecordFolder = {
  id: string;
  name: string;
  collection_type: string;
  archived_at?: string | null;
};

export type ManagedRecordEditField = {
  name: string;
  label: string;
  type?: "text" | "textarea" | "select" | "date" | "number" | "checkbox" | "lines";
  options?: string[];
  rows?: number;
  required?: boolean;
};

export type ManagedRecord = {
  id: string;
  title: string;
  type?: string | null;
  status?: string | null;
  owner?: string | null;
  category?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  folderId?: string | null;
  archivedAt?: string | null;
  deletedAt?: string | null;
  preview?: string | null;
  href?: Route;
  selectLabel?: string;
  inlineActions?: ReactNode;
  meta?: Array<{ label: string; value: ReactNode }>;
  quickActions?: ReactNode;
  editFields?: ManagedRecordEditField[];
  editValues?: Record<string, string | number | boolean | null | undefined>;
  children?: ReactNode;
};

type ManagedRecordListProps = {
  collection: ManagedRecordCollection;
  records: ManagedRecord[];
  folders: ManagedRecordFolder[];
  title: string;
  description?: string;
  emptyTitle: string;
  emptyDescription: string;
  returnPath?: string;
  searchParams?: Record<string, string | string[] | undefined>;
  activeRecordId?: string | null;
};

const sortOptions = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "name", label: "Name" },
  { value: "status", label: "Status" },
  { value: "owner", label: "Owner" },
  { value: "category", label: "Category" },
  { value: "last_updated", label: "Last updated" }
];
const pageSizeOptions = ["5", "10", "25", "50"];

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function readableDate(value?: string | null) {
  if (!value) {
    return "Not set";
  }

  return new Date(value).toLocaleDateString();
}

function includes(value: unknown, query: string) {
  return String(value || "")
    .toLowerCase()
    .includes(query);
}

function getFolderName(folders: ManagedRecordFolder[], folderId?: string | null) {
  return folders.find((folder) => folder.id === folderId)?.name || "Unfiled";
}

function folderOptions(folders: ManagedRecordFolder[]) {
  return folders.filter((folder) => !folder.archived_at);
}

function uniqueOptions(records: ManagedRecord[], key: "status" | "owner" | "category") {
  return Array.from(new Set(records.map((record) => record[key]).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
}

function listHref(returnPath: string, params: Record<string, string>) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      query.set(key, value);
    }
  });

  const suffix = query.toString();
  return suffix ? `${returnPath}?${suffix}` : returnPath;
}

function listParams(searchParams?: ManagedRecordListProps["searchParams"]) {
  return {
    q: param(searchParams?.q),
    folder: param(searchParams?.folder),
    status: param(searchParams?.status),
    owner: param(searchParams?.owner),
    category: param(searchParams?.category),
    sort: param(searchParams?.sort),
    view: param(searchParams?.view),
    date_from: param(searchParams?.date_from),
    date_to: param(searchParams?.date_to)
  };
}

function collectionLabel(collection: ManagedRecordCollection) {
  const labels: Record<ManagedRecordCollection, string> = {
    sops: "SOPs",
    tasks: "follow-ups",
    checklists: "checklists",
    checklist_runs: "checklist runs",
    issues: "issues",
    reports: "reports",
    kpis: "KPIs",
    forms: "forms",
    form_submissions: "form submissions",
    ai_agent_runs: "Vaeroex results",
    assets: "assets",
    asset_checks: "asset checks",
    crm_leads: "customer context",
    files: "files",
    people: "people",
    support_requests: "support requests"
  };

  return labels[collection];
}

function removeParam(params: ReturnType<typeof listParams>, key: keyof ReturnType<typeof listParams>) {
  return {
    ...params,
    [key]: ""
  };
}

function activeFilterChips({
  params,
  folders,
  returnPath
}: {
  params: ReturnType<typeof listParams>;
  folders: ManagedRecordFolder[];
  returnPath: string;
}) {
  const chips: Array<{ key: keyof typeof params; label: string; value: string }> = [];

  if (params.q) chips.push({ key: "q", label: "Search", value: params.q });
  if (params.folder) chips.push({ key: "folder", label: "Folder", value: params.folder === "unfiled" ? "Unfiled" : getFolderName(folders, params.folder) });
  if (params.status) chips.push({ key: "status", label: "Status", value: params.status });
  if (params.owner) chips.push({ key: "owner", label: "Owner", value: params.owner });
  if (params.category) chips.push({ key: "category", label: "Category", value: params.category });
  if (params.view && params.view !== "active") chips.push({ key: "view", label: "View", value: params.view });
  if (params.date_from) chips.push({ key: "date_from", label: "From", value: params.date_from });
  if (params.date_to) chips.push({ key: "date_to", label: "To", value: params.date_to });

  return chips.map((chip) => ({
    ...chip,
    href: listHref(returnPath, removeParam(params, chip.key)) as Route
  }));
}

function pageLimit(value: string, total: number) {
  if (value === "all") {
    return total;
  }

  const parsed = Number(value || 10);
  return pageSizeOptions.includes(String(parsed)) ? parsed : 10;
}

function filteredRecords(records: ManagedRecord[], folders: ManagedRecordFolder[], searchParams?: ManagedRecordListProps["searchParams"]) {
  const query = param(searchParams?.q).toLowerCase().trim();
  const folder = param(searchParams?.folder);
  const status = param(searchParams?.status);
  const owner = param(searchParams?.owner);
  const category = param(searchParams?.category);
  const view = param(searchParams?.view) || "active";
  const dateFrom = param(searchParams?.date_from);
  const dateTo = param(searchParams?.date_to);

  return records.filter((record) => {
    const isDeleted = Boolean(record.deletedAt);
    const isArchived = Boolean(record.archivedAt);
    const recordDate = (record.updatedAt || record.createdAt).slice(0, 10);

    if (view === "active" && (isDeleted || isArchived)) return false;
    if (view === "archived" && (!isArchived || isDeleted)) return false;
    if (view === "deleted" && !isDeleted) return false;
    if (folder === "unfiled" && record.folderId) return false;
    if (folder && folder !== "unfiled" && record.folderId !== folder) return false;
    if (status && record.status !== status) return false;
    if (owner && record.owner !== owner) return false;
    if (category && record.category !== category) return false;
    if (dateFrom && recordDate < dateFrom) return false;
    if (dateTo && recordDate > dateTo) return false;

    if (!query) {
      return true;
    }

    return (
      includes(record.title, query) ||
      includes(record.type, query) ||
      includes(record.status, query) ||
      includes(record.owner, query) ||
      includes(record.category, query) ||
      includes(record.preview, query) ||
      includes(getFolderName(folders, record.folderId), query)
    );
  });
}

function sortedRecords(records: ManagedRecord[], sort: string) {
  const sorted = [...records];

  return sorted.sort((a, b) => {
    if (sort === "oldest") return a.createdAt.localeCompare(b.createdAt);
    if (sort === "name") return a.title.localeCompare(b.title);
    if (sort === "status") return (a.status || "").localeCompare(b.status || "") || a.title.localeCompare(b.title);
    if (sort === "owner") return (a.owner || "").localeCompare(b.owner || "") || a.title.localeCompare(b.title);
    if (sort === "category") return (a.category || "").localeCompare(b.category || "") || a.title.localeCompare(b.title);
    if (sort === "last_updated") return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);

    return b.createdAt.localeCompare(a.createdAt);
  });
}

function fieldInput(field: ManagedRecordEditField, value: string | number | boolean | null | undefined) {
  const shared = {
    name: field.name,
    defaultValue: value === null || value === undefined || typeof value === "boolean" ? "" : value,
    required: field.required,
    className: "mt-2 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-vaeroex-blue"
  };

  if (field.type === "textarea" || field.type === "lines") {
    return <textarea {...shared} rows={field.rows || 4} />;
  }

  if (field.type === "select") {
    return (
      <select {...shared}>
        <option value="">Choose...</option>
        {(field.options || []).map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  }

  if (field.type === "checkbox") {
    return (
      <input
        name={field.name}
        type="checkbox"
        defaultChecked={value === true}
        className="mt-3 h-4 w-4 rounded border-line text-vaeroex-blue"
      />
    );
  }

  return <input {...shared} type={field.type || "text"} step={field.type === "number" ? "0.01" : undefined} />;
}

function FolderManager({
  collection,
  folders,
  returnPath
}: {
  collection: ManagedRecordCollection;
  folders: ManagedRecordFolder[];
  returnPath: string;
}) {
  return (
    <details className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
      <summary className="cursor-pointer text-sm font-semibold text-slate-100">Folders</summary>
      <div className="mt-3 space-y-3">
        <form action={createRecordFolderAction} className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input type="hidden" name="collection" value={collection} />
          <input type="hidden" name="return_path" value={returnPath} />
          <input
            name="folder_name"
            placeholder="New folder name"
            className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
            required
          />
          <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Create folder</button>
        </form>

        {folderOptions(folders).length ? (
          <div className="space-y-2">
            {folderOptions(folders).map((folder) => (
              <div key={folder.id} className="grid gap-2 rounded-lg border border-white/10 bg-slate-950/45 p-3 md:grid-cols-[1fr_auto_auto]">
                <form action={renameRecordFolderAction} className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <input type="hidden" name="collection" value={collection} />
                  <input type="hidden" name="folder_id" value={folder.id} />
                  <input type="hidden" name="return_path" value={returnPath} />
                  <input
                    name="folder_name"
                    defaultValue={folder.name}
                    className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-vaeroex-accent"
                  />
                  <button className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent/40 hover:bg-cyan-950/30">Rename</button>
                </form>
                <form action={archiveRecordFolderAction}>
                  <input type="hidden" name="collection" value={collection} />
                  <input type="hidden" name="folder_id" value={folder.id} />
                  <input type="hidden" name="return_path" value={returnPath} />
                  <ConfirmSubmitButton message={`Archive folder "${folder.name}"? Records will remain available.`}>Archive</ConfirmSubmitButton>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No folders yet.</p>
        )}
      </div>
    </details>
  );
}

const inactivePagePillClass =
  "border border-white/10 bg-white/5 text-slate-200 hover:border-vaeroex-accent/40 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45";
const recordRowInactiveClass = "hover:bg-cyan-950/20 hover:ring-1 hover:ring-inset hover:ring-vaeroex-accent/20";
const actionMenuPanelClass = "absolute right-0 z-20 mt-2 w-[min(18rem,calc(100vw-2rem))] rounded-lg border border-white/10 bg-[#08111f] p-3 text-slate-100 shadow-2xl shadow-black/30";
const menuItemClass =
  "block min-h-11 w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-100 hover:border-vaeroex-accent/40 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45";

function RecordEditForm({
  collection,
  record,
  returnPath
}: {
  collection: ManagedRecordCollection;
  record: ManagedRecord;
  returnPath: string;
}) {
  if (!record.editFields?.length) {
    return <p className="text-sm text-muted">This record does not have editable fields configured yet.</p>;
  }

  return (
    <form action={updateManagedRecordAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="collection" value={collection} />
      <input type="hidden" name="record_id" value={record.id} />
      <input type="hidden" name="return_path" value={returnPath} />
      {record.editFields.map((field) => (
        <label key={field.name} className={`block text-sm font-medium ${field.type === "textarea" || field.type === "lines" ? "sm:col-span-2" : ""}`}>
          {field.label}
          {fieldInput(field, record.editValues?.[field.name])}
        </label>
      ))}
      <div className="sm:col-span-2">
        <button className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Save changes</button>
      </div>
    </form>
  );
}

function RecordDetailContent({
  record,
  folders
}: {
  record: ManagedRecord;
  folders: ManagedRecordFolder[];
}) {
  return (
    <>
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Type</p>
          <p className="mt-1 text-ink">{record.type || "Record"}</p>
        </div>
        <div className="rounded-lg border border-line bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Status</p>
          <div className="mt-1">{record.status ? <StatusBadge value={record.status} /> : <span className="text-ink">Not set</span>}</div>
        </div>
        <div className="rounded-lg border border-line bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Owner</p>
          <p className="mt-1 text-ink">{record.owner || "No owner"}</p>
        </div>
        <div className="rounded-lg border border-line bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Category</p>
          <p className="mt-1 text-ink">{record.category || "Uncategorized"}</p>
        </div>
        <div className="rounded-lg border border-line bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Folder</p>
          <p className="mt-1 text-ink">{getFolderName(folders, record.folderId)}</p>
        </div>
        <div className="rounded-lg border border-line bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Created</p>
          <p className="mt-1 text-ink">{readableDate(record.createdAt)}</p>
        </div>
        <div className="rounded-lg border border-line bg-slate-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Updated</p>
          <p className="mt-1 text-ink">{readableDate(record.updatedAt || record.createdAt)}</p>
        </div>
      </div>
      {record.meta?.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {record.meta.map((item) => (
            <div key={item.label} className="rounded-lg border border-line bg-white p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{item.label}</p>
              <div className="mt-1 text-ink">{item.value || "Not set"}</div>
            </div>
          ))}
        </div>
      ) : null}
      {record.children ? <div className="rounded-lg border border-line bg-white p-4">{record.children}</div> : null}
    </>
  );
}

function RecordActionsMenu({
  collection,
  record,
  folders,
  activeFolders,
  returnPath
}: {
  collection: ManagedRecordCollection;
  record: ManagedRecord;
  folders: ManagedRecordFolder[];
  activeFolders: ManagedRecordFolder[];
  returnPath: string;
}) {
  return (
    <details className="relative">
      <summary
        className="grid h-11 w-11 cursor-pointer list-none place-items-center rounded-md border border-line bg-white text-lg font-semibold text-slate-600 hover:border-vaeroex-accent/50 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45 lg:h-9 lg:w-9"
        aria-label={`Actions for ${record.title}`}
      >
        ...
      </summary>
      <div className={actionMenuPanelClass}>
        <div className="space-y-2">
          <RecordDetailDrawer
            title={record.title}
            description={record.preview || record.type}
            triggerLabel="View"
            triggerClassName={menuItemClass}
          >
            <RecordDetailContent record={record} folders={folders} />
          </RecordDetailDrawer>

          {record.editFields?.length ? (
            <RecordDetailDrawer
              title={record.title}
              description="Edit this record. Changes are saved only inside the current workspace."
              eyebrow="Edit record"
              triggerLabel="Edit"
              triggerClassName={menuItemClass}
            >
              <RecordEditForm collection={collection} record={record} returnPath={returnPath} />
            </RecordDetailDrawer>
          ) : null}

          {record.quickActions ? (
            <details className="rounded-md border border-white/10 bg-white/[0.04] p-2">
              <summary className="cursor-pointer text-sm font-semibold text-slate-100">File or module actions</summary>
              <div className="mt-2 flex flex-wrap gap-2">{record.quickActions}</div>
            </details>
          ) : null}

          <details className="rounded-md border border-white/10 bg-white/[0.04] p-2">
            <summary className="cursor-pointer text-sm font-semibold text-slate-100">Move</summary>
            <form action={manageRecordAction} className="mt-3 grid gap-2">
              <input type="hidden" name="collection" value={collection} />
              <input type="hidden" name="record_id" value={record.id} />
              <input type="hidden" name="record_action" value="move" />
              <input type="hidden" name="return_path" value={returnPath} />
              <select name="target_folder_id" defaultValue={record.folderId || ""} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                <option value="">No folder</option>
                {activeFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
              <button className="min-h-11 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent/40 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45">Move</button>
            </form>
          </details>

          <form action={manageRecordAction}>
            <input type="hidden" name="collection" value={collection} />
            <input type="hidden" name="record_id" value={record.id} />
            <input type="hidden" name="record_action" value={record.archivedAt ? "restore" : "archive"} />
            <input type="hidden" name="return_path" value={returnPath} />
            <button className={menuItemClass}>
              {record.archivedAt ? "Restore" : "Archive"}
            </button>
          </form>

          <form action={manageRecordAction}>
            <input type="hidden" name="collection" value={collection} />
            <input type="hidden" name="record_id" value={record.id} />
            <input type="hidden" name="record_action" value="duplicate" />
            <input type="hidden" name="return_path" value={returnPath} />
            <button className={menuItemClass}>
              Duplicate
            </button>
          </form>

          <form action={manageRecordAction}>
            <input type="hidden" name="collection" value={collection} />
            <input type="hidden" name="record_id" value={record.id} />
            <input type="hidden" name="record_action" value="delete" />
            <input type="hidden" name="return_path" value={returnPath} />
            <ConfirmSubmitButton
              message={`Delete "${record.title}"? It will be hidden from active views.`}
              className="min-h-11 w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-950/35 hover:text-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/40"
            >
              Delete
            </ConfirmSubmitButton>
          </form>
        </div>
      </div>
    </details>
  );
}

export function ManagedRecordList({
  collection,
  records,
  folders,
  title,
  description,
  emptyTitle,
  emptyDescription,
  returnPath: configuredReturnPath,
  searchParams,
  activeRecordId
}: ManagedRecordListProps) {
  const sort = param(searchParams?.sort) || "newest";
  const visibleRecords = sortedRecords(filteredRecords(records, folders, searchParams), sort);
  const limitValue = param(searchParams?.limit);
  const visibleLimit = pageLimit(limitValue, visibleRecords.length);
  const displayedRecords = visibleRecords.slice(0, visibleLimit);
  const returnPath = configuredReturnPath || `/app/${collection.replace("_", "-")}`;
  const activeFolders = folderOptions(folders);
  const statusOptions = uniqueOptions(records, "status");
  const ownerOptions = uniqueOptions(records, "owner");
  const categoryOptions = uniqueOptions(records, "category");
  const bulkFormId = `bulk-${collection}`;
  const activeFolder = param(searchParams?.folder);
  const baseParams = listParams(searchParams);
  const successMessage = param(searchParams?.message);
  const errorMessage = param(searchParams?.error);
  const activeCount = records.filter((record) => !record.deletedAt && !record.archivedAt).length;
  const archivedCount = records.filter((record) => record.archivedAt && !record.deletedAt).length;
  const deletedCount = records.filter((record) => record.deletedAt).length;
  const chips = activeFilterChips({ params: baseParams, folders, returnPath });
  const askPrompt = `Review these ${collectionLabel(collection)} and tell me what needs attention.`;
  const summaryChips = [
    { label: "Active", value: activeCount },
    { label: "Showing", value: visibleRecords.length },
    archivedCount ? { label: "Archived", value: archivedCount, tone: "muted" as const } : null,
    deletedCount ? { label: "Hidden", value: deletedCount, tone: "muted" as const } : null
  ].filter(Boolean) as Array<{ label: string; value: string | number; tone?: "default" | "attention" | "good" | "muted" }>;

  return (
    <div className="managed-record-list space-y-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          {description ? (
            <details className="mt-1">
              <summary className="cursor-pointer list-none text-xs font-semibold text-slate-400 hover:text-vaeroex-accent">
                What is this?
              </summary>
              <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">{description}</p>
            </details>
          ) : null}
        </div>
        <CompactSummaryChips items={summaryChips} />
      </div>

      {successMessage ? (
        <div className="rounded-lg border border-emerald-400/35 bg-emerald-950/30 p-3 text-sm text-emerald-100">{successMessage}</div>
      ) : null}
      {errorMessage ? <div className="rounded-lg border border-red-400/35 bg-red-950/30 p-3 text-sm text-red-100">{errorMessage}</div> : null}

      <form method="get" className="rounded-lg border border-white/10 bg-[#08111f] p-3 shadow-sm">
        <div className="grid gap-2 lg:grid-cols-[minmax(180px,1fr)_160px_140px_130px_auto_auto] lg:items-center">
          <input
            name="q"
            defaultValue={param(searchParams?.q)}
            placeholder="Search records..."
            className="min-h-11 min-w-0 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-vaeroex-accent"
          />
          <select name="folder" defaultValue={activeFolder} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
            <option value="">Folder: All</option>
            <option value="unfiled">Folder: Unfiled</option>
            {activeFolders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
          <select name="sort" defaultValue={sort} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select name="view" defaultValue={param(searchParams?.view) || "active"} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="deleted">Hidden</option>
            <option value="all">All</option>
          </select>
          <details className="relative rounded-lg border border-white/10 bg-white/[0.04]">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center px-3 py-2 text-sm font-semibold text-slate-100">Filters</summary>
            <div className="mt-2 grid gap-2 border-t border-white/10 p-3 md:grid-cols-2 xl:absolute xl:right-0 xl:z-20 xl:w-[42rem] xl:rounded-lg xl:border xl:border-white/10 xl:bg-[#08111f] xl:shadow-2xl xl:shadow-black/30">
              <select name="status" defaultValue={param(searchParams?.status)} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                <option value="">All statuses</option>
                {statusOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              <select name="owner" defaultValue={param(searchParams?.owner)} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                <option value="">All owners</option>
                {ownerOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              <select name="category" defaultValue={param(searchParams?.category)} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                <option value="">All categories</option>
                {categoryOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              <select name="limit" defaultValue={limitValue || "10"} className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
                {pageSizeOptions.map((option) => (
                  <option key={option} value={option}>
                    Show {option}
                  </option>
                ))}
                <option value="all">View all</option>
              </select>
              <input
                type="date"
                name="date_from"
                defaultValue={param(searchParams?.date_from)}
                aria-label="Updated after"
                className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
              />
              <input
                type="date"
                name="date_to"
                defaultValue={param(searchParams?.date_to)}
                aria-label="Updated before"
                className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
              />
              <button className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white md:col-span-2">
                Apply filters
              </button>
            </div>
          </details>
          <button className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Search
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 flex-wrap gap-2">
          {chips.map((chip) => (
            <Link key={`${chip.key}-${chip.value}`} href={chip.href} className="inline-flex min-h-9 items-center gap-2 rounded-full border border-vaeroex-accent/30 bg-vaeroex-soft px-3 py-1 text-xs font-semibold text-vaeroex-blue">
              {chip.label}: {chip.value}
              <span aria-hidden="true">x</span>
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <details className="relative">
            <summary className="inline-flex min-h-10 cursor-pointer list-none items-center rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:border-cyan-300/50 hover:bg-cyan-400/20">
              More
            </summary>
            <div className="absolute right-0 z-20 mt-2 w-[min(28rem,calc(100vw-2rem))] space-y-3 rounded-lg border border-white/10 bg-[#08111f] p-3 text-slate-100 shadow-2xl shadow-black/30">
              <ContextualAskVaeroex
                label="Ask Vaeroex about this page"
                prompt={askPrompt}
                contextType={`managed_${collection}`}
                contextId={collection}
                sourceTitle={title}
                sourceSummary={`${description || `Managed ${collectionLabel(collection)} page.`} Showing ${visibleRecords.length} records, with ${activeCount} active, ${archivedCount} archived, and ${deletedCount} hidden.`}
                evidence={[
                  `Collection: ${collectionLabel(collection)}`,
                  `Active records: ${activeCount}`,
                  `Visible records after filters: ${visibleRecords.length}`,
                  `Displayed records: ${displayedRecords.length}`,
                  `Archived records: ${archivedCount}`,
                  `Hidden records: ${deletedCount}`,
                  activeFolder ? `Active folder: ${getFolderName(folders, activeFolder)}` : "No folder filter selected",
                  statusOptions.length ? `Statuses visible: ${statusOptions.slice(0, 8).join(", ")}` : "No status values visible"
                ]}
                compact
              />
              <FolderManager collection={collection} folders={folders} returnPath={returnPath} />
            </div>
          </details>
        </div>
      </div>

      <div className="bulk-action-bar hidden rounded-lg border border-vaeroex-accent/35 bg-vaeroex-soft p-3">
        <form id={bulkFormId} action={bulkManageRecordsAction} className="grid w-full gap-3 md:grid-cols-[auto_1fr_220px_auto] md:items-center">
          <input type="hidden" name="collection" value={collection} />
          <input type="hidden" name="return_path" value={returnPath} />
          <p className="text-sm font-semibold text-vaeroex-blue">Selected records</p>
          <select name="bulk_action" className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100" required>
            <option value="">Bulk action</option>
            <option value="archive">Archive selected</option>
            <option value="delete">Delete selected</option>
            <option value="move">Move selected to folder</option>
            <option value="restore">Restore selected</option>
          </select>
          <select name="target_folder_id" className="min-h-11 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
            <option value="">No folder</option>
            {activeFolders.map((folder) => (
              <option key={folder.id} value={folder.id}>{folder.name}</option>
            ))}
          </select>
          <ConfirmSubmitButton message="Apply this action to the selected records?">Apply</ConfirmSubmitButton>
        </form>
      </div>

          {visibleRecords.length ? (
            <div className="rounded-lg border border-line bg-white">
              <div className="flex flex-col gap-3 border-b border-line px-3 py-3 text-sm md:flex-row md:items-center md:justify-between">
                <p className="text-muted">
                  Showing <span className="font-semibold text-ink">{displayedRecords.length}</span> of{" "}
                  <span className="font-semibold text-ink">{visibleRecords.length}</span> records
                </p>
                <div className="flex flex-wrap gap-2">
                  {pageSizeOptions.map((option) => (
                    <Link
                      key={option}
                      href={listHref(returnPath, { ...baseParams, limit: option }) as Route}
                      className={`inline-flex min-h-10 items-center rounded-md px-2.5 py-1.5 text-xs font-semibold ${String(visibleLimit) === option && limitValue !== "all" ? "bg-vaeroex-blue text-white" : inactivePagePillClass}`}
                    >
                      {option}
                    </Link>
                  ))}
                  <Link
                    href={listHref(returnPath, { ...baseParams, limit: "all" }) as Route}
                    className={`inline-flex min-h-10 items-center rounded-md px-2.5 py-1.5 text-xs font-semibold ${limitValue === "all" ? "bg-vaeroex-blue text-white" : inactivePagePillClass}`}
                  >
                    View All
                  </Link>
                </div>
              </div>
              <div className="hidden border-b border-line bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted lg:grid lg:grid-cols-[32px_minmax(220px,1.5fr)_110px_110px_110px_120px_44px] lg:gap-3">
                <span />
                <span>Title</span>
                <span>Status</span>
                <span>Owner</span>
                <span>Category</span>
                <span>Date</span>
                <span />
              </div>
              <div className="divide-y divide-line">
                {displayedRecords.map((record) => {
                  const isActive = activeRecordId === record.id;

                  return (
                    <article
                      key={record.id}
                      className={`px-3 py-2 transition ${isActive ? "bg-vaeroex-soft ring-1 ring-inset ring-vaeroex-accent/50" : recordRowInactiveClass}`}
                      aria-current={isActive ? "true" : undefined}
                    >
                      <div className="grid gap-3 lg:grid-cols-[32px_minmax(220px,1.5fr)_110px_110px_110px_120px_44px] lg:items-center">
                        <input
                          form={bulkFormId}
                          type="checkbox"
                          name="record_id"
                          value={record.id}
                          className="mt-1 h-4 w-4 rounded border-line text-vaeroex-blue lg:mt-0"
                          aria-label={`Select ${record.title}`}
                        />
                        <div className="min-w-0 lg:col-start-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {record.href ? (
                              <Link href={record.href} className="truncate text-sm font-semibold text-ink hover:text-vaeroex-blue">
                                {record.title}
                              </Link>
                            ) : (
                              <h3 className="truncate text-sm font-semibold text-ink">{record.title}</h3>
                            )}
                            {isActive ? <StatusBadge value="Selected" /> : null}
                            {record.archivedAt ? <StatusBadge value="Archived" /> : null}
                            {record.deletedAt ? <StatusBadge value="Deleted" /> : null}
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted">
                            {record.preview || record.type || "No preview available."}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            <RecordDetailDrawer title={record.title} description={record.preview || record.type}>
                              <RecordDetailContent record={record} folders={folders} />
                              <div className="rounded-lg border border-line bg-slate-50 p-3">
                                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Actions</p>
                                <RecordActionsMenu collection={collection} record={record} folders={folders} activeFolders={activeFolders} returnPath={returnPath} />
                              </div>
                            </RecordDetailDrawer>
                            {record.editFields?.length ? (
                              <RecordDetailDrawer
                                title={record.title}
                                description="Edit this record. Changes are saved only inside the current workspace."
                                eyebrow="Edit record"
                                triggerLabel="Edit"
                              >
                                <RecordEditForm collection={collection} record={record} returnPath={returnPath} />
                              </RecordDetailDrawer>
                            ) : null}
                            {record.href ? (
                              <Link href={record.href} className="mt-1 inline-flex text-xs font-semibold text-vaeroex-blue hover:underline">
                                {isActive ? "Active selection" : record.selectLabel || "Select this record"}
                              </Link>
                            ) : null}
                          </div>
                          <p className="mt-1 text-xs text-muted lg:hidden">
                            {record.status || "No status"} · {record.owner || "No owner"} · {record.category || "Uncategorized"} · {readableDate(record.updatedAt || record.createdAt)}
                          </p>
                        </div>
                        {record.inlineActions ? <div className="lg:col-span-6 lg:col-start-2">{record.inlineActions}</div> : null}
                        <div className="hidden lg:block">{record.status ? <StatusBadge value={record.status} /> : <span className="text-sm text-muted">-</span>}</div>
                        <div className="hidden truncate text-sm text-slate-700 lg:block">{record.owner || "-"}</div>
                        <div className="hidden lg:block">{record.category ? <StatusBadge value={record.category} /> : <span className="text-sm text-muted">-</span>}</div>
                        <div className="hidden text-sm text-muted lg:block">{readableDate(record.updatedAt || record.createdAt)}</div>
                        <RecordActionsMenu collection={collection} record={record} folders={folders} activeFolders={activeFolders} returnPath={returnPath} />
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <EmptyState title={emptyTitle} description={emptyDescription} />
          )}
    </div>
  );
}
