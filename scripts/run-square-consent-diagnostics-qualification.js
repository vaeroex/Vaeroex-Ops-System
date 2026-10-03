/* Local synthetic values only. No default network, credentials or hosted paths. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
require("./square-account-browser-test-support.js").loadSquareBrowserModules();
const { createSquareConsentDiagnostics, createSquareConsentFileSink } = require("../services/square-sandbox-callback/src/consent-diagnostics.ts");
const { reportSquareConsentProgress, SQUARE_CONSENT_STAGES } = require("../lib/integrations/providers/square/account-connection-progress.ts");
const { createSquareOAuthCredentialProvider, createSquareOAuthPolicy, SQUARE_OAUTH_SCOPES } = require("../lib/integrations/providers/square/account-connection-oauth.ts");
const { createSquareAccountConnectionService } = require("../lib/integrations/providers/square/account-connection-service.ts");
const { ProviderApplicationSecret } = require("../lib/integrations/credentials/secret-manager.ts");
const { oauthStateHash } = require("../lib/integrations/credentials/oauth-state.ts");
const canary = "SYNTHETIC_PRIVATE_DIAGNOSTIC_CANARY";
const applicationId = "synthetic-square-application", merchantId = "SYNTHETIC_SELLER";
const now = new Date("2026-09-10T00:00:00.000Z"), expiry = new Date(+now + 86_400_000).toISOString();
const redirectUri = "https://synthetic.invalid/callback", returnPath = "/app/settings/integrations/square";
const policy = createSquareOAuthPolicy({ environment: "sandbox", applicationId, redirectUri, returnPath });
const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const actor = { actorId: id(1), workspaceId: id(2), sessionId: id(3), role: "owner" };
const secret = new ProviderApplicationSecret({ schemaVersion: "provider_application_secret_v1", providerKey: "square",
  environment: "sandbox", clientId: applicationId, clientSecret: canary });
const token = () => ({ access_token: canary, refresh_token: canary, token_type: "bearer", expires_at: expiry,
  merchant_id: merchantId, short_lived: true });
const status = () => ({ scopes: [...SQUARE_OAUTH_SCOPES], expires_at: expiry, client_id: applicationId, merchant_id: merchantId });
const location = () => ({ id: "SYNTHETIC_LOC", merchant_id: merchantId, name: "Synthetic location", status: "ACTIVE", country: "US", currency: "USD", timezone: "America/Los_Angeles" });
const replies = () => [token(), status(), { merchant: { id: merchantId, status: "ACTIVE", country: "US", main_location_id: "SYNTHETIC_LOC" } },
  { locations: [location()] }, { location: location() }];
const response = value => ({ status: 200, body: (async function* () { yield Buffer.from(typeof value === "string" ? value : JSON.stringify(value)); })() });
let assertions = 0, checkpoint = "collection";
const eq = (a, b, label) => { assertions++; assert.deepEqual(a, b, label); };
const ok = (a, label) => { assertions++; assert.ok(a, label); };
const rejects = async work => { assertions++; await assert.rejects(work); };
function collector() {
  const writes = [];
  const value = createSquareConsentDiagnostics(bytes => { writes.push(bytes.toString()); return true; });
  return { value, writes, begin: signal => value.begin(signal ?? new AbortController().signal) };
}
async function collectionTests() {
  const c = collector();
  eq(c.value.snapshot().lastFailure, null); eq(c.value.snapshot().lastOutcome, "absent");
  const a = c.begin(), b = c.begin(), overflow = c.begin();
  eq(c.value.snapshot().active, 2); eq(c.value.snapshot().started, 2);
  eq(JSON.parse(c.writes.at(-1)).active, 2, "begin writes explicit incomplete evidence");
  overflow.finish("failed"); eq(c.value.snapshot().completed, 0);
  for (const value of [canary, { toString() { throw new Error(canary); } }, null, new String("token_verified")]) a.observe(value);
  a.finish("failed"); eq(c.value.snapshot().lastFailure.stage, "unknown");
  a.observe("token_verified"); a.finish("callback_returned"); eq(c.value.snapshot().completed, 1);
  b.observe("token_request"); b.finish("failed");
  eq(c.value.snapshot().lastFailure, { completion: 2, stage: "token_request", outcome: "failed" });
  const success = c.begin(); success.finish("callback_returned");
  eq(c.value.snapshot().lastFailure.completion, 2); eq(c.value.snapshot().lastOutcome, "callback_returned");
  const abort = new AbortController(), cancelled = c.begin(abort.signal);
  cancelled.observe("state_consume"); abort.abort(); cancelled.observe("fenced_store_returned"); cancelled.finish("failed");
  eq(c.value.snapshot().lastFailure, { completion: 4, stage: "state_consume", outcome: "cancelled" });
  const preAborted = new AbortController(); preAborted.abort(); c.begin(preAborted.signal);
  eq(c.value.snapshot().lastFailure.stage, "unknown"); eq(c.value.snapshot().active, 0);
  for (let i = 0; i < 110; i++) c.begin().finish("failed");
  eq(c.value.snapshot().started, 100); eq(c.value.snapshot().completed, 100);
  ok(c.writes.every(value => Buffer.byteLength(value) <= 2048 && !value.includes(canary)));
  eq(c.writes.length, 201, "one initial plus bounded begin/finish writes");
  const broken = createSquareConsentDiagnostics(() => { throw new Error(canary); });
  broken.begin(new AbortController().signal).finish("failed");
  eq(broken.snapshot().persistence, "unavailable"); eq(broken.snapshot().lastFailure.stage, "unknown");
  const asyncSink = createSquareConsentDiagnostics(async () => { throw new Error(canary); });
  eq(asyncSink.snapshot().persistence, "unavailable");
  let calls = 0, traps = 0;
  reportSquareConsentProgress(() => calls++, canary); eq(calls, 0);
  reportSquareConsentProgress(() => { throw new Error(canary); }, "token_request");
  reportSquareConsentProgress(async () => { throw new Error(canary); }, "token_request");
  reportSquareConsentProgress(() => Object.defineProperty({}, "then", { get() { traps++; throw new Error(canary); } }), "token_request");
  await new Promise(resolve => setImmediate(resolve)); eq(traps, 0);
}
async function fileTests() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "square-diagnostic-synthetic-"));
  fs.chmodSync(directory, 0o700);
  const file = path.join(directory, "consent-diagnostic.json"), temp = path.join(directory, ".consent-diagnostic.tmp");
  try {
    const c = createSquareConsentDiagnostics(createSquareConsentFileSink(directory));
    eq(c.snapshot().persistence, "available"); eq(fs.statSync(file).mode & 0o777, 0o600);
    const first = c.begin(new AbortController().signal); first.observe("token_schema_validation"); first.finish("failed");
    eq(JSON.parse(fs.readFileSync(file)).lastFailure.stage, "token_schema_validation");
    const original = fs.readFileSync(file, "utf8");
    fs.chmodSync(file, 0o644); c.begin(new AbortController().signal).finish("callback_returned");
    eq(c.snapshot().persistence, "unavailable"); eq(fs.readFileSync(file, "utf8"), original, "failed writer can leave stale snapshot");
    fs.chmodSync(file, 0o600);
    fs.linkSync(file, path.join(directory, "link")); eq(createSquareConsentDiagnostics(createSquareConsentFileSink(directory)).snapshot().persistence, "unavailable");
    fs.unlinkSync(path.join(directory, "link")); fs.unlinkSync(file);
    fs.symlinkSync(path.join(directory, "unrelated"), file);
    eq(createSquareConsentDiagnostics(createSquareConsentFileSink(directory)).snapshot().persistence, "unavailable");
    ok(!fs.existsSync(path.join(directory, "unrelated"))); fs.unlinkSync(file);
    fs.mkdirSync(file); eq(createSquareConsentDiagnostics(createSquareConsentFileSink(directory)).snapshot().persistence, "unavailable"); fs.rmdirSync(file);
    fs.writeFileSync(temp, "synthetic_owned_elsewhere", { mode: 0o600 });
    eq(createSquareConsentDiagnostics(createSquareConsentFileSink(directory)).snapshot().persistence, "unavailable");
    eq(fs.readFileSync(temp, "utf8"), "synthetic_owned_elsewhere"); fs.unlinkSync(temp);
    fs.chmodSync(directory, 0o755);
    eq(createSquareConsentDiagnostics(createSquareConsentFileSink(directory)).snapshot().persistence, "unavailable");
    // Default Linux mount/owner guard with synthetic filesystem metadata only:
    // no /run read/write and no claim of actual guest mount qualification.
    fs.chmodSync(directory, 0o700);
    const stat = fs.statSync(directory), originalLstat = fs.lstatSync, originalStatfs = fs.statfsSync, originalOpen = fs.openSync;
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    let allocations = 0, filesystemType = 0, foreignOwner = false;
    try {
      Object.defineProperty(process, "platform", { value: "linux" });
      fs.lstatSync = value => {
        if (value === "/run/vaeroex-square-callback") return { ...stat, uid: foreignOwner ? stat.uid + 1 : stat.uid, isDirectory: () => true, isSymbolicLink: () => false };
        assert.equal(value, "/run/vaeroex-square-callback/consent-diagnostic.json");
        throw Object.assign(new Error("synthetic_absent"), { code: "ENOENT" });
      };
      fs.statfsSync = () => ({ type: filesystemType });
      fs.openSync = () => { allocations++; throw new Error("synthetic_no_host_file_io"); };
      createSquareConsentDiagnostics(createSquareConsentFileSink()); eq(allocations, 0, "non-tmpfs fails before allocation");
      filesystemType = 0x01021994;
      createSquareConsentDiagnostics(createSquareConsentFileSink()); eq(allocations, 1, "tmpfs passes metadata gate; actual IO remains stubbed");
      foreignOwner = true;
      createSquareConsentDiagnostics(createSquareConsentFileSink()); eq(allocations, 1, "foreign owner fails before allocation");
    } finally { Object.defineProperty(process, "platform", platform); fs.lstatSync = originalLstat; fs.statfsSync = originalStatfs; fs.openSync = originalOpen; }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}
async function oauthTests() {
  for (const [values, expected, extra] of [
    [["not json"], "token_response_body"], [[{}], "token_schema_validation"], [[token(), {}], "token_status_schema_validation"],
    [[token(), { ...status(), client_id: "foreign-application" }], "token_status_verification"],
    [[token(), { ...status(), scopes: [] }], "token_status_verification"],
    [[token(), status()], "token_verified"],
    [[], "token_request", { throwing: true }]
  ]) {
    const c = collector(), attempt = c.begin(); let calls = 0;
    const provider = createSquareOAuthCredentialProvider({ policy, applicationId, observeConsent: attempt.observe,
      transport: async () => { calls++; if (extra?.throwing) throw new Error(canary); return response(values.shift()); } });
    const run = () => provider.exchangeAuthorizationCode({ applicationSecret: secret, authorizationCode: canary, requestedScopes: SQUARE_OAUTH_SCOPES, now });
    if (expected === "token_verified") await run(); else await rejects(run);
    attempt.finish("failed"); eq(c.value.snapshot().lastFailure.stage, expected); ok(calls <= 2); ok(!JSON.stringify(c.writes).includes(canary));
  }
  for (const observer of [undefined, () => { throw new Error(canary); }, async () => { throw new Error(canary); }]) {
    const values = [token(), status()];
    const provider = createSquareOAuthCredentialProvider({ policy, applicationId, observeConsent: observer, transport: async () => response(values.shift()) });
    const result = await provider.exchangeAuthorizationCode({ applicationSecret: secret, authorizationCode: canary, requestedScopes: SQUARE_OAUTH_SCOPES, now });
    eq(result.externalAuthorizedEntityReference, merchantId);
  }
  const events = [], production = createSquareOAuthCredentialProvider({ applicationId, observeConsent: stage => events.push(stage),
    policy: createSquareOAuthPolicy({ environment: "production", applicationId, redirectUri, returnPath }), transport: async () => { throw new Error(canary); } });
  await rejects(() => production.exchangeAuthorizationCode({ applicationSecret: secret, authorizationCode: canary, requestedScopes: SQUARE_OAUTH_SCOPES, now }));
  eq(events, [], "Production does not emit consent diagnostics even when explicitly injected");
}
async function serviceTests() {
  // Actual Square service/broker/OAuth/discovery/store, injected synthetic RPC,
  // secret/KMS/transport only. No claim that synthetic RPC is a database commit.
  const state = "s".repeat(43);
  const command = { contractVersion: "integration_oauth_state_v1", id: id(4), workspaceId: actor.workspaceId, businessEntityId: id(5),
    connectionId: id(6), connectionGeneration: 1, providerKey: "square", providerEnvironment: "sandbox", initiatedBy: actor.actorId,
    requestedScopes: SQUARE_OAUTH_SCOPES, returnIntent: returnPath, stateHash: oauthStateHash(state), createdAt: now.toISOString(), expiresAt: expiry };
  for (const failure of ["lookup", "consume", "merchant", "locations", "main", "crosscheck", "store", "return", "denial"]) {
    checkpoint = `service_${failure}`;
    const c = collector(), attempt = c.begin(), events = [], data = replies(); let calls = 0, reads = 0, encrypts = 0;
    if (failure === "merchant") data[2] = { merchant: { id: canary } };
    if (failure === "locations") data[3] = { locations: [] };
    if (failure === "main") data[4] = {};
    if (failure === "crosscheck") data[4].location.currency = "CAD";
    const client = { async rpc(_name, { p_operation: op, p_command: value }) {
      events.push(op);
      let result = {};
      if (op === "lookup_state") result = failure === "lookup" ? { accepted: false, reasonCode: "state_missing" } : { accepted: true, command, rowVersion: 1 };
      if (op === "consume_state") result = failure === "consume" ? { accepted: false, reasonCode: "state_replayed" } : {
        accepted: true, stateId: command.id, workspaceId: command.workspaceId, businessEntityId: command.businessEntityId, connectionId: command.connectionId,
        connectionGeneration: 1, providerKey: "square", providerEnvironment: "sandbox", requestedScopes: SQUARE_OAUTH_SCOPES,
        returnIntent: returnPath, consumedAt: now.toISOString() };
      if (op === "deny_state") result = { accepted: true };
      if (op === "store_credential") {
        if (failure === "store") return { data: null, error: { synthetic: canary } };
        result = { credentialId: value.command.id, credentialVersion: 1, credentialStatus: "active", connectionStatus: "authorized_unmapped", idempotent: false };
      }
      return { data: result, error: null };
    } };
    const service = createSquareAccountConnectionService({ client, enrollmentClient: client, environment: "sandbox", applicationId,
      redirectUri, observeConsent: attempt.observe, clock: () => now, kmsKeyResource: "projects/synthetic/locations/us-west1/keyRings/synthetic/cryptoKeys/synthetic",
      secrets: { async access() { reads++; return secret; } }, kms: { async encrypt() { encrypts++; return Buffer.from("synthetic_ciphertext"); }, async decrypt() { throw new Error(canary); } },
      transport: async () => { calls++; return response(data.shift()); } });
    const run = () => service.complete(actor, failure === "denial" ? { state, error: "access_denied" } : { state, code: canary });
    if (["return", "denial"].includes(failure)) { await run(); attempt.finish("callback_returned"); }
    else { await rejects(run); attempt.finish("failed"); }
    const expected = { lookup: "callback_authority_checks", consume: "state_consume", merchant: "merchant_validation", locations: "locations_validation",
      main: "main_location_validation", crosscheck: "discovery_verification", store: "fenced_store_requested" }[failure];
    if (expected) eq(c.value.snapshot().lastFailure.stage, expected, failure);
    else { eq(c.value.snapshot().lastFailure, null); eq(c.value.snapshot().lastOutcome, "callback_returned"); }
    if (["lookup", "consume", "denial"].includes(failure)) { eq(reads, 0); eq(calls, 0); eq(encrypts, 0); }
    if (["merchant", "locations", "main", "crosscheck"].includes(failure)) eq(encrypts, 0);
    if (failure === "store") { eq(events.filter(op => op === "store_credential").length, 1); eq(encrypts, 1); eq(calls, 5); }
    ok(!JSON.stringify(c.writes).includes(canary));
  }
}
async function runtimeTests() {
  // Actual native composition wrappers; only constructor dependencies are
  // synthetic here. Actual authority/parser behavior is tested separately above
  // and by the existing identity/credential qualification, not claimed by stubs.
  const contracts = require("../lib/integrations/control-plane/square-gcp-callback-contracts.ts");
  const db = require("../lib/integrations/control-plane/square-gcp-callback-database.ts");
  const identity = require("../lib/integrations/control-plane/square-gcp-callback-identity.ts");
  const credentials = require("../lib/integrations/control-plane/square-gcp-callback-credentials.ts");
  const serviceModule = require("../lib/integrations/providers/square/account-connection-service.ts");
  const portalModule = require("../services/square-sandbox-callback/src/portal.ts");
  const auth = require("../services/square-sandbox-callback/src/auth.ts");
  const restore = [];
  const patch = (module, key, value) => { const before = module[key]; restore.push(() => { module[key] = before; }); module[key] = value; };
  const binding = { providerCallsEnabled: true, applicationId, applicationOrigin: "https://synthetic.invalid", kmsKeyResource: "synthetic" };
  const { createNativeSquareSandboxPortal } = require("../services/square-sandbox-callback/src/runtime.ts");
  try {
    patch(contracts, "checkedSquareGcpCallbackBinding", value => value);
    patch(db, "checkedSquareGcpCallbackDatabaseCa", value => value);
    patch(identity, "createSquareGcpCallbackIdentity", () => ({ async verify() {}, dispose() {} }));
    patch(credentials, "readSquareGcpCallbackDatabaseSecret", async () => canary);
    patch(portalModule, "createSquareSandboxPortal", value => value);
    patch(auth, "createSquarePortalAuth", () => ({}));
    for (const failure of ["secret", "encrypt", "none", "cancel"]) {
      let reads = 0, encrypts = 0, closes = 0, disposed = 0;
      const error = new Error(canary), c = collector();
      patch(db, "openSquareGcpCallbackDatabase", async () => ({ binding, client: {}, async authorizeFirstConsent() {}, async close() { closes++; } }));
      patch(credentials, "createSquareGcpCallbackCredentials", () => ({ dispose() { disposed++; },
        secrets: { async access(provider, environment) { eq([provider, environment], ["square", "sandbox"]); reads++; if (failure === "secret") throw error; return secret; } },
        kms: { async encrypt(value) { eq(value, "synthetic-input"); encrypts++; if (failure === "encrypt") throw error; return "synthetic-output"; }, async decrypt() { throw error; } }
      }));
      patch(serviceModule, "createSquareAccountConnectionService", input => ({ async complete() {
        reportSquareConsentProgress(input.observeConsent, "callback_authority_checks");
        await input.secrets.access("square", "sandbox");
        if (failure === "cancel") { controller.abort(); await Promise.resolve(); reportSquareConsentProgress(input.observeConsent, "token_verified"); return; }
        await input.kms.encrypt("synthetic-input");
      } }));
      const controller = new AbortController();
      const portal = createNativeSquareSandboxPortal({ binding, publishableKey: "synthetic", databaseCa: "synthetic", network: global.fetch }, c.value);
      const scope = await portal.open(controller.signal);
      if (["none", "cancel"].includes(failure)) await scope.service.complete(actor, { state: "s".repeat(43), code: canary });
      else { assertions++; await assert.rejects(() => scope.service.complete(actor, {}), value => value === error); }
      eq(reads, 1); eq(encrypts, ["secret", "cancel"].includes(failure) ? 0 : 1);
      if (failure === "cancel") {
        eq(c.value.snapshot().lastFailure.stage, "application_secret_returned", "late native completion stage cannot replace cancellation");
        eq(c.value.snapshot().lastOutcome, "cancelled"); eq(c.value.snapshot().completed, 1); eq(c.value.snapshot().active, 0);
      }
      else if (failure !== "none") eq(c.value.snapshot().lastFailure.stage, failure === "secret" ? "application_secret_access" : "credential_encrypt_requested");
      else eq(c.value.snapshot().lastOutcome, "callback_returned");
      await scope.close(); await scope.close(); eq(closes, 1); eq(disposed, 1);
      ok(!JSON.stringify(c.writes).includes(canary));
    }
  } finally { for (const undo of restore.reverse()) undo(); }
}
const previousFetch = global.fetch;
global.fetch = () => { throw new Error("synthetic_default_network_forbidden"); };
(async () => { try {
  await collectionTests(); checkpoint = "file"; await fileTests(); checkpoint = "oauth"; await oauthTests(); await serviceTests();
  checkpoint = "runtime"; await runtimeTests();
  eq(new Set(SQUARE_CONSENT_STAGES).size, SQUARE_CONSENT_STAGES.length);
  process.stdout.write(`Square consent diagnostics: ${assertions} synthetic checks passed.\n`);
} finally { global.fetch = previousFetch; } })().catch(() => { process.stderr.write(`Square consent diagnostics qualification failed at ${checkpoint}, assertion ${assertions}.\n`); process.exitCode = 1; });
