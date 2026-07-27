import { JsonPreview } from "@/components/operations/JsonPreview";
import type { Database } from "@/lib/supabase/types";

type SubscriptionEvent = Database["public"]["Tables"]["subscription_events"]["Row"];

export function AdminSubscriptionEventDetails({ event }: { event: SubscriptionEvent }) {
  return (
    <details className="mt-3 rounded-md border border-line bg-slate-50 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-ink">View event</summary>
      <div className="mt-3 space-y-3">
        <dl className="grid gap-2 text-xs text-muted sm:grid-cols-2">
          <div><dt className="font-semibold text-ink">Provider event ID</dt><dd className="mt-1 break-all">{event.stripe_event_id || event.squarespace_order_id || "Not available"}</dd></div>
          <div><dt className="font-semibold text-ink">Subscription ID</dt><dd className="mt-1 break-all">{event.stripe_subscription_id || "Not available"}</dd></div>
        </dl>
        {event.processing_error ? <p className="text-sm text-red-700">{event.processing_error}</p> : null}
        <JsonPreview value={event.payload_json} />
      </div>
    </details>
  );
}
