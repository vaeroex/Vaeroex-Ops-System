import Link from "next/link";
import { ArrowUpRight, Library } from "lucide-react";
import type { ExecutiveHomepageModel } from "@/lib/intelligence/executive-homepage";

// Presentation of the same workspace-health model used by the former Overview.
export function IntelligenceReadiness({ readiness }: { readiness: ExecutiveHomepageModel["readiness"] | null }) {
  return <section className="intelligence-summary-card intelligence-readiness" aria-labelledby="intelligence-readiness-heading">
    <div className="flex items-center gap-2 text-slate-300"><Library aria-hidden="true" size={18} /><h2 id="intelligence-readiness-heading" className="text-base font-semibold text-white">Intelligence readiness</h2></div>
    <p className="mt-1 text-sm text-slate-400">How much useful information Vaeroex has to work with.</p>
    {readiness?.available ? <>
      <div className="mt-4 flex flex-wrap items-baseline gap-3"><p className="text-3xl font-semibold tabular-nums text-white">{readiness.coverage}<span className="ml-1 text-base text-slate-400">%</span></p><p className="text-sm text-slate-300">{readiness.label} understanding</p></div>
      <meter className="intelligence-coverage-meter" min={0} max={100} value={readiness.coverage} aria-label="Information coverage" />
      <details className="mt-3 border-t border-white/10 pt-1">
        <summary className="intelligence-disclosure">Readiness details</summary>
        <dl className="space-y-3 pb-3 text-sm"><div><dt className="text-slate-400">Strongest area</dt><dd className="mt-1 text-slate-100">{readiness.strongestArea} — {readiness.strongestCoverage}%</dd></div><div><dt className="text-slate-400">Largest information gap</dt><dd className="mt-1 text-slate-100">{readiness.largestGap}</dd></div><div><dt className="text-slate-400">Recommended next source</dt><dd className="mt-1 leading-6 text-slate-100">{readiness.recommendedNextSource}</dd></div></dl>
      </details>
    </> : <p className="mt-4 text-sm leading-6 text-slate-300" role="status">{readiness ? "Readiness is limited until enough eligible original evidence is available." : "Readiness is temporarily unavailable. No score has been estimated."}</p>}
    <Link href="/app/sources" className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300">Add information <ArrowUpRight size={16} aria-hidden="true" /></Link>
    <p className="mt-1 text-xs leading-5 text-slate-400">Information coverage is separate from business performance.</p>
  </section>;
}
