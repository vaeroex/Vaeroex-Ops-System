const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX }, fileName: filename
}).outputText, filename);
require.extensions[".tsx"] = require.extensions[".ts"];
const resolve = Module._resolveFilename, load = Module._load;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
  if (/^(?:openai|ai|@ai-sdk)(?:\/|$)|\/lib\/ai\//.test(request)) throw new Error("unexpected_ai_runtime");
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
let access;
Module._load = function(request, parent, isMain) {
  if (request === "@/lib/security/require-workspace-access") return { requireWorkspaceAccess: async () => access };
  return load.call(this, request, parent, isMain);
};
const { productionSquareCustomerAction, productionSquareCustomerView } = require("../lib/integrations/control-plane/square-production-customer.ts");
const { SquareProductionCustomerPanel } = require("../components/integrations/SquareProductionCustomerPanel.tsx");
const { renderToStaticMarkup } = require("react-dom/server");
const React = require("react");
const id = () => crypto.randomUUID(), userId = id(), sessionId = id(), workspaceId = id(), entityId = id(), connectionId = id();
const applicationId = "sq0idp-SYNTHETIC_CUSTOMER", configurationFingerprint = `sha256:${"a".repeat(64)}`;
const calls = [];
function setup(role = "owner", claim = sessionId) {
  access = { user: { id: userId }, membership: { role }, workspaceId,
    supabase: { auth: { async getClaims() { return { data: { claims: { sub: userId, session_id: claim } }, error: null }; } },
      async rpc(name, args) {
        assert.equal(name, "square_production_customer_v1");
        calls.push(args);
        const operation = args.p_operation, command = args.p_payload;
        assert.equal(command.workspaceId, workspaceId, "request cannot choose another workspace");
        if (operation === "status") return { error: null, data: { canManage: true,
          businessEntities: [{ id: entityId, label: "Owner business entity" }], connections: [] } };
        if (operation === "prepare") {
          assert.equal(command.businessEntityId, entityId);
          return { error: null, data: { connectionId: command.connectionId, businessEntityId: entityId,
            generation: 1, rowVersion: 1, applicationId, configurationFingerprint } };
        }
        if (operation === "create_state") {
          assert.match(command.stateHash, /^sha256:[a-f0-9]{64}$/);
          return { error: null, data: { stateId: command.stateId,
            expiresAt: command.expiresAt.replace("Z", "+00:00"), generation: 1,
            workspaceId, actorId: userId, sessionId, businessEntityId: entityId,
            applicationId, configurationFingerprint } };
        }
        if (operation === "disconnect") {
          assert.equal(command.connectionId, connectionId);
          assert.equal(command.confirmation, "disconnect");
          return { error: null, data: { fenced: true } };
        }
        throw new Error("unexpected operation");
      } } };
}
const origin = "https://www.vaeroex.com";
function request(action, method, body, extra = {}) {
  return new Request(`${origin}/api/integrations/square/${action}`, {
    method, headers: { host: "www.vaeroex.com", ...(method === "POST" ? { origin, "content-type": "application/x-www-form-urlencoded" } : {}), ...extra },
    ...(body === undefined ? {} : { body })
  });
}
async function main() {
  const baseView = { canManage: true, businessEntities: [{ id: entityId, label: "Owner entity" }],
    connections: [{ connectionId, businessEntityId: entityId, state: "recovery_required", sellerLabel: null,
      locations: [], mappedLocationIds: [], retentionApproved: false, revocationPending: false }] };
  const recovery = renderToStaticMarkup(React.createElement(SquareProductionCustomerPanel, { view: baseView }));
  assert.match(recovery, /action="\/api\/integrations\/square\/disconnect"/,
    "owner can fence denied or failed consent before reconnecting");
  assert.ok(!recovery.includes('action="/api/integrations/square/connect"'));
  const history = renderToStaticMarkup(React.createElement(SquareProductionCustomerPanel, {
    view: { ...baseView, connections: [{ ...baseView.connections[0], state: "disconnected" }] }
  }));
  assert.match(history, /action="\/api\/integrations\/square\/connect"/,
    "disconnected history does not strand reconnect");
  const prior = { NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV,
    SQUARE_PRODUCTION_CUSTOMER_CONNECTIONS: process.env.SQUARE_PRODUCTION_CUSTOMER_CONNECTIONS };
  try {
    process.env.NODE_ENV = "production";
    process.env.VERCEL_ENV = "production";
    delete process.env.SQUARE_PRODUCTION_CUSTOMER_CONNECTIONS;
    setup();
    assert.equal((await productionSquareCustomerAction("status", request("status", "GET"))).status, 404);
    assert.equal(calls.length, 0, "closed gate stops before owner/session/RPC");
    process.env.SQUARE_PRODUCTION_CUSTOMER_CONNECTIONS = "enabled";
    assert.equal((await productionSquareCustomerAction("status", request("status", "GET"))).status, 200,
      "normal browser GET has no Origin header");
    assert.equal((await productionSquareCustomerView()).businessEntities.length, 1);
    const before = calls.length;
    assert.equal((await productionSquareCustomerAction("status", request("status", "GET", undefined, { host: "preview.vaeroex.com" }))).status, 403);
    assert.equal(calls.length, before, "alternate host stops before database");
    const connected = await productionSquareCustomerAction("connect", request("connect", "POST", `businessEntityId=${entityId}`));
    assert.equal(connected.status, 200, `form without Content-Length is accepted (stage=${calls.at(-1)?.p_operation ?? "none"})`);
    assert.match(await connected.text(), /Opening Square authorization/);
    assert.equal(calls.at(-2).p_operation, "prepare");
    assert.equal(calls.at(-1).p_operation, "create_state");
    assert.equal((await productionSquareCustomerAction("disconnect", request("disconnect", "POST", `connectionId=${connectionId}`))).status, 403,
      "explicit customer confirmation required");
    assert.equal((await productionSquareCustomerAction("disconnect", request("disconnect", "POST",
      `connectionId=${connectionId}&confirmation=disconnect`))).status, 303);
    const count = calls.length;
    assert.equal((await productionSquareCustomerAction("disconnect", request("disconnect", "POST",
      `connectionId=${connectionId}&connectionId=${id()}&confirmation=disconnect`))).status, 403);
    assert.equal(calls.length, count, "duplicate form stops before RPC");
    setup("admin");
    assert.equal((await productionSquareCustomerAction("status", request("status", "GET"))).status, 403);
    setup("owner", null);
    assert.equal((await productionSquareCustomerAction("status", request("status", "GET"))).status, 403,
      "stale or missing session fails before RPC");
    assert.equal(calls.length, count);
    process.stdout.write("square_production_customer_workspace_owner_csrf_host_session_zero_ai_passed\n");
  } finally {
    for (const [key, value] of Object.entries(prior)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}
const fixtureRunner = fs.readFileSync(path.join(root, "scripts/run-square-production-customer-qualification.js"), "utf8");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
assert.match(workflow, /node scripts\/run-square-production-customer-qualification\.js --prepare-legacy-fixture/);
assert.match(fixtureRunner, /resetLocalFixture\('20260915040500'\)/);
assert.match(fixtureRunner, /await resetLocalFixture\(baseline\)/);
assert.match(fixtureRunner, /assert\.equal\(before\.rows\.length,104\)/);
const customerSql = fs.readFileSync(path.join(root, 'supabase/migrations/20260925032300_square_production_customer_connection.sql'), 'utf8');
assert.match(customerSql, /if state_row\.status not in \('consumed','exchanging'\) then/);
assert.match(customerSql, /check\(status='uncertain' or \(status in \('exchanging','stored'\)\)=\(exchange_fingerprint is not null\)\)/);
const { withoutSquareQualificationPaths } = require('./square-dormant-scope-test-support.js');
assert.equal(withoutSquareQualificationPaths('supabase/migrations/20260925032300_square_production_customer_connection.sql'), '');
assert.equal(withoutSquareQualificationPaths('supabase/migrations/20260925032301_unapproved.sql'),
  'supabase/migrations/20260925032301_unapproved.sql');
main().catch(error => { process.stderr.write(`square_production_customer_workspace_failed:${error instanceof Error ? error.message : "unknown"}\n`); process.exitCode = 1; });
