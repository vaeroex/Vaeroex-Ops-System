import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { SquareConnectionService } from "@/lib/integrations/providers/square/account-connection-contracts";
import { parseSquareOAuthCallback } from "@/lib/integrations/providers/square/account-connection-oauth";
import { SQUARE_REMOTE_SANDBOX } from "@/lib/integrations/control-plane/square-remote-sandbox-contracts";
import type { SquareGcpCallbackBinding } from "@/lib/integrations/control-plane/square-gcp-callback-contracts";
import { SESSION_COOKIE, type SquarePortalAuth } from "./auth";

export const PORTAL_PATH = "/app/settings/integrations/square";
export const CALLBACK_PATH = "/api/integrations/square/callback";
const CSRF_COOKIE = "__Host-vaeroex-square-csrf";
const origin = SQUARE_REMOTE_SANDBOX.applicationOrigin;
const actions = new Set(["login", "logout", "connect", "reauthorize", "disconnect", "map"]);
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const locationPattern = /^[A-Za-z0-9._:-]{1,32}$/;
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

// Ordinary form navigation under no-referrer sends Origin:null in Chromium.
// A fixed hash-pinned fetch preserves the real Origin and sends no Referer.
// No framework, third-party scripts, telemetry, storage, or dynamic error text.
export const PORTAL_SCRIPT = `document.addEventListener("submit",async function(event){event.preventDefault();const form=event.target;const button=form.querySelector("button");button.disabled=true;try{const response=await fetch(form.action,{method:"POST",body:new URLSearchParams(new FormData(form)),credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});if(!response.ok)throw 0;const result=await response.json();if(Object.keys(result).join(",")!=="navigate")throw 0;const next=new URL(result.navigate,location.origin);if(next.username||next.password||next.hash)throw 0;if(next.origin===location.origin){if(next.pathname!=="${PORTAL_PATH}"||next.search)throw 0;}else if(next.origin!=="${SQUARE_REMOTE_SANDBOX.providerOrigin}"||next.pathname!=="/oauth2/authorize")throw 0;location.replace(next.href);}catch{document.getElementById("notice").textContent="The request could not be completed. Reload the clean page and try again.";button.disabled=false;}});`;
const scriptHash = createHash("sha256").update(PORTAL_SCRIPT).digest("base64");
const style = "body{font:16px system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:1rem;color:#172033}label{display:block;margin:1rem 0}input,button{font:inherit;padding:.6rem}form,article{margin:1.4rem 0;padding:1rem;border:1px solid #ced4da}button{cursor:pointer}p{line-height:1.5}";
const styleHash = createHash("sha256").update(style).digest("base64");
export function portalHeaders(html = false) {
  return new Headers({
    "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff",
    "x-frame-options": "DENY", "cross-origin-opener-policy": "same-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
    "strict-transport-security": "max-age=31536000",
    "content-security-policy": `default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; connect-src 'self'; script-src 'sha256-${scriptHash}'; style-src 'sha256-${styleHash}'`,
    "content-type": html ? "text/html; charset=utf-8" : "application/json"
  });
}
function cookie(name: string, value: string, clear = false) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax${clear ? "; Max-Age=0" : ""}`;
}
function cookies(request: Request) {
  const raw = request.headers.get("cookie") ?? "";
  if (raw.length > 8_192) throw new Error("denied");
  const result = new Map<string, string>();
  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim(), value = part.slice(index + 1).trim();
    if (name !== SESSION_COOKIE && name !== CSRF_COOKIE) continue;
    if (result.has(name)) throw new Error("denied");
    result.set(name, value);
  }
  return result;
}
function response(body: string | null, status: number, headers = portalHeaders()) { return new Response(body, { status, headers }); }
export function portalUnavailable(status = 404) { return response('{"error":"unavailable"}', status); }
function clean(headers = portalHeaders()) { headers.set("location", PORTAL_PATH); return response(null, 303, headers); }
function navigate(headers = portalHeaders(), target = PORTAL_PATH) { return response(JSON.stringify({ navigate: target }), 200, headers); }
function form(action: string, csrf: string, content: string) {
  return `<form method="post" action="/actions/${action}"><input type="hidden" name="csrf" value="${csrf}">${content}</form>`;
}
function page(content: string, headers: Headers) {
  return response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Vaeroex Square Sandbox</title><style>${style}</style></head><body><main><h1>Vaeroex Square Sandbox</h1><p>Isolated connection qualification. Production and QBO are not connected here.</p><p id="notice" role="status"></p>${content}<noscript>JavaScript is required for privacy-preserving portal actions.</noscript></main><script>${PORTAL_SCRIPT}</script></body></html>`, 200, headers);
}
async function fields(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0] !== "application/x-www-form-urlencoded" || !request.body) throw new Error("denied");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 8_192)) throw new Error("denied");
  const buffer = new Uint8Array(8_192), reader = request.body.getReader();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5_000)]);
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  let count = 0, chunks = 0;
  try {
    for (;;) {
      if (++chunks > 16_384) throw new Error("denied");
      const part = await reader.read();
      if (signal.aborted) throw new Error("denied");
      if (part.done) break;
      if (count + part.value.length > buffer.length) throw new Error("denied");
      buffer.set(part.value, count); count += part.value.length;
    }
    const result = new URLSearchParams(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count)));
    for (const key of result.keys()) if (result.getAll(key).length !== 1) throw new Error("denied");
    return result;
  } finally { signal.removeEventListener("abort", abort); buffer.fill(0); void reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export type SquarePortalScope = Readonly<{
  binding: SquareGcpCallbackBinding; auth: SquarePortalAuth;
  service: Pick<SquareConnectionService, "initiate" | "complete" | "snapshot" | "disconnect">;
  // Installed only by the separately checked Sandbox mapping composition.
  // This callback confirms mapping, not enrollment or provider access.
  mapping?: Readonly<{ enabled: true; confirmMapping: SquareConnectionService["confirmMapping"] }>;
  close(): Promise<void>;
}>;

/** Pure request adapter. Production composition supplies the actual native host,
 * authenticated operator and checked broker; no caller-installed global runtime. */
export function createSquareSandboxPortal(input: Readonly<{
  open(signal: AbortSignal): Promise<SquarePortalScope>;
}>) {
  return async (request: Request) => {
    let scope: SquarePortalScope | undefined;
    const callback = request.method === "GET" && (request.url === origin + CALLBACK_PATH || request.url.startsWith(origin + CALLBACK_PATH + "?"));
    try {
      // Host headers, proxy forwarding and browser authority selectors are never trusted.
      if (request.url.length > 8_192 || request.headers.get("host") !== new URL(origin).host ||
        ["forwarded", "x-forwarded-host", "x-forwarded-proto", "x-original-url", "x-rewrite-url"].some(key => request.headers.has(key))) return callback ? clean() : portalUnavailable();
      const url = new URL(request.url);
      if (url.origin !== origin || url.username || url.password || url.hash) return portalUnavailable();
      if (!callback && url.search) return portalUnavailable();
      const jar = cookies(request);
      const session = jar.get(SESSION_COOKIE);
      if (url.pathname === "/" && request.method === "GET") return clean();
      if (request.method === "GET" && url.pathname === PORTAL_PATH) {
        const csrf = randomBytes(32).toString("base64url"), headers = portalHeaders(true);
        headers.append("set-cookie", cookie(CSRF_COOKIE, csrf));
        if (!session) return page(form("login", csrf, '<label>Sandbox operator email <input name="email" type="email" autocomplete="off" maxlength="254" required></label><label>Password <input name="password" type="password" autocomplete="off" maxlength="1024" required></label><button>Sign in</button>'), headers);
        scope = await input.open(request.signal);
        const actor = await scope.auth.authenticate(session);
        if (!actor) { headers.append("set-cookie", cookie(SESSION_COOKIE, "", true)); return clean(headers); }
        const view = await scope.service.snapshot(actor);
        if (!view.canManage) return portalUnavailable();
        let content = "<h2>Consent only</h2><p>Successful consent stops at authorized_unmapped. Location mapping, enrollment, refresh, webhooks, ingestion and economic contributions remain unavailable.</p>";
        if (scope.mapping?.enabled === true) content = "<h2>Sandbox location mapping</h2><p>Confirm one verified location for this business entity. Mapping does not start enrollment, ingestion or economic contributions.</p>";
        if (scope.binding.providerCallsEnabled) content += form("connect", csrf, "<button>Connect a Sandbox seller</button>");
        for (const connection of view.connections.filter(item => item.businessEntityId === scope!.binding.businessEntityId)) {
          if (!idPattern.test(connection.connectionId)) throw new Error("denied");
          const label = ({ mapping_required: "authorized_unmapped — consent verified; no mapping or ingestion",
            disconnected: "Locally disconnected — this connection is fenced; no provider-wide revocation was requested",
            revoked: "Provider revocation recorded", authorization_required: "Authorization required",
            reauthorization_required: "Reauthorization required", recovery_required: "Recovery required",
            disconnecting: "Disconnect in progress", authorized: "Existing authorization — enrollment is unavailable here" } as const)[connection.state];
          if (!label) throw new Error("denied");
          content += `<article><p>${label}</p>${scope.binding.providerCallsEnabled ? form("reauthorize", csrf, `<input type="hidden" name="connectionId" value="${connection.connectionId}"><button>Reauthorize this connection</button>`) : ""}${form("disconnect", csrf, `<input type="hidden" name="connectionId" value="${connection.connectionId}"><input type="hidden" name="confirmation" value="disconnect"><button>Disconnect this connection locally</button>`)}</article>`;
          if (scope.mapping?.enabled === true && connection.state === "mapping_required" && !connection.revocationPending) {
            if (new Set(connection.locations.map(location => location.id)).size !== connection.locations.length) throw new Error("denied");
            for (const location of connection.locations) {
              if (!locationPattern.test(location.id)) throw new Error("denied");
              content += form("map", csrf, `<p>Seller: ${escapeHtml(connection.sellerLabel ?? "Verified Sandbox seller")}</p><p>Location: ${escapeHtml(location.label)}</p><input type="hidden" name="connectionId" value="${connection.connectionId}"><input type="hidden" name="locationId" value="${location.id}"><input type="hidden" name="confirmation" value="map"><button>Confirm location mapping</button>`);
            }
          }
        }
        return page(content + form("logout", csrf, "<button>Sign out of this Sandbox session</button>"), headers);
      }
      if (callback) {
        // Reject malformed envelopes before IO. Neither the URL nor callback data
        // is put in a receipt, log, database, error message or clean redirect.
        const parsed = parseSquareOAuthCallback(request.url, origin + CALLBACK_PATH);
        if (!session) return clean();
        scope = await input.open(request.signal);
        const actor = await scope.auth.authenticate(session);
        if (!actor || !scope.binding.providerCallsEnabled) return clean();
        await scope.service.complete(actor, parsed.kind === "authorized"
          ? { state: parsed.state, code: parsed.authorizationCode } : { state: parsed.state, error: "access_denied" }, request.signal);
        return clean();
      }
      const action = url.pathname.startsWith("/actions/") ? url.pathname.slice(9) : "";
      if (request.method !== "POST" || !actions.has(action)) return portalUnavailable();
      if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") !== "same-origin") return portalUnavailable(403);
      const data = await fields(request), csrf = data.get("csrf") ?? "", expected = jar.get(CSRF_COOKIE) ?? "";
      if (!tokenPattern.test(csrf) || !tokenPattern.test(expected) || !timingSafeEqual(Buffer.from(csrf), Buffer.from(expected))) return portalUnavailable(403);
      const keys = action === "login" ? ["csrf", "email", "password"] : action === "reauthorize" ? ["csrf", "connectionId"]
        : action === "disconnect" ? ["csrf", "connectionId", "confirmation"] : action === "map" ? ["csrf", "connectionId", "locationId", "confirmation"] : ["csrf"];
      if ([...data.keys()].some(key => !keys.includes(key)) || keys.some(key => !data.has(key))) return portalUnavailable(400);
      scope = await input.open(request.signal);
      const headers = portalHeaders();
      if (action === "login") {
        const token = await scope.auth.login(data.get("email")!, data.get("password")!);
        headers.append("set-cookie", cookie(SESSION_COOKIE, token)); headers.append("set-cookie", cookie(CSRF_COOKIE, "", true));
        return navigate(headers);
      }
      const actor = session ? await scope.auth.authenticate(session) : null;
      if (!actor || !session) return portalUnavailable(403);
      if (action === "logout") {
        await scope.auth.logout(session);
        headers.append("set-cookie", cookie(SESSION_COOKIE, "", true)); headers.append("set-cookie", cookie(CSRF_COOKIE, "", true));
        return navigate(headers);
      }
      const connectionId = data.get("connectionId");
      if (connectionId !== null && !idPattern.test(connectionId)) return portalUnavailable(400);
      if (action === "map") {
        if (scope.mapping?.enabled !== true) return portalUnavailable();
        const locationId = data.get("locationId")!;
        if (data.get("confirmation") !== "map" || !locationPattern.test(locationId)) return portalUnavailable(400);
        // Re-read authority and discovery on this invocation; never trust a
        // hidden form field, earlier GET or browser-provided entity selector.
        const view = await scope.service.snapshot(actor);
        const matches = view.connections.filter(connection => connection.connectionId === connectionId && connection.businessEntityId === scope!.binding.businessEntityId);
        const connection = matches[0];
        if (!view.canManage || matches.length !== 1 || connection.state !== "mapping_required" || connection.revocationPending ||
          new Set(connection.locations.map(location => location.id)).size !== connection.locations.length ||
          !connection.locations.some(location => location.id === locationId)) return portalUnavailable(403);
        await scope.mapping.confirmMapping(actor, { connectionId: connectionId!, businessEntityId: scope.binding.businessEntityId, locationIds: [locationId], confirmation: "map" });
        return navigate();
      }
      if (action === "disconnect") {
        if (data.get("confirmation") !== "disconnect") return portalUnavailable(400);
        await scope.service.disconnect(actor, { connectionId: connectionId!, confirmation: "disconnect" }, request.signal);
        return navigate();
      }
      if (!scope.binding.providerCallsEnabled) return portalUnavailable();
      const result = await scope.service.initiate(actor, { operation: action === "connect" ? "connect" : "reauthorize",
        businessEntityId: scope.binding.businessEntityId, ...(connectionId ? { connectionId } : {}) }, request.signal);
      const target = new URL(result.authorizationUrl);
      if (target.origin !== SQUARE_REMOTE_SANDBOX.providerOrigin || target.pathname !== "/oauth2/authorize" || target.username || target.password || target.hash) throw new Error("denied");
      return navigate(headers, target.href);
    } catch { return callback ? clean() : portalUnavailable(400); }
    finally { await scope?.close().catch(() => undefined); }
  };
}
