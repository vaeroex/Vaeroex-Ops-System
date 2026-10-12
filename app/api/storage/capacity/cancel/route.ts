import { z } from "zod";
import { assertStorageOrigin, assertStorageWorkspace, requireStorageAccess, StorageAccessError, storageErrorResponse, storageJson } from "@/lib/storage-capacity/access";
import { cancelWorkspaceCapacity } from "@/lib/storage-capacity/billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input=z.object({workspaceId:z.string().uuid(),subscriptionId:z.string().regex(/^sub_[A-Za-z0-9]+$/),confirmed:z.literal(true)}).strict();
export async function POST(request:Request) {
  try {
    assertStorageOrigin(request);const access=await requireStorageAccess({owner:true,allowExpired:true});
    const body=input.parse(await storageJson(request));assertStorageWorkspace(access,body.workspaceId);
    const result=await cancelWorkspaceCapacity(access.workspaceId,access.user.id,body.subscriptionId);
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return storageErrorResponse(error instanceof z.ZodError ? new StorageAccessError(400,"Select a workspace capacity subscription and confirm cancellation.") : error); }
}
