import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const ACTIVE_RESET_STATUSES = ["manifesting", "in_progress", "restoring"] as const;

function isResetSchemaUnavailable(error: { code?: string; message?: string } | null) {
  return Boolean(
    error &&
      (error.code === "42P01" ||
        error.code === "PGRST205" ||
        /workspace_reset_operations.*(does not exist|schema cache)/i.test(error.message || ""))
  );
}

export async function assertWorkspaceBusinessWritesAllowed(workspaceId: string) {
  const admin = createSupabaseAdminClient();
  if (!admin) {
    throw new Error("Vaeroex could not verify workspace write safety.");
  }

  const { data, error } = await admin
    .from("workspace_reset_operations")
    .select("id,status,updated_at")
    .eq("workspace_id", workspaceId)
    .in("status", [...ACTIVE_RESET_STATUSES])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // This keeps application code deployable before the additive migration. Any
  // other lookup failure is treated as unsafe rather than silently allowing a
  // business write during an unknown reset state.
  if (error) {
    if (isResetSchemaUnavailable(error)) return;
    throw new Error("Vaeroex could not verify workspace write safety.");
  }

  const staleManifest =
    data?.status === "manifesting" && new Date(data.updated_at).getTime() < Date.now() - 30 * 60 * 1_000;

  if (data && !staleManifest) {
    throw new Error("Workspace business data is temporarily locked for reset.");
  }
}
