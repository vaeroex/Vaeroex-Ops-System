import "server-only";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { isHistoricalProvider, isProvider, type Provider } from "./catalog";
import { admin, available, unseal } from "./security";
import { executeReportingRefresh, reportingErrorCode, reportingRequestSignal, reportingRpcArgs, type ReportingDatabase } from "./execution";
import { ReportingProviderError } from "./transport";
import { recentDateRange, resolveImportRange } from "../date-range";

export { reportingRefreshScope, reportingRecurringAllowed } from "./recurring-scope";
import { reportingRecurringAllowed } from "./recurring-scope";
export type DueReportingConnection = { id: string; workspace_id: string; provider: Provider };
export const REPORTING_REFRESH_CONCURRENCY = 2;
export const REPORTING_REFRESH_MAX_ATTEMPTS = 20;
const uuid = z.string().uuid();

export function validReportingSchedulerSecret(authorization: string | null, secret: string | undefined) {
  if (!secret || secret.length < 32 || secret.length > 512 || !authorization) return false;
  const actual = Buffer.from(authorization), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Only the last seven completed UTC dates are revisited automatically. A
 * current snapshot is never represented as a reconstructed reporting period. */
export function recurringReportingRange(now = new Date()) {
  const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000).toISOString().slice(0, 10);
  const range = recentDateRange(7, yesterday);
  return resolveImportRange(range.startDate, range.endDate, now);
}

export async function runScheduledReportingRefresh(connection: DueReportingConnection, execution: {
  deadlineAt: number; cleanupDeadlineAt: number;
}, db: ReportingDatabase = admin()): Promise<"succeeded" | "deferred" | "failed"> {
  const { provider, workspace_id: workspaceId, id: connectionId } = connection;
  if (!reportingRecurringAllowed(workspaceId, provider) || !available(provider)) return "deferred";
  const args = reportingRpcArgs(workspaceId, provider, connectionId), lease = randomUUID();
  const startedAt = Date.now(), deadlineAt = Math.min(execution.deadlineAt, startedAt + 58_000);
  let admitted = false;
  try {
    const claim = await db.rpc("claim_reporting_recurring", { ...args, p_lease: lease }).abortSignal(reportingRequestSignal(deadlineAt));
    if (claim.error) throw new Error("reporting_claim_unavailable");
    if (claim.data !== true) return "deferred";
    admitted = true;
    // The ID, workspace, provider, live lease and consent scope are checked
    // before opening the encrypted credential. SQL rechecks on every write.
    const { data: row, error } = await db.from("reporting_connections").select("account,recurring_last_attempt_at")
      .eq("workspace_id", workspaceId).eq("provider", provider).eq("id", connectionId)
      .eq("status", "connected").eq("recurring_enabled", true).eq("lease_id", lease)
      .eq("lease_kind", "scheduled").gt("lease_expires_at", new Date().toISOString())
      .abortSignal(reportingRequestSignal(deadlineAt)).single();
    if (error || !row) throw new Error("reporting_claim_unavailable");
    const { data: saved, error: savedError } = await db.from("reporting_credentials").select("ciphertext")
      .eq("workspace_id", workspaceId).eq("provider", provider).eq("connection_id", connectionId)
      .abortSignal(reportingRequestSignal(deadlineAt)).single();
    if (savedError || !saved) throw new Error("authorization_required");
    const now = new Date(), claimedAt = new Date(z.string().datetime({ offset: true }).parse(row.recurring_last_attempt_at));
    await executeReportingRefresh({ db, workspaceId, provider, connectionId, leaseId: lease, account: row.account,
      credential: unseal(provider, workspaceId, connectionId, saved.ciphertext),
      range: isHistoricalProvider(provider) ? recurringReportingRange(claimedAt) : null, now, deadlineAt });
    return "succeeded";
  } catch (error) {
    // Even when a claim response is lost, a cleanup with the request's random
    // lease can safely settle only that claim. Never clear a newer worker.
    const failed = await db.rpc("fail_reporting_recurring", { ...args, p_lease: lease, p_error: reportingErrorCode(error),
      p_retry_seconds: error instanceof ReportingProviderError ? error.retryAfterSeconds : 0 })
      .abortSignal(reportingRequestSignal(execution.cleanupDeadlineAt));
    if (failed.error) throw new Error("reporting_cleanup_unavailable");
    if (failed.data !== true && admitted) return "deferred";
    return "failed";
  }
}

/** One bounded, oldest-due SQL page per tick. SQL spreads the page across
 * workspaces and limits all overlapping invocations; local workers never run
 * two connections from one workspace together. Every started task is awaited. */
export async function runDueReportingRefreshes(input: {
  due: (limit: number, deadlineAt: number) => Promise<DueReportingConnection[]>;
  sync: (connection: DueReportingConnection, execution: { deadlineAt: number; cleanupDeadlineAt: number }) => Promise<"succeeded" | "deferred" | "failed">;
  eligible: (connection: DueReportingConnection) => boolean;
  now?: () => number;
}) {
  const now = input.now ?? Date.now, startedAt = now();
  const execution = { deadlineAt: startedAt + 240_000, cleanupDeadlineAt: startedAt + 285_000 };
  const found = await input.due(REPORTING_REFRESH_MAX_ATTEMPTS, execution.deadlineAt);
  if (found.length > REPORTING_REFRESH_MAX_ATTEMPTS) throw new Error("reporting_due_invalid");
  const seen = new Set<string>();
  const pending = found.filter(connection => {
    if (!uuid.safeParse(connection.id).success || !uuid.safeParse(connection.workspace_id).success || !isProvider(connection.provider))
      throw new Error("reporting_due_invalid");
    if (seen.has(connection.id)) throw new Error("reporting_due_invalid");
    seen.add(connection.id);
    return input.eligible(connection);
  });
  const active = new Set<Promise<void>>(), workspaces = new Set<string>();
  let succeeded = 0, deferred = 0, failed = 0, cleanupFailed = 0, peakActive = 0, attempted = 0;
  try {
    while (pending.length && now() + 65_000 < execution.deadlineAt) {
      const index = pending.findIndex(connection => !workspaces.has(connection.workspace_id));
      if (active.size < REPORTING_REFRESH_CONCURRENCY && index >= 0) {
        const [connection] = pending.splice(index, 1);
        workspaces.add(connection.workspace_id); attempted++;
        const task = Promise.resolve().then(async () => {
          try {
            const result = await input.sync(connection, execution);
            if (result === "succeeded") succeeded++;
            else if (result === "deferred") deferred++;
            else failed++;
          } catch { failed++; cleanupFailed++; }
        }).finally(() => { active.delete(task); workspaces.delete(connection.workspace_id); });
        active.add(task); peakActive = Math.max(peakActive, active.size);
      } else if (active.size) await Promise.race(active);
      else break;
    }
  } finally { await Promise.all(active); }
  return { attempted, succeeded, failed, deferred, cleanupFailed, peakActive, remaining: pending.length };
}
