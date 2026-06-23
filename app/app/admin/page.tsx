import Link from "next/link";
import type { Route } from "next";
import { GroupedErrorRuns, TruncatedLogMessage, type AdminRunLog } from "@/components/admin/AdminLogViews";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { LEGAL_DOCUMENT_VERSIONS } from "@/lib/legal/content";

type AdminHomeProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function AdminHomePage({ searchParams }: AdminHomeProps) {
  const params = await searchParams;
  const access = await getVaeroexAdminAccess();

  if (!access.allowed || !access.admin) {
    return <ErrorNotice message={params?.error || access.error} />;
  }

  const [profiles, workspaces, activeSubscriptions, supportRequests, failedRuns, subscriptionErrors, recentSupport, legalAcceptances, workspaceRows] = await Promise.all([
    access.admin.from("profiles").select("id", { count: "exact", head: true }),
    access.admin.from("workspaces").select("id", { count: "exact", head: true }),
    access.admin.from("customer_subscriptions").select("id", { count: "exact", head: true }).in("status", ["active", "trialing", "demo"]),
    access.admin.from("support_requests").select("id", { count: "exact", head: true }).in("status", ["open", "in_review"]),
    access.admin.from("ai_agent_runs").select("id,workspace_id,agent_type,error_message,created_at").eq("status", "failed").order("created_at", { ascending: false }).limit(15),
    access.admin.from("subscription_events").select("id,event_type,customer_email,processing_error,created_at").not("processing_error", "is", null).order("created_at", { ascending: false }).limit(5),
    access.admin.from("support_requests").select("*").order("created_at", { ascending: false }).limit(5),
    access.admin
      .from("legal_acceptances")
      .select("id", { count: "exact", head: true })
      .eq("terms_version", LEGAL_DOCUMENT_VERSIONS.terms)
      .eq("privacy_version", LEGAL_DOCUMENT_VERSIONS.privacy)
      .eq("ai_disclaimer_version", LEGAL_DOCUMENT_VERSIONS.aiDisclaimer)
      .eq("sensitive_data_policy_version", LEGAL_DOCUMENT_VERSIONS.sensitiveData),
    access.admin.from("workspaces").select("id,name").limit(500)
  ]);
  const workspaceName = new Map((workspaceRows.data || []).map((workspace) => [workspace.id, workspace.name]));
  const failedRunRows = (failedRuns.data || []).map((run) => ({ ...run, status: "failed" })) as AdminRunLog[];

  const cards: { label: string; value: number; href: Route }[] = [
    { label: "Customers", value: profiles.count ?? 0, href: "/app/admin/customers" },
    { label: "Workspaces", value: workspaces.count ?? 0, href: "/app/admin/workspaces" },
    { label: "Active subscriptions", value: activeSubscriptions.count ?? 0, href: "/app/admin/subscriptions" },
    { label: "Open support", value: supportRequests.count ?? 0, href: "/app/admin/support-requests" }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Vaeroex Admin"
        description="Review customers, workspaces, subscriptions, support requests, Vaeroex usage, recent errors, and audit history from one internal area."
      />
      <ErrorNotice message={params?.error} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.label} href={card.href} className="rounded-lg border border-line bg-white p-5 shadow-panel hover:border-vaeroex-accent">
            <p className="text-sm text-muted">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold">{card.value}</p>
          </Link>
        ))}
      </section>

      <SectionCard title="Legal and trust readiness" description="Admin-only launch checklist for policy versions and acceptance visibility. Legal content should be reviewed by qualified counsel before commercial launch.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Terms version", LEGAL_DOCUMENT_VERSIONS.terms],
            ["Privacy version", LEGAL_DOCUMENT_VERSIONS.privacy],
            ["Vaeroex disclaimer", LEGAL_DOCUMENT_VERSIONS.aiDisclaimer],
            ["Sensitive data policy", LEGAL_DOCUMENT_VERSIONS.sensitiveData]
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
              <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-line p-4">
            <p className="text-sm text-muted">Latest acceptance records</p>
            <p className="mt-2 text-3xl font-semibold">{legalAcceptances.count ?? 0}</p>
          </div>
          <div className="rounded-lg border border-line p-4">
            <p className="text-sm text-muted">Estimated users not accepted latest</p>
            <p className="mt-2 text-3xl font-semibold">{Math.max((profiles.count ?? 0) - (legalAcceptances.count ?? 0), 0)}</p>
            <p className="mt-2 text-xs leading-5 text-muted">Estimate based on profile count minus latest acceptance records. Use as a launch-readiness signal, not a legal report.</p>
          </div>
        </div>
      </SectionCard>

      <section className="grid gap-6 xl:grid-cols-3">
        <SectionCard title="Recent support requests">
          <div className="space-y-3">
            {recentSupport.data?.length ? recentSupport.data.map((request) => (
              <article key={request.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{request.email}</p>
                    <p className="mt-1 text-xs text-muted">{request.issue_type}</p>
                  </div>
                  <StatusBadge value={request.priority} />
                </div>
                <p className="mt-2 text-xs text-muted">{request.status}</p>
              </article>
            )) : (
              <EmptyState title="No support requests" description="New customer and workspace support requests will appear here." />
            )}
          </div>
        </SectionCard>

        <SectionCard title="Recent Vaeroex errors" description="Grouped by repeated message so the admin dashboard stays compact.">
          <GroupedErrorRuns
            runs={failedRunRows}
            workspaceNames={workspaceName}
            emptyTitle="No recent Vaeroex errors"
            emptyDescription="Failed Vaeroex runs will appear here for investigation."
          />
        </SectionCard>

        <SectionCard title="Recent subscription errors">
          <div className="space-y-3">
            {subscriptionErrors.data?.length ? subscriptionErrors.data.map((event) => (
              <article key={event.id} className="rounded-lg border border-line p-3">
                <p className="text-sm font-semibold">{event.event_type || "Squarespace event"}</p>
                <p className="mt-1 text-xs text-muted">{event.customer_email || "No customer email"}</p>
                <div className="mt-2">
                  <TruncatedLogMessage message={event.processing_error} />
                </div>
              </article>
            )) : (
              <EmptyState title="No subscription errors" description="Webhook processing errors will appear here." />
            )}
          </div>
        </SectionCard>
      </section>

      <SectionCard title="Impersonation">
        <div className="rounded-lg border border-dashed border-line p-4">
          <p className="text-sm font-semibold">Impersonation placeholder</p>
          <p className="mt-2 text-sm leading-6 text-muted">
            Customer impersonation is intentionally not implemented yet. Add a full audit trail, approval step, and session boundary before enabling it.
          </p>
          <button disabled className="mt-4 rounded-lg border border-line bg-slate-100 px-4 py-2 text-sm font-semibold text-muted">
            Impersonation not enabled
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
