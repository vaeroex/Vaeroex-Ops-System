import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { EmptyState } from "@/components/operations/EmptyState";
import { getVaeroexAdminAccess } from "@/lib/admin/vaeroex-admin";
import { displayPlanName } from "@/lib/billing/plans";

type AdminCustomersPageProps = {
  searchParams?: Promise<{ q?: string; error?: string }>;
};

export default async function AdminCustomersPage({ searchParams }: AdminCustomersPageProps) {
  const params = await searchParams;
  const query = params?.q?.trim() || "";
  const access = await getVaeroexAdminAccess();

  if (!access.allowed || !access.admin) {
    return <ErrorNotice message={params?.error || access.error} />;
  }

  let profilesQuery = access.admin
    .from("profiles")
    .select("*");
  let subscriptionsQuery = access.admin
    .from("customer_subscriptions")
    .select("*");
  let workspacesQuery = access.admin
    .from("workspaces")
    .select("id,name,primary_contact_email,subscription_status,plan_slug,created_at");

  if (query) {
    profilesQuery = profilesQuery.ilike("email", `%${query}%`);
    subscriptionsQuery = subscriptionsQuery.ilike("customer_email", `%${query}%`);
    workspacesQuery = workspacesQuery.ilike("primary_contact_email", `%${query}%`);
  }

  const [{ data: profiles }, { data: subscriptions }, { data: workspaces }] = await Promise.all([
    profilesQuery.order("created_at", { ascending: false }).limit(40),
    subscriptionsQuery.order("created_at", { ascending: false }).limit(40),
    workspacesQuery.order("created_at", { ascending: false }).limit(20)
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal admin"
        title="Customers"
        description="Search customers by email and review profile, workspace, and subscription signals."
      />
      <ErrorNotice message={params?.error} />

      <SectionCard title="Search customers" description="Search by profile email, subscription email, or workspace contact email.">
        <form className="flex flex-col gap-3 sm:flex-row">
          <input
            name="q"
            type="email"
            defaultValue={query}
            placeholder="customer@example.com"
            className="w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
          />
          <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Search</button>
        </form>
      </SectionCard>

      <section className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Profiles">
          <div className="space-y-3">
            {profiles?.length ? profiles.map((profile) => (
              <article key={profile.id} className="rounded-lg border border-line p-4">
                <p className="font-semibold">{profile.email || "No email"}</p>
                <p className="mt-1 text-sm text-muted">{profile.full_name || "No name"}</p>
                <p className="mt-2 break-all text-xs text-muted">{profile.id}</p>
                <button disabled className="mt-4 rounded-lg border border-line bg-slate-100 px-3 py-2 text-sm font-semibold text-muted">
                  Impersonation placeholder
                </button>
              </article>
            )) : (
              <EmptyState title="No profiles found" description="Try a different email search." />
            )}
          </div>
        </SectionCard>

        <SectionCard title="Subscriptions">
          <div className="space-y-3">
            {subscriptions?.length ? subscriptions.map((subscription) => (
              <article key={subscription.id} className="rounded-lg border border-line p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{subscription.customer_email}</p>
                    <p className="mt-1 text-sm text-muted">{subscription.customer_name || "No name"} · {displayPlanName(subscription.plan_slug)}</p>
                  </div>
                  <StatusBadge value={subscription.status} />
                </div>
                <p className="mt-2 text-xs text-muted">{subscription.billing_provider || subscription.source || "subscription"} · {subscription.stripe_subscription_id || subscription.stripe_customer_id || "No Stripe ID"}</p>
              </article>
            )) : (
              <EmptyState title="No subscriptions found" description="No customer subscriptions matched the current search." />
            )}
          </div>
        </SectionCard>
      </section>

      <SectionCard title="Workspaces by customer email">
        <div className="space-y-3">
          {workspaces?.length ? workspaces.map((workspace) => (
            <article key={workspace.id} className="rounded-lg border border-line p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="font-semibold">{workspace.name}</p>
                  <p className="mt-1 text-sm text-muted">{workspace.primary_contact_email || "No contact email"}</p>
                  <p className="mt-2 break-all text-xs text-muted">{workspace.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge value={workspace.subscription_status} />
                  <StatusBadge value={displayPlanName(workspace.plan_slug)} />
                </div>
              </div>
            </article>
          )) : (
            <EmptyState title="No workspaces found" description="No workspace contact email matched the current search." />
          )}
        </div>
      </SectionCard>
    </div>
  );
}
