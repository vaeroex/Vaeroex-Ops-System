import Link from "next/link";
import { INTELLIGENCE_BRIEFING_TYPES, briefingTypeLabel } from "@/lib/ai/intelligence-briefing/contracts";
import { loadCurrentIntelligenceBriefing } from "@/lib/ai/intelligence-briefing/storage";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

export default async function IntelligenceBriefingsPage() {
  const { supabase, workspaceId } = await requireWorkspacePage();
  const saved = await Promise.all(INTELLIGENCE_BRIEFING_TYPES.map(async briefingType => {
    try {
      return { briefingType, current: await loadCurrentIntelligenceBriefing({ supabase, workspaceId, briefingType }), unavailable: false };
    } catch {
      return { briefingType, current: null, unavailable: true };
    }
  }));
  return <div className="space-y-6">
    <header className="workspace-page-header">
      <h1 className="text-2xl font-semibold text-white sm:text-3xl">Saved briefs</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Previously saved briefs remain available with their original evidence and access restrictions. Request new briefs in VSI.</p>
      <Link href="/app/si" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200 hover:underline">Open VSI</Link>
    </header>
    <ul className="divide-y divide-white/10 border-y border-white/10">
      {saved.map(({ briefingType, current, unavailable }) => <li key={briefingType} className="py-4">
        <h2 className="font-semibold text-white">{briefingTypeLabel(briefingType)} · latest saved</h2>
        {current ? <>
          <p className="mt-1 text-sm text-slate-400">Evidence period: {current.artifact.period.start} through {current.artifact.period.end}.</p>
          <Link href={`/app/intelligence/briefings/${briefingType}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200 hover:underline">Open saved brief</Link>
        </> : <p className="mt-1 text-sm text-slate-400">{unavailable ? "Saved brief access could not be verified. Try again later." : "No saved brief is available."}</p>}
      </li>)}
    </ul>
    <Link href="/app/reports" className="inline-flex min-h-11 items-center text-sm font-semibold text-cyan-200 hover:underline">Browse Saved analyses</Link>
  </div>;
}
