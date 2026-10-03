#!/usr/bin/env node
// CI-only fixture adaptation: Supabase CLI 2.111 installs pg_net unconditionally;
// the verified Production 102-migration baseline has no net schema/extension.
// Never weaken the overlay to admit that unrelated local HTTP authority.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const cli = process.env.SUPABASE_CLI_PATH || "supabase";

function run(command, args, { cwd = root, env = process.env } = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", timeout: 240000,
    maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error("production_shaped_local_command_failed");
  return result.stdout;
}

function validateLocalTarget(config, context, container, rawUrl) {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") throw new Error("ci_fixture_only");
  const project = /^project_id\s*=\s*"([A-Za-z0-9_-]+)"/m.exec(config)?.[1];
  if (!project || context.length !== 1 || !String(context[0]?.Endpoints?.docker?.Host).startsWith("unix://")
    || (process.env.DOCKER_HOST && !process.env.DOCKER_HOST.startsWith("unix://"))) throw new Error("local_container_required");
  const url = new URL(rawUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1"].includes(url.hostname)
    || url.username !== "postgres" || url.pathname !== "/postgres" || url.search || url.hash
    || !/^\d{2,5}$/.test(url.port) || Number(url.port) > 65535) throw new Error("local_database_required");
  const target = container[0];
  if (container.length !== 1 || target?.Name !== `/supabase_db_${project}` || !target.State?.Running
    || !String(target.Config?.Image).includes("supabase/postgres")
    || !(target.NetworkSettings?.Ports?.["5432/tcp"] || []).some(port => Number(port.HostPort) === Number(url.port))) {
    throw new Error("local_container_identity_mismatch");
  }
  return { host: "127.0.0.1", port: Number(url.port), database: "postgres", user: "postgres",
    password: decodeURIComponent(url.password), ssl: false };
}

const normalizeSql = `begin;
do $fixture$
begin
  if current_database()<>'postgres' or inet_server_port()<>5432
    or current_setting('server_version_num')::integer/10000<>17 then
    raise exception 'production_shaped_local_identity_mismatch';
  end if;
  if exists(select 1 from pg_catalog.pg_extension where extname='pg_net') then
    -- The exact 17.6.1.156 image control file pins 0.20.4; its README's
    -- older 0.19.5 extension table is not the packaged default.
    if not exists(select 1 from pg_catalog.pg_extension where extname='pg_net' and extversion='0.20.4')
      or (select array_agg(relname::text order by relname) from pg_catalog.pg_class
        where relnamespace='net'::regnamespace and relkind in ('r','p','v','m','f','S','i','I')) is distinct from
        array['_http_response','_http_response_created_idx','http_request_queue','http_request_queue_id_seq']::text[]
      or (select array_agg(proname::text order by proname) from pg_catalog.pg_proc
        where pronamespace='net'::regnamespace) is distinct from
        array['_await_response','_encode_url_with_params_array','_http_collect_response','_urlencode_string',
          'check_worker_is_up','http_collect_response','http_delete','http_get','http_post',
          'wait_until_running','wake','worker_restart']::text[] then
      raise exception 'local_pg_net_fixture_inventory_changed';
    end if;
    if exists(select 1 from net.http_request_queue) or exists(select 1 from net._http_response) then
      raise exception 'local_pg_net_fixture_not_empty';
    end if;
    -- RESTRICT preserves any unexpected dependent object by failing atomically.
    drop extension pg_net restrict;
  end if;
  if to_regnamespace('net') is not null or exists(select 1 from pg_catalog.pg_extension where extname='pg_net') then
    raise exception 'local_net_schema_not_extension_owned';
  end if;
end $fixture$;
commit;`;

function assertFixtureEnvironment() {
  if (process.env.CI !== "true" || process.env.GITHUB_ACTIONS !== "true") throw new Error("ci_fixture_only");
  if (fs.existsSync(path.join(root, "supabase/.temp/project-ref"))) throw new Error("linked_project_forbidden");
  for (const key of ["DATABASE_URL", "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
    "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "SUPABASE_ACCESS_TOKEN", "SUPABASE_TEST_DATABASE_URL"])
    if (Object.hasOwn(process.env, key)) throw new Error("inherited_database_configuration_forbidden");
}

function localConnection() {
  assertFixtureEnvironment();
  const config = fs.readFileSync(path.join(root, "supabase/config.toml"), "utf8");
  const project = /^project_id\s*=\s*"([A-Za-z0-9_-]+)"/m.exec(config)?.[1];
  if (!project) throw new Error("local_project_missing");
  const context = JSON.parse(run("docker", ["context", "inspect"]));
  const container = JSON.parse(run("docker", ["inspect", `supabase_db_${project}`]));
  const status = run(cli, ["status", "-o", "env"]);
  const url = /^DB_URL="([^"\r\n]+)"$/m.exec(status)?.[1];
  if (!url) throw new Error("local_database_status_missing");
  return validateLocalTarget(config, context, container, url);
}

async function normalizeLocalFixture() {
  const connection = localConnection();
  const { Client } = require("pg");
  const client = new Client(connection);
  try { await client.connect(); await client.query(normalizeSql); }
  finally { await client.end(); }
}

async function resetLocalFixture(version) {
  assertFixtureEnvironment();
  if (!/^\d{14}$/.test(version)) throw new Error("exact_migration_version_required");
  const names = fs.readdirSync(path.join(root, "supabase/migrations")).filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  if (!names.some(name => name.startsWith(`${version}_`))) throw new Error("migration_version_missing");
  localConnection(); // Verify the current local container before destructive reset.
  // The CLI recreates its bootstrap on every reset. Disable only its automatic
  // apply, remove the absent-in-Production extension, then use its normal migrator.
  run(cli, ["db", "reset", "--local", "--no-seed", "--version", version], {
    env: { ...process.env, SUPABASE_DB_MIGRATIONS_ENABLED: "false" }
  });
  await normalizeLocalFixture();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vaeroex-production-shaped-migrations-"));
  try {
    fs.mkdirSync(path.join(directory, "supabase/migrations"), { recursive: true });
    fs.copyFileSync(path.join(root, "supabase/config.toml"), path.join(directory, "supabase/config.toml"));
    for (const name of names.filter(name => name.split("_", 1)[0] <= version)) {
      fs.copyFileSync(path.join(root, "supabase/migrations", name), path.join(directory, "supabase/migrations", name));
    }
    run(cli, ["migration", "up", "--local", "--workdir", directory], {
      env: { ...process.env, SUPABASE_DB_MIGRATIONS_ENABLED: "true" }
    });
    const { Client } = require("pg");
    const client = new Client(localConnection());
    try {
      await client.connect();
      const ledger = await client.query("select version from supabase_migrations.schema_migrations order by version");
      const expected = names.filter(name => name.split("_", 1)[0] <= version).map(name => name.split("_", 1)[0]);
      if (JSON.stringify(ledger.rows.map(row => row.version)) !== JSON.stringify(expected)) {
        throw new Error("local_migration_prefix_not_exact");
      }
    } finally { await client.end(); }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function sanitizedFailure(error) {
  const labels = new Set(["ci_fixture_only", "local_container_required", "local_database_required",
    "local_container_identity_mismatch", "linked_project_forbidden", "inherited_database_configuration_forbidden",
    "local_project_missing", "local_database_status_missing", "production_shaped_local_command_failed",
    "production_shaped_local_identity_mismatch", "local_pg_net_fixture_inventory_changed",
    "local_pg_net_fixture_not_empty", "local_net_schema_not_extension_owned",
    "exact_migration_version_required", "migration_version_missing", "local_migration_prefix_not_exact"]);
  if (labels.has(error?.message)) return error.message;
  if (error?.code === "42501") return "local_fixture_database_permission_denied";
  if (error?.code === "2BP01") return "local_fixture_unexpected_extension_dependency";
  if (["42P01", "42704", "42883"].includes(error?.code)) return "local_fixture_expected_object_missing";
  return "production_shaped_local_fixture_failed";
}

module.exports = { validateLocalTarget, normalizeSql, normalizeLocalFixture, resetLocalFixture, sanitizedFailure };
if (require.main === module) {
  if (process.argv.length !== 2) throw new Error("no_target_arguments_allowed");
  normalizeLocalFixture().then(() => console.log("production_shaped_local_fixture_ready"))
    .catch(error => { console.error(sanitizedFailure(error)); process.exitCode = 1; });
}
