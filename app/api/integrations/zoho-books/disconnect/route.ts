import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertOrigin, requireOwner } from "@/lib/integrations/zoho-books/server";

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const form = await request.formData();
    const connectionId = z.string().uuid().parse(form.get("connectionId"));
    if (form.get("confirmation") !== "disconnect") throw new Error("zoho_books_confirmation_required");
    const { data: disconnected, error } = await admin().rpc("disconnect_zoho_books_connection", {
      p_workspace_id: access.workspaceId, p_connection_id: connectionId
    });
    if (error || !disconnected) throw new Error("zoho_books_disconnect_failed");
    return Response.redirect("https://www.vaeroex.com/app/integrations/zoho-books?result=disconnected", 303);
  } catch {
    return Response.redirect("https://www.vaeroex.com/app/integrations/zoho-books?result=error", 303);
  }
}
