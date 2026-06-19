import "server-only";

import { requireAuth } from "@/lib/security/require-auth";
import { getCurrentWorkspace } from "@/lib/security/get-current-workspace";
import { requireActiveSubscription } from "@/lib/security/require-active-subscription";

export async function requireWorkspaceAccess(preferredWorkspaceId?: string | null) {
  const { supabase, user } = await requireAuth();
  const { context, workspace, workspaceId, membership } = await getCurrentWorkspace(preferredWorkspaceId);

  await requireActiveSubscription({
    supabase,
    userId: user.id,
    email: user.email,
    workspaceId
  });

  return {
    supabase,
    user,
    context,
    workspace,
    workspaceId,
    membership
  };
}
