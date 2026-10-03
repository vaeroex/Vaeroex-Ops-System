import "server-only";

import { performance } from "node:perf_hooks";
import { isProxy } from "node:util/types";
import type { SquareIngestionOutcome } from "@/lib/integrations/providers/square/ingestion-contracts";

export type SquareSyncStop = "scan_exhausted" | "page_budget" | "deadline" | "cancelled" | "retry_deferred" | "recovery_required" | "blocked" | "rejected" | "conflict";
type Dependencies = Readonly<{
  runPage: (signal: AbortSignal) => Promise<SquareIngestionOutcome>;
  monotonicNow?: () => number;
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}>;

function wait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("cancelled")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** A bounded operator invocation, not a scheduler or new authority. Each page
 * reopens the existing native checked path. Durable cursors never leave it.
 * Retry/uncertain acknowledgement stops this process: the next invocation must
 * consult the original durable task after its lease/retry delay, not replay SQL.
 */
export async function runSquareMappedSync(dependencies: Dependencies, durationMs: number, signal: AbortSignal) {
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > 300_000) throw new Error("square_sync_window_denied");
  const now = dependencies.monotonicNow ?? (() => performance.now());
  const until = now() + durationMs;
  let attempts = 0, acknowledgedPages = 0, sourceObservations = 0;
  const result = (stop: SquareSyncStop, retryAfterMs: number | null = null) => Object.freeze({
    contractVersion: "square_bounded_sync_v1" as const, stop, attempts, acknowledgedPages,
    // Observations returned by acknowledged pages, NOT newly inserted versions.
    sourceObservations, retryAfterMs, historical: "unknown" as const, economic: "blocked" as const
  });
  while (attempts < 10) {
    if (signal.aborted) return result("cancelled");
    // Native setup and close surround the adapter's30s deadline. Reserve its
    // full60s command bound plus2s, not only the inner provider operation.
    if (until - now() < 62_000) return result("deadline");
    if (attempts) {
      try { await (dependencies.wait ?? wait)(500, signal); }
      catch { return result(signal.aborted ? "cancelled" : "recovery_required", 30_000); }
      if (signal.aborted) return result("cancelled");
      if (until - now() < 62_000) return result("deadline");
    }
    attempts++;
    let page: SquareIngestionOutcome;
    try {
      const value = await dependencies.runPage(signal);
      if (!value || typeof value !== "object" || isProxy(value)) throw new Error("invalid_outcome");
      const fields: Record<string, unknown> = {};
      for (const key of ["outcome", "code", "sourceCount", "continuation", "retryAfterMs"]) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !("value" in descriptor)) throw new Error("invalid_outcome");
        fields[key] = descriptor.value;
      }
      page = fields as unknown as SquareIngestionOutcome;
    }
    catch { return result(signal.aborted ? "cancelled" : "recovery_required", 30_000); }
    if (signal.aborted) return result("cancelled", 30_000);
    // Only finite public categories/counters leave this layer. Never propagate
    // arbitrary dependency error text, completeness details, URLs or cursors.
    if (!Number.isSafeInteger(page.sourceCount) || page.sourceCount < 0 || page.sourceCount > 20_000 || typeof page.continuation !== "boolean") return result("recovery_required", 30_000);
    switch (page.outcome) {
      case "committed":
        acknowledgedPages++; sourceObservations += page.sourceCount;
        if (!page.continuation) return result("scan_exhausted");
        break;
      case "finished": return result("scan_exhausted");
      case "blocked": case "rejected": case "conflict": return result(page.outcome);
      case "retry": {
        const delay = page.retryAfterMs;
        if (!Number.isSafeInteger(delay) || delay === null || delay < 0 || delay > 86_400_000) return result("recovery_required", 30_000);
        return result(["rate_limited", "transient", "deadline", "checkpoint_deferred"].includes(page.code) ? "retry_deferred" : "recovery_required", Math.max(30_000, delay));
      }
      default: return result("recovery_required", 30_000);
    }
  }
  return result("page_budget");
}
