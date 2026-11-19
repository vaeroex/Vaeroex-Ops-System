import "server-only";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { reportingRequestSignal } from "../reporting/execution";
import { squareDirectConfig, squareDirectEnabled } from "./server";
import { squareRecurringAllowed } from "./recurring-scope";
import { createDirectSquareProvider, SquareDirectRateLimitError } from "./provider";
import { readDirectSquarePage } from "./read-page";

export type DueSquareConnection = { connection_id: string; workspace_id: string };
export type SquareRecurringDatabase = { rpc(name: string, payload: Record<string, unknown>): {
  abortSignal(signal: AbortSignal): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
} };
export const SQUARE_RECURRING_MAX_PAGES = 4;
export const SQUARE_RECURRING_MAX_ATTEMPTS = 20;
export const SQUARE_RECURRING_CONCURRENCY = 2;

/** One bounded continuation, retaining the provider's original validated cursor
 * and atomic page commits. A partial page never commits. Earlier complete pages
 * remain saved while a later failure leaves the completed-window time unchanged. */
export async function runSquareRecurring(connection: DueSquareConnection, execution: {
  deadlineAt: number; cleanupDeadlineAt: number;
}, options: { db?: SquareRecurringDatabase; network?: typeof fetch; now?: () => Date } = {}) {
  if (!squareDirectEnabled() || !squareRecurringAllowed(connection.workspace_id)) return { outcome: "deferred" as const, pages: 0, complete: false };
  const settings = squareDirectConfig(), db = options.db ?? (createSupabaseAdminClient() as unknown as SquareRecurringDatabase | null), now = options.now ?? (() => new Date());
  if (!db) throw new Error("square_recurring_database_unavailable");
  let pages = 0, complete = false;
  while (pages < SQUARE_RECURRING_MAX_PAGES && Date.now() + 65_000 < execution.deadlineAt) {
    const pageDeadline = Math.min(execution.deadlineAt, Date.now() + 58_000);
    let busy = false, cleanupFailed = false;
    const call = async (operation: string, payload: Record<string, unknown>, cleanup = false) => {
      if (!["claim", "authorize", "reconcile", "commit_refresh", "commit_page", "fail"].includes(operation)) throw new Error("square_recurring_operation_denied");
      const result = await db.rpc("square_customer_recurring_v1", { p_operation: operation, p_workspace_id: connection.workspace_id,
        p_application_id: settings.applicationId, p_payload: payload }).abortSignal(reportingRequestSignal(cleanup ? execution.cleanupDeadlineAt : pageDeadline));
      if (result.error || result.data == null) {
        if (operation === "claim" && result.error?.code === "55000") busy = true;
        throw new Error("square_recurring_persistence_failed");
      }
      return result.data;
    };
    try {
      const receipt = await readDirectSquarePage({ workspaceId: connection.workspace_id, connectionId: connection.connection_id,
        encryptionKey: settings.encryptionKey, now, updatedOnly: true, rpc: call,
        provider: authorize => createDirectSquareProvider({ ...settings, authorize, now, network: options.network,
          signal: reportingRequestSignal(pageDeadline, 58_000) }),
        fail: async (connectionId, leaseId, error) => {
          if (busy) return;
          const reason = error instanceof Error && error.message === "square_direct_reauthorization_required" ? "reauthorization_required" : "retry_required";
          try { await call("fail", { connectionId, leaseId, reason,
            retryAfterSeconds: error instanceof SquareDirectRateLimitError ? error.retryAfterSeconds : 0 }, true); }
          catch { cleanupFailed = true; }
        }
      });
      pages++; complete = !receipt.hasMore;
      if (complete) return { outcome: "succeeded" as const, pages, complete: true };
    } catch {
      if (cleanupFailed) throw new Error("square_recurring_cleanup_unavailable");
      return { outcome: busy ? "deferred" as const : "failed" as const, pages, complete: false };
    }
  }
  return { outcome: pages ? "progressed" as const : "deferred" as const, pages, complete };
}

/** The same database admission budget also covers manual reads and the nine
 * other reporting/import connectors. A timer tick never scans arbitrary tenants. */
export async function runDueSquareRefreshes(input: {
  due: (limit: number, deadlineAt: number) => Promise<DueSquareConnection[]>;
  eligible: (connection: DueSquareConnection) => boolean;
  sync: (connection: DueSquareConnection, execution: { deadlineAt: number; cleanupDeadlineAt: number }) => ReturnType<typeof runSquareRecurring>;
  now?: () => number;
}) {
  const clock = input.now ?? Date.now, startedAt = clock();
  const execution = { deadlineAt: startedAt + 240_000, cleanupDeadlineAt: startedAt + 285_000 };
  const rows = await input.due(SQUARE_RECURRING_MAX_ATTEMPTS, execution.deadlineAt), seen = new Set<string>();
  if (rows.length > SQUARE_RECURRING_MAX_ATTEMPTS) throw new Error("square_recurring_due_invalid");
  const pending = rows.filter(row => {
    if (!z.string().uuid().safeParse(row.connection_id).success || !z.string().uuid().safeParse(row.workspace_id).success || seen.has(row.connection_id))
      throw new Error("square_recurring_due_invalid");
    seen.add(row.connection_id); return input.eligible(row);
  });
  const active = new Set<Promise<void>>(), tenants = new Set<string>();
  let attempted = 0, succeeded = 0, progressed = 0, deferred = 0, failed = 0, cleanupFailed = 0, pages = 0, peakActive = 0;
  try {
    while (pending.length && clock() + 65_000 < execution.deadlineAt) {
      const index = pending.findIndex(row => !tenants.has(row.workspace_id));
      if (active.size < SQUARE_RECURRING_CONCURRENCY && index >= 0) {
        const [row] = pending.splice(index, 1); tenants.add(row.workspace_id); attempted++;
        const task = Promise.resolve().then(async () => {
          try {
            const result = await input.sync(row, execution); pages += result.pages;
            if (result.outcome === "succeeded") succeeded++; else if (result.outcome === "progressed") progressed++;
            else if (result.outcome === "deferred") deferred++; else failed++;
          } catch { failed++; cleanupFailed++; }
        }).finally(() => { active.delete(task); tenants.delete(row.workspace_id); });
        active.add(task); peakActive = Math.max(peakActive, active.size);
      } else if (active.size) await Promise.race(active);
      else break;
    }
  } finally { await Promise.all(active); }
  return { attempted, succeeded, progressed, deferred, failed, cleanupFailed, pages, peakActive, remaining: pending.length };
}
