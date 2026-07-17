import { redirect } from "next/navigation";
import { AskVaeroexWorkspace } from "@/components/app/AskVaeroexWorkspace";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";
import AgentsPage from "../agents/page";

type LegacyAskPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AskVaeroexPage({ searchParams }: LegacyAskPageProps) {
  const params = (await searchParams) || {};

  if (params.run || params.error || params.saved || params.debug) {
    return <AgentsPage searchParams={Promise.resolve(params)} />;
  }

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
