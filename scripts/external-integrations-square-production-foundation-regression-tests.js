const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "lib/integrations/control-plane/square-production-contracts.ts");
const migrationPath = path.join(root, "supabase/migrations/20260912190000_square_production_runtime_foundation.sql");
const migration = fs.readFileSync(migrationPath, "utf8");

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
const contract = require(sourcePath);

function fixture(overrides = {}) {
  const project = "vaeroex-square-production";
  const secret = (name) => `projects/${project}/secrets/${name}/versions/1`;
  const account = (name) => `${name}@${project}.iam.gserviceaccount.com`;
  return {
    contractVersion: "square_production_runtime_binding_v1",
    environment: "production", apiVersion: "2026-08-19",
    applicationId: "sq0idp-production-fixture",
    applicationOrigin: "https://www.vaeroex.com",
    callbackOrigin: "https://square.vaeroex.com",
    callbackUri: "https://square.vaeroex.com/api/integrations/square/callback",
    authorizationEndpoint: "https://connect.squareup.com/oauth2/authorize",
    providerOrigin: "https://connect.squareup.com",
    scopes: ["INVENTORY_READ","ITEMS_READ","MERCHANT_PROFILE_READ","ORDERS_READ","PAYMENTS_READ"],
    projectId: project, projectNumber: "123456789012", region: "us-west1",
    kmsKeyResource: `projects/${project}/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials`,
    applicationSecretVersionResource: secret("square-production-application"),
    webhookSignatureVersionResource: secret("square-production-webhook-signature"),
    databaseSecretVersionResources: Object.fromEntries(["oauth","broker","scheduler","webhook","runtime","evidence"].map((name) => [name, secret(`square-production-${name}-db`)])),
    serviceAccounts: Object.fromEntries(["oauth","broker","scheduler","webhook","runtime","evidence","taskInvoker"].map((name) => [name, account(`sq-${name.toLowerCase().replace("taskinvoker","task-invoker")}`)])),
    databaseLogins: Object.fromEntries(["oauth","broker","scheduler","webhook","runtime","evidence"].map((name) => [name, `square_production_${name}`])),
    queueResource: `projects/${project}/locations/us-west1/queues/square-production-sync`,
    sourceCommit: "a".repeat(40), enabled: true, providerCallsEnabled: false,
    customerOnboardingEnabled: false, evidenceEnabled: false,
    economicContributionsEnabled: false, aiDispatchEnabled: false,
    approvalExpiresAt: "2099-01-01T00:00:00.000Z", ...overrides
  };
}

assert.deepEqual(contract.checkedSquareProductionBinding(fixture()).scopes, fixture().scopes);
for (const changes of [
  { environment: "sandbox" },
  { applicationOrigin: "https://square-sandbox.vaeroex.com" },
  { callbackOrigin: "https://square-sandbox.vaeroex.com", callbackUri: "https://square-sandbox.vaeroex.com/api/integrations/square/callback" },
  { applicationOrigin: "https://127.0.0.1" },
  { callbackOrigin: "https://10.0.0.1", callbackUri: "https://10.0.0.1/api/integrations/square/callback" },
  { applicationId: "sandbox-sq0idb-production" },
  { providerOrigin: "https://connect.squareupsandbox.com" },
  { scopes: ["PAYMENTS_WRITE"] },
  { economicContributionsEnabled: true },
  { aiDispatchEnabled: true },
  { providerCallsEnabled: false, customerOnboardingEnabled: true },
  { applicationSecretVersionResource: "projects/vaeroex-square-production/secrets/app/versions/latest" },
  { projectId: "vaeroex-square-sandbox" }
]) assert.throws(() => contract.checkedSquareProductionBinding(fixture(changes)), Object.keys(changes).join(","));

for (const mismatch of [
  { kmsKeyResource: "projects/vaeroex-square-qualification/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials" },
  { kmsKeyResource: "projects/vaeroex-square-production/locations/us-east1/keyRings/square-production/cryptoKeys/provider-credentials" },
  { applicationSecretVersionResource: "projects/vaeroex-square-qualification/secrets/app/versions/1" },
  { queueResource: "projects/vaeroex-square-production/locations/us-east1/queues/square-production-sync" }
]) assert.throws(() => contract.checkedSquareProductionBinding(fixture(mismatch)));

const wrongSecret = fixture();
wrongSecret.databaseSecretVersionResources.runtime = "projects/vaeroex-square-qualification/secrets/runtime/versions/1";
assert.throws(() => contract.checkedSquareProductionBinding(wrongSecret));
const wrongAccount = fixture();
wrongAccount.serviceAccounts.runtime = "sq-runtime@vaeroex-square-qualification.iam.gserviceaccount.com";
assert.throws(() => contract.checkedSquareProductionBinding(wrongAccount));

const duplicated = fixture();
duplicated.databaseLogins.runtime = duplicated.databaseLogins.broker;
assert.throws(() => contract.checkedSquareProductionBinding(duplicated));

assert.match(migration, /square_production_authority_role_drift/);
assert.match(migration, /pg_catalog\.pg_auth_members/);
assert.match(migration, /economic_contributions_enabled boolean not null default false check\(not economic_contributions_enabled\)/);
assert.match(migration, /ai_dispatch_enabled boolean not null default false check\(not ai_dispatch_enabled\)/);
assert.match(migration, /alter table private\.square_production_runtime_binding force row level security/);
assert.match(migration, /alter table private\.square_production_sync_schedule force row level security/);
assert.match(migration, /alter table private\.square_production_webhook_receipts force row level security/);
assert.match(migration, /square_production_sync_schedule_due_idx[\s\S]*where state='ready'/);
assert.match(migration, /square_production_webhook_application_idx[\s\S]*\(environment,application_id,received_at\)/);
assert.match(migration, /square_account_connections_production_schedule_authority_idx/);
assert.match(migration, /square_connections_production_schedule_environment_idx/);
assert.match(migration, /foreign key\(workspace_id,business_entity_id,connection_id,connection_generation,environment,application_id\)/);
assert.match(migration, /square_production_runtime_binding_configuration_fkey/);
assert.match(migration, /square_production_binding_fingerprint text generated always/);
assert.match(migration, /square_account_configuration_production_binding_idx[\s\S]*environment,application_id,square_production_binding_fingerprint/);
assert.doesNotMatch(migration, /on private\.square_account_configuration\([^\n]*redirect_uri/);
assert.match(migration, /split_part\(kms_key_resource,'\/',2\)=project_id/);
assert.match(migration, /split_part\(queue_resource,'\/',4\)=region/);
assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all) on table private\.square_production_/i);
assert.doesNotMatch(migration, /create role\s+square_production_\w+\s+login/i);
assert.doesNotMatch(migration, /squareupsandbox|oysjpoondtcrqpghhrbd|sandbox-sq0idb/i);
console.log("square production foundation regression tests passed");
