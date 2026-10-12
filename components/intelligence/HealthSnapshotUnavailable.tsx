"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function HealthSnapshotUnavailable() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <section id="business-health" aria-labelledby="intelligence-health-heading" className="scroll-mt-24 rounded-xl border border-amber-300/30 bg-vaeroex-navy p-5 text-white">
    <h2 id="intelligence-health-heading" className="text-lg font-semibold">Business Health</h2>
    <p className="mt-2 text-sm text-slate-300" role="status">Health is temporarily unavailable. Other Intelligence findings remain available below.</p>
    <button type="button" disabled={pending} aria-busy={pending} onClick={() => startTransition(() => router.refresh())} className="mt-3 min-h-11 rounded-lg border border-cyan-200/30 px-4 py-2 text-sm font-semibold text-cyan-100 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">{pending ? "Retrying Health…" : "Retry Health"}</button>
  </section>;
}
