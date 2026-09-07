/* Real PostgreSQL qualification. No linked/hosted target or live provider is supported. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync, fork } = require("node:child_process");
const { Client } = require("pg");

const root = path.resolve(__dirname, "..");
const baselineVersion = "20260902191322";
const squareVersions = ["20260907042202", "20260907042352"];
const accountMigration = "20260907174326_square_dormant_account_connection.sql";
const remoteBindingMigration = "20260907225626_square_remote_sandbox_binding.sql";
const fixedPassword = "square-disposable-synthetic-only";
let stage = "startup", assertions = 0, scenarios = 0;
let lastRpcFailure = null, lastOutcome = null;
let catalogTiming = null;
const ownedDatabases = [], ownedRoles = [], openClients = [];
const equal = (actual, expected, label) => { assertions++; assert.ok(actual === expected, label); };
const ok = (condition, label) => { assertions++; assert.ok(condition, label); };
const id = () => crypto.randomUUID();
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
const safeCode = error => /^[A-Z0-9_]{1,30}$/.test(String(error?.code)) ? String(error.code) : "test_failure";

function assertNoRemoteConfiguration(env = process.env) {
  for (const name of ["SUPABASE_TEST_DATABASE_URL", "SUPABASE_TEST_BRANCH_NAME", "SUPABASE_TEST_PARENT_PROJECT_REF", "DATABASE_URL", "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "SUPABASE_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY", "SQUARE_ACCESS_TOKEN"]) {
    if (Object.hasOwn(env, name)) throw new Error("remote_or_inherited_database_configuration_forbidden");
  }
}
function assertNoLinkedProject(exists = fs.existsSync) {
  if (exists(path.join(root, "supabase/.temp/project-ref"))) throw new Error("linked_project_configuration_forbidden");
}

function validateLocalDatabaseUrl(value) {
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
      parsed.username !== "postgres" || parsed.pathname !== "/postgres" ||
      !/^[0-9]{2,5}$/.test(parsed.port) || Number(parsed.port) > 65535 ||
      parsed.search || parsed.hash) throw new Error("nonlocal_database_target_forbidden");
  return { host: "127.0.0.1", port: Number(parsed.port), database: "postgres", user: "postgres", password: decodeURIComponent(parsed.password), ssl: false };
}

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { cwd: options.cwd ?? root, env: process.env,
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: options.timeout ?? 120000,
    maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) {
    const error = new Error("local_runtime_command_failed");
    if (options.diagnostics) error.localDiagnostic = String(result.stderr).replace(/postgres(?:ql)?:\/\/\S+/g, "[verified-local-dsn]").replaceAll(fixedPassword, "[synthetic]").slice(0,3000);
    throw error;
  }
  return result.stdout;
}

async function connect(config, applicationName = "square_disposable_qualification") {
  const client = new Client({ ...config, ssl: false, application_name: applicationName,
    connectionTimeoutMillis: 5000, statement_timeout: config.statement_timeout ?? 15000, query_timeout: config.query_timeout ?? 20000 });
  // Interrupted test backends are expected; query rejections are asserted separately.
  client.on("error", () => {});
  client.on("notice", () => {});
  await client.connect();
  return client;
}

function discoverSupabaseTarget() {
  assertNoRemoteConfiguration();
  assertNoLinkedProject();
  const cli = process.env.SUPABASE_CLI_PATH || "supabase";
  const context = JSON.parse(command("docker", ["context", "inspect"]));
  if (context.length !== 1 || !String(context[0]?.Endpoints?.docker?.Host).startsWith("unix://") ||
      (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://"))) throw new Error("nonlocal_container_context_forbidden");
  const config = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  const project = /^project_id\s*=\s*"([A-Za-z0-9_-]+)"/m.exec(config)?.[1];
  if (!project) throw new Error("local_project_identity_missing");
  const containers = JSON.parse(command("docker", ["inspect", `supabase_db_${project}`]));
  const container = containers[0];
  if (containers.length !== 1 || container?.Name !== `/supabase_db_${project}` || !container.State?.Running ||
      !String(container.Config?.Image).includes("supabase/postgres")) throw new Error("local_container_identity_mismatch");
  const status = command(cli, ["status", "--output", "env"]);
  const url = /^DB_URL="([^"\r\n]+)"$/m.exec(status)?.[1];
  if (!url) throw new Error("local_database_status_missing");
  const connection = validateLocalDatabaseUrl(url);
  const ports = container.NetworkSettings?.Ports?.["5432/tcp"] ?? [];
  if (!ports.some(item => Number(item.HostPort) === connection.port)) throw new Error("local_port_identity_mismatch");
  return { connection, kind: "supabase-local", proof: { containerId: container.Id, project },
    async verify(client) {
      const observed = (await client.query("select current_database() as db, inet_server_port() as port, current_setting('server_version_num')::integer as version")).rows[0];
      if (observed.db !== "postgres" || observed.port !== 5432 || observed.version < 170000) throw new Error("local_server_identity_mismatch");
    }, async stop() {} };
}

async function createNativeTarget() {
  assertNoRemoteConfiguration();
  assertNoLinkedProject();
  const bin = process.env.SQUARE_QUALIFICATION_PG_BIN;
  if (!bin || !path.isAbsolute(bin) || !fs.statSync(path.join(bin, "initdb")).isFile()) throw new Error("explicit_native_postgres_bin_required");
  // macOS's per-user TMPDIR exceeds sockaddr_un's 103-byte path limit.
  const temporary = fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "square-qualification-"));
  const directory = fs.realpathSync(temporary);
  fs.chmodSync(directory, 0o700);
  const data = path.join(directory, "data"), socket = path.join(directory, "socket");
  fs.mkdirSync(socket, { mode: 0o700 });
  const nonce = crypto.randomBytes(12).toString("hex"), clusterName = "square_qualification_" + nonce;
  command(path.join(bin, "initdb"), ["-D", data, "--username=postgres", "--auth-local=trust", "--auth-host=reject", "--encoding=UTF8", "--no-locale"]);
  const serverOptions = `-c listen_addresses='' -c unix_socket_directories='${socket}' -c unix_socket_permissions=0700 -c cluster_name='${clusterName}' -c shared_buffers=32MB -c max_connections=20 -c work_mem=4MB -c log_statement=none -c log_min_error_statement=panic -c log_error_verbosity=terse`;
  command(path.join(bin, "pg_ctl"), ["-D", data, "-l", path.join(directory, "postgres.log"), "-o", serverOptions, "-w", "start"]);
  const target = { kind: "native-postgres", directory, bin,
    connection: { host: socket, port: 5432, database: "postgres", user: "postgres", password: fixedPassword, ssl: false },
    proof: { directory, clusterName },
    async verify(client) {
      const observed = (await client.query("select current_database() as db, current_setting('data_directory') as data, current_setting('cluster_name') as cluster, current_setting('listen_addresses') as listen, inet_server_addr() as address, current_setting('server_version_num')::integer as version")).rows[0];
      if (observed.db !== "postgres" || fs.realpathSync(observed.data) !== fs.realpathSync(data) ||
          observed.cluster !== clusterName || observed.listen !== "" || observed.address !== null ||
          observed.version < 170000 || fs.statSync(directory).uid !== process.getuid()) throw new Error("native_target_identity_mismatch");
    },
    async stop() {
      // Only the exact initdb-owned cluster is stopped; leave files recoverable.
      command(path.join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
    }
  };
  return target;
}

function installTypescriptLoader() {
  const ts = require("typescript"), Module = require("node:module"), resolve = Module._resolveFilename;
  require.extensions[".ts"] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: filename
  }).outputText, filename);
  Module._resolveFilename = function(request, parent, isMain, options) {
    return resolve.call(this, request === "server-only" ? path.join(root, "scripts/test-stubs/server-only.js") : request.startsWith("@/") ? path.join(root, request.slice(2)) : request, parent, isMain, options);
  };
}

function migrationFiles() {
  return fs.readdirSync(path.join(root, "supabase/migrations")).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
}

async function applyMigrations(client, names) {
  for (const name of names) {
    stage = "migration_" + name.slice(0, 14);
    try { await client.query(fs.readFileSync(path.join(root, "supabase/migrations", name), "utf8")); }
    catch (error) { await client.query("rollback").catch(() => {}); throw error; }
  }
}

async function sourceSchemaFingerprint(client) {
  const functions = await client.query("select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,pg_get_functiondef(p.oid) as body,p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.proname not like '%square%' order by 1,2,3");
  const relations = await client.query("select n.nspname,c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text as acl from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relname not like '%square%' order by 1,2");
  const constraints = await client.query("select n.nspname,c.relname,k.conname,pg_get_constraintdef(k.oid,true) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relname not like '%square%' order by 1,2,3");
  const triggers = await client.query("select n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid,true) as definition,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relname not like '%square%' and not t.tgisinternal order by 1,2,3");
  const policies = await client.query("select * from pg_policies where schemaname in ('public','private') and tablename not like '%square%' order by schemaname,tablename,policyname");
  const roles = await client.query("select rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolconnlimit,rolbypassrls,rolconfig from pg_roles where rolname not like '%square%' order by rolname");
  const memberships = await client.query("select parent.rolname as parent,member.rolname as member,m.admin_option,m.inherit_option,m.set_option from pg_auth_members m join pg_roles parent on parent.oid=m.roleid join pg_roles member on member.oid=m.member where parent.rolname not like '%square%' and member.rolname not like '%square%' order by 1,2");
  return crypto.createHash("sha256").update(JSON.stringify([functions.rows, relations.rows, constraints.rows, triggers.rows, policies.rows, roles.rows, memberships.rows])).digest("hex");
}

async function createDatabase(target, administrator, suffix) {
  const name = `square_qualification_${crypto.randomBytes(10).toString("hex")}_${suffix}`;
  if (!/^square_qualification_[a-z0-9_]+$/.test(name) || name.length > 63) throw new Error("disposable_database_name_invalid");
  await target.verify(administrator); // Must precede CREATE DATABASE.
  await administrator.query(`create database ${quote(name)} template template0 encoding 'UTF8'`);
  const owned = { name, client: null }; ownedDatabases.push(owned);
  const connection = { ...target.connection, database: name };
  const client = await connect(connection);
  owned.client = client;
  const observed = (await client.query("select current_database() as db")).rows[0];
  if (observed.db !== name) throw new Error("disposable_database_identity_mismatch");
  await client.query("set search_path=public,extensions");
  await client.query(fs.readFileSync(path.join(root, "supabase/tests/fixtures/square-durable-platform.sql"), "utf8"));
  return { name, connection, client };
}

async function migrationQualification(target, administrator) {
  const files = migrationFiles(), baseline = files.filter(name => name.slice(0, 14) <= baselineVersion);
  const added = files.filter(name => squareVersions.includes(name.slice(0, 14)));
  const accountTail = files.filter(name => name === accountMigration);
  const remoteTail = files.filter(name => name === remoteBindingMigration);
  equal(added.length, 2, "both additive Square migrations present");
  equal(accountTail.length, 1, "account-connection migration present");
  equal(remoteTail.length, 1, "remote Sandbox binding migration present");
  equal(baseline.length + added.length + accountTail.length + remoteTail.length, files.length, "migration manifest is explicit");
  const clean = await createDatabase(target, administrator, "clean");
  await applyMigrations(clean.client, baseline);
  const before = await sourceSchemaFingerprint(clean.client);
  await applyMigrations(clean.client, added);
  equal(await sourceSchemaFingerprint(clean.client), before, "clean installation preserves all non-Square function/role/ACL definitions");
  scenarios++;

  const upgrade = await createDatabase(target, administrator, "upgrade");
  await applyMigrations(upgrade.client, baseline);
  await upgrade.client.query(fs.readFileSync(path.join(root, "supabase/tests/fixtures/square-durable-upgrade-history.sql"), "utf8"));
  const historyQuery = "select row_to_json(v) as version from private.external_source_record_versions v where source_record_id='99000000-0000-4000-8000-000000000004' order by immutable_version";
  const immutableHistory = JSON.stringify((await upgrade.client.query(historyQuery)).rows);
  const upgradeBefore = await sourceSchemaFingerprint(upgrade.client);
  const migration = fs.readFileSync(path.join(root, "supabase/migrations", added[0]), "utf8");
  const finalCommit = migration.toLowerCase().lastIndexOf("commit;");
  ok(finalCommit >= 0, "authority migration has explicit transaction boundary");
  let failed = false;
  try { await upgrade.client.query(migration.slice(0, finalCommit) + "select 1/0;\n" + migration.slice(finalCommit)); }
  catch (error) { failed = error.code === "22012"; await upgrade.client.query("rollback"); }
  ok(failed, "injected migration failure occurs before COMMIT");
  equal((await upgrade.client.query("select to_regclass('private.square_connections') as target")).rows[0].target, null, "failed migration leaves no partial Square schema");
  equal(await sourceSchemaFingerprint(upgrade.client), upgradeBefore, "failed migration preserves baseline definitions");
  await applyMigrations(upgrade.client, [added[0]]);
  const authorityBefore = (await upgrade.client.query("select pg_get_functiondef('public.resolve_square_ingestion_authority_v1(uuid,text)'::regprocedure) as definition")).rows[0].definition;
  const persistenceMigration = fs.readFileSync(path.join(root, "supabase/migrations", added[1]), "utf8");
  const persistenceCommit = persistenceMigration.toLowerCase().lastIndexOf("commit;");
  ok(persistenceCommit >= 0, "persistence migration has explicit transaction boundary");
  failed = false;
  try { await upgrade.client.query(persistenceMigration.slice(0, persistenceCommit) + "select 1/0;\n" + persistenceMigration.slice(persistenceCommit)); }
  catch (error) { failed = error.code === "22012"; await upgrade.client.query("rollback"); }
  ok(failed, "second migration failure occurs before COMMIT");
  equal((await upgrade.client.query("select to_regclass('private.square_ingestion_versions') as target")).rows[0].target, null, "second migration failure leaves no partial persistence schema");
  equal((await upgrade.client.query("select pg_get_functiondef('public.resolve_square_ingestion_authority_v1(uuid,text)'::regprocedure) as definition")).rows[0].definition, authorityBefore, "second migration failure retains committed authority schema");
  await applyMigrations(upgrade.client, [added[1]]);
  equal(await sourceSchemaFingerprint(upgrade.client), upgradeBefore, "upgrade preserves non-Square definitions");
  equal((await upgrade.client.query("select count(*)::integer as n from public.profiles where id='99000000-0000-4000-8000-000000000001'")).rows[0].n, 1, "upgrade retains preexisting fixture history");
  equal(JSON.stringify((await upgrade.client.query(historyQuery)).rows), immutableHistory, "upgrade and both rollback attempts preserve immutable version/fingerprint bytes");
  equal((await upgrade.client.query("select current_version_id from private.external_source_records where id='99000000-0000-4000-8000-000000000004'")).rows[0].current_version_id, "99000000-0000-4000-8000-000000000007", "upgrade preserves preexisting tombstone current pointer");
  let mutationDenied = false;
  try { await upgrade.client.query("update private.external_source_record_versions set normalized_schema_version='forbidden' where source_record_id='99000000-0000-4000-8000-000000000004'"); }
  catch (error) { mutationDenied = error.code === "55000"; }
  ok(mutationDenied, "preexisting immutable-history protection remains active after upgrade");
  await applyMigrations(clean.client, accountTail);
  await applyMigrations(upgrade.client, accountTail);
  await applyMigrations(clean.client, remoteTail);
  await applyMigrations(upgrade.client, remoteTail);
  equal(await sourceSchemaFingerprint(clean.client), before, "account migration preserves clean non-Square definitions");
  equal(await sourceSchemaFingerprint(upgrade.client), upgradeBefore, "account migration preserves upgrade non-Square definitions");
  scenarios++;
  return { clean, upgrade };
}

async function main() {
  if (process.argv.slice(2).some(arg => !["--supabase-local", "--local-advisors"].includes(arg))) throw new Error("unknown_qualification_argument");
  const target = process.argv.includes("--supabase-local") ? discoverSupabaseTarget() : await createNativeTarget();
  let administrator, databases;
  try {
    administrator = await connect(target.connection);
    await target.verify(administrator);
    console.log(`Verified disposable ${target.kind} target; no supplied or hosted connection URL accepted.`);
    databases = await migrationQualification(target, administrator);
    if (process.argv.includes("--local-advisors")) {
      stage = "verified_local_advisors";
      await target.verify(administrator);
      const config = databases.clean.connection;
      const unix = config.host.startsWith("/");
      const host = unix ? "localhost" : config.host + ":" + config.port;
      const url = `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${host}/${databases.clean.name}${unix ? "?host=" + encodeURIComponent(config.host) : ""}`;
      const output = command(process.env.SUPABASE_CLI_PATH || "supabase", ["db", "advisors", "--db-url", url, "--type", "all", "--level", "warn", "--output", "json"], { diagnostics: true });
      const findings = JSON.parse(output);
      console.log("Local advisors completed against the verified disposable target; finding count: " + (Array.isArray(findings) ? findings.length : Object.keys(findings).length) + ".");
      if (Array.isArray(findings)) console.log("Local advisor summaries: " + JSON.stringify(findings.map(item => ({ name: item.name, level: item.level, schema: item.metadata?.schema, object: item.metadata?.name }))));
    }
    installTypescriptLoader();
    stage = "durable_application_tests";
    await durableQualification(databases.clean);
    console.log(`Square durable database qualification: ${assertions} assertions across ${scenarios} scenarios.`);
  } finally { await cleanupOwnedQualification(target, administrator); }
}

async function cleanupOwnedQualification(target, administrator) {
  for (const client of openClients.splice(0)) await client.end().catch(() => {});
  for (const database of ownedDatabases.splice(0)) {
    await database.client?.end().catch(() => {});
    await administrator?.query(`drop database ${quote(database.name)} with (force)`).catch(() => {});
  }
  for (const role of ownedRoles.splice(0)) await administrator?.query(`drop role ${quote(role)}`).catch(() => {});
  await administrator?.end().catch(() => {});
  await target.stop();
}

// Additional milestones reuse the same verified local target and owned cleanup.
// No caller-provided DSN, database name, or external reconnect target is accepted.
async function runAdditionalQualification(callback) {
  if (typeof callback !== "function" || process.argv.slice(2).some(arg => !["--supabase-local", "--local-advisors"].includes(arg))) throw new Error("unknown_qualification_argument");
  if (ownedDatabases.length || ownedRoles.length || openClients.length) throw new Error("qualification_already_active");
  const target = process.argv.includes("--supabase-local") ? discoverSupabaseTarget() : await createNativeTarget();
  const databases = new Set(), connections = new Set();
  let administrator;
  try {
    administrator = await connect(target.connection);
    await target.verify(administrator);
    console.log(`Verified disposable ${target.kind} account-connection target; no supplied or hosted connection URL accepted.`);
    const result = await callback({
      async createDatabase(suffix) {
        if (!/^[a-z][a-z0-9_]{0,19}$/.test(suffix)) throw new Error("disposable_database_suffix_invalid");
        const database = await createDatabase(target, administrator, suffix);
        databases.add(database);
        return database;
      },
      async applyMigrations(client, names) {
        if (![...databases].some(database => database.client === client) || !Array.isArray(names) || names.some(name => !migrationFiles().includes(name))) throw new Error("unowned_migration_target_forbidden");
        return applyMigrations(client, names);
      },
      migrationFiles, sourceSchemaFingerprint, installTypescriptLoader,
      async login(database, suffix, roles = [], namespace = "square_qualification") {
        if (!databases.has(database) || !/^[a-z][a-z0-9_]{0,19}$/.test(suffix) || !Array.isArray(roles) || roles.some(role => !/^square_[a-z_]+$/.test(role)) ||
            !["square_qualification", "square_sandbox"].includes(namespace) || namespace === "square_sandbox" && !/^[a-z_]{1,19}$/.test(suffix)) throw new Error("unowned_login_target_forbidden");
        await target.verify(administrator);
        const nonce = crypto.randomBytes(8).toString("hex");
        const identifier = namespace === "square_sandbox" ? [...nonce].map(char => String.fromCharCode(97 + parseInt(char, 16))).join("") : nonce;
        const name = `${namespace}_${identifier}_${suffix}`;
        await database.client.query(`create role ${quote(name)} login nosuperuser nobypassrls nocreatedb nocreaterole noreplication inherit password '${fixedPassword}'`);
        ownedRoles.push(name);
        for (const role of roles) await database.client.query(`grant ${quote(role)} to ${quote(name)}`);
        const connection = Object.freeze({ ...database.connection, user: name, password: fixedPassword });
        connections.add(connection);
        const client = await connect(connection);
        openClients.push(client);
        return { name, client, connection };
      },
      async connect(connection) {
        if (!connections.has(connection)) throw new Error("unowned_reconnect_target_forbidden");
        await target.verify(administrator);
        const client = await connect(connection);
        openClients.push(client);
        return client;
      },
    });
    if (process.argv.includes("--local-advisors")) {
      await target.verify(administrator);
      for (const database of databases) {
        const config = database.connection, unix = config.host.startsWith("/");
        const host = unix ? "localhost" : config.host + ":" + config.port;
        const url = `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@${host}/${database.name}${unix ? "?host=" + encodeURIComponent(config.host) : ""}`;
        const findings = JSON.parse(command(process.env.SUPABASE_CLI_PATH || "supabase", ["db", "advisors", "--db-url", url, "--type", "all", "--level", "warn", "--output", "json"], { diagnostics: true }));
        console.log("Account-connection verified local advisor summaries: " + JSON.stringify(Array.isArray(findings) ? findings.map(item => ({ name: item.name, level: item.level, schema: item.metadata?.schema, object: item.metadata?.name })) : { count: Object.keys(findings).length }));
      }
    }
    return result;
  } finally { await cleanupOwnedQualification(target, administrator); }
}

async function durableQualification(database) {
  const square = path.join(root, "lib/integrations/providers/square");
  const { createSquareDormantIngestionAdapter } = require(path.join(square, "ingestion-adapter.ts"));
  const { createSquareDatabaseAuthority } = require(path.join(square, "durable-authority.ts"));
  const { createSquareDurablePageRepository } = require(path.join(square, "durable-page-repository.ts"));
  const { squareIngestionScopeFingerprint } = require(path.join(square, "ingestion-contracts.ts"));
  const { assertSquareReadOperation } = require(path.join(square, "request-validators.ts"));
  const { contractSha256 } = require(path.join(root, "lib/integrations/contracts/canonical.ts"));
  const { materializeSquarePendingSource } = require(path.join(square, "ingestion-mapping.ts"));
  const { squarePhase2B2B3Order } = require(path.join(square, "fixtures/phase-2b2b3.ts"));
  const { squarePaymentFixture } = require(path.join(square, "fixtures/payment-responses.ts"));
  const { squareRefundFixture } = require(path.join(square, "fixtures/refund-responses.ts"));
  const { squareCatalogValidationFixture, squareCatalogValidationMaximumEnvelope } = require(path.join(square, "fixtures/catalog-response-validation.ts"));
  const inventory = require(path.join(square, "fixtures/inventory-responses.ts"));
  const owner = database.client, clone = value => JSON.parse(JSON.stringify(value));
  const fingerprint = value => contractSha256(value);
  const rpcNames = new Set(["enroll_square_qualification_connection_v1", "enroll_square_qualification_task_v1", "revoke_square_qualification_connection_v1", "resolve_square_ingestion_authority_v1", "acquire_square_ingestion_page_v1", "commit_square_ingestion_page_v1", "release_square_ingestion_page_v1"]);
  function rpc(client) {
    return { async rpc(name, args) {
      if (!rpcNames.has(name) || Object.keys(args).some(key => !/^p_[a-z_]+$/.test(key))) throw new Error("rpc_not_allowlisted");
      try {
        const fields = Object.keys(args);
        const jsonArguments = new Set(["p_command", "p_binding", "p_lease", "p_release"]);
        const queryStart = Date.now();
        if (catalogTiming) catalogTiming.events.push({ phase: name + "_serialize_start", milliseconds: queryStart - catalogTiming.started });
        const values = fields.map(key => jsonArguments.has(key) ? JSON.stringify(args[key]) : args[key]);
        if (catalogTiming) catalogTiming.events.push({ phase: name + "_query_start", milliseconds: Date.now() - catalogTiming.started });
        const result = await client.query(`select public.${name}(${fields.map((key, index) => `${key} => $${index + 1}`).join(",")}) as result`, values);
        if (catalogTiming) catalogTiming.events.push({ phase: name + "_query_done", milliseconds: Date.now() - catalogTiming.started });
        return { data: result.rows[0].result, error: null };
      } catch (error) { lastRpcFailure = { operation: name, code: safeCode(error) }; return { data: null, error: { code: safeCode(error) } }; }
    } };
  }
  async function invoke(client, name, args) {
    const result = await rpc(client).rpc(name, args);
    if (result.error) { const error = new Error("checked_rpc_failed"); error.code = result.error.code; throw error; }
    return result.data;
  }
  async function denied(action, label) {
    let failed = false; try { await action(); } catch (error) { failed = ["42501", "22023", "55000", "23503", "23505"].includes(error.code); }
    ok(failed, label); scenarios++;
  }
  stage = "sql_structural_boundary_parity";
  const visitor = (await owner.query("select provolatile,proconfig from pg_proc where oid='private.square_walk_page_json_v1(jsonb,text[],bigint[],jsonb,text,text)'::regprocedure")).rows[0];
  equal(visitor.provolatile, "s", "page visitor cannot be constant-folded as immutable");
  ok(visitor.proconfig.includes("plan_cache_mode=force_generic_plan"), "page visitor forces parameterized plans");
  const visitorBody = (await owner.query("select prosrc from pg_proc where oid='private.square_walk_page_json_v1(jsonb,text[],bigint[],jsonb,text,text)'::regprocedure")).rows[0].prosrc;
  ok(!visitorBody.includes("private.square_walk_page_json_v1("), "page guard visits containers without recursive function calls");
  function logicalBudget(value) {
    let values = 0, containers = 0;
    const visit = node => { values++; if (node !== null && typeof node === "object") { containers++; for (const child of Object.values(node)) visit(child); } };
    visit(value);
    return [7199999 - (values - 1), 66000 - containers, 67108864 - Buffer.byteLength(JSON.stringify(value))];
  }
  let deepEmpty = {}, deepScalar = "leaf";
  for (let depth = 0; depth < 64; depth++) { deepEmpty = [deepEmpty]; deepScalar = [deepScalar]; }
  const traversalCases = [null, true, false, 0, -9007199254740991, "", "😀", {}, [],
    { a: [{ a: [], b: [{ c: {} }, []] }, {}], b: { a: [[], { b: [] }], z: [0, false, null, "last"] }, z: {} },
    [{ left: [{ nested: [[], {}] }] }, [], { right: [{ tail: {} }, []] }], deepEmpty, deepScalar];
  for (const value of traversalCases) {
    const result = (await owner.query("select private.square_walk_page_json_v1($1::jsonb,array[]::text[],array[7199999,66000,67108864]::bigint[]) as remaining", [JSON.stringify(value)])).rows[0].remaining;
    equal(JSON.stringify(result.map(Number)), JSON.stringify(logicalBudget(value)), "iterative pop and scalar/empty roots retain exact expanded value/container/byte charges"); scenarios++;
  }
  const entrySubtree = traversalCases[9];
  const entryBudget = (await owner.query("select private.square_walk_page_json_v1($1::jsonb,array['outer','inner'],array[7199999,66000,67108864]::bigint[]) as remaining", [JSON.stringify({ outer: { inner: entrySubtree }, excluded: [false] })])).rows[0].remaining.map(Number);
  equal(JSON.stringify(entryBudget), JSON.stringify(logicalBudget(entrySubtree)), "nonempty entry path visits only its subtree and preserves frame-pop accounting");
  const flatArrayCases = [[], [""], ["L01"], ["A-Za_z.0:9"], Array(3000).fill("L01"),
    ["x".repeat(255)], ["x".repeat(256)], ["x".repeat(4096)],
    ['quote"', "back\\slash", "with space", "tab\t", "line\n", "control\u0001", "é", "😀"],
    ["before", null, true, 1, {}, ["nested"], "after"]];
  for (const size of [32767, 32768, 32769]) {
    const value = [...Array(126).fill("x".repeat(255)), "x".repeat(size - 32646)];
    equal((await owner.query("select pg_column_size($1::jsonb) as bytes", [JSON.stringify(value)])).rows[0].bytes, size, "physical flat-array fast-path threshold fixture is exact");
    flatArrayCases.push(value);
  }
  for (const value of flatArrayCases) {
    const result = (await owner.query("select private.square_walk_page_json_v1($1::jsonb,array[]::text[],array[7199999,66000,67108864]::bigint[]) as remaining", [JSON.stringify(value)])).rows[0].remaining.map(Number);
    equal(JSON.stringify(result), JSON.stringify(logicalBudget(value)), "bounded flat ASCII classification and fallback preserve exact logical accounting"); scenarios++;
  }
  await denied(() => owner.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify(["x".repeat(4097)])]), "flat-array classification cannot admit an oversized fallback string");
  await denied(() => owner.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify(Array(3001).fill("L01"))]), "flat-array classification cannot bypass immediate cardinality");
  await denied(() => owner.query("select private.square_walk_page_json_v1($1::jsonb,array[]::text[],array[0,1,100]::bigint[])", [JSON.stringify(["L01"])]), "flat-array classification cannot bypass the raw expanded-value budget");
  await denied(() => owner.query("select private.square_walk_page_json_v1($1::jsonb,array[]::text[],array[1,1,6]::bigint[])", [JSON.stringify(["L01"])]), "flat-array classification cannot bypass exact compact JSON bytes");
  await denied(() => owner.query("select private.square_walk_page_json_v1($1::jsonb,array[]::text[],array[7199999,66000,67108864]::bigint[],$2::jsonb)", [JSON.stringify({ a: ["L01"], z: { providerKey: "foreign" } }), JSON.stringify({ environment: "sandbox" })]), "flat sibling shortcut cannot skip later nested authority checks");
  await denied(() => owner.query("select private.square_assert_page_json_v1('[\"L01\",1e131071]'::jsonb)"), "compact huge numeric cannot reach whole-array string serialization shortcut");
  let tooDeepFlat = ["L01"]; for (let depth = 0; depth < 64; depth++) tooDeepFlat = [tooDeepFlat];
  await denied(() => owner.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify(tooDeepFlat)]), "flat-array shortcut cannot bypass depth64 child-scalar rejection");
  equal(JSON.stringify((await owner.query("select private.square_walk_page_json_v1('[{},[]]'::jsonb,array[]::text[],array[2,3,7]::bigint[]) as remaining")).rows[0].remaining.map(Number)), "[0,0,0]", "last empty sibling consumes exactly the remaining container and byte budgets");
  await denied(() => owner.query("select private.square_walk_page_json_v1('[{},[]]'::jsonb,array[]::text[],array[2,2,7]::bigint[])"), "last empty sibling beyond the permitted expanded container count rejects");
  const sharedLeaf = {}, exactContainers = [];
  for (let n = 0; n < 22; n++) exactContainers.push(Array(n === 21 ? 2977 : 3000).fill(sharedLeaf));
  await owner.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify(exactContainers)]); assertions++;
  exactContainers[21].push(sharedLeaf);
  await denied(() => owner.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify(exactContainers)]), "first expanded container above66000 rejected by SQL");
  equal((await owner.query("select private.square_utf16_length_v1('😀') as length")).rows[0].length, 2, "SQL charges supplementary characters as two UTF16 units");
  await owner.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify("😀".repeat(2048))]); assertions++;
  await denied(() => owner.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify("😀".repeat(2049))]), "first astral string above4096units rejected");
  let deep = 0; for (let n = 0; n < 64; n++) deep = [deep];
  await owner.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify(deep)]); assertions++;
  await denied(() => owner.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify([deep])]), "scalar depth65 rejected");
  await denied(() => owner.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify(Array(3001).fill(null))]), "immediate array cardinality rejects before descent");
  // A fresh session has no warmed SPI plans. A caller forcing custom plans must
  // not disable the function-local generic setting. Deep payload stays bounded.
  for (const mode of ["auto", "force_custom_plan"]) {
    const fresh = await connect(database.connection); openClients.push(fresh);
    await fresh.query(`set plan_cache_mode='${mode}'`);
    let nested = Array.from({ length: 2000 }, () => "x".repeat(4096));
    for (let depth = 0; depth < 60; depth++) nested = { child: nested };
    const started = Date.now();
    await fresh.query("select private.square_assert_page_json_v1($1::jsonb)", [JSON.stringify(nested)]);
    equal((await fresh.query("select private.square_page_hash_v1($1::jsonb) as fingerprint", [JSON.stringify(nested)])).rows[0].fingerprint, fingerprint(nested), "fresh deep large Square-only canonical hashing matches established Node contract");
    ok(Date.now() - started < 15000, "fresh deep bounded guard finishes within statement budget");
    equal((await fresh.query("show plan_cache_mode")).rows[0].plan_cache_mode, mode, "function-local planner setting restores caller setting");
    console.log(`Fresh deep JSON witness: 8,192,000 scalar characters; depth60; caller ${mode}; guard plus canonical parity ${Date.now() - started}ms.`);
    await fresh.end(); scenarios++;
  }
  for (const value of [null, true, false, 0, -1, 9007199254740991, -9007199254740991, "é😀\n\r\t\\\"\u0001", [], {}, { a: [{ z: "é", a: 1 }, false], aa: null, z: { empty: [], unicode: "😀" } }]) {
    equal((await owner.query("select private.square_page_hash_v1($1::jsonb) as fingerprint", [JSON.stringify(value)])).rows[0].fingerprint, fingerprint(value), "current ASCII-field schema canonical scalar/nested parity");
  }
  async function login(kind, membership) {
    const name = "square_qualification_" + crypto.randomBytes(8).toString("hex") + "_" + kind;
    await owner.query(`create role ${quote(name)} login nosuperuser nobypassrls nocreatedb nocreaterole noreplication inherit password '${fixedPassword}'`);
    ownedRoles.push(name);
    if (membership) await owner.query(`grant ${quote(membership)} to ${quote(name)}`);
    const connection = { ...database.connection, user: name, password: fixedPassword };
    const client = await connect(connection); openClients.push(client);
    return { name, client, connection };
  }
  const admin = await login("admin", "square_ingestion_qualification_admin");
  const runtime = await login("runtime", "square_ingestion_runtime_authority");
  const other = await login("other", "square_ingestion_runtime_authority");
  const outsider = await login("outsider", null);
  const actor = id(), workspace = id(), entity = id();
  await owner.query("insert into public.profiles(id,email,full_name) values($1,'square-synthetic@example.invalid','Synthetic Square qualification')", [actor]);
  await owner.query("insert into public.workspaces(id,name,created_by) values($1,'Disposable Square synthetic workspace',$2)", [workspace, actor]);
  await owner.query("insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,status,created_by,updated_by) values($1,$2,'square_synthetic','Square synthetic','USD','UTC','active',$3,$3)", [entity, workspace, actor]);
  const scope = { workspaceId: workspace, businessEntityId: entity, connectionId: id(), sellerId: "MERCHANT_SYNTHETIC_1", environment: "sandbox", authorizedLocationIds: ["LOC_SYNTHETIC_1", "LOC_SYNTHETIC_2", "SQ2B2ALOC001", "SQ2B2ALOC002"], generation: 1 };
  const enrollment = scopeValue => ({ workspaceId: scopeValue.workspaceId, businessEntityId: scopeValue.businessEntityId, connectionId: scopeValue.connectionId, sellerId: scopeValue.sellerId, environment: scopeValue.environment, generation: scopeValue.generation, expectedGeneration: scopeValue.generation === 1 ? null : scopeValue.generation - 1,
    verifiedIdentity: { mode: "synthetic_local_qualification", evidenceFingerprint: fingerprint("synthetic_verified_identity") },
    locations: scopeValue.authorizedLocationIds.map(locationId => ({ locationId, businessEntityId: scopeValue.businessEntityId, verificationFingerprint: fingerprint({ synthetic: locationId }) })), defaultLocation: null,
    retention: { policyVersion: "synthetic_qualification_v1", approvalFingerprint: fingerprint("synthetic_explicit_retention_approval"), seconds: 3600 } });
  await denied(() => invoke(admin.client, "enroll_square_qualification_connection_v1", { p_command: enrollment(scope) }), "gate absent denies enrollment");
  await owner.query("insert into private.square_qualification_gate(singleton,database_name,purpose,expires_at) values(true,current_database(),'disposable_local_synthetic',clock_timestamp()+interval '1 day')");
  await denied(() => invoke(runtime.client, "enroll_square_qualification_connection_v1", { p_command: enrollment(scope) }), "runtime cannot enroll authority");
  await invoke(admin.client, "enroll_square_qualification_connection_v1", { p_command: enrollment(scope) });
  for (const mutation of [
    value => { value.verifiedIdentity.mode = "caller_supplied_provider_id"; },
    value => { delete value.retention; },
    value => { value.locations[0].businessEntityId = id(); },
    value => { value.defaultLocation = { locationId: "UNMAPPED_SYNTHETIC_LOCATION", discoveryFingerprint: fingerprint("synthetic") }; }
  ]) {
    const invalid = enrollment({ ...scope, connectionId: id() }); mutation(invalid);
    await denied(() => invoke(admin.client, "enroll_square_qualification_connection_v1", { p_command: invalid }), "unverified identity, missing retention, and implicit or foreign mappings cannot enroll");
  }
  const grant = (stream, operation, endpoint, body = null, grantScope = scope) => ({ scope: clone(grantScope), stream, operation, scanId: id(), expiresAt: Date.now() + 1800000, request: { method: body === null ? "GET" : "POST", url: "https://connect.squareupsandbox.com" + endpoint, body: body === null ? null : JSON.stringify(body) } });
  function binding(input) {
    const decision = assertSquareReadOperation({ providerKey: "square", providerEnvironment: input.scope.environment, method: input.request.method, url: input.request.url, headers: { "Square-Version": "2026-08-19", ...(input.request.method === "POST" ? { "Content-Type": "application/json" } : {}) }, body: input.request.body });
    return { scanKey: fingerprint({ purpose: "square_ingestion_scan_v1", workspaceId: input.scope.workspaceId, businessEntityId: input.scope.businessEntityId, connectionId: input.scope.connectionId, stream: input.stream, scanId: input.scanId }), scopeFingerprint: squareIngestionScopeFingerprint(input.scope), queryFingerprint: fingerprint({ request: decision.requestFingerprint, operation: input.operation, resolvedDefaultLocationId: input.resolvedDefaultLocationId ?? null }), cursorBindingFingerprint: decision.cursorBindingFingerprint, generation: input.scope.generation };
  }
  async function task(input, worker = runtime) {
    const context = { taskId: id(), leaseOwnerFingerprint: fingerprint(id()) }, pageBinding = binding(input);
    await invoke(admin.client, "enroll_square_qualification_task_v1", { p_command: { ...context, connectionId: input.scope.connectionId, generation: input.scope.generation, runtimeLogin: worker.name, grant: input, binding: pageBinding } });
    return { context, binding: pageBinding, grant: input, worker };
  }
  function adapter(testTask, response, client = testTask.worker.client, hooks = {}) {
    const checkedClient = rpc(client), context = testTask.context;
    const repository = createSquareDurablePageRepository({ ...context, client: checkedClient });
    let calls = 0, command;
    const observed = { ...repository, async commitPage(value) { command = clone(value); if (hooks.beforeCommit) await hooks.beforeCommit(value); const result = await repository.commitPage(value); if (hooks.afterCommit) await hooks.afterCommit(value); return result; } };
    const instance = createSquareDormantIngestionAdapter({ authority: createSquareDatabaseAuthority({ ...context, client: checkedClient }), repository: observed,
      transport: async request => { calls++; const payload = typeof response === "function" ? await response(request, calls) : response;
        equal(request.headers.Authorization, "Bearer square-synthetic-fixture", "only fixed synthetic credential");
        return { status: 200, url: request.url, redirected: false, headers: { "content-type": "application/json" }, body: { async *[Symbol.asyncIterator]() { const bytes = Buffer.from(JSON.stringify(payload)); for (let at = 0; at < bytes.length; at += 31) yield bytes.subarray(at, at + 31); } }, cancel() {} }; } });
    return { async run() { scenarios++; const result = await instance.run({ taskId: context.taskId }); lastOutcome = { outcome: result.outcome, code: result.code }; return result; }, repository, get calls() { return calls; }, get command() { return command; } };
  }
  const order = squarePhase2B2B3Order(), cases = [];
  for (const stream of ["order_core", "order_line_items", "order_adjustments", "order_tenders"]) for (const [operation, endpoint, body, response] of [
    ["retrieve_order", "/v2/orders/" + order.id, null, { order }], ["orders_batch_retrieve", "/v2/orders/batch-retrieve", { order_ids: [order.id] }, { orders: [order] }], ["orders_search", "/v2/orders/search", { location_ids: [order.location_id], return_entries: false }, { orders: [order] }]
  ]) cases.push([grant(stream, operation, endpoint, body), response]);
  for (const [stream, operation, endpoint, response] of [
    ["payments", "retrieve_payment", "/v2/payments/PAY_SYNTHETIC_1", { payment: squarePaymentFixture() }], ["payments", "list_payments", "/v2/payments?location_id=LOC_SYNTHETIC_1", { payments: [squarePaymentFixture()] }],
    ["refunds", "retrieve_payment_refund", "/v2/refunds/REFUND_SYNTHETIC_1", { refund: squareRefundFixture() }], ["refunds", "list_payment_refunds", "/v2/refunds", { refunds: [squareRefundFixture()] }],
    ["catalog", "retrieve_catalog_object", "/v2/catalog/object/SQ2B1B1CAT001", { object: squareCatalogValidationFixture() }], ["catalog", "list_catalog", "/v2/catalog/list?types=CATEGORY", { objects: [squareCatalogValidationFixture()] }],
    ["inventory", "retrieve_inventory_count", "/v2/inventory/CATALOG_SYNTHETIC_1", { counts: [inventory.squareInventoryCountFixture()] }], ["inventory", "retrieve_inventory_adjustment", "/v2/inventory/adjustments/ADJUSTMENT_SYNTHETIC_1", { adjustment: inventory.squareInventoryAdjustmentFixture() }], ["inventory", "retrieve_inventory_physical_count", "/v2/inventory/physical-counts/PHYSICAL_SYNTHETIC_1", { count: inventory.squareInventoryPhysicalCountFixture() }]
  ]) cases.push([grant(stream, operation, endpoint), response]);
  for (const [stream, operation, endpoint, body, response] of [
    ["catalog", "catalog_search", "/v2/catalog/search", { object_types: ["CATEGORY"] }, { objects: [squareCatalogValidationFixture()] }], ["catalog", "catalog_batch_retrieve", "/v2/catalog/batch-retrieve", { object_ids: ["SQ2B1B1CAT001"] }, { objects: [squareCatalogValidationFixture()] }],
    ["inventory", "inventory_counts_batch_retrieve", "/v2/inventory/counts/batch-retrieve", { location_ids: ["LOC_SYNTHETIC_1"] }, { counts: [inventory.squareInventoryCountFixture()] }], ["inventory", "inventory_changes_batch_retrieve", "/v2/inventory/changes/batch-retrieve", { location_ids: ["LOC_SYNTHETIC_1"] }, { changes: [inventory.squareInventoryChangeFixture()] }]
  ]) cases.push([grant(stream, operation, endpoint, body), response]);
  equal(cases.length, 25, "all current operation/projection combinations enumerated");
  for (const [input, response] of cases) {
    stage = "operation_" + input.stream + "_" + input.operation;
    const testTask = await task(input), test = adapter(testTask, response), result = await test.run();
    equal(result.outcome, "committed", "real decoder through durable commit"); equal(result.sourceCount, 1, "one pending root");
    equal(result.completeness.historical, "unknown", "no historical inference"); equal(result.completeness.economic, "blocked", "no economic inference");
    const reconstructed = adapter(testTask, response); equal((await reconstructed.run()).outcome, "finished", "reconstruction resumes durable finished state"); equal(reconstructed.calls, 0, "finished scan performs no transport");
  }
  const stored = await owner.query("select version,pending,ordinal,prior_version_id from private.square_ingestion_versions");
  for (const row of stored.rows) { equal(row.version.trust, "untrusted_external_input", "durable source never trusted"); equal(row.version.validation.state, "pending", "durable source remains pending"); equal(fingerprint(row.version), fingerprint(materializeSquarePendingSource(row.pending, Number(row.ordinal), row.prior_version_id)), "SQL materialization exactly matches established source envelope and fingerprints"); }
  stage = "private_cursor_restart";
  scope.connectionId = id();
  await invoke(admin.client, "enroll_square_qualification_connection_v1", { p_command: enrollment(scope) });
  for (const index of [2, 13, 15, 17, 18, 21, 23, 24]) {
    const [initial, response] = cases[index], input = { ...initial, scope: clone(scope), scanId: id() }, testTask = await task(input);
    const cursor = "c".repeat(4092) + "+x==";
    stage = "cursor_" + input.operation;
    const first = adapter(testTask, { ...response, cursor });
    const initialResult = await first.run(); equal(initialResult.outcome, "committed", "maximum cursor first page"); ok(initialResult.continuation, "maximum cursor retained"); ok(!JSON.stringify(initialResult).includes(cursor), "private cursor never emitted");
    const separate = await connect(runtime.connection); openClients.push(separate);
    const second = adapter(testTask, request => { const observed = request.body ? JSON.parse(request.body).cursor : new URL(request.url).search.slice(1).split("&").find(part => part.startsWith("cursor="))?.slice(7); equal(observed, cursor, "cursor exact bytes survive fresh session without form-style plus decoding"); return response; }, separate);
    equal((await second.run()).outcome, "committed", "maximum cursor continuation commits");
    await separate.end();
  }
  const basic = () => grant("payments", "list_payments", "/v2/payments?location_id=LOC_SYNTHETIC_1");
  stage = "authority_and_private_access";
  const checkedTask = await task(basic());
  await denied(() => invoke(runtime.client, "commit_square_ingestion_page_v1", { p_task_id: checkedTask.context.taskId, p_lease_owner_fingerprint: checkedTask.context.leaseOwnerFingerprint, p_command: exactContainers }), "actual least-privileged runtime oversized graph rejects before source hashing");
  for (const role of ["anon", "authenticated", "service_role", runtime.name]) {
    const privileges = (await owner.query("select bool_or(has_table_privilege($1,c.oid,'SELECT,INSERT,UPDATE,DELETE')) as exposed from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relkind='r' and c.relname like 'square_%'", [role])).rows[0];
    equal(privileges.exposed, false, "no API/runtime role has direct private table DML or reads");
  }
  for (const client of [other.client, outsider.client]) await denied(() => invoke(client, "resolve_square_ingestion_authority_v1", { p_task_id: checkedTask.context.taskId, p_lease_owner_fingerprint: checkedTask.context.leaseOwnerFingerprint }), "wrong actual login cannot resolve task");
  await denied(() => invoke(runtime.client, "resolve_square_ingestion_authority_v1", { p_task_id: checkedTask.context.taskId, p_lease_owner_fingerprint: fingerprint("wrong_owner") }), "wrong worker fence denied");
  for (const table of ["square_connections", "square_connection_generations", "square_location_mappings", "square_ingestion_tasks", "square_ingestion_scans", "square_ingestion_resources", "square_ingestion_versions", "square_ingestion_page_receipts"]) {
    for (const client of [runtime.client, other.client, outsider.client]) await denied(() => client.query(`select * from private.${table} limit 1`), "private source and cursor tables not exposed");
  }
  const direct = createSquareDurablePageRepository({ ...checkedTask.context, client: rpc(runtime.client) });
  for (const key of ["scanKey", "scopeFingerprint", "queryFingerprint", "cursorBindingFingerprint", "generation"]) {
    const altered = { ...checkedTask.binding, [key]: key === "generation" ? 2 : fingerprint("swapped") };
    equal((await invoke(runtime.client, "acquire_square_ingestion_page_v1", { p_task_id: checkedTask.context.taskId, p_lease_owner_fingerprint: checkedTask.context.leaseOwnerFingerprint, p_binding: altered })).outcome, "conflict", "all page authority bindings exact");
  }
  const acquired = await direct.acquire(checkedTask.binding, 0); equal(acquired.outcome, "leased", "database controls clock, ignores caller epoch");
  const counters = async connectionId => (await owner.query("select scans,resources,versions,receipts,retained_bytes,retained_containers from private.square_ingestion_capacity where connection_id=$1", [connectionId])).rows[0];
  const acquiredCounters = await counters(scope.connectionId);
  const concurrentClient = await connect(runtime.connection); openClients.push(concurrentClient);
  const concurrent = createSquareDurablePageRepository({ ...checkedTask.context, client: rpc(concurrentClient) });
  equal((await concurrent.acquire(checkedTask.binding, Number.MAX_SAFE_INTEGER)).outcome, "conflict", "independent session cannot steal active lease using caller time");
  equal(JSON.stringify(await counters(scope.connectionId)), JSON.stringify(acquiredCounters), "duplicate acquire cannot drift retained-state counters");
  await direct.release(acquired.lease, { now: 0, retryAfterMs: null, blocked: false });
  stage = "durable_fault_recovery";
  const failedTask = await task(basic());
  const capture = adapter(failedTask, { payments: [squarePaymentFixture()] }, runtime.client, { beforeCommit() { throw new Error("synthetic_before_commit"); } });
  equal((await capture.run()).outcome, "retry", "prewrite failure remains uncertain until lease recovery");
  const expireLease = async testTask => owner.query("update private.square_ingestion_scans set lease=jsonb_set(lease,'{expiresAt}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)::bigint-1000)) where scan_key=$1", [testTask.binding.scanKey]);
  await expireLease(failedTask);
  equal((await adapter(failedTask, { payments: [squarePaymentFixture()] }).run()).outcome, "committed", "prewrite failure resumes");
  const lostTask = await task(basic());
  const lost = adapter(lostTask, { payments: [squarePaymentFixture()] }, runtime.client, { afterCommit() { throw new Error("synthetic_ack_loss"); } });
  equal((await lost.run()).outcome, "retry", "lost acknowledgement is contained");
  equal((await adapter(lostTask, { payments: [squarePaymentFixture()] }).run()).outcome, "finished", "lost acknowledgement resumes committed checkpoint");
  const beforeReplay = await counters(scope.connectionId);
  equal((await invoke(runtime.client, "commit_square_ingestion_page_v1", { p_task_id: lostTask.context.taskId, p_lease_owner_fingerprint: lostTask.context.leaseOwnerFingerprint, p_command: lost.command })).outcome, "replayed", "same committed command idempotent");
  equal(JSON.stringify(await counters(scope.connectionId)), JSON.stringify(beforeReplay), "receipt replay does not drift any retained-state counter");
  const conflict = clone(lost.command); conflict.completeness.reasons.push("unsupported_page");
  equal((await invoke(runtime.client, "commit_square_ingestion_page_v1", { p_task_id: lostTask.context.taskId, p_lease_owner_fingerprint: lostTask.context.leaseOwnerFingerprint, p_command: conflict })).outcome, "conflict", "same page identity with conflicting command rejected");
  function recompute(source) {
    const stable = { ...source.scope }; delete stable.authorizedLocationIds; delete stable.generation;
    source.resourceKey = fingerprint({ purpose: "square_source_resource_identity_v1", scope: stable, stream: source.stream, providerRecordType: source.providerRecordType, providerRecordId: source.providerRecordId });
    source.versionKey = fingerprint({ purpose: "square_source_observed_version_v1", mappingVersion: "square_pending_source_mapping_v1", resourceKey: source.resourceKey, providerRevision: source.providerRevision, deleted: source.deleted, projection: source.projection });
  }
  for (const key of ["workspaceId", "businessEntityId", "connectionId", "sellerId", "environment", "authorizedLocationIds", "generation"]) {
    const forged = clone(lost.command), source = forged.sources[0];
    source.scope[key] = key.endsWith("Id") && key !== "sellerId" ? id() : key === "environment" ? "production" : key === "authorizedLocationIds" ? ["FOREIGN_SYNTHETIC_LOCATION"] : key === "generation" ? 2 : "FOREIGN_SYNTHETIC_SELLER";
    recompute(source);
    await denied(() => invoke(runtime.client, "commit_square_ingestion_page_v1", { p_task_id: lostTask.context.taskId, p_lease_owner_fingerprint: lostTask.context.leaseOwnerFingerprint, p_command: forged }), "recomputed integrity hashes do not authorize foreign scope");
  }
  for (const key of ["workspaceId", "connectionId", "providerEntityId", "providerEnvironment", "providerKey", "locationId"]) {
    const forged = clone(lost.command), source = forged.sources[0];
    const foreign = key === "providerEnvironment" ? "production" : key === "providerKey" ? "quickbooks_online" : key === "workspaceId" || key === "connectionId" ? id() : "FOREIGN_SYNTHETIC_VALUE";
    source.projection.data.authority[key] = foreign;
    if (key === "locationId") source.projection.data.locationId = foreign;
    recompute(source);
    await denied(() => invoke(runtime.client, "commit_square_ingestion_page_v1", { p_task_id: lostTask.context.taskId, p_lease_owner_fingerprint: lostTask.context.leaseOwnerFingerprint, p_command: forged }), "recomputed projection hashes cannot grant nested authority");
  }
  for (const committed of [false, true]) {
    const processTask = await task(basic());
    const processCapture = adapter(processTask, { payments: [squarePaymentFixture()] }, runtime.client, { beforeCommit() { throw new Error("synthetic_capture"); } });
    await processCapture.run();
    // The failed capture retains its finite lease; owner-only fixture expiry
    // advances this test without changing application authority or task evidence.
    await expireLease(processTask);
    const lease = await processCapture.repository.acquire(processTask.binding, Date.now());
    const commandValue = { ...processCapture.command, lease: lease.lease };
    const child = fork(path.join(root, "supabase/tests/fixtures/square-durable-process.js"), [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const ready = new Promise((resolveReady, rejectReady) => { const timer = setTimeout(() => rejectReady(new Error("worker_barrier_timeout")), 15000); child.once("message", message => { clearTimeout(timer); if (message.ready) resolveReady(message); else rejectReady(Object.assign(new Error("worker_failed"), { code: message.code })); }); child.once("error", rejectReady); });
    child.send({ connection: runtime.connection, args: [processTask.context.taskId, processTask.context.leaseOwnerFingerprint, commandValue], commit: committed });
    try { await ready; } finally { child.kill("SIGKILL"); await new Promise(resolveExit => child.once("exit", resolveExit)); }
    const receipts = await owner.query("select count(*)::integer as n from private.square_ingestion_page_receipts where scan_key=$1", [processTask.binding.scanKey]);
    equal(receipts.rows[0].n, committed ? 1 : 0, "real process death respects commit boundary"); scenarios++;
    if (!committed) await expireLease(processTask);
    equal((await adapter(processTask, { payments: [squarePaymentFixture()] }).run()).outcome, committed ? "finished" : "committed", "new process view recovers atomic state");
  }
  stage = "multi_source_transaction_rollback";
  const multiTask = await task(basic());
  const multiResponse = { payments: [squarePaymentFixture({ id: "PAY_SYNTHETIC_MULTI_A" }), squarePaymentFixture({ id: "PAY_SYNTHETIC_MULTI_B" })] };
  await owner.query("create sequence private.square_qualification_fault_counter");
  await owner.query("create function private.square_qualification_fault_v1() returns trigger language plpgsql set search_path='' as $$ begin if nextval('private.square_qualification_fault_counter')=2 then raise exception using errcode='P0001',message='synthetic_second_write_fault'; end if; return new; end $$");
  await owner.query("create trigger square_qualification_midwrite_fault after insert on private.square_ingestion_versions for each row execute function private.square_qualification_fault_v1()");
  const multi = adapter(multiTask, multiResponse);
  equal((await multi.run()).outcome, "retry", "second-write fault contained");
  equal((await owner.query("select last_value::integer as n from private.square_qualification_fault_counter")).rows[0].n, 2, "fault actually follows two source INSERTs");
  equal((await owner.query("select count(*)::integer as n from private.square_ingestion_versions where pending->>'providerRecordId' like 'PAY_SYNTHETIC_MULTI_%'")).rows[0].n, 0, "every source INSERT rolls back together");
  equal((await owner.query("select checkpoint_version from private.square_ingestion_scans where scan_key=$1", [multiTask.binding.scanKey])).rows[0].checkpoint_version, 0, "checkpoint cannot advance past rolled-back sources");
  await owner.query("drop trigger square_qualification_midwrite_fault on private.square_ingestion_versions");
  await owner.query("drop function private.square_qualification_fault_v1()");
  await owner.query("drop sequence private.square_qualification_fault_counter");
  await expireLease(multiTask);
  equal((await adapter(multiTask, multiResponse).run()).sourceCount, 2, "retry commits complete multi-source page");
  equal((await owner.query("select count(*)::integer as n from private.square_ingestion_versions where pending->>'providerRecordId' like 'PAY_SYNTHETIC_MULTI_%'")).rows[0].n, 2, "only complete retry visible");

  stage = "real_revocation_lock_order";
  async function waitForLock(pid) {
    const until = Date.now() + 5000;
    while (Date.now() < until) {
      await owner.query("select pg_stat_clear_snapshot()");
      const row = (await owner.query("select wait_event_type from pg_stat_activity where pid=$1", [pid])).rows[0];
      if (row?.wait_event_type === "Lock") { assertions++; return; }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 10));
    }
    throw new Error("expected_lock_barrier_missing");
  }
  for (const revokeFirst of [false, true]) {
    const raceScope = { ...scope, connectionId: id() };
    await invoke(admin.client, "enroll_square_qualification_connection_v1", { p_command: enrollment(raceScope) });
    const raceTask = await task(grant("payments", "list_payments", "/v2/payments?location_id=LOC_SYNTHETIC_1", null, raceScope));
    const raceCapture = adapter(raceTask, { payments: [squarePaymentFixture()] }, runtime.client, { beforeCommit() { throw new Error("synthetic_capture"); } });
    await raceCapture.run(); await expireLease(raceTask);
    const raceLease = await raceCapture.repository.acquire(raceTask.binding, 0), raceCommand = { ...raceCapture.command, lease: raceLease.lease };
    const worker = await connect(runtime.connection), revoker = await connect(admin.connection); openClients.push(worker, revoker);
    const commitArgs = { p_task_id: raceTask.context.taskId, p_lease_owner_fingerprint: raceTask.context.leaseOwnerFingerprint, p_command: raceCommand };
    const revokeArgs = { p_connection_id: raceScope.connectionId, p_expected_generation: 1, p_reason: "qualification_revoked" };
    if (revokeFirst) {
      await revoker.query("begin"); await invoke(revoker, "revoke_square_qualification_connection_v1", revokeArgs);
      const waiting = rpc(worker).rpc("commit_square_ingestion_page_v1", commitArgs);
      await waitForLock(worker.processID); await revoker.query("commit");
      equal((await waiting).error?.code, "42501", "revocation winning fence rejects waiting stale commit");
    } else {
      await worker.query("begin"); equal((await invoke(worker, "commit_square_ingestion_page_v1", commitArgs)).outcome, "committed", "valid earlier transaction stages page");
      const waiting = rpc(revoker).rpc("revoke_square_qualification_connection_v1", revokeArgs);
      await waitForLock(revoker.processID); await worker.query("commit");
      equal((await waiting).data.state, "revoked", "revocation waits for earlier valid commit");
    }
    equal((await owner.query("select count(*)::integer as n from private.square_ingestion_page_receipts where scan_key=$1", [raceTask.binding.scanKey])).rows[0].n, revokeFirst ? 0 : 1, "only lock-ordered historical commit retained");
    await worker.end(); await revoker.end();
    scenarios++;
  }
  stage = "lease_clock_after_wait";
  const expiringTask = await task({ ...basic(), expiresAt: Date.now() + 2500 });
  const blocker = await connect(admin.connection); openClients.push(blocker);
  // Owner fixture locks the connection; checked runtime acquisition must reread
  // database time after waiting, not rely on caller time or transaction start.
  await owner.query("begin"); await owner.query("select connection_id from private.square_connections where connection_id=$1 for update", [scope.connectionId]);
  const expiryWaiting = rpc(concurrentClient).rpc("acquire_square_ingestion_page_v1", { p_task_id: expiringTask.context.taskId, p_lease_owner_fingerprint: expiringTask.context.leaseOwnerFingerprint, p_binding: expiringTask.binding });
  await waitForLock(concurrentClient.processID);
  await blocker.query("select pg_sleep(2.6)"); await owner.query("commit");
  equal((await expiryWaiting).error?.code, "42501", "expired task cannot acquire after lock wait"); scenarios++;

  stage = "cursor_expiry_after_resource_wait";
  const cursorTask = await task(basic());
  const cursorFirst = adapter(cursorTask, { payments: [squarePaymentFixture({ id: "PAY_SYNTHETIC_CURSOR_WAIT" })], cursor: "shortCursor==" });
  equal((await cursorFirst.run()).outcome, "committed", "cursor race initial page");
  // Narrow mutable-state expiry fixture; no immutable authority/versions changed.
  await owner.query("update private.square_ingestion_scans set cursor=jsonb_set(cursor,'{expiresAt}',to_jsonb(floor(extract(epoch from clock_timestamp())*1000)::bigint+2500)) where scan_key=$1", [cursorTask.binding.scanKey]);
  const cursorWorker = await connect(runtime.connection); openClients.push(cursorWorker);
  const cursorSecond = adapter(cursorTask, { payments: [squarePaymentFixture({ id: "PAY_SYNTHETIC_CURSOR_WAIT", updated_at: "2026-09-01T12:09:00Z" })] }, cursorWorker);
  await owner.query("begin"); await owner.query("select resource_key from private.square_ingestion_resources where provider_record_id='PAY_SYNTHETIC_CURSOR_WAIT' for update");
  const cursorWaiting = cursorSecond.run();
  await waitForLock(cursorWorker.processID); await blocker.query("select pg_sleep(2.6)"); await owner.query("commit");
  equal((await cursorWaiting).outcome, "retry", "input cursor expiration while waiting rolls back publication");
  equal((await owner.query("select checkpoint_version from private.square_ingestion_scans where scan_key=$1", [cursorTask.binding.scanKey])).rows[0].checkpoint_version, 1, "expired input cursor cannot advance checkpoint");
  equal((await owner.query("select count(*)::integer as n from private.square_ingestion_versions where pending->>'providerRecordId'='PAY_SYNTHETIC_CURSOR_WAIT'")).rows[0].n, 1, "expired input cursor rolls back new source version");
  equal((await adapter(cursorTask, { payments: [] }).run()).outcome, "blocked", "expired private cursor remains fail-closed across restart");

  stage = "ordering_completeness_privacy";
  const privacyCanary = "SQUARE_SYNTHETIC_PRIVATE_CANARY_DO_NOT_PERSIST";
  for (const [time, amount] of [["2026-09-01T12:01:00.000000001Z", 1000], ["2026-09-01T12:01:00.000000002Z", 2000], ["2026-09-01T12:01:00.000000001Z", 500], ["2026-09-01T12:01:00.000000002Z", 3000]]) {
    const revisionTask = await task(basic());
    equal((await adapter(revisionTask, { payments: [squarePaymentFixture({ id: "PAY_SYNTHETIC_ORDERING", updated_at: time, amount_money: { amount, currency: "USD" }, note: privacyCanary })] }).run()).outcome, "committed", "provider ordering observation retained");
  }
  const revisions = (await owner.query("select v.pending,v.ordering,r.current_version_key from private.square_ingestion_versions v join private.square_ingestion_resources r using(resource_key) where r.provider_record_id='PAY_SYNTHETIC_ORDERING' order by ordinal")).rows;
  equal(revisions.length, 4, "four immutable content versions");
  equal(revisions.map(row => row.ordering).join(","), "newer,newer,older,conflict", "nanosecond, late and equal-clock ordering preserved");
  equal(revisions.find(row => row.pending.versionKey === row.current_version_key).pending.projection.data.amountMoney.amountMinor, "2000", "late and conflicting observations cannot replace current version");
  ok(!JSON.stringify(revisions).includes(privacyCanary), "private raw field is minimized before durable storage");
  const unsupportedTask = await task({ ...cases[2][0], scope: clone(scope), scanId: id() });
  equal((await adapter(unsupportedTask, { orders: [order], cursor: "partialCursor==" }).run()).outcome, "committed", "partial Orders page accepted");
  equal((await adapter(unsupportedTask, { orders: [{ ...order, location_id: "FOREIGN_SYNTHETIC_LOCATION" }] }).run()).outcome, "blocked", "unsupported or rejected continuation blocks");
  const cumulative = await adapter(unsupportedTask, { orders: [] }).run();
  ok(cumulative.completeness.reasons.includes("returns_unknown") && cumulative.completeness.reasons.includes("unsupported_page"), "prior and later limitations persist together across restart");
  const oversizedTask = await task(basic());
  equal((await adapter(oversizedTask, { payments: [], cursor: "x".repeat(4097) }).run()).outcome, "blocked", "first oversized cursor rejected");
  equal((await owner.query("select checkpoint_version from private.square_ingestion_scans where scan_key=$1", [oversizedTask.binding.scanKey])).rows[0].checkpoint_version, 0, "oversized cursor cannot advance checkpoint");

  stage = "new_owner_lease_fence";
  const takeoverTask = await task(basic());
  const takeover = adapter(takeoverTask, { payments: [squarePaymentFixture()] }, runtime.client, { beforeCommit() { throw new Error("synthetic_capture"); } });
  await takeover.run(); await expireLease(takeoverTask);
  const nextTask = await task(takeoverTask.grant, other);
  const nextRepository = createSquareDurablePageRepository({ ...nextTask.context, client: rpc(other.client) });
  const nextLease = await nextRepository.acquire(nextTask.binding, 0); equal(nextLease.outcome, "leased", "new checked worker takes over expired lease");
  equal((await invoke(runtime.client, "commit_square_ingestion_page_v1", { p_task_id: takeoverTask.context.taskId, p_lease_owner_fingerprint: takeoverTask.context.leaseOwnerFingerprint, p_command: takeover.command })).outcome, "conflict", "late old worker cannot advance checkpoint");
  await takeover.repository.release(takeover.command.lease, { now: 0, retryAfterMs: null, blocked: true });
  equal((await owner.query("select lease->>'leaseId' as id from private.square_ingestion_scans where scan_key=$1", [takeoverTask.binding.scanKey])).rows[0].id, nextLease.lease.leaseId, "old release cannot reclaim newer owner lease");
  equal((await nextRepository.commitPage({ ...takeover.command, lease: nextLease.lease })).outcome, "committed", "only new lease owner commits");

  stage = "retained_capacity_boundaries";
  const capacityScope = { ...scope, connectionId: id() };
  await invoke(admin.client, "enroll_square_qualification_connection_v1", { p_command: enrollment(capacityScope) });
  for (let index = 0; index < 33; index++) {
    const capacityTask = await task(grant("payments", "list_payments", "/v2/payments?location_id=LOC_SYNTHETIC_1", null, capacityScope));
    const capacityTest = adapter(capacityTask, { payments: [] });
    equal((await capacityTest.run()).outcome, index < 32 ? "committed" : "blocked", "exact scan capacity and first excess enforced");
    if (index === 32) equal(capacityTest.calls, 0, "scan33 blocks before transport");
  }
  equal((await counters(capacityScope.connectionId)).scans, 32, "scan cap rejects without counter drift");
  const byteScope = { ...scope, connectionId: id() };
  await invoke(admin.client, "enroll_square_qualification_connection_v1", { p_command: enrollment(byteScope) });
  const byteTask = await task(grant("payments", "list_payments", "/v2/payments?location_id=LOC_SYNTHETIC_1", null, byteScope));
  const byteTest = adapter(byteTask, { payments: [squarePaymentFixture()] }, runtime.client, { async beforeCommit() {
    // Synthetic near-capacity state avoids allocating64MiB just to test the
    // checked transactional exhaustion branch. No source/checkpoint DML shortcut.
    await owner.query("update private.square_ingestion_capacity set retained_bytes=67108863 where connection_id=$1", [byteScope.connectionId]);
  } });
  equal((await byteTest.run()).outcome, "conflict", "capacity failure does not report committed page");
  equal((await owner.query("select checkpoint_version,status from private.square_ingestion_scans where scan_key=$1", [byteTask.binding.scanKey])).rows[0].checkpoint_version, 0, "capacity failure cannot publish checkpoint");
  equal((await counters(byteScope.connectionId)).versions, 0, "capacity failure rolls back source and counter together");
  equal((await counters(byteScope.connectionId)).receipts, 0, "capacity failure cannot publish receipt");
  equal((await adapter(byteTask, { payments: [] }).run()).outcome, "blocked", "capacity stop remains incomplete after restart");

  stage = "supported_large_catalog_expansion";
  const largeScope = { ...scope, connectionId: id(), authorizedLocationIds: Array.from({ length: 1000 }, (_, index) => "L" + index.toString(36).padStart(2, "0")).sort() };
  await invoke(admin.client, "enroll_square_qualification_connection_v1", { p_command: enrollment(largeScope) });
  const largeRaw = squareCatalogValidationMaximumEnvelope();
  function rawValues(value) { return 1 + (value !== null && typeof value === "object" ? Object.values(value).reduce((sum, child) => sum + rawValues(child), 0) : 0); }
  equal(rawValues(largeRaw), 20000, "supported large Catalog fixture reaches exact raw response budget");
  const largeTask = await task(grant("catalog", "catalog_search", "/v2/catalog/search", { object_types: ["ITEM"], limit: 1000, include_deleted_objects: true, include_related_objects: true, include_options: { include: ["INCLUDE_NESTED_MODIFIERS"] } }, largeScope));
  // Owner-only profiling configuration for this disposable login, not extra
  // application authority. Function timings contain names/counts only, no data.
  await owner.query(`alter role ${quote(runtime.name)} set track_functions='all'`);
  const largeClient = await connect({ ...runtime.connection, statement_timeout: 29000, query_timeout: 31000 }); openClients.push(largeClient);
  const settings = (await largeClient.query("select current_setting('server_version') as version,current_setting('plan_cache_mode') as plans,current_setting('jit') as jit,pg_jit_available() as jit_available,current_setting('jit_above_cost') as jit_above_cost,current_setting('work_mem') as work_mem,current_setting('default_toast_compression') as compression")).rows[0];
  // Preload names are superuser-readable metadata. Read them through the
  // existing fixture owner, never by enlarging the runtime login privileges.
  settings.ownerExtensionSettings = (await owner.query("select current_setting('shared_preload_libraries') as shared_libraries,current_setting('session_preload_libraries') as session_libraries,current_setting('pg_stat_statements.track',true) as statement_tracking,current_setting('pg_stat_statements.track_planning',true) as planning_tracking,current_setting('pgaudit.log',true) as audit_classes")).rows[0];
  console.log("Catalog qualification database settings: " + JSON.stringify(settings));
  const largeTest = adapter(largeTask, largeRaw, largeClient, { beforeCommit() { catalogTiming.events.push({ phase: "mapped_command_captured", milliseconds: Date.now() - catalogTiming.started }); } });
  const largeStarted = Date.now(); catalogTiming = { started: largeStarted, events: [] };
  const largeResult = await largeTest.run(), largeElapsed = Date.now() - largeStarted;
  console.log(`Supported Catalog bounded attempt: ${largeElapsed}ms; outcome ${largeResult.outcome}.`);
  console.log("Catalog qualification stage timings: " + JSON.stringify(catalogTiming.events)); catalogTiming = null;
  // On deadline failure the active SQL statement may still be finishing its
  // own bounded cancellation. Diagnostics add at most five seconds, not a new
  // application attempt; a timed-out queued flush is removed by the pg client.
  await largeClient.query({ text: "select pg_stat_force_next_flush()", query_timeout: 5000 }).catch(() => {});
  await owner.query("select pg_stat_clear_snapshot()");
  const functions = (await owner.query("select funcname,calls,total_time,self_time from pg_stat_user_functions where funcname like '%square%' order by self_time desc limit 12")).rows;
  console.log("Catalog qualification function timings: " + JSON.stringify(functions));
  equal(largeResult.outcome, "committed", "largest supported repeated-location Catalog page commits within finite invocation");
  equal(largeResult.sourceCount, 3000, "all primary/related/included roots durably represented");
  const largeState = await counters(largeScope.connectionId);
  equal(largeState.versions, 3000, "large page creates3000 immutable pending versions");
  ok(Number(largeState.retained_bytes) < 67108864, "large supported page fits retained byte cap");
  console.log(`Supported Catalog witness: 20,000 raw values; 3,000 roots x 1,000 explicit locations; ${largeElapsed}ms; ${largeState.retained_bytes} retained logical bytes.`);
  await largeClient.end();
  stage = "isolated_catalog_guard_diagnostic";
  // Isolate the initial whole-command guard that previously consumed the CI
  // deadline before source validation. The fixture owner configures one owned
  // diagnostic login, not the shared postgres role or an application runtime.
  // Only the pure JSON helpers are callable; no session SET/reset privilege,
  // application role membership or table access is needed for profiling.
  const guardRole = await login("guard", null);
  await owner.query(`alter role ${quote(guardRole.name)} set track_functions='all'`);
  await owner.query(`grant usage on schema private to ${quote(guardRole.name)}`);
  await owner.query(`grant execute on function private.square_walk_page_json_v1(jsonb,text[],bigint[],jsonb,text,text),private.square_utf16_length_v1(text) to ${quote(guardRole.name)}`);
  await guardRole.client.end();
  const guardClient = await connect({ ...guardRole.connection, statement_timeout: 29000, query_timeout: 31000 }); openClients.push(guardClient);
  equal((await guardClient.query("select current_setting('track_functions') as tracking")).rows[0].tracking, "all", "owned diagnostic login inherits profiling without privileged session SET");
  await denied(() => guardClient.query("set track_functions='none'"), "restricted diagnostic login cannot change privileged session tracking");
  await denied(() => guardClient.query("select pg_stat_reset_single_function_counters('private.square_walk_page_json_v1(jsonb,text[],bigint[],jsonb,text,text)'::regprocedure)"), "restricted diagnostic login cannot reset shared function statistics");
  await denied(() => guardClient.query("select 1 from private.square_ingestion_versions limit 1"), "pure guard diagnostic grants do not permit source-table access");
  const guardPrivileges = (await owner.query("select pg_has_role($1,'square_ingestion_runtime_authority','MEMBER') as runtime,pg_has_role($1,'square_ingestion_qualification_admin','MEMBER') as admin,has_function_privilege($1,'public.commit_square_ingestion_page_v1(uuid,text,jsonb)','EXECUTE') as commit", [guardRole.name])).rows[0];
  equal(guardPrivileges.runtime, false, "diagnostic login has no runtime authority membership");
  equal(guardPrivileges.admin, false, "diagnostic login has no qualification admin membership");
  equal(guardPrivileges.commit, false, "diagnostic login cannot invoke the page commit RPC");
  await owner.query("select pg_stat_clear_snapshot()");
  const guardCallsBefore = Number((await owner.query("select calls from pg_stat_user_functions where funcid='private.square_walk_page_json_v1(jsonb,text[],bigint[],jsonb,text,text)'::regprocedure")).rows[0].calls);
  const guardStarted = Date.now();
  const guardBudget = (await guardClient.query("select private.square_walk_page_json_v1($1::jsonb,array[]::text[],array[7199999,66000,67108864]::bigint[]) as remaining", [JSON.stringify(largeTest.command)])).rows[0].remaining.map(Number);
  const guardElapsed = Date.now() - guardStarted;
  equal(JSON.stringify(guardBudget), JSON.stringify(logicalBudget(largeTest.command)), "maximum supported command has exact whole-graph accounting in one iterative guard");
  await guardClient.query("select pg_stat_force_next_flush()");
  await guardClient.end();
  await owner.query("select pg_stat_clear_snapshot()");
  equal(Number((await owner.query("select calls from pg_stat_user_functions where funcid='private.square_walk_page_json_v1(jsonb,text[],bigint[],jsonb,text,text)'::regprocedure")).rows[0].calls) - guardCallsBefore, 1, "whole maximum command adds exactly one visitor invocation without resetting counters");
  console.log(`Isolated maximum Catalog command guard: ${guardElapsed}ms; exact logical budget; one visitor call.`);

  stage = "connection_revocation_and_generation";
  const beforeRevocation = (await owner.query("select count(*)::integer as n from private.square_ingestion_versions")).rows[0].n;
  await invoke(admin.client, "revoke_square_qualification_connection_v1", { p_connection_id: scope.connectionId, p_expected_generation: 1, p_reason: "qualification_revoked" });
  equal((await adapter(checkedTask, { payments: [squarePaymentFixture()] }).run()).outcome, "rejected", "revoked connection blocks runtime without transport");
  equal((await owner.query("select count(*)::integer as n from private.square_ingestion_versions")).rows[0].n, beforeRevocation, "revocation preserves historical versions");
  scope.generation = 2;
  await invoke(admin.client, "enroll_square_qualification_connection_v1", { p_command: enrollment(scope) });
  await denied(() => invoke(runtime.client, "resolve_square_ingestion_authority_v1", { p_task_id: checkedTask.context.taskId, p_lease_owner_fingerprint: checkedTask.context.leaseOwnerFingerprint }), "new generation cannot revive old task");
  equal((await owner.query("select count(*)::integer as n from private.square_connection_generations where connection_id=$1", [scope.connectionId])).rows[0].n, 2, "append-only generation history retained");
  await denied(() => owner.query("update private.square_connection_generations set retention_policy_version='mutated' where connection_id=$1", [scope.connectionId]), "even owner cannot silently mutate authority evidence");
}

module.exports = { assertNoRemoteConfiguration, assertNoLinkedProject, validateLocalDatabaseUrl, runAdditionalQualification };
if (require.main === module) main().catch(error => {
  process.stderr.write(`Square durable qualification failed at ${stage} (${safeCode(error)}).\n`);
  if (error.code === "ERR_ASSERTION") process.stderr.write(`Assertion: ${String(error.message).split("\n")[0]}\n`);
  if (lastRpcFailure) process.stderr.write("Last checked RPC failure: " + JSON.stringify(lastRpcFailure) + "\n");
  if (lastOutcome) process.stderr.write("Last adapter outcome: " + JSON.stringify(lastOutcome) + "\n");
  if (error.localDiagnostic) process.stderr.write(error.localDiagnostic + "\n");
  process.exitCode = 1;
});
