import "server-only";

import { z } from "zod";

import {
  KmsCryptoKeyResourceSchema,
  SecretManagerVersionResourceSchema
} from "@/lib/integrations/credentials/contracts";

export const PRODUCTION_INTEGRATION_PLATFORM_VERSION =
  "production_integration_platform_v1" as const;
export const PRODUCTION_PROVIDER_ISOLATION_VERSION =
  "production_provider_isolation_v1" as const;

export const ProductionProviderKeySchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

const ProjectIdSchema = z.string()
  .min(6)
  .max(30)
  .regex(/^[a-z][a-z0-9-]+[a-z0-9]$/)
  .refine((value) => !/(?:sandbox|preview|qualification)/i.test(value));
const RegionSchema = z.string().regex(/^[a-z]+-[a-z]+[0-9]$/);
const ResourceNameSchema = z.string().min(1).max(63).regex(/^[a-z][a-z0-9-]*[a-z0-9]$/);
const ServiceAccountSchema = z.string()
  .max(254)
  .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/);
const LoginSchema = z.string().max(63).regex(/^[a-z][a-z0-9_]*$/);
const ShaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const VersionSchema = z.string().min(1).max(128).regex(/^[a-z][a-z0-9_]*_v[1-9][0-9]*$/);

export const ProductionPlatformBindingSchema = z.object({
  contractVersion: z.literal(PRODUCTION_INTEGRATION_PLATFORM_VERSION),
  environment: z.literal("production"),
  projectId: ProjectIdSchema,
  projectNumber: z.string().regex(/^[1-9][0-9]{5,19}$/),
  region: RegionSchema,
  sharedResources: z.object({
    network: ResourceNameSchema,
    subnet: ResourceNameSchema,
    router: ResourceNameSchema,
    nat: ResourceNameSchema,
    egressAddress: ResourceNameSchema,
    ingressAddress: ResourceNameSchema,
    taskQueue: ResourceNameSchema,
    artifactRepository: ResourceNameSchema
  }).strict(),
  databaseAuthorityTarget: z.literal("existing_production_postgres"),
  runtimePolicyVersion: VersionSchema,
  retentionPolicyVersion: VersionSchema,
  observabilityPolicyVersion: VersionSchema,
  backupPolicyVersion: VersionSchema,
  sourceCommit: ShaSchema,
  infrastructureProvisioned: z.literal(false),
  runtimeEnabled: z.literal(false),
  economicContributionsEnabled: z.literal(false),
  aiDispatchEnabled: z.literal(false)
}).strict().superRefine((value, context) => {
  if (new Set(Object.values(value.sharedResources)).size !== Object.keys(value.sharedResources).length) {
    context.addIssue({ code: "custom", message: "shared resource names must be distinct" });
  }
});

export const ProductionProviderIsolationSchema = z.object({
  contractVersion: z.literal(PRODUCTION_PROVIDER_ISOLATION_VERSION),
  providerKey: ProductionProviderKeySchema,
  environment: z.literal("production"),
  applicationId: z.string().min(8).max(512).regex(/^[A-Za-z0-9._-]+$/),
  routeNamespace: z.string().max(256).regex(/^\/[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/),
  callbackUri: z.string().url().max(2_048),
  kmsKeyResource: KmsCryptoKeyResourceSchema,
  secretVersionResources: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), SecretManagerVersionResourceSchema),
  serviceAccounts: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), ServiceAccountSchema),
  databaseLogins: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), LoginSchema),
  sourceCommit: ShaSchema,
  enabled: z.literal(false),
  providerCallsEnabled: z.literal(false),
  customerOnboardingEnabled: z.literal(false),
  webhookIntakeEnabled: z.literal(false),
  evidenceEnabled: z.literal(false),
  economicContributionsEnabled: z.literal(false),
  aiDispatchEnabled: z.literal(false)
}).strict().superRefine((value, context) => {
  const callback = new URL(value.callbackUri);
  const expectedRouteNamespace = `/api/integrations/${value.providerKey.replaceAll("_", "-")}`;
  if (callback.protocol !== "https:" || callback.username || callback.password || callback.port ||
    callback.search || callback.hash || !callback.hostname.includes(".") ||
    /(?:sandbox|preview|localhost|sslip\.io)/i.test(callback.hostname) ||
    /^\d+(?:\.\d+){3}$/.test(callback.hostname) ||
    value.routeNamespace !== expectedRouteNamespace ||
    callback.pathname !== `${expectedRouteNamespace}/callback`) {
    context.addIssue({ code: "custom", message: "provider callback boundary invalid" });
  }
  for (const [kind, values] of Object.entries({
    "secret versions": Object.values(value.secretVersionResources),
    "service accounts": Object.values(value.serviceAccounts),
    "database logins": Object.values(value.databaseLogins)
  })) {
    if (values.length === 0 || new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: `${kind} must be nonempty and distinct` });
    }
  }
  if (Object.values(value.databaseLogins).some((login) => !login.startsWith(`${value.providerKey}_production_`))) {
    context.addIssue({ code: "custom", message: "database login provider boundary invalid" });
  }
});

export type ProductionPlatformBinding = Readonly<z.infer<typeof ProductionPlatformBindingSchema>>;
export type ProductionProviderIsolation = Readonly<z.infer<typeof ProductionProviderIsolationSchema>>;

export function checkedProductionPlatformBinding(raw: unknown): ProductionPlatformBinding {
  return ProductionPlatformBindingSchema.parse(raw);
}

export function checkedProductionProviderIsolation(
  raw: unknown,
  platform: ProductionPlatformBinding
): ProductionProviderIsolation {
  const checked = ProductionProviderIsolationSchema.parse(raw);
  const projectPrefix = `projects/${platform.projectId}/`;
  const serviceSuffix = `@${platform.projectId}.iam.gserviceaccount.com`;
  if (!checked.kmsKeyResource.startsWith(`${projectPrefix}locations/${platform.region}/`) ||
    Object.values(checked.secretVersionResources).some((value) =>
      !value.startsWith(projectPrefix) || value.endsWith("/latest")) ||
    Object.values(checked.serviceAccounts).some((value) => !value.endsWith(serviceSuffix)) ||
    checked.sourceCommit !== platform.sourceCommit) {
    throw new Error("production_provider_resource_boundary_invalid");
  }
  return checked;
}

/** Proves that shared infrastructure does not make provider authority shared. */
export function assertProductionProviderSetIsolation(
  platform: ProductionPlatformBinding,
  candidates: readonly unknown[]
) {
  const providers = candidates.map((value) => checkedProductionProviderIsolation(value, platform));
  const tuple = (value: ProductionProviderIsolation) => `${value.providerKey}\u0000${value.environment}`;
  if (new Set(providers.map(tuple)).size !== providers.length) {
    throw new Error("production_provider_binding_duplicate");
  }
  for (const field of ["applicationId", "callbackUri", "kmsKeyResource"] as const) {
    if (new Set(providers.map((value) => value[field])).size !== providers.length) {
      throw new Error("production_provider_authority_overlap");
    }
  }
  for (const field of ["secretVersionResources", "serviceAccounts", "databaseLogins"] as const) {
    const values = providers.flatMap((provider) => Object.values(provider[field]));
    if (new Set(values).size !== values.length) {
      throw new Error("production_provider_authority_overlap");
    }
  }
  return Object.freeze([...providers]);
}
