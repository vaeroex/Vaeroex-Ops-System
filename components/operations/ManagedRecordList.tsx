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

function uniqueOptions(records: ManagedRecord[], key: "status" | "owner" | "category") {
  return Array.from(new Set(records.map((record) => record[key]).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b));
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
    if (folder && record.folderId !== folder) return false;
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

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-6 text-muted">{description}</p> : null}
      </div>

      <form method="get" className="grid gap-3 rounded-lg border border-line bg-slate-50 p-4 lg:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_0.8fr_0.8fr_auto]">
        <input
          name="q"
          defaultValue={param(searchParams?.q)}
          placeholder="Search"
          className="rounded-lg border border-line px-3 py-2 text-sm outline-none focus:border-vaeroex-blue"
        />
        <select name="folder" defaultValue={param(searchParams?.folder)} className="rounded-lg border border-line px-3 py-2 text-sm">
          <option value="">All folders</option>
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
        <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white lg:col-start-7">Apply</button>
      </form>

      <FolderManager collection={collection} folders={folders} returnPath={returnPath} />

      <form id={bulkFormId} action={bulkManageRecordsAction} className="grid gap-3 rounded-lg border border-line bg-white p-4 md:grid-cols-[1fr_220px_auto]">
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
        <ConfirmSubmitButton message="Apply this action to the selected records?">Apply bulk action</ConfirmSubmitButton>
      </form>

      {visibleRecords.length ? (
        <div className="space-y-3">
          {visibleRecords.map((record) => (
            <article key={record.id} className="rounded-lg border border-line bg-white p-4 shadow-panel">
              <div className="flex items-start gap-3">
                <input
                  form={bulkFormId}
                  type="checkbox"
                  name="record_id"
                  value={record.id}
                  className="mt-1 h-4 w-4 rounded border-line text-vaeroex-blue"
                  aria-label={`Select ${record.title}`}
                />
                <details className="group min-w-0 flex-1">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-ink">{record.title}</h3>
                          {record.archivedAt ? <StatusBadge value="Archived" /> : null}
                          {record.deletedAt ? <StatusBadge value="Deleted" /> : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">
                          {record.preview || record.type || "No preview available."}
                        </p>
                        <p className="mt-2 text-xs text-muted">
                          {record.type || "Record"} · {getFolderName(folders, record.folderId)} · Created {readableDate(record.createdAt)} · Updated{" "}
                          {readableDate(record.updatedAt || record.createdAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {record.status ? <StatusBadge value={record.status} /> : null}
                        {record.owner ? <StatusBadge value={record.owner} /> : null}
                        {record.category ? <StatusBadge value={record.category} /> : null}
                      </div>
                    </div>
                    <span className="mt-3 inline-flex text-xs font-semibold text-vaeroex-blue group-open:hidden">View details</span>
                    <span className="mt-3 hidden text-xs font-semibold text-vaeroex-blue group-open:inline-flex">Hide details</span>
                  </summary>

                  <div className="mt-4 space-y-4 border-t border-line pt-4">
                    {record.meta?.length ? (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {record.meta.map((item) => (
                          <div key={item.label} className="rounded-lg bg-slate-50 p-3 text-sm">
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{item.label}</p>
                            <div className="mt-1 text-ink">{item.value || "Not set"}</div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {record.children ? <div className="rounded-lg bg-slate-50 p-4">{record.children}</div> : null}
                  </div>
                </details>
              </div>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                {record.quickActions ? <div className="flex flex-wrap gap-2">{record.quickActions}</div> : null}
                {record.href ? (
                  <Link href={record.href} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
                    Open
                  </Link>
                ) : null}
                <form action={manageRecordAction} className="flex flex-wrap gap-2">
                  <input type="hidden" name="collection" value={collection} />
                  <input type="hidden" name="record_id" value={record.id} />
                  <input type="hidden" name="return_path" value={returnPath} />
                  <select name="target_folder_id" defaultValue={record.folderId || ""} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <option value="">No folder</option>
                    {activeFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>{folder.name}</option>
                    ))}
                  </select>
                  <button name="record_action" value="move" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
                    Move
                  </button>
                  <button name="record_action" value={record.archivedAt ? "restore" : "archive"} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
                    {record.archivedAt ? "Restore" : "Archive"}
                  </button>
                  <button name="record_action" value="duplicate" className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
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
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                  >
                    Delete
                  </ConfirmSubmitButton>
                </form>
              </div>

              {record.editFields?.length ? (
                <details className="mt-4 rounded-lg border border-line bg-slate-50 p-4">
                  <summary className="cursor-pointer text-sm font-semibold">Edit</summary>
                  <form action={updateManagedRecordAction} className="mt-4 grid gap-4 md:grid-cols-2">
                    <input type="hidden" name="collection" value={collection} />
                    <input type="hidden" name="record_id" value={record.id} />
                    <input type="hidden" name="return_path" value={returnPath} />
                    {record.editFields.map((field) => (
                      <label key={field.name} className={field.type === "textarea" || field.type === "lines" ? "block text-sm font-medium md:col-span-2" : "block text-sm font-medium"}>
                        {field.label}
                        {fieldInput(field, record.editValues?.[field.name])}
                      </label>
                    ))}
                    <div className="md:col-span-2">
                      <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Save changes</button>
                    </div>
                  </form>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      )}
    </div>
  );
}
