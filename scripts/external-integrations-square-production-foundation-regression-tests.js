const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { Client: PostgresClient } = require("pg");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "lib/integrations/control-plane/square-production-contracts.ts");
const migrationPath = path.join(root, "supabase/migrations/20260912190000_square_production_runtime_foundation.sql");
const migration = fs.readFileSync(migrationPath, "utf8");
const overlayPath = path.join(root, "supabase/migrations/20260914234546_square_production_runtime_overlay.sql");
const overlay = fs.readFileSync(overlayPath, "utf8");
const ciWorkflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const evidenceDatabaseTest = fs.readFileSync(path.join(root, "scripts/square-workspace-evidence-database-tests.js"), "utf8");
const fixtureRichMigrationTest = fs.readFileSync(path.join(root, "scripts/run-phase8b-zero-based-delivery-migration-tests.js"), "utf8");

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
const { localMigrationAdministratorUrl } = require("./run-phase8b-zero-based-delivery-migration-tests.js");

function fixture(overrides = {}) {
  const project = "vaeroex-square-production";
  const secret = (name) => `projects/${project}/secrets/${name}/versions/1`;
  const account = (name) => `${name}@${project}.iam.gserviceaccount.com`;
  return {
    contractVersion: "square_production_runtime_binding_v1",
    platform: {
      contractVersion: "production_integration_platform_v1", environment: "production",
      projectId: project, projectNumber: "123456789012", region: "us-west1",
      sharedResources: {
        network: "vaeroex-integrations-production", subnet: "vaeroex-integrations-us-west1",
        router: "vaeroex-integrations-router", nat: "vaeroex-integrations-nat",
        egressAddress: "vaeroex-integrations-egress", ingressAddress: "vaeroex-integrations-ingress",
        taskQueue: "vaeroex-integrations-tasks", artifactRepository: "vaeroex-integrations-images"
      },
      databaseAuthorityTarget: "existing_production_postgres",
      runtimePolicyVersion: "production_runtime_v1", retentionPolicyVersion: "production_retention_v1",
      observabilityPolicyVersion: "production_observability_v1", backupPolicyVersion: "production_backup_v1",
      sourceCommit: "a".repeat(40), infrastructureProvisioned: false, runtimeEnabled: false,
      economicContributionsEnabled: false, aiDispatchEnabled: false
    },
    environment: "production", apiVersion: "2026-08-19",
    applicationId: "sq0idp-production-fixture",
    applicationOrigin: "https://www.vaeroex.com",
    callbackOrigin: "https://square.vaeroex.com",
    callbackUri: "https://square.vaeroex.com/api/integrations/square/callback",
    authorizationEndpoint: "https://connect.squareup.com/oauth2/authorize",
    providerOrigin: "https://connect.squareup.com",
    scopes: ["INVENTORY_READ","ITEMS_READ","MERCHANT_PROFILE_READ","ORDERS_READ","PAYMENTS_READ"],
    kmsKeyResource: `projects/${project}/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials`,
    applicationSecretVersionResource: secret("square-production-application"),
    webhookSignatureVersionResource: secret("square-production-webhook-signature"),
    databaseSecretVersionResources: Object.fromEntries(["oauth","broker","scheduler","webhook","runtime","evidence"].map((name) => [name, secret(`square-production-${name}-db`)])),
    serviceAccounts: Object.fromEntries(["oauth","broker","scheduler","webhook","runtime","evidence","taskInvoker"].map((name) => [name, account(`sq-${name.toLowerCase().replace("taskinvoker","task-invoker")}`)])),
    databaseLogins: Object.fromEntries(["oauth","broker","scheduler","webhook","runtime","evidence"].map((name) => [name, `square_production_${name}`])),
    sourceCommit: "a".repeat(40), enabled: false, providerCallsEnabled: false,
    customerOnboardingEnabled: false, webhookIntakeEnabled: false, evidenceEnabled: false,
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
  { platform: { ...fixture().platform, projectId: "vaeroex-square-sandbox" } }
]) assert.throws(() => contract.checkedSquareProductionBinding(fixture(changes)), Object.keys(changes).join(","));

for (const mismatch of [
  { kmsKeyResource: "projects/vaeroex-square-qualification/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials" },
  { kmsKeyResource: "projects/vaeroex-square-production/locations/us-east1/keyRings/square-production/cryptoKeys/provider-credentials" },
  { applicationSecretVersionResource: "projects/vaeroex-square-qualification/secrets/app/versions/1" },
  { platform: { ...fixture().platform, sourceCommit: "b".repeat(40) } }
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
assert.match(migration, /m\.inherit_option or m\.set_option or not m\.admin_option/);
assert.match(migration, /member_role\.rolsuper or member_role\.rolcreaterole/);
assert.match(migration, /1 < \(\s*select count\(\*\) from pg_catalog\.pg_auth_members where roleid=role_record\.oid/);
assert.doesNotMatch(migration, /revoke %I from %I/);
assert.match(migration, /economic_contributions_enabled boolean not null default false check\(not economic_contributions_enabled\)/);
assert.match(migration, /ai_dispatch_enabled boolean not null default false check\(not ai_dispatch_enabled\)/);
assert.match(migration, /alter table private\.integration_production_platform_bindings force row level security/);
assert.match(migration, /alter table private\.integration_production_provider_bindings force row level security/);
assert.match(migration, /alter table private\.integration_production_provider_secrets force row level security/);
assert.match(migration, /alter table private\.integration_production_provider_capabilities force row level security/);
assert.doesNotMatch(migration, /create table private\.square_production_(?:sync_schedule|webhook_receipts)/);
assert.match(migration, /private\.integration_sync_tasks/);
assert.match(migration, /private\.integration_sync_checkpoints/);
assert.match(migration, /private\.integration_webhook_events/);
assert.match(migration, /private\.integration_rate_limit_states/);
assert.match(migration, /integration_production_fingerprint_v1\(p_parts text\[\]\)[\s\S]*language sql[\s\S]*immutable[\s\S]*strict[\s\S]*parallel safe/);
assert.match(migration, /revoke all on function private\.integration_production_fingerprint_v1\(text\[\]\) from public,anon,authenticated,service_role/);
assert.match(migration, /platform_fingerprint text generated always as \(private\.integration_production_fingerprint_v1/);
assert.match(migration, /provider_authority_fingerprint text generated always as \(private\.integration_production_fingerprint_v1/);
assert.doesNotMatch(migration, /create unique index[^;]+redirect_uri/);
assert.match(migration, /foreign key\(platform_binding_key,project_id,region,source_commit\)/);
assert.match(migration, /split_part\(kms_key_resource,'\/',2\)=project_id/);
assert.match(migration, /project_id text not null check\(project_id ~ '\^\[a-z\]\[a-z0-9-\]\{4,28\}\[a-z0-9\]\$'/);
assert.match(migration, /kms_key_resource text not null unique check\(kms_key_resource ~[\s\S]*\/keyRings\/\[A-Za-z0-9_-\]\{1,63\}/);
assert.match(migration, /production_provider_capability_service_account_key/);
assert.match(migration, /production_provider_capability_database_login_key/);
assert.match(migration, /production_provider_secret_resource_key/);
assert.match(migration, /application_id text not null unique check/);
assert.match(migration, /callback_uri ~ \('\^https:\/\/\[\^\/\]\+'\|\|route_namespace\|\|'\/callback\$'\)/);
assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all) on table private\.(?:square|integration)_production_/i);
assert.doesNotMatch(migration, /create role\s+square_production_\w+\s+login/i);
assert.doesNotMatch(migration, /squareupsandbox|oysjpoondtcrqpghhrbd|sandbox-sq0idb/i);
assert.doesNotMatch(migration, /square_account_configuration|square_production_runtime_binding/,
  "the provider-neutral foundation must apply without the separately qualified Square lifecycle schema");
assert.ok(migration.trimStart().startsWith("-- Closed-by-default Production Integration Platform composition authority."));
assert.ok(migration.trimEnd().endsWith("commit;"), "the self-contained foundation is one explicit transaction");

assert.match(overlay, /square_production_runtime_overlay_prerequisite_missing/);
assert.match(overlay, /square_production_runtime_overlay_partial_or_drifted/);
assert.match(overlay, /square_production_runtime_overlay_shared_foundation_attributes_drifted/);
assert.match(overlay, /square_production_runtime_overlay_shared_foundation_semantics_drifted/);
assert.match(overlay, /square_production_runtime_overlay_shared_foundation_acl_drifted/);
assert.match(overlay, /integration_production_fingerprint_v1\(text\[\]\)'::regprocedure/);
assert.match(overlay, /array\['a','bc'\]/);
assert.match(overlay, /array\['ab','c'\]/);
assert.match(overlay, /array\['😀','é'\]/);
assert.match(overlay, /shared_fingerprint_proc\.proowner<>\(select oid from pg_catalog\.pg_roles where rolname=current_user\)/,
  "the shared helper must remain owned by the active migration administrator");
assert.match(overlay, /shared_fingerprint_proc\.proowner<>\(select relowner/,
  "the shared helper and provider-authority table must retain one trusted owner");
assert.match(overlay, /proconfig is distinct from array\['search_path='\]/,
  "a NULL or altered function configuration must fail closed");
assert.match(overlay, /square_production_runtime_overlay_shared_foundation_definition_drifted/);
assert.match(overlay, /f08697ddaaf6d4af4faf77d0e5a2de67a87cc5bbee5f9579cecd403161edca8f/,
  "the exact canonical shared-helper body is pinned independently of its outputs");
assert.match(overlay, /integration_production_fingerprint_v1\(array\[[\s\S]*'square','production','sq0idp-Authority_App'[\s\S]*is distinct from[\s\S]*92e720a00023fd7fcfc813e41d43db2339591f8bfabd0da3292e465f7159d34a/,
  "the semantic oracle covers the complete five-part provider authority shape");
assert.match(overlay, /integration_production_fingerprint_v1\(array\[[\s\S]*'square_production_webhook_login'[\s\S]*is distinct from[\s\S]*8e1b2ec3f53655304d7ed20ae67243fd8b8f1e8ad846148d7ce617006e5df1f0/,
  "the semantic oracle covers the complete seven-part Square configuration shape");
assert.doesNotMatch(overlay, /integration_production_fingerprint_v1\([^;]*\)<>\s*'sha256:/,
  "semantic probes reject NULL results with NULL-safe comparisons");
assert.match(overlay, /square_production_runtime_overlay_provider_fingerprint_definition_drifted/);
assert.match(overlay, /attribute\.attgenerated='s'/);
assert.match(overlay, /pg_catalog\.pg_get_expr\(definition\.adbin,definition\.adrelid,false\)/);
assert.match(overlay, /private\.integration_production_fingerprint_v1\(ARRAY\[provider_key,environment,application_id,callback_uri,kms_key_resource\]\)/,
  "the provider authority column must preserve the exact five-part generated expression");
assert.match(overlay, /square_production_runtime_overlay_provider_fingerprint_value_drifted/);
assert.match(overlay, /provider_binding\.provider_authority_fingerprint is distinct from[\s\S]*provider_binding\.provider_key[\s\S]*provider_binding\.kms_key_resource/,
  "stored generated values are revalidated after any temporarily drifted helper definition");
assert.match(overlay, /square_production_runtime_overlay_provider_authority_chain_drifted/);
assert.match(overlay, /provider_platform_fk\.confrelid='private\.integration_production_platform_bindings'::regclass/);
assert.match(overlay, /array\['platform_binding_key','project_id','region','source_commit'\]::text\[\]/);
assert.match(overlay, /array\['binding_key','project_id','region','source_commit'\]::text\[\]/,
  "the retained provider row must preserve its exact provider-to-platform authority chain");
assert.match(overlay, /square_production_runtime_overlay_provider_acl_drifted/);
assert.match(overlay, /private\.integration_production_provider_bindings',privilege_name/,
  "no denied runtime role may retain effective provider-table authority");
assert.match(overlay, /to_regclass\('private\.integration_production_provider_bindings'\)/);
assert.match(overlay, /to_regclass\('private\.square_account_configuration'\)/);
assert.match(overlay, /rolname='square_production_runtime_authority'/);
assert.match(overlay, /alter table private\.square_production_runtime_binding force row level security/);
assert.match(overlay, /square_production_runtime_binding_configuration_fkey/);
assert.match(overlay, /square_production_binding_fingerprint text\s+generated always/);
assert.match(overlay, /square_production_authority_fingerprint text\s+generated always/);
assert.match(overlay, /square_production_configuration_fingerprint_v1\([\s\S]*p_broker_login name[\s\S]*p_enrollment_login name[\s\S]*p_webhook_login name[\s\S]*immutable/);
assert.match(overlay, /square_production_binding_fingerprint text[\s\S]*private\.square_production_configuration_fingerprint_v1/);
assert.match(overlay, /square_account_configuration_production_binding_idx[\s\S]*environment,square_production_authority_fingerprint,square_production_binding_fingerprint/);
assert.match(overlay, /foreign key\(provider_key,environment,provider_authority_fingerprint\)[\s\S]*integration_production_provider_bindings/);
assert.match(overlay, /foreign key\(environment,square_configuration_authority_fingerprint,square_configuration_fingerprint\)/);
assert.doesNotMatch(overlay, /grant (?:select|insert|update|delete|all) on table/i);
assert.doesNotMatch(overlay, /create role\s+\w+\s+login/i);
assert.doesNotMatch(overlay, /squareupsandbox|oysjpoondtcrqpghhrbd|sandbox-sq0idb/i);
assert.doesNotMatch(overlay, /create table private\.integration_production_(?:platform_bindings|provider_bindings|provider_secrets|provider_capabilities)/);
assert.match(overlay, /square_production_runtime_overlay_nonempty_reconciliation_required/);
assert.match(overlay, /lock table private\.square_production_runtime_binding in access exclusive mode/);
assert.match(overlay, /set local row_security=off/,
  "legacy emptiness checks abort rather than silently filtering rows through FORCE RLS");
assert.match(overlay, /set local search_path=''/,
  "catalog expression deparsing is independent of the caller's search path");
assert.match(overlay, /drop table if exists private\.square_production_runtime_binding/);
assert.doesNotMatch(overlay, /drop[^;]*cascade/i,
  "unknown dependencies abort the legacy rebuild instead of being deleted");
assert.match(overlay, /create function private\.square_production_configuration_fingerprint_v1/);
assert.match(overlay, /add column square_production_binding_fingerprint/);
assert.match(overlay, /create unique index square_account_configuration_production_binding_idx/);
assert.match(overlay, /create table private\.square_production_runtime_binding/);
assert.match(overlay, /existing_objects not in \(0,6\)/,
  "the overlay accepts only a fresh install or the complete legacy all-in-one shape");
assert.match(overlay, /relrowsecurity and relforcerowsecurity/);
assert.match(overlay, /pg_catalog\.unnest\(c\.conkey\)/);
assert.match(overlay, /pg_catalog\.unnest\(c\.confkey\)/);
assert.match(overlay, /c\.confupdtype='a' and c\.confdeltype='r'/);
assert.match(overlay, /c\.confupdtype='r' and c\.confdeltype='r'/);
assert.match(overlay, /provider_authority_fingerprint'\]::text\[\]/);
assert.match(overlay, /square_production_binding_fingerprint'\]::text\[\]/);
assert.match(overlay, /'SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'/,
  "legacy acceptance rejects every effective table privilege, including operations outside RLS");
assert.match(overlay, /square_production_runtime_authority','square_production_evidence_authority'/);
assert.match(overlay, /pg_catalog\.has_any_column_privilege/);
assert.ok(overlay.indexOf("square_production_runtime_overlay_prerequisite_missing") <
  overlay.indexOf("create function private.square_production_configuration_fingerprint_v1"),
"the overlay validates every prerequisite before its first durable mutation");
assert.ok(overlay.trimEnd().endsWith("commit;"), "the prerequisite gate and Square overlay are one explicit transaction");
assert.match(ciWorkflow, /run: pnpm test:external-integrations-square-production-foundation/,
  "CI executes the provider-neutral and Square Production runtime regressions");
assert.match(fixtureRichMigrationTest, /\["127\.0\.0\.1", "localhost"\]\.includes\(parsed\.hostname\)/,
  "fixture-rich role mutation remains restricted to disposable local Supabase");
assert.match(fixtureRichMigrationTest, /parsed\.username = "supabase_admin"/,
  "fixture-rich role drift uses the local migration actor that owns PostgreSQL 17's creator edge");
assert.match(fixtureRichMigrationTest, /qualifyProductionRoleDrift\(localMigrationAdministratorDatabaseUrl\)/,
  "only the role-drift witness uses the local migration-administrator connection");
assert.ok(
  fixtureRichMigrationTest.indexOf("const localMigrationAdministratorDatabaseUrl = localMigrationAdministratorUrl(databaseUrl)") <
    fixtureRichMigrationTest.indexOf("run(cli, [\n    \"db\",\n    \"reset\""),
  "the canonical local URL is validated before reset and every database connection"
);
const localAdminUrl = localMigrationAdministratorUrl("postgresql://postgres:synthetic-local@127.0.0.1:54322/postgres");
assert.deepEqual(
  (({ host, port, user, password, database }) => ({ host, port, user, password, database }))(
    new PostgresClient({ connectionString: localAdminUrl }).connectionParameters
  ),
  { host: "127.0.0.1", port: 54322, user: "supabase_admin", password: "synthetic-local", database: "postgres" },
  "the pinned PostgreSQL parser sees only the intended local migration identity"
);
for (const unsafeUrl of [
  "postgresql://postgres:synthetic-local@127.0.0.1:54322/postgres?host=remote.example&user=remote_actor",
  "postgresql://postgres:synthetic-local@localhost:54322/postgres?hostaddr=203.0.113.10",
  "https://postgres:synthetic-local@127.0.0.1:54322/postgres",
  "postgresql://postgres:synthetic-local@remote.example:54322/postgres"
]) assert.throws(() => localMigrationAdministratorUrl(unsafeUrl),
  "routing/authentication overrides and nonlocal/non-PostgreSQL URLs fail closed");
assert.match(evidenceDatabaseTest, /insert into private\.square_account_configuration\(\s*environment,application_id,redirect_uri/,
  "existing qualification clones only writable configuration columns");
assert.doesNotMatch(evidenceDatabaseTest, /jsonb_populate_record\(null::private\.square_account_configuration/,
  "existing qualification never supplies generated Production fingerprints");
require("./external-integrations-production-activation-regression-tests.js");
console.log("square production foundation regression tests passed");
