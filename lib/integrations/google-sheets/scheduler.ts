import "server-only";

import type { SheetsExecutionBudget } from "./execution";

export type DueSheetsConnection = { id: string; workspace_id: string };

// Matches the authoritative SQL admission budget. This is a per-invocation
// bound; the database also covers overlapping schedulers and manual refreshes.
export const SHEETS_SCHEDULER_CONCURRENCY = 4;
export const SHEETS_SCHEDULER_MAX_ATTEMPTS = 50;

export type SheetsScheduledAdmission = { run: <T>(claim: () => Promise<T>) => Promise<T> };

/** Serialize admission RPCs only. When external work occupies the budget,
 * poll once per second across this dispatcher, preserving each worker's place
 * in a fair claim queue. A busy tenant releases the queue before retrying. */
export function createSheetsScheduledAdmission(deadlineAt: number, now = Date.now,
  wait: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))) {
  let tail = Promise.resolve(), retryAt = 0, admissionRpcAttempts = 0, admissionRetries = 0, admissionWaitMs = 0;
  return {
    metrics: () => ({ admissionRpcAttempts, admissionRetries, admissionWaitMs }),
    async run<T>(claim: () => Promise<T>): Promise<T> {
      let attempts = 0, lastBusy = new Error("google_sheets_capacity_busy");
      while (now() < deadlineAt) {
        const waitingAt = now(), preceding = tail;
        let release!: () => void;
        tail = new Promise<void>(resolve => { release = resolve; });
        await preceding;
        try {
          if (now() < retryAt) await wait(Math.max(1, Math.min(retryAt, deadlineAt) - now()));
          admissionWaitMs += Math.max(0, now() - waitingAt);
          if (now() >= deadlineAt) throw lastBusy;
          admissionRpcAttempts++;
          if (attempts++ > 0) admissionRetries++;
          try {
            const claimed = await claim();
            retryAt = 0;
            return claimed;
          } catch (error) {
            if (!(error instanceof Error) || !/^google_sheets_(?:capacity|workspace)_busy$/.test(error.message)) throw error;
            lastBusy = error;
            retryAt = now() + 1000;
          }
        } finally { release(); }
      }
      throw lastBusy;
    }
  };
}

/** Work-conserving, tenant-fair dispatch: a slow workspace occupies one slot,
 * never a whole batch. All launched work is awaited, including cancellation and
 * cleanup. SQL owns admission, expiring leases and stale-worker fencing. */
export async function runDueSheetsRefreshes(input: {
  due: (tickAt: string, limit: number, deadlineAt: number, excludedConnectionIds: readonly string[]) => Promise<DueSheetsConnection[]>;
  sync: (connection: DueSheetsConnection, execution: SheetsExecutionBudget, admission: SheetsScheduledAdmission) => Promise<unknown>;
  backoff: (connection: DueSheetsConnection, tickAt: string, deadlineAt: number) => Promise<unknown>;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}) {
  const now = input.now ?? Date.now;
  const startedAt = now(), tickAt = new Date(startedAt).toISOString();
  const execution = { deadlineAt: startedAt + 240_000, cleanupDeadlineAt: startedAt + 285_000 };
  const admission = createSheetsScheduledAdmission(execution.deadlineAt, now, input.wait);
  const seenIds = new Set<string>(), activeWorkspaces = new Set<string>();
  const pending: DueSheetsConnection[] = [], active = new Set<Promise<void>>();
  let succeeded = 0, failed = 0, deferred = 0, backoffFailed = 0, peakActive = 0, exhausted = false;
  try {
    while (now() < execution.deadlineAt) {
      // Fetch while there is a free slot and no queued eligible tenant. Looking
      // past a busy tenant prevents its other connections from hiding the rest.
      let next = pending.findIndex(connection => !activeWorkspaces.has(connection.workspace_id));
      if (active.size < SHEETS_SCHEDULER_CONCURRENCY && next < 0 && !exhausted && seenIds.size < SHEETS_SCHEDULER_MAX_ATTEMPTS) {
        const limit = Math.min(10, SHEETS_SCHEDULER_MAX_ATTEMPTS - seenIds.size);
        const due = await input.due(tickAt, limit, execution.deadlineAt, [...seenIds]);
        if (due.length > limit) throw new Error("google_sheets_scheduler_result_invalid");
        const candidates = due.filter(connection => !seenIds.has(connection.id));
        // A failed acknowledgement or nonconforming reader must not spin.
        if (candidates.length === 0) exhausted = true;
        for (const connection of candidates) {
          if (seenIds.has(connection.id)) continue;
          seenIds.add(connection.id);
          pending.push(connection);
        }
        next = pending.findIndex(connection => !activeWorkspaces.has(connection.workspace_id));
        if (now() >= execution.deadlineAt) break;
        if (next < 0 && !exhausted && seenIds.size < SHEETS_SCHEDULER_MAX_ATTEMPTS) continue;
      }
      if (active.size < SHEETS_SCHEDULER_CONCURRENCY && next >= 0) {
        const [connection] = pending.splice(next, 1);
        activeWorkspaces.add(connection.workspace_id);
        const task = Promise.resolve().then(async () => {
          try { await input.sync(connection, execution, admission); succeeded++; }
          catch (error) {
            // A race for admission accepted no work. Leave original eligibility
            // unchanged; another tick can admit it without an hour-long backoff.
            if (error instanceof Error && /google_sheets_(?:capacity|workspace|sync)_busy/.test(error.message)) deferred++;
            else {
              failed++;
              await input.backoff(connection, tickAt, execution.cleanupDeadlineAt).catch(() => { backoffFailed++; });
            }
          }
        }).finally(() => { active.delete(task); activeWorkspaces.delete(connection.workspace_id); });
        active.add(task);
        peakActive = Math.max(peakActive, active.size);
        continue;
      }
      if (active.size === 0) break;
      await Promise.race(active);
    }
  } finally {
    // A failed due query must not return while already-started workers still
    // run. Transport cancellation is handled by each worker's shared deadline.
    await Promise.all(active);
  }
  return { attempted: succeeded + failed + deferred, succeeded, failed, deferred, backoffFailed, peakActive, ...admission.metrics() };
}
