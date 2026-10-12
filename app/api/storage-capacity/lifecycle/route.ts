import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { assertStorageOrigin, assertStorageWorkspace, requireStorageAccess, storageJson, storageErrorResponse, StorageAccessError } from "@/lib/storage-capacity/access";
import { storageRpc } from "@/lib/storage-capacity/server";

const inputSchema = z.object({ workspaceId: z.string().uuid(), fileId: z.string().uuid(), action: z.enum(["archive", "restore", "delete", "purge"]) }).strict();
export async function POST(request: Request) {
  try {
    assertStorageOrigin(request);
    const input = inputSchema.parse(await storageJson(request));
    const access = await requireStorageAccess({ allowExpired: true });
    assertStorageWorkspace(access, input.workspaceId);
    if (!["owner", "admin", "manager"].includes(access.membership.role)) throw new StorageAccessError(403, "Only an owner, admin, or manager can change file retention.");
    let pending = false;
    if (input.action === "purge") {
      const admin = createSupabaseAdminClient();
      if (!admin) throw new StorageAccessError(503, "Permanent deletion is temporarily unavailable.");
      const purge = z.object({ storage_path: z.string() }).parse(await storageRpc(admin, "mark_workspace_file_purge_v1", {
        p_workspace_id: access.workspaceId, p_file_id: input.fileId, p_actor_id: access.user.id,
      }));
      if (!purge.storage_path.startsWith(`${access.workspaceId}/`)) throw new StorageAccessError(503, "File deletion could not be verified.");
      const removed = await admin.storage.from("workspace-files").remove([purge.storage_path]);
      if (removed.error) pending = true;
      else pending = await storageRpc(admin, "finalize_workspace_file_purge_v1", { p_workspace_id: access.workspaceId, p_file_id: input.fileId }) !== true;
    } else {
      await storageRpc(access.supabase, "update_source_file_lifecycle", { p_workspace_id: access.workspaceId, p_file_id: input.fileId, p_action: input.action });
    }
    for (const path of ["/app/sources", "/app/settings/storage", "/app"]) revalidatePath(path);
    return Response.json({ ok: true, pending }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return storageErrorResponse(new StorageAccessError(400, "Invalid storage action."));
    return storageErrorResponse(error);
  }
}
