import Link from "next/link";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { displayPlanName, displaySubscriptionStatus, normalizePlanLimits, VAEROEX_PLAN_LIMITS } from "@/lib/billing/plans";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { getUsageSnapshot } from "@/lib/billing/usage-limits";
import { getWorkspaceStorageUsage } from "@/lib/storage-capacity/server";
import { formatStorageBytes } from "@/lib/storage-capacity/policy";
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
  const accessContext = {
    supabase,
    userId: user?.id,
    email: user?.email,
    workspaceId: context.activeWorkspace?.id
  };
  const storageAccess = user && context.activeWorkspace && context.membership
    && context.membership.workspace_id === context.activeWorkspace.id && context.membership.status === "active"
    ? { supabase, user, context, workspaceId: context.activeWorkspace.id, workspace: context.activeWorkspace, membership: context.membership } : null;
  const [subscription, usage, storage] = await Promise.all([
    getSubscriptionStatus(accessContext),
    getUsageSnapshot(accessContext).catch(() => null),
    storageAccess ? getWorkspaceStorageUsage(storageAccess).catch(() => null) : Promise.resolve(null)
  ]);
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
          Use Manage billing to schedule cancellation of the base subscription through the Stripe Customer Portal. Cancellation prevents the next renewal and takes effect at the end of the current paid billing period, with access continuing through that period. No prorated refund or credit is provided for unused time.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          Your subscription price will not increase while it remains continuously active. If Vaeroex lowers the applicable subscription price, active subscribers receive the lower price for future renewals. Canceling ends this pricing protection; a later subscription uses the pricing available when you resubscribe.
        </p>
        <p className="mt-3 text-sm leading-6 text-muted">
          Billing, subscription, or payment questions can be sent to{" "}
          <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
            {VAEROEX_CONTACT_EMAILS.billing}
          </a>
          .
        </p>
      </SectionCard>

      <SectionCard title="Current usage" description="General usage is checked against active Vaeroex access limits. Uploaded-file capacity is measured separately for this workspace.">
        {!usage ? <ErrorNotice message="Current usage is temporarily unavailable. Reload to try again. Billing controls remain available above." /> : <div className="grid gap-4 md:grid-cols-3">
          {[
            ["Workspaces", usage.workspaces, limits?.max_workspaces],
            ["Users", usage.users, limits?.max_users],
            ["Vaeroex runs this month", usage.ai_runs_this_month, limits?.max_ai_runs_per_month]
          ].map(([label, current, limit]) => (
            <div key={String(label)} className="rounded-lg border border-line p-4">
              <p className="text-sm text-muted">{label}</p>
              <p className="mt-2 text-2xl font-semibold">
                {current} / {limit ?? "Unlimited"}
              </p>
            </div>
          ))}
        </div>}
        <div className="mt-4 rounded-lg border border-line p-4">
          <h3 className="text-sm font-semibold text-ink">This workspace’s uploaded-file capacity</h3>
          {storage ? <>
            <p className="mt-2 text-lg font-semibold">{storage.usedFiles.toLocaleString("en-US")} / {storage.allowanceFiles.toLocaleString("en-US")} file slots · {formatStorageBytes(storage.usedBytes, { gb: true })} / {formatStorageBytes(storage.allowanceBytes, { gb: true })}</p>
            <p className="mt-2 text-sm text-muted">Includes {formatStorageBytes(storage.includedBytes, { gb: true })} and {storage.includedFiles.toLocaleString("en-US")} file slots, plus {storage.paidPacks} paid capacity {storage.paidPacks === 1 ? "pack" : "packs"}. Retained originals in Trash use capacity until permanent deletion.</p>
          </> : <p className="mt-2 text-sm text-muted">The current file allowance and usage could not be measured. Open Usage &amp; Storage to retry; no zero usage or fixed file ceiling is assumed.</p>}
          <Link href="/app/settings/storage" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-vaeroex-blue underline underline-offset-2">View Usage &amp; Storage and manage capacity purchases</Link>
          <p className="mt-2 text-xs text-muted">Optional capacity purchases have separate recurring charges. Canceling a capacity pack retains existing files and blocks only new uploads that exceed the resulting allowance.</p>
        </div>
      </SectionCard>
    </div>
  );
}
