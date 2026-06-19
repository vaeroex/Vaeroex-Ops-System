import { createManualSubscriptionAction, reviewActivationRequestAction, updateSubscriptionAction } from "@/app/app/admin/subscriptions/actions";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { JsonPreview } from "@/components/operations/JsonPreview";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { displayPlanName, VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";

type AdminSubscriptionsPageProps = {
  searchParams?: Promise<{ q?: string; error?: string; message?: string }>;
};

export default async function AdminSubscriptionsPage({ searchParams }: AdminSubscriptionsPageProps) {
  const params = await searchParams;
  const access = await getVaeroexAdminAccess();
  const query = params?.q?.trim() || "";

  if (!access.allowed || !access.admin) {
    return <ErrorNotice message={params?.error || access.error} />;
  }

  let subscriptionsQuery = access.admin
    .from("customer_subscriptions")
    .select("*");

  if (query) {
    subscriptionsQuery = subscriptionsQuery.ilike("customer_email", `%${query}%`);
  }

  const { data: subscriptions } = await subscriptionsQuery.order("created_at", { ascending: false }).limit(20);
  const { data: requests } = await access.admin
    .from("manual_activation_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20);
  const { data: events } = await access.admin
    .from("subscription_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12);

  return (
    <div className="space-y-6">
      <SectionCard title="Subscription admin" description="Manually activate Vaeroex customers and review Squarespace subscription events.">
        {params?.message ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{params.message}</div> : null}
        <ErrorNotice message={params?.error} />
        <form className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search customer email"
            className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
          <button className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">Search</button>
        </form>
      </SectionCard>

      <section className="space-y-6">
        <CreateDrawer title="Create manual activation" description="Use after confirming a Squarespace purchase or testing access for a verified account." triggerLabel="New Activation">
          <form action={createManualSubscriptionAction} className="grid gap-4 lg:grid-cols-2">
            <label className="block text-sm font-medium">
              Customer email
              <input required name="customer_email" type="email" className="mt-2 w-full rounded-lg border border-line px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              Customer name
              <input name="customer_name" className="mt-2 w-full rounded-lg border border-line px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              Plan
              <select name="plan_slug" defaultValue={VAEROEX_PLAN_SLUG} className="mt-2 w-full rounded-lg border border-line px-3 py-2">
                <option value={VAEROEX_PLAN_SLUG}>Vaeroex</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Status
              <select name="status" defaultValue="active" className="mt-2 w-full rounded-lg border border-line px-3 py-2">
                <option value="active">active</option>
                <option value="trialing">trialing</option>
                <option value="manual_review">manual_review</option>
                <option value="past_due">past_due</option>
                <option value="canceled">canceled</option>
                <option value="expired">expired</option>
              </select>
            </label>
            <label className="block text-sm font-medium">
              Workspace ID
              <input name="workspace_id" className="mt-2 w-full rounded-lg border border-line px-3 py-2" />
            </label>
            <label className="block text-sm font-medium">
              Squarespace order ID
              <input name="squarespace_order_id" className="mt-2 w-full rounded-lg border border-line px-3 py-2" />
            </label>
            <label className="block text-sm font-medium lg:col-span-2">
              Notes
              <textarea name="notes" rows={4} className="mt-2 w-full rounded-lg border border-line px-3 py-2" />
            </label>
            <div className="lg:col-span-2">
              <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Save activation</button>
            </div>
          </form>
        </CreateDrawer>

        <SectionCard title="Customer subscriptions">
          <div className="space-y-4">
            {subscriptions?.length ? subscriptions.map((subscription) => (
              <article key={subscription.id} className="rounded-lg border border-line p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <p className="font-semibold">{subscription.customer_email}</p>
                    <p className="mt-1 text-xs text-muted">
                      {subscription.customer_name || "No name"} · {subscription.source} · {displayPlanName(subscription.plan_slug)}
                    </p>
                  </div>
                  <StatusBadge value={subscription.status} />
                </div>
                <form action={updateSubscriptionAction} className="mt-4 grid gap-3 md:grid-cols-4">
                  <input type="hidden" name="subscription_id" value={subscription.id} />
                  <select name="plan_slug" defaultValue={VAEROEX_PLAN_SLUG} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <option value={VAEROEX_PLAN_SLUG}>Vaeroex</option>
                  </select>
                  <select name="status" defaultValue={subscription.status} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <option value="active">active</option>
                    <option value="trialing">trialing</option>
                    <option value="past_due">past_due</option>
                    <option value="canceled">canceled</option>
                    <option value="expired">expired</option>
                    <option value="manual_review">manual_review</option>
                    <option value="demo">demo</option>
                  </select>
                  <input name="notes" defaultValue={subscription.notes || ""} className="rounded-lg border border-line px-3 py-2 text-sm" />
                  <button className="rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white">Update</button>
                </form>
              </article>
            )) : (
              <EmptyState title="No customer subscriptions found" description="Create a manual activation after confirming the Squarespace purchase, or wait for a Squarespace webhook event." />
            )}
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Manual activation requests">
          <div className="space-y-3">
            {requests?.length ? requests.map((request) => (
              <article key={request.id} className="rounded-lg border border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{request.email}</p>
                    <p className="mt-1 text-sm text-muted">{request.company || "No company"} · Vaeroex subscription</p>
                  </div>
                  <StatusBadge value={request.status} />
                </div>
                <p className="mt-3 text-sm leading-6 text-muted">{request.message || "No message."}</p>
                <form action={reviewActivationRequestAction} className="mt-4 flex gap-2">
                  <input type="hidden" name="request_id" value={request.id} />
                  <select name="status" defaultValue={request.status} className="rounded-lg border border-line px-3 py-2 text-sm">
                    <option value="pending">pending</option>
                    <option value="approved">approved</option>
                    <option value="denied">denied</option>
                    <option value="needs_more_info">needs_more_info</option>
                  </select>
                  <button className="rounded-lg border border-line px-3 py-2 text-sm font-semibold">Update</button>
                </form>
              </article>
            )) : (
              <EmptyState title="No activation requests" description="Requests from the billing-required page will appear here for review." />
            )}
          </div>
        </SectionCard>

        <SectionCard title="Squarespace events">
          <div className="space-y-4">
            {events?.length ? events.map((event) => (
              <article key={event.id} className="rounded-lg border border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{event.event_type || "Squarespace event"}</p>
                    <p className="mt-1 text-xs text-muted">{event.customer_email || "No email"} · {event.squarespace_order_id || "No order"}</p>
                  </div>
                  <StatusBadge value={event.processed ? "processed" : "manual_review"} />
                </div>
                {event.processing_error ? <p className="mt-3 text-sm text-red-700">{event.processing_error}</p> : null}
                <div className="mt-4">
                  <JsonPreview value={event.payload_json} />
                </div>
              </article>
            )) : (
              <EmptyState title="No Squarespace events yet" description="When the webhook is configured, received order events and processing details will appear here." />
            )}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
