/* Synthetic identities, secrets and network only. No metadata, Google or Square
 * request can escape: every network dependency is injected and default fetch fails. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
require("./square-account-browser-test-support.js").loadSquareBrowserModules();
const {
  checkedSquareGcpCallbackBinding: checkedBinding,
  SQUARE_GCP_CALLBACK_CONTRACT_VERSION, SQUARE_GCP_CALLBACK_IDENTITY_AUDIENCE
} = require("../lib/integrations/control-plane/square-gcp-callback-contracts.ts");
const { SQUARE_REMOTE_SANDBOX: constants } = require("../lib/integrations/control-plane/square-remote-sandbox-contracts.ts");
const {
  createSquareGcpCallbackIdentity: createIdentity, SQUARE_GCP_METADATA_ROOT: metadata,
  SQUARE_GCP_GOOGLE_JWKS_URL: jwksUrl, assertSquareGcpCallbackIdentityClaims: assertClaims
} = require("../lib/integrations/control-plane/square-gcp-callback-identity.ts");
const { createSquareGcpCallbackCredentials: createCredentials, readSquareGcpCallbackDatabaseSecret: readDatabase } =
  require("../lib/integrations/control-plane/square-gcp-callback-credentials.ts");
const { credentialAad } = require("../lib/integrations/credentials/kms.ts");

const canary = "SYNTHETIC_ONLY_GCP_CALLBACK_SECRET_DO_NOT_LOG";
const uuid = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const binding = Object.freeze({
  contractVersion: SQUARE_GCP_CALLBACK_CONTRACT_VERSION, projectRef: constants.projectRef,
  applicationOrigin: constants.applicationOrigin, environment: "sandbox", applicationId: constants.applicationId, apiVersion: constants.apiVersion,
  gcpProjectId: "vaeroex-square-sandbox", gcpProjectNumber: "123456789012", gcpZone: "us-west1-a",
  gcpInstanceId: "9876543210987654321", gcpInstanceName: "square-sandbox-callback",
  serviceAccountEmail: "synthetic-broker@vaeroex-square-sandbox.iam.gserviceaccount.com", serviceAccountSubject: "123456789012345678901",
  identityAudience: SQUARE_GCP_CALLBACK_IDENTITY_AUDIENCE,
  operatorId: uuid(1), workspaceId: uuid(2), businessEntityId: uuid(3), operatorRole: "owner", brokerLogin: "square_sandbox_broker",
  approvalExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), enabled: true, providerCallsEnabled: true,
  policyVersion: "synthetic_only_v1", policyFingerprint: `sha256:${"1".repeat(64)}`,
  kmsKeyResource: "projects/vaeroex-square-sandbox/locations/us-west1/keyRings/synthetic/cryptoKeys/synthetic",
  appSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/synthetic-app/versions/1",
  databaseSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db/versions/1"
});
const aadContext = Object.freeze({ schemaVersion: "oauth_credential_aad_v1", purpose: "provider_oauth_credential", environment: "sandbox",
  workspaceId: binding.workspaceId, connectionId: uuid(4), connectionGeneration: 1, providerKey: "square", credentialId: uuid(5) });
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256", use: "sig", kid: "synthetic-only-rsa-key" };
const identityUrl = `${metadata}identity?audience=${encodeURIComponent(binding.identityAudience)}&format=full&licenses=FALSE`;
let assertions = 0;
const equal = (actual, expected, label) => { assertions++; assert.deepEqual(actual, expected, label); };
const ok = (actual, label) => { assertions++; assert.ok(actual, label); };
const throws = work => { assertions++; assert.throws(work, error => !String(error).includes(canary)); };
const rejects = async (work, label) => {
  assertions++;
  await assert.rejects(work, error => {
    assert.ok(!`${error.message}${JSON.stringify(error)}`.includes(canary), label);
    return true;
  }, label);
};
async function until(check) {
  const deadline = Date.now() + 6_000;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("synthetic_observer_timeout");
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
function claims(expected = binding) {
  const now = Math.floor(Date.now() / 1000);
  return { iss: "https://accounts.google.com", aud: expected.identityAudience, iat: now - 2, exp: now + 3598,
    sub: expected.serviceAccountSubject, azp: expected.serviceAccountSubject, email: expected.serviceAccountEmail, email_verified: true,
    google: { compute_engine: { project_id: expected.gcpProjectId, project_number: Number(expected.gcpProjectNumber),
      zone: expected.gcpZone, instance_id: expected.gcpInstanceId, instance_name: expected.gcpInstanceName, instance_creation_timestamp: now - 3600 } } };
}
function sign(payload = claims(), header = { alg: "RS256", typ: "JWT", kid: jwk.kid }, signingKey = privateKey) {
  const unsigned = [header, payload].map(value => Buffer.from(JSON.stringify(value)).toString("base64url")).join(".");
  return `${unsigned}.${crypto.sign("RSA-SHA256", Buffer.from(unsigned), signingKey).toString("base64url")}`;
}
function json(value, options = {}) { return new Response(JSON.stringify(value), options); }
function metadataResponse(value) { return new Response(value, { headers: { "Metadata-Flavor": "Google" } }); }
function secretReply(resource, value) { return { name: resource, payload: { data: Buffer.from(value).toString("base64") } }; }
const appSecret = JSON.stringify({ schemaVersion: "provider_application_secret_v1", providerKey: "square", environment: "sandbox",
  clientId: binding.applicationId, clientSecret: canary });
const databaseDsn = `postgresql://square_sandbox_broker:${canary}@db.${binding.projectRef}.supabase.co:5432/postgres`;
const keyVersionResource = `${binding.kmsKeyResource}/cryptoKeyVersions/1`;
const encryptUrl = `https://cloudkms.googleapis.com/v1/${keyVersionResource}:encrypt`;
const kmsReply = (ciphertext, changes = {}) => ({ name: keyVersionResource, protectionLevel: "SOFTWARE", ciphertext, ...changes });
const originalFetch = global.fetch;
global.fetch = () => assert.fail("No default network is authorized in this synthetic runner");

function fixture(options = {}) {
  const calls = [], checks = [], abort = new AbortController();
  const expected = options.binding ?? binding;
  let consumed = options.consumed ?? true;
  const network = async (url, init) => {
    calls.push({ url, method: init.method });
    equal(init.redirect, "error"); equal(init.cache, "no-store"); equal(init.credentials, "omit");
    ok(init.signal instanceof AbortSignal); ok(!init.signal.aborted);
    if (options.network) {
      const response = await options.network(url, init, calls.length);
      if (response !== undefined) return response;
    }
    if (url === identityUrl) {
      equal(init.headers["Metadata-Flavor"], "Google"); equal(init.headers.Authorization, undefined);
      return metadataResponse(options.jwt ?? sign(options.payload ?? claims(expected), options.header));
    }
    if (url === jwksUrl) { equal(init.headers, undefined); return json(options.jwks ?? { keys: [jwk] }); }
    if (url === `${metadata}token`) {
      equal(init.headers["Metadata-Flavor"], "Google");
      return metadataResponse(JSON.stringify({ access_token: `SYNTHETIC_ACCESS_${canary}`, expires_in: 600, token_type: "Bearer" }));
    }
    equal(init.headers.Authorization, `Bearer SYNTHETIC_ACCESS_${canary}`);
    if (url === `https://secretmanager.googleapis.com/v1/${binding.appSecretVersionResource}:access`) {
      equal(init.body, undefined); return json(secretReply(binding.appSecretVersionResource, appSecret));
    }
    if (url === `https://secretmanager.googleapis.com/v1/${binding.databaseSecretVersionResource}:access`) {
      equal(init.body, undefined); return json(secretReply(binding.databaseSecretVersionResource, databaseDsn));
    }
    if (url === encryptUrl) {
      const body = JSON.parse(init.body);
      equal(Object.keys(body).sort(), ["additionalAuthenticatedData", "plaintext"]);
      equal(JSON.parse(Buffer.from(body.additionalAuthenticatedData, "base64")), aadContext);
      const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.alloc(32, 7), Buffer.alloc(12, 2));
      cipher.setAAD(Buffer.from(body.additionalAuthenticatedData, "base64"));
      const encrypted = Buffer.concat([cipher.update(Buffer.from(body.plaintext, "base64")), cipher.final(), cipher.getAuthTag()]);
      return json(kmsReply(encrypted.toString("base64")));
    }
    assert.fail("Only exact synthetic metadata/JWKS/app-secret/KMS/DB-secret URLs may be requested");
  };
  const identity = createIdentity({ binding: expected, network, signal: abort.signal, ...(options.clock ? { clock: options.clock } : {}) });
  const dependencies = { binding: expected, identity, network, signal: abort.signal, authorizeFirstConsent: async request => {
    checks.push(request.purpose);
    ok(Object.isFrozen(request)); equal(request.signal, abort.signal);
    if (!consumed || request.signal.aborted) throw new Error(`denied_${canary}`);
    if (request.purpose === "credential_encrypt") equal(request.aadContext, aadContext);
    else equal(request.aadContext, undefined);
    return options.authorize ? options.authorize(request, checks.length) : expected;
  } };
  const credentials = createCredentials(dependencies, options.observeConsent);
  return { calls, checks, abort, network, identity, credentials, dependencies, setConsumed(value) { consumed = value; } };
}
const secret = f => f.credentials.secrets.access("square", "sandbox");
const encrypt = (f, changes = {}) => f.credentials.kms.encrypt({ keyResource: binding.kmsKeyResource,
  plaintext: Buffer.from(canary), additionalAuthenticatedData: credentialAad(aadContext), ...changes });
const decodeCipher = value => {
  const bytes = Buffer.from(value), decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.alloc(32, 7), Buffer.alloc(12, 2));
  decipher.setAAD(credentialAad(aadContext)); decipher.setAuthTag(bytes.subarray(-16));
  return Buffer.concat([decipher.update(bytes.subarray(0, -16)), decipher.final()]).toString();
};

async function main() {
  // Exact new diagnostic boundaries; the adapter input descriptor shape, one-use
  // latch and consumed-state prerequisite are unchanged. No raw values emitted.
  for (const [kind, expected] of [["payload", "application_secret_payload_validation"],
    ["decode", "application_secret_decode_validation"], ["binding", "application_secret_binding_validation"],
    ["valid", "application_secret_binding_validation"]]) {
    const stages = [];
    const f = fixture({ observeConsent: stage => stages.push(stage), network: async url => {
      if (!url.includes("secretmanager")) return undefined;
      if (kind === "payload") return json(secretReply("foreign-synthetic-resource", appSecret));
      if (kind === "decode") return json(secretReply(binding.appSecretVersionResource, canary));
      if (kind === "binding") return json(secretReply(binding.appSecretVersionResource,
        JSON.stringify({ ...JSON.parse(appSecret), clientId: "foreign-synthetic-app" })));
      return undefined;
    } });
    if (kind === "valid") await secret(f); else await rejects(() => secret(f));
    equal(stages.at(-1), expected); ok(!JSON.stringify(stages).includes(canary));
    await rejects(() => secret(f));
    equal(f.calls.filter(call => call.url.includes("secretmanager")).length, 1, "diagnostics never permit an app-secret retry");
    f.credentials.dispose();
  }
  for (const observeConsent of [() => { throw new Error(canary); }, async () => { throw new Error(canary); }]) {
    const f = fixture({ observeConsent }); await secret(f); await encrypt(f);
    equal(f.calls.filter(call => call.url.includes("secretmanager")).length, 1);
    equal(f.calls.filter(call => call.url.includes("cloudkms")).length, 1); f.credentials.dispose();
  }
  const unconsumedStages = [], unconsumed = fixture({ consumed: false, observeConsent: stage => unconsumedStages.push(stage) });
  await rejects(() => secret(unconsumed)); equal(unconsumedStages, []);
  equal(unconsumed.calls.length, 0, "no diagnostic probe bypasses consumed-intent authority");
  equal(checkedBinding(binding), binding); ok(Object.isFrozen(checkedBinding(binding)));
  for (const [key, value] of [["gcpProjectId", "Production"], ["gcpProjectId", "foreign-project"],
    ...["us-west1-d", "us-west2-a", "us-east1-b", "us-west1", "US-WEST1-B"].map(zone => ["gcpZone", zone]), ["gcpInstanceId", "PENDING"],
    ["gcpInstanceName", "another-sandbox-host"],
    ["serviceAccountEmail", "foreign@foreign-project.iam.gserviceaccount.com"], ["identityAudience", binding.applicationOrigin],
    ["applicationId", "production-app"], ["environment", "production"], ["enabled", false],
    ["kmsKeyResource", binding.kmsKeyResource.replace("us-west1", "global")], ["approvalExpiresAt", new Date(0).toISOString()],
    ["databaseSecretVersionResource", binding.appSecretVersionResource], ["appSecretVersionResource", binding.appSecretVersionResource.replace("/1", "/latest")]]) {
    throws(() => checkedBinding({ ...binding, [key]: value }));
  }
  throws(() => checkedBinding({ ...binding, webhookLogin: "square_sandbox_webhook" }));
  let getters = 0;
  const accessor = { ...binding };
  Object.defineProperty(accessor, "gcpProjectId", { enumerable: true, get() { getters++; return "vaeroex-square-sandbox"; } });
  throws(() => checkedBinding(accessor)); equal(getters, 0);
  throws(() => checkedBinding(new Proxy(binding, { ownKeys() { getters++; return []; } }))); equal(getters, 0);

  for (const [zone, instanceId] of [["us-west1-b", "9876543210987654322"], ["us-west1-c", "9876543210987654323"]]) {
    const replacement = checkedBinding({ ...binding, gcpZone: zone, gcpInstanceId: instanceId });
    equal(replacement.gcpZone, zone); equal(replacement.gcpInstanceId, instanceId); ok(Object.isFrozen(replacement));
    equal(replacement.policyFingerprint, binding.policyFingerprint, "zonal recovery does not replace retention authority");
    const current = fixture({ binding: replacement });
    await current.identity.verify(); equal(current.calls.length, 2, "real synthetic RSA signature accepts the exact new canonical zone and instance");
    const wrongZone = claims(replacement); wrongZone.google.compute_engine.zone = "us-west1-a";
    const wrongInstance = claims(replacement); wrongInstance.google.compute_engine.instance_id = binding.gcpInstanceId;
    for (const payload of [wrongZone, wrongInstance, claims()]) {
      const stale = fixture({ binding: replacement, payload });
      await rejects(() => secret(stale), "signed wrong-zone, old-instance or old-host claims reject against the replacement binding");
      equal(stale.calls.filter(call => call.url.endsWith("/token") || call.url.includes("secretmanager") || call.url.includes("cloudkms")).length, 0,
        "a valid provider signature never substitutes for exact current host authority");
    }
  }

  const good = fixture(); equal(good.calls.length, 0, "constructors/imports are inert");
  await good.identity.verify(); equal(good.calls.length, 2, "real RSA signature + full instance claims verified with synthetic Google key reply");
  equal((await secret(good)).use(value => value.clientId), binding.applicationId);
  equal(decodeCipher(await encrypt(good)), canary, "existing exact KMS AAD encrypts the synthetic value");
  equal(good.calls.filter(call => call.url.endsWith(":encrypt")).length, 1);
  equal(good.calls.find(call => call.url.endsWith(":encrypt")).url, encryptUrl, "encrypt requests exact version 1, never current primary");
  equal(good.calls.filter(call => call.url.endsWith(":access")).length, 1);
  await rejects(() => secret(good)); await rejects(() => encrypt(good));

  const closed = fixture({ consumed: false }); await rejects(() => secret(closed)); equal(closed.calls.length, 0, "no identity/secret network before consumed intent");
  closed.setConsumed(true); await rejects(() => secret(closed)); equal(closed.calls.length, 0, "denied instance cannot later be activated");
  const premature = fixture(); await rejects(() => encrypt(premature)); equal(premature.calls.length, 0, "encrypt requires successful secret read first");
  const deniedDecrypt = fixture(); await rejects(() => deniedDecrypt.credentials.kms.decrypt({ keyResource: binding.kmsKeyResource,
    ciphertext: Buffer.alloc(32), additionalAuthenticatedData: credentialAad(aadContext) })); equal(deniedDecrypt.calls.length, 0);
  for (const pair of [["qbo", "sandbox"], ["square", "production"]]) {
    const wrong = fixture(); await rejects(() => wrong.credentials.secrets.access(...pair)); equal(wrong.calls.length, 0);
  }
  throws(() => createCredentials({ ...fixture().dependencies, binding: { ...binding, providerCallsEnabled: false } }));
  for (const key of ["authorizeFirstConsent", "identity", "network", "signal"]) {
    const deps = { ...fixture().dependencies }; delete deps[key]; throws(() => createCredentials(deps));
  }

  const invalidClaims = [
    { iss: "https://attacker.invalid" }, { aud: [binding.identityAudience] }, { aud: "https://foreign.invalid" }, { sub: "123" }, { azp: "123" },
    { email: "other@vaeroex-square-sandbox.iam.gserviceaccount.com" }, { email_verified: false },
    { exp: 0 }, { iat: Math.floor(Date.now() / 1000) + 60 }, { exp: Math.floor(Date.now() / 1000) + 7200 }, { google: undefined }
  ];
  for (const update of invalidClaims) {
    const invalid = fixture({ payload: { ...claims(), ...update } });
    await rejects(() => secret(invalid)); equal(invalid.calls.filter(call => call.url.endsWith("/token") || call.url.includes("secretmanager")).length, 0);
  }
  for (const [key, value] of [["project_id", "foreign-project"], ["project_number", 123], ["project_number", "123456789012"],
    ["zone", "us-west1-b"], ["instance_id", "1"], ["instance_name", "other"], ["instance_creation_timestamp", 0]]) {
    const payload = claims(); payload.google.compute_engine[key] = value;
    const invalid = fixture({ payload }); await rejects(() => secret(invalid));
    equal(invalid.calls.filter(call => call.url.endsWith("/token") || call.url.includes("secretmanager")).length, 0);
  }
  const foreignKeys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const badSignature = fixture({ jwt: sign(claims(), undefined, foreignKeys.privateKey) });
  await rejects(() => secret(badSignature)); equal(badSignature.calls.length, 2);
  for (const header of [{ alg: "none", kid: jwk.kid }, { alg: "HS256", kid: jwk.kid }, { alg: "RS256", kid: jwk.kid, jku: "https://attacker.invalid/key" },
    { alg: "RS256", kid: jwk.kid, x5u: "https://attacker.invalid/key" }, { alg: "RS256" }]) {
    const invalid = fixture({ header }); await rejects(() => secret(invalid)); equal(invalid.calls.length, 1, "untrusted header cannot choose a key URL");
  }
  for (const keys of [[], [jwk, jwk], [{ ...jwk, d: "private-key" }], [{ ...jwk, alg: "HS256" }], Array(17).fill(jwk)]) {
    const invalid = fixture({ jwks: { keys } }); await rejects(() => secret(invalid)); equal(invalid.calls.length, 2);
  }

  for (let at = 1; at <= 4; at++) {
    const invalid = fixture({ authorize: (_request, count) => count === at ? { ...binding, policyFingerprint: `sha256:${"2".repeat(64)}` } : binding });
    await rejects(() => secret(invalid));
    const count = invalid.calls.length; await rejects(() => secret(invalid)); equal(invalid.calls.length, count, "stale current authority permanently disposes request");
  }
  const wrongAad = fixture(); await secret(wrongAad);
  const beforeAad = wrongAad.calls.length;
  await rejects(() => encrypt(wrongAad, { additionalAuthenticatedData: credentialAad({ ...aadContext, workspaceId: uuid(9) }) }));
  equal(wrongAad.calls.length, beforeAad, "foreign AAD never reaches identity/KMS");
  const noncanonical = fixture(); await secret(noncanonical);
  await rejects(() => encrypt(noncanonical, { additionalAuthenticatedData: Buffer.from(JSON.stringify(aadContext, null, 1)) }));

  const db = fixture();
  equal(await readDatabase({ binding, identity: db.identity, network: db.network, signal: db.abort.signal }), databaseDsn);
  equal(db.checks.length, 0, "separate DB bootstrap is not a provider consent grant");
  equal(db.calls.filter(call => call.url.includes("secretmanager")).map(call => call.url), [`https://secretmanager.googleapis.com/v1/${binding.databaseSecretVersionResource}:access`]);
  await rejects(() => db.identity.verify(), "bootstrap identity disposed after private DSN delivery");

  const applicationUrl = `https://secretmanager.googleapis.com/v1/${binding.appSecretVersionResource}:access`;
  const malformedReplies = [
    new Response("no-metadata-header"), new Response("redirect", { status: 302, headers: { location: "https://attacker.invalid" } }),
    new Response("x".repeat(16_385), { headers: { "Metadata-Flavor": "Google" } }),
    new Response("short", { headers: { "Metadata-Flavor": "Google", "content-length": "99999999" } })
  ];
  for (const response of malformedReplies) {
    const bad = fixture({ network: url => url === identityUrl ? response : undefined }); await rejects(() => secret(bad)); equal(bad.calls.length, 1);
  }
  const foreignResponse = metadataResponse(sign());
  Object.defineProperty(foreignResponse, "url", { value: "https://foreign.invalid/metadata" });
  const wrongUrl = fixture({ network: url => url === identityUrl ? foreignResponse : undefined });
  await rejects(() => secret(wrongUrl)); equal(wrongUrl.calls.length, 1);
  const invalidUtf8 = fixture({ network: url => url === identityUrl ? new Response(new Uint8Array([0xc3, 0x28]),
    { headers: { "Metadata-Flavor": "Google" } }) : undefined });
  await rejects(() => secret(invalidUtf8)); equal(invalidUtf8.calls.length, 1);
  for (const change of [{ expires_in: 0 }, { expires_in: 3601 }, { token_type: "MAC" }, { access_token: "not a token" }, { refresh_token: canary }]) {
    const invalid = fixture({ network: url => url === `${metadata}token` ? metadataResponse(JSON.stringify({
      access_token: canary, token_type: "Bearer", expires_in: 300, ...change
    })) : undefined });
    await rejects(() => secret(invalid)); equal(invalid.calls.length, 3, "invalid native token cannot contact secrets/KMS");
  }
  for (const body of [
    { ...secretReply(binding.appSecretVersionResource, appSecret), name: binding.databaseSecretVersionResource },
    { ...secretReply(binding.appSecretVersionResource, appSecret), name: binding.appSecretVersionResource.replace(binding.gcpProjectId, "999999999999") },
    { name: binding.appSecretVersionResource, payload: { data: "not base64" } },
    secretReply(binding.appSecretVersionResource, JSON.stringify({ schemaVersion: "provider_application_secret_v1", providerKey: "square", environment: "sandbox", clientId: "foreign-app", clientSecret: canary }))
  ]) {
    const bad = fixture({ network: url => url === applicationUrl ? json(body) : undefined }); await rejects(() => secret(bad));
  }
  const canonicalProject = fixture({ network: url => url === applicationUrl ? json({ ...secretReply(binding.appSecretVersionResource, appSecret),
    name: binding.appSecretVersionResource.replace(binding.gcpProjectId, binding.gcpProjectNumber) }) : undefined });
  equal((await secret(canonicalProject)).use(value => value.clientId), binding.applicationId); canonicalProject.credentials.dispose();

  const oversizedCipher = fixture({ network: url => url.endsWith(":encrypt") ? json(kmsReply(Buffer.alloc(131_073).toString("base64"))) : undefined });
  await secret(oversizedCipher); await rejects(() => encrypt(oversizedCipher));
  for (const change of [
    { name: undefined }, { name: binding.kmsKeyResource }, { name: `${binding.kmsKeyResource}/cryptoKeyVersions/2` },
    { name: keyVersionResource.replace("/cryptoKeys/synthetic/", "/cryptoKeys/foreign/") },
    { name: keyVersionResource.replace("projects/vaeroex-square-sandbox/", "projects/foreign-project/") },
    { protectionLevel: undefined }, { protectionLevel: "HSM" }, { protectionLevel: "EXTERNAL" },
    { protectionLevel: "PROTECTION_LEVEL_UNSPECIFIED" }, { protectionLevel: "software" }
  ]) {
    const invalid = fixture({ network: url => url.endsWith(":encrypt") ? json(kmsReply(Buffer.alloc(32).toString("base64"), change)) : undefined });
    await secret(invalid); await rejects(() => encrypt(invalid), "wrong or missing KMS version/protection is denied");
    equal(invalid.calls.filter(call => call.url.endsWith(":encrypt")).map(call => call.url), [encryptUrl]);
    const count = invalid.calls.length;
    await rejects(() => encrypt(invalid)); equal(invalid.calls.length, count, "failed version check disposes capability without fallback/retry");
  }
  const wrongKey = fixture(); await rejects(() => encrypt(wrongKey, { keyResource: binding.kmsKeyResource + "foreign" }));
  equal(wrongKey.calls.length, 0); await rejects(() => secret(wrongKey), "foreign key attempt permanently disposes adapter");
  const badDatabase = fixture({ network: url => url.includes("square-sandbox-callback-db/versions/1:access")
    ? json(secretReply(binding.databaseSecretVersionResource, "not-a-dsn")) : undefined });
  await rejects(() => readDatabase({ binding, identity: badDatabase.identity, network: badDatabase.network, signal: badDatabase.abort.signal }));

  let cancelled = 0, release;
  const ignoredNetwork = fixture({ network: url => url === identityUrl ? new Promise(resolve => { release = resolve; }) : undefined });
  const pending = secret(ignoredNetwork);
  await until(() => release);
  ignoredNetwork.abort.abort(); await rejects(() => pending);
  release(new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { "Metadata-Flavor": "Google" } }));
  await new Promise(resolve => setImmediate(resolve)); equal(cancelled, 1, "late fetch body is disposed after abort");

  let readerCancelled = 0;
  const stalledBody = fixture({ network: url => url === identityUrl ? new Response(new ReadableStream({
    pull() { return new Promise(() => {}); }, cancel() { readerCancelled++; }
  }), { headers: { "Metadata-Flavor": "Google" } }) : undefined });
  const stalled = secret(stalledBody);
  await until(() => stalledBody.calls.length);
  await new Promise(resolve => setImmediate(resolve)); stalledBody.abort.abort(); await rejects(() => stalled);
  equal(readerCancelled, 1);

  let overlapRelease;
  const overlapping = fixture({ authorize: () => new Promise(resolve => { overlapRelease = () => resolve(binding); }) });
  const first = secret(overlapping);
  await until(() => overlapRelease);
  await rejects(() => secret(overlapping)); await rejects(() => first); overlapRelease();
  equal(overlapping.calls.length, 0, "concurrent effect attempts cannot race the one-use latch");

  const emptyChunks = fixture({ network: url => url === identityUrl ? new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array()); } }),
    { headers: { "Metadata-Flavor": "Google" } }) : undefined });
  await rejects(() => secret(emptyChunks)); equal(emptyChunks.calls.length, 1, "zero-byte chunk flood is finite");

  const stalledDeadline = fixture({ network: url => url === identityUrl ? new Promise(() => {}) : undefined });
  const started = Date.now(); await rejects(() => secret(stalledDeadline));
  ok(Date.now() - started >= 4_500 && Date.now() - started < 7_000, "noncooperative fetch is rejected by the five-second step deadline");
  equal(stalledDeadline.calls.length, 1);

  let syntheticClock = Date.now();
  const deadline = fixture({ clock: () => syntheticClock }); syntheticClock += 60_001;
  await rejects(() => deadline.identity.verify(), "whole-session deadline is enforced without any new request"); equal(deadline.calls.length, 0);
  throws(() => assertClaims(binding, { ...claims(), google: new Proxy({}, {}) }));
  global.fetch = originalFetch;
  console.log(`Square GCP callback identity/first-consent credentials: ${assertions} synthetic assertions passed; no live network or credentials.`);
}
main().catch(error => {
  global.fetch = originalFetch;
  console.error(`Square GCP callback synthetic regression failed after ${assertions} checks.`);
  // Synthetic runner-only source positions; omit assertion values/messages.
  console.error(String(error.stack).split("\n").filter(line => /^\s+at /.test(line)).join("\n"));
  process.exitCode = 1;
});
