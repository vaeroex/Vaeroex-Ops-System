import Link from "next/link";
import type { Route } from "next";
import { SupportRequestsInbox } from "@/components/admin/SupportRequestsInbox";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { SUPPORT_PAGE_SIZE, SUPPORT_REQUEST_LIST_FIELDS, supportFilters, supportPageHref, supportSearchExpression } from "@/lib/admin/support-requests";

type AdminSupportRequestsPageProps = {
  searchParams?: Promise<{ q?: string | string[]; status?: string | string[]; view?: string | string[]; page?: string | string[] }>;
};

export default async function AdminSupportRequestsPage({ searchParams }: AdminSupportRequestsPageProps) {
  const filters = supportFilters(await searchParams);
  const access = await getVaeroexAdminAccess();
  if (!access.allowed || !access.admin) return <ErrorNotice message={access.error} />;

  let query = access.admin.from("support_requests").select(SUPPORT_REQUEST_LIST_FIELDS, { count: "exact" });
  if (filters.q) query = query.or(supportSearchExpression(filters.q));
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.view === "active") query = query.is("archived_at", null).is("deleted_at", null);
  if (filters.view === "archived") query = query.not("archived_at", "is", null).is("deleted_at", null);
  if (filters.view === "deleted") query = query.not("deleted_at", "is", null);
  const offset = (filters.page - 1) * SUPPORT_PAGE_SIZE;
  const { data, error, count } = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + SUPPORT_PAGE_SIZE - 1);
  const rows = data || [];
  const workspaceIds = [...new Set(rows.map((request) => request.workspace_id).filter((id): id is string => Boolean(id)))];
  const workspaceResult = workspaceIds.length ? await access.admin.from("workspaces").select("id,name").in("id", workspaceIds) : { data: [], error: null };
  const workspaceNames = new Map((workspaceResult.data || []).map((workspace) => [workspace.id, workspace.name]));
  const requests = rows.map((row) => ({ ...row, workspaceName: row.workspace_id ? workspaceNames.get(row.workspace_id) || "Workspace name unavailable" : "No workspace" }));
  const total = count ?? 0;
  const pages = Math.max(1, Math.ceil(total / SUPPORT_PAGE_SIZE));

  return (
    <div className="space-y-4">
      <header><p className="text-xs font-semibold uppercase tracking-wide text-muted">Platform admin · All workspaces</p><h1 className="mt-1 text-2xl font-semibold">Support requests</h1><p className="mt-1 text-sm text-muted">Review contact inquiries and public or in-app support requests. Deleted requests retain their contents and can be restored.</p></header>
      {error ? <ErrorNotice message="Support requests are unavailable. Refresh and try again." /> : <>
        {workspaceResult.error ? <ErrorNotice message="Some workspace names are unavailable. Request filters and counts are still complete." /> : null}
        <SupportRequestsInbox key={JSON.stringify(filters)} requests={requests} filters={filters} total={total} />
        <nav aria-label="Support request pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted">{total ? `${requests.length ? offset + 1 : 0}–${requests.length ? offset + requests.length : 0} of ${total}` : "0 requests"} · {SUPPORT_PAGE_SIZE} per page · Page {filters.page} of {pages}</span>
          <div className="flex gap-2">
            {filters.page > 1 ? <Link className="rounded-lg border border-line px-3 py-2" href={supportPageHref(filters, Math.min(filters.page - 1, pages)) as Route}>Previous</Link> : null}
            {filters.page < pages ? <Link className="rounded-lg border border-line px-3 py-2" href={supportPageHref(filters, filters.page + 1) as Route}>Next</Link> : null}
          </div>
        </nav>
      </>}
    </div>
  );
}
