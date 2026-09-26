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
const { createProductionCustomerOAuth, createProductionCustomerBroker, customerFingerprint } = require("../services/external-integrations-production/internal-consent/customer-flow.ts");
const { createCustomerRpc } = require("../services/external-integrations-production/internal-consent/database.ts");
const { createCustomerOAuthHandler, createCustomerBrokerHandler } = require("../services/external-integrations-production/internal-consent/customer-server.ts");
const { oauthStateHash } = require("../lib/integrations/credentials/oauth-state.ts");
const id = () => crypto.randomUUID();
const now = new Date("2026-09-24T12:00:00.000Z");
const actor = { actorId: id(), sessionId: id(), workspaceId: id() }, businessEntityId = id();
const applicationId = "sq0idp-SYNTHETIC_CUSTOMER";
const configurationFingerprint = customerFingerprint(["configuration"]);
function callback(state) {
  return { method: "GET", url: "/api/integrations/square/callback", rawHeaders: ["Host", "square.vaeroex.com",
    "x-vaeroex-oauth-handoff-version", "square_oauth_callback_handoff_v1",
    "x-vaeroex-oauth-query", Buffer.from(`state=${state}&code=synthetic-code`).toString("base64url")] };
}
function fixture(failBeforeAcquire = false) {
  const calls = [], exchange = [];
  const state = crypto.randomBytes(32).toString("base64url");
  const created = { stateId: id(), connectionId: id(), stateHash: oauthStateHash(state) };
  let consumed = false;
  const rpc = async (operation, payload) => {
    calls.push(operation);
    if (operation === "lookup_state") {
      assert.equal(payload.stateHash, created.stateHash);
      return { accepted: true, stateId: created.stateId, ...actor, connectionId: created.connectionId,
        businessEntityId, generation: 1, rowVersion: 1, applicationId, configurationFingerprint };
    }
    if (operation === "consume_state") {
      assert.equal(payload.requestFingerprint, customerFingerprint(["square-production-customer-consume-v1", created.stateId, created.stateHash, 1]));
      const status = consumed ? "replayed" : "acquired";
      consumed = true;
      return { status, stateId: created.stateId, connectionId: created.connectionId, generation: 1 };
    }
    if (operation === "deny_state") { assert.equal(payload.stateHash, created.stateHash); return { accepted: true }; }
    if (operation === "authorization_failed") { assert.equal(payload.stateId, created.stateId); return { fenced: true }; }
    throw new Error("unexpected operation");
  };
  const oauth = createProductionCustomerOAuth({ applicationId, rpc, now: () => now,
    async exchange(command) { exchange.push(command); if (failBeforeAcquire) throw new Error('synthetic_broker_unreachable');
      return { status: "stored", nonEconomic: true }; } });
  return { oauth, calls, exchange, state, created };
}

async function main() {
  const first = fixture();
  assert.equal((await first.oauth.callback(callback(first.state))).status, "stored");
  assert.equal(first.exchange.length, 1);
  await assert.rejects(() => first.oauth.callback(callback(first.state)), /requires_reconciliation/);
  assert.equal(first.exchange.length, 1, "replayed callback cannot repeat provider exchange");
  const revoked = fixture();
  await assert.rejects(() => revoked.oauth.callback({ ...callback(revoked.state), rawHeaders: ["Host", "other.vaeroex.com"] }));
  assert.equal(revoked.exchange.length, 0, "host fails before exchange");
  const unreachable = fixture(true);
  await assert.rejects(() => unreachable.oauth.callback(callback(unreachable.state)), /requires_reconciliation/);
  assert.deepEqual(unreachable.calls, ['lookup_state', 'consume_state', 'authorization_failed']);
  await assert.rejects(() => unreachable.oauth.callback(callback(unreachable.state)), /requires_reconciliation/);
  assert.equal(unreachable.exchange.length, 1, 'lost broker connection does not retry provider exchange');

  for (const profile of ["oauth", "broker"]) {
    const queries = [];
    const rpc = createCustomerRpc(profile, async () => ({ async query(sql, args) {
      queries.push([sql, args]);
      if (sql.startsWith("select session_user")) return { rows: [{ login: `square_production_${profile}`, current_login: `square_production_${profile}` }] };
      return { rows: [{ value: { ok: true } }] };
    }, async end() {} }));
    await rpc(profile === "oauth" ? "lookup_state" : "acquire_exchange", { stateHash: "synthetic" });
    assert.equal(queries[1][0], "select public.square_production_customer_v1($1::text,$2::jsonb) as value");
    await assert.rejects(() => rpc(profile === "oauth" ? "commit_credential" : "lookup_state", {}));
  }

  const rawToken = "synthetic_private_access_token_only", rawRefresh = "synthetic_private_refresh_token_only";
  function brokerFixture(change = {}, stopAfter = Infinity) {
    const calls = [], network = [], encryption = [];
    let acquired = false;
    const command = { stateId: id(), connectionId: id(), generation: 1, ...actor,
      businessEntityId, applicationId, configurationFingerprint, authorizationCode: "synthetic-code" };
    const broker = createProductionCustomerBroker({ applicationId, now: () => now,
      rpc: async (operation, payload) => {
        calls.push(operation);
        if (operation === "acquire_exchange") {
          assert.equal(payload.requestFingerprint, customerFingerprint(["square-production-customer-acquire-v1",
            command.stateId, command.connectionId, 1]));
          if (acquired) return { status: "replayed", stateId: command.stateId, connectionId: command.connectionId, generation: 1 };
          acquired = true;
          return { status: "acquired", stateId: command.stateId, connectionId: command.connectionId, generation: 1,
            ...actor, businessEntityId, applicationId, configurationFingerprint,
            kmsKeyResource: "projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials",
            ...change };
        }
        if (operation === "authorize_exchange") {
          assert.equal(payload.stateId, command.stateId);
          assert.equal(payload.connectionId, command.connectionId);
          assert.equal(payload.generation, command.generation);
          if (network.length >= stopAfter) throw new Error("square_customer_connection_fenced");
          return { authorized: true, stateId: command.stateId, connectionId: command.connectionId, generation: 1 };
        }
        assert.equal(operation, "commit_credential");
        assert.equal(payload.requestFingerprint, customerFingerprint(["square-production-customer-commit-v1",
          command.stateId, payload.credentialId, 1, payload.aadDigest, "SYNTHETIC_SELLER"]));
        assert.equal(payload.aadDigest, customerFingerprint(["square-production-customer-aad-v1",
          actor.workspaceId, command.connectionId, 1, payload.credentialId, 1]));
        assert.ok(!JSON.stringify(payload).includes(rawToken));
        assert.ok(!JSON.stringify(payload).includes(rawRefresh));
        return { status: "stored", connectionId: command.connectionId, generation: 1, replayed: false };
      },
      async applicationSecret() { return new (require("../lib/integrations/credentials/secret-manager.ts").ProviderApplicationSecret)({
        schemaVersion: "provider_application_secret_v1", providerKey: "square", environment: "production",
        clientId: applicationId, clientSecret: "synthetic_private_application_secret_only"
      }); },
      kms: { async encrypt(request) { encryption.push(request); assert.match(request.plaintext.toString(), /synthetic_private_access_token_only/);
        return Buffer.from("synthetic-encrypted-envelope"); } },
      transport: authorize => async request => {
        await authorize();
        assert.ok(acquired, "durable broker acquire precedes provider call");
        network.push(new URL(request.url).pathname);
        const expiresAt = new Date(now.getTime() + 86400_000).toISOString();
        const location = { id: "SYNTHETIC_LOCATION", merchant_id: "SYNTHETIC_SELLER", name: "Synthetic location",
          status: "ACTIVE", country: "US", currency: "USD", timezone: "UTC" };
        const responses = {
          "/oauth2/token": { access_token: rawToken, refresh_token: rawRefresh, token_type: "bearer", short_lived: true,
            expires_at: expiresAt, merchant_id: "SYNTHETIC_SELLER" },
          "/oauth2/token/status": { client_id: applicationId, merchant_id: "SYNTHETIC_SELLER",
            scopes: [...require("../lib/integrations/providers/square/account-connection-oauth.ts").SQUARE_OAUTH_SCOPES], expires_at: expiresAt },
          "/v2/merchants/me": { merchant: { id: "SYNTHETIC_SELLER", status: "ACTIVE", country: "US", main_location_id: location.id } },
          "/v2/locations": { locations: [location] }, "/v2/locations/main": { location }
        };
        return { status: 200, body: (async function*() { yield Buffer.from(JSON.stringify(responses[new URL(request.url).pathname])); })() };
      }
    });
    return { broker, command, calls, network, encryption };
  }
  const committed = brokerFixture();
  assert.deepEqual(await committed.broker.exchange(committed.command), { status: "stored", nonEconomic: true });
  assert.deepEqual(committed.network, ["/oauth2/token", "/oauth2/token/status", "/v2/merchants/me", "/v2/locations", "/v2/locations/main"]);
  assert.ok(committed.encryption.every(request => request.plaintext.every(byte => byte === 0) &&
    request.additionalAuthenticatedData.every(byte => byte === 0)));
  await assert.rejects(() => committed.broker.exchange(committed.command), /requires_reconciliation/);
  assert.equal(committed.network.length, 5, "broker replay never exchanges code twice");
  const crossWorkspace = brokerFixture({ workspaceId: id() });
  await assert.rejects(() => crossWorkspace.broker.exchange(crossWorkspace.command), /requires_reconciliation/);
  assert.equal(crossWorkspace.network.length, 0, "foreign workspace rejected before provider call");
  for (const completedCalls of [0, 1]) {
    const disconnected = brokerFixture({}, completedCalls);
    await assert.rejects(() => disconnected.broker.exchange(disconnected.command), /requires_reconciliation/);
    assert.equal(disconnected.network.length, completedCalls,
      "disconnect after acquisition or one call prevents every subsequent provider call");
    assert.ok(!disconnected.calls.includes("commit_credential"));
  }

  const managed = fixture();
  const oauthHandler = createCustomerOAuthHandler(managed.oauth);
  const redirect = await oauthHandler(new Request("https://square.vaeroex.com/api/integrations/square/callback"),
    callback(managed.state).rawHeaders);
  assert.equal(redirect.status, 303, "validated callback returns browser to workspace");
  assert.equal(redirect.headers.get('location'), 'https://www.vaeroex.com/app/settings/integrations/square');
  assert.equal(await redirect.text(), '', 'callback redirect carries no OAuth data');
  const deniedHandler = createCustomerOAuthHandler({ async callback() { return { status: 'denied' }; } });
  assert.equal((await deniedHandler(new Request('https://square.vaeroex.com/api/integrations/square/callback'),
    callback(managed.state).rawHeaders)).headers.get('location'), redirect.headers.get('location'));
  assert.equal((await oauthHandler(new Request("https://square.vaeroex.com/api/integrations/square/callback?state=leak"),
    callback(managed.state).rawHeaders)).status, 404, "raw public query is never accepted by backend handoff");
  assert.equal((await oauthHandler(new Request("https://other.vaeroex.com/api/integrations/square/callback"),
    callback(managed.state).rawHeaders)).status, 404);

  const serviceBroker = brokerFixture();
  const brokerHandler = createCustomerBrokerHandler({ runtime: serviceBroker.broker,
    authenticateOAuthService: async request => request.headers.get("authorization") === "Bearer synthetic-service-identity" });
  const brokerRequest = new Request("https://square-production-broker-u5c6zahmpq-uw.a.run.app/internal/square/broker/customer-exchange",
    { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer synthetic-service-identity" } });
  assert.equal((await brokerHandler(brokerRequest, serviceBroker.command)).status, 200);
  assert.equal(serviceBroker.network.length, 5);
  assert.equal((await brokerHandler(brokerRequest, serviceBroker.command)).status, 409);
  assert.equal(serviceBroker.network.length, 5, "broker service replay is non-economic and does not repeat provider exchange");
  const noServiceIdentity = new Request(brokerRequest.url, { method: "POST", headers: { "content-type": "application/json" } });
  assert.equal((await brokerHandler(noServiceIdentity, serviceBroker.command)).status, 404);
  process.stdout.write("square_production_customer_flow_positive_replay_isolation_zero_ai_passed\n");
}
main().catch(() => { process.stderr.write("square_production_customer_flow_failed\n"); process.exitCode = 1; });
