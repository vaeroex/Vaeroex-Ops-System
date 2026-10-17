import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { accessToken, admin, assertOrigin, config, encryptInstance, hash, requireOwner, verifySignedInstance } from "@/lib/integrations/wix-orders/server";

export async function GET(request: Request) {
  let pendingConnection: { workspaceId: string; id: string } | null = null;
  try {
    assertOrigin(request, true);
    const params = new URL(request.url).searchParams;
    for (const key of ["state", "appId", "instanceId", "signedInstance", "tenantId"]) {
      if (params.getAll(key).length > 1) throw new Error("wix_callback_invalid");
    }
    const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(params.get("state"));
    const db = admin(), stateHash = hash(state);
    const { data: pending, error: lookupError } = await db.from("wix_order_install_states")
      .select("workspace_id,connection_id,initiated_by").eq("state_hash", stateHash)
      .is("consumed_at", null).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (lookupError || !pending) throw new Error("wix_state_invalid");
    const access = await requireWorkspaceAccess(pending.workspace_id);
    requireOwner(access);
    if (access.workspaceId !== pending.workspace_id || access.user.id !== pending.initiated_by)
      throw new Error("wix_actor_invalid");
    const { data: consumed, error: consumeError } = await db.from("wix_order_install_states")
      .update({ consumed_at: new Date().toISOString() }).eq("state_hash", stateHash)
      .is("consumed_at", null).gt("expires_at", new Date().toISOString())
      .select("connection_id").maybeSingle();
    if (consumeError || consumed?.connection_id !== pending.connection_id) throw new Error("wix_state_invalid");
    pendingConnection = { workspaceId: access.workspaceId, id: pending.connection_id };
    if (params.get("appId") !== config().appId) throw new Error("wix_app_invalid");
    const signed = z.string().min(20).max(8192).parse(params.get("signedInstance"));
    const instanceId = verifySignedInstance(signed);
    if (params.get("instanceId") !== instanceId) throw new Error("wix_instance_invalid");
    const siteId = z.string().uuid().parse(params.get("tenantId"));
    await accessToken(instanceId); // Confirm the app is installed and authorized before storing the instance.
    const { error: credentialError } = await db.from("wix_order_credentials").insert({
      workspace_id: access.workspaceId, connection_id: pending.connection_id,
      instance_ciphertext: encryptInstance(access.workspaceId, pending.connection_id, instanceId)
    });
    if (credentialError) throw new Error("wix_credential_failed");
    const { data: connected, error: connectionError } = await db.from("wix_order_connections")
      .update({ status: "connected", instance_hash: hash(instanceId),
        site_id: siteId, updated_at: new Date().toISOString() })
      .eq("workspace_id", access.workspaceId).eq("id", pending.connection_id).eq("status", "pending")
      .select("id").maybeSingle();
    if (connectionError || !connected) throw new Error("wix_connection_failed");
    pendingConnection = null;
    return Response.redirect("https://www.vaeroex.com/app/integrations/wix-orders?result=connected", 303);
  } catch {
    if (pendingConnection) await admin().from("wix_order_connections").delete()
      .eq("workspace_id", pendingConnection.workspaceId).eq("id", pendingConnection.id).eq("status", "pending");
    return Response.redirect("https://www.vaeroex.com/app/integrations/wix-orders?result=error", 303);
  }
}
