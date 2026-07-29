import { createManualSubscriptionAction } from "@/app/app/admin/subscriptions/actions";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";

const subscriptionStatusOptions = ["active", "trialing", "past_due", "unpaid", "incomplete", "canceled", "expired", "manual_review"] as const;

export function AdminManualActivationForm({
  returnTo,
  workspaceId = "",
  customerEmail = "",
  customerName = ""
}: {
  returnTo: string;
  workspaceId?: string;
  customerEmail?: string;
  customerName?: string;
}) {
  return (
    <form action={createManualSubscriptionAction} className="grid gap-4 lg:grid-cols-2">
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="block text-sm font-medium text-slate-100">
        Customer email
        <input required name="customer_email" type="email" defaultValue={customerEmail} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-ink" />
      </label>
      <label className="block text-sm font-medium text-slate-100">
        Customer name
        <input name="customer_name" defaultValue={customerName} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-ink" />
      </label>
      <label className="block text-sm font-medium text-slate-100">
        Plan
        <select name="plan_slug" defaultValue={VAEROEX_PLAN_SLUG} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-ink">
          <option value={VAEROEX_PLAN_SLUG}>Vaeroex</option>
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-100">
        Status
        <select name="status" defaultValue="active" className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-ink">
          {subscriptionStatusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
        </select>
      </label>
      <label className="block text-sm font-medium text-slate-100">
        Workspace ID
        <input name="workspace_id" defaultValue={workspaceId} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2 text-ink" />
      </label>
      <label className="block text-sm font-medium text-slate-100 lg:col-span-2">
        Notes
        <textarea name="notes" rows={4} className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-ink" />
      </label>
      <div className="lg:col-span-2">
        <PendingSubmitButton
          pendingLabel="Saving..."
          className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950/70"
        >
          Save activation
        </PendingSubmitButton>
      </div>
    </form>
  );
}
