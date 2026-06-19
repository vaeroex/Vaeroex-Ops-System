import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";

export async function requireWorkspacePage() {
  const { supabase, context, workspaceId } = await requireWorkspaceAccess();

  return {
    supabase,
    context,
    workspaceId
  };
}
