import http from "node:http";
import {
  evaluateSquareProductionCallback,
  SQUARE_CALLBACK_PATH,
} from "./callback-boundary.mjs";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const sourceCommit = process.env.VAEROEX_SOURCE_COMMIT ?? "unbound";

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("invalid_port");
}

const disabledCallbackAuthority = Object.freeze({
  now: () => Date.now(),
  consumeState: async () => null,
});

const server = http.createServer({ maxHeaderSize: 32_768 }, async (request, response) => {
  // This image is deliberately incapable of handling OAuth, webhooks, tasks,
  // database access, provider calls, evidence, economics, or AI dispatch.
  request.resume();
  const health = (request.method === "GET" || request.method === "HEAD") && request.url === "/healthz";
  if (request.method === "GET" && (request.url === SQUARE_CALLBACK_PATH || request.url?.startsWith(`${SQUARE_CALLBACK_PATH}?`))) {
    // Exercise the complete backend boundary without installing any state,
    // database, credential, provider, or token-exchange authority. Even a
    // structurally valid callback therefore remains disabled.
    await evaluateSquareProductionCallback({
      method: request.method,
      url: request.url,
      rawHeaders: request.rawHeaders,
    }, disabledCallbackAuthority).catch(() => undefined);
  }
  response.writeHead(health ? 200 : 404, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Vaeroex-Source-Commit": sourceCommit,
  });
  response.end(request.method === "HEAD" ? undefined : health
    ? '{"status":"disabled"}\n'
    : '{"error":"production_integration_runtime_disabled"}\n');
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
// Preserve the complete parser-owned rawHeaders array. The HTTP parser retains
// its explicit 32 KiB byte ceiling above; the callback boundary then applies
// the exact 66-header limit without Node silently truncating a 67th header.
server.maxHeadersCount = 0;

server.listen(port, "0.0.0.0");

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
