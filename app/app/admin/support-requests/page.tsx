import { manageSupportRequestAction, updateSupportRequestAction } from "@/app/app/admin/support-requests/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { managedValues } from "@/lib/records/management";

type AdminSupportRequestsPageProps = {
  searchParams?: Promise<{ q?: string; status?: string; view?: string; error?: string; message?: string }>;
};

const statuses = ["open", "in_review", "waiting_on_customer", "resolved", "closed"];
const priorities = ["Low", "Medium", "High", "Urgent"];

export default async function AdminSupportRequestsPage({ searchParams }: AdminSupportRequestsPageProps) {
  const params = await searchParams;
  const query = params?.q?.trim() || "";
  const status = params?.status?.trim() || "";
  const view = params?.view?.trim() || "active";
  const access = await getVaeroexAdminAccess();

  if (!access.allowed || !access.admin) {
    return <ErrorNotice message={params?.error || access.error} />;
  }

  let requestsQuery = access.admin
    .from("support_requests")
    .select("*");

  if (query) {
    requestsQuery = requestsQuery.or(`email.ilike.%${query}%,name.ilike.%${query}%,issue_type.ilike.%${query}%`);
  }

  if (status) {
    requestsQuery = requestsQuery.eq("status", status);
  }

  const [{ data: rawRequests }, { data: workspaces }] = await Promise.all([
    requestsQuery.order("created_at", { ascending: false }).limit(60),
    access.admin.from("workspaces").select("id,name").limit(500)
  ]);
  const workspaceName = new Map((workspaces || []).map((workspace) => [workspace.id, workspace.name]));
  const requests = (rawRequests || []).filter((request) => {
    const management = managedValues(request);

    if (view === "archived") return Boolean(management.archivedAt) && !management.deletedAt;
    if (view === "deleted") return Boolean(management.deletedAt);
    if (view === "all") return true;

    return !management.archivedAt && !management.deletedAt;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Support requests"
        description="Review and triage support requests submitted from the public and in-app support forms."
      />
      {params?.message ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{params.message}</div> : null}
      <ErrorNotice message={params?.error} />

      <SectionCard title="Search support" description="Search by name, email, issue type, or filter by status.">
        <form className="grid gap-3 md:grid-cols-[1fr_220px_180px_auto]">
          <input
            name="q"
            defaultValue={query}
            placeholder="Name, email, or issue type"
            className="rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
          <select name="status" defaultValue={status} className="rounded-lg border border-line px-3 py-2">
            <option value="">All statuses</option>
            {statuses.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
          <select name="view" defaultValue={view} className="rounded-lg border border-line px-3 py-2">
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="deleted">Deleted</option>
            <option value="all">All</option>
          </select>
          <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Search</button>
        </form>
      </SectionCard>

      <SectionCard title="Queue">
        <div className="space-y-4">
          {requests.length ? requests.map((request) => {
            const management = managedValues(request);

            return (
            <article key={request.id} className="rounded-lg border border-line p-4">
              <details>
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <p className="font-semibold">{request.name} · {request.email}</p>
                      <p className="mt-1 text-sm text-muted">
                        {request.issue_type} · {workspaceName.get(request.workspace_id || "") || request.workspace_id || "No workspace"} · Created{" "}
                        {new Date(request.created_at).toLocaleDateString()}
                      </p>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{request.message}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge value={request.priority} />
                      <StatusBadge value={request.status} />
                      {management.archivedAt ? <StatusBadge value="Archived" /> : null}
                      {management.deletedAt ? <StatusBadge value="Deleted" /> : null}
                    </div>
                  </div>
                  <span className="mt-3 inline-flex text-xs font-semibold text-vaeroex-blue">View request</span>
                </summary>
                <div className="mt-4 rounded-lg bg-slate-50 p-4 text-sm leading-6 text-muted whitespace-pre-wrap">{request.message}</div>
              </details>
              <form action={updateSupportRequestAction} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <input type="hidden" name="support_request_id" value={request.id} />
                <select name="status" defaultValue={request.status} className="rounded-lg border border-line px-3 py-2 text-sm">
                  {statuses.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
                <select name="priority" defaultValue={request.priority} className="rounded-lg border border-line px-3 py-2 text-sm">
                  {priorities.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
                <button className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">Update</button>
              </form>
              <div className="mt-3 flex flex-wrap gap-2">
                <form action={manageSupportRequestAction}>
                  <input type="hidden" name="support_request_id" value={request.id} />
                  <input type="hidden" name="support_action" value={management.archivedAt || management.deletedAt ? "restore" : "archive"} />
                  <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">
                    {management.archivedAt || management.deletedAt ? "Restore" : "Archive"}
                  </button>
                </form>
                <form action={manageSupportRequestAction}>
                  <input type="hidden" name="support_request_id" value={request.id} />
                  <input type="hidden" name="support_action" value="duplicate" />
                  <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Duplicate</button>
                </form>
                <form action={manageSupportRequestAction}>
                  <input type="hidden" name="support_request_id" value={request.id} />
                  <input type="hidden" name="support_action" value="delete" />
                  <ConfirmSubmitButton
                    message="Delete this support request from the active queue?"
                    className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                  >
                    Delete
                  </ConfirmSubmitButton>
                </form>
              </div>
            </article>
          );
          }) : (
            <EmptyState title="No support requests" description="Requests from /support and /app/support will appear here." />
          )}
        </div>
      </SectionCard>
    </div>
  );
}
