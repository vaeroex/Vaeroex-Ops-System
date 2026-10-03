const assert = require("node:assert/strict");
const { loadSquareBrowserModules } = require("./square-account-browser-test-support.js");
loadSquareBrowserModules();
const {
  checkedSquareRemoteSandboxBinding, squareRemoteSandboxCandidate, SQUARE_REMOTE_SANDBOX: constants
} = require("../lib/integrations/control-plane/square-remote-sandbox-contracts.ts");
const { checkedSquareSandboxDatabaseUrl, openSquareRemoteDatabase } = require("../lib/integrations/control-plane/square-remote-sandbox-database.ts");
const { createSquareSandboxOAuthTransport, readSquareSandboxNotification } = require("../lib/integrations/control-plane/square-remote-sandbox-transport.ts");
const { createSquareRemoteSandboxCustomerHandlers } = require("../lib/integrations/control-plane/square-customer-routes.ts");
const { SQUARE_OAUTH_SCOPES, squareAuthorizationUrl, createSquareOAuthPolicy, createSquareOAuthCredentialProvider, readSquareAuthenticatedDiscovery } = require("../lib/integrations/providers/square/account-connection-oauth.ts");
const { ProviderApplicationSecret } = require("../lib/integrations/credentials/secret-manager.ts");
const uuid = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const binding = {
  contractVersion: constants.contractVersion, projectRef: constants.projectRef,
  vercelTeamId: constants.vercelTeamId, vercelTeamSlug: "vaeroex-2167s-projects",
  vercelProjectId: "prj_SyntheticSquareSandboxOnly123", vercelProjectName: constants.vercelProjectName,
  applicationOrigin: constants.applicationOrigin, environment: "sandbox", applicationId: constants.applicationId,
  apiVersion: constants.apiVersion, operatorId: uuid(1), workspaceId: uuid(2), businessEntityId: uuid(3), operatorRole: "owner",
  brokerLogin: "square_sandbox_broker", enrollerLogin: "square_sandbox_enroller", webhookLogin: "square_sandbox_webhook", runtimeLogin: "square_sandbox_runtime",
  approvalExpiresAt: new Date(Date.now() + 3600000).toISOString(), enabled: true, providerCallsEnabled: false,
  policyVersion: "synthetic_test_only_v1", policyFingerprint: `sha256:${"1".repeat(64)}`,
  kmsKeyResource: null, appSecretVersionResource: null, webhookSecretVersionResource: null,
  credentialServiceAccount: null, workloadIdentityAudience: null
};
let assertions = 0;
const equal = (a, b, message) => { assertions++; assert.equal(a, b, message); };
const ok = (a, message) => { assertions++; assert.ok(a, message); };
const denies = (f, message) => { assertions++; assert.throws(f, undefined, message); };
const rejects = async (f, message) => { assertions++; await assert.rejects(f, undefined, message); };
const environment = {
  SQUARE_REMOTE_SANDBOX: "configured", VERCEL: "1", VERCEL_ENV: "production", NODE_ENV: "production",
  VERCEL_PROJECT_ID: binding.vercelProjectId, NEXT_PUBLIC_SUPABASE_URL: `https://${binding.projectRef}.supabase.co`,
  NEXT_PUBLIC_APP_URL: binding.applicationOrigin, SQUARE_ENVIRONMENT: "sandbox", SQUARE_APPLICATION_ID: binding.applicationId,
  SQUARE_API_VERSION: binding.apiVersion
};
const oldEnv = Object.fromEntries([...Object.keys(environment), "VERCEL_OIDC_TOKEN"].map(key => [key, process.env[key]]));
const restoreEnv = () => { for (const [key, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
const origin = binding.applicationOrigin;
const request = (action, body, headers = {}) => new Request(`${origin}/api/integrations/square/${action}`, {
  method: ["status", "callback"].includes(action) ? "GET" : "POST",
  headers: { host: "square-sandbox.vaeroex.com", origin, "content-type": "application/x-www-form-urlencoded", ...headers },
  ...(body === undefined ? {} : { body })
});
async function main() {
  const checked = checkedSquareRemoteSandboxBinding(binding);
  ok(Object.isFrozen(checked)); ok(checked !== binding);
  for (const [key, value] of [
    ["projectRef", "foreignprojectreference"], ["applicationOrigin", "https://www.vaeroex.com"],
    ["applicationOrigin", "https://arbitrary.vercel.app"], ["applicationId", "sq0idp-production"], ["environment", "production"],
    ["apiVersion", "2025-01-01"], ["vercelProjectId", constants.forbiddenVercelProjectId], ["vercelTeamId", "team_foreign"],
    ["vercelTeamSlug", "foreign-team"], ["vercelProjectName", "production"], ["operatorId", null], ["workspaceId", null],
    ["businessEntityId", null], ["operatorRole", "viewer"], ["enabled", false], ["approvalExpiresAt", new Date(0).toISOString()],
    ["runtimeLogin", binding.brokerLogin], ["brokerLogin", "postgres"], ["policyVersion", ""], ["policyFingerprint", null],
    ["providerCallsEnabled", true], ["appSecretVersionResource", "projects/synthetic/secrets/test/versions/latest"]
  ]) denies(() => checkedSquareRemoteSandboxBinding({ ...binding, [key]: value }), `reject changed ${key}`);
  for (const key of Object.keys(binding)) { const copy = { ...binding }; delete copy[key]; denies(() => checkedSquareRemoteSandboxBinding(copy), `reject missing ${key}`); }
  let accessed = 0;
  const accessor = { ...binding }; Object.defineProperty(accessor, "operatorId", { get() { accessed++; return uuid(1); }, enumerable: true });
  denies(() => checkedSquareRemoteSandboxBinding(accessor)); equal(accessed, 0);
  const proxy = new Proxy(binding, { ownKeys() { accessed++; return Reflect.ownKeys(binding); } });
  denies(() => checkedSquareRemoteSandboxBinding(proxy)); equal(accessed, 0);
  const revoked = Proxy.revocable(binding, {}); revoked.revoke(); denies(() => checkedSquareRemoteSandboxBinding(revoked.proxy));

  Object.assign(process.env, environment);
  equal(squareRemoteSandboxCandidate(request("status")), true, "candidate is not authority");
  for (const [key, value] of Object.entries(environment)) {
    delete process.env[key]; equal(squareRemoteSandboxCandidate(request("status")), false, `missing ${key}`); process.env[key] = value;
  }
  for (const url of ["https://www.vaeroex.com", "https://vaeroex.com", "https://arbitrary.vercel.app", "http://square-sandbox.vaeroex.com", "https://square-sandbox.vaeroex.com:444", "https://square-sandbox.vaeroex.com.evil.test"]) {
    equal(squareRemoteSandboxCandidate(new Request(`${url}/api/integrations/square/status`, { headers: { host: "square-sandbox.vaeroex.com" } })), false);
  }
  equal(squareRemoteSandboxCandidate(new Request(`${origin}/api/integrations/square/status`, { headers: { host: "arbitrary.vercel.app", "x-forwarded-host": "square-sandbox.vaeroex.com" } })), false);
  process.env.VERCEL_PROJECT_ID = constants.forbiddenVercelProjectId; equal(squareRemoteSandboxCandidate(request("status")), false); process.env.VERCEL_PROJECT_ID = binding.vercelProjectId;
  process.env.VERCEL_ENV = "preview"; equal(squareRemoteSandboxCandidate(request("status")), false); process.env.VERCEL_ENV = "production";
  const availability = require("../lib/integrations/control-plane/square-customer-availability.ts");
  equal((await availability.squareCustomerRoute("status", request("status"))).status, 404, "environment alone cannot install remote capabilities");

  const dsn = `postgresql://${binding.brokerLogin}:synthetic-fixture-not-a-password@db.${binding.projectRef}.supabase.co:5432/postgres?sslmode=require`;
  equal(checkedSquareSandboxDatabaseUrl(dsn).login, binding.brokerLogin);
  ok(!checkedSquareSandboxDatabaseUrl(dsn).connectionString.includes("sslmode"));
  equal(checkedSquareSandboxDatabaseUrl(`postgresql://${binding.brokerLogin}.${binding.projectRef}:synthetic-fixture@aws-0-us-west-2.pooler.supabase.com:6543/postgres`).login, binding.brokerLogin);
  for (const value of [dsn.replace(binding.projectRef, "foreign"), dsn.replace(binding.brokerLogin, "postgres"), dsn.replace("sslmode=require", "sslmode=disable"),
    dsn.replace("sslmode=require", "options=-csearch_path=public"), dsn.replace("/postgres?", "/production?"), dsn.replace(":5432", ":4444"),
    `postgresql://${binding.brokerLogin}.foreign:synthetic-fixture@aws-0-us-west-2.pooler.supabase.com:6543/postgres`,
    `postgresql://${binding.brokerLogin}.${binding.projectRef}:synthetic-fixture@evil.example:6543/postgres`]) denies(() => checkedSquareSandboxDatabaseUrl(value));

  const pg = require("pg"), originalClient = pg.Client;
  let sql = [], resultBinding = binding, ended = 0, expireAfterPageQuery = false;
  pg.Client = class {
    constructor(options) { equal(options.ssl.rejectUnauthorized, true); equal(options.statement_timeout, 5000); }
    on() {} async connect() {} async end() { ended++; }
    async query(input, parameters) {
      const query = typeof input === "string" ? input : input.text;
      sql.push({ query, parameters: typeof input === "string" ? parameters : input.values, queryTimeout: typeof input === "string" ? undefined : input.query_timeout });
      if (query.includes("get_square_remote_sandbox_binding_v1")) return { rows: [{ value: JSON.stringify(resultBinding) }] };
      if (query.includes("commit_square_ingestion_page_v1") && expireAfterPageQuery) resultBinding = { ...binding, approvalExpiresAt: new Date(0).toISOString() };
      if (query.includes("square_account_connection_v1") || query.includes("commit_square_ingestion_page_v1") || query.includes("resolve_square_ingestion_authority_v1")) return { rows: [{ value: JSON.stringify({ fixture: true }) }] };
      return { rows: [] };
    }
  };
  try {
    const db = await openSquareRemoteDatabase("broker", dsn);
    const input = { p_context: {}, p_operation: "status", p_command: {} };
    equal((await db.client.rpc("square_account_connection_v1", input)).data.fixture, true);
    equal(sql.find(item => item.query.includes("square_account_connection_v1")).queryTimeout, 6000);
    ok(sql.some(item => item.query === "begin")); ok(sql.some(item => item.query === "commit"));
    equal(sql.filter(item => item.query.includes("get_square_remote_sandbox_binding_v1")).length, 2, "binding rechecked in same transaction as each operation");
    for (const name of ["qbo_runtime_v1", "enroll_square_qualification_connection_v1", "enroll_square_verified_connection_v1", "square_account_connection_v1); drop table public.workspaces; --"]) {
      const count = sql.length; await rejects(() => db.client.rpc(name, input)); equal(sql.length, count);
    }
    await rejects(() => db.client.rpc("square_account_connection_v1", { ...input, extra: 1 }));
    resultBinding = { ...binding, approvalExpiresAt: new Date(0).toISOString() };
    await rejects(() => db.client.rpc("square_account_connection_v1", input)); equal(ended, 1);
    resultBinding = binding; await rejects(() => db.client.rpc("square_account_connection_v1", input), "closed uncertain connection never restores authority");
    await db.close(); equal(ended, 1);
    await rejects(() => openSquareRemoteDatabase("runtime", dsn), "runtime cannot reuse broker LOGIN");
    const runtimeDb = await openSquareRemoteDatabase("runtime", dsn.replace(binding.brokerLogin, binding.runtimeLogin));
    await runtimeDb.client.rpc("commit_square_ingestion_page_v1", {
      p_task_id: uuid(7), p_lease_owner_fingerprint: `sha256:${"2".repeat(64)}`, p_command: {}
    });
    equal(sql.find(item => item.query.includes("commit_square_ingestion_page_v1")).queryTimeout, 21000);
    equal(sql.filter(item => item.query === "set local statement_timeout = '20s'").length, 1);
    const pageQueryIndex = sql.findIndex(item => item.query.includes("commit_square_ingestion_page_v1"));
    equal(sql[pageQueryIndex + 1].query, "set local statement_timeout = '5s'");
    ok(sql[pageQueryIndex + 2].query.includes("get_square_remote_sandbox_binding_v1"), "post-RPC approval check runs after restoring the control-plane timeout");
    await runtimeDb.client.rpc("resolve_square_ingestion_authority_v1", {
      p_task_id: uuid(7), p_lease_owner_fingerprint: `sha256:${"2".repeat(64)}`
    });
    equal(sql.find(item => item.query.includes("resolve_square_ingestion_authority_v1")).queryTimeout, 6000);
    equal(sql.filter(item => item.query === "set local statement_timeout = '20s'").length, 1, "only atomic commit can request the bounded longer timeout");
    await runtimeDb.close();
    const expiringDb = await openSquareRemoteDatabase("runtime", dsn.replace(binding.brokerLogin, binding.runtimeLogin));
    const commitsBeforeExpiry = sql.filter(item => item.query === "commit").length, closesBeforeExpiry = ended;
    expireAfterPageQuery = true;
    await rejects(() => expiringDb.client.rpc("commit_square_ingestion_page_v1", {
      p_task_id: uuid(7), p_lease_owner_fingerprint: `sha256:${"2".repeat(64)}`, p_command: {}
    }), "approval valid at preflight but expired after page execution rolls back");
    equal(sql.filter(item => item.query === "commit").length, commitsBeforeExpiry, "expired host approval never commits pending page data");
    equal(ended, closesBeforeExpiry + 1, "expired transaction connection is closed/rolled back");
    expireAfterPageQuery = false; resultBinding = binding;
  } finally { pg.Client = originalClient; }

  const Module = require("node:module"), originalLoad = Module._load;
  let authUser = { id: binding.operatorId, user_metadata: { role: "admin", workspace_id: uuid(99) } };
  let authClaims = { sub: binding.operatorId, iss: `https://${binding.projectRef}.supabase.co/auth/v1`, aud: "authenticated", session_id: uuid(4) };
  let claimReads = 0, clientOpens = 0;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "synthetic-publishable-key-not-a-secret";
  Module._load = function(name, parent, isMain) {
    if (name === "next/headers") return { cookies: async () => ({ getAll: () => [], set: () => {} }) };
    if (name === "@supabase/ssr") return { createServerClient(url) {
      clientOpens++; equal(url, `https://${binding.projectRef}.supabase.co`);
      return { auth: { getUser: async () => ({ error: null, data: { user: authUser } }),
        getClaims: async () => { claimReads++; return { error: null, data: { claims: authClaims } }; } } };
    } };
    return originalLoad.call(this, name, parent, isMain);
  };
  try {
    const { authenticateSquareRemoteSandboxActor } = require("../lib/integrations/control-plane/square-remote-sandbox-auth.ts");
    const actor = await authenticateSquareRemoteSandboxActor(binding);
    equal(actor.actorId, binding.operatorId); equal(actor.workspaceId, binding.workspaceId); equal(actor.role, binding.operatorRole);
    equal(actor.sessionId, uuid(4)); ok(Object.isFrozen(actor));
    authUser = { id: uuid(99) };
    const before = claimReads; equal(await authenticateSquareRemoteSandboxActor(binding), null); equal(claimReads, before);
    authUser = { id: binding.operatorId };
    for (const [key, value] of [["sub", uuid(99)], ["iss", "https://production.supabase.co/auth/v1"], ["aud", "service_role"], ["session_id", "invented"]]) {
      const original = authClaims; authClaims = { ...authClaims, [key]: value };
      equal(await authenticateSquareRemoteSandboxActor(binding), null); authClaims = original;
    }
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://production.supabase.co";
    const beforeOpen = clientOpens; equal(await authenticateSquareRemoteSandboxActor(binding), null); equal(clientOpens, beforeOpen);
    process.env.NEXT_PUBLIC_SUPABASE_URL = environment.NEXT_PUBLIC_SUPABASE_URL;
  } finally { Module._load = originalLoad; delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; }

  const jose = await import("jose");
  const { publicKey, privateKey } = await jose.generateKeyPair("RS256");
  const jwk = { ...await jose.exportJWK(publicKey), kid: "square-synthetic-key", alg: "RS256", use: "sig" };
  const savedFetch = global.fetch;
  let jwksCalls = 0;
  global.fetch = async url => { equal(String(url), "https://oidc.vercel.com/vaeroex-2167s-projects/.well-known/jwks"); jwksCalls++; return Response.json({ keys: [jwk] }); };
  try {
    const deployment = require("../lib/integrations/control-plane/square-remote-sandbox-deployment.ts");
    const now = Math.floor(Date.now() / 1000);
    const claims = { iss: "https://oidc.vercel.com/vaeroex-2167s-projects", aud: "https://vercel.com/vaeroex-2167s-projects",
      sub: "owner:vaeroex-2167s-projects:project:vaeroex-square-sandbox:environment:production",
      owner: binding.vercelTeamSlug, owner_id: binding.vercelTeamId, project: binding.vercelProjectName,
      project_id: binding.vercelProjectId, environment: "production", iat: now - 5, exp: now + 300 };
    const token = await new jose.SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
    process.env.VERCEL_OIDC_TOKEN = token;
    equal(await deployment.verifySquareRemoteSandboxDeployment(binding), token); equal(jwksCalls, 1);
    const twoHours = await new jose.SignJWT({ ...claims, iat: now - 3700, exp: now + 3500 }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
    process.env.VERCEL_OIDC_TOKEN = twoHours;
    equal(await deployment.verifySquareRemoteSandboxDeployment(binding), twoHours, "current two-hour Function token remains valid after its first hour");
    const tooLong = await new jose.SignJWT({ ...claims, iat: now - 5, exp: now + 7196 }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
    process.env.VERCEL_OIDC_TOKEN = tooLong;
    await rejects(() => deployment.verifySquareRemoteSandboxDeployment(binding), "first lifetime above two hours denies");
    for (const [key, value] of [["project_id", constants.forbiddenVercelProjectId], ["project_id", "prj_ForeignProject1234567890"], ["owner_id", "team_foreign"],
      ["environment", "preview"], ["aud", "foreign"], ["sub", "foreign"], ["iss", "https://evil.example"], ["exp", now - 1], ["iat", now + 60]]) {
      const bad = await new jose.SignJWT({ ...claims, [key]: value }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
      process.env.VERCEL_OIDC_TOKEN = bad; await rejects(() => deployment.verifySquareRemoteSandboxDeployment(binding), `signed foreign ${key} denies`);
    }
    process.env.VERCEL_OIDC_TOKEN = token.slice(0, -6) + "broken";
    await rejects(() => deployment.verifySquareRemoteSandboxDeployment(binding), "forged signature denies");
  } finally { global.fetch = savedFetch; }

  let networkCalls = 0, permitted = true, content = [new TextEncoder().encode("{}")];
  const transport = createSquareSandboxOAuthTransport({ authorize: async () => { if (!permitted) throw new Error("closed"); },
    network: async (_url, options) => { networkCalls++; equal(options.redirect, "manual"); equal(options.credentials, "omit");
      return new Response(new ReadableStream({ start(controller) { for (const chunk of content) controller.enqueue(chunk); controller.close(); } }), { status: 200 }); }
  });
  const transportRequest = { url: constants.providerOrigin + "/oauth2/token", method: "POST", headers: { "Square-Version": binding.apiVersion, "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: binding.applicationId, grant_type: "authorization_code", short_lived: true }), signal: new AbortController().signal, maximumResponseBytes: 65536 };
  const response = await transport(transportRequest); for await (const chunk of response.body) equal(chunk.length, 2); await response.close(); equal(networkCalls, 1);
  for (const override of [{ url: "https://connect.squareup.com/oauth2/token" }, { url: constants.providerOrigin + "/oauth2/revoke" },
    { url: constants.providerOrigin + "/oauth2/token?anything=1" }, { method: "GET" }, { maximumResponseBytes: 1e9 },
    { body: JSON.stringify({ client_id: "production", grant_type: "authorization_code", short_lived: true }) }]) {
    await rejects(() => transport({ ...transportRequest, ...override })); equal(networkCalls, 1, "invalid policy denies before network");
  }
  permitted = false; await rejects(() => transport(transportRequest)); equal(networkCalls, 1, "closed call approval denies before network"); permitted = true;
  content = Array.from({ length: 65536 }, () => new Uint8Array([32]));
  let bytes = 0; for await (const chunk of (await transport(transportRequest)).body) bytes += chunk.length; equal(bytes, 65536);
  content = [new Uint8Array(65537)]; await rejects(async () => { for await (const chunk of (await transport(transportRequest)).body) void chunk; });
  const redirecting = createSquareSandboxOAuthTransport({ authorize: async () => {}, network: async () => new Response("private", { status: 302, headers: { location: "https://evil.example" } }) });
  await rejects(() => redirecting(transportRequest));

  // Exercise the real existing provider through the new adapter, not a manually
  // approximated request. RetrieveTokenStatus is an authenticated POST with NO
  // body, unlike ObtainToken. All tokens and secrets below are synthetic fixtures.
  let oauthCalls = [], oauthNow = new Date();
  const oauthFixture = createSquareSandboxOAuthTransport({ authorize: async () => {}, network: async (url, options) => {
    oauthCalls.push({ path: new URL(url).pathname, method: options.method, body: options.body });
    const expiresAt = new Date(oauthNow.getTime() + 86400000).toISOString();
    if (new URL(url).pathname === "/oauth2/token") return Response.json({
      access_token: "ACCESS_SQUARE_REMOTE_SYNTHETIC_CANARY", refresh_token: "REFRESH_SQUARE_REMOTE_SYNTHETIC_CANARY",
      token_type: "bearer", expires_at: expiresAt, merchant_id: "SYNTHETIC_SELLER", short_lived: true
    });
    equal(options.body, null, "status/discovery preserves the existing no-body contract");
    equal(options.headers.Authorization, "Bearer ACCESS_SQUARE_REMOTE_SYNTHETIC_CANARY");
    if (new URL(url).pathname === "/oauth2/token/status") return Response.json({
      scopes: [...SQUARE_OAUTH_SCOPES], expires_at: expiresAt, client_id: binding.applicationId, merchant_id: "SYNTHETIC_SELLER"
    });
    return Response.json({ locations: [] });
  } });
  const oauthPolicy = createSquareOAuthPolicy({ environment: "sandbox", applicationId: binding.applicationId,
    redirectUri: `${origin}/api/integrations/square/callback`, returnPath: "/app/settings/integrations/square" });
  const oauthProvider = createSquareOAuthCredentialProvider({ policy: oauthPolicy, applicationId: binding.applicationId, transport: oauthFixture });
  const fixtureSecret = new ProviderApplicationSecret({ schemaVersion: "provider_application_secret_v1", providerKey: "square",
    environment: "sandbox", clientId: binding.applicationId, clientSecret: "SECRET_SQUARE_REMOTE_SYNTHETIC_CANARY" });
  const envelope = await oauthProvider.exchangeAuthorizationCode({ applicationSecret: fixtureSecret,
    authorizationCode: "synthetic-code", requestedScopes: SQUARE_OAUTH_SCOPES, now: oauthNow });
  equal(envelope.environment, "sandbox"); equal(envelope.externalAuthorizedEntityReference, "SYNTHETIC_SELLER");
  equal(oauthCalls.map(call => call.path).join(","), "/oauth2/token,/oauth2/token/status");
  equal(oauthCalls[1].method, "POST"); equal(oauthCalls[1].body, null);
  oauthNow = new Date(oauthNow.getTime() + 1000);
  const refreshed = await oauthProvider.refreshCredential({ credential: envelope, applicationSecret: fixtureSecret, now: oauthNow });
  equal(refreshed.issuedAt, envelope.issuedAt); equal(refreshed.refreshToken, envelope.refreshToken);
  equal(oauthCalls.slice(2).map(call => call.path).join(","), "/oauth2/token,/oauth2/token/status");
  for (const path of ["/v2/merchants/me", "/v2/locations", "/v2/locations/main"]) {
    await readSquareAuthenticatedDiscovery({ transport: oauthFixture, environment: "sandbox", path, accessToken: envelope.accessToken });
    equal(oauthCalls.at(-1).method, "GET"); equal(oauthCalls.at(-1).body, null);
  }
  const beforeInvalidStatus = oauthCalls.length;
  await rejects(() => oauthFixture({ ...transportRequest, url: constants.providerOrigin + "/oauth2/token/status", body: "{}" }));
  equal(oauthCalls.length, beforeInvalidStatus, "a body on token status rejects before network");

  for (const length of [1, 65536]) {
    const raw = await readSquareSandboxNotification(new Request(origin, { method: "POST", body: "x".repeat(length), headers: { "content-type": "application/json" } })); equal(raw.length, length);
  }
  await rejects(() => readSquareSandboxNotification(new Request(origin, { method: "POST", body: "x".repeat(65537), headers: { "content-type": "application/json" } })));

  let serviceCalls = 0, enabled = false;
  const actor = { actorId: binding.operatorId, workspaceId: binding.workspaceId, sessionId: uuid(4), role: binding.operatorRole };
  const policy = createSquareOAuthPolicy({ environment: "sandbox", applicationId: binding.applicationId, redirectUri: `${origin}/api/integrations/square/callback`, returnPath: "/app/settings/integrations/square" });
  let navigation = squareAuthorizationUrl({ policy, applicationId: binding.applicationId, state: "S".repeat(43) });
  const handlers = createSquareRemoteSandboxCustomerHandlers({ enabled: async req => enabled && squareRemoteSandboxCandidate(req), authenticate: async () => actor,
    service: { snapshot: async () => { serviceCalls++; return { canManage: true, businessEntities: [], connections: [] }; },
      initiate: async () => { serviceCalls++; return { authorizationUrl: navigation }; }, complete: async () => { serviceCalls++; },
      confirmMapping: async () => { serviceCalls++; }, disconnect: async () => { serviceCalls++; } }, notify: async () => new Response(null, { status: 204 }) });
  equal((await handlers.handle("status", request("status"))).status, 404); equal(serviceCalls, 0);
  enabled = true; equal((await handlers.handle("status", request("status"))).status, 200);
  const connect = new URLSearchParams({ businessEntityId: binding.businessEntityId }).toString();
  equal((await handlers.handle("connect", request("connect", connect))).status, 200);
  equal(new URL(navigation).searchParams.get("session"), "true");
  for (const next of [navigation.replace("connect.squareupsandbox.com", "connect.squareup.com"), navigation + "&scope=PAYMENTS_WRITE",
    navigation.replace("session=true", "session=false"), navigation.replace("&session=true", ""), navigation + "&session=true"]) {
    const original = navigation; navigation = next; equal((await handlers.handle("connect", request("connect", connect))).status, 400); navigation = original;
  }
  equal(SQUARE_OAUTH_SCOPES.join(","), "INVENTORY_READ,ITEMS_READ,MERCHANT_PROFILE_READ,ORDERS_READ,PAYMENTS_READ");
  equal((await handlers.handle("status", new Request("https://www.vaeroex.com/api/integrations/square/status"))).status, 404);
  console.log(`Square remote Sandbox regression tests passed: ${assertions} assertions (synthetic only).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(restoreEnv);
