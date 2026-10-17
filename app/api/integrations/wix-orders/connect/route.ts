import { randomBytes, randomUUID } from "node:crypto";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertOrigin, enabled, hash, installHandoff, requireOwner } from "@/lib/integrations/wix-orders/server";

export async function POST(request: Request) {
  try {
    if (!enabled()) throw new Error("wix_unavailable");
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const db = admin();
    const { data: existing, error: lookupError } = await db.from("wix_order_connections")
      .select("id,status,created_at").eq("workspace_id", access.workspaceId)
      .in("status", ["pending", "connected", "reauthorization_required"]).limit(2);
    if (lookupError || (existing?.length ?? 0) > 1 || existing?.some((row) => row.status !== "pending"))
      throw new Error("wix_connection_exists");
    if (existing?.[0]) {
      if (Date.parse(existing[0].created_at) > Date.now() - 20 * 60_000) throw new Error("wix_connection_exists");
      const { error: staleError } = await db.from("wix_order_connections").delete()
        .eq("workspace_id", access.workspaceId).eq("id", existing[0].id).eq("status", "pending");
      if (staleError) throw new Error("wix_database_unavailable");
    }
    const id = randomUUID(), state = randomBytes(32).toString("base64url");
    const { error: connectionError } = await db.from("wix_order_connections").insert({
      id, workspace_id: access.workspaceId, created_by: access.user.id, status: "pending"
    });
    if (connectionError) throw new Error("wix_database_unavailable");
    const { error: stateError } = await db.from("wix_order_install_states").insert({
      state_hash: hash(state), workspace_id: access.workspaceId, connection_id: id,
      initiated_by: access.user.id, expires_at: new Date(Date.now() + 20 * 60_000).toISOString()
    });
    if (stateError) {
      await db.from("wix_order_connections").delete().eq("workspace_id", access.workspaceId).eq("id", id);
      throw new Error("wix_database_unavailable");
    }
    return installHandoff(state);
  } catch {
    return Response.redirect("https://www.vaeroex.com/app/integrations/wix-orders?result=error", 303);
  }
}
