import { redirect } from "next/navigation";
import { VsiWorkspace } from "@/components/vsi/VsiWorkspace";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export default async function SuperIntelligencePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const params = (await searchParams) || {};
  return <VsiWorkspace key={`${workspaceId}:${user.id}`} workspaceId={workspaceId}
    workspaceName={context.activeWorkspace?.name || "this workspace"} userId={user.id}
    initialConversationId={typeof params.chat === "string" ? params.chat : ""}
    initialPrompt={typeof params.prompt === "string" ? params.prompt.slice(0, 8000) : ""} />;
}
