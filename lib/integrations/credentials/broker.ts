import { randomUUID } from "node:crypto";

import { canonicalContractJson, contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  AcquireRefreshLeaseCommandSchema,
  AuthorizationAuditEventSchema,
  CREDENTIAL_SECURITY_CONTRACT_VERSIONS,
  CompleteCredentialRevocationCommandSchema,
  CompleteRefreshFailureCommandSchema,
  ConsumeOAuthStateCommandSchema,
  CredentialAadContextSchema,
  CredentialEnvelopeSchema,
  CredentialMutationResultSchema,
  DestroyCredentialCommandSchema,
  OAuthStateConsumeResultSchema,
  PHASE_5_REFRESH_LEASE_SECONDS,
  RefreshLeaseResultSchema,
  RevokeCredentialCommandSchema,
  RotateCredentialCommandSchema,
  StoreCredentialCommandSchema,
  type AcquireRefreshLeaseCommand,
  type AuthorizationAuditEvent,
  type CompleteCredentialRevocationCommand,
  type CompleteRefreshFailureCommand,
  type CreateOAuthStateCommand,
  type DestroyCredentialCommand,
  type RevokeCredentialCommand,
  type RotateCredentialCommand,
  type StoreCredentialCommand
} from "@/lib/integrations/credentials/contracts";
import {
  credentialAad,
  credentialAadDigest,
  type CredentialKms
} from "@/lib/integrations/credentials/kms";
import {
  createOAuthStateIntent,
  oauthStateHash,
  sortedCredentialScopes
} from "@/lib/integrations/credentials/oauth-state";
import { safeCredentialBrokerError } from "@/lib/integrations/credentials/redaction";
import type { ProviderApplicationSecret } from "@/lib/integrations/credentials/secret-manager";
import { SyntheticProviderFailure } from "@/lib/integrations/credentials/synthetic-provider";

export type CredentialBrokerStore = Readonly<{
  createOAuthState(command: CreateOAuthStateCommand, requestId: string): PromiseLike<unknown>;
  consumeOAuthState(command: unknown, requestId: string): PromiseLike<unknown>;
  storeCredential(command: StoreCredentialCommand, requestId: string): PromiseLike<unknown>;
  acquireRefreshLease(command: AcquireRefreshLeaseCommand, requestId: string): PromiseLike<unknown>;
  rotateCredential(command: RotateCredentialCommand, requestId: string): PromiseLike<unknown>;
  completeRefreshFailure(
    command: CompleteRefreshFailureCommand,
    requestId: string
  ): PromiseLike<unknown>;
  revokeCredential(command: RevokeCredentialCommand, requestId: string): PromiseLike<unknown>;
  completeCredentialRevocation(
    command: CompleteCredentialRevocationCommand,
    requestId: string
  ): PromiseLike<unknown>;
  destroyCredential(command: DestroyCredentialCommand, requestId: string): PromiseLike<unknown>;
  recordAuthorizationEvent(event: AuthorizationAuditEvent, requestId: string): PromiseLike<unknown>;
}>;

export type ProviderSecretStore = Readonly<{
  access(providerKey: string, environment: string): PromiseLike<ProviderApplicationSecret>;
}>;

export type OAuthCredentialProvider = Readonly<{
  providerKey: string;
  environment: string;
  exchangeAuthorizationCode(input: {
    authorizationCode: string;
    applicationSecret: ProviderApplicationSecret;
    requestedScopes: readonly string[];
    now: Date;
  }): PromiseLike<unknown>;
  refreshCredential(input: {
    credential: ReturnType<typeof CredentialEnvelopeSchema.parse>;
    applicationSecret: ProviderApplicationSecret;
    now: Date;
  }): PromiseLike<unknown>;
  revokeCredential(input: {
    credential: ReturnType<typeof CredentialEnvelopeSchema.parse>;
    applicationSecret: ProviderApplicationSecret;
  }): PromiseLike<unknown>;
}>;

function externalEntityReferenceFingerprint(value: string | null) {
  return value === null
    ? null
    : contractSha256({
        fingerprintPurpose: "provider_authorized_entity_reference",
        fingerprintVersion: "provider_authorized_entity_reference_fingerprint_v1",
        value
      });
}

function credentialFailureReason(error: unknown) {
  if (error instanceof SyntheticProviderFailure) return error.code;
  if (error instanceof Error && error.message.includes("kms")) return "kms_failure";
  return "integrity_failure";
}

export class IntegrationCredentialBroker {
  readonly #store: CredentialBrokerStore;
  readonly #kms: CredentialKms;
  readonly #kmsKeyResource: string;
  readonly #secrets: ProviderSecretStore;
  readonly #provider: OAuthCredentialProvider;
  readonly #clock: () => Date;

  constructor(input: {
    store: CredentialBrokerStore;
    kms: CredentialKms;
    kmsKeyResource: string;
    secrets: ProviderSecretStore;
    provider: OAuthCredentialProvider;
    clock?: () => Date;
  }) {
    this.#store = input.store;
    this.#kms = input.kms;
    this.#kmsKeyResource = input.kmsKeyResource;
    this.#secrets = input.secrets;
    this.#provider = input.provider;
    this.#clock = input.clock ?? (() => new Date());
  }

  async beginAuthorization(
    input: Omit<
      CreateOAuthStateCommand,
      "contractVersion" | "id" | "stateHash" | "createdAt" | "expiresAt" | "requestedScopes" | "returnIntent"
    > & {
      requestedScopes: readonly string[];
      returnIntent: string;
      requestId: string;
    }
  ) {
    const { requestId, ...intent } = input;
    const created = createOAuthStateIntent(intent, this.#clock());
    await this.#store.createOAuthState(created.command, requestId);
    return {
      state: created.state,
      expiresAt: created.command.expiresAt
    } as const;
  }

  async completeAuthorization(input: {
    state: string;
    authorizationCode: string;
    workspaceId: string;
    businessEntityId: string;
    connectionId: string;
    connectionGeneration: number;
    expectedConnectionRowVersion: number;
    providerKey: string;
    providerEnvironment: string;
    initiatedBy: string;
    requestedScopes: readonly string[];
    returnIntent: string;
    consumeRequestId: string;
    storeRequestId: string;
  }) {
    const now = this.#clock();
    const consumed = OAuthStateConsumeResultSchema.parse(
      await this.#store.consumeOAuthState(
        ConsumeOAuthStateCommandSchema.parse({
          workspaceId: input.workspaceId,
          businessEntityId: input.businessEntityId,
          connectionId: input.connectionId,
          connectionGeneration: input.connectionGeneration,
          providerKey: input.providerKey,
          providerEnvironment: input.providerEnvironment,
          initiatedBy: input.initiatedBy,
          requestedScopes: sortedCredentialScopes(input.requestedScopes),
          returnIntent: input.returnIntent,
          stateHash: oauthStateHash(input.state),
          consumedAt: now.toISOString()
        }),
        input.consumeRequestId
      )
    );
    if (!consumed.accepted) {
      throw new Error(safeCredentialBrokerError("oauth_state_rejected"));
    }
    let plaintext: Buffer | null = null;
    try {
      if (
        this.#provider.providerKey !== consumed.providerKey ||
        this.#provider.environment !== consumed.providerEnvironment
      ) {
        throw new Error("authorization_provider_binding_invalid");
      }
      const applicationSecret = await this.#secrets.access(
        consumed.providerKey,
        consumed.providerEnvironment
      );
      const envelope = CredentialEnvelopeSchema.parse(
        await this.#provider.exchangeAuthorizationCode({
          authorizationCode: input.authorizationCode,
          applicationSecret,
          requestedScopes: consumed.requestedScopes,
          now
        })
      );
      if (
        envelope.providerKey !== consumed.providerKey ||
        envelope.environment !== consumed.providerEnvironment ||
        consumed.requestedScopes.some(
          (scope) => !envelope.grantedScopes.includes(scope)
        )
      ) {
        throw new Error("authorization_envelope_binding_invalid");
      }

      const credentialId = randomUUID();
      const aadContext = CredentialAadContextSchema.parse({
        schemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad,
        purpose: "provider_oauth_credential",
        environment: consumed.providerEnvironment,
        workspaceId: consumed.workspaceId,
        connectionId: consumed.connectionId,
        connectionGeneration: consumed.connectionGeneration,
        providerKey: consumed.providerKey,
        credentialId
      });
      plaintext = Buffer.from(canonicalContractJson(envelope), "utf8");
      const ciphertext = await this.#kms.encrypt({
        keyResource: this.#kmsKeyResource,
        plaintext,
        additionalAuthenticatedData: credentialAad(aadContext)
      });
      const command = StoreCredentialCommandSchema.parse({
        contractVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAuthority,
        id: credentialId,
        oauthStateId: consumed.stateId,
        workspaceId: consumed.workspaceId,
        businessEntityId: consumed.businessEntityId,
        connectionId: consumed.connectionId,
        connectionGeneration: consumed.connectionGeneration,
        providerKey: consumed.providerKey,
        providerEnvironment: consumed.providerEnvironment,
        initiatedBy: input.initiatedBy,
        expectedConnectionRowVersion: input.expectedConnectionRowVersion,
        credentialVersion: 1,
        envelopeSchemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope,
        aadSchemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad,
        aadDigest: credentialAadDigest(aadContext),
        kmsKeyResource: this.#kmsKeyResource,
        ciphertextBase64: Buffer.from(ciphertext).toString("base64"),
        accessExpiresAt: envelope.accessExpiresAt,
        refreshExpiresAt: envelope.refreshExpiresAt,
        grantedScopes: envelope.grantedScopes,
        externalEntityReferenceFingerprint: externalEntityReferenceFingerprint(
          envelope.externalAuthorizedEntityReference
        ),
        authorizedAt: now.toISOString()
      });
      const result = CredentialMutationResultSchema.parse(
        await this.#store.storeCredential(command, input.storeRequestId)
      );
      return {
        credentialId: result.credentialId,
        credentialVersion: result.credentialVersion,
        connectionStatus: result.connectionStatus,
        returnIntent: consumed.returnIntent
      } as const;
    } catch (error) {
      await this.#auditAuthorizationFailure(
        input,
        credentialFailureReason(error),
        now.toISOString()
      );
      throw new Error(safeCredentialBrokerError("authorization_failed"));
    } finally {
      plaintext?.fill(0);
    }
  }

  async refreshCredential(input: {
    workspaceId: string;
    businessEntityId: string;
    connectionId: string;
    connectionGeneration: number;
    credentialId: string;
    expectedCredentialVersion: number;
    requiredScopes: readonly string[];
    workerId: string;
    acquireRequestId: string;
    rotateRequestId: string;
    failureRequestId: string;
  }) {
    const now = this.#clock();
    const leaseId = randomUUID();
    const leaseOwnerFingerprint = contractSha256({
      fingerprintPurpose: "credential_refresh_worker",
      fingerprintVersion: "credential_refresh_worker_fingerprint_v1",
      workerId: input.workerId
    });
    const acquired = RefreshLeaseResultSchema.parse(
      await this.#store.acquireRefreshLease(
        AcquireRefreshLeaseCommandSchema.parse({
          workspaceId: input.workspaceId,
          businessEntityId: input.businessEntityId,
          connectionId: input.connectionId,
          connectionGeneration: input.connectionGeneration,
          credentialId: input.credentialId,
          expectedCredentialVersion: input.expectedCredentialVersion,
          leaseId,
          leaseOwnerFingerprint,
          acquiredAt: now.toISOString(),
          leaseExpiresAt: new Date(
            now.getTime() + PHASE_5_REFRESH_LEASE_SECONDS * 1_000
          ).toISOString()
        }),
        input.acquireRequestId
      )
    );
    if (!acquired.acquired) {
      return {
        refreshed: false,
        reasonCode: safeCredentialBrokerError("refresh_not_acquired")
      } as const;
    }

    let plaintext: Buffer | null = null;
    let nextPlaintext: Buffer | null = null;
    let decryptSucceeded = false;
    try {
      if (credentialAadDigest(acquired.aadContext) !== acquired.aadDigest) {
        throw new Error("credential_aad_digest_mismatch");
      }
      plaintext = Buffer.from(
        await this.#kms.decrypt({
          keyResource: acquired.kmsKeyResource,
          ciphertext: Buffer.from(acquired.ciphertextBase64, "base64"),
          additionalAuthenticatedData: credentialAad(acquired.aadContext)
        })
      );
      decryptSucceeded = true;
      await this.#audit(input, acquired.credentialVersion, {
        action: "credential_decrypt_attempt",
        outcome: "succeeded",
        reasonCode: "decrypt_succeeded",
        occurredAt: now.toISOString()
      });
      const envelope = CredentialEnvelopeSchema.parse(
        JSON.parse(plaintext.toString("utf8"))
      );
      if (
        envelope.providerKey !== acquired.aadContext.providerKey ||
        envelope.environment !== acquired.aadContext.environment
      ) {
        throw new Error("credential_envelope_binding_invalid");
      }
      const secret = await this.#secrets.access(
        envelope.providerKey,
        envelope.environment
      );
      const next = CredentialEnvelopeSchema.parse(
        await this.#provider.refreshCredential({
          credential: envelope,
          applicationSecret: secret,
          now
        })
      );
      if (next.refreshToken === envelope.refreshToken) {
        throw new Error("credential_refresh_token_not_rotated");
      }
      if (
        sortedCredentialScopes(input.requiredScopes).some(
          (scope) => !next.grantedScopes.includes(scope)
        )
      ) {
        throw new SyntheticProviderFailure("scope_loss");
      }
      nextPlaintext = Buffer.from(canonicalContractJson(next), "utf8");
      const ciphertext = await this.#kms.encrypt({
        keyResource: acquired.kmsKeyResource,
        plaintext: nextPlaintext,
        additionalAuthenticatedData: credentialAad(acquired.aadContext)
      });
      const command = RotateCredentialCommandSchema.parse({
        workspaceId: input.workspaceId,
        businessEntityId: input.businessEntityId,
        connectionId: input.connectionId,
        connectionGeneration: input.connectionGeneration,
        credentialId: acquired.credentialId,
        expectedCredentialVersion: acquired.credentialVersion,
        leaseId: acquired.leaseId,
        leaseOwnerFingerprint: acquired.leaseOwnerFingerprint,
        aadDigest: credentialAadDigest(acquired.aadContext),
        kmsKeyResource: acquired.kmsKeyResource,
        ciphertextBase64: Buffer.from(ciphertext).toString("base64"),
        accessExpiresAt: next.accessExpiresAt,
        refreshExpiresAt: next.refreshExpiresAt,
        grantedScopes: next.grantedScopes,
        externalEntityReferenceFingerprint: externalEntityReferenceFingerprint(
          next.externalAuthorizedEntityReference
        ),
        rotatedAt: now.toISOString()
      });
      const result = CredentialMutationResultSchema.parse(
        await this.#store.rotateCredential(command, input.rotateRequestId)
      );
      return {
        refreshed: true,
        credentialVersion: result.credentialVersion
      } as const;
    } catch (error) {
      const reasonCode = credentialFailureReason(error);
      if (!decryptSucceeded) {
        try {
          await this.#audit(input, acquired.credentialVersion, {
            action: "credential_decrypt_attempt",
            outcome: "failed",
            reasonCode: reasonCode === "kms_failure" ? reasonCode : "integrity_failure",
            occurredAt: now.toISOString()
          });
        } catch {
          // The checked failure transition below remains the authoritative fail-closed path.
        }
      }
      const failure = CompleteRefreshFailureCommandSchema.parse({
        workspaceId: input.workspaceId,
        businessEntityId: input.businessEntityId,
        connectionId: input.connectionId,
        connectionGeneration: input.connectionGeneration,
        credentialId: acquired.credentialId,
        expectedCredentialVersion: acquired.credentialVersion,
        leaseId: acquired.leaseId,
        leaseOwnerFingerprint: acquired.leaseOwnerFingerprint,
        reasonCode,
        failedAt: now.toISOString()
      });
      const result = CredentialMutationResultSchema.parse(
        await this.#store.completeRefreshFailure(failure, input.failureRequestId)
      );
      return {
        refreshed: false,
        reasonCode:
          result.credentialStatus === "reauthorization_required"
            ? safeCredentialBrokerError("reauthorization_required")
            : safeCredentialBrokerError("refresh_failed")
      } as const;
    } finally {
      plaintext?.fill(0);
      nextPlaintext?.fill(0);
    }
  }

  async revokeAndDestroyCredential(input: {
    workspaceId: string;
    businessEntityId: string;
    connectionId: string;
    connectionGeneration: number;
    credentialId: string;
    expectedCredentialVersion: number;
    workerId: string;
    acquireRequestId: string;
    revokeRequestId: string;
    revocationResultRequestId: string;
    destroyRequestId: string;
  }) {
    const now = this.#clock();
    const leaseId = randomUUID();
    const leaseOwnerFingerprint = contractSha256({
      fingerprintPurpose: "credential_revocation_worker",
      fingerprintVersion: "credential_revocation_worker_fingerprint_v1",
      workerId: input.workerId
    });
    let plaintext: Buffer | null = null;
    let envelope: ReturnType<typeof CredentialEnvelopeSchema.parse> | null = null;
    let applicationSecret: ProviderApplicationSecret | null = null;
    let providerRevocationOutcome: "succeeded" | "failed" | "deferred" = "deferred";
    try {
      try {
        const acquired = RefreshLeaseResultSchema.parse(
          await this.#store.acquireRefreshLease(
            AcquireRefreshLeaseCommandSchema.parse({
              workspaceId: input.workspaceId,
              businessEntityId: input.businessEntityId,
              connectionId: input.connectionId,
              connectionGeneration: input.connectionGeneration,
              credentialId: input.credentialId,
              expectedCredentialVersion: input.expectedCredentialVersion,
              leaseId,
              leaseOwnerFingerprint,
              acquiredAt: now.toISOString(),
              leaseExpiresAt: new Date(
                now.getTime() + PHASE_5_REFRESH_LEASE_SECONDS * 1_000
              ).toISOString()
            }),
            input.acquireRequestId
          )
        );
        if (acquired.acquired) {
          if (credentialAadDigest(acquired.aadContext) !== acquired.aadDigest) {
            throw new Error("credential_aad_digest_mismatch");
          }
          plaintext = Buffer.from(
            await this.#kms.decrypt({
              keyResource: acquired.kmsKeyResource,
              ciphertext: Buffer.from(acquired.ciphertextBase64, "base64"),
              additionalAuthenticatedData: credentialAad(acquired.aadContext)
            })
          );
          envelope = CredentialEnvelopeSchema.parse(
            JSON.parse(plaintext.toString("utf8"))
          );
          applicationSecret = await this.#secrets.access(
            envelope.providerKey,
            envelope.environment
          );
        }
      } catch {
        providerRevocationOutcome = "failed";
      }

      const revoked = CredentialMutationResultSchema.parse(
        await this.#store.revokeCredential(
          RevokeCredentialCommandSchema.parse({
            workspaceId: input.workspaceId,
            businessEntityId: input.businessEntityId,
            connectionId: input.connectionId,
            connectionGeneration: input.connectionGeneration,
            credentialId: input.credentialId,
            expectedCredentialVersion: input.expectedCredentialVersion,
            reasonCode: "customer_disconnect",
            revokedAt: now.toISOString()
          }),
          input.revokeRequestId
        )
      );

      if (envelope && applicationSecret) {
        try {
          await this.#provider.revokeCredential({
            credential: envelope,
            applicationSecret
          });
          providerRevocationOutcome = "succeeded";
        } catch {
          providerRevocationOutcome = "failed";
        }
      }

      try {
        await this.#store.completeCredentialRevocation(
          CompleteCredentialRevocationCommandSchema.parse({
            workspaceId: input.workspaceId,
            businessEntityId: input.businessEntityId,
            connectionId: input.connectionId,
            connectionGeneration: input.connectionGeneration,
            credentialId: input.credentialId,
            expectedCredentialVersion: revoked.credentialVersion,
            outcome: providerRevocationOutcome,
            completedAt: now.toISOString()
          }),
          input.revocationResultRequestId
        );
      } catch {
        providerRevocationOutcome = "deferred";
      }

      const destroyed = CredentialMutationResultSchema.parse(
        await this.#store.destroyCredential(
          DestroyCredentialCommandSchema.parse({
            workspaceId: input.workspaceId,
            businessEntityId: input.businessEntityId,
            connectionId: input.connectionId,
            connectionGeneration: input.connectionGeneration,
            credentialId: input.credentialId,
            expectedCredentialVersion: revoked.credentialVersion,
            reasonCode: "local_destruction",
            destroyedAt: now.toISOString()
          }),
          input.destroyRequestId
        )
      );
      return {
        destroyed: destroyed.credentialStatus === "destroyed",
        providerRevocationOutcome,
        connectionStatus: destroyed.connectionStatus
      } as const;
    } finally {
      plaintext?.fill(0);
    }
  }

  async #auditAuthorizationFailure(
    input: {
      workspaceId: string;
      businessEntityId: string;
      connectionId: string;
      storeRequestId: string;
    },
    reasonCode: ReturnType<typeof credentialFailureReason>,
    occurredAt: string
  ) {
    try {
      await this.#store.recordAuthorizationEvent(
        AuthorizationAuditEventSchema.parse({
          contractVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.brokerAudit,
          workspaceId: input.workspaceId,
          businessEntityId: input.businessEntityId,
          connectionId: input.connectionId,
          credentialId: null,
          actorId: "integration_credential_broker",
          action: "authorization_failure",
          outcome: "failed",
          reasonCode,
          credentialVersion: null,
          occurredAt
        }),
        input.storeRequestId
      );
    } catch {
      // Authorization still fails closed when the non-sensitive audit write fails.
    }
  }

  async #audit(
    input: {
      workspaceId: string;
      businessEntityId: string;
      connectionId: string;
      credentialId: string;
      workerId: string;
      failureRequestId: string;
    },
    credentialVersion: number,
    event: Pick<
      AuthorizationAuditEvent,
      "action" | "outcome" | "reasonCode" | "occurredAt"
    >
  ) {
    await this.#store.recordAuthorizationEvent(
      AuthorizationAuditEventSchema.parse({
        contractVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.brokerAudit,
        workspaceId: input.workspaceId,
        businessEntityId: input.businessEntityId,
        connectionId: input.connectionId,
        credentialId: input.credentialId,
        actorId: input.workerId,
        credentialVersion,
        ...event
      }),
      input.failureRequestId
    );
  }
}
