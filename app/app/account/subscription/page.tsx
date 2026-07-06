import Link from "next/link";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { displayPlanName, displaySubscriptionStatus, normalizePlanLimits, VAEROEX_PLAN_LIMITS } from "@/lib/billing/plans";
import { getSubscriptionUsageStatus } from "@/lib/billing/usage-limits";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

type AccountSubscriptionPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function AccountSubscriptionPage({ searchParams }: AccountSubscriptionPageProps) {
  const params = await searchParams;
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return <SectionCard title="Subscription">Supabase is not configured.</SectionCard>;
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();
  const context = await getWorkspaceContext();
  const { subscription, usage } = await getSubscriptionUsageStatus({
    supabase,
    userId: user?.id,
    email: user?.email,
    workspaceId: context.activeWorkspace?.id
  });
  const limits = normalizePlanLimits(subscription.plan) || (subscription.allowed ? VAEROEX_PLAN_LIMITS : null);

  return (
    <div className="space-y-6">
      <SectionCard title="Subscription access" description="Vaeroex access is connected to your Vaeroex subscription email.">
        {params?.message ? <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{params.message}</div> : null}
        <ErrorNotice message={params?.error} />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-line p-4">
            <p className="text-sm text-muted">Status</p>
            <div className="mt-2">
              <StatusBadge value={displaySubscriptionStatus(subscription.status, subscription.billing_provider || subscription.source)} />
            </div>
          </div>
          <div className="rounded-lg border border-line p-4">
            <p className="text-sm text-muted">Plan</p>
            <p className="mt-2 text-lg font-semibold">{subscription.allowed ? displayPlanName(subscription.plan_slug || subscription.plan?.slug || "vaeroex") : "Subscription required"}</p>
          </div>
          <div className="rounded-lg border border-line p-4">
            <p className="text-sm text-muted">Access</p>
            <p className="mt-2 text-lg font-semibold">{subscription.allowed ? "Allowed" : "Blocked"}</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted">{subscription.reason}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          {subscription.stripe_customer_id ? (
            <form action="/api/stripe/portal" method="post">
              <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white" type="submit">
                Manage billing
              </button>
            </form>
          ) : null}
          <Link href="https://vaeroex.com/pricing" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            View Vaeroex Subscription
          </Link>
          <Link href="/billing-required#already-purchased" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            I already purchased
          </Link>
          <a href={VAEROEX_MAILTO_LINKS.billing} className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            Email Billing
          </a>
        </div>
        <p className="mt-3 text-sm leading-6 text-muted">
          Billing, subscription, or payment questions can be sent to{" "}
          <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
            {VAEROEX_CONTACT_EMAILS.billing}
          </a>
          .
        </p>
      </SectionCard>

      <SectionCard title="Current usage" description="Usage is checked against active Vaeroex access limits. All product features are included.">
        <div className="grid gap-4 md:grid-cols-4">
          {[
            ["Workspaces", usage.workspaces, limits?.max_workspaces],
            ["Users", usage.users, limits?.max_users],
            ["Files", usage.files, limits?.max_files],
            ["Vaeroex runs this month", usage.ai_runs_this_month, limits?.max_ai_runs_per_month]
          ].map(([label, current, limit]) => (
            <div key={String(label)} className="rounded-lg border border-line p-4">
              <p className="text-sm text-muted">{label}</p>
              <p className="mt-2 text-2xl font-semibold">
                {current} / {limit ?? "Unlimited"}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
