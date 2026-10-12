import { z } from "zod";
import { assertStorageWorkspace, requireStorageAccess, storageErrorResponse, StorageAccessError } from "@/lib/storage-capacity/access";
export async function GET(request: Request) {
  try {
    const access = await requireStorageAccess({ allowExpired: true });
    const url = new URL(request.url);
    assertStorageWorkspace(access, z.string().uuid().parse(url.searchParams.get("workspaceId")));
    const fileId = z.string().uuid().parse(url.searchParams.get("fileId"));
    const { data: file, error } = await access.supabase.from("file_uploads").select("id,original_name,storage_bucket,storage_path")
      .eq("workspace_id", access.workspaceId).eq("id", fileId).maybeSingle();
    if (error || !file) throw new StorageAccessError(404, "The file could not be found in this workspace.");
    if (file.storage_bucket !== "workspace-files" || !file.storage_path.startsWith(`${access.workspaceId}/`)) throw new StorageAccessError(404, "The original file is not available in this workspace.");
    const { data, error: linkError } = await access.supabase.storage.from(file.storage_bucket).createSignedUrl(file.storage_path, 60, { download: file.original_name });
    if (linkError || !data) throw new StorageAccessError(404, "The original object is missing or unavailable.");
    return new Response(null, { status: 303, headers: { Location: data.signedUrl, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return storageErrorResponse(error); }
}
