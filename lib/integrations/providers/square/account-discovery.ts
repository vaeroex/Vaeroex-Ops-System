import "server-only";

import { isProxy } from "node:util/types";
import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { ProviderAccessCredential, type AuthorizedProviderEntityVerifier } from "@/lib/integrations/credentials/broker";
import { AuthorizedProviderEntityEvidenceSchema } from "@/lib/integrations/credentials/oauth-policy";
import {
  SquareAccountEnvironmentSchema, SquareVerifiedDiscoverySchema,
  type SquareVerifiedDiscovery
} from "@/lib/integrations/providers/square/account-connection-contracts";
import { SQUARE_API_VERSION, SQUARE_MINIMUM_READ_SCOPES } from "@/lib/integrations/providers/square/contracts";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";
import { parseSquareLocationResponse } from "@/lib/integrations/providers/square/location-responses";
import { parseSquareMerchantResponse } from "@/lib/integrations/providers/square/merchant-responses";
import { squareSafeJsonObject } from "@/lib/integrations/providers/square/response-validation";
import { reportSquareConsentProgress, type SquareConsentObserver } from "./account-connection-progress";

export type SquareAccountDiscoveryPath = "/v2/merchants/me" | "/v2/locations" | "/v2/locations/main";
/** An injected bounded GET adapter, never a default fetch or credential lookup. */
export type SquareAccountAuthenticatedRead = (input: Readonly<{
  environment: "sandbox" | "production";
  path: SquareAccountDiscoveryPath;
  accessToken: string;
  signal?: AbortSignal;
}>) => PromiseLike<unknown>;

// Derived from current implemented schemas, before fixtures: ListLocations has
// L<=500, one outer object/array/provenance plus 3 containers per item (item,
// authority, provenance), so 3+3L<=1503 expanded containers. Retrieve merchant
// and main location each add 6: all three projections total <=1515, even when
// every provenance occurrence is shared. The minimized handoff has exactly
// 2+L<=502 containers and 10+4L<=2010 values. Its maximum 255-character IDs/
// labels and 512-character application ID fit <2MiB even at six escaped bytes
// per UTF-16 code unit. Optional raw fields never add handoff containers.
// Account seller IDs are the intersection of the merchant/OAuth (191), generic
// authority evidence (128), and unchanged durable ingestion (100) contracts.
// Evidence also requires an alphanumeric first character; discovery refuses an
// unsupported account before any credential/discovery storage or mapping.
export const SQUARE_ACCOUNT_DISCOVERY_BOUNDS = Object.freeze({
  maximumLocations: 500, maximumParserContainers: 1_515,
  maximumContainers: 502, maximumValues: 2_010, maximumBytes: 2 * 1_024 * 1_024
});
const HANDOFF_LIMITS = Object.freeze({
  containers: 502, values: 2_010, bytes: 2 * 1_024 * 1_024,
  depth: 3, arrayLength: 500, properties: 16, stringLength: 512
});
const REQUIRED_SCOPES = Object.freeze([...SQUARE_MINIMUM_READ_SCOPES].sort());
function denied(): never { throw new Error("square_account_discovery_denied"); }

/**
 * The legacy Merchant/Location minimizers remain unchanged. This descriptor-only
 * preflight protects their raw-input boundary without applying the durable
 * integer-only projection guard to legitimate discarded fractional coordinates.
 * Expanded occurrences count, with exactly the existing raw 20k/depth12/array1k
 * property64/string4096 limits and the read policy's 16MiB byte cap.
 */
function inspectRaw(value: unknown) {
  const active = new Set<object>();
  let values = 0, bytes = 0;
  const charge = (count: number) => { bytes += count; if (bytes > 16 * 1_024 * 1_024) denied(); };
  const visit = (current: unknown, depth: number): void => {
    if (++values > 20_000 || depth > 12) denied();
    if (current === null || typeof current === "boolean") { charge(JSON.stringify(current).length); return; }
    if (typeof current === "string") {
      if (current.length > 4_096) denied();
      charge(Buffer.byteLength(JSON.stringify(current), "utf8")); return;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current) || Math.abs(current) > Number.MAX_SAFE_INTEGER || Object.is(current, -0)) denied();
      charge(JSON.stringify(current).length); return;
    }
    if (typeof current !== "object" || isProxy(current) || active.has(current)) denied();
    const array = Array.isArray(current), proto = Object.getPrototypeOf(current);
    if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) denied();
    const keys = Reflect.ownKeys(current);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(current, "length");
      if (!length || !("value" in length) || length.value > 1_000 || keys.length !== length.value + 1) denied();
      for (let i = 0; i < length.value; i++) if (!Object.hasOwn(current, String(i))) denied();
    } else if (keys.length > 64) denied();
    charge(2); active.add(current);
    let count = 0;
    try {
      for (const key of keys) {
        if (array && key === "length") continue;
        if (typeof key !== "string" || key.length > 128 || ["__proto__", "constructor", "prototype"].includes(key)) denied();
        const property = Object.getOwnPropertyDescriptor(current, key);
        if (!property?.enumerable || !("value" in property)) denied();
        if (count++ > 0) charge(1);
        if (!array) charge(Buffer.byteLength(JSON.stringify(key), "utf8") + 1);
        visit(property.value, depth + 1);
      }
    } finally { active.delete(current); }
  };
  visit(value, 0);
}

function envelope(raw: unknown, key: "merchant" | "locations" | "location") {
  inspectRaw(raw);
  const safe = squareSafeJsonObject(raw);
  if (!Object.hasOwn(safe, key) || Object.keys(safe).some(name => name !== key && name !== "errors")) denied();
  // ListLocations' pinned contract says errors and locations never coexist.
  if (key === "locations" && Object.hasOwn(safe, "errors")) denied();
  if (key !== "locations" && (safe[key] === null || Array.isArray(safe[key]) || typeof safe[key] !== "object")) denied();
  return safe;
}

export function createSquareAccountDiscovery(input: Readonly<{
  environment: "sandbox" | "production";
  applicationId: string;
  readAuthenticated: SquareAccountAuthenticatedRead;
  clock?: () => Date;
  signal?: AbortSignal;
  observeConsent?: SquareConsentObserver;
}>): AuthorizedProviderEntityVerifier & Readonly<{ consumeVerifiedDiscovery(): SquareVerifiedDiscovery }> {
  const environment = SquareAccountEnvironmentSchema.parse(input.environment);
  const applicationId = input.applicationId;
  if (typeof applicationId !== "string" || applicationId.length < 8 || applicationId.length > 512 ||
      typeof input.readAuthenticated !== "function" || isProxy(input.readAuthenticated)) denied();
  const read = input.readAuthenticated, clock = input.clock ?? (() => new Date()), signal = input.signal;
  const observeConsent = environment === "sandbox" ? input.observeConsent : undefined;
  let state: "fresh" | "running" | "ready" | "consumed" | "failed" = "fresh";
  let discovery: SquareVerifiedDiscovery | null = null;
  const check = () => { if (signal?.aborted) denied(); };
  return Object.freeze({
    async verify(invocation): Promise<unknown> {
      if (state !== "fresh") denied();
      state = "running";
      try {
        check();
        if (!invocation || isProxy(invocation)) denied();
        const descriptors = Object.getOwnPropertyDescriptors(invocation);
        if (Reflect.ownKeys(descriptors).length !== 2 || !["credential", "externalAuthorizedEntityReference"].every(key =>
          descriptors[key]?.enumerable && "value" in descriptors[key])) denied();
        const merchantId: unknown = descriptors.externalAuthorizedEntityReference.value;
        const credential: unknown = descriptors.credential.value;
        if (typeof merchantId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(merchantId) ||
            !credential || typeof credential !== "object" || isProxy(credential) || !(credential instanceof ProviderAccessCredential)) denied();
        const metadata = Object.getOwnPropertyDescriptors(credential);
        for (const key of ["providerKey", "providerEnvironment", "accessExpiresAt", "grantedScopes"]) {
          if (!metadata[key]?.enumerable || !("value" in metadata[key])) denied();
        }
        const scopes = snapshotSquareDurableJson(metadata.grantedScopes.value, {
          containers: 1, values: 6, bytes: 512, depth: 1, arrayLength: 5, properties: 0, stringLength: 64
        }) as readonly string[];
        if (metadata.providerKey.value !== "square" || metadata.providerEnvironment.value !== environment ||
            scopes.length !== REQUIRED_SCOPES.length || scopes.some((scope, index) => scope !== REQUIRED_SCOPES[index]) ||
            typeof metadata.accessExpiresAt.value !== "string" || Date.parse(metadata.accessExpiresAt.value) <= clock().getTime() ||
            !Number.isFinite(Date.parse(metadata.accessExpiresAt.value))) denied();
        const accessExpiresAt = Date.parse(metadata.accessExpiresAt.value);
        const validCredential = () => {
          check();
          if (accessExpiresAt <= clock().getTime()) denied();
        };
        const value = await ProviderAccessCredential.prototype.use.call(credential, async ({ accessToken }) => {
          const request = async (path: SquareAccountDiscoveryPath, key: "merchant" | "locations" | "location") => {
            validCredential();
            reportSquareConsentProgress(observeConsent, key === "merchant" ? "merchant_request" : key === "locations" ? "locations_request" : "main_location_request");
            const raw = await read(Object.freeze({ environment, path, accessToken, ...(signal ? { signal } : {}) }));
            reportSquareConsentProgress(observeConsent, key === "merchant" ? "merchant_validation" : key === "locations" ? "locations_validation" : "main_location_validation");
            validCredential(); return envelope(raw, key);
          };
          const parser = (response: unknown) => ({ providerKey: "square" as const, providerEnvironment: environment, apiVersion: SQUARE_API_VERSION, response });
          const merchant = parseSquareMerchantResponse(parser(await request("/v2/merchants/me", "merchant")));
          if (merchant.outcome !== "accepted" || merchant.value.items.length !== 1) denied();
          const seller = merchant.value.items[0];
          if (seller.id !== merchantId || seller.status !== "ACTIVE") denied();
          reportSquareConsentProgress(observeConsent, "merchant_verified");
          const listed = parseSquareLocationResponse(parser(await request("/v2/locations", "locations")));
          if (listed.outcome !== "accepted" || listed.value.items.length === 0) denied();
          reportSquareConsentProgress(observeConsent, "locations_validated");
          const main = parseSquareLocationResponse(parser(await request("/v2/locations/main", "location")));
          if (main.outcome !== "accepted" || main.value.items.length !== 1) denied();
          reportSquareConsentProgress(observeConsent, "discovery_verification");
          const primary = main.value.items[0];
          if (primary.status !== "ACTIVE" || primary.merchantId !== null && primary.merchantId !== seller.id ||
              seller.mainLocationId !== null && seller.mainLocationId !== primary.id ||
              listed.value.items.some(item => item.merchantId !== null && item.merchantId !== seller.id)) denied();
          const listedMain = listed.value.items.find(item => item.id === primary.id);
          if (!listedMain || listedMain.status !== "ACTIVE" || listedMain.country !== primary.country || listedMain.currency !== primary.currency) denied();
          const unsigned = {
            contractVersion: "square_verified_discovery_v1" as const, environment, applicationId,
            merchantId: seller.id, merchantLabel: seller.displayName ?? "Square seller", defaultLocationId: primary.id,
            locations: listed.value.items.map(item => ({ id: item.id, label: item.displayName ?? "Square location", status: item.status }))
              .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
            verifiedAt: clock().toISOString()
          };
          return SquareVerifiedDiscoverySchema.parse({
            ...unsigned, fingerprint: contractSha256({ purpose: "square_authenticated_account_discovery_v1", ...unsigned })
          });
        });
        validCredential();
        discovery = snapshotSquareDurableJson(value, HANDOFF_LIMITS) as SquareVerifiedDiscovery;
        const evidence = Object.freeze(AuthorizedProviderEntityEvidenceSchema.parse({
          providerKey: "square", providerEnvironment: environment, externalAuthorizedEntityReference: discovery.merchantId,
          providerEntityType: "merchant", safeDisplayName: discovery.merchantLabel, verificationFingerprint: discovery.fingerprint
        }));
        state = "ready";
        reportSquareConsentProgress(observeConsent, "discovery_verified");
        return evidence;
      } catch {
        discovery = null; state = "failed"; denied();
      }
    },
    consumeVerifiedDiscovery() {
      if (state !== "ready" || discovery === null) denied();
      if (signal?.aborted) { discovery = null; state = "failed"; denied(); }
      const result = discovery; discovery = null; state = "consumed";
      return result;
    }
  });
}
