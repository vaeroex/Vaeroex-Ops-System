import "server-only";

import type { SheetsExecutionBudget } from "./execution";

export type DueSheetsConnection = { id: string; workspace_id: string };

/** Bounded dispatcher on the existing application scheduler. A seen set also
 * prevents repeated attempts when a failed backoff acknowledgement is lost. */
export async function runDueSheetsRefreshes(input: {
  due: (tickAt: string, limit: number, deadlineAt: number) => Promise<DueSheetsConnection[]>;
  sync: (connection: DueSheetsConnection, execution: SheetsExecutionBudget) => Promise<unknown>;
  backoff: (connection: DueSheetsConnection, tickAt: string, deadlineAt: number) => Promise<unknown>;
  now?: () => number;
}) {
  const now = input.now ?? Date.now;
  const startedAt = now(), tickAt = new Date(startedAt).toISOString();
  const execution = { deadlineAt: startedAt + 240_000, cleanupDeadlineAt: startedAt + 285_000 };
  const deadline = execution.deadlineAt, seen = new Set<string>();
  let succeeded = 0, failed = 0;
  for (let batch = 0; batch < 5 && now() < deadline; batch++) {
    const due = await input.due(tickAt, 10, deadline);
    if (due.length > 10) throw new Error("google_sheets_scheduler_result_invalid");
    const candidates = due.filter(connection => !seen.has(`${connection.workspace_id}:${connection.id}`));
    if (candidates.length === 0) break;
    for (const connection of candidates) {
      if (now() >= deadline) break;
      const key = `${connection.workspace_id}:${connection.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try { await input.sync(connection, execution); succeeded++; }
      catch {
        failed++;
        // Do not retry a failed write inside this tick. Its original due slot
        // can be reconsidered next tick without repeating it in this request.
        await input.backoff(connection, tickAt, execution.cleanupDeadlineAt).catch(() => undefined);
      }
    }
  }
  return { attempted: succeeded + failed, succeeded, failed };
}
