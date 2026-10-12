import { z } from "zod";
import { assertStorageWorkspace, requireStorageAccess, storageErrorResponse } from "@/lib/storage-capacity/access";
import { getWorkspaceStorageTrash } from "@/lib/storage-capacity/server";
export async function GET(request: Request) {
  try {
    const access = await requireStorageAccess({ allowExpired: true });
    const url = new URL(request.url);
    assertStorageWorkspace(access, z.string().uuid().parse(url.searchParams.get("workspaceId")));
    const page = z.coerce.number().int().min(1).max(100000).parse(url.searchParams.get("page") || 1);
    return Response.json(await getWorkspaceStorageTrash(access, page), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return storageErrorResponse(error); }
}
