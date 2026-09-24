import "server-only";
import { createInternalConsentServer } from "./server";
import { createProductionInternalConsentRuntime } from "./runtime";

process.on("uncaughtException", () => process.exit(78));
process.on("unhandledRejection", () => process.exit(78));
async function main() {
  const port = Number(process.env.PORT ?? "8080");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("square_internal_port_denied");
  const raw = process.env.SQUARE_INTERNAL_CONSENT_CONFIGURATION;
  // No configuration is the ordinary dormant deployment: no metadata, secret,
  // database, authentication or provider access occurs.
  const server = raw
    ? await createProductionInternalConsentRuntime(JSON.parse(raw))
    : createInternalConsentServer({ profile: "oauth", runtime: null, authenticate: async () => null });
  server.listen(port, "0.0.0.0");
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
}
void main().catch(() => { process.exitCode = 78; });
