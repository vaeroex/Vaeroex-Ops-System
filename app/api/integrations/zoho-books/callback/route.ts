import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { admin, assertOrigin, encryptToken, exchangeCode, organizations, redirect, requireOwner, stateHash } from "@/lib/integrations/zoho-books/server";

export async function GET(request: Request) {
  let cleanup: { workspaceId: string; connectionId: string } | null = null;
  try {
    assertOrigin(request, true);
    const url = new URL(request.url);
    for (const key of ["state", "code", "error", "location", "accounts-server"])
      if (url.searchParams.getAll(key).length > 1) throw new Error("invalid_callback");
    const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(url.searchParams.get("state"));
    if (url.searchParams.has("code") === url.searchParams.has("error")) throw new Error("invalid_callback");
    if (url.searchParams.has("accounts-server") && url.searchParams.get("accounts-server") !== "https://accounts.zoho.com")
      throw new Error("zoho_books_region_unsupported");
    if (url.searchParams.has("location") && url.searchParams.get("location") !== "us")
      throw new Error("zoho_books_region_unsupported");
    const db = admin(), hash = stateHash(state);
    const { data: pending, error: lookupError } = await db.from("zoho_books_oauth_states")
      .select("workspace_id,connection_id,initiated_by").eq("state_hash", hash).is("consumed_at", null)
      .gt("expires_at", new Date().toISOString()).maybeSingle();
    if (lookupError || !pending) throw new Error("invalid_state");
    const access = await requireWorkspaceAccess(pending.workspace_id);
    requireOwner(access);
    if (access.workspaceId !== pending.workspace_id || access.user.id !== pending.initiated_by) throw new Error("invalid_actor");
    const { data: consumed, error: consumeError } = await db.from("zoho_books_oauth_states")
      .update({ consumed_at: new Date().toISOString() }).eq("state_hash", hash).is("consumed_at", null)
      .gt("expires_at", new Date().toISOString()).select("connection_id").single();
    if (consumeError || consumed?.connection_id !== pending.connection_id) throw new Error("invalid_state");
    cleanup = { workspaceId: access.workspaceId, connectionId: pending.connection_id };
    if (url.searchParams.has("error")) {
      await db.from("zoho_books_credentials").delete()
        .eq("workspace_id", access.workspaceId).eq("connection_id", pending.connection_id);
      await settlePending(access.workspaceId, pending.connection_id);
      cleanup = null;
      return redirect("error");
    }
    const code = z.string().min(8).max(8192).parse(url.searchParams.get("code"));
    const tokens = await exchangeCode(code);
    const options = await organizations(tokens.accessToken);
    if (!options.length) throw new Error("zoho_books_us_organization_required");
    const { data: prior, error: priorError } = await db.from("zoho_books_connections")
      .select("organization_id").eq("workspace_id", access.workspaceId).eq("id", pending.connection_id).single();
    if (priorError || !prior) throw new Error("zoho_books_connection_missing");
    const selected = prior.organization_id ? options.find((org) => org.id === prior.organization_id) :
      options.length === 1 ? options[0] : null;
    if (prior.organization_id && !selected) throw new Error("zoho_books_organization_mismatch");
    const ciphertext = encryptToken(access.workspaceId, pending.connection_id, tokens);
    const { error: credentialError } = await db.from("zoho_books_credentials").upsert({
      workspace_id: access.workspaceId, connection_id: pending.connection_id,
      token_ciphertext: ciphertext, access_expires_at: tokens.expiresAt,
      scope: "ZohoBooks.settings.READ,ZohoBooks.invoices.READ,ZohoBooks.expenses.READ"
    }, { onConflict: "connection_id" });
    if (credentialError) throw new Error("zoho_books_credential_storage_failed");
    const { data: connected, error: connectionError } = await db.from("zoho_books_connections").update({
      status: selected ? "connected" : "choose_organization",
      organization_id: selected?.id ?? null, organization_name: selected?.name ?? null,
      currency_code: selected?.currency ?? null, updated_at: new Date().toISOString()
    }).eq("workspace_id", access.workspaceId).eq("id", pending.connection_id).eq("status", "pending")
      .select("id").maybeSingle();
    if (connectionError || !connected) throw new Error("zoho_books_connection_storage_failed");
    cleanup = null;
    return redirect(selected ? "connected" : "choose");
  } catch {
    if (cleanup) {
      const db = admin();
      await db.from("zoho_books_credentials").delete().eq("workspace_id", cleanup.workspaceId).eq("connection_id", cleanup.connectionId);
      await settlePending(cleanup.workspaceId, cleanup.connectionId);
    }
    return Response.redirect("https://www.vaeroex.com/app/integrations/zoho-books?result=error", 303);
  }
}

async function settlePending(workspaceId: string, connectionId: string) {
  const db = admin();
  await db.from("zoho_books_connections").update({ status: "reauthorization_required" })
    .eq("workspace_id", workspaceId).eq("id", connectionId).eq("status", "pending")
    .not("organization_id", "is", null);
  await db.from("zoho_books_connections").update({ status: "disconnected" })
    .eq("workspace_id", workspaceId).eq("id", connectionId).eq("status", "pending")
    .is("organization_id", null);
}
