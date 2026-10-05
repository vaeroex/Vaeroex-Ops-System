import "server-only";

// Keep the 300-second database lease and its expiry-bound evidence immutable.
// Useful work stops with a minute still reserved for fenced failure recording.
export const QBO_TASK_LEASE_SECONDS = 300;
export const QBO_TASK_WORK_MS = 240_000;
export const QBO_TASK_CLEANUP_MS = 285_000;

export class QboExecutionBudgetError extends Error {
  constructor() { super("qbo_production_execution_budget_exhausted"); }
}

export function createQboExecutionBudget(now = () => performance.now()) {
  const started = now();
  let cleanup = false;
  const remainingMilliseconds = () => {
    const remaining = (cleanup ? QBO_TASK_CLEANUP_MS : QBO_TASK_WORK_MS) - (now() - started);
    if (!Number.isFinite(remaining) || remaining < 1) throw new QboExecutionBudgetError();
    return Math.floor(remaining);
  };
  return {
    remainingMilliseconds,
    timeout: (maximum: number) => Math.min(maximum, remainingMilliseconds()),
    workExhausted: () => now() - started >= QBO_TASK_WORK_MS,
    beginCleanup: () => { cleanup = true; return remainingMilliseconds(); }
  };
}
