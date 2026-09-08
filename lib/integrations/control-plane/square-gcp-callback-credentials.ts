import "server-only";

import { timingSafeEqual } from "node:crypto";
import { isProxy } from "node:util/types";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { CredentialAadContextSchema, type CredentialAadContext } from "@/lib/integrations/credentials/contracts";
import { credentialAad, GoogleCloudKmsCredentialAdapter, type CredentialKms } from "@/lib/integrations/credentials/kms";
import { GoogleSecretManagerProviderSecrets } from "@/lib/integrations/credentials/secret-manager";
import {
  checkedSquareGcpCallbackBinding, type SquareGcpCallbackBinding, type SquareGcpFirstConsentAuthority,
  type SquareGcpFirstConsentPurpose
} from "./square-gcp-callback-contracts";
import { createSquareGcpCallbackIo, squareGcpCallbackDependencies, type SquareGcpCallbackIdentity } from "./square-gcp-callback-identity";

const DENIED = "square_gcp_callback_credentials_denied";
const WIRE_BYTES = 262_144;
function deny(): never { throw new Error(DENIED); }
function base64(value: unknown, maximum: number) {
  if (typeof value !== "string" || !value || value.length > 4 * Math.ceil(maximum / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return deny();
  const bytes = Buffer.from(value, "base64");
  try { if (!bytes.length || bytes.length > maximum || bytes.toString("base64") !== value) return deny(); }
  finally { bytes.fill(0); }
  return value;
}
function identityDependency(value: unknown): SquareGcpCallbackIdentity {
  const args = squareGcpCallbackDependencies(value, ["verify", "withAccessToken", "dispose"]);
  if (Object.values(args).some(method => typeof method !== "function" || isProxy(method))) return deny();
  return value as SquareGcpCallbackIdentity;
}
function secretData(reply: Record<string, unknown>, resource: string, binding: SquareGcpCallbackBinding) {
  // Canonical project-number response is accepted only for this exact approved
  // project number, not an arbitrary Google project or a new requested resource.
  if (Object.keys(reply).some(key => !["name", "payload"].includes(key)) ||
    reply.name !== resource && reply.name !== resource.replace(`projects/${binding.gcpProjectId}/`, `projects/${binding.gcpProjectNumber}/`)) return deny();
  const payload = reply.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return deny();
  const value = payload as Record<string, unknown>;
  if (Object.keys(value).some(key => !["data", "dataCrc32c"].includes(key))) return deny();
  return base64(value.data, 65_536);
}

/** First-consent adapter only. There is no activation API: only the injected
 * request-owned checked database closure can establish consumed-intent authority.
 * Construction performs no IO, and access remains closed before consume_state.
 * Permit exactly one app-secret read, followed by exactly one encryption. The
 * existing broker owns discovery and the final fenced ciphertext commit. No
 * decrypt, refresh, enrollment, webhook or runtime capability is installed. */
export function createSquareGcpCallbackCredentials(input: Readonly<{
  binding: SquareGcpCallbackBinding; identity: SquareGcpCallbackIdentity;
  authorizeFirstConsent: SquareGcpFirstConsentAuthority; network: typeof fetch; signal: AbortSignal;
}>) {
  try {
    const args = squareGcpCallbackDependencies(input, ["binding", "identity", "authorizeFirstConsent", "network", "signal"]);
    const binding = checkedSquareGcpCallbackBinding(args.binding);
    if (!binding.providerCallsEnabled) return deny();
    const identity = identityDependency(args.identity), authorize = args.authorizeFirstConsent as SquareGcpFirstConsentAuthority;
    if (typeof authorize !== "function" || isProxy(authorize)) return deny();
    const signal = args.signal as AbortSignal;
    const io = createSquareGcpCallbackIo({ network: args.network as typeof fetch, signal });
    const expected = canonicalContractJson(binding);
    // The reviewed Sandbox key has exactly one approved SOFTWARE version. Never
    // follow a changed primary or retry against the parent CryptoKey resource.
    const keyVersionResource = `${binding.kmsKeyResource}/cryptoKeyVersions/1`;
    let phase: "fresh" | "secret" | "encrypting" | "done" | "disposed" = "fresh", busy = false;
    const dispose = () => { phase = "disposed"; io.dispose(); identity.dispose(); signal.removeEventListener("abort", dispose); };
    signal.addEventListener("abort", dispose, { once: true });
    async function recheck(purpose: SquareGcpFirstConsentPurpose, aadContext?: CredentialAadContext) {
      io.check();
      if (phase === "disposed") return deny();
      const current = await io.wait(() => authorize(Object.freeze({ purpose, ...(aadContext ? { aadContext } : {}), signal })));
      if (canonicalContractJson(checkedSquareGcpCallbackBinding(current)) !== expected) return deny();
      io.check();
    }
    async function operation<T>(purpose: SquareGcpFirstConsentPurpose, work: (access: string) => Promise<T>, aadContext?: CredentialAadContext) {
      io.check();
      if (busy || purpose === "application_secret" && phase !== "fresh" || purpose === "credential_encrypt" && phase !== "secret") {
        dispose(); return deny();
      }
      busy = true;
      // Take the effect latch before any await: failure/reentry cannot retry.
      phase = purpose === "application_secret" ? "secret" : "encrypting";
      try {
        await recheck(purpose, aadContext);
        const result = await identity.withAccessToken(async access => {
          await recheck(purpose, aadContext);
          const value = await work(access);
          await recheck(purpose, aadContext);
          return value;
        });
        await recheck(purpose, aadContext);
        if (purpose === "credential_encrypt") phase = "done";
        return result;
      } catch { dispose(); return deny(); }
      finally { busy = false; }
    }
    const secrets = new GoogleSecretManagerProviderSecrets({ resources: { "square:sandbox": binding.appSecretVersionResource },
      transport: { accessSecretVersion: async ({ name }) => {
        if (name !== binding.appSecretVersionResource) return deny();
        return operation("application_secret", async access => {
          const reply = await io.json(`https://secretmanager.googleapis.com/v1/${name}:access`, {
            method: "GET", headers: { Authorization: `Bearer ${access}` }
          }, WIRE_BYTES);
          return { payload: { data: secretData(reply, name, binding) } };
        });
      } }
    });
    const kms = new GoogleCloudKmsCredentialAdapter({ allowedKeyResource: binding.kmsKeyResource, transport: {
      encrypt: async ({ name, plaintext, additionalAuthenticatedData }) => {
        try {
          if (name !== binding.kmsKeyResource) return deny();
          base64(plaintext, 32_768);
          const bytes = Buffer.from(base64(additionalAuthenticatedData, 4_096), "base64");
          let context: CredentialAadContext;
          try {
            context = Object.freeze(CredentialAadContextSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))));
            const canonical = credentialAad(context);
            try { if (canonical.length !== bytes.length || !timingSafeEqual(canonical, bytes)) return deny(); }
            finally { canonical.fill(0); }
          } finally { bytes.fill(0); }
          if (context.providerKey !== "square" || context.environment !== "sandbox" || context.workspaceId !== binding.workspaceId) return deny();
          return await operation("credential_encrypt", async access => {
            const reply = await io.json(`https://cloudkms.googleapis.com/v1/${keyVersionResource}:encrypt`, {
              method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
              body: JSON.stringify({ plaintext, additionalAuthenticatedData })
            }, WIRE_BYTES);
            if (reply.name !== keyVersionResource || reply.protectionLevel !== "SOFTWARE") return deny();
            // Optional documented checksum metadata is bounded by the reader;
            // only ciphertext from this exact approved version crosses here.
            return { ciphertext: base64(reply.ciphertext, 131_072) };
          }, context);
        } catch { dispose(); return deny(); }
      },
      decrypt: async () => { dispose(); return deny(); }
    } });
    const guardedKms: CredentialKms = Object.freeze({
      async encrypt(request) {
        try { return await kms.encrypt(request); } catch { dispose(); return deny(); }
      },
      async decrypt() { dispose(); return deny(); }
    });
    return Object.freeze({
      kms: guardedKms,
      secrets: Object.freeze({ async access(provider: string, environment: string) {
        try {
          if (provider !== "square" || environment !== "sandbox") return deny();
          const secret = await secrets.access(provider, environment);
          if (!secret.use(value => value.clientId === binding.applicationId)) return deny();
          return secret;
        } catch { dispose(); return deny(); }
      } }),
      dispose
    });
  } catch { return deny(); }
}

/** Explicit startup bootstrap, not first-consent/provider authority. It reads
 * only the pinned dedicated broker-LOGIN secret after signed host verification.
 * The caller must check the returned DSN and actual DB binding before serving.
 * Never log/serialize this return value or put it in env/arguments/metadata. */
export async function readSquareGcpCallbackDatabaseSecret(input: Readonly<{
  binding: SquareGcpCallbackBinding; identity: SquareGcpCallbackIdentity; network: typeof fetch; signal: AbortSignal;
}>): Promise<string> {
  let io: ReturnType<typeof createSquareGcpCallbackIo> | undefined;
  let identity: SquareGcpCallbackIdentity | undefined;
  try {
    const args = squareGcpCallbackDependencies(input, ["binding", "identity", "network", "signal"]);
    const binding = checkedSquareGcpCallbackBinding(args.binding);
    identity = identityDependency(args.identity);
    io = createSquareGcpCallbackIo({ network: args.network as typeof fetch, signal: args.signal as AbortSignal });
    return await identity.withAccessToken(async access => {
      const reply = await io!.json(`https://secretmanager.googleapis.com/v1/${binding.databaseSecretVersionResource}:access`, {
        method: "GET", headers: { Authorization: `Bearer ${access}` }
      }, WIRE_BYTES);
      const bytes = Buffer.from(secretData(reply, binding.databaseSecretVersionResource, binding), "base64");
      try {
        const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (value.length > 8_192 || !value.startsWith("postgresql://") || /[\u0000-\u0020\u007f]/.test(value)) return deny();
        io!.check(); checkedSquareGcpCallbackBinding(binding);
        return value;
      } finally { bytes.fill(0); }
    });
  } catch { return deny(); }
  finally { io?.dispose(); identity?.dispose(); }
}
