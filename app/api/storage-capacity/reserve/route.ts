import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ALLOWED_UPLOAD_EXTENSIONS, fileExtension, normalizeStoredExtension, preferredMimeType, MAX_UPLOAD_FILE_SIZE_BYTES } from "@/lib/security/file-upload-safety";
import { assertStorageOrigin, assertStorageWorkspace, requireStorageAccess, storageJson, storageErrorResponse, StorageAccessError } from "@/lib/storage-capacity/access";
import { storageRpc } from "@/lib/storage-capacity/server";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const inputSchema = z.object({ workspaceId: z.string().uuid(), requestId: z.string().uuid(), originalName: z.string().min(1).max(255),
  displayName: z.string().max(255).optional(), bytes: z.number().int().positive().max(MAX_UPLOAD_FILE_SIZE_BYTES),
  mimeType: z.string().max(160), folderId: z.string().uuid().nullable(), allowDuplicate: z.boolean() }).strict();
const reservationSchema = z.object({ reservation_id: z.string().uuid(), file_id: z.string().uuid(), storage_path: z.string(), expires_at: z.string(), bytes: z.number() });
export async function POST(request: Request) {
  try {
    assertStorageOrigin(request);
    const input = inputSchema.parse(await storageJson(request));
    const access = await requireStorageAccess({ edit: true });
    assertStorageWorkspace(access, input.workspaceId);
    const admin = createSupabaseAdminClient();
    if (!admin) throw new StorageAccessError(503, "Uploads are temporarily unavailable.");
    const extension = z.enum(ALLOWED_UPLOAD_EXTENSIONS).parse(fileExtension(input.originalName));
    const mimeType = input.mimeType || preferredMimeType(extension);
    const rate = await enforceRateLimit({ action: "file.upload", limit: 20, windowSeconds: 600, userId: access.user.id,
      workspaceId: access.workspaceId, identifiers: [access.user.email], strict: true });
    if (!rate.allowed) throw new StorageAccessError(429, "Too many upload requests. Try again shortly.");
    if (!input.allowDuplicate) {
      const { count, error } = await access.supabase.from("file_uploads").select("id", { count: "exact", head: true })
        .eq("workspace_id", access.workspaceId).eq("original_name", input.originalName).eq("file_size_bytes", input.bytes)
        .eq("file_extension", normalizeStoredExtension(extension)).is("deleted_at", null).is("archived_at", null);
      if (error) throw new StorageAccessError(503, "Existing sources could not be checked.");
      if (count) throw new StorageAccessError(409, "This looks like an existing source. Select Upload anyway if you intend to save another copy.");
    }
    const reservation = reservationSchema.parse(await storageRpc(access.supabase, "reserve_workspace_upload_v1", {
      p_workspace_id: access.workspaceId, p_request_id: input.requestId, p_original_name: input.originalName,
      p_extension: normalizeStoredExtension(extension), p_mime_type: mimeType, p_bytes: input.bytes, p_folder_id: input.folderId,
      p_display_name: input.displayName || input.originalName,
    }));
    if (!reservation.storage_path.startsWith(`${access.workspaceId}/`)) throw new StorageAccessError(503, "Upload reservation could not be verified.");
    const { data, error } = await admin.storage.from("workspace-files").createSignedUploadUrl(reservation.storage_path, { upsert: false });
    if (error || !data) throw new StorageAccessError(503, "A private upload link could not be created. Your reservation will expire automatically.");
    return Response.json({ reservationId: reservation.reservation_id, fileId: reservation.file_id, expiresAt: reservation.expires_at,
      signedUrl: data.signedUrl, mimeType }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof z.ZodError) return storageErrorResponse(new StorageAccessError(400, "Choose a supported file of 25 MiB or smaller and valid upload details."));
    return storageErrorResponse(error);
  }
}
