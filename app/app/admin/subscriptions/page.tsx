import Link from "next/link";
import type { Route } from "next";
import { AdminActivationRequestReview } from "@/components/admin/AdminActivationRequestReview";
import { AdminManualActivationForm } from "@/components/admin/AdminManualActivationForm";
import { AdminSubscriptionEditor } from "@/components/admin/AdminSubscriptionEditor";
import { AdminSubscriptionEventDetails } from "@/components/admin/AdminSubscriptionEventDetails";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireVaeroexAdmin } from "@/lib/admin/vaeroex-admin";
import { formatAdminDate, quotedPostgrestValue } from "@/lib/admin/company-directory";
import { displayPlanName } from "@/lib/billing/plans";
import type { Database } from "@/lib/supabase/types";

const PAGE_SIZE = 25;
const allowedStatuses = new Set(["all", "active", "trialing", "past_due", "unpaid", "incomplete", "canceled", "expired", "manual_review", "demo"]);
const allowedSorts = new Set(["updated_desc", "created_desc", "email_asc", "email_desc"]);
type SubscriptionRow = Database["public"]["Tables"]["customer_subscriptions"]["Row"];
type ActivationRequest = Database["public"]["Tables"]["manual_activation_requests"]["Row"];
type SubscriptionEvent = Database["public"]["Tables"]["subscription_events"]["Row"];

function pageNumber(value?: string) {
  const parsed = Number.parseInt(String(value || "1"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 1;
}

function subscriptionPageHref(query: string, status: string, sort: string, page: number) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (status !== "all") params.set("status", status);
  if (sort !== "updated_desc") params.set("sort", sort);
  if (page > 1) params.set("page", String(page));
  const search = params.toString();
  return `/app/admin/subscriptions${search ? `?${search}` : ""}` as Route;
}

export default async function AdminSubscriptionsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = (await searchParams) || {};
  const query = String(params.q || "").trim().slice(0, 120);
  const requestedStatus = String(params.status || "all").trim();
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "all";
  const requestedSort = String(params.sort || "updated_desc").trim();
  const sort = allowedSorts.has(requestedSort) ? requestedSort : "updated_desc";
  const page = pageNumber(params.page);
  const { admin } = await requireVaeroexAdmin("/app");

  let subscriptionsQuery = admin.from("customer_subscriptions").select("*", { count: "exact" });
  if (query) {
    const pattern = quotedPostgrestValue(`*${query}*`);
    subscriptionsQuery = subscriptionsQuery.or(`customer_email.ilike.${pattern},customer_name.ilike.${pattern}`);
  }
  if (status !== "all") subscriptionsQuery = subscriptionsQuery.eq("status", status);

  const offset = (page - 1) * PAGE_SIZE;
  if (sort === "email_asc") {
    subscriptionsQuery = subscriptionsQuery.order("customer_email", { ascending: true }).order("id", { ascending: true });
  } else if (sort === "email_desc") {
    subscriptionsQuery = subscriptionsQuery.order("customer_email", { ascending: false }).order("id", { ascending: true });
  } else if (sort === "created_desc") {
    subscriptionsQuery = subscriptionsQuery.order("created_at", { ascending: false }).order("id", { ascending: true });
  } else {
    subscriptionsQuery = subscriptionsQuery.order("updated_at", { ascending: false }).order("id", { ascending: true });
  }

  const [subscriptionsResult, requestsResult, eventsResult] = await Promise.all([
    subscriptionsQuery.range(offset, offset + PAGE_SIZE - 1),
    admin.from("manual_activation_requests").select("*").order("created_at", { ascending: false }).limit(20),
    admin.from("subscription_events").select("*").order("created_at", { ascending: false }).limit(12)
  ]);

  const subscriptions = (subscriptionsResult.data || []) as SubscriptionRow[];
  const requests = (requestsResult.data || []) as ActivationRequest[];
  const events = (eventsResult.data || []) as SubscriptionEvent[];
  const workspaceIds = [...new Set(subscriptions.map((subscription) => subscription.workspace_id).filter((value): value is string => Boolean(value)))];
  const companiesResult = workspaceIds.length
    ? await admin.from("admin_company_directory_v1").select("workspace_id,company_name").in("workspace_id", workspaceIds)
    : { data: [], error: null };
  const companyNames = new Map((companiesResult.data || []).map((company) => [company.workspace_id, company.company_name]));
  const queryError = [subscriptionsResult, requestsResult, eventsResult, companiesResult].find((result) => result.error)?.error;
  const total = subscriptionsResult.count || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const first = total ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const last = Math.min(currentPage * PAGE_SIZE, total);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Subscriptions"
        description="Review cross-company billing status, manual activation requests, and provider events."
        actions={(
          <CreateDrawer title="Create manual activation" description="Use after confirming a purchase or testing access for a verified account." triggerLabel="New Activation">
            <AdminManualActivationForm returnTo="/app/admin/subscriptions" />
          </CreateDrawer>
        )}
      />
      {params.message ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{params.message}</p> : null}
      <ErrorNotice message={params.error || (queryError ? "Some subscription administration data could not be loaded." : null)} />

      <form method="get" className="grid gap-3 rounded-lg border border-line bg-white p-4 shadow-panel lg:grid-cols-[minmax(220px,1fr)_180px_180px_auto_auto] lg:items-end">
        <label className="text-sm font-medium text-ink">
          Company or customer email
          <input name="q" defaultValue={query} placeholder="Search company contact" className="mt-2 min-h-11 w-full rounded-md border border-line px-3 py-2" />
        </label>
        <label className="text-sm font-medium text-ink">
          Status
          <select name="status" defaultValue={status} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
            {[...allowedStatuses].map((value) => <option key={value} value={value}>{value === "all" ? "All statuses" : value}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-ink">
          Sort
          <select name="sort" defaultValue={sort} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
            <option value="updated_desc">Recently updated</option>
            <option value="created_desc">Recently created</option>
            <option value="email_asc">Email A-Z</option>
            <option value="email_desc">Email Z-A</option>
          </select>
        </label>
        <button className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Apply</button>
        <Link href="/app/admin/subscriptions" className="inline-flex min-h-11 items-center justify-center rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink">Clear</Link>
      </form>

      <SectionCard title="Customer subscriptions" description="Linked subscriptions open in the consolidated company record. Unlinked records retain an inline update path.">
        {subscriptions.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[980px] w-full divide-y divide-line text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-600">
                <tr><th className="px-4 py-3">Company</th><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Provider</th><th className="px-4 py-3">Provider IDs</th><th className="px-4 py-3">Updated</th><th className="px-4 py-3 text-right">Manage</th></tr>
              </thead>
              <tbody className="divide-y divide-line bg-white">
                {subscriptions.map((subscription) => {
                  const companyName = subscription.workspace_id ? companyNames.get(subscription.workspace_id) : null;
                  return (
                    <tr key={subscription.id} className="align-top hover:bg-slate-50/80">
                      <td className="px-4 py-4 font-semibold text-ink">{companyName || subscription.customer_name || "Unlinked subscription"}</td>
                      <td className="px-4 py-4"><p>{subscription.customer_email}</p><p className="mt-1 text-xs text-muted">{displayPlanName(subscription.plan_slug)}</p></td>
                      <td className="px-4 py-4"><StatusBadge value={subscription.status} /></td>
                      <td className="px-4 py-4 text-xs text-muted">{subscription.billing_provider || subscription.source}</td>
                      <td className="px-4 py-4 text-xs leading-5 text-muted"><p className="break-all">Customer: {subscription.stripe_customer_id || subscription.squarespace_customer_id || "Not available"}</p><p className="break-all">Subscription: {subscription.stripe_subscription_id || "Not available"}</p></td>
                      <td className="px-4 py-4 text-xs text-muted">{formatAdminDate(subscription.updated_at)}</td>
                      <td className="px-4 py-4 text-right">
                        {subscription.workspace_id ? (
                          <Link href={`/app/admin/customers/${subscription.workspace_id}?tab=subscription` as Route} className="inline-flex min-h-10 items-center rounded-md border border-line px-3 py-2 font-semibold text-ink hover:border-vaeroex-blue">Manage</Link>
                        ) : (
                          <details className="text-left">
                            <summary className="cursor-pointer font-semibold text-vaeroex-blue">Update</summary>
                            <div className="mt-3 min-w-[700px] rounded-md border border-line bg-white p-3 shadow-panel">
                              <AdminSubscriptionEditor subscription={subscription} returnTo="/app/admin/subscriptions" />
                            </div>
                          </details>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="No customer subscriptions found" description="No subscriptions match the current search and status filter." />}
        <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted">Showing {first}-{last} of {total}</p>
          <div className="flex items-center gap-2">
            {currentPage > 1 ? <Link href={subscriptionPageHref(query, status, sort, currentPage - 1)} className="min-h-10 rounded-md border border-line px-3 py-2 font-semibold">Previous</Link> : <span className="min-h-10 rounded-md border border-line px-3 py-2 text-slate-400">Previous</span>}
            <span className="px-2 font-medium">Page {currentPage} of {totalPages}</span>
            {currentPage < totalPages ? <Link href={subscriptionPageHref(query, status, sort, currentPage + 1)} className="min-h-10 rounded-md border border-line px-3 py-2 font-semibold">Next</Link> : <span className="min-h-10 rounded-md border border-line px-3 py-2 text-slate-400">Next</span>}
          </div>
        </div>
      </SectionCard>

      <section className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Manual activation requests" description="Approval continues through the transactional entitlement workflow.">
          <div className="space-y-3">
            {requests.length ? requests.map((request) => (
              <article key={request.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold text-ink">{request.company || request.name}</p><p className="mt-1 text-xs text-muted">{request.email} · {formatAdminDate(request.created_at)}</p></div>
                  <StatusBadge value={request.status} />
                </div>
                {request.message ? <p className="mt-2 text-sm leading-6 text-muted">{request.message}</p> : null}
                <AdminActivationRequestReview request={request} returnTo="/app/admin/subscriptions" />
              </article>
            )) : <EmptyState title="No activation requests" description="Requests from the billing-required page will appear here." />}
          </div>
        </SectionCard>

        <SectionCard title="Subscription events" description="Processing errors and provider identifiers remain visible; raw payloads are collapsed.">
          <div className="space-y-3">
            {events.length ? events.map((event) => (
              <article key={event.id} className="rounded-lg border border-line p-3">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-semibold text-ink">{event.event_type || "Subscription event"}</p><p className="mt-1 text-xs text-muted">{event.customer_email || "No email"} · {formatAdminDate(event.created_at)}</p></div>
                  <StatusBadge value={event.processed ? "processed" : "manual_review"} />
                </div>
                <AdminSubscriptionEventDetails event={event} />
              </article>
            )) : <EmptyState title="No subscription events" description="Provider events and processing details will appear here." />}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
