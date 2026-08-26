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

const phase8b = require("../lib/integrations/provider-runtime/qbo/index.ts");
const qbo = require("../lib/integrations/providers/qbo/index.ts");
const fixtures = require("../lib/integrations/providers/qbo/fixtures/v1.ts");
const secrets = require("../lib/integrations/credentials/secret-manager.ts");
const serializers = require("../lib/integrations/persistence/serializers.ts");
const reconciliation = require("../lib/integrations/reconciliation/index.ts");
const deterministic = require("../lib/integrations/deterministic/index.ts");
const qboRuntimeRepository = require("../lib/integrations/persistence/qbo-sandbox-runtime-repository.ts");
const credentialResolution = require("../lib/integrations/provider-runtime/credential-resolution.ts");
const credentialContracts = require("../lib/integrations/credentials/contracts.ts");
const credentialBroker = require("../lib/integrations/credentials/broker.ts");
const credentialKms = require("../lib/integrations/credentials/kms.ts");
const credentialRedaction = require("../lib/integrations/credentials/redaction.ts");
const oauthState = require("../lib/integrations/credentials/oauth-state.ts");
const canonical = require("../lib/integrations/contracts/canonical.ts");
const cloudTaskDelivery = require(
  "../services/external-integrations-qbo-sandbox/src/cloud-task-delivery.ts"
);
const controlledRun = require("../lib/integrations/runtime/controlled-run-observer.ts");
const runtimeContracts = require("../lib/integrations/runtime/contracts.ts");
const { ProviderCredentialRefreshFailure } = require("../lib/integrations/credentials/provider-failure.ts");

let assertionCount = 0;
function equal(actual, expected, message) {
  assertionCount += 1;
  assert.equal(actual, expected, message);
}
function deepEqual(actual, expected, message) {
  assertionCount += 1;
  assert.deepEqual(actual, expected, message);
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

function id(seed) {
  const hex = BigInt(seed).toString(16).padStart(32, "0").slice(-32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

function hash(value) {
  return qbo.QBO_PROVIDER_KEY && require("node:crypto")
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function fingerprint(value) {
  return `sha256:${hash(value)}`;
}

const ids = {
  workspace: id(8001),
  entity: id(8002),
  connection: id(8003),
  user: id(8004),
  sourcePending: id(8010),
  sourceValidated: id(8011),
  reportPending: id(8012),
  reportValidated: id(8013),
  policy: id(8020),
  family: id(8021),
  controlFamily: id(8022),
  case: id(8023),
  batch: id(8024)
};
const at = "2026-08-22T12:00:00.000Z";
const provider = fixtures.QBO_SYNTHETIC_PROVIDER;

async function testControlledRunObserver() {
  const taskId = id(8999);
  const queueName = "p8b-qbo-canary";
  const snapshot = (state, queueState = "RUNNING") => ({
    queueName,
    queueState,
    tasks: [{ taskId, state }]
  });

  deepEqual(
    runtimeContracts.RUNTIME_TERMINAL_TASK_STATES,
    ["succeeded", "failed", "dead_letter", "cancelled"],
    "the runtime contract owns the complete terminal task-state set"
  );
  deepEqual(
    runtimeContracts.RUNTIME_NON_TERMINAL_TASK_STATES,
    ["pending", "dispatched", "leased", "retry_wait"],
    "the runtime contract distinguishes every nonterminal task state"
  );

  for (const terminalState of runtimeContracts.RUNTIME_TERMINAL_TASK_STATES) {
    let pauses = 0;
    const observer = new controlledRun.ControlledRunObserver({
      queueName,
      expectedTaskIds: [taskId],
      pauseQueue: async () => {
        pauses += 1;
      }
    });
    const result = await observer.observe(snapshot(terminalState));
    equal(result.status, "finalized", `${terminalState} terminates controlled observation`);
    equal(pauses, 1, `${terminalState} triggers exactly one queue finalization`);
  }

  let nonTerminalPauses = 0;
  const nonTerminalObserver = new controlledRun.ControlledRunObserver({
    queueName,
    expectedTaskIds: [taskId],
    pauseQueue: async () => {
      nonTerminalPauses += 1;
    }
  });
  for (const nonTerminalState of runtimeContracts.RUNTIME_NON_TERMINAL_TASK_STATES) {
    const result = await nonTerminalObserver.observe(snapshot(nonTerminalState));
    equal(result.status, "observing", `${nonTerminalState} remains nonterminal`);
  }
  equal(nonTerminalPauses, 0, "nonterminal states never request queue finalization");

  let streamedSnapshots = 0;
  let canaryPauses = 0;
  async function* canarySnapshots() {
    streamedSnapshots += 1;
    yield snapshot("leased");
    streamedSnapshots += 1;
    yield snapshot("succeeded");
    streamedSnapshots += 1;
    yield snapshot("failed");
  }
  const canaryObserver = new controlledRun.ControlledRunObserver({
    queueName,
    expectedTaskIds: [taskId],
    pauseQueue: async () => {
      canaryPauses += 1;
    }
  });
  const canaryResult = await controlledRun.observeControlledRunSnapshots(
    canaryObserver,
    canarySnapshots()
  );
  equal(canaryResult.status, "finalized", "the one-task canary finalizes on success");
  equal(streamedSnapshots, 2, "observation stops without reading a post-terminal snapshot");
  equal(canaryPauses, 1, "one-task completion performs exactly one pause action");

  const replay = await canaryObserver.observe(snapshot("succeeded"));
  equal(replay.idempotent, true, "terminal observation replay is idempotent");
  equal(canaryPauses, 1, "terminal replay cannot perform a second pause action");

  let alreadyPausedCalls = 0;
  const alreadyPausedObserver = new controlledRun.ControlledRunObserver({
    queueName,
    expectedTaskIds: [taskId],
    pauseQueue: async () => {
      alreadyPausedCalls += 1;
    }
  });
  const alreadyPaused = await alreadyPausedObserver.observe(snapshot("succeeded", "PAUSED"));
  equal(alreadyPaused.idempotent, true, "an already-paused settled run finalizes idempotently");
  equal(alreadyPausedCalls, 0, "an already-paused queue does not receive another pause request");

  let releasePause;
  const pauseGate = new Promise((resolve) => {
    releasePause = resolve;
  });
  let concurrentPauses = 0;
  const concurrentObserver = new controlledRun.ControlledRunObserver({
    queueName,
    expectedTaskIds: [taskId],
    pauseQueue: async () => {
      concurrentPauses += 1;
      await pauseGate;
    }
  });
  const firstFinalization = concurrentObserver.observe(snapshot("succeeded"));
  const secondFinalization = concurrentObserver.observe(snapshot("succeeded"));
  await Promise.resolve();
  equal(concurrentPauses, 1, "concurrent terminal observations share one pause action");
  releasePause();
  const concurrentResults = await Promise.all([firstFinalization, secondFinalization]);
  equal(
    concurrentResults.filter((result) => result.pauseRequested).length,
    1,
    "exactly one concurrent observer owns finalization"
  );
  equal(
    concurrentResults.filter((result) => result.idempotent).length,
    1,
    "the concurrent finalization follower is idempotent"
  );

  await rejects(
    () => canaryObserver.observe({ ...snapshot("succeeded"), tasks: [] }),
    /controlled_run_task_scope_mismatch|too_small/,
    "an incomplete controlled batch fails closed"
  );
  await rejects(
    () => canaryObserver.observe({
      ...snapshot("succeeded"),
      tasks: [snapshot("succeeded").tasks[0], snapshot("succeeded").tasks[0]]
    }),
    /controlled_run_task_scope_mismatch/,
    "duplicate task observations cannot widen or settle the batch"
  );

  const observerSource = read("lib/integrations/runtime/controlled-run-observer.ts");
  equal(
    /resumeQueue|dispatchTask|createCloudTask|googleCreateCloudTask/.test(observerSource),
    false,
    "the observer has no queue-resume or delivery-creation capability"
  );
  equal(
    /setInterval|setTimeout/.test(observerSource),
    false,
    "the observer does not use a polling timer as its execution safety boundary"
  );
}

async function testOAuth() {
  equal(
    phase8b.QBO_PHASE_8B_RUNTIME_BOUNDARY.providerEnvironment,
    "sandbox",
    "Phase 8B runtime is sandbox-only"
  );
  deepEqual(
    phase8b.QBO_PHASE_8B_RUNTIME_BOUNDARY.scopes,
    ["com.intuit.quickbooks.accounting"],
    "Phase 8B requests only the accounting scope"
  );
  equal(
    phase8b.QBO_PHASE_8B_RUNTIME_BOUNDARY.promotionAuthorized,
    false,
    "Phase 8B cannot promote customer-visible KPI state"
  );
  equal(phase8b.QBO_PHASE_8B_RUNTIME_BOUNDARY.modelCallCount, 0, "Phase 8B makes zero model calls");

  const authorizationUrl = new URL(
    phase8b.createQboSandboxAuthorizationUrl({
      clientId: "phase8b-development-client",
      redirectUri: "https://phase8b.example.test/oauth/callback",
      state: "a".repeat(43)
    })
  );
  equal(authorizationUrl.origin, "https://appcenter.intuit.com", "authorization host is exact");
  deepEqual(
    [...authorizationUrl.searchParams.keys()].sort(),
    ["client_id", "redirect_uri", "response_type", "scope", "state"],
    "authorization URL contains only the five reviewed OAuth parameters"
  );
  equal(authorizationUrl.searchParams.get("client_id"), "phase8b-development-client", "client ID is exact");
  equal(authorizationUrl.searchParams.get("redirect_uri"), "https://phase8b.example.test/oauth/callback", "redirect URI is exact");
  equal(authorizationUrl.searchParams.get("response_type"), "code", "authorization-code flow is exact");
  equal(authorizationUrl.searchParams.get("scope"), phase8b.QBO_ACCOUNTING_SCOPE, "scope is exact");
  equal(authorizationUrl.searchParams.getAll("scope").length, 1, "scope is not duplicated");
  equal(authorizationUrl.searchParams.get("state"), "a".repeat(43), "single-use state is passed unchanged");
  equal(authorizationUrl.searchParams.has("prompt"), false, "Vaeroex cannot request a silent authorization path");
  equal(authorizationUrl.searchParams.has("realmId"), false, "authorization URL cannot choose realm authority");
  equal(authorizationUrl.toString().includes("quickbooks.payment"), false, "payments scope is absent");

  const callbackBoundary = read(
    "docs/architecture/external-integrations-phase-8b-oauth-callback-log-boundary.md"
  );
  ok(
    /A visible Intuit consent button is not a Phase 8B protocol or security\s+invariant/.test(callbackBoundary),
    "provider authorization UI is not treated as application-owned evidence"
  );
  ok(
    /the absence of that UI alone neither proves a bypass nor\s+invalidates an otherwise evidenced authorization/.test(callbackBoundary),
    "absence of provider UI still requires complete protocol evidence"
  );
  ok(
    /No Vaeroex path may suppress provider UI/.test(callbackBoundary) &&
      /reuse stored provider tokens as a new authorization/.test(callbackBoundary),
    "authorization UI semantics cannot create an implementation bypass"
  );

  const accessCanary = "phase8b-access-token-canary-0001";
  const refreshCanary = "phase8b-refresh-token-canary-0001";
  const rotatedRefresh = "phase8b-refresh-token-rotated-0002";
  const calls = [];
  const transport = {
    async postForm(input) {
      calls.push({ ...input });
      const refresh = input.body.includes("refresh_token=");
      return {
        status: 200,
        body: Buffer.from(JSON.stringify({
          access_token: refresh ? "phase8b-access-token-rotated-0002" : accessCanary,
          refresh_token: refresh ? rotatedRefresh : refreshCanary,
          expires_in: 3600,
          x_refresh_token_expires_in: 8_640_000,
          token_type: "bearer",
          ...(refresh ? { scope: phase8b.QBO_ACCOUNTING_SCOPE } : {})
        }))
      };
    }
  };
  const secret = new secrets.ProviderApplicationSecret({
    schemaVersion: "provider_application_secret_v1",
    providerKey: "quickbooks_online",
    environment: "sandbox",
    clientId: "phase8b-development-client",
    clientSecret: "phase8b-client-secret-canary-0001"
  });
  const oauth = new phase8b.QboSandboxOAuthCredentialProvider({
    redirectUri: "https://phase8b.example.test/oauth/callback",
    transport
  });
  const envelope = await oauth.exchangeAuthorizationCode({
    authorizationCode: "phase8b-authorization-code-canary-0001",
    externalAuthorizedEntityReference: provider.realmId,
    applicationSecret: secret,
    requestedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
    now: new Date(at)
  });
  equal(envelope.environment, "sandbox", "credential envelope binds provider environment");
  equal(envelope.externalAuthorizedEntityReference, provider.realmId, "credential envelope binds realm metadata");
  equal(envelope.accessExpiresAt, "2026-08-22T13:00:00.000Z", "access lifetime is provider-derived");
  deepEqual(
    envelope.grantedScopes,
    [phase8b.QBO_ACCOUNTING_SCOPE],
    "state-bound requested scope remains authoritative when Intuit omits scope from its token response"
  );
  equal(calls[0].url, phase8b.QBO_TOKEN_ENDPOINT, "code exchange uses exact token endpoint");
  equal(calls[0].contentType, "application/x-www-form-urlencoded", "code exchange content type is exact");
  equal(calls[0].body.includes("redirect_uri="), true, "code exchange repeats exact redirect URI");
  equal(JSON.stringify(secret).includes("client-secret-canary"), false, "application secret serializes redacted");

  const refreshed = await oauth.refreshCredential({
    credential: envelope,
    applicationSecret: secret,
    now: new Date("2026-08-22T12:30:00.000Z")
  });
  equal(refreshed.refreshToken, rotatedRefresh, "refresh persists the newest rotated refresh token");
  equal(refreshed.externalAuthorizedEntityReference, provider.realmId, "refresh preserves realm binding");
  await rejects(
    () => oauth.exchangeAuthorizationCode({
      authorizationCode: "phase8b-authorization-code-canary-0002",
      externalAuthorizedEntityReference: provider.realmId,
      applicationSecret: secret,
      requestedScopes: [phase8b.QBO_ACCOUNTING_SCOPE, "com.intuit.quickbooks.payment"],
      now: new Date(at)
    }),
    /scope_set_invalid/,
    "arbitrary or payment scopes fail closed"
  );
  const mismatchedScopeOauth = new phase8b.QboSandboxOAuthCredentialProvider({
    redirectUri: "https://phase8b.example.test/oauth/callback",
    transport: {
      async postForm() {
        return {
          status: 200,
          body: Buffer.from(JSON.stringify({
            access_token: accessCanary,
            refresh_token: refreshCanary,
            expires_in: 3600,
            x_refresh_token_expires_in: 8_640_000,
            token_type: "bearer",
            scope: "com.intuit.quickbooks.payment"
          }))
        };
      }
    }
  });
  await rejects(
    () => mismatchedScopeOauth.exchangeAuthorizationCode({
      authorizationCode: "phase8b-authorization-code-canary-0003",
      externalAuthorizedEntityReference: provider.realmId,
      applicationSecret: secret,
      requestedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
      now: new Date(at)
    }),
    /scope_set_invalid/,
    "an explicit provider scope mismatch fails closed"
  );
  throws(
    () => phase8b.createQboSandboxAuthorizationUrl({
      clientId: "phase8b-development-client",
      redirectUri: "not-a-url",
      state: "a".repeat(43)
    }),
    /url|Invalid/i,
    "malformed callbacks fail before authorization"
  );
}

function testCloudTaskDeliveryIdentity() {
  const taskName = "a".repeat(64);
  const base = {
    taskId: id(8750),
    workspaceId: id(8751),
    businessEntityId: id(8752),
    connectionId: id(8753),
    connectionGeneration: 1,
    expectedQueueName: "p8b-qbo",
    trustedDispatchGeneration: 2,
    taskName,
    queueName: "p8b-qbo",
    retryCount: "0",
    executionCount: "0"
  };
  const first = cloudTaskDelivery.parseQboCloudTaskDelivery(base);
  equal(first.retryCount, 0, "first Cloud Tasks delivery retains retry count zero");
  equal(first.executionCount, 0, "first Cloud Tasks delivery retains execution count zero");
  equal(first.dispatchGeneration, 2, "delivery identity uses the trusted dispatch generation");
  throws(
    () => cloudTaskDelivery.parseQboCloudTaskDelivery({
      ...base,
      queueName: "p8b-qbo-canary"
    }),
    /queue mismatch|invalid/i,
    "the main runtime cannot execute a canary-queue envelope"
  );
  const canaryDelivery = cloudTaskDelivery.parseQboCloudTaskDelivery({
    ...base,
    expectedQueueName: "p8b-qbo-canary",
    queueName: "p8b-qbo-canary"
  });
  equal(
    canaryDelivery.queueName,
    "p8b-qbo-canary",
    "the canary runtime accepts only its exact queue identity"
  );
  throws(
    () => cloudTaskDelivery.parseQboCloudTaskDelivery({
      ...base,
      expectedQueueName: "p8b-qbo-canary"
    }),
    /queue mismatch|invalid/i,
    "the canary runtime cannot execute a main-queue envelope"
  );

  const retryWithoutExecutionAdvance = cloudTaskDelivery.parseQboCloudTaskDelivery({
    ...base,
    retryCount: "1",
    executionCount: "0"
  });
  ok(
    retryWithoutExecutionAdvance.attemptFingerprint !== first.attemptFingerprint,
    "retry one/execution zero is distinct from retry zero/execution zero"
  );
  const nonContiguous = cloudTaskDelivery.parseQboCloudTaskDelivery({
    ...base,
    retryCount: "6",
    executionCount: "4"
  });
  equal(nonContiguous.executionCount, 4, "non-contiguous execution observations remain valid");

  for (const [field, value] of [
    ["retryCount", undefined],
    ["executionCount", undefined],
    ["retryCount", ["0"]],
    ["executionCount", ["0"]],
    ["retryCount", "-1"],
    ["executionCount", "-1"],
    ["retryCount", "00"],
    ["executionCount", "one"],
    ["retryCount", "101"],
    ["executionCount", "101"]
  ]) {
    throws(
      () => cloudTaskDelivery.parseQboCloudTaskDelivery({ ...base, [field]: value }),
      /phase8b_cloud_task_delivery_invalid|invalid/i,
      `${field} fails closed for missing, malformed, negative or bounded-invalid metadata`
    );
  }
  throws(
    () => cloudTaskDelivery.parseQboCloudTaskDelivery({
      ...base,
      retryCount: "1",
      executionCount: "2"
    }),
    /execution count cannot exceed retry count|invalid/i,
    "execution count cannot outrun the authoritative retry count"
  );
  for (const mutation of [
    { trustedDispatchGeneration: 3 },
    { taskId: id(8754) },
    { workspaceId: id(8755) },
    { businessEntityId: id(8756) },
    { connectionId: id(8757) },
    { connectionGeneration: 2 },
    { taskName: "b".repeat(64) }
  ]) {
    const changed = cloudTaskDelivery.parseQboCloudTaskDelivery({
      ...base,
      ...mutation
    });
    ok(
      changed.attemptFingerprint !== first.attemptFingerprint,
      "delivery fingerprint changes with every trusted identity dimension"
    );
  }

  deepEqual(
    qboRuntimeRepository.QboSandboxRuntimeLeaseResultSchema.parse({
      acquired: false,
      terminalReplay: false,
      taskId: base.taskId,
      state: "leased",
      rowVersion: 9,
      reasonCode: "lease_held"
    }),
    {
      acquired: false,
      terminalReplay: false,
      taskId: base.taskId,
      state: "leased",
      rowVersion: 9,
      reasonCode: "lease_held"
    },
    "lease denial is a first-class authoritative runtime result"
  );
}

async function testSameGenerationReauthorizationBroker() {
  const callback = credentialContracts.PHASE_8B_REAUTHORIZATION_REDIRECT_URI;
  equal(
    callback,
    "https://p8b-oauth-34-120-247-116.sslip.io/oauth/callback",
    "reauthorization contract pins the approved query-stripping callback edge"
  );
  equal(
    credentialContracts.CREDENTIAL_SECURITY_CONTRACT_VERSIONS.reauthorizationState,
    "integration_reauthorization_state_v1",
    "reauthorization state has a distinct versioned contract"
  );
  equal(
    credentialContracts.CREDENTIAL_SECURITY_CONTRACT_VERSIONS.credentialReauthorization,
    "integration_credential_reauthorization_v1",
    "credential replacement has a distinct versioned contract"
  );
  throws(
    () => oauthState.oauthStateHash(`r1_${"a".repeat(43)}`),
    /oauth_state_format_invalid/,
    "initial OAuth hashing rejects a reauthorization state"
  );
  throws(
    () => oauthState.reauthorizationStateHash("a".repeat(43)),
    /reauthorization_state_format_invalid/,
    "reauthorization hashing rejects an initial OAuth state"
  );

  const now = new Date("2026-08-24T08:00:00.000Z");
  const workspaceId = id(8801);
  const businessEntityId = id(8802);
  const connectionId = id(8803);
  const mappingId = id(8804);
  const userId = id(8805);
  const priorCredentialId = id(8806);
  const realmId = "phase8b-reauthorization-realm";
  const realmFingerprint = canonical.contractSha256({
    fingerprintPurpose: "provider_authorized_entity_reference",
    fingerprintVersion: "provider_authorized_entity_reference_fingerprint_v1",
    value: realmId
  });
  const kmsKeyResource =
    "projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth";
  const calls = {
    created: [],
    consumed: [],
    stored: [],
    exchanged: 0,
    verified: 0,
    encryptedPlaintext: null
  };
  const store = {
    async createOAuthState() {},
    async consumeOAuthState() {},
    async storeCredential() {},
    async createReauthorizationState(command) {
      calls.created.push(command);
      return {
        stateId: command.id,
        connectionRowVersion: 3,
        credentialId: priorCredentialId,
        credentialVersion: 1,
        credentialRowVersion: 1,
        mappingId,
        mappingRowVersion: 1,
        recoveryEvidenceCount: 24,
        idempotent: false
      };
    },
    async consumeReauthorizationState(command) {
      calls.consumed.push(command);
      if (command.providerEntityReferenceFingerprint !== realmFingerprint) {
        return { accepted: false, reasonCode: "state_invalid" };
      }
      return {
        accepted: true,
        stateId: id(8810),
        workspaceId,
        businessEntityId,
        connectionId,
        connectionGeneration: 1,
        mappingId,
        providerKey: "quickbooks_online",
        providerEnvironment: "sandbox",
        requestedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
        redirectUri: callback,
        returnIntent: "/phase8b/sandbox/reauthorized",
        authorizationPurpose: "reauthorization",
        reasonCode: "expired_credential_recovery",
        expectedConnectionRowVersion: 3,
        supersededCredentialId: priorCredentialId,
        supersededCredentialVersion: 1,
        expectedCredentialRowVersion: 1,
        expectedMappingRowVersion: 1,
        providerEntityReferenceFingerprint: realmFingerprint,
        consumedAt: now.toISOString()
      };
    },
    async storeReauthorizedCredential(command) {
      calls.stored.push(command);
      return {
        credentialId: command.id,
        credentialVersion: 2,
        credentialStatus: "active",
        supersededCredentialId: priorCredentialId,
        supersededCredentialVersion: 1,
        connectionStatus: "initializing",
        connectionRowVersion: 3,
        mappingId,
        mappingStatus: "active",
        mappingRowVersion: 1,
        idempotent: false
      };
    },
    async readProviderCredential() {},
    async acquireRefreshLease() {},
    async reclaimExpiredRefreshLease() {},
    async rotateCredential() {},
    async completeRefreshFailure() {},
    async revokeCredential() {},
    async completeCredentialRevocation() {},
    async destroyCredential() {},
    async recordAuthorizationEvent() {},
    async recordRefreshBoundaryEvent() {}
  };
  const secret = new secrets.ProviderApplicationSecret({
    schemaVersion: "provider_application_secret_v1",
    providerKey: "quickbooks_online",
    environment: "sandbox",
    clientId: "phase8b-development-client",
    clientSecret: "phase8b-reauthorization-client-secret-canary"
  });
  const broker = new credentialBroker.IntegrationCredentialBroker({
    store,
    kms: {
      async encrypt(input) {
        calls.encryptedPlaintext = Buffer.from(input.plaintext);
        return Buffer.from("phase8b-reauthorized-ciphertext-v2", "utf8");
      },
      async decrypt() {
        throw new Error("unexpected_decrypt");
      }
    },
    kmsKeyResource,
    secrets: { async access() { return secret; } },
    provider: {
      providerKey: "quickbooks_online",
      environment: "sandbox",
      async exchangeAuthorizationCode(input) {
        calls.exchanged += 1;
        equal(
          input.externalAuthorizedEntityReference,
          realmId,
          "token exchange remains bound to the callback realm"
        );
        return {
          schemaVersion: "oauth_credential_envelope_v1",
          providerKey: "quickbooks_online",
          environment: "sandbox",
          externalAuthorizedEntityReference: realmId,
          accessToken: "phase8b-access-token-reauthorized-v2",
          accessExpiresAt: "2026-08-24T09:00:00.000Z",
          refreshToken: "phase8b-refresh-token-reauthorized-v2",
          refreshExpiresAt: "2026-11-22T08:00:00.000Z",
          grantedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
          issuedAt: now.toISOString(),
          updatedAt: now.toISOString()
        };
      },
      async refreshCredential() {
        throw new Error("unexpected_refresh");
      },
      async revokeCredential() {
        throw new Error("unexpected_revoke");
      }
    },
    authorizedEntityVerifier: {
      async verify(input) {
        calls.verified += 1;
        await input.credential.use(({ accessToken }) => {
          equal(
            accessToken,
            "phase8b-access-token-reauthorized-v2",
            "realm revalidation receives access-token authority only"
          );
        });
        return {
          externalAuthorizedEntityReference: realmId,
          providerEntityType: "company",
          safeDisplayName: "Phase 8B Sandbox Company",
          verificationFingerprint: fingerprint("phase8b-company-revalidated")
        };
      }
    },
    clock: () => now
  });

  const begun = await broker.beginReauthorization({
    workspaceId,
    businessEntityId,
    connectionId,
    connectionGeneration: 1,
    mappingId,
    providerKey: "quickbooks_online",
    providerEnvironment: "sandbox",
    initiatedBy: userId,
    requestedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
    requestId: "phase8b_reauthorization_begin_test"
  });
  equal(oauthState.isReauthorizationOAuthState(begun.state), true, "reauthorization state has a non-interchangeable prefix");
  equal(calls.created.length, 1, "begin persists exactly one bounded reauthorization state");
  equal(calls.created[0].redirectUri, callback, "state persistence binds the exact callback edge");
  equal("expectedConnectionRowVersion" in calls.created[0], false, "begin command exposes no caller-selected connection row version");
  equal("expectedCredentialVersion" in calls.created[0], false, "begin command exposes no caller-selected credential version");

  const completed = await broker.completeReauthorization({
    state: begun.state,
    authorizationCode: "phase8b-authorization-code-reauthorized-v2",
    externalAuthorizedEntityReference: realmId,
    workspaceId,
    businessEntityId,
    connectionId,
    connectionGeneration: 1,
    mappingId,
    providerKey: "quickbooks_online",
    providerEnvironment: "sandbox",
    initiatedBy: userId,
    requestedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
    consumeRequestId: "phase8b_reauthorization_consume_test",
    storeRequestId: "phase8b_reauthorization_store_test"
  });
  equal(completed.credentialVersion, 2, "completion returns the appended credential version");
  equal(completed.connectionStatus, "initializing", "completion preserves initializing lifecycle");
  equal(calls.exchanged, 1, "successful reauthorization exchanges exactly one code");
  equal(calls.verified, 1, "successful reauthorization revalidates exactly one company realm");
  equal(calls.stored.length, 1, "successful reauthorization stores exactly one replacement");
  equal(calls.stored[0].reauthorizationStateId, id(8810), "replacement storage is state-lineage bound");
  equal(calls.stored[0].externalEntityReferenceFingerprint, realmFingerprint, "replacement storage preserves existing realm identity");
  equal("expectedConnectionRowVersion" in calls.stored[0], false, "completion storage derives CAS versions from persisted state");
  equal("credentialVersion" in calls.stored[0], false, "completion storage cannot choose its successor version");

  const callbackEnvelope = credentialContracts.CredentialEnvelopeSchema.parse(
    JSON.parse(calls.encryptedPlaintext.toString("utf8"))
  );
  const callbackPersistedAt = new Date(now.getTime() + 1_000);
  const rebaseExpiry = (expiresAt) => new Date(
    callbackPersistedAt.getTime() +
      Date.parse(expiresAt) -
      Date.parse(callbackEnvelope.updatedAt)
  ).toISOString();
  const callbackReadBroker = new credentialBroker.IntegrationCredentialBroker({
    store: {
      ...store,
      async readProviderCredential() {
        return {
          state: "available",
          credentialId: completed.credentialId,
          credentialVersion: completed.credentialVersion,
          providerKey: "quickbooks_online",
          providerEnvironment: "sandbox",
          accessExpiresAt: rebaseExpiry(callbackEnvelope.accessExpiresAt),
          ciphertextPersistedAt: callbackPersistedAt.toISOString(),
          refreshExpiresAt: rebaseExpiry(callbackEnvelope.refreshExpiresAt),
          externalEntityReferenceFingerprint: realmFingerprint,
          ciphertextBase64: Buffer.from(
            "phase8b-reauthorized-ciphertext-v2",
            "utf8"
          ).toString("base64"),
          aadDigest: calls.stored[0].aadDigest,
          kmsKeyResource,
          aadContext: {
            schemaVersion: "oauth_credential_aad_v1",
            purpose: "provider_oauth_credential",
            environment: "sandbox",
            workspaceId,
            connectionId,
            connectionGeneration: 1,
            providerKey: "quickbooks_online",
            credentialId: completed.credentialId
          },
          grantedScopes: [phase8b.QBO_ACCOUNTING_SCOPE]
        };
      }
    },
    kms: {
      async encrypt() {
        throw new Error("unexpected_encrypt");
      },
      async decrypt() {
        return Buffer.from(calls.encryptedPlaintext);
      }
    },
    kmsKeyResource,
    secrets: { async access() { throw new Error("unexpected_secret"); } },
    provider: {
      providerKey: "quickbooks_online",
      environment: "sandbox",
      async exchangeAuthorizationCode() { throw new Error("unexpected_exchange"); },
      async refreshCredential() { throw new Error("unexpected_refresh"); },
      async revokeCredential() { throw new Error("unexpected_revoke"); }
    },
    clock: () => now
  });
  equal(
    (await callbackReadBroker.readProviderAccessCredential({
      taskId: id(8811),
      leaseId: id(8812),
      leaseOwnerFingerprint: fingerprint("phase8b-callback-read-owner"),
      expectedCredentialVersion: completed.credentialVersion,
      requiredScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
      minimumValiditySeconds: 300,
      requestId: "phase8b_callback_credential_read"
    })).state,
    "available",
    "callback-created credential remains readable after trusted-clock expiry rebasing"
  );

  const providerCallsBeforeMismatch = calls.exchanged;
  await rejects(
    () => broker.completeReauthorization({
      state: begun.state,
      authorizationCode: "phase8b-wrong-realm-code",
      externalAuthorizedEntityReference: "phase8b-wrong-realm",
      workspaceId,
      businessEntityId,
      connectionId,
      connectionGeneration: 1,
      mappingId,
      providerKey: "quickbooks_online",
      providerEnvironment: "sandbox",
      initiatedBy: userId,
      requestedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
      consumeRequestId: "phase8b_reauthorization_wrong_realm_consume",
      storeRequestId: "phase8b_reauthorization_wrong_realm_store"
    }),
    /oauth_state_rejected/,
    "wrong realm fails through bounded state validation"
  );
  equal(calls.exchanged, providerCallsBeforeMismatch, "wrong realm cannot trigger Intuit token exchange");
}

async function testExpiredRefreshLeaseReclamationBroker() {
  equal(
    credentialContracts.CREDENTIAL_SECURITY_CONTRACT_VERSIONS
      .expiredRefreshLeaseReclamation,
    "integration_expired_refresh_lease_reclamation_v1",
    "expired lease reclamation has a distinct versioned contract"
  );
  const workspaceId = id(8901);
  const businessEntityId = id(8902);
  const connectionId = id(8903);
  const credentialId = id(8904);
  const auditEventId = id(8905);
  const calls = [];
  let sensitiveBoundaryCalls = 0;
  const broker = new credentialBroker.IntegrationCredentialBroker({
    store: {
      async reclaimExpiredRefreshLease(command, requestId) {
        calls.push({ command, requestId });
        return {
          auditEventId,
          credentialId,
          credentialVersion: 1,
          credentialStatus: "active",
          credentialRowVersion: 3,
          leaseState: "expired_reclaimed",
          accessExpired: true,
          reclaimedAt: "2026-08-24T08:45:00.000Z",
          idempotent: false
        };
      }
    },
    kms: {
      async encrypt() {
        sensitiveBoundaryCalls += 1;
        throw new Error("unexpected_encrypt");
      },
      async decrypt() {
        sensitiveBoundaryCalls += 1;
        throw new Error("unexpected_decrypt");
      }
    },
    kmsKeyResource:
      "projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth",
    secrets: {
      async access() {
        sensitiveBoundaryCalls += 1;
        throw new Error("unexpected_secret_access");
      }
    },
    provider: {
      providerKey: "quickbooks_online",
      environment: "sandbox",
      async exchangeAuthorizationCode() {
        sensitiveBoundaryCalls += 1;
        throw new Error("unexpected_exchange");
      },
      async refreshCredential() {
        sensitiveBoundaryCalls += 1;
        throw new Error("unexpected_refresh");
      },
      async revokeCredential() {
        sensitiveBoundaryCalls += 1;
        throw new Error("unexpected_revoke");
      }
    }
  });

  const result = await broker.reclaimExpiredRefreshLease({
    workspaceId,
    businessEntityId,
    connectionId,
    connectionGeneration: 1,
    credentialId,
    expectedCredentialVersion: 1,
    expectedCredentialRowVersion: 2,
    providerKey: "quickbooks_online",
    providerEnvironment: "sandbox",
    requestId: "phase8b_expired_refresh_lease_reclamation"
  });
  equal(result.leaseState, "expired_reclaimed", "broker returns the explicit reclamation outcome");
  equal(result.accessExpired, true, "reclamation cannot make the access credential current");
  equal(result.credentialVersion, 1, "reclamation does not create credential V2");
  equal(result.credentialRowVersion, 3, "reclamation advances only the credential row CAS version");
  equal(calls.length, 1, "broker performs exactly one checked reclamation RPC");
  equal(
    calls[0].command.contractVersion,
    "integration_expired_refresh_lease_reclamation_v1",
    "broker uses the purpose-bound reclamation contract"
  );
  equal(calls[0].command.providerKey, "quickbooks_online", "broker preserves the trusted service provider scope");
  equal(calls[0].command.providerEnvironment, "sandbox", "broker preserves the trusted service environment scope");
  equal(
    calls[0].command.reasonCode,
    "refresh_lease_expired_reclaimed",
    "broker cannot fabricate a refresh-success or refresh-failure reason"
  );
  equal("leaseId" in calls[0].command, false, "caller cannot select or reuse a lease identifier");
  equal("reclaimedAt" in calls[0].command, false, "database wall-clock owns reclamation time");
  equal(sensitiveBoundaryCalls, 0, "reclamation performs no KMS, Secret Manager, token, or provider operation");
  throws(
    () => credentialContracts.ReclaimExpiredRefreshLeaseCommandSchema.parse({
      ...calls[0].command,
      connectionGeneration: 2
    }),
    /invalid/i,
    "reclamation cannot widen beyond generation one"
  );
}

async function runRefreshRotationCase(mode) {
  const now = new Date("2026-08-24T10:00:00.000Z");
  const scope = {
    workspaceId: id(8951),
    businessEntityId: id(8952),
    connectionId: id(8953),
    connectionGeneration: 1,
    credentialId: id(8954)
  };
  const priorRefreshToken = "phase8b-refresh-token-prior-0001";
  const rotatedRefreshToken = "phase8b-refresh-token-rotated-0002";
  const priorEnvelope = credentialContracts.CredentialEnvelopeSchema.parse({
    schemaVersion: "oauth_credential_envelope_v1",
    providerKey: "quickbooks_online",
    environment: "sandbox",
    externalAuthorizedEntityReference: provider.realmId,
    accessToken: "phase8b-access-token-prior-0001",
    accessExpiresAt: "2026-08-24T10:05:00.000Z",
    refreshToken: priorRefreshToken,
    refreshExpiresAt: "2026-11-22T10:00:00.000Z",
    grantedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
    issuedAt: "2026-08-24T09:00:00.000Z",
    updatedAt: "2026-08-24T09:30:00.000Z"
  });
  const aadContext = {
    schemaVersion: "oauth_credential_aad_v1",
    purpose: "provider_oauth_credential",
    environment: "sandbox",
    workspaceId: scope.workspaceId,
    connectionId: scope.connectionId,
    connectionGeneration: 1,
    providerKey: "quickbooks_online",
    credentialId: scope.credentialId
  };
  const calls = {
    encrypt: 0,
    rotate: [],
    failure: [],
    boundaries: [],
    encryptedPlaintext: null
  };
  const store = {
    async acquireRefreshLease(command) {
      return {
        acquired: true,
        credentialId: scope.credentialId,
        credentialVersion: 1,
        ciphertextBase64: Buffer.from("phase8b-ciphertext-v1", "utf8").toString("base64"),
        aadDigest: credentialKms.credentialAadDigest(aadContext),
        kmsKeyResource:
          "projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth",
        aadContext,
        providerEnvironment: "sandbox",
        grantedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
        leaseId: command.leaseId,
        leaseOwnerFingerprint: command.leaseOwnerFingerprint,
        leaseExpiresAt: command.leaseExpiresAt
      };
    },
    async rotateCredential(command) {
      calls.rotate.push(command);
      if (mode === "stale_cas") throw new Error("credential_version_stale");
      return {
        credentialId: scope.credentialId,
        credentialVersion: 2,
        credentialStatus: "active",
        connectionStatus: "initializing",
        idempotent: false
      };
    },
    async completeRefreshFailure(command) {
      calls.failure.push(command);
      if (mode === "stale_cas") throw new Error("credential_refresh_failure_stale");
      return {
        credentialId: scope.credentialId,
        credentialVersion: 1,
        credentialStatus: "active",
        connectionStatus: "initializing",
        idempotent: false
      };
    },
    async recordAuthorizationEvent() {},
    async recordRefreshBoundaryEvent(event) {
      calls.boundaries.push(event);
    }
  };
  const broker = new credentialBroker.IntegrationCredentialBroker({
    store,
    kms: {
      async decrypt() {
        return Buffer.from(canonical.canonicalContractJson(priorEnvelope), "utf8");
      },
      async encrypt(input) {
        calls.encrypt += 1;
        calls.encryptedPlaintext = Buffer.from(input.plaintext);
        return Buffer.from("phase8b-ciphertext-v2", "utf8");
      }
    },
    kmsKeyResource:
      "projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth",
    secrets: {
      async access() {
        return new secrets.ProviderApplicationSecret({
          schemaVersion: "provider_application_secret_v1",
          providerKey: "quickbooks_online",
          environment: "sandbox",
          clientId: "phase8b-development-client",
          clientSecret: "phase8b-refresh-client-secret-canary"
        });
      }
    },
    provider: {
      providerKey: "quickbooks_online",
      environment: "sandbox",
      refreshTokenRotationPolicy: "returned_token_authoritative",
      tokenType: "bearer",
      async refreshCredential() {
        const next = {
          ...priorEnvelope,
          accessToken: mode === "oversize"
            ? "a".repeat(16_384)
            : "phase8b-access-token-next-0002",
          accessExpiresAt: "2026-08-24T11:00:00.000Z",
          refreshToken: mode === "oversize"
            ? "b".repeat(16_384)
            : mode === "same"
              ? priorRefreshToken
              : rotatedRefreshToken,
          updatedAt: now.toISOString()
        };
        if (mode === "missing") delete next.refreshToken;
        return next;
      },
      async exchangeAuthorizationCode() {
        throw new Error("unexpected_exchange");
      },
      async revokeCredential() {
        throw new Error("unexpected_revoke");
      }
    },
    clock: () => now
  });
  const result = await broker.refreshCredential({
    ...scope,
    expectedCredentialVersion: 1,
    requiredScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
    workerId: `phase8b_refresh_${mode}`,
    acquireRequestId: `phase8b_refresh_${mode}_acquire`,
    rotateRequestId: `phase8b_refresh_${mode}_rotate`,
    failureRequestId: `phase8b_refresh_${mode}_failure`
  });
  return {
    result,
    calls,
    priorRefreshToken,
    rotatedRefreshToken,
    scope,
    aadContext,
    now
  };
}

async function testQboRefreshRotationPolicy() {
  equal(
    new phase8b.QboSandboxOAuthCredentialProvider({
      redirectUri: "https://phase8b.example.test/oauth/callback",
      transport: { async postForm() { throw new Error("unused"); } }
    }).refreshTokenRotationPolicy,
    "returned_token_authoritative",
    "QBO treats every returned schema-valid refresh token as authoritative"
  );

  for (const mode of ["same", "rotated"]) {
    const tested = await runRefreshRotationCase(mode);
    equal(tested.result.state, "refreshed", `${mode} refresh token completes the checked CAS path`);
    equal(tested.calls.encrypt, 1, `${mode} refresh token is encrypted exactly once`);
    equal(tested.calls.rotate.length, 1, `${mode} refresh token produces exactly one CAS rotation`);
    const persisted = credentialContracts.CredentialEnvelopeSchema.parse(
      JSON.parse(tested.calls.encryptedPlaintext.toString("utf8"))
    );
    equal(
      persisted.refreshToken,
      mode === "same" ? tested.priorRefreshToken : tested.rotatedRefreshToken,
      `${mode} provider response is the exact latest persisted refresh token`
    );
    const diagnostics = tested.calls.boundaries.find(
      (event) => event.stage === "credential_cas" && event.outcome === "started"
    ).diagnostics;
    equal(
      diagnostics.refreshTokenEqualToPrior,
      mode === "same",
      `${mode} refresh records only the redacted equality decision`
    );
    equal(diagnostics.returnedRefreshTokenPresent, true, "refresh diagnostics record token presence only");
    equal(diagnostics.scopeEquivalent, true, "refresh diagnostics retain exact scope equivalence");
    equal(diagnostics.tokenType, "bearer", "refresh diagnostics retain the validated token type");
    const auditText = JSON.stringify(tested.calls.boundaries);
    equal(auditText.includes(tested.priorRefreshToken), false, "refresh audit never retains prior token bytes");
    equal(auditText.includes(tested.rotatedRefreshToken), false, "refresh audit never retains returned token bytes");

    const persistedAt = new Date(tested.now.getTime() + 500);
    const rebaseExpiry = (expiresAt) => expiresAt === null
      ? null
      : new Date(
          persistedAt.getTime() +
            Date.parse(expiresAt) -
            Date.parse(persisted.updatedAt)
        ).toISOString();
    const readBroker = new credentialBroker.IntegrationCredentialBroker({
      store: {
        async readProviderCredential() {
          return {
            state: "available",
            credentialId: tested.scope.credentialId,
            credentialVersion: tested.result.credentialVersion,
            providerKey: "quickbooks_online",
            providerEnvironment: "sandbox",
            accessExpiresAt: rebaseExpiry(persisted.accessExpiresAt),
            ciphertextPersistedAt: persistedAt.toISOString(),
            refreshExpiresAt: rebaseExpiry(persisted.refreshExpiresAt),
            externalEntityReferenceFingerprint:
              tested.calls.rotate[0].externalEntityReferenceFingerprint,
            ciphertextBase64: tested.calls.rotate[0].ciphertextBase64,
            aadDigest: tested.calls.rotate[0].aadDigest,
            kmsKeyResource: tested.calls.rotate[0].kmsKeyResource,
            aadContext: tested.aadContext,
            grantedScopes: persisted.grantedScopes
          };
        }
      },
      kms: {
        async decrypt() {
          return Buffer.from(tested.calls.encryptedPlaintext);
        }
      },
      kmsKeyResource: tested.calls.rotate[0].kmsKeyResource,
      secrets: { async access() { throw new Error("unexpected_secret"); } },
      provider: {
        providerKey: "quickbooks_online",
        environment: "sandbox",
        async exchangeAuthorizationCode() { throw new Error("unexpected_exchange"); },
        async refreshCredential() { throw new Error("unexpected_refresh"); },
        async revokeCredential() { throw new Error("unexpected_revoke"); }
      },
      clock: () => tested.now
    });
    equal(
      (await readBroker.readProviderAccessCredential({
        taskId: id(mode === "same" ? 8961 : 8962),
        leaseId: id(mode === "same" ? 8963 : 8964),
        leaseOwnerFingerprint: fingerprint(`phase8b-${mode}-refresh-read`),
        expectedCredentialVersion: tested.result.credentialVersion,
        requiredScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
        minimumValiditySeconds: 300,
        requestId: `phase8b_${mode}_refresh_read`
      })).state,
      "available",
      `${mode} returned-token refresh remains readable after trusted-clock rebasing`
    );
  }

  const missing = await runRefreshRotationCase("missing");
  equal(missing.result.state, "retry_required", "missing refresh token fails the credential envelope contract");
  equal(missing.calls.encrypt, 0, "missing refresh token fails before KMS encrypt");
  equal(missing.calls.rotate.length, 0, "missing refresh token cannot reach credential CAS");

  const oversize = await runRefreshRotationCase("oversize");
  equal(oversize.result.state, "retry_required", "oversize canonical envelope fails closed");
  equal(oversize.calls.encrypt, 0, "oversize canonical envelope is rejected before KMS encrypt");
  equal(oversize.calls.rotate.length, 0, "oversize canonical envelope cannot reach credential CAS");
  ok(
    oversize.calls.boundaries.some(
      (event) => event.stage === "credential_cas" &&
        event.outcome === "failed" &&
        event.diagnostics?.envelopeByteLength >
          credentialContracts.PHASE_5_DIRECT_KMS_MAX_PLAINTEXT_BYTES
    ),
    "oversize rejection retains only bounded envelope-length diagnostics"
  );

  await rejects(
    () => runRefreshRotationCase("stale_cas"),
    /credential_refresh_failure_stale/,
    "stale credential CAS and stale failure ownership both fail closed"
  );
}

async function testCredentialReadDiagnostics() {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const realmId = "phase8b-read-diagnostic-realm";
  const aadContext = {
    schemaVersion: "oauth_credential_aad_v1",
    purpose: "provider_oauth_credential",
    environment: "sandbox",
    workspaceId: id(8971),
    connectionId: id(8972),
    connectionGeneration: 1,
    providerKey: "quickbooks_online",
    credentialId: id(8973)
  };
  const envelope = {
    schemaVersion: "oauth_credential_envelope_v1",
    providerKey: "quickbooks_online",
    environment: "sandbox",
    externalAuthorizedEntityReference: realmId,
    accessToken: credentialRedaction.PHASE_5_LEAKAGE_CANARIES.accessToken,
    accessExpiresAt: "2026-08-24T13:00:00.000Z",
    refreshToken: credentialRedaction.PHASE_5_LEAKAGE_CANARIES.refreshToken,
    refreshExpiresAt: "2026-11-22T12:00:00.000Z",
    grantedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
    issuedAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  const baseResult = {
    state: "available",
    credentialId: aadContext.credentialId,
    credentialVersion: 5,
    providerKey: "quickbooks_online",
    providerEnvironment: "sandbox",
    accessExpiresAt: "2026-08-24T13:00:01.000Z",
    ciphertextPersistedAt: "2026-08-24T12:00:01.000Z",
    refreshExpiresAt: "2026-11-22T12:00:01.000Z",
    externalEntityReferenceFingerprint: canonical.contractSha256({
      fingerprintPurpose: "provider_authorized_entity_reference",
      fingerprintVersion: "provider_authorized_entity_reference_fingerprint_v1",
      value: realmId
    }),
    ciphertextBase64: Buffer.from("phase8b-read-ciphertext", "utf8").toString("base64"),
    aadDigest: credentialKms.credentialAadDigest(aadContext),
    kmsKeyResource:
      "projects/vaeroex-intg-dev-9999/locations/us-west1/keyRings/phase8b/cryptoKeys/qbo-sandbox-oauth",
    aadContext,
    grantedScopes: [phase8b.QBO_ACCOUNTING_SCOPE]
  };
  const input = {
    taskId: id(8974),
    leaseId: id(8975),
    leaseOwnerFingerprint: fingerprint("phase8b-read-diagnostic-owner"),
    expectedCredentialVersion: 5,
    requiredScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
    minimumValiditySeconds: 300,
    requestId: "phase8b_read_diagnostic"
  };

  async function readWith(options = {}) {
    const broker = new credentialBroker.IntegrationCredentialBroker({
      store: {
        async readProviderCredential() {
          return { ...baseResult, ...options.result };
        }
      },
      kms: {
        async decrypt() {
          if (options.kmsFailure) throw new Error("kms_decrypt_failed");
          return Buffer.from(
            JSON.stringify(options.envelope ?? envelope),
            "utf8"
          );
        }
      },
      kmsKeyResource: baseResult.kmsKeyResource,
      secrets: { async access() { throw new Error("unexpected_secret"); } },
      provider: {
        providerKey: "quickbooks_online",
        environment: "sandbox",
        async exchangeAuthorizationCode() { throw new Error("unexpected_exchange"); },
        async refreshCredential() { throw new Error("unexpected_refresh"); },
        async revokeCredential() { throw new Error("unexpected_revoke"); }
      },
      clock: () => now
    });
    return broker.readProviderAccessCredential(input);
  }

  equal((await readWith()).state, "available", "canonical V5 envelope is readable after exact clock rebasing");
  const missingRefresh = { ...envelope };
  delete missingRefresh.refreshToken;
  const cases = [
    ["refresh_token_presence", { envelope: missingRefresh }],
    ["provider_key", { envelope: { ...envelope, providerKey: "synthetic" } }],
    ["provider_environment", { envelope: { ...envelope, environment: "test" } }],
    ["scope_shape", { envelope: { ...envelope, grantedScopes: ["openid"] } }],
    ["credential_binding", {
      result: { externalEntityReferenceFingerprint: fingerprint("wrong-realm") }
    }],
    ["expires_at_binding", {
      result: { accessExpiresAt: "2026-08-24T13:00:02.000Z" }
    }],
    ["kms_failure", { kmsFailure: true }],
    ["aad_binding", {
      result: { aadDigest: fingerprint("wrong-aad") }
    }],
    ["reader_contract", {
      result: { ciphertextPersistedAt: undefined }
    }]
  ];
  for (const [diagnosticClass, options] of cases) {
    const error = await readWith(options).catch((failure) => failure);
    equal(
      error.diagnosticClass,
      diagnosticClass,
      `${diagnosticClass} fails closed with only its bounded diagnostic class`
    );
    const diagnostic = JSON.stringify(error);
    equal(
      [
        ...Object.values(credentialRedaction.PHASE_5_LEAKAGE_CANARIES),
        realmId,
        "Authorization",
        "Bearer"
      ].some((secret) => diagnostic.includes(secret)),
      false,
      `${diagnosticClass} diagnostics contain no credential, realm, or authorization material`
    );
  }
}

async function testReadOnlyClient() {
  const accessCanary = "phase8b-provider-read-access-canary-0001";
  const calls = [];
  const transport = {
    async request(input) {
      calls.push(input);
      return {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({
          QueryResponse: {
            Invoice: [fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice]
          }
        }))
      };
    }
  };
  const client = new phase8b.QboSandboxReadOnlyClient({
    realmId: provider.realmId,
    transport
  });
  const page = await client.fetchEntityPage({
    recordType: "Invoice",
    startPosition: 1,
    maximumResults: 500,
    postingWindow: { startDate: "2026-01-01", endDate: "2026-12-31" },
    accessToken: accessCanary
  });
  equal(page.records.length, 1, "bounded query page returns one fixture record");
  equal(calls[0].method, "GET", "provider accounting request is GET-only");
  equal(new URL(calls[0].url).hostname, "sandbox-quickbooks.api.intuit.com", "egress uses sandbox host");
  equal(new URL(calls[0].url).pathname, `/v3/company/${provider.realmId}/query`, "egress path binds realm");
  equal(calls[0].url.includes(accessCanary), false, "access token never enters URL or task data");
  equal(calls[0].accessToken, accessCanary, "only transient access token reaches provider boundary");

  const exactDecimalClient = new phase8b.QboSandboxReadOnlyClient({
    realmId: provider.realmId,
    transport: {
      async request() {
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            '{"QueryResponse":{"Invoice":[{"Id":"exact-decimal","TotalAmt":123456789012345.123456789}]}}',
            "utf8"
          )
        };
      }
    }
  });
  const exactDecimalPage = await exactDecimalClient.fetchEntityPage({
    recordType: "Invoice",
    accessToken: accessCanary
  });
  equal(
    exactDecimalPage.records[0].TotalAmt,
    "123456789012345.123456789",
    "provider JSON preserves accounting decimal tokens exactly as strings"
  );

  const companyCalls = [];
  const companyClient = new phase8b.QboSandboxReadOnlyClient({
    realmId: provider.realmId,
    transport: {
      async request(input) {
        companyCalls.push(input);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({
            CompanyInfo: fixtures.QBO_SYNTHETIC_MASTER_FIXTURES.CompanyInfo
          }))
        };
      }
    }
  });
  const company = await companyClient.fetchCompanyInfo({ accessToken: accessCanary });
  equal(company.Id, "1", "company entity ID remains provider metadata, not tenant authority");
  equal(
    new URL(companyCalls[0].url).pathname,
    `/v3/company/${provider.realmId}/companyinfo/${provider.realmId}`,
    "company verification uses the exact read-only identity route"
  );
  equal(companyCalls[0].url.includes(accessCanary), false, "company identity URL excludes access credentials");

  const reportCalls = [];
  const reportClient = new phase8b.QboSandboxReadOnlyClient({
    realmId: provider.realmId,
    transport: {
      async request(input) {
        reportCalls.push(input);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from('{"Header":{"ReportName":"bounded-report"}}')
        };
      }
    }
  });
  for (const reportType of ["ProfitAndLoss", "BalanceSheet", "CashFlow", "TrialBalance"]) {
    await reportClient.fetchReport({
      reportType,
      startDate: "2026-01-01",
      endDate: "2026-08-22",
      accountingMethod: "Accrual",
      accessToken: accessCanary
    });
    const url = new URL(reportCalls.at(-1).url);
    deepEqual(
      [...url.searchParams.keys()].sort(),
      ["accounting_method", "end_date", "start_date"],
      `${reportType} uses only its bounded period parameters`
    );
    equal(url.searchParams.get("start_date"), "2026-01-01", `${reportType} has an exact start date`);
    equal(url.searchParams.get("end_date"), "2026-08-22", `${reportType} has an exact end date`);
  }
  for (const reportType of ["ARAgingSummary", "APAgingSummary"]) {
    await reportClient.fetchReport({
      reportType,
      startDate: "2026-01-01",
      endDate: "2026-08-22",
      accountingMethod: "Accrual",
      accessToken: accessCanary
    });
    const url = new URL(reportCalls.at(-1).url);
    deepEqual(
      [...url.searchParams.keys()],
      ["report_date"],
      `${reportType} uses only its point-in-time report date`
    );
    equal(url.searchParams.get("report_date"), "2026-08-22", `${reportType} has an exact report date`);
  }
  equal(
    reportCalls.every((call) => !call.url.includes(accessCanary)),
    true,
    "report URLs exclude access credentials"
  );

  const evidence = await new phase8b.QboSandboxCompanyVerifier({
    clientForRealm: () => companyClient
  }).verify({
    externalAuthorizedEntityReference: provider.realmId,
    credential: new (require("../lib/integrations/credentials/broker.ts").ProviderAccessCredential)({
      providerKey: "quickbooks_online",
      providerEnvironment: "sandbox",
      accessExpiresAt: "2026-08-22T13:00:00.000Z",
      grantedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
      accessToken: accessCanary
    })
  });
  equal(evidence.externalAuthorizedEntityReference, provider.realmId, "verified company evidence preserves realm identity");
  equal(evidence.providerEntityType, "company", "verified entity type is fixed");
  ok(evidence.verificationFingerprint.startsWith("sha256:"), "company evidence is fingerprinted");

  for (const denied of [
    { method: "POST", url: `${phase8b.QBO_SANDBOX_API_ORIGIN}/v3/company/${provider.realmId}/query?query=select+%2A+from+Invoice` },
    { method: "GET", url: `https://quickbooks.api.intuit.com/v3/company/${provider.realmId}/query?query=select+%2A+from+Invoice` },
    { method: "GET", url: `${phase8b.QBO_SANDBOX_API_ORIGIN}/v3/company/another-realm/query?query=select+%2A+from+Invoice` },
    { method: "GET", url: `${phase8b.QBO_SANDBOX_API_ORIGIN}/v3/company/${provider.realmId}/query?query=select+%2A+from+Invoice&unexpected=true` },
    { method: "GET", url: `${phase8b.QBO_SANDBOX_API_ORIGIN}/v3/company/${provider.realmId}/invoice` }
  ]) {
    throws(
      () => phase8b.assertQboSandboxRuntimeEgress({ ...denied, realmId: provider.realmId }),
      /denied|violation/,
      "runtime egress rejects method, production host, realm substitution, query injection, or write path"
    );
  }

  const limitedClient = new phase8b.QboSandboxReadOnlyClient({
    realmId: provider.realmId,
    transport: {
      async request() {
        return {
          status: 429,
          headers: { "retry-after": "7" },
          body: Buffer.from(JSON.stringify({ Fault: { Error: [{ code: "rate-limit-safe" }] }, secret: accessCanary }))
        };
      }
    }
  });
  await rejects(
    () => limitedClient.fetchEntityPage({ recordType: "Account", accessToken: accessCanary }),
    (error) => {
      equal(error.classification.kind, "rate_limit", "429 is classified without raw response material");
      equal(error.classification.retryAfterMs, 7_000, "Retry-After is preserved for durable scheduling");
      equal(error.message.includes(accessCanary), false, "provider error excludes token canary");
      return true;
    },
    "rate limits surface only safe retry metadata"
  );

  const cdcCalls = [];
  const cdcClient = new phase8b.QboSandboxReadOnlyClient({
    realmId: provider.realmId,
    transport: {
      async request(input) {
        cdcCalls.push(input);
        return {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from(JSON.stringify({
            CDCResponse: [{
              QueryResponse: {
                Invoice: [fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice]
              }
            }]
          }))
        };
      }
    }
  });
  const cdc = await cdcClient.fetchCdc({
    recordTypes: ["Invoice", "Account"],
    changedSince: "2026-08-21T12:00:00.000Z",
    accessToken: accessCanary
  });
  equal(cdc.observedObjectCount, 1, "CDC returns bounded approved-object changes");
  equal(new URL(cdcCalls[0].url).pathname, `/v3/company/${provider.realmId}/cdc`, "CDC uses the exact sandbox route");
  equal(new URL(cdcCalls[0].url).searchParams.get("entities"), "Invoice,Account", "CDC entities are explicit and allowlisted");
  equal(cdcCalls[0].url.includes(accessCanary), false, "CDC URL excludes access credentials");
  const densePartitions = qbo.bisectQboCdcEntityTypesIfDense({
    recordTypes: ["Invoice", "Account", "Item", "Payment"],
    observedObjectCount: 1_000
  });
  deepEqual(
    densePartitions,
    [["Invoice", "Account"], ["Item", "Payment"]],
    "dense CDC recovery bisects only the provider-supported entity list"
  );
  throws(
    () => qbo.bisectQboCdcEntityTypesIfDense({
      recordTypes: ["Invoice"],
      observedObjectCount: 1_000
    }),
    /full_reconciliation/,
    "a single capped entity fails closed for explicit full reconciliation"
  );
}

function sourceContext() {
  return {
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    connectionId: ids.connection,
    providerKey: "quickbooks_online",
    providerEnvironment: "sandbox"
  };
}

function validatedMasterSource(recordType, raw, seed) {
  const record = qbo.minimizeQboSourceRecord({ recordType, raw, provider });
  const pending = qbo.qboMinimizedRecordToExternalSourceVersion({
    context: sourceContext(),
    record,
    id: id(seed),
    immutableVersion: 1,
    priorVersionId: null,
    previousRecord: null,
    observedAt: at,
    synchronizedAt: at,
    ingestedAt: at,
    receivedAt: at
  });
  return phase8b.validatePendingQboSourceVersion({
    pendingVersion: pending,
    validatedVersionId: id(seed + 1),
    expectedRealmId: provider.realmId,
    validatedAt: "2026-08-22T12:00:01.000Z"
  }).version;
}

function testSourceValidationAndMapping() {
  const revenueAuthority = phase8b.deriveQboRevenueMappingAuthority({
    sourceVersions: [
      validatedMasterSource("Account", fixtures.QBO_SYNTHETIC_MASTER_FIXTURES.Account, 8040),
      validatedMasterSource("Item", fixtures.QBO_SYNTHETIC_MASTER_FIXTURES.Item, 8050)
    ],
    expectedRealmId: provider.realmId
  });
  equal(revenueAuthority.incomeAccountRefs[0], "401", "validated income-account authority is exact");
  equal(revenueAuthority.revenueItemRefs[0], "301", "validated item-to-income-account authority is exact");
  const minimizedInvoice = qbo.minimizeQboSourceRecord({
    recordType: "Invoice",
    raw: fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice,
    provider
  });
  const pending = qbo.qboMinimizedRecordToExternalSourceVersion({
    context: sourceContext(),
    record: minimizedInvoice,
    id: ids.sourcePending,
    immutableVersion: 1,
    priorVersionId: null,
    previousRecord: null,
    observedAt: at,
    synchronizedAt: at,
    ingestedAt: at,
    receivedAt: at
  });
  equal(pending.trust, "untrusted_external_input", "provider record is untrusted at ingress");
  equal(pending.validation.state, "pending", "provider record is pending at ingress");
  const preparedPending = serializers.prepareExternalSourceVersionCommit(pending);
  const validated = phase8b.validatePendingQboSourceVersion({
    pendingVersion: preparedPending.version,
    validatedVersionId: ids.sourceValidated,
    expectedRealmId: provider.realmId,
    validatedAt: "2026-08-22T12:00:01.000Z"
  });
  equal(validated.state, "valid", "deterministic contract and realm validation passes");
  equal(validated.version.priorVersionId, pending.id, "validation appends immutable lineage");
  equal(validated.version.immutableVersion, 2, "validation increments immutable version exactly once");
  equal(validated.version.changeKind, "unchanged", "validation promotion does not claim an economic change");
  equal(validated.version.validation.validatorVersion, phase8b.QBO_DETERMINISTIC_VALIDATOR_VERSION, "validator is versioned");

  const wrongRealm = phase8b.validatePendingQboSourceVersion({
    pendingVersion: preparedPending.version,
    validatedVersionId: id(8014),
    expectedRealmId: "different-sandbox-realm",
    validatedAt: "2026-08-22T12:00:01.000Z"
  });
  equal(wrongRealm.state, "quarantined", "realm substitution is quarantined");
  equal(wrongRealm.issues[0].code, "qbo_realm_binding_mismatch", "realm mismatch is explicit");

  const deletedRecord = {
    ...minimizedInvoice,
    active: false,
    status: "deleted",
    providerVersionReference: "9",
    metadata: { ...minimizedInvoice.metadata, syncToken: "9" }
  };
  const deletedPending = qbo.qboMinimizedRecordToExternalSourceVersion({
    context: sourceContext(),
    record: deletedRecord,
    id: id(8016),
    immutableVersion: 3,
    priorVersionId: validated.version.id,
    previousRecord: minimizedInvoice,
    observedAt: "2026-08-22T12:00:02.000Z",
    synchronizedAt: "2026-08-22T12:00:02.000Z",
    ingestedAt: "2026-08-22T12:00:02.000Z",
    receivedAt: "2026-08-22T12:00:02.000Z"
  });
  equal(deletedPending.normalizedProjection, null, "provider deletions persist no live projection");
  const deletedValidated = phase8b.validatePendingQboSourceVersion({
    pendingVersion: deletedPending,
    validatedVersionId: id(8017),
    expectedRealmId: provider.realmId,
    validatedAt: "2026-08-22T12:00:03.000Z"
  });
  equal(deletedValidated.state, "quarantined", "provider deletions fail closed for lineage review");
  equal(deletedValidated.version.changeKind, "deleted", "deletion validation appends immutable deletion lineage");
  equal(deletedValidated.version.immutableVersion, 4, "deletion validation advances immutable history");
  equal(
    deletedValidated.version.validation.issues[0].code,
    "qbo_deleted_source_requires_review",
    "deletion quarantine reason is explicit"
  );

  const mapped = phase8b.mapValidatedQboRevenueSource({
    sourceVersion: validated.version,
    sourceIdentityFingerprint: preparedPending.sourceIdentityFingerprint,
    reportingCurrency: "USD",
    accountingBasis: "accrual",
    revenueAuthority,
    mappedAt: "2026-08-22T12:00:02.000Z",
    identityForFact: (_key, ordinal) => ({ id: id(8100 + ordinal), immutableVersion: 1, priorVersionId: null }),
    representationIdForFact: (_key, ordinal) => id(8200 + ordinal)
  });
  equal(mapped.disposition, "mapped", "eligible sales detail maps deterministically");
  equal(mapped.candidates.length, 1, "only an approved sales line becomes a candidate");
  equal(mapped.candidates[0].fact.value.amount, "1250", "canonical decimal text is exact");
  equal(mapped.candidates[0].representation.economicIdentity.contributionFamilyKind, "additive_transaction", "transaction detail is additive");
  equal(mapped.candidates[0].representation.sourceClass, "connected_system", "provider source class is explicit");

  const unprovenAuthority = phase8b.deriveQboRevenueMappingAuthority({
    sourceVersions: [
      validatedMasterSource("Item", fixtures.QBO_SYNTHETIC_MASTER_FIXTURES.Item, 8060)
    ],
    expectedRealmId: provider.realmId
  });
  equal(
    phase8b.mapValidatedQboRevenueSource({
      sourceVersion: validated.version,
      sourceIdentityFingerprint: preparedPending.sourceIdentityFingerprint,
      reportingCurrency: "USD",
      accountingBasis: "accrual",
      revenueAuthority: unprovenAuthority,
      mappedAt: at,
      identityForFact: () => ({ id: id(8062), immutableVersion: 1, priorVersionId: null }),
      representationIdForFact: () => id(8063)
    }).disposition,
    "quarantined",
    "a sales line without validated income-account authority fails closed"
  );

  const payment = qbo.minimizeQboSourceRecord({
    recordType: "Payment",
    raw: fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Payment,
    provider
  });
  const paymentPending = qbo.qboMinimizedRecordToExternalSourceVersion({
    context: sourceContext(),
    record: payment,
    id: id(8030),
    immutableVersion: 1,
    priorVersionId: null,
    previousRecord: null,
    observedAt: at,
    synchronizedAt: at,
    ingestedAt: at,
    receivedAt: at
  });
  const paymentValidated = phase8b.validatePendingQboSourceVersion({
    pendingVersion: paymentPending,
    validatedVersionId: id(8031),
    expectedRealmId: provider.realmId,
    validatedAt: at
  });
  equal(
    phase8b.mapValidatedQboRevenueSource({
      sourceVersion: paymentValidated.version,
      sourceIdentityFingerprint: serializers.prepareExternalSourceVersionCommit(paymentPending).sourceIdentityFingerprint,
      reportingCurrency: "USD",
      accountingBasis: "accrual",
      revenueAuthority,
      mappedAt: at,
      identityForFact: () => ({ id: id(8032), immutableVersion: 1, priorVersionId: null }),
      representationIdForFact: () => id(8033)
    }).disposition,
    "not_applicable",
    "cash receipt does not double count invoice revenue"
  );

  const unsafeMagnitude = JSON.parse(JSON.stringify(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice));
  unsafeMagnitude.TotalAmt = "1000000000000000000000";
  unsafeMagnitude.Line[0].Amount = "1000000000000000000000";
  throws(
    () => qbo.minimizeQboSourceRecord({ recordType: "Invoice", raw: unsafeMagnitude, provider }),
    /TotalAmt|Amount/,
    "out-of-bounds accounting decimals reject before hashing"
  );

  const nativeDecimal = JSON.parse(JSON.stringify(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice));
  nativeDecimal.Line[0].Amount = 1250.25;
  throws(
    () => qbo.minimizeQboSourceRecord({ recordType: "Invoice", raw: nativeDecimal, provider }),
    /Amount/,
    "native non-integer accounting numbers are rejected before hashing"
  );

  const correctedRaw = JSON.parse(JSON.stringify(fixtures.QBO_SYNTHETIC_TRANSACTION_FIXTURES.Invoice));
  correctedRaw.SyncToken = "8";
  correctedRaw.TotalAmt = "1300.00";
  correctedRaw.Line[0].Amount = "1300.00";
  const correctedRecord = qbo.minimizeQboSourceRecord({
    recordType: "Invoice",
    raw: correctedRaw,
    provider
  });
  const correctedPending = qbo.qboMinimizedRecordToExternalSourceVersion({
    context: sourceContext(),
    record: correctedRecord,
    id: id(8070),
    immutableVersion: 3,
    priorVersionId: validated.version.id,
    previousRecord: minimizedInvoice,
    observedAt: "2026-08-22T12:05:00.000Z",
    synchronizedAt: "2026-08-22T12:05:00.000Z",
    ingestedAt: "2026-08-22T12:05:00.000Z",
    receivedAt: "2026-08-22T12:05:00.000Z"
  });
  const correctedPrepared = serializers.prepareExternalSourceVersionCommit(correctedPending);
  const correctedValidated = phase8b.validatePendingQboSourceVersion({
    pendingVersion: correctedPrepared.version,
    validatedVersionId: id(8071),
    expectedRealmId: provider.realmId,
    validatedAt: "2026-08-22T12:05:01.000Z"
  }).version;
  const correctedMapped = phase8b.mapValidatedQboRevenueSource({
    sourceVersion: correctedValidated,
    sourceIdentityFingerprint: correctedPrepared.sourceIdentityFingerprint,
    reportingCurrency: "USD",
    accountingBasis: "accrual",
    revenueAuthority,
    mappedAt: "2026-08-22T12:05:02.000Z",
    priorFactByKey: { [mapped.candidates[0].fact.factKey]: mapped.candidates[0].fact },
    identityForFact: () => ({
      id: id(8072),
      immutableVersion: 2,
      priorVersionId: mapped.candidates[0].fact.id
    }),
    representationIdForFact: () => id(8073)
  });
  equal(correctedMapped.candidates[0].fact.value.amount, "1300", "corrected exact value is canonical");
  equal(correctedMapped.candidates[0].representation.lineage.kind, "correction", "correction carries immutable fact lineage");

  const duplicateRepresentation = {
    ...mapped.candidates[0].representation,
    representationId: id(8074),
    sourceRecordVersionId: id(8079),
    sourceVersionFingerprint: fingerprint("phase8b-duplicate-source-version"),
    sourceIdentityFingerprint: fingerprint("phase8b-duplicate-source-identity"),
    sourceImmutableVersion: 1
  };
  const priorCase = reconciliation.classifyReconciliationCase({
    id: id(8075),
    policy: policy(),
    representations: [mapped.candidates[0].representation, duplicateRepresentation],
    classifiedAt: "2026-08-22T12:05:03.000Z"
  });
  const priorBatch = reconciliation.planFactContributionBatch({
    id: id(8076),
    reconciliationCase: priorCase,
    registryVersion: "financial_contribution_registry_v1",
    families: [family(ids.family, "additive_transaction")],
    priorEvents: [],
    plannedAt: "2026-08-22T12:05:04.000Z"
  });
  const correctionCase = reconciliation.classifyReconciliationCase({
    id: id(8077),
    policy: policy(),
    representations: [mapped.candidates[0].representation, correctedMapped.candidates[0].representation],
    classifiedAt: "2026-08-22T12:05:05.000Z"
  });
  const correctionBatch = reconciliation.planFactContributionBatch({
    id: id(8078),
    reconciliationCase: correctionCase,
    registryVersion: "financial_contribution_registry_v1",
    families: [family(ids.family, "additive_transaction")],
    priorEvents: priorBatch.events,
    plannedAt: "2026-08-22T12:05:06.000Z"
  });
  equal(correctionCase.classification, "source_correction", "explicit QBO lineage classifies as a correction");
  deepEqual(
    correctionBatch.events.map((event) => event.eventKind),
    ["retract", "establish"],
    "QBO correction retracts prior truth before establishing the immutable successor"
  );

  return { pending, validated: validated.version, preparedPending, mapped };
}

function testReportControl() {
  const report = qbo.parseQboReport({
    reportType: "ProfitAndLoss",
    raw: fixtures.QBO_SYNTHETIC_REPORT_FIXTURES.ProfitAndLoss,
    provider
  });
  equal(report.additive, false, "QBO reports remain non-additive controls");
  equal(phase8b.extractQboProfitAndLossIncomeControl(report), "1250", "P&L total income is exact");
  const pending = qbo.qboReportToExternalSourceVersion({
    context: sourceContext(),
    report,
    id: ids.reportPending,
    immutableVersion: 1,
    priorVersionId: null,
    observedAt: at,
    synchronizedAt: at,
    ingestedAt: at,
    receivedAt: at
  });
  equal(pending.validation.state, "pending", "report control first enters pending source authority");
  const replay = qbo.qboReportToExternalSourceVersion({
    context: sourceContext(),
    report,
    previousReport: report,
    id: id(8015),
    immutableVersion: 2,
    priorVersionId: pending.id,
    observedAt: "2026-08-22T12:01:00.000Z",
    synchronizedAt: "2026-08-22T12:01:00.000Z",
    ingestedAt: "2026-08-22T12:01:00.000Z",
    receivedAt: "2026-08-22T12:01:00.000Z"
  });
  equal(replay.changeKind, "unchanged", "identical report replay creates no new economic effect");
  const prepared = serializers.prepareExternalSourceVersionCommit(pending);
  const validated = phase8b.validatePendingQboSourceVersion({
    pendingVersion: prepared.version,
    validatedVersionId: ids.reportValidated,
    expectedRealmId: provider.realmId,
    validatedAt: "2026-08-22T12:00:01.000Z"
  });
  const mapped = phase8b.mapValidatedQboProfitAndLossControl({
    sourceVersion: validated.version,
    sourceIdentityFingerprint: prepared.sourceIdentityFingerprint,
    mappedAt: "2026-08-22T12:00:02.000Z",
    factIdentity: { id: id(8300), immutableVersion: 1, priorVersionId: null },
    representationId: id(8301)
  });
  equal(mapped.disposition, "mapped", "compatible P&L control maps deterministically");
  equal(mapped.candidate.representation.economicIdentity.contributionFamilyKind, "non_additive_control", "report control family is non-additive");
  equal(mapped.candidate.fact.sources[0].sourceRole, "control_observation", "report provenance is marked control-only");
  return mapped.candidate;
}

function policy() {
  const draft = {
    contractVersion: reconciliation.RECONCILIATION_CONTRACT_VERSIONS.sourceAuthorityPolicy,
    id: ids.policy,
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    policyVersion: "qbo_sandbox_source_authority_v1",
    domain: "posted_revenue",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null,
    conflictBehavior: "hold_all",
    rules: [{
      ruleId: "qbo_connected_source",
      ruleVersion: "qbo_connected_source_v1",
      domain: "posted_revenue",
      sourceClass: "connected_system",
      sourceAuthorityKey: "quickbooks_online",
      authorityRole: "authoritative",
      priority: 1
    }],
    decision: {
      authority: "customer_authorized_user",
      actorId: ids.user,
      decidedAt: at,
      reasonCodes: ["qbo_sandbox_connection_authorized"]
    }
  };
  return { ...draft, policyFingerprint: reconciliation.sourceAuthorityPolicyFingerprint(draft) };
}

function family(idValue, kind) {
  const control = kind === "non_additive_control";
  const draft = {
    contractVersion: reconciliation.RECONCILIATION_CONTRACT_VERSIONS.contributionFamily,
    id: idValue,
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    registryVersion: "financial_contribution_registry_v1",
    familyVersion: control ? "revenue_report_control_v1" : "revenue_transactions_v1",
    domain: "posted_revenue",
    familyKey: control ? "recognized_revenue_report_control" : "recognized_revenue_transactions",
    familyKind: kind,
    measureKey: "recognized_revenue",
    aggregateKey: "recognized_revenue_actual",
    allowedAccountingBases: ["accrual"],
    currencyMode: "required",
    effectiveFrom: "2026-01-01T00:00:00.000Z",
    effectiveTo: null
  };
  return { ...draft, familyFingerprint: reconciliation.contributionFamilyFingerprint(draft) };
}

function testReconciliationAndDeterministic(revenueCandidate, reportCandidate) {
  const compatibleControlRepresentation = {
    ...reportCandidate.representation,
    economicIdentity: {
      ...revenueCandidate.representation.economicIdentity,
      contributionFamilyKey: phase8b.QBO_REPORT_CONTROL_FAMILY_KEY,
      contributionFamilyKind: "non_additive_control",
      transactionIdentity: null
    }
  };
  const reconciliationCase = reconciliation.classifyReconciliationCase({
    id: ids.case,
    policy: policy(),
    representations: [revenueCandidate.representation, compatibleControlRepresentation],
    classifiedAt: "2026-08-22T12:00:03.000Z"
  });
  equal(reconciliationCase.classification, "control_observation_vs_additive_detail", "detail and report control are separated");
  const batch = reconciliation.planFactContributionBatch({
    id: ids.batch,
    reconciliationCase,
    registryVersion: "financial_contribution_registry_v1",
    families: [
      family(ids.family, "additive_transaction"),
      family(ids.controlFamily, "non_additive_control")
    ],
    priorEvents: [],
    plannedAt: "2026-08-22T12:00:04.000Z"
  });
  equal(batch.events.filter((event) => event.eventKind === "establish").length, 1, "one detail contribution is established");
  equal(batch.events.filter((event) => event.eventKind === "control_observation").length, 1, "one report control is retained separately");

  const establish = batch.events.find((event) => event.eventKind === "establish");
  const active = {
    id: id(8400),
    eventFingerprint: establish.eventFingerprint,
    sourceFactFingerprint: establish.canonicalFactFingerprint,
    workspaceId: establish.workspaceId,
    businessEntityId: establish.businessEntityId,
    contributionFamilyKey: establish.contributionFamily.familyKey,
    contributionFamilyKind: establish.contributionFamily.familyKind,
    measureKey: establish.contributionFamily.measureKey,
    aggregateKey: establish.contributionFamily.aggregateKey,
    valueCanonical: establish.value,
    economicDate: establish.effectiveTime.postingDate,
    periodStart: establish.effectiveTime.periodStart,
    periodEnd: establish.effectiveTime.periodEnd,
    dimensions: establish.dimensions,
    accountingBasis: establish.accountingBasis,
    currency: establish.currency,
    observationKind: "active_additive"
  };
  const full = deterministic.cleanFullRecompute({
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    contributions: [active],
    registry: deterministic.PHASE_3_DEPENDENCY_REGISTRY,
    asOfDate: "2026-08-22"
  });
  const revenue = full.snapshot.states.find((state) => state.nodeKey === "revenue");
  equal(revenue.valueCanonical, "1250", "report total is not added to transaction revenue");
  equal(revenue.supportingContributionCount, 1, "only detail supports the KPI");
  equal(deterministic.PHASE_3_MODEL_CALL_COUNT, 0, "Phase 3 shadow calculation makes zero model calls");

  const empty = deterministic.emptyDeterministicStateSnapshot({
    workspaceId: ids.workspace,
    businessEntityId: ids.entity
  });
  const equivalence = deterministic.runIncrementalFullEquivalence({
    prior: empty,
    contributions: [active],
    mutations: [{
      mutationKey: "qbo_initial_revenue_1",
      prior: null,
      next: active,
      causeContributionEventIds: [active.id]
    }],
    registry: deterministic.PHASE_3_DEPENDENCY_REGISTRY,
    asOfDate: "2026-08-22"
  });
  equal(equivalence.status, "completed", "incremental and clean QBO-derived truth are equivalent");
  equal(equivalence.modelCallCount, 0, "incremental QBO path uses zero model calls");
  equal(equivalence.safeSnapshot.watermark.stateFingerprint, full.snapshot.watermark.stateFingerprint, "shadow state matches clean oracle exactly");
}

function testMigrationBoundary() {
  const migration = read("supabase/migrations/20260823042718_external_integrations_phase_8b_qbo_sandbox_validation.sql");
  const scopedDispatchMigration = read(
    "supabase/migrations/20260823111004_scope_qbo_sandbox_dispatch_candidates.sql"
  );
  const scopedRecoveryMigration = read(
    "supabase/migrations/20260823113832_qbo_sandbox_scoped_dispatch_recovery.sql"
  );
  const scopedReservationMigration = read(
    "supabase/migrations/20260823115807_reserve_qbo_sandbox_scoped_dispatch.sql"
  );
  const scopedRunLockMigration = read(
    "supabase/migrations/20260823121454_qbo_sandbox_dispatch_run_lock.sql"
  );
  const credentialRecoveryMigration = read(
    "supabase/migrations/20260823205806_qbo_sandbox_credential_refresh_recovery.sql"
  );
  const reauthorizationMigration = read(
    "supabase/migrations/20260824071101_qbo_sandbox_same_generation_reauthorization.sql"
  );
  const leaseReclamationMigration = read(
    "supabase/migrations/20260824083917_qbo_sandbox_expired_refresh_lease_reclamation.sql"
  );
  const zeroBasedDeliveryMigration = read(
    "supabase/migrations/20260824193332_qbo_cloud_tasks_zero_based_delivery.sql"
  );
  const retryExecutionMigration = read(
    "supabase/migrations/20260824233000_qbo_retry_execution_and_reauthorization_recovery.sql"
  );
  const recoveryReauthorizationMigration = read(
    "supabase/migrations/20260825180000_qbo_reauthorization_required_lifecycle.sql"
  );
  const dispatchRetryLifecycleMigration = read(
    "supabase/migrations/20260825190000_qbo_scoped_dispatch_retry_lifecycle.sql"
  );
  const credentialBindingMigration = read(
    "supabase/migrations/20260826043610_qbo_credential_envelope_binding_convergence.sql"
  );
  const credentialBindingCanaryMigration = read(
    "supabase/migrations/20260826090000_qbo_credential_envelope_binding_incident_canary.sql"
  );
  const credentialLineageRecoveryMigration = read(
    "supabase/migrations/20260826120000_qbo_credential_lineage_incident_recovery.sql"
  );
  const credentialBindingCanaryTest = read(
    "supabase/tests/external_integrations_phase_8b_credential_binding_canary.test.sql"
  );
  const credentialLineageRecoveryTest = read(
    "supabase/tests/external_integrations_phase_8b_credential_lineage_recovery.test.sql"
  );
  const canaryProvisioning = read(
    "services/external-integrations-qbo-sandbox/ops/provision-qbo-canary.sh"
  );
  const service = read("services/external-integrations-qbo-sandbox/src/server.ts");
  const credentialBrokerSource = read("lib/integrations/credentials/broker.ts");
  const credentialRepositorySource = read(
    "lib/integrations/persistence/credential-repository.ts"
  );
  const deliveryParser = read(
    "services/external-integrations-qbo-sandbox/src/cloud-task-delivery.ts"
  );
  const database = read("services/external-integrations-qbo-sandbox/src/database.ts");
  const google = read("services/external-integrations-qbo-sandbox/src/google.ts");
  ok(/create role integration_provider_validation_authority nologin noinherit/.test(migration), "validation authority is NOLOGIN/NOINHERIT");
  ok(/perform private\.assert_integration_provider_source_authority_v1\(\)/.test(migration), "source-state read retains provider-source authority");
  ok(/perform private\.assert_integration_provider_validation_authority_v1\(\)/.test(migration), "validation append uses distinct authority");
  ok(/v_pending\.validation_state <> 'pending'/.test(migration), "only pending source versions can be validated");
  ok(/case when v_pending\.change_kind = 'deleted' then 'deleted'/.test(migration), "validation preserves deletion lineage while normal promotions remain unchanged");
  ok(/v_pending\.source_fingerprint <>/.test(migration), "pending fingerprint is compare-and-swap bound");
  ok(/v_source\.current_version_id <> v_pending\.id/.test(migration), "stale validation workers fail closed");
  ok(/grant execute[\s\S]+validate_provider_external_source_record_version_v1[\s\S]+to integration_provider_validation_authority/.test(migration), "only validation authority receives validation RPC");
  ok(!/grant integration_provider_validation_authority\s+to service_role/i.test(migration), "service_role receives no validation shortcut");
  ok(!/grant (?:select|insert|update|delete|all)[\s\S]{0,120}integration_provider_validation_authority/i.test(migration), "validation role receives no table DML");
  ok(!/canonical_business_fact|fact_contribution|deterministic_node_state/.test(migration), "validation migration cannot write facts, contributions, or KPI state");
  ok(/read_qbo_sandbox_pending_source_versions_v1/.test(migration), "pending minimized sources have a checked validation work feed");
  ok(/read_qbo_sandbox_current_valid_source_versions_v1/.test(migration), "later CDC batches can read current validated mapping authority without private table access");
  ok(/credentialId[\s\S]+credentialVersion/.test(migration), "runtime delivery derives the safe current credential identity/version");
  ok(/integration_provider_validation_authority[\s\S]+read_qbo_sandbox_pending_source_versions_v1/.test(migration), "pending work feed remains validation-authority only");
  ok(/complete_qbo_sandbox_runtime_task_v1[\s\S]+v_child\.parent_task_id <> v_parent\.id/.test(migration), "page continuation is database-derived from its completed parent");
  ok(/grant execute on function public\.complete_qbo_sandbox_runtime_task_v1[\s\S]+to integration_provider_runtime_authority/.test(migration), "only provider runtime can atomically complete and continue QBO work");
  ok(/read_qbo_sandbox_dispatch_candidates_v1[\s\S]+provider_environment = 'sandbox'/.test(migration), "legacy dispatch discovery remains QBO sandbox-only before its authority is revoked");
  ok(/read_qbo_sandbox_scoped_dispatch_candidates_v1/.test(scopedDispatchMigration), "forward-only migration adds scoped QBO dispatch discovery");
  ok(/task\.workspace_id = v_workspace_id[\s\S]+task\.business_entity_id = v_business_entity_id[\s\S]+task\.connection_id = v_connection_id[\s\S]+task\.connection_generation = v_connection_generation/.test(scopedDispatchMigration), "database discovery enforces all trusted scope dimensions before returning tasks");
  ok(/inner join private\.integration_sync_runs[\s\S]+run\.state in \('created', 'running'\)/.test(scopedDispatchMigration), "scoped discovery preserves live run linkage");
  ok(/revoke all on function public\.read_qbo_sandbox_dispatch_candidates_v1\(integer\)[\s\S]+from integration_task_dispatch_authority/.test(scopedDispatchMigration), "dispatcher authority loses global discovery execution");
  ok(/grant execute on function public\.read_qbo_sandbox_scoped_dispatch_candidates_v1\(jsonb\)[\s\S]+to integration_task_dispatch_authority/.test(scopedDispatchMigration), "only dispatcher authority receives scoped discovery execution");
  ok(!/grant integration_task_dispatch_authority\s+to service_role/i.test(scopedDispatchMigration), "service_role receives no dispatcher shortcut");
  ok(/create role integration_task_scheduler_authority nologin noinherit/.test(scopedRecoveryMigration), "global scheduler authority is NOLOGIN/NOINHERIT");
  ok(/revoke all on function public\.discover_integration_sync_dispatch_v1\(text, integer\)[\s\S]+from integration_task_dispatch_authority/.test(scopedRecoveryMigration), "dispatcher loses generic global task discovery");
  ok(/revoke all on function public\.discover_integration_sync_due_work_v1\(timestamptz, integer\)[\s\S]+from integration_task_dispatch_authority/.test(scopedRecoveryMigration), "dispatcher loses generic global due-work discovery");
  ok(/revoke all on function public\.sweep_integration_sync_tasks_v1\(integer, text, text\)[\s\S]+from integration_task_dispatch_authority/.test(scopedRecoveryMigration), "dispatcher loses generic global task recovery");
  ok(/sweep_qbo_sandbox_scoped_dispatch_tasks_v1/.test(scopedRecoveryMigration), "forward-only migration adds scoped QBO retry recovery");
  ok(/task\.workspace_id = v_workspace_id[\s\S]+task\.business_entity_id = v_business_entity_id[\s\S]+task\.connection_id = v_connection_id[\s\S]+task\.connection_generation = v_connection_generation/.test(scopedRecoveryMigration), "database recovery enforces all trusted scope dimensions");
  ok(/grant execute on function public\.sweep_qbo_sandbox_scoped_dispatch_tasks_v1[\s\S]+to integration_task_dispatch_authority/.test(scopedRecoveryMigration), "dispatcher receives only scoped QBO recovery authority");
  ok(!/grant integration_task_scheduler_authority\s+to service_role/i.test(scopedRecoveryMigration), "service_role receives no scheduler shortcut");
  ok(/reserve_qbo_sandbox_scoped_dispatch_task_v1/.test(scopedReservationMigration), "forward-only migration adds pre-enqueue scoped reservation");
  ok(/select connection\.\* into v_connection[\s\S]+connection\.workspace_id = \(p_command ->> 'workspaceId'\)::uuid[\s\S]+connection\.connection_generation =[\s\S]+\(p_command ->> 'connectionGeneration'\)::bigint[\s\S]+for share/.test(scopedReservationMigration), "reservation locks and validates the current configured connection generation");
  ok(/select task\.\* into v_task[\s\S]+task\.workspace_id = v_connection\.workspace_id[\s\S]+task\.business_entity_id = v_connection\.business_entity_id[\s\S]+task\.connection_id = v_connection\.id[\s\S]+task\.connection_generation = v_connection\.connection_generation/.test(scopedReservationMigration), "reservation derives task authority from the locked connection scope");
  ok(/run\.state in \('created', 'running'\)/.test(scopedReservationMigration), "reservation requires current live run linkage");
  ok(/dispatcherTaskName' !~ '\^\[a-f0-9\]\{64\}\$'/.test(scopedReservationMigration), "reservation persists the exact Cloud Tasks short delivery identity");
  ok(/grant execute on function public\.reserve_qbo_sandbox_scoped_dispatch_task_v1[\s\S]+to integration_task_dispatch_authority/.test(scopedReservationMigration), "only dispatcher authority receives scoped reservation execution");
  ok(!/grant integration_task_dispatch_authority\s+to service_role/i.test(scopedReservationMigration), "service_role receives no scoped reservation shortcut");
  const connectionLockIndex = scopedRunLockMigration.indexOf(
    "select connection.* into v_connection"
  );
  const runLockIndex = scopedRunLockMigration.indexOf(
    "select run.* into v_run"
  );
  const taskLockIndex = scopedRunLockMigration.indexOf(
    "select task.* into v_task"
  );
  ok(
    connectionLockIndex >= 0 &&
      runLockIndex > connectionLockIndex &&
      taskLockIndex > runLockIndex,
    "reservation acquires scoped connection, run, and task locks in order"
  );
  ok(
    /run\.state in \('created', 'running'\)[\s\S]+for share of run/.test(
      scopedRunLockMigration
    ),
    "reservation holds the live run decision through transaction completion"
  );
  ok(
    /task\.sync_run_id = v_run\.id[\s\S]+for update/.test(
      scopedRunLockMigration
    ),
    "task reservation revalidates the locked run linkage before compare-and-swap"
  );
  ok(
    /grant execute on function public\.reserve_qbo_sandbox_scoped_dispatch_task_v1[\s\S]+to integration_task_dispatch_authority/.test(
      scopedRunLockMigration
    ) &&
      !/grant integration_task_dispatch_authority\s+to service_role/i.test(
        scopedRunLockMigration
      ),
    "run-lock correction preserves dispatcher-only RPC execution"
  );
  const globalSweepCorrection = dispatchRetryLifecycleMigration.slice(
    dispatchRetryLifecycleMigration.indexOf(
      "create or replace function public.sweep_integration_sync_tasks_v1"
    ),
    dispatchRetryLifecycleMigration.indexOf(
      "create or replace function public.sweep_qbo_sandbox_scoped_dispatch_tasks_v1"
    )
  );
  const scopedSweepCorrection = dispatchRetryLifecycleMigration.slice(
    dispatchRetryLifecycleMigration.indexOf(
      "create or replace function public.sweep_qbo_sandbox_scoped_dispatch_tasks_v1"
    ),
    dispatchRetryLifecycleMigration.indexOf(
      "create or replace function public.promote_qbo_sandbox_due_retry_tasks_v1"
    )
  );
  ok(
    !/15 minutes|task\.state = 'dispatched'[\s\S]+task\.updated_at/.test(
      globalSweepCorrection
    ) &&
      !/15 minutes|task\.state = 'dispatched'[\s\S]+task\.updated_at/.test(
        scopedSweepCorrection
      ),
    "global and scoped sweeps eliminate age-only dispatched recovery"
  );
  ok(
    /task\.state = 'retry_wait'[\s\S]+task\.available_at <= v_now/.test(
      globalSweepCorrection
    ) &&
      !/task\.state = 'retry_wait'[\s\S]+task\.available_at <= v_now/.test(
        scopedSweepCorrection
      ),
    "generic scheduling remains compatible while scoped retry promotion is separated"
  );
  ok(
    /create or replace function public\.promote_qbo_sandbox_due_retry_tasks_v1[\s\S]+qbo_sandbox_due_retry_promotion_v1/.test(
      dispatchRetryLifecycleMigration
    ),
    "forward migration adds a distinct scoped due-retry scheduling contract"
  );
  ok(
    /select connection\.\* into v_connection[\s\S]+for share[\s\S]+perform run\.id[\s\S]+for share[\s\S]+for update of task skip locked/.test(
      dispatchRetryLifecycleMigration
    ),
    "due-retry promotion locks connection, live runs, and tasks in canonical order"
  );
  ok(
    /task\.state = 'retry_wait'[\s\S]+task\.available_at <= v_now[\s\S]+set[\s\S]+state = 'pending'/.test(
      dispatchRetryLifecycleMigration
    ),
    "only due retry_wait work is promoted through the existing state graph"
  );
  ok(
    /grant execute on function public\.promote_qbo_sandbox_due_retry_tasks_v1[\s\S]+to integration_task_dispatch_authority/.test(
      dispatchRetryLifecycleMigration
    ) &&
      !/grant integration_task_dispatch_authority\s+to service_role/i.test(
        dispatchRetryLifecycleMigration
      ),
    "retry promotion remains dispatcher-only with no service_role shortcut"
  );
  ok(/qbo_phase_8b_realm_fingerprint_v1/.test(migration) && /qbo_provider_source_realm_binding_denied/.test(migration), "provider source persistence is bound to the trusted mapping realm fingerprint");
  ok(/p_dispatcher_task_name !~ '\^\[a-f0-9\]\{64\}\$'/.test(migration), "runtime delivery accepts only the Cloud Tasks short task identifier");
  ok(/read_qbo_sandbox_authorization_recovery_v1[\s\S]+assert_integration_credential_broker_authority_v1/.test(migration), "authorization recovery is constrained to credential-broker authority");
  ok(/grant execute on function public\.read_qbo_sandbox_authorization_recovery_v1\(jsonb\)[\s\S]+to integration_credential_broker_authority/.test(migration), "only the credential broker can read resumable ciphertext state");
  ok(/consume_integration_oauth_state_v2[\s\S]+state\.consumed_at[\s\S]+'consumedAt'/.test(migration), "credential issuance receives the database-authoritative state consumption time");
  ok(/grant execute on function public\.consume_integration_oauth_state_v2\(jsonb, text\)[\s\S]+to integration_oauth_ingress_authority/.test(migration), "only OAuth ingress authority receives the timestamp-bound consume RPC");
  ok(/acquire_integration_credential_refresh_lease_v2[\s\S]+translate\(v_result ->> 'ciphertextBase64', E'\\n\\r', ''\)/.test(credentialRecoveryMigration), "refresh lease V2 canonicalizes database base64 before strict parsing");
  ok(/read_integration_provider_credential_v2[\s\S]+translate\(v_result ->> 'ciphertextBase64', E'\\n\\r', ''\)/.test(credentialRecoveryMigration), "provider read V2 canonicalizes database base64 before strict parsing");
  ok(/record_integration_credential_refresh_boundary_v1/.test(credentialRecoveryMigration), "redacted refresh stage boundaries are append-only audit RPCs");
  ok(/integration_sync_task_recovery_events[\s\S]+enable row level security[\s\S]+force row level security/.test(credentialRecoveryMigration), "terminal recovery evidence is private with forced RLS");
  ok(/recover_qbo_sandbox_expired_credential_tasks_v1[\s\S]+failure_category = 'contract'[\s\S]+failure_code = 'phase8b_provider_task_failed'/.test(credentialRecoveryMigration), "recovery admits only the evidenced legacy credential-expiry terminal shape");
  ok(/credential_provider_read'[\s\S]+credential_expired/.test(credentialRecoveryMigration), "recovery requires matching expired-credential read evidence");
  ok(/integration_sync_task\.credential_recover/.test(credentialRecoveryMigration), "recovery preserves append-only task audit lineage");
  ok(/grant execute on function public\.recover_qbo_sandbox_expired_credential_tasks_v1[\s\S]+to integration_credential_broker_authority/.test(credentialRecoveryMigration), "only credential-broker authority receives the recovery RPC");
  ok(!/grant (?:execute|integration_credential_broker_authority)[\s\S]{0,100}to service_role/i.test(credentialRecoveryMigration), "service_role receives no credential recovery shortcut");
  ok(/create table private\.integration_reauthorization_states/.test(reauthorizationMigration), "reauthorization uses distinct private state persistence");
  ok(/integration_reauthorization_state_v1/.test(reauthorizationMigration) && /integration_credential_reauthorization_v1/.test(reauthorizationMigration), "state and credential replacement contracts are independently versioned");
  ok(/redirect_uri =\s*'https:\/\/p8b-oauth-34-120-247-116\.sslip\.io\/oauth\/callback'/.test(reauthorizationMigration), "database state pins the approved Development callback edge");
  ok(/connection\.status <> 'initializing'[\s\S]+connection\.state_reason_code <> 'initial_sync_pending'/.test(reauthorizationMigration), "only the approved initializing recovery lifecycle can create state");
  ok(/credential\.status = 'active'[\s\S]+credential\.access_expires_at <= pg_catalog\.transaction_timestamp\(\)[\s\S]+integration_sync_task_recovery_events/.test(reauthorizationMigration), "state creation derives an expired active credential and recovery evidence");
  ok(/expected_connection_row_version[\s\S]+v_connection\.row_version/.test(reauthorizationMigration), "state captures the database-authoritative connection row version");
  ok(!/create_integration_reauthorization_state_v1[\s\S]{0,2500}'expectedConnectionRowVersion'/.test(reauthorizationMigration), "state creation accepts no caller-selected row version");
  ok(/set status = 'superseded'[\s\S]+insert into private\.integration_credentials/.test(reauthorizationMigration), "replacement atomically supersedes then appends without overwriting ciphertext");
  ok(/integration_credentials_current_scope_key[\s\S]+where status in \('active', 'reauthorization_required'\)/.test(reauthorizationMigration), "database enforces one authoritative credential per connection generation");
  ok(/v_mapping\.provider_entity_reference_fingerprint <>[\s\S]+v_state\.provider_entity_reference_fingerprint/.test(reauthorizationMigration), "completion fails closed on any realm mapping mismatch");
  ok(/read_integration_provider_credential_v3[\s\S]+credential\.status = 'active'/.test(reauthorizationMigration), "provider reads select only the authoritative active credential");
  ok(/integration_credentials_current_scope_key[\s\S]+where status in \('active', 'reauthorization_required'\)/.test(reauthorizationMigration), "one partial unique index makes current credential authority deterministic per tenant scope");
  ok(/read_integration_provider_credential_v4[\s\S]+read_integration_provider_credential_v3/.test(credentialBindingMigration), "credential read V4 inherits the complete task, tenant, lease, and active-row authority check");
  ok(/credential\.status = 'active'[\s\S]+credential\.credential_ciphertext is not null[\s\S]+for share/.test(credentialBindingMigration), "credential read V4 rechecks the exact returned active version under a shared lock");
  ok(/v_created_credential_version[\s\S]+v_rotation_evidence_count <> 0[\s\S]+v_rotation_evidence_count <> 1/.test(credentialBindingMigration), "credential read V4 uses creation time only for an unrotated row and requires exactly one immutable event for the current refreshed version");
  ok(/ciphertextPersistedAt[\s\S]+refreshExpiresAt[\s\S]+externalEntityReferenceFingerprint/.test(credentialBindingMigration), "credential read V4 returns only the trusted non-secret binding metadata needed for exact validation");
  ok(/grant execute on function public\.read_integration_provider_credential_v4\(jsonb, text\)[\s\S]+to integration_credential_broker_authority/.test(credentialBindingMigration), "only credential-broker authority receives the converged read RPC");
  ok(!/grant (?:execute|integration_credential_broker_authority)[\s\S]{0,100}to service_role/i.test(credentialBindingMigration), "service_role receives no converged credential-read shortcut");
  ok(!/(?:create or replace|drop) function public\.read_integration_provider_credential_v[123]/.test(credentialBindingMigration), "forward convergence leaves all historical credential-read definitions unchanged");
  ok(/read_integration_provider_credential_v4/.test(credentialRepositorySource) && !/read_integration_provider_credential_v[123]/.test(credentialRepositorySource), "runtime persistence uses only the converged V4 credential read");
  ok(/databaseAccessLifetime !== envelopeAccessLifetime[\s\S]+databaseRefreshLifetime !== envelopeRefreshLifetime/.test(credentialBrokerSource), "broker validates exact access and refresh lifetimes across trusted-clock rebasing");
  ok(/externalEntityReferenceFingerprint[\s\S]+credential_binding/.test(credentialBrokerSource), "broker binds the decrypted realm reference to its persisted fingerprint");
  ok(/ProviderCredentialReadFailure[\s\S]+diagnosticClass/.test(credentialBrokerSource) && /safeEvent\("credential_read_failed"[\s\S]+diagnosticClass/.test(service), "credential read failures retain only a bounded non-secret diagnostic class");
  ok(/create role integration_qbo_canary_dispatch_authority nologin noinherit/.test(credentialBindingCanaryMigration), "canary dispatch authority is NOLOGIN/NOINHERIT");
  ok(/integration_sync_task_credential_binding_recovery_events[\s\S]+enable row level security[\s\S]+force row level security/.test(credentialBindingCanaryMigration), "incident recovery evidence is private with forced RLS");
  ok(/qbo_sandbox_credential_envelope_binding_incident_recovery_v1/.test(credentialBindingCanaryMigration), "credential-envelope-binding recovery has a distinct incident contract");
  ok(!/integration_sync_task_credential_binding_recovery_scope_key/.test(credentialBindingCanaryMigration), "incident recovery remains one-time per task without stranding other incident tasks in the same scope");
  ok(/qbo_sandbox_expired_credential_recovery_v1[\s\S]+recovered_at < v_task\.completed_at/.test(credentialBindingCanaryMigration), "incident recovery requires preserved earlier expired-credential recovery lineage");
  ok(/failureAuditEventId[\s\S]+integration_sync_task\.fail[\s\S]+audit\.occurred_at = v_task\.completed_at/.test(credentialBindingCanaryMigration), "incident recovery binds the exact latest terminal failure audit");
  ok(/credentialReadAuditEventId[\s\S]+credential_provider_read[\s\S]+audit\.outcome = 'allowed'[\s\S]+audit\.metadata ->> 'task_state' = 'leased'/.test(credentialBindingCanaryMigration), "incident recovery requires the exact leased credential-read boundary");
  ok(/diagnosticClass'[\s\S]+expires_at_binding[\s\S]+externalEvidenceFingerprint/.test(credentialBindingCanaryMigration), "incident recovery accepts only redacted expires-at-binding evidence");
  ok(/integration_sync_task\.complete[\s\S]+external_source_record_versions[\s\S]+qbo_sandbox_credential_binding_incident_recovery_effect_denied/.test(credentialBindingCanaryMigration), "completed provider effects or source versions deny recovery");
  ok(/reason_code in \('invalid_grant', 'provider_revoked'\)[\s\S]+qbo_sandbox_credential_binding_incident_recovery_revoked/.test(credentialBindingCanaryMigration), "invalid-grant and provider-revoked evidence deny incident recovery");
  ok(/v_task\.state <> 'failed'[\s\S]+v_task\.row_version <>[\s\S]+v_task\.dispatch_generation <>/.test(credentialBindingCanaryMigration), "incident recovery requires exact failed task CAS and dispatch generation");
  ok(/v_credential\.status <> 'active'[\s\S]+array\['com\.intuit\.quickbooks\.accounting'\][\s\S]+v_credential\.refresh_lease_id is not null/.test(credentialBindingCanaryMigration), "incident recovery requires exact lease-free active QBO accounting credential authority");
  ok(/pg_advisory_xact_lock[\s\S]+integration_sync_task_credential_binding_recovery_events[\s\S]+'idempotent', true/.test(credentialBindingCanaryMigration), "incident recovery serializes before immutable idempotency evidence");
  ok(/state = 'retry_wait'[\s\S]+failure_category = null[\s\S]+completed_at = null[\s\S]+row_version = task\.row_version \+ 1/.test(credentialBindingCanaryMigration), "incident recovery uses only the checked failed-to-retry_wait transition");
  ok(/grant execute on function[\s\S]+recover_qbo_sandbox_credential_binding_incident_task_v1[\s\S]+to integration_credential_broker_authority/.test(credentialBindingCanaryMigration), "only credential-broker authority receives incident recovery execution");
  ok(!/grant integration_(?:credential_broker|qbo_canary_dispatch)_authority\s+to service_role/i.test(credentialBindingCanaryMigration), "service_role receives no incident recovery or canary shortcut");
  equal((credentialBindingCanaryMigration.match(/p_command ->> 'maximumTasks' <> '1'/g) || []).length, 2, "canary promotion and discovery both require maximumTasks exactly one");
  equal((credentialBindingCanaryMigration.match(/task\.stream_key = 'company_info'/g) || []).length >= 3, true, "promotion, discovery, and reservation remain company_info-only");
  ok(/read_qbo_sandbox_canary_dispatch_candidate_v1[\s\S]+task\.id = \(p_command ->> 'taskId'\)::uuid[\s\S]+integration_sync_task_credential_binding_recovery_events/.test(credentialBindingCanaryMigration), "canary discovery requires both exact task identity and immutable incident recovery evidence");
  ok(/task\.state = 'dispatched'[\s\S]+phase8b_qbo_canary_cloud_task_v1:[\s\S]+candidate_row_version[\s\S]+candidate_dispatch_generation/.test(credentialBindingCanaryMigration), "reserved canary discovery reconstructs only the same deterministic pre-enqueue identity");
  ok(/grant execute on function public\.read_qbo_sandbox_canary_dispatch_candidate_v1[\s\S]+to integration_qbo_canary_dispatch_authority/.test(credentialBindingCanaryMigration), "only canary authority receives exact discovery execution");
  ok(/revoke execute on function public\.read_qbo_sandbox_scoped_dispatch_candidates_v1[\s\S]+revoke execute on function public\.sweep_integration_sync_tasks_v1/.test(credentialBindingCanaryMigration), "canary authority has no global or ordinary scoped discovery and recovery surface");
  ok(/url\.pathname === "\/tasks\/recover-credential-binding-incident"[\s\S]+scope\.workspaceId[\s\S]+scope\.businessEntityId[\s\S]+scope\.connectionId/.test(service), "incident recovery derives tenant scope from trusted broker configuration");
  ok(/task_canary_dispatcher[\s\S]+integration_qbo_canary_dispatch_authority/.test(service), "canary service mode has only the narrow database authority");
  ok(/QBO_CANARY_QUEUE_NAME = "p8b-qbo-canary"[\s\S]+queueName !== QBO_CANARY_QUEUE_NAME/.test(service), "canary dispatcher is bound to the exact canary queue");
  ok(/PHASE8B_CANARY_TASK_ID[\s\S]+UuidSchema\.parse\(config\.canaryTaskId\)/.test(service), "canary task identity comes only from trusted service configuration");
  const canaryHandler = service.slice(
    service.indexOf("async function handleCanaryTaskDispatcher"),
    service.indexOf("async function executeProviderTask")
  );
  ok(!/readQboSandboxScopedDispatchCandidates|sweepQboSandboxScopedDispatchTasks|promoteQboSandboxDueRetryTasks/.test(canaryHandler), "canary dispatcher cannot fall back to ordinary scope-wide discovery or recovery");
  ok(/candidate\.taskId !== canaryTaskId \|\| candidate\.streamKey !== "company_info"/.test(canaryHandler), "canary dispatcher rejects any candidate other than the configured company_info task");
  ok(canaryHandler.indexOf("reserveQboSandboxCanaryDispatchTask(") < canaryHandler.indexOf("googleCreateCloudTask({"), "canary reservation is durable before external enqueue");
  ok(/maximumTasks: z\.literal\(1\)/.test(service), "canary dispatcher accepts no batch size other than one");
  ok(/modelCallCount: 0[\s\S]+promotionAuthorized: false|promotionAuthorized: false[\s\S]+modelCallCount: 0/.test(canaryHandler), "canary dispatch preserves zero model calls and no promotion authority");
  ok(/PROJECT_ID="vaeroex-p8b-20260823-84b2f0"/.test(canaryProvisioning), "canary provisioning is pinned to the disposable Phase 8B project");
  ok(/CANARY_TASK_ID="edb562b4-11fa-4bc4-93ea-2bb50e4d7f15"/.test(canaryProvisioning), "canary provisioning pins the reviewed company_info task");
  ok(/MAIN_QUEUE_STATE[\s\S]+PAUSED[\s\S]+tasks queues create "\$CANARY_QUEUE"[\s\S]+max-concurrent-dispatches 1[\s\S]+tasks queues pause "\$CANARY_QUEUE"/.test(canaryProvisioning), "provisioning refuses an active main queue and leaves the canary paused at concurrency one");
  ok(/--image "\$IMAGE"[\s\S]+PHASE8B_SERVICE_MODE=provider_runtime[\s\S]+--image "\$IMAGE"[\s\S]+PHASE8B_SERVICE_MODE=task_canary_dispatcher/.test(canaryProvisioning), "canary runtime and dispatcher use the same immutable reviewed image");
  ok(/--no-allow-unauthenticated[\s\S]+roles\/run\.invoker[\s\S]+PHASE8B_RUNTIME_INVOKER_SERVICE_ACCOUNT/.test(canaryProvisioning), "canary services preserve private OIDC invocation");
  ok(!/quickbooks\.api\.intuit\.com|PHASE8B_QUEUE_NAME=\$MAIN_QUEUE/.test(canaryProvisioning), "canary provisioning has no Production provider endpoint or main-queue fallback");
  ok(/raises_sqlstate[\s\S]+service_role[\s\S]+42501/.test(credentialBindingCanaryTest), "database tests prove service_role has no recovery shortcut");
  ok(/extensions\.dblink_send_query[\s\S]+extensions\.dblink_get_result/.test(credentialBindingCanaryTest), "database tests include hosted concurrent incident recovery");
  ok(/legacy_unattributed[\s\S]+remains quarantined and unchanged/.test(credentialBindingCanaryTest), "database tests preserve legacy-unattributed quarantine");
  ok(/reserved canary reconciliation returns the same virtual pre-reservation identity/.test(credentialBindingCanaryTest), "database tests prove deterministic reservation-to-enqueue reconciliation");
  ok(/integration_sync_task_credential_lineage_recovery_events[\s\S]+enable row level security[\s\S]+force row level security/.test(credentialLineageRecoveryMigration), "lineage recovery evidence is private with forced RLS");
  ok(/credential_lineage_id = historical_credential_id[\s\S]+credential_lineage_id = current_credential_id/.test(credentialLineageRecoveryMigration), "credential row ID is the immutable refresh-lineage anchor");
  ok(/historicalCredentialId[\s\S]+expectedHistoricalCredentialVersion[\s\S]+currentCredentialId[\s\S]+expectedCurrentCredentialVersion[\s\S]+expectedCurrentCredentialRowVersion/.test(credentialLineageRecoveryMigration), "lineage recovery separates historical incident evidence from current credential CAS authority");
  ok(/generate_series[\s\S]+credential_rotated[\s\S]+refresh_succeeded[\s\S]+credential_version/.test(credentialLineageRecoveryMigration), "every credential-version advance requires one immutable canonical refresh event");
  ok(/supersedes_credential_id is null[\s\S]+oauth_state_id is null[\s\S]+integration_reauthorization_states[\s\S]+replacement_credential_id = v_current_credential\.id/.test(credentialLineageRecoveryMigration), "the current credential row must itself have canonical creation authority");
  ok(/historicalCredentialId'\)::uuid <>[\s\S]+v_current_credential\.id[\s\S]+incident_recovery_lineage_denied/.test(credentialLineageRecoveryMigration), "reauthorization row substitution cannot cross the refresh-lineage anchor");
  ok(/credential_provider_read[\s\S]+audit\.metadata \? 'task_id'[\s\S]+audit\.metadata ->> 'task_id' = v_task\.id::text/.test(credentialLineageRecoveryMigration), "task-bound read metadata cannot be substituted across tasks");
  ok(/integration_sync_task\.lease[\s\S]+audit\.target_id = v_task\.id::text[\s\S]+audit\.occurred_at <= v_credential_read_audit\.occurred_at/.test(credentialLineageRecoveryMigration), "historical read evidence remains bounded to the exact task lease window");
  ok(/v_historical_persisted_at[\s\S]+credential_version'\)::bigint >[\s\S]+v_historical_credential_version[\s\S]+audit\.occurred_at <= v_credential_read_audit\.occurred_at/.test(credentialLineageRecoveryMigration), "credential versions newer than the incident must postdate the historical read");
  ok(/reason_code in \('invalid_grant', 'provider_revoked'\)[\s\S]+lineage_recovery_revoked/.test(credentialLineageRecoveryMigration), "invalid-grant and provider-revoked evidence still blocks lineage recovery");
  ok(/integration_sync_task\.complete[\s\S]+external_source_record_versions[\s\S]+lineage_recovery_effect_denied/.test(credentialLineageRecoveryMigration), "provider completion or source effects still block lineage recovery");
  ok(/grant execute on function[\s\S]+recover_qbo_sandbox_credential_binding_incident_task_v2[\s\S]+to integration_credential_broker_authority/.test(credentialLineageRecoveryMigration), "only credential-broker authority receives V2 lineage recovery execution");
  ok(!/grant (?:execute|integration_credential_broker_authority)[\s\S]{0,100}to service_role/i.test(credentialLineageRecoveryMigration), "service_role receives no V2 lineage recovery shortcut");
  ok(/historical V5 incident plus current V6[\s\S]+exact same refresh-lineage version remains recoverable/.test(credentialLineageRecoveryTest), "database coverage proves both advanced and unchanged refresh-lineage recovery");
  ok(/credential-read evidence explicitly bound to another task is denied/.test(credentialLineageRecoveryTest), "database coverage rejects a read audit bound to another task");
  ok(/valid reauthorization successor cannot substitute/.test(credentialLineageRecoveryTest), "database coverage rejects reauthorization-row substitution");
  ok(/provider completion evidence still blocks lineage recovery/.test(credentialLineageRecoveryTest), "database coverage rejects effect-bearing recovery");
  ok(/dblink_send_query[\s\S]+concurrent lineage recovery permits exactly one authoritative mutation/.test(credentialLineageRecoveryTest), "hosted concurrency proves one V2 mutation and idempotent convergence");

  const validIncidentRecovery = {
    contractVersion:
      qboRuntimeRepository.QBO_SANDBOX_CREDENTIAL_BINDING_INCIDENT_RECOVERY_CONTRACT_VERSION,
    workspaceId: id(8901),
    businessEntityId: id(8902),
    connectionId: id(8903),
    connectionGeneration: 1,
    mappingId: id(8904),
    expectedMappingRowVersion: 1,
    historicalCredentialId: id(8905),
    expectedHistoricalCredentialVersion: 5,
    currentCredentialId: id(8905),
    expectedCurrentCredentialVersion: 6,
    expectedCurrentCredentialRowVersion: 4,
    taskId: id(8906),
    expectedTaskRowVersion: 9,
    expectedDispatchGeneration: 2,
    failureAuditEventId: id(8907),
    credentialReadAuditEventId: id(8908),
    diagnosticClass: "expires_at_binding",
    externalEvidenceFingerprint: fingerprint("phase8b-binding-incident"),
    retryAfterSeconds: 1
  };
  equal(
    qboRuntimeRepository.RecoverQboSandboxCredentialBindingIncidentTaskCommandSchema.parse(
      validIncidentRecovery
    ).diagnosticClass,
    "expires_at_binding",
    "repository accepts only the canonical redacted incident classification"
  );
  throws(
    () => qboRuntimeRepository.RecoverQboSandboxCredentialBindingIncidentTaskCommandSchema.parse({
      ...validIncidentRecovery,
      diagnosticClass: "credential_expired"
    }),
    /invalid|literal/i,
    "non-binding credential failures cannot use incident recovery"
  );
  const validCanaryTarget = {
    contractVersion:
      qboRuntimeRepository.QBO_SANDBOX_CANARY_DISPATCH_DISCOVERY_CONTRACT_VERSION,
    workspaceId: id(8901),
    businessEntityId: id(8902),
    connectionId: id(8903),
    connectionGeneration: 1,
    taskId: id(8906),
    maximumTasks: 1
  };
  equal(
    qboRuntimeRepository.ReadQboSandboxCanaryDispatchCandidateCommandSchema.parse(
      validCanaryTarget
    ).maximumTasks,
    1,
    "repository accepts exactly one canary target"
  );
  throws(
    () => qboRuntimeRepository.ReadQboSandboxCanaryDispatchCandidateCommandSchema.parse({
      ...validCanaryTarget,
      maximumTasks: 2
    }),
    /invalid|literal/i,
    "repository rejects any widened canary batch"
  );
  ok(/grant execute on function public\.create_integration_reauthorization_state_v1[\s\S]+to integration_oauth_ingress_authority/.test(reauthorizationMigration), "only OAuth ingress receives reauthorization state creation");
  ok(/grant execute on function public\.store_reauthorized_integration_credential_v1[\s\S]+to integration_credential_broker_authority/.test(reauthorizationMigration), "only credential broker receives replacement authority");
  ok(!/grant (?:execute|integration_credential_broker_authority)[\s\S]{0,100}to service_role/i.test(reauthorizationMigration), "service_role receives no reauthorization shortcut");
  ok(/add column reauthorization_path text not null/.test(recoveryReauthorizationMigration), "recovery reauthorization persists a distinct immutable lifecycle path");
  ok(/'initializing_same_generation'[\s\S]+?'authorization_required_recovery'/.test(recoveryReauthorizationMigration), "initializing and authorization-required recovery paths remain explicit and separate");
  ok(/is_qbo_sandbox_recovery_reauthorization_eligible_v1[\s\S]+action = 'reauthorization_required'[\s\S]+reason_code in \([\s\S]+?'credential_expired'[\s\S]+?'scope_loss'[\s\S]+?'kms_failure'[\s\S]+?'integrity_failure'/.test(recoveryReauthorizationMigration), "recovery begin requires canonical recoverable credential-failure evidence");
  ok(/reason_code in \('invalid_grant', 'provider_revoked'\)/.test(recoveryReauthorizationMigration), "revoked provider authorization remains an explicit recovery fence");
  ok(/connection\.status = 'reauthorization_required'[\s\S]+connection\.state_reason_code = 'authorization_required'/.test(recoveryReauthorizationMigration), "recovery state creation admits only the exact authorization-required connection lifecycle");
  ok(/credential\.status = case v_reauthorization_path[\s\S]+?'initializing_same_generation' then 'active'[\s\S]+?else 'reauthorization_required'/.test(recoveryReauthorizationMigration), "credential authority is path-specific and database-derived");
  ok(/v_state\.reauthorization_path = 'authorization_required_recovery'[\s\S]+is_qbo_sandbox_recovery_reauthorization_eligible_v1/.test(recoveryReauthorizationMigration), "consume and completion recheck recovery authority after state creation");
  ok(/set status = 'superseded'[\s\S]+insert into private\.integration_credentials[\s\S]+set status = 'completed'[\s\S]+set status = 'initializing'/.test(recoveryReauthorizationMigration), "credential replacement, state completion, and lifecycle restoration are atomic and ordered");
  ok(/state\.status = 'completed'[\s\S]+state\.expected_connection_row_version = old\.row_version[\s\S]+replacement\.status = 'active'/.test(recoveryReauthorizationMigration), "the exceptional connection transition requires one-shot completed replacement evidence");
  ok(!/create or replace function private\.is_integration_connection_transition_v1/.test(recoveryReauthorizationMigration), "the generic connection lifecycle graph is not broadened");
  ok(/revoke all on function[\s\S]+is_qbo_sandbox_recovery_reauthorization_eligible_v1[\s\S]+from public, anon, authenticated, service_role/.test(recoveryReauthorizationMigration), "recovery evidence inspection exposes no client or service-role shortcut");
  ok(/integration_expired_refresh_lease_reclamation_v1/.test(leaseReclamationMigration), "expired lease reclamation is a distinct versioned authority action");
  ok(/select credential\.\*[\s\S]+for update/.test(leaseReclamationMigration), "reclamation locks the credential before its CAS decision");
  ok(/p_command is null[\s\S]+is not true[\s\S]+is distinct from/.test(leaseReclamationMigration), "reclamation rejects JSON null and three-valued validation bypasses");
  ok(/for update;[\s\S]+select event\.\*[\s\S]+refresh_lease_expired_reclaimed/.test(leaseReclamationMigration), "idempotency evidence is rechecked after the credential lock");
  ok(/for update nowait[\s\S]+integration_expired_refresh_lease_reclamation_connection_busy/.test(leaseReclamationMigration), "connection eligibility locking fails fast rather than deadlocking with reauthorization");
  ok(/expectedCredentialRowVersion[\s\S]+credential\.row_version/.test(leaseReclamationMigration), "reclamation is bound to the expected credential row version");
  ok(/refresh_lease_expires_at >= v_reclaimed_at/.test(leaseReclamationMigration), "an active or boundary-time lease fails closed");
  ok(/clock_timestamp\(\)/.test(leaseReclamationMigration), "database wall-clock owns strict lease expiry and reclamation time");
  ok(/refresh_lease_id = null[\s\S]+row_version = credential\.row_version \+ 1/.test(leaseReclamationMigration), "the checked RPC clears only the operational lease tuple and advances CAS");
  ok(/reject_unleased_integration_credential_refresh_outcome_v1[\s\S]+old\.refresh_lease_id is null[\s\S]+new\.credential_version is distinct from old\.credential_version/.test(leaseReclamationMigration), "reclamation fences stale refresh-success and refresh-failure updates after the lease tuple is cleared");
  ok(/refresh_lease_expired_reclaimed[\s\S]+retention_class/.test(leaseReclamationMigration), "reclamation appends purpose-bound security audit evidence");
  ok(/refresh_lease_fingerprint/.test(leaseReclamationMigration), "audit evidence fingerprints rather than exposes the prior lease identifier");
  ok(/is_integration_expired_refresh_lease_reclamation_metadata_v1[\s\S]+jsonb_has_exact_keys_v1[\s\S]+refresh_lease_expired_at[\s\S]+reclaimed_at/.test(leaseReclamationMigration), "reclamation audit metadata has an action-specific strict schema");
  ok(/grant execute on function public\.reclaim_integration_expired_refresh_lease_v1[\s\S]+to integration_credential_broker_authority/.test(leaseReclamationMigration), "only credential-broker authority receives reclamation execution");
  ok(!/grant (?:execute|integration_credential_broker_authority)[\s\S]{0,100}to service_role/i.test(leaseReclamationMigration), "service_role receives no expired-lease reclamation shortcut");
  ok(!/(?:credential_ciphertext|granted_scopes|access_expires_at|refresh_expires_at)\s*=/.test(leaseReclamationMigration), "reclamation never rewrites credential material, scopes, or token expiries");
  ok(/alter column last_delivery_execution_count drop not null/.test(zeroBasedDeliveryMigration), "never-observed delivery uses an explicit nullable execution count");
  ok(/last_delivery_dispatch_generation bigint/.test(zeroBasedDeliveryMigration), "delivery evidence is bound to its owning dispatch generation");
  ok(/delivery_attribution_state text/.test(zeroBasedDeliveryMigration), "delivery evidence has an explicit three-state attribution model");
  ok(/delivery_attribution_state in \([\s\S]+?'none'[\s\S]+?'attributed'[\s\S]+?'legacy_unattributed'/.test(zeroBasedDeliveryMigration), "the database distinguishes never-delivered, attributed, and quarantined legacy evidence");
  ok(/integration_audit_events[\s\S]+action = 'integration_sync_task\.lease'[\s\S]+outcome = 'succeeded'[\s\S]+delivery_attribution_state = 'attributed'/.test(zeroBasedDeliveryMigration), "historical generation attribution requires authoritative successful lease evidence");
  ok(/set delivery_attribution_state = 'legacy_unattributed'[\s\S]+last_delivery_dispatch_generation is null/.test(zeroBasedDeliveryMigration), "ambiguous historical bytes are retained without a guessed generation");
  ok(!/integration_sync_task_delivery_backfill_unattributed/.test(zeroBasedDeliveryMigration), "ambiguous unrelated fixtures no longer abort the atomic migration");
  ok(/integration_sync_task_delivery_attribution_events[\s\S]+enable row level security[\s\S]+force row level security/.test(zeroBasedDeliveryMigration), "legacy attribution evidence is private with forced RLS");
  ok(/successful_lease_audit_missing/.test(zeroBasedDeliveryMigration), "legacy quarantine evidence records the exact attribution failure reason");
  ok(/reject_integration_sync_task_delivery_attribution_event_mutation_v1/.test(zeroBasedDeliveryMigration), "legacy attribution evidence is immutable");
  ok(/old\.delivery_attribution_state = 'legacy_unattributed'[\s\S]+integration_sync_task_delivery_attribution_unresolved/.test(zeroBasedDeliveryMigration), "ordinary task mutation cannot convert or resume a quarantined task");
  ok(/v_task\.delivery_attribution_state = 'legacy_unattributed'[\s\S]+integration_sync_task_delivery_attribution_unresolved/.test(zeroBasedDeliveryMigration), "runtime leasing fails closed before interpreting legacy evidence");
  equal(
    (zeroBasedDeliveryMigration.match(
      /delivery_attribution_state <> 'legacy_unattributed'/g
    ) || []).length >= 4,
    true,
    "global/scoped discovery and sweep boundaries all exclude quarantine"
  );
  ok(/grant integration_task_dispatch_authority[\s\S]+to integration_task_scheduler_authority[\s\S]+with inherit false, set false/.test(zeroBasedDeliveryMigration), "scheduler membership cannot inherit or assume dispatcher recovery authority");
  ok(/qbo_sandbox_zero_based_delivery_recovery_v1/.test(zeroBasedDeliveryMigration), "the rejected count-zero incident has a distinct recovery contract");
  ok(/integration_sync_task_delivery_recovery_events[\s\S]+enable row level security[\s\S]+force row level security/.test(zeroBasedDeliveryMigration), "delivery recovery evidence is private with forced RLS");
  ok(/observed_delivery_execution_count = 0/.test(zeroBasedDeliveryMigration), "recovery can record only the observed zero-based first execution");
  ok(/task\.last_delivery_dispatch_generation is null[\s\S]+task\.last_delivery_dispatch_generation < task\.dispatch_generation/.test(zeroBasedDeliveryMigration), "recovery never overwrites accepted evidence for the current dispatch generation");
  ok(/not exists \([\s\S]+integration_sync_task\.lease[\s\S]+task\.dispatch_generation::text/.test(zeroBasedDeliveryMigration), "recovery requires proof that the rejected delivery never acquired a lease");
  ok(/v_recovered_delivery_execution_count is not null[\s\S]+deliveryExecutionCount'\)::integer <=[\s\S]+v_recovered_delivery_execution_count/.test(zeroBasedDeliveryMigration), "recovered count zero fences its replay while allowing a later retry count");
  const recoveryFunction = zeroBasedDeliveryMigration.slice(
    zeroBasedDeliveryMigration.indexOf(
      "create or replace function public.recover_qbo_sandbox_zero_based_deliveries_v1"
    ),
    zeroBasedDeliveryMigration.indexOf(
      "revoke all on function public.recover_qbo_sandbox_zero_based_deliveries_v1"
    )
  );
  ok(
    recoveryFunction.indexOf("pg_advisory_xact_lock") >= 0 &&
      recoveryFunction.indexOf("pg_advisory_xact_lock") <
        recoveryFunction.indexOf(
          "from private.integration_sync_task_delivery_recovery_events"
        ),
    "recovery request idempotency serializes before its first evidence read"
  );
  ok(/delivery_attribution_state = 'none'[\s\S]+last_delivery_dispatch_generation <[\s\S]+v_recovered_delivery_execution_count is null[\s\S]+deliveryExecutionCount'\)::integer <> 0/.test(zeroBasedDeliveryMigration), "a new dispatch generation starts at count zero absent immutable recovery evidence");
  equal(
    (zeroBasedDeliveryMigration.match(
      /task\.delivery_attribution_state = 'attributed'/g
    ) || []).length >= 3,
    true,
    "quarantined historical leases do not consume runtime concurrency"
  );
  ok(/delivery_attribution_state = 'attributed'[\s\S]+last_delivery_dispatch_generation = task\.dispatch_generation[\s\S]+last_delivery_execution_count =/.test(zeroBasedDeliveryMigration), "an accepted lease persists explicit zero-based evidence for the current dispatch generation");
  ok(/grant execute on function public\.recover_qbo_sandbox_zero_based_deliveries_v1[\s\S]+to integration_task_dispatch_authority/.test(zeroBasedDeliveryMigration), "only dispatcher authority receives the incident recovery RPC");
  ok(!/grant integration_task_dispatch_authority\s+to service_role/i.test(zeroBasedDeliveryMigration), "service_role receives no zero-based delivery shortcut");
  ok(/add column last_delivery_retry_count integer/.test(retryExecutionMigration), "forward migration persists retry count beside existing delivery evidence");
  ok(!/check_function_bodies\s*=\s*off/.test(retryExecutionMigration), "forward migration keeps PostgreSQL function-body validation enabled");
  ok(
    /action = 'refresh_lease_expired_reclaimed'[\s\S]+is_integration_expired_refresh_lease_reclamation_metadata_v1[\s\S]+action <> 'refresh_lease_expired_reclaimed'[\s\S]+is_integration_audit_metadata_v8b_delivery_v2/.test(retryExecutionMigration),
    "forward migration preserves the distinct expired-refresh-lease audit metadata contract"
  );
  ok(/deliveryDispatchGeneration'[\s\S]+deliveryRetryCount'[\s\S]+deliveryExecutionCount'/.test(retryExecutionMigration), "lease RPC requires trusted generation and both delivery counters");
  ok(/last_delivery_dispatch_generation = v_delivery_dispatch_generation[\s\S]+last_delivery_retry_count = v_delivery_retry_count[\s\S]+last_delivery_execution_count = v_delivery_execution_count/.test(retryExecutionMigration), "accepted leases persist the complete delivery tuple atomically");
  ok(/v_delivery_retry_count <= v_baseline_retry_count[\s\S]+v_delivery_execution_count < v_baseline_execution_count/.test(retryExecutionMigration), "retry and applicable execution regressions fail closed without contiguity assumptions");
  ok(/integration_sync_task_delivery_retry_compatibility_events[\s\S]+enable row level security[\s\S]+force row level security/.test(retryExecutionMigration), "legacy retry attribution evidence is private with forced RLS");
  ok(/delivery_recovery_event_id uuid not null references[\s\S]+integration_sync_task_delivery_recovery_events/.test(retryExecutionMigration), "retry compatibility requires prior no-lease incident evidence");
  ok(/recover_qbo_sandbox_delivery_retry_compatibility_v1[\s\S]+to integration_task_dispatch_authority/.test(retryExecutionMigration), "only dispatcher authority receives bounded retry compatibility execution");
  ok(/integration_sync_task_reauthorization_recovery_events[\s\S]+enable row level security[\s\S]+force row level security/.test(retryExecutionMigration), "purchase recovery evidence is immutable private authority state");
  ok(/stream_key = 'qbo_purchase'[\s\S]+failure_category <> 'authorization'[\s\S]+failure_code <> 'credential_reauthorization_required'/.test(retryExecutionMigration), "failed purchase recovery admits only the reviewed authorization failure shape");
  ok(/v_replacement\.status <> 'active'[\s\S]+v_replacement\.credential_version <>[\s\S]+v_replacement\.refresh_lease_id is not null/.test(retryExecutionMigration), "purchase recovery requires a current lease-free replacement credential under CAS");
  ok(/reason_code in \('invalid_grant', 'provider_revoked'\)/.test(retryExecutionMigration), "invalid-grant and revoked replacement authority cannot recover purchase work");
  ok(/set state = 'retry_wait'[\s\S]+failure_category = null[\s\S]+failure_code = null[\s\S]+row_version = task\.row_version \+ 1/.test(retryExecutionMigration), "purchase recovery reuses the same task identity and advances only the checked retry transition");
  ok(/prior_dispatcher_task_name_fingerprint is null/.test(retryExecutionMigration), "recovery preserves the standard terminal failure's cleared dispatcher identity without fabrication");
  ok(/record_integration_credential_refresh_boundary_v2/.test(retryExecutionMigration) && /refresh_diagnostics/.test(retryExecutionMigration), "refresh diagnostics are versioned, redacted and operation-scoped");
  ok(!/grant (?:execute|integration_(?:task_dispatch|credential_broker)_authority)[\s\S]{0,100}to service_role/i.test(retryExecutionMigration), "service_role receives no retry, purchase-recovery or refresh shortcut");
  ok(/url\.pathname === "\/credentials\/refresh"/.test(service), "private broker owns refresh execution");
  ok(/url\.pathname === "\/credentials\/reclaim-expired-refresh-lease"/.test(service), "private broker exposes a distinct expired-lease reclamation route");
  ok(/reclamation_capability_denied/.test(service), "expired-lease reclamation requires the operator cleanup capability");
  ok(/reclaimExpiredRefreshLease\([\s\S]+providerKey: "quickbooks_online"[\s\S]+providerEnvironment: "sandbox"/.test(service), "the Phase 8B service pins reclamation to trusted QBO sandbox configuration");
  ok(/url\.pathname === "\/credentials\/disconnect"/.test(service), "checked cleanup path performs provider revocation and local destruction");
  ok(/url\.pathname === "\/oauth\/finalize"/.test(service), "OAuth finalization has a private restartable recovery path");
  ok(/url\.pathname === "\/oauth\/reauthorize\/begin"/.test(service), "broker exposes a distinct private reauthorization begin path");
  ok(/isReauthorizationOAuthState\(callback\.state\)/.test(service), "callback routing distinguishes reauthorization state before completion");
  ok(/if \(isReauthorizationOAuthState\(callback\.state\)\)[\s\S]+throw new Error\("phase8b_reauthorization_completion_failed"\)/.test(service), "reauthorization cannot fall back into initial mapping finalization");
  equal(service.includes('integerEnv("PHASE8B_CONNECTION_ROW_VERSION", 1)'), false, "broker no longer hard-codes connection row version one");
  ok(/callbackUrl !== PHASE_8B_REAUTHORIZATION_REDIRECT_URI/.test(service), "runtime fails closed unless callback configuration equals the approved edge");
  ok(/credentialAadDigest\(credential\.aadContext\)/.test(service) && /companyVerifier\.verify/.test(service), "recovery revalidates canonical AAD and current sandbox company evidence");
  ok(/cleanupCapabilityAuthorized\(request\)/.test(service), "disconnect requires an application-level cleanup capability");
  ok(/url\.pathname === "\/webhooks\/verify"/.test(service), "private broker owns raw webhook verification");
  ok(/request\.method === "POST" && url\.pathname === "\/webhooks\/qbo"/.test(service), "isolated ingress exposes only the QBO webhook endpoint");
  ok(/recordVerifiedWebhookEvent/.test(service), "verified webhook deliveries enter the durable replay ledger as hints");
  ok(/leased\.streamKey === "qbo_cdc"/.test(service), "durable runtime executes the approved CDC stream");
  ok(/bisectQboCdcWindowIfDense/.test(service), "dense CDC responses invoke the reviewed time-window signal");
  ok(/bisectQboCdcEntityTypesIfDense/.test(service), "dense CDC retries bisect the provider-supported entity list before any source commit");
  ok(/config\.mode === "task_dispatcher"/.test(service), "private dispatcher is an explicit service mode");
  ok(/const retryRaw = request\.headers\["x-cloudtasks-taskretrycount"\];/.test(service), "runtime reads the distinct Cloud Tasks retry-count header");
  ok(/const executionRaw = request\.headers\["x-cloudtasks-taskexecutioncount"\];/.test(service), "runtime reads the distinct Cloud Tasks execution-count header");
  ok(!/x-cloudtasks-task(?:retry|execution)count"\]\s*\?\?\s*"0"/.test(service), "missing delivery counters cannot masquerade as a first delivery");
  ok(/typeof value !== "string"/.test(deliveryParser) && /!\/\^\(0\|\[1-9\]\[0-9\]\*\)\$\//.test(deliveryParser), "delivery counters require canonical nonnegative decimal headers");
  ok(/count < 0 \|\| count > 100/.test(deliveryParser), "runtime rejects negative and out-of-contract delivery counters");
  ok(/dispatchGeneration: input\.trustedDispatchGeneration[\s\S]+retryCount: metadata\.retryCount[\s\S]+executionCount: metadata\.executionCount/.test(deliveryParser), "delivery fingerprint includes trusted dispatch generation and both Cloud Tasks counters");
  ok(/if \(!leaseDecision\.acquired\)[\s\S]+return json\(response, 409[\s\S]+leased = leasedTask\(leaseDecision\)/.test(service), "acquired false exits before credential resolution and provider execution");
  ok(
    service.indexOf("const deliveryMetadata = parseQboCloudTaskDelivery(") <
      service.indexOf('if (delivery.state === "succeeded")'),
    "even terminal idempotent replays validate both Cloud Tasks counters first"
  );
  ok(/readQboSandboxScopedDispatchCandidates\([\s\S]+workspaceId: scope\.workspaceId[\s\S]+businessEntityId: scope\.businessEntityId[\s\S]+connectionId: scope\.connectionId[\s\S]+connectionGeneration: config\.connectionGeneration/.test(service), "dispatcher builds discovery scope from trusted service configuration");
  ok(/sweepQboSandboxScopedDispatchTasks\([\s\S]+workspaceId: scope\.workspaceId[\s\S]+businessEntityId: scope\.businessEntityId[\s\S]+connectionId: scope\.connectionId[\s\S]+connectionGeneration: config\.connectionGeneration/.test(service), "dispatcher builds lifecycle-sweep scope from trusted service configuration");
  ok(/promoteQboSandboxDueRetryTasks\([\s\S]+workspaceId: scope\.workspaceId[\s\S]+businessEntityId: scope\.businessEntityId[\s\S]+connectionId: scope\.connectionId[\s\S]+connectionGeneration: config\.connectionGeneration/.test(service), "dispatcher builds due-retry scope from trusted service configuration");
  ok(!/sweepRuntimeTasks/.test(service), "connection-scoped dispatcher cannot invoke global task recovery");
  const retryPromotionIndex = service.indexOf("await promoteQboSandboxDueRetryTasks(");
  const discoveryIndex = service.indexOf("await readQboSandboxScopedDispatchCandidates(");
  ok(
    retryPromotionIndex >= 0 && discoveryIndex > retryPromotionIndex,
    "due retries enter pending state before scoped candidate discovery"
  );
  ok(!/Math\.max\(body\.maximumTasks, 25\)/.test(service), "dispatcher lifecycle work is bounded by the requested batch size");
  const reservationIndex = service.indexOf("await reserveQboSandboxScopedDispatchTask(");
  const enqueueIndex = service.indexOf("const cloudTask = await googleCreateCloudTask(");
  ok(reservationIndex >= 0 && enqueueIndex > reservationIndex, "database scope reservation completes before external Cloud Task enqueue");
  ok(/dispatcherTaskName: cloudTaskId/.test(service), "reservation and Cloud Tasks use the same short task identity");
  ok(!/markRuntimeTaskDispatched/.test(service), "QBO dispatch cannot fall back to the incompatible generic full-resource mark RPC");
  ok(/object\(\{ maximumTasks:[\s\S]+\}\)[\s\S]+\.strict\(\)/.test(service), "dispatcher request body cannot carry tenant scope identifiers");
  ok(/completeQboSandboxRuntimeTask/.test(service) && /continuationTaskId/.test(service), "runtime page completion persists its next page before acknowledging delivery");
  ok(/provider_task_failure_recorded/.test(service) && /durableFailureRecorded: true/.test(service), "provider failures are acknowledged only after durable retry state is recorded");
  ok(/cloudtasks\.googleapis\.com\/v2/.test(google) && /oidcToken/.test(google), "Cloud Tasks dispatch uses Google OIDC without service-account keys");
  ok(/return \{ taskId: input\.taskId, created:/.test(google), "dispatcher persists the short task identifier delivered by Cloud Tasks");
  ok(/databaseRolesByMode/.test(service), "each service mode has an explicit database-authority allowlist");
  ok(/checkedIdentifier\(role, this\.#allowedRoles\)/.test(database), "a service cannot select authority outside its mode allowlist");
  ok(/roles\.length === 0/.test(database), "database construction fails closed without an authority set");
  ok(!/url\.pathname === "\/oauth\/start"/.test(service), "OAuth start is private-broker initiated rather than publicly triggerable");
  ok(!/quickbooks\.api\.intuit\.com/.test(service), "service code contains no Production QBO API origin");
  ok(!/com\.intuit\.quickbooks\.payment/.test(service), "service code contains no payments scope");
  ok(/parseQboOAuthCallbackHandoff/.test(service), "callback ingress accepts only the clean internal handoff contract");
  ok(!/url\.searchParams\.get\("(?:code|state|realmId)"\)/.test(service), "callback ingress never parses sensitive query values in Cloud Run");
  ok(/sanitizedQboOAuthConfirmationUrl/.test(service) && /return redirect\(/.test(service), "callback completion redirects to a sanitized URL without provider values");
  deepEqual(
    qboRuntimeRepository.QboSandboxRuntimeTaskContinuationSchema.parse({
      kind: "next_page",
      childTaskId: id(8999)
    }),
    { kind: "next_page", childTaskId: id(8999) },
    "continuation contract admits only the bounded next-page shape"
  );
  equal(
    qboRuntimeRepository.QboSandboxCloudTaskNameSchema.parse("a".repeat(64)),
    "a".repeat(64),
    "Cloud Tasks short-name contract admits the deterministic task hash"
  );
  throws(
    () => qboRuntimeRepository.QboSandboxCloudTaskNameSchema.parse(
      "projects/example/locations/us-west1/queues/qbo/tasks/" + "a".repeat(64)
    ),
    /invalid|Invalid|regex/i,
    "Cloud Tasks full resource names cannot be confused with delivered short names"
  );
  throws(
    () => qboRuntimeRepository.QboSandboxRuntimeTaskContinuationSchema.parse({
      kind: "next_page",
      childTaskId: id(8999),
      workspaceId: ids.workspace
    }),
    /unrecognized|Unrecognized|invalid/i,
    "continuation callers cannot provide tenant authority"
  );

  const trustedScope = {
    workspaceId: ids.workspace,
    businessEntityId: ids.entity,
    connectionId: ids.connection,
    connectionGeneration: 1
  };
  const delivery = {
    taskId: id(8998),
    ...trustedScope,
    credentialId: id(8997),
    credentialVersion: 1,
    dispatchGeneration: 2,
    state: "dispatched",
    rowVersion: 2
  };
  deepEqual(
    qboRuntimeRepository.assertQboSandboxRuntimeTaskDeliveryScope(
      delivery,
      trustedScope
    ),
    delivery,
    "downstream runtime accepts only its exact configured delivery scope"
  );
  for (const [field, value] of [
    ["workspaceId", id(8910)],
    ["businessEntityId", id(8911)],
    ["connectionId", id(8912)],
    ["connectionGeneration", 2]
  ]) {
    throws(
      () => qboRuntimeRepository.assertQboSandboxRuntimeTaskDeliveryScope(
        { ...delivery, [field]: value },
        trustedScope
      ),
      /qbo_sandbox_runtime_delivery_scope_mismatch/,
      `downstream runtime rejects forged ${field} authority`
    );
  }

  deepEqual(
    qboRuntimeRepository.ReadQboSandboxScopedDispatchCandidatesCommandSchema.parse({
      contractVersion: "qbo_sandbox_scoped_dispatch_discovery_v1",
      ...trustedScope,
      maximumTasks: 24
    }),
    {
      contractVersion: "qbo_sandbox_scoped_dispatch_discovery_v1",
      ...trustedScope,
      maximumTasks: 24
    },
    "scoped discovery command carries only the reviewed trusted boundary"
  );
  throws(
    () => qboRuntimeRepository.ReadQboSandboxScopedDispatchCandidatesCommandSchema.parse({
      contractVersion: "qbo_sandbox_scoped_dispatch_discovery_v1",
      ...trustedScope,
      maximumTasks: 24,
      fallbackWorkspaceId: id(8913)
    }),
    /unrecognized|Unrecognized|invalid/i,
    "copied fallback identifiers cannot widen the strict discovery command"
  );
  deepEqual(
    qboRuntimeRepository.SweepQboSandboxScopedDispatchTasksCommandSchema.parse({
      contractVersion: "qbo_sandbox_scoped_dispatch_recovery_v1",
      ...trustedScope,
      maximumTasks: 25
    }),
    {
      contractVersion: "qbo_sandbox_scoped_dispatch_recovery_v1",
      ...trustedScope,
      maximumTasks: 25
    },
    "scoped recovery command carries only the reviewed trusted boundary"
  );
  deepEqual(
    qboRuntimeRepository.PromoteQboSandboxDueRetryTasksCommandSchema.parse({
      contractVersion: "qbo_sandbox_due_retry_promotion_v1",
      ...trustedScope,
      maximumTasks: 25
    }),
    {
      contractVersion: "qbo_sandbox_due_retry_promotion_v1",
      ...trustedScope,
      maximumTasks: 25
    },
    "due-retry promotion carries only the reviewed trusted boundary"
  );
  throws(
    () => qboRuntimeRepository.PromoteQboSandboxDueRetryTasksCommandSchema.parse({
      contractVersion: "qbo_sandbox_due_retry_promotion_v1",
      ...trustedScope,
      maximumTasks: 25,
      cloudTaskMissing: true
    }),
    /unrecognized|Unrecognized|invalid/i,
    "caller-claimed missing Cloud Task evidence cannot widen retry promotion"
  );
  throws(
    () => qboRuntimeRepository.SweepQboSandboxScopedDispatchTasksCommandSchema.parse({
      contractVersion: "qbo_sandbox_scoped_dispatch_recovery_v1",
      ...trustedScope,
      maximumTasks: 25,
      fallbackConnectionId: id(8914)
    }),
    /unrecognized|Unrecognized|invalid/i,
    "copied fallback identifiers cannot widen scoped retry recovery"
  );
  deepEqual(
    qboRuntimeRepository.ReserveQboSandboxScopedDispatchTaskCommandSchema.parse({
      contractVersion: "qbo_sandbox_scoped_dispatch_reservation_v1",
      ...trustedScope,
      taskId: id(8915),
      expectedRowVersion: 2,
      dispatcherTaskName: "d".repeat(64)
    }),
    {
      contractVersion: "qbo_sandbox_scoped_dispatch_reservation_v1",
      ...trustedScope,
      taskId: id(8915),
      expectedRowVersion: 2,
      dispatcherTaskName: "d".repeat(64)
    },
    "scoped reservation carries exact trusted scope and short task identity"
  );
  throws(
    () => qboRuntimeRepository.ReserveQboSandboxScopedDispatchTaskCommandSchema.parse({
      contractVersion: "qbo_sandbox_scoped_dispatch_reservation_v1",
      ...trustedScope,
      taskId: id(8915),
      expectedRowVersion: 2,
      dispatcherTaskName: `projects/example/locations/us-west1/queues/q/tasks/${"d".repeat(64)}`
    }),
    /invalid/i,
    "full resource names cannot cross the short Cloud Task reservation boundary"
  );
  const zeroBasedObservation = {
    taskId: id(8916),
    expectedRowVersion: 7,
    dispatcherTaskName: "e".repeat(64),
    deliveryExecutionCount: 0,
    deliveryAttemptFingerprint: fingerprint("phase8b-zero-delivery"),
    externalEvidenceFingerprint: fingerprint("phase8b-zero-evidence")
  };
  deepEqual(
    qboRuntimeRepository.RecoverQboSandboxZeroBasedDeliveriesCommandSchema.parse({
      contractVersion: "qbo_sandbox_zero_based_delivery_recovery_v1",
      ...trustedScope,
      observations: [zeroBasedObservation]
    }).observations,
    [zeroBasedObservation],
    "zero-based incident recovery is bound to exact task CAS and evidence"
  );
  for (const invalidObservation of [
    { ...zeroBasedObservation, deliveryExecutionCount: -1 },
    { ...zeroBasedObservation, deliveryExecutionCount: 1 },
    { ...zeroBasedObservation, deliveryExecutionCount: "0" },
    { ...zeroBasedObservation, deliveryExecutionCount: undefined }
  ]) {
    throws(
      () => qboRuntimeRepository.RecoverQboSandboxZeroBasedDeliveriesCommandSchema.parse({
        contractVersion: "qbo_sandbox_zero_based_delivery_recovery_v1",
        ...trustedScope,
        observations: [invalidObservation]
      }),
      /invalid|Invalid|required/i,
      "recovery admits only an explicitly observed numeric execution count zero"
    );
  }
  throws(
    () => qboRuntimeRepository.RecoverQboSandboxZeroBasedDeliveriesCommandSchema.parse({
      contractVersion: "qbo_sandbox_zero_based_delivery_recovery_v1",
      ...trustedScope,
      observations: [zeroBasedObservation, zeroBasedObservation]
    }),
    /unique/i,
    "duplicate task identities cannot widen incident recovery"
  );

  const compatibilityObservation = {
    taskId: id(8917),
    expectedRowVersion: 8,
    dispatcherTaskName: "f".repeat(64),
    deliveryDispatchGeneration: 2,
    observedDeliveryRetryCount: 0,
    observedDeliveryExecutionCount: 0,
    externalEvidenceFingerprint: fingerprint("phase8b-retry-compatibility")
  };
  deepEqual(
    qboRuntimeRepository.RecoverQboSandboxDeliveryRetryCompatibilityCommandSchema.parse({
      contractVersion: "qbo_sandbox_delivery_retry_compatibility_v1",
      ...trustedScope,
      observations: [compatibilityObservation]
    }).observations,
    [compatibilityObservation],
    "retry compatibility is bound to exact scope, task CAS, generation and external evidence"
  );
  throws(
    () => qboRuntimeRepository.RecoverQboSandboxDeliveryRetryCompatibilityCommandSchema.parse({
      contractVersion: "qbo_sandbox_delivery_retry_compatibility_v1",
      ...trustedScope,
      observations: [{
        ...compatibilityObservation,
        observedDeliveryRetryCount: 0,
        observedDeliveryExecutionCount: 1
      }]
    }),
    /execution count cannot exceed retry count|invalid/i,
    "compatibility cannot assign an impossible retry/execution tuple"
  );
  const purchaseRecovery = {
    contractVersion: "qbo_sandbox_reauthorized_purchase_recovery_v1",
    ...trustedScope,
    credentialId: id(8920),
    expectedCredentialVersion: 2,
    expectedCredentialRowVersion: 1,
    mappingId: id(8921),
    expectedMappingRowVersion: 1,
    taskId: id(8922),
    expectedTaskRowVersion: 4,
    retryAfterSeconds: 30
  };
  deepEqual(
    qboRuntimeRepository.RecoverQboSandboxReauthorizedPurchaseTaskCommandSchema.parse(
      purchaseRecovery
    ),
    purchaseRecovery,
    "purchase recovery carries exact credential, mapping and task CAS authority"
  );
  throws(
    () => qboRuntimeRepository.RecoverQboSandboxReauthorizedPurchaseTaskCommandSchema.parse({
      ...purchaseRecovery,
      fallbackTaskId: id(8923)
    }),
    /unrecognized|invalid/i,
    "purchase recovery cannot accept caller-controlled fallback authority"
  );
}

async function testCredentialRefreshFanoutAndCallbackSafety() {
  const credentialId = id(9100);
  const accessTokenCanary = "phase8b-access-token-fanout-canary-0001";
  const refreshTokenCanary = "phase8b-refresh-token-fanout-canary-0001";
  const accessExpiresAt = "2026-08-23T22:00:00.000Z";
  let credentialVersion = 1;
  let refreshHeld = false;
  let providerRefreshCount = 0;
  let credentialCasCount = 0;

  const readCredential = async (expectedCredentialVersion) => {
    if (expectedCredentialVersion !== credentialVersion) {
      return {
        state: "credential_version_stale",
        credentialId,
        credentialVersion,
        accessExpiresAt
      };
    }
    if (credentialVersion === 1) {
      return {
        state: "refresh_required",
        credentialId,
        credentialVersion,
        accessExpiresAt
      };
    }
    return {
      state: "available",
      credentialId,
      credentialVersion,
      accessExpiresAt,
      accessToken: accessTokenCanary
    };
  };
  const refreshCredential = async (_credentialId, expectedCredentialVersion) => {
    if (expectedCredentialVersion !== credentialVersion) {
      return {
        state: "credential_version_superseded",
        refreshed: false,
        reasonCode: "credential_version_stale"
      };
    }
    if (refreshHeld) {
      return {
        state: "refresh_in_progress",
        refreshed: false,
        reasonCode: "refresh_not_acquired",
        retryAfterSeconds: 5
      };
    }
    refreshHeld = true;
    providerRefreshCount += 1;
    await new Promise((resolve) => setImmediate(resolve));
    credentialVersion += 1;
    credentialCasCount += 1;
    refreshHeld = false;
    return {
      state: "refreshed",
      refreshed: true,
      credentialVersion
    };
  };

  const firstWave = await Promise.all(
    Array.from({ length: 24 }, () =>
      credentialResolution.resolveProviderAccessCredential({
        expectedCredentialVersion: 1,
        readCredential,
        refreshCredential
      })
    )
  );
  equal(firstWave.filter((result) => result.state === "available").length, 1, "one of 24 expired-credential tasks wins refresh and receives V2");
  equal(firstWave.filter((result) => result.state === "retry_wait").length, 23, "23 refresh non-winners enter bounded retry wait");
  equal(providerRefreshCount, 1, "24-task fan-out produces one provider token refresh");
  equal(credentialCasCount, 1, "24-task fan-out produces one credential CAS commit");
  equal(credentialVersion, 2, "credential V2 supersedes V1 exactly once");

  const resumed = await Promise.all(
    firstWave
      .filter((result) => result.state === "retry_wait")
      .map(() =>
        credentialResolution.resolveProviderAccessCredential({
          expectedCredentialVersion: 1,
          readCredential,
          refreshCredential
        })
      )
  );
  equal(resumed.filter((result) => result.state === "available").length, 23, "all bounded retries hand off to authoritative credential V2");
  equal(providerRefreshCount, 1, "retry handoff does not start a second provider refresh");
  equal(JSON.stringify([...firstWave, ...resumed]).includes(refreshTokenCanary), false, "no provider task receives refresh-token material");
  equal(
    credentialContracts.CredentialRefreshResultSchema.parse(
      await refreshCredential(credentialId, 1)
    ).state,
    "credential_version_superseded",
    "a stale V1 worker cannot overwrite credential V2"
  );
  equal(credentialCasCount, 1, "stale-worker rejection preserves the single CAS effect");
  throws(
    () => credentialResolution.ProviderCredentialBrokerReadSchema.parse({
      state: "available",
      credentialId,
      credentialVersion: 2,
      accessExpiresAt,
      accessToken: accessTokenCanary,
      refreshToken: refreshTokenCanary
    }),
    /unrecognized|Unrecognized|invalid/i,
    "the provider-task read boundary rejects refresh-token fields"
  );

  const refreshRequired = async () => ({
    state: "refresh_required",
    credentialId,
    credentialVersion: 1,
    accessExpiresAt
  });
  const reauthorization = await credentialResolution.resolveProviderAccessCredential({
    expectedCredentialVersion: 1,
    readCredential: refreshRequired,
    refreshCredential: async () => ({
      state: "reauthorization_required",
      refreshed: false,
      reasonCode: "reauthorization_required"
    })
  });
  equal(reauthorization.state, "reauthorization_required", "invalid or revoked authorization requires reconnection rather than endless retry");
  const transient = await credentialResolution.resolveProviderAccessCredential({
    expectedCredentialVersion: 1,
    readCredential: refreshRequired,
    refreshCredential: async () => ({
      state: "retry_required",
      refreshed: false,
      reasonCode: "refresh_failed",
      retryAfterSeconds: 15
    })
  });
  deepEqual(transient, {
    state: "retry_wait",
    failureCode: "credential_refresh_transient",
    retryAfterSeconds: 15
  }, "transient refresh failure produces bounded retry metadata");

  const callbackCodeCanary = "phase8b-oauth-code-platform-log-canary-0001";
  const callbackStateCanary = "phase8b_oauth_state_platform_log_canary_0000000001";
  const realmIdCanary = "phase8b-realm-canary";
  const callback = phase8b.parseQboOAuthCallbackHandoff({
    method: "GET",
    requestUrl: "/oauth/callback",
    headers: {
      [phase8b.QBO_OAUTH_CALLBACK_HANDOFF_HEADERS.version]:
        phase8b.QBO_OAUTH_CALLBACK_HANDOFF_VERSION,
      [phase8b.QBO_OAUTH_CALLBACK_HANDOFF_HEADERS.code]: callbackCodeCanary,
      [phase8b.QBO_OAUTH_CALLBACK_HANDOFF_HEADERS.state]: callbackStateCanary,
      [phase8b.QBO_OAUTH_CALLBACK_HANDOFF_HEADERS.realmId]: realmIdCanary
    }
  });
  equal(callback.code, callbackCodeCanary, "clean internal callback handoff preserves the bounded code transiently");
  throws(
    () => phase8b.parseQboOAuthCallbackHandoff({
      method: "GET",
      requestUrl: `/oauth/callback?code=${callbackCodeCanary}&state=${callbackStateCanary}&realmId=${realmIdCanary}`,
      headers: {}
    }),
    /handoff_invalid/,
    "Cloud Run callback handling rejects any request URL containing OAuth query material"
  );
  const confirmation = phase8b.sanitizedQboOAuthConfirmationUrl(
    "https://phase8b.example.test/integrations/authorized"
  );
  equal(
    [callbackCodeCanary, callbackStateCanary, realmIdCanary].some((value) =>
      confirmation.includes(value)
    ),
    false,
    "sanitized callback confirmation contains no OAuth code, state, or realm value"
  );
  throws(
    () => phase8b.sanitizedQboOAuthConfirmationUrl(
      `https://phase8b.example.test/integrations/authorized?code=${callbackCodeCanary}`
    ),
    /confirmation_url_invalid/,
    "confirmation URLs with query material fail closed"
  );

  const secret = new secrets.ProviderApplicationSecret({
    schemaVersion: "provider_application_secret_v1",
    providerKey: "quickbooks_online",
    environment: "sandbox",
    clientId: "phase8b-development-client",
    clientSecret: "phase8b-client-secret-log-canary-0001"
  });
  const envelope = credentialContracts.CredentialEnvelopeSchema.parse({
    schemaVersion: "oauth_credential_envelope_v1",
    providerKey: "quickbooks_online",
    environment: "sandbox",
    externalAuthorizedEntityReference: provider.realmId,
    accessToken: accessTokenCanary,
    accessExpiresAt,
    refreshToken: refreshTokenCanary,
    refreshExpiresAt: "2026-11-21T22:00:00.000Z",
    grantedScopes: [phase8b.QBO_ACCOUNTING_SCOPE],
    issuedAt: "2026-08-23T20:00:00.000Z",
    updatedAt: "2026-08-23T20:00:00.000Z"
  });
  for (const failure of [
    { status: 400, body: { error: "invalid_grant" }, code: "invalid_grant" },
    { status: 403, body: { error: "access_denied" }, code: "provider_revoked" },
    { status: 503, body: { error: "temporarily_unavailable" }, code: "provider_transient" }
  ]) {
    const boundaries = [];
    const oauth = new phase8b.QboSandboxOAuthCredentialProvider({
      redirectUri: "https://phase8b.example.test/oauth/callback",
      transport: {
        async postForm() {
          return {
            status: failure.status,
            body: Buffer.from(JSON.stringify(failure.body), "utf8")
          };
        }
      }
    });
    await rejects(
      () => oauth.refreshCredential({
        credential: envelope,
        applicationSecret: secret,
        now: new Date("2026-08-23T20:30:00.000Z"),
        reportBoundary: (event) => boundaries.push(event)
      }),
      (error) => error instanceof ProviderCredentialRefreshFailure && error.code === failure.code,
      `${failure.code} refresh response maps to its redacted safe category`
    );
    const serializedBoundaries = JSON.stringify(boundaries);
    equal(
      [accessTokenCanary, refreshTokenCanary, "phase8b-client-secret-log-canary-0001", "Basic ", "Bearer "].some((value) =>
        serializedBoundaries.includes(value)
      ),
      false,
      `${failure.code} boundary telemetry contains no credential or authorization canary`
    );
  }
}

function testOAuthCallbackEdgeSource() {
  const parser = read("services/external-integrations-qbo-sandbox/edge/callback.go");
  const plugin = read("services/external-integrations-qbo-sandbox/edge/plugin/main.go");
  const cloudBuild = read("services/external-integrations-qbo-sandbox/edge/cloudbuild.yaml");
  const trafficExtension = read("services/external-integrations-qbo-sandbox/edge/lb-traffic-extension.yaml");
  const provision = read("services/external-integrations-qbo-sandbox/ops/provision-oauth-callback-edge.sh");
  const verify = read("services/external-integrations-qbo-sandbox/ops/verify-oauth-callback-edge.sh");
  const cleanup = read("services/external-integrations-qbo-sandbox/ops/cleanup-oauth-callback-edge.sh");

  ok(parser.includes('method != "GET" || !endOfStream'), "the edge parser rejects methods or bodies before handoff");
  ok(parser.includes("MaxRawQueryBytes"), "the edge parser has an explicit raw-query bound");
  ok(parser.includes('strings.Count(requestTarget, "?") != 1'), "the edge parser rejects ambiguous request targets");
  ok(parser.includes("duplicate := values[key]"), "the edge parser rejects duplicate OAuth fields");
  ok(parser.includes('key != "code" && key != "state" && key != "realmId"'), "the edge parser allowlists exactly the Intuit callback fields");
  ok(parser.includes("pathQuery != rawQuery"), "duplicate platform path/query representations must agree byte for byte");
  ok(parser.includes("IsConfirmationRequest"), "the edge exposes only a fixed query-free confirmation path");
  ok(plugin.includes("clearReservedHandoffHeaders()"), "the edge removes client-supplied internal handoff headers");
  ok(plugin.includes('GetProperty([]string{"request", "method"})'), "the edge consumes the explicitly forwarded request method");
  ok(plugin.includes('GetProperty([]string{"request", "query"})'), "the edge consumes the documented undecoded query attribute");
  ok(plugin.includes("GetHttpRequestHeaders()"), "the edge evaluates the complete bounded header map for body indicators");
  ok(plugin.includes('case "transfer-encoding", "expect"'), "transfer encoding and expect-based callback bodies fail closed");
  ok(plugin.includes("contentLengthCount > 1"), "duplicate or nonzero content-length callback bodies fail closed");
  ok(plugin.indexOf("clearReservedHandoffHeaders()") < plugin.indexOf("AddHttpRequestHeader(callbackedge.HandoffVersionHeader"), "header removal precedes bounded internal handoff creation");
  ok(plugin.includes('ReplaceHttpRequestHeader(":path", callbackedge.CallbackPath)'), "the edge strips the query before backend forwarding");
  ok(plugin.includes('sendFixedResponse(200, "Authorization processing complete.")'), "the confirmation response is fixed and contains no callback material");
  equal(/Log(?:Info|Warn|Error|Critical|Debug)/.test(plugin), false, "the plugin emits no application log containing callback material");
  ok(cloudBuild.includes("go test -count=1 ."), "the disposable plugin build runs unit tests before compilation");
  ok(cloudBuild.includes("@sha256:"), "the disposable plugin build uses immutable builder images");
  ok(provision.includes("PHASE8B_EDGE_PLUGIN_IMAGE must be an immutable disposable-project digest"), "provisioning accepts only an immutable plugin from the disposable project");
  const edgeBuild = read("services/external-integrations-qbo-sandbox/ops/build-oauth-callback-edge.sh");
  ok(edgeBuild.includes("p8b-oauth-edge-build"), "the callback artifact uses a dedicated disposable build identity");
  ok(edgeBuild.includes("roles/storage.objectViewer"), "the callback builder receives source-object read only");
  ok(edgeBuild.includes("roles/artifactregistry.writer"), "the callback builder writes only the disposable artifact repository");
  equal(/service-accounts keys create|keys create/.test(edgeBuild), false, "the callback build introduces no service-account key");
  ok(trafficExtension.includes("failOpen: false"), "the load-balancer traffic extension fails closed");
  ok(trafficExtension.includes('request.path.startsWith("/")'), "all Internet paths traverse the callback-only plugin");
  ok(trafficExtension.includes("- request.method") && trafficExtension.includes("- request.query"), "the traffic extension explicitly forwards method and raw query attributes");
  ok(provision.includes("lb-traffic-extensions import"), "query stripping runs at the supported traffic-extension URL-mutation stage");
  equal(provision.includes("lb-edge-extensions import"), false, "the deployment does not rely on the header-routing-only edge-extension stage for query stripping");
  ok(provision.includes("--no-enable-logging"), "the callback-only backend suppresses access logging");
  ok(provision.includes("--log-config enable=false"), "the Service Extensions plugin suppresses plugin logging");
  ok(provision.includes("--ingress internal-and-cloud-load-balancing"), "direct public Cloud Run ingress is disabled after edge attachment");
  equal(provision.includes("intuit"), false, "edge provisioning cannot mutate the Intuit application");
  ok(verify.includes("cloud_logging_canary_matches=0"), "live verification requires a zero-match logging canary");
  ok(verify.includes("private_broker_fail_closed_requests=4"), "live verification proves the clean bounded handoff reaches the private broker");
  ok(verify.includes("Direct Cloud Run bypass remains available"), "live verification fails if direct Cloud Run bypass succeeds");
  ok(cleanup.includes("PHASE8B_EDGE_CLEANUP_CONFIRM"), "disposable edge cleanup requires a second exact confirmation");
}

async function main() {
  await testControlledRunObserver();
  await testOAuth();
  testCloudTaskDeliveryIdentity();
  await testSameGenerationReauthorizationBroker();
  await testExpiredRefreshLeaseReclamationBroker();
  await testQboRefreshRotationPolicy();
  await testCredentialReadDiagnostics();
  await testReadOnlyClient();
  const source = testSourceValidationAndMapping();
  const report = testReportControl();
  testReconciliationAndDeterministic(source.mapped.candidates[0], report);
  testMigrationBoundary();
  await testCredentialRefreshFanoutAndCallbackSafety();
  testOAuthCallbackEdgeSource();
  console.log(
    `External integration Phase 8B QBO sandbox regressions: ${assertionCount} assertions passed; model calls 0; promotionAuthorized false.`
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
