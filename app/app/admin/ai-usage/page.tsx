import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";

export default async function AdminAiUsagePage() {
  const access = await getVaeroexAdminAccess();

  if (!access.allowed || !access.admin) {
    return <ErrorNotice message={access.error} />;
  }

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  const [{ data: usage }, { data: runs }, { data: workspaces }, { data: failedRuns }] = await Promise.all([
    access.admin.from("ai_usage").select("*").gte("created_at", monthStart.toISOString()).order("created_at", { ascending: false }).limit(200),
    access.admin.from("ai_agent_runs").select("id,workspace_id,agent_type,status,error_message,created_at").order("created_at", { ascending: false }).limit(100),
    access.admin.from("workspaces").select("id,name").limit(500),
    access.admin.from("ai_agent_runs").select("id,workspace_id,agent_type,error_message,created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(25)
  ]);

  const workspaceName = new Map((workspaces || []).map((workspace) => [workspace.id, workspace.name]));
  const usageByWorkspace = new Map<string, { runs: number; tokens: number; cost: number }>();

  for (const row of usage || []) {
    const key = row.workspace_id || "No workspace";
    const current = usageByWorkspace.get(key) || { runs: 0, tokens: 0, cost: 0 };
    usageByWorkspace.set(key, {
      runs: current.runs + 1,
      tokens: current.tokens + row.tokens_used,
      cost: current.cost + row.estimated_cost_cents
    });
  }

  const usageRows = [...usageByWorkspace.entries()].sort((a, b) => b[1].runs - a[1].runs).slice(0, 20);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Vaeroex usage"
        description="Review monthly Vaeroex run usage, recent run history, and failed run errors."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Usage rows this month</p>
          <p className="mt-2 text-3xl font-semibold">{usage?.length || 0}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Recent Vaeroex runs</p>
          <p className="mt-2 text-3xl font-semibold">{runs?.length || 0}</p>
        </article>
        <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <p className="text-sm text-muted">Recent failed runs</p>
          <p className="mt-2 text-3xl font-semibold">{failedRuns?.length || 0}</p>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
        <SectionCard title="Monthly usage by workspace">
          <div className="space-y-3">
            {usageRows.length ? usageRows.map(([workspaceId, totals]) => (
              <article key={workspaceId} className="rounded-lg border border-line p-4">
                <p className="font-semibold">{workspaceName.get(workspaceId) || workspaceId}</p>
                <p className="mt-1 break-all text-xs text-muted">{workspaceId}</p>
                <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
                  <p>{totals.runs} runs</p>
                  <p>{totals.tokens} tokens</p>
                  <p>{totals.cost} cents</p>
                </div>
              </article>
            )) : (
              <EmptyState title="No usage this month" description="Vaeroex usage rows will appear after customers run workflows." />
            )}
          </div>
        </SectionCard>

        <SectionCard title="Recent Vaeroex runs">
          <div className="space-y-3">
            {runs?.length ? runs.map((run) => (
              <article key={run.id} className="rounded-lg border border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{run.agent_type}</p>
                    <p className="mt-1 text-xs text-muted">{workspaceName.get(run.workspace_id) || run.workspace_id}</p>
                  </div>
                  <StatusBadge value={run.status} />
                </div>
                {run.error_message ? <p className="mt-3 text-sm leading-6 text-red-700">{run.error_message}</p> : null}
              </article>
            )) : (
              <EmptyState title="No Vaeroex runs" description="Recent runs will appear here." />
            )}
          </div>
        </SectionCard>
      </section>

      <SectionCard title="Recent errors">
        <div className="space-y-3">
          {failedRuns?.length ? failedRuns.map((run) => (
            <article key={run.id} className="rounded-lg border border-line p-4">
              <p className="font-semibold">{run.agent_type}</p>
              <p className="mt-1 text-xs text-muted">{workspaceName.get(run.workspace_id) || run.workspace_id}</p>
              <p className="mt-3 text-sm leading-6 text-red-700">{run.error_message || "Vaeroex run failed."}</p>
            </article>
          )) : (
            <EmptyState title="No failed runs" description="Failed Vaeroex run details will appear here." />
          )}
        </div>
      </SectionCard>
    </div>
  );
}
