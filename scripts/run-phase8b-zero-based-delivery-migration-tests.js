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
const targetVersion = "20260826090000";
const fixturePath = path.join(
  root,
  "supabase/tests/fixtures/external_integrations_phase_8b_zero_based_legacy.sql"
);
const testPaths = [
  "supabase/tests/external_integrations_phase_8b_zero_based_delivery_upgrade.test.sql",
  "supabase/tests/external_integrations_phase_6_durable_runtime.test.sql",
  "supabase/tests/external_integrations_phase_8b_credential_refresh_recovery.test.sql",
  "supabase/tests/external_integrations_phase_8b_same_generation_reauthorization.test.sql",
  "supabase/tests/external_integrations_phase_8b_credential_binding_canary.test.sql"
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
  if (migrations[targetIndex - 1]?.slice(0, 14) !== credentialBindingVersion) {
    fail(
      `Migration ${targetVersion} no longer immediately follows ${credentialBindingVersion}.`
    );
  }
  if (targetIndex !== migrations.length - 1) {
    fail(
      `Fixture-rich harness requires ${targetVersion} to remain the latest migration.`
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

async function main() {
  assertTargetIsSinglePendingMigration();

  const status = run(cli, ["status", "-o", "env"], { capture: true });
  const databaseUrl = parseEnvValue(status.stdout, "DB_URL");
  if (!databaseUrl) fail("The isolated local database URL is unavailable.");

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("The isolated local database URL is invalid.");
  }
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    fail("Fixture-rich migration reset is restricted to local Supabase only.");
  }

  run(cli, [
    "db",
    "reset",
    "--local",
    "--no-seed",
    "--version",
    fixtureBaseVersion
  ]);
  await applyFixture(databaseUrl);
  run(cli, ["migration", "up", "--local"]);
  run(process.execPath, [
    "scripts/run-isolated-database-tests.js",
    ...testPaths
  ]);
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : "Fixture-rich migration test failed.");
});
