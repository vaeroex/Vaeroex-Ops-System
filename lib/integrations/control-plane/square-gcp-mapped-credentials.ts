import "server-only";

import { timingSafeEqual } from "node:crypto";
import { isProxy } from "node:util/types";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { CredentialAadContextSchema, type CredentialAadContext } from "@/lib/integrations/credentials/contracts";
import { credentialAad, GoogleCloudKmsCredentialAdapter, type CredentialKms } from "@/lib/integrations/credentials/kms";
import { createSquareGcpCallbackIo, squareGcpCallbackDependencies, type SquareGcpCallbackIdentity } from "./square-gcp-callback-identity";
import { checkedSquareGcpMappedBinding, squareGcpMappedDatabaseSecret, type SquareGcpMappedBinding } from "./square-gcp-mapped-contracts";

const DENIED = "square_gcp_mapped_credentials_denied";
const WIRE_BYTES = 262_144;
function deny(): never { throw new Error(DENIED); }
function base64(value: unknown, maximum: number): string {
  if (typeof value !== "string" || !value || value.length > 4 * Math.ceil(maximum / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return deny();
  const bytes = Buffer.from(value, "base64");
  try { if (!bytes.length || bytes.length > maximum || bytes.toString("base64") !== value) return deny(); }
  finally { bytes.fill(0); }
  return value;
}
function identityDependency(value: unknown): SquareGcpCallbackIdentity {
  const methods = squareGcpCallbackDependencies(value, ["verify", "withAccessToken", "dispose"]);
  if (Object.values(methods).some(method => typeof method !== "function" || isProxy(method))) return deny();
  return value as SquareGcpCallbackIdentity;
}

/** Trusted task/lease-owned native DB closure, not a serialized permission. It
 * checks current enrollment, generation, task fencing and the current credential
 * ID on every call. This module independently checks canonical AAD and host pins. */
export type SquareGcpMappedCredentialAuthority = (request: Readonly<{
  aadContext: CredentialAadContext; signal: AbortSignal;
}>) => Promise<SquareGcpMappedBinding>;

/** One task-owned decrypt. No application secret, encryption, refresh, OAuth or
 * retry capability. The native identity implementation verifies the exact signed
 * host before and after each authenticated Google request. */
export function createSquareGcpMappedCredentials(input: Readonly<{
  binding: SquareGcpMappedBinding; identity: SquareGcpCallbackIdentity;
  authorizeCredentialRead: SquareGcpMappedCredentialAuthority; network: typeof fetch; signal: AbortSignal;
}>) {
  try {
    const args = squareGcpCallbackDependencies(input, ["binding", "identity", "authorizeCredentialRead", "network", "signal"]);
    const binding = checkedSquareGcpMappedBinding(args.binding);
    if (binding.capability !== "runtime" || !binding.mappedProviderCallsEnabled) return deny();
    const identity = identityDependency(args.identity), authorize = args.authorizeCredentialRead as SquareGcpMappedCredentialAuthority;
    if (typeof authorize !== "function" || isProxy(authorize)) return deny();
    const signal = args.signal as AbortSignal;
    const io = createSquareGcpCallbackIo({ network: args.network as typeof fetch, signal });
    const expected = canonicalContractJson(binding);
    let used = false, disposed = false;
    const dispose = () => { disposed = true; io.dispose(); identity.dispose(); signal.removeEventListener("abort", dispose); };
    signal.addEventListener("abort", dispose, { once: true });
    async function recheck(aadContext: CredentialAadContext) {
      io.check(); if (disposed) return deny();
      const current = await io.wait(() => authorize(Object.freeze({ aadContext, signal })));
      if (canonicalContractJson(checkedSquareGcpMappedBinding(current)) !== expected) return deny();
      io.check();
    }
    const adapter = new GoogleCloudKmsCredentialAdapter({ allowedKeyResource: binding.kmsKeyResource, transport: {
      encrypt: async () => deny(),
      decrypt: async ({ name, ciphertext, additionalAuthenticatedData }) => {
        if (name !== binding.kmsKeyResource) return deny();
        base64(ciphertext, 131_072);
        const bytes = Buffer.from(base64(additionalAuthenticatedData, 4_096), "base64");
        let context: CredentialAadContext;
        try {
          context = Object.freeze(CredentialAadContextSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))));
          const canonical = credentialAad(context);
          try { if (canonical.length !== bytes.length || !timingSafeEqual(canonical, bytes)) return deny(); }
          finally { canonical.fill(0); }
        } finally { bytes.fill(0); }
        if (context.providerKey !== "square" || context.environment !== "sandbox" || context.workspaceId !== binding.workspaceId ||
          context.connectionId !== binding.connectionId || context.connectionGeneration !== binding.connectionGeneration) return deny();
        await recheck(context);
        const result = await identity.withAccessToken(async access => {
          await recheck(context);
          const reply = await io.json(`https://cloudkms.googleapis.com/v1/${name}:decrypt`, {
            method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ciphertext, additionalAuthenticatedData })
          }, WIRE_BYTES);
          // CryptoKey decrypt selects the version encoded in the ciphertext. Do
          // not invent an encrypt-style name/protectionLevel response contract.
          if (Object.keys(reply).some(key => !["plaintext", "plaintextCrc32c", "usedPrimary", "protectionLevel"].includes(key)) ||
            reply.protectionLevel !== "SOFTWARE") return deny();
          const plaintext = base64(reply.plaintext, 32_768);
          await recheck(context);
          return { plaintext };
        });
        await recheck(context);
        return result;
      }
    } });
    const kms: CredentialKms = Object.freeze({
      async encrypt() { dispose(); return deny(); },
      async decrypt(request) {
        let plaintext: Uint8Array | undefined;
        try {
          io.check(); if (used || disposed) return deny(); used = true;
          plaintext = await adapter.decrypt(request);
          io.check(); if (disposed) return deny();
          return plaintext;
        } catch { plaintext?.fill(0); return deny(); }
        finally { dispose(); }
      }
    });
    return Object.freeze({ kms, dispose });
  } catch { return deny(); }
}

/** Explicit bootstrap reads exactly this capability's pinned dedicated DB
 * secret. It cannot select another role or the application secret. Returned DSN
 * stays in memory; the caller must validate DSN and native session_user before
 * using the connection. Broker bootstrap continues to use the existing path. */
export async function readSquareGcpMappedDatabaseSecret(input: Readonly<{
  binding: SquareGcpMappedBinding; identity: SquareGcpCallbackIdentity; network: typeof fetch; signal: AbortSignal;
}>): Promise<string> {
  let io: ReturnType<typeof createSquareGcpCallbackIo> | undefined, identity: SquareGcpCallbackIdentity | undefined;
  try {
    const args = squareGcpCallbackDependencies(input, ["binding", "identity", "network", "signal"]);
    const binding = checkedSquareGcpMappedBinding(args.binding);
    if (binding.capability !== "enroller" && binding.capability !== "runtime") return deny();
    const resource = squareGcpMappedDatabaseSecret(binding, binding.capability);
    identity = identityDependency(args.identity);
    io = createSquareGcpCallbackIo({ network: args.network as typeof fetch, signal: args.signal as AbortSignal });
    return await identity.withAccessToken(async access => {
      const reply = await io!.json(`https://secretmanager.googleapis.com/v1/${resource}:access`, {
        method: "GET", headers: { Authorization: `Bearer ${access}` }
      }, WIRE_BYTES);
      if (Object.keys(reply).some(key => !["name", "payload"].includes(key)) ||
        reply.name !== resource && reply.name !== resource.replace(`projects/${binding.gcpProjectId}/`, `projects/${binding.gcpProjectNumber}/`)) return deny();
      const payload = reply.payload;
      if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
        Object.keys(payload).some(key => !["data", "dataCrc32c"].includes(key))) return deny();
      const bytes = Buffer.from(base64((payload as Record<string, unknown>).data, 8_192), "base64");
      try {
        const dsn = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (!dsn.startsWith("postgresql://") || /[\u0000-\u0020\u007f]/.test(dsn)) return deny();
        io!.check(); checkedSquareGcpMappedBinding(binding);
        return dsn;
      } finally { bytes.fill(0); }
    });
  } catch { return deny(); }
  finally { io?.dispose(); identity?.dispose(); }
}
