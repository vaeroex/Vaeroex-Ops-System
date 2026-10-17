import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { activeToken, admin, assertOrigin, organizations, requireOwner } from "@/lib/integrations/zoho-books/server";

export async function POST(request: Request) {
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const form = await request.formData();
    const connectionId = z.string().uuid().parse(form.get("connectionId"));
    const organizationId = z.string().regex(/^\d{5,30}$/).parse(form.get("organizationId"));
    const db = admin();
    const { data: connection, error: lookupError } = await db.from("zoho_books_connections")
      .select("id").eq("workspace_id", access.workspaceId).eq("id", connectionId)
      .eq("status", "choose_organization").maybeSingle();
    if (lookupError || !connection) throw new Error("zoho_books_selection_invalid");
    const choices = await organizations(await activeToken(access.workspaceId, connectionId));
    const selected = choices.find((org) => org.id === organizationId);
    if (!selected) throw new Error("zoho_books_selection_invalid");
    const { data: updated, error: updateError } = await db.from("zoho_books_connections").update({
      status: "connected", organization_id: selected.id, organization_name: selected.name,
      currency_code: selected.currency, updated_at: new Date().toISOString()
    }).eq("workspace_id", access.workspaceId).eq("id", connectionId)
      .eq("status", "choose_organization").select("id").maybeSingle();
    if (updateError || !updated) throw new Error("zoho_books_selection_failed");
    return Response.redirect("https://www.vaeroex.com/app/integrations/zoho-books?result=connected", 303);
  } catch {
    return Response.redirect("https://www.vaeroex.com/app/integrations/zoho-books?result=error", 303);
  }
}
