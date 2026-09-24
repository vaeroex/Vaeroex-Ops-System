import "server-only";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { z } from "zod";
import { GoogleCloudKmsCredentialAdapter } from "@/lib/integrations/credentials/kms";
import { GoogleSecretManagerProviderSecrets } from "@/lib/integrations/credentials/secret-manager";
import { createInternalBroker, createInternalOAuth, InternalPermitSchema, type InternalActor } from "./handlers";
import { createInternalRpc } from "./database";
import { createInternalConsentTransport } from "./transport";
import { createInternalConsentServer } from "./server";

const project = "vaeroex-integrations-prod", projectNumber = "711446392261";
const databaseProject = "mdiianhfrojmxqpwrflh";
const databaseHost = "aws-1-us-west-2.pooler.supabase.com";
const databaseCaHash = "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7";
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"), { timeoutDuration: 5_000 });
const ConfigSchema = z.object({
  profile: z.enum(["oauth", "broker"]), permit: InternalPermitSchema,
  databaseVersion: z.number().int().positive().safe(), databaseCa: z.string().max(16_384),
  brokerOrigin: z.literal("https://square-production-broker-u5c6zahmpq-uw.a.run.app"),
  supabasePublishableKey: z.string().min(16).max(2048)
}).strict();
export type InternalConsentConfiguration = z.infer<typeof ConfigSchema>;

async function readBounded(response: Response, maximum = 262_144) {
  if (!response.ok || !response.body) throw new Error("square_internal_transport_failed");
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum || chunks.length > 1024) throw new Error("square_internal_transport_failed");
      chunks.push(next.value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
async function metadata(path: string) {
  return readBounded(await fetch(`http://metadata.google.internal/computeMetadata/v1/${path}`, {
    headers: { "Metadata-Flavor": "Google" }, redirect: "error", signal: AbortSignal.timeout(5_000)
  }), 32_768);
}

/** Production assembly uses native metadata identity and the reviewed native
 * database wire format. No ADC, administrator fallback, environment password,
 * browser credential, generic SQL or arbitrary secret selection exists. */
export async function createProductionInternalConsentRuntime(raw: unknown) {
  const config = ConfigSchema.parse(raw), profile = config.profile;
  if (createHash("sha256").update(config.databaseCa).digest("hex") !== databaseCaHash) throw new Error("square_internal_ca_denied");
  const ca = config.databaseCa;
  const identity = `sq-prod-${profile}@${project}.iam.gserviceaccount.com`;
  if (await metadata("project/project-id") !== project ||
    (await metadata("instance/service-accounts/default/email")).trim() !== identity) throw new Error("square_internal_identity_denied");
  const google = async (url: string, init: RequestInit) => {
    const token = JSON.parse(await metadata("instance/service-accounts/default/token"));
    if (typeof token.access_token !== "string" || token.access_token.length < 16) throw new Error("square_internal_identity_denied");
    return JSON.parse(await readBounded(await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.access_token}` } })));
  };
  const secretData = async (resource: string) => {
    const result = await google(`https://secretmanager.googleapis.com/v1/${resource}:access`, { method: "GET" });
    if (result.name !== resource && result.name !== resource.replace(`projects/${project}/`, `projects/${projectNumber}/`))
      throw new Error("square_internal_secret_binding_denied");
    if (typeof result.payload?.data !== "string" || result.payload.data.length > 90_000) throw new Error("square_internal_secret_binding_denied");
    return result.payload.data as string;
  };
  const rpc = createInternalRpc(profile, async () => {
    const resource = `projects/${project}/secrets/square-production-${profile}-db/versions/${config.databaseVersion}`;
    const bytes = Buffer.from(await secretData(resource), "base64");
    const prefix = Buffer.from(`postgresql://square_production_${profile}.${databaseProject}:`);
    const suffix = Buffer.from(`@${databaseHost}:5432/postgres?sslmode=verify-full`);
    try {
      const password = bytes.subarray(prefix.length, prefix.length + 128);
      if (bytes.length !== prefix.length + 128 + suffix.length || !bytes.subarray(0, prefix.length).equals(prefix) ||
        !bytes.subarray(prefix.length + 128).equals(suffix) || !/^[a-f0-9]{128}$/.test(password.toString("ascii")))
        throw new Error("square_internal_database_secret_denied");
      const client = new Client({ host: databaseHost, port: 5432, database: "postgres",
        user: `square_production_${profile}.${databaseProject}`, password: password.toString("ascii"),
        ssl: { ca, rejectUnauthorized: true, servername: databaseHost }, connectionTimeoutMillis: 5_000,
        statement_timeout: 5_000, query_timeout: 6_000, application_name: `square_internal_${profile}` });
      client.on("error", () => { void client.end().catch(() => undefined); });
      try { await client.connect(); return client; }
      catch { await client.end().catch(() => undefined); throw new Error("square_internal_database_connect_failed"); }
    } finally { bytes.fill(0); }
  });
  if (profile === "oauth") {
    const oauth = createInternalOAuth({ permit: config.permit, oauthRpc: rpc,
      async brokerExchange(request) {
        const token = await metadata(`instance/service-accounts/default/identity?audience=${encodeURIComponent(config.brokerOrigin)}&format=full`);
        const response = await fetch(`${config.brokerOrigin}/internal/square/broker/exchange`, { method: "POST", redirect: "error",
          signal: AbortSignal.timeout(90_000), headers: { Authorization: `Bearer ${token}`, "X-Serverless-Authorization": `Bearer ${token}`,
            "Content-Type": "application/json" }, body: JSON.stringify(request) });
        return z.object({ status: z.literal("stored"), nonEconomic: z.literal(true) }).strict().parse(JSON.parse(await readBounded(response, 4096)));
      }
    });
    return createInternalConsentServer({ profile, runtime: oauth, async authenticate(request): Promise<InternalActor | null> {
      const authorization = request.headers.get("authorization");
      if (!authorization?.startsWith("Bearer ") || authorization.length > 16_384) return null;
      // Auth server validates this exact token; JWT decoding alone is never
      // authentication. Migration 25 separately rechecks the live session.
      const user = JSON.parse(await readBounded(await fetch(`https://${databaseProject}.supabase.co/auth/v1/user`, {
        headers: { Authorization: authorization, apikey: config.supabasePublishableKey }, redirect: "error", signal: AbortSignal.timeout(5_000)
      }), 65_536));
      const claims = decodeJwt(authorization.slice(7));
      if (user.id !== config.permit.operatorId || claims.sub !== user.id || claims.session_id !== config.permit.operatorSessionId) return null;
      return { actorId: user.id, sessionId: String(claims.session_id), workspaceId: config.permit.workspaceId, businessEntityId: config.permit.businessEntityId };
    } });
  }
  const appResource = `projects/${project}/secrets/square-production-application/versions/1`;
  const kmsResource = `projects/${project}/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials`;
  const secrets = new GoogleSecretManagerProviderSecrets({ resources: { "square:production": appResource },
    transport: { async accessSecretVersion({ name }) {
      if (name !== appResource) throw new Error("square_internal_secret_binding_denied");
      return { payload: { data: await secretData(name) } };
    } } });
  const broker = createInternalBroker({ permit: config.permit, brokerRpc: rpc,
    transport: createInternalConsentTransport({ applicationId: config.permit.applicationId,
      authorize: async () => { if (Date.parse(config.permit.approvalExpiresAt) <= Date.now()) throw new Error("square_internal_permit_expired"); } }),
    async applicationSecret(resource) {
      if (resource !== appResource) throw new Error("square_internal_secret_binding_denied");
      return secrets.access("square", "production");
    },
    kms: new GoogleCloudKmsCredentialAdapter({ allowedKeyResource: kmsResource, transport: {
      async encrypt({ name, plaintext, additionalAuthenticatedData }) {
        if (name !== kmsResource) throw new Error("square_internal_kms_binding_denied");
        const result = await google(`https://cloudkms.googleapis.com/v1/${name}:encrypt`, { method: "POST", body: JSON.stringify({ plaintext, additionalAuthenticatedData }) });
        return { ciphertext: result.ciphertext };
      }, async decrypt() { throw new Error("square_internal_decrypt_unavailable"); }
    } })
  });
  return createInternalConsentServer({ profile, runtime: broker, async authenticateOAuthService(request) {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ") || authorization.length > 16_384) return false;
    try {
      const { payload } = await jwtVerify(authorization.slice(7), googleKeys, {
        issuer: ["https://accounts.google.com", "accounts.google.com"], audience: config.brokerOrigin, algorithms: ["RS256"]
      });
      return payload.email === `sq-prod-oauth@${project}.iam.gserviceaccount.com` && payload.email_verified === true;
    } catch { return false; }
  } });
}
