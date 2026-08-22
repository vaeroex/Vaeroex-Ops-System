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

const credentials = require("../lib/integrations/credentials/index.ts");
const { contractSha256 } = require("../lib/integrations/contracts/canonical.ts");

let assertionCount = 0;
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function ok(value, message) {
  assertionCount += 1;
  assert.ok(value, message);
}
function throws(callback, matcher, message) {
  assertionCount += 1;
  assert.throws(callback, matcher, message);
}
async function rejects(callback, matcher, message) {
  assertionCount += 1;
  await assert.rejects(callback, matcher, message);
}
function doesNotMatch(value, matcher, message) {
  assertionCount += 1;
  assert.doesNotMatch(value, matcher, message);
}

function id(value) {
  const hex = value.toString(16).padStart(32, "0").slice(-32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

const kmsKeyResource =
  "projects/vaeroex-phase5-test/locations/us-central1/keyRings/phase5-test/cryptoKeys/oauth-credentials";
const secretVersionResource =
  "projects/vaeroex-phase5-test/secrets/synthetic-oauth-client/versions/1";
const scope = "read_synthetic_business_data";

class InMemoryCredentialStore {
  constructor() {
    this.states = new Map();
    this.credentials = new Map();
    this.auditEvents = [];
    this.clientOutputs = [];
    this.connectionStatus = "pending_authorization";
  }

  async createOAuthState(command) {
    this.states.set(command.stateHash, { ...command, status: "pending" });
    const result = { stateId: command.id, idempotent: false };
    this.clientOutputs.push(result);
    return result;
  }

  async consumeOAuthState(command) {
    const state = this.states.get(command.stateHash);
    if (!state) return { accepted: false, reasonCode: "state_missing" };
    if (state.status === "consumed") {
      return { accepted: false, reasonCode: "state_replayed" };
    }
    if (state.status === "expired" || Date.parse(command.consumedAt) >= Date.parse(state.expiresAt)) {
      state.status = "expired";
      return { accepted: false, reasonCode: "state_expired" };
    }
    const keys = [
      "workspaceId",
      "businessEntityId",
      "connectionId",
      "connectionGeneration",
      "providerKey",
      "providerEnvironment",
      "initiatedBy",
      "returnIntent"
    ];
    const mismatch =
      keys.some((key) => state[key] !== command[key]) ||
      JSON.stringify(state.requestedScopes) !== JSON.stringify(command.requestedScopes) ||
      this.connectionStatus !== "pending_authorization";
    if (mismatch) return { accepted: false, reasonCode: "state_invalid" };
    state.status = "consumed";
    const result = {
      accepted: true,
      stateId: state.id,
      workspaceId: state.workspaceId,
      businessEntityId: state.businessEntityId,
      connectionId: state.connectionId,
      connectionGeneration: state.connectionGeneration,
      providerKey: state.providerKey,
      providerEnvironment: state.providerEnvironment,
      requestedScopes: state.requestedScopes,
      returnIntent: state.returnIntent
    };
    this.clientOutputs.push(result);
    return result;
  }

  async storeCredential(command) {
    const state = [...this.states.values()].find((candidate) => candidate.id === command.oauthStateId);
    if (!state || state.status !== "consumed") throw new Error("state_not_consumed");
    this.connectionStatus = "authorized_unmapped";
    const value = {
      ...command,
      status: "active",
      version: 1,
      lease: null,
      providerRevocationStatus: null,
      ciphertextBase64: command.ciphertextBase64
    };
    this.credentials.set(command.id, value);
    return this.mutation(value, false);
  }

  async acquireRefreshLease(command) {
    const value = this.credentials.get(command.credentialId);
    if (!value || !this.bound(value, command)) {
      return { acquired: false, reasonCode: "credential_missing" };
    }
    if (value.status !== "active") {
      return { acquired: false, reasonCode: "credential_inactive" };
    }
    if (value.version !== command.expectedCredentialVersion) {
      return { acquired: false, reasonCode: "credential_version_stale" };
    }
    if (value.refreshExpiresAt && Date.parse(value.refreshExpiresAt) <= Date.parse(command.acquiredAt)) {
      value.status = "reauthorization_required";
      this.connectionStatus = "reauthorization_required";
      return { acquired: false, reasonCode: "credential_inactive" };
    }
    if (value.lease && Date.parse(value.lease.expiresAt) > Date.parse(command.acquiredAt)) {
      return { acquired: false, reasonCode: "refresh_lease_held" };
    }
    value.lease = {
      id: command.leaseId,
      owner: command.leaseOwnerFingerprint,
      expiresAt: command.leaseExpiresAt
    };
    const result = {
      acquired: true,
      credentialId: value.id,
      credentialVersion: value.version,
      ciphertextBase64: value.ciphertextBase64,
      aadDigest: value.aadDigest,
      kmsKeyResource: value.kmsKeyResource,
      aadContext: {
        schemaVersion: "oauth_credential_aad_v1",
        purpose: "provider_oauth_credential",
        environment: value.providerEnvironment,
        workspaceId: value.workspaceId,
        connectionId: value.connectionId,
        connectionGeneration: value.connectionGeneration,
        providerKey: value.providerKey,
        credentialId: value.id
      },
      providerEnvironment: value.providerEnvironment,
      grantedScopes: value.grantedScopes,
      leaseId: value.lease.id,
      leaseOwnerFingerprint: value.lease.owner,
      leaseExpiresAt: value.lease.expiresAt
    };
    return result;
  }

  async rotateCredential(command) {
    const value = this.credentials.get(command.credentialId);
    if (
      !value ||
      value.status !== "active" ||
      value.version !== command.expectedCredentialVersion ||
      !value.lease ||
      value.lease.id !== command.leaseId ||
      value.lease.owner !== command.leaseOwnerFingerprint ||
      Date.parse(value.lease.expiresAt) < Date.parse(command.rotatedAt)
    ) {
      throw new Error("credential_rotation_stale");
    }
    value.version += 1;
    value.ciphertextBase64 = command.ciphertextBase64;
    value.accessExpiresAt = command.accessExpiresAt;
    value.refreshExpiresAt = command.refreshExpiresAt;
    value.grantedScopes = command.grantedScopes;
    value.externalEntityReferenceFingerprint = command.externalEntityReferenceFingerprint;
    value.lease = null;
    return this.mutation(value, false);
  }

  async completeRefreshFailure(command) {
    const value = this.credentials.get(command.credentialId);
    if (
      !value ||
      value.status !== "active" ||
      value.version !== command.expectedCredentialVersion ||
      !value.lease ||
      value.lease.id !== command.leaseId ||
      value.lease.owner !== command.leaseOwnerFingerprint
    ) {
      throw new Error("credential_refresh_failure_stale");
    }
    value.lease = null;
    if (command.reasonCode !== "provider_transient") {
      value.status = "reauthorization_required";
      this.connectionStatus = "reauthorization_required";
    }
    return this.mutation(value, false);
  }

  async revokeCredential(command) {
    const value = this.credentials.get(command.credentialId);
    if (!value || !this.bound(value, command) || value.version !== command.expectedCredentialVersion) {
      throw new Error("credential_revocation_stale");
    }
    if (command.reasonCode === "customer_disconnect" && this.connectionStatus !== "disconnecting") {
      throw new Error("connection_not_disconnecting");
    }
    value.status = "revoked";
    value.lease = null;
    value.providerRevocationStatus = "pending";
    return this.mutation(value, false);
  }

  async completeCredentialRevocation(command) {
    const value = this.credentials.get(command.credentialId);
    if (!value || value.status !== "revoked" || value.version !== command.expectedCredentialVersion) {
      throw new Error("credential_revocation_result_stale");
    }
    value.providerRevocationStatus = command.outcome;
    return this.mutation(value, false);
  }

  async destroyCredential(command) {
    const value = this.credentials.get(command.credentialId);
    if (!value || value.status !== "revoked" || value.version !== command.expectedCredentialVersion) {
      throw new Error("credential_destruction_stale");
    }
    value.status = "destroyed";
    value.ciphertextBase64 = null;
    if (this.connectionStatus === "disconnecting") this.connectionStatus = "disconnected";
    return this.mutation(value, false);
  }

  async recordAuthorizationEvent(event) {
    this.auditEvents.push(JSON.parse(JSON.stringify(event)));
    return { eventId: id(9000 + this.auditEvents.length) };
  }

  bound(value, command) {
    return ["workspaceId", "businessEntityId", "connectionId", "connectionGeneration"]
      .every((key) => value[key] === command[key]);
  }

  mutation(value, idempotent) {
    const result = {
      credentialId: value.id,
      credentialVersion: value.version,
      credentialStatus: value.status,
      connectionStatus: this.connectionStatus,
      idempotent
    };
    this.clientOutputs.push(result);
    return result;
  }

  currentCredential() {
    return [...this.credentials.values()][0];
  }
}

function createSecretStore() {
  return new credentials.GoogleSecretManagerProviderSecrets({
    resources: { "synthetic:test": secretVersionResource },
    transport: {
      async accessSecretVersion() {
        return {
          payload: {
            data: Buffer.from(JSON.stringify({
              schemaVersion: "provider_application_secret_v1",
              providerKey: "synthetic",
              environment: "test",
              clientId: "synthetic-phase5-client",
              clientSecret: credentials.PHASE_5_LEAKAGE_CANARIES.clientSecret
            })).toString("base64")
          }
        };
      }
    }
  });
}

async function bootstrap(seed) {
  const ids = {
    workspaceId: id(seed * 100 + 1),
    businessEntityId: id(seed * 100 + 2),
    connectionId: id(seed * 100 + 3),
    initiatedBy: id(seed * 100 + 4)
  };
  let now = new Date("2026-08-21T22:30:00.000Z");
  const clock = () => new Date(now);
  const advance = (milliseconds) => {
    now = new Date(now.getTime() + milliseconds);
  };
  const store = new InMemoryCredentialStore();
  const kms = new credentials.SyntheticCredentialKms({ keyResource: kmsKeyResource });
  const provider = new credentials.SyntheticOAuthProvider();
  const broker = new credentials.IntegrationCredentialBroker({
    store,
    kms,
    kmsKeyResource,
    secrets: createSecretStore(),
    provider,
    clock
  });
  const authorization = await broker.beginAuthorization({
    ...ids,
    connectionGeneration: 1,
    providerKey: "synthetic",
    providerEnvironment: "test",
    requestedScopes: [scope],
    returnIntent: "/app/integrations",
    requestId: `state_${seed}`
  });
  const completed = await broker.completeAuthorization({
    state: authorization.state,
    authorizationCode: credentials.PHASE_5_LEAKAGE_CANARIES.authorizationCode,
    ...ids,
    connectionGeneration: 1,
    expectedConnectionRowVersion: 1,
    providerKey: "synthetic",
    providerEnvironment: "test",
    requestedScopes: [scope],
    returnIntent: "/app/integrations",
    consumeRequestId: `consume_${seed}`,
    storeRequestId: `store_${seed}`
  });
  return { ids, clock, advance, store, kms, provider, broker, authorization, completed };
}

async function main() {
  equal(credentials.PHASE_5_MODEL_CALL_COUNT, 0, "Phase 5 makes zero model calls");
  equal(credentials.PHASE_5_PROMOTION_AUTHORIZED, false, "KPI promotion remains disabled");
  equal(credentials.PHASE_5_OAUTH_STATE_BYTES, 32, "OAuth state uses 256 bits of entropy");
  throws(
    () => credentials.normalizeOAuthReturnIntent("https://attacker.example/callback"),
    /Invalid/,
    "external return intents fail closed"
  );
  throws(
    () => credentials.normalizeOAuthReturnIntent("//attacker.example"),
    /Invalid/,
    "scheme-relative return intents fail closed"
  );
  throws(
    () => credentials.CredentialEnvelopeSchema.parse({
      schemaVersion: "oauth_credential_envelope_v1",
      providerKey: "synthetic",
      environment: "test",
      externalAuthorizedEntityReference: null,
      accessToken: "a".repeat(20),
      accessExpiresAt: "2026-08-21T23:30:00.000Z",
      refreshToken: "r".repeat(20),
      refreshExpiresAt: null,
      grantedScopes: [scope],
      issuedAt: "2026-08-21T22:30:00.000Z",
      updatedAt: "2026-08-21T22:30:00.000Z",
      customerDisplayName: "forbidden"
    }),
    /unrecognized/i,
    "credential envelopes reject customer and display data"
  );

  const stateFixture = credentials.createOAuthStateIntent({
    workspaceId: id(1),
    businessEntityId: id(2),
    connectionId: id(3),
    connectionGeneration: 1,
    providerKey: "synthetic",
    providerEnvironment: "test",
    initiatedBy: id(4),
    requestedScopes: [scope],
    returnIntent: "/app/integrations"
  }, new Date("2026-08-21T22:00:00.000Z"));
  equal(stateFixture.state.length, 43, "the browser receives a fixed-length base64url state");
  doesNotMatch(JSON.stringify(stateFixture.command), new RegExp(stateFixture.state), "persistence receives only the state hash");
  equal(
    credentials.oauthStateHash(stateFixture.state),
    stateFixture.command.stateHash,
    "state hashing is deterministic"
  );

  const stateStore = new InMemoryCredentialStore();
  await stateStore.createOAuthState(stateFixture.command);
  const consumeBase = {
    workspaceId: stateFixture.command.workspaceId,
    businessEntityId: stateFixture.command.businessEntityId,
    connectionId: stateFixture.command.connectionId,
    connectionGeneration: 1,
    providerKey: "synthetic",
    providerEnvironment: "test",
    initiatedBy: stateFixture.command.initiatedBy,
    requestedScopes: [scope],
    returnIntent: "/app/integrations",
    stateHash: stateFixture.command.stateHash,
    consumedAt: "2026-08-21T22:01:00.000Z"
  };
  const substitutions = [
    { workspaceId: id(101) },
    { businessEntityId: id(102) },
    { connectionId: id(103) },
    { connectionGeneration: 2 },
    { providerKey: "synthetic_substitute" },
    { providerEnvironment: "preview" },
    { initiatedBy: id(104) },
    { requestedScopes: [scope, "read_synthetic_reference_data"] },
    { returnIntent: "/app/attacker" }
  ];
  for (const substitution of substitutions) {
    const result = await stateStore.consumeOAuthState({ ...consumeBase, ...substitution });
    equal(result.reasonCode, "state_invalid", "OAuth state binding substitution fails closed");
  }
  const consumed = await stateStore.consumeOAuthState(consumeBase);
  equal(consumed.accepted, true, "a fully bound current state is consumed");
  const replayed = await stateStore.consumeOAuthState(consumeBase);
  equal(replayed.reasonCode, "state_replayed", "a consumed state cannot be replayed");
  const missing = await stateStore.consumeOAuthState({
    ...consumeBase,
    stateHash: credentials.oauthStateHash("A".repeat(43))
  });
  equal(missing.reasonCode, "state_missing", "an unknown state hash fails closed");
  const expiredFixture = credentials.createOAuthStateIntent({
    workspaceId: id(11),
    businessEntityId: id(12),
    connectionId: id(13),
    connectionGeneration: 1,
    providerKey: "synthetic",
    providerEnvironment: "test",
    initiatedBy: id(14),
    requestedScopes: [scope],
    returnIntent: "/app/integrations"
  }, new Date("2026-08-21T20:00:00.000Z"));
  const expiredStore = new InMemoryCredentialStore();
  await expiredStore.createOAuthState(expiredFixture.command);
  const expired = await expiredStore.consumeOAuthState({
    ...expiredFixture.command,
    consumedAt: "2026-08-21T20:11:00.000Z"
  });
  equal(expired.reasonCode, "state_expired", "expired OAuth state fails closed");

  const aadContext = {
    schemaVersion: "oauth_credential_aad_v1",
    purpose: "provider_oauth_credential",
    environment: "test",
    workspaceId: id(21),
    connectionId: id(22),
    connectionGeneration: 1,
    providerKey: "synthetic",
    credentialId: id(23)
  };
  const syntheticKms = new credentials.SyntheticCredentialKms({ keyResource: kmsKeyResource });
  const encrypted = await syntheticKms.encrypt({
    keyResource: kmsKeyResource,
    plaintext: Buffer.from("synthetic credential envelope"),
    additionalAuthenticatedData: credentials.credentialAad(aadContext)
  });
  equal(
    Buffer.from(await syntheticKms.decrypt({
      keyResource: kmsKeyResource,
      ciphertext: encrypted,
      additionalAuthenticatedData: credentials.credentialAad(aadContext)
    })).toString("utf8"),
    "synthetic credential envelope",
    "matching trusted AAD decrypts"
  );
  await rejects(
    () => syntheticKms.decrypt({
      keyResource: kmsKeyResource,
      ciphertext: encrypted,
      additionalAuthenticatedData: credentials.credentialAad({ ...aadContext, workspaceId: id(24) })
    }),
    /decrypt_failed/,
    "cross-workspace AAD substitution fails"
  );
  await rejects(
    () => syntheticKms.decrypt({
      keyResource: kmsKeyResource,
      ciphertext: encrypted,
      additionalAuthenticatedData: credentials.credentialAad({ ...aadContext, connectionId: id(25) })
    }),
    /decrypt_failed/,
    "cross-connection AAD substitution fails"
  );
  await rejects(
    () => syntheticKms.decrypt({
      keyResource: kmsKeyResource,
      ciphertext: encrypted,
      additionalAuthenticatedData: credentials.credentialAad({ ...aadContext, environment: "preview" })
    }),
    /decrypt_failed/,
    "cross-environment AAD substitution fails"
  );
  await rejects(
    () => syntheticKms.decrypt({
      keyResource: `${kmsKeyResource}-wrong`,
      ciphertext: encrypted,
      additionalAuthenticatedData: credentials.credentialAad(aadContext)
    }),
    /key_not_allowed/,
    "the wrong KMS key fails closed"
  );
  syntheticKms.setDisabled(true);
  await rejects(
    () => syntheticKms.decrypt({
      keyResource: kmsKeyResource,
      ciphertext: encrypted,
      additionalAuthenticatedData: credentials.credentialAad(aadContext)
    }),
    /key_disabled/,
    "a disabled KMS key fails closed"
  );

  const iam = credentials.createPhase5CredentialIamBoundary({
    kmsKeyResource,
    providerSecretVersionResource: secretVersionResource
  });
  const brokerIam = iam.find((identity) => identity.identity === "connector_broker");
  equal(brokerIam.gcpPermissions.length, 3, "only the broker receives exact KMS and Secret Manager permissions");
  for (const identity of iam.filter((item) => item.identity !== "connector_broker")) {
    equal(identity.gcpPermissions.length, 0, `${identity.identity} has no cloud credential authority`);
    equal(identity.mayReceiveCredentialPlaintext, false, `${identity.identity} cannot receive plaintext credentials`);
  }
  throws(
    () => credentials.createPhase5CredentialIamBoundary({
      kmsKeyResource: "projects/*/locations/global/keyRings/all/cryptoKeys/all",
      providerSecretVersionResource: secretVersionResource
    }),
    /exact/,
    "wildcard IAM resources are rejected"
  );
  throws(
    () => new credentials.GoogleSecretManagerProviderSecrets({
      resources: {
        "synthetic:test": "projects/vaeroex-phase5-test/secrets/synthetic-oauth-client/versions/latest"
      },
      transport: { accessSecretVersion: async () => ({ payload: null }) }
    }),
    /Invalid/,
    "provider application secrets require a pinned numeric Secret Manager version"
  );

  const authorizationFailureIds = {
    workspaceId: id(9101),
    businessEntityId: id(9102),
    connectionId: id(9103),
    initiatedBy: id(9104)
  };
  const authorizationFailureStore = new InMemoryCredentialStore();
  const authorizationFailureBroker = new credentials.IntegrationCredentialBroker({
    store: authorizationFailureStore,
    kms: new credentials.SyntheticCredentialKms({ keyResource: kmsKeyResource }),
    kmsKeyResource,
    secrets: createSecretStore(),
    provider: new credentials.SyntheticOAuthProvider(),
    clock: () => new Date("2026-08-21T22:30:00.000Z")
  });
  const authorizationFailureState = await authorizationFailureBroker.beginAuthorization({
    ...authorizationFailureIds,
    connectionGeneration: 1,
    providerKey: "synthetic",
    providerEnvironment: "test",
    requestedScopes: [scope],
    returnIntent: "/app/integrations",
    requestId: "authorization_failure_state"
  });
  await rejects(
    () => authorizationFailureBroker.completeAuthorization({
      state: authorizationFailureState.state,
      authorizationCode: "invalid_synthetic_authorization_code",
      ...authorizationFailureIds,
      connectionGeneration: 1,
      expectedConnectionRowVersion: 1,
      providerKey: "synthetic",
      providerEnvironment: "test",
      requestedScopes: [scope],
      returnIntent: "/app/integrations",
      consumeRequestId: "authorization_failure_consume",
      storeRequestId: "authorization_failure_audit"
    }),
    /authorization_failed/,
    "invalid authorization codes fail with a redacted broker error"
  );
  equal(
    authorizationFailureStore.auditEvents.at(-1).action,
    "authorization_failure",
    "pre-credential authorization failures retain a non-sensitive audit event"
  );

  const parallel = await bootstrap(2);
  equal(parallel.completed.connectionStatus, "authorized_unmapped", "valid authorization reaches only authorized_unmapped");
  equal(parallel.store.connectionStatus, "authorized_unmapped", "credentials alone do not activate a connection");
  const refreshInput = {
    ...parallel.ids,
    connectionGeneration: 1,
    credentialId: parallel.completed.credentialId,
    expectedCredentialVersion: 1,
    requiredScopes: [scope],
    acquireRequestId: "parallel_acquire",
    rotateRequestId: "parallel_rotate",
    failureRequestId: "parallel_failure"
  };
  const beforeParallelCalls = parallel.provider.callCounts.refresh;
  const parallelResults = await Promise.all([
    parallel.broker.refreshCredential({ ...refreshInput, workerId: "worker_parallel_a" }),
    parallel.broker.refreshCredential({ ...refreshInput, workerId: "worker_parallel_b", acquireRequestId: "parallel_acquire_b" })
  ]);
  equal(parallelResults.filter((result) => result.refreshed).length, 1, "one parallel refresh wins");
  equal(parallelResults.filter((result) => !result.refreshed).length, 1, "one parallel refresh loses");
  equal(parallel.provider.callCounts.refresh - beforeParallelCalls, 1, "only the lease winner contacts the provider");
  equal(parallel.store.currentCredential().version, 2, "the winner rotates credential_version by one");

  const crashBeforeLease = {
    workspaceId: parallel.ids.workspaceId,
    businessEntityId: parallel.ids.businessEntityId,
    connectionId: parallel.ids.connectionId,
    connectionGeneration: 1,
    credentialId: parallel.completed.credentialId,
    expectedCredentialVersion: 2,
    leaseId: id(301),
    leaseOwnerFingerprint: contractSha256({ worker: "crash_before" }),
    acquiredAt: parallel.clock().toISOString(),
    leaseExpiresAt: new Date(parallel.clock().getTime() + 120_000).toISOString()
  };
  equal((await parallel.store.acquireRefreshLease(crashBeforeLease)).acquired, true, "crash-before fixture acquires a lease");
  parallel.advance(121_000);
  const crashBeforeRetry = await parallel.broker.refreshCredential({
    ...refreshInput,
    expectedCredentialVersion: 2,
    workerId: "worker_crash_before_retry",
    acquireRequestId: "crash_before_retry_acquire",
    rotateRequestId: "crash_before_retry_rotate",
    failureRequestId: "crash_before_retry_failure"
  });
  equal(crashBeforeRetry.refreshed, true, "an expired pre-provider lease retries deterministically");
  equal(parallel.store.currentCredential().version, 3, "pre-provider crash retry advances exactly once");

  const crashAfterLease = await parallel.store.acquireRefreshLease({
    ...crashBeforeLease,
    expectedCredentialVersion: 3,
    leaseId: id(302),
    leaseOwnerFingerprint: contractSha256({ worker: "crash_after" }),
    acquiredAt: parallel.clock().toISOString(),
    leaseExpiresAt: new Date(parallel.clock().getTime() + 120_000).toISOString()
  });
  const crashAfterPlaintext = Buffer.from(await parallel.kms.decrypt({
    keyResource: crashAfterLease.kmsKeyResource,
    ciphertext: Buffer.from(crashAfterLease.ciphertextBase64, "base64"),
    additionalAuthenticatedData: credentials.credentialAad(crashAfterLease.aadContext)
  }));
  const crashAfterEnvelope = credentials.CredentialEnvelopeSchema.parse(
    JSON.parse(crashAfterPlaintext.toString("utf8"))
  );
  await parallel.provider.refreshCredential({
    credential: crashAfterEnvelope,
    applicationSecret: await createSecretStore().access("synthetic", "test"),
    now: parallel.clock()
  });
  crashAfterPlaintext.fill(0);
  parallel.advance(121_000);
  const crashAfterRetry = await parallel.broker.refreshCredential({
    ...refreshInput,
    expectedCredentialVersion: 3,
    workerId: "worker_crash_after_retry",
    acquireRequestId: "crash_after_retry_acquire",
    rotateRequestId: "crash_after_retry_rotate",
    failureRequestId: "crash_after_retry_failure"
  });
  equal(crashAfterRetry.reasonCode, "reauthorization_required", "post-response crash fails closed after refresh-token rotation");
  equal(parallel.store.currentCredential().version, 3, "a stale post-response worker cannot persist a fourth version");

  const transient = await bootstrap(3);
  transient.provider.failNextRefresh("provider_transient");
  const transientFailure = await transient.broker.refreshCredential({
    ...transient.ids,
    connectionGeneration: 1,
    credentialId: transient.completed.credentialId,
    expectedCredentialVersion: 1,
    requiredScopes: [scope],
    workerId: "worker_transient",
    acquireRequestId: "transient_acquire",
    rotateRequestId: "transient_rotate",
    failureRequestId: "transient_failure"
  });
  equal(transientFailure.reasonCode, "refresh_failed", "transient provider failure preserves retryability");
  equal(transient.store.currentCredential().status, "active", "transient failure preserves active credential state");
  const transientRetry = await transient.broker.refreshCredential({
    ...transient.ids,
    connectionGeneration: 1,
    credentialId: transient.completed.credentialId,
    expectedCredentialVersion: 1,
    requiredScopes: [scope],
    workerId: "worker_transient_retry",
    acquireRequestId: "transient_retry_acquire",
    rotateRequestId: "transient_retry_rotate",
    failureRequestId: "transient_retry_failure"
  });
  equal(transientRetry.refreshed, true, "transient failure can retry from the same safe version");

  const invalidGrant = await bootstrap(31);
  invalidGrant.provider.failNextRefresh("invalid_grant");
  const invalidGrantResult = await invalidGrant.broker.refreshCredential({
    ...invalidGrant.ids,
    connectionGeneration: 1,
    credentialId: invalidGrant.completed.credentialId,
    expectedCredentialVersion: 1,
    requiredScopes: [scope],
    workerId: "worker_invalid_grant",
    acquireRequestId: "invalid_grant_acquire",
    rotateRequestId: "invalid_grant_rotate",
    failureRequestId: "invalid_grant_failure"
  });
  equal(invalidGrantResult.reasonCode, "reauthorization_required", "invalid_grant fails closed to reauthorization");

  const expiredRefresh = await bootstrap(32);
  expiredRefresh.store.currentCredential().refreshExpiresAt = new Date(
    expiredRefresh.clock().getTime() - 1
  ).toISOString();
  const beforeExpiredCalls = expiredRefresh.provider.callCounts.refresh;
  const expiredRefreshResult = await expiredRefresh.broker.refreshCredential({
    ...expiredRefresh.ids,
    connectionGeneration: 1,
    credentialId: expiredRefresh.completed.credentialId,
    expectedCredentialVersion: 1,
    requiredScopes: [scope],
    workerId: "worker_expired_refresh",
    acquireRequestId: "expired_refresh_acquire",
    rotateRequestId: "expired_refresh_rotate",
    failureRequestId: "expired_refresh_failure"
  });
  equal(expiredRefreshResult.reasonCode, "refresh_not_acquired", "expired refresh credentials cannot acquire a lease");
  equal(expiredRefresh.provider.callCounts.refresh - beforeExpiredCalls, 0, "expired credentials never contact the provider");

  for (const terminalFailure of ["scope_loss", "provider_revoked"]) {
    const fixture = await bootstrap(terminalFailure === "scope_loss" ? 4 : 5);
    fixture.provider.failNextRefresh(terminalFailure);
    const result = await fixture.broker.refreshCredential({
      ...fixture.ids,
      connectionGeneration: 1,
      credentialId: fixture.completed.credentialId,
      expectedCredentialVersion: 1,
      requiredScopes: [scope],
      workerId: `worker_${terminalFailure}`,
      acquireRequestId: `${terminalFailure}_acquire`,
      rotateRequestId: `${terminalFailure}_rotate`,
      failureRequestId: `${terminalFailure}_failure`
    });
    equal(result.reasonCode, "reauthorization_required", `${terminalFailure} requires reauthorization`);
    equal(fixture.store.connectionStatus, "reauthorization_required", `${terminalFailure} updates truthful connection state`);
  }

  const swapA = await bootstrap(6);
  const swapB = await bootstrap(7);
  swapA.store.currentCredential().ciphertextBase64 = swapB.store.currentCredential().ciphertextBase64;
  const swapped = await swapA.broker.refreshCredential({
    ...swapA.ids,
    connectionGeneration: 1,
    credentialId: swapA.completed.credentialId,
    expectedCredentialVersion: 1,
    requiredScopes: [scope],
    workerId: "worker_ciphertext_swap",
    acquireRequestId: "swap_acquire",
    rotateRequestId: "swap_rotate",
    failureRequestId: "swap_failure"
  });
  equal(swapped.reasonCode, "reauthorization_required", "cross-workspace ciphertext swap fails AAD verification");

  const disconnect = await bootstrap(8);
  disconnect.store.connectionStatus = "disconnecting";
  const disconnected = await disconnect.broker.revokeAndDestroyCredential({
    ...disconnect.ids,
    connectionGeneration: 1,
    credentialId: disconnect.completed.credentialId,
    expectedCredentialVersion: 1,
    workerId: "worker_disconnect",
    acquireRequestId: "disconnect_acquire",
    revokeRequestId: "disconnect_revoke",
    revocationResultRequestId: "disconnect_revoke_result",
    destroyRequestId: "disconnect_destroy"
  });
  equal(disconnected.destroyed, true, "disconnect destroys local credential ciphertext");
  equal(disconnected.providerRevocationOutcome, "succeeded", "synthetic provider revocation is recorded");
  equal(disconnect.store.currentCredential().ciphertextBase64, null, "destroyed credential retains no ciphertext");
  equal(disconnected.connectionStatus, "disconnected", "disconnect leaves Phase 4 lifecycle truthful");
  equal(
    (await disconnect.store.acquireRefreshLease({
      workspaceId: disconnect.ids.workspaceId,
      businessEntityId: disconnect.ids.businessEntityId,
      connectionId: disconnect.ids.connectionId,
      connectionGeneration: 1,
      credentialId: disconnect.completed.credentialId,
      expectedCredentialVersion: 1,
      leaseId: id(801),
      leaseOwnerFingerprint: contractSha256({ worker: "after_destroy" }),
      acquiredAt: disconnect.clock().toISOString(),
      leaseExpiresAt: new Date(disconnect.clock().getTime() + 120_000).toISOString()
    })).reasonCode,
    "credential_inactive",
    "destroyed credentials cannot be reacquired"
  );

  const unavailableRevocation = await bootstrap(9);
  unavailableRevocation.store.connectionStatus = "disconnecting";
  unavailableRevocation.provider.failNextRevocation();
  const unavailableRevocationResult = await unavailableRevocation.broker.revokeAndDestroyCredential({
    ...unavailableRevocation.ids,
    connectionGeneration: 1,
    credentialId: unavailableRevocation.completed.credentialId,
    expectedCredentialVersion: 1,
    workerId: "worker_unavailable_revocation",
    acquireRequestId: "unavailable_revocation_acquire",
    revokeRequestId: "unavailable_revocation_revoke",
    revocationResultRequestId: "unavailable_revocation_result",
    destroyRequestId: "unavailable_revocation_destroy"
  });
  equal(unavailableRevocationResult.providerRevocationOutcome, "failed", "provider revocation failure is retained as metadata");
  equal(unavailableRevocationResult.destroyed, true, "provider unavailability cannot block local ciphertext destruction");

  const revocationAuditFailure = await bootstrap(10);
  revocationAuditFailure.store.connectionStatus = "disconnecting";
  revocationAuditFailure.store.completeCredentialRevocation = async () => {
    throw new Error("synthetic_revocation_result_persistence_failure");
  };
  const revocationAuditFailureResult = await revocationAuditFailure.broker.revokeAndDestroyCredential({
    ...revocationAuditFailure.ids,
    connectionGeneration: 1,
    credentialId: revocationAuditFailure.completed.credentialId,
    expectedCredentialVersion: 1,
    workerId: "worker_revocation_audit_failure",
    acquireRequestId: "revocation_audit_failure_acquire",
    revokeRequestId: "revocation_audit_failure_revoke",
    revocationResultRequestId: "revocation_audit_failure_result",
    destroyRequestId: "revocation_audit_failure_destroy"
  });
  equal(revocationAuditFailureResult.providerRevocationOutcome, "deferred", "an unrecorded provider result remains explicitly deferred");
  equal(revocationAuditFailureResult.destroyed, true, "local destruction survives revocation-result persistence failure");

  const safeSurfaces = [
    parallel.completed,
    parallelResults,
    crashBeforeRetry,
    crashAfterRetry,
    transientFailure,
    transientRetry,
    swapped,
    disconnected,
    unavailableRevocationResult,
    revocationAuditFailureResult,
    ...authorizationFailureStore.auditEvents,
    ...parallel.store.auditEvents,
    ...parallel.store.clientOutputs,
    JSON.parse(JSON.stringify(await createSecretStore().access("synthetic", "test"))),
    credentials.redactCredentialMaterial(
      `access_token=${credentials.PHASE_5_LEAKAGE_CANARIES.accessToken} ` +
      `refresh_token=${credentials.PHASE_5_LEAKAGE_CANARIES.refreshToken} ` +
      `authorization_code=${credentials.PHASE_5_LEAKAGE_CANARIES.authorizationCode} ` +
      `client_secret=${credentials.PHASE_5_LEAKAGE_CANARIES.clientSecret}`
    )
  ];
  ok(credentials.assertNoCredentialLeakage(safeSurfaces), "logs, audits, errors, and client results contain no leakage canary");

  const migration = read("supabase/migrations/20260821220853_external_integrations_phase_5_credential_security.sql");
  const phase5Source = [
    read("lib/integrations/credentials/contracts.ts"),
    read("lib/integrations/credentials/kms.ts"),
    read("lib/integrations/credentials/secret-manager.ts"),
    read("lib/integrations/credentials/iam.ts"),
    read("lib/integrations/credentials/broker.ts"),
    read("lib/integrations/credentials/synthetic-provider.ts")
  ].join("\n");
  doesNotMatch(phase5Source, /QuickBooks|Intuit|Microsoft|Oracle|NetSuite|SAP|CAKE/i, "Phase 5 has no real-provider implementation");
  doesNotMatch(phase5Source, /\bfetch\s*\(|axios|node:https|node:http/i, "Phase 5 makes no provider network call");
  doesNotMatch(phase5Source, /openai|embedding|rerank|business_state_delta/i, "Phase 5 introduces no AI or Business State Delta path");
  doesNotMatch(migration, /create table (?:public|private)\.[^\s]*(?:queue|checkpoint|webhook|payload)/i, "Phase 5 creates no queue, checkpoint, webhook, or provider-payload table");
  ok(/create role integration_oauth_ingress_authority nologin noinherit/.test(migration), "OAuth ingress uses a dedicated NOLOGIN/NOINHERIT role");
  ok(/create role integration_credential_broker_authority nologin noinherit/.test(migration), "credential broker uses a dedicated NOLOGIN/NOINHERIT role");
  ok(/alter table private\.integration_credentials force row level security/.test(migration), "credential authority forces RLS");
  ok(/revoke all on table private\.integration_credentials[\s\S]+service_role/.test(migration), "service_role has no credential table shortcut");
  doesNotMatch(migration, /grant (?:select|insert|update|delete|all)[\s\S]{0,100}integration_credentials/i, "no role receives direct credential-table DML");
  doesNotMatch(migration, /\b(access_token|refresh_token|authorization_code|client_secret)\b/i, "database columns contain no plaintext authorization material");
  ok(/v_consumed_at := pg_catalog\.transaction_timestamp\(\);[\s\S]+v_consumed_at >= v_state\.expires_at/.test(migration), "OAuth expiry decisions use the database transaction clock");
  ok(/v_acquired_at := pg_catalog\.transaction_timestamp\(\);[\s\S]+refresh_lease_expires_at > v_acquired_at/.test(migration), "refresh lease acquisition uses the database transaction clock");
  ok(/v_rotated_at := pg_catalog\.transaction_timestamp\(\);[\s\S]+refresh_lease_expires_at <= v_rotated_at/.test(migration), "credential rotation rejects leases expired by the database transaction clock");

  console.log(`External integration Phase 5 credential-security regressions: ${assertionCount} assertions passed; model calls 0; promotionAuthorized false.`);
}

main().catch((error) => {
  process.stderr.write(`${credentials.redactCredentialMaterial(error instanceof Error ? error.stack : error)}\n`);
  process.exit(1);
});
