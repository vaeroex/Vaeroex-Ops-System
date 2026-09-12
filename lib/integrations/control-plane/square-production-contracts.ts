import "server-only";

import { z } from "zod";

import {
  KmsCryptoKeyResourceSchema,
  SecretManagerVersionResourceSchema
} from "@/lib/integrations/credentials/contracts";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";
import { SQUARE_OAUTH_SCOPES } from "@/lib/integrations/providers/square/account-connection-oauth";

export const SQUARE_PRODUCTION_BINDING_VERSION = "square_production_runtime_binding_v1" as const;
export const SQUARE_PRODUCTION_API_VERSION = "2026-08-19" as const;
export const SQUARE_PRODUCTION_REQUIRED_SCOPES = Object.freeze([
  "INVENTORY_READ",
  "ITEMS_READ",
  "MERCHANT_PROFILE_READ",
  "ORDERS_READ",
  "PAYMENTS_READ"
] as const);

const ServiceAccountSchema = z.string()
  .max(254)
  .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/);
const LoginSchema = z.string().max(63).regex(/^square_production_[a-z_]{1,39}$/);
function isApprovedProductionHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized.includes(".") &&
    !normalized.includes(":") &&
    !/^\d+(?:\.\d+){3}$/.test(normalized) &&
    !/(?:sandbox|preview|localhost)/.test(normalized) &&
    !/(?:^|\.)sslip\.io$/.test(normalized) &&
    !/^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(normalized);
}
const HttpsOriginSchema = z.string().url().max(2_048).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    url.pathname === "/" && !url.search && !url.hash && url.origin === value &&
    isApprovedProductionHostname(url.hostname);
});
const HttpsCallbackSchema = z.string().url().max(2_048).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.port &&
    url.pathname === "/api/integrations/square/callback" && !url.search && !url.hash &&
    isApprovedProductionHostname(url.hostname);
});

const ProductionBindingSchema = z.object({
  contractVersion: z.literal(SQUARE_PRODUCTION_BINDING_VERSION),
  environment: z.literal("production"),
  apiVersion: z.literal(SQUARE_PRODUCTION_API_VERSION),
  applicationId: z.string().min(8).max(191).regex(/^sq0idp-[A-Za-z0-9_-]+$/),
  applicationOrigin: HttpsOriginSchema,
  callbackOrigin: HttpsOriginSchema,
  callbackUri: HttpsCallbackSchema,
  authorizationEndpoint: z.literal("https://connect.squareup.com/oauth2/authorize"),
  providerOrigin: z.literal("https://connect.squareup.com"),
  scopes: z.tuple([
    z.literal("INVENTORY_READ"), z.literal("ITEMS_READ"),
    z.literal("MERCHANT_PROFILE_READ"), z.literal("ORDERS_READ"),
    z.literal("PAYMENTS_READ")
  ]),
  projectId: z.string().min(6).max(30).regex(/^[a-z][a-z0-9-]+[a-z0-9]$/),
  projectNumber: z.string().regex(/^[1-9][0-9]{5,19}$/),
  region: z.string().regex(/^[a-z]+-[a-z]+[0-9]$/),
  kmsKeyResource: KmsCryptoKeyResourceSchema,
  applicationSecretVersionResource: SecretManagerVersionResourceSchema,
  webhookSignatureVersionResource: SecretManagerVersionResourceSchema,
  databaseSecretVersionResources: z.object({
    oauth: SecretManagerVersionResourceSchema,
    broker: SecretManagerVersionResourceSchema,
    scheduler: SecretManagerVersionResourceSchema,
    webhook: SecretManagerVersionResourceSchema,
    runtime: SecretManagerVersionResourceSchema,
    evidence: SecretManagerVersionResourceSchema
  }).strict(),
  serviceAccounts: z.object({
    oauth: ServiceAccountSchema,
    broker: ServiceAccountSchema,
    scheduler: ServiceAccountSchema,
    webhook: ServiceAccountSchema,
    runtime: ServiceAccountSchema,
    evidence: ServiceAccountSchema,
    taskInvoker: ServiceAccountSchema
  }).strict(),
  databaseLogins: z.object({
    oauth: LoginSchema,
    broker: LoginSchema,
    scheduler: LoginSchema,
    webhook: LoginSchema,
    runtime: LoginSchema,
    evidence: LoginSchema
  }).strict(),
  queueResource: z.string().max(512).regex(/^projects\/[a-z][a-z0-9-]+[a-z0-9]\/locations\/[a-z]+-[a-z]+[0-9]\/queues\/square-production-[a-z0-9-]+$/),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  enabled: z.literal(true),
  providerCallsEnabled: z.boolean(),
  customerOnboardingEnabled: z.boolean(),
  evidenceEnabled: z.boolean(),
  economicContributionsEnabled: z.literal(false),
  aiDispatchEnabled: z.literal(false),
  approvalExpiresAt: z.string().datetime({ offset: true })
}).strict().superRefine((value, context) => {
  if (new Set(Object.values(value.serviceAccounts)).size !== Object.keys(value.serviceAccounts).length) {
    context.addIssue({ code: "custom", message: "service identities must be distinct" });
  }
  if (new Set(Object.values(value.databaseLogins)).size !== Object.keys(value.databaseLogins).length) {
    context.addIssue({ code: "custom", message: "database logins must be distinct" });
  }
  if (new URL(value.callbackUri).origin !== value.callbackOrigin) {
    context.addIssue({ code: "custom", message: "callback origin mismatch" });
  }
  const expectedProjectPrefix = `projects/${value.projectId}/`;
  const expectedServiceAccountSuffix = `@${value.projectId}.iam.gserviceaccount.com`;
  if (!value.kmsKeyResource.startsWith(`${expectedProjectPrefix}locations/${value.region}/`)) {
    context.addIssue({ code: "custom", message: "KMS project or region mismatch" });
  }
  for (const resource of [value.applicationSecretVersionResource, value.webhookSignatureVersionResource,
    ...Object.values(value.databaseSecretVersionResources)]) {
    if (!resource.startsWith(expectedProjectPrefix)) {
      context.addIssue({ code: "custom", message: "secret project mismatch" });
    }
  }
  for (const account of Object.values(value.serviceAccounts)) {
    if (!account.endsWith(expectedServiceAccountSuffix)) {
      context.addIssue({ code: "custom", message: "service identity project mismatch" });
    }
  }
  if (!value.queueResource.startsWith(`${expectedProjectPrefix}locations/${value.region}/`)) {
    context.addIssue({ code: "custom", message: "queue project or region mismatch" });
  }
  if ((value.customerOnboardingEnabled || value.evidenceEnabled) && !value.providerCallsEnabled) {
    context.addIssue({ code: "custom", message: "dependent gate opened without provider calls" });
  }
});

export type SquareProductionBinding = Readonly<z.infer<typeof ProductionBindingSchema>>;

/** Representation validation only. Database session_user checks and deployment
 * identity establish authority; no serialized binding grants a capability. */
export function checkedSquareProductionBinding(raw: unknown, now = Date.now()): SquareProductionBinding {
  const value = snapshotSquareDurableJson(raw, {
    containers: 5,
    values: 80,
    bytes: 65_536,
    depth: 2,
    arrayLength: 5,
    properties: 48,
    stringLength: 2_048
  });
  const checked = ProductionBindingSchema.parse(value);
  if (!Number.isSafeInteger(now) || Date.parse(checked.approvalExpiresAt) <= now ||
    checked.applicationSecretVersionResource.endsWith("/latest") ||
    checked.webhookSignatureVersionResource.endsWith("/latest") ||
    Object.values(checked.databaseSecretVersionResources).some((resource) => resource.endsWith("/latest")) ||
    checked.kmsKeyResource.includes("vaeroex-square-sandbox") ||
    checked.projectId.includes("sandbox")) {
    throw new Error("square_production_binding_denied");
  }
  if (JSON.stringify(SQUARE_PRODUCTION_REQUIRED_SCOPES) !== JSON.stringify(SQUARE_OAUTH_SCOPES)) {
    throw new Error("square_production_scope_contract_mismatch");
  }
  return value as SquareProductionBinding;
}

/** A deployment candidate is a negative gate, never authorization. Production
 * capabilities still require the checked binding, exact service identity and
 * actual least-privilege database LOGIN. */
export function squareProductionCandidate() {
  return process.env.NODE_ENV === "production" &&
    process.env.SQUARE_PRODUCTION_RUNTIME === "configured" &&
    process.env.SQUARE_ENVIRONMENT === "production" &&
    process.env.SQUARE_API_VERSION === SQUARE_PRODUCTION_API_VERSION &&
    process.env.SQUARE_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED === "false";
}
