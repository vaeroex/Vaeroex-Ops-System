import { z } from "zod";
import { assertStorageOrigin, assertStorageWorkspace, requireStorageAccess, StorageAccessError, storageErrorResponse, storageJson } from "@/lib/storage-capacity/access";
import { quoteWorkspaceCapacity } from "@/lib/storage-capacity/billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({ workspaceId:z.string().uuid(), packs:z.number().int().min(1).max(10) }).strict();
export async function POST(request:Request) {
  try {
    assertStorageOrigin(request);
    const access=await requireStorageAccess({owner:true});
    const body=input.parse(await storageJson(request));assertStorageWorkspace(access,body.workspaceId);
    const quote=await quoteWorkspaceCapacity(access.workspaceId,access.user.id,body.packs);
    return Response.json(quote,{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return storageErrorResponse(error instanceof z.ZodError ? new StorageAccessError(400,"Select between 1 and 10 packs for the current workspace.") : error); }
}
