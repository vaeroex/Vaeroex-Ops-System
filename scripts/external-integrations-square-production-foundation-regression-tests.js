const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { Client: PostgresClient } = require("pg");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "lib/integrations/control-plane/square-production-contracts.ts");
const migrationPath = path.join(root, "supabase/migrations/20260902191323_integration_production_runtime_foundation.sql");
const migration = fs.readFileSync(migrationPath, "utf8");
const historicalMarker = fs.readFileSync(path.join(root,
  "supabase/migrations/20260912190000_square_production_runtime_foundation.sql"), "utf8");
const legacyGuard = fs.readFileSync(path.join(root,
  "supabase/migrations/20260915040500_integration_production_legacy_foundation_guard.sql"), "utf8");
const ciWorkflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const activationReadme = fs.readFileSync(path.join(root, "services/external-integrations-production/infra/activation/README.md"), "utf8");
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
assert.match(migration, /pg_catalog\.pg_shdepend[\s\S]*dependency\.deptype in \('a','o'\)/,
  "pre-existing capability roles cannot own or hold ACL privileges on database objects");
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
assert.match(migration, /closed_created_object_acls/);
assert.match(migration, /integration_production_foundation_acl_not_closed/);
assert.match(migration, /integration_production_foundation_function_acl_not_closed/);
assert.match(migration, /pg_catalog\.aclexplode\(object_relation\.relacl\)/);
assert.match(migration, /pg_catalog\.aclexplode\(object_column\.attacl\)/);
assert.match(migration, /pg_catalog\.aclexplode\(fingerprint_function\.proacl\)/);
assert.doesNotMatch(migration, /pg_catalog\.aclexplode\([\s\S]{0,120}coalesce\([^)]*'\{\}'::aclitem\[\]\)/,
  "foundation ACL closure must handle nullable native catalogs without zero-dimensional arrays");
assert.doesNotMatch(migration, /grant (?:select|insert|update|delete|all) on table private\.(?:square|integration)_production_/i);
assert.doesNotMatch(migration, /create role\s+square_production_\w+\s+login/i);
assert.doesNotMatch(migration, /squareupsandbox|oysjpoondtcrqpghhrbd|sandbox-sq0idb/i);
assert.doesNotMatch(migration, /square_account_configuration|square_production_runtime_binding/,
  "the provider-neutral foundation must apply without the separately qualified Square lifecycle schema");
assert.ok(migration.trimStart().startsWith("-- Closed-by-default Production Integration Platform composition authority."));
assert.ok(migration.trimEnd().endsWith("commit;"), "the self-contained foundation is one explicit transaction");
assert.match(historicalMarker, /integration_production_foundation_missing/,
  "the recorded historical version validates that the earlier provider-neutral foundation ran");
assert.match(historicalMarker, /create function private\.integration_production_foundation_split_marker_v1\(\)/,
  "fresh installs leave an explicit split-foundation ledger marker");
assert.doesNotMatch(historicalMarker, /square_production_(?:runtime_binding|configuration_fingerprint|binding_fingerprint|authority_fingerprint)|create\s+(?:table|role)|alter\s+table|drop\s+/i,
  "fresh installs do not recreate any historical Square overlay authority");
assert.match(legacyGuard, /to_regprocedure\('private\.integration_production_foundation_split_marker_v1\(\)'\) is null[\s\S]*integration_production_legacy_foundation_requires_review[\s\S]*integration_production_foundation_split_marker_v1\(\)[\s\S]*is distinct from '20260902191323_provider_neutral'/,
  "a previously recorded all-in-one migration cannot pass without the new split marker");
for (const legacyArtifact of [
  "square_production_runtime_binding",
  "square_production_configuration_fingerprint_v1",
  "square_production_binding_fingerprint",
  "square_production_authority_fingerprint"
]) assert.match(legacyGuard, new RegExp(legacyArtifact), `forward guard detects legacy artifact ${legacyArtifact}`);
assert.match(legacyGuard, /integration_production_legacy_overlay_requires_review/,
  "legacy all-in-one installations stop for a separately reviewed reconciliation");
assert.match(legacyGuard, /relkind <> 'r'[\s\S]*relowner <> marker_owner[\s\S]*relrowsecurity[\s\S]*relforcerowsecurity/,
  "forward guard validates retained relation type, owner and FORCE RLS posture");
assert.match(legacyGuard, /aclexplode\(relation\.relacl\)[\s\S]*aclexplode\(attribute\.attacl\)/,
  "forward guard validates retained table and column ACLs");
assert.match(legacyGuard, /has_table_privilege[\s\S]*has_column_privilege[\s\S]*integration_production_foundation_effective_acl_drift/,
  "forward guard rejects effective privileges for every dormant runtime identity");
assert.match(legacyGuard, /provolatile <> 'i'[\s\S]*proisstrict[\s\S]*proparallel <> 's'[\s\S]*prosecdef[\s\S]*proconfig/,
  "forward guard validates retained fingerprint helper execution properties");
assert.match(legacyGuard, /convert_to\(object_record\.prosrc,'UTF8'\)[\s\S]*98a86fc4d75c479b10ae63900cdf1c03a5083fb59a52d61636cc3a886acfa096/,
  "forward guard binds the retained fingerprint helper to its reviewed implementation bytes");
assert.match(legacyGuard, /integration_production_foundation_role_drift/,
  "forward guard revalidates dormant authority role attributes and memberships");
assert.match(legacyGuard, /pg_catalog\.pg_shdepend[\s\S]*dependency\.classid='pg_namespace'::regclass[\s\S]*dependency\.objid='public'::regnamespace/,
  "forward guard permits only the reviewed public-schema ACL dependency");
assert.match(legacyGuard, /aclexplode\(public_schema\.nspacl\)[\s\S]*privilege_type='USAGE'[\s\S]*has_schema_privilege\(role_name,'public','CREATE'\)/,
  "forward guard requires exact non-grantable public USAGE without CREATE");
assert.doesNotMatch(legacyGuard, /drop\s+|delete\s+from|alter\s+table/i,
  "the forward guard never mutates legacy authority state while rejecting it");

assert.match(ciWorkflow, /run: pnpm test:external-integrations-square-production-foundation/,
  "CI executes the provider-neutral and Square Production runtime regressions");
assert.match(activationReadme, /end at `20260902191322_qbo_production_dormant_connection_gate`[\s\S]*apply only the immediately following `20260902191323_integration_production_runtime_foundation\.sql`[\s\S]*exact-version bound/,
  "activation records only the provider-neutral migration immediately after the verified Production ledger");
assert.match(activationReadme, /recorded the former all-in-one `20260912190000`[\s\S]*forward guard[\s\S]*abort/,
  "runbook preserves and safely rejects the historical all-in-one upgrade state");
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
