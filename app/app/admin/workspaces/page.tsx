import { updateWorkspaceAccessAction } from "@/app/app/admin/workspaces/actions";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";

type AdminWorkspacesPageProps = {
  searchParams?: Promise<{ q?: string; error?: string; message?: string }>;
};

const statuses = ["active", "trialing", "past_due", "canceled", "expired", "manual_review", "demo"];
const plans = ["", "starter", "growth", "pro"];

export default async function AdminWorkspacesPage({ searchParams }: AdminWorkspacesPageProps) {
  const params = await searchParams;
  const query = params?.q?.trim() || "";
  const access = await getVaeroexAdminAccess();

  if (!access.allowed || !access.admin) {
    return <ErrorNotice message={params?.error || access.error} />;
  }

  let workspacesQuery = access.admin
    .from("workspaces")
    .select("*");

  if (query) {
    workspacesQuery = workspacesQuery.or(`name.ilike.%${query}%,primary_contact_email.ilike.%${query}%,subscription_status.ilike.%${query}%`);
  }

  const { data: workspaces } = await workspacesQuery.order("created_at", { ascending: false }).limit(40);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Workspaces"
        description="Review workspace status, subscription fields, and manually unlock or deactivate access when needed."
      />
      {params?.message ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{params.message}</div> : null}
      <ErrorNotice message={params?.error} />

      <SectionCard title="Search workspaces" description="Search by workspace name, contact email, or subscription status.">
        <form className="flex flex-col gap-3 sm:flex-row">
          <input
            name="q"
            defaultValue={query}
            placeholder="Workspace, email, or status"
            className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
          <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Search</button>
        </form>
      </SectionCard>

      <SectionCard title="Workspace access">
        <div className="space-y-4">
          {workspaces?.length ? workspaces.map((workspace) => (
            <article key={workspace.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-semibold">{workspace.name}</p>
                  <p className="mt-1 text-sm text-muted">{workspace.primary_contact_email || "No contact email"} · {workspace.industry || "No industry"}</p>
                  <p className="mt-2 break-all text-xs text-muted">{workspace.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge value={workspace.subscription_status} />
                  <StatusBadge value={workspace.plan_slug} />
                  <StatusBadge value={workspace.manually_unlocked ? "manual unlock" : "locked by status"} />
                </div>
              </div>

              <form action={updateWorkspaceAccessAction} className="mt-4 grid gap-3 md:grid-cols-5">
                <input type="hidden" name="workspace_id" value={workspace.id} />
                <select name="subscription_status" defaultValue={workspace.subscription_status} className="rounded-lg border border-line px-3 py-2 text-sm">
                  {statuses.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
                <select name="plan_slug" defaultValue={workspace.plan_slug || ""} className="rounded-lg border border-line px-3 py-2 text-sm">
                  {plans.map((plan) => (
                    <option key={plan || "none"} value={plan}>{plan || "No plan"}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <input type="checkbox" name="subscription_required" defaultChecked={workspace.subscription_required} />
                  Required
                </label>
                <label className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <input type="checkbox" name="manually_unlocked" defaultChecked={workspace.manually_unlocked} />
                  Manual unlock
                </label>
                <button className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">Update access</button>
              </form>
            </article>
          )) : (
            <EmptyState title="No workspaces found" description="Try a different workspace or customer search." />
          )}
        </div>
      </SectionCard>
    </div>
  );
}
