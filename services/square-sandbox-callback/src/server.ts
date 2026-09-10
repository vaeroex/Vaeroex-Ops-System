import "server-only";

import { createHash, createPrivateKey, X509Certificate } from "node:crypto";
import { readFileSync, lstatSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer } from "node:https";
import { Readable } from "node:stream";
import { resolve } from "node:path";
import { SQUARE_REMOTE_SANDBOX } from "@/lib/integrations/control-plane/square-remote-sandbox-contracts";
import { checkedSquareGcpCallbackDatabaseCa } from "@/lib/integrations/control-plane/square-gcp-callback-database";
import { checkedPortalConfig, HostPolicySchema } from "./config";
import { checkNativeSquareSandboxPortalBinding, createNativeSquareSandboxPortal } from "./runtime";
import { CALLBACK_PATH, PORTAL_PATH, portalHeaders, portalUnavailable } from "./portal";

const configPath = "/etc/vaeroex-square-callback/config.json";
function denied(): never { throw new Error("square_portal_startup_denied"); }
function readLocal(path: string, maximum: number) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum || (stat.mode & 0o022) !== 0) denied();
  return readFileSync(path);
}
export function checkedPortalDatabaseCa(bytes: Buffer, expectedSha256: string) {
  try {
    if (!Buffer.isBuffer(bytes) || bytes.length > 16_384 || !/^[a-f0-9]{64}$/.test(expectedSha256) ||
      createHash("sha256").update(bytes).digest("hex") !== expectedSha256) denied();
    return checkedSquareGcpCallbackDatabaseCa(bytes.toString("utf8"));
  } catch { return denied(); }
}
function localEnvironment() {
  // Never enable process diagnostics, SDK wire logging or telemetry via ambient
  // launch settings. Extra roots are loaded by Node before this function, so
  // reject the process before any config/credential/network access; deleting the
  // variable here would not undo that trust. systemd also unsets it before exec.
  // Values are not printed even when an environment is refused.
  for (const name of Object.keys(process.env)) if (/^(?:NODE_OPTIONS|NODE_DEBUG|NODE_V8_COVERAGE|NODE_EXTRA_CA_CERTS|NODE_TLS_REJECT_UNAUTHORIZED|NODE_USE_SYSTEM_CA|NODE_USE_ENV_PROXY|HTTP_PROXY|HTTPS_PROXY|http_proxy|https_proxy|OPENSSL_CONF|SSL_CERT_FILE|SSL_CERT_DIR|SQUARE_SANDBOX_DATABASE_CA_PEM|SSLKEYLOGFILE|DEBUG|OTEL_|SENTRY_|DD_|NEW_RELIC_|VERCEL|GOOGLE_APPLICATION_CREDENTIALS|GOOGLE_OAUTH_ACCESS_TOKEN|GCLOUD_KEYFILE_JSON)/.test(name) && process.env[name]) denied();
  // The reviewed unit has one exact Node argument, not alternate TLS/proxy,
  // preload, diagnostic or report switches supplied by the operator.
  if (process.execArgv.length !== 1 || process.execArgv[0] !== "--conditions=react-server") denied();
}

export function checkedPortalTls(cert: Buffer, key: Buffer, until: number, now = Date.now()) {
  try {
    const leaf = new X509Certificate(cert), privateKey = createPrivateKey(key);
    if (!Number.isSafeInteger(now) || !Number.isSafeInteger(until) || until <= now ||
      leaf.checkHost("square-sandbox.vaeroex.com", { subject: "never", wildcards: false }) !== "square-sandbox.vaeroex.com" ||
      Date.parse(leaf.validFrom) > now || Date.parse(leaf.validTo) <= until || !leaf.checkPrivateKey(privateKey)) denied();
    return { cert, key };
  } catch { return denied(); }
}

/** Native HTTPS only; no framework/router/proxy/access logger and no request
 * serialization on any failure. All entry/connection/parser errors are handled
 * without printing error objects, raw packets, URLs, headers, or bodies. */
export function nativePortalHandler(handle: (request: Request) => Promise<Response>) {
  let active = 0, tokens = 12, last = Date.now();
  return async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    const abort = () => { if (!outgoing.writableFinished) controller.abort(); };
    incoming.once("aborted", abort); outgoing.once("close", abort);
    let admitted = false;
    const isCallback = incoming.method === "GET" && incoming.url?.split("?", 1)[0] === CALLBACK_PATH;
    const safeFailure = () => {
      const headers = portalHeaders();
      if (isCallback) headers.set("location", PORTAL_PATH);
      return new Response(isCallback ? null : '{"error":"unavailable"}', { status: isCallback ? 303 : 503, headers });
    };
    try {
      let response: Response;
      const now = Date.now(); tokens = Math.min(12, tokens + Math.max(0, now - last) / 10_000); last = now;
      if (active >= 2 || tokens < 1) response = safeFailure();
      else {
        tokens--; active++; admitted = true;
        const raw = incoming.url ?? "";
        if (raw.length > 8_192 || !raw.startsWith("/") || raw.startsWith("//") || /[\u0000-\u0020\u007f\\]/.test(raw)) response = safeFailure();
        else {
          const headers = new Headers();
          for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
            const key = incoming.rawHeaders[index];
            if (headers.has(key) && ["host", "cookie", "origin", "content-length", "content-type", "sec-fetch-site"].includes(key.toLowerCase())) throw new Error();
            headers.append(key, incoming.rawHeaders[index + 1]);
          }
          const method = incoming.method ?? "GET";
          if (!["GET", "POST"].includes(method)) response = portalUnavailable();
          else {
            const request = new Request(SQUARE_REMOTE_SANDBOX.applicationOrigin + raw, {
              method, headers, signal: controller.signal,
              ...(method === "POST" ? { body: Readable.toWeb(incoming), duplex: "half" } : {})
            } as RequestInit);
            incoming.url = "";
            // No detached work: abort closes the broker and transport; wait for
            // settled cleanup before releasing this bounded concurrency slot.
            response = await handle(request);
            if (controller.signal.aborted) response = safeFailure();
          }
        }
      }
      if (!outgoing.destroyed) {
        const cookies = response.headers.getSetCookie();
        outgoing.writeHead(response.status, { ...Object.fromEntries(response.headers),
          ...(cookies.length ? { "set-cookie": cookies } : {}), connection: "close" });
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      }
    } catch {
      if (!outgoing.destroyed && !outgoing.headersSent) {
        const response = safeFailure(); outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end();
      } else outgoing.destroy();
    } finally {
      clearTimeout(timer); incoming.removeListener("aborted", abort); outgoing.removeListener("close", abort);
      controller.abort(); if (admitted) active--;
    }
  };
}

export async function runSquareSandboxPortalCommand() {
  const args = process.argv.slice(2);
  if (args.length !== 3 || !["--preflight", "--check-binding", "--serve"].includes(args[0]) || args[1] !== "--config" || args[2] !== configPath) denied();
  localEnvironment();
  const config = checkedPortalConfig(JSON.parse(readLocal(configPath, 32_768).toString()), args[0] !== "--preflight");
  // Both enabled preflight and serving validate public trust before metadata,
  // Secret Manager, database IO or listener creation. Disabled legacy configs
  // remain valid and never load a CA or regain an ambient trust override.
  let databaseCa: string | undefined;
  if (config.enabled) {
    if (!config.databaseCaPath || !config.databaseCaSha256 || lstatSync(config.databaseCaPath).uid !== 0) denied();
    databaseCa = checkedPortalDatabaseCa(readLocal(config.databaseCaPath, 16_384), config.databaseCaSha256);
  }
  if (args[0] === "--preflight") return;
  const now = Date.now(), policy = HostPolicySchema.parse(JSON.parse(readLocal(config.hostPolicyPath, 8_192).toString()));
  const expiry = Date.parse(policy.approvedUntil);
  if (expiry <= now || expiry > now + 31 * 86_400_000 || policy.nodeVersion !== process.version ||
    createHash("sha256").update(readLocal(process.argv[1], 64 * 1_024 * 1_024)).digest("hex") !== policy.artifactSha256 ||
    !config.binding || !config.supabasePublishableKey || !databaseCa) denied();
  const input = { binding: config.binding, publishableKey: config.supabasePublishableKey, databaseCa, network: fetch };
  if (args[0] === "--check-binding") {
    const remaining = expiry - Date.now();
    if (remaining <= 0) denied();
    const window = Math.min(30_000, remaining), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, window - 2_000));
    // This explicit, read-only operator process cannot depend on a peer sending
    // EOF during pg.end(). Abort first, then let OS process teardown close any
    // stalled socket/unfinished read transaction at the absolute deadline.
    // No normal portal request or callback cleanup behavior is changed here.
    const hardTimer = setTimeout(() => { controller.abort();process.exit(78); }, window);
    try {
      await checkNativeSquareSandboxPortalBinding(input, controller.signal);
      if (controller.signal.aborted || Date.now() >= expiry) denied();
    }
    catch {
      // An abort may already have started a detached close whose idempotent
      // second call returns before pg.end() settles. A rejected read-only probe
      // must terminate its process, not disarm the deadline and retain sockets.
      controller.abort();process.exit(78);
    }
    finally { clearTimeout(timer);clearTimeout(hardTimer);controller.abort(); }
    process.stdout.write("square_portal_binding_checked\n");
    return;
  }
  const portal = createNativeSquareSandboxPortal(input);
  const tls = checkedPortalTls(readLocal(config.tlsCertPath, 65_536), readLocal(config.tlsKeyPath, 65_536), Math.min(now + 3_600_000, expiry));
  const server = createServer({ ...tls,
    minVersion: "TLSv1.2", maxHeaderSize: 16_384, requestTimeout: 60_000, headersTimeout: 10_000 }, nativePortalHandler(portal));
  server.maxConnections = 16; server.keepAliveTimeout = 1_000; server.setTimeout(60_000, socket => socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy()); server.on("tlsClientError", () => undefined);
  server.on("error", () => stop());
  const acme = createHttpServer({ maxHeaderSize: 4_096, headersTimeout: 5_000, requestTimeout: 5_000 }, (req, res) => {
    try {
      if (req.method !== "GET" || req.headers.host !== "square-sandbox.vaeroex.com" ||
        !/^\/\.well-known\/acme-challenge\/[A-Za-z0-9_-]{1,128}$/.test(req.url ?? "")) throw new Error();
      const name = req.url!.slice(req.url!.lastIndexOf("/") + 1);
      const bytes = readLocal(resolve(config.challengeWebroot, ".well-known/acme-challenge", name), 4_096);
      res.writeHead(200, { "cache-control": "no-store", "referrer-policy": "no-referrer", "content-type": "text/plain" }); res.end(bytes);
    } catch { res.writeHead(404, { "cache-control": "no-store", "referrer-policy": "no-referrer" }); res.end(); }
  });
  acme.maxConnections = 8; acme.on("clientError", (_error, socket) => socket.destroy()); acme.on("error", () => stop());
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    server.close(); acme.close();
    setTimeout(() => { server.closeAllConnections(); acme.closeAllConnections(); }, 60_000).unref();
  }
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  // No automatic restart is configured. Each finite run requires the operator's
  // renewed approval; request counters are not claimed to survive a restart.
  setTimeout(stop, Math.min(3_600_000, expiry - now)).unref();
  server.listen(443, "0.0.0.0"); acme.listen(80, "0.0.0.0");
}
