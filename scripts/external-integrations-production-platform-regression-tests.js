const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = function(loaded, filename) {
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
  }).outputText, filename);
};
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
  if (request === "server-only") return path.join(root, "scripts/test-stubs/server-only.js");
  return resolve.call(this, request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
};
const contract = require(path.join(root, "lib/integrations/control-plane/production-platform-contracts.ts"));

const project = "vaeroex-integrations-prod";
const platform = contract.checkedProductionPlatformBinding({
  contractVersion: "production_integration_platform_v1", environment: "production",
  projectId: project, projectNumber: "123456789012", region: "us-west1",
  sharedResources: {
    network: "vaeroex-integrations-production", subnet: "vaeroex-integrations-us-west1",
    router: "vaeroex-integrations-router", nat: "vaeroex-integrations-nat",
    egressAddress: "vaeroex-integrations-egress", ingressAddress: "vaeroex-integrations-ingress",
    taskQueue: "vaeroex-integrations-tasks", artifactRepository: "vaeroex-integrations-images"
  }, databaseAuthorityTarget: "existing_production_postgres",
  runtimePolicyVersion: "production_runtime_v1", retentionPolicyVersion: "production_retention_v1",
  observabilityPolicyVersion: "production_observability_v1", backupPolicyVersion: "production_backup_v1",
  sourceCommit: "a".repeat(40), infrastructureProvisioned: false, runtimeEnabled: false,
  economicContributionsEnabled: false, aiDispatchEnabled: false
});
const provider = (key) => ({
  contractVersion: "production_provider_isolation_v1", providerKey: key, environment: "production",
  applicationId: `${key}-production-app`,
  routeNamespace: `/api/integrations/${key.replaceAll("_", "-")}`, callbackUri: `https://integrations.vaeroex.com/api/integrations/${key.replaceAll("_", "-")}/callback`,
  kmsKeyResource: `projects/${project}/locations/us-west1/keyRings/${key}-production/cryptoKeys/provider-credentials`,
  secretVersionResources: { application: `projects/${project}/secrets/${key}-application/versions/1` },
  serviceAccounts: { broker: `${key.replaceAll("_", "-")}-broker@${project}.iam.gserviceaccount.com` },
  databaseLogins: { broker: `${key}_production_broker` },
  sourceCommit: "a".repeat(40),
  enabled: false,
  providerCallsEnabled: false, customerOnboardingEnabled: false, webhookIntakeEnabled: false,
  evidenceEnabled: false, economicContributionsEnabled: false, aiDispatchEnabled: false
});

assert.equal(contract.assertProductionProviderSetIsolation(platform, [provider("square"), provider("quickbooks_online")]).length, 2);
for (const field of ["kmsKeyResource", "callbackUri"]) {
  const qbo = provider("quickbooks_online"); qbo[field] = provider("square")[field];
  assert.throws(() => contract.assertProductionProviderSetIsolation(platform, [provider("square"), qbo]));
}
for (const field of ["secretVersionResources", "serviceAccounts", "databaseLogins"]) {
  const qbo = provider("quickbooks_online"); qbo[field] = provider("square")[field];
  assert.throws(() => contract.assertProductionProviderSetIsolation(platform, [provider("square"), qbo]));
}
assert.throws(() => contract.checkedProductionProviderIsolation({ ...provider("square"), providerKey: "quickbooks_online" }, platform));
assert.throws(() => contract.checkedProductionProviderIsolation({ ...provider("square"), routeNamespace: "/api/integrations/quickbooks-online" }, platform));
assert.throws(() => contract.checkedProductionProviderIsolation({ ...provider("square"), callbackUri: "https://integrations.vaeroex.com/api/integrations/square/callback/extra" }, platform));
assert.throws(() => contract.checkedProductionProviderIsolation({ ...provider("square"), callbackUri: "https://127.0.0.1/api/integrations/square/callback" }, platform));
assert.throws(() => contract.checkedProductionProviderIsolation({ ...provider("square"), callbackUri: "https://internal/api/integrations/square/callback" }, platform));
assert.throws(() => contract.checkedProductionProviderIsolation({ ...provider("square"), callbackUri: "https://square-sandbox.vaeroex.com/api/integrations/square/callback" }, platform));
assert.throws(() => contract.checkedProductionProviderIsolation({ ...provider("square"), enabled: true }, platform));
assert.throws(() => contract.checkedProductionProviderIsolation({ ...provider("square"), providerCallsEnabled: true }, platform));
assert.throws(() => contract.checkedProductionProviderIsolation({ ...provider("square"), sourceCommit: "b".repeat(40) }, platform));

const qboRegistry = fs.readFileSync(path.join(root, "lib/integrations/control-plane/registered-provider-registry.ts"), "utf8");
assert.doesNotMatch(qboRegistry, /SQUARE|Square|square/, "historical QBO registry and fingerprint stay unchanged");
const packageJson = fs.readFileSync(path.join(root, "package.json"), "utf8");
assert.doesNotMatch(packageJson, /apply.*migration|supabase db push/i, "foundation tests cannot apply remote migrations");

const durableRuntime = fs.readFileSync(path.join(root,
  "supabase/migrations/20260822012253_external_integrations_phase_6_durable_runtime.sql"), "utf8");
for (const table of ["integration_sync_tasks", "integration_sync_checkpoints", "integration_webhook_events", "integration_rate_limit_states"]) {
  const start = durableRuntime.indexOf(`create table private.${table}`);
  assert.notEqual(start, -1, `${table} remains in the shared data plane`);
  const body = durableRuntime.slice(start, durableRuntime.indexOf("\n);", start) + 3);
  assert.match(body, /provider_key text/, `${table} is provider-partitioned`);
  assert.match(body, /provider_environment text/, `${table} is environment-partitioned`);
}
console.log("production integration platform regression tests passed");
