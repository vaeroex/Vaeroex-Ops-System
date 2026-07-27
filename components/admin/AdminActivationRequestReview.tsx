import { reviewActivationRequestAction } from "@/app/app/admin/subscriptions/actions";
import { PendingSubmitButton } from "@/components/operations/PendingSubmitButton";
import type { Database } from "@/lib/supabase/types";

type ActivationRequest = Database["public"]["Tables"]["manual_activation_requests"]["Row"];

export function AdminActivationRequestReview({ request, returnTo }: { request: ActivationRequest; returnTo: string }) {
  return (
    <form action={reviewActivationRequestAction} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
      <input type="hidden" name="request_id" value={request.id} />
      <input type="hidden" name="return_to" value={returnTo} />
      <label className="flex-1 text-xs font-semibold text-muted">
        Review status
        <select name="status" defaultValue={request.status} className="mt-1 min-h-10 w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink">
          <option value="pending">pending</option>
          <option value="approved">approved</option>
          <option value="denied">denied</option>
          <option value="needs_more_info">needs_more_info</option>
        </select>
      </label>
      <PendingSubmitButton pendingLabel="Updating..." className="min-h-10 rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink hover:border-vaeroex-blue">
        Update
      </PendingSubmitButton>
    </form>
  );
}
