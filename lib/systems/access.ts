import "server-only";
import type { Route } from "next";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getWorkspaceContext, type WorkspaceContext } from "@/lib/workspaces/current";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import type { Database } from "@/lib/supabase/types";
import type { SystemDecision } from "./routing";

// Reuse the product's authoritative billing resolver and RLS membership context.
// New catalog entries intentionally get no automatic access resolver.
export async function loadSystemAccess(supabase: SupabaseClient<Database>, user: User, existingContext?: WorkspaceContext) {
  const context = existingContext ?? await getWorkspaceContext(undefined, { supabase, user });
  const workspaces = await Promise.all(context.workspaces.map(async workspace => {
    const status = await getSubscriptionStatus({ supabase, userId: user.id, email: user.email, workspaceId: workspace.id });
    return { id: workspace.id, name: workspace.name, allowed: status.allowed, reason: status.reason };
  }));
  const allowed = workspaces.some(workspace => workspace.allowed);
  // Preserve workspace context: a blocked preferred workspace is not silently replaced.
  const activeAllowed = workspaces.some(workspace => workspace.id === context.activeWorkspace?.id && workspace.allowed);
  const accountStatus = context.workspaces.length ? null : await getSubscriptionStatus({ supabase, userId: user.id, email: user.email });
  const executive: SystemDecision = { id: "executive-intelligence", name: "Vaeroex Executive Intelligence", available: true, allowed, href: (activeAllowed ? "/app/intelligence" : "/systems") as Route };
  return { decisions: [executive], workspaces, activeAllowed, needsWorkspaceSetup: Boolean(accountStatus?.allowed), reason: allowed ? (activeAllowed ? "Your workspace access is active. Required policy review still applies when you open the system." : "Choose an accessible workspace below to continue. Your current workspace selection has been preserved.") : workspaces.length ? "Your account has workspace membership, but no workspace currently has verified active access. Review subscription or activation options." : "Your account does not have an active workspace membership. An account alone does not grant product access." };
}
