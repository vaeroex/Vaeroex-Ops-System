import { IntelligenceBriefingCards } from "@/components/intelligence/IntelligenceBriefingCards";
import { loadWorkspaceIntelligenceBriefingStates } from "@/lib/ai/intelligence-briefing/workspace-context";
import { isIntelligenceBriefingEnabled } from "@/lib/ai/providers/workflow-provider-policy";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

export default async function IntelligenceBriefingsPage() {
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const states = await loadWorkspaceIntelligenceBriefingStates({
    supabase,
    workspaceId,
    workspace: context.activeWorkspace || {}
  });
  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-cyan-200">Executive Intelligence</p>
        <h1 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">Intelligence Briefings</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Rolling weekly and monthly syntheses of eligible deterministic business evidence. Briefings preserve source links, confidence, and evidence limitations.</p>
      </header>
      <IntelligenceBriefingCards
        states={states}
        generationEnabled={isIntelligenceBriefingEnabled()}
      />
    </div>
  );
}
