import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { z } from "zod";

import { canonicalContractJson, contractSha256 } from "@/lib/integrations/contracts/canonical";
import { BoundedIdentifierSchema, UuidSchema } from "@/lib/integrations/contracts/primitives";
import {
  AuthorizedProviderEntityEvidenceSchema,
  IntegrationCredentialBroker,
  ProviderAccessCredential,
  ProviderCredentialReadFailure,
  type CredentialBrokerStore
} from "@/lib/integrations/credentials/broker";
import {
  CREDENTIAL_SECURITY_CONTRACT_VERSIONS,
  CredentialAadContextSchema,
  CredentialEnvelopeSchema,
  SecretManagerVersionResourceSchema,
  StoreCredentialCommandSchema
} from "@/lib/integrations/credentials/contracts";
import { credentialAad, credentialAadDigest, GoogleCloudKmsCredentialAdapter } from "@/lib/integrations/credentials/kms";
import { oauthStateHash, reauthorizationStateHash } from "@/lib/integrations/credentials/oauth-state";
import { GoogleSecretManagerProviderSecrets } from "@/lib/integrations/credentials/secret-manager";
import {
  acquireIntegrationCredentialRefreshLease,
  completeIntegrationCredentialRefreshFailure,
  completeIntegrationCredentialRevocation,
  consumeIntegrationOAuthState,
  consumeIntegrationReauthorizationState,
  createIntegrationOAuthState,
  createIntegrationReauthorizationState,
  destroyIntegrationCredential,
  readIntegrationProviderCredential,
  reclaimIntegrationExpiredRefreshLease,
  recordIntegrationAuthorizationEvent,
  recordIntegrationCredentialRefreshBoundary,
  recordIntegrationProviderCredentialReadFailure,
  revokeIntegrationCredential,
  rotateIntegrationCredential,
  storeIntegrationCredential,
  storeReauthorizedIntegrationCredential
} from "@/lib/integrations/persistence/credential-repository";
import {
  createProviderEntityMapping,
  transitionIntegrationConnection,
  transitionProviderEntityMapping
} from "@/lib/integrations/persistence/control-plane-repository";
import {
  consumeQboCustomerOAuthState,
  consumeQboCustomerReauthorizationState,
  confirmQboRuntimeCloudTaskStaged,
  discoverQboRuntimeDispatch,
  discoverQboRuntimeDispatchReconciliation,
  readQboRuntimeConfiguration,
  readQboRuntimeTaskDelivery,
  scheduleQboProductionInitialization,
  storeQboCustomerReauthorizedCredential
} from "@/lib/integrations/persistence/qbo-production-repository";
import {
  failRuntimeTask,
  leaseRuntimeTask,
  markRuntimeTaskDispatched,
  recordVerifiedWebhookEvent
} from "@/lib/integrations/persistence/runtime-repository";
import { resolveProviderAccessCredential } from "@/lib/integrations/provider-runtime/credential-resolution";
import {
  parseQboOAuthCallbackHandoff,
  sanitizedQboOAuthConfirmationUrl
} from "@/lib/integrations/provider-runtime/qbo/callback-handoff";
import { QboReadOnlyClient, QboRuntimeProviderError } from "@/lib/integrations/provider-runtime/qbo/client";
import { QboCompanyVerifier } from "@/lib/integrations/provider-runtime/qbo/company-verification";
import { FetchQboOAuthTransport, FetchQboRuntimeTransport } from "@/lib/integrations/provider-runtime/qbo/fetch-transport";
import {
  QBO_ACCOUNTING_SCOPE,
  QboOAuthCredentialProvider
} from "@/lib/integrations/provider-runtime/qbo/oauth";
import {
  QBO_WEBHOOK_MAX_RAW_BODY_BYTES,
  QBO_WEBHOOK_SIGNATURE_HEADER,
  verifyAndParseQboCloudEventsWebhook
} from "@/lib/integrations/providers/qbo/webhook-signature";
import { CloudTaskEnvelopeSchema, RUNTIME_CONTRACT_VERSIONS } from "@/lib/integrations/runtime/contracts";

import { parseQboProductionCloudTaskDelivery } from "./cloud-task-delivery";
import { QboProductionDatabase } from "./database";
import { executeQboProductionRead, type QboProductionLeasedTask } from "./executor";
import {
  googleCloudKmsTransport,
  googleCreateCloudTask,
  googleIdentityToken,
  googleSecretManagerTransport
} from "./google";

const MAX_BODY_BYTES = 32 * 1024;
const ServiceModeSchema = z.enum([
  "oauth_ingress",
  "credential_broker",
  "task_scheduler",
  "task_dispatcher",
  "provider_runtime"
]);
type ServiceMode = z.infer<typeof ServiceModeSchema>;

const rolesByMode: Readonly<Record<ServiceMode, readonly string[]>> = {
  oauth_ingress: ["integration_webhook_ingress_authority"],
  credential_broker: [
    "integration_oauth_ingress_authority",
    "integration_credential_broker_authority",
    "integration_control_plane_authority"
  ],
  task_scheduler: ["integration_task_scheduler_authority"],
  task_dispatcher: ["integration_task_dispatch_authority"],
  provider_runtime: [
    "integration_provider_runtime_authority",
    "integration_provider_source_authority"
  ]
};

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`qbo_production_configuration_missing:${name}`);
  return value;
}

function integerEnv(name: string, fallback: number) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^[1-9][0-9]*$/.test(raw)) throw new Error(`qbo_production_configuration_invalid:${name}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`qbo_production_configuration_invalid:${name}`);
  return value;
}

const config = {
  mode: ServiceModeSchema.parse(env("QBO_SERVICE_MODE")),
  port: integerEnv("PORT", 8080),
  databaseUrl: env("DATABASE_URL"),
  brokerUrl: process.env.QBO_BROKER_URL ?? null,
  callbackUrl: process.env.QBO_PRODUCTION_CALLBACK_URI ?? null,
  kmsKeyResource: process.env.QBO_KMS_KEY_RESOURCE ?? null,
  providerSecretResource: process.env.QBO_PROVIDER_SECRET_VERSION_RESOURCE ?? null,
  webhookSecretResource: process.env.QBO_WEBHOOK_SECRET_VERSION_RESOURCE ?? null,
  queueName: process.env.QBO_QUEUE_NAME ?? null,
  queueResource: process.env.QBO_QUEUE_RESOURCE ?? null,
  runtimeUrl: process.env.QBO_PROVIDER_RUNTIME_URL ?? null,
  runtimeInvokerServiceAccount: process.env.QBO_RUNTIME_INVOKER_SERVICE_ACCOUNT ?? null,
  sourceCommit: env("QBO_SOURCE_COMMIT")
};

for (const value of Object.values(config)) {
  if (typeof value === "string" && /(?:phase8b|p8b|canary|sslip\.io|sandbox)/i.test(value)) {
    throw new Error("qbo_production_disposable_configuration_denied");
  }
}

function database() {
  return new QboProductionDatabase(config.databaseUrl, rolesByMode[config.mode]);
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

function safeEvent(event: string, details: Record<string, string | number | boolean> = {}) {
  process.stdout.write(`${JSON.stringify({
    component: "qbo_production_runtime",
    mode: config.mode,
    event,
    ...details
  })}\n`);
}

async function readBody(request: IncomingMessage) {
  const declared = Number(request.headers["content-length"] ?? "0");
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_BODY_BYTES) {
    throw new Error("qbo_production_request_body_invalid");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_BODY_BYTES) throw new Error("qbo_production_request_body_invalid");
    chunks.push(bytes);
  }
  const body = Buffer.concat(chunks);
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } finally {
    body.fill(0);
    chunks.forEach((chunk) => chunk.fill(0));
  }
}

async function readRawBody(request: IncomingMessage, maximumBytes: number) {
  const contentLength = request.headers["content-length"];
  const declared = contentLength === undefined || Array.isArray(contentLength)
    ? null
    : Number(contentLength);
  if (
    Array.isArray(contentLength) ||
    (declared !== null &&
      (!Number.isSafeInteger(declared) || declared < 1 || declared > maximumBytes))
  ) {
    throw new Error("qbo_production_request_body_invalid");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > maximumBytes) throw new Error("qbo_production_request_body_invalid");
      chunks.push(bytes);
    }
    if (total === 0 || (declared !== null && total !== declared)) {
      throw new Error("qbo_production_request_body_invalid");
    }
    return Buffer.concat(chunks, total);
  } finally {
    chunks.forEach((chunk) => chunk.fill(0));
  }
}

function callbackUrl() {
  const value = new URL(config.callbackUrl ?? "");
  if (value.protocol !== "https:" || value.username || value.password || value.search || value.hash) {
    throw new Error("qbo_production_callback_invalid");
  }
  return value.toString();
}

function queueConfiguration() {
  const queueName = z.string().regex(/^[a-z][a-z0-9-]{0,62}$/).parse(config.queueName);
  const queueResource = z.string().regex(/^projects\/[a-z][a-z0-9-]{0,62}\/locations\/[a-z][a-z0-9-]{0,62}\/queues\/[a-z][a-z0-9-]{0,62}$/).parse(config.queueResource);
  if (!queueResource.endsWith(`/queues/${queueName}`)) {
    throw new Error("qbo_production_queue_configuration_mismatch");
  }
  return { queueName, queueResource } as const;
}

function externalReferenceFingerprint(value: string | null) {
  if (value === null) return null;
  return contractSha256({
    fingerprintPurpose: "provider_authorized_entity_reference",
    fingerprintVersion: "provider_authorized_entity_reference_fingerprint_v1",
    value
  });
}

function credentialStore(db: QboProductionDatabase): CredentialBrokerStore {
  const oauth = db.role("integration_oauth_ingress_authority");
  const broker = db.role("integration_credential_broker_authority");
  return {
    createOAuthState: (command, requestId) => createIntegrationOAuthState(command, requestId, oauth),
    consumeOAuthState: (command, requestId) => consumeIntegrationOAuthState(command, requestId, oauth),
    storeCredential: (command, requestId) => storeIntegrationCredential(command, requestId, broker),
    createReauthorizationState: (command, requestId) => createIntegrationReauthorizationState(command, requestId, oauth),
    consumeReauthorizationState: (command, requestId) => consumeIntegrationReauthorizationState(command, requestId, oauth),
    storeReauthorizedCredential: (command, requestId) => storeReauthorizedIntegrationCredential(command, requestId, broker),
    readProviderCredential: (command, requestId) => readIntegrationProviderCredential(command, requestId, broker),
    recordProviderCredentialReadFailure: (command, requestId) => recordIntegrationProviderCredentialReadFailure(command, requestId, broker),
    acquireRefreshLease: (command, requestId) => acquireIntegrationCredentialRefreshLease(command, requestId, broker),
    reclaimExpiredRefreshLease: (command, requestId) => reclaimIntegrationExpiredRefreshLease(command, requestId, broker),
    rotateCredential: (command, requestId) => rotateIntegrationCredential(command, requestId, broker),
    completeRefreshFailure: (command, requestId) => completeIntegrationCredentialRefreshFailure(command, requestId, broker),
    revokeCredential: (command, requestId) => revokeIntegrationCredential(command, requestId, broker),
    completeCredentialRevocation: (command, requestId) => completeIntegrationCredentialRevocation(command, requestId, broker),
    destroyCredential: (command, requestId) => destroyIntegrationCredential(command, requestId, broker),
    recordAuthorizationEvent: (event, requestId) => recordIntegrationAuthorizationEvent(event, requestId, broker),
    recordRefreshBoundaryEvent: (event, requestId) => recordIntegrationCredentialRefreshBoundary(event, requestId, broker)
  };
}

function brokerDependencies(db: QboProductionDatabase) {
  const kmsKeyResource = env("QBO_KMS_KEY_RESOURCE");
  const providerSecretResource = SecretManagerVersionResourceSchema.parse(env("QBO_PROVIDER_SECRET_VERSION_RESOURCE"));
  const secrets = new GoogleSecretManagerProviderSecrets({
    transport: googleSecretManagerTransport,
    resources: { "quickbooks_online:production": providerSecretResource }
  });
  const provider = new QboOAuthCredentialProvider({
    environment: "production",
    redirectUri: callbackUrl(),
    transport: new FetchQboOAuthTransport()
  });
  const kms = new GoogleCloudKmsCredentialAdapter({
    transport: googleCloudKmsTransport,
    allowedKeyResource: kmsKeyResource
  });
  const verifier = new QboCompanyVerifier({
    providerEnvironment: "production",
    clientForRealm: (realmId) => new QboReadOnlyClient({
      realmId,
      providerEnvironment: "production",
      transport: new FetchQboRuntimeTransport()
    })
  });
  const broker = new IntegrationCredentialBroker({
    store: credentialStore(db),
    kms,
    kmsKeyResource,
    secrets,
    provider,
    authorizedEntityVerifier: verifier
  });
  return { broker, kms, kmsKeyResource, provider, secrets, verifier } as const;
}

const CallbackSchema = z.object({
  code: z.string().min(8).max(8_192),
  state: z.string().min(46).max(46).regex(/^(?:i1_|r1_)[A-Za-z0-9_-]{43}$/),
  realmId: BoundedIdentifierSchema
}).strict();

async function exchangeAndVerify(
  callback: z.infer<typeof CallbackSchema>,
  consumed: {
    providerEnvironment: "production";
    requestedScopes: readonly string[];
    consumedAt: string;
  },
  dependencies: ReturnType<typeof brokerDependencies>
) {
  const secret = await dependencies.secrets.access("quickbooks_online", "production");
  const envelope = CredentialEnvelopeSchema.parse(await dependencies.provider.exchangeAuthorizationCode({
    authorizationCode: callback.code,
    externalAuthorizedEntityReference: callback.realmId,
    applicationSecret: secret,
    requestedScopes: consumed.requestedScopes,
    now: new Date(consumed.consumedAt)
  }));
  const evidence = AuthorizedProviderEntityEvidenceSchema.parse(await dependencies.verifier.verify({
    externalAuthorizedEntityReference: callback.realmId,
    credential: new ProviderAccessCredential({
      providerKey: envelope.providerKey,
      providerEnvironment: envelope.environment,
      accessExpiresAt: envelope.accessExpiresAt,
      grantedScopes: envelope.grantedScopes,
      accessToken: envelope.accessToken
    })
  }));
  if (evidence.externalAuthorizedEntityReference !== callback.realmId) {
    throw new Error("qbo_production_authorized_entity_mismatch");
  }
  return { envelope, evidence } as const;
}

async function encryptedCredential(input: {
  envelope: z.infer<typeof CredentialEnvelopeSchema>;
  workspaceId: string;
  connectionId: string;
  connectionGeneration: number;
  credentialId: string;
  dependencies: ReturnType<typeof brokerDependencies>;
}) {
  const aadContext = CredentialAadContextSchema.parse({
    schemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad,
    purpose: "provider_oauth_credential",
    environment: "production",
    workspaceId: input.workspaceId,
    connectionId: input.connectionId,
    connectionGeneration: input.connectionGeneration,
    providerKey: "quickbooks_online",
    credentialId: input.credentialId
  });
  const plaintext = Buffer.from(canonicalContractJson(input.envelope), "utf8");
  try {
    const ciphertext = await input.dependencies.kms.encrypt({
      keyResource: input.dependencies.kmsKeyResource,
      plaintext,
      additionalAuthenticatedData: credentialAad(aadContext)
    });
    return {
      aadContext,
      aadDigest: credentialAadDigest(aadContext),
      ciphertextBase64: Buffer.from(ciphertext).toString("base64")
    } as const;
  } finally {
    plaintext.fill(0);
  }
}

async function completeInitialAuthorization(
  callback: z.infer<typeof CallbackSchema>,
  db: QboProductionDatabase,
  dependencies: ReturnType<typeof brokerDependencies>
) {
  const consumed = await consumeQboCustomerOAuthState(
    {
      contractVersion: "qbo_customer_oauth_state_consume_v2",
      stateHash: oauthStateHash(callback.state),
      redirectUri: callbackUrl()
    },
    `qbo_oauth_consume_${randomUUID()}`,
    db.role("integration_oauth_ingress_authority")
  );
  if (!consumed.accepted) throw new Error("qbo_production_oauth_state_rejected");
  const { envelope, evidence } = await exchangeAndVerify(callback, consumed, dependencies);
  const credentialId = randomUUID();
  const encrypted = await encryptedCredential({
    envelope,
    workspaceId: consumed.workspaceId,
    connectionId: consumed.connectionId,
    connectionGeneration: consumed.connectionGeneration,
    credentialId,
    dependencies
  });
  const stored = await storeIntegrationCredential(
    StoreCredentialCommandSchema.parse({
      contractVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAuthority,
      id: credentialId,
      oauthStateId: consumed.stateId,
      workspaceId: consumed.workspaceId,
      businessEntityId: consumed.businessEntityId,
      connectionId: consumed.connectionId,
      connectionGeneration: consumed.connectionGeneration,
      providerKey: consumed.providerKey,
      providerEnvironment: consumed.providerEnvironment,
      initiatedBy: consumed.initiatedBy,
      expectedConnectionRowVersion: consumed.expectedConnectionRowVersion,
      credentialVersion: 1,
      envelopeSchemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope,
      aadSchemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad,
      aadDigest: encrypted.aadDigest,
      kmsKeyResource: dependencies.kmsKeyResource,
      ciphertextBase64: encrypted.ciphertextBase64,
      accessExpiresAt: envelope.accessExpiresAt,
      refreshExpiresAt: envelope.refreshExpiresAt,
      grantedScopes: envelope.grantedScopes,
      externalEntityReferenceFingerprint: externalReferenceFingerprint(callback.realmId),
      authorizedAt: consumed.consumedAt
    }),
    `qbo_credential_store_${randomUUID()}`,
    db.role("integration_credential_broker_authority")
  );
  if (stored.connectionStatus !== "authorized_unmapped") {
    throw new Error("qbo_production_authorization_store_state_invalid");
  }
  const mappingId = randomUUID();
  const control = db.role("integration_control_plane_authority");
  const mapping = await createProviderEntityMapping(
    {
      contractVersion: "provider_entity_mapping_v1",
      id: mappingId,
      workspaceId: consumed.workspaceId,
      businessEntityId: consumed.businessEntityId,
      connectionId: consumed.connectionId,
      providerEntityType: "company",
      providerEntityReferenceFingerprint: externalReferenceFingerprint(callback.realmId),
      safeDisplayName: evidence.safeDisplayName,
      mappingRole: "primary",
      mappedAt: consumed.consumedAt,
      replacesMappingId: null
    },
    `qbo_mapping_create_${credentialId}`,
    "qbo_credential_broker",
    control
  );
  const activeMapping = await transitionProviderEntityMapping(
    {
      workspaceId: consumed.workspaceId,
      businessEntityId: consumed.businessEntityId,
      connectionId: consumed.connectionId,
      mappingId,
      expectedRowVersion: mapping.rowVersion,
      targetStatus: "active",
      verificationFingerprint: evidence.verificationFingerprint,
      transitionedAt: new Date().toISOString()
    },
    `qbo_mapping_verify_${credentialId}`,
    "qbo_credential_broker",
    control
  );
  const connection = await transitionIntegrationConnection(
    {
      workspaceId: consumed.workspaceId,
      businessEntityId: consumed.businessEntityId,
      connectionId: consumed.connectionId,
      expectedRowVersion: consumed.expectedConnectionRowVersion + 1,
      expectedGeneration: consumed.connectionGeneration,
      targetStatus: "initializing",
      stateReasonCode: "initial_sync_pending",
      providerTenantReferenceFingerprint: externalReferenceFingerprint(callback.realmId),
      grantedScopes: [QBO_ACCOUNTING_SCOPE],
      transitionedAt: new Date().toISOString()
    },
    `qbo_connection_initialize_${credentialId}`,
    "qbo_credential_broker",
    control
  );
  return {
    connectionStatus: connection.connection.status,
    mappingStatus: activeMapping.status,
    returnIntent: consumed.returnIntent
  } as const;
}

async function completeReauthorization(
  callback: z.infer<typeof CallbackSchema>,
  db: QboProductionDatabase,
  dependencies: ReturnType<typeof brokerDependencies>
) {
  const realmFingerprint = externalReferenceFingerprint(callback.realmId);
  if (!realmFingerprint) throw new Error("qbo_production_reauthorization_realm_invalid");
  const consumed = await consumeQboCustomerReauthorizationState(
    {
      contractVersion: "qbo_customer_reauthorization_state_consume_v2",
      stateHash: reauthorizationStateHash(callback.state),
      redirectUri: callbackUrl(),
      providerEntityReferenceFingerprint: realmFingerprint
    },
    `qbo_reauthorization_consume_${randomUUID()}`,
    db.role("integration_oauth_ingress_authority")
  );
  if (!consumed.accepted || consumed.providerEntityReferenceFingerprint !== realmFingerprint) {
    throw new Error("qbo_production_reauthorization_state_rejected");
  }
  const { envelope, evidence } = await exchangeAndVerify(callback, consumed, dependencies);
  const credentialId = randomUUID();
  const encrypted = await encryptedCredential({
    envelope,
    workspaceId: consumed.workspaceId,
    connectionId: consumed.connectionId,
    connectionGeneration: consumed.connectionGeneration,
    credentialId,
    dependencies
  });
  const result = await storeQboCustomerReauthorizedCredential(
    {
      contractVersion: "qbo_customer_credential_reauthorization_v2",
      id: credentialId,
      reauthorizationStateId: consumed.stateId,
      workspaceId: consumed.workspaceId,
      businessEntityId: consumed.businessEntityId,
      connectionId: consumed.connectionId,
      connectionGeneration: consumed.connectionGeneration,
      mappingId: consumed.mappingId,
      providerKey: consumed.providerKey,
      providerEnvironment: consumed.providerEnvironment,
      initiatedBy: consumed.initiatedBy,
      envelopeSchemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope,
      aadSchemaVersion: CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad,
      aadDigest: encrypted.aadDigest,
      kmsKeyResource: dependencies.kmsKeyResource,
      ciphertextBase64: encrypted.ciphertextBase64,
      accessExpiresAt: envelope.accessExpiresAt,
      refreshExpiresAt: envelope.refreshExpiresAt,
      grantedScopes: envelope.grantedScopes,
      externalEntityReferenceFingerprint: realmFingerprint,
      mappingRevalidationFingerprint: evidence.verificationFingerprint,
      reauthorizedAt: consumed.consumedAt
    },
    `qbo_reauthorization_store_${randomUUID()}`,
    db.role("integration_credential_broker_authority")
  );
  return { connectionStatus: result.connectionStatus, mappingStatus: result.mappingStatus, returnIntent: consumed.returnIntent } as const;
}

async function callBroker(path: string, body: unknown) {
  const broker = new URL(config.brokerUrl ?? "");
  if (broker.protocol !== "https:" || broker.pathname !== "/" || broker.search || broker.hash) {
    throw new Error("qbo_production_broker_url_invalid");
  }
  const url = new URL(path, broker);
  if (url.origin !== broker.origin) throw new Error("qbo_production_broker_url_invalid");
  const response = await fetch(url, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
    headers: {
      accept: "application/json",
      authorization: `Bearer ${await googleIdentityToken(broker.origin)}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const value = await response.json() as Record<string, unknown>;
  if (!response.ok && response.status !== 409) throw new Error("qbo_production_broker_request_failed");
  return value;
}

async function callBrokerWebhook(rawBody: Buffer, intuitSignature: string) {
  const broker = new URL(config.brokerUrl ?? "");
  if (broker.protocol !== "https:" || broker.pathname !== "/" || broker.search || broker.hash) {
    throw new Error("qbo_production_broker_url_invalid");
  }
  const url = new URL("/webhooks/verify", broker);
  const outbound = new Uint8Array(rawBody);
  try {
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${await googleIdentityToken(broker.origin)}`,
        "content-type": "application/octet-stream",
        [QBO_WEBHOOK_SIGNATURE_HEADER]: intuitSignature
      },
      body: outbound
    });
    if (!response.ok) throw new Error("qbo_production_webhook_verification_failed");
    return await response.json() as Record<string, unknown>;
  } finally {
    outbound.fill(0);
  }
}

async function accessWebhookVerifierSecret() {
  const resource = SecretManagerVersionResourceSchema.parse(
    env("QBO_WEBHOOK_SECRET_VERSION_RESOURCE")
  );
  const response = await googleSecretManagerTransport.accessSecretVersion({ name: resource });
  const encoded = response.payload?.data;
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("qbo_production_webhook_secret_unavailable");
  }
  const secret = Buffer.from(encoded, "base64");
  if (secret.byteLength < 16 || secret.byteLength > 8_192) {
    secret.fill(0);
    throw new Error("qbo_production_webhook_secret_invalid");
  }
  return secret;
}

async function handleBroker(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method !== "POST") return json(response, 405, { error: "method_not_allowed" });
  const db = database();
  try {
    if (url.pathname === "/webhooks/verify") {
      const intuitSignature = request.headers[QBO_WEBHOOK_SIGNATURE_HEADER];
      if (typeof intuitSignature !== "string") {
        throw new Error("qbo_production_webhook_signature_missing");
      }
      const rawBody = await readRawBody(request, QBO_WEBHOOK_MAX_RAW_BODY_BYTES);
      const secret = await accessWebhookVerifierSecret();
      try {
        const verified = verifyAndParseQboCloudEventsWebhook({
          rawBody,
          intuitSignature,
          verifierSecret: secret
        });
        safeEvent("webhook_verified", { eventCount: verified.events.length });
        return json(response, 200, verified);
      } finally {
        rawBody.fill(0);
        secret.fill(0);
      }
    }
    const dependencies = brokerDependencies(db);
    if (url.pathname === "/oauth/complete") {
      const callback = CallbackSchema.parse(await readBody(request));
      const isReauthorization = callback.state.startsWith("r1_");
      if (!isReauthorization && !callback.state.startsWith("i1_")) {
        throw new Error("qbo_production_oauth_state_namespace_invalid");
      }
      const result = isReauthorization
        ? await completeReauthorization(callback, db, dependencies)
        : await completeInitialAuthorization(callback, db, dependencies);
      safeEvent("oauth_completed", { reauthorization: isReauthorization });
      return json(response, 200, { ...result, promotionAuthorized: false, modelCallCount: 0 });
    }
    if (url.pathname === "/credentials/read") {
      const body = z.object({
        taskId: UuidSchema,
        leaseId: UuidSchema,
        leaseOwnerFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        expectedCredentialVersion: z.number().int().positive().safe()
      }).strict().parse(await readBody(request));
      const result = await dependencies.broker.readProviderAccessCredential({
        ...body,
        requiredScopes: [QBO_ACCOUNTING_SCOPE],
        minimumValiditySeconds: 300,
        requestId: `qbo_provider_read_${randomUUID()}`
      }).catch((error: unknown) => {
        if (error instanceof ProviderCredentialReadFailure) {
          safeEvent("credential_read_failed", { diagnosticClass: error.diagnosticClass });
        }
        throw error;
      });
      if (result.state !== "available") return json(response, 409, result);
      if (!result.externalAuthorizedEntityReference) {
        throw new Error("qbo_production_credential_realm_missing");
      }
      return result.credential.use(({ accessToken }) => json(response, 200, {
        state: "available",
        credentialId: result.credentialId,
        credentialVersion: result.credentialVersion,
        credentialReadEvidenceId: result.credentialReadEvidenceId,
        accessExpiresAt: result.credential.accessExpiresAt,
        externalAuthorizedEntityReference: result.externalAuthorizedEntityReference,
        accessToken
      }));
    }
    if (url.pathname === "/credentials/refresh") {
      const body = z.object({
        workspaceId: UuidSchema,
        businessEntityId: UuidSchema,
        connectionId: UuidSchema,
        connectionGeneration: z.number().int().positive().safe(),
        credentialId: UuidSchema,
        expectedCredentialVersion: z.number().int().positive().safe()
      }).strict().parse(await readBody(request));
      const result = await dependencies.broker.refreshCredential({
        ...body,
        requiredScopes: [QBO_ACCOUNTING_SCOPE],
        workerId: "qbo_production_refresh",
        acquireRequestId: `qbo_refresh_acquire_${randomUUID()}`,
        rotateRequestId: `qbo_refresh_rotate_${randomUUID()}`,
        failureRequestId: `qbo_refresh_failure_${randomUUID()}`
      });
      safeEvent("credential_refresh_completed", { refreshed: result.refreshed });
      return json(response, result.refreshed ? 200 : 409, result);
    }
    return json(response, 404, { error: "not_found" });
  } finally {
    await db.close();
  }
}

function canonicalTaskName(header: string | readonly string[] | undefined) {
  const { queueResource } = queueConfiguration();
  if (typeof header !== "string") throw new Error("qbo_production_cloud_task_delivery_invalid");
  const value = /^[a-f0-9]{64}$/.test(header) ? `${queueResource}/tasks/${header}` : header;
  if (!value.startsWith(`${queueResource}/tasks/`)) throw new Error("qbo_production_cloud_task_delivery_invalid");
  return value;
}

async function handleDispatcher(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method !== "POST" || url.pathname !== "/tasks/dispatch") {
    return json(response, 404, { error: "not_found" });
  }
  const body = z.object({
    maximumTasks: z.number().int().min(1).max(100),
    queueClass: z.enum(["provider_interactive", "provider_bulk"])
  }).strict().parse(await readBody(request));
  const { queueName, queueResource } = queueConfiguration();
  const runtime = new URL(config.runtimeUrl ?? "");
  if (runtime.protocol !== "https:" || runtime.pathname !== "/" || runtime.search || runtime.hash) {
    throw new Error("qbo_production_runtime_url_invalid");
  }
  const db = database();
  try {
    const client = db.role("integration_task_dispatch_authority");
    const registered = await readQboRuntimeConfiguration(client);
    if (registered.queueName !== queueName || registered.queueAudience !== runtime.origin) {
      throw new Error("qbo_production_runtime_configuration_mismatch");
    }
    const reservations = await discoverQboRuntimeDispatchReconciliation(
      body.queueClass,
      body.maximumTasks,
      client
    );
    let reconciledCreated = 0;
    let reconciledExisting = 0;
    let stagingConfirmed = 0;
    let stagingAlreadyConfirmed = 0;
    for (const reservation of reservations) {
      if (
        reservation.queueName !== queueName ||
        reservation.queueAudience !== runtime.origin ||
        canonicalTaskName(reservation.dispatcherTaskName) !==
          reservation.dispatcherTaskName
      ) {
        throw new Error("qbo_production_dispatch_reconciliation_mismatch");
      }
      const taskId = reservation.dispatcherTaskName.slice(
        reservation.dispatcherTaskName.lastIndexOf("/") + 1
      );
      const result = await googleCreateCloudTask({
        queueResource,
        taskId,
        targetUrl: new URL("/tasks/execute", runtime).toString(),
        oidcServiceAccountEmail: env("QBO_RUNTIME_INVOKER_SERVICE_ACCOUNT"),
        oidcAudience: runtime.origin,
        payload: {
          protocolVersion: RUNTIME_CONTRACT_VERSIONS.cloudTaskProtocol,
          taskId: reservation.taskId
        }
      });
      const confirmation = await confirmQboRuntimeCloudTaskStaged(
        {
          taskId: reservation.taskId,
          expectedRowVersion: reservation.rowVersion,
          dispatcherTaskName: reservation.dispatcherTaskName,
          dispatchGeneration: reservation.dispatchGeneration,
          stagingOutcome: result.created ? "created" : "already_existing"
        },
        `qbo_dispatch_confirm_${taskId}`,
        client
      );
      if (confirmation.idempotent) stagingAlreadyConfirmed += 1;
      else stagingConfirmed += 1;
      if (result.created) reconciledCreated += 1;
      else reconciledExisting += 1;
    }
    const remainingCapacity = body.maximumTasks - reservations.length;
    const candidates = remainingCapacity > 0
      ? await discoverQboRuntimeDispatch(body.queueClass, remainingCapacity, client)
      : [];
    let created = 0;
    let reused = 0;
    for (const candidate of candidates) {
      const taskHash = createHash("sha256").update(
        `qbo_production_cloud_task_v2:${candidate.taskId}:${candidate.rowVersion}:${candidate.dispatchGeneration + 1}`,
        "utf8"
      ).digest("hex");
      const taskName = `${queueResource}/tasks/${taskHash}`;
      await markRuntimeTaskDispatched(
        {
          workspaceId: candidate.workspaceId,
          businessEntityId: candidate.businessEntityId,
          connectionId: candidate.connectionId,
          connectionGeneration: candidate.connectionGeneration,
          taskId: candidate.taskId,
          expectedRowVersion: candidate.rowVersion,
          dispatcherTaskName: taskName
        },
        `qbo_dispatch_reserve_${taskHash}`,
        "qbo_task_dispatcher",
        client
      );
      const result = await googleCreateCloudTask({
        queueResource,
        taskId: taskHash,
        targetUrl: new URL("/tasks/execute", runtime).toString(),
        oidcServiceAccountEmail: env("QBO_RUNTIME_INVOKER_SERVICE_ACCOUNT"),
        oidcAudience: runtime.origin,
        payload: { protocolVersion: RUNTIME_CONTRACT_VERSIONS.cloudTaskProtocol, taskId: candidate.taskId }
      });
      const confirmation = await confirmQboRuntimeCloudTaskStaged(
        {
          taskId: candidate.taskId,
          expectedRowVersion: candidate.rowVersion + 1,
          dispatcherTaskName: taskName,
          dispatchGeneration: candidate.dispatchGeneration + 1,
          stagingOutcome: result.created ? "created" : "already_existing"
        },
        `qbo_dispatch_confirm_${taskHash}`,
        client
      );
      if (confirmation.idempotent) stagingAlreadyConfirmed += 1;
      else stagingConfirmed += 1;
      if (result.created) created += 1;
      else reused += 1;
    }
    safeEvent("tasks_dispatched", {
      reconciliationCount: reservations.length,
      reconciledCreated,
      reconciledExisting,
      stagingConfirmed,
      stagingAlreadyConfirmed,
      candidateCount: candidates.length,
      created,
      reused
    });
    return json(response, 200, {
      reconciliationCount: reservations.length,
      reconciledCreated,
      reconciledExisting,
      stagingConfirmed,
      stagingAlreadyConfirmed,
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

async function handleScheduler(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method !== "POST" || url.pathname !== "/tasks/schedule") {
    return json(response, 404, { error: "not_found" });
  }
  const body = z.object({
    maximumConnections: z.number().int().min(1).max(25)
  }).strict().parse(await readBody(request));
  const db = database();
  try {
    const client = db.role("integration_task_scheduler_authority");
    await readQboRuntimeConfiguration(client);
    const result = await scheduleQboProductionInitialization(
      body.maximumConnections,
      `qbo_initialization_schedule_${randomUUID()}`,
      client
    );
    safeEvent("initialization_runs_scheduled", {
      scheduledConnectionCount: result.scheduledConnectionCount,
      scheduledTaskCount: result.scheduledTaskCount
    });
    return json(response, 200, {
      scheduledConnectionCount: result.scheduledConnectionCount,
      scheduledTaskCount: result.scheduledTaskCount,
      promotionAuthorized: false,
      modelCallCount: 0
    });
  } finally {
    await db.close();
  }
}

const LeaseResultSchema = z.discriminatedUnion("acquired", [
  z.object({
    acquired: z.literal(false),
    terminalReplay: z.boolean(),
    state: z.string(),
    reasonCode: z.string().nullable().optional()
  }).passthrough(),
  z.object({
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
    controlMetadata: z.object({
      checkpointId: UuidSchema.nullable(),
      mappingId: UuidSchema.nullable(),
      pageOrdinal: z.number().int().nonnegative(),
      cursorVersion: z.number().int().nonnegative(),
      windowStartAt: z.string().datetime({ offset: true }).nullable(),
      windowEndAt: z.string().datetime({ offset: true }).nullable()
    }).passthrough(),
    rowVersion: z.number().int().positive().safe()
  }).passthrough()
]);

async function executeTask(request: IncomingMessage, response: ServerResponse) {
  const envelope = CloudTaskEnvelopeSchema.parse(await readBody(request));
  const { queueName, queueResource } = queueConfiguration();
  const taskName = canonicalTaskName(request.headers["x-cloudtasks-taskname"]);
  const db = database();
  const runtimeClient = db.role("integration_provider_runtime_authority");
  const sourceClient = db.role("integration_provider_source_authority");
  const leaseId = randomUUID();
  const owner = contractSha256({
    fingerprintPurpose: "qbo_production_runtime_owner",
    fingerprintVersion: "qbo_production_runtime_owner_v2",
    service: "provider_runtime"
  });
  let leased: QboProductionLeasedTask | null = null;
  try {
    const authority = await readQboRuntimeTaskDelivery(
      { taskId: envelope.taskId, taskName, queueName },
      runtimeClient
    );
    if (authority.queueAudience !== new URL(env("QBO_PROVIDER_RUNTIME_URL")).origin) {
      throw new Error("qbo_production_delivery_audience_mismatch");
    }
    const delivery = parseQboProductionCloudTaskDelivery({
      queueResource,
      expectedQueueName: queueName,
      taskHeader: request.headers["x-cloudtasks-taskname"],
      queueHeader: request.headers["x-cloudtasks-queuename"],
      retryHeader: request.headers["x-cloudtasks-taskretrycount"],
      executionHeader: request.headers["x-cloudtasks-taskexecutioncount"],
      taskId: envelope.taskId,
      workspaceId: authority.workspaceId,
      businessEntityId: authority.businessEntityId,
      connectionId: authority.connectionId,
      connectionGeneration: authority.connectionGeneration,
      dispatchGeneration: authority.dispatchGeneration
    });
    if (authority.state === "succeeded") {
      return json(response, 200, { state: "succeeded", idempotent: true, promotionAuthorized: false, modelCallCount: 0 });
    }
    if (!['dispatched', 'retry_wait'].includes(authority.state)) {
      throw new Error("qbo_production_delivery_state_denied");
    }
    const decision = LeaseResultSchema.parse(await leaseRuntimeTask(
      {
        workspaceId: authority.workspaceId,
        businessEntityId: authority.businessEntityId,
        connectionId: authority.connectionId,
        connectionGeneration: authority.connectionGeneration,
        taskId: authority.taskId,
        expectedRowVersion: authority.rowVersion,
        workerKind: "provider_runtime",
        leaseId,
        leaseOwnerFingerprint: owner,
        leaseSeconds: 300,
        dispatcherTaskName: taskName,
        deliveryDispatchGeneration: delivery.dispatchGeneration,
        deliveryRetryCount: delivery.retryCount,
        deliveryExecutionCount: delivery.executionCount,
        deliveryAttemptFingerprint: delivery.attemptFingerprint
      },
      `qbo_lease_${randomUUID()}`,
      "qbo_provider_runtime",
      runtimeClient
    ));
    if (!decision.acquired) {
      safeEvent("task_lease_not_acquired", { terminalReplay: decision.terminalReplay });
      return json(response, decision.terminalReplay ? 200 : 409, {
        state: decision.state,
        leaseAcquired: false,
        promotionAuthorized: false,
        modelCallCount: 0
      });
    }
    leased = decision as QboProductionLeasedTask;
    const credential = await resolveProviderAccessCredential({
      expectedCredentialVersion: authority.credentialVersion,
      readCredential: (version) => callBroker("/credentials/read", {
        taskId: authority.taskId,
        leaseId,
        leaseOwnerFingerprint: owner,
        expectedCredentialVersion: version
      }),
      refreshCredential: (credentialId, version) => callBroker("/credentials/refresh", {
        workspaceId: authority.workspaceId,
        businessEntityId: authority.businessEntityId,
        connectionId: authority.connectionId,
        connectionGeneration: authority.connectionGeneration,
        credentialId,
        expectedCredentialVersion: version
      })
    });
    if (credential.state !== "available") {
      throw new Error(`qbo_credential_${credential.failureCode}`);
    }
    const realmId = BoundedIdentifierSchema.parse(credential.externalAuthorizedEntityReference);
    if (externalReferenceFingerprint(realmId) !== authority.providerTenantReferenceFingerprint) {
      throw new Error("qbo_production_realm_binding_mismatch");
    }
    try {
      const result = await executeQboProductionRead({
        task: leased,
        leaseId,
        owner,
        accessToken: credential.accessToken,
        credentialReadEvidenceId: credential.credentialReadEvidenceId,
        realmId,
        providerTenantReferenceFingerprint: authority.providerTenantReferenceFingerprint,
        connectionConfigurationVersion: authority.connectionConfigurationVersion,
        mappingVersion: authority.mappingVersion,
        runtimeClient,
        sourceClient
      });
      safeEvent("task_completed", { observed: result.observed, committed: result.committed });
      return json(response, 200, {
        state: result.completed.state,
        observed: result.observed,
        committed: result.committed,
        continuationTaskId: result.completed.continuationTaskId,
        promotionAuthorized: false,
        modelCallCount: 0
      });
    } finally {
      credential.accessToken = "[consumed]";
    }
  } catch (error) {
    if (!leased) throw error;
    const classification = error instanceof QboRuntimeProviderError ? error.classification : null;
    const failed = await failRuntimeTask(
      {
        workspaceId: leased.workspaceId,
        businessEntityId: leased.businessEntityId,
        connectionId: leased.connectionId,
        connectionGeneration: leased.connectionGeneration,
        taskId: leased.taskId,
        expectedRowVersion: leased.rowVersion,
        leaseId,
        leaseOwnerFingerprint: owner,
        failureCategory: classification?.kind === "rate_limit" ? "rate_limit" : classification?.retryDisposition === "retry_with_backoff" ? "availability" : "contract",
        failureCode: classification?.safeCode ?? "qbo_provider_task_failed",
        retryable: classification?.retryDisposition === "retry_with_backoff",
        retryAfterSeconds: classification?.retryAfterMs ? Math.ceil(classification.retryAfterMs / 1_000) : null
      },
      `qbo_fail_${randomUUID()}`,
      "qbo_provider_runtime",
      runtimeClient
    );
    safeEvent("task_failure_recorded");
    return json(response, 200, { state: (failed as { state?: unknown }).state, durableFailureRecorded: true, promotionAuthorized: false, modelCallCount: 0 });
  } finally {
    await db.close();
  }
}

async function handleIngress(request: IncomingMessage, response: ServerResponse, url: URL) {
  if (request.method === "POST" && url.pathname === "/webhooks/qbo") {
    const intuitSignature = request.headers[QBO_WEBHOOK_SIGNATURE_HEADER];
    if (typeof intuitSignature !== "string") {
      throw new Error("qbo_production_webhook_signature_missing");
    }
    const rawBody = await readRawBody(request, QBO_WEBHOOK_MAX_RAW_BODY_BYTES);
    const db = database();
    try {
      const result = await callBrokerWebhook(rawBody, intuitSignature);
      const verified = z.object({
        deliveryHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        events: z.array(z.object({
          eventId: BoundedIdentifierSchema,
          eventType: BoundedIdentifierSchema,
          realmId: BoundedIdentifierSchema,
          recordType: BoundedIdentifierSchema,
          providerRecordId: BoundedIdentifierSchema,
          changeKind: BoundedIdentifierSchema,
          signatureVerification: z.literal("verified_hmac_sha256"),
          hintOnly: z.literal(true)
        }).passthrough()).max(1_000)
      }).strict().parse(result);
      const webhookClient = db.role("integration_webhook_ingress_authority");
      let replayed = 0;
      for (const event of verified.events) {
        const persisted = await recordVerifiedWebhookEvent(
          {
            id: randomUUID(),
            providerKey: "quickbooks_online",
            providerEnvironment: "production",
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
          `qbo_webhook_${randomUUID()}`,
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
  if (request.method !== "GET" || url.pathname !== "/oauth/callback") {
    return json(response, 404, { error: "not_found" });
  }
  const callback = CallbackSchema.parse(parseQboOAuthCallbackHandoff({
    method: request.method,
    requestUrl: request.url ?? "",
    headers: request.headers
  }));
  safeEvent("oauth_callback_handoff_accepted");
  const result = await callBroker("/oauth/complete", callback);
  const returnIntent = z.string().startsWith("/").max(512).parse(result.returnIntent);
  const appOrigin = new URL(env("QBO_APPLICATION_ORIGIN"));
  const target = new URL(returnIntent, appOrigin);
  if (target.origin !== appOrigin.origin) throw new Error("qbo_production_return_intent_invalid");
  safeEvent("oauth_callback_completion_accepted");
  return redirect(response, sanitizedQboOAuthConfirmationUrl(target.toString()));
}

async function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://qbo-production.invalid");
  if (url.pathname === "/health") {
    return json(response, 200, {
      ok: true,
      mode: config.mode,
      providerEnvironment: "production",
      sourceCommit: config.sourceCommit,
      promotionAuthorized: false,
      modelCallCount: 0
    });
  }
  if (config.mode === "oauth_ingress") return handleIngress(request, response, url);
  if (config.mode === "credential_broker") return handleBroker(request, response, url);
  if (config.mode === "task_scheduler") return handleScheduler(request, response, url);
  if (config.mode === "task_dispatcher") return handleDispatcher(request, response, url);
  if (request.method === "POST" && url.pathname === "/tasks/execute") {
    return executeTask(request, response);
  }
  return json(response, 404, { error: "not_found" });
}

const server = createServer((request, response) => {
  route(request, response).catch(() => {
    safeEvent("request_failed");
    if (!response.headersSent) json(response, 500, { error: "request_failed" });
    else response.end();
  });
});

server.listen(config.port, "0.0.0.0", () => safeEvent("service_started"));
