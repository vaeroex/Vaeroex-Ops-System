import { randomUUID } from "node:crypto";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertOrigin, decryptToken, recentReceipts, refreshToken, requireOwner } from "@/lib/integrations/loyverse/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  let lease: { workspaceId: string; connectionId: string; leaseId: string } | null = null;
  try {
    assertOrigin(request);
    const access = await requireWorkspaceAccess();
    requireOwner(access);
    const data = await request.formData();
    const connectionId = data.get("connectionId");
    if (typeof connectionId !== "string" || !/^[a-f0-9-]{36}$/i.test(connectionId)) throw new Error("invalid_connection");
    const db = admin(), now = new Date(), leaseId = randomUUID();
    const { data: connection, error: leaseError } = await db.from("loyverse_connections")
      .update({ sync_lease_id: leaseId, sync_lease_expires_at: new Date(Date.now() + 65_000).toISOString() })
      .eq("workspace_id", access.workspaceId).eq("id", connectionId).eq("status", "connected")
      .or(`sync_lease_expires_at.is.null,sync_lease_expires_at.lt.${now.toISOString()}`)
      .select("id").maybeSingle();
    if (leaseError || !connection) throw new Error("loyverse_sync_busy");
    lease = { workspaceId: access.workspaceId, connectionId, leaseId };
    const { data: credential, error: credentialError } = await db.from("loyverse_credentials")
      .select("token_ciphertext").eq("workspace_id", access.workspaceId).eq("connection_id", connectionId).single();
    if (credentialError || !credential) throw new Error("loyverse_authorization_required");
    let token = decryptToken(access.workspaceId, connectionId, credential.token_ciphertext);
    if (Date.parse(token.expiresAt) < Date.now() + 60_000) {
      token = await refreshToken(token.refreshToken);
      const { encryptToken } = await import("@/lib/integrations/loyverse/server");
      const { error: updateError } = await db.from("loyverse_credentials").update({
        token_ciphertext: encryptToken(access.workspaceId, connectionId, token),
        access_expires_at: token.expiresAt, updated_at: new Date().toISOString()
      }).eq("workspace_id", access.workspaceId).eq("connection_id", connectionId);
      if (updateError) throw new Error("loyverse_credential_storage_failed");
    }
    const windowEnd = new Date().toISOString();
    const windowStart = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const facts = await recentReceipts(token.accessToken, windowStart, windowEnd);
    const { error: applyError } = await db.rpc("apply_loyverse_receipts", {
      p_workspace_id: access.workspaceId, p_connection_id: connectionId, p_lease_id: leaseId,
      p_window_start: windowStart, p_window_end: windowEnd, p_receipts: facts
    });
    if (applyError) throw new Error("loyverse_sync_failed");
    lease = null;
    return Response.redirect("https://www.vaeroex.com/app/integrations/loyverse?result=synced", 303);
  } catch (error) {
    if (lease) {
      const code = error instanceof Error && error.message === "loyverse_authorization_required"
        ? "authorization_required" : "sync_failed";
      await admin().from("loyverse_connections").update({
        sync_lease_id: null, sync_lease_expires_at: null, last_error_code: code,
        ...(code === "authorization_required" ? { status: "reauthorization_required" } : {})
      }).eq("workspace_id", lease.workspaceId).eq("id", lease.connectionId).eq("sync_lease_id", lease.leaseId);
    }
    return Response.redirect("https://www.vaeroex.com/app/integrations/loyverse?result=error", 303);
  }
}
