"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link2, LoaderCircle, RefreshCw } from "lucide-react";
import { qboAuthorizationNavigationTarget } from "@/lib/integrations/control-plane/qbo-authorization-navigation";

export function QboAuthorizationForm({
  children,
  mode = "connect",
  className
}: {
  children: ReactNode;
  mode?: "connect" | "reauthorize";
  className?: string;
}) {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    setReady(true);
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) { inFlight.current = false; setPending(false); }
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    const body = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string") body.append(key, value);
    }
    setPending(true);
    setError(null);
    let navigating = false;
    try {
      const response = await fetch(`/api/integrations/qbo/${mode}`, {
        method: "POST",
        credentials: "same-origin",
        redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body
      });
      if (!response.ok) {
        setError(response.status === 409
          ? "An unfinished QuickBooks attempt already exists. Refresh this page, then cancel the pending attempt before trying again."
          : "QuickBooks could not be opened. Your connection was not authorized. Refresh this page to review pending attempts, then try again.");
        return;
      }
      const result: unknown = await response.json();
      const target = qboAuthorizationNavigationTarget(
        result && typeof result === "object" && "authorizationUrl" in result ? result.authorizationUrl : null
      );
      window.location.assign(target);
      navigating = true;
      // Stay locked until the navigation completes, including repeated click events.
      return;
    } catch {
      setError("QuickBooks could not be opened. Refresh this page to review any pending attempt before trying again.");
    } finally {
      // Successful navigation keeps the button disabled. Errors restore a retryable form.
      // The database independently fences duplicate intents across tabs and requests.
      if (!navigating) {
        setPending(false);
        inFlight.current = false;
      }
    }
  }

  return (
    <form action={`/api/integrations/qbo/${mode}`} method="post" onSubmit={submit} className={className} aria-busy={pending}>
      {children}
      <button type="submit" disabled={!ready || pending}
        className="inline-flex min-h-10 items-center justify-center gap-2 self-end rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">
        {pending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          : mode === "connect" ? <Link2 aria-hidden="true" className="h-4 w-4" /> : <RefreshCw aria-hidden="true" className="h-4 w-4" />}
        {pending ? "Opening Intuit..." : mode === "connect" ? "Connect QuickBooks" : "Reconnect QuickBooks"}
      </button>
      {pending ? <p role="status" className="text-sm text-muted sm:col-span-full">Opening Intuit securely...</p> : null}
      {error ? <p role="alert" className="text-sm text-red-700 sm:col-span-full">{error}</p> : null}
      <noscript><p>Enable JavaScript to connect QuickBooks securely.</p></noscript>
    </form>
  );
}
