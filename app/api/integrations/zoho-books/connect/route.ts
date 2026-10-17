import { randomBytes, randomUUID } from "node:crypto";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertOrigin, authorizationUrl, enabled, requireOwner, stateHash } from "@/lib/integrations/zoho-books/server";

export async function POST(request: Request) {
  try {
    if (!enabled()) throw new Error("zoho_books_unavailable");
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const db = admin();
    const { data: existing, error: existingError } = await db.from("zoho_books_connections")
      .select("id,status,organization_id").eq("workspace_id", access.workspaceId)
      .in("status", ["pending", "choose_organization", "connected", "reauthorization_required"]).limit(2);
    if (existingError || (existing?.length ?? 0) > 1) throw new Error("zoho_books_connection_exists");
    let current: { id: string; status: string; organization_id: string | null } | undefined = existing?.[0];
    if (current?.status === "pending") {
      const { data: liveState, error: stateLookupError } = await db.from("zoho_books_oauth_states")
        .select("state_hash").eq("workspace_id", access.workspaceId).eq("connection_id", current.id)
        .is("consumed_at", null).gt("expires_at", new Date().toISOString()).limit(1);
      if (stateLookupError || liveState?.length) throw new Error("zoho_books_connection_exists");
      const nextStatus = current.organization_id ? "reauthorization_required" : "disconnected";
      const { error: retireError } = await db.from("zoho_books_connections").update({ status: nextStatus })
        .eq("workspace_id", access.workspaceId).eq("id", current.id).eq("status", "pending");
      if (retireError) throw new Error("zoho_books_database_unavailable");
      current = nextStatus === "reauthorization_required" ? { ...current, status: nextStatus } : undefined;
    }
    if (current && current.status !== "reauthorization_required") throw new Error("zoho_books_connection_exists");
    const reconnect = Boolean(current);
    const connectionId = current?.id ?? randomUUID();
    const state = randomBytes(32).toString("base64url");
    const { error: insertError } = reconnect
      ? await db.from("zoho_books_connections").update({ status: "pending" })
        .eq("workspace_id", access.workspaceId).eq("id", connectionId).eq("status", "reauthorization_required")
      : await db.from("zoho_books_connections").insert({ id: connectionId,
        workspace_id: access.workspaceId, created_by: access.user.id, status: "pending" });
    if (insertError) throw new Error("zoho_books_database_unavailable");
    const { error: stateError } = await db.from("zoho_books_oauth_states").insert({
      state_hash: stateHash(state), workspace_id: access.workspaceId, connection_id: connectionId,
      initiated_by: access.user.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
    });
    if (stateError) {
      if (reconnect) await db.from("zoho_books_connections").update({ status: "reauthorization_required" })
        .eq("workspace_id", access.workspaceId).eq("id", connectionId).eq("status", "pending");
      else await db.from("zoho_books_connections").delete().eq("workspace_id", access.workspaceId).eq("id", connectionId);
      throw new Error("zoho_books_database_unavailable");
    }
    return Response.redirect(authorizationUrl(state), 303);
  } catch {
    return Response.redirect("https://www.vaeroex.com/app/integrations/zoho-books?result=error", 303);
  }
}
