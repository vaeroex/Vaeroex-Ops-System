import { randomUUID } from "node:crypto";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { accessToken, admin, assertOrigin, decryptInstance, recentOrders, requireOwner } from "@/lib/integrations/wix-orders/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  let lease: { workspaceId: string; connectionId: string; leaseId: string } | null = null;
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const form = await request.formData();
    const connectionId = form.get("connectionId");
    if (typeof connectionId !== "string" || !/^[a-f0-9-]{36}$/i.test(connectionId)) throw new Error("wix_connection_invalid");
    const db = admin(), leaseId = randomUUID();
    const { data: connection, error: leaseError } = await db.from("wix_order_connections")
      .update({ sync_lease_id: leaseId, sync_lease_expires_at: new Date(Date.now() + 65_000).toISOString() })
      .eq("workspace_id", access.workspaceId).eq("id", connectionId).eq("status", "connected")
      .or(`sync_lease_expires_at.is.null,sync_lease_expires_at.lt.${new Date().toISOString()}`)
      .select("id").maybeSingle();
    if (leaseError || !connection) throw new Error("wix_sync_busy");
    lease = { workspaceId: access.workspaceId, connectionId, leaseId };
    const { data: credential, error: credentialError } = await db.from("wix_order_credentials")
      .select("instance_ciphertext").eq("workspace_id", access.workspaceId).eq("connection_id", connectionId).single();
    if (credentialError || !credential) throw new Error("wix_authorization_required");
    const instanceId = decryptInstance(access.workspaceId, connectionId, credential.instance_ciphertext);
    const token = await accessToken(instanceId);
    const end = new Date().toISOString(), start = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const orders = await recentOrders(token, start, end);
    const { error: applyError } = await db.rpc("apply_wix_order_snapshot", {
      p_workspace_id: access.workspaceId, p_connection_id: connectionId, p_lease_id: leaseId,
      p_window_start: start, p_window_end: end, p_orders: orders
    });
    if (applyError) throw new Error("wix_sync_failed");
    lease = null;
    return Response.redirect("https://www.vaeroex.com/app/integrations/wix-orders?result=synced", 303);
  } catch (error) {
    if (lease) {
      const reauthorize = error instanceof Error && error.message === "wix_authorization_required";
      await admin().from("wix_order_connections").update({ sync_lease_id: null, sync_lease_expires_at: null,
        last_error_code: reauthorize ? "authorization_required" : "sync_failed",
        ...(reauthorize ? { status: "reauthorization_required" } : {}) })
        .eq("workspace_id", lease.workspaceId).eq("id", lease.connectionId).eq("sync_lease_id", lease.leaseId);
    }
    return Response.redirect("https://www.vaeroex.com/app/integrations/wix-orders?result=error", 303);
  }
}
