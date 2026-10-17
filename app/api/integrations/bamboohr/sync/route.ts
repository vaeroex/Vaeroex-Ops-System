import { randomUUID } from "node:crypto";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertOrigin, decryptToken, encryptToken, refreshToken, requireOwner, staffingSnapshot } from "@/lib/integrations/bamboohr/server";

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
    const { data: connection, error: leaseError } = await db.from("bamboohr_connections")
      .update({ sync_lease_id: leaseId, sync_lease_expires_at: new Date(Date.now() + 65_000).toISOString() })
      .eq("workspace_id", access.workspaceId).eq("id", connectionId).eq("status", "connected")
      .or(`sync_lease_expires_at.is.null,sync_lease_expires_at.lt.${now.toISOString()}`)
      .select("id,company_domain").maybeSingle();
    if (leaseError || !connection) throw new Error("bamboohr_sync_busy");
    lease = { workspaceId: access.workspaceId, connectionId, leaseId };
    const { data: credential, error: credentialError } = await db.from("bamboohr_credentials")
      .select("token_ciphertext").eq("workspace_id", access.workspaceId).eq("connection_id", connectionId).single();
    if (credentialError || !credential) throw new Error("bamboohr_authorization_required");
    let token = decryptToken(access.workspaceId, connectionId, credential.token_ciphertext);
    if (Date.parse(token.expiresAt) < Date.now() + 60_000) {
      token = await refreshToken(connection.company_domain, token.refreshToken);
      const { error: updateError } = await db.from("bamboohr_credentials").update({
        token_ciphertext: encryptToken(access.workspaceId, connectionId, token),
        access_expires_at: token.expiresAt, updated_at: new Date().toISOString()
      }).eq("workspace_id", access.workspaceId).eq("connection_id", connectionId);
      if (updateError) throw new Error("bamboohr_credential_storage_failed");
    }
    const snapshot = await staffingSnapshot(connection.company_domain, token.accessToken);
    const { data: applied, error: applyError } = await db.rpc("apply_bamboohr_snapshot", {
      p_workspace_id: access.workspaceId, p_connection_id: connectionId, p_lease_id: leaseId,
      p_active_headcount: snapshot.activeHeadcount,
      p_roster_readable: snapshot.rosterReadable, p_roster_total: snapshot.rosterTotal,
      p_approved_time_off_requests: snapshot.approvedTimeOffRequests
    });
    if (applyError || !applied) throw new Error("bamboohr_sync_failed");
    lease = null;
    return Response.redirect("https://www.vaeroex.com/app/integrations/bamboohr?result=synced", 303);
  } catch (error) {
    if (lease) {
      const code = error instanceof Error && error.message === "bamboohr_authorization_required"
        ? "authorization_required" : "sync_failed";
      await admin().from("bamboohr_connections").update({
        sync_lease_id: null, sync_lease_expires_at: null, last_error_code: code,
        ...(code === "authorization_required" ? { status: "reauthorization_required" } : {})
      }).eq("workspace_id", lease.workspaceId).eq("id", lease.connectionId).eq("sync_lease_id", lease.leaseId);
    }
    return Response.redirect("https://www.vaeroex.com/app/integrations/bamboohr?result=error", 303);
  }
}
