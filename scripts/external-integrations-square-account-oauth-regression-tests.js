const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = function(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
  }).outputText, filename);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const oauth = require("../lib/integrations/providers/square/account-connection-oauth.ts");
const { ProviderApplicationSecret } = require("../lib/integrations/credentials/secret-manager.ts");
const { assertCredentialEnvelopeMatchesProviderOAuthPolicy } = require("../lib/integrations/credentials/oauth-policy.ts");
const { IntegrationCredentialBroker } = require("../lib/integrations/credentials/broker.ts");
const { credentialAad, credentialAadDigest } = require("../lib/integrations/credentials/kms.ts");
const { squareAccountRpc, createSquareAccountBrokerStore, squareCredentialReadLeaseId } = require("../lib/integrations/providers/square/account-connection-broker.ts");
const now = new Date("2026-09-07T12:00:00.000Z");
const applicationId = "synthetic-square-application";
const redirectUri = "https://square-qualification.invalid/oauth/callback";
const returnPath = "/app/settings/integrations/square";
const merchantId = "SYNTHETIC_SELLER";
const state = "s".repeat(43);
const canary = "PRIVATE_SYNTHETIC_OAUTH_CANARY";
const secret = new ProviderApplicationSecret({ schemaVersion: "provider_application_secret_v1",
  providerKey: "square", environment: "sandbox", clientId: applicationId, clientSecret: canary });
const policy = oauth.createSquareOAuthPolicy({ environment: "sandbox", applicationId, redirectUri, returnPath });
const expiresAt = new Date(now.getTime() + 86_400_000).toISOString();
const token = () => ({ access_token: `ACCESS_${canary}`, refresh_token: `REFRESH_${canary}`, token_type: "bearer",
  expires_at: expiresAt, merchant_id: merchantId, short_lived: true });
const status = () => ({ scopes: [...oauth.SQUARE_OAUTH_SCOPES], expires_at: expiresAt,
  client_id: applicationId, merchant_id: merchantId });
function response(value, size = 65536, statusCode = 200, onClose = () => {}) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  return { status: statusCode, body: (async function*() {
    for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size);
  })(), close: onClose };
}
function provider(replies = [token(), status()], options = {}) {
  const calls = [];
  let closes = 0;
  const transport = options.transport ?? (async request => { calls.push(request); return response(replies.shift(), options.chunkSize, 200, () => closes++); });
  return { calls, get closes() { return closes; }, value: oauth.createSquareOAuthCredentialProvider({ policy, applicationId, transport,
    signal: options.signal, timeoutMs: options.timeoutMs }), transport };
}
const exchange = value => value.exchangeAuthorizationCode({ applicationSecret: secret, authorizationCode: "synthetic-code",
  requestedScopes: oauth.SQUARE_OAUTH_SCOPES, now });
let assertions = 0;
const equal = (a, b, label) => { assertions++; assert.deepEqual(a, b, label); };
const ok = (value, label) => { assertions++; assert.ok(value, label); };
const throws = (run, pattern) => { assertions++; assert.throws(run, pattern); };
async function rejects(run, code) {
  assertions++;
  await assert.rejects(run, error => {
    assert.equal(error.message, "provider_credential_refresh_failed");
    assert.ok(!JSON.stringify(error).includes(canary));
    if (code) assert.equal(error.code, code);
    return true;
  });
}
async function main() {
  equal(policy.requestedScopes, [...oauth.SQUARE_OAUTH_SCOPES]);
  equal(policy.tokenLifetime, { accessTokenMaximumSeconds: 86400, requiredAccessTokenLifetimeSeconds: 86400,
    providerShortLivedAccessTokenRequired: true });
  const authorization = new URL(oauth.squareAuthorizationUrl({ policy, applicationId, state }));
  equal(authorization.origin, "https://connect.squareupsandbox.com");
  equal(authorization.searchParams.get("scope"), oauth.SQUARE_OAUTH_SCOPES.join(" "));
  equal(authorization.searchParams.get("redirect_uri"), redirectUri);
  equal(authorization.searchParams.get("session"), "true", "Sandbox supports only the existing seller session");
  equal(authorization.searchParams.getAll("session"), ["true"]);
  const productionPolicy = oauth.createSquareOAuthPolicy({ environment: "production", applicationId, redirectUri, returnPath });
  const productionAuthorization = new URL(oauth.squareAuthorizationUrl({ policy: productionPolicy, applicationId, state }));
  equal(productionAuthorization.origin, "https://connect.squareup.com");
  equal(productionAuthorization.searchParams.getAll("session"), ["false"], "Production still forces seller login");
  for (const key of ["client_id", "redirect_uri", "scope", "state"]) equal(productionAuthorization.searchParams.get(key), authorization.searchParams.get(key));
  for (const [checked, foreign] of [[policy, productionPolicy], [productionPolicy, policy]]) {
    throws(() => oauth.squareAuthorizationUrl({ policy: { ...checked, authorizationEndpoint: foreign.authorizationEndpoint }, applicationId, state }));
  }
  equal(authorization.searchParams.has("code_challenge"), false);
  throws(() => oauth.createSquareOAuthPolicy({ environment: "sandbox", applicationId, redirectUri: "http://example.com/callback", returnPath }));
  throws(() => oauth.createSquareOAuthCredentialProvider({ policy: { ...policy, tokenEndpoint: "https://example.com/token" }, applicationId, transport: async () => response({}) }));
  for (const suffix of [`?state=${state}&code=synthetic-code`, `?code=synthetic-code&response_type=code&state=${state}`]) {
    equal(oauth.parseSquareOAuthCallback(redirectUri + suffix, redirectUri), { kind: "authorized", state, authorizationCode: "synthetic-code" });
  }
  equal(oauth.parseSquareOAuthCallback(`${redirectUri}?state=${state}&error=access_denied&error_description=${canary}`, redirectUri), { kind: "denied", state });
  for (const suffix of ["", `?state=${state}`, `?state=${state}&state=${state}&code=x`, `?state=${state}&code=x&code=x`,
    `?state=${state}&code=x&error=access_denied`, `?state=${state}&code=x&response_type=token`,
    `?state=${state}&code=x&extra=${canary}`, `?state=${state}&code=x#error`, `?state=${state}&code=x&error_description=x`,
    `?state=${state}&code=${"x".repeat(192)}`, "?state=bad&code=x"])
    throws(() => oauth.parseSquareOAuthCallback(redirectUri + suffix, redirectUri), /^Error: square_oauth_callback_rejected$/);
  throws(() => oauth.parseSquareOAuthCallback(`https://foreign.invalid/oauth/callback?state=${state}&code=x`, redirectUri), /square_oauth_callback_rejected/);

  const initial = provider();
  const envelope = await exchange(initial.value);
  equal(initial.calls.length, 2); equal(initial.closes, 2);
  equal(initial.calls.map(call => call.url), ["https://connect.squareupsandbox.com/oauth2/token", "https://connect.squareupsandbox.com/oauth2/token/status"]);
  equal(initial.calls[0].headers["Square-Version"], "2026-08-19");
  equal(JSON.parse(initial.calls[0].body), { client_id: applicationId, client_secret: canary,
    code: "synthetic-code", redirect_uri: redirectUri, grant_type: "authorization_code", short_lived: true });
  equal(initial.calls[1].body, null); equal(initial.calls[1].headers.Authorization, `Bearer ACCESS_${canary}`);
  equal(envelope.externalAuthorizedEntityReference, merchantId);
  equal(envelope.refreshExpiresAt, null); equal(envelope.updatedAt, now.toISOString());
  equal(envelope.grantedScopes, [...oauth.SQUARE_OAUTH_SCOPES]);
  equal(assertCredentialEnvelopeMatchesProviderOAuthPolicy(policy, envelope), envelope);
  const later = new Date(now.getTime() + 10_000), nextExpiry = new Date(later.getTime() + 86400_000).toISOString();
  const refreshing = provider([{ ...token(), access_token: `NEXT_${canary}`, expires_at: nextExpiry }, { ...status(), expires_at: nextExpiry }]);
  const refreshed = await refreshing.value.refreshCredential({ credential: envelope, applicationSecret: secret, now: later });
  equal(refreshed.issuedAt, envelope.issuedAt); equal(refreshed.updatedAt, later.toISOString());
  equal(refreshed.refreshToken, envelope.refreshToken);
  equal(JSON.parse(refreshing.calls[0].body), { client_id: applicationId, client_secret: canary,
    refresh_token: envelope.refreshToken, grant_type: "refresh_token", scopes: [...oauth.SQUARE_OAUTH_SCOPES], short_lived: true });
  for (const [change, statusChange] of [
    [{ short_lived: false }, {}], [{ refresh_token_expires_at: expiresAt }, {}], [{ token_type: "mac" }, {}],
    [{ access_token: undefined }, {}], [{ refresh_token: undefined }, {}], [{ merchant_id: "FOREIGN" }, {}],
    [{ access_token: `${canary}\r\nInjected: true` }, {}],
    [{}, { client_id: "foreign-application" }], [{}, { merchant_id: "FOREIGN" }],
    [{}, { scopes: [...oauth.SQUARE_OAUTH_SCOPES, "PAYMENTS_WRITE"] }], [{}, { scopes: oauth.SQUARE_OAUTH_SCOPES.slice(1) }],
    [{}, { scopes: Array(5).fill("PAYMENTS_READ") }], [{}, { expires_at: now.toISOString() }]
  ]) await rejects(() => exchange(provider([{ ...token(), ...change }, { ...status(), ...statusChange }]).value));
  await rejects(() => provider([{ ...token(), refresh_token: `DIFFERENT_${canary}` }, status()]).value.refreshCredential({ credential: envelope, applicationSecret: secret, now }));
  for (const skew of [-60_001, 60_001]) {
    const expiry = new Date(Date.parse(expiresAt) + skew).toISOString();
    await rejects(() => exchange(provider([{ ...token(), expires_at: expiry }, { ...status(), expires_at: expiry }]).value));
  }
  for (const skew of [-60_000, 1_000, 60_000]) {
    const expiry = new Date(Date.parse(expiresAt) + skew).toISOString();
    const skewEnvelope = await exchange(provider([{ ...token(), expires_at: expiry }, { ...status(), expires_at: expiry }]).value);
    equal(skewEnvelope.accessExpiresAt, expiry);
    equal(Date.parse(skewEnvelope.accessExpiresAt) - Date.parse(skewEnvelope.updatedAt), 86400_000);
  }
  // Run the real broker, not just the adapter: issuance one second after its request
  // clock must not create an invalid 86,401-second diagnostic or prevent the CAS.
  const ids = { workspaceId: "11111111-1111-4111-8111-111111111111", connectionId: "22222222-2222-4222-8222-222222222222",
    businessEntityId: "33333333-3333-4333-8333-333333333333", credentialId: "44444444-4444-4444-8444-444444444444" };
  const aadContext = { schemaVersion: "oauth_credential_aad_v1", purpose: "provider_oauth_credential", environment: "sandbox",
    workspaceId: ids.workspaceId, connectionId: ids.connectionId, connectionGeneration: 1, providerKey: "square", credentialId: ids.credentialId };
  const kmsKeyResource = "projects/synthetic-square/locations/global/keyRings/test/cryptoKeys/test";
  const syntheticKey = Buffer.alloc(32, 7);
  const kms = {
    async encrypt(request) {
      const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", syntheticKey, iv);
      cipher.setAAD(request.additionalAuthenticatedData);
      const bytes = Buffer.concat([cipher.update(request.plaintext), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    },
    async decrypt(request) {
      const bytes = Buffer.from(request.ciphertext), decipher = crypto.createDecipheriv("aes-256-gcm", syntheticKey, bytes.subarray(0, 12));
      decipher.setAAD(request.additionalAuthenticatedData); decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    }
  };
  const ciphertext = await kms.encrypt({ plaintext: Buffer.from(JSON.stringify(envelope)), additionalAuthenticatedData: credentialAad(aadContext) });
  const boundary = []; let rotated;
  const plusOneExpiry = new Date(Date.parse(expiresAt) + 1_000).toISOString();
  const brokerProvider = provider([{ ...token(), access_token: `REFRESHED_${canary}`, expires_at: plusOneExpiry }, { ...status(), expires_at: plusOneExpiry }]);
  const broker = new IntegrationCredentialBroker({ provider: brokerProvider.value, providerOAuthPolicy: policy,
    kmsKeyResource, kms, clock: () => new Date(now), secrets: { async access() { return secret; } }, store: {
      async acquireRefreshLease(command) { return { acquired: true, credentialId: ids.credentialId, credentialVersion: 1,
        ciphertextBase64: ciphertext.toString("base64"), aadDigest: credentialAadDigest(aadContext), kmsKeyResource, aadContext,
        providerEnvironment: "sandbox", grantedScopes: [...oauth.SQUARE_OAUTH_SCOPES], leaseId: command.leaseId,
        leaseOwnerFingerprint: command.leaseOwnerFingerprint, leaseExpiresAt: command.leaseExpiresAt }; },
      async rotateCredential(command) { rotated = command; return { credentialId: ids.credentialId, credentialVersion: 2,
        credentialStatus: "active", connectionStatus: "authorized_unmapped", idempotent: false }; },
      async completeRefreshFailure() { assert.fail("valid Square issuance after request clock must not fail refresh"); },
      async recordAuthorizationEvent() {}, async recordRefreshBoundaryEvent(event) { boundary.push(event); }
    } });
  const brokerResult = await broker.refreshCredential({ ...ids, connectionGeneration: 1, expectedCredentialVersion: 1,
    requiredScopes: oauth.SQUARE_OAUTH_SCOPES, workerId: "synthetic-square-worker", acquireRequestId: "acquire-1",
    rotateRequestId: "rotate-1", failureRequestId: "failure-1" });
  equal(brokerResult, { state: "refreshed", refreshed: true, credentialVersion: 2 });
  equal(rotated.accessExpiresAt, plusOneExpiry); equal(brokerProvider.calls.length, 2);
  const diagnostics = boundary.filter(event => event.diagnostics).map(event => event.diagnostics);
  ok(diagnostics.length >= 2);
  for (const diagnostic of diagnostics) { equal(diagnostic.accessExpiresInSeconds, 86_400); equal(diagnostic.refreshExpiresInSeconds, null); }
  ok(!JSON.stringify(boundary).includes(canary), "broker diagnostic events never contain credentials");
  const wrongSecret = new ProviderApplicationSecret({ schemaVersion: "provider_application_secret_v1", providerKey: "square",
    environment: "production", clientId: applicationId, clientSecret: canary });
  const neverCall = provider();
  await rejects(() => neverCall.value.exchangeAuthorizationCode({ applicationSecret: wrongSecret, authorizationCode: "code",
    requestedScopes: oauth.SQUARE_OAUTH_SCOPES, now })); equal(neverCall.calls.length, 0);
  await rejects(() => initial.value.exchangeAuthorizationCode({ applicationSecret: secret, authorizationCode: "code",
    requestedScopes: ["PAYMENTS_WRITE"], now }), "scope_loss");

  // Exact byte boundary, aggregate KMS boundary, UTF-8/escaping and many tiny reads.
  const padded = { ...token(), padding: Array(16).fill("") };
  let paddingBytes = 65536 - Buffer.byteLength(JSON.stringify(padded));
  for (let index = 0; paddingBytes; index++) { const length = Math.min(paddingBytes, 4096); padded.padding[index] = "x".repeat(length); paddingBytes -= length; }
  const exactBody = Buffer.from(JSON.stringify(padded));
  equal(exactBody.byteLength, 65536);
  equal((await exchange(provider([exactBody, status()], { chunkSize: 1024 }).value)).accessToken, envelope.accessToken);
  await rejects(() => exchange(provider([Buffer.concat([exactBody, Buffer.from(" ")])]).value));
  await rejects(() => exchange(provider([{ ...token(), access_token: "x".repeat(16384), refresh_token: "r".repeat(16384) }, status()]).value));
  const complex = { ...token(), private_unknown: "é💠\\\"\n\t" };
  equal((await exchange(provider([complex, status()], { chunkSize: 1 }).value)).accessToken, envelope.accessToken);
  await rejects(() => exchange(provider([Buffer.from([123, 34, 120, 34, 58, 34, 0xff, 34, 125])]).value));
  await rejects(() => exchange(provider([Buffer.from('{"access_token":')]).value));
  await rejects(() => exchange(provider([Buffer.from(JSON.stringify(token()).replace('"access_token":', '"access_token":"duplicate","access_token":'))]).value));
  await rejects(() => exchange(provider([Buffer.from(JSON.stringify(token()).replace('"access_token":', '"access_token":"duplicate","access_\\u0074oken":'))]).value));
  const hostileDiscovery = value => oauth.readSquareAuthenticatedDiscovery({ environment: "sandbox", path: "/v2/locations", accessToken: envelope.accessToken,
    transport: async () => response(value, 65536) });
  await rejects(() => hostileDiscovery({ locations: Array(40_001).fill(null) }));
  await rejects(() => hostileDiscovery(Buffer.from('{"locations":' + '['.repeat(14) + '0' + ']'.repeat(14) + '}')));
  await rejects(() => hostileDiscovery({ locations: [], ignored: "x".repeat(4097) }));
  await rejects(() => hostileDiscovery(Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key${index}`, null]))));
  // Derivation-backed maximum raw witness: root + two arrays + 308 objects +
  // 19,689 scalar values = exactly20,000. Objectkeys add19,691 lexical tokens,
  // below the conservative40,000 preallocation bound; no convenient smaller case.
  const maximumRaw = { locations: [], padding: Array.from({ length: 308 }, (_, index) =>
    Object.fromEntries(Array.from({ length: index === 307 ? 41 : 64 }, (_, key) => [`key${key}`, null]))) };
  equal(3 + maximumRaw.padding.length + maximumRaw.padding.reduce((sum, item) => sum + Object.keys(item).length, 0), 20_000);
  equal(await hostileDiscovery(maximumRaw), maximumRaw);
  for (const statusCode of [301, 302, 307, 308, 400, 403, 429, 500, 503]) {
    let calls = 0;
    await rejects(() => exchange(provider([], { transport: async () => { calls++; return response({ error: canary }, 500, statusCode); } }).value));
    equal(calls, 1, "OAuth failure never automatically retries a code");
  }
  for (const [code, expected] of [["ACCESS_TOKEN_REVOKED", "provider_revoked"], ["INVALID_GRANT", "invalid_grant"], ["ACCESS_TOKEN_EXPIRED", "invalid_grant"], ["UNAUTHORIZED", "invalid_grant"], ["UNKNOWN_PROVIDER_CODE", "invalid_grant"]])
    await rejects(() => exchange(provider([], { transport: async () => response({ errors: [{ code, detail: canary }] }, 500, 401) }).value), expected);
  await rejects(() => exchange(provider([], { transport: async () => response({}, 500, 401) }).value), "invalid_grant");
  await rejects(() => exchange(provider([], { transport: () => { throw new Error(canary); } }).value), "provider_transient");

  const abort = new AbortController(); abort.abort(); let abortedCalls = 0;
  await rejects(() => exchange(provider([], { signal: abort.signal, transport: async () => { abortedCalls++; return response(token()); } }).value), "provider_transient");
  equal(abortedCalls, 0);
  let lateResolve, lateCloses = 0;
  const hanging = provider([], { timeoutMs: 20, transport: () => new Promise(resolve => { lateResolve = resolve; }) });
  await rejects(() => exchange(hanging.value), "provider_transient");
  lateResolve(response(token(), 1024, 200, () => lateCloses++));
  await new Promise(resolve => setImmediate(resolve)); equal(lateCloses, 1);
  let readReject, readCloses = 0;
  const during = new AbortController();
  const waiting = exchange(provider([], { signal: during.signal, transport: async () => ({ status: 200, close() { readCloses++; },
    body: { [Symbol.asyncIterator]() { return this; }, next() { return new Promise((resolve, reject) => { readReject = reject; }); } } }) }).value);
  await new Promise(resolve => setImmediate(resolve)); during.abort();
  await rejects(() => waiting, "provider_transient");
  readReject(new Error(canary)); await new Promise(resolve => setImmediate(resolve)); equal(readCloses, 1);
  let emptyReads = 0;
  await rejects(() => exchange(provider([], { timeoutMs: 20, transport: async () => ({ status: 200, body: {
    [Symbol.asyncIterator]() { return this; }, async next() { emptyReads++; return { done: false, value: Buffer.alloc(0) }; }
  } }) }).value), "provider_transient"); ok(emptyReads >= 64, "empty-stream cancellation timer is not starved");

  const revocationCalls = [];
  const cannotRevoke = provider([], { transport: async request => { revocationCalls.push(request); return response({ success: true }); } });
  let revocationCredentialReads = 0;
  await rejects(() => cannotRevoke.value.revokeCredential({
    get credential() { revocationCredentialReads++; return envelope; },
    get applicationSecret() { revocationCredentialReads++; return secret; }, now
  }), "integrity_failure");
  equal(revocationCalls.length, 0, "connection-bound provider cannot revoke a shared grant or access token");
  equal(revocationCredentialReads, 0, "denied grant-level revocation never accesses credentials or application secret");
  equal(oauth.revokeSquareMerchant, undefined, "no unscoped merchant-revocation helper is exposed");
  for (const fixedPath of ["/v2/merchants/me", "/v2/locations", "/v2/locations/main"]) {
    let call;
    equal(await oauth.readSquareAuthenticatedDiscovery({ environment: "sandbox", path: fixedPath, accessToken: envelope.accessToken,
      transport: async request => { call = request; return response({ locations: [] }); } }), { locations: [] });
    equal(call.method, "GET"); equal(call.body, null); equal(call.maximumResponseBytes, 16 * 1024 * 1024);
    equal(call.headers.Authorization, `Bearer ${envelope.accessToken}`);
  }
  await rejects(() => oauth.readSquareAuthenticatedDiscovery({ environment: "sandbox", path: "/v2/payments", accessToken: envelope.accessToken,
    transport: async () => { throw new Error("must not call"); } }));

  const notificationUrl = "https://square-qualification.invalid/webhooks/revoked";
  const signatureKey = "SYNTHETIC_SIGNATURE_KEY_00000000";
  const event = { merchant_id: merchantId, type: "oauth.authorization.revoked", event_id: "synthetic-event-1",
    created_at: "2026-09-06T12:00:00.246373287Z", data: { type: "revocation", id: "not-authority", object: {
      revocation: { revoked_at: "2026-09-06T11:59:00.246373287Z", revoker_type: "MERCHANT" }
    } }, ignored_private: canary };
  const rawBody = JSON.stringify(event);
  const sign = (body, url = notificationUrl, key = signatureKey) => crypto.createHmac("sha256", key).update(url).update(body).digest("base64");
  const notification = { environment: "sandbox", applicationId, notificationUrl, signatureKey, rawBody, signature: sign(rawBody) };
  const verified = oauth.verifySquareRevocationNotification(notification);
  equal(verified.merchantId, merchantId); equal(verified.revokedAt, event.data.object.revocation.revoked_at);
  equal(verified.eventId, event.event_id); ok(Object.isFrozen(verified)); ok(!JSON.stringify(verified).includes(canary));
  equal(oauth.verifySquareRevocationNotification(notification), verified, "authentication does not pretend to implement durable replay handling");
  for (const change of [{ signature: "x".repeat(44) }, { signature: sign(rawBody + " ") }, { rawBody: rawBody + " " },
    { notificationUrl: "https://foreign.invalid/webhooks/revoked" }, { signatureKey: "WRONG_SYNTHETIC_KEY_0000" },
    { rawBody: "x".repeat(65537) }])
    throws(() => oauth.verifySquareRevocationNotification({ ...notification, ...change }), /^Error: square_revocation_notification_rejected$/);
  for (const bad of [{ ...event, type: "payment.updated" }, { ...event, event_id: "" }, { ...event, merchant_id: null },
    { ...event, data: { type: "revocation", object: { revocation: { revoked_at: now.toISOString(), revoker_type: "UNKNOWN" } } } }]) {
    const body = JSON.stringify(bad);
    throws(() => oauth.verifySquareRevocationNotification({ ...notification, rawBody: body, signature: sign(body) }), /square_revocation_notification_rejected/);
  }
  const context = { actor: { actorId: ids.credentialId, workspaceId: ids.workspaceId, sessionId: ids.businessEntityId, role: "owner" },
    environment: "sandbox", applicationId, redirectUri };
  const discovery = { contractVersion: "square_verified_discovery_v1", environment: "sandbox", applicationId,
    merchantId, merchantLabel: "Synthetic seller", defaultLocationId: "LOCATION_1", locations: [{ id: "LOCATION_1", label: "Synthetic location", status: "ACTIVE" }],
    verifiedAt: now.toISOString(), fingerprint: `sha256:${"a".repeat(64)}` };
  const storeCommand = { contractVersion: "integration_credential_authority_v1", id: ids.credentialId,
    oauthStateId: ids.businessEntityId, workspaceId: ids.workspaceId, businessEntityId: ids.businessEntityId,
    connectionId: ids.connectionId, connectionGeneration: 1, providerKey: "square", providerEnvironment: "sandbox",
    initiatedBy: ids.credentialId, expectedConnectionRowVersion: 1, credentialVersion: 1,
    envelopeSchemaVersion: "oauth_credential_envelope_v1", aadSchemaVersion: "oauth_credential_aad_v1",
    aadDigest: credentialAadDigest(aadContext), kmsKeyResource, ciphertextBase64: ciphertext.toString("base64"),
    accessExpiresAt: envelope.accessExpiresAt, refreshExpiresAt: null, grantedScopes: oauth.SQUARE_OAUTH_SCOPES,
    externalEntityReferenceFingerprint: `sha256:${"b".repeat(64)}`, authorizedAt: now.toISOString() };
  const mutationResult = { credentialId: ids.credentialId, credentialVersion: 1, credentialStatus: "active", connectionStatus: "authorized_unmapped", idempotent: true };
  const rpcCalls = []; let discoveries = 0;
  const store = createSquareAccountBrokerStore({ context, consumeVerifiedDiscovery() { discoveries++; return discovery; }, client: {
    async rpc(name, args) { rpcCalls.push({ name, args }); if (rpcCalls.length === 1) throw new Error(canary); return { data: mutationResult, error: null }; }
  } });
  equal(await store.storeCredential(storeCommand, "ignored-request-id"), mutationResult);
  equal(rpcCalls.length, 2); equal(discoveries, 1);
  equal(rpcCalls[0], rpcCalls[1], "uncertain store ACK retries exactly the same context, ciphertext and discovery");
  equal(rpcCalls[0].name, "square_account_connection_v1"); equal(rpcCalls[0].args.p_operation, "store_credential");
  ok(Object.isFrozen(rpcCalls[0].args.p_command)); ok(Object.isFrozen(rpcCalls[0].args.p_context.actor));
  assertions++; await assert.rejects(() => store.storeCredential(storeCommand, "second-invocation"), /^Error: square_account_broker_denied$/);
  equal(rpcCalls.length, 2); equal(discoveries, 1);
  for (const result of [{ data: null, error: { code: "42501", message: canary } }, { data: { wrong: canary }, error: null }]) {
    let attempts = 0;
    const failedStore = createSquareAccountBrokerStore({ context, consumeVerifiedDiscovery: () => discovery,
      client: { async rpc() { attempts++; return result; } } });
    assertions++; await assert.rejects(() => failedStore.storeCredential(storeCommand, "test"), /^Error: square_account_broker_denied$/);
    equal(attempts, 1, "explicit rejection and malformed success never retry");
  }
  let uncertainAttempts = 0;
  const uncertain = createSquareAccountBrokerStore({ context, consumeVerifiedDiscovery: () => discovery,
    client: { async rpc() { uncertainAttempts++; throw new Error(canary); } } });
  assertions++; await assert.rejects(() => uncertain.storeCredential(storeCommand, "test"), /^Error: square_account_broker_denied$/);
  equal(uncertainAttempts, 2, "uncertain ACK has at most one retry");
  let boundaryRpcCalls = 0;
  const maximumStore = createSquareAccountBrokerStore({ context, consumeVerifiedDiscovery: () => discovery, client: { async rpc(name, args) {
    boundaryRpcCalls++; equal(args.p_command.command.ciphertextBase64.length, 131072); return { data: mutationResult, error: null };
  } } });
  equal(await maximumStore.storeCredential({ ...storeCommand, ciphertextBase64: "A".repeat(131072) }, "test"), mutationResult);
  equal(boundaryRpcCalls, 1);
  // Derivation-backed composition: all500 currently supported locations, maximum
  // labels (including six-byte JSON escapes), full IDs and maximum ciphertext.
  // This is not just a maximum-size credential tested with a tiny discovery.
  const fullDiscovery = { ...discovery, merchantLabel: "\u0001".repeat(255),
    defaultLocationId: "LOCATION_000".padEnd(32, "x"), locations: Array.from({ length: 500 }, (_, index) => ({
      id: `LOCATION_${String(index).padStart(3, "0")}`.padEnd(32, "x"), label: "\u0001".repeat(255), status: "ACTIVE"
    })) };
  const fullCommand = { ...storeCommand, ciphertextBase64: "A".repeat(131072) };
  ok(Buffer.byteLength(JSON.stringify({ command: fullCommand, discovery: fullDiscovery })) > 524288, "composed current schema exceeds old512KiB approximation");
  const composedStore = createSquareAccountBrokerStore({ context, consumeVerifiedDiscovery: () => fullDiscovery,
    client: { async rpc(name, args) { equal(args.p_command.discovery.locations.length, 500); return { data: mutationResult, error: null }; } } });
  equal(await composedStore.storeCredential(fullCommand, "composed-maximum"), mutationResult);
  const statusLocation = { id: "L".repeat(32), label: "\u0001".repeat(255) };
  const fullView = { canManage: true,
    businessEntities: Array.from({ length: 1000 }, () => ({ id: ids.businessEntityId, label: "\u0001".repeat(255) })),
    connections: Array.from({ length: 32 }, () => ({ connectionId: ids.connectionId, businessEntityId: ids.businessEntityId,
      state: "authorized", sellerLabel: "\u0001".repeat(255), locations: Array(500).fill(statusLocation),
      mappedLocationIds: Array(500).fill(statusLocation.id), retentionApproved: true, revocationPending: false })) };
  const fullStatus = await squareAccountRpc({ async rpc() { return { data: fullView, error: null }; } }, context, "status", {});
  equal(fullStatus.connections.length, 32); equal(fullStatus.businessEntities.length, 1000);
  ok(Object.isFrozen(fullStatus.connections[31].locations[499]), "full schema view remains deeply frozen with repeated shared occurrences");
  const invalidStore = createSquareAccountBrokerStore({ context, consumeVerifiedDiscovery: () => discovery, client: { async rpc() { assert.fail("invalid command must not reach RPC"); } } });
  assertions++; await assert.rejects(() => invalidStore.storeCredential({ ...storeCommand, ciphertextBase64: "A".repeat(131073) }, "test"), /square_account_broker_denied/);
  let traps = 0;
  const proxy = new Proxy({}, { ownKeys() { traps++; return []; } });
  const accessor = Object.defineProperty({}, "connectionId", { enumerable: true, get() { traps++; return ids.connectionId; } });
  const revokedProxy = Proxy.revocable({}, {}); revokedProxy.revoke();
  const cycle = {}; cycle.self = cycle;
  for (const bad of [proxy, revokedProxy.proxy, accessor, cycle, { extra: "x".repeat(131073) }]) {
    assertions++; await assert.rejects(() => squareAccountRpc({ async rpc() { assert.fail("hostile graph must not reach RPC"); } }, context, "prepare", bad), /^Error: square_account_rpc_failed$/);
  }
  equal(traps, 0);
  for (const method of ["createReauthorizationState", "consumeReauthorizationState", "storeReauthorizedCredential", "reclaimExpiredRefreshLease",
    "revokeCredential", "completeCredentialRevocation", "destroyCredential"]) {
    assertions++; await assert.rejects(() => store[method]({}, "denied"), /^Error: square_account_broker_denied$/);
  }
  const errorAccessor = Object.defineProperty({ data: {} }, "error", { get() { traps++; return null; } });
  assertions++; await assert.rejects(() => squareAccountRpc({ async rpc() { return errorAccessor; } }, context, "status", {}), /^Error: square_account_rpc_failed$/);
  equal(traps, 0);
  // Independent canonical-JSON SHA256 witness, shared with checked SQL. This is
  // only a UUID representation; the real database suite tests lease authority.
  equal(squareCredentialReadLeaseId(`sha256:${"a".repeat(64)}`), "cbff192e-a9d5-80f7-8bb2-94b688c87c17");
  equal(squareCredentialReadLeaseId(`sha256:${"a".repeat(64)}`), squareCredentialReadLeaseId(`sha256:${"a".repeat(64)}`));
  ok(squareCredentialReadLeaseId(`sha256:${"a".repeat(64)}`) !== squareCredentialReadLeaseId(`sha256:${"b".repeat(64)}`));
  const readCommandSchema = require("../lib/integrations/credentials/contracts.ts").ReadProviderCredentialCommandSchema;
  const leaseIds = new Set();
  for (let index = 0; index < 32; index++) {
    const value = squareCredentialReadLeaseId(`sha256:${index.toString(16).padStart(64, "0")}`);
    ok(readCommandSchema.shape.leaseId.safeParse(value).success, "bridge preserves unchanged generic UUID schema");
    leaseIds.add(value);
  }
  equal(leaseIds.size, 32);
  for (const invalidLease of ["a".repeat(64), `sha256:${"A".repeat(64)}`, `sha256:${"a".repeat(65)}`, "cbff192e-a9d5-80f7-8bb2-94b688c87c17", null, proxy, revokedProxy.proxy]) {
    assertions++; assert.throws(() => squareCredentialReadLeaseId(invalidLease), /^Error: square_account_broker_denied$/);
  }
  equal(traps, 0);
  console.log(`Square account OAuth regression tests passed: ${assertions} assertions. Synthetic injected transport only; no provider calls.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
