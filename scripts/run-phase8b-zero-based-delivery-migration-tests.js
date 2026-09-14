const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const cli = process.env.SUPABASE_CLI_PATH || "supabase";
const fixtureBaseVersion = "20260824083917";
const zeroBasedVersion = "20260824193332";
const retryExecutionVersion = "20260824233000";
const recoveryLifecycleVersion = "20260825180000";
const scopedRetryLifecycleVersion = "20260825190000";
const credentialBindingVersion = "20260826043610";
const credentialBindingCanaryVersion = "20260826090000";
const credentialLineageVersion = "20260826120000";
const precontractRetirementVersion = "20260826190801";
const providerResultEvidenceVersion = "20260826222000";
const productionConvergenceVersion = "20260827033058";
const targetVersion = "20260902191322";
const fixturePath = path.join(
  root,
  "supabase/tests/fixtures/external_integrations_phase_8b_zero_based_legacy.sql"
);
const testPaths = [
  "supabase/tests/external_integrations_phase_8b_zero_based_delivery_upgrade.test.sql",
  "supabase/tests/external_integrations_phase_6_durable_runtime.test.sql",
  "supabase/tests/external_integrations_phase_8b_credential_refresh_recovery.test.sql",
  "supabase/tests/external_integrations_phase_8b_same_generation_reauthorization.test.sql",
  "supabase/tests/external_integrations_phase_8b_credential_binding_canary.test.sql",
  "supabase/tests/external_integrations_phase_8b_credential_lineage_recovery.test.sql",
  "supabase/tests/external_integrations_phase_8b_precontract_retirement.test.sql",
  "supabase/tests/external_integrations_phase_8b_provider_result_evidence.test.sql",
  "supabase/tests/external_integrations_qbo_production_convergence.test.sql",
  "supabase/tests/square_production_runtime_foundation.test.sql"
];

function fail(message, status = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(status);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });

  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr || "");
    }
    fail(`${command} ${args.join(" ")} failed.`, result.status || 1);
  }
  return result;
}

function parseEnvValue(output, name) {
  const line = output
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));
  if (!line) return null;
  const value = line.slice(name.length + 1).trim();
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function localMigrationAdministratorUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Migration-administrator qualification requires a PostgreSQL URL.");
  }
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error("Migration-administrator qualification is restricted to local Supabase only.");
  }
  // node-postgres connection query parameters override URI authority fields.
  // Reject every parameter and fragment rather than trying to enumerate current
  // and future routing/auth aliases before preserving the disposable password.
  if (parsed.search || parsed.hash) {
    throw new Error("Migration-administrator qualification requires a canonical local URL.");
  }
  // PostgreSQL 16+ assigns the automatic ADMIN-only creator edge to the role
  // that applied the migration. Local Supabase applies migrations as its fixed
  // supabase_admin role; retain the disposable local password and change only
  // the identity so the drift witness is created and recovered by its owner.
  parsed.username = "supabase_admin";
  return parsed.toString();
}

function assertTargetIsSinglePendingMigration() {
  const migrations = fs
    .readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  const targetIndex = migrations.findIndex((name) =>
    name.startsWith(`${targetVersion}_`)
  );

  if (targetIndex < 0) {
    fail(`Target migration ${targetVersion} is missing.`);
  }
  const zeroBasedIndex = migrations.findIndex((name) =>
    name.startsWith(`${zeroBasedVersion}_`)
  );
  if (zeroBasedIndex < 0) {
    fail(`Zero-based migration ${zeroBasedVersion} is missing.`);
  }
  if (migrations[zeroBasedIndex - 1]?.slice(0, 14) !== fixtureBaseVersion) {
    fail(
      `Migration ${zeroBasedVersion} no longer immediately follows ${fixtureBaseVersion}.`
    );
  }
  const retryExecutionIndex = migrations.findIndex((name) =>
    name.startsWith(`${retryExecutionVersion}_`)
  );
  if (retryExecutionIndex < 0) {
    fail(`Retry/execution migration ${retryExecutionVersion} is missing.`);
  }
  if (migrations[retryExecutionIndex - 1]?.slice(0, 14) !== zeroBasedVersion) {
    fail(
      `Migration ${retryExecutionVersion} no longer immediately follows ${zeroBasedVersion}.`
    );
  }
  const recoveryLifecycleIndex = migrations.findIndex((name) =>
    name.startsWith(`${recoveryLifecycleVersion}_`)
  );
  if (recoveryLifecycleIndex < 0) {
    fail(`Recovery lifecycle migration ${recoveryLifecycleVersion} is missing.`);
  }
  if (
    migrations[recoveryLifecycleIndex - 1]?.slice(0, 14) !==
      retryExecutionVersion
  ) {
    fail(
      `Migration ${recoveryLifecycleVersion} no longer immediately follows ${retryExecutionVersion}.`
    );
  }
  const scopedRetryLifecycleIndex = migrations.findIndex((name) =>
    name.startsWith(`${scopedRetryLifecycleVersion}_`)
  );
  if (scopedRetryLifecycleIndex < 0) {
    fail(
      `Scoped retry lifecycle migration ${scopedRetryLifecycleVersion} is missing.`
    );
  }
  if (
    migrations[scopedRetryLifecycleIndex - 1]?.slice(0, 14) !==
      recoveryLifecycleVersion
  ) {
    fail(
      `Migration ${scopedRetryLifecycleVersion} no longer immediately follows ${recoveryLifecycleVersion}.`
    );
  }
  const credentialBindingIndex = migrations.findIndex((name) =>
    name.startsWith(`${credentialBindingVersion}_`)
  );
  if (credentialBindingIndex < 0) {
    fail(`Credential-binding migration ${credentialBindingVersion} is missing.`);
  }
  if (
    migrations[credentialBindingIndex - 1]?.slice(0, 14) !==
      scopedRetryLifecycleVersion
  ) {
    fail(
      `Migration ${credentialBindingVersion} no longer immediately follows ${scopedRetryLifecycleVersion}.`
    );
  }
  const credentialBindingCanaryIndex = migrations.findIndex((name) =>
    name.startsWith(`${credentialBindingCanaryVersion}_`)
  );
  if (credentialBindingCanaryIndex < 0) {
    fail(
      `Credential-binding canary migration ${credentialBindingCanaryVersion} is missing.`
    );
  }
  if (
    migrations[credentialBindingCanaryIndex - 1]?.slice(0, 14) !==
      credentialBindingVersion
  ) {
    fail(
      `Migration ${credentialBindingCanaryVersion} no longer immediately follows ${credentialBindingVersion}.`
    );
  }
  if (
    migrations.findIndex((name) =>
      name.startsWith(`${credentialLineageVersion}_`)
    ) < 0
  ) {
    fail(`Credential-lineage migration ${credentialLineageVersion} is missing.`);
  }
  const credentialLineageIndex = migrations.findIndex((name) =>
    name.startsWith(`${credentialLineageVersion}_`)
  );
  if (
    migrations[credentialLineageIndex - 1]?.slice(0, 14) !==
      credentialBindingCanaryVersion
  ) {
    fail(
      `Migration ${credentialLineageVersion} no longer immediately follows ${credentialBindingCanaryVersion}.`
    );
  }
  const precontractRetirementIndex = migrations.findIndex((name) =>
    name.startsWith(`${precontractRetirementVersion}_`)
  );
  if (precontractRetirementIndex < 0) {
    fail(
      `Pre-contract retirement migration ${precontractRetirementVersion} is missing.`
    );
  }
  if (
    migrations[precontractRetirementIndex - 1]?.slice(0, 14) !==
      credentialLineageVersion
  ) {
    fail(
      `Migration ${precontractRetirementVersion} no longer immediately follows ${credentialLineageVersion}.`
    );
  }
  const providerResultEvidenceIndex = migrations.findIndex((name) =>
    name.startsWith(`${providerResultEvidenceVersion}_`)
  );
  if (providerResultEvidenceIndex < 0) {
    fail(
      `Provider-result evidence migration ${providerResultEvidenceVersion} is missing.`
    );
  }
  if (
    migrations[providerResultEvidenceIndex - 1]?.slice(0, 14) !==
      precontractRetirementVersion
  ) {
    fail(
      `Migration ${providerResultEvidenceVersion} no longer immediately follows ${precontractRetirementVersion}.`
    );
  }
  const productionConvergenceIndex = migrations.findIndex((name) =>
    name.startsWith(`${productionConvergenceVersion}_`)
  );
  if (productionConvergenceIndex < 0) {
    fail(
      `Production convergence migration ${productionConvergenceVersion} is missing.`
    );
  }
  if (
    migrations[productionConvergenceIndex - 1]?.slice(0, 14) !==
      providerResultEvidenceVersion
  ) {
    fail(
      `Migration ${productionConvergenceVersion} no longer immediately follows ${providerResultEvidenceVersion}.`
    );
  }
  if (
    migrations[targetIndex - 1]?.slice(0, 14) !==
      productionConvergenceVersion
  ) {
    fail(
      `Migration ${targetVersion} no longer immediately follows ${productionConvergenceVersion}.`
    );
  }
  // Keep the entire historical QBO upgrade chain pinned. The independently
  // qualified dormant Square additions run AFTER it and must leave QBO closed
  // and unchanged; they do not replace the fixture's QBO target or assertions.
  const dormantSquareTail = [
    "20260907042202_square_dormant_trusted_authority.sql",
    "20260907042352_square_dormant_atomic_pages.sql",
    "20260907174326_square_dormant_account_connection.sql",
    "20260907225626_square_remote_sandbox_binding.sql",
    "20260908014713_square_broker_runtime_credential_authority.sql",
    "20260908042529_square_gcp_callback_authority.sql",
  "20260910193429_square_gcp_callback_oregon_recovery.sql",
  "20260910231437_square_gcp_mapped_runtime.sql",
  "20260911000915_square_gcp_mapped_legacy_fencing.sql",
  "20260911151334_square_verified_provider_observations.sql",
  "20260911205108_square_canonical_interpretation.sql", "20260911222230_square_workspace_evidence.sql",
  "20260912034447_square_workspace_card_contract.sql",
  "20260912150000_square_operational_intelligence.sql",
  "20260912190000_square_production_runtime_foundation.sql",
  "20260914234546_square_production_runtime_overlay.sql"
  ];
  const laterMigrations = migrations.slice(targetIndex + 1);
  if (laterMigrations.length !== dormantSquareTail.length ||
      laterMigrations.some((migration, index) => migration !== dormantSquareTail[index])) {
    fail(
      `Fixture-rich harness requires the reviewed dormant Square tail after ${targetVersion}.`
    );
  }
}

async function applyFixture(databaseUrl) {
  let Client;
  try {
    ({ Client } = require("pg"));
  } catch {
    fail("The pinned PostgreSQL test client is unavailable.");
  }

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(fs.readFileSync(fixturePath, "utf8"));
  } finally {
    await client.end();
  }
}

async function qualifyProductionRoleDrift(databaseUrl) {
  const { Client } = require("pg");
  const crypto = require("node:crypto");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`do $role$
      begin
        if exists(select 1 from pg_roles where rolname='square_production_evidence_authority') then
          alter role square_production_evidence_authority login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
        else
          create role square_production_evidence_authority login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
        end if;
      end $role$`);
    await client.query(`do $memberships$
      declare edge record;
      begin
        for edge in select parent.rolname as parent_name,child.rolname as child_name
          from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles child on child.oid=m.member
          where parent.rolname='square_production_evidence_authority' or child.rolname='square_production_evidence_authority'
        loop execute format('revoke %I from %I',edge.parent_name,edge.child_name); end loop;
      end $memberships$`);
  } finally {
    await client.end();
  }

  const rejected = spawnSync(cli, ["migration", "up", "--local"], {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const diagnostic = `${rejected.stdout || ""}\n${rejected.stderr || ""}`;
  if (rejected.status === 0 || !diagnostic.includes("square_production_authority_role_drift")) {
    fail("Unsafe pre-existing Production authority role was not rejected atomically.");
  }

  const recovery = new Client({ connectionString: databaseUrl });
  await recovery.connect();
  try {
    const state = (await recovery.query(
      "select r.rolcanlogin, to_regclass('private.square_production_runtime_binding') is null as rolled_back from pg_roles r where r.rolname='square_production_evidence_authority'"
    )).rows[0];
    if (!state?.rolcanlogin || !state?.rolled_back) {
      fail("Production foundation drift rejection did not preserve atomic rollback.");
    }
    await recovery.query("alter role square_production_evidence_authority nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls");
    const applicationId = crypto.randomBytes(256).toString("hex");
    const redirectUri = `https://${crypto.randomBytes(1018).toString("hex")}.com`;
    const kmsResource = crypto.randomBytes(4096).toString("hex");
    await recovery.query(`insert into private.square_account_configuration(environment,application_id,redirect_uri,broker_login,
      enrollment_login,webhook_login,kms_key_resource,approval_expires_at)
      values('sandbox',$1,$2,'square_long_broker','square_long_enrollment','square_long_webhook',$3,'2099-01-01T00:00:00Z')`,
      [applicationId,redirectUri,kmsResource]);
  } finally {
    await recovery.end();
  }
}

async function verifyProductionFingerprintUpgrade(databaseUrl) {
  const { Client } = require("pg");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`select count(*)::integer as count from private.square_account_configuration
      where length(application_id)=512 and length(redirect_uri)=2048 and length(kms_key_resource)=8192
        and square_production_binding_fingerprint~'^sha256:[a-f0-9]{64}$'
        and square_production_authority_fingerprint~'^sha256:[a-f0-9]{64}$'`);
    if (result.rows[0]?.count !== 1) fail("Long existing configuration did not survive compact Production fingerprint upgrade.");
  } finally {
    await client.end();
  }
}

async function main() {
  assertTargetIsSinglePendingMigration();

  const status = run(cli, ["status", "-o", "env"], { capture: true });
  const databaseUrl = parseEnvValue(status.stdout, "DB_URL");
  if (!databaseUrl) fail("The isolated local database URL is unavailable.");
  // Validate every effective routing/authentication field before the reset or
  // any node-postgres connection, then retain the checked migration identity.
  const localMigrationAdministratorDatabaseUrl = localMigrationAdministratorUrl(databaseUrl);

  run(cli, [
    "db",
    "reset",
    "--local",
    "--no-seed",
    "--version",
    fixtureBaseVersion
  ]);
  await applyFixture(databaseUrl);
  await qualifyProductionRoleDrift(localMigrationAdministratorDatabaseUrl);
  run(cli, ["migration", "up", "--local"]);
  await verifyProductionFingerprintUpgrade(databaseUrl);
  run(process.execPath, [
    "scripts/run-isolated-database-tests.js",
    ...testPaths
  ]);
}

if (require.main === module) {
  main().catch((error) => {
    fail(error instanceof Error ? error.message : "Fixture-rich migration test failed.");
  });
}

module.exports = { localMigrationAdministratorUrl };
