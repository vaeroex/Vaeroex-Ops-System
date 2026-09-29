import { updateSubscriptionAction } from "@/app/app/admin/subscriptions/actions";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import type { Database } from "@/lib/supabase/types";

const subscriptionStatusOptions = ["active", "trialing", "past_due", "unpaid", "incomplete", "canceled", "expired", "manual_review"] as const;
type SubscriptionRow = Database["public"]["Tables"]["customer_subscriptions"]["Row"];

export function AdminSubscriptionEditor({ subscription, returnTo }: { subscription: SubscriptionRow; returnTo: string }) {
  return (
    <form action={updateSubscriptionAction} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="subscription_id" value={subscription.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="text-sm font-medium text-ink">
        Plan
        <select name="plan_slug" defaultValue={VAEROEX_PLAN_SLUG} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
          <option value={VAEROEX_PLAN_SLUG}>Vaeroex</option>
        </select>
      </label>
      <label className="text-sm font-medium text-ink">
        Vaeroex subscription status
        <select name="status" defaultValue={subscription.status} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
          {subscriptionStatusOptions.map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ")}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink md:col-span-2">
        Notes
        <input name="notes" defaultValue={subscription.notes || ""} className="mt-2 min-h-11 w-full rounded-md border border-line px-3 py-2" />
      </label>
      <div className="space-y-3 md:col-span-2">
        <p className="text-sm leading-6 text-muted">
          Saves this Vaeroex subscription record and updates the linked workspace’s access settings. Choosing Canceled here does not cancel billing in Stripe. User accounts, workspace data, and connection records are retained.
        </p>
        {subscription.billing_provider === "manual" ? <p className="text-sm text-muted">Manual pilot access does not expire automatically. Choose Expired to end this record, then confirm that workspace access requires a subscription and manual unlock is off. Other eligible subscriptions or trials may still allow access.</p> : null}
        <PendingSubmitButton
          pendingLabel="Saving subscription record..."
          className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950/70"
        >
          Save subscription record
        </PendingSubmitButton>
      </div>
    </form>
  );
}
