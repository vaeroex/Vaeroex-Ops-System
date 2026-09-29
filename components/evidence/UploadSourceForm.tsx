"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { uploadSourceAction } from "@/app/app/files/actions";
import type { UploadSourceState } from "@/lib/files/upload-types";

const fieldClass = "mt-2 min-h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-vaeroex-accent";

export function UploadSourceTrigger() {
  return <button type="button" aria-controls="workspace-file-upload" className="min-h-11 rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white" onClick={() => {
    const upload = document.getElementById("workspace-file-upload");
    if (!(upload instanceof HTMLDetailsElement)) return;
    upload.open = true;
    upload.scrollIntoView({ block: "center" });
    upload.querySelector<HTMLInputElement>('input[type="file"]')?.focus({ preventScroll: true });
  }}>Upload file</button>;
}

export function UploadSourceForm({ folders }: { folders: { id: string; name: string }[] }) {
  const [state, submit, pending] = useActionState<UploadSourceState, FormData>(async (previous, data) => {
    try {
      return await uploadSourceAction(previous, data);
    } catch (error) {
      // Preserve framework navigation (including sign-in). A lost transport
      // acknowledgment must not reset the form or invite a duplicate upload.
      if (error && typeof error === "object" && "digest" in error && typeof error.digest === "string" && error.digest.startsWith("NEXT_REDIRECT")) throw error;
      return { error: "The upload result could not be confirmed. Your file and details remain here. Check saved sources before another upload.", blocked: true };
    }
  }, { error: null });
  const [submitted, setSubmitted] = useState(false);
  const [delayed, setDelayed] = useState(false);
  const locked = useRef(false);
  const responseRef = useRef<HTMLDivElement>(null);
  const busy = pending || submitted;

  useEffect(() => {
    if (state.error) {
      locked.current = Boolean(state.blocked);
      setSubmitted(false);
    }
  }, [state]);

  useEffect(() => {
    if (state.error && !busy) responseRef.current?.focus();
  }, [state, busy]);

  useEffect(() => {
    if (!busy) { setDelayed(false); return; }
    const timer = window.setTimeout(() => setDelayed(true), 60000);
    return () => window.clearTimeout(timer);
  }, [busy]);

  return (
    <form
      className="grid gap-4 text-slate-100"
      onSubmit={(event) => {
        event.preventDefault();
        if (locked.current || pending || state.blocked) return;
        const data = new FormData(event.currentTarget);
        locked.current = true;
        setSubmitted(true);
        // Submit manually so a recoverable result does not reset the selected
        // file, display name, folder, or intentional-duplicate decision.
        startTransition(() => submit(data));
      }}
    >
      <input type="hidden" name="return_path" value="/app/sources" />
      <p className="text-sm leading-6 text-slate-300">Upload once. Spreadsheet rows are prepared automatically for your mapping review. Nothing is added to active KPI or metric history until you approve it.</p>
      {state.error && !busy ? (
        <div ref={responseRef} tabIndex={-1} role="alert" className="rounded-lg border border-amber-300/30 bg-amber-950/20 p-3 text-sm leading-6 text-amber-100">
          <p>{state.error}</p>
          {state.blocked ? <Link href="/app/sources" className="mt-2 inline-block font-semibold underline">Check saved sources before another upload</Link> : <p className="mt-1 text-xs">Your selected file and entered details remain here. Correct the issue before submitting again.</p>}
        </div>
      ) : null}
      <fieldset disabled={busy || state.blocked} className="grid min-w-0 gap-4 disabled:opacity-70">
        <label className="block text-sm font-medium text-slate-200">File
          <input name="file" type="file" accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,.docx" required className={`${fieldClass} file:mr-3 file:rounded-md file:border-0 file:bg-vaeroex-blue file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white`} />
        </label>
        <label className="block text-sm font-medium text-slate-200">Display name
          <input name="display_name" placeholder="Optional name shown in Vaeroex" className={fieldClass} />
        </label>
        <label className="block text-sm font-medium text-slate-200">Folder
          <select name="folder_id" className={fieldClass}>
            <option value="">No folder</option>
            {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </label>
        <details className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-slate-300">Intentional duplicate upload</summary>
          <label className="mt-3 flex items-start gap-3 text-xs leading-5 text-slate-300">
            <input name="allow_duplicate" type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-white/20 bg-slate-950 text-vaeroex-blue focus:ring-vaeroex-accent" />
            <span>Upload anyway if this is a duplicate source. Vaeroex checks the file name, type, and size against active sources.</span>
          </label>
        </details>
        <p className="text-xs leading-5 text-slate-400">Documents and images are saved for a separate analysis decision.</p>
        <p data-upload-sensitive-reminder className="text-xs leading-5 text-slate-400">Do not upload patient data, PHI/ePHI, Social Security numbers, insurance IDs, or other regulated sensitive information.</p>
        <button type="submit" disabled={busy || state.blocked} aria-busy={busy} data-vaeroex-local-activity="true" className="min-h-11 rounded-lg bg-vaeroex-blue px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? "Uploading and preparing review…" : "Upload and prepare review"}
        </button>
      </fieldset>
      {busy ? <div role="status" aria-live="polite" className="rounded-lg border border-cyan-300/30 bg-cyan-950/20 p-3 text-sm leading-6 text-cyan-100">
        <p>Request received. Checking and saving your file, then preparing supported spreadsheet rows for review.</p>
        <p className="mt-1 text-xs">Keep this page open. You’ll see the saved source or the specific issue when processing finishes. This does not approve extracted information.</p>
        {delayed ? <p className="mt-2 text-amber-100">Still waiting for confirmation. Do not submit another copy. No automatic retry is running.</p> : null}
      </div> : null}
    </form>
  );
}
