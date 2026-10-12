"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { GOOGLE_SHEETS_CALLBACK_PATH, GOOGLE_SHEETS_READ_SCOPE } from "@/lib/integrations/google-sheets/contracts";
import { GOOGLE_SHEETS_PILOT } from "@/lib/integrations/google-sheets/availability";

export function googleSheetsAuthorizationTarget(value: unknown) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("invalid_authorization_url");
  const target = new URL(value);
  if (target.origin !== "https://accounts.google.com" || target.pathname !== "/o/oauth2/v2/auth" || target.username || target.password || target.hash) throw new Error("invalid_authorization_url");
  for (const key of target.searchParams.keys()) if (target.searchParams.getAll(key).length !== 1) throw new Error("invalid_authorization_url");
  if (!target.searchParams.get("client_id") || target.searchParams.get("response_type") !== "code" || target.searchParams.get("scope") !== GOOGLE_SHEETS_READ_SCOPE || target.searchParams.get("access_type") !== "offline" || target.searchParams.get("include_granted_scopes") !== "false" || !/^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get("state") ?? "")) throw new Error("invalid_authorization_url");
  const callback = new URL(target.searchParams.get("redirect_uri") ?? "");
  if (callback.protocol !== "https:" || callback.pathname !== GOOGLE_SHEETS_CALLBACK_PATH || callback.username || callback.password || callback.search || callback.hash) throw new Error("invalid_authorization_url");
  return target.toString();
}

export function GoogleSheetsAuthorizationForm({ children, mode = "connect", className }: {
  children: ReactNode; mode?: "connect" | "reconnect"; className?: string;
}) {
  const disclosureId = useId();
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
    for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === "string") body.append(key, value);
    setPending(true);
    setError(null);
    let navigating = false;
    try {
      const response = await fetch(`/api/integrations/google-sheets/${mode}`, {
        method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body,
        signal: AbortSignal.timeout(30_000)
      });
      if (!response.ok) throw new Error("authorization_unavailable");
      const result: unknown = await response.json();
      const target = googleSheetsAuthorizationTarget(result && typeof result === "object" && "authorizationUrl" in result ? result.authorizationUrl : null);
      window.location.assign(target);
      navigating = true;
    } catch {
      setError("Google could not be opened. Refresh this page to check any pending connection attempt, then try again.");
    } finally {
      if (!navigating) { inFlight.current = false; setPending(false); }
    }
  }

  return <form action={`/api/integrations/google-sheets/${mode}`} method="post" onSubmit={submit} className={className} aria-busy={pending} aria-describedby={disclosureId}>
    {children}
    <p className="text-sm leading-6 text-slate-600 sm:col-span-full"><strong>{GOOGLE_SHEETS_PILOT.title}.</strong> {GOOGLE_SHEETS_PILOT.eligibility}</p>
    <div id={disclosureId} className="space-y-2 text-sm leading-6 text-slate-600 sm:col-span-full">
      <p>Google grants read-only access to spreadsheets your account can access. Vaeroex reads the spreadsheet you configure, its worksheet details and headings, and the columns you select for preview or approve for sync. It cannot edit your spreadsheet.</p>
      <p>Approved metrics and their history are stored in your workspace for Performance and Intelligence. Relevant data may be sent to OpenAI for requested analyses, conversations, and Business Memory indexing. OpenAI data sharing is disabled and Responses use store:false; standard abuse-monitoring retention may be up to 30 days with legal or safety exceptions, and prompt caching may last up to 24 hours. This is not Zero Data Retention.</p>
      <p>History expires 13 calendar months after first import, or 30 days after disconnect, whichever comes first. Refreshes and copies do not restart the clock. Identified copies and analyses expire with their sources. Expired content becomes unavailable immediately and support purges it the next business day. Disconnect stops refresh but does not immediately erase history.</p>
      <p>Review our <a href="/privacy" className="font-semibold text-vaeroex-blue underline">Privacy Policy</a> and <a href="/data-retention" className="font-semibold text-vaeroex-blue underline">Data Retention Notice</a> before connecting. For a deletion request, contact <a href="mailto:support@vaeroex.com" className="font-semibold text-vaeroex-blue underline">support@vaeroex.com</a> with your workspace and connection name. Do not send spreadsheet contents or credentials.</p>
    </div>
    <button type="submit" disabled={!ready || pending} className="min-h-11 justify-self-start rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60">{pending ? "Opening Google…" : mode === "connect" ? "Connect Google Sheets" : "Reconnect Google Sheets"}</button>
    {pending ? <p role="status" className="text-sm text-slate-600 sm:col-span-full">Opening Google securely…</p> : null}
    {error ? <p role="alert" className="text-sm text-red-700 sm:col-span-full">{error}</p> : null}
    <noscript><p className="text-sm text-slate-600">Enable JavaScript to connect Google Sheets securely.</p></noscript>
  </form>;
}
