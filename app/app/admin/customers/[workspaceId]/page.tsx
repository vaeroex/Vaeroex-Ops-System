import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { AdminActivationRequestReview } from "@/components/admin/AdminActivationRequestReview";
import { AdminCompanyTabs, type AdminCompanyTab } from "@/components/admin/AdminCompanyTabs";
import { AdminLifecycleBadge } from "@/components/admin/AdminLifecycleBadge";
import { AdminManualActivationForm } from "@/components/admin/AdminManualActivationForm";
import { AdminSubscriptionEditor } from "@/components/admin/AdminSubscriptionEditor";
import { AdminSubscriptionEventDetails } from "@/components/admin/AdminSubscriptionEventDetails";
import { AdminWorkspaceAccessForm } from "@/components/admin/AdminWorkspaceAccessForm";
import { AdminWorkspaceLifecycleActions } from "@/components/admin/AdminWorkspaceLifecycleActions";
import { WorkspaceAgreementActions } from "@/components/legal/WorkspaceAgreementActions";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { companyAttentionReasons, formatAdminDate, type AdminCompanyRow } from "@/lib/admin/company-directory";
import { displayPlanName } from "@/lib/billing/plans";
import type { Database } from "@/lib/supabase/types";

type WorkspaceRow = Database["public"]["Tables"]["workspaces"]["Row"];
type SubscriptionRow = Database["public"]["Tables"]["customer_subscriptions"]["Row"];
type ActivationRequest = Database["public"]["Tables"]["manual_activation_requests"]["Row"];
type SubscriptionEvent = Database["public"]["Tables"]["subscription_events"]["Row"];
type AgreementRow = Database["public"]["Tables"]["workspace_agreements"]["Row"];
type DeliveryRow = Database["public"]["Tables"]["workspace_agreement_admin_email_deliveries"]["Row"];

const validTabs = new Set<AdminCompanyTab>(["overview", "workspace", "subscription", "agreement"]);

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-line bg-slate-50 p-3">
      <dt className="text-xs font-semibold uppercase text-muted">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

export default async function AdminCompanyDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams?: Promise<{ tab?: string; message?: string; error?: string }>;
}) {
  const { workspaceId } = await params;
  const notices = (await searchParams) || {};
  const tab = validTabs.has(notices.tab as AdminCompanyTab) ? notices.tab as AdminCompanyTab : "overview";
  const { admin } = await requireVaeroexAdmin("/app");

  const companyResult = await admin
    .from("admin_company_directory_v1")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (!companyResult.error && !companyResult.data) notFound();

  if (companyResult.error) {
    return (
      <div className="space-y-6">
        <PageHeader eyebrow="Internal admin" title="Company unavailable" description="The selected company record could not be loaded." />
        <ErrorNotice message="Company management data could not be loaded." />
      </div>
    );
  }

  const company = companyResult.data as AdminCompanyRow;
  const returnTo = `/app/admin/customers/${workspaceId}?tab=${tab}`;
  const [workspaceResult, subscriptionsResult, agreementResult, membersResult, kpiCount, fileCount, reportCount, intelligenceCount] = await Promise.all([
    admin.from("workspaces").select("*").eq("id", workspaceId).maybeSingle(),
    admin.from("customer_subscriptions").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(20),
    admin.from("workspace_agreements").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("workspace_members").select("id,user_id,role,status,invited_email,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: true }).limit(100),
    admin.from("kpis").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    admin.from("file_uploads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    admin.from("reports").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    admin.from("ai_agent_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId)
  ]);

  const workspace = workspaceResult.data as WorkspaceRow | null;
  if (!workspace) notFound();
  const subscriptions = (subscriptionsResult.data || []) as SubscriptionRow[];
  const agreement = agreementResult.data as AgreementRow | null;
  const contactEmail = company.primary_contact_email || subscriptions[0]?.customer_email || "";
  const [activationRequestsResult, eventsResult, deliveryResult] = await Promise.all([
    contactEmail
      ? admin.from("manual_activation_requests").select("*").ilike("email", contactEmail).order("created_at", { ascending: false }).limit(12)
      : Promise.resolve({ data: [] as ActivationRequest[], error: null }),
    contactEmail
      ? admin.from("subscription_events").select("*").ilike("customer_email", contactEmail).order("created_at", { ascending: false }).limit(12)
      : Promise.resolve({ data: [] as SubscriptionEvent[], error: null }),
    agreement
      ? admin.from("workspace_agreement_admin_email_deliveries").select("*").eq("agreement_id", agreement.id).maybeSingle()
      : Promise.resolve({ data: null as DeliveryRow | null, error: null })
  ]);

  const activationRequests = (activationRequestsResult.data || []) as ActivationRequest[];
  const events = (eventsResult.data || []) as SubscriptionEvent[];
  const delivery = deliveryResult.data as DeliveryRow | null;
  const queryResults = [
    workspaceResult,
    subscriptionsResult,
    agreementResult,
    membersResult,
    kpiCount,
    fileCount,
    reportCount,
    intelligenceCount,
    activationRequestsResult,
    eventsResult,
    deliveryResult
  ];
  const relatedQueryError = queryResults.find((result) => result.error)?.error;
  const attention = companyAttentionReasons(company);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/app/admin/customers" className="text-sm font-semibold text-vaeroex-blue hover:underline">Back to Customers</Link>
        <span className="break-all text-xs text-muted">Workspace {workspaceId}</span>
      </div>
      <PageHeader
        eyebrow="Company management"
        title={company.company_name}
        description={`${company.primary_contact_email || "No primary contact email"} · ${company.industry || "Industry not set"}`}
        actions={<AdminLifecycleBadge value={company.lifecycle_status} />}
      />
      {notices.message ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notices.message}</p> : null}
      <ErrorNotice message={notices.error || (relatedQueryError ? "Some company details could not be loaded." : null)} />
      <AdminCompanyTabs workspaceId={workspaceId} activeTab={tab} />

      {tab === "overview" ? (
        <div className="space-y-6">
          <SectionCard title="Company summary" description="A concise view of the company record and its current operational state.">
            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <DetailValue label="Primary contact" value={company.primary_contact_name || "Name not set"} />
              <DetailValue label="Lifecycle" value={company.lifecycle_status === "pending_activation" ? "Pending activation" : company.lifecycle_status} />
              <DetailValue label="Subscription" value={`${company.subscription_status} · ${displayPlanName(company.subscription_plan_slug)}`} />
              <DetailValue label="Agreement" value={agreement ? `Signed ${formatAdminDate(agreement.signed_at)}` : "No agreement"} />
              <DetailValue label="Workspace updated" value={formatAdminDate(company.workspace_updated_at)} />
              <DetailValue label="Workspace members" value={String(membersResult.data?.length || 0)} />
              <DetailValue label="Industry" value={company.industry || "Not set"} />
              <DetailValue label="Company size" value={company.size || "Not set"} />
            </dl>
          </SectionCard>

          <section className="grid gap-6 lg:grid-cols-2">
            <SectionCard title="Attention">
              {attention.length ? (
                <ul className="space-y-2 text-sm text-amber-900">
                  {attention.map((reason) => <li key={reason} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2">{reason}</li>)}
                </ul>
              ) : <EmptyState title="No current exceptions" description="This company has no access, activation, or agreement exceptions." />}
            </SectionCard>
            <SectionCard title="Operational footprint">
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailValue label="KPIs" value={String(kpiCount.count || 0)} />
                <DetailValue label="Evidence files" value={String(fileCount.count || 0)} />
                <DetailValue label="Saved analyses and legacy reports" value={String(reportCount.count || 0)} />
                <DetailValue label="Intelligence runs" value={String(intelligenceCount.count || 0)} />
              </dl>
            </SectionCard>
          </section>
        </div>
      ) : null}

      {tab === "workspace" ? (
        <div className="space-y-6">
          <SectionCard title="Workspace access" description="These are the existing access controls, scoped to this workspace.">
            <AdminWorkspaceAccessForm workspace={workspace} returnTo={returnTo} />
          </SectionCard>

          <section className="grid gap-6 xl:grid-cols-2">
            <SectionCard title="Workspace details">
              <dl className="grid gap-3 sm:grid-cols-2">
                <DetailValue label="Workspace ID" value={workspace.id} />
                <DetailValue label="Created" value={formatAdminDate(workspace.created_at)} />
                <DetailValue label="Last updated" value={formatAdminDate(workspace.updated_at)} />
                <DetailValue label="Access required" value={workspace.subscription_required ? "Yes" : "No"} />
                <DetailValue label="Manual unlock" value={workspace.manually_unlocked ? "Enabled" : "Disabled"} />
                <DetailValue label="Plan" value={displayPlanName(workspace.plan_slug)} />
              </dl>
              <div className="mt-4">
                {agreement ? (
                  <Link href={`/app/admin/workspace-agreements/${agreement.id}` as Route} className="text-sm font-semibold text-vaeroex-blue hover:underline">View agreement</Link>
                ) : <span className="text-sm font-medium text-slate-500">No agreement</span>}
              </div>
            </SectionCard>

            <SectionCard title="Workspace lifecycle" description="Archive removes an inactive workspace from normal Admin lists without altering access, data, billing, or legal history.">
              <div className="flex flex-col items-start gap-4">
                <AdminLifecycleBadge value={company.lifecycle_status} />
                <AdminWorkspaceLifecycleActions
                  workspaceId={workspace.id}
                  companyName={company.company_name}
                  lifecycle={company.lifecycle_status}
                  returnTo={returnTo}
                />
              </div>
            </SectionCard>
          </section>
        </div>
      ) : null}

      {tab === "subscription" ? (
        <div className="space-y-6">
          <div className="flex justify-end">
            <CreateDrawer title="Create manual activation" description="Use the existing trusted activation path for a verified account." triggerLabel="New Activation">
              <AdminManualActivationForm
                returnTo={returnTo}
                workspaceId={workspace.id}
                customerEmail={contactEmail}
                customerName={company.primary_contact_name || company.company_name}
              />
            </CreateDrawer>
          </div>

          <SectionCard title="Subscriptions" description="Provider attribution and update controls are preserved for each linked subscription.">
            <div className="space-y-4">
              {subscriptions.length ? subscriptions.map((subscription) => (
                <article key={subscription.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{subscription.customer_email}</p>
                      <p className="mt-1 text-xs text-muted">{subscription.billing_provider || subscription.source} · Updated {formatAdminDate(subscription.updated_at)}</p>
                      <p className="mt-2 break-all text-xs text-muted">Stripe customer: {subscription.stripe_customer_id || "Not available"}</p>
                      <p className="mt-1 break-all text-xs text-muted">Stripe subscription: {subscription.stripe_subscription_id || "Not available"}</p>
                    </div>
                    <StatusBadge value={subscription.status} />
                  </div>
                  <div className="mt-4 border-t border-line pt-4">
                    <AdminSubscriptionEditor subscription={subscription} returnTo={returnTo} />
                  </div>
                </article>
              )) : <EmptyState title="No linked subscription" description="Create a manual activation or review an existing activation request." />}
            </div>
          </SectionCard>

          <section className="grid gap-6 xl:grid-cols-2">
            <SectionCard title="Activation requests">
              <div className="space-y-3">
                {activationRequests.length ? activationRequests.map((request) => (
                  <article key={request.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-semibold text-ink">{request.email}</p><p className="mt-1 text-xs text-muted">{request.company || "No company"} · {formatAdminDate(request.created_at)}</p></div>
                      <StatusBadge value={request.status} />
                    </div>
                    {request.message ? <p className="mt-2 text-sm leading-6 text-muted">{request.message}</p> : null}
                    <AdminActivationRequestReview request={request} returnTo={returnTo} />
                  </article>
                )) : <EmptyState title="No activation requests" description="No request matches this company contact." />}
              </div>
            </SectionCard>

            <SectionCard title="Subscription events" description="Raw provider payloads stay collapsed until needed.">
              <div className="space-y-3">
                {events.length ? events.map((event) => (
                  <article key={event.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-semibold text-ink">{event.event_type || "Subscription event"}</p><p className="mt-1 break-all text-xs text-muted">{event.stripe_event_id || event.squarespace_order_id || "No provider event ID"}</p></div>
                      <StatusBadge value={event.processed ? "processed" : "manual_review"} />
                    </div>
                    <AdminSubscriptionEventDetails event={event} />
                  </article>
                )) : <EmptyState title="No subscription events" description="No provider events match this company contact." />}
              </div>
            </SectionCard>
          </section>
        </div>
      ) : null}

      {tab === "agreement" ? (
        <SectionCard title="Workspace Agreement" description="The existing immutable agreement record and secure PDF actions are reused without modification.">
          {agreement ? (
            <div className="space-y-5">
              <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <DetailValue label="Agreement ID" value={agreement.id} />
                <DetailValue label="Signed" value={formatAdminDate(agreement.signed_at)} />
                <DetailValue label="Version" value={agreement.agreement_version} />
                <DetailValue label="Delivery" value={delivery ? `${delivery.status} · ${delivery.attempt_count} attempt${delivery.attempt_count === 1 ? "" : "s"}` : "Not recorded"} />
              </dl>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/app/admin/workspace-agreements/${agreement.id}` as Route} className="inline-flex min-h-11 items-center rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">View agreement</Link>
                <WorkspaceAgreementActions agreementId={agreement.id} admin />
              </div>
              <p className="text-xs leading-5 text-muted">Administrative resend and full delivery-ledger status remain available on the agreement detail page.</p>
            </div>
          ) : <EmptyState title="No agreement" description="This workspace does not have a retained Workspace Agreement." />}
        </SectionCard>
      ) : null}
    </div>
  );
}
