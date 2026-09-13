import http from "node:http";

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const sourceCommit = process.env.VAEROEX_SOURCE_COMMIT ?? "unbound";

if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error("invalid_port");
}

const server = http.createServer((request, response) => {
  // This image is deliberately incapable of handling OAuth, webhooks, tasks,
  // database access, provider calls, evidence, economics, or AI dispatch.
  request.resume();
  const health = (request.method === "GET" || request.method === "HEAD") && request.url === "/healthz";
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
server.maxHeadersCount = 32;

server.listen(port, "0.0.0.0");

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
