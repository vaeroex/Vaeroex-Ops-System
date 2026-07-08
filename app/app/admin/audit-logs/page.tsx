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
import type { Database } from "@/lib/supabase/types";

type AdminAuditLogsPageProps = {
  searchParams?: Promise<{ q?: string; error?: string; limit?: string }>;
};
type SecurityAuditEvent = Database["public"]["Tables"]["security_audit_events"]["Row"];

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

  let securityEventsQuery = access.admin
    .from("security_audit_events")
    .select(
      "id,workspace_id,user_id,action_name,operation_type,target_table,target_record_id,initiated_by,allowed,reason_blocked,required_confirmation,confirmation_received,request_id,model,metadata_json,created_at"
    );

  if (query) {
    securityEventsQuery = securityEventsQuery.or(`action_name.ilike.%${query}%,operation_type.ilike.%${query}%,target_table.ilike.%${query}%,reason_blocked.ilike.%${query}%`);
  }

  const [
    { data: logs },
    { data: workspaces },
    { data: failedRuns },
    { data: subscriptionErrors },
    { data: securityEvents, error: securityEventsError }
  ] = await Promise.all([
    logsQuery.order("created_at", { ascending: false }).limit(logLimit),
    access.admin.from("workspaces").select("id,name").limit(500),
    access.admin.from("ai_agent_runs").select("id,workspace_id,agent_type,error_message,created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(25),
    access.admin.from("subscription_events").select("id,event_type,customer_email,processing_error,created_at").not("processing_error", "is", null).order("created_at", { ascending: false }).limit(15),
    securityEventsQuery.order("created_at", { ascending: false }).limit(logLimit)
  ]);
  const workspaceName = new Map((workspaces || []).map((workspace) => [workspace.id, workspace.name]));
  const failedRunRows = (failedRuns || []).map((run) => ({ ...run, status: "failed" })) as AdminRunLog[];
  const securityRows = (securityEvents || []) as SecurityAuditEvent[];

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

      <SectionCard
        title="Security events"
        description="AI-mediated actions, blocked mutations, service-role billing/admin actions, confirmations, and suspicious requests."
      >
        {securityEventsError ? (
          <ErrorNotice message={`Security events are not available yet: ${securityEventsError.message}`} />
        ) : securityRows.length ? (
          <>
            <div className="overflow-hidden rounded-lg border border-line">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-line text-sm">
                  <thead className="bg-slate-950/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-300">
                    <tr>
                      <th className="px-3 py-2">Decision</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Workspace</th>
                      <th className="px-3 py-2">Target</th>
                      <th className="px-3 py-2">Confirmation</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {securityRows.map((event) => (
                      <tr key={event.id} className="align-top hover:bg-blue-950/30">
                        <td className="px-3 py-3">
                          <span
                            className={
                              event.allowed
                                ? "inline-flex rounded-full border border-emerald-400/30 bg-emerald-950/30 px-2 py-1 text-xs font-semibold text-emerald-100"
                                : "inline-flex rounded-full border border-red-400/40 bg-red-950/40 px-2 py-1 text-xs font-semibold text-red-100"
                            }
                          >
                            {event.allowed ? "Allowed" : "Blocked"}
                          </span>
                          {event.reason_blocked ? <p className="mt-2 max-w-[220px] text-xs text-slate-300">{event.reason_blocked}</p> : null}
                        </td>
                        <td className="max-w-[260px] px-3 py-3">
                          <p className="line-clamp-1 font-semibold text-ink">{event.action_name}</p>
                          <p className="mt-1 text-xs text-muted">{event.operation_type} - {event.initiated_by}</p>
                        </td>
                        <td className="max-w-[220px] px-3 py-3 text-muted">
                          <span className="line-clamp-1">{event.workspace_id ? workspaceName.get(event.workspace_id) || event.workspace_id : "System / pending workspace"}</span>
                          {event.user_id ? <p className="mt-1 font-mono text-[0.68rem]">{event.user_id.slice(0, 8)}</p> : null}
                        </td>
                        <td className="px-3 py-3">
                          {event.target_table ? <StatusBadge value={event.target_table} /> : <span className="text-xs text-muted">No table</span>}
                          <p className="mt-1 line-clamp-1 font-mono text-[0.68rem] text-muted">{event.target_record_id || "No target ID"}</p>
                        </td>
                        <td className="px-3 py-3 text-xs text-muted">
                          {event.required_confirmation ? (
                            <span className={event.confirmation_received ? "text-emerald-200" : "text-amber-200"}>
                              {event.confirmation_received ? "Confirmed" : "Missing confirmation"}
                            </span>
                          ) : (
                            "Not required"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted">{formatDateTime(event.created_at)}</td>
                        <td className="min-w-[220px] px-3 py-3">
                          <details>
                            <summary className="cursor-pointer text-xs font-semibold text-cyan-200">View event</summary>
                            <div className="mt-2 space-y-2">
                              {event.request_id ? <p className="font-mono text-[0.68rem] text-muted">Request: {event.request_id}</p> : null}
                              {event.model ? <p className="font-mono text-[0.68rem] text-muted">Model: {event.model}</p> : null}
                              <JsonPreview value={event.metadata_json} />
                            </div>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {securityRows.length >= logLimit ? (
              <Link href={auditHref(query, Math.min(logLimit + 20, 80))} className="mt-3 inline-flex text-sm font-semibold text-vaeroex-blue">
                Show more security events
              </Link>
            ) : logLimit > 20 ? (
              <Link href={auditHref(query, 20)} className="mt-3 inline-flex text-sm font-semibold text-vaeroex-blue">
                Show fewer security events
              </Link>
            ) : null}
          </>
        ) : (
          <EmptyState title="No security events" description="AI-mediated actions, blocked requests, and service-role audits will appear here." />
        )}
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
