import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { AdminActivationRequestReview } from "@/components/admin/AdminActivationRequestReview";
import { AdminAccountOverview } from "@/components/admin/AdminAccountOverview";
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
import { ACTIVE_AI_AGENT_RUN_TYPES } from "@/lib/ai/active-agent-artifacts";
import { displayPlanName } from "@/lib/billing/plans";
import { currentSavedAnalysisReleaseChannel } from "@/lib/reports/release-channel";
import { SAVED_ANALYSIS_ENVELOPE_VERSION, SAVED_ANALYSIS_TYPES } from "@/lib/reports/saved-analysis";
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
        <Link href="/app/admin/customers" className="text-sm font-semibold text-vaeroex-blue hover:underline">Back to Customers</Link>
        <PageHeader eyebrow="Internal admin" title="Company unavailable" description="The selected company record could not be loaded." />
        <ErrorNotice message="Company management data could not be loaded." />
      </div>
    );
  }

  const company = companyResult.data as AdminCompanyRow;
  const returnTo = `/app/admin/customers/${workspaceId}?tab=${tab}`;
  const savedAnalysisChannel = currentSavedAnalysisReleaseChannel();
  const [workspaceResult, subscriptionsResult, agreementResult, membersResult, kpiCount, fileCount, savedAnalysisResult, intelligenceCount] = await Promise.all([
    admin.from("workspaces").select("*").eq("id", workspaceId).maybeSingle(),
    admin.from("customer_subscriptions").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(20),
    admin.from("workspace_agreements").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    admin.from("workspace_members").select("id,user_id,role,status,invited_email,created_at", { count: "exact" }).eq("workspace_id", workspaceId).order("created_at", { ascending: true }).limit(100),
    admin.from("kpis").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    admin.from("file_uploads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    admin
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("deleted_at", null)
      .in("analysis_type", [...SAVED_ANALYSIS_TYPES])
      .contains("source_data_json", {
        record_kind: "saved_analysis",
        envelope_version: SAVED_ANALYSIS_ENVELOPE_VERSION,
        workspace_id: workspaceId,
        release_channel: savedAnalysisChannel
      }),
    admin
      .from("ai_agent_runs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .in("agent_type", [...ACTIVE_AI_AGENT_RUN_TYPES])
  ]);

  const workspace = workspaceResult.data as WorkspaceRow | null;
  if (workspaceResult.error) return <div className="space-y-6"><Link href="/app/admin/customers" className="text-sm font-semibold text-vaeroex-blue hover:underline">Back to Customers</Link><ErrorNotice message="Workspace details could not be loaded. No access settings are available until the workspace can be verified." /></div>;
  if (!workspace) notFound();
  const members = membersResult.data || [];
  const memberUserIds = [...new Set(members.flatMap((member) => member.user_id ? [member.user_id] : []))];
  const profilesResult = memberUserIds.length
    ? await admin.from("profiles").select("id,full_name,email").in("id", memberUserIds)
    : { data: [], error: null };
  const profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
  const subscriptions = (subscriptionsResult.data || []) as SubscriptionRow[];
  const agreement = agreementResult.data as AgreementRow | null;
  const contactEmail = company.primary_contact_email || subscriptions[0]?.customer_email || "";
  const [pendingRequestsResult, previousRequestsResult, eventsResult, deliveryResult] = await Promise.all([
    contactEmail
      ? admin.from("manual_activation_requests").select("*").ilike("email", contactEmail).in("status", ["pending", "needs_more_info"]).order("created_at", { ascending: false }).limit(12)
      : Promise.resolve({ data: [] as ActivationRequest[], error: null }),
    contactEmail
      ? admin.from("manual_activation_requests").select("*").ilike("email", contactEmail).in("status", ["approved", "denied"]).order("created_at", { ascending: false }).limit(12)
      : Promise.resolve({ data: [] as ActivationRequest[], error: null }),
    contactEmail
      ? admin.from("subscription_events").select("*").ilike("customer_email", contactEmail).order("created_at", { ascending: false }).limit(12)
      : Promise.resolve({ data: [] as SubscriptionEvent[], error: null }),
    agreement
      ? admin.from("workspace_agreement_admin_email_deliveries").select("*").eq("agreement_id", agreement.id).maybeSingle()
      : Promise.resolve({ data: null as DeliveryRow | null, error: null })
  ]);

  const pendingRequests = (pendingRequestsResult.data || []) as ActivationRequest[];
  const previousRequests = (previousRequestsResult.data || []) as ActivationRequest[];
  const events = (eventsResult.data || []) as SubscriptionEvent[];
  const delivery = deliveryResult.data as DeliveryRow | null;
  const queryResults = [
    ["subscriptions", subscriptionsResult], ["agreement", agreementResult],
    ["members", membersResult], ["member profiles", profilesResult],
    ["KPI count", kpiCount], ["evidence-file count", fileCount],
    ["saved-analysis count", savedAnalysisResult], ["analysis-artifact count", intelligenceCount],
    ["pending activation requests", pendingRequestsResult], ["previous activation requests", previousRequestsResult], ["subscription events", eventsResult], ["agreement delivery", deliveryResult]
  ] as const;
  const unavailable = queryResults.filter(([, result]) => result.error).map(([label]) => label);
  const countLabel = (result: { error: unknown; count: number | null }) => result.error || result.count === null ? "Unavailable" : String(result.count);
  const attention = companyAttentionReasons(company);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <Link href="/app/admin/customers" className="text-sm font-semibold text-vaeroex-blue hover:underline">Back to Customers</Link>
      </div>
      <PageHeader
        eyebrow="Workspace account"
        title={company.company_name}
        description="Manage this workspace’s access, subscription records, and agreement. User logins are separate."
      />
      {notices.message ? <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notices.message}</p> : null}
      <ErrorNotice message={notices.error || (unavailable.length ? `Could not load: ${unavailable.join(", ")}. Unavailable information is not a zero or an absent record.` : null)} />
      <AdminCompanyTabs workspaceId={workspaceId} activeTab={tab} />

      {tab === "overview" ? (
        <AdminAccountOverview company={company} attention={attention}
          subscriptionLabel={subscriptionsResult.error ? "Unavailable" : `${company.subscription_status} · ${displayPlanName(company.subscription_plan_slug)}${company.billing_provider ? ` · ${company.billing_provider}` : ""}`}
          agreementLabel={agreementResult.error ? "Unavailable" : agreement ? `Signed ${formatAdminDate(agreement.signed_at)}` : "No agreement"}
          members={members.map((member) => ({ id: member.id, userId: member.user_id, name: profiles.get(member.user_id || "")?.full_name || null, email: profiles.get(member.user_id || "")?.email || member.invited_email, role: member.role, status: member.status }))}
          memberCount={membersResult.error ? null : membersResult.count}
          memberError={membersResult.error ? "Membership records could not be loaded." : profilesResult.error ? "Member identities could not be loaded. Membership totals are still available." : null}
          footprint={[{ label: "Last workspace update", value: formatAdminDate(workspace.updated_at) }, { label: "Created", value: formatAdminDate(workspace.created_at) }, { label: "KPIs", value: countLabel(kpiCount) }, { label: "Evidence files", value: countLabel(fileCount) }, { label: "Saved analyses", value: countLabel(savedAnalysisResult) }, { label: "Analysis artifacts", value: countLabel(intelligenceCount) }]}
        />
      ) : null}

      {tab === "workspace" ? (
        <div className="space-y-6">
          <SectionCard title="Workspace access settings" description="Changes affect this workspace’s eligibility, not a user’s login or membership. Linked subscriptions also determine access.">
            <AdminWorkspaceAccessForm workspace={workspace} returnTo={returnTo} />
          </SectionCard>
            <SectionCard title="Admin list visibility" description="Archive hides an inactive workspace from normal Admin lists. It does not deactivate a login, delete data, cancel billing, or disconnect services.">
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
        </div>
      ) : null}

      {(tab === "overview" || tab === "subscription") && pendingRequests.length ? <SectionCard title="Activation needs a decision" description="Requests match the contact email, not a workspace ID. Approval uses the existing account entitlement and workspace-setup rules; review the customer identity before approving.">
        <div className="space-y-4">{pendingRequests.map((request) => <article key={request.id} className="rounded-lg border border-line p-4">
          <p className="break-all font-semibold text-ink">{request.email}</p>
          <p className="mt-1 text-xs text-muted">{request.company || "Company not provided"} · {formatAdminDate(request.created_at)} UTC</p>
          {request.message ? <p className="mt-2 text-sm text-muted">{request.message}</p> : null}
          <AdminActivationRequestReview request={request} returnTo={returnTo} />
        </article>)}</div>
      </SectionCard> : null}

      {tab === "subscription" ? (
        <div className="space-y-6">
          <div className="flex justify-end">
            <CreateDrawer title="Manual subscription record" description="Record pilot access for this business without a purchase or charge. Only its matching manual record may be updated." triggerLabel="Manage manual subscription">
              <AdminManualActivationForm
                returnTo={returnTo}
                workspaceId={workspace.id}
                customerEmail={contactEmail}
                customerName={company.primary_contact_name || company.company_name}
              />
            </CreateDrawer>
          </div>

          <SectionCard title="Subscription records" description="These are Vaeroex records, not controls for canceling or charging a Stripe subscription.">
            <div className="space-y-4">
              {subscriptions.length ? subscriptions.map((subscription) => (
                <article key={subscription.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{subscription.customer_email}</p>
                      <p className="mt-1 text-xs text-muted">{subscription.billing_provider || subscription.source} · Updated {formatAdminDate(subscription.updated_at)}</p>
                    </div>
                    <StatusBadge value={subscription.status} />
                  </div>
                  <details className="mt-4 border-t border-line pt-4" open={Boolean(notices.error)}>
                    <summary className="cursor-pointer text-sm font-semibold text-ink">Edit subscription record</summary>
                    <div className="mt-4 space-y-3">
                    <p className="break-all text-xs text-muted">Stripe customer: {subscription.stripe_customer_id || "Not available"}</p>
                    <p className="break-all text-xs text-muted">Stripe subscription: {subscription.stripe_subscription_id || "Not available"}</p>
                    <AdminSubscriptionEditor subscription={subscription} returnTo={returnTo} />
                    </div>
                  </details>
                </article>
              )) : subscriptionsResult.error ? <p className="text-sm text-muted">Subscription records unavailable.</p> : <EmptyState title="No linked subscription" description="Review manual access or an existing activation request; this does not establish Stripe billing." />}
            </div>
          </SectionCard>

          <details className="rounded-lg border border-line p-4">
            <summary className="cursor-pointer font-semibold text-ink">Activation and subscription history</summary>
            <section className="mt-4 grid gap-6 xl:grid-cols-2">
            <SectionCard title="Activation requests">
              <div className="space-y-3">
                {previousRequests.length ? previousRequests.map((request) => (
                  <article key={request.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-semibold text-ink">{request.email}</p><p className="mt-1 text-xs text-muted">{request.company || "No company"} · {formatAdminDate(request.created_at)}</p></div>
                      <StatusBadge value={request.status} />
                    </div>
                    {request.message ? <p className="mt-2 text-sm leading-6 text-muted">{request.message}</p> : null}
                    <p className="mt-2 text-xs text-muted">Decision retained. Manage current access separately; do not replay approval to end a pilot.</p>
                  </article>
                )) : previousRequestsResult.error ? <p className="text-sm text-muted">Previous activation requests unavailable.</p> : <EmptyState title="No previous activation requests" description="No resolved request matches this company contact." />}
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
                )) : eventsResult.error ? <p className="text-sm text-muted">Subscription events unavailable.</p> : <EmptyState title="No subscription events" description="No provider events match this company contact." />}
              </div>
            </SectionCard>
          </section>
          </details>
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
                <DetailValue label="Delivery" value={deliveryResult.error ? "Unavailable" : delivery ? `${delivery.status} · ${delivery.attempt_count} attempt${delivery.attempt_count === 1 ? "" : "s"}` : "Not recorded"} />
              </dl>
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/app/admin/workspace-agreements/${agreement.id}` as Route} className="inline-flex min-h-11 items-center rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">View agreement</Link>
                <WorkspaceAgreementActions agreementId={agreement.id} admin />
              </div>
              <p className="text-xs leading-5 text-muted">Administrative resend and full delivery-ledger status remain available on the agreement detail page.</p>
            </div>
          ) : agreementResult.error ? <p className="text-sm text-muted">Agreement unavailable.</p> : <EmptyState title="No agreement" description="This workspace does not have a retained Workspace Agreement." />}
        </SectionCard>
      ) : null}
    </div>
  );
}
