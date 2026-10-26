import "server-only";

import { requireAuth } from "@/lib/security/require-auth";
import { getCurrentWorkspace } from "@/lib/security/get-current-workspace";
import { requireActiveSubscription } from "@/lib/security/require-active-subscription";
import type { SharedCitationReadTrace } from "@/lib/supabase/citation-read-trace";

export async function requireWorkspaceAccess(preferredWorkspaceId?: string | null, citationTrace?: SharedCitationReadTrace) {
  const { supabase, user } = await requireAuth(citationTrace);
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
