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
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { EmptyState } from "@/components/operations/EmptyState";
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

function folderCounts(records: ManagedRecord[]) {
  return records.reduce<Record<string, number>>((counts, record) => {
    const key = record.folderId || "unfiled";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
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

function filteredRecords(records: ManagedRecord[], folders: ManagedRecordFolder[], searchParams?: ManagedRecordListProps["searchParams"]) {
  const query = param(searchParams?.q).toLowerCase().trim();
  const folder = param(searchParams?.folder);
  const status = param(searchParams?.status);
  const owner = param(searchParams?.owner);
  const category = param(searchParams?.category);
  const view = param(searchParams?.view) || "active";

  return records.filter((record) => {
    const isDeleted = Boolean(record.deletedAt);
    const isArchived = Boolean(record.archivedAt);

    if (view === "active" && (isDeleted || isArchived)) return false;
    if (view === "archived" && (!isArchived || isDeleted)) return false;
    if (view === "deleted" && !isDeleted) return false;
    if (folder === "unfiled" && record.folderId) return false;
    if (folder && folder !== "unfiled" && record.folderId !== folder) return false;
    if (status && record.status !== status) return false;
    if (owner && record.owner !== owner) return false;
    if (category && record.category !== category) return false;

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
    <details className="rounded-lg border border-line bg-slate-50 p-4">
      <summary className="cursor-pointer text-sm font-semibold">Folders and collections</summary>
      <div className="mt-4 space-y-4">
        <form action={createRecordFolderAction} className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input type="hidden" name="collection" value={collection} />
          <input type="hidden" name="return_path" value={returnPath} />
          <input
            name="folder_name"
            placeholder="New folder name"
            className="rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-vaeroex-blue"
            required
          />
          <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Create folder</button>
        </form>

        {folderOptions(folders).length ? (
          <div className="space-y-2">
            {folderOptions(folders).map((folder) => (
              <div key={folder.id} className="grid gap-2 rounded-lg border border-line bg-white p-3 md:grid-cols-[1fr_auto_auto]">
                <form action={renameRecordFolderAction} className="grid gap-2 md:grid-cols-[1fr_auto]">
                  <input type="hidden" name="collection" value={collection} />
                  <input type="hidden" name="folder_id" value={folder.id} />
                  <input type="hidden" name="return_path" value={returnPath} />
                  <input
                    name="folder_name"
                    defaultValue={folder.name}
                    className="rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-vaeroex-blue"
                  />
                  <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Rename</button>
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
          <p className="text-sm text-muted">No folders yet.</p>
        )}
      </div>
    </details>
  );
}

function FolderQuickFilters({
  folders,
  records,
  activeFolder,
  returnPath
}: {
  folders: ManagedRecordFolder[];
  records: ManagedRecord[];
  activeFolder: string;
  returnPath: string;
}) {
  const counts = folderCounts(records);
  const activeFolders = folderOptions(folders);
  const unfiledCount = counts.unfiled || 0;

  return (
    <aside className="rounded-lg border border-line bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Folders</p>
        <Link href={listHref(returnPath, {}) as Route} className="text-xs font-semibold text-vaeroex-blue">
          All {records.length}
        </Link>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto lg:block lg:space-y-1">
        <Link
          href={listHref(returnPath, { folder: "" }) as Route}
          className={`flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm lg:w-full ${!activeFolder ? "bg-vaeroex-blue text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
        >
          <span>All records</span>
          <span className="text-xs opacity-80">{records.length}</span>
        </Link>
        {activeFolders.map((folder) => (
          <Link
            key={folder.id}
            href={listHref(returnPath, { folder: folder.id }) as Route}
            className={`flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm lg:w-full ${activeFolder === folder.id ? "bg-vaeroex-blue text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
          >
            <span className="truncate">{folder.name}</span>
            <span className="text-xs opacity-80">{counts[folder.id] || 0}</span>
          </Link>
        ))}
        {unfiledCount ? (
          <Link
            href={listHref(returnPath, { folder: "unfiled" }) as Route}
            className={`flex shrink-0 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm lg:w-full ${activeFolder === "unfiled" ? "bg-vaeroex-blue text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"}`}
          >
            <span>Unfiled</span>
            <span className="text-xs opacity-80">{unfiledCount}</span>
          </Link>
        ) : null}
      </div>
    </aside>
  );
}

function RecordActionsMenu({
  collection,
  record,
  activeFolders,
  returnPath
}: {
  collection: ManagedRecordCollection;
  record: ManagedRecord;
  activeFolders: ManagedRecordFolder[];
  returnPath: string;
}) {
  return (
    <details className="relative">
      <summary
        className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-md border border-line bg-white text-lg font-semibold text-slate-600 hover:border-vaeroex-blue"
        aria-label={`Actions for ${record.title}`}
      >
        ...
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border border-line bg-white p-3 shadow-lg">
        <div className="space-y-2">
          {record.href ? (
            <Link href={record.href} className="block rounded-md px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              View
            </Link>
          ) : null}

          {record.quickActions ? (
            <details className="rounded-md border border-line bg-slate-50 p-2">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">File or module actions</summary>
              <div className="mt-2 flex flex-wrap gap-2">{record.quickActions}</div>
            </details>
          ) : null}

          {record.editFields?.length ? (
            <details className="rounded-md border border-line bg-slate-50 p-2">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Edit</summary>
              <form action={updateManagedRecordAction} className="mt-3 grid gap-3">
                <input type="hidden" name="collection" value={collection} />
                <input type="hidden" name="record_id" value={record.id} />
                <input type="hidden" name="return_path" value={returnPath} />
                {record.editFields.map((field) => (
                  <label key={field.name} className="block text-sm font-medium">
                    {field.label}
                    {fieldInput(field, record.editValues?.[field.name])}
                  </label>
                ))}
                <button className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">Save changes</button>
              </form>
            </details>
          ) : null}

          <details className="rounded-md border border-line bg-slate-50 p-2">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Move</summary>
            <form action={manageRecordAction} className="mt-3 grid gap-2">
              <input type="hidden" name="collection" value={collection} />
              <input type="hidden" name="record_id" value={record.id} />
              <input type="hidden" name="record_action" value="move" />
              <input type="hidden" name="return_path" value={returnPath} />
              <select name="target_folder_id" defaultValue={record.folderId || ""} className="rounded-lg border border-line px-3 py-2 text-sm">
                <option value="">No folder</option>
                {activeFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
              <button className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold">Move</button>
            </form>
          </details>

          <form action={manageRecordAction}>
            <input type="hidden" name="collection" value={collection} />
            <input type="hidden" name="record_id" value={record.id} />
            <input type="hidden" name="record_action" value={record.archivedAt ? "restore" : "archive"} />
            <input type="hidden" name="return_path" value={returnPath} />
            <button className="w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
              {record.archivedAt ? "Restore" : "Archive"}
            </button>
          </form>

          <form action={manageRecordAction}>
            <input type="hidden" name="collection" value={collection} />
            <input type="hidden" name="record_id" value={record.id} />
            <input type="hidden" name="record_action" value="duplicate" />
            <input type="hidden" name="return_path" value={returnPath} />
            <button className="w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50">
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
              className="w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50"
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
  searchParams
}: ManagedRecordListProps) {
  const sort = param(searchParams?.sort) || "newest";
  const visibleRecords = sortedRecords(filteredRecords(records, folders, searchParams), sort);
  const returnPath = configuredReturnPath || `/app/${collection.replace("_", "-")}`;
  const activeFolders = folderOptions(folders);
  const statusOptions = uniqueOptions(records, "status");
  const ownerOptions = uniqueOptions(records, "owner");
  const categoryOptions = uniqueOptions(records, "category");
  const bulkFormId = `bulk-${collection}`;
  const activeFolder = param(searchParams?.folder);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 border-b border-line pb-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-1 text-sm leading-6 text-muted">{description}</p> : null}
        </div>
        <form method="get" className="flex w-full gap-2 lg:max-w-md">
          <input
            name="q"
            defaultValue={param(searchParams?.q)}
            placeholder="Search records"
            className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-vaeroex-blue"
          />
          <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Search</button>
        </form>
      </div>

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <FolderQuickFilters folders={folders} records={records} activeFolder={activeFolder} returnPath={returnPath} />

        <div className="space-y-3">
          <details className="rounded-lg border border-line bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Filters</summary>
            <form method="get" className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <input type="hidden" name="q" value={param(searchParams?.q)} />
              <select name="folder" defaultValue={activeFolder} className="rounded-lg border border-line px-3 py-2 text-sm">
                <option value="">All folders</option>
                <option value="unfiled">Unfiled</option>
                {activeFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
              <select name="status" defaultValue={param(searchParams?.status)} className="rounded-lg border border-line px-3 py-2 text-sm">
                <option value="">All statuses</option>
                {statusOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              <select name="owner" defaultValue={param(searchParams?.owner)} className="rounded-lg border border-line px-3 py-2 text-sm">
                <option value="">All owners</option>
                {ownerOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              <select name="category" defaultValue={param(searchParams?.category)} className="rounded-lg border border-line px-3 py-2 text-sm">
                <option value="">All categories</option>
                {categoryOptions.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
              <select name="sort" defaultValue={sort} className="rounded-lg border border-line px-3 py-2 text-sm">
                {sortOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <select name="view" defaultValue={param(searchParams?.view) || "active"} className="rounded-lg border border-line px-3 py-2 text-sm">
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="deleted">Deleted</option>
                <option value="all">All</option>
              </select>
              <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white md:col-span-2 xl:col-span-1">
                Apply filters
              </button>
            </form>
          </details>

          <details className="rounded-lg border border-line bg-white p-3">
            <summary className="cursor-pointer text-sm font-semibold text-slate-700">Bulk actions</summary>
            <form id={bulkFormId} action={bulkManageRecordsAction} className="mt-3 grid gap-3 md:grid-cols-[1fr_220px_auto]">
              <input type="hidden" name="collection" value={collection} />
              <input type="hidden" name="return_path" value={returnPath} />
              <select name="bulk_action" className="rounded-lg border border-line px-3 py-2 text-sm" required>
                <option value="">Bulk action</option>
                <option value="archive">Archive selected</option>
                <option value="delete">Delete selected</option>
                <option value="move">Move selected to folder</option>
                <option value="restore">Restore selected</option>
              </select>
              <select name="target_folder_id" className="rounded-lg border border-line px-3 py-2 text-sm">
                <option value="">No folder</option>
                {activeFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>{folder.name}</option>
                ))}
              </select>
              <ConfirmSubmitButton message="Apply this action to the selected records?">Apply</ConfirmSubmitButton>
            </form>
          </details>

          <FolderManager collection={collection} folders={folders} returnPath={returnPath} />

          {visibleRecords.length ? (
            <div className="rounded-lg border border-line bg-white">
              <div className="hidden border-b border-line bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted md:grid md:grid-cols-[32px_minmax(220px,1.5fr)_120px_120px_120px_140px_44px] md:gap-3">
                <span />
                <span>Title</span>
                <span>Status</span>
                <span>Owner</span>
                <span>Category</span>
                <span>Date</span>
                <span />
              </div>
              <div className="divide-y divide-line">
                {visibleRecords.map((record) => (
                  <article key={record.id} className="px-3 py-2">
                    <div className="grid gap-3 md:grid-cols-[32px_minmax(220px,1.5fr)_120px_120px_120px_140px_44px] md:items-center">
                      <input
                        form={bulkFormId}
                        type="checkbox"
                        name="record_id"
                        value={record.id}
                        className="mt-1 h-4 w-4 rounded border-line text-vaeroex-blue md:mt-0"
                        aria-label={`Select ${record.title}`}
                      />
                      <details className="group min-w-0 md:contents">
                        <summary className="cursor-pointer list-none md:col-start-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-semibold text-ink">{record.title}</h3>
                              {record.archivedAt ? <StatusBadge value="Archived" /> : null}
                              {record.deletedAt ? <StatusBadge value="Deleted" /> : null}
                            </div>
                            <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted">
                              {record.preview || record.type || "No preview available."}
                            </p>
                            <p className="mt-1 text-xs text-muted md:hidden">
                              {record.status || "No status"} · {record.owner || "No owner"} · {record.category || "Uncategorized"} · {readableDate(record.updatedAt || record.createdAt)}
                            </p>
                          </div>
                        </summary>
                        <div className="mt-3 space-y-3 rounded-lg border border-line bg-slate-50 p-3 md:col-span-7 md:col-start-1">
                          <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Type</p>
                              <p className="mt-1 text-ink">{record.type || "Record"}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Folder</p>
                              <p className="mt-1 text-ink">{getFolderName(folders, record.folderId)}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Created</p>
                              <p className="mt-1 text-ink">{readableDate(record.createdAt)}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Updated</p>
                              <p className="mt-1 text-ink">{readableDate(record.updatedAt || record.createdAt)}</p>
                            </div>
                          </div>
                          {record.meta?.length ? (
                            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                              {record.meta.map((item) => (
                                <div key={item.label} className="rounded-md bg-white p-3 text-sm">
                                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{item.label}</p>
                                  <div className="mt-1 text-ink">{item.value || "Not set"}</div>
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {record.children ? <div className="rounded-md bg-white p-3">{record.children}</div> : null}
                        </div>
                      </details>
                      <div className="hidden md:block">{record.status ? <StatusBadge value={record.status} /> : <span className="text-sm text-muted">-</span>}</div>
                      <div className="hidden truncate text-sm text-slate-700 md:block">{record.owner || "-"}</div>
                      <div className="hidden md:block">{record.category ? <StatusBadge value={record.category} /> : <span className="text-sm text-muted">-</span>}</div>
                      <div className="hidden text-sm text-muted md:block">{readableDate(record.updatedAt || record.createdAt)}</div>
                      <RecordActionsMenu collection={collection} record={record} activeFolders={activeFolders} returnPath={returnPath} />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState title={emptyTitle} description={emptyDescription} />
          )}
        </div>
      </div>
    </div>
  );
}
