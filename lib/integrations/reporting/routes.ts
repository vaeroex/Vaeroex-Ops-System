import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { requireWorkspaceAccess } from "@/lib/security/require-workspace-access";
import { isProvider, catalog, type Provider } from "./catalog";
import { admin, assertRequest, available, formData, hashState, redirect, requireOwner, seal, unseal, credentialSchema, accountSchema } from "./security";
import { authorizationUrl, exchange } from "./oauth";
import { accounts, snapshot } from "./adapters";

type Params = { params: Promise<{ provider: string; action: string }> };
const uuid = z.string().uuid();
function rpcArgs(workspace: string, provider: Provider, connection: string) {
  return { p_workspace: workspace, p_provider: provider, p_connection: connection };
}
function requireResult(result: { error: unknown; data: unknown }) {
  if (result.error || result.data !== true) throw new Error("database_action_failed");
}
export async function post(request: Request, context: Params) {
  const { provider: raw, action } = await context.params;
  if (!isProvider(raw) || !["connect","select-account","sync","disconnect"].includes(action)) return new Response(null, { status: 404 });
  const provider = raw;
  let cleanup: { workspace: string; connection: string } | null = null;
  let lease: { workspace: string; connection: string; id: string } | null = null;
  try {
    assertRequest(request);
    const access = await requireWorkspaceAccess(); requireOwner(access);
    // Disconnect remains possible after a provider has been disabled or credentials rotated.
    if (action !== "disconnect" && !available(provider)) return redirect(provider, "configuration_required");
    const form = await formData(request), db = admin();
    if (action === "connect") {
      if (form.get("confirmation") !== "connect") throw new Error("confirmation_required");
      const connection = randomUUID(), state = randomBytes(32).toString("base64url");
      const { error } = await db.rpc("begin_reporting_connection", { ...rpcArgs(access.workspaceId, provider, connection),
        p_actor: access.user.id, p_hash: catalog[provider].auth === "oauth" ? hashState(state) : null });
      if (error?.code === "23505") return redirect(provider, "connection_exists");
      if (error) throw new Error("database_action_failed");
      cleanup = { workspace: access.workspaceId, connection };
      if (catalog[provider].auth === "oauth") {
        const target = authorizationUrl(provider, state); cleanup = null;
        return new Response(null, { status: 303, headers: { Location: target, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
      }
      const credential = credentialSchema.parse({ accessToken: form.get("apiKey") });
      credential.accounts = await accounts(provider, credential.accessToken, AbortSignal.timeout(20_000), form);
      requireResult(await db.rpc("finish_reporting_connection", { ...rpcArgs(access.workspaceId, provider, connection), p_ciphertext: seal(provider, access.workspaceId, connection, credential) }));
      cleanup = null; return redirect(provider, "choose_account");
    }
    const connection = uuid.parse(form.get("connectionId")), args = rpcArgs(access.workspaceId, provider, connection);
    if (action === "disconnect") {
      if (form.get("confirmation") !== "disconnect") throw new Error("confirmation_required");
      requireResult(await db.rpc("disconnect_reporting_connection", args));
      return redirect(provider, "disconnected");
    }
    const { data: row, error } = await db.from("reporting_connections").select("status,account,created_by")
      .eq("workspace_id", access.workspaceId).eq("provider", provider).eq("id", connection).single();
    if (error || !row) throw new Error("connection_missing");
    if (action === "select-account" && (row.status !== "choose_account" || row.created_by !== access.user.id)) throw new Error("invalid_actor");
    if (action === "sync") {
      const leaseId = randomUUID();
      const claimed = await db.rpc("claim_reporting_sync", { ...args, p_lease: leaseId });
      if (claimed.error) throw new Error("database_action_failed");
      if (!claimed.data) return redirect(provider, "sync_wait");
      lease = { workspace: access.workspaceId, connection, id: leaseId };
    }
    const { data: saved, error: savedError } = await db.from("reporting_credentials").select("ciphertext")
      .eq("workspace_id", access.workspaceId).eq("provider", provider).eq("connection_id", connection).single();
    if (savedError || !saved) throw new Error("authorization_required");
    let credential = unseal(provider, access.workspaceId, connection, saved.ciphertext);
    if (action === "select-account") {
      const selected = credential.accounts?.find(a => a.id === form.get("accountId") && (a.parent ?? "") === (form.get("parent") ?? ""));
      if (!selected || form.get("confirmation") !== "select") throw new Error("invalid_account");
      if (credential.expiresAt && Date.parse(credential.expiresAt) < Date.now()+60_000) return redirect(provider, "authorization_required");
      delete credential.accounts;
      requireResult(await db.rpc("select_reporting_account", { ...args, p_account: selected, p_ciphertext: seal(provider, access.workspaceId, connection, credential) }));
      return redirect(provider, "connected");
    }
    const signal = AbortSignal.timeout(45_000);
    if (credential.expiresAt && Date.parse(credential.expiresAt) < Date.now()+60_000) {
      if (!credential.refreshToken) throw new Error("authorization_required");
      credential = await exchange(provider, { refresh: credential.refreshToken }, signal);
      requireResult(await db.rpc("save_reporting_refresh", { ...args, p_lease: lease!.id, p_ciphertext: seal(provider, access.workspaceId, connection, credential) }));
    }
    const report = await snapshot(provider, credential.accessToken, accountSchema.parse(row.account), signal);
    requireResult(await db.rpc("apply_reporting_snapshot", { ...args, p_lease: lease!.id, p_snapshot: report }));
    lease = null; return redirect(provider, "synced");
  } catch (error) {
    const code = error instanceof Error && ["authorization_required","quota_exceeded","snapshot_too_large"].includes(error.message) ? error.message : "sync_failed";
    if (cleanup) await admin().rpc("disconnect_reporting_connection", rpcArgs(cleanup.workspace, provider, cleanup.connection));
    if (lease) await admin().from("reporting_connections").update({ lease_id: null, lease_expires_at: null, last_error_code: code,
      ...(code === "authorization_required" ? { status: "reauthorization_required" } : {}) })
      .eq("workspace_id", lease.workspace).eq("provider", provider).eq("id", lease.connection).eq("lease_id", lease.id).eq("status", "connected");
    return redirect(provider, code);
  }
}
export async function get(request: Request, context: Params) {
  const { provider: raw, action } = await context.params;
  if (!isProvider(raw) || action !== "callback" || catalog[raw].auth !== "oauth") return new Response(null, { status: 404 });
  const provider = raw;
  let cleanup: { workspace: string; connection: string } | null = null;
  try {
    assertRequest(request, true);
    if (!available(provider)) throw new Error("configuration_required");
    const url = new URL(request.url);
    for (const field of ["state","code","error"]) if (url.searchParams.getAll(field).length > 1) throw new Error("invalid_callback");
    const state = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(url.searchParams.get("state"));
    if (url.searchParams.has("code") === url.searchParams.has("error")) throw new Error("invalid_callback");
    const db = admin(), hash = hashState(state);
    const { data: pending, error } = await db.from("reporting_oauth_states").select("workspace_id,connection_id,initiated_by")
      .eq("state_hash", hash).eq("provider", provider).is("consumed_at", null).gt("expires_at", new Date().toISOString()).single();
    if (error || !pending) throw new Error("invalid_state");
    const access = await requireWorkspaceAccess(pending.workspace_id); requireOwner(access);
    if (access.workspaceId !== pending.workspace_id || access.user.id !== pending.initiated_by) throw new Error("invalid_actor");
    const consumed = await db.from("reporting_oauth_states").update({ consumed_at: new Date().toISOString() })
      .eq("state_hash", hash).eq("workspace_id", access.workspaceId).eq("provider", provider).is("consumed_at", null)
      .gt("expires_at", new Date().toISOString()).select("connection_id").single();
    if (consumed.error || consumed.data?.connection_id !== pending.connection_id) throw new Error("invalid_state");
    cleanup = { workspace: access.workspaceId, connection: pending.connection_id };
    if (url.searchParams.has("error")) throw new Error("consent_denied");
    const signal = AbortSignal.timeout(30_000);
    const credential = await exchange(provider, { code: z.string().min(8).max(8192).parse(url.searchParams.get("code")) }, signal);
    credential.accounts = await accounts(provider, credential.accessToken, signal);
    requireResult(await db.rpc("finish_reporting_connection", { ...rpcArgs(access.workspaceId, provider, pending.connection_id),
      p_ciphertext: seal(provider, access.workspaceId, pending.connection_id, credential) }));
    cleanup = null; return redirect(provider, "choose_account");
  } catch {
    if (cleanup) await admin().rpc("disconnect_reporting_connection", rpcArgs(cleanup.workspace, provider, cleanup.connection));
    return redirect(provider, "authorization_failed");
  }
}
