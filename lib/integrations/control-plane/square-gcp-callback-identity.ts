import "server-only";

import { isProxy } from "node:util/types";
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from "jose";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";
import { checkedSquareGcpCallbackBinding, type SquareGcpCallbackBinding } from "./square-gcp-callback-contracts";

export const SQUARE_GCP_GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const SQUARE_GCP_METADATA_ROOT = "http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/";
const DENIED = "square_gcp_callback_identity_denied";
const STEP_MS = 5_000, SESSION_MS = 60_000, MAX_REQUESTS = 32, MAX_CHUNKS = 4_096;
function deny(): never { throw new Error(DENIED); }

/** Dependency records are trusted server composition, never decoded grants.
 * Inspect descriptors before reading them, including optional test clocks. */
export function squareGcpCallbackDependencies(input: unknown, keys: readonly string[], optional: readonly string[] = []) {
  if (!input || typeof input !== "object" || isProxy(input) || Object.getPrototypeOf(input) !== Object.prototype) return deny();
  const properties = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(properties).some(key => typeof key !== "string" || ![...keys, ...optional].includes(key)) ||
    keys.some(key => !Object.hasOwn(properties, key)) || Object.values(properties).some(item => !item.enumerable || !("value" in item))) return deny();
  return Object.fromEntries(Object.entries(properties).map(([key, property]) => [key, property.value])) as Record<string, unknown>;
}

/** Small bounded transport reused by the two GCP adapters, not a deployed HTTP
 * endpoint. No ambient network/credentials, logging, retries or token cache.
 * One fixed collector + one current chunk/string may coexist; the byte cap is
 * not a claim about total heap. Zero-length/chunk-flood replies are bounded too. */
export function createSquareGcpCallbackIo(input: Readonly<{ network: typeof fetch; signal: AbortSignal; clock?: () => number }>) {
  const args = squareGcpCallbackDependencies(input, ["network", "signal"], ["clock"]);
  const network = args.network as typeof fetch, signal = args.signal as AbortSignal;
  const clock = (args.clock ?? Date.now) as () => number;
  if (typeof network !== "function" || isProxy(network) || typeof clock !== "function" || isProxy(clock) ||
    !(signal instanceof AbortSignal) || signal.aborted) return deny();
  const initial = clock();
  if (!Number.isSafeInteger(initial)) return deny();
  const deadline = initial + SESSION_MS;
  const controller = new AbortController();
  let disposed = false, active = false, requests = 0;
  let rejectActive: (() => void) | undefined;
  const dispose = () => { disposed = true; controller.abort(); rejectActive?.(); signal.removeEventListener("abort", dispose); };
  signal.addEventListener("abort", dispose, { once: true });
  const check = () => {
    const now = clock();
    if (disposed || signal.aborted || controller.signal.aborted || !Number.isSafeInteger(now) || now < initial || now >= deadline) return deny();
  };
  async function wait<T>(start: () => PromiseLike<T>, late?: (value: T) => void): Promise<T> {
    check();
    if (active) return deny();
    active = true;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const cleanup = () => { clearTimeout(timer); rejectActive = undefined; active = false; };
      const fail = () => {
        if (settled) return;
        settled = true; cleanup(); dispose(); reject(new Error(DENIED));
      };
      const timer = setTimeout(fail, Math.max(1, Math.min(STEP_MS, deadline - clock())));
      rejectActive = fail;
      const cleanLate = (value: T) => { try { late?.(value); } catch { /* No dependency error escapes. */ } };
      let pending: PromiseLike<T>;
      try { pending = start(); } catch { fail(); return; }
      Promise.resolve(pending).then(value => {
        if (settled) { cleanLate(value); return; }
        settled = true; cleanup();
        try { check(); resolve(value); } catch { cleanLate(value); dispose(); reject(new Error(DENIED)); }
      }, fail);
    });
  }
  const cancel = (response: Response) => { void response.body?.cancel().catch(() => undefined); };
  async function text(url: string, init: RequestInit, maximumBytes: number, metadata = false) {
    check();
    if (++requests > MAX_REQUESTS || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 262_144) return deny();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const bytes = new Uint8Array(maximumBytes);
    try {
      const response = await wait(() => network(url, { ...init, redirect: "error", cache: "no-store", credentials: "omit", signal: controller.signal }), cancel);
      if (response.status !== 200 || response.redirected || response.url && response.url !== url || !response.body ||
        metadata && response.headers.get("metadata-flavor") !== "Google") { cancel(response); return deny(); }
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^[0-9]{1,9}$/.test(declared) || Number(declared) > maximumBytes)) { cancel(response); return deny(); }
      reader = response.body.getReader();
      let length = 0, chunks = 0;
      while (true) {
        if (++chunks > MAX_CHUNKS) return deny();
        const part = await wait(() => reader!.read());
        if (part.done) break;
        if (!(part.value instanceof Uint8Array) || part.value.byteLength > maximumBytes - length) return deny();
        bytes.set(part.value, length); length += part.value.byteLength;
      }
      check();
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    } catch { dispose(); return deny(); }
    finally {
      bytes.fill(0);
      if (reader) {
        void reader.cancel().catch(() => undefined);
        try { reader.releaseLock(); } catch { /* A cancelled pending read owns release. */ }
      }
    }
  }
  async function json(url: string, init: RequestInit, maximumBytes: number, metadata = false): Promise<Record<string, unknown>> {
    try {
      const parsed = JSON.parse(await text(url, init, maximumBytes, metadata));
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object" || Object.getPrototypeOf(parsed) !== Object.prototype) return deny();
      return parsed;
    } catch { dispose(); return deny(); }
  }
  return Object.freeze({ text, json, wait, check, dispose });
}

/** Pure post-signature checks, also exercised with synthetic signed tokens.
 * Full Compute payload contract: cloud.google.com/compute/docs/instances/verifying-instance-identity.
 * This does NOT establish signature authority by itself. */
export function assertSquareGcpCallbackIdentityClaims(binding: SquareGcpCallbackBinding, raw: JWTPayload, now = Date.now()) {
  try {
    const expected = checkedSquareGcpCallbackBinding(binding, now);
    const payload = snapshotSquareDurableJson(raw, { containers: 8, values: 64, bytes: 16_384, depth: 4,
      arrayLength: 16, properties: 24, stringLength: 2_048 }) as JWTPayload;
    const google = payload.google as { compute_engine?: Record<string, unknown> } | undefined;
    const compute = google?.compute_engine;
    const seconds = Math.floor(now / 1_000);
    if (payload.iss !== "https://accounts.google.com" || payload.aud !== expected.identityAudience ||
      payload.sub !== expected.serviceAccountSubject || payload.azp !== expected.serviceAccountSubject ||
      payload.email !== expected.serviceAccountEmail || payload.email_verified !== true ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
      payload.iat! > seconds || payload.exp! <= seconds || payload.exp! <= payload.iat! || payload.exp! - payload.iat! > 3_600 ||
      !compute || compute.project_id !== expected.gcpProjectId ||
      !(typeof compute.project_number === "number" && Number.isSafeInteger(compute.project_number) && compute.project_number > 0) ||
      String(compute.project_number) !== expected.gcpProjectNumber || compute.zone !== expected.gcpZone ||
      compute.instance_id !== expected.gcpInstanceId || compute.instance_name !== expected.gcpInstanceName ||
      !Number.isSafeInteger(compute.instance_creation_timestamp) || (compute.instance_creation_timestamp as number) <= 0 ||
      (compute.instance_creation_timestamp as number) > payload.iat!) return deny();
  } catch { return deny(); }
}

export type SquareGcpCallbackIdentity = Readonly<{
  verify(): Promise<void>;
  withAccessToken<T>(use: (accessToken: string) => Promise<T>): Promise<T>;
  dispose(): void;
}>;

/** Inert until verify()/withAccessToken() is explicitly called by the new host.
 * Every use obtains a full Google-signed identity, from the fixed metadata path,
 * and verifies only a bounded JWKS from Google's pinned public key URL. JWT
 * jku/x5u/iss never choose a key source. Native metadata tokens only: no ADC,
 * CLI, key file, environment-token, WIF or impersonation fallback. */
export function createSquareGcpCallbackIdentity(input: Readonly<{
  binding: SquareGcpCallbackBinding; network: typeof fetch; signal: AbortSignal; clock?: () => number;
}>): SquareGcpCallbackIdentity {
  const args = squareGcpCallbackDependencies(input, ["binding", "network", "signal"], ["clock"]);
  const clock = (args.clock ?? Date.now) as () => number;
  if (typeof clock !== "function" || isProxy(clock)) return deny();
  const binding = checkedSquareGcpCallbackBinding(args.binding, clock());
  const io = createSquareGcpCallbackIo({ network: args.network as typeof fetch, signal: args.signal as AbortSignal, clock });
  let busy = false;
  const metadataHeaders = Object.freeze({ "Metadata-Flavor": "Google" });
  const identityUrl = `${SQUARE_GCP_METADATA_ROOT}identity?audience=${encodeURIComponent(binding.identityAudience)}&format=full&licenses=FALSE`;

  async function verify() {
    io.check(); checkedSquareGcpCallbackBinding(binding, clock());
    const encoded = await io.text(identityUrl, { method: "GET", headers: metadataHeaders }, 16_384, true);
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(encoded)) return deny();
    const header = decodeProtectedHeader(encoded);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(header.kid) ||
      Object.keys(header).some(key => !["alg", "kid", "typ"].includes(key)) || header.typ !== undefined && header.typ !== "JWT") return deny();
    const jwks = await io.json(SQUARE_GCP_GOOGLE_JWKS_URL, { method: "GET" }, 65_536);
    if (Object.keys(jwks).join() !== "keys" || !Array.isArray(jwks.keys) || jwks.keys.length < 1 || jwks.keys.length > 16) return deny();
    const ids = new Set<string>();
    for (const key of jwks.keys) {
      if (!key || typeof key !== "object" || Array.isArray(key) || key.kty !== "RSA" || key.alg !== "RS256" || key.use !== "sig" ||
        typeof key.kid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(key.kid) || ids.has(key.kid) ||
        typeof key.n !== "string" || !/^[A-Za-z0-9_-]{342,1024}$/.test(key.n) ||
        typeof key.e !== "string" || !/^[A-Za-z0-9_-]{1,12}$/.test(key.e) ||
        Object.keys(key).some(name => !["kty", "alg", "use", "kid", "n", "e"].includes(name))) return deny();
      ids.add(key.kid);
    }
    const keys = jwks.keys;
    const verified = await io.wait(() => jwtVerify(encoded, createLocalJWKSet({ keys }), {
      algorithms: ["RS256"], issuer: "https://accounts.google.com", audience: binding.identityAudience,
      subject: binding.serviceAccountSubject, requiredClaims: ["iat", "exp", "aud", "iss", "sub", "azp", "email", "email_verified", "google"],
      clockTolerance: 0, maxTokenAge: "1 hour", currentDate: new Date(clock())
    }));
    assertSquareGcpCallbackIdentityClaims(binding, verified.payload, clock());
    io.check();
  }
  async function run<T>(work: () => Promise<T>) {
    io.check();
    if (busy) { io.dispose(); return deny(); }
    busy = true;
    try { return await work(); } catch { io.dispose(); return deny(); } finally { busy = false; }
  }
  return Object.freeze({
    verify: () => run(verify),
    withAccessToken: <T>(use: (accessToken: string) => Promise<T>) => run(async () => {
      if (typeof use !== "function" || isProxy(use)) return deny();
      await verify();
      const reply = await io.json(`${SQUARE_GCP_METADATA_ROOT}token`, { method: "GET", headers: metadataHeaders }, 32_768, true);
      if (Object.keys(reply).sort().join() !== "access_token,expires_in,token_type" || reply.token_type !== "Bearer" ||
        typeof reply.access_token !== "string" || !/^[\x21-\x7e]{1,16384}$/.test(reply.access_token) ||
        !Number.isSafeInteger(reply.expires_in) || (reply.expires_in as number) <= 0 || (reply.expires_in as number) > 3_600) return deny();
      let access = reply.access_token;
      const expiresAt = clock() + (reply.expires_in as number) * 1_000;
      delete reply.access_token;
      try {
        io.check();
        const result = await io.wait(() => use(access));
        if (clock() >= expiresAt) return deny();
        await verify();
        return result;
      } finally { access = ""; }
    }),
    dispose: io.dispose
  });
}
