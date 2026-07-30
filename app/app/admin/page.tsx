import Link from "next/link";
import type { Route } from "next";
import { GroupedErrorRuns, TruncatedLogMessage, type AdminRunLog } from "@/components/admin/AdminLogViews";
import { AdminLifecycleBadge } from "@/components/admin/AdminLifecycleBadge";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { companyAttentionReasons, formatAdminDate, type AdminCompanyRow } from "@/lib/admin/company-directory";
import { ACTIVE_AI_AGENT_RUN_TYPES } from "@/lib/ai/active-agent-artifacts";

type AdminHomeProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function AdminHomePage({ searchParams }: AdminHomeProps) {
  const params = await searchParams;
  const { admin } = await requireVaeroexAdmin("/app");

  const [
    totalCompanies,
    activeCompanies,
    pendingCompanies,
    inactiveCompanies,
    archivedCompanies,
    activeSubscriptions,
    missingAgreements,
    supportRequests,
    attentionCompanies,
    failedRuns,
    subscriptionErrors,
    workspaceRows
  ] = await Promise.all([
    admin.from("admin_company_directory_v1").select("workspace_id", { count: "exact", head: true }),
    admin.from("admin_company_directory_v1").select("workspace_id", { count: "exact", head: true }).eq("lifecycle_status", "active"),
    admin.from("admin_company_directory_v1").select("workspace_id", { count: "exact", head: true }).eq("lifecycle_status", "pending_activation"),
    admin.from("admin_company_directory_v1").select("workspace_id", { count: "exact", head: true }).eq("lifecycle_status", "inactive"),
    admin.from("admin_company_directory_v1").select("workspace_id", { count: "exact", head: true }).eq("lifecycle_status", "archived"),
    admin.from("customer_subscriptions").select("id", { count: "exact", head: true }).in("status", ["active", "trialing", "demo"]),
    admin.from("admin_company_directory_v1").select("workspace_id", { count: "exact", head: true }).eq("agreement_status", "missing"),
    admin.from("support_requests").select("id", { count: "exact", head: true }).in("status", ["open", "in_review"]),
    admin
      .from("admin_company_directory_v1")
      .select("*")
      .neq("lifecycle_status", "archived")
      .or("agreement_status.eq.missing,lifecycle_status.eq.pending_activation,lifecycle_status.eq.inactive")
      .order("workspace_updated_at", { ascending: false })
      .limit(6),
    admin
      .from("ai_agent_runs")
      .select("id,workspace_id,agent_type,error_message,created_at")
      .in("agent_type", [...ACTIVE_AI_AGENT_RUN_TYPES])
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(8),
    admin.from("subscription_events").select("id,event_type,customer_email,processing_error,created_at").not("processing_error", "is", null).order("created_at", { ascending: false }).limit(5),
    admin.from("workspaces").select("id,name").limit(500)
  ]);

  const results = [
    totalCompanies,
    activeCompanies,
    pendingCompanies,
    inactiveCompanies,
    archivedCompanies,
    activeSubscriptions,
    missingAgreements,
    supportRequests,
    attentionCompanies,
    failedRuns,
    subscriptionErrors,
    workspaceRows
  ];
  const queryError = results.find((result) => result.error)?.error;
  const workspaceName = new Map((workspaceRows.data || []).map((workspace) => [workspace.id, workspace.name]));
  const failedRunRows = (failedRuns.data || []).map((run) => ({ ...run, status: "failed" })) as AdminRunLog[];
  const attentionRows = (attentionCompanies.data || []) as AdminCompanyRow[];

  const cards: Array<{ label: string; value: number; href: Route; description: string }> = [
    { label: "Total companies", value: totalCompanies.count ?? 0, href: "/app/admin/customers", description: "All workspace-backed company records" },
    { label: "Active", value: activeCompanies.count ?? 0, href: "/app/admin/customers?lifecycle=active", description: "Companies with current access" },
    { label: "Pending activation", value: pendingCompanies.count ?? 0, href: "/app/admin/customers?lifecycle=pending_activation", description: "Waiting for access review" },
    { label: "Inactive", value: inactiveCompanies.count ?? 0, href: "/app/admin/customers?lifecycle=inactive", description: "Eligible for archive review" },
    { label: "Archived", value: archivedCompanies.count ?? 0, href: "/app/admin/customers?lifecycle=archived", description: "Preserved outside normal lists" },
    { label: "Active subscriptions", value: activeSubscriptions.count ?? 0, href: "/app/admin/subscriptions?status=active", description: "Current billing entitlements" },
    { label: "Missing agreements", value: missingAgreements.count ?? 0, href: "/app/admin/customers?agreement=missing", description: "Companies without a signed record" },
    { label: "Open support", value: supportRequests.count ?? 0, href: "/app/admin/support-requests", description: "Open or in-review requests" }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Vaeroex Admin"
        description="Monitor company lifecycle, agreements, subscriptions, support, and important platform exceptions."
      />
      {params?.message ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{params.message}</p> : null}
      <ErrorNotice message={params?.error || (queryError ? "Admin totals could not be loaded completely." : null)} />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.label} href={card.href} className="rounded-lg border border-line bg-white p-4 shadow-panel hover:border-vaeroex-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vaeroex-accent/45">
            <p className="text-sm font-medium text-muted">{card.label}</p>
            <p className="mt-1 text-3xl font-semibold text-ink">{card.value}</p>
            <p className="mt-1 text-xs leading-5 text-muted">{card.description}</p>
          </Link>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <SectionCard title="Companies requiring attention" description="Current companies with access, activation, or agreement exceptions.">
          <div className="divide-y divide-line">
            {attentionRows.length ? attentionRows.map((company) => (
              <article key={company.workspace_id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/app/admin/customers/${company.workspace_id}` as Route} className="font-semibold text-ink hover:text-vaeroex-blue">{company.company_name}</Link>
                    <AdminLifecycleBadge value={company.lifecycle_status} />
                  </div>
                  <p className="mt-1 text-xs text-muted">{companyAttentionReasons(company).join(" · ") || "No current exception"}</p>
                  <p className="mt-1 text-xs text-muted">Updated {formatAdminDate(company.workspace_updated_at)}</p>
                </div>
                <Link href={`/app/admin/customers/${company.workspace_id}` as Route} className="inline-flex min-h-10 items-center justify-center rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue">Manage</Link>
              </article>
            )) : <EmptyState title="No company exceptions" description="Current companies do not have activation, access, or agreement exceptions." />}
          </div>
        </SectionCard>

        <SectionCard title="Recent subscription errors">
          <div className="space-y-3">
            {subscriptionErrors.data?.length ? subscriptionErrors.data.map((event) => (
              <article key={event.id} className="rounded-lg border border-line p-3">
                <p className="text-sm font-semibold text-ink">{event.event_type || "Subscription event"}</p>
                <p className="mt-1 text-xs text-muted">{event.customer_email || "No customer email"}</p>
                <div className="mt-2"><TruncatedLogMessage message={event.processing_error} /></div>
              </article>
            )) : <EmptyState title="No subscription errors" description="Recent billing processing errors will appear here." />}
          </div>
        </SectionCard>
      </section>

      <SectionCard title="Recent analysis artifact errors" description="Failures from current supported analysis artifacts, grouped for internal review.">
        <GroupedErrorRuns
          runs={failedRunRows}
          workspaceNames={workspaceName}
          emptyTitle="No recent artifact errors"
          emptyDescription="Failed supported artifacts will appear here for investigation."
        />
      </SectionCard>
    </div>
  );
}
