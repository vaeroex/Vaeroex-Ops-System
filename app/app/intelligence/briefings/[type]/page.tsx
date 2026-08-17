import { notFound } from "next/navigation";
import { IntelligenceBriefingViewer } from "@/components/intelligence/IntelligenceBriefingViewer";
import { isIntelligenceBriefingType } from "@/lib/ai/intelligence-briefing/contracts";
import { loadCurrentIntelligenceBriefing } from "@/lib/ai/intelligence-briefing/storage";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

export default async function IntelligenceBriefingPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!isIntelligenceBriefingType(type)) notFound();
  const { supabase, workspaceId } = await requireWorkspacePage();
  const current = await loadCurrentIntelligenceBriefing({ supabase, workspaceId, briefingType: type });
  if (!current) notFound();
  return <IntelligenceBriefingViewer artifact={current.artifact} />;
}
