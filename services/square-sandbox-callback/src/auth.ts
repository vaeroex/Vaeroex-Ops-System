import "server-only";

import { createClient } from "@supabase/supabase-js";
import { SquareConnectionActorSchema, type SquareConnectionActor } from "@/lib/integrations/providers/square/account-connection-contracts";
import type { SquareGcpCallbackBinding } from "@/lib/integrations/control-plane/square-gcp-callback-contracts";
import { SQUARE_REMOTE_SANDBOX } from "@/lib/integrations/control-plane/square-remote-sandbox-contracts";
import { createSquareGcpCallbackIo } from "@/lib/integrations/control-plane/square-gcp-callback-identity";

export const SESSION_COOKIE = "__Host-vaeroex-square-session";
const AUTH_ORIGIN = `https://${SQUARE_REMOTE_SANDBOX.projectRef}.supabase.co`;
function denied(): never { throw new Error("square_portal_auth_denied"); }

/** The only persistent browser authentication material is a host-only HttpOnly
 * session cookie. No refresh token, browser SDK/storage, magic link, invite or
 * URL session exists. Session expiry requires a fresh operator sign-in. */
export function createSquarePortalAuth(input: Readonly<{
  binding: SquareGcpCallbackBinding; publishableKey: string; network: typeof fetch; signal: AbortSignal;
}>) {
  const allowed = new Set(["POST /auth/v1/token?grant_type=password", "GET /auth/v1/user",
    "GET /auth/v1/.well-known/jwks.json", "POST /auth/v1/logout?scope=local"]);
  const boundedFetch: typeof fetch = async (resource, options) => {
    let io: ReturnType<typeof createSquareGcpCallbackIo> | undefined;
    try {
      const url = new URL(typeof resource === "string" ? resource : resource instanceof URL ? resource.href : resource.url);
      const method = options?.method ?? "GET";
      if (url.origin !== AUTH_ORIGIN || url.username || url.password || url.hash ||
        !allowed.has(`${method} ${url.pathname}${url.search}`) || input.signal.aborted) denied();
      const abort = AbortSignal.any([input.signal, AbortSignal.timeout(5_000)]);
      io = createSquareGcpCallbackIo({ network: input.network, signal: abort });
      const response = await io.wait(() => input.network(url.href, { ...options, signal: abort,
        redirect: "manual", cache: "no-store", credentials: "omit" }), late => { void late.body?.cancel().catch(() => undefined); });
      if (!response.ok || response.redirected || response.url && response.url !== url.href) {
        void response.body?.cancel().catch(() => undefined); denied();
      }
      const reader = response.body?.getReader(), buffer = new Uint8Array(131_072);
      let size = 0, chunks = 0;
      try {
        if (reader) for (;;) {
          if (++chunks > 4_096) denied();
          const part = await io.wait(() => reader.read());
          if (abort.aborted) denied();
          if (part.done) break;
          if (size + part.value.length > buffer.length) denied();
          buffer.set(part.value, size); size += part.value.length;
        }
        return new Response(response.status === 204 ? null : buffer.slice(0, size), {
          status: response.status, headers: { "content-type": "application/json" }
        });
      } finally { buffer.fill(0); void reader?.cancel().catch(() => undefined); reader?.releaseLock(); }
    } catch {
      // The pinned SDK prints rejected fetch errors. Return a fixed HTTP failure
      // instead: no provider error body, thrown transport error or stack reaches
      // that SDK logging path. No global console patch is used.
      return new Response('{"message":"Authentication unavailable"}', { status: 503, headers: { "content-type": "application/json" } });
    } finally { io?.dispose(); }
  };
  const client = createClient(AUTH_ORIGIN, input.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, debug: false },
    global: { fetch: boundedFetch }
  });
  const jwt = (value: string) => {
    // One cookie stays under the browser's 4096-byte bound, including attributes.
    if (value.length < 32 || value.length > 3_800 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) denied();
    return value;
  };
  async function authenticate(value: string): Promise<SquareConnectionActor | null> {
    try {
      jwt(value);
      const user = await client.auth.getUser(value);
      if (user.error || user.data.user?.id !== input.binding.operatorId) return null;
      const claims = await client.auth.getClaims(value);
      if (claims.error || claims.data?.claims.sub !== input.binding.operatorId ||
        claims.data.claims.iss !== AUTH_ORIGIN + "/auth/v1" || claims.data.claims.aud !== "authenticated" ||
        input.signal.aborted) return null;
      return Object.freeze(SquareConnectionActorSchema.parse({ actorId: input.binding.operatorId,
        workspaceId: input.binding.workspaceId, sessionId: claims.data.claims.session_id, role: input.binding.operatorRole }));
    } catch { return null; }
  }
  return Object.freeze({
    authenticate,
    async login(email: string, password: string) {
      try {
        if (!email || email.length > 254 || !password || password.length > 1_024) denied();
        const result = await client.auth.signInWithPassword({ email, password });
        const session = result.data.session;
        if (result.error || !session || !await authenticate(session.access_token)) denied();
        // The returned refresh token stays in this request's transient SDK object;
        // it is neither serialized nor retained by the runtime after disposal.
        return jwt(session.access_token);
      } catch { return denied(); }
    },
    async logout(value: string) {
      try {
        // Despite the SDK namespace, this endpoint uses only the user's own JWT,
        // not a service-role/admin secret, and revokes only this isolated session.
        const result = await client.auth.admin.signOut(jwt(value), "local");
        if (result.error || input.signal.aborted) denied();
      } catch { return denied(); }
    }
  });
}

export type SquarePortalAuth = ReturnType<typeof createSquarePortalAuth>;
