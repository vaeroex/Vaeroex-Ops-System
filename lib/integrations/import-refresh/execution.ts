import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import * as loyverse from "../loyverse/server";
import * as books from "../zoho-books/server";
import * as wix from "../wix-orders/server";
import { recentDateRange, resolveImportRange, type ImportDateRange } from "../date-range";
import { reportingRequestSignal } from "../reporting/execution";
import { importRecurringAllowed, type ImportProvider } from "./scope";
import { ImportProviderError } from "./provider-error";

export type ImportDatabase = ReturnType<typeof loyverse.admin>;
export type ImportExecution = { deadlineAt: number; cleanupDeadlineAt: number };
export function importProviderEnabled(provider: ImportProvider) {
  return provider === "loyverse" ? loyverse.enabled() : provider === "zoho-books" ? books.enabled() : wix.enabled();
}
export function importAdmin(provider: ImportProvider = "loyverse") {
  return provider === "loyverse" ? loyverse.admin() : provider === "zoho-books" ? books.admin() : wix.admin();
}
export const importTables = {
  loyverse: { connections: "loyverse_connections", credentials: "loyverse_credentials" },
  "zoho-books": { connections: "zoho_books_connections", credentials: "zoho_books_credentials" },
  "wix-orders": { connections: "wix_order_connections", credentials: "wix_order_credentials" }
} as const;
export function importRpcArgs(workspaceId: string, provider: ImportProvider, connectionId: string) {
  return { p_workspace: workspaceId, p_provider: provider, p_connection: connectionId };
}
export function importRecurringRange(claimedAt: Date) {
  const yesterday = new Date(Date.UTC(claimedAt.getUTCFullYear(), claimedAt.getUTCMonth(), claimedAt.getUTCDate()) - 86_400_000).toISOString().slice(0, 10);
  const range = recentDateRange(7, yesterday);
  return resolveImportRange(range.startDate, range.endDate, claimedAt);
}
export function importErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /_authorization_required$/.test(message) ? "authorization_required" : /_quota_exceeded$/.test(message) ? "quota_exceeded" :
    /(?:_limit_exceeded|_too_many_orders|_response_too_large)$/.test(message) ? "snapshot_too_large" : "sync_failed";
}

/** The manual and scheduled paths share SQL admission and the existing complete
 * parsers/atomic apply RPCs. A database response lost after commit is never
 * interpreted as a second import; cleanup can only own this attempt's lease. */
export async function runImportRefresh(input: {
  provider: ImportProvider; workspaceId: string; connectionId: string; trigger: "manual" | "scheduled";
  actorId?: string; range?: ImportDateRange; execution?: ImportExecution; db?: ImportDatabase;
}): Promise<"succeeded" | "deferred" | "failed"> {
  const { provider, workspaceId, connectionId, trigger } = input;
  if (trigger === "scheduled" && (!importRecurringAllowed(workspaceId, provider) || !importProviderEnabled(provider))) return "deferred";
  if (trigger === "manual" && (!z.string().uuid().safeParse(input.actorId).success || !input.range)) throw new Error("import_actor_required");
  // Validate a manual range before admission/credential access. Historical dates
  // remain supported; scheduled bounds come from the SQL admission timestamp.
  if (input.range) resolveImportRange(input.range.startDate, input.range.endDate);
  const startedAt = Date.now(), execution = input.execution ?? { deadlineAt: startedAt + 55_000, cleanupDeadlineAt: startedAt + 59_000 };
  const deadlineAt = Math.min(execution.deadlineAt, startedAt + 58_000), lease = randomUUID();
  const db = input.db ?? importAdmin(provider), tables = importTables[provider];
  const args = { ...importRpcArgs(workspaceId, provider, connectionId), p_lease: lease };
  let admitted = false;
  try {
    const claim = await db.rpc("claim_import_refresh", { ...args, p_trigger: trigger, p_actor: trigger === "manual" ? input.actorId : null })
      .abortSignal(reportingRequestSignal(deadlineAt));
    if (claim.error) throw new Error("import_claim_unavailable");
    if (claim.data !== true) return "deferred";
    admitted = true;
    let query = db.from(tables.connections).select(provider === "zoho-books" ? "id,organization_id,recurring_last_attempt_at" : "id,recurring_last_attempt_at")
      .eq("workspace_id", workspaceId).eq("id", connectionId).eq("status", "connected")
      .eq("sync_lease_id", lease).eq("sync_lease_kind", trigger).gt("sync_lease_expires_at", new Date().toISOString());
    if (trigger === "scheduled") query = query.eq("recurring_enabled", true);
    else query = query.eq("sync_lease_authorized_by", input.actorId!);
    const { data: connection, error: connectionError } = await query.abortSignal(reportingRequestSignal(deadlineAt)).single();
    if (connectionError || !connection) throw new Error("import_claim_unavailable");
    const row = connection as unknown as { id: string; organization_id?: string; recurring_last_attempt_at: string };
    const range = trigger === "manual" ? input.range! : importRecurringRange(new Date(z.string().datetime({ offset: true }).parse(row.recurring_last_attempt_at)));
    const { data: saved, error: savedError } = await db.from(tables.credentials)
      .select(provider === "wix-orders" ? "instance_ciphertext" : "token_ciphertext")
      .eq("workspace_id", workspaceId).eq("connection_id", connectionId)
      .abortSignal(reportingRequestSignal(deadlineAt)).single();
    if (savedError || !saved) throw new Error(`${provider === "zoho-books" ? "zoho_books" : provider === "wix-orders" ? "wix" : provider}_authorization_required`);
    const credential = saved as unknown as { token_ciphertext?: string; instance_ciphertext?: string };
    const signal = reportingRequestSignal(deadlineAt, 45_000);
    const applyArgs = { p_workspace_id: workspaceId, p_connection_id: connectionId, p_lease_id: lease };
    let applyName: string, payload: Record<string, unknown>;
    if (provider === "wix-orders") {
      const instance = wix.decryptInstance(workspaceId, connectionId, z.string().parse(credential.instance_ciphertext));
      const token = await wix.accessToken(instance, signal);
      const orders = await wix.recentOrders(token, range.startAt, range.endAt, signal);
      applyName = "apply_wix_order_snapshot";
      payload = { ...applyArgs, p_window_start: range.startAt, p_window_end: range.endAt, p_orders: orders };
    } else {
      const source = provider === "loyverse" ? loyverse : books;
      let token = source.decryptToken(workspaceId, connectionId, z.string().parse(credential.token_ciphertext));
      if (Date.parse(token.expiresAt) < Date.now() + 60_000) {
        token = await source.refreshToken(token.refreshToken, signal);
        const stored = await db.rpc("save_import_refresh_token", { ...args,
          p_ciphertext: source.encryptToken(workspaceId, connectionId, token), p_expires_at: token.expiresAt })
          .abortSignal(reportingRequestSignal(deadlineAt));
        if (stored.error || stored.data !== true) throw new Error("import_credential_storage_failed");
      }
      if (provider === "loyverse") {
        const receipts = await loyverse.recentReceipts(token.accessToken, range.startAt, range.endAt, signal);
        applyName = "apply_loyverse_receipts";
        payload = { ...applyArgs, p_window_start: range.startAt, p_window_end: range.endAt, p_receipts: receipts };
      } else {
        const facts = await books.accountingFacts(token.accessToken, z.string().parse(row.organization_id), range.startDate, range.endDate, signal);
        applyName = "apply_zoho_books_history";
        payload = { ...applyArgs, p_start_date: range.startDate, p_end_date: range.endDate, p_observed_through: range.endAt, p_facts: facts };
      }
    }
    const applied = await db.rpc(applyName, payload).abortSignal(reportingRequestSignal(deadlineAt));
    if (applied.error || !Number.isSafeInteger(applied.data) || applied.data < 0) throw new Error("import_apply_failed");
    return "succeeded";
  } catch (error) {
    const failure = await db.rpc("fail_import_refresh", { ...args, p_error: importErrorCode(error),
      p_retry_seconds: error instanceof ImportProviderError ? error.retryAfterSeconds : 0 })
      .abortSignal(reportingRequestSignal(execution.cleanupDeadlineAt));
    if (failure.error) throw new Error("import_cleanup_unavailable");
    if (trigger === "manual") throw error;
    return failure.data !== true && admitted ? "deferred" : "failed";
  }
}
