import "server-only";

export type SheetsExecutionBudget = { deadlineAt: number; cleanupDeadlineAt: number };
export type SheetsAbortableResult<T> = PromiseLike<T> & { abortSignal: (signal: AbortSignal) => PromiseLike<T> };

export function assertSheetsTimeRemaining(deadlineAt?: number, reserveMs = 0) {
  if (deadlineAt !== undefined && Date.now() + reserveMs >= deadlineAt)
    throw new Error("google_sheets_deadline_exceeded");
}

/** The transport and body reader must honor the supplied signal. Await actual
 * cancellation, rather than racing a still-running operation against a timer. */
export async function withSheetsRequest<T>(deadlineAt: number | undefined, timeoutMs: number,
  action: (signal: AbortSignal) => PromiseLike<T>): Promise<T> {
  assertSheetsTimeRemaining(deadlineAt);
  const startedAt = Date.now();
  const expiresAt = Math.min(deadlineAt ?? Infinity, startedAt + timeoutMs);
  const error = new Error(expiresAt === deadlineAt ? "google_sheets_deadline_exceeded" : "google_sheets_request_timeout");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(error), Math.max(1, expiresAt - startedAt));
  try {
    const result = await action(controller.signal);
    if (Date.now() >= expiresAt) controller.abort(error);
    controller.signal.throwIfAborted();
    return result;
  } catch (cause) {
    if (controller.signal.aborted) throw error;
    throw cause;
  } finally { clearTimeout(timer); }
}
