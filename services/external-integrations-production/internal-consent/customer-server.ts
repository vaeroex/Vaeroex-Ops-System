import "server-only";

import http from "node:http";
import { z } from "zod";
import type { CustomerExchange } from "./customer-flow";

const exchangeSchema = z.object({
  stateId: z.string().uuid(), connectionId: z.string().uuid(), generation: z.number().int().positive().safe(),
  actorId: z.string().uuid(), sessionId: z.string().uuid(), workspaceId: z.string().uuid(), businessEntityId: z.string().uuid(),
  applicationId: z.string().min(8).max(191), configurationFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  authorizationCode: z.string().min(1).max(191).regex(/^[\x21-\x7e]+$/)
}).strict();
const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const closed = () => Response.json({ error: "production_integration_runtime_disabled" }, { status: 404, headers });
const denied = () => Response.json({ error: "square_customer_requires_reconciliation" }, { status: 409, headers });

/** Only the managed-edge callback handoff reaches the OAuth profile. The
 * service has no public connect/status/disconnect route and never receives a
 * workspace cookie or Supabase bearer from Vaeroex's Next app. */
export function createCustomerOAuthHandler(runtime: Readonly<{
  callback(request: { method: string; url: string; rawHeaders: string[] }): Promise<unknown>;
}> | null) {
  return async (request: Request, rawHeaders: string[]): Promise<Response> => {
    if (!runtime) return closed();
    try {
      const url = new URL(request.url);
      if (request.method !== "GET" || url.origin !== "https://square.vaeroex.com" ||
        url.pathname !== "/api/integrations/square/callback" || url.search || url.hash || request.body !== null) return closed();
      const result = await runtime.callback({ method: request.method, url: url.pathname, rawHeaders });
      z.union([z.object({ status: z.literal("denied") }).strict(),
        z.object({ status: z.literal("stored"), nonEconomic: z.literal(true) }).strict()]).parse(result);
      return new Response(null, { status: 303, headers: { ...headers,
        location: "https://www.vaeroex.com/app/settings/integrations/square" } });
    } catch { return denied(); }
  };
}

export function createCustomerBrokerHandler(input: Readonly<{
  runtime: { exchange(command: CustomerExchange): Promise<unknown> } | null;
  authenticateOAuthService(request: Request): Promise<boolean>;
}>) {
  return async (request: Request, body: unknown): Promise<Response> => {
    if (!input.runtime) return closed();
    try {
      const url = new URL(request.url);
      if (request.method !== "POST" || url.origin !== "https://square-production-broker-u5c6zahmpq-uw.a.run.app" ||
        url.pathname !== "/internal/square/broker/customer-exchange" || url.search || url.hash ||
        request.headers.get("content-type") !== "application/json" || !await input.authenticateOAuthService(request)) return closed();
      const result = await input.runtime.exchange(exchangeSchema.parse(body));
      return Response.json(z.object({ status: z.literal("stored"), nonEconomic: z.literal(true) }).strict().parse(result), { headers });
    } catch { return denied(); }
  };
}

/** The ordinary dormant entrypoint does not construct this listener. A future
 * reviewed customer-mode deployment must select the matching OAuth/broker
 * profile and exact native role; no generic runtime or webhook endpoint exists. */
export function createCustomerConsentServer(input: Readonly<{
  profile: "oauth"; runtime: Parameters<typeof createCustomerOAuthHandler>[0];
}> | Readonly<{
  profile: "broker"; runtime: Parameters<typeof createCustomerBrokerHandler>[0]["runtime"];
  authenticateOAuthService: Parameters<typeof createCustomerBrokerHandler>[0]["authenticateOAuthService"];
}>) {
  const oauth = input.profile === "oauth" ? createCustomerOAuthHandler(input.runtime) : null;
  const broker = input.profile === "broker" ? createCustomerBrokerHandler(input) : null;
  const server = http.createServer({ maxHeaderSize: 32_768 }, async (incoming, outgoing) => {
    let response: Response;
    try {
      if ((incoming.method === "GET" || incoming.method === "HEAD") && incoming.url === "/healthz") {
        response = Response.json({ status: input.runtime ? "customer_consent_only" : "disabled" }, { headers });
      } else {
        const checkedHeaders = new Headers();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) checkedHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
        const request = new Request(`https://${incoming.headers.host ?? "invalid"}${incoming.url ?? "/"}`,
          { method: incoming.method, headers: checkedHeaders });
        if (oauth) {
          if (incoming.headers["transfer-encoding"] || incoming.headers["content-length"] && incoming.headers["content-length"] !== "0")
            throw new Error("body");
          response = await oauth(request, incoming.rawHeaders);
        } else if (broker && incoming.method === "POST" && incoming.url === "/internal/square/broker/customer-exchange") {
          const chunks: Buffer[] = []; let bytes = 0;
          try {
            for await (const part of incoming) {
              const chunk = Buffer.from(part);
              bytes += chunk.byteLength;
              if (bytes > 4096 || chunks.length >= 64) throw new Error("body");
              chunks.push(chunk);
            }
            const raw = Buffer.concat(chunks);
            try { response = await broker(request, JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(raw))); }
            finally { raw.fill(0); }
          } finally { for (const chunk of chunks) chunk.fill(0); }
        } else response = closed();
      }
    } catch { response = denied(); }
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
