const assert = require("node:assert/strict");
const crypto = require("node:crypto");
require("./square-account-browser-test-support.js").loadSquareBrowserModules();
const { createSquareRemoteSandboxEnrolledCredentials: create } = require("../lib/integrations/control-plane/square-remote-sandbox-credentials.ts");
const { SQUARE_REMOTE_SANDBOX: constants } = require("../lib/integrations/control-plane/square-remote-sandbox-contracts.ts");
const { credentialAad, credentialAadDigest } = require("../lib/integrations/credentials/kms.ts");
const { IntegrationCredentialBroker } = require("../lib/integrations/credentials/broker.ts");
const { createSquareOAuthPolicy, createSquareOAuthCredentialProvider, SQUARE_OAUTH_SCOPES } = require("../lib/integrations/providers/square/account-connection-oauth.ts");
const uuid = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const canary = "PRIVATE_SYNTHETIC_REMOTE_CREDENTIAL_ONLY";
const binding = {
  contractVersion: constants.contractVersion, projectRef: constants.projectRef,
  vercelTeamId: constants.vercelTeamId, vercelTeamSlug: "vaeroex-2167s-projects",
  vercelProjectId: "prj_SyntheticSquareSandboxOnly123", vercelProjectName: constants.vercelProjectName,
  applicationOrigin: constants.applicationOrigin, environment: "sandbox", applicationId: constants.applicationId,
  apiVersion: constants.apiVersion, operatorId: uuid(1), workspaceId: uuid(2), businessEntityId: uuid(3), operatorRole: "owner",
  brokerLogin: "square_sandbox_broker", enrollerLogin: "square_sandbox_enroller", webhookLogin: "square_sandbox_webhook", runtimeLogin: "square_sandbox_runtime",
  approvalExpiresAt: new Date(Date.now() + 3600000).toISOString(), enabled: true, providerCallsEnabled: true,
  policyVersion: "synthetic_test_only_v1", policyFingerprint: `sha256:${"1".repeat(64)}`,
  kmsKeyResource: "projects/synthetic-square/locations/global/keyRings/test/cryptoKeys/test",
  appSecretVersionResource: "projects/synthetic-square/secrets/app-secret/versions/1",
  webhookSecretVersionResource: "projects/synthetic-square/secrets/webhook-secret/versions/1",
  credentialServiceAccount: "square-sandbox@synthetic-square.iam.gserviceaccount.com",
  workloadIdentityAudience: "//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/square-sandbox/providers/vercel"
};
const context = { schemaVersion: "oauth_credential_aad_v1", purpose: "provider_oauth_credential", environment: "sandbox",
  workspaceId: binding.workspaceId, connectionId: uuid(4), connectionGeneration: 1, providerKey: "square", credentialId: uuid(5) };
const appSecret = { schemaVersion: "provider_application_secret_v1", providerKey: "square", environment: "sandbox",
  clientId: binding.applicationId, clientSecret: canary };
const secretReply = () => ({ name: binding.appSecretVersionResource, payload: { data: Buffer.from(JSON.stringify(appSecret)).toString("base64") } });
let assertions = 0;
const equal = (a, b, label) => { assertions++; assert.deepEqual(a, b, label); };
const ok = (value, label) => { assertions++; assert.ok(value, label); };
const throws = run => { assertions++; assert.throws(run); };
const rejects = async (run, label) => { assertions++; await assert.rejects(run, error => {
  assert.ok(!`${error.message}${JSON.stringify(error)}`.includes(canary), label); return true;
}); };
const originalFetch = global.fetch;
global.fetch = () => assert.fail("no test may call a real/default network");
function json(value, options) { return new Response(JSON.stringify(value), options); }
function fixture(options = {}) {
  const calls = [], authority = [], abort = new AbortController();
  let verifies = 0;
  const dependencies = {
    binding, credentialContext: context, signal: abort.signal,
    authorizeCurrentEnrollment: async request => {
      authority.push({ purpose: request.purpose, context: request.context });
      equal(request.context, context); ok(Object.isFrozen(request.context)); ok(!request.signal.aborted);
      if (options.authorize) return options.authorize(request, authority.length);
      return binding;
    },
    verifyDeployment: async current => { verifies++; equal(current, binding); return `SYNTHETIC_OIDC_${canary}`; },
    network: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      calls.push({ url, init, body });
      equal(init.redirect, "error"); equal(init.cache, "no-store"); equal(init.credentials, "omit");
      if (options.network) { const result = await options.network(url, init, calls.length); if (result !== undefined) return result; }
      if (url === "https://sts.googleapis.com/v1/token") {
        equal(init.headers.Authorization, undefined); equal(body.audience, binding.workloadIdentityAudience);
        equal(body.subjectToken, `SYNTHETIC_OIDC_${canary}`);
        equal(body.grantType, "urn:ietf:params:oauth:grant-type:token-exchange");
        equal(body.requestedTokenType, "urn:ietf:params:oauth:token-type:access_token");
        equal(body.subjectTokenType, "urn:ietf:params:oauth:token-type:jwt");
        return json({ access_token: `STS_${canary}`, token_type: "Bearer", issued_token_type: body.requestedTokenType, expires_in: 3600 });
      }
      if (url === `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${binding.credentialServiceAccount}:generateAccessToken`) {
        equal(init.headers.Authorization, `Bearer STS_${canary}`);
        equal(body, { scope: ["https://www.googleapis.com/auth/cloud-platform"], lifetime: "300s" });
        return json({ accessToken: `IAM_${canary}`, expireTime: new Date(Date.now() + 295000).toISOString() });
      }
      equal(init.headers.Authorization, `Bearer IAM_${canary}`);
      if (url === `https://secretmanager.googleapis.com/v1/${binding.appSecretVersionResource}:access`) {
        equal(init.method, "GET"); equal(init.body, undefined); return json(secretReply());
      }
      if (url === `https://cloudkms.googleapis.com/v1/${binding.kmsKeyResource}:encrypt`) {
        const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.alloc(32, 7), Buffer.alloc(12, 5));
        cipher.setAAD(Buffer.from(body.additionalAuthenticatedData, "base64"));
        const encrypted = Buffer.concat([cipher.update(Buffer.from(body.plaintext, "base64")), cipher.final()]);
        return json({ ciphertext: Buffer.concat([cipher.getAuthTag(), encrypted]).toString("base64") });
      }
      if (url === `https://cloudkms.googleapis.com/v1/${binding.kmsKeyResource}:decrypt`) {
        const bytes = Buffer.from(body.ciphertext, "base64");
        const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.alloc(32, 7), Buffer.alloc(12, 5));
        decipher.setAAD(Buffer.from(body.additionalAuthenticatedData, "base64")); decipher.setAuthTag(bytes.subarray(0, 16));
        return json({ plaintext: Buffer.concat([decipher.update(bytes.subarray(16)), decipher.final()]).toString("base64") });
      }
      assert.fail("only fixed GCP paths are permitted in this synthetic fixture");
    }
  };
  return { dependencies, calls, authority, abort, get verifies() { return verifies; }, value: create(dependencies) };
}
const encrypt = (fixture, plaintext = Buffer.from(canary), aad = credentialAad(context)) => fixture.value.kms.encrypt({
  keyResource: binding.kmsKeyResource, plaintext, additionalAuthenticatedData: aad
});
const decrypt = (fixture, ciphertext, aad = credentialAad(context)) => fixture.value.kms.decrypt({
  keyResource: binding.kmsKeyResource, ciphertext, additionalAuthenticatedData: aad
});
async function main() {
  const initial = fixture();
  const secret = await initial.value.secrets.access("square", "sandbox");
  equal(secret.use(value => value.clientId), binding.applicationId);
  ok(!JSON.stringify(secret).includes(canary)); equal(initial.calls.length, 3); equal(initial.authority.length, 5);
  const encrypted = await encrypt(initial);
  equal((await decrypt(initial, encrypted)).toString(), canary);
  equal(initial.calls.length, 9); equal(initial.verifies, 3);
  equal(initial.calls.filter(call => call.url.includes("sts.googleapis.com")).length, 3, "no cached federated/provider token");
  initial.value.dispose(); await rejects(() => initial.value.secrets.access("square", "sandbox"));
  equal(initial.calls.length, 9, "disposed request cannot contact provider");

  const normalized = fixture({ network: (_url, _init, count) => count === 3 ? json({ ...secretReply(),
    name: binding.appSecretVersionResource.replace("projects/synthetic-square/", "projects/123456789012/") }) : undefined });
  equal((await normalized.value.secrets.access("square", "sandbox")).use(value => value.clientId), binding.applicationId);
  equal(normalized.calls[2].url, `https://secretmanager.googleapis.com/v1/${binding.appSecretVersionResource}:access`, "canonical response cannot change approved request authority");

  for (const key of ["authorizeCurrentEnrollment", "verifyDeployment", "network", "signal"]) {
    const input = { ...fixture().dependencies }; delete input[key]; throws(() => create(input));
  }
  for (const [key, value] of [["providerCallsEnabled", false], ["enabled", false], ["kmsKeyResource", null], ["appSecretVersionResource", null],
    ["webhookSecretVersionResource", null], ["credentialServiceAccount", null], ["workloadIdentityAudience", null],
    ["environment", "production"], ["projectRef", "foreign-project"], ["applicationId", "sq0idp-production"],
    ["approvalExpiresAt", new Date(0).toISOString()], ["appSecretVersionResource", binding.appSecretVersionResource.replace("/1", "/latest")]]) {
    throws(() => create({ ...fixture().dependencies, binding: { ...binding, [key]: value } }));
  }
  for (const [key, value] of [["workspaceId", uuid(9)], ["providerKey", "qbo"], ["environment", "production"]]) {
    throws(() => create({ ...fixture().dependencies, credentialContext: { ...context, [key]: value } }));
  }
  let accessed = 0;
  const accessor = { ...fixture().dependencies }; Object.defineProperty(accessor, "network", { enumerable: true, get() { accessed++; return originalFetch; } });
  throws(() => create(accessor)); equal(accessed, 0);
  const proxy = new Proxy(fixture().dependencies, { ownKeys() { accessed++; return []; } }); throws(() => create(proxy)); equal(accessed, 0);
  for (const [key, value] of [["workspaceId", uuid(9)], ["connectionId", uuid(9)], ["connectionGeneration", 2], ["credentialId", uuid(9)], ["environment", "production"]]) {
    const mismatch = fixture(); await rejects(() => encrypt(mismatch, Buffer.from(canary), credentialAad({ ...context, [key]: value })));
    equal(mismatch.calls.length, 0, "foreign AAD denied before WIF or secret access");
  }
  for (const [provider, environment] of [["qbo", "sandbox"], ["square", "production"]]) {
    const mismatch = fixture(); await rejects(() => mismatch.value.secrets.access(provider, environment)); equal(mismatch.calls.length, 0);
  }
  const wrongKey = fixture(); await rejects(() => wrongKey.value.kms.encrypt({ keyResource: binding.kmsKeyResource + "foreign", plaintext: Buffer.from(canary), additionalAuthenticatedData: credentialAad(context) })); equal(wrongKey.calls.length, 0);

  for (let failureAt = 1; failureAt <= 5; failureAt++) {
    const stale = fixture({ authorize: (_, count) => count === failureAt ? { ...binding, policyFingerprint: `sha256:${"2".repeat(64)}` } : binding });
    await rejects(() => stale.value.secrets.access("square", "sandbox"), "every stage rechecks immutable approved binding");
    const count = stale.calls.length; await rejects(() => stale.value.secrets.access("square", "sandbox")); equal(stale.calls.length, count, "failed request remains fenced");
  }
  for (const reason of ["missing_enrollment", "synthetic_only", "stale_generation", "missing_mapping", "retention_unapproved", "revoked"]) {
    const denied = fixture({ authorize: () => { throw new Error(reason + canary); } });
    await rejects(() => encrypt(denied)); equal(denied.calls.length, 0);
  }
  for (const endpoint of [1, 2, 3]) {
    const denied = fixture({ network: (_url, _init, count) => count === endpoint ? json({ error: canary }, { status: 403 }) : undefined });
    await rejects(() => denied.value.secrets.access("square", "sandbox")); equal(denied.calls.length, endpoint, "no IAM fallback or retry");
  }
  for (const reply of [
    { ...secretReply(), name: binding.webhookSecretVersionResource },
    ...["projects/123456789012/secrets/foreign-secret/versions/1", "projects/123456789012/secrets/app-secret/versions/2",
      "projects/123456789012/locations/global/secrets/app-secret/versions/1", "projects/foreign-project/secrets/app-secret/versions/1",
      "projects/012345678901/secrets/app-secret/versions/1", "projects/123456789012/secrets/app-secret/versions/latest"]
      .map(name => ({ ...secretReply(), name })),
    { ...secretReply(), payload: { data: Buffer.from(JSON.stringify({ ...appSecret, environment: "production" })).toString("base64") } },
    { ...secretReply(), payload: { data: Buffer.from(JSON.stringify({ ...appSecret, clientId: "foreign-app" })).toString("base64") } },
    { ...secretReply(), payload: { data: "!!!!" } },
    { ...secretReply(), payload: { data: Buffer.alloc(65537).toString("base64") } }
  ]) {
    const invalid = fixture({ network: (_url, _init, count) => count === 3 ? json(reply) : undefined });
    await rejects(() => invalid.value.secrets.access("square", "sandbox"));
  }
  for (const reply of [
    { access_token: `STS_${canary}`, token_type: "MAC", issued_token_type: "urn:ietf:params:oauth:token-type:access_token", expires_in: 3600 },
    { access_token: `STS_${canary}`, token_type: "Bearer", issued_token_type: "wrong", expires_in: 3600 },
    { access_token: `STS_${canary}`, token_type: "Bearer", issued_token_type: "urn:ietf:params:oauth:token-type:access_token", expires_in: 3601 },
    { access_token: `${canary}\n`, token_type: "Bearer", issued_token_type: "urn:ietf:params:oauth:token-type:access_token", expires_in: 3600 }
  ]) {
    const invalid = fixture({ network: (_url, _init, count) => count === 1 ? json(reply) : undefined });
    await rejects(() => encrypt(invalid)); equal(invalid.calls.length, 1);
  }
  for (const expiry of [new Date(0).toISOString(), new Date(Date.now() + 3600_000).toISOString(), "invalid"]) {
    const invalid = fixture({ network: (_url, _init, count) => count === 2 ? json({ accessToken: canary, expireTime: expiry }) : undefined });
    await rejects(() => encrypt(invalid)); equal(invalid.calls.length, 2);
  }
  for (const size of [32768, 32769]) {
    const largest = fixture();
    if (size === 32768) equal((await decrypt(largest, await encrypt(largest, Buffer.alloc(size, 9)))).length, size);
    else { await rejects(() => encrypt(largest, Buffer.alloc(size))); equal(largest.calls.length, 0); }
  }
  for (const size of [131072, 131073]) {
    const largest = fixture({ network: (_url, _init, count) => count === 3 ? json({ plaintext: Buffer.from("synthetic").toString("base64") }) : undefined });
    if (size === 131072) equal((await decrypt(largest, Buffer.alloc(size))).toString(), "synthetic");
    else { await rejects(() => decrypt(largest, Buffer.alloc(size))); equal(largest.calls.length, 0); }
  }

  // Exact wire cap from the derived KMS bound, with large and one-byte chunks.
  const padded = { ...secretReply(), padding: "" };
  padded.padding = "x".repeat(262144 - Buffer.byteLength(JSON.stringify(padded)));
  const exact = Buffer.from(JSON.stringify(padded)); equal(exact.length, 262144);
  for (const chunkSize of [1, 65536, 262144]) {
    const maximum = fixture({ network: (_url, _init, count) => count === 3 ? new Response(new ReadableStream({
      start(controller) { for (let offset = 0; offset < exact.length; offset += chunkSize) controller.enqueue(exact.subarray(offset, offset + chunkSize)); controller.close(); }
    })) : undefined });
    equal((await maximum.value.secrets.access("square", "sandbox")).use(value => value.clientId), binding.applicationId);
  }
  for (const bytes of [Buffer.concat([exact, Buffer.from(" ")]), Buffer.from('{"payload":'), Buffer.from([0xff])]) {
    const invalid = fixture({ network: (_url, _init, count) => count === 3 ? new Response(bytes) : undefined });
    await rejects(() => invalid.value.secrets.access("square", "sandbox"));
  }
  for (const reply of [new Response("", { status: 302, headers: { location: "https://foreign.invalid" } }),
    new Response("{}", { headers: { "content-length": "262145" } })]) {
    const invalid = fixture({ network: () => reply }); await rejects(() => encrypt(invalid)); equal(invalid.calls.length, 1);
  }
  const preAborted = fixture(); preAborted.abort.abort(); await rejects(() => encrypt(preAborted)); equal(preAborted.calls.length, 0);
  const unhandled = [], onUnhandled = reason => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    for (const stage of ["authorizeCurrentEnrollment", "verifyDeployment", "network"]) {
      const aborting = fixture();
      const value = create({ ...aborting.dependencies, [stage]: async () => { aborting.abort.abort(); throw new Error(canary); } });
      await rejects(() => value.secrets.access("square", "sandbox"));
      await new Promise(resolve => setImmediate(resolve));
      equal(unhandled.length, 0, "synchronous abort plus rejection is always observed privately");
    }
  } finally { process.removeListener("unhandledRejection", onUnhandled); }
  let finishNetwork, lateCancelled = 0;
  const pending = fixture({ network: () => new Promise(resolve => { finishNetwork = resolve; }) });
  const waiting = encrypt(pending); await new Promise(resolve => setImmediate(resolve));
  pending.abort.abort(); await rejects(() => waiting);
  finishNetwork(new Response(new ReadableStream({ cancel() { lateCancelled++; } })));
  await new Promise(resolve => setImmediate(resolve)); equal(lateCancelled, 1); equal(pending.calls.length, 1);
  let finishRead, cancelledRead = 0;
  const reading = fixture({ network: () => new Response(new ReadableStream({ pull() { return new Promise(resolve => { finishRead = resolve; }); }, cancel() { cancelledRead++; } })) });
  const readWait = encrypt(reading); await new Promise(resolve => setImmediate(resolve));
  reading.value.dispose(); await rejects(() => readWait); finishRead(); await new Promise(resolve => setImmediate(resolve)); equal(cancelledRead, 1);
  let releaseAuthority;
  const concurrent = fixture({ authorize: () => new Promise(resolve => { releaseAuthority = resolve; }) });
  const first = encrypt(concurrent); await rejects(() => encrypt(concurrent), "concurrent operations cannot retain parallel credentials");
  concurrent.value.dispose(); await rejects(() => first); releaseAuthority(binding); await new Promise(resolve => setImmediate(resolve)); equal(concurrent.calls.length, 0);

  const operationBound = fixture();
  for (let count = 0; count < 32; count++) await operationBound.value.secrets.access("square", "sandbox");
  equal(operationBound.calls.length, 96); await rejects(() => operationBound.value.secrets.access("square", "sandbox"));
  equal(operationBound.calls.length, 96, "first operation above request limit causes no network"); operationBound.value.dispose();
  const realNow = Date.now, timeBase = realNow();
  try {
    Date.now = () => timeBase;
    const expiry = fixture();
    Date.now = () => timeBase + 59999;
    await expiry.value.secrets.access("square", "sandbox"); equal(expiry.calls.length, 3);
    Date.now = () => timeBase + 60000;
    await rejects(() => expiry.value.secrets.access("square", "sandbox")); equal(expiry.calls.length, 3, "60-second request deadline is exclusive");
  } finally { Date.now = realNow; }
  const realSetTimeout = global.setTimeout, realClearTimeout = global.clearTimeout;
  const timers = new Map(); let timerId = 0;
  try {
    global.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; };
    global.clearTimeout = id => { timers.delete(id); };
    let lateTimeout;
    const timed = fixture({ network: () => new Promise(resolve => { lateTimeout = resolve; }) });
    const result = encrypt(timed); await new Promise(resolve => setImmediate(resolve));
    equal([...timers.values()].filter(timer => timer.delay === 5000).length, 1, "only one active step wait is retained");
    [...timers.values()].find(timer => timer.delay === 5000).callback();
    await rejects(() => result); equal(timers.size, 0, "step timeout clears all request timers");
    lateTimeout(json({ ignored: canary })); await new Promise(resolve => setImmediate(resolve));
    equal(timed.calls.length, 1); await rejects(() => encrypt(timed)); equal(timed.calls.length, 1);
  } finally { global.setTimeout = realSetTimeout; global.clearTimeout = realClearTimeout; }

  // Existing broker refresh lifecycle using synthetic AES-GCM behind the adapter's
  // exact fixed KMS HTTP protocol; Square itself is an injected synthetic stream.
  const enrolled = fixture(), now = new Date(), expiry = new Date(now.getTime() + 86400_000).toISOString();
  const envelope = { schemaVersion: "oauth_credential_envelope_v1", providerKey: "square", environment: "sandbox",
    externalAuthorizedEntityReference: "SYNTHETIC_SELLER", accessToken: `OLD_${canary}`, accessExpiresAt: expiry,
    refreshToken: `REFRESH_${canary}`, refreshExpiresAt: null, grantedScopes: [...SQUARE_OAUTH_SCOPES], issuedAt: now.toISOString(), updatedAt: now.toISOString() };
  const ciphertext = await encrypt(enrolled, Buffer.from(JSON.stringify(envelope)));
  const policy = createSquareOAuthPolicy({ environment: "sandbox", applicationId: binding.applicationId,
    redirectUri: `${binding.applicationOrigin}/api/integrations/square/callback`, returnPath: "/app/settings/integrations/square" });
  let providerCalls = 0, rotated;
  const events = [];
  const provider = createSquareOAuthCredentialProvider({ policy, applicationId: binding.applicationId, transport: async request => {
    providerCalls++;
    const reply = request.url.endsWith("/status") ? { scopes: [...SQUARE_OAUTH_SCOPES], expires_at: expiry, client_id: binding.applicationId, merchant_id: "SYNTHETIC_SELLER" } :
      { access_token: `NEW_${canary}`, refresh_token: envelope.refreshToken, token_type: "bearer", expires_at: expiry, merchant_id: "SYNTHETIC_SELLER", short_lived: true };
    return { status: 200, body: (async function*() { yield Buffer.from(JSON.stringify(reply)); })(), close() {} };
  } });
  const broker = new IntegrationCredentialBroker({ provider, providerOAuthPolicy: policy, kmsKeyResource: binding.kmsKeyResource,
    kms: enrolled.value.kms, secrets: enrolled.value.secrets, clock: () => now, store: {
      async acquireRefreshLease(command) { return { acquired: true, credentialId: context.credentialId, credentialVersion: 1,
        ciphertextBase64: ciphertext.toString("base64"), aadDigest: credentialAadDigest(context), kmsKeyResource: binding.kmsKeyResource, aadContext: context,
        providerEnvironment: "sandbox", grantedScopes: [...SQUARE_OAUTH_SCOPES], leaseId: command.leaseId,
        leaseOwnerFingerprint: command.leaseOwnerFingerprint, leaseExpiresAt: command.leaseExpiresAt }; },
      async rotateCredential(command) { rotated = command; return { credentialId: context.credentialId, credentialVersion: 2,
        credentialStatus: "active", connectionStatus: "authorized_unmapped", idempotent: false }; },
      async completeRefreshFailure() { assert.fail("synthetic enrolled broker refresh must succeed"); },
      async recordAuthorizationEvent(event) { events.push(event); }, async recordRefreshBoundaryEvent(event) { events.push(event); }
    } });
  const result = await broker.refreshCredential({ workspaceId: context.workspaceId, connectionId: context.connectionId,
    businessEntityId: binding.businessEntityId, credentialId: context.credentialId, connectionGeneration: 1, expectedCredentialVersion: 1,
    requiredScopes: SQUARE_OAUTH_SCOPES, workerId: "synthetic-square-worker", acquireRequestId: "synthetic-acquire-1",
    rotateRequestId: "synthetic-rotate-1", failureRequestId: "synthetic-failure-1" });
  equal(result, { state: "refreshed", refreshed: true, credentialVersion: 2 }); equal(providerCalls, 2);
  equal(rotated.aadDigest, credentialAadDigest(context)); ok(!JSON.stringify(events).includes(canary));
  equal(JSON.parse((await decrypt(enrolled, Buffer.from(rotated.ciphertextBase64, "base64"))).toString()).accessToken, `NEW_${canary}`);
  enrolled.value.dispose();
  console.log(`Square remote credential adapter regressions passed (${assertions} assertions; synthetic network only).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { global.fetch = originalFetch; });
