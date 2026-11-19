import "server-only";
import { importHistory, snapshot } from "./adapters";
import { isHistoricalProvider, type Provider } from "./catalog";
import { accountSchema, seal, type Credential, type admin } from "./security";
import { exchange } from "./oauth";
import type { ImportDateRange } from "../date-range";

export type ReportingDatabase = ReturnType<typeof admin>;
export function reportingRpcArgs(workspace: string, provider: Provider, connection: string) {
  return { p_workspace: workspace, p_provider: provider, p_connection: connection };
}
export function requireReportingResult(result: { error: unknown; data: unknown }) {
  if (result.error || result.data !== true) throw new Error("database_action_failed");
}
export function reportingErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "sync_failed";
  return ["snapshot_too_large", "read_budget_exceeded", "response_too_large"].includes(message) ? "snapshot_too_large" :
    message === "authorization_required" ? "authorization_required" : message === "quota_exceeded" ? "quota_exceeded" : "sync_failed";
}

/** The deadline covers database calls as well as provider I/O. Cancellation never
 * retries a write: the lease and atomic commit decide whether it took effect. */
export function reportingRequestSignal(deadlineAt: number, maxMs = 10_000) {
  const remaining = Math.min(maxMs, deadlineAt - Date.now());
  if (remaining <= 0) throw new Error("reporting_deadline_exceeded");
  return AbortSignal.timeout(Math.max(1, Math.floor(remaining)));
}

/** Both manual imports and unattended refreshes use the same provider parser,
 * encrypted credential refresh, and whole-window atomic database commit. */
export async function executeReportingRefresh(input: {
  db: ReportingDatabase; workspaceId: string; provider: Provider; connectionId: string; leaseId: string;
  account: unknown; credential: Credential; range: ImportDateRange | null; deadlineAt?: number; now?: Date;
}) {
  const { db, provider, workspaceId, connectionId, leaseId } = input;
  const args = { ...reportingRpcArgs(workspaceId, provider, connectionId), p_lease: leaseId };
  const account = accountSchema.parse(input.account), now = input.now ?? new Date();
  const signal = input.deadlineAt === undefined ? AbortSignal.timeout(45_000) : reportingRequestSignal(input.deadlineAt, 45_000);
  const rpc = (name: string, parameters: Record<string, unknown>) => {
    const request = db.rpc(name, parameters);
    return input.deadlineAt === undefined ? request : request.abortSignal(reportingRequestSignal(input.deadlineAt));
  };
  let credential = input.credential;
  if (credential.expiresAt && Date.parse(credential.expiresAt) < now.getTime() + 60_000) {
    if (!credential.refreshToken) throw new Error("authorization_required");
    credential = await exchange(provider, { refresh: credential.refreshToken }, signal);
    requireReportingResult(await rpc("save_reporting_refresh", { ...args, p_ciphertext: seal(provider, workspaceId, connectionId, credential) }));
  }
  if (isHistoricalProvider(provider)) {
    if (!input.range) throw new Error("invalid_date_range");
    const report = await importHistory(provider, credential.accessToken, account, signal, input.range, now);
    requireReportingResult(await rpc("apply_reporting_history", { ...args,
      p_start_date: report.startDate, p_end_date: report.endDate, p_records: report.records,
      p_currencies: report.currencies, p_observed_through: input.range.endAt }));
  } else {
    const report = await snapshot(provider, credential.accessToken, account, signal, now);
    requireReportingResult(await rpc("apply_reporting_snapshot", { ...args, p_snapshot: report }));
  }
}
