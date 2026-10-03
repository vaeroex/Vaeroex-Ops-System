import "server-only";

import { timingSafeEqual } from "node:crypto";
import { isProxy } from "node:util/types";
import { canonicalContractJson } from "@/lib/integrations/contracts/canonical";
import { CredentialAadContextSchema, type CredentialAadContext } from "@/lib/integrations/credentials/contracts";
import { credentialAad, GoogleCloudKmsCredentialAdapter } from "@/lib/integrations/credentials/kms";
import { GoogleSecretManagerProviderSecrets } from "@/lib/integrations/credentials/secret-manager";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";
import { checkedSquareRemoteSandboxBinding, type SquareRemoteSandboxBinding } from "./square-remote-sandbox-contracts";

export type SquareEnrolledCredentialPurpose = "application_secret" | "credential_encrypt" | "credential_decrypt";

/** A trusted server dependency, not an enrollment assertion supplied by a caller.
 * Each invocation MUST consult checked database broker/task state using the actual
 * dedicated LOGIN and verify oauth_verified enrollment, current credential and
 * connection generation, mappings, retention, policy and the remote approval.
 * Neither an environment variable nor a deserialized grant can implement this.
 * There is deliberately no production constructor/composition for this capability
 * yet. In particular, first consent and webhook-only access are NOT exemptions.
 */
export type SquareCurrentEnrollmentAuthority = (request: Readonly<{
  context: CredentialAadContext;
  purpose: SquareEnrolledCredentialPurpose;
  signal: AbortSignal;
}>) => Promise<SquareRemoteSandboxBinding>;

const DENIED = "square_remote_sandbox_credentials_denied";
const WIRE_BYTES = 256 * 1024;
const STEP_MS = 5_000;
const SESSION_MS = 60_000;
const MAX_OPERATIONS = 32;
const CLOUD_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token";

function deny(): never { throw new Error(DENIED); }
function plain(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return deny();
  return value as Record<string, unknown>;
}
function token(value: unknown) {
  if (typeof value !== "string" || !/^[\x21-\x7e]{1,16384}$/.test(value)) return deny();
  return value;
}
function base64(value: unknown, maxBytes: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4 * Math.ceil(maxBytes / 3) ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return deny();
  const bytes = Buffer.from(value, "base64");
  try { if (bytes.length > maxBytes || bytes.toString("base64") !== value) return deny(); }
  finally { bytes.fill(0); }
  return value;
}
function secretResponseMatchesRequest(responseName: unknown, requestedName: string) {
  if (responseName === requestedName) return true;
  if (typeof responseName !== "string") return false;
  const parts = responseName.split("/");
  // Google resource responses support project IDs and canonical project numbers.
  // The authenticated, nonredirected request to the approved ID/version remains
  // the authority; this response name never becomes a binding or another URL.
  // First-party response parser: github.com/firebase/firebase-tools/blob/master/src/gcp/secretManager.ts
  return parts.length === 6 && parts[0] === "projects" && /^[1-9][0-9]{0,19}$/.test(parts[1]) &&
    parts.slice(2).join("/") === requestedName.split("/").slice(2).join("/");
}

/** Code-only, request-scoped adapter for ALREADY verified/enrolled credentials.
 * It is not imported by route availability and cannot discover any credentials:
 * network, current-enrollment authority and signed deployment verification are
 * mandatory injected server capabilities. There is no fetch, ADC, metadata-server,
 * CLI, credential-file or environment-token fallback, token cache, or retry.
 *
 * Bound: the existing largest ciphertext is 131,072 bytes => 174,764 base64
 * characters. Existing AAD <=4,096 bytes =>5,464 characters. Their fixed JSON
 * envelope is <181KiB, below this conservative 256KiB wire cap. Plaintext <=32KiB
 * and Secret Manager <=64KiB decoded are smaller. A single fixed collector,
 * one current transport chunk, UTF-8 string and parsed JSON may coexist; no
 * per-character/chunk collection is retained. The 256KiB collector is not total
 * heap: bounded strings, parsed replies and temporary base64/AAD buffers can
 * coexist. These are all limited by the wire/field caps, with no token cache.
 * Returned existing secret/credential objects remain the broker caller's private
 * responsibility; JS immutable strings cannot be reliably zeroized.
 */
export function createSquareRemoteSandboxEnrolledCredentials(input: Readonly<{
  binding: SquareRemoteSandboxBinding;
  credentialContext: CredentialAadContext;
  authorizeCurrentEnrollment: SquareCurrentEnrollmentAuthority;
  verifyDeployment: (binding: SquareRemoteSandboxBinding) => Promise<string>;
  network: typeof fetch;
  signal: AbortSignal;
}>) {
  if (!input || isProxy(input)) return deny();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = ["binding", "credentialContext", "authorizeCurrentEnrollment", "verifyDeployment", "network", "signal"];
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !descriptors[key]?.enumerable || !("value" in descriptors[key]))) return deny();
  const binding = checkedSquareRemoteSandboxBinding(descriptors.binding.value);
  if (!binding.providerCallsEnabled || !binding.kmsKeyResource || !binding.appSecretVersionResource ||
    !binding.credentialServiceAccount || !binding.workloadIdentityAudience) return deny();
  const context = CredentialAadContextSchema.parse(snapshotSquareDurableJson(descriptors.credentialContext.value, {
    containers: 1, values: 10, bytes: 4096, depth: 1, arrayLength: 0, properties: 9, stringLength: 128
  }));
  Object.freeze(context);
  if (context.providerKey !== "square" || context.environment !== "sandbox" || context.workspaceId !== binding.workspaceId) return deny();
  const authorize = descriptors.authorizeCurrentEnrollment.value as SquareCurrentEnrollmentAuthority;
  const verify = descriptors.verifyDeployment.value as (binding: SquareRemoteSandboxBinding) => Promise<string>;
  const network = descriptors.network.value as typeof fetch;
  const signal = descriptors.signal.value as AbortSignal;
  if (typeof authorize !== "function" || isProxy(authorize) || typeof verify !== "function" || isProxy(verify) ||
    typeof network !== "function" || isProxy(network) || !(signal instanceof AbortSignal) || signal.aborted) return deny();

  const expectedBinding = canonicalContractJson(binding);
  const expectedAad = credentialAad(context);
  const deadline = Date.now() + SESSION_MS;
  let disposed = false, busy = false, operations = 0;
  let activeController: AbortController | undefined;
  const dispose = () => { disposed = true; expectedAad.fill(0); activeController?.abort(); };
  const live = () => { if (disposed || signal.aborted || Date.now() >= deadline) return deny(); };

  async function operation<T>(purpose: SquareEnrolledCredentialPurpose, work: (cloud: (url: string, body?: object) => Promise<Record<string, unknown>>) => Promise<T>): Promise<T> {
    live();
    if (busy || ++operations > MAX_OPERATIONS) return deny();
    busy = true;
    const controller = new AbortController();
    activeController = controller;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    let activeWait: (() => void) | undefined;
    const rejectWait = () => activeWait?.();
    controller.signal.addEventListener("abort", rejectWait);
    const sessionTimer = setTimeout(abort, Math.max(1, deadline - Date.now()));
    const check = () => { live(); if (controller.signal.aborted) return deny(); };
    // One replaceable wait; no reactions accumulate on a shared cancellation
    // promise as reads progress. Late completion can only dispose a response.
    async function wait<V>(start: () => PromiseLike<V>, late?: (value: V) => void): Promise<V> {
      check();
      return new Promise<V>((resolve, reject) => {
        let settled = false;
        const fail = () => { if (!settled) { settled = true; activeWait = undefined; clearTimeout(timer); reject(new Error(DENIED)); } };
        const timer = setTimeout(() => { controller.abort(); fail(); }, STEP_MS);
        activeWait = fail;
        const cleanupLate = (value: V) => { try { late?.(value); } catch { /* cleanup cannot expose a dependency failure */ } };
        let pending: PromiseLike<V>;
        try { pending = start(); } catch { fail(); return; }
        Promise.resolve(pending).then(value => {
          if (settled) { cleanupLate(value); return; }
          settled = true; activeWait = undefined; clearTimeout(timer);
          try { check(); resolve(value); } catch { cleanupLate(value); reject(new Error(DENIED)); }
        }, () => { fail(); });
      });
    }
    const recheck = async () => {
      check();
      const current = await wait(() => authorize(Object.freeze({ context, purpose, signal: controller.signal })));
      if (canonicalContractJson(checkedSquareRemoteSandboxBinding(current)) !== expectedBinding) return deny();
      check();
    };
    const cancelResponse = (response: Response) => { void response.body?.cancel().catch(() => undefined); };
    async function json(url: string, body: object | undefined, bearer?: string) {
      await recheck();
      const serialized = body === undefined ? undefined : JSON.stringify(body);
      if (serialized && Buffer.byteLength(serialized) > WIRE_BYTES) return deny();
      const response = await wait(() => network(url, {
        method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store", credentials: "omit",
        headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
        body: serialized, signal: controller.signal
      }), cancelResponse);
      if (!response.ok || response.redirected || (response.url && response.url !== url) || !response.body) { cancelResponse(response); return deny(); }
      const declared = response.headers.get("content-length");
      if (declared !== null && (!/^[0-9]{1,9}$/.test(declared) || Number(declared) > WIRE_BYTES)) { cancelResponse(response); return deny(); }
      const bytes = new Uint8Array(WIRE_BYTES), reader = response.body.getReader();
      let count = 0;
      try {
        while (true) {
          const part = await wait(() => reader.read());
          if (part.done) break;
          if (!(part.value instanceof Uint8Array) || part.value.byteLength > WIRE_BYTES - count) return deny();
          bytes.set(part.value, count); count += part.value.byteLength;
        }
        check();
        return plain(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count))));
      } finally {
        bytes.fill(0);
        void reader.cancel().catch(() => undefined);
        try { reader.releaseLock(); } catch { /* outstanding cancelled read owns release */ }
      }
    }
    try {
      await recheck();
      let oidc = token(await wait(() => verify(binding)));
      const sts = await json("https://sts.googleapis.com/v1/token", {
        grantType: "urn:ietf:params:oauth:grant-type:token-exchange", audience: binding.workloadIdentityAudience,
        scope: CLOUD_SCOPE, requestedTokenType: ACCESS_TOKEN_TYPE, subjectToken: oidc,
        subjectTokenType: "urn:ietf:params:oauth:token-type:jwt"
      });
      oidc = "";
      if (sts.token_type !== "Bearer" || sts.issued_token_type !== ACCESS_TOKEN_TYPE ||
        !Number.isInteger(sts.expires_in) || (sts.expires_in as number) <= 0 || (sts.expires_in as number) > 3600) return deny();
      let federated = token(sts.access_token); delete sts.access_token;
      const impersonated = await json(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${binding.credentialServiceAccount}:generateAccessToken`, {
        scope: [CLOUD_SCOPE], lifetime: "300s"
      }, federated);
      federated = "";
      const expires = typeof impersonated.expireTime === "string" ? Date.parse(impersonated.expireTime) : NaN;
      if (!Number.isFinite(expires) || expires <= Date.now() || expires > Date.now() + 300_000) return deny();
      let access = token(impersonated.accessToken); delete impersonated.accessToken;
      try {
        const result = await work(async (url, body) => { if (Date.now() >= expires) return deny(); return json(url, body, access); });
        await recheck();
        return result;
      } finally { access = ""; }
    } catch { dispose(); throw new Error(DENIED); }
    finally {
      clearTimeout(sessionTimer); signal.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", rejectWait); activeWait = undefined;
      controller.abort(); activeController = undefined; busy = false;
    }
  }

  const secrets = new GoogleSecretManagerProviderSecrets({
    resources: { "square:sandbox": binding.appSecretVersionResource },
    transport: { accessSecretVersion: async ({ name }) => operation("application_secret", async cloud => {
      if (name !== binding.appSecretVersionResource) return deny();
      const response = await cloud(`https://secretmanager.googleapis.com/v1/${name}:access`);
      if (!secretResponseMatchesRequest(response.name, name)) return deny();
      return { payload: { data: base64(plain(response.payload).data, 65_536) } };
    }) }
  });
  const kms = new GoogleCloudKmsCredentialAdapter({ allowedKeyResource: binding.kmsKeyResource, transport: {
    encrypt: async ({ name, plaintext, additionalAuthenticatedData }) => {
      checkAad(additionalAuthenticatedData);
      return operation("credential_encrypt", async cloud => {
        const result = await cloud(`https://cloudkms.googleapis.com/v1/${name}:encrypt`, { plaintext, additionalAuthenticatedData });
        return { ciphertext: base64(result.ciphertext, 131_072) };
      });
    },
    decrypt: async ({ name, ciphertext, additionalAuthenticatedData }) => {
      checkAad(additionalAuthenticatedData);
      return operation("credential_decrypt", async cloud => {
        const result = await cloud(`https://cloudkms.googleapis.com/v1/${name}:decrypt`, { ciphertext, additionalAuthenticatedData });
        return { plaintext: base64(result.plaintext, 32_768) };
      });
    }
  } });
  function checkAad(encoded: string) {
    const bytes = Buffer.from(base64(encoded, 4096), "base64");
    try { if (bytes.length !== expectedAad.length || !timingSafeEqual(bytes, expectedAad)) return deny(); }
    finally { bytes.fill(0); }
  }
  return Object.freeze({
    kms,
    secrets: Object.freeze({ async access(provider: string, environment: string) {
      if (provider !== "square" || environment !== "sandbox") return deny();
      const value = await secrets.access(provider, environment);
      if (!value.use(secret => secret.clientId === binding.applicationId)) { dispose(); return deny(); }
      return value;
    } }),
    dispose
  });
}
