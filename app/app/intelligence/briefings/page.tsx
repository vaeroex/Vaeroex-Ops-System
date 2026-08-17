import { IntelligenceBriefingCards } from "@/components/intelligence/IntelligenceBriefingCards";
import type { IntelligenceBriefingState, IntelligenceBriefingType } from "@/lib/ai/intelligence-briefing/contracts";
import { intelligenceBriefingPeriod } from "@/lib/ai/intelligence-briefing/period";
import { briefingStateFromPackage, loadCurrentIntelligenceBriefing } from "@/lib/ai/intelligence-briefing/storage";
import { buildWorkspaceIntelligenceBriefingPackage } from "@/lib/ai/intelligence-briefing/workspace-context";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

function fallbackState(type: IntelligenceBriefingType, message: string): IntelligenceBriefingState {
  return {
    status: "unavailable",
    briefingType: type,
    period: intelligenceBriefingPeriod(type),
    eligibility: "no_eligible_evidence",
    confidence: "Low",
    artifact: null,
    message
  };
}

export default async function IntelligenceBriefingsPage() {
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  async function stateFor(type: IntelligenceBriefingType) {
    const current = await loadCurrentIntelligenceBriefing({ supabase, workspaceId, briefingType: type }).catch(() => null);
    try {
      const { briefingPackage } = await buildWorkspaceIntelligenceBriefingPackage({
        supabase,
        workspaceId,
        workspace: context.activeWorkspace || {},
        briefingType: type,
        previousBriefing: current ? {
          runId: current.runId,
          generatedAt: current.artifact.generatedAt,
          materialStateFingerprint: current.artifact.materialStateFingerprint
        } : null
      });
      return briefingStateFromPackage({ briefingPackage, current });
    } catch {
      return { ...fallbackState(type, "Eligible evidence could not be verified safely."), artifact: current?.artifact || null };
    }
  }
  const [weekly, monthly] = await Promise.all([stateFor("weekly"), stateFor("monthly")]);
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-cyan-200">Executive Intelligence</p>
        <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Intelligence Briefings</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Rolling weekly and monthly syntheses of eligible deterministic business evidence. Briefings preserve source links, confidence, and evidence limitations.</p>
      </header>
      <IntelligenceBriefingCards states={{ weekly, monthly }} />
    </div>
  );
}
