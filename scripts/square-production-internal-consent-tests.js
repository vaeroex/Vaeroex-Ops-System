const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
}).outputText, filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
  if (/^(?:openai|ai|@ai-sdk)(?:\/|$)|\/lib\/ai\//.test(request)) throw new Error("unexpected_ai_runtime");
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const { createInternalOAuth, createInternalBroker, createInternalOAuthHandler, InternalPermitSchema, internalFingerprint: fp } = require("../services/external-integrations-production/internal-consent/handlers.ts");
const { createInternalRpc } = require("../services/external-integrations-production/internal-consent/database.ts");
const { createInternalConsentTransport } = require("../services/external-integrations-production/internal-consent/transport.ts");
const { createProductionInternalConsentRuntime } = require("../services/external-integrations-production/internal-consent/runtime.ts");
const { ProviderApplicationSecret } = require("../lib/integrations/credentials/secret-manager.ts");
const squareOAuth = require("../lib/integrations/providers/square/account-connection-oauth.ts");
const { SQUARE_OAUTH_SCOPES } = squareOAuth;
const id = () => crypto.randomUUID();
const now = new Date("2026-09-24T12:00:00.000Z");
const permit = {
  providerKey: "square", environment: "production", projectId: "vaeroex-integrations-prod", permitId: id(),
  workspaceId: id(), businessEntityId: id(), operatorId: id(), operatorSessionId: id(), generation: 1,
  configurationFingerprint: fp(["configuration"]), rowVersion: 1, applicationId: "sq0idp-SYNTHETIC_INTERNAL",
  expectedMerchantId: "SYNTHETIC_SELLER", expectedLocationId: "SYNTHETIC_LOCATION",
  approvalExpiresAt: new Date(now.getTime() + 3600_000).toISOString(),
  runtimeEnabled: false, providerCallsEnabled: false, customerOnboardingEnabled: false, webhookIntakeEnabled: false,
  evidenceEnabled: false, economicContributionsEnabled: false, aiDispatchEnabled: false
};
const actor = { actorId: permit.operatorId, sessionId: permit.operatorSessionId, workspaceId: permit.workspaceId, businessEntityId: permit.businessEntityId };
const secretSentinel = "synthetic_private_application_secret_only";
const accessSentinel = "synthetic_private_access_token_only";
const refreshSentinel = "synthetic_private_refresh_token_only";
function callback(state, suffix = "code=synthetic-code") {
  return { method: "GET", url: "/api/integrations/square/callback", rawHeaders: ["Host", "square.vaeroex.com",
    "x-vaeroex-oauth-handoff-version", "square_oauth_callback_handoff_v1",
    "x-vaeroex-oauth-query", Buffer.from(`state=${state}&${suffix}`).toString("base64url")] };
}
function fixture(options = {}) {
  const calls = [], network = [], secrets = [], encrypted = [];
  let created, consumed, acquired, stored;
  let consumeLost = false, acquireLost = false;
  const makeReceipt = () => ({ permitId: permit.permitId, stateId: created.stateId, generation: permit.generation,
    configurationFingerprint: permit.configurationFingerprint, consumeReceiptFingerprint: fp(["consume", created.stateId]) });
  const oauthRpc = async (operation, payload) => {
    calls.push(operation);
    if (options.revoke) throw new Error("synthetic revoked session");
    if (operation === "create_state") {
      assert.equal(payload.requestFingerprint, fp(["create-state-v1", permit.permitId, payload.stateId, payload.stateHash,
        actor.actorId, actor.sessionId, payload.expiresAt, 1]));
      assert.ok(!JSON.stringify(payload).includes("synthetic-code"));
      if (created) throw new Error("already created");
      created = payload;
      return { permitId: permit.permitId, stateId: payload.stateId, state: "consent_pending", expiresAt: payload.expiresAt, auditFingerprint: fp(["audit"]) };
    }
    assert.equal(payload.stateHash, created.stateHash);
    if (operation === "deny_state") return { status: "denied", generation: permit.generation,
      configurationFingerprint: permit.configurationFingerprint, denialReceiptFingerprint: fp(["denial"]) };
    assert.equal(payload.consumeRequestFingerprint, fp(["consume-state-v2", created.stateHash]));
    if (operation === "consume_state") {
      const replayed = !!consumed;
      consumed = { ...makeReceipt(), status: "consumed" };
      if (options.loseConsume && !consumeLost) { consumeLost = true; throw new Error("lost ack"); }
      return { ...consumed, status: replayed ? "replayed" : "consumed" };
    }
    if (operation === "reconcile_state") return consumed;
    throw new Error("unexpected oauth operation");
  };
  const brokerRpc = async (operation, payload) => {
    calls.push(operation);
    if (options.revoke) throw new Error("synthetic revoked session");
    assert.equal(payload.stateId, created.stateId);
    if (operation === "acquire_exchange" || operation === "reconcile_acquire") {
      assert.equal(payload.exchangeRequestFingerprint, fp(["acquire-exchange-v1", created.stateId, consumed.consumeReceiptFingerprint]));
      if (!acquired) acquired = { ...makeReceipt(), status: "acquired", applicationId: permit.applicationId,
        applicationSecretVersionResource: "projects/vaeroex-integrations-prod/secrets/square-production-application/versions/1",
        kmsKeyResource: "projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials",
        requestedScopes: [...SQUARE_OAUTH_SCOPES], expectedMerchantId: permit.expectedMerchantId, expectedLocationId: permit.expectedLocationId,
        exchangeId: id(), exchangeRequestFingerprint: payload.exchangeRequestFingerprint, exchangeReceiptFingerprint: fp(["exchange"]),
        ...options.acquiredChange };
      if (options.loseAcquire && !acquireLost) { acquireLost = true; throw new Error("lost ack"); }
      return acquired;
    }
    assert.equal(payload.exchangeId, acquired.exchangeId);
    assert.equal(payload.exchangeReceiptFingerprint, acquired.exchangeReceiptFingerprint);
    if (operation === "reconcile_exchange") return stored ?? { ...makeReceipt(), status: "uncertain", exchangeId: acquired.exchangeId,
      exchangeRequestFingerprint: acquired.exchangeRequestFingerprint, exchangeReceiptFingerprint: acquired.exchangeReceiptFingerprint };
    if (operation === "commit_credential") {
      assert.equal(payload.merchantId, permit.expectedMerchantId);
      assert.equal(payload.locationId, permit.expectedLocationId);
      assert.equal(payload.commandFingerprint, fp(["credential-command-v1", created.stateId, acquired.exchangeId,
        acquired.exchangeReceiptFingerprint, payload.credentialId, 1, fp(["ciphertext-v1", payload.ciphertextBase64]),
        payload.aadDigest, payload.externalEntityFingerprint, payload.providerIssuedAt, payload.accessExpiresAt, SQUARE_OAUTH_SCOPES.join(",")]));
      for (const secret of [secretSentinel, accessSentinel, refreshSentinel]) assert.ok(!JSON.stringify(payload).includes(secret));
      stored = { ...makeReceipt(), status: "stored", exchangeId: acquired.exchangeId,
        exchangeRequestFingerprint: acquired.exchangeRequestFingerprint, exchangeReceiptFingerprint: acquired.exchangeReceiptFingerprint,
        credentialCommandFingerprint: payload.commandFingerprint };
      if (options.loseCommit) throw new Error("lost ack");
      return stored;
    }
    throw new Error("unexpected broker operation");
  };
  const transport = async request => {
    assert.ok(acquired, "database acquisition committed before provider call");
    assert.equal(new URL(request.url).origin, "https://connect.squareup.com");
    network.push(new URL(request.url).pathname);
    if (options.failProvider) throw new Error("raw synthetic provider error never returned");
    const expiresAt = new Date(now.getTime() + 86400_000).toISOString();
    const location = { id: options.foreignLocation ?? permit.expectedLocationId, merchant_id: permit.expectedMerchantId,
      name: "Synthetic location", status: "ACTIVE", country: "US", currency: "USD", timezone: "UTC" };
    const responses = {
      "/oauth2/token": { access_token: accessSentinel, refresh_token: refreshSentinel, token_type: "bearer", short_lived: true,
        expires_at: expiresAt, merchant_id: options.foreignSeller ?? permit.expectedMerchantId },
      "/oauth2/token/status": { client_id: permit.applicationId, merchant_id: options.foreignSeller ?? permit.expectedMerchantId,
        scopes: [...SQUARE_OAUTH_SCOPES], expires_at: expiresAt },
      "/v2/merchants/me": { merchant: { id: permit.expectedMerchantId, status: "ACTIVE", country: "US", main_location_id: location.id } },
      "/v2/locations": { locations: [location] }, "/v2/locations/main": { location }
    };
    const bytes = Buffer.from(JSON.stringify(responses[new URL(request.url).pathname]));
    return { status: 200, body: (async function*() { yield bytes; })() };
  };
  const broker = createInternalBroker({ permit, brokerRpc, transport, now: () => now,
    async applicationSecret(resource) { secrets.push(resource); return new ProviderApplicationSecret({ schemaVersion: "provider_application_secret_v1",
      providerKey: "square", environment: "production", clientId: permit.applicationId, clientSecret: secretSentinel }); },
    kms: { async encrypt(request) { encrypted.push(request); assert.match(request.plaintext.toString(), /synthetic_private_access_token_only/);
      return Buffer.from("synthetic-encrypted-envelope"); } }
  });
  const oauth = createInternalOAuth({ permit, oauthRpc, brokerExchange: request => broker.exchange(request), now: () => now });
  return { oauth, broker, calls, network, secrets, encrypted, options, get stored() { return stored; } };
}
async function authorized(f) {
  const result = await f.oauth.initiate(actor);
  const navigation = new URL(result.authorizationUrl);
  assert.equal(navigation.origin, "https://connect.squareup.com");
  assert.equal(navigation.searchParams.get("session"), "false");
  assert.equal(navigation.searchParams.get("redirect_uri"), "https://square.vaeroex.com/api/integrations/square/callback");
  return navigation.searchParams.get("state");
}
async function main() {
  for (const options of [{}, { loseConsume: true }, { loseAcquire: true }, { loseCommit: true }]) {
    const f = fixture(options), state = await authorized(f);
    assert.deepEqual(await f.oauth.callback(callback(state)), { status: "stored", nonEconomic: true });
    assert.deepEqual(f.network, ["/oauth2/token", "/oauth2/token/status", "/v2/merchants/me", "/v2/locations", "/v2/locations/main"]);
    assert.equal(f.calls.filter(value => value === "acquire_exchange").length, 1);
    assert.equal(f.calls.filter(value => value === "commit_credential").length, 1);
    assert.equal(f.secrets.length, 1);
    assert.ok(f.encrypted.every(request => request.plaintext.every(byte => byte === 0) && request.additionalAuthenticatedData.every(byte => byte === 0)));
    await assert.rejects(() => f.oauth.callback(callback(state)), /requires_reconciliation/);
    assert.equal(f.network.length, 5, "duplicate callback never exchanges another code");
  }
  for (const options of [{ foreignSeller: "FOREIGN" }, { foreignLocation: "FOREIGN" }, { failProvider: true }]) {
    const f = fixture(options), state = await authorized(f);
    await assert.rejects(() => f.oauth.callback(callback(state)), /requires_reconciliation/);
    assert.equal(f.calls.filter(value => value === "reconcile_exchange").length, 1);
    assert.equal(f.calls.filter(value => value === "commit_credential").length, 0);
    assert.equal(f.network.filter(value => value === "/oauth2/token").length, 1);
  }
  // The provider interface deliberately returns unknown. Revalidate its result
  // at the broker boundary before discovery, encryption or a credential commit.
  const createProvider = squareOAuth.createSquareOAuthCredentialProvider;
  try {
    squareOAuth.createSquareOAuthCredentialProvider = options => {
      const provider = createProvider(options);
      return { ...provider, async exchangeAuthorizationCode(request) {
        return { ...await provider.exchangeAuthorizationCode(request), accessToken: null };
      } };
    };
    const malformed = fixture(), state = await authorized(malformed);
    await assert.rejects(() => malformed.oauth.callback(callback(state)), /provider_exchange_requires_reconciliation/);
    assert.deepEqual(malformed.network, ["/oauth2/token", "/oauth2/token/status"]);
    assert.equal(malformed.encrypted.length, 0);
    assert.equal(malformed.calls.filter(value => value === "commit_credential").length, 0);
    assert.equal(malformed.calls.filter(value => value === "reconcile_exchange").length, 1);
  } finally { squareOAuth.createSquareOAuthCredentialProvider = createProvider; }
  const denial = fixture(), deniedState = await authorized(denial);
  assert.deepEqual(await denial.oauth.callback(callback(deniedState, "error=access_denied&error_description=discarded")), { status: "denied" });
  assert.equal(denial.network.length + denial.secrets.length, 0);
  for (const key of Object.keys(actor)) {
    const f = fixture();
    await assert.rejects(() => f.oauth.initiate({ ...actor, [key]: id() }), /authority_denied/);
    assert.equal(f.calls.length, 0);
  }
  for (const field of ["runtimeEnabled", "providerCallsEnabled", "customerOnboardingEnabled", "webhookIntakeEnabled", "evidenceEnabled", "economicContributionsEnabled", "aiDispatchEnabled"])
    assert.equal(InternalPermitSchema.safeParse({ ...permit, [field]: true }).success, false);
  const revoked = fixture(), revokedState = await authorized(revoked);
  revoked.options.revoke = true;
  await assert.rejects(() => revoked.oauth.callback(callback(revokedState)), /state_consume_requires_reconciliation/);
  assert.equal(revoked.network.length, 0);
  for (const change of [{ generation: 2 }, { expectedMerchantId: "FOREIGN" }, { applicationSecretVersionResource: "projects/vaeroex-square-sandbox/secrets/s/versions/1" }]) {
    const f = fixture({ acquiredChange: change }), state = await authorized(f);
    await assert.rejects(() => f.oauth.callback(callback(state)), /requires_reconciliation/);
    assert.equal(f.network.length + f.secrets.length, 0);
  }
  for (const mutate of [request => { request.rawHeaders[1] = "vaeroex.com"; }, request => { request.rawHeaders.push("x-forwarded-host", "square.vaeroex.com"); },
    request => { request.url += "?code=x"; }, request => { request.method = "POST"; }]) {
    const f = fixture(), state = await authorized(f), request = callback(state); mutate(request);
    await assert.rejects(() => f.oauth.callback(request));
    assert.equal(f.calls.length, 1, "host/query gate stops before database consumption");
  }
  const closed = createInternalOAuthHandler({ runtime: null, authenticate() { throw new Error("must not authenticate"); } });
  assert.equal((await closed(new Request("https://square.vaeroex.com/api/integrations/square/connect", { method: "POST" }))).status, 404);
  const f = fixture(), handler = createInternalOAuthHandler({ runtime: f.oauth, authenticate: async () => actor });
  assert.equal((await handler(new Request("https://square.vaeroex.com/api/integrations/square/connect", { method: "POST" }))).status, 200);
  assert.equal((await handler(new Request("https://square.vaeroex.com/api/integrations/square/webhook", { method: "POST" }))).status, 404);

  for (const profile of ["oauth", "broker"]) {
    const queries = [], ended = [];
    const rpc = createInternalRpc(profile, async () => ({ async query(sql, args) {
      queries.push([sql, args]);
      if (sql.startsWith("select session_user")) return { rows: [{ login: `square_production_${profile}`, current_login: `square_production_${profile}` }] };
      return { rows: [{ value: { status: "synthetic" } }] };
    }, async end() { ended.push(true); } }));
    await rpc(profile === "oauth" ? "create_state" : "acquire_exchange", { stateId: id() });
    assert.equal(queries[1][0], `set role square_production_${profile}_authority`);
    assert.equal(queries[2][0], `select public.square_production_internal_${profile}_v1($1::text,$2::jsonb) as value`);
    assert.equal(ended.length, 1);
    await assert.rejects(() => rpc("create_scan", {}), /operation_denied/);
    assert.equal(ended.length, 1);
  }
  const wrong = createInternalRpc("oauth", async () => ({ async query() { return { rows: [{ login: "postgres", current_login: "postgres" }] }; }, async end() {} }));
  await assert.rejects(() => wrong("create_state", {}), /result_unavailable/);
  const runtimeFetch = global.fetch;
  try {
    for (const profile of ["oauth", "broker"]) {
      const metadataCalls = [];
      global.fetch = async url => {
        metadataCalls.push(String(url));
        if (url === "http://metadata.google.internal/computeMetadata/v1/project/project-id") return new Response("vaeroex-integrations-prod");
        if (url === "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email")
          return new Response(`sq-prod-${profile}@vaeroex-integrations-prod.iam.gserviceaccount.com`);
        throw new Error("unexpected_runtime_qualification_network");
      };
      const configuration = { profile, permit, databaseVersion: 1,
        databaseCa: fs.readFileSync(path.join(root, "tools/jit-access-feasibility/supabase-root-2021.crt"), "utf8"),
        brokerOrigin: "https://square-production-broker-u5c6zahmpq-uw.a.run.app",
        supabasePublishableKey: "sb_publishable_synthetic_configuration_only" };
      const server = await createProductionInternalConsentRuntime(configuration);
      assert.equal(server.listening, false);
      assert.equal(metadataCalls.length, 2, "version 1 assembly uses only the expected identity readback");
      for (const databaseVersion of [0, 2, 1.5, null, undefined, "1"])
        await assert.rejects(() => createProductionInternalConsentRuntime({ ...configuration, databaseVersion }), /Invalid literal value/);
      assert.equal(metadataCalls.length, 2, "non-version-1 configuration stops before metadata, database, secret or provider access");
    }
  } finally { global.fetch = runtimeFetch; }
  let networkCalls = 0, authorizations = 0;
  const transport = createInternalConsentTransport({ applicationId: permit.applicationId, authorize: async () => { authorizations++; },
    network: async () => { networkCalls++; return new Response("{}", { status: 200 }); } });
  const request = { url: "https://connect.squareup.com/oauth2/token", method: "POST", maximumResponseBytes: 65_536,
    headers: { "Square-Version": "2026-08-19", "Content-Type": "application/json" }, signal: new AbortController().signal,
    body: JSON.stringify({ client_id: permit.applicationId, grant_type: "authorization_code", short_lived: true,
      redirect_uri: "https://square.vaeroex.com/api/integrations/square/callback" }) };
  const accepted = await transport(request);
  for await (const chunk of accepted.body) assert.ok(chunk instanceof Uint8Array);
  assert.equal(networkCalls, 1); assert.equal(authorizations, 1);
  for (const url of ["https://connect.squareupsandbox.com/oauth2/token", "https://connect.squareup.com/oauth2/revoke", "https://connect.squareup.com/v2/payments"])
    await assert.rejects(() => transport({ ...request, url }), /transport_denied/);
  await assert.rejects(() => transport({ ...request, body: JSON.stringify({ ...JSON.parse(request.body), grant_type: "refresh_token" }) }), /transport_denied/);
  assert.equal(networkCalls, 1);

  // The real authenticated Next proxy is tested with a validated session; no
  // client-supplied workspace or database authority is forwarded to the edge.
  const load = Module._load, savedFetch = global.fetch, savedNow = Date.now;
  const savedEnvironment = { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV,
    SQUARE_INTERNAL_PILOT_WORKSPACE: process.env.SQUARE_INTERNAL_PILOT_WORKSPACE };
  let workspace = permit.workspaceId, session = permit.operatorSessionId, authReads = 0, proxyCalls = 0;
  const jwtSentinel = "synthetic_user_session_secret_not_for_navigation";
  Module._load = function(name, parent, isMain) {
    if (name === "@/lib/security/require-workspace-access") return { async requireWorkspaceAccess() {
      authReads++;
      return { workspaceId: workspace, user: { id: permit.operatorId }, membership: { role: "owner" },
        supabase: { auth: {
          async getClaims() { return { data: { claims: { sub: permit.operatorId, session_id: session } }, error: null }; },
          async getSession() { return { data: { session: { user: { id: permit.operatorId }, access_token: jwtSentinel } }, error: null }; }
        } } };
    } };
    return load.call(this, name, parent, isMain);
  };
  try {
    Date.now = () => now.getTime();
    const pilot = require("../lib/integrations/control-plane/square-internal-pilot.ts");
    process.env.NODE_ENV = "production"; process.env.VERCEL_ENV = "production";
    delete process.env.SQUARE_INTERNAL_PILOT_WORKSPACE;
    const request = (origin = "https://www.vaeroex.com") => new Request(`${origin}/api/integrations/square/internal/connect`, {
      method: "POST", headers: { origin, host: new URL(origin).host, "sec-fetch-site": "same-origin" }
    });
    assert.equal((await pilot.initiateSquareInternalPilot(request())).status, 404);
    assert.equal(authReads, 0, "disabled_private_route_stops_before_authentication");
    process.env.SQUARE_INTERNAL_PILOT_WORKSPACE = JSON.stringify({ operatorId: permit.operatorId,
      operatorSessionId: permit.operatorSessionId, workspaceId: permit.workspaceId,
      applicationId: permit.applicationId, approvalExpiresAt: permit.approvalExpiresAt });
    const authorizationUrl = new URL("https://connect.squareup.com/oauth2/authorize");
    authorizationUrl.search = new URLSearchParams({ client_id: permit.applicationId,
      redirect_uri: "https://square.vaeroex.com/api/integrations/square/callback", scope: SQUARE_OAUTH_SCOPES.join(" "),
      state: "x".repeat(43), session: "false" }).toString();
    global.fetch = async (url, options) => {
      proxyCalls++;
      assert.equal(url, "https://square.vaeroex.com/api/integrations/square/connect");
      assert.equal(options.method, "POST"); assert.equal(options.body, undefined);
      assert.deepEqual(options.headers, { Authorization: `Bearer ${jwtSentinel}` });
      return Response.json({ authorizationUrl: authorizationUrl.href, expiresAt: new Date(now.getTime() + 60_000).toISOString() });
    };
    const accepted = await pilot.initiateSquareInternalPilot(request());
    assert.equal(accepted.status, 200); assert.equal(proxyCalls, 1);
    const html = await accepted.text();
    for (const privateValue of [jwtSentinel, permit.workspaceId, permit.operatorId, permit.operatorSessionId]) assert.ok(!html.includes(privateValue));
    assert.equal(accepted.headers.get("referrer-policy"), "no-referrer");
    for (const origin of ["https://vaeroex.com", "https://preview.vercel.app", "http://localhost:3000", "https://other.invalid"])
      assert.equal((await pilot.initiateSquareInternalPilot(request(origin))).status, 404);
    workspace = id(); assert.equal(await pilot.squareInternalPilotAccess(), null);
    assert.equal((await pilot.initiateSquareInternalPilot(request())).status, 404);
    workspace = permit.workspaceId; session = id(); assert.equal(await pilot.squareInternalPilotAccess(), null);
    assert.equal((await pilot.initiateSquareInternalPilot(request())).status, 404);
    session = permit.operatorSessionId; process.env.VERCEL_ENV = "preview";
    assert.equal((await pilot.initiateSquareInternalPilot(request())).status, 404);
    assert.equal(proxyCalls, 1, "preview_foreign_workspace_and_changed_session_never_forward_a_token");
    process.env.VERCEL_ENV = "production";
    global.fetch = async () => new Response(" ".repeat(8193), { status: 200 });
    assert.equal((await pilot.initiateSquareInternalPilot(request())).status, 404, "response_budget_does_not_trust_content_length");
    let manualCalls = 0;
    global.fetch = async (url, options) => {
      manualCalls++;
      assert.equal(url, "https://square.vaeroex.com/api/integrations/square/connect");
      assert.equal(options.headers["x-vaeroex-square-action"], "map");
      assert.equal(options.body, undefined);
      assert.equal(options.headers.Authorization, `Bearer ${jwtSentinel}`);
      return Response.json({ status: "mapped", nonEconomic: true });
    };
    assert.deepEqual(await (await pilot.executeSquareInternalPilotAction(request(), "map")).json(), { status: "mapped", nonEconomic: true });
    workspace = id();
    assert.equal((await pilot.executeSquareInternalPilotAction(request(), "map")).status, 404);
    workspace = permit.workspaceId;
    assert.equal((await pilot.executeSquareInternalPilotAction(request(), "scheduler")).status, 404);
    assert.equal((await pilot.executeSquareInternalPilotAction(request("https://other.example"), "map")).status, 404);
    assert.equal(manualCalls, 1, "manual_foreign_workspace_origin_and_unknown_action_stop_before_forwarding");
    global.fetch = async () => Response.json({ status: "mapped", nonEconomic: true, credential: "synthetic_private_value" });
    assert.equal((await pilot.executeSquareInternalPilotAction(request(), "map")).status, 404, "manual_proxy_rejects_unexpected_private_fields");
  } finally {
    Module._load = load; global.fetch = savedFetch; Date.now = savedNow;
    for (const [name, value] of Object.entries(savedEnvironment)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
  await require("./square-production-manual-read-tests.js")({ permit, actor, now, fp });
  console.log("Square internal Production consent: real handlers, five exact provider endpoints, encrypted commit, replay/lost-ack, denial/isolation, zero AI: passed");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
