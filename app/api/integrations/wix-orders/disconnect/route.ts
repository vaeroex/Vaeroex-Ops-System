import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertOrigin, requireOwner } from "@/lib/integrations/wix-orders/server";

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const form = await request.formData();
    const id = form.get("connectionId");
    if (form.get("confirmation") !== "disconnect" || typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))
      throw new Error("wix_request_invalid");
    const db = admin();
    const { data: disconnected, error } = await db.rpc("disconnect_wix_order_connection", {
      p_workspace_id: access.workspaceId, p_connection_id: id
    });
    if (error || !disconnected) throw new Error("wix_disconnect_failed");
    return Response.redirect("https://www.vaeroex.com/app/integrations/wix-orders?result=disconnected", 303);
  } catch {
    return Response.redirect("https://www.vaeroex.com/app/integrations/wix-orders?result=error", 303);
  }
}
