import { z } from "zod";

import {
  BoundedIdentifierSchema,
  IsoTimestampSchema,
  ProviderEnvironmentKeySchema,
  ProviderKeySchema,
  Sha256FingerprintSchema,
  UuidSchema
} from "@/lib/integrations/contracts/primitives";

export const CREDENTIAL_SECURITY_CONTRACT_VERSIONS = {
  oauthState: "integration_oauth_state_v1",
  credentialAuthority: "integration_credential_authority_v1",
  credentialEnvelope: "oauth_credential_envelope_v1",
  credentialAad: "oauth_credential_aad_v1",
  brokerAudit: "integration_authorization_audit_v1",
  providerRead: "integration_provider_credential_read_v1"
} as const;

export const PHASE_5_MODEL_CALL_COUNT = 0 as const;
export const PHASE_5_PROMOTION_AUTHORIZED = false as const;
export const PHASE_5_OAUTH_STATE_BYTES = 32 as const;
export const PHASE_5_OAUTH_STATE_TTL_SECONDS = 600 as const;
export const PHASE_5_REFRESH_LEASE_SECONDS = 120 as const;
export const PHASE_5_DIRECT_KMS_MAX_PLAINTEXT_BYTES = 32 * 1024;
export const PHASE_5_MAX_AAD_BYTES = 4 * 1024;

const SortedScopeSetSchema = z
  .array(BoundedIdentifierSchema)
  .min(1)
  .max(64)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Credential scopes must be unique"
      });
    }
    if (values.some((value, index) => index > 0 && values[index - 1] > value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Credential scopes must be sorted"
      });
    }
  });

export const OAuthReturnIntentSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/);

export const OAuthStateHashSchema = Sha256FingerprintSchema;

export const CreateOAuthStateCommandSchema = z
  .object({
    contractVersion: z.literal(CREDENTIAL_SECURITY_CONTRACT_VERSIONS.oauthState),
    id: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    providerKey: ProviderKeySchema,
    providerEnvironment: ProviderEnvironmentKeySchema,
    initiatedBy: UuidSchema,
    requestedScopes: SortedScopeSetSchema,
    returnIntent: OAuthReturnIntentSchema,
    stateHash: OAuthStateHashSchema,
    createdAt: IsoTimestampSchema,
    expiresAt: IsoTimestampSchema
  })
  .strict();

export const ConsumeOAuthStateCommandSchema = CreateOAuthStateCommandSchema.pick({
  workspaceId: true,
  businessEntityId: true,
  connectionId: true,
  connectionGeneration: true,
  providerKey: true,
  providerEnvironment: true,
  initiatedBy: true,
  requestedScopes: true,
  returnIntent: true,
  stateHash: true
})
  .extend({ consumedAt: IsoTimestampSchema })
  .strict();

export const OAuthStateConsumeResultSchema = z
  .discriminatedUnion("accepted", [
    z
      .object({
        accepted: z.literal(true),
        stateId: UuidSchema,
        workspaceId: UuidSchema,
        businessEntityId: UuidSchema,
        connectionId: UuidSchema,
        connectionGeneration: z.number().int().positive().safe(),
        providerKey: ProviderKeySchema,
        providerEnvironment: ProviderEnvironmentKeySchema,
        requestedScopes: SortedScopeSetSchema,
        returnIntent: OAuthReturnIntentSchema
      })
      .strict(),
    z
      .object({
        accepted: z.literal(false),
        reasonCode: z.enum([
          "state_missing",
          "state_invalid",
          "state_expired",
          "state_replayed"
        ])
      })
      .strict()
  ]);

export const CredentialEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope),
    providerKey: ProviderKeySchema,
    // This legacy field name means the provider descriptor environment key.
    environment: ProviderEnvironmentKeySchema,
    externalAuthorizedEntityReference: z.string().min(1).max(512).nullable(),
    accessToken: z.string().min(16).max(16_384),
    accessExpiresAt: IsoTimestampSchema,
    refreshToken: z.string().min(16).max(16_384),
    refreshExpiresAt: IsoTimestampSchema.nullable(),
    grantedScopes: SortedScopeSetSchema,
    issuedAt: IsoTimestampSchema,
    updatedAt: IsoTimestampSchema
  })
  .strict()
  .superRefine((value, context) => {
    const issuedAt = Date.parse(value.issuedAt);
    const updatedAt = Date.parse(value.updatedAt);
    const accessExpiresAt = Date.parse(value.accessExpiresAt);
    const refreshExpiresAt = value.refreshExpiresAt === null
      ? null
      : Date.parse(value.refreshExpiresAt);
    if (updatedAt < issuedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["updatedAt"],
        message: "Credential update time cannot precede issuance"
      });
    }
    if (accessExpiresAt <= updatedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["accessExpiresAt"],
        message: "Access token must expire after the update time"
      });
    }
    if (refreshExpiresAt !== null && refreshExpiresAt <= updatedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["refreshExpiresAt"],
        message: "Refresh token must expire after the update time"
      });
    }
  });

export type CredentialEnvelope = Readonly<z.infer<typeof CredentialEnvelopeSchema>>;

export const CredentialAadContextSchema = z
  .object({
    schemaVersion: z.literal(CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad),
    purpose: z.literal("provider_oauth_credential"),
    // The V1 AAD bytes already bind the provider environment under this name.
    environment: ProviderEnvironmentKeySchema,
    workspaceId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    providerKey: ProviderKeySchema,
    credentialId: UuidSchema
  })
  .strict();

export type CredentialAadContext = Readonly<z.infer<typeof CredentialAadContextSchema>>;

export const KmsCryptoKeyResourceSchema = z
  .string()
  .regex(/^projects\/[a-z][a-z0-9-]{4,62}\/(?:locations\/[a-z0-9-]+)\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/);

export const SecretManagerVersionResourceSchema = z
  .string()
  .regex(/^projects\/[a-z][a-z0-9-]{4,62}\/secrets\/[A-Za-z0-9_-]{1,255}\/versions\/[1-9][0-9]*$/);

export const CiphertextBase64Schema = z
  .string()
  .min(16)
  .max(131_072)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const StoreCredentialCommandSchema = z
  .object({
    contractVersion: z.literal(CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAuthority),
    id: UuidSchema,
    oauthStateId: UuidSchema,
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    providerKey: ProviderKeySchema,
    providerEnvironment: ProviderEnvironmentKeySchema,
    initiatedBy: UuidSchema,
    expectedConnectionRowVersion: z.number().int().positive().safe(),
    credentialVersion: z.literal(1),
    envelopeSchemaVersion: z.literal(CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope),
    aadSchemaVersion: z.literal(CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad),
    aadDigest: Sha256FingerprintSchema,
    kmsKeyResource: KmsCryptoKeyResourceSchema,
    ciphertextBase64: CiphertextBase64Schema,
    accessExpiresAt: IsoTimestampSchema,
    refreshExpiresAt: IsoTimestampSchema.nullable(),
    grantedScopes: SortedScopeSetSchema,
    externalEntityReferenceFingerprint: Sha256FingerprintSchema.nullable(),
    authorizedAt: IsoTimestampSchema
  })
  .strict();

export const AcquireRefreshLeaseCommandSchema = z
  .object({
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    credentialId: UuidSchema,
    expectedCredentialVersion: z.number().int().positive().safe(),
    leaseId: UuidSchema,
    leaseOwnerFingerprint: Sha256FingerprintSchema,
    acquiredAt: IsoTimestampSchema,
    leaseExpiresAt: IsoTimestampSchema
  })
  .strict();

export const RefreshLeaseResultSchema = z.discriminatedUnion("acquired", [
  z
    .object({
      acquired: z.literal(false),
      reasonCode: z.enum([
        "credential_missing",
        "credential_inactive",
        "credential_version_stale",
        "refresh_lease_held"
      ])
    })
    .strict(),
  z
    .object({
      acquired: z.literal(true),
      credentialId: UuidSchema,
      credentialVersion: z.number().int().positive().safe(),
      ciphertextBase64: CiphertextBase64Schema,
      aadDigest: Sha256FingerprintSchema,
      kmsKeyResource: KmsCryptoKeyResourceSchema,
      aadContext: CredentialAadContextSchema,
      providerEnvironment: ProviderEnvironmentKeySchema,
      grantedScopes: SortedScopeSetSchema,
      leaseId: UuidSchema,
      leaseOwnerFingerprint: Sha256FingerprintSchema,
      leaseExpiresAt: IsoTimestampSchema
    })
    .strict()
  ]);

export const ReadProviderCredentialCommandSchema = z
  .object({
    contractVersion: z.literal(CREDENTIAL_SECURITY_CONTRACT_VERSIONS.providerRead),
    taskId: UuidSchema,
    leaseId: UuidSchema,
    leaseOwnerFingerprint: Sha256FingerprintSchema,
    expectedCredentialVersion: z.number().int().positive().safe(),
    requiredScopes: SortedScopeSetSchema,
    minimumValiditySeconds: z.number().int().min(30).max(900).safe(),
    requestedAt: IsoTimestampSchema
  })
  .strict();

const ProviderCredentialReadIdentitySchema = z
  .object({
    credentialId: UuidSchema,
    credentialVersion: z.number().int().positive().safe(),
    providerKey: ProviderKeySchema,
    providerEnvironment: ProviderEnvironmentKeySchema,
    accessExpiresAt: IsoTimestampSchema
  })
  .strict();

export const ProviderCredentialReadResultSchema = z.discriminatedUnion("state", [
  ProviderCredentialReadIdentitySchema.extend({
    state: z.literal("available"),
    ciphertextBase64: CiphertextBase64Schema,
    aadDigest: Sha256FingerprintSchema,
    kmsKeyResource: KmsCryptoKeyResourceSchema,
    aadContext: CredentialAadContextSchema,
    grantedScopes: SortedScopeSetSchema
  }).strict(),
  ProviderCredentialReadIdentitySchema.extend({
    state: z.literal("refresh_required")
  }).strict(),
  ProviderCredentialReadIdentitySchema.extend({
    state: z.literal("credential_version_stale")
  }).strict()
]);

export const RotateCredentialCommandSchema = z
  .object({
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    connectionGeneration: z.number().int().positive().safe(),
    credentialId: UuidSchema,
    expectedCredentialVersion: z.number().int().positive().safe(),
    leaseId: UuidSchema,
    leaseOwnerFingerprint: Sha256FingerprintSchema,
    aadDigest: Sha256FingerprintSchema,
    kmsKeyResource: KmsCryptoKeyResourceSchema,
    ciphertextBase64: CiphertextBase64Schema,
    accessExpiresAt: IsoTimestampSchema,
    refreshExpiresAt: IsoTimestampSchema.nullable(),
    grantedScopes: SortedScopeSetSchema,
    externalEntityReferenceFingerprint: Sha256FingerprintSchema.nullable(),
    rotatedAt: IsoTimestampSchema
  })
  .strict();

export const RefreshFailureReasonSchema = z.enum([
  "invalid_grant",
  "provider_revoked",
  "scope_loss",
  "provider_transient",
  "credential_expired",
  "kms_failure",
  "integrity_failure"
]);

export const CompleteRefreshFailureCommandSchema = AcquireRefreshLeaseCommandSchema.pick({
  workspaceId: true,
  businessEntityId: true,
  connectionId: true,
  connectionGeneration: true,
  credentialId: true,
  expectedCredentialVersion: true,
  leaseId: true,
  leaseOwnerFingerprint: true
})
  .extend({
    reasonCode: RefreshFailureReasonSchema,
    failedAt: IsoTimestampSchema
  })
  .strict();

export const RevokeCredentialCommandSchema = AcquireRefreshLeaseCommandSchema.pick({
  workspaceId: true,
  businessEntityId: true,
  connectionId: true,
  connectionGeneration: true,
  credentialId: true,
  expectedCredentialVersion: true
})
  .extend({
    reasonCode: z.enum([
      "provider_revoked",
      "customer_disconnect",
      "authorization_failure"
    ]),
    revokedAt: IsoTimestampSchema
  })
  .strict();

export const CompleteCredentialRevocationCommandSchema = RevokeCredentialCommandSchema.pick({
  workspaceId: true,
  businessEntityId: true,
  connectionId: true,
  connectionGeneration: true,
  credentialId: true,
  expectedCredentialVersion: true
})
  .extend({
    outcome: z.enum(["succeeded", "failed", "deferred"]),
    completedAt: IsoTimestampSchema
  })
  .strict();

export const DestroyCredentialCommandSchema = RevokeCredentialCommandSchema.pick({
  workspaceId: true,
  businessEntityId: true,
  connectionId: true,
  connectionGeneration: true,
  credentialId: true,
  expectedCredentialVersion: true
})
  .extend({
    reasonCode: z.literal("local_destruction"),
    destroyedAt: IsoTimestampSchema
  })
  .strict();

export const CredentialMutationResultSchema = z
  .object({
    credentialId: UuidSchema,
    credentialVersion: z.number().int().positive().safe(),
    credentialStatus: z.enum([
      "active",
      "reauthorization_required",
      "revoked",
      "destroyed"
    ]),
    connectionStatus: z.enum([
      "authorized_unmapped",
      "initializing",
      "active",
      "degraded",
      "error",
      "reauthorization_required",
      "disconnecting",
      "disconnected"
    ]),
    idempotent: z.boolean()
  })
  .strict();

export const AuthorizationAuditActionSchema = z.enum([
  "oauth_state_created",
  "oauth_state_consumed",
  "oauth_state_rejected",
  "credential_encrypted",
  "credential_decrypt_attempt",
  "credential_refresh",
  "credential_rotated",
  "credential_revocation",
  "credential_destroyed",
  "reauthorization_required",
  "authorization_failure"
]);

export const AuthorizationAuditReasonSchema = z.enum([
  "authorized",
  "state_missing",
  "state_invalid",
  "state_expired",
  "state_replayed",
  "decrypt_succeeded",
  "decrypt_failed",
  "refresh_succeeded",
  "refresh_lease_held",
  "credential_version_stale",
  "invalid_grant",
  "provider_revoked",
  "scope_loss",
  "provider_transient",
  "credential_expired",
  "kms_failure",
  "integrity_failure",
  "customer_disconnect",
  "local_destruction"
]);

export const AuthorizationAuditEventSchema = z
  .object({
    contractVersion: z.literal(CREDENTIAL_SECURITY_CONTRACT_VERSIONS.brokerAudit),
    workspaceId: UuidSchema,
    businessEntityId: UuidSchema,
    connectionId: UuidSchema,
    credentialId: UuidSchema.nullable(),
    actorId: BoundedIdentifierSchema,
    action: AuthorizationAuditActionSchema,
    outcome: z.enum(["allowed", "denied", "succeeded", "failed"]),
    reasonCode: AuthorizationAuditReasonSchema,
    credentialVersion: z.number().int().positive().safe().nullable(),
    occurredAt: IsoTimestampSchema
  })
  .strict();

export type CreateOAuthStateCommand = Readonly<z.infer<typeof CreateOAuthStateCommandSchema>>;
export type ConsumeOAuthStateCommand = Readonly<z.infer<typeof ConsumeOAuthStateCommandSchema>>;
export type StoreCredentialCommand = Readonly<z.infer<typeof StoreCredentialCommandSchema>>;
export type AcquireRefreshLeaseCommand = Readonly<z.infer<typeof AcquireRefreshLeaseCommandSchema>>;
export type ReadProviderCredentialCommand = Readonly<
  z.infer<typeof ReadProviderCredentialCommandSchema>
>;
export type RotateCredentialCommand = Readonly<z.infer<typeof RotateCredentialCommandSchema>>;
export type CompleteRefreshFailureCommand = Readonly<z.infer<typeof CompleteRefreshFailureCommandSchema>>;
export type RevokeCredentialCommand = Readonly<z.infer<typeof RevokeCredentialCommandSchema>>;
export type CompleteCredentialRevocationCommand = Readonly<z.infer<typeof CompleteCredentialRevocationCommandSchema>>;
export type DestroyCredentialCommand = Readonly<z.infer<typeof DestroyCredentialCommandSchema>>;
export type AuthorizationAuditEvent = Readonly<z.infer<typeof AuthorizationAuditEventSchema>>;
