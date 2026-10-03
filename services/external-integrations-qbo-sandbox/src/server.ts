import "server-only";

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { contractSha256 } from "@/lib/integrations/contracts/canonical";
import { BoundedIdentifierSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import {
  AuthorizedProviderEntityEvidenceSchema,
  IntegrationCredentialBroker,
  ProviderAccessCredential,
  ProviderCredentialReadFailure,
  type CredentialBrokerStore
} from "@/lib/integrations/credentials/broker";
import {
  SecretManagerVersionResourceSchema
} from "@/lib/integrations/credentials/contracts";
import {
  assertAuthorizedProviderEntityEvidence,
  assertCredentialEnvelopeMatchesProviderOAuthPolicy,
  validateProviderOAuthCallbackUri
} from "@/lib/integrations/credentials/oauth-policy";
import { isReauthorizationOAuthState } from "@/lib/integrations/credentials/oauth-state";
import {
  credentialAad,
  credentialAadDigest,
  GoogleCloudKmsCredentialAdapter
} from "@/lib/integrations/credentials/kms";
import { GoogleSecretManagerProviderSecrets } from "@/lib/integrations/credentials/secret-manager";
import {
  acquireIntegrationCredentialRefreshLease,
  completeIntegrationCredentialRefreshFailure,
  completeIntegrationCredentialRevocation,
  consumeIntegrationReauthorizationState,
  consumeIntegrationOAuthState,
  createIntegrationReauthorizationState,
  createIntegrationOAuthState,
  destroyIntegrationCredential,
  readIntegrationProviderCredential,
  reclaimIntegrationExpiredRefreshLease,
  recordIntegrationAuthorizationEvent,
  recordIntegrationCredentialRefreshBoundary,
  recordIntegrationProviderCredentialReadFailure,
  revokeIntegrationCredential,
  rotateIntegrationCredential,
  storeReauthorizedIntegrationCredential,
  storeIntegrationCredential
} from "@/lib/integrations/persistence/credential-repository";
import { resolveProviderAccessCredential } from "@/lib/integrations/provider-runtime/credential-resolution";
import {
  createProviderEntityMapping,
  transitionIntegrationConnection,
  transitionProviderEntityMapping
} from "@/lib/integrations/persistence/control-plane-repository";
import { commitProviderExternalSourceRecordVersion } from "@/lib/integrations/persistence/provider-source-repository";
import {
  failRuntimeTask,
  leaseRuntimeTask,
  recordVerifiedWebhookEvent
} from "@/lib/integrations/persistence/runtime-repository";
import {
  assertQboSandboxRuntimeTaskDeliveryScope,
  completeQboSandboxRuntimeTask,
  QboSandboxCloudTaskNameSchema,
  QBO_SANDBOX_AR_AGING_IDENTIFIER_RECOVERY_CONTRACT_VERSION,
  QBO_SANDBOX_AUTHORIZATION_RECOVERY_CONTRACT_VERSION,
  QBO_SANDBOX_CANARY_DISPATCH_DISCOVERY_CONTRACT_VERSION,
  QBO_SANDBOX_CANARY_DISPATCH_RESERVATION_CONTRACT_VERSION,
  QBO_SANDBOX_CANARY_DUE_RETRY_PROMOTION_CONTRACT_VERSION,
  QBO_SANDBOX_CREDENTIAL_BINDING_INCIDENT_RECOVERY_CONTRACT_VERSION,
  QBO_SANDBOX_DUE_RETRY_PROMOTION_CONTRACT_VERSION,
  QBO_SANDBOX_EXPIRED_CREDENTIAL_RECOVERY_CONTRACT_VERSION,
  QBO_SANDBOX_PROVIDER_RESULT_EVIDENCE_CONTRACT_VERSION,
  QBO_SANDBOX_REAUTHORIZED_PURCHASE_RECOVERY_CONTRACT_VERSION,
  QBO_SANDBOX_REPORT_PARSER_RESULT_EVIDENCE_CONTRACT_VERSION,
  QBO_SANDBOX_SCOPED_DISPATCH_DISCOVERY_CONTRACT_VERSION,
  QBO_SANDBOX_SCOPED_DISPATCH_RECOVERY_CONTRACT_VERSION,
  QBO_SANDBOX_SCOPED_DISPATCH_RESERVATION_CONTRACT_VERSION,
  readQboSandboxAuthorizationRecovery,
  readQboSandboxScopedDispatchCandidates,
  readQboSandboxRuntimeTaskDelivery,
  recordQboSandboxProviderResult,
  recordQboSandboxReportParserResult,
  promoteQboSandboxDueRetryTasks,
  promoteQboSandboxCanaryTask,
  readQboSandboxCanaryDispatchCandidate,
  recoverQboSandboxCredentialBindingIncidentTask,
  recoverQboSandboxArAgingIdentifierFailure,
  recoverQboSandboxExpiredCredentialTasks,
  recoverQboSandboxReauthorizedPurchaseTask,
  QboSandboxRuntimeLeaseResultSchema,
  reserveQboSandboxScopedDispatchTask,
  reserveQboSandboxCanaryDispatchTask,
  sweepQboSandboxScopedDispatchTasks
} from "@/lib/integrations/persistence/qbo-sandbox-runtime-repository";
import {
  readProviderExternalSourceRecordState,
  PROVIDER_SOURCE_STATE_READ_CONTRACT_VERSION
} from "@/lib/integrations/persistence/provider-validation-repository";
import {
  QBO_ACCOUNTING_SCOPE,
  QboSandboxOAuthCredentialProvider,
  createQboSandboxAuthorizationUrl
} from "@/lib/integrations/provider-runtime/qbo/oauth";
import {
  QBO_PHASE_8B_AUTHORIZATION_RETURN_PATH,
  QBO_PHASE_8B_CALLBACK_URI,
  QBO_PHASE_8B_OAUTH_POLICY
} from "@/lib/integrations/provider-runtime/qbo/oauth-policy";
import {
  parseQboOAuthCallbackHandoff,
  sanitizedQboOAuthConfirmationUrl
} from "@/lib/integrations/provider-runtime/qbo/callback-handoff";
import {
  FetchQboOAuthTransport,
  FetchQboRuntimeTransport
} from "@/lib/integrations/provider-runtime/qbo/fetch-transport";
import {
  QboRuntimeProviderError,
  QboSandboxReadOnlyClient
} from "@/lib/integrations/provider-runtime/qbo/client";
import { QboSandboxCompanyVerifier } from "@/lib/integrations/provider-runtime/qbo/company-verification";
import {
  QBO_REPORT_TYPES,
  QBO_MASTER_RECORD_TYPES,
  QBO_TRANSACTION_RECORD_TYPES,
  QboMinimizedSourceRecordSchema,
  QboReportControlObservationSchema,
  QboReportParserOutcomeSchema,
  type QboReportType,
  type QboSupportedObjectType
} from "@/lib/integrations/providers/qbo/contracts";
import {
  bisectQboCdcEntityTypesIfDense,
  bisectQboCdcWindowIfDense,
  planQboCdcWindow
} from "@/lib/integrations/providers/qbo/planning";
import {
  QBO_WEBHOOK_MAX_RAW_BODY_BYTES,
  QBO_WEBHOOK_SIGNATURE_HEADER,
  verifyAndParseQboCloudEventsWebhook
} from "@/lib/integrations/providers/qbo/webhook-signature";
import { minimizeQboSourceRecord } from "@/lib/integrations/providers/qbo/minimizers";
import {
  QboReportContractError,
  parseQboReport
} from "@/lib/integrations/providers/qbo/reports";
import {
  qboMinimizedRecordToExternalSourceVersion,
  qboReportProviderRecordId,
  qboReportToExternalSourceVersion
} from "@/lib/integrations/providers/qbo/source-records";
import {
  RUNTIME_CONTRACT_VERSIONS,
  RuntimeCheckpointCommitSchema
} from "@/lib/integrations/runtime/contracts";

import { Phase8bDatabase } from "./database";
import { parseQboCloudTaskDelivery } from "./cloud-task-delivery";
import {
  googleCreateCloudTask,
  googleCloudKmsTransport,
  googleIdentityToken,
  googleSecretManagerTransport
} from "./google";

const MAX_BODY_BYTES = 32 * 1024;
const QBO_ACCOUNTING_METHOD = "Accrual" as const;
const QBO_CANARY_QUEUE_NAME = "p8b-qbo-canary" as const;

class CredentialResolutionFailure extends Error {
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;
  readonly safeCode: string;

  constructor(input: {
    retryable: boolean;
    retryAfterSeconds: number | null;
    safeCode: string;
  }) {
    super("phase8b_credential_resolution_failed");
    this.name = "CredentialResolutionFailure";
    this.retryable = input.retryable;
    this.retryAfterSeconds = input.retryAfterSeconds;
    this.safeCode = BoundedIdentifierSchema.parse(input.safeCode);
  }
}

const ServiceModeSchema = z.enum([
  "oauth_ingress",
  "credential_broker",
  "task_dispatcher",
  "task_canary_dispatcher",
  "provider_runtime"
]);
type ServiceMode = z.infer<typeof ServiceModeSchema>;

const databaseRolesByMode: Readonly<Record<ServiceMode, readonly string[]>> = {
  oauth_ingress: ["integration_webhook_ingress_authority"],
  credential_broker: [
    "integration_oauth_ingress_authority",
    "integration_credential_broker_authority",
    "integration_control_plane_authority"
  ],
  task_dispatcher: ["integration_task_dispatch_authority"],
  task_canary_dispatcher: ["integration_qbo_canary_dispatch_authority"],
  provider_runtime: [
    "integration_provider_runtime_authority",
    "integration_provider_source_authority"
  ]
};
const OAuthCallbackSchema = z
  .object({
    code: z.string().min(8).max(8_192),
    state: z.string().min(32).max(512).regex(/^[A-Za-z0-9_-]+$/),
    realmId: BoundedIdentifierSchema
  })
  .strict();
const CloudTaskEnvelopeSchema = z
  .object({
    protocolVersion: z.literal(RUNTIME_CONTRACT_VERSIONS.cloudTaskProtocol),
    taskId: UuidSchema
  })
  .strict();

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`phase8b_configuration_missing:${name}`);
  return value;
}

function integerEnv(name: string, fallback?: number) {
  const raw = process.env[name] ?? (fallback === undefined ? null : String(fallback));
  if (raw === null || !/^\d+$/.test(raw)) {
    throw new Error(`phase8b_configuration_invalid:${name}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`phase8b_configuration_invalid:${name}`);
  return value;
}

const config = {
  mode: ServiceModeSchema.parse(env("PHASE8B_SERVICE_MODE")),
  port: integerEnv("PORT", 8080),
  databaseUrl: process.env.DATABASE_URL ?? null,
  brokerUrl: process.env.PHASE8B_BROKER_URL ?? null,
  callbackUrl: process.env.PHASE8B_CALLBACK_URL ?? null,
  callbackConfirmationUrl:
    process.env.PHASE8B_CALLBACK_CONFIRMATION_URL ?? null,
  workspaceId: process.env.PHASE8B_WORKSPACE_ID ?? null,
  businessEntityId: process.env.PHASE8B_BUSINESS_ENTITY_ID ?? null,
  connectionId: process.env.PHASE8B_CONNECTION_ID ?? null,
  connectionGeneration: integerEnv("PHASE8B_CONNECTION_GENERATION", 1),
  connectionRowVersion: process.env.PHASE8B_CONNECTION_ROW_VERSION
    ? integerEnv("PHASE8B_CONNECTION_ROW_VERSION")
    : null,
  initiatedBy: process.env.PHASE8B_INITIATED_BY ?? null,
  mappingId: process.env.PHASE8B_MAPPING_ID ?? null,
  kmsKeyResource: process.env.PHASE8B_KMS_KEY_RESOURCE ?? null,
  providerSecretResource: process.env.PHASE8B_PROVIDER_SECRET_VERSION_RESOURCE ?? null,
  webhookSecretResource: process.env.PHASE8B_WEBHOOK_SECRET_VERSION_RESOURCE ?? null,
  cleanupCapabilitySha256: process.env.PHASE8B_CLEANUP_CAPABILITY_SHA256 ?? null,
  queueName: process.env.PHASE8B_QUEUE_NAME ?? null,
  queueResource: process.env.PHASE8B_QUEUE_RESOURCE ?? null,
  providerRuntimeUrl: process.env.PHASE8B_PROVIDER_RUNTIME_URL ?? null,
  runtimeInvokerServiceAccount:
    process.env.PHASE8B_RUNTIME_INVOKER_SERVICE_ACCOUNT ?? null,
  canaryTaskId: process.env.PHASE8B_CANARY_TASK_ID ?? null
};

function requireCommonScope() {
  return {
    workspaceId: UuidSchema.parse(config.workspaceId),
    businessEntityId: UuidSchema.parse(config.businessEntityId),
    connectionId: UuidSchema.parse(config.connectionId),
    initiatedBy: UuidSchema.parse(config.initiatedBy),
    mappingId: UuidSchema.parse(config.mappingId)
  };
}

function exactPhase8bCallbackUrl() {
  const callbackUrl = env("PHASE8B_CALLBACK_URL");
  if (
    validateProviderOAuthCallbackUri(QBO_PHASE_8B_OAUTH_POLICY, callbackUrl) !==
    QBO_PHASE_8B_CALLBACK_URI
  ) {
    throw new Error("phase8b_callback_url_invalid");
  }
  return callbackUrl;
}

function initialConnectionRowVersion() {
  if (config.connectionRowVersion === null) {
    throw new Error("phase8b_initial_connection_row_version_missing");
  }
  return config.connectionRowVersion;
}

function safeEvent(event: string, details: Record<string, string | number | boolean> = {}) {
  process.stdout.write(`${JSON.stringify({
    component: "phase8b_qbo_sandbox",
    mode: config.mode,
    event,
    ...details
  })}\n`);
}

function json(response: ServerResponse, status: number, value: unknown) {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.byteLength,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
  body.fill(0);
}

function redirect(response: ServerResponse, location: string) {
  response.writeHead(303, {
    location,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  });
  response.end();
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of request) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new Error("phase8b_request_too_large");
      chunks.push(value);
    }
    const body = Buffer.concat(chunks, total);
    try {
      return JSON.parse(body.toString("utf8")) as unknown;
    } finally {
      body.fill(0);
    }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

async function readRawBody(request: IncomingMessage, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of request) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("phase8b_request_too_large");
      chunks.push(value);
    }
    if (total === 0) throw new Error("phase8b_request_body_missing");
    return Buffer.concat(chunks, total);
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

function cleanupCapabilityAuthorized(request: IncomingMessage) {
  const expected = config.cleanupCapabilitySha256;
  const presented = request.headers["x-vaeroex-cleanup-capability"];
  if (
    !expected ||
    !/^sha256:[a-f0-9]{64}$/.test(expected) ||
    typeof presented !== "string" ||
    presented.length < 32 ||
    presented.length > 512
  ) {
    return false;
  }
  const actual = `sha256:${createHash("sha256").update(presented, "utf8").digest("hex")}`;
  return timingSafeEqual(Buffer.from(actual, "utf8"), Buffer.from(expected, "utf8"));
}

async function callBroker(path: string, body: unknown) {
  const broker = new URL(config.brokerUrl ?? "");
  if (broker.protocol !== "https:" || broker.pathname !== "/") {
    throw new Error("phase8b_broker_url_invalid");
  }
  const url = new URL(path, broker);
  if (url.origin !== broker.origin) throw new Error("phase8b_broker_url_invalid");
  const token = await googleIdentityToken(broker.origin);
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const value = await response.json() as Record<string, unknown>;
  if (!response.ok && response.status !== 409) {
    throw new Error("phase8b_broker_request_failed");
  }
  return value;
}

async function callBrokerWebhook(rawBody: Buffer, intuitSignature: string) {
  const broker = new URL(config.brokerUrl ?? "");
  if (broker.protocol !== "https:" || broker.pathname !== "/") {
    throw new Error("phase8b_broker_url_invalid");
  }
  const url = new URL("/webhooks/verify", broker);
  const token = await googleIdentityToken(broker.origin);
  const outbound = new Uint8Array(rawBody);
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        [QBO_WEBHOOK_SIGNATURE_HEADER]: intuitSignature
      },
      body: outbound
    });
    if (!response.ok) throw new Error("phase8b_webhook_verification_failed");
    return await response.json() as Record<string, unknown>;
  } finally {
    outbound.fill(0);
  }
}

function database() {
  return new Phase8bDatabase(
    env("DATABASE_URL"),
    databaseRolesByMode[config.mode]
  );
}

function credentialStore(db: Phase8bDatabase): CredentialBrokerStore {
  const oauth = db.role("integration_oauth_ingress_authority");
  const broker = db.role("integration_credential_broker_authority");
  return {
    createOAuthState: (command, requestId) => createIntegrationOAuthState(command, requestId, oauth),
    consumeOAuthState: (command, requestId) => consumeIntegrationOAuthState(command, requestId, oauth),
    storeCredential: (command, requestId) => storeIntegrationCredential(command, requestId, broker),
    createReauthorizationState: (command, requestId) =>
      createIntegrationReauthorizationState(command, requestId, oauth),
    consumeReauthorizationState: (command, requestId) =>
      consumeIntegrationReauthorizationState(command, requestId, oauth),
    storeReauthorizedCredential: (command, requestId) =>
      storeReauthorizedIntegrationCredential(command, requestId, broker),
    readProviderCredential: (command, requestId) => readIntegrationProviderCredential(command, requestId, broker),
    recordProviderCredentialReadFailure: (command, requestId) =>
      recordIntegrationProviderCredentialReadFailure(command, requestId, broker),
    acquireRefreshLease: (command, requestId) => acquireIntegrationCredentialRefreshLease(command, requestId, broker),
    reclaimExpiredRefreshLease: (command, requestId) =>
      reclaimIntegrationExpiredRefreshLease(command, requestId, broker),
    rotateCredential: (command, requestId) => rotateIntegrationCredential(command, requestId, broker),
    completeRefreshFailure: (command, requestId) => completeIntegrationCredentialRefreshFailure(command, requestId, broker),
    revokeCredential: (command, requestId) => revokeIntegrationCredential(command, requestId, broker),
    completeCredentialRevocation: (command, requestId) => completeIntegrationCredentialRevocation(command, requestId, broker),
    destroyCredential: (command, requestId) => destroyIntegrationCredential(command, requestId, broker),
    recordAuthorizationEvent: (event, requestId) => recordIntegrationAuthorizationEvent(event, requestId, broker),
    recordRefreshBoundaryEvent: (event, requestId) =>
      recordIntegrationCredentialRefreshBoundary(event, requestId, broker)
  };
}

function brokerDependencies(db: Phase8bDatabase) {
  const kmsKeyResource = env("PHASE8B_KMS_KEY_RESOURCE");
  const providerSecretResource = env("PHASE8B_PROVIDER_SECRET_VERSION_RESOURCE");
  const secrets = new GoogleSecretManagerProviderSecrets({
    transport: googleSecretManagerTransport,
    resources: { "quickbooks_online:sandbox": providerSecretResource }
  });
  const provider = new QboSandboxOAuthCredentialProvider({
    redirectUri: exactPhase8bCallbackUrl(),
    transport: new FetchQboOAuthTransport()
  });
  const runtimeTransport = new FetchQboRuntimeTransport();
  const kms = new GoogleCloudKmsCredentialAdapter({
    transport: googleCloudKmsTransport,
    allowedKeyResource: kmsKeyResource
  });
  const companyVerifier = new QboSandboxCompanyVerifier({
    clientForRealm: (realmId) =>
      new QboSandboxReadOnlyClient({ realmId, transport: runtimeTransport })
  });
  const broker = new IntegrationCredentialBroker({
    store: credentialStore(db),
    kms,
    kmsKeyResource,
    secrets,
    provider,
    providerOAuthPolicy: QBO_PHASE_8B_OAUTH_POLICY,
    authorizedEntityVerifier: companyVerifier
  });
  return { broker, secrets, kms, companyVerifier };
}

async function accessWebhookVerifierSecret() {
  const name = SecretManagerVersionResourceSchema.parse(
    env("PHASE8B_WEBHOOK_SECRET_VERSION_RESOURCE")
  );
  try {
    const response = await googleSecretManagerTransport.accessSecretVersion({ name });
    const encoded = response.payload?.data;
    if (!encoded) throw new Error("phase8b_webhook_secret_missing");
    const secret = Buffer.from(encoded, "base64");
    if (secret.byteLength < 16 || secret.byteLength > 16_384) {
      secret.fill(0);
      throw new Error("phase8b_webhook_secret_invalid");
    }
    return secret;
  } catch {
    throw new Error("phase8b_webhook_secret_access_failed");
  }
}

function externalReferenceFingerprint(value: string) {
  return contractSha256({
    fingerprintPurpose: "provider_authorized_entity_reference",
    fingerprintVersion: "provider_authorized_entity_reference_fingerprint_v1",
    value
  });
}

async function authorizationRecovery(db: Phase8bDatabase) {
  const scope = requireCommonScope();
  return readQboSandboxAuthorizationRecovery(
    {
      contractVersion: QBO_SANDBOX_AUTHORIZATION_RECOVERY_CONTRACT_VERSION,
      workspaceId: scope.workspaceId,
      businessEntityId: scope.businessEntityId,
      connectionId: scope.connectionId,
      connectionGeneration: config.connectionGeneration,
      mappingId: scope.mappingId
    },
    db.role("integration_credential_broker_authority")
  );
}

async function recoverAuthorizationEvidence(
  recovery: Awaited<ReturnType<typeof authorizationRecovery>>,
  dependencies: ReturnType<typeof brokerDependencies>
) {
  const credential = recovery.credential;
  if (credentialAadDigest(credential.aadContext) !== credential.aadDigest) {
    throw new Error("phase8b_authorization_recovery_aad_invalid");
  }
  const ciphertext = Buffer.from(credential.ciphertextBase64, "base64");
  let plaintext: Buffer | null = null;
  try {
    plaintext = Buffer.from(
      await dependencies.kms.decrypt({
        keyResource: credential.kmsKeyResource,
        ciphertext,
        additionalAuthenticatedData: credentialAad(credential.aadContext)
      })
    );
    const envelope = assertCredentialEnvelopeMatchesProviderOAuthPolicy(
      QBO_PHASE_8B_OAUTH_POLICY,
      JSON.parse(plaintext.toString("utf8"))
    );
    const realmId = BoundedIdentifierSchema.parse(
      envelope.externalAuthorizedEntityReference
    );
    if (
      envelope.providerKey !== "quickbooks_online" ||
      envelope.environment !== "sandbox" ||
      envelope.grantedScopes.length !== 1 ||
      envelope.grantedScopes[0] !== QBO_ACCOUNTING_SCOPE ||
      externalReferenceFingerprint(realmId) !==
        credential.externalEntityReferenceFingerprint ||
      Date.parse(envelope.accessExpiresAt) <= Date.now() + 30_000
    ) {
      throw new Error("phase8b_authorization_recovery_binding_invalid");
    }
    const evidence = assertAuthorizedProviderEntityEvidence(
      QBO_PHASE_8B_OAUTH_POLICY,
      await dependencies.companyVerifier.verify({
        externalAuthorizedEntityReference: realmId,
        credential: new ProviderAccessCredential({
          providerKey: envelope.providerKey,
          providerEnvironment: envelope.environment,
          accessExpiresAt: envelope.accessExpiresAt,
          grantedScopes: envelope.grantedScopes,
          accessToken: envelope.accessToken
        })
      }),
      { externalAuthorizedEntityReference: realmId, purpose: "authorization" }
    );
    return { evidence, realmId } as const;
  } finally {
    plaintext?.fill(0);
    ciphertext.fill(0);
  }
}

async function finalizeAuthorization(input: {
  db: Phase8bDatabase;
  recovery: Awaited<ReturnType<typeof authorizationRecovery>>;
  evidence: z.infer<typeof AuthorizedProviderEntityEvidenceSchema>;
  realmId: string;
}) {
  const scope = requireCommonScope();
  const expectedReferenceFingerprint = externalReferenceFingerprint(input.realmId);
  if (
    input.evidence.externalAuthorizedEntityReference !== input.realmId ||
    input.recovery.credential.externalEntityReferenceFingerprint !==
      expectedReferenceFingerprint
  ) {
    throw new Error("phase8b_authorization_finalization_binding_invalid");
  }
  const control = input.db.role("integration_control_plane_authority");
  let mapping = input.recovery.mapping;
  if (mapping.state === "missing") {
    const created = await createProviderEntityMapping(
      {
        contractVersion: "provider_entity_mapping_v1",
        id: scope.mappingId,
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        providerEntityType: input.evidence.providerEntityType,
        providerEntityReferenceFingerprint: expectedReferenceFingerprint,
        safeDisplayName: input.evidence.safeDisplayName,
        mappingRole: "primary",
        mappedAt: input.recovery.credential.authorizedAt,
        replacesMappingId: null
      },
      `phase8b_mapping_create_${input.recovery.credential.credentialId}`,
      "phase8b_credential_broker",
      control
    );
    if (created.status !== "pending_verification") {
      throw new Error("phase8b_authorization_mapping_create_state_invalid");
    }
    mapping = {
      state: "available",
      mappingId: created.mappingId,
      status: "pending_verification",
      rowVersion: created.rowVersion,
      providerEntityReferenceFingerprint: expectedReferenceFingerprint,
      verificationFingerprint: null
    };
  }
  if (
    mapping.mappingId !== scope.mappingId ||
    mapping.providerEntityReferenceFingerprint !== expectedReferenceFingerprint
  ) {
    throw new Error("phase8b_authorization_mapping_binding_invalid");
  }
  let mappingStatus = mapping.status;
  if (mappingStatus === "pending_verification") {
    const transitioned = await transitionProviderEntityMapping(
      {
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        mappingId: scope.mappingId,
        expectedRowVersion: mapping.rowVersion,
        targetStatus: "active",
        verificationFingerprint: input.evidence.verificationFingerprint,
        transitionedAt: new Date().toISOString()
      },
      `phase8b_mapping_verify_${input.recovery.credential.credentialId}`,
      "phase8b_credential_broker",
      control
    );
    if (transitioned.status !== "active") {
      throw new Error("phase8b_authorization_mapping_transition_invalid");
    }
    mappingStatus = "active";
  } else if (
    mapping.verificationFingerprint !== input.evidence.verificationFingerprint
  ) {
    throw new Error("phase8b_authorization_mapping_verification_stale");
  }

  let connectionStatus = input.recovery.connectionStatus;
  if (connectionStatus === "authorized_unmapped") {
    const transitioned = await transitionIntegrationConnection(
      {
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        expectedRowVersion: input.recovery.connectionRowVersion,
        expectedGeneration: config.connectionGeneration,
        targetStatus: "initializing",
        stateReasonCode: "initial_sync_pending",
        providerTenantReferenceFingerprint: expectedReferenceFingerprint,
        grantedScopes: [QBO_ACCOUNTING_SCOPE],
        transitionedAt: new Date().toISOString()
      },
      `phase8b_connection_initialize_${input.recovery.credential.credentialId}`,
      "phase8b_credential_broker",
      control
    );
    if (transitioned.connection.status !== "initializing") {
      throw new Error("phase8b_authorization_connection_transition_invalid");
    }
    connectionStatus = "initializing";
  }
  if (mappingStatus !== "active" || connectionStatus !== "initializing") {
    throw new Error("phase8b_authorization_finalization_incomplete");
  }
  return {
    connectionStatus,
    mappingStatus,
    safeDisplayName: input.evidence.safeDisplayName,
    credentialVersion: input.recovery.credential.credentialVersion,
    promotionAuthorized: false,
    modelCallCount: 0
  } as const;
}

async function handleBroker(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" });
  const db = database();
  try {
    if (url.pathname === "/webhooks/verify") {
      const intuitSignature = request.headers[QBO_WEBHOOK_SIGNATURE_HEADER];
      if (typeof intuitSignature !== "string") {
        throw new Error("phase8b_webhook_signature_missing");
      }
      const rawBody = await readRawBody(request, QBO_WEBHOOK_MAX_RAW_BODY_BYTES);
      const secret = await accessWebhookVerifierSecret();
      try {
        const verified = verifyAndParseQboCloudEventsWebhook({
          rawBody,
          intuitSignature,
          verifierSecret: secret,
          expectedProvider: {
            providerKey: "quickbooks_online",
            realmId: env("PHASE8B_SANDBOX_REALM_ID"),
            sourceEnvironment: "sandbox"
          }
        });
        safeEvent("webhook_verified", { eventCount: verified.events.length });
        return json(response, 200, verified);
      } finally {
        rawBody.fill(0);
        secret.fill(0);
      }
    }
    const scope = requireCommonScope();
    const dependencies = brokerDependencies(db);
    if (url.pathname === "/oauth/begin") {
      const authorization = await dependencies.broker.beginAuthorization({
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        providerKey: "quickbooks_online",
        providerEnvironment: "sandbox",
        initiatedBy: scope.initiatedBy,
        requestedScopes: [QBO_ACCOUNTING_SCOPE],
        returnIntent: QBO_PHASE_8B_AUTHORIZATION_RETURN_PATH,
        requestId: `phase8b_oauth_begin_${randomUUID()}`
      });
      const secret = await dependencies.secrets.access("quickbooks_online", "sandbox");
      const authorizationUrl = secret.use(({ clientId }) =>
        createQboSandboxAuthorizationUrl({
          clientId,
          redirectUri: exactPhase8bCallbackUrl(),
          state: authorization.state
        })
      );
      safeEvent("oauth_state_created");
      return json(response, 200, {
        authorizationUrl,
        expiresAt: authorization.expiresAt
      });
    }
    if (url.pathname === "/oauth/reauthorize/begin") {
      const authorization = await dependencies.broker.beginReauthorization({
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        mappingId: scope.mappingId,
        providerKey: "quickbooks_online",
        providerEnvironment: "sandbox",
        initiatedBy: scope.initiatedBy,
        requestedScopes: [QBO_ACCOUNTING_SCOPE],
        requestId: `phase8b_reauthorization_begin_${randomUUID()}`
      });
      const secret = await dependencies.secrets.access(
        "quickbooks_online",
        "sandbox"
      );
      const authorizationUrl = secret.use(({ clientId }) =>
        createQboSandboxAuthorizationUrl({
          clientId,
          redirectUri: exactPhase8bCallbackUrl(),
          state: authorization.state
        })
      );
      safeEvent("reauthorization_state_created");
      return json(response, 200, {
        authorizationUrl,
        expiresAt: authorization.expiresAt
      });
    }
    if (url.pathname === "/oauth/complete") {
      const callback = OAuthCallbackSchema.parse(await readBody(request));
      if (isReauthorizationOAuthState(callback.state)) {
        const result = await dependencies.broker.completeReauthorization({
          state: callback.state,
          authorizationCode: callback.code,
          externalAuthorizedEntityReference: callback.realmId,
          workspaceId: scope.workspaceId,
          businessEntityId: scope.businessEntityId,
          connectionId: scope.connectionId,
          connectionGeneration: config.connectionGeneration,
          mappingId: scope.mappingId,
          providerKey: "quickbooks_online",
          providerEnvironment: "sandbox",
          initiatedBy: scope.initiatedBy,
          requestedScopes: [QBO_ACCOUNTING_SCOPE],
          consumeRequestId: `phase8b_reauthorization_consume_${randomUUID()}`,
          storeRequestId: `phase8b_reauthorization_store_${randomUUID()}`
        });
        if (
          result.connectionStatus !== "initializing" ||
          result.mappingStatus !== "active"
        ) {
          throw new Error("phase8b_reauthorization_lifecycle_invalid");
        }
        safeEvent("reauthorization_completed", {
          connectionInitializing: true,
          mappingActive: true,
          credentialVersion: result.credentialVersion
        });
        return json(response, 200, {
          connectionStatus: result.connectionStatus,
          connectionRowVersion: result.connectionRowVersion,
          mappingStatus: result.mappingStatus,
          mappingRowVersion: result.mappingRowVersion,
          credentialVersion: result.credentialVersion,
          safeDisplayName: result.authorizedEntity.safeDisplayName,
          promotionAuthorized: false,
          modelCallCount: 0
        });
      }
      const result = await dependencies.broker.completeAuthorization({
        state: callback.state,
        authorizationCode: callback.code,
        externalAuthorizedEntityReference: callback.realmId,
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        expectedConnectionRowVersion: initialConnectionRowVersion(),
        providerKey: "quickbooks_online",
        providerEnvironment: "sandbox",
        initiatedBy: scope.initiatedBy,
        requestedScopes: [QBO_ACCOUNTING_SCOPE],
        returnIntent: QBO_PHASE_8B_AUTHORIZATION_RETURN_PATH,
        consumeRequestId: `phase8b_oauth_consume_${randomUUID()}`,
        storeRequestId: `phase8b_credential_store_${randomUUID()}`
      });
      if (!result.authorizedEntity) throw new Error("phase8b_company_evidence_missing");
      const recovery = await authorizationRecovery(db);
      const finalized = await finalizeAuthorization({
        db,
        recovery,
        evidence: result.authorizedEntity,
        realmId: callback.realmId
      });
      safeEvent("oauth_completed", {
        mappingActive: finalized.mappingStatus === "active",
        connectionInitializing: finalized.connectionStatus === "initializing"
      });
      return json(response, 200, finalized);
    }
    if (url.pathname === "/oauth/finalize") {
      await readBody(request);
      const recovery = await authorizationRecovery(db);
      const recovered = await recoverAuthorizationEvidence(recovery, dependencies);
      const finalized = await finalizeAuthorization({
        db,
        recovery,
        evidence: recovered.evidence,
        realmId: recovered.realmId
      });
      safeEvent("oauth_finalization_recovered");
      return json(response, 200, finalized);
    }
    if (url.pathname === "/credentials/read") {
      const body = z
        .object({
          taskId: UuidSchema,
          leaseId: UuidSchema,
          leaseOwnerFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          expectedCredentialVersion: z.number().int().positive().safe()
        })
        .strict()
        .parse(await readBody(request));
      const result = await dependencies.broker
        .readProviderAccessCredential({
          ...body,
          requiredScopes: [QBO_ACCOUNTING_SCOPE],
          minimumValiditySeconds: 300,
          requestId: `phase8b_provider_read_${randomUUID()}`
        })
        .catch((error: unknown) => {
          if (error instanceof ProviderCredentialReadFailure) {
            safeEvent("credential_read_failed", {
              diagnosticClass: error.diagnosticClass
            });
          }
          throw error;
        });
      if (result.state !== "available") {
        return json(response, 409, {
          state: result.state,
          credentialId: result.credentialId,
          credentialVersion: result.credentialVersion,
          accessExpiresAt: result.accessExpiresAt
        });
      }
      return result.credential.use(({ accessToken }) =>
        json(response, 200, {
          state: "available",
          credentialId: result.credentialId,
          credentialVersion: result.credentialVersion,
          credentialReadEvidenceId: result.credentialReadEvidenceId,
          accessExpiresAt: result.credential.accessExpiresAt,
          accessToken
        })
      );
    }
    if (url.pathname === "/credentials/reclaim-expired-refresh-lease") {
      if (!cleanupCapabilityAuthorized(request)) {
        return json(response, 403, { error: "reclamation_capability_denied" });
      }
      const body = z
        .object({
          reclamationRequestId: BoundedIdentifierSchema,
          credentialId: UuidSchema,
          expectedCredentialVersion: z.number().int().positive().safe(),
          expectedCredentialRowVersion: z.number().int().positive().safe()
        })
        .strict()
        .parse(await readBody(request));
      const result = await dependencies.broker.reclaimExpiredRefreshLease({
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        credentialId: body.credentialId,
        expectedCredentialVersion: body.expectedCredentialVersion,
        expectedCredentialRowVersion: body.expectedCredentialRowVersion,
        providerKey: "quickbooks_online",
        providerEnvironment: "sandbox",
        requestId: body.reclamationRequestId
      });
      safeEvent("expired_refresh_lease_reclaimed", {
        credentialVersion: result.credentialVersion,
        credentialRowVersion: result.credentialRowVersion,
        idempotent: result.idempotent
      });
      return json(response, 200, result);
    }
    if (url.pathname === "/credentials/refresh") {
      const body = z
        .object({
          credentialId: UuidSchema,
          expectedCredentialVersion: z.number().int().positive().safe()
        })
        .strict()
        .parse(await readBody(request));
      const result = await dependencies.broker.refreshCredential({
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        credentialId: body.credentialId,
        expectedCredentialVersion: body.expectedCredentialVersion,
        requiredScopes: [QBO_ACCOUNTING_SCOPE],
        workerId: "phase8b_qbo_sandbox_refresh",
        acquireRequestId: `phase8b_refresh_acquire_${randomUUID()}`,
        rotateRequestId: `phase8b_refresh_rotate_${randomUUID()}`,
        failureRequestId: `phase8b_refresh_failure_${randomUUID()}`
      });
      safeEvent("credential_refresh_completed", { refreshed: result.refreshed });
      return json(response, result.refreshed ? 200 : 409, result);
    }
    if (url.pathname === "/tasks/recover-expired-credential") {
      if (!cleanupCapabilityAuthorized(request)) {
        return json(response, 403, { error: "recovery_capability_denied" });
      }
      const body = z
        .object({
          recoveryRequestId: BoundedIdentifierSchema,
          credentialId: UuidSchema,
          expectedCredentialVersion: z.number().int().positive().safe(),
          taskIds: z.array(UuidSchema).min(1).max(100),
          retryAfterSeconds: z.number().int().min(1).max(3_600)
        })
        .strict()
        .parse(await readBody(request));
      const result = await recoverQboSandboxExpiredCredentialTasks(
        {
          contractVersion: QBO_SANDBOX_EXPIRED_CREDENTIAL_RECOVERY_CONTRACT_VERSION,
          workspaceId: scope.workspaceId,
          businessEntityId: scope.businessEntityId,
          connectionId: scope.connectionId,
          connectionGeneration: config.connectionGeneration,
          credentialId: body.credentialId,
          expectedCredentialVersion: body.expectedCredentialVersion,
          taskIds: body.taskIds,
          retryAfterSeconds: body.retryAfterSeconds
        },
        body.recoveryRequestId,
        "phase8b_credential_recovery",
        db.role("integration_credential_broker_authority")
      );
      safeEvent("expired_credential_tasks_recovered", {
        recoveredTaskCount: result.recoveredTaskCount,
        recoveryGeneration: result.recoveryGeneration,
        idempotent: result.idempotent
      });
      return json(response, 200, result);
    }
    if (url.pathname === "/tasks/recover-reauthorized-purchase") {
      if (!cleanupCapabilityAuthorized(request)) {
        return json(response, 403, { error: "recovery_capability_denied" });
      }
      const body = z
        .object({
          recoveryRequestId: BoundedIdentifierSchema,
          credentialId: UuidSchema,
          expectedCredentialVersion: z.number().int().positive().safe(),
          expectedCredentialRowVersion: z.number().int().positive().safe(),
          mappingId: UuidSchema,
          expectedMappingRowVersion: z.number().int().positive().safe(),
          taskId: UuidSchema,
          expectedTaskRowVersion: z.number().int().positive().safe(),
          retryAfterSeconds: z.number().int().min(1).max(3_600)
        })
        .strict()
        .parse(await readBody(request));
      const result = await recoverQboSandboxReauthorizedPurchaseTask(
        {
          contractVersion: QBO_SANDBOX_REAUTHORIZED_PURCHASE_RECOVERY_CONTRACT_VERSION,
          workspaceId: scope.workspaceId,
          businessEntityId: scope.businessEntityId,
          connectionId: scope.connectionId,
          connectionGeneration: config.connectionGeneration,
          credentialId: body.credentialId,
          expectedCredentialVersion: body.expectedCredentialVersion,
          expectedCredentialRowVersion: body.expectedCredentialRowVersion,
          mappingId: body.mappingId,
          expectedMappingRowVersion: body.expectedMappingRowVersion,
          taskId: body.taskId,
          expectedTaskRowVersion: body.expectedTaskRowVersion,
          retryAfterSeconds: body.retryAfterSeconds
        },
        body.recoveryRequestId,
        "phase8b_reauthorized_purchase_recovery",
        db.role("integration_credential_broker_authority")
      );
      safeEvent("reauthorized_purchase_task_recovered", {
        taskId: result.taskId,
        state: result.state,
        idempotent: result.idempotent
      });
      return json(response, 200, result);
    }
    if (url.pathname === "/tasks/recover-credential-binding-incident") {
      if (!cleanupCapabilityAuthorized(request)) {
        return json(response, 403, { error: "recovery_capability_denied" });
      }
      const body = z
        .object({
          recoveryRequestId: BoundedIdentifierSchema,
          mappingId: UuidSchema,
          expectedMappingRowVersion: z.number().int().positive().safe(),
          historicalCredentialId: UuidSchema,
          expectedHistoricalCredentialVersion: z.number().int().positive().safe(),
          currentCredentialId: UuidSchema,
          expectedCurrentCredentialVersion: z.number().int().positive().safe(),
          expectedCurrentCredentialRowVersion: z.number().int().positive().safe(),
          taskId: UuidSchema,
          expectedTaskRowVersion: z.number().int().positive().safe(),
          expectedDispatchGeneration: z.number().int().positive().safe(),
          failureAuditEventId: UuidSchema,
          credentialReadEvidenceId: UuidSchema,
          credentialReadFailureEvidenceId: UuidSchema,
          diagnosticClass: z.literal("expires_at_binding"),
          retryAfterSeconds: z.number().int().min(1).max(3_600)
        })
        .strict()
        .parse(await readBody(request));
      const result = await recoverQboSandboxCredentialBindingIncidentTask(
        {
          contractVersion:
            QBO_SANDBOX_CREDENTIAL_BINDING_INCIDENT_RECOVERY_CONTRACT_VERSION,
          workspaceId: scope.workspaceId,
          businessEntityId: scope.businessEntityId,
          connectionId: scope.connectionId,
          connectionGeneration: config.connectionGeneration,
          mappingId: body.mappingId,
          expectedMappingRowVersion: body.expectedMappingRowVersion,
          historicalCredentialId: body.historicalCredentialId,
          expectedHistoricalCredentialVersion:
            body.expectedHistoricalCredentialVersion,
          currentCredentialId: body.currentCredentialId,
          expectedCurrentCredentialVersion: body.expectedCurrentCredentialVersion,
          expectedCurrentCredentialRowVersion:
            body.expectedCurrentCredentialRowVersion,
          taskId: body.taskId,
          expectedTaskRowVersion: body.expectedTaskRowVersion,
          expectedDispatchGeneration: body.expectedDispatchGeneration,
          failureAuditEventId: body.failureAuditEventId,
          credentialReadEvidenceId: body.credentialReadEvidenceId,
          credentialReadFailureEvidenceId:
            body.credentialReadFailureEvidenceId,
          diagnosticClass: body.diagnosticClass,
          retryAfterSeconds: body.retryAfterSeconds
        },
        body.recoveryRequestId,
        "phase8b_credential_binding_incident_recovery",
        db.role("integration_credential_broker_authority")
      );
      safeEvent("credential_binding_incident_task_recovered", {
        taskId: result.taskId,
        state: result.state,
        idempotent: result.idempotent
      });
      return json(response, 200, result);
    }
    if (url.pathname === "/tasks/recover-ar-aging-identifier") {
      if (!cleanupCapabilityAuthorized(request)) {
        return json(response, 403, { error: "recovery_capability_denied" });
      }
      const body = z
        .object({
          recoveryRequestId: BoundedIdentifierSchema,
          syncRunId: UuidSchema,
          mappingId: UuidSchema,
          expectedMappingRowVersion: z.number().int().positive().safe(),
          historicalCredentialId: UuidSchema,
          expectedHistoricalCredentialVersion: z.number().int().positive().safe(),
          currentCredentialId: UuidSchema,
          expectedCurrentCredentialVersion: z.number().int().positive().safe(),
          expectedCurrentCredentialRowVersion: z.number().int().positive().safe(),
          taskId: z.literal("1eb257e9-5275-51a7-992c-d08186c58c98"),
          expectedTaskRowVersion: z.number().int().positive().safe(),
          expectedDispatchGeneration: z.number().int().positive().safe(),
          failureAuditEventId: UuidSchema,
          credentialReadEvidenceId: UuidSchema,
          retryAfterSeconds: z.number().int().min(1).max(3_600)
        })
        .strict()
        .parse(await readBody(request));
      const result = await recoverQboSandboxArAgingIdentifierFailure(
        {
          contractVersion: QBO_SANDBOX_AR_AGING_IDENTIFIER_RECOVERY_CONTRACT_VERSION,
          workspaceId: scope.workspaceId,
          businessEntityId: scope.businessEntityId,
          connectionId: scope.connectionId,
          connectionGeneration: config.connectionGeneration,
          syncRunId: body.syncRunId,
          mappingId: body.mappingId,
          expectedMappingRowVersion: body.expectedMappingRowVersion,
          historicalCredentialId: body.historicalCredentialId,
          expectedHistoricalCredentialVersion:
            body.expectedHistoricalCredentialVersion,
          currentCredentialId: body.currentCredentialId,
          expectedCurrentCredentialVersion: body.expectedCurrentCredentialVersion,
          expectedCurrentCredentialRowVersion:
            body.expectedCurrentCredentialRowVersion,
          taskId: body.taskId,
          expectedTaskRowVersion: body.expectedTaskRowVersion,
          expectedDispatchGeneration: body.expectedDispatchGeneration,
          failureAuditEventId: body.failureAuditEventId,
          credentialReadEvidenceId: body.credentialReadEvidenceId,
          retryAfterSeconds: body.retryAfterSeconds
        },
        body.recoveryRequestId,
        "phase8b_ar_aging_identifier_recovery",
        db.role("integration_credential_broker_authority")
      );
      safeEvent("ar_aging_identifier_task_recovered", {
        taskId: result.taskId,
        state: result.state,
        idempotent: result.idempotent
      });
      return json(response, 200, result);
    }
    if (url.pathname === "/credentials/disconnect") {
      if (!cleanupCapabilityAuthorized(request)) {
        return json(response, 403, { error: "cleanup_capability_denied" });
      }
      const body = z
        .object({
          credentialId: UuidSchema,
          expectedCredentialVersion: z.number().int().positive().safe()
        })
        .strict()
        .parse(await readBody(request));
      const result = await dependencies.broker.revokeAndDestroyCredential({
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        credentialId: body.credentialId,
        expectedCredentialVersion: body.expectedCredentialVersion,
        workerId: "phase8b_qbo_sandbox_disconnect",
        acquireRequestId: `phase8b_disconnect_acquire_${randomUUID()}`,
        revokeRequestId: `phase8b_disconnect_revoke_${randomUUID()}`,
        revocationResultRequestId: `phase8b_disconnect_result_${randomUUID()}`,
        destroyRequestId: `phase8b_disconnect_destroy_${randomUUID()}`
      });
      safeEvent("credential_disconnect_completed", {
        destroyed: result.destroyed,
        providerRevocationSucceeded: result.providerRevocationOutcome === "succeeded"
      });
      return json(response, result.destroyed ? 200 : 409, result);
    }
    return json(response, 404, { error: "not_found" });
  } finally {
    await db.close();
  }
}

const entityStreams: Readonly<Record<string, QboSupportedObjectType>> = {
  accounts: "Account",
  company_info: "CompanyInfo",
  preferences: "Preferences",
  qbo_bill: "Bill",
  qbo_billpayment: "BillPayment",
  qbo_creditmemo: "CreditMemo",
  customers_minimized: "Customer",
  qbo_deposit: "Deposit",
  qbo_invoice: "Invoice",
  items_minimized: "Item",
  qbo_journalentry: "JournalEntry",
  qbo_payment: "Payment",
  qbo_purchase: "Purchase",
  qbo_refundreceipt: "RefundReceipt",
  qbo_salesreceipt: "SalesReceipt",
  qbo_transfer: "Transfer",
  vendors_minimized: "Vendor",
  qbo_vendorcredit: "VendorCredit"
};
const reportStreams: Readonly<Record<string, QboReportType>> = {
  qbo_apagingsummary: "APAgingSummary",
  qbo_aragingsummary: "ARAgingSummary",
  qbo_balancesheet: "BalanceSheet",
  qbo_cashflow: "CashFlow",
  qbo_profitandloss: "ProfitAndLoss",
  qbo_trialbalance: "TrialBalance"
};
const QBO_CDC_RECORD_TYPES = [
  ...QBO_MASTER_RECORD_TYPES.filter(
    (recordType): recordType is Exclude<(typeof QBO_MASTER_RECORD_TYPES)[number], "CompanyInfo" | "Preferences"> =>
      recordType !== "CompanyInfo" && recordType !== "Preferences"
  ),
  ...QBO_TRANSACTION_RECORD_TYPES
] as const;

type LeasedTask = Readonly<{
  taskId: string;
  workspaceId: string;
  businessEntityId: string;
  connectionId: string;
  connectionGeneration: number;
  syncRunId: string;
  streamKey: string;
  taskKind: string;
  controlMetadata: {
    checkpointId: string | null;
    mappingId: string | null;
    pageOrdinal: number;
    cursorVersion: number;
    windowStartAt: string | null;
    windowEndAt: string | null;
  };
  rowVersion: number;
}>;

function leasedTask(value: unknown): LeasedTask {
  return z
    .object({
      acquired: z.literal(true),
      terminalReplay: z.literal(false),
      taskId: UuidSchema,
      workspaceId: UuidSchema,
      businessEntityId: UuidSchema,
      connectionId: UuidSchema,
      connectionGeneration: z.number().int().positive().safe(),
      syncRunId: UuidSchema,
      streamKey: BoundedIdentifierSchema,
      taskKind: BoundedIdentifierSchema,
      controlMetadata: z
        .object({
          checkpointId: UuidSchema.nullable(),
          mappingId: UuidSchema.nullable(),
          pageOrdinal: z.number().int().nonnegative(),
          cursorVersion: z.number().int().nonnegative(),
          windowStartAt: z.string().datetime({ offset: true }).nullable(),
          windowEndAt: z.string().datetime({ offset: true }).nullable()
        })
        .passthrough(),
      rowVersion: z.number().int().positive().safe()
    })
    .passthrough()
    .parse(value);
}

function sourceStateCommand(task: LeasedTask, leaseId: string, owner: string, recordType: string, recordId: string) {
  if (!task.controlMetadata.mappingId) throw new Error("phase8b_mapping_missing");
  return {
    contractVersion: PROVIDER_SOURCE_STATE_READ_CONTRACT_VERSION,
    taskId: task.taskId,
    leaseId,
    leaseOwnerFingerprint: owner,
    mappingId: task.controlMetadata.mappingId,
    providerRecordType: recordType,
    providerRecordId: recordId
  } as const;
}

async function commitEntityRecord(input: {
  task: LeasedTask;
  leaseId: string;
  owner: string;
  raw: unknown;
  recordType: QboSupportedObjectType;
  realmId: string;
  sourceClient: ReturnType<Phase8bDatabase["role"]>;
  now: string;
}) {
  const record = minimizeQboSourceRecord({
    recordType: input.recordType,
    raw: input.raw,
    provider: {
      providerKey: "quickbooks_online",
      realmId: input.realmId,
      sourceEnvironment: "sandbox"
    }
  });
  const state = await readProviderExternalSourceRecordState(
    sourceStateCommand(input.task, input.leaseId, input.owner, input.recordType, record.id),
    input.sourceClient
  );
  const previous =
    state.state === "available" && state.normalizedProjection
      ? QboMinimizedSourceRecordSchema.parse(state.normalizedProjection)
      : null;
  const version = qboMinimizedRecordToExternalSourceVersion({
    context: {
      workspaceId: input.task.workspaceId,
      businessEntityId: input.task.businessEntityId,
      connectionId: input.task.connectionId,
      providerKey: "quickbooks_online",
      providerEnvironment: "sandbox",
      providerTenantReferenceFingerprint: contractSha256({ realmId: input.realmId }),
      connectionConfigurationVersion: 1,
      mappingVersion: 1
    },
    record,
    id: randomUUID(),
    immutableVersion: state.state === "available" ? state.immutableVersion + 1 : 1,
    priorVersionId: state.state === "available" ? state.currentVersionId : null,
    previousRecord: previous,
    observedAt: input.now,
    synchronizedAt: input.now,
    ingestedAt: input.now,
    receivedAt: input.now
  });
  if (version.changeKind === "unchanged") return null;
  return commitProviderExternalSourceRecordVersion(
    {
      taskId: input.task.taskId,
      leaseId: input.leaseId,
      leaseOwnerFingerprint: input.owner,
      mappingId: input.task.controlMetadata.mappingId ?? "",
      version
    },
    `phase8b_source_${randomUUID()}`,
    input.sourceClient
  );
}

async function commitReport(input: {
  task: LeasedTask;
  leaseId: string;
  owner: string;
  raw: unknown;
  reportType: QboReportType;
  realmId: string;
  sourceClient: ReturnType<Phase8bDatabase["role"]>;
  runtimeClient: ReturnType<Phase8bDatabase["role"]>;
  providerResultEvidenceId: string;
  now: string;
}) {
  const recordParserResult = (parserOutcome: unknown) =>
    recordQboSandboxReportParserResult(
      {
        contractVersion:
          QBO_SANDBOX_REPORT_PARSER_RESULT_EVIDENCE_CONTRACT_VERSION,
        providerResultEvidenceId: input.providerResultEvidenceId,
        parserOutcome: QboReportParserOutcomeSchema.parse(parserOutcome)
      },
      `phase8b_report_parser_${randomUUID()}`,
      input.runtimeClient
    );
  let report: ReturnType<typeof parseQboReport>;
  try {
    report = parseQboReport({
      reportType: input.reportType,
      raw: input.raw,
      provider: {
        providerKey: "quickbooks_online",
        realmId: input.realmId,
        sourceEnvironment: "sandbox"
      }
    });
  } catch (error) {
    if (error instanceof QboReportContractError) {
      await recordParserResult(error.diagnosticClass);
    }
    throw error;
  }
  const recordId = qboReportProviderRecordId(report);
  const state = await readProviderExternalSourceRecordState(
    sourceStateCommand(input.task, input.leaseId, input.owner, report.reportType, recordId),
    input.sourceClient
  );
  const previous =
    state.state === "available" && state.normalizedProjection
      ? QboReportControlObservationSchema.parse(state.normalizedProjection)
      : null;
  let version: ReturnType<typeof qboReportToExternalSourceVersion>;
  try {
    version = qboReportToExternalSourceVersion({
      context: {
        workspaceId: input.task.workspaceId,
        businessEntityId: input.task.businessEntityId,
        connectionId: input.task.connectionId,
        providerKey: "quickbooks_online",
        providerEnvironment: "sandbox",
        providerTenantReferenceFingerprint: contractSha256({ realmId: input.realmId }),
        connectionConfigurationVersion: 1,
        mappingVersion: 1
      },
      report,
      previousReport: previous,
      id: randomUUID(),
      immutableVersion: state.state === "available" ? state.immutableVersion + 1 : 1,
      priorVersionId: state.state === "available" ? state.currentVersionId : null,
      observedAt: input.now,
      synchronizedAt: input.now,
      ingestedAt: input.now,
      receivedAt: input.now
    });
  } catch (error) {
    await recordParserResult("minimization_failure");
    throw error;
  }
  await recordParserResult("parser_success");
  if (version.changeKind === "unchanged") return null;
  return commitProviderExternalSourceRecordVersion(
    {
      taskId: input.task.taskId,
      leaseId: input.leaseId,
      leaseOwnerFingerprint: input.owner,
      mappingId: input.task.controlMetadata.mappingId ?? "",
      version
    },
    `phase8b_report_${randomUUID()}`,
    input.sourceClient
  );
}

function deterministicUuid(value: string) {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function fetchBoundedQboCdc(input: {
  client: QboSandboxReadOnlyClient;
  recordTypes: readonly QboSupportedObjectType[];
  changedSince: string;
  accessToken: string;
  window: ReturnType<typeof planQboCdcWindow>;
}) {
  let requestCount = 0;
  const visit = async (
    recordTypes: readonly QboSupportedObjectType[]
  ): Promise<Array<{ recordType: QboSupportedObjectType; raw: unknown }>> => {
    const page = await input.client.fetchCdc({
      recordTypes,
      changedSince: input.changedSince,
      accessToken: input.accessToken
    });
    requestCount += 1;
    const plannedWindows = bisectQboCdcWindowIfDense({
      window: input.window,
      observedObjectCount: page.observedObjectCount
    });
    if (plannedWindows.length === 1) return page.records;
    const partitions = bisectQboCdcEntityTypesIfDense({
      recordTypes,
      observedObjectCount: page.observedObjectCount
    });
    const records: Array<{ recordType: QboSupportedObjectType; raw: unknown }> = [];
    for (const partition of partitions) {
      records.push(...await visit(partition));
    }
    return records;
  };
  return { records: await visit(input.recordTypes), requestCount } as const;
}

async function handleTaskDispatcher(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
) {
  if (request.method !== "POST" || url.pathname !== "/tasks/dispatch") {
    return json(response, 404, { error: "not_found" });
  }
  const body = z
    .object({ maximumTasks: z.number().int().min(1).max(100) })
    .strict()
    .parse(await readBody(request));
  const queueResource = env("PHASE8B_QUEUE_RESOURCE");
  const queueName = env("PHASE8B_QUEUE_NAME");
  if (!queueResource.endsWith(`/queues/${queueName}`)) {
    throw new Error("phase8b_queue_configuration_mismatch");
  }
  const runtimeOrigin = new URL(env("PHASE8B_PROVIDER_RUNTIME_URL"));
  if (
    runtimeOrigin.protocol !== "https:" ||
    runtimeOrigin.pathname !== "/" ||
    runtimeOrigin.search ||
    runtimeOrigin.hash
  ) {
    throw new Error("phase8b_provider_runtime_url_invalid");
  }
  const targetUrl = new URL("/tasks/execute", runtimeOrigin).toString();
  const db = database();
  const dispatcherClient = db.role("integration_task_dispatch_authority");
  try {
    const scope = requireCommonScope();
    await sweepQboSandboxScopedDispatchTasks(
      {
        contractVersion: QBO_SANDBOX_SCOPED_DISPATCH_RECOVERY_CONTRACT_VERSION,
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        maximumTasks: body.maximumTasks
      },
      `phase8b_sweep_${randomUUID()}`,
      "phase8b_qbo_task_dispatcher",
      dispatcherClient
    );
    await promoteQboSandboxDueRetryTasks(
      {
        contractVersion: QBO_SANDBOX_DUE_RETRY_PROMOTION_CONTRACT_VERSION,
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        maximumTasks: body.maximumTasks
      },
      `phase8b_retry_ready_${randomUUID()}`,
      "phase8b_qbo_task_dispatcher",
      dispatcherClient
    );
    const candidates = await readQboSandboxScopedDispatchCandidates(
      {
        contractVersion: QBO_SANDBOX_SCOPED_DISPATCH_DISCOVERY_CONTRACT_VERSION,
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        maximumTasks: body.maximumTasks
      },
      dispatcherClient
    );
    let created = 0;
    let reused = 0;
    for (const candidate of candidates) {
      const cloudTaskId = createHash("sha256")
        .update(
          [
            "phase8b_qbo_cloud_task_v1",
            candidate.taskId,
            candidate.rowVersion,
            candidate.dispatchGeneration + 1
          ].join(":"),
          "utf8"
        )
        .digest("hex");
      await reserveQboSandboxScopedDispatchTask(
        {
          contractVersion: QBO_SANDBOX_SCOPED_DISPATCH_RESERVATION_CONTRACT_VERSION,
          workspaceId: candidate.workspaceId,
          businessEntityId: candidate.businessEntityId,
          connectionId: candidate.connectionId,
          connectionGeneration: candidate.connectionGeneration,
          taskId: candidate.taskId,
          expectedRowVersion: candidate.rowVersion,
          dispatcherTaskName: cloudTaskId
        },
        `phase8b_reserve_${cloudTaskId}`,
        "phase8b_qbo_task_dispatcher",
        dispatcherClient
      );
      const cloudTask = await googleCreateCloudTask({
        queueResource,
        taskId: cloudTaskId,
        targetUrl,
        oidcServiceAccountEmail: env("PHASE8B_RUNTIME_INVOKER_SERVICE_ACCOUNT"),
        oidcAudience: runtimeOrigin.origin,
        payload: {
          protocolVersion: RUNTIME_CONTRACT_VERSIONS.cloudTaskProtocol,
          taskId: candidate.taskId
        }
      });
      if (cloudTask.created) created += 1;
      else reused += 1;
    }
    safeEvent("provider_tasks_dispatched", {
      candidateCount: candidates.length,
      created,
      reused
    });
    return json(response, 200, {
      candidateCount: candidates.length,
      created,
      reused,
      promotionAuthorized: false,
      modelCallCount: 0
    });
  } finally {
    await db.close();
  }
}

async function handleCanaryTaskDispatcher(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
) {
  if (request.method !== "POST" || url.pathname !== "/tasks/dispatch-canary") {
    return json(response, 404, { error: "not_found" });
  }
  const body = z
    .object({ maximumTasks: z.literal(1) })
    .strict()
    .parse(await readBody(request));
  const queueResource = env("PHASE8B_QUEUE_RESOURCE");
  const queueName = env("PHASE8B_QUEUE_NAME");
  if (
    queueName !== QBO_CANARY_QUEUE_NAME ||
    !queueResource.endsWith(`/queues/${QBO_CANARY_QUEUE_NAME}`)
  ) {
    throw new Error("phase8b_canary_queue_configuration_mismatch");
  }
  const runtimeOrigin = new URL(env("PHASE8B_PROVIDER_RUNTIME_URL"));
  if (
    runtimeOrigin.protocol !== "https:" ||
    runtimeOrigin.pathname !== "/" ||
    runtimeOrigin.search ||
    runtimeOrigin.hash
  ) {
    throw new Error("phase8b_canary_provider_runtime_url_invalid");
  }
  const targetUrl = new URL("/tasks/execute", runtimeOrigin).toString();
  const canaryTaskId = UuidSchema.parse(config.canaryTaskId);
  const db = database();
  const dispatcherClient = db.role("integration_qbo_canary_dispatch_authority");
  try {
    const scope = requireCommonScope();
    await promoteQboSandboxCanaryTask(
      {
        contractVersion: QBO_SANDBOX_CANARY_DUE_RETRY_PROMOTION_CONTRACT_VERSION,
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        taskId: canaryTaskId,
        maximumTasks: body.maximumTasks
      },
      `phase8b_canary_retry_ready_${canaryTaskId}`,
      "phase8b_qbo_canary_dispatcher",
      dispatcherClient
    );
    const candidates = await readQboSandboxCanaryDispatchCandidate(
      {
        contractVersion: QBO_SANDBOX_CANARY_DISPATCH_DISCOVERY_CONTRACT_VERSION,
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        taskId: canaryTaskId,
        maximumTasks: body.maximumTasks
      },
      dispatcherClient
    );
    let created = 0;
    let reused = 0;
    for (const candidate of candidates) {
      if (candidate.taskId !== canaryTaskId || candidate.streamKey !== "company_info") {
        throw new Error("phase8b_canary_candidate_scope_mismatch");
      }
      const cloudTaskId = createHash("sha256")
        .update(
          [
            "phase8b_qbo_canary_cloud_task_v1",
            candidate.taskId,
            candidate.rowVersion,
            candidate.dispatchGeneration + 1
          ].join(":"),
          "utf8"
        )
        .digest("hex");
      await reserveQboSandboxCanaryDispatchTask(
        {
          contractVersion: QBO_SANDBOX_CANARY_DISPATCH_RESERVATION_CONTRACT_VERSION,
          workspaceId: candidate.workspaceId,
          businessEntityId: candidate.businessEntityId,
          connectionId: candidate.connectionId,
          connectionGeneration: candidate.connectionGeneration,
          taskId: candidate.taskId,
          expectedRowVersion: candidate.rowVersion,
          dispatcherTaskName: cloudTaskId
        },
        `phase8b_canary_reserve_${cloudTaskId}`,
        "phase8b_qbo_canary_dispatcher",
        dispatcherClient
      );
      const cloudTask = await googleCreateCloudTask({
        queueResource,
        taskId: cloudTaskId,
        targetUrl,
        oidcServiceAccountEmail: env("PHASE8B_RUNTIME_INVOKER_SERVICE_ACCOUNT"),
        oidcAudience: runtimeOrigin.origin,
        payload: {
          protocolVersion: RUNTIME_CONTRACT_VERSIONS.cloudTaskProtocol,
          taskId: candidate.taskId
        }
      });
      if (cloudTask.created) created += 1;
      else reused += 1;
    }
    safeEvent("canary_provider_task_dispatched", {
      candidateCount: candidates.length,
      created,
      reused
    });
    return json(response, 200, {
      candidateCount: candidates.length,
      created,
      reused,
      maximumTasks: 1,
      promotionAuthorized: false,
      modelCallCount: 0
    });
  } finally {
    await db.close();
  }
}

async function executeProviderTask(request: IncomingMessage, response: ServerResponse) {
  const envelope = CloudTaskEnvelopeSchema.parse(await readBody(request));
  const taskName = request.headers["x-cloudtasks-taskname"];
  const queueName = request.headers["x-cloudtasks-queuename"];
  const retryRaw = request.headers["x-cloudtasks-taskretrycount"];
  const executionRaw = request.headers["x-cloudtasks-taskexecutioncount"];
  if (
    typeof taskName !== "string" ||
    !QboSandboxCloudTaskNameSchema.safeParse(taskName).success ||
    queueName !== config.queueName
  ) {
    throw new Error("phase8b_cloud_task_delivery_invalid");
  }
  const scope = requireCommonScope();
  const db = database();
  const runtimeClient = db.role("integration_provider_runtime_authority");
  const sourceClient = db.role("integration_provider_source_authority");
  const leaseId = randomUUID();
  const owner = contractSha256({
    fingerprintPurpose: "phase8b_provider_runtime_owner",
    fingerprintVersion: "phase8b_provider_runtime_owner_v1",
    service: "provider_runtime"
  });
  let leased: LeasedTask | null = null;
  try {
    const delivery = assertQboSandboxRuntimeTaskDeliveryScope(
      await readQboSandboxRuntimeTaskDelivery(
        envelope.taskId,
        taskName,
        runtimeClient
      ),
      {
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration
      }
    );
    const deliveryMetadata = parseQboCloudTaskDelivery({
      taskId: envelope.taskId,
      workspaceId: delivery.workspaceId,
      businessEntityId: delivery.businessEntityId,
      connectionId: delivery.connectionId,
      connectionGeneration: delivery.connectionGeneration,
      expectedQueueName: config.queueName,
      trustedDispatchGeneration: delivery.dispatchGeneration,
      taskName,
      queueName,
      retryCount: retryRaw,
      executionCount: executionRaw
    });
    if (delivery.state === "succeeded") {
      return json(response, 200, {
        state: "succeeded",
        idempotent: true,
        promotionAuthorized: false,
        modelCallCount: 0
      });
    }
    if (delivery.state !== "dispatched" && delivery.state !== "retry_wait") {
      throw new Error("phase8b_runtime_delivery_state_denied");
    }
    const leaseDecision = QboSandboxRuntimeLeaseResultSchema.parse(
      await leaseRuntimeTask(
        {
          workspaceId: scope.workspaceId,
          businessEntityId: scope.businessEntityId,
          connectionId: scope.connectionId,
          connectionGeneration: config.connectionGeneration,
          taskId: envelope.taskId,
          expectedRowVersion: delivery.rowVersion,
          workerKind: "provider_runtime",
          leaseId,
          leaseOwnerFingerprint: owner,
          leaseSeconds: 300,
          dispatcherTaskName: taskName,
          deliveryDispatchGeneration: deliveryMetadata.dispatchGeneration,
          deliveryRetryCount: deliveryMetadata.retryCount,
          deliveryExecutionCount: deliveryMetadata.executionCount,
          deliveryAttemptFingerprint: deliveryMetadata.attemptFingerprint
        },
        `phase8b_lease_${randomUUID()}`,
        "phase8b_provider_runtime",
        runtimeClient
      )
    );
    if (!leaseDecision.acquired) {
      safeEvent("provider_task_lease_not_acquired", {
        state: leaseDecision.state,
        terminalReplay: leaseDecision.terminalReplay,
        reasonCode: leaseDecision.reasonCode ?? "delivery_replayed"
      });
      if (leaseDecision.terminalReplay || leaseDecision.state === "succeeded") {
        return json(response, 200, {
          state: "succeeded",
          idempotent: true,
          promotionAuthorized: false,
          modelCallCount: 0
        });
      }
      return json(response, 409, {
        state: leaseDecision.state,
        retryable: true,
        leaseAcquired: false,
        promotionAuthorized: false,
        modelCallCount: 0
      });
    }
    leased = leasedTask(leaseDecision);
    const credential = await resolveProviderAccessCredential({
      expectedCredentialVersion: delivery.credentialVersion,
      readCredential: (expectedCredentialVersion) =>
        callBroker("/credentials/read", {
          taskId: envelope.taskId,
          leaseId,
          leaseOwnerFingerprint: owner,
          expectedCredentialVersion
        }),
      refreshCredential: (credentialId, expectedCredentialVersion) =>
        callBroker("/credentials/refresh", {
          credentialId,
          expectedCredentialVersion
        })
    });
    if (credential.state !== "available") {
      throw new CredentialResolutionFailure({
        retryable: credential.state === "retry_wait",
        retryAfterSeconds:
          credential.state === "retry_wait" ? credential.retryAfterSeconds : null,
        safeCode: credential.failureCode
      });
    }
    const realmId = env("PHASE8B_SANDBOX_REALM_ID");
    let providerRequestOrdinal = 0;
    let latestReportProviderResultEvidenceId: string | null = null;
    const client = new QboSandboxReadOnlyClient({
      realmId,
      transport: new FetchQboRuntimeTransport(),
      providerResultObserver: async (observation) => {
        providerRequestOrdinal += 1;
        const evidence = await recordQboSandboxProviderResult(
          {
            contractVersion: QBO_SANDBOX_PROVIDER_RESULT_EVIDENCE_CONTRACT_VERSION,
            credentialReadEvidenceId: credential.credentialReadEvidenceId,
            requestOrdinal: providerRequestOrdinal,
            ...observation
          },
          `phase8b_provider_result_${randomUUID()}`,
          runtimeClient
        );
        if (
          observation.endpointDomain === "report" &&
          observation.providerOutcome === "provider_success"
        ) {
          latestReportProviderResultEvidenceId =
            evidence.providerResultEvidenceId;
        }
      }
    });
    const now = new Date().toISOString();
    const committed: Array<{
      sourceVersionId: string;
      sourceFingerprint: string;
    }> = [];
    let observed = 0;
    let nextStartPosition: number | null = null;
    let cdcRequestCount = 0;
    try {
      const accessToken = credential.accessToken as string;
      const entityType = entityStreams[leased.streamKey];
      const reportType = reportStreams[leased.streamKey];
      if (leased.streamKey === "qbo_cdc") {
        if (!leased.controlMetadata.windowStartAt || !leased.controlMetadata.windowEndAt) {
          throw new Error("phase8b_cdc_window_missing");
        }
        const window = planQboCdcWindow({
          changedSince: leased.controlMetadata.windowStartAt,
          until: leased.controlMetadata.windowEndAt
        });
        const page = await fetchBoundedQboCdc({
          client,
          recordTypes: QBO_CDC_RECORD_TYPES,
          changedSince: window.changedSince,
          accessToken,
          window
        });
        cdcRequestCount = page.requestCount;
        observed = page.records.length;
        for (const item of page.records) {
          const result = await commitEntityRecord({
            task: leased,
            leaseId,
            owner,
            raw: item.raw,
            recordType: item.recordType,
            realmId,
            sourceClient,
            now
          });
          if (result) committed.push(result);
        }
      } else if (entityType) {
        const records = entityType === "CompanyInfo"
          ? [await client.fetchCompanyInfo({ accessToken })]
          : (
              await client.fetchEntityPage({
                recordType: entityType,
                startPosition: leased.controlMetadata.pageOrdinal * 500 + 1,
                maximumResults: 500,
                postingWindow:
                  (QBO_TRANSACTION_RECORD_TYPES as readonly string[]).includes(entityType) &&
                  leased.controlMetadata.windowStartAt &&
                  leased.controlMetadata.windowEndAt
                    ? {
                        startDate: leased.controlMetadata.windowStartAt.slice(0, 10),
                        endDate: leased.controlMetadata.windowEndAt.slice(0, 10)
                      }
                    : null,
                accessToken
              })
            ).records;
        observed = records.length;
        nextStartPosition = records.length === 500
          ? leased.controlMetadata.pageOrdinal * 500 + 501
          : null;
        for (const raw of records) {
          const result = await commitEntityRecord({
            task: leased,
            leaseId,
            owner,
            raw,
            recordType: entityType,
            realmId,
            sourceClient,
            now
          });
          if (result) committed.push(result);
        }
      } else if (reportType && (QBO_REPORT_TYPES as readonly string[]).includes(reportType)) {
        if (!leased.controlMetadata.windowStartAt || !leased.controlMetadata.windowEndAt) {
          throw new Error("phase8b_report_window_missing");
        }
        latestReportProviderResultEvidenceId = null;
        const raw = await client.fetchReport({
          reportType,
          startDate: leased.controlMetadata.windowStartAt.slice(0, 10),
          endDate: leased.controlMetadata.windowEndAt.slice(0, 10),
          accountingMethod: QBO_ACCOUNTING_METHOD,
          accessToken
        });
        observed = 1;
        const result = await commitReport({
          task: leased,
          leaseId,
          owner,
          raw,
          reportType,
          realmId,
          sourceClient,
          runtimeClient,
          providerResultEvidenceId:
            latestReportProviderResultEvidenceId ??
            (() => {
              throw new Error("phase8b_report_provider_result_evidence_missing");
            })(),
          now
        });
        if (result) committed.push(result);
      } else {
        throw new Error("phase8b_stream_key_denied");
      }
    } finally {
      credential.accessToken = "[consumed]";
    }
    const durableEffectFingerprint = contractSha256({
      fingerprintPurpose: "phase8b_qbo_durable_source_page",
      fingerprintVersion: "phase8b_qbo_durable_source_page_v1",
      taskId: leased.taskId,
      streamKey: leased.streamKey,
      committed: committed.map((result) => ({
        sourceVersionId: result.sourceVersionId,
        sourceFingerprint: result.sourceFingerprint
      }))
    });
    const checkpoint = leased.controlMetadata.checkpointId
      ? RuntimeCheckpointCommitSchema.parse({
          checkpointId: leased.controlMetadata.checkpointId,
          expectedCheckpointVersion: leased.controlMetadata.cursorVersion,
          streamKey: leased.streamKey,
          checkpointKind: "cursor",
          cursorVersion: leased.controlMetadata.cursorVersion + 1,
          cursor: {
            protocolVersion: RUNTIME_CONTRACT_VERSIONS.checkpoint,
            cursorKind: "cursor",
            cursorValue: nextStartPosition === null ? "complete" : `start_${nextStartPosition}`,
            windowStartAt: leased.controlMetadata.windowStartAt,
            windowEndAt: leased.controlMetadata.windowEndAt
          },
          cursorFingerprint: contractSha256({
            fingerprintPurpose: "phase8b_qbo_checkpoint_cursor",
            fingerprintVersion: "phase8b_qbo_checkpoint_cursor_v1",
            streamKey: leased.streamKey,
            nextStartPosition,
            pageOrdinal: leased.controlMetadata.pageOrdinal
          }),
          providerWatermarkAt: now,
          overlapSeconds: 300,
          fullReconciliation: leased.taskKind === "full_reconciliation",
          downstreamCommitFingerprint: durableEffectFingerprint
        })
      : null;
    const continuation = nextStartPosition === null
      ? null
      : {
          kind: "next_page" as const,
          childTaskId: deterministicUuid(
            `phase8b_qbo_page_v1:${leased.taskId}:${leased.controlMetadata.pageOrdinal + 1}`
          )
        };
    const completed = await completeQboSandboxRuntimeTask(
      {
        completion: {
        workspaceId: leased.workspaceId,
        businessEntityId: leased.businessEntityId,
        connectionId: leased.connectionId,
        connectionGeneration: leased.connectionGeneration,
        taskId: leased.taskId,
        expectedRowVersion: leased.rowVersion,
        leaseId,
        leaseOwnerFingerprint: owner,
        durableEffectFingerprint,
        checkpoint
        },
        continuation
      },
      `phase8b_complete_${randomUUID()}`,
      "phase8b_provider_runtime",
      runtimeClient
    );
    safeEvent("provider_task_completed", {
      observed,
      committed: committed.length,
      replayed: observed - committed.length,
      hasNextPage: nextStartPosition !== null,
      cdcRequestCount
    });
    return json(response, 200, {
      state: (completed as { state?: unknown }).state,
      observed,
      committed: committed.length,
      nextStartPosition,
      cdcRequestCount,
      continuationTaskId: completed.continuationTaskId,
      promotionAuthorized: false,
      modelCallCount: 0
    });
  } catch (error) {
    const classification =
      error instanceof QboRuntimeProviderError
        ? error.classification
        : null;
    const credentialFailure =
      error instanceof CredentialResolutionFailure ? error : null;
    const reportFailure =
      error instanceof QboReportContractError ? error : null;
    if (leased === null) throw error;
    const failed = await failRuntimeTask(
      {
        workspaceId: scope.workspaceId,
        businessEntityId: scope.businessEntityId,
        connectionId: scope.connectionId,
        connectionGeneration: config.connectionGeneration,
        taskId: envelope.taskId,
        expectedRowVersion: leased.rowVersion,
        leaseId,
        leaseOwnerFingerprint: owner,
        failureCategory:
          credentialFailure && !credentialFailure.retryable
            ? "authorization"
            : credentialFailure?.retryable
              ? "availability"
              : classification?.kind === "rate_limit"
            ? "rate_limit"
            : classification?.retryDisposition === "retry_with_backoff"
              ? "availability"
              : "contract",
        failureCode:
          credentialFailure?.safeCode ??
          classification?.safeCode ??
          "phase8b_provider_task_failed",
        retryable:
          credentialFailure?.retryable ??
          classification?.retryDisposition === "retry_with_backoff",
        retryAfterSeconds:
          credentialFailure?.retryAfterSeconds ??
          (classification?.retryAfterMs
            ? Math.ceil(classification.retryAfterMs / 1_000)
            : null)
      },
      `phase8b_fail_${randomUUID()}`,
      "phase8b_provider_runtime",
      runtimeClient
    );
    const failedState = z
      .object({
        state: z.enum(["retry_wait", "failed", "dead_letter"]),
        retryAfterSeconds: z.number().int().nonnegative().optional()
      })
      .passthrough()
      .parse(failed);
    safeEvent("provider_task_failure_recorded", {
      retryable: failedState.state === "retry_wait",
      state: failedState.state,
      reportDiagnosticClass:
        reportFailure?.diagnosticClass ?? "not_applicable"
    });
    return json(response, 200, {
      state: failedState.state,
      retryAfterSeconds: failedState.retryAfterSeconds ?? null,
      durableFailureRecorded: true,
      promotionAuthorized: false,
      modelCallCount: 0
    });
  } finally {
    await db.close();
  }
}

async function handleIngress(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method === "POST" && url.pathname === "/webhooks/qbo") {
    const intuitSignature = request.headers[QBO_WEBHOOK_SIGNATURE_HEADER];
    if (typeof intuitSignature !== "string") {
      throw new Error("phase8b_webhook_signature_missing");
    }
    const rawBody = await readRawBody(request, QBO_WEBHOOK_MAX_RAW_BODY_BYTES);
    const db = database();
    try {
      const result = await callBrokerWebhook(rawBody, intuitSignature);
      const verified = z
        .object({
          deliveryHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          events: z.array(
            z
              .object({
                eventId: BoundedIdentifierSchema,
                eventType: BoundedIdentifierSchema,
                realmId: BoundedIdentifierSchema,
                recordType: BoundedIdentifierSchema,
                providerRecordId: BoundedIdentifierSchema,
                changeKind: BoundedIdentifierSchema,
                signatureVerification: z.literal("verified_hmac_sha256"),
                hintOnly: z.literal(true)
              })
              .passthrough()
          ).max(1_000)
        })
        .strict()
        .parse(result);
      const webhookClient = db.role("integration_webhook_ingress_authority");
      let replayed = 0;
      for (const event of verified.events) {
        const persisted = await recordVerifiedWebhookEvent(
          {
            id: randomUUID(),
            providerKey: "quickbooks_online",
            providerEnvironment: "sandbox",
            specificationVersion: "1.0",
            eventType: event.eventType,
            providerEventFingerprint: contractSha256({
              fingerprintPurpose: "qbo_webhook_event_identity",
              fingerprintVersion: "qbo_webhook_event_identity_v1",
              eventId: event.eventId,
              eventType: event.eventType,
              realmId: event.realmId,
              recordType: event.recordType,
              providerRecordId: event.providerRecordId,
              changeKind: event.changeKind
            }),
            deliveryHash: verified.deliveryHash,
            providerAccountReferenceFingerprint: externalReferenceFingerprint(event.realmId),
            providerEntityType: "company",
            providerEntityReferenceFingerprint: externalReferenceFingerprint(event.realmId),
            verifiedAt: new Date().toISOString()
          },
          `phase8b_webhook_${randomUUID()}`,
          webhookClient
        ) as { idempotent?: unknown };
        if (persisted.idempotent === true) replayed += 1;
      }
      safeEvent("webhook_hints_recorded", {
        eventCount: verified.events.length,
        replayed
      });
      return json(response, 200, {
        accepted: true,
        eventCount: verified.events.length,
        replayed,
        hintOnly: true,
        promotionAuthorized: false,
        modelCallCount: 0
      });
    } finally {
      rawBody.fill(0);
      await db.close();
    }
  }
  if (request.method !== "GET") return json(response, 405, { error: "method_not_allowed" });
  if (url.pathname === "/oauth/callback") {
    const callback = parseQboOAuthCallbackHandoff({
      method: request.method,
      requestUrl: request.url ?? "",
      headers: request.headers
    });
    safeEvent("oauth_callback_handoff_accepted");
    try {
      await callBroker("/oauth/complete", callback);
      safeEvent("oauth_callback_completion_accepted");
    } catch {
      if (isReauthorizationOAuthState(callback.state)) {
        throw new Error("phase8b_reauthorization_completion_failed");
      }
      safeEvent("oauth_callback_recovery_attempted");
      await callBroker("/oauth/finalize", {});
      safeEvent("oauth_callback_recovery_accepted");
    }
    return redirect(
      response,
      sanitizedQboOAuthConfirmationUrl(
        config.callbackConfirmationUrl ?? ""
      )
    );
  }
  return json(response, 404, { error: "not_found" });
}

async function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://phase8b.invalid");
  if (url.pathname === "/health") {
    return json(response, 200, {
      ok: true,
      mode: config.mode,
      providerEnvironment: "sandbox",
      promotionAuthorized: false,
      modelCallCount: 0
    });
  }
  if (config.mode === "oauth_ingress") return handleIngress(request, response, url);
  if (config.mode === "credential_broker") return handleBroker(request, response, url);
  if (config.mode === "task_dispatcher") {
    return handleTaskDispatcher(request, response, url);
  }
  if (config.mode === "task_canary_dispatcher") {
    return handleCanaryTaskDispatcher(request, response, url);
  }
  if (request.method === "POST" && url.pathname === "/tasks/execute") {
    return executeProviderTask(request, response);
  }
  return json(response, 404, { error: "not_found" });
}

const server = createServer((request, response) => {
  route(request, response).catch(() => {
    safeEvent("request_failed");
    if (!response.headersSent) json(response, 500, { error: "phase8b_request_failed" });
    else response.end();
  });
});

server.listen(config.port, "0.0.0.0", () => {
  safeEvent("service_started", { port: config.port });
});
