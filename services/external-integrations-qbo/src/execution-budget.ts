import "server-only";

// New claims reserve 30 seconds for post-expiry recovery inside the 300-second
// recovery target. Already-issued database lease expiries are never rewritten.
// Useful work retains 240 seconds; cleanup gets 15 seconds, then a further
// 15-second fencing margin before expiry. Cleanup failure remains explicit.
export const QBO_TASK_LEASE_SECONDS = 270;
export const QBO_TASK_WORK_MS = 240_000;
export const QBO_TASK_CLEANUP_MS = 255_000;

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
