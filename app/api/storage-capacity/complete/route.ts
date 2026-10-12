import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { MAX_UPLOAD_FILE_SIZE_BYTES, validateUploadFileSafety } from "@/lib/security/file-upload-safety";
import { assertStorageOrigin, assertStorageWorkspace, requireStorageAccess, storageJson, storageErrorResponse, StorageAccessError } from "@/lib/storage-capacity/access";
import { storageRpc } from "@/lib/storage-capacity/server";

export const runtime = "nodejs";
export const maxDuration = 60;
const inputSchema = z.object({ workspaceId: z.string().uuid(), reservationId: z.string().uuid() }).strict();
const reservedSchema = z.object({ state: z.string(), file_id: z.string().uuid(), storage_path: z.string(), bytes: z.number().int().positive().max(MAX_UPLOAD_FILE_SIZE_BYTES),
  original_name: z.string(), mime_type: z.string(), extension: z.string() });
export async function POST(request: Request) {
  try {
    assertStorageOrigin(request);
    const input = inputSchema.parse(await storageJson(request));
    const access = await requireStorageAccess({ edit: true });
    assertStorageWorkspace(access, input.workspaceId);
    const admin = createSupabaseAdminClient();
    if (!admin) throw new StorageAccessError(503, "Upload validation is temporarily unavailable.");
    const args = { p_workspace_id: access.workspaceId, p_reservation_id: input.reservationId, p_actor_id: access.user.id };
    const reserved = reservedSchema.parse(await storageRpc(admin, "inspect_workspace_upload_v1", args));
    if (!reserved.storage_path.startsWith(`${access.workspaceId}/`)) throw new StorageAccessError(503, "Upload reservation could not be verified.");
    if (reserved.state !== "completed") {
      if (reserved.state !== "pending") throw new StorageAccessError(409, "This upload is no longer available. Refresh before starting again.");
      const { data: blob, error } = await admin.storage.from("workspace-files").download(reserved.storage_path);
      if (error || !blob) throw new StorageAccessError(409, "Your file has not reached storage yet. Complete the upload before confirming it.");
      if (blob.size !== reserved.bytes || blob.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
        await storageRpc(admin, "abort_workspace_upload_v1", args);
        await admin.storage.from("workspace-files").remove([reserved.storage_path]);
        throw new StorageAccessError(400, "The stored file size does not match the upload reservation.");
      }
      const buffer = Buffer.from(await blob.arrayBuffer());
      const validation = validateUploadFileSafety({ fileName: reserved.original_name, browserMimeType: reserved.mime_type, size: blob.size, buffer });
      if (!validation.ok) {
        await storageRpc(admin, "abort_workspace_upload_v1", args);
        // A durable aborted reservation also fences outstanding signed URLs.
        // Failed object deletion is retried by maintenance and still uses bytes.
        await admin.storage.from("workspace-files").remove([reserved.storage_path]);
        throw new StorageAccessError(400, validation.error);
      }
      await storageRpc(admin, "finalize_workspace_upload_v1", args);
    }
    revalidatePath("/app/sources");
    revalidatePath("/app/settings/storage");
    return Response.json({ fileId: reserved.file_id, extension: reserved.extension }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return storageErrorResponse(new StorageAccessError(400, "The upload response could not be verified. Refresh before trying again."));
    return storageErrorResponse(error);
  }
}
