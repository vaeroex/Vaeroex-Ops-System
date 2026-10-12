import { z } from "zod";
import { assertStorageOrigin, assertStorageWorkspace, requireStorageAccess, StorageAccessError, storageErrorResponse, storageJson } from "@/lib/storage-capacity/access";
import { recoverWorkspaceCapacityPayment } from "@/lib/storage-capacity/billing";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const fields={workspaceId:z.string().uuid(),subscriptionId:z.string().regex(/^sub_[A-Za-z0-9]+$/)};
const input=z.union([z.object(fields).strict(),z.object({...fields,invoiceId:z.string().regex(/^in_[A-Za-z0-9]+$/),acceptedTerms:z.literal(true)}).strict()]);
export async function POST(request:Request) {
  try {
    assertStorageOrigin(request);const access=await requireStorageAccess({owner:true,allowExpired:true});
    const body=input.parse(await storageJson(request));assertStorageWorkspace(access,body.workspaceId);
    const result=await recoverWorkspaceCapacityPayment(access.workspaceId,access.user.id,body.subscriptionId,"invoiceId" in body?body.invoiceId:undefined);
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch(error) { return storageErrorResponse(error instanceof z.ZodError?new StorageAccessError(400,"Review this workspace's overdue invoice and explicitly accept its payment terms before paying."):error); }
}
