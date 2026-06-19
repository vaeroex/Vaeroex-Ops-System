import { updateWorkspaceAccessAction } from "@/app/app/admin/workspaces/actions";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { displayPlanName, normalizePlanSlug, VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import type { Database } from "@/lib/supabase/types";

type AdminWorkspacesPageProps = {
  searchParams?: Promise<{ q?: string; error?: string; message?: string }>;
};

const statuses = ["active", "trialing", "past_due", "canceled", "expired", "manual_review", "demo"];
const plans = ["", VAEROEX_PLAN_SLUG];
type WorkspaceRow = Database["public"]["Tables"]["workspaces"]["Row"];

function countByWorkspace(rows: Array<{ workspace_id: string }>) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.workspace_id] = (counts[row.workspace_id] || 0) + 1;
    return counts;
  }, {});
}

function customerStatus(workspace: WorkspaceRow) {
  if (workspace.subscription_status === "demo") return "Demo workspace";
  if (!workspace.subscription_required || workspace.manually_unlocked || ["active", "trialing"].includes(workspace.subscription_status)) return "Active";
  if (workspace.subscription_status === "manual_review") return "Pending activation";
  return "Subscription required";
}

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
  const workspaceRows = (workspaces || []) as WorkspaceRow[];
  const workspaceIds = workspaceRows.map((workspace) => workspace.id);
  const [kpiRows, leadRows, fileRows, taskRows, vaeroexRows, reportRows] = workspaceIds.length
    ? await Promise.all([
        access.admin.from("kpis").select("workspace_id").in("workspace_id", workspaceIds),
        access.admin.from("crm_leads").select("workspace_id").in("workspace_id", workspaceIds),
        access.admin.from("file_uploads").select("workspace_id").in("workspace_id", workspaceIds),
        access.admin.from("tasks").select("workspace_id").in("workspace_id", workspaceIds),
        access.admin.from("ai_agent_runs").select("workspace_id").in("workspace_id", workspaceIds),
        access.admin.from("reports").select("workspace_id").in("workspace_id", workspaceIds)
      ])
    : [];
  const kpiCounts = countByWorkspace(kpiRows?.data || []);
  const leadCounts = countByWorkspace(leadRows?.data || []);
  const fileCounts = countByWorkspace(fileRows?.data || []);
  const taskCounts = countByWorkspace(taskRows?.data || []);
  const vaeroexCounts = countByWorkspace(vaeroexRows?.data || []);
  const reportCounts = countByWorkspace(reportRows?.data || []);

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
          {workspaceRows.length ? workspaceRows.map((workspace) => {
            const completed = [
              Boolean(workspace.primary_contact_email || workspace.size),
              Boolean(workspace.industry),
              Boolean(kpiCounts[workspace.id]),
              Boolean(leadCounts[workspace.id]),
              Boolean(fileCounts[workspace.id]),
              Boolean(taskCounts[workspace.id]),
              Boolean(vaeroexCounts[workspace.id]),
              Boolean(reportCounts[workspace.id])
            ].filter(Boolean).length;
            const progress = Math.round((completed / 8) * 100);
            const usage = (kpiCounts[workspace.id] || 0) + (leadCounts[workspace.id] || 0) + (fileCounts[workspace.id] || 0) + (taskCounts[workspace.id] || 0) + (vaeroexCounts[workspace.id] || 0) + (reportCounts[workspace.id] || 0);

            return (
            <article key={workspace.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-semibold">{workspace.name}</p>
                  <p className="mt-1 text-sm text-muted">{workspace.primary_contact_email || "No contact email"} · {workspace.industry || "No industry"}</p>
                  <p className="mt-2 break-all text-xs text-muted">{workspace.id}</p>
                  <p className="mt-2 text-xs text-muted">Last login: not tracked yet</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge value={customerStatus(workspace)} />
                  <StatusBadge value={workspace.subscription_status} />
                  <StatusBadge value={displayPlanName(workspace.plan_slug)} />
                  <StatusBadge value={workspace.manually_unlocked ? "manual unlock" : "locked by status"} />
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-line bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Onboarding progress</p>
                  <p className="mt-2 text-lg font-semibold">{progress}%</p>
                  <p className="mt-1 text-xs text-muted">{completed} of 8 activation steps detected</p>
                </div>
                <div className="rounded-lg border border-line bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Usage</p>
                  <p className="mt-2 text-lg font-semibold">{usage} records</p>
                  <p className="mt-1 text-xs text-muted">KPIs, CRM, files, tasks, Vaeroex runs, reports</p>
                </div>
                <div className="rounded-lg border border-line bg-slate-50 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">Customer status</p>
                  <p className="mt-2 text-lg font-semibold">{customerStatus(workspace)}</p>
                  <p className="mt-1 text-xs text-muted">Active, pending activation, demo, or subscription required</p>
                </div>
              </div>

              <form action={updateWorkspaceAccessAction} className="mt-4 grid gap-3 md:grid-cols-5">
                <input type="hidden" name="workspace_id" value={workspace.id} />
                <select name="subscription_status" defaultValue={workspace.subscription_status} className="rounded-lg border border-line px-3 py-2 text-sm">
                  {statuses.map((status) => (
                    <option key={status} value={status}>{status}</option>
                  ))}
                </select>
                <select name="plan_slug" defaultValue={normalizePlanSlug(workspace.plan_slug) || ""} className="rounded-lg border border-line px-3 py-2 text-sm">
                  {plans.map((plan) => (
                    <option key={plan || "none"} value={plan}>{plan ? "Vaeroex" : "No plan"}</option>
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
          );
          }) : (
            <EmptyState title="No workspaces found" description="Try a different workspace or customer search." />
          )}
        </div>
      </SectionCard>
    </div>
  );
}
