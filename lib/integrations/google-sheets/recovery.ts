import "server-only";
import { z } from "zod";
import { sheetsAdmin } from "./server";
import { withSheetsRequest } from "./execution";

/** No provider traffic or retry admission. SQL only terminally reconciles
 * expired, still-running leases and never overwrites a completed result. */
export async function recoverExpiredSheetsSyncs() {
  const { data, error } = await withSheetsRequest(Date.now() + 10_000, 10_000, signal =>
    sheetsAdmin().rpc("recover_google_sheets_syncs_v1", { p_limit: 100 }).abortSignal(signal));
  if (error) throw new Error("google_sheets_recovery_unavailable");
  return z.object({ recovered: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(),
    remainingExpired: z.number().int().nonnegative(), oldestExpiredSeconds: z.number().nonnegative() }).parse(data);
}
