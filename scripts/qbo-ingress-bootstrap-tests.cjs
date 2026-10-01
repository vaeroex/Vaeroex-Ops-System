/* eslint-disable @typescript-eslint/no-require-imports -- Focused offline entrypoint qualification. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const sha = "c1b1982efbf5956ee6053edaefbbed3728eb08c2";
const valid = { QBO_INGRESS_BOOTSTRAP_ONLY: "true", QBO_SERVICE_MODE: "oauth_ingress", QBO_SOURCE_COMMIT: sha };
let assertions = 0;
function check(fn) { fn(); assertions++; }
function load(file, require) {
  const loaded = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, { module: loaded, exports: loaded.exports, require, Buffer, Set });
  return loaded.exports;
}
const imports = [];
let handler, listeners = 0;
const bootstrap = load("services/external-integrations-qbo/src/ingress-bootstrap.ts", name => {
  imports.push(name);
  assert.equal(name, "node:http", "bootstrap cannot load operational dependencies");
  return { createServer(options, callback) {
    assert.equal(options.maxHeaderSize, 16384);
    handler = callback;
    return { listen(port, host) { assert.equal(port, 8080); assert.equal(host, "0.0.0.0"); listeners++; } };
  } };
});
check(() => assert.equal(bootstrap.disabledQboIngressConfiguration(valid).sourceCommit, sha));
for (const changed of [
  { QBO_INGRESS_BOOTSTRAP_ONLY: undefined }, { QBO_INGRESS_BOOTSTRAP_ONLY: "false" },
  { QBO_SERVICE_MODE: "credential_broker" }, { QBO_SOURCE_COMMIT: "main" },
  { PORT: "0" }, { PORT: "65536" }, { PORT: " 8080" },
  { DATABASE_URL: "never-use" }, { SUPABASE_SERVICE_ROLE_KEY: "never-use" },
  { NEXT_PUBLIC_SUPABASE_URL: "never-use" }, { GOOGLE_APPLICATION_CREDENTIALS: "never-use" },
  { PGPASSWORD: "never-use" }, { QBO_WEBHOOK_SECRET_VERSION_RESOURCE: "never-use" },
  { QBO_PROVIDER_SECRET_VERSION_RESOURCE: "never-use" }, { QBO_BROKER_URL: "never-use" },
  { QBO_KMS_KEY_RESOURCE: "never-use" }, { QBO_QUEUE_NAME: "never-use" },
  { QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED: "true" }
]) check(() => assert.throws(() => bootstrap.disabledQboIngressConfiguration({ ...valid, ...changed })));
bootstrap.startDisabledQboIngress(valid);
check(() => assert.equal(listeners, 1));
for (const [method, url] of [
  ["GET", "/oauth/callback?code=never-log&state=never-log&realmId=never-log"],
  ["GET", "/oauth/callback"], ["POST", "/webhooks/qbo"],
  ["POST", "/webhooks/qbo?secret=never-log"], ["POST", "/oauth/complete"],
  ["POST", "/tasks/execute"], ["GET", "/health?secret=never-log"],
  ["POST", "/health"], ["OPTIONS", "/webhooks/qbo"], ["GET", "/unknown"]
]) {
  let status, headers, body;
  const request = { method, url, get headers() { throw Error("must not inspect secret headers"); },
    on() { throw Error("must not read body"); }, [Symbol.asyncIterator]() { throw Error("must not read body"); } };
  handler(request, { writeHead(code, values) { status = code; headers = values; }, end(value) { body = value; } });
  check(() => assert.equal(status, 503));
  check(() => assert.equal(body, '{"error":"qbo_production_processing_disabled"}'));
  check(() => assert.equal(headers["cache-control"], "no-store"));
  check(() => assert.equal(headers.connection, "close"));
}
let health;
handler({ method: "GET", url: "/health" }, { writeHead(code) { assert.equal(code, 200); }, end(body) { health = JSON.parse(body); } });
for (const field of ["oauthProcessingEnabled", "webhookProcessingEnabled", "readyForProviderProcessing", "promotionAuthorized"]) {
  check(() => assert.equal(health[field], false));
}
check(() => assert.equal(health.modelCallCount, 0));
check(() => assert.deepEqual(imports, ["node:http"]));

async function testEntry(environment, operationalAllowed = false) {
  let operationalLoads = 0, bootstrapLoads = 0, errors = "";
  const process = { env: environment, stderr: { write(message) { errors += message; } }, exitCode: undefined };
  const loaded = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, "services/external-integrations-qbo/src/entry.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, { module: loaded, exports: loaded.exports, process, require(name) {
    if (name === "./ingress-bootstrap") return { startDisabledQboIngress(env) { bootstrapLoads++; bootstrap.disabledQboIngressConfiguration(env); } };
    operationalLoads++;
    assert.ok(operationalAllowed, "operational runtime must never load in bootstrap");
    assert.equal(name, "./server");
    return {};
  } });
  await new Promise(resolve => setImmediate(resolve));
  return { operationalLoads, bootstrapLoads, errors, exitCode: process.exitCode };
}
(async () => {
  check(() => assert.equal(imports.length, 1));
  const disabled = await testEntry(valid);
  check(() => assert.equal(disabled.operationalLoads, 0));
  check(() => assert.equal(disabled.bootstrapLoads, 1));
  check(() => assert.equal(disabled.errors, ""));
  const bad = await testEntry({ ...valid, DATABASE_URL: "secret-never-print" });
  check(() => assert.equal(bad.operationalLoads, 0));
  check(() => assert.equal(bad.exitCode, 1));
  check(() => assert.equal(bad.errors, "qbo_runtime_startup_failed\n"));
  const invalid = await testEntry({ ...valid, QBO_INGRESS_BOOTSTRAP_ONLY: "TRUE" });
  check(() => assert.equal(invalid.operationalLoads, 0));
  check(() => assert.equal(invalid.exitCode, 1));
  for (const flag of [undefined, "false"]) {
    const enabled = await testEntry({ QBO_INGRESS_BOOTSTRAP_ONLY: flag }, true);
    check(() => assert.equal(enabled.operationalLoads, 1));
    check(() => assert.equal(enabled.bootstrapLoads, 0));
  }
  console.log(`QBO ingress bootstrap: ${assertions} assertions passed; no database, provider, secret or network operation.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
