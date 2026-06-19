import "server-only";

import { redirect } from "next/navigation";
import { getWorkspaceContext } from "@/lib/workspaces/current";

export async function getCurrentWorkspace(preferredWorkspaceId?: string | null) {
  const context = await getWorkspaceContext(preferredWorkspaceId);

  if (!context.activeWorkspace) {
    redirect("/app/setup");
  }

  const membership = context.membership;

  if (!membership || membership.workspace_id !== context.activeWorkspace.id || membership.status !== "active") {
    redirect("/app/setup?error=Workspace access is required.");
  }

  return {
    context,
    workspace: context.activeWorkspace,
    workspaceId: context.activeWorkspace.id,
    membership
  };
}
