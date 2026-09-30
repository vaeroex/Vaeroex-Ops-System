import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export function disabledQboIngressConfiguration(environment: NodeJS.ProcessEnv) {
  if (environment.QBO_INGRESS_BOOTSTRAP_ONLY !== "true" ||
      environment.QBO_SERVICE_MODE !== "oauth_ingress" ||
      !/^[a-f0-9]{40}$/.test(environment.QBO_SOURCE_COMMIT ?? "")) {
    throw new Error("qbo_bootstrap_configuration_invalid");
  }
  const allowedQboKeys = new Set([
    "QBO_INGRESS_BOOTSTRAP_ONLY", "QBO_SERVICE_MODE", "QBO_SOURCE_COMMIT"
  ]);
  for (const key of Object.keys(environment)) {
    if ((key.startsWith("QBO_") && !allowedQboKeys.has(key)) ||
        /^(DATABASE_URL|PGPASSWORD|PGHOST|PGSERVICE|SUPABASE_|NEXT_PUBLIC_SUPABASE_|GOOGLE_APPLICATION_CREDENTIALS)/.test(key)) {
      throw new Error("qbo_bootstrap_operational_configuration_denied");
    }
  }
  const rawPort = environment.PORT ?? "8080";
  if (!/^[1-9][0-9]{0,4}$/.test(rawPort) || Number(rawPort) > 65535) {
    throw new Error("qbo_bootstrap_configuration_invalid");
  }
  return { sourceCommit: environment.QBO_SOURCE_COMMIT!, port: Number(rawPort) };
}

export function disabledQboIngressHandler(sourceCommit: string) {
  return (request: IncomingMessage, response: ServerResponse) => {
    // Do not parse, consume, echo or log callback queries, headers or bodies.
    const health = request.method === "GET" && request.url === "/health";
    const body = JSON.stringify(health ? {
      ok: true, mode: "oauth_ingress", providerEnvironment: "production", sourceCommit,
      bootstrapOnly: true, oauthProcessingEnabled: false, webhookProcessingEnabled: false,
      readyForProviderProcessing: false, promotionAuthorized: false, modelCallCount: 0
    } : { error: "qbo_production_processing_disabled" });
    response.writeHead(health ? 200 : 503, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "connection": "close"
    });
    response.end(body);
  };
}

export function startDisabledQboIngress(environment: NodeJS.ProcessEnv) {
  const configuration = disabledQboIngressConfiguration(environment);
  const server = createServer({ maxHeaderSize: 16 * 1024 }, disabledQboIngressHandler(configuration.sourceCommit));
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 64;
  server.listen(configuration.port, "0.0.0.0");
  return server;
}
