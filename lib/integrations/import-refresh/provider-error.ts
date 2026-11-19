import "server-only";
import { reportingRetryAfter } from "../reporting/transport";

export class ImportProviderError extends Error {
  constructor(message: string, readonly retryAfterSeconds = 0) {
    super(message); this.name = "ImportProviderError";
  }
}
/** Closed error codes and bounded delay only. Provider bodies and credentials
 * never become UI errors, persisted diagnostics, or log content. */
export async function throwImportProviderError(response: Response, prefix: "loyverse" | "zoho_books" | "wix", token = false): Promise<never> {
  await response.body?.cancel();
  const reason = response.status === 401 || response.status === 403 || (token && response.status === 400)
    ? "authorization_required" : response.status === 429 ? "quota_exceeded" : "provider_unavailable";
  throw new ImportProviderError(`${prefix}_${reason}`, response.status === 429 || response.status === 503
    ? reportingRetryAfter(response.headers.get("retry-after")) : 0);
}
