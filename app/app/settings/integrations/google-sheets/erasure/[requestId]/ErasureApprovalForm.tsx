"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, LoaderCircle } from "lucide-react";
import type { ErasureScope } from "../scope";

export function ErasureApprovalForm({ scope }: { scope: ErasureScope }) {
  const [ready, setReady] = useState(false);
  const [pending, setPending] = useState(false);
  const [approved, setApproved] = useState(scope.state === "approved");
  const [error, setError] = useState(false);
  const inFlight = useRef(false);
  const feedback = useRef<HTMLParagraphElement>(null);
  const deletions = scope.artifacts.filter((artifact) => artifact.action === "delete");
  const kept = scope.artifacts.filter((artifact) => artifact.action === "keep_unrelated");
  const completed = scope.state === "completed";
  const withdrawn = scope.state === "withdrawn";
  useEffect(() => { setReady(true); }, []);
  useEffect(() => { if (error || approved) feedback.current?.focus(); }, [error, approved]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || inFlight.current || approved || completed || withdrawn || !event.currentTarget.reportValidity()) return;
    const body = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) if (typeof value === "string") body.append(key, value);
    inFlight.current = true;
    setPending(true);
    setError(false);
    try {
      const response = await fetch("/api/integrations/google-sheets/erasure/confirm", {
        method: "POST", credentials: "same-origin", redirect: "error",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body, signal: AbortSignal.timeout(30_000)
      });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object" || !("ok" in result) || result.ok !== true) throw new Error("approval_failed");
      setApproved(true);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <form action="/api/integrations/google-sheets/erasure/confirm" method="post" onSubmit={submit} aria-busy={pending} className="space-y-4">
    <input type="hidden" name="requestId" value={scope.requestId} />
    <input type="hidden" name="scopeHash" value={scope.scopeHash} />
    <fieldset disabled={!ready || pending || approved || completed || withdrawn} className="min-w-0 space-y-4">
      <legend className="text-base font-semibold text-ink">Artifacts to delete ({deletions.length})</legend>
      {deletions.length ? <ol className="list-decimal space-y-3 pl-5 text-sm">
        {deletions.map(({ table, id }, index) => <li key={`${table}:${id}`}>
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1">
            <input type="checkbox" name={`artifact_${index}`} value={JSON.stringify({ table, id })} required className="mt-1.5 h-4 w-4 shrink-0" />
            <span className="min-w-0"><span className="block break-words font-medium text-ink">Delete whole artifact: {table.replaceAll("_", " ")}</span>
              <code className="block break-all text-xs leading-6 text-slate-600">{table} / {id}</code></span>
          </label>
        </li>)}
      </ol> : <p className="text-sm text-slate-600">No whole analyses or other artifacts require separate deletion approval.</p>}
      {!approved && !completed && !withdrawn ? <label className="flex min-h-11 cursor-pointer items-start gap-3 border-t border-line pt-4 text-sm leading-6 text-ink">
        <input type="checkbox" name="confirmation" value="approve_erasure" required className="mt-1.5 h-4 w-4 shrink-0" />
        <span>I approve permanent erasure of the imports and history in this scope and every artifact selected above.</span>
      </label> : null}
      {!approved && !completed && !withdrawn ? <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60" disabled={!ready || pending}>
        {pending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}
        {pending ? "Recording approval..." : "Approve erasure scope"}
      </button> : null}
    </fieldset>
    <p ref={feedback} tabIndex={-1} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} className={`text-sm leading-6 ${error ? "text-red-700" : "text-slate-600"}`}>
      {error ? "Approval could not be confirmed. Refresh this page to check the request status and review its current scope before trying again."
        : completed ? "Erasure completed. This request cannot be approved again."
        : withdrawn ? "Request withdrawn. This scope cannot be approved."
        : approved ? "Scope approved. No erasure was executed by this approval."
        : pending ? "Recording your approval. No erasure is being executed." : ""}
    </p>
    {kept.length ? <section aria-labelledby="erasure-kept" className="border-t border-line pt-4">
      <h2 id="erasure-kept" className="text-base font-semibold text-ink">Unrelated artifacts to keep ({kept.length})</h2>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-slate-600">
        {kept.map(({ table, id }) => <li key={`${table}:${id}`}><span className="break-words">Keep: {table.replaceAll("_", " ")}</span><code className="block break-all text-xs leading-6">{table} / {id}</code></li>)}
      </ol>
    </section> : null}
    <noscript><p className="text-sm text-slate-600">Enable JavaScript to record your approval and receive confirmation.</p></noscript>
  </form>;
}
