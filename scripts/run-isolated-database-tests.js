const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const cli = process.env.SUPABASE_CLI_PATH || "supabase";
const testFiles = process.argv.slice(2);

if (testFiles.length === 0) {
  process.stderr.write("At least one database test file is required.\n");
  process.exit(2);
}

function parseEnvValue(output, name) {
  const line = output
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${name}=`));

  if (!line) return null;

  const value = line.slice(name.length + 1).trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function localDatabaseUrl() {
  const status = spawnSync(cli, ["status", "-o", "env"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (status.status !== 0) {
    process.stderr.write("Could not read the isolated Supabase database status.\n");
    process.exit(status.status || 1);
  }

  return parseEnvValue(status.stdout, "DB_URL");
}

function hostedBranchDatabaseUrl() {
  const branchName = process.env.SUPABASE_TEST_BRANCH_NAME;
  const parentProjectRef = process.env.SUPABASE_TEST_PARENT_PROJECT_REF;

  if (!branchName || !parentProjectRef) return null;

  const branch = spawnSync(
    cli,
    [
      "--experimental",
      "branches",
      "get",
      branchName,
      "--project-ref",
      parentProjectRef,
      "-o",
      "env"
    ],
    {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  if (branch.status !== 0) {
    process.stderr.write("Could not retrieve the disposable branch connection.\n");
    process.exit(branch.status || 1);
  }

  return parseEnvValue(branch.stdout, "POSTGRES_URL_NON_POOLING");
}

const databaseUrl =
  process.env.SUPABASE_TEST_DATABASE_URL ||
  hostedBranchDatabaseUrl() ||
  localDatabaseUrl();

if (!databaseUrl) {
  process.stderr.write("The isolated database connection is unavailable.\n");
  process.exit(2);
}

let testUrl;
try {
  testUrl = new URL(databaseUrl);
} catch {
  process.stderr.write("The isolated database connection is invalid.\n");
  process.exit(2);
}

function quoteConnectionValue(value) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function localDatabaseContainerHost() {
  const containers = spawnSync(
    "docker",
    ["ps", "--filter", "name=supabase_db_", "--format", "{{.ID}}"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const containerIds = containers.stdout?.trim().split(/\s+/).filter(Boolean) || [];

  if (containers.status !== 0 || containerIds.length !== 1) {
    throw new Error("The isolated Supabase database container is ambiguous or unavailable.");
  }

  const inspect = spawnSync(
    "docker",
    [
      "inspect",
      "--format",
      "{{range .NetworkSettings.Networks}}{{println .IPAddress}}{{end}}",
      containerIds[0]
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  const hosts = inspect.stdout?.trim().split(/\s+/).filter((value) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) || [];

  if (inspect.status !== 0 || hosts.length !== 1) {
    throw new Error("The isolated Supabase database network is ambiguous or unavailable.");
  }

  return hosts[0];
}

function localDblinkConnection(url, host) {
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);

  return [
    `host=${quoteConnectionValue(host)}`,
    "port='5432'",
    "sslmode='disable'",
    `dbname=${quoteConnectionValue(database)}`,
    `user=${quoteConnectionValue(user)}`,
    `password=${quoteConnectionValue(password)}`
  ].join(" ");
}

const isLocalDatabase = ["127.0.0.1", "localhost"].includes(testUrl.hostname);
const dblinkConnection = isLocalDatabase
  ? localDblinkConnection(testUrl, localDatabaseContainerHost())
  : databaseUrl;
const connectionSetting = Buffer.from(dblinkConnection, "utf8").toString("base64");

const billingDatabaseTest = "customer_1_billing_entitlement.test.sql";
const localBillingServiceRolePrivileges = [
  ["profiles", "SELECT"],
  ["profiles", "UPDATE"],
  ["subscription_plans", "SELECT"],
  ["stripe_checkout_intents", "SELECT"],
  ["stripe_checkout_intents", "INSERT"],
  ["stripe_checkout_intents", "UPDATE"],
  ["customer_subscriptions", "SELECT"],
  ["customer_subscriptions", "INSERT"],
  ["customer_subscriptions", "UPDATE"],
  ["workspaces", "SELECT"],
  ["workspaces", "INSERT"],
  ["workspaces", "UPDATE"],
  ["workspace_members", "SELECT"],
  ["workspace_members", "INSERT"],
  ["audit_logs", "INSERT"],
  ["security_audit_events", "INSERT"]
];

function redactDatabaseDiagnostic(value) {
  let diagnostic = String(value || "unknown database error");
  const credentialFragments = [
    databaseUrl,
    dblinkConnection,
    connectionSetting,
    testUrl.password,
    encodeURIComponent(testUrl.password)
  ].filter(Boolean);

  for (const fragment of credentialFragments) {
    diagnostic = diagnostic.split(fragment).join("[redacted]");
  }

  return diagnostic.replace(
    /postgres(?:ql)?:\/\/[^\s@]+@/gi,
    "postgresql://[redacted]@"
  );
}

function clearCredentialEnvironment() {
  testUrl.password = "";
  delete process.env.SUPABASE_TEST_DATABASE_URL;
  delete process.env.SUPABASE_TEST_BRANCH_NAME;
  delete process.env.SUPABASE_TEST_PARENT_PROJECT_REF;
}

async function installLocalBillingServiceRoleAdapter(Client) {
  if (
    !isLocalDatabase ||
    !testFiles.some((testFile) => path.basename(testFile) === billingDatabaseTest)
  ) {
    return async () => undefined;
  }

  const client = new Client({ connectionString: databaseUrl });
  const addedPrivileges = [];
  await client.connect();

  try {
    for (const [table, privilege] of localBillingServiceRolePrivileges) {
      const existing = await client.query(
        "select has_table_privilege('service_role', $1, $2) as allowed",
        [`public.${table}`, privilege]
      );

      if (!existing.rows[0]?.allowed) {
        await client.query(
          `grant ${privilege} on table public.${table} to service_role`
        );
        addedPrivileges.push([table, privilege]);
      }
    }
  } catch (error) {
    for (const [table, privilege] of addedPrivileges.reverse()) {
      await client
        .query(`revoke ${privilege} on table public.${table} from service_role`)
        .catch(() => undefined);
    }
    await client.end().catch(() => undefined);
    throw error;
  }

  return async () => {
    try {
      for (const [table, privilege] of addedPrivileges.reverse()) {
        await client.query(
          `revoke ${privilege} on table public.${table} from service_role`
        );
      }
    } finally {
      await client.end().catch(() => undefined);
    }
  };
}

async function runWithPostgresClient() {
  let Client;
  try {
    ({ Client } = require("pg"));
  } catch {
    throw new Error("The pinned PostgreSQL test client is unavailable.");
  }

  const restoreLocalBillingServiceRole =
    await installLocalBillingServiceRoleAdapter(Client);

  try {
    for (const testFile of testFiles) {
      const client = new Client({
        connectionString: databaseUrl,
        options: `-c vaeroex.test_database_url_b64=${connectionSetting}`
      });

      let assertionCount = 0;
      let failed = false;

      try {
        await client.connect();
        const queryResult = await client.query(fs.readFileSync(testFile, "utf8"));
        const results = Array.isArray(queryResult) ? queryResult : [queryResult];

        for (const result of results) {
          for (const row of result.rows || []) {
            for (const value of Object.values(row)) {
              if (typeof value !== "string") continue;
              if (/^(?:not )?ok\s+\d+\b/.test(value)) {
                assertionCount += 1;
                failed ||= value.startsWith("not ok");
                if (value.startsWith("not ok")) process.stderr.write(`${value}\n`);
              }
            }
          }
        }
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? error.code : "unknown";
        const message = redactDatabaseDiagnostic(
          error instanceof Error ? error.message : "unknown database error"
        );
        process.stderr.write(`${testFile}: database test failed (${code}): ${message}\n`);
        failed = true;
      } finally {
        await client.end().catch(() => undefined);
      }

      if (failed || assertionCount === 0) {
        throw new Error("An isolated database test did not complete successfully.");
      }

      process.stdout.write(`${testFile}: ${assertionCount} assertions passed.\n`);
    }
  } finally {
    await restoreLocalBillingServiceRole();
  }
}

async function main() {
  try {
    await runWithPostgresClient();
  } finally {
    clearCredentialEnvironment();
  }
}

main().catch(() => {
  process.stderr.write("The isolated database test coordinator failed.\n");
  process.exit(1);
});
