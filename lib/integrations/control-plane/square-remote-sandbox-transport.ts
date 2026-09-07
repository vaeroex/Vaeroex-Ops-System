import "server-only";

import type { SquareOAuthTransport } from "@/lib/integrations/providers/square/account-connection-oauth";
import { SQUARE_REMOTE_SANDBOX } from "@/lib/integrations/control-plane/square-remote-sandbox-contracts";

function denied(): never { throw new Error("square_remote_transport_denied"); }

/** One reader, one current chunk, no retained chunk list; the consumer's existing
 * decoder owns the fixed response buffer. The expanded graph limits are unchanged.
 * Abort cancels fetch and the reader; redirect bodies are never delivered. */
async function openSquareSandboxResponse(input: Readonly<{
  url: string; method: "GET" | "POST"; headers: Readonly<Record<string, string>>;
  body: string | null; signal: AbortSignal; maximumResponseBytes: number;
}>, network: typeof fetch = fetch) {
  const response = await network(input.url, { method: input.method, headers: input.headers,
    body: input.body, signal: input.signal, redirect: "manual", cache: "no-store", credentials: "omit" });
  if (response.redirected || response.status >= 300 && response.status < 400 || !response.body) {
    await response.body?.cancel().catch(() => undefined); denied();
  }
  const reader = response.body.getReader();
  let closed = false, count = 0;
  const close = async () => {
    if (closed) return;
    closed = true;
    input.signal.removeEventListener("abort", aborted);
    try { await reader.cancel(); } catch { /* Never forward provider diagnostics. */ }
    try { reader.releaseLock(); } catch { /* An in-flight read settles on cancel. */ }
  };
  const aborted = () => { void close(); };
  input.signal.addEventListener("abort", aborted, { once: true });
  if (input.signal.aborted) { await close(); denied(); }
  async function* body() {
    try {
      for (;;) {
        if (closed || input.signal.aborted) denied();
        const next = await reader.read();
        if (input.signal.aborted) denied();
        if (next.done) return;
        count += next.value.byteLength;
        if (count > input.maximumResponseBytes) denied();
        yield next.value;
      }
    } finally { await close(); }
  }
  return Object.freeze({ status: response.status, body: body(), close });
}

/** Credential use is gated again immediately before each request. Only the five
 * implemented OAuth/discovery endpoints exist here; no revoke or business write.
 * A surface flag does not approve provider calls. */
export function createSquareSandboxOAuthTransport(input: Readonly<{
  authorize(): Promise<void>;
  network?: typeof fetch;
}>): SquareOAuthTransport {
  return async request => {
    try {
      const url = new URL(request.url);
      const discovery = ["/v2/merchants/me", "/v2/locations", "/v2/locations/main"].includes(url.pathname);
      if (url.origin !== SQUARE_REMOTE_SANDBOX.providerOrigin || url.username || url.password || url.search || url.hash ||
        (!discovery && !["/oauth2/token", "/oauth2/token/status"].includes(url.pathname)) ||
        request.method !== (discovery ? "GET" : "POST") ||
        request.maximumResponseBytes !== (discovery ? 16 * 1_024 * 1_024 : 65_536) ||
        request.headers["Square-Version"] !== SQUARE_REMOTE_SANDBOX.apiVersion ||
        request.headers["Content-Type"] !== "application/json" ||
        Object.keys(request.headers).some(key => !["Square-Version", "Content-Type", "Authorization"].includes(key)) ||
        (url.pathname === "/oauth2/token"
          ? typeof request.body !== "string" || request.body.length > 65_536
          : request.body !== null)) denied();
      if (url.pathname === "/oauth2/token") {
        const body = JSON.parse(request.body!);
        if (body.client_id !== SQUARE_REMOTE_SANDBOX.applicationId ||
          !["authorization_code", "refresh_token"].includes(body.grant_type) || body.short_lived !== true) denied();
      }
      if (request.signal.aborted) denied();
      await input.authorize();
      if (request.signal.aborted) denied();
      return await openSquareSandboxResponse(request, input.network);
    } catch { return denied(); }
  };
}

/** Provider-owned raw notification bytes, bounded before signature validation.
 * A fixed 64KiB buffer plus one <=64KiB copy at return is the retained bound;
 * many tiny chunks do not add closures or per-chunk collection entries. */
export async function readSquareSandboxNotification(request: Request) {
  if (!request.body || request.headers.get("content-type")?.split(";", 1)[0] !== "application/json") denied();
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 65_536)) denied();
  const reader = request.body.getReader();
  const buffer = new Uint8Array(65_536);
  let count = 0, stopped = false;
  const stop = () => { stopped = true; void reader.cancel().catch(() => undefined); };
  const timer = setTimeout(stop, 5_000);
  request.signal.addEventListener("abort", stop, { once: true });
  if (request.signal.aborted) stop();
  try {
    for (;;) {
      const next = await reader.read();
      if (stopped) denied();
      if (next.done) break;
      if (count + next.value.byteLength > buffer.length) denied();
      buffer.set(next.value, count); count += next.value.byteLength;
    }
    return buffer.slice(0, count);
  } finally {
    clearTimeout(timer); request.signal.removeEventListener("abort", stop);
    buffer.fill(0); void reader.cancel().catch(() => undefined); reader.releaseLock();
  }
}
