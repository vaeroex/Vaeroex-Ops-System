import { randomUUID, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { canonicalContractJson, contractSha256 } from "@/lib/integrations/contracts/canonical";
import {
  AcquireRefreshLeaseCommandSchema,
  AuthorizationAuditEventSchema,
  CREDENTIAL_SECURITY_CONTRACT_VERSIONS,
  CompleteCredentialRevocationCommandSchema,
  CompleteRefreshFailureCommandSchema,
  ConsumeReauthorizationStateCommandSchema,
  ConsumeOAuthStateCommandSchema,
  CredentialAadContextSchema,
  CredentialEnvelopeSchema,
  CredentialMutationResultSchema,
  CredentialRefreshDiagnosticsSchema,
  ExpiredRefreshLeaseReclamationResultSchema,
  CredentialRefreshBoundaryEventSchema,
  CredentialRefreshResultSchema,
  CredentialReauthorizationResultSchema,
  DestroyCredentialCommandSchema,
  OAuthStateConsumeResultSchema,
  PHASE_5_DIRECT_KMS_MAX_PLAINTEXT_BYTES,
  PHASE_5_REFRESH_LEASE_SECONDS,
  PHASE_8B_REAUTHORIZATION_REDIRECT_URI,
  PHASE_8B_REAUTHORIZATION_RETURN_INTENT,
  ProviderCredentialReadDiagnosticClassSchema,
  ProviderCredentialReadResultSchema,
  ReadProviderCredentialCommandSchema,
  ReclaimExpiredRefreshLeaseCommandSchema,
  RefreshLeaseResultSchema,
  ReauthorizationStateConsumeResultSchema,
  RevokeCredentialCommandSchema,
  RotateCredentialCommandSchema,
  StoreCredentialCommandSchema,
  StoreReauthorizedCredentialCommandSchema,
  type AcquireRefreshLeaseCommand,
  type AuthorizationAuditEvent,
  type CompleteCredentialRevocationCommand,
  type CreateOAuthStateCommand,
  type CreateReauthorizationStateCommand,
  type CompleteRefreshFailureCommand,
  type CredentialRefreshBoundaryEvent,
  type CredentialRefreshBoundaryReporter,
  type DestroyCredentialCommand,
  type ProviderCredentialReadDiagnosticClass,
  type ReadProviderCredentialCommand,
  type ReclaimExpiredRefreshLeaseCommand,
  type RevokeCredentialCommand,
  type RotateCredentialCommand,
  type StoreCredentialCommand,
  type StoreReauthorizedCredentialCommand
} from "@/lib/integrations/credentials/contracts";
import {
  credentialAad,
  credentialAadDigest,
  type CredentialKms
} from "@/lib/integrations/credentials/kms";
import {
  createOAuthStateIntent,
  createReauthorizationStateIntent,
  oauthStateHash,
  reauthorizationStateHash,
  sortedCredentialScopes
} from "@/lib/integrations/credentials/oauth-state";
import { ProviderCredentialRefreshFailure } from "@/lib/integrations/credentials/provider-failure";
import { safeCredentialBrokerError } from "@/lib/integrations/credentials/redaction";
import type { ProviderApplicationSecret } from "@/lib/integrations/credentials/secret-manager";
import { SyntheticProviderFailure } from "@/lib/integrations/credentials/synthetic-provider";
import {
  BoundedIdentifierSchema,
  BoundedLabelSchema,
  IsoTimestampSchema,
  ProviderEnvironmentKeySchema,
  ProviderKeySchema,
  Sha256FingerprintSchema
} from "@/lib/integrations/contracts/primitives";

export type CredentialBrokerStore = Readonly<{
  createOAuthState(command: CreateOAuthStateCommand, requestId: string): PromiseLike<unknown>;
  consumeOAuthState(command: unknown, requestId: string): PromiseLike<unknown>;
  storeCredential(command: StoreCredentialCommand, requestId: string): PromiseLike<unknown>;
  createReauthorizationState(
    command: CreateReauthorizationStateCommand,
    requestId: string
  ): PromiseLike<unknown>;
  consumeReauthorizationState(command: unknown, requestId: string): PromiseLike<unknown>;
  storeReauthorizedCredential(
    command: StoreReauthorizedCredentialCommand,
    requestId: string
  ): PromiseLike<unknown>;
  readProviderCredential(
    command: ReadProviderCredentialCommand,
    requestId: string
  ): PromiseLike<unknown>;
  acquireRefreshLease(command: AcquireRefreshLeaseCommand, requestId: string): PromiseLike<unknown>;
  reclaimExpiredRefreshLease(
    command: ReclaimExpiredRefreshLeaseCommand,
    requestId: string
  ): PromiseLike<unknown>;
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
  recordRefreshBoundaryEvent(
    event: CredentialRefreshBoundaryEvent,
    requestId: string
  ): PromiseLike<unknown>;
}>;

export class ProviderAccessCredential {
  readonly providerKey: string;
  readonly providerEnvironment: string;
  readonly accessExpiresAt: string;
  readonly grantedScopes: readonly string[];
  #accessToken: Buffer | null;

  constructor(input: {
    providerKey: string;
    providerEnvironment: string;
    accessExpiresAt: string;
    grantedScopes: readonly string[];
    accessToken: string;
  }) {
    this.providerKey = input.providerKey;
    this.providerEnvironment = input.providerEnvironment;
    this.accessExpiresAt = input.accessExpiresAt;
    this.grantedScopes = Object.freeze([...input.grantedScopes]);
    this.#accessToken = Buffer.from(input.accessToken, "utf8");
  }

  async use<T>(
    callback: (value: Readonly<{ accessToken: string }>) => T | PromiseLike<T>
  ): Promise<T> {
    if (this.#accessToken === null) {
      throw new Error("provider_access_credential_already_consumed");
    }
    const token = this.#accessToken;
    try {
      return await callback({ accessToken: token.toString("utf8") });
    } finally {
      token.fill(0);
      this.#accessToken = null;
    }
  }

  toJSON() {
    return {
      providerKey: this.providerKey,
      providerEnvironment: this.providerEnvironment,
      accessExpiresAt: this.accessExpiresAt,
      grantedScopes: this.grantedScopes,
      accessToken: "[redacted]"
    };
  }

  toString() {
    return "[ProviderAccessCredential redacted]";
  }
}

export class ProviderCredentialReadFailure extends Error {
  readonly diagnosticClass: ProviderCredentialReadDiagnosticClass;

  constructor(diagnosticClass: ProviderCredentialReadDiagnosticClass) {
    super(safeCredentialBrokerError("credential_read_failed"));
    this.name = "ProviderCredentialReadFailure";
    this.diagnosticClass = ProviderCredentialReadDiagnosticClassSchema.parse(
      diagnosticClass
    );
  }
}

export type ProviderSecretStore = Readonly<{
  access(providerKey: string, environment: string): PromiseLike<ProviderApplicationSecret>;
}>;

export type OAuthCredentialProvider = Readonly<{
  providerKey: string;
  environment: string;
  refreshTokenRotationPolicy: "must_rotate" | "returned_token_authoritative";
  tokenType: "bearer";
  exchangeAuthorizationCode(input: {
    authorizationCode: string;
    externalAuthorizedEntityReference?: string | null;
    applicationSecret: ProviderApplicationSecret;
    requestedScopes: readonly string[];
    now: Date;
  }): PromiseLike<unknown>;
  refreshCredential(input: {
    credential: ReturnType<typeof CredentialEnvelopeSchema.parse>;
    applicationSecret: ProviderApplicationSecret;
    now: Date;
    reportBoundary?: CredentialRefreshBoundaryReporter;
  }): PromiseLike<unknown>;
  revokeCredential(input: {
    credential: ReturnType<typeof CredentialEnvelopeSchema.parse>;
    applicationSecret: ProviderApplicationSecret;
  }): PromiseLike<unknown>;
}>;

export const AuthorizedProviderEntityEvidenceSchema = z
  .object({
    externalAuthorizedEntityReference: BoundedIdentifierSchema,
    providerEntityType: BoundedIdentifierSchema,
    safeDisplayName: BoundedLabelSchema,
    verificationFingerprint: Sha256FingerprintSchema
  })
  .strict();

export type AuthorizedProviderEntityVerifier = Readonly<{
  verify(input: Readonly<{
    externalAuthorizedEntityReference: string;
    credential: ProviderAccessCredential;
  }>): PromiseLike<unknown>;
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

const credentialEnvelopeKeys = [
  "schemaVersion",
  "providerKey",
  "environment",
  "externalAuthorizedEntityReference",
  "accessToken",
  "accessExpiresAt",
  "refreshToken",
  "refreshExpiresAt",
  "grantedScopes",
  "issuedAt",
  "updatedAt"
] as const;

function credentialEnvelopeDiagnosticClass(
  value: unknown
): ProviderCredentialReadDiagnosticClass {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return "unknown_missing_field_contract";
  }
  const record = value as Record<string, unknown>;
  if (!("refreshToken" in record)) return "refresh_token_presence";
  const keys = Object.keys(record).sort();
  if (
    keys.length !== credentialEnvelopeKeys.length ||
    credentialEnvelopeKeys.some((key) => !keys.includes(key))
  ) {
    return "unknown_missing_field_contract";
  }
  if (
    record.schemaVersion !==
    CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope
  ) {
    return "envelope_version";
  }
  if (!ProviderKeySchema.safeParse(record.providerKey).success) {
    return "provider_key";
  }
  if (!ProviderEnvironmentKeySchema.safeParse(record.environment).success) {
    return "provider_environment";
  }
  const grantedScopes = record.grantedScopes;
  if (
    !Array.isArray(grantedScopes) ||
    grantedScopes.some((scope) => typeof scope !== "string") ||
    grantedScopes.length === 0 ||
    new Set(grantedScopes).size !== grantedScopes.length ||
    [...grantedScopes]
      .sort()
      .some((scope, index) => scope !== grantedScopes[index])
  ) {
    return "scope_shape";
  }
  if (
    typeof record.accessToken !== "string" ||
    record.accessToken.length < 16 ||
    record.accessToken.length > 16_384
  ) {
    return "token_shape";
  }
  if (
    typeof record.refreshToken !== "string" ||
    record.refreshToken.length < 16 ||
    record.refreshToken.length > 16_384
  ) {
    return "refresh_token_presence";
  }
  if (
    !IsoTimestampSchema.safeParse(record.accessExpiresAt).success ||
    (record.refreshExpiresAt !== null &&
      !IsoTimestampSchema.safeParse(record.refreshExpiresAt).success) ||
    !IsoTimestampSchema.safeParse(record.issuedAt).success ||
    !IsoTimestampSchema.safeParse(record.updatedAt).success
  ) {
    return "expires_at_shape";
  }
  return "unknown_missing_field_contract";
}

function parseCredentialEnvelopeForRead(plaintext: Buffer) {
  let value: unknown;
  try {
    value = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new ProviderCredentialReadFailure(
      "unknown_missing_field_contract"
    );
  }
  const parsed = CredentialEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new ProviderCredentialReadFailure(
      credentialEnvelopeDiagnosticClass(value)
    );
  }
  return parsed.data;
}

function credentialLifetimeMilliseconds(expiresAt: string, updatedAt: string) {
  return Date.parse(expiresAt) - Date.parse(updatedAt);
}

function exactScopeSet(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((scope, index) => scope === right[index])
  );
}

function credentialFailureReason(error: unknown) {
  if (error instanceof ProviderCredentialRefreshFailure) return error.code;
  if (error instanceof SyntheticProviderFailure) return error.code;
  if (error instanceof Error && error.message.includes("kms")) return "kms_failure";
  return "integrity_failure";
}

function credentialSecretEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  try {
    return leftBytes.byteLength === rightBytes.byteLength && timingSafeEqual(leftBytes, rightBytes);
  } finally {
    leftBytes.fill(0);
    rightBytes.fill(0);
  }
}

export class IntegrationCredentialBroker {
  readonly #store: CredentialBrokerStore;
  readonly #kms: CredentialKms;
  readonly #kmsKeyResource: string;
  readonly #secrets: ProviderSecretStore;
  readonly #provider: OAuthCredentialProvider;
  readonly #authorizedEntityVerifier: AuthorizedProviderEntityVerifier | null;
  readonly #clock: () => Date;

  constructor(input: {
    store: CredentialBrokerStore;
    kms: CredentialKms;
    kmsKeyResource: string;
    secrets: ProviderSecretStore;
    provider: OAuthCredentialProvider;
    authorizedEntityVerifier?: AuthorizedProviderEntityVerifier;
    clock?: () => Date;
  }) {
    this.#store = input.store;
    this.#kms = input.kms;
    this.#kmsKeyResource = input.kmsKeyResource;
    this.#secrets = input.secrets;
    this.#provider = input.provider;
    this.#authorizedEntityVerifier = input.authorizedEntityVerifier ?? null;
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

  async beginReauthorization(
    input: Omit<
      CreateReauthorizationStateCommand,
      | "contractVersion"
      | "id"
      | "stateHash"
      | "createdAt"
      | "expiresAt"
      | "requestedScopes"
      | "redirectUri"
      | "returnIntent"
      | "authorizationPurpose"
      | "reasonCode"
    > & {
      requestedScopes: readonly string[];
      requestId: string;
    }
  ) {
    const { requestId, ...intent } = input;
    const created = createReauthorizationStateIntent(intent, this.#clock());
    const persisted = await this.#store.createReauthorizationState(
      created.command,
      requestId
    );
    return {
      state: created.state,
      expiresAt: created.command.expiresAt,
      authority: persisted
    } as const;
  }

  async completeAuthorization(input: {
    state: string;
    authorizationCode: string;
    externalAuthorizedEntityReference?: string | null;
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
    const authorizationTime = new Date(consumed.consumedAt);
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
          externalAuthorizedEntityReference:
            input.externalAuthorizedEntityReference ?? null,
          applicationSecret,
          requestedScopes: consumed.requestedScopes,
          now: authorizationTime
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

      const authorizedEntity = this.#authorizedEntityVerifier
        ? await this.#verifyAuthorizedEntity(envelope)
        : null;

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
        authorizedAt: consumed.consumedAt
      });
      const result = CredentialMutationResultSchema.parse(
        await this.#store.storeCredential(command, input.storeRequestId)
      );
      return {
        credentialId: result.credentialId,
        credentialVersion: result.credentialVersion,
        connectionStatus: result.connectionStatus,
        returnIntent: consumed.returnIntent,
        authorizedEntity
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

  async completeReauthorization(input: {
    state: string;
    authorizationCode: string;
    externalAuthorizedEntityReference: string;
    workspaceId: string;
    businessEntityId: string;
    connectionId: string;
    connectionGeneration: number;
    mappingId: string;
    providerKey: string;
    providerEnvironment: string;
    initiatedBy: string;
    requestedScopes: readonly string[];
    consumeRequestId: string;
    storeRequestId: string;
  }) {
    const now = this.#clock();
    const realmFingerprint = externalEntityReferenceFingerprint(
      input.externalAuthorizedEntityReference
    );
    if (realmFingerprint === null) {
      throw new Error(safeCredentialBrokerError("authorization_failed"));
    }
    const consumed = ReauthorizationStateConsumeResultSchema.parse(
      await this.#store.consumeReauthorizationState(
        ConsumeReauthorizationStateCommandSchema.parse({
          workspaceId: input.workspaceId,
          businessEntityId: input.businessEntityId,
          connectionId: input.connectionId,
          connectionGeneration: input.connectionGeneration,
          mappingId: input.mappingId,
          providerKey: input.providerKey,
          providerEnvironment: input.providerEnvironment,
          initiatedBy: input.initiatedBy,
          requestedScopes: sortedCredentialScopes(input.requestedScopes),
          redirectUri: PHASE_8B_REAUTHORIZATION_REDIRECT_URI,
          returnIntent: PHASE_8B_REAUTHORIZATION_RETURN_INTENT,
          authorizationPurpose: "reauthorization",
          reasonCode: "expired_credential_recovery",
          stateHash: reauthorizationStateHash(input.state),
          providerEntityReferenceFingerprint: realmFingerprint,
          consumedAt: now.toISOString()
        }),
        input.consumeRequestId
      )
    );
    if (!consumed.accepted) {
      throw new Error(safeCredentialBrokerError("oauth_state_rejected"));
    }
    if (realmFingerprint !== consumed.providerEntityReferenceFingerprint) {
      throw new Error(safeCredentialBrokerError("authorization_failed"));
    }

    const authorizationTime = new Date(consumed.consumedAt);
    let plaintext: Buffer | null = null;
    try {
      if (
        this.#provider.providerKey !== consumed.providerKey ||
        this.#provider.environment !== consumed.providerEnvironment
      ) {
        throw new Error("reauthorization_provider_binding_invalid");
      }
      const applicationSecret = await this.#secrets.access(
        consumed.providerKey,
        consumed.providerEnvironment
      );
      const envelope = CredentialEnvelopeSchema.parse(
        await this.#provider.exchangeAuthorizationCode({
          authorizationCode: input.authorizationCode,
          externalAuthorizedEntityReference:
            input.externalAuthorizedEntityReference,
          applicationSecret,
          requestedScopes: consumed.requestedScopes,
          now: authorizationTime
        })
      );
      if (
        envelope.providerKey !== consumed.providerKey ||
        envelope.environment !== consumed.providerEnvironment ||
        envelope.externalAuthorizedEntityReference !==
          input.externalAuthorizedEntityReference ||
        consumed.requestedScopes.some(
          (scope) => !envelope.grantedScopes.includes(scope)
        )
      ) {
        throw new Error("reauthorization_envelope_binding_invalid");
      }

      const authorizedEntity = await this.#verifyAuthorizedEntity(envelope);
      if (
        authorizedEntity.providerEntityType !== "company" ||
        authorizedEntity.externalAuthorizedEntityReference !==
          input.externalAuthorizedEntityReference
      ) {
        throw new Error("reauthorization_mapping_evidence_invalid");
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
      const command = StoreReauthorizedCredentialCommandSchema.parse({
        contractVersion:
          CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialReauthorization,
        id: credentialId,
        reauthorizationStateId: consumed.stateId,
        workspaceId: consumed.workspaceId,
        businessEntityId: consumed.businessEntityId,
        connectionId: consumed.connectionId,
        connectionGeneration: consumed.connectionGeneration,
        mappingId: consumed.mappingId,
        providerKey: consumed.providerKey,
        providerEnvironment: consumed.providerEnvironment,
        initiatedBy: input.initiatedBy,
        envelopeSchemaVersion:
          CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope,
        aadSchemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad,
        aadDigest: credentialAadDigest(aadContext),
        kmsKeyResource: this.#kmsKeyResource,
        ciphertextBase64: Buffer.from(ciphertext).toString("base64"),
        accessExpiresAt: envelope.accessExpiresAt,
        refreshExpiresAt: envelope.refreshExpiresAt,
        grantedScopes: envelope.grantedScopes,
        externalEntityReferenceFingerprint: realmFingerprint,
        mappingRevalidationFingerprint:
          authorizedEntity.verificationFingerprint,
        reauthorizedAt: consumed.consumedAt
      });
      const result = CredentialReauthorizationResultSchema.parse(
        await this.#store.storeReauthorizedCredential(
          command,
          input.storeRequestId
        )
      );
      return {
        ...result,
        returnIntent: consumed.returnIntent,
        authorizedEntity
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

  async #verifyAuthorizedEntity(
    envelope: ReturnType<typeof CredentialEnvelopeSchema.parse>
  ) {
    const externalReference = envelope.externalAuthorizedEntityReference;
    if (externalReference === null || this.#authorizedEntityVerifier === null) {
      throw new Error("authorization_entity_reference_missing");
    }
    const evidence = AuthorizedProviderEntityEvidenceSchema.parse(
      await this.#authorizedEntityVerifier.verify({
        externalAuthorizedEntityReference: externalReference,
        credential: new ProviderAccessCredential({
          providerKey: envelope.providerKey,
          providerEnvironment: envelope.environment,
          accessExpiresAt: envelope.accessExpiresAt,
          grantedScopes: envelope.grantedScopes,
          accessToken: envelope.accessToken
        })
      })
    );
    if (evidence.externalAuthorizedEntityReference !== externalReference) {
      throw new Error("authorization_entity_reference_mismatch");
    }
    return evidence;
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
      if (acquired.reasonCode === "refresh_lease_held") {
        return CredentialRefreshResultSchema.parse({
          state: "refresh_in_progress",
          refreshed: false,
          reasonCode: safeCredentialBrokerError("refresh_not_acquired"),
          retryAfterSeconds: 5
        });
      }
      if (acquired.reasonCode === "credential_version_stale") {
        return CredentialRefreshResultSchema.parse({
          state: "credential_version_superseded",
          refreshed: false,
          reasonCode: "credential_version_stale"
        });
      }
      return CredentialRefreshResultSchema.parse({
        state: "credential_unavailable",
        refreshed: false,
        reasonCode: safeCredentialBrokerError("refresh_not_acquired")
      });
    }

    let plaintext: Buffer | null = null;
    let nextPlaintext: Buffer | null = null;
    let refreshDiagnostics: ReturnType<typeof CredentialRefreshDiagnosticsSchema.parse> | null = null;
    let decryptSucceeded = false;
    let activeStage: CredentialRefreshBoundaryEvent["stage"] = "broker_decrypt";
    const reportBoundary: CredentialRefreshBoundaryReporter = (event) => {
      activeStage = event.stage;
      return this.#recordRefreshBoundary(
        input,
        acquired.credentialVersion,
        leaseId,
        event
      );
    };
    try {
      await reportBoundary({
        stage: "broker_decrypt",
        outcome: "started",
        reasonCode: "started"
      });
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
      await reportBoundary({
        stage: "broker_decrypt",
        outcome: "succeeded",
        reasonCode: "succeeded"
      });
      try {
        await this.#audit(input, acquired.credentialVersion, {
          action: "credential_decrypt_attempt",
          outcome: "succeeded",
          reasonCode: "decrypt_succeeded",
          occurredAt: now.toISOString()
        });
      } catch {
        // Boundary telemetry is independent of the credential lease/CAS transition.
      }
      const envelope = CredentialEnvelopeSchema.parse(
        JSON.parse(plaintext.toString("utf8"))
      );
      if (
        envelope.providerKey !== acquired.aadContext.providerKey ||
        envelope.environment !== acquired.aadContext.environment
      ) {
        throw new Error("credential_envelope_binding_invalid");
      }
      activeStage = "secret_manager_access";
      await reportBoundary({
        stage: activeStage,
        outcome: "started",
        reasonCode: "started"
      });
      const secret = await this.#secrets.access(
        envelope.providerKey,
        envelope.environment
      );
      await reportBoundary({
        stage: activeStage,
        outcome: "succeeded",
        reasonCode: "succeeded"
      });
      const next = CredentialEnvelopeSchema.parse(
        await this.#provider.refreshCredential({
          credential: envelope,
          applicationSecret: secret,
          now,
          reportBoundary
        })
      );
      activeStage = "credential_cas";
      const refreshTokenEqualToPrior = credentialSecretEqual(
        next.refreshToken,
        envelope.refreshToken
      );
      const accessTokenEqualToPrior = credentialSecretEqual(next.accessToken, envelope.accessToken);
      const scopeEquivalent =
        JSON.stringify(sortedCredentialScopes(next.grantedScopes)) ===
        JSON.stringify(sortedCredentialScopes(envelope.grantedScopes));
      if (
        this.#provider.refreshTokenRotationPolicy === "must_rotate" &&
        refreshTokenEqualToPrior
      ) {
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
      refreshDiagnostics = CredentialRefreshDiagnosticsSchema.parse({
        returnedRefreshTokenPresent: next.refreshToken.length > 0,
        refreshTokenEqualToPrior,
        accessTokenEqualToPrior,
        envelopeByteLength: nextPlaintext.byteLength,
        tokenType: this.#provider.tokenType,
        scopeEquivalent,
        accessExpiresInSeconds: Math.max(
          1,
          Math.ceil((Date.parse(next.accessExpiresAt) - now.getTime()) / 1_000)
        ),
        refreshExpiresInSeconds: next.refreshExpiresAt === null
          ? null
          : Math.max(
              1,
              Math.ceil((Date.parse(next.refreshExpiresAt) - now.getTime()) / 1_000)
            )
      });
      await reportBoundary({
        stage: activeStage,
        outcome: "started",
        reasonCode: "started",
        diagnostics: refreshDiagnostics
      });
      if (nextPlaintext.byteLength > PHASE_5_DIRECT_KMS_MAX_PLAINTEXT_BYTES) {
        throw new Error("credential_envelope_plaintext_too_large");
      }
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
      await reportBoundary({
        stage: activeStage,
        outcome: "succeeded",
        reasonCode: "succeeded",
        diagnostics: refreshDiagnostics
      });
      return CredentialRefreshResultSchema.parse({
        state: "refreshed",
        refreshed: true,
        credentialVersion: result.credentialVersion
      });
    } catch (error) {
      const reasonCode = credentialFailureReason(error);
      await reportBoundary({
        stage: activeStage,
        outcome: "failed",
        reasonCode:
          activeStage === "broker_decrypt" && reasonCode !== "kms_failure"
            ? "integrity_failure"
            : reasonCode,
        diagnostics: refreshDiagnostics
      });
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
      return result.credentialStatus === "reauthorization_required"
        ? CredentialRefreshResultSchema.parse({
            state: "reauthorization_required",
            refreshed: false,
            reasonCode: safeCredentialBrokerError("reauthorization_required")
          })
        : CredentialRefreshResultSchema.parse({
            state: "retry_required",
            refreshed: false,
            reasonCode: safeCredentialBrokerError("refresh_failed"),
            retryAfterSeconds: 15
          });
    } finally {
      plaintext?.fill(0);
      nextPlaintext?.fill(0);
    }
  }

  async reclaimExpiredRefreshLease(
    input: Readonly<{
      workspaceId: string;
      businessEntityId: string;
      connectionId: string;
      connectionGeneration: number;
      credentialId: string;
      expectedCredentialVersion: number;
      expectedCredentialRowVersion: number;
      providerKey: string;
      providerEnvironment: string;
      requestId: string;
    }>
  ) {
    const command = ReclaimExpiredRefreshLeaseCommandSchema.parse({
      contractVersion:
        CREDENTIAL_SECURITY_CONTRACT_VERSIONS.expiredRefreshLeaseReclamation,
      workspaceId: input.workspaceId,
      businessEntityId: input.businessEntityId,
      connectionId: input.connectionId,
      connectionGeneration: input.connectionGeneration,
      credentialId: input.credentialId,
      expectedCredentialVersion: input.expectedCredentialVersion,
      expectedCredentialRowVersion: input.expectedCredentialRowVersion,
      providerKey: input.providerKey,
      providerEnvironment: input.providerEnvironment,
      reasonCode: "refresh_lease_expired_reclaimed"
    });
    return ExpiredRefreshLeaseReclamationResultSchema.parse(
      await this.#store.reclaimExpiredRefreshLease(command, input.requestId)
    );
  }

  async readProviderAccessCredential(input: {
    taskId: string;
    leaseId: string;
    leaseOwnerFingerprint: string;
    expectedCredentialVersion: number;
    requiredScopes: readonly string[];
    minimumValiditySeconds: number;
    requestId: string;
  }) {
    const now = this.#clock();
    let result: ReturnType<typeof ProviderCredentialReadResultSchema.parse>;
    try {
      result = ProviderCredentialReadResultSchema.parse(
        await this.#store.readProviderCredential(
          ReadProviderCredentialCommandSchema.parse({
            contractVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.providerRead,
            taskId: input.taskId,
            leaseId: input.leaseId,
            leaseOwnerFingerprint: input.leaseOwnerFingerprint,
            expectedCredentialVersion: input.expectedCredentialVersion,
            requiredScopes: sortedCredentialScopes(input.requiredScopes),
            minimumValiditySeconds: input.minimumValiditySeconds,
            requestedAt: now.toISOString()
          }),
          input.requestId
        )
      );
    } catch {
      throw new ProviderCredentialReadFailure("reader_contract");
    }
    if (result.state !== "available") return result;

    let plaintext: Buffer | null = null;
    try {
      if (
        result.providerKey !== this.#provider.providerKey ||
        result.providerEnvironment !== this.#provider.environment ||
        result.providerKey !== result.aadContext.providerKey ||
        result.providerEnvironment !== result.aadContext.environment ||
        credentialAadDigest(result.aadContext) !== result.aadDigest
      ) {
        throw new ProviderCredentialReadFailure("aad_binding");
      }
      try {
        plaintext = Buffer.from(
          await this.#kms.decrypt({
            keyResource: result.kmsKeyResource,
            ciphertext: Buffer.from(result.ciphertextBase64, "base64"),
            additionalAuthenticatedData: credentialAad(result.aadContext)
          })
        );
      } catch {
        throw new ProviderCredentialReadFailure("kms_failure");
      }
      const envelope = parseCredentialEnvelopeForRead(plaintext);
      if (envelope.providerKey !== result.providerKey) {
        throw new ProviderCredentialReadFailure("provider_key");
      }
      if (envelope.environment !== result.providerEnvironment) {
        throw new ProviderCredentialReadFailure("provider_environment");
      }
      if (
        !exactScopeSet(envelope.grantedScopes, result.grantedScopes) ||
        input.requiredScopes.some(
          (scope) => !envelope.grantedScopes.includes(scope)
        )
      ) {
        throw new ProviderCredentialReadFailure("scope_shape");
      }
      if (
        externalEntityReferenceFingerprint(
          envelope.externalAuthorizedEntityReference
        ) !== result.externalEntityReferenceFingerprint
      ) {
        throw new ProviderCredentialReadFailure("credential_binding");
      }

      const databaseAccessLifetime = credentialLifetimeMilliseconds(
        result.accessExpiresAt,
        result.ciphertextPersistedAt
      );
      const envelopeAccessLifetime = credentialLifetimeMilliseconds(
        envelope.accessExpiresAt,
        envelope.updatedAt
      );
      const refreshExpiryShapeMatches =
        (result.refreshExpiresAt === null) ===
        (envelope.refreshExpiresAt === null);
      const databaseRefreshLifetime = result.refreshExpiresAt === null
        ? null
        : credentialLifetimeMilliseconds(
            result.refreshExpiresAt,
            result.ciphertextPersistedAt
          );
      const envelopeRefreshLifetime = envelope.refreshExpiresAt === null
        ? null
        : credentialLifetimeMilliseconds(
            envelope.refreshExpiresAt,
            envelope.updatedAt
          );
      if (
        databaseAccessLifetime <= 0 ||
        envelopeAccessLifetime <= 0 ||
        !refreshExpiryShapeMatches ||
        (databaseRefreshLifetime !== null && databaseRefreshLifetime <= 0) ||
        (envelopeRefreshLifetime !== null && envelopeRefreshLifetime <= 0)
      ) {
        throw new ProviderCredentialReadFailure("expires_at_shape");
      }
      if (
        databaseAccessLifetime !== envelopeAccessLifetime ||
        databaseRefreshLifetime !== envelopeRefreshLifetime
      ) {
        throw new ProviderCredentialReadFailure("expires_at_binding");
      }
      if (
        Date.parse(envelope.accessExpiresAt) <=
        now.getTime() + input.minimumValiditySeconds * 1_000
      ) {
        throw new ProviderCredentialReadFailure("credential_expired");
      }
      return {
        state: "available" as const,
        credentialId: result.credentialId,
        credentialVersion: result.credentialVersion,
        credential: new ProviderAccessCredential({
          providerKey: envelope.providerKey,
          providerEnvironment: envelope.environment,
          accessExpiresAt: envelope.accessExpiresAt,
          grantedScopes: envelope.grantedScopes,
          accessToken: envelope.accessToken
        })
      };
    } catch (error) {
      throw error instanceof ProviderCredentialReadFailure
        ? error
        : new ProviderCredentialReadFailure(
            "unknown_missing_field_contract"
          );
    } finally {
      plaintext?.fill(0);
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

  async #recordRefreshBoundary(
    input: {
      workspaceId: string;
      businessEntityId: string;
      connectionId: string;
      connectionGeneration: number;
      credentialId: string;
      workerId: string;
    },
    credentialVersion: number,
    refreshOperationId: string,
    event: Parameters<CredentialRefreshBoundaryReporter>[0]
  ) {
    const requestFingerprint = contractSha256({
      fingerprintPurpose: "credential_refresh_boundary_request",
      fingerprintVersion: "credential_refresh_boundary_request_v1",
      credentialId: input.credentialId,
      credentialVersion,
      refreshOperationId,
      stage: event.stage,
      outcome: event.outcome
    }).slice("sha256:".length);
    try {
      await this.#store.recordRefreshBoundaryEvent(
        CredentialRefreshBoundaryEventSchema.parse({
          contractVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.refreshBoundaryAudit,
          workspaceId: input.workspaceId,
          businessEntityId: input.businessEntityId,
          connectionId: input.connectionId,
          connectionGeneration: input.connectionGeneration,
          credentialId: input.credentialId,
          credentialVersion,
          refreshOperationId,
          actorId: input.workerId,
          ...event,
          diagnostics: event.diagnostics ?? null,
          occurredAt: this.#clock().toISOString()
        }),
        `credential_refresh_boundary_${requestFingerprint}`
      );
    } catch {
      // The boundary result remains redacted and the lease/CAS path stays authoritative.
    }
  }
}
