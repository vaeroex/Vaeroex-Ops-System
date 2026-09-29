import { reviewActivationRequestAction } from "@/app/app/admin/subscriptions/actions";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import type { Database } from "@/lib/supabase/types";

type ActivationRequest = Database["public"]["Tables"]["manual_activation_requests"]["Row"];

export function AdminActivationRequestReview({ request, returnTo }: { request: ActivationRequest; returnTo: string }) {
  return (
    <form action={reviewActivationRequestAction} className="mt-3 space-y-3">
      <input type="hidden" name="request_id" value={request.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="block text-sm font-medium text-ink">
        Review status
        <select name="status" defaultValue={request.status} className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink">
          <option value="pending">Pending</option>
          <option value="approved">Approved — grant manual access</option>
          <option value="denied">Denied</option>
          <option value="needs_more_info">Needs more information</option>
        </select>
      </label>
      <p className="text-sm leading-6 text-muted">
        Approval creates or updates manual access for the matching account and workspace. An approved request cannot be changed to another review status. This review does not change Stripe billing or delete account data or connections.
      </p>
      <PendingSubmitButton pendingLabel="Saving review..." className="min-h-11 rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue">
        Save review
      </PendingSubmitButton>
    </form>
  );
}
