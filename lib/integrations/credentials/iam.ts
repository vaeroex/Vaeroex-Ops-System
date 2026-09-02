import { z } from "zod";

const ExactResourceSchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !value.includes("*"), "IAM resources must be exact");

const PermissionSchema = z.enum([
  "cloudkms.cryptoKeyVersions.useToEncrypt",
  "cloudkms.cryptoKeyVersions.useToDecrypt",
  "secretmanager.versions.access"
]);

const DatabaseRpcSchema = z.enum([
  "create_integration_oauth_state_v1",
  "consume_integration_oauth_state_v1",
  "store_integration_credential_v1",
  "read_integration_provider_credential_v5",
  "record_integration_provider_credential_task_read_failure_v1",
  "acquire_integration_credential_refresh_lease_v1",
  "rotate_integration_credential_v1",
  "complete_integration_credential_refresh_failure_v1",
  "revoke_integration_credential_v1",
  "complete_integration_credential_revocation_v1",
  "destroy_integration_credential_v1",
  "record_integration_authorization_event_v1"
]);

export const CredentialServiceIdentitySchema = z
  .object({
    identity: z.enum([
      "connector_ingress",
      "connector_broker",
      "deterministic_worker",
      "vercel_application",
      "browser_client"
    ]),
    gcpPermissions: z.array(PermissionSchema),
    gcpResources: z.array(ExactResourceSchema),
    databaseRpcs: z.array(DatabaseRpcSchema),
    mayReceiveCredentialPlaintext: z.boolean(),
    mayContactProviderAuthorizationEndpoint: z.boolean()
  })
  .strict();

export type CredentialServiceIdentity = Readonly<
  z.infer<typeof CredentialServiceIdentitySchema>
>;

export function createPhase5CredentialIamBoundary(input: {
  kmsKeyResource: string;
  providerSecretVersionResource: string;
}) {
  const kmsKeyResource = ExactResourceSchema.parse(input.kmsKeyResource);
  const providerSecretVersionResource = ExactResourceSchema.parse(
    input.providerSecretVersionResource
  );
  const identities = [
    {
      identity: "connector_ingress",
      gcpPermissions: [],
      gcpResources: [],
      databaseRpcs: [
        "create_integration_oauth_state_v1",
        "consume_integration_oauth_state_v1"
      ],
      mayReceiveCredentialPlaintext: false,
      mayContactProviderAuthorizationEndpoint: false
    },
    {
      identity: "connector_broker",
      gcpPermissions: [
        "cloudkms.cryptoKeyVersions.useToEncrypt",
        "cloudkms.cryptoKeyVersions.useToDecrypt",
        "secretmanager.versions.access"
      ],
      gcpResources: [kmsKeyResource, providerSecretVersionResource],
      databaseRpcs: [
        "store_integration_credential_v1",
        "read_integration_provider_credential_v5",
        "record_integration_provider_credential_task_read_failure_v1",
        "acquire_integration_credential_refresh_lease_v1",
        "rotate_integration_credential_v1",
        "complete_integration_credential_refresh_failure_v1",
        "revoke_integration_credential_v1",
        "complete_integration_credential_revocation_v1",
        "destroy_integration_credential_v1",
        "record_integration_authorization_event_v1"
      ],
      mayReceiveCredentialPlaintext: true,
      mayContactProviderAuthorizationEndpoint: true
    },
    {
      identity: "deterministic_worker",
      gcpPermissions: [],
      gcpResources: [],
      databaseRpcs: [],
      mayReceiveCredentialPlaintext: false,
      mayContactProviderAuthorizationEndpoint: false
    },
    {
      identity: "vercel_application",
      gcpPermissions: [],
      gcpResources: [],
      databaseRpcs: [],
      mayReceiveCredentialPlaintext: false,
      mayContactProviderAuthorizationEndpoint: false
    },
    {
      identity: "browser_client",
      gcpPermissions: [],
      gcpResources: [],
      databaseRpcs: [],
      mayReceiveCredentialPlaintext: false,
      mayContactProviderAuthorizationEndpoint: false
    }
  ].map((identity) => CredentialServiceIdentitySchema.parse(identity));

  assertPhase5CredentialIamBoundary(identities);
  return identities;
}

export function assertPhase5CredentialIamBoundary(
  identities: readonly CredentialServiceIdentity[]
) {
  const checked = identities.map((identity) =>
    CredentialServiceIdentitySchema.parse(identity)
  );
  if (new Set(checked.map((identity) => identity.identity)).size !== 5) {
    throw new Error("credential_iam_identity_set_invalid");
  }
  const broker = checked.find((identity) => identity.identity === "connector_broker");
  if (!broker || !broker.mayReceiveCredentialPlaintext) {
    throw new Error("credential_broker_plaintext_authority_missing");
  }
  for (const identity of checked) {
    if (identity.identity === "connector_broker") continue;
    if (
      identity.mayReceiveCredentialPlaintext ||
      identity.gcpPermissions.length > 0 ||
      identity.gcpResources.length > 0
    ) {
      throw new Error("credential_iam_non_broker_authority_detected");
    }
  }
  const ingress = checked.find((identity) => identity.identity === "connector_ingress");
  if (
    !ingress ||
    ingress.databaseRpcs.some((rpc) => !rpc.includes("oauth_state"))
  ) {
    throw new Error("credential_ingress_authority_invalid");
  }
  return checked;
}
