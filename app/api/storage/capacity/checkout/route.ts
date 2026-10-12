import { z } from "zod";
import { assertStorageOrigin, assertStorageWorkspace, requireStorageAccess, StorageAccessError, storageErrorResponse, storageJson } from "@/lib/storage-capacity/access";
import { checkoutWorkspaceCapacity } from "@/lib/storage-capacity/billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input=z.object({workspaceId:z.string().uuid(),quoteId:z.string().uuid(),acceptedTerms:z.literal(true)}).strict();
export async function POST(request:Request) {
  try {
    assertStorageOrigin(request);const access=await requireStorageAccess({owner:true});
    const body=input.parse(await storageJson(request));assertStorageWorkspace(access,body.workspaceId);
    if(!access.user.email || !access.user.email_confirmed_at)throw new StorageAccessError(403,"Verify your email before purchasing capacity.");
    const result=await checkoutWorkspaceCapacity(access.workspaceId,access.user.id,access.user.email,body.quoteId);
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return storageErrorResponse(error instanceof z.ZodError ? new StorageAccessError(400,"Review a current workspace quote and explicitly accept its recurring terms before continuing.") : error); }
}
