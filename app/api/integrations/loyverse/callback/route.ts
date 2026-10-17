import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertOrigin, encryptToken, exchangeCode, merchant, redirect, requireOwner, stateHash } from "@/lib/integrations/loyverse/server";

export async function GET(request: Request) {
  let cleanup: { workspaceId: string; connectionId: string } | null = null;
  try {
    assertOrigin(request, true);
    const url = new URL(request.url);
    for (const key of ["state", "code", "error"]) if (url.searchParams.getAll(key).length > 1) throw new Error("invalid_callback");
    const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(url.searchParams.get("state"));
    if (url.searchParams.has("code") === url.searchParams.has("error")) throw new Error("invalid_callback");
    const db = admin(), hash = stateHash(state);
    const { data: pending, error: lookupError } = await db.from("loyverse_oauth_states")
      .select("workspace_id,connection_id,initiated_by").eq("state_hash", hash).is("consumed_at", null)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (lookupError || !pending) throw new Error("invalid_state");
    const access = await requireWorkspaceAccess(pending.workspace_id);
    requireOwner(access);
    if (access.workspaceId !== pending.workspace_id || access.user.id !== pending.initiated_by) throw new Error("invalid_actor");
    const { data: consumed, error: consumeError } = await db.from("loyverse_oauth_states")
      .update({ consumed_at: new Date().toISOString() }).eq("state_hash", hash).is("consumed_at", null)
      .gt("expires_at", new Date().toISOString()).select("connection_id").single();
    if (consumeError || consumed?.connection_id !== pending.connection_id) throw new Error("invalid_state");
    cleanup = { workspaceId: access.workspaceId, connectionId: pending.connection_id };
    if (url.searchParams.has("error")) {
      await db.from("loyverse_connections").update({ status: "reauthorization_required" })
        .eq("workspace_id", access.workspaceId).eq("id", pending.connection_id).eq("status", "pending")
        .not("merchant_id", "is", null);
      await db.from("loyverse_connections").update({ status: "disconnected" })
        .eq("workspace_id", access.workspaceId).eq("id", pending.connection_id).eq("status", "pending")
        .is("merchant_id", null);
      cleanup = null;
      return redirect("error", "consent_denied");
    }
    const code = z.string().min(8).max(8192).parse(url.searchParams.get("code"));
    const tokens = await exchangeCode(code);
    const account = await merchant(tokens.accessToken);
    const ciphertext = encryptToken(access.workspaceId, pending.connection_id, tokens);
    const { error: credentialError } = await db.from("loyverse_credentials").upsert({
      workspace_id: access.workspaceId, connection_id: pending.connection_id,
      token_ciphertext: ciphertext, access_expires_at: tokens.expiresAt,
      scope: "MERCHANT_READ RECEIPTS_READ"
    }, { onConflict: "connection_id" });
    if (credentialError) throw new Error("credential_storage_failed");
    const { data: connected, error: connectionError } = await db.from("loyverse_connections").update({
      status: "connected", merchant_id: account.id, business_name: account.business_name,
      currency_code: account.currency.code, updated_at: new Date().toISOString()
    }).eq("workspace_id", access.workspaceId).eq("id", pending.connection_id).eq("status", "pending").select("id").maybeSingle();
    if (connectionError || !connected) throw new Error("connection_storage_failed");
    cleanup = null;
    return redirect("connected");
  } catch {
    if (cleanup) {
      const db = admin();
      await db.from("loyverse_credentials").delete().eq("workspace_id", cleanup.workspaceId).eq("connection_id", cleanup.connectionId);
      await db.from("loyverse_connections").update({ status: "reauthorization_required" })
        .eq("workspace_id", cleanup.workspaceId).eq("id", cleanup.connectionId).eq("status", "pending")
        .not("merchant_id", "is", null);
      await db.from("loyverse_connections").update({ status: "disconnected" })
        .eq("workspace_id", cleanup.workspaceId).eq("id", cleanup.connectionId).eq("status", "pending")
        .is("merchant_id", null);
    }
    return Response.redirect("https://www.vaeroex.com/app/integrations/loyverse?result=error", 303);
  }
}
