import { z } from "zod";
import { assertStorageWorkspace, requireStorageAccess, storageErrorResponse } from "@/lib/storage-capacity/access";
import { getWorkspaceStorageUsage } from "@/lib/storage-capacity/server";
export async function GET(request: Request) {
  try {
    const access = await requireStorageAccess({ allowExpired: true });
    assertStorageWorkspace(access, z.string().uuid().parse(new URL(request.url).searchParams.get("workspaceId")));
    return Response.json(await getWorkspaceStorageUsage(access), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return storageErrorResponse(error); }
}
