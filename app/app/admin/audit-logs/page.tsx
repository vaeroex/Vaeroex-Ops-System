import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { JsonPreview } from "@/components/operations/JsonPreview";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";

type AdminAuditLogsPageProps = {
  searchParams?: Promise<{ q?: string; error?: string }>;
};

export default async function AdminAuditLogsPage({ searchParams }: AdminAuditLogsPageProps) {
  const params = await searchParams;
  const query = params?.q?.trim() || "";
  const access = await getVaeroexAdminAccess();

  if (!access.allowed || !access.admin) {
    return <ErrorNotice message={params?.error || access.error} />;
  }

  let logsQuery = access.admin
    .from("audit_logs")
    .select("*");

  if (query) {
    logsQuery = logsQuery.or(`action.ilike.%${query}%,entity_type.ilike.%${query}%`);
  }

  const [{ data: logs }, { data: workspaces }, { data: failedRuns }, { data: subscriptionErrors }] = await Promise.all([
    logsQuery.order("created_at", { ascending: false }).limit(80),
    access.admin.from("workspaces").select("id,name").limit(500),
    access.admin.from("ai_agent_runs").select("id,workspace_id,agent_type,error_message,created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(10),
    access.admin.from("subscription_events").select("id,event_type,customer_email,processing_error,created_at").not("processing_error", "is", null).order("created_at", { ascending: false }).limit(10)
  ]);
  const workspaceName = new Map((workspaces || []).map((workspace) => [workspace.id, workspace.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Audit logs"
        description="Review tenant audit history and recent operational errors that need Vaeroex follow-up."
      />
      <ErrorNotice message={params?.error} />

      <SectionCard title="Search audit logs" description="Search by action or entity type.">
        <form className="flex flex-col gap-3 sm:flex-row">
          <input
            name="q"
            defaultValue={query}
            placeholder="action or entity type"
            className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
          <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Search</button>
        </form>
      </SectionCard>

      <section className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Recent Vaeroex errors">
          <div className="space-y-3">
            {failedRuns?.length ? failedRuns.map((run) => (
              <article key={run.id} className="rounded-lg border border-line p-4">
                <p className="font-semibold">{run.agent_type}</p>
                <p className="mt-1 text-xs text-muted">{workspaceName.get(run.workspace_id) || run.workspace_id}</p>
                <p className="mt-3 text-sm leading-6 text-red-700">{run.error_message || "Vaeroex run failed."}</p>
              </article>
            )) : (
              <EmptyState title="No Vaeroex errors" description="Failed Vaeroex run details will appear here." />
            )}
          </div>
        </SectionCard>

        <SectionCard title="Recent subscription errors">
          <div className="space-y-3">
            {subscriptionErrors?.length ? subscriptionErrors.map((event) => (
              <article key={event.id} className="rounded-lg border border-line p-4">
                <p className="font-semibold">{event.event_type || "Squarespace event"}</p>
                <p className="mt-1 text-xs text-muted">{event.customer_email || "No customer email"}</p>
                <p className="mt-3 text-sm leading-6 text-red-700">{event.processing_error}</p>
              </article>
            )) : (
              <EmptyState title="No subscription errors" description="Squarespace processing errors will appear here." />
            )}
          </div>
        </SectionCard>
      </section>

      <SectionCard title="Audit history">
        <div className="space-y-4">
          {logs?.length ? logs.map((log) => (
            <article key={log.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="font-semibold">{log.action}</p>
                  <p className="mt-1 text-sm text-muted">{workspaceName.get(log.workspace_id) || log.workspace_id}</p>
                  <p className="mt-1 break-all text-xs text-muted">{log.entity_type} · {log.entity_id || "No entity ID"}</p>
                </div>
                <StatusBadge value={log.entity_type} />
              </div>
              <div className="mt-4">
                <JsonPreview value={log.metadata_json} />
              </div>
            </article>
          )) : (
            <EmptyState title="No audit logs" description="Audit logs will appear after tracked workspace actions are recorded." />
          )}
        </div>
      </SectionCard>
    </div>
  );
}
