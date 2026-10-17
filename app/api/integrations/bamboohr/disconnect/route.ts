import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertOrigin, requireOwner } from "@/lib/integrations/bamboohr/server";

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const form = await request.formData();
    const connectionId = form.get("connectionId");
    if (form.get("confirmation") !== "disconnect" || typeof connectionId !== "string" ||
        !/^[a-f0-9-]{36}$/i.test(connectionId)) throw new Error("invalid_request");
    const db = admin();
    const { data: disconnected, error } = await db.rpc("disconnect_bamboohr_connection", {
      p_workspace_id: access.workspaceId, p_connection_id: connectionId
    });
    if (error || !disconnected) throw new Error("bamboohr_disconnect_failed");
    return Response.redirect("https://www.vaeroex.com/app/integrations/bamboohr?result=disconnected", 303);
  } catch {
    return Response.redirect("https://www.vaeroex.com/app/integrations/bamboohr?result=error", 303);
  }
}
