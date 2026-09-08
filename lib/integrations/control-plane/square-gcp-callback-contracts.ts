import "server-only";

import { z } from "zod";
import { KmsCryptoKeyResourceSchema, SecretManagerVersionResourceSchema, type CredentialAadContext } from "@/lib/integrations/credentials/contracts";
import { snapshotSquareDurableJson } from "@/lib/integrations/providers/square/durable-contracts";
import { SQUARE_REMOTE_SANDBOX } from "./square-remote-sandbox-contracts";

export const SQUARE_GCP_CALLBACK_CONTRACT_VERSION = "square_gcp_callback_binding_v1" as const;
export const SQUARE_GCP_CALLBACK_IDENTITY_AUDIENCE = `${SQUARE_REMOTE_SANDBOX.applicationOrigin}/_identity/square-callback` as const;
export const SQUARE_GCP_CALLBACK_PROJECT_ID = "vaeroex-square-sandbox" as const;
export const SQUARE_GCP_CALLBACK_INSTANCE_NAME = "square-sandbox-callback" as const;

const decimal = z.string().regex(/^[1-9][0-9]{0,20}$/);
const BindingSchema = z.object({
  contractVersion: z.literal(SQUARE_GCP_CALLBACK_CONTRACT_VERSION),
  projectRef: z.literal(SQUARE_REMOTE_SANDBOX.projectRef),
  applicationOrigin: z.literal(SQUARE_REMOTE_SANDBOX.applicationOrigin),
  environment: z.literal("sandbox"), applicationId: z.literal(SQUARE_REMOTE_SANDBOX.applicationId),
  apiVersion: z.literal(SQUARE_REMOTE_SANDBOX.apiVersion),
  gcpProjectId: z.literal(SQUARE_GCP_CALLBACK_PROJECT_ID), gcpProjectNumber: decimal, gcpZone: z.literal("us-west1-a"),
  gcpInstanceId: decimal, gcpInstanceName: z.literal(SQUARE_GCP_CALLBACK_INSTANCE_NAME),
  serviceAccountEmail: z.string().max(254).regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/),
  serviceAccountSubject: decimal, identityAudience: z.literal(SQUARE_GCP_CALLBACK_IDENTITY_AUDIENCE),
  operatorId: z.string().uuid(), workspaceId: z.string().uuid(), businessEntityId: z.string().uuid(),
  operatorRole: z.enum(["owner", "admin", "manager"]),
  brokerLogin: z.string().regex(/^square_sandbox_[a-z_]{1,40}$/).max(63),
  approvalExpiresAt: z.string().datetime({ offset: true }), enabled: z.literal(true), providerCallsEnabled: z.boolean(),
  policyVersion: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/), policyFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  kmsKeyResource: KmsCryptoKeyResourceSchema,
  appSecretVersionResource: SecretManagerVersionResourceSchema,
  databaseSecretVersionResource: SecretManagerVersionResourceSchema
}).strict().superRefine((value, context) => {
  if (!value.serviceAccountEmail.endsWith(`@${value.gcpProjectId}.iam.gserviceaccount.com`) ||
    ![value.kmsKeyResource, value.appSecretVersionResource, value.databaseSecretVersionResource]
      .every(resource => resource.startsWith(`projects/${value.gcpProjectId}/`)) ||
    !value.kmsKeyResource.startsWith(`projects/${value.gcpProjectId}/locations/us-west1/`) ||
    !value.databaseSecretVersionResource.startsWith(`projects/${value.gcpProjectId}/secrets/square-sandbox-callback-db/versions/`) ||
    value.appSecretVersionResource === value.databaseSecretVersionResource) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "square_gcp_callback_binding_denied" });
  }
});

export type SquareGcpCallbackBinding = Readonly<z.infer<typeof BindingSchema>>;

/** Validates a checked, owner-approved server/DB binding, never a browser grant.
 * No defaults or example identities can install a live capability. */
export function checkedSquareGcpCallbackBinding(input: unknown, now = Date.now()): SquareGcpCallbackBinding {
  try {
    const value = snapshotSquareDurableJson(input, {
      containers: 1, values: 32, bytes: 16_384, depth: 1, arrayLength: 0, properties: 32, stringLength: 2_048
    });
    const checked = BindingSchema.parse(value);
    if (!Number.isSafeInteger(now) || Date.parse(checked.approvalExpiresAt) <= now) throw new Error();
    return Object.freeze(checked);
  } catch { throw new Error("square_gcp_callback_binding_denied"); }
}

export type SquareGcpFirstConsentPurpose = "application_secret" | "credential_encrypt";
/** Trusted request-owned DB closure. It can open only after its own accepted
 * consume_state and must recheck that intent and current actor/host on every call.
 * For encrypt it also checks/pins the exact AAD against the consumed connection.
 * Neither this function's type nor a serialized assertion grants authority. */
export type SquareGcpFirstConsentAuthority = (request: Readonly<{
  purpose: SquareGcpFirstConsentPurpose;
  aadContext?: CredentialAadContext;
  signal: AbortSignal;
}>) => Promise<SquareGcpCallbackBinding>;
