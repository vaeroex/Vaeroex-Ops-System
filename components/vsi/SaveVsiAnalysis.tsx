"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { saveVsiAnalysis } from "@/app/app/reports/save-vsi-analysis";
export function SaveVsiAnalysis({ exchangeId }: { exchangeId: string }) {
  const [pending, start] = useTransition(), [saved, setSaved] = useState<string | null>(null), [message, setMessage] = useState("");
  return <div className="my-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
    <p>This conversation is private. Saving this answer shares its text, charts, and cited evidence with people who can access Saved Analyses in this workspace.</p>
    {saved ? <Link href={`/app/reports/${saved}`} className="mt-2 inline-flex min-h-11 items-center font-semibold text-blue-800 underline">View saved analysis</Link> : <button type="button" disabled={pending} className="mt-2 min-h-11 rounded-lg bg-vaeroex-blue px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={() => start(async () => {
      try { const result = await saveVsiAnalysis(exchangeId); setMessage(result.message); if (result.id) setSaved(result.id); }
      catch { setMessage("The analysis could not be saved. Please try again."); }
    })}>{pending ? "Saving…" : "Confirm and save to workspace"}</button>}
    {message ? <p role="status" className="mt-2">{message}</p> : null}
  </div>;
}
