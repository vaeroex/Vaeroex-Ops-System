"use client";

import { useRef, useState, type FormEvent } from "react";
import { LoaderCircle, X } from "lucide-react";

export function QboCancelPendingForm({ connectionId }: { connectionId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/qbo/cancel", {
        method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({ connectionId, confirmation: "cancel" })
      });
      if (!response.ok) throw new Error("qbo_cancel_failed");
      window.location.reload();
    } catch {
      setError("This attempt could not be cancelled. Refresh to check its current status.");
      setPending(false);
      inFlight.current = false;
    }
  }

  return (
    <form action="/api/integrations/qbo/cancel" method="post" onSubmit={submit} aria-busy={pending} className="space-y-2">
      <input type="hidden" name="connectionId" value={connectionId} />
      <input type="hidden" name="confirmation" value="cancel" />
      <button type="submit" disabled={pending} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-line px-3 py-2 text-sm font-semibold text-ink disabled:opacity-60">
        {pending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <X aria-hidden="true" className="h-4 w-4" />}
        {pending ? "Cancelling..." : "Cancel attempt"}
      </button>
      {error ? <p role="alert" className="max-w-sm text-sm text-red-700">{error}</p> : null}
    </form>
  );
}
