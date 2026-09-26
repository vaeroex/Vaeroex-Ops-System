import "server-only";

import { createHash } from "node:crypto";
import { Client } from "pg";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { GoogleCloudKmsCredentialAdapter } from "@/lib/integrations/credentials/kms";
import { GoogleSecretManagerProviderSecrets } from "@/lib/integrations/credentials/secret-manager";
import { createCustomerRpc } from "./database";
import { createProductionCustomerOAuth, createProductionCustomerBroker, type CustomerExchange } from "./customer-flow";
import { createCustomerConsentServer } from "./customer-server";
import { createInternalConsentTransport } from "./transport";

const project = "vaeroex-integrations-prod", projectNumber = "711446392261";
const databaseProject = "mdiianhfrojmxqpwrflh";
const databaseHost = "aws-1-us-west-2.pooler.supabase.com";
const databaseCaHash = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";
const brokerOrigin = "https://square-production-broker-u5c6zahmpq-uw.a.run.app";
const applicationResource = `projects/${project}/secrets/square-production-application/versions/1`;
const kmsResource = `projects/${project}/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials`;
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 5_000 });
const ConfigSchema = z.object({
  mode: z.literal("customer_owner_v1"), profile: z.enum(["oauth", "broker"]),
  applicationId: z.string().regex(/^sq0idp-[A-Za-z0-9_-]{1,184}$/),
  databaseVersion: z.literal(1), databaseCa: z.string().max(16_384),
  brokerOrigin: z.literal(brokerOrigin)
}).strict();

async function readBounded(response: Response, maximum = 8192) {
  if (!response.ok || !response.body) throw new Error("square_customer_transport_denied");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum || chunks.length >= 64) throw new Error("square_customer_transport_denied");
      chunks.push(Uint8Array.from(next.value));
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally { for (const chunk of chunks) chunk.fill(0); await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
async function metadata(path: string) {
  return readBounded(await fetch(`http://metadata.google.internal/computeMetadata/v1/${path}`, {
    headers: { "Metadata-Flavor": "Google" }, redirect: "error", signal: AbortSignal.timeout(5_000)
  }), 32_768);
}

/** Never accepts a database URI or secret value from the deployment config.
 * The same exact native LOGIN, pinned CA and fixed numeric version 1 as the
 * already-reviewed internal consent service are used for customer mode.
 */
export async function createProductionCustomerRuntime(raw: unknown) {
  const config = ConfigSchema.parse(raw), profile = config.profile;
  if (createHash("sha256").update(config.databaseCa).digest("hex") !== databaseCaHash)
    throw new Error("square_customer_ca_denied");
  const identity = `sq-prod-${profile}@${project}.iam.gserviceaccount.com`;
  if (await metadata("project/project-id") !== project ||
    (await metadata("instance/service-accounts/default/email")).trim() !== identity)
    throw new Error("square_customer_identity_denied");
  const google = async (url: string, init: RequestInit) => {
    const token = JSON.parse(await metadata("instance/service-accounts/default/token"));
    if (typeof token.access_token !== "string" || token.access_token.length < 16) throw new Error("square_customer_identity_denied");
    return JSON.parse(await readBounded(await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.access_token}` } }), 90_000));
  };
  const secretData = async (resource: string) => {
    const result = await google(`https://secretmanager.googleapis.com/v1/${resource}:access`, { method: "GET" });
    if (result.name !== resource && result.name !== resource.replace(`projects/${project}/`, `projects/${projectNumber}/`))
      throw new Error("square_customer_secret_denied");
    if (typeof result.payload?.data !== "string" || result.payload.data.length > 90_000)
      throw new Error("square_customer_secret_denied");
    return result.payload.data as string;
  };
  const open = async () => {
    const resource = `projects/${project}/secrets/square-production-${profile}-db/versions/${config.databaseVersion}`;
    const bytes = Buffer.from(await secretData(resource), "base64");
    const prefix = Buffer.from(`postgresql://square_production_${profile}.${databaseProject}:`);
    const suffix = Buffer.from(`@${databaseHost}:5432/postgres?sslmode=verify-full`);
    try {
      const password = bytes.subarray(prefix.length, prefix.length + 128);
      if (bytes.length !== prefix.length + 128 + suffix.length || !bytes.subarray(0, prefix.length).equals(prefix) ||
        !bytes.subarray(prefix.length + 128).equals(suffix) || !/^[a-f0-9]{128}$/.test(password.toString("ascii")))
        throw new Error("square_customer_database_secret_denied");
      const client = new Client({ host: databaseHost, port: 5432, database: "postgres",
        user: `square_production_${profile}.${databaseProject}`, password: password.toString("ascii"),
        ssl: { ca: config.databaseCa, rejectUnauthorized: true, servername: databaseHost },
        connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 6_000,
        application_name: `square_customer_${profile}` });
      client.on("error", () => { void client.end().catch(() => undefined); });
      try { await client.connect(); return client; }
      catch { await client.end().catch(() => undefined); throw new Error("square_customer_database_connect_denied"); }
    } finally { bytes.fill(0); }
  };
  const rpc = createCustomerRpc(profile, open);
  if (profile === "oauth") {
    const oauth = createProductionCustomerOAuth({ applicationId: config.applicationId, rpc,
      async exchange(command: CustomerExchange) {
        const token = await metadata(`instance/service-accounts/default/identity?audience=${encodeURIComponent(brokerOrigin)}&format=full`);
        const response = await fetch(`${brokerOrigin}/internal/square/broker/customer-exchange`, {
          method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(90_000),
          headers: { Authorization: `Bearer ${token}`, "X-Serverless-Authorization": `Bearer ${token}`,
            "Content-Type": "application/json" }, body: JSON.stringify(command)
        });
        return z.object({ status: z.literal("stored"), nonEconomic: z.literal(true) }).strict().parse(JSON.parse(await readBounded(response, 4096)));
      }
    });
    return createCustomerConsentServer({ profile, runtime: oauth });
  }
  const secrets = new GoogleSecretManagerProviderSecrets({ resources: { "square:production": applicationResource },
    transport: { async accessSecretVersion({ name }) {
      if (name !== applicationResource) throw new Error("square_customer_secret_denied");
      return { payload: { data: await secretData(name) } };
    } } });
  const kms = new GoogleCloudKmsCredentialAdapter({ allowedKeyResource: kmsResource, transport: {
    async encrypt({ name, plaintext, additionalAuthenticatedData }) {
      if (name !== kmsResource) throw new Error("square_customer_kms_denied");
      const result = await google(`https://cloudkms.googleapis.com/v1/${name}:encrypt`, {
        method: "POST", body: JSON.stringify({ plaintext, additionalAuthenticatedData })
      });
      return { ciphertext: result.ciphertext };
    }, async decrypt() { throw new Error("square_customer_decrypt_unavailable"); }
  } });
  const broker = createProductionCustomerBroker({ applicationId: config.applicationId, rpc,
    transport: authorize => createInternalConsentTransport({ applicationId: config.applicationId, authorize }),
    applicationSecret: () => secrets.access("square", "production"), kms });
  const authenticateOAuthService = async (request: Request) => {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length > 16_384) return false;
    try {
      const { payload } = await jwtVerify(authorization.slice(7), googleKeys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"], audience: brokerOrigin, algorithms: ["RS256"]
      });
      return payload.email === `sq-prod-oauth@${project}.iam.gserviceaccount.com` && payload.email_verified === true;
    } catch { return false; }
  };
  return createCustomerConsentServer({ profile, runtime: broker, authenticateOAuthService });
}
