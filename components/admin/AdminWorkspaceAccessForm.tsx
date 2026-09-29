import { updateWorkspaceAccessAction } from "@/app/app/admin/workspaces/actions";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import { normalizePlanSlug, VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import type { Database } from "@/lib/supabase/types";

const statuses = ["active", "trialing", "past_due", "canceled", "expired", "manual_review"];
const plans = ["", VAEROEX_PLAN_SLUG];
type WorkspaceRow = Database["public"]["Tables"]["workspaces"]["Row"];

export function AdminWorkspaceAccessForm({ workspace, returnTo }: { workspace: WorkspaceRow; returnTo: string }) {
  return (
    <form action={updateWorkspaceAccessAction} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="workspace_id" value={workspace.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="text-sm font-medium text-ink">
        Workspace subscription status
        <select name="subscription_status" defaultValue={workspace.subscription_status} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
          {statuses.map((status) => <option key={status} value={status}>{status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ")}</option>)}
        </select>
      </label>
      <label className="text-sm font-medium text-ink">
        Plan
        <select name="plan_slug" defaultValue={normalizePlanSlug(workspace.plan_slug) || ""} className="mt-2 min-h-11 w-full rounded-md border border-line bg-white px-3 py-2">
          {plans.map((plan) => <option key={plan || "none"} value={plan}>{plan ? "Vaeroex" : "No plan"}</option>)}
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 self-end rounded-md border border-line px-3 py-2 text-sm font-medium text-ink">
        <input type="checkbox" name="subscription_required" defaultChecked={workspace.subscription_required} />
        Require a subscription
      </label>
      <label className="flex min-h-11 items-center gap-2 self-end rounded-md border border-line px-3 py-2 text-sm font-medium text-ink">
        <input type="checkbox" name="manually_unlocked" defaultChecked={workspace.manually_unlocked} />
        Manual access unlock
      </label>
      <div className="space-y-3 md:col-span-2">
        <p className="text-sm leading-6 text-muted">
          Changes apply to this workspace. Linked subscriptions also determine access; a manual unlock needs an active manual subscription. These settings do not disable a user’s sign-in or remove members. Workspace data and connection records are retained, and Stripe billing is unchanged.
        </p>
        <PendingSubmitButton
          pendingLabel="Saving access settings..."
          className="min-h-11 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-950/70"
        >
          Save access settings
        </PendingSubmitButton>
      </div>
    </form>
  );
}
