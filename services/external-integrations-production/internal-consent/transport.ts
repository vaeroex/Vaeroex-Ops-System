import "server-only";
import { SQUARE_OAUTH_API_VERSION, type SquareOAuthTransport } from "@/lib/integrations/providers/square/account-connection-oauth";

/** The existing provider parser owns token/schema/size semantics. This concrete
 * transport restricts the network to the five consent/discovery endpoints;
 * redirects, refresh grants, revocation and business-data writes are absent. */
export function createInternalConsentTransport(input: {
  applicationId: string; authorize(): Promise<void>; network?: typeof fetch;
}): SquareOAuthTransport {
  return async request => {
    try {
      const url = new URL(request.url);
      const discovery = ["/v2/merchants/me", "/v2/locations", "/v2/locations/main"].includes(url.pathname);
      if (url.origin !== "https://connect.squareup.com" || url.username || url.password || url.search || url.hash ||
        (!discovery && !["/oauth2/token", "/oauth2/token/status"].includes(url.pathname)) ||
        request.method !== (discovery ? "GET" : "POST") ||
        request.maximumResponseBytes !== (discovery ? 16 * 1_024 * 1_024 : 65_536) ||
        request.headers["Square-Version"] !== SQUARE_OAUTH_API_VERSION ||
        request.headers["Content-Type"] !== "application/json" ||
        Object.keys(request.headers).some(key => !["Square-Version", "Content-Type", "Authorization"].includes(key))) throw new Error("request");
      if (url.pathname === "/oauth2/token") {
        if (typeof request.body !== "string" || request.body.length > 65_536) throw new Error("body");
        const body = JSON.parse(request.body);
        if (body.client_id !== input.applicationId || body.grant_type !== "authorization_code" || body.short_lived !== true ||
          body.redirect_uri !== "https://square.vaeroex.com/api/integrations/square/callback") throw new Error("body");
      } else if (request.body !== null) throw new Error("body");
      if (request.signal.aborted) throw new Error("abort");
      await input.authorize();
      if (request.signal.aborted) throw new Error("abort");
      const response = await (input.network ?? fetch)(request.url, { method: request.method, body: request.body,
        headers: request.headers, signal: request.signal, redirect: "manual", cache: "no-store", credentials: "omit" });
      if (response.redirected || response.status >= 300 && response.status < 400 || !response.body) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error("response");
      }
      const reader = response.body.getReader();
      let bytes = 0, closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", aborted);
        try { await reader.cancel(); } catch { /* No provider diagnostics. */ }
        try { reader.releaseLock(); } catch { /* An in-flight read settles on cancellation. */ }
      };
      const aborted = () => { void close(); };
      request.signal.addEventListener("abort", aborted, { once: true });
      if (request.signal.aborted) { await close(); throw new Error("abort"); }
      async function* body() {
        try {
          for (;;) {
            if (closed || request.signal.aborted) throw new Error("square_internal_transport_denied");
            const next = await reader.read();
            if (request.signal.aborted) throw new Error("square_internal_transport_denied");
            if (next.done) return;
            bytes += next.value.byteLength;
            if (bytes > request.maximumResponseBytes) throw new Error("square_internal_transport_denied");
            yield next.value;
          }
        } finally { await close(); }
      }
      return { status: response.status, body: body(), close };
    } catch { throw new Error("square_internal_transport_denied"); }
  };
}
