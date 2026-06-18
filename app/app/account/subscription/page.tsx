import Link from "next/link";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { SectionCard } from "@/components/operations/SectionCard";
import { getSubscriptionUsageStatus } from "@/lib/billing/usage-limits";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

export default async function AccountSubscriptionPage() {
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

  return (
    <div className="space-y-6">
      <SectionCard title="Subscription access" description="Vaeroex Ops System access is connected to your Squarespace subscription email.">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-lg border border-line p-4">
            <p className="text-sm text-muted">Status</p>
            <div className="mt-2">
              <StatusBadge value={subscription.status} />
            </div>
          </div>
          <div className="rounded-lg border border-line p-4">
            <p className="text-sm text-muted">Plan</p>
            <p className="mt-2 text-lg font-semibold">{subscription.plan?.name || subscription.plan_slug || "No plan found"}</p>
          </div>
          <div className="rounded-lg border border-line p-4">
            <p className="text-sm text-muted">Access</p>
            <p className="mt-2 text-lg font-semibold">{subscription.allowed ? "Allowed" : "Blocked"}</p>
          </div>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted">{subscription.reason}</p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="https://www.vaeroex.com/pricing" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Upgrade Plan
          </Link>
          <Link href="/billing-required#already-purchased" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            I already purchased
          </Link>
          <Link href="https://www.vaeroex.com/contact" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            Contact Vaeroex
          </Link>
        </div>
      </SectionCard>

      <SectionCard title="Current usage" description="Usage is checked against the active Vaeroex plan limits.">
        <div className="grid gap-4 md:grid-cols-5">
          {[
            ["Workspaces", usage.workspaces, subscription.plan?.max_workspaces],
            ["Users", usage.users, subscription.plan?.max_users],
            ["Forms", usage.forms, subscription.plan?.max_forms],
            ["Checklists", usage.checklists, subscription.plan?.max_checklists],
            ["Vaeroex runs this month", usage.ai_runs_this_month, subscription.plan?.max_ai_runs_per_month]
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
