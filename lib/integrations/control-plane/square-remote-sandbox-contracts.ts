import "server-only";

import { z } from "zod";
import { KmsCryptoKeyResourceSchema, SecretManagerVersionResourceSchema } from "@/lib/integrations/credentials/contracts";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";

export const SQUARE_REMOTE_SANDBOX = Object.freeze({
  contractVersion: "square_remote_sandbox_binding_v1",
  projectRef: "oysjpoondtcrqpghhrbd",
  applicationOrigin: "https://square-sandbox.vaeroex.com",
  applicationId: "sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw",
  apiVersion: "2026-08-19",
  environment: "sandbox",
  vercelTeamId: "team_uORtrMvad77Qz6HikOgD4cnp",
  vercelProjectName: "vaeroex-square-sandbox",
  forbiddenVercelProjectId: "prj_J810bZ9ECoN4CyLKujUoEEH8N6ja",
  providerOrigin: "https://connect.squareupsandbox.com"
} as const);

const LoginSchema = z.string().regex(/^square_sandbox_[a-z_]{1,40}$/).max(63);
const ServiceAccountSchema = z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/);
const WorkloadIdentitySchema = z.string().regex(/^\/\/iam\.googleapis\.com\/projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/[a-z0-9-]+\/providers\/[a-z0-9-]+$/).max(512);

const BindingSchema = z.object({
  contractVersion: z.literal(SQUARE_REMOTE_SANDBOX.contractVersion),
  projectRef: z.literal(SQUARE_REMOTE_SANDBOX.projectRef),
  vercelTeamId: z.literal(SQUARE_REMOTE_SANDBOX.vercelTeamId),
  vercelTeamSlug: z.literal("vaeroex-2167s-projects"),
  vercelProjectId: z.string().regex(/^prj_[A-Za-z0-9]{16,64}$/).refine(value => value !== SQUARE_REMOTE_SANDBOX.forbiddenVercelProjectId),
  vercelProjectName: z.literal(SQUARE_REMOTE_SANDBOX.vercelProjectName),
  applicationOrigin: z.literal(SQUARE_REMOTE_SANDBOX.applicationOrigin),
  environment: z.literal("sandbox"),
  applicationId: z.literal(SQUARE_REMOTE_SANDBOX.applicationId),
  apiVersion: z.literal(SQUARE_REMOTE_SANDBOX.apiVersion),
  operatorId: z.string().uuid(), workspaceId: z.string().uuid(), businessEntityId: z.string().uuid(),
  operatorRole: z.enum(["owner", "admin", "manager"]),
  brokerLogin: LoginSchema, enrollerLogin: LoginSchema, webhookLogin: LoginSchema, runtimeLogin: LoginSchema,
  approvalExpiresAt: z.string().datetime({ offset: true }),
  enabled: z.literal(true), providerCallsEnabled: z.boolean(),
  policyVersion: z.string().min(1).max(128),
  policyFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  kmsKeyResource: KmsCryptoKeyResourceSchema.nullable(),
  appSecretVersionResource: SecretManagerVersionResourceSchema.nullable(),
  webhookSecretVersionResource: SecretManagerVersionResourceSchema.nullable(),
  credentialServiceAccount: ServiceAccountSchema.nullable(),
  workloadIdentityAudience: WorkloadIdentitySchema.nullable()
}).strict().refine(value => new Set([value.brokerLogin, value.enrollerLogin, value.webhookLogin, value.runtimeLogin]).size === 4)
  .refine(value => !value.providerCallsEnabled || !!(value.kmsKeyResource && value.appSecretVersionResource &&
    value.webhookSecretVersionResource && value.credentialServiceAccount && value.workloadIdentityAudience))
  .refine(value => value.appSecretVersionResource === null || !value.appSecretVersionResource.endsWith("/latest"))
  .refine(value => value.webhookSecretVersionResource === null || !value.webhookSecretVersionResource.endsWith("/latest"));

export type SquareRemoteSandboxBinding = Readonly<z.infer<typeof BindingSchema>>;

/** This validates a small checked database response, not a caller-supplied grant.
 * Its current fixed scalar fields fit one container and fewer than 40 values. */
export function checkedSquareRemoteSandboxBinding(input: unknown, now = Date.now()): SquareRemoteSandboxBinding {
  const value = snapshotSquareDurableJson(input, {
    containers: 1, values: 40, bytes: 16_384, depth: 1,
    arrayLength: 0, properties: 39, stringLength: 2_048
  });
  const checked = BindingSchema.parse(value);
  if (!Number.isSafeInteger(now) || Date.parse(checked.approvalExpiresAt) <= now) throw new Error("square_remote_sandbox_denied");
  return value as SquareRemoteSandboxBinding;
}

/** Cheap negative gate only. It cannot install capabilities or grant authority. */
export function squareRemoteSandboxCandidate(request?: Request) {
  if (process.env.SQUARE_REMOTE_SANDBOX !== "configured" || process.env.VERCEL !== "1" ||
    process.env.VERCEL_ENV !== "production" || process.env.NODE_ENV !== "production" ||
    !/^prj_[A-Za-z0-9]{16,64}$/.test(process.env.VERCEL_PROJECT_ID ?? "") ||
    process.env.VERCEL_PROJECT_ID === SQUARE_REMOTE_SANDBOX.forbiddenVercelProjectId ||
    process.env.NEXT_PUBLIC_SUPABASE_URL !== `https://${SQUARE_REMOTE_SANDBOX.projectRef}.supabase.co` ||
    process.env.NEXT_PUBLIC_APP_URL !== SQUARE_REMOTE_SANDBOX.applicationOrigin ||
    process.env.SQUARE_ENVIRONMENT !== "sandbox" || process.env.SQUARE_APPLICATION_ID !== SQUARE_REMOTE_SANDBOX.applicationId ||
    process.env.SQUARE_API_VERSION !== SQUARE_REMOTE_SANDBOX.apiVersion) return false;
  if (!request) return true;
  try {
    const url = new URL(request.url);
    return url.origin === SQUARE_REMOTE_SANDBOX.applicationOrigin && !url.username && !url.password && !url.hash &&
      request.headers.get("host") === "square-sandbox.vaeroex.com";
  } catch { return false; }
}
