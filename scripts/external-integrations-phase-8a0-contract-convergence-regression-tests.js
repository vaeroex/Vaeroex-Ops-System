const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

require.extensions[".ts"] = function compileTypeScript(module, filename) {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      target: ts.ScriptTarget.ES2022
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (request === "server-only") {
    return path.join(root, "scripts/test-stubs/server-only.js");
  }
  if (request.startsWith("@/")) {
    return originalResolveFilename.call(
      this,
      path.join(root, request.slice(2)),
      parent,
      isMain,
      options
    );
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

const canonical = require("../lib/integrations/contracts/canonical.ts");
const primitives = require("../lib/integrations/contracts/primitives.ts");
const controlPlane = require("../lib/integrations/control-plane/provider-registry.ts");
const registered = require("../lib/integrations/control-plane/registered-provider-registry.ts");
const controlRepository = require("../lib/integrations/persistence/control-plane-repository.ts");
const sourceRepository = require("../lib/integrations/persistence/provider-source-repository.ts");
const credentials = require("../lib/integrations/credentials/contracts.ts");
const brokerModule = require("../lib/integrations/credentials/broker.ts");
const credentialKms = require("../lib/integrations/credentials/kms.ts");
const syntheticCredentials = require("../lib/integrations/credentials/synthetic-provider.ts");
const redaction = require("../lib/integrations/credentials/redaction.ts");
const qbo = require("../lib/integrations/providers/qbo/index.ts");

const migrationPath =
  "supabase/migrations/20260822035335_external_integrations_phase_8a0_provider_contract_convergence.sql";
const migration = read(migrationPath);
const phase5Contracts = read("lib/integrations/credentials/contracts.ts");
const phase5SecretManager = read("lib/integrations/credentials/secret-manager.ts");
const sourceRepositorySource = read(
  "lib/integrations/persistence/provider-source-repository.ts"
);
const providerReadRpc =
  migration.match(
    /create or replace function public\.read_integration_provider_credential_v1[\s\S]*?\$function\$;/
  )?.[0] || "";
const providerSourceCommitRpc =
  migration.match(
    /create or replace function public\.commit_provider_external_source_record_version_v1[\s\S]*?\$function\$;/
  )?.[0] || "";
const connectionTransitionRpc =
  migration.match(
    /create or replace function public\.transition_integration_connection_v1[\s\S]*?\$function\$;/
  )?.[0] || "";

let assertionCount = 0;
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepEqual(actual, expected, message);
}
function matches(value, pattern, message) {
  assertionCount += 1;
  assert.match(value, pattern, message);
}
function doesNotMatch(value, pattern, message) {
  assertionCount += 1;
  assert.doesNotMatch(value, pattern, message);
}
function throws(callback, matcher, message) {
  assertionCount += 1;
  assert.throws(callback, matcher, message);
}
async function rejects(callback, matcher, message) {
  assertionCount += 1;
  await assert.rejects(callback, matcher, message);
}

function id(seed) {
  const hex = seed.toString(16).padStart(32, "0").slice(-32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function sha(seed) {
  return canonical.contractSha256({ seed });
}

function rpcCapture() {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data: {
            connection: {
              contractVersion: "integration_connection_summary_v1",
              id: args.p_command.id,
              workspaceId: args.p_command.workspaceId,
              businessEntityId: args.p_command.businessEntityId,
              providerKey: args.p_command.providerKey,
              providerEnvironment: args.p_command.providerEnvironment,
              safeDisplayName: args.p_command.safeDisplayName,
              status: "pending_authorization",
              stateReasonCode: "authorization_pending",
              requestedScopes: args.p_command.requestedScopes,
              grantedScopes: [],
              capabilitySnapshot: args.p_command.capabilitySnapshot,
              adapterVersion: args.p_command.adapterVersion,
              configurationVersion: args.p_command.configurationVersion,
              connectionGeneration: 1,
              statusChangedAt: args.p_command.requestedAt,
              disconnectedAt: null,
              rowVersion: 1
            },
            idempotent: false
          },
          error: null
        };
      }
    }
  };
}

async function main() {
  equal(
    primitives.ProviderEnvironmentKeySchema.parse("sandbox"),
    "sandbox",
    "provider environment is a bounded provider-defined key"
  );
  equal(
    primitives.ProviderEnvironmentKeySchema.parse("test"),
    "test",
    "synthetic test remains a valid generic provider-environment key"
  );
  throws(
    () => primitives.ProviderEnvironmentKeySchema.parse("not a key"),
    Error,
    "malformed provider environments fail generic validation"
  );
  doesNotMatch(
    `${phase5Contracts}\n${phase5SecretManager}`,
    /z\.enum\(\[\s*["']development["'][\s\S]{0,120}["']preview["']/,
    "Phase 5 cannot reintroduce Vaeroex deployment environments as provider environments"
  );
  matches(
    phase5Contracts,
    /legacy field name means the provider descriptor environment key/,
    "credential envelope V1 documents provider-environment semantics"
  );
  matches(
    phase5Contracts,
    /V1 AAD bytes already bind the provider environment/,
    "AAD V1 documents its unchanged provider-environment semantics"
  );
  equal(
    credentials.CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope,
    "oauth_credential_envelope_v1",
    "credential envelope remains V1 because bytes and meaning are unchanged"
  );
  equal(
    credentials.CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad,
    "oauth_credential_aad_v1",
    "AAD remains V1 because canonical bytes are unchanged"
  );
  equal(
    credentials.CREDENTIAL_SECURITY_CONTRACT_VERSIONS.providerRead,
    "integration_provider_credential_read_v1",
    "normal provider read has a distinct versioned contract"
  );
  deepEqual(
    Object.keys(credentials.ReadProviderCredentialCommandSchema.shape).sort(),
    [
      "contractVersion",
      "expectedCredentialVersion",
      "leaseId",
      "leaseOwnerFingerprint",
      "minimumValiditySeconds",
      "requestedAt",
      "requiredScopes",
      "taskId"
    ],
    "provider-read callers cannot select tenant, connection, generation, provider, or environment"
  );
  deepEqual(
    Object.keys(sourceRepository.ProviderSourceCommitCommandSchema.shape).sort(),
    [
      "contractVersion",
      "leaseId",
      "leaseOwnerFingerprint",
      "mappingId",
      "sourceIdentityFingerprint",
      "taskId",
      "version"
    ],
    "provider-source command derives authority scope from the leased task"
  );

  const registry = registered.REGISTERED_PROVIDER_REGISTRY;
  equal(
    registry.registryFingerprint,
    "sha256:6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758",
    "new persistence uses the canonical QBO-inclusive registry fingerprint"
  );
  const qboEntry = controlPlane.providerDescriptor(
    "quickbooks_online",
    "sandbox",
    registry
  );
  equal(
    qboEntry.descriptorFingerprint,
    "sha256:e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac",
    "QBO persistence uses the reviewed descriptor fingerprint"
  );
  equal(
    qboEntry.descriptor.adapterVersion,
    "qbo_provider_adapter_v1",
    "QBO persistence uses the reviewed adapter version"
  );
  deepEqual(
    qboEntry.descriptor.minimumScopes,
    ["com.intuit.quickbooks.accounting"],
    "QBO has only the approved accounting scope"
  );
  deepEqual(qboEntry.descriptor.optionalScopes, [], "QBO has no implicit extra scopes");
  equal(
    controlPlane.providerDescriptor("quickbooks_online", "production", registry)
      .descriptor.providerKey,
    "quickbooks_online",
    "QBO production is registered"
  );
  for (const rejectedEnvironment of [
    "test",
    "development",
    "preview",
    "unknown"
  ]) {
    throws(
      () =>
        controlPlane.providerDescriptor(
          "quickbooks_online",
          rejectedEnvironment,
          registry
        ),
      /provider_environment_not_registered/,
      `QBO ${rejectedEnvironment} is not an authority environment`
    );
  }

  for (const providerEnvironment of ["sandbox", "production"]) {
    const capture = rpcCapture();
    await controlRepository.createIntegrationConnectionIntent(
      {
        id: id(providerEnvironment === "sandbox" ? 1 : 2),
        workspaceId: id(3),
        businessEntityId: id(4),
        providerKey: "quickbooks_online",
        providerEnvironment,
        safeDisplayName: `QBO ${providerEnvironment}`,
        requestedScopes: ["com.intuit.quickbooks.accounting"],
        requestedAt: "2026-08-22T00:00:00.000Z"
      },
      capture.client
    );
    const command = capture.calls[0].args.p_command;
    equal(command.providerEnvironment, providerEnvironment, `${providerEnvironment} is persisted exactly`);
    equal(command.providerDescriptorRegistryFingerprint, registry.registryFingerprint, "connection command binds registry fingerprint");
    equal(command.providerDescriptorFingerprint, qboEntry.descriptorFingerprint, "connection command binds descriptor fingerprint");
    equal(command.adapterVersion, qboEntry.descriptor.adapterVersion, "connection command binds adapter version");
    deepEqual(
      command.capabilitySnapshot,
      controlPlane.safeCapabilitySnapshot(qboEntry.descriptor),
      "connection command carries the exact safe QBO capability snapshot"
    );
  }
  const rejectedCapture = rpcCapture();
  await rejects(
    () =>
      controlRepository.createIntegrationConnectionIntent(
        {
          id: id(5),
          workspaceId: id(3),
          businessEntityId: id(4),
          providerKey: "quickbooks_online",
          providerEnvironment: "sandbox",
          safeDisplayName: "QBO excess scope",
          requestedScopes: [
            "com.intuit.quickbooks.accounting",
            "openid"
          ],
          requestedAt: "2026-08-22T00:00:00.000Z"
        },
        rejectedCapture.client
      ),
    /integration_connection_scope_set_invalid/,
    "QBO excess scope fails before persistence"
  );
  equal(rejectedCapture.calls.length, 0, "invalid scopes never reach the checked RPC");

  matches(migration, /create role integration_provider_source_authority nologin noinherit/, "provider source authority is NOLOGIN/NOINHERIT");
  matches(migration, /p_provider_key = 'synthetic' and p_provider_environment = 'test'/, "synthetic/test remains accepted");
  matches(migration, /p_provider_key = 'quickbooks_online'[\s\S]{0,100}p_provider_environment in \('sandbox', 'production'\)/, "QBO authority environments are exact");
  doesNotMatch(migration, /quickbooks_online'[\s\S]{0,120}provider_environment in \([^)]*(?:development|preview|unknown)/, "QBO environment authority excludes deployment and parsing-only values");
  matches(migration, /com\.intuit\.quickbooks\.accounting/, "database QBO scope allowlist is exact");
  doesNotMatch(migration, /\b(?:openid|profile|email|phone|address|payroll|payments)\b/i, "database allowlist does not broaden QBO scopes");
  matches(migration, /6981f2593ee13a1476be9940d752bbccffaa07f6ff45d153e8cacbd5837ce758/, "database validates the QBO-inclusive registry fingerprint");
  matches(migration, /e4c07ee40eacda38342037219c473159aab5109c3d94c5e22d306364523d74ac/, "database validates the exact QBO descriptor fingerprint");
  matches(migration, /and p_adapter_version = 'qbo_provider_adapter_v1'/, "database validates the exact QBO adapter version");
  matches(migration, /p_value = pg_catalog\.jsonb_build_object\([\s\S]+qbo_trialbalance[\s\S]+webhookMode', 'change_hints'/, "QBO safe capability snapshot is exact rather than arbitrary JSON");
  matches(migration, /qbo_control_plane_freshness_policy_v1/, "QBO freshness architecture is persistence-ready and versioned");
  matches(migration, /p_current_max_age_seconds between 60 and 86400/, "QBO launch freshness remains tunable within reviewed bounds");
  doesNotMatch(migration, /real.?time/i, "freshness persistence makes no literal real-time claim");
  doesNotMatch(migration, /policy\.enabled\b/, "freshness authority uses the canonical policy state and sync-enabled columns");
  matches(migration, /p_provider_key = 'synthetic' and p_trigger_kind = 'synthetic_verification'[\s\S]+p_provider_key = 'quickbooks_online'[\s\S]+p_trigger_kind = 'provider_initialization'/, "activation evidence is provider-specific and allowlisted");
  matches(connectionTransitionRpc, /private\.is_phase_8a0_activation_trigger_v1\([\s\S]+v_connection\.provider_key,[\s\S]+run\.trigger_kind/, "QBO activation consumes provider-initialization evidence without weakening lifecycle gates");
  doesNotMatch(connectionTransitionRpc, /run\.trigger_kind = 'synthetic_verification'/, "connection activation no longer hard-codes synthetic-only evidence");
  matches(migration, /create or replace function public\.read_integration_provider_credential_v1/, "provider reads use a distinct checked RPC");
  matches(migration, /for share;[\s\S]+v_state := case[\s\S]+else 'available'/, "routine credential reads use shared locking and permit concurrency");
  doesNotMatch(providerReadRpc, /update private\.integration_credentials|refresh_lease_id\s*=/i, "provider reads cannot mutate or reuse refresh leases");
  matches(providerReadRpc, /connection\.workspace_id = v_task\.workspace_id[\s\S]+connection\.business_entity_id = v_task\.business_entity_id[\s\S]+connection\.connection_generation = v_task\.connection_generation[\s\S]+connection\.provider_key = v_task\.provider_key[\s\S]+connection\.provider_environment = v_task\.provider_environment/, "provider reads derive exact tenant, generation, provider, and environment from the task");
  matches(providerReadRpc, /credential\.workspace_id = v_task\.workspace_id[\s\S]+credential\.business_entity_id = v_task\.business_entity_id[\s\S]+credential\.connection_id = v_task\.connection_id[\s\S]+credential\.connection_generation = v_task\.connection_generation[\s\S]+credential\.provider_key = v_task\.provider_key[\s\S]+credential\.provider_environment = v_task\.provider_environment/, "provider reads select only the exact task-bound credential generation");
  matches(migration, /then 'refresh_required'/, "near-expiry reads return typed refresh-required state");
  matches(migration, /then 'credential_version_stale'/, "stale reads return a typed stale-version state");
  matches(migration, /grant execute on function public\.read_integration_provider_credential_v1\(jsonb, text\)[\s\S]{0,100}integration_credential_broker_authority/, "only the credential broker receives provider-read execution");
  matches(migration, /grant execute on function public\.commit_provider_external_source_record_version_v1\([\s\S]{0,100}integration_provider_source_authority/, "only provider-source authority receives source commit execution");
  matches(migration, /v_task\.state <> 'leased'/, "source commit requires a leased runtime task");
  matches(migration, /v_task\.connection_generation = connection\.connection_generation|connection\.connection_generation = v_task\.connection_generation/, "source commit binds the current connection generation");
  matches(migration, /mapping\.status = 'active'/, "source commit requires an active mapping");
  matches(migration, /v_version ->> 'trust' <> 'untrusted_external_input'/, "source commit preserves untrusted provider input");
  matches(migration, /v_version #>> '\{validation,state\}' <> 'pending'/, "source commit preserves pending validation");
  doesNotMatch(sourceRepositorySource, /canonical_business_fact|contribution|aggregate|kpi|model/i, "provider source repository has no direct truth, contribution, KPI, or model path");
  matches(providerSourceCommitRpc, /connection\.workspace_id = v_task\.workspace_id[\s\S]+connection\.business_entity_id = v_task\.business_entity_id[\s\S]+connection\.connection_generation = v_task\.connection_generation[\s\S]+connection\.provider_key = v_task\.provider_key[\s\S]+connection\.provider_environment = v_task\.provider_environment/, "provider-source commits derive exact current connection generation and provider environment");
  doesNotMatch(providerSourceCommitRpc, /insert into private\.(?:canonical_business_fact|fact_contribution|deterministic_aggregate)/i, "provider source RPC cannot fast-path canonical truth or KPI state");
  matches(migration, /revoke all on table private\.external_source_records,[\s\S]+from integration_provider_source_authority/, "provider source role has no direct private-table DML");
  doesNotMatch(migration, /grant integration_provider_source_authority\s+to service_role|grant (?:select|insert|update|delete|all)[\s\S]{0,100}integration_provider_source_authority/i, "service_role and direct table grants cannot acquire provider source authority");

  const keyResource =
    "projects/vaeroex-test/locations/us-central1/keyRings/integrations/cryptoKeys/credentials";
  const kms = new syntheticCredentials.SyntheticCredentialKms({ keyResource });
  const now = new Date("2026-08-22T00:00:00.000Z");
  const aadContext = credentials.CredentialAadContextSchema.parse({
    schemaVersion: credentials.CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialAad,
    purpose: "provider_oauth_credential",
    environment: "sandbox",
    workspaceId: id(10),
    connectionId: id(11),
    connectionGeneration: 1,
    providerKey: "quickbooks_online",
    credentialId: id(12)
  });
  const envelope = credentials.CredentialEnvelopeSchema.parse({
    schemaVersion: credentials.CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialEnvelope,
    providerKey: "quickbooks_online",
    environment: "sandbox",
    externalAuthorizedEntityReference: "synthetic-realm",
    accessToken: redaction.PHASE_5_LEAKAGE_CANARIES.accessToken,
    accessExpiresAt: "2026-08-22T01:00:00.000Z",
    refreshToken: redaction.PHASE_5_LEAKAGE_CANARIES.refreshToken,
    refreshExpiresAt: "2026-09-22T00:00:00.000Z",
    grantedScopes: ["com.intuit.quickbooks.accounting"],
    issuedAt: "2026-08-21T23:00:00.000Z",
    updatedAt: "2026-08-21T23:00:00.000Z"
  });
  const ciphertext = await kms.encrypt({
    keyResource,
    plaintext: Buffer.from(canonical.canonicalContractJson(envelope), "utf8"),
    additionalAuthenticatedData: credentialKms.credentialAad(aadContext)
  });
  let readCount = 0;
  const readFailures = [];
  const readResult = {
    state: "available",
    credentialId: id(12),
    credentialVersion: 1,
    credentialReadEvidenceId: id(15),
    providerKey: "quickbooks_online",
    providerEnvironment: "sandbox",
    accessExpiresAt: "2026-08-22T02:00:00.000Z",
    ciphertextPersistedAt: "2026-08-22T00:00:00.000Z",
    refreshExpiresAt: "2026-09-22T01:00:00.000Z",
    externalEntityReferenceFingerprint: canonical.contractSha256({
      fingerprintPurpose: "provider_authorized_entity_reference",
      fingerprintVersion: "provider_authorized_entity_reference_fingerprint_v1",
      value: envelope.externalAuthorizedEntityReference
    }),
    ciphertextBase64: Buffer.from(ciphertext).toString("base64"),
    aadDigest: credentialKms.credentialAadDigest(aadContext),
    kmsKeyResource: keyResource,
    aadContext,
    grantedScopes: ["com.intuit.quickbooks.accounting"]
  };
  const unavailable = async () => {
    throw new Error("unexpected credential mutation");
  };
  const store = {
    createOAuthState: unavailable,
    consumeOAuthState: unavailable,
    storeCredential: unavailable,
    async readProviderCredential() {
      readCount += 1;
      return readResult;
    },
    async recordProviderCredentialReadFailure(command) {
      readFailures.push(command);
      return {
        credentialReadFailureEvidenceId: id(16 + readFailures.length),
        credentialReadEvidenceId: command.credentialReadEvidenceId,
        diagnosticClass: command.diagnosticClass,
        failedAt: now.toISOString(),
        idempotent: false
      };
    },
    acquireRefreshLease: unavailable,
    rotateCredential: unavailable,
    completeRefreshFailure: unavailable,
    revokeCredential: unavailable,
    completeCredentialRevocation: unavailable,
    destroyCredential: unavailable,
    recordAuthorizationEvent: unavailable
  };
  const broker = new brokerModule.IntegrationCredentialBroker({
    store,
    kms,
    kmsKeyResource: keyResource,
    secrets: { access: unavailable },
    provider: {
      providerKey: "quickbooks_online",
      environment: "sandbox",
      exchangeAuthorizationCode: unavailable,
      refreshCredential: unavailable,
      revokeCredential: unavailable
    },
    clock: () => now
  });
  const readInput = {
    taskId: id(13),
    leaseId: id(14),
    leaseOwnerFingerprint: sha("owner"),
    expectedCredentialVersion: 1,
    requiredScopes: ["com.intuit.quickbooks.accounting"],
    minimumValiditySeconds: 300,
    requestId: "provider_read_1"
  };
  const [readA, readB] = await Promise.all([
    broker.readProviderAccessCredential(readInput),
    broker.readProviderAccessCredential({ ...readInput, requestId: "provider_read_2" })
  ]);
  equal(readCount, 2, "ordinary provider reads are concurrent and independently checked");
  equal(readA.state, "available", "valid credential read is available");
  equal(readB.state, "available", "second concurrent credential read is available");
  equal(
    readA.credential.accessExpiresAt,
    envelope.accessExpiresAt,
    "provider reads accept exact lifetime-preserving database clock rebasing"
  );
  const mismatchedAadContext = {
    ...aadContext,
    environment: "production"
  };
  const mismatchedBroker = new brokerModule.IntegrationCredentialBroker({
    store: {
      ...store,
      async readProviderCredential() {
        return {
          ...readResult,
          providerEnvironment: "production",
          aadContext: mismatchedAadContext,
          aadDigest: credentialKms.credentialAadDigest(mismatchedAadContext)
        };
      }
    },
    kms,
    kmsKeyResource: keyResource,
    secrets: { access: unavailable },
    provider: {
      providerKey: "quickbooks_online",
      environment: "sandbox",
      exchangeAuthorizationCode: unavailable,
      refreshCredential: unavailable,
      revokeCredential: unavailable
    },
    clock: () => now
  });
  await rejects(
    () => mismatchedBroker.readProviderAccessCredential(readInput),
    /credential_read_failed/,
    "broker rejects a cross-environment credential result before decryption"
  );
  const expiryBindingBroker = new brokerModule.IntegrationCredentialBroker({
    store: {
      ...store,
      async readProviderCredential() {
        return {
          ...readResult,
          accessExpiresAt: "2026-08-22T02:00:01.000Z"
        };
      }
    },
    kms,
    kmsKeyResource: keyResource,
    secrets: { access: unavailable },
    provider: {
      providerKey: "quickbooks_online",
      environment: "sandbox",
      exchangeAuthorizationCode: unavailable,
      refreshCredential: unavailable,
      revokeCredential: unavailable
    },
    clock: () => now
  });
  const expiryBindingFailure = await expiryBindingBroker
    .readProviderAccessCredential(readInput)
    .catch((error) => error);
  equal(
    expiryBindingFailure.diagnosticClass,
    "expires_at_binding",
    "credential reads diagnose lifetime-binding mismatch without secret material"
  );
  deepEqual(
    readFailures.map((failure) => failure.diagnosticClass),
    ["aad_binding", "expires_at_binding"],
    "post-decrypt failures append only bounded evidence classifications"
  );
  doesNotMatch(
    JSON.stringify(expiryBindingFailure),
    new RegExp(
      Object.values(redaction.PHASE_5_LEAKAGE_CANARIES).join("|")
    ),
    "credential-read diagnostics contain no access, refresh, code, or client-secret canary"
  );
  const exposedKeys = [];
  const token = await readA.credential.use((value) => {
    exposedKeys.push(...Object.keys(value));
    return value.accessToken;
  });
  deepEqual(exposedKeys, ["accessToken"], "provider request boundary receives only the access token");
  equal(token, redaction.PHASE_5_LEAKAGE_CANARIES.accessToken, "access token is transiently usable");
  await rejects(
    () => readA.credential.use(() => undefined),
    /already_consumed/,
    "access-token capability is one-use and zeroed"
  );
  doesNotMatch(
    JSON.stringify(readA.credential),
    new RegExp(redaction.PHASE_5_LEAKAGE_CANARIES.accessToken),
    "serialized provider credential does not expose the access token"
  );
  doesNotMatch(
    JSON.stringify([readA, readB]),
    new RegExp(redaction.PHASE_5_LEAKAGE_CANARIES.refreshToken),
    "provider request results never expose refresh tokens"
  );

  const passthroughStore = {
    ...store,
    async readProviderCredential() {
      return {
        state: "refresh_required",
        credentialId: id(12),
        credentialVersion: 1,
        providerKey: "quickbooks_online",
        providerEnvironment: "sandbox",
        accessExpiresAt: "2026-08-22T00:04:00.000Z"
      };
    }
  };
  const refreshBroker = new brokerModule.IntegrationCredentialBroker({
    store: passthroughStore,
    kms,
    kmsKeyResource: keyResource,
    secrets: { access: unavailable },
    provider: {
      providerKey: "quickbooks_online",
      environment: "sandbox",
      exchangeAuthorizationCode: unavailable,
      refreshCredential: unavailable,
      revokeCredential: unavailable
    },
    clock: () => now
  });
  equal(
    (await refreshBroker.readProviderAccessCredential(readInput)).state,
    "refresh_required",
    "near-expiry state does not decrypt or misuse the refresh lease"
  );

  const qboFixture = qbo.minimizeQboSourceRecord({
    recordType: "Invoice",
    raw: require("../lib/integrations/providers/qbo/fixtures/v1.ts")
      .QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice,
    provider: require("../lib/integrations/providers/qbo/fixtures/v1.ts")
      .QBO_SYNTHETIC_PROVIDER
  });
  const context = {
    workspaceId: id(20),
    businessEntityId: id(21),
    connectionId: id(22),
    providerKey: "quickbooks_online",
    providerEnvironment: "sandbox",
    requestedAt: "2026-08-22T00:00:00.000Z"
  };
  throws(
    () =>
      qbo.qboMinimizedRecordToExternalSourceVersion({
        context,
        record: {
          ...qboFixture,
          provider: { ...qboFixture.provider, sourceEnvironment: "unknown" }
        },
        id: id(23),
        immutableVersion: 1,
        priorVersionId: null,
        previousRecord: null,
        observedAt: "2026-08-22T00:00:00.000Z",
        synchronizedAt: "2026-08-22T00:00:00.000Z",
        ingestedAt: "2026-08-22T00:00:00.000Z",
        receivedAt: "2026-08-22T00:00:00.000Z"
      }),
    /qbo_source_environment_mismatch/,
    "QBO parsing-only unknown cannot cross the source-authority mapper"
  );
  throws(
    () =>
      qbo.qboMinimizedRecordToExternalSourceVersion({
        context,
        record: {
          ...qboFixture,
          provider: { ...qboFixture.provider, sourceEnvironment: "production" }
        },
        id: id(24),
        immutableVersion: 1,
        priorVersionId: null,
        previousRecord: null,
        observedAt: "2026-08-22T00:00:00.000Z",
        synchronizedAt: "2026-08-22T00:00:00.000Z",
        ingestedAt: "2026-08-22T00:00:00.000Z",
        receivedAt: "2026-08-22T00:00:00.000Z"
      }),
    /qbo_source_environment_mismatch/,
    "source environment must equal trusted task context"
  );

  equal(credentials.PHASE_5_MODEL_CALL_COUNT, 0, "Phase 8A.0 adds zero credential model calls");
  equal(credentials.PHASE_5_PROMOTION_AUTHORIZED, false, "promotionAuthorized remains false");
  equal(qbo.QBO_MODEL_CALL_COUNT, 0, "QBO model-call count remains zero");
  ok(redaction.assertNoCredentialLeakage([readA, readB]), "provider-read public surfaces pass leakage canaries");
  equal(sourceRepository.PROVIDER_SOURCE_AUTHORITY_CONTRACT_VERSION, "integration_provider_source_commit_v1", "provider source commit contract is explicitly versioned");

  console.log(
    `External integration Phase 8A.0 contract-convergence regressions: ${assertionCount} assertions passed; model calls 0; promotionAuthorized false.`
  );
}

main().catch((error) => {
  process.stderr.write(
    `${redaction.redactCredentialMaterial(error instanceof Error ? error.stack : error)}\n`
  );
  process.exit(1);
});
