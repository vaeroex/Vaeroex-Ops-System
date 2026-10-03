/* Fixed synthetic identities/credentials only; no default network may run. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
require("./square-account-browser-test-support.js").loadSquareBrowserModules();
const { createSquareGcpMappedCredentials: create, readSquareGcpMappedDatabaseSecret: read } = require("../lib/integrations/control-plane/square-gcp-mapped-credentials.ts");
const { squareGcpMappedHost } = require("../lib/integrations/control-plane/square-gcp-mapped-contracts.ts");
const { SQUARE_REMOTE_SANDBOX: constants } = require("../lib/integrations/control-plane/square-remote-sandbox-contracts.ts");
const { createSquareGcpCallbackIdentity: createIdentity, SQUARE_GCP_METADATA_ROOT: metadata, SQUARE_GCP_GOOGLE_JWKS_URL: jwks } = require("../lib/integrations/control-plane/square-gcp-callback-identity.ts");
const { credentialAad } = require("../lib/integrations/credentials/kms.ts");
const uuid = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const canary = "SYNTHETIC_MAPPED_CREDENTIAL_NEVER_LOG";
const binding = {
  contractVersion: "square_gcp_mapped_runtime_binding_v1", projectRef: constants.projectRef, applicationOrigin: constants.applicationOrigin,
  environment: "sandbox", applicationId: constants.applicationId, apiVersion: constants.apiVersion,
  gcpProjectId: "vaeroex-square-sandbox", gcpProjectNumber: "123456789012", gcpZone: "us-west1-b", gcpInstanceId: "9876543210987654321",
  gcpInstanceName: "square-sandbox-callback", serviceAccountEmail: "synthetic-broker@vaeroex-square-sandbox.iam.gserviceaccount.com",
  serviceAccountSubject: "123456789012345678901", identityAudience: `${constants.applicationOrigin}/_identity/square-callback`,
  operatorId: uuid(1), workspaceId: uuid(2), businessEntityId: uuid(3), operatorRole: "owner", brokerLogin: "square_sandbox_broker",
  approvalExpiresAt: new Date(Date.now() + 3_600_000).toISOString(), enabled: true, providerCallsEnabled: false,
  policyVersion: "synthetic_only_v1", policyFingerprint: `sha256:${"1".repeat(64)}`,
  kmsKeyResource: "projects/vaeroex-square-sandbox/locations/us-west1/keyRings/synthetic/cryptoKeys/synthetic",
  appSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/synthetic-app/versions/1",
  databaseSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/square-sandbox-callback-db/versions/1",
  capability: "runtime", enrollerLogin: "square_sandbox_enroller", runtimeLogin: "square_sandbox_runtime", connectionId: uuid(4), connectionGeneration: 4,
  operatorSessionId: uuid(6), defaultLocationId: "SYNTHETIC_LOCATION", discoveryFingerprint: `sha256:${"2".repeat(64)}`, mappedProviderCallsEnabled: true,
  enrollerDatabaseSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/square-sandbox-enroller-db/versions/1",
  runtimeDatabaseSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/square-sandbox-runtime-db/versions/1"
};
binding.mappedApprovalExpiresAt = binding.approvalExpiresAt;
const aad = { schemaVersion: "oauth_credential_aad_v1", purpose: "provider_oauth_credential", environment: "sandbox", providerKey: "square",
  workspaceId: binding.workspaceId, connectionId: binding.connectionId, connectionGeneration: 4, credentialId: uuid(5) };
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), alg: "RS256", use: "sig", kid: "synthetic-key" };
function signed(expected, wrongHost) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: "https://accounts.google.com", aud: expected.identityAudience, sub: expected.serviceAccountSubject, azp: expected.serviceAccountSubject,
    email: expected.serviceAccountEmail, email_verified: true, iat: now - 2, exp: now + 3598,
    google: { compute_engine: { project_id: expected.gcpProjectId, project_number: Number(expected.gcpProjectNumber), zone: expected.gcpZone,
      instance_id: wrongHost ? "999" : expected.gcpInstanceId, instance_name: expected.gcpInstanceName, instance_creation_timestamp: now - 3600 } } };
  const part = [{ alg: "RS256", kid: jwk.kid }, payload].map(v => Buffer.from(JSON.stringify(v)).toString("base64url")).join(".");
  return `${part}.${crypto.sign("RSA-SHA256", Buffer.from(part), privateKey).toString("base64url")}`;
}
let assertions = 0;
function eq(a, b) { assertions++; assert.deepEqual(a, b); }
async function denied(work) { assertions++; await assert.rejects(work, e => e.message === "square_gcp_mapped_credentials_denied"); }
const json = value => new Response(JSON.stringify(value));
function fixture(options = {}) {
  const expected = { ...binding, ...options.binding }, abort = new AbortController(), calls = [];
  let checks = 0;
  const network = async (url, init) => {
    calls.push(url); eq(init.redirect, "error"); eq(init.cache, "no-store"); eq(init.credentials, "omit");
    if (url.startsWith(`${metadata}identity?`)) return new Response(signed(expected, options.wrongHost), { headers: { "Metadata-Flavor": "Google" } });
    if (url === jwks) return json({ keys: [jwk] });
    if (url === `${metadata}token`) return new Response(JSON.stringify({ access_token: "SYNTHETIC_ACCESS", expires_in: 600, token_type: "Bearer" }), { headers: { "Metadata-Flavor": "Google" } });
    eq(init.headers.Authorization, "Bearer SYNTHETIC_ACCESS");
    if (options.network) return options.network(url, init);
    if (url === `https://cloudkms.googleapis.com/v1/${binding.kmsKeyResource}:decrypt`) {
      eq(Object.keys(JSON.parse(init.body)).sort(), ["additionalAuthenticatedData", "ciphertext"]);
      return json({ plaintext: Buffer.from(canary).toString("base64"), protectionLevel: "SOFTWARE", usedPrimary: true });
    }
    const resource = expected.capability === "enroller" ? expected.enrollerDatabaseSecretVersionResource : expected.runtimeDatabaseSecretVersionResource;
    eq(url, `https://secretmanager.googleapis.com/v1/${resource}:access`);
    return json({ name: resource.replace("vaeroex-square-sandbox", expected.gcpProjectNumber), payload: { data: Buffer.from(`postgresql://${expected.runtimeLogin}:${canary}@synthetic.invalid/postgres`).toString("base64") } });
  };
  const identity = createIdentity({ binding: squareGcpMappedHost(expected), network, signal: abort.signal });
  const input = { binding: expected, identity, network, signal: abort.signal, authorizeCredentialRead: async request => {
    checks++; eq(request.aadContext, aad); eq(request.signal, abort.signal);
    if (options.denyAt === checks) throw new Error(canary);
    return options.changedAt === checks ? { ...expected, connectionGeneration: 5 } : expected;
  } };
  return { input, calls, abort, checks: () => checks };
}
const request = changes => ({ keyResource: binding.kmsKeyResource, ciphertext: Buffer.from("synthetic-ciphertext"), additionalAuthenticatedData: credentialAad(aad), ...changes });
async function main() {
  const original = global.fetch; global.fetch = () => assert.fail("No default network permitted");
  try {
    const f = fixture(), c = create(f.input);
    eq(f.calls.length, 0); eq(Object.keys(c).sort(), ["dispose", "kms"]);
    const plaintext = await c.kms.decrypt(request()); eq(Buffer.from(plaintext).toString(), canary); plaintext.fill(0);
    eq(f.checks(), 4); await denied(() => c.kms.decrypt(request()));
    eq(f.calls.filter(v => v.includes("cloudkms")).length, 1);
    for (const denyAt of [1, 2, 3, 4]) {
      const item = fixture({ denyAt }); await denied(() => create(item.input).kms.decrypt(request()));
      eq(item.calls.filter(v => v.includes("cloudkms")).length, denyAt < 3 ? 0 : 1);
    }
    for (const changedAt of [1, 2, 3, 4]) { const item = fixture({ changedAt }); await denied(() => create(item.input).kms.decrypt(request())); }
    for (const changes of [{ workspaceId: uuid(9) }, { connectionId: uuid(9) }, { connectionGeneration: 3 }, { environment: "production" }]) {
      const item = fixture(); await denied(() => create(item.input).kms.decrypt(request({ additionalAuthenticatedData: credentialAad({ ...aad, ...changes }) })));
      eq(item.calls.length, 0);
    }
    for (const change of [{ keyResource: binding.kmsKeyResource + "-foreign" }, { ciphertext: Buffer.alloc(131073) },
      { additionalAuthenticatedData: Buffer.from(JSON.stringify(aad)) }]) {
      const item = fixture(); await denied(() => create(item.input).kms.decrypt(request(change))); eq(item.calls.length, 0);
    }
    const host = fixture({ wrongHost: true }); await denied(() => create(host.input).kms.decrypt(request())); eq(host.calls.some(v => v.includes("cloudkms")), false);
    const enc = fixture(); await denied(() => create(enc.input).kms.encrypt({})); eq(enc.calls.length, 0);
    for (const reply of [{ plaintext: "!!!!", protectionLevel: "SOFTWARE" }, { plaintext: Buffer.alloc(32769).toString("base64"), protectionLevel: "SOFTWARE" },
      { plaintext: Buffer.from(canary).toString("base64"), protectionLevel: "HSM" }, { plaintext: Buffer.from(canary).toString("base64"), protectionLevel: "SOFTWARE", extra: canary }]) {
      const item = fixture({ network: async () => json(reply) }); await denied(() => create(item.input).kms.decrypt(request()));
    }
    for (const network of [async () => new Response(canary, { status: 503 }), async () => new Response("x".repeat(262145)), async () => { throw new Error(canary); }]) {
      const item = fixture({ network }); await denied(() => create(item.input).kms.decrypt(request()));
    }
    const aborted = fixture(); const abortCredentials = create(aborted.input); aborted.abort.abort(); await denied(() => abortCredentials.kms.decrypt(request())); eq(aborted.calls.length, 0);
    let release, observed;
    const reached = new Promise(resolve => { observed = resolve; });
    const pending = fixture({ network: () => { observed(); return new Promise(resolve => { release = resolve; }); } });
    const pendingCredentials = create(pending.input), pendingResult = pendingCredentials.kms.decrypt(request());
    await reached; pending.abort.abort();
    await denied(() => pendingResult);
    release(json({ plaintext: Buffer.from(canary).toString("base64"), protectionLevel: "SOFTWARE" }));
    await new Promise(resolve => setImmediate(resolve));
    await denied(() => pendingCredentials.kms.decrypt(request()));
    const concurrent = fixture(); const instance = create(concurrent.input); const first = instance.kms.decrypt(request());
    await denied(() => instance.kms.decrypt(request())); await denied(() => first);
    for (const capability of ["enroller", "runtime"]) {
      const item = fixture({ binding: { capability, mappedProviderCallsEnabled: false } });
      const bootstrap = { ...item.input }; delete bootstrap.authorizeCredentialRead;
      const value = await read(bootstrap); eq(value.includes(canary), true);
      eq(item.calls.filter(v => v.includes("secretmanager")).length, 1); eq(item.calls.some(v => v.includes("cloudkms") || v.includes("synthetic-app")), false);
    }
    for (const reply of [
      { name: binding.appSecretVersionResource, payload: { data: Buffer.from(canary).toString("base64") } },
      { name: binding.runtimeDatabaseSecretVersionResource, payload: { data: Buffer.from(`postgresql://synthetic:${canary}@host/\n`).toString("base64") } },
      { name: binding.runtimeDatabaseSecretVersionResource, payload: { data: Buffer.alloc(8193).toString("base64") } }
    ]) {
      const item = fixture({ network: async () => json(reply) }); const bootstrap = { ...item.input }; delete bootstrap.authorizeCredentialRead;
      await denied(() => read(bootstrap));
    }
    for (const capability of ["broker", "enroller"]) assert.throws(() => create(fixture({ binding: { capability } }).input));
    assert.throws(() => create(fixture({ binding: { mappedProviderCallsEnabled: false } }).input));
    let getters = 0; const unsafe = { ...fixture().input }; Object.defineProperty(unsafe, "network", { get() { getters++; throw Error(canary); }, enumerable: true });
    assert.throws(() => create(unsafe)); eq(getters, 0);
    process.stdout.write(`square_gcp_mapped_credentials_passed ${assertions}\n`);
  } finally { global.fetch = original; }
}
module.exports = { syntheticMappedBinding: binding };
if (require.main === module) main().catch(() => { process.stderr.write("square_gcp_mapped_credentials_failed\n"); process.exitCode = 1; });
