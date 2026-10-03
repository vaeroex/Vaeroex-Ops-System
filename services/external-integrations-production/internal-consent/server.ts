import "server-only";
import http from "node:http";
import { createInternalOAuthHandler, type createInternalOAuth, type createInternalBroker, type InternalActor, type ExchangeInput } from "./handlers";

const privateHeaders = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };

/** One server per existing service identity. This factory does not start a
 * listener or install credentials merely by being imported. The host installs
 * only its own native RPC client; OAuth has no broker database/secret access.
 * Google ingress/invoker checks remain external and unchanged. */
export function createInternalConsentServer(input:
  | { profile: "oauth"; runtime: ReturnType<typeof createInternalOAuth> | null;
      authenticate(request: Request): Promise<InternalActor | null>;
      manual?(action: string, actor: InternalActor): Promise<unknown> }
  | { profile: "broker"; runtime: ReturnType<typeof createInternalBroker> | null;
      authenticateOAuthService(request: Request): Promise<boolean>;
      readPage?(body: unknown): Promise<unknown>;
      authenticateRuntimeService?(request: Request): Promise<boolean> }
  | { profile: "runtime" | "evidence"; runtime: ((body: unknown) => Promise<unknown>) | null;
      authenticateOAuthService(request: Request): Promise<boolean> }) {
  const oauth = input.profile === "oauth" ? createInternalOAuthHandler(input) : null;
  const server = http.createServer({ maxHeaderSize: 32_768 }, async (incoming, outgoing) => {
    let response: Response;
    try {
      if ((incoming.method === "GET" || incoming.method === "HEAD") && incoming.url === "/healthz") {
        response = Response.json({ status: input.runtime ? "internal_consent_only" : "disabled" }, { headers: privateHeaders });
      } else {
        const headers = new Headers();
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) headers.append(incoming.rawHeaders[index], incoming.rawHeaders[index + 1]);
        const request = new Request(`https://${incoming.headers.host ?? "invalid"}${incoming.url ?? "/"}`, { method: incoming.method, headers });
        if (oauth) {
          // All allowed OAuth requests have no body. Never silently discard a
          // body to turn a different request into the approved connect shape.
          if (incoming.headers["transfer-encoding"] || incoming.headers["content-length"] && incoming.headers["content-length"] !== "0")
            throw new Error("body");
          response = await oauth(request, incoming.rawHeaders);
        } else if (input.profile !== "oauth" && input.runtime && incoming.method === "POST" &&
          incoming.headers["content-type"] === "application/json" &&
          (input.profile === "broker" ?
            incoming.url === "/internal/square/broker/exchange" && await input.authenticateOAuthService(request) ||
            incoming.url === "/internal/square/broker/payments" && !!input.readPage && !!input.authenticateRuntimeService && await input.authenticateRuntimeService(request)
            : incoming.url === `/internal/square/${input.profile}/manual` && await input.authenticateOAuthService(request))) {
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const part of incoming) {
            const chunk = Buffer.from(part);
            bytes += chunk.length;
            if (bytes > 4_096 || chunks.length >= 64) throw new Error("body");
            chunks.push(chunk);
          }
          const body = Buffer.concat(chunks);
          try {
            const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
            const result = input.profile !== "broker" ? await input.runtime(parsed) :
              incoming.url === "/internal/square/broker/payments" ? await input.readPage!(parsed) : await input.runtime.exchange(parsed as ExchangeInput);
            response = Response.json(result, { headers: privateHeaders });
          }
          finally { body.fill(0); for (const chunk of chunks) chunk.fill(0); }
        } else response = Response.json({ error: "production_integration_runtime_disabled" }, { status: 404, headers: privateHeaders });
      }
    } catch { response = Response.json({ error: "square_internal_consent_requires_reconciliation" }, { status: 409, headers: privateHeaders }); }
    incoming.resume();
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(incoming.method === "HEAD" ? undefined : await response.text());
  });
  server.maxHeadersCount = 0;
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}
