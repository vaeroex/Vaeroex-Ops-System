import Link from "next/link";
import type { Route } from "next";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { ManagedRecordList } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { ASSET_STATUSES, assetCheckHistoryFilters, loadAssetCheckHistory } from "@/lib/records/asset-check-history";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export default async function AssetCheckHistoryPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams || {};
  const { supabase, workspaceId } = await requireWorkspacePage();
  let filters;
  try { filters = assetCheckHistoryFilters(params); }
  catch (error) { return <ErrorNotice message={error instanceof Error ? error.message : "Invalid history filters."} />; }
  const [result, folders] = await Promise.all([loadAssetCheckHistory(supabase, workspaceId, filters), getRecordFolders(supabase, workspaceId, "asset_checks")]);
  const assetIds = [...new Set([...(result.data || []).map((check) => check.asset_id), ...(filters.assetId ? [filters.assetId] : [])])];
  const assets = assetIds.length ? await supabase.from("assets").select("id,asset_name").eq("workspace_id", workspaceId).in("id", assetIds) : { data: [], error: null };
  const names = new Map((assets.data || []).map((asset) => [asset.id, asset.asset_name]));
  const href = (page: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (typeof value === "string" && !["page", "error", "message"].includes(key)) next.set(key, value);
    next.set("page", String(page));
    return `/app/assets/checks?${next}` as Route;
  };
  const records = (result.data || []).map((check) => {
    const management = managedValues(check);
    const name = names.get(check.asset_id) || "Unavailable asset";
    return { id: check.id, title: name, type: "Asset check", status: check.status, owner: check.checked_by ? "Checked" : "Unassigned", category: name, createdAt: check.created_at, updatedAt: management.updatedAt, folderId: management.folderId, archivedAt: management.archivedAt, deletedAt: management.deletedAt, preview: shortPreview(check.notes, "No notes."), editFields: [{ name: "status", label: "Status", type: "select" as const, options: ASSET_STATUSES }, { name: "notes", label: "Notes", type: "textarea" as const, rows: 4 }], editValues: { status: check.status, notes: check.notes }, children: <p className="whitespace-pre-wrap text-sm">{check.notes || "No notes."}</p> };
  });
  const total = result.count || 0;
  const pages = Math.max(1, Math.ceil(total / filters.size));
  const control = "mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 py-2 text-ink";
  return <div className="space-y-6">
    <PageHeader eyebrow="Assets" title="Asset check history" description={filters.assetId ? `All recorded checks for ${names.get(filters.assetId) || "the selected asset"}.` : "Review all asset checks, including archived and hidden history."} actions={<Link href="/app/assets" className="rounded-lg border border-line px-4 py-2">Back to assets</Link>} />
    <ErrorNotice message={result.error || folders.error || assets.error ? "Asset check history is temporarily unavailable. Refresh and try again." : undefined} />
    <form method="get" className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-2 lg:grid-cols-4">
      {filters.assetId ? <input type="hidden" name="asset_id" value={filters.assetId} /> : null}
      <label>Search check notes<input name="q" defaultValue={filters.query} maxLength={200} className={control} /></label>
      <label>Status<select name="status" defaultValue={filters.status} className={control}><option value="">All statuses</option>{ASSET_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label>
      <label>History<select name="view" defaultValue={filters.view} className={control}>{[["active", "Active"], ["archived", "Archived"], ["deleted", "Hidden"], ["all", "All"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Folder<select name="folder" defaultValue={filters.folder} className={control}><option value="">All folders</option><option value="unfiled">Unfiled</option>{folders.folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select></label>
      <label>Checked on or after (UTC)<input name="from" type="date" defaultValue={filters.from} className={control} /></label>
      <label>Checked on or before (UTC)<input name="to" type="date" defaultValue={filters.to} className={control} /></label>
      <label>Order<select name="sort" defaultValue={filters.oldest ? "oldest" : "newest"} className={control}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      <label>Checks per page<select name="size" defaultValue={filters.size} className={control}>{[10, 25, 50].map((size) => <option key={size}>{size}</option>)}</select></label>
      <button className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 font-semibold text-white">Apply filters</button>
      <Link href="/app/assets/checks" className="flex min-h-11 items-center underline">Clear filters</Link>
    </form>
    {!result.error ? <>
      <nav aria-label="Asset check history pages" className="flex flex-wrap items-center gap-4">
        <p>{total ? `${(result.page - 1) * filters.size + 1}–${Math.min(result.page * filters.size, total)} of ${total} checks` : "0 matching checks"} · Page {result.page} of {pages}</p>
        {result.page > 1 ? <Link href={href(result.page - 1)} className="rounded-lg border px-4 py-2">Previous</Link> : null}
        {result.page < pages ? <Link href={href(result.page + 1)} className="rounded-lg border px-4 py-2">Next</Link> : null}
      </nav>
      <ManagedRecordList collection="asset_checks" records={records} folders={folders.folders} title="Check records" emptyTitle="No matching checks" emptyDescription="Adjust the filters or record an asset check from Assets." returnPath={href(result.page)} searchParams={{ message: params.message, error: params.error }} serverManaged />
    </> : null}
  </div>;
}
