import { updateSubscriptionAction } from "@/app/app/admin/subscriptions/actions";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import type { Database } from "@/lib/supabase/types";

const subscriptionStatusOptions = ["active", "trialing", "past_due", "unpaid", "incomplete", "canceled", "expired", "manual_review"] as const;
type SubscriptionRow = Database["public"]["Tables"]["customer_subscriptions"]["Row"];

export function AdminSubscriptionEditor({ subscription, returnTo }: { subscription: SubscriptionRow; returnTo: string }) {
  return (
    <form action={updateSubscriptionAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-[180px_180px_minmax(240px,1fr)_auto] xl:items-end">
      <input type="hidden" name="subscription_id" value={subscription.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="text-sm font-medium text-ink">
        Plan
        <select name="plan_slug" defaultValue={VAEROEX_PLAN_SLUG} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
          <option value={VAEROEX_PLAN_SLUG}>Vaeroex</option>
        </select>
      </label>
      <label className="text-sm font-medium text-ink">
        Status
        <select name="status" defaultValue={subscription.status} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
          {subscriptionStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink">
        Notes
        <input name="notes" defaultValue={subscription.notes || ""} className="mt-2 min-h-11 w-full rounded-md border border-line px-3 py-2" />
      </label>
      <PendingSubmitButton
        pendingLabel="Updating..."
        className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950/70"
      >
        Update subscription
      </PendingSubmitButton>
    </form>
  );
}
