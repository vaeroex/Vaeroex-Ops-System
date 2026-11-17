import "server-only";
import { z } from "zod";
import { isImportProvider, type ImportProvider } from "./scope";
import type { ImportExecution } from "./execution";

export type DueImportConnection = { id: string; workspace_id: string; provider: ImportProvider };
export const IMPORT_REFRESH_MAX_ATTEMPTS = 20;
export const IMPORT_REFRESH_CONCURRENCY = 2;
/** SQL owns shared admission across all nine reporting/import connectors. This
 * dispatcher bounds one tick and waits for every worker, including cleanup. */
export async function runDueImportRefreshes(input: {
  due: (limit: number, deadlineAt: number) => Promise<DueImportConnection[]>;
  eligible: (connection: DueImportConnection) => boolean;
  sync: (connection: DueImportConnection, execution: ImportExecution) => Promise<"succeeded" | "deferred" | "failed">;
  now?: () => number;
}) {
  const now = input.now ?? Date.now, startedAt = now(), execution = { deadlineAt: startedAt + 240_000, cleanupDeadlineAt: startedAt + 285_000 };
  const rows = await input.due(IMPORT_REFRESH_MAX_ATTEMPTS, execution.deadlineAt), seen = new Set<string>();
  if (rows.length > IMPORT_REFRESH_MAX_ATTEMPTS) throw new Error("import_due_invalid");
  const pending = rows.filter(row => {
    if (!z.string().uuid().safeParse(row.id).success || !z.string().uuid().safeParse(row.workspace_id).success ||
      !isImportProvider(row.provider) || seen.has(row.id)) throw new Error("import_due_invalid");
    seen.add(row.id); return input.eligible(row);
  });
  const active = new Set<Promise<void>>(), tenants = new Set<string>();
  let attempted = 0, succeeded = 0, deferred = 0, failed = 0, cleanupFailed = 0, peakActive = 0;
  try {
    while (pending.length && now() + 65_000 < execution.deadlineAt) {
      const index = pending.findIndex(row => !tenants.has(row.workspace_id));
      if (active.size < IMPORT_REFRESH_CONCURRENCY && index >= 0) {
        const [row] = pending.splice(index, 1); tenants.add(row.workspace_id); attempted++;
        const task = Promise.resolve().then(async () => {
          try {
            const result = await input.sync(row, execution);
            if (result === "succeeded") succeeded++; else if (result === "deferred") deferred++; else failed++;
          } catch { failed++; cleanupFailed++; }
        }).finally(() => { active.delete(task); tenants.delete(row.workspace_id); });
        active.add(task); peakActive = Math.max(peakActive, active.size);
      } else if (active.size) await Promise.race(active);
      else break;
    }
  } finally { await Promise.all(active); }
  return { attempted, succeeded, deferred, failed, cleanupFailed, peakActive, remaining: pending.length };
}
