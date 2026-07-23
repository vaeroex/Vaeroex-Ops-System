import { redirect } from "next/navigation";
import { AskVaeroexWorkspace } from "@/components/app/AskVaeroexWorkspace";
import { isPremiumConversationalVaeroexEnabled } from "@/lib/product/conversational-vaeroex";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type LegacyAskPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AskVaeroexPage({ searchParams }: LegacyAskPageProps) {
  const params = (await searchParams) || {};

  if (params.run || params.error || params.saved || params.debug) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === "string") query.set(key, value);
    }
    redirect(`/app/agents${query.size ? `?${query.toString()}` : ""}`);
  }

  if (!isPremiumConversationalVaeroexEnabled()) redirect("/app/intelligence");

  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const initialPrompt = typeof params.prompt === "string" ? params.prompt : "";
  return (
    <AskVaeroexWorkspace
      key={`${workspaceId}:${user.id}`}
      workspaceId={workspaceId}
      workspaceName={context.activeWorkspace?.name || "this workspace"}
      userId={user.id}
      initialPrompt={initialPrompt}
    />
  );
}
