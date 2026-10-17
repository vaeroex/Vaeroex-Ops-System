import { randomBytes, randomUUID } from "node:crypto";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertOrigin, authorizationUrl, enabled, requireOwner, stateHash } from "@/lib/integrations/loyverse/server";

export async function POST(request: Request) {
  try {
    if (!enabled()) throw new Error("loyverse_unavailable");
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const db = admin();
    const { data: existing, error: existingError } = await db.from("loyverse_connections")
      .select("id,status,merchant_id").eq("workspace_id", access.workspaceId)
      .in("status", ["pending", "connected", "reauthorization_required"]).limit(2);
    if (existingError || (existing?.length ?? 0) > 1) throw new Error("loyverse_connection_exists");
    let current: { id: string; status: string; merchant_id: string | null } | undefined = existing?.[0];
    if (current?.status === "pending") {
      const { data: liveState, error: stateLookupError } = await db.from("loyverse_oauth_states")
        .select("state_hash").eq("workspace_id", access.workspaceId).eq("connection_id", current.id)
        .is("consumed_at", null).gt("expires_at", new Date().toISOString()).limit(1);
      if (stateLookupError || liveState?.length) throw new Error("loyverse_connection_exists");
      const nextStatus = current.merchant_id ? "reauthorization_required" : "disconnected";
      const { error: retireError } = await db.from("loyverse_connections").update({ status: nextStatus })
        .eq("workspace_id", access.workspaceId).eq("id", current.id).eq("status", "pending");
      if (retireError) throw new Error("loyverse_database_unavailable");
      current = nextStatus === "reauthorization_required" ? { ...current, status: nextStatus } : undefined;
    }
    if (current?.status === "connected") throw new Error("loyverse_connection_exists");
    const reconnect = current?.status === "reauthorization_required";
    const connectionId = reconnect && current ? current.id : randomUUID();
    const state = randomBytes(32).toString("base64url");
    const { error: insertError } = reconnect
      ? await db.from("loyverse_connections").update({ status: "pending" })
        .eq("workspace_id", access.workspaceId).eq("id", connectionId).eq("status", "reauthorization_required")
      : await db.from("loyverse_connections").insert({ id: connectionId,
        workspace_id: access.workspaceId, created_by: access.user.id, status: "pending" });
    if (insertError) throw new Error("loyverse_database_unavailable");
    const { error: stateError } = await db.from("loyverse_oauth_states").insert({
      state_hash: stateHash(state), workspace_id: access.workspaceId, connection_id: connectionId,
      initiated_by: access.user.id, expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
    });
    if (stateError) {
      if (reconnect) await db.from("loyverse_connections").update({ status: "reauthorization_required" })
        .eq("workspace_id", access.workspaceId).eq("id", connectionId).eq("status", "pending");
      else await db.from("loyverse_connections").delete().eq("workspace_id", access.workspaceId).eq("id", connectionId);
      throw new Error("loyverse_database_unavailable");
    }
    return Response.redirect(authorizationUrl(state), 303);
  } catch {
    return Response.redirect("https://www.vaeroex.com/app/integrations/loyverse?result=error", 303);
  }
}
