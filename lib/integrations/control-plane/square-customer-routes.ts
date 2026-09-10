import { z } from "zod";
import squareHandoffPolicy from "@/lib/integrations/control-plane/square-customer-handoff-policy.json";
import {
  SquareConnectionActorSchema,
  SquareConnectionViewSchema,
  type SquareConnectionActor,
  type SquareConnectionService,
  type SquareConnectionView
} from "@/lib/integrations/providers/square/account-connection-contracts";
import { parseSquareOAuthCallback } from "@/lib/integrations/providers/square/account-connection-oauth";
import { SQUARE_REMOTE_SANDBOX } from "@/lib/integrations/control-plane/square-remote-sandbox-contracts";
import { SQUARE_OAUTH_SCOPES } from "@/lib/integrations/providers/square/account-connection-oauth";

export const SQUARE_CUSTOMER_SETTINGS_PATH = "/app/settings/integrations/square" as const;
export const SQUARE_CUSTOMER_API_PATH = "/api/integrations/square" as const;
export const SQUARE_CUSTOMER_CALLBACK_PATH = `${SQUARE_CUSTOMER_API_PATH}/callback` as const;
export const SQUARE_CUSTOMER_ACTIONS = ["connect", "callback", "mapping", "status", "reauthorize", "disconnect", "webhook"] as const;
export type SquareCustomerAction = (typeof SQUARE_CUSTOMER_ACTIONS)[number];

const managementRoles = new Set(["owner", "admin", "manager"]);
// Current ListLocations/mapping supports 500 IDs of 32 characters. Even if every
// character requires three-byte percent encoding, all fields fit in 54,620 bytes.
const bodyMaximumBytes = 64 * 1024;
const bodyMaximumChunks = 1024;
const bodyMaximumMilliseconds = 5_000;
const identifier = z.string().uuid();
const providerIdentifier = z.string().min(1).max(32).regex(/^[A-Za-z0-9._:-]+$/);
const ConnectSchema = z.object({ businessEntityId: identifier }).strict();
const ReauthorizeSchema = z.object({ businessEntityId: identifier, connectionId: identifier }).strict();
const MappingSchema = z.object({
  connectionId: identifier,
  businessEntityId: identifier,
  locationIds: z.array(providerIdentifier).min(1).max(500),
  confirmation: z.literal("map")
}).strict().refine((value) => new Set(value.locationIds).size === value.locationIds.length);
const DisconnectSchema = z.object({ connectionId: identifier, confirmation: z.literal("disconnect") }).strict();

/** These are host capabilities, never values deserialized from an HTTP request. */
export type SquareLocalCustomerDependencies = Readonly<{
  qualification: "disposable_local_synthetic_only";
  applicationOrigin: string;
  authenticate(request: Request): Promise<SquareConnectionActor | null>;
  service: SquareConnectionService;
  /** Maps the exact logical OAuth URL to the local synthetic provider, without changing OAuth policy. */
  resolveAuthorizationNavigation(authorizationUrl: string): string;
  /** Bounded raw-body reader, signature verification and durable replay handling belong to the host. */
  notify?(request: Request): Promise<Response>;
}>;

export function squareLocalQualificationEnvironmentAllowed() {
  return process.env.NODE_ENV !== "production" &&
    ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_TARGET_ENV", "VERCEL_REGION"].every((key) => process.env[key] === undefined);
}

export function squareLocalQualificationOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash || value !== url.origin) {
    throw new Error("square_local_customer_configuration_invalid");
  }
  return url.origin;
}

const privateHeaders = {
  "content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "cross-origin-resource-policy": "same-origin",
  vary: "Cookie"
} as const;

export function squareCustomerConnectionsUnavailableResponse() {
  return Response.json({ ok: false, error: "Square connections are unavailable." }, { status: 404, headers: privateHeaders });
}

function failure(status = 400) {
  return Response.json({ ok: false, error: "Square connection request could not be completed." }, { status, headers: privateHeaders });
}

function attributeString(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Standalone documents never load the app layout, React, telemetry or third-party assets. */
function handoff(target: string, cleanPath: string, message: string) {
  // Only already-validated navigation and fixed clean paths enter inert data.
  // The executable bytes are shared with Next's fixed hash policy, never input.
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>Square connection</title></head><body><p id="square-handoff" data-target="${attributeString(target)}" data-clean-path="${attributeString(cleanPath)}">${message}</p><noscript>Enable JavaScript, then return to Square connection settings. Do not share this address.</noscript><script>${squareHandoffPolicy.script}</script></body></html>`, {
    status: 200,
    headers: { ...privateHeaders, "content-type": "text/html; charset=utf-8", "content-security-policy": squareHandoffPolicy.csp }
  });
}

async function boundedForm(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded" || !request.body) throw new Error("square_customer_body_invalid");
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > bodyMaximumBytes)) throw new Error("square_customer_body_invalid");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let interrupted = false;
  const cancel = () => { interrupted = true; void reader.cancel().catch(() => undefined); };
  const timer = setTimeout(cancel, bodyMaximumMilliseconds);
  request.signal.addEventListener("abort", cancel, { once: true });
  try {
    if (request.signal.aborted) cancel();
    for (;;) {
      const result = await reader.read();
      if (interrupted) throw new Error("square_customer_body_interrupted");
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > bodyMaximumBytes || chunks.length >= bodyMaximumChunks) throw new Error("square_customer_body_invalid");
      // Copy only the logical bytes, not a potentially much larger backing buffer.
      chunks.push(Uint8Array.from(result.value));
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(joined);
    let fieldCount = 1;
    for (const character of text) if (character === "&" && ++fieldCount > 1004) throw new Error("square_customer_body_invalid");
    // URLSearchParams otherwise replaces malformed UTF-8/percent sequences silently.
    for (const field of text.split("&")) {
      const split = field.indexOf("=");
      decodeURIComponent((split < 0 ? field : field.slice(0, split)).replace(/\+/g, " "));
      if (split >= 0) decodeURIComponent(field.slice(split + 1).replace(/\+/g, " "));
    }
    const form = new URLSearchParams(text);
    const record: Record<string, string | string[]> = Object.create(null);
    let entries = 0;
    for (const [key, value] of form) {
      if (++entries > 1004) throw new Error("square_customer_body_invalid");
      if (key === "locationIds") {
        const locations = (record[key] ??= []) as string[];
        locations.push(value);
      } else {
        if (Object.hasOwn(record, key)) throw new Error("square_customer_duplicate_field");
        record[key] = value;
      }
    }
    return record;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", cancel);
    chunks.length = 0;
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function callbackInput(url: URL, expectedRedirect?: string) {
  // The local fixture URL has already matched the exact host/path gate. Reuse
  // the authoritative Square query parser without relaxing its HTTPS policy.
  // Actual application/redirect binding is checked again by consumed state.
  const logicalCallback = expectedRedirect ?? `https://square-callback.synthetic.invalid${SQUARE_CUSTOMER_CALLBACK_PATH}`;
  const result = parseSquareOAuthCallback(logicalCallback + url.search, logicalCallback);
  return result.kind === "authorized"
    ? { state: result.state, code: result.authorizationCode }
    : { state: result.state, error: "access_denied" as const };
}

export function createSquareCustomerHandlers(dependencies: SquareLocalCustomerDependencies) {
  if (dependencies.qualification !== "disposable_local_synthetic_only" || !squareLocalQualificationEnvironmentAllowed()) throw new Error("square_local_customer_configuration_invalid");
  const origin = squareLocalQualificationOrigin(dependencies.applicationOrigin);
  return customerHandlers({ ...dependencies, origin,
    enabled: request => squareLocalQualificationEnvironmentAllowed() && new URL(request.url).origin === origin,
    authorizationNavigation(authorizationUrl) {
      const navigation = new URL(dependencies.resolveAuthorizationNavigation(authorizationUrl));
      if (navigation.origin !== origin || navigation.pathname !== "/__square_synthetic_provider/authorize" || navigation.username || navigation.password || navigation.hash) throw new Error("square_customer_navigation_denied");
      return navigation.toString();
    }, openingMessage: "Opening the local Square authorization fixture."
  });
}

/** Only the server's checked remote binding supplies these capabilities. A flag,
 * host, request header or serialized binding cannot install a remote handler. */
export function createSquareRemoteSandboxCustomerHandlers(dependencies: Readonly<{
  authenticate(request: Request): Promise<SquareConnectionActor | null>;
  service: SquareConnectionService;
  enabled(request: Request): Promise<boolean>;
  notify(request: Request): Promise<Response>;
}>) {
  return customerHandlers({ ...dependencies, origin: SQUARE_REMOTE_SANDBOX.applicationOrigin,
    expectedRedirect: SQUARE_REMOTE_SANDBOX.applicationOrigin + SQUARE_CUSTOMER_CALLBACK_PATH,
    authorizationNavigation(authorizationUrl) {
      const navigation = new URL(authorizationUrl);
      const entries = [...navigation.searchParams.keys()];
      const keys = ["client_id", "redirect_uri", "scope", "state", "session"];
      if (navigation.origin !== SQUARE_REMOTE_SANDBOX.providerOrigin || navigation.pathname !== "/oauth2/authorize" ||
        navigation.username || navigation.password || navigation.hash || entries.length !== keys.length ||
        keys.some(key => navigation.searchParams.getAll(key).length !== 1) ||
        navigation.searchParams.get("client_id") !== SQUARE_REMOTE_SANDBOX.applicationId ||
        navigation.searchParams.get("redirect_uri") !== SQUARE_REMOTE_SANDBOX.applicationOrigin + SQUARE_CUSTOMER_CALLBACK_PATH ||
        navigation.searchParams.get("scope") !== SQUARE_OAUTH_SCOPES.join(" ") ||
        !/^[A-Za-z0-9_-]{43}$/.test(navigation.searchParams.get("state") ?? "") ||
        navigation.searchParams.get("session") !== "true") throw new Error("square_customer_navigation_denied");
      return navigation.toString();
    }, openingMessage: "Opening Square Sandbox authorization."
  });
}

function customerHandlers(dependencies: Readonly<{
  origin: string;
  authenticate(request: Request): Promise<SquareConnectionActor | null>;
  service: SquareConnectionService;
  enabled(request: Request): boolean | Promise<boolean>;
  authorizationNavigation(authorizationUrl: string): string;
  expectedRedirect?: string;
  openingMessage: string;
  notify?(request: Request): Promise<Response>;
}>) {
  const origin = dependencies.origin;
  const authenticate = dependencies.authenticate;
  const service = dependencies.service;
  const notify = dependencies.notify;
  const enabled = async (request: Request) => {
    try { return await dependencies.enabled(request); } catch { return false; }
  };
  const actorFor = async (request: Request) => {
    const actor = SquareConnectionActorSchema.parse(await authenticate(request));
    return Object.freeze(actor);
  };
  const viewFor = async (actor: SquareConnectionActor): Promise<SquareConnectionView> => {
    const view = SquareConnectionViewSchema.parse(await service.snapshot(actor));
    return { ...view, canManage: view.canManage && managementRoles.has(actor.role) };
  };
  return Object.freeze({
    async view(request: Request) {
      if (!await enabled(request)) return null;
      return viewFor(await actorFor(request));
    },
    async handle(action: SquareCustomerAction, request: Request): Promise<Response> {
      // No authentication, parsing, provider call or configuration lookup precedes the closed gate.
      if (!await enabled(request)) return squareCustomerConnectionsUnavailableResponse();
      const url = new URL(request.url);
      if (url.pathname !== `${SQUARE_CUSTOMER_API_PATH}/${action}` || url.hash ||
        request.method !== (action === "callback" || action === "status" ? "GET" : "POST")) return failure();
      if (action === "webhook") {
        if (!notify) return squareCustomerConnectionsUnavailableResponse();
        if (url.search) return failure();
        try {
          // Do not decode/re-serialize the signed bytes or use customer cookies/CSRF.
          const result = await notify(request);
          const status = [200, 202, 204, 400, 401, 403, 409, 429, 503].includes(result.status) ? result.status : 400;
          // A provider acknowledgment never reflects a host/provider response body or headers.
          return new Response(null, { status, headers: privateHeaders });
        } catch { return failure(); }
      }
      if (action === "callback") {
        // A genuine OAuth top-level GET is cross-site and usually has no Origin header.
        try {
          const input = callbackInput(url, dependencies.expectedRedirect);
          const actor = await actorFor(request);
          if (!managementRoles.has(actor.role)) throw new Error("square_customer_actor_denied");
          await service.complete(actor, input, request.signal);
        } catch {
          // A fixed handoff avoids leaking a code, state, authentication redirect or provider failure.
        }
        return handoff(SQUARE_CUSTOMER_SETTINGS_PATH, SQUARE_CUSTOMER_CALLBACK_PATH, "Returning to Square connection settings.");
      }
      try {
        if (url.search) return failure();
        const actor = await actorFor(request);
        if (action === "status") return Response.json({ ok: true, view: await viewFor(actor) }, { headers: privateHeaders });
        if (!managementRoles.has(actor.role)) return failure(403);
        if (request.headers.get("origin") !== origin ||
          (request.headers.has("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin")) return failure(403);
        const input = await boundedForm(request);
        if (action === "connect" || action === "reauthorize") {
          const checked = action === "connect" ? ConnectSchema.parse(input) : ReauthorizeSchema.parse(input);
          const result = await service.initiate(actor, { ...checked, operation: action === "connect" ? "connect" : "reauthorize" }, request.signal);
          const navigation = dependencies.authorizationNavigation(result.authorizationUrl);
          return handoff(navigation, SQUARE_CUSTOMER_SETTINGS_PATH, dependencies.openingMessage);
        }
        if (action === "mapping") await service.confirmMapping(actor, MappingSchema.parse(input));
        else await service.disconnect(actor, DisconnectSchema.parse(input), request.signal);
        return new Response(null, { status: 303, headers: { ...privateHeaders, location: SQUARE_CUSTOMER_SETTINGS_PATH } });
      } catch {
        return failure();
      }
    }
  });
}

export type SquareCustomerHandlers = ReturnType<typeof createSquareCustomerHandlers>;
