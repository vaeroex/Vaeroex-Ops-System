import { redirect } from "next/navigation";
import { requireActiveSubscription } from "@/lib/billing/require-active-subscription";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getWorkspaceContext } from "@/lib/workspaces/current";

export async function requireWorkspacePage() {
  const context = await getWorkspaceContext();

  if (!context.activeWorkspace) {
    redirect("/app/setup");
  }

  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    throw new Error("Supabase is not configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  await requireActiveSubscription({
    supabase,
    userId: user?.id,
    email: user?.email,
    workspaceId: context.activeWorkspace.id
  });

  return {
    supabase,
    context,
    workspaceId: context.activeWorkspace.id
  };
}
