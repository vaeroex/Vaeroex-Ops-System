import Link from "next/link";
import type { Route } from "next";
import { CompactRunTable, GroupedErrorRuns, TruncatedLogMessage, type AdminRunLog } from "@/components/admin/AdminLogViews";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { JsonPreview } from "@/components/operations/JsonPreview";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";

type AdminAuditLogsPageProps = {
  searchParams?: Promise<{ q?: string; error?: string; limit?: string }>;
};

function parseLimit(value: string | undefined, fallback: number, maximum = 80) {
  const parsed = Number.parseInt(value || "", 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, fallback), maximum);
}

function auditHref(query: string, limit: number): Route {
  const params = new URLSearchParams();

  if (query) {
    params.set("q", query);
  }

  if (limit !== 20) {
    params.set("limit", String(limit));
  }

  const search = params.toString();

  return `/app/admin/audit-logs${search ? `?${search}` : ""}` as Route;
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "No date";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export default async function AdminAuditLogsPage({ searchParams }: AdminAuditLogsPageProps) {
  const params = await searchParams;
  const query = params?.q?.trim() || "";
  const logLimit = parseLimit(params?.limit, 20);
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
    logsQuery.order("created_at", { ascending: false }).limit(logLimit),
    access.admin.from("workspaces").select("id,name").limit(500),
    access.admin.from("ai_agent_runs").select("id,workspace_id,agent_type,error_message,created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(25),
    access.admin.from("subscription_events").select("id,event_type,customer_email,processing_error,created_at").not("processing_error", "is", null).order("created_at", { ascending: false }).limit(15)
  ]);
  const workspaceName = new Map((workspaces || []).map((workspace) => [workspace.id, workspace.name]));
  const failedRunRows = (failedRuns || []).map((run) => ({ ...run, status: "failed" })) as AdminRunLog[];

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
        <SectionCard title="Recent Vaeroex errors" description="Grouped by message so repeated failures stay compact.">
          <GroupedErrorRuns
            runs={failedRunRows}
            workspaceNames={workspaceName}
            emptyTitle="No Vaeroex errors"
            emptyDescription="Failed Vaeroex run details will appear here."
          />
        </SectionCard>

        <SectionCard title="Recent subscription errors" description="Latest billing/webhook processing errors with long messages collapsed.">
          {subscriptionErrors?.length ? (
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="min-w-full divide-y divide-line text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2">Event</th>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Created</th>
                    <th className="px-3 py-2">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {subscriptionErrors.map((event) => (
                    <tr key={event.id} className="align-top hover:bg-blue-950/5">
                      <td className="max-w-[180px] px-3 py-3 font-semibold text-ink">{event.event_type || "Billing event"}</td>
                      <td className="max-w-[220px] px-3 py-3 text-muted">{event.customer_email || "No customer email"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDateTime(event.created_at)}</td>
                      <td className="min-w-[220px] px-3 py-3">
                        <TruncatedLogMessage message={event.processing_error} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No subscription errors" description="Billing webhook processing errors will appear here." />
          )}
        </SectionCard>
      </section>

      <SectionCard title="Audit history" description="Recent audit records are shown as rows. Metadata is collapsed until you need it.">
        {logs?.length ? (
          <>
            <div className="overflow-hidden rounded-lg border border-line">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-line text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Workspace</th>
                      <th className="px-3 py-2">Entity</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Metadata</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {logs.map((log) => (
                      <tr key={log.id} className="align-top hover:bg-blue-950/5">
                        <td className="max-w-[220px] px-3 py-3">
                          <p className="line-clamp-1 font-semibold text-ink">{log.action}</p>
                          <p className="mt-1 font-mono text-[0.68rem] text-muted">{log.id.slice(0, 8)}</p>
                        </td>
                        <td className="max-w-[220px] px-3 py-3 text-muted">
                          <span className="line-clamp-1">{workspaceName.get(log.workspace_id) || log.workspace_id}</span>
                        </td>
                        <td className="px-3 py-3">
                          <StatusBadge value={log.entity_type} />
                          <p className="mt-1 line-clamp-1 font-mono text-[0.68rem] text-muted">{log.entity_id || "No entity ID"}</p>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDateTime(log.created_at)}</td>
                        <td className="min-w-[220px] px-3 py-3">
                          <details>
                            <summary className="cursor-pointer text-xs font-semibold text-vaeroex-blue">View details</summary>
                            <div className="mt-2">
                              <JsonPreview value={log.metadata_json} />
                            </div>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {logs.length >= logLimit ? (
              <Link href={auditHref(query, Math.min(logLimit + 20, 80))} className="mt-3 inline-flex text-sm font-semibold text-vaeroex-blue">
                Show more audit logs
              </Link>
            ) : logLimit > 20 ? (
              <Link href={auditHref(query, 20)} className="mt-3 inline-flex text-sm font-semibold text-vaeroex-blue">
                Show fewer audit logs
              </Link>
            ) : null}
          </>
        ) : (
          <EmptyState title="No audit logs" description="Audit logs will appear after tracked workspace actions are recorded." />
        )}
      </SectionCard>
    </div>
  );
}
