"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Standalone Node CommonJS synthetic fixture. */
// Synthetic fixtures only. No user profile, remote endpoint or credential input.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawnSync } = require("node:child_process");
function localPath(value) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\u0000-\u0020\u007f'\\]/.test(value) || value.includes("://")) throw new Error("local_dependencies_denied");
  return fs.realpathSync(value);
}
const manifestPath = process.env.VAEROEX_NATIVE_TEST_DEPENDENCIES;
let manifest;
if (manifestPath !== undefined) {
  const file = localPath(manifestPath);
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 8192) throw new Error("local_dependencies_denied");
  manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!manifest || Object.keys(manifest).sort().join(",") !== "auditRoot,binarySha256,nodeModulesRoot,pgRoot,supaRoot" ||
      !Array.isArray(manifest.binarySha256) || manifest.binarySha256.length !== 6 ||
      manifest.binarySha256.some(value => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))) throw new Error("local_dependencies_denied");
  for (const key of ["auditRoot", "nodeModulesRoot", "pgRoot", "supaRoot"]) manifest[key] = localPath(manifest[key]);
}
const pgRoot = manifest?.pgRoot ?? "/private/tmp/vaeroex-square-pg176.ArIWfz/install";
const auditRoot = manifest?.auditRoot ?? "/private/tmp/vaeroex-square-pgaudit-17-review";
const supaRoot = manifest?.supaRoot ?? "/private/tmp/vaeroex-square-supautils-review";
const nodeModulesRoot = manifest?.nodeModulesRoot ?? path.resolve(__dirname, "../../../node_modules");
const { Client } = require(path.join(nodeModulesRoot, "pg"));
const env = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", PSQL_HISTORY: "/dev/null",
  PGPASSFILE: "/dev/null", PGSERVICEFILE: "/dev/null", PGSYSCONFDIR: "/nonexistent" });
const admin = "synthetic_native_owner";
const target = "square_sandbox_synthetic_broker";
const capability = "square_account_broker_authority";
const failed = name => { const error = new Error("synthetic_qualification_failed"); error.safeStage = name; throw error; };
function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { env, encoding: "utf8", timeout: 20000,
    maxBuffer: 1024 * 1024, ...options });
  if (result.error || result.status !== 0) failed("local_dependency_command");
  return result.stdout;
}
function hash(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function dependencies() {
  if (command(path.join(pgRoot, "bin/postgres"), ["--version"]).trim() !== "postgres (PostgreSQL) 17.6" ||
      command(path.join(pgRoot, "bin/pg_config"), ["--version"]).trim() !== "PostgreSQL 17.6") failed("postgres_version");
  const sources = [[auditRoot, "538f89a93d8fd0d8913f3d740cacaea7b7eb66d9"], [supaRoot, "e35f8affc4467202ff0d98f8dd14cb955bc13c75"]];
  for (const [directory, expected] of sources) if (command("/usr/bin/git", ["-C", directory, "rev-parse", "HEAD"]).trim() !== expected) failed("extension_source_revision");
  const suffix = process.platform === "linux" ? "so" : "dylib";
  const files = [
    [path.join(pgRoot, "bin/postgres"), "cfba8d6fc8f1bd3cd57babfb184b8e66f96877402e3be5d3a2afa914d700a9e4"],
    [path.join(pgRoot, process.platform === "linux" ? "lib/libpq.so.5" : "lib/libpq.5.dylib"), "beaf2bee592d346dc211bedd8636698d9aa11efabb5b0fbd61e883f0a43194b6"],
    [path.join(auditRoot, "pgaudit." + suffix), "ea2c93d6c4672c67f1d0e3b67e6f0e9938265a003cb24c04a2d4833b9ea338ea"],
    [path.join(supaRoot, "supautils." + suffix), "69836d5e6ca287b72263dcbb113593cfd79f292127d3ac45a73f3831f59bb444"],
    [path.join(pgRoot, "lib/postgresql/pg_stat_statements." + suffix), "f3d380431feb95fd2700f5de711535dd2a08a0603cd51a39d2d71cdc69de749e"],
    [path.join(pgRoot, "lib/postgresql/auto_explain." + suffix), "29ac023054959362ab96adffd5153ce75e5b8354547bacbd21beda7c01318447"]
  ];
  if (manifest) files.forEach((file, index) => { file[1] = manifest.binarySha256[index]; });
  for (const [file, expected] of files) if (hash(file) !== expected) failed("local_dependency_digest");
  return { postgres: "17.6", pgaudit: "17.1", supautilsSource: sources[1][1], binarySha256: files.map(([, digest]) => digest) };
}
async function port() {
  const socket = net.createServer();
  await new Promise((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const value = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return value;
}
async function createFixture({ expandedOperator = false } = {}) {
  const versions = dependencies();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "native-broker-synthetic-")));
  fs.chmodSync(root, 0o700);
  const data = path.join(root, "data"), log = path.join(root, "postgres.log");
  const cert = path.join(root, "server.crt"), key = path.join(root, "server.key");
  const socket = path.join(root, "socket"); fs.mkdirSync(socket, { mode: 0o700 });
  const listenPort = await port();
  let running = false, startupAttempted = false;
  const clients = new Set();
  async function connect(user = admin, password, transport = "socket") {
    if (![admin, target, "synthetic_unprivileged", "synthetic_privileged", "synthetic_lane_admin", "synthetic_other_grantor"].includes(user) || !["socket", "tls"].includes(transport)) failed("local_client_target");
    const client = new Client({ host: transport === "tls" ? "127.0.0.1" : socket, port: listenPort, user,
      password: password ?? "", database: "postgres", application_name: "native_broker_synthetic_control",
      connectionTimeoutMillis: 3000, statement_timeout: 6000, query_timeout: 7000,
      ...(transport === "tls" ? { ssl: { rejectUnauthorized: true, ca: fs.readFileSync(cert, "utf8") } } : {}) });
    client.on("error", () => undefined); clients.add(client);
    try { await client.connect(); return client; } catch { await client.end().catch(() => undefined); clients.delete(client); failed("local_authentication_denied"); }
  }
  async function stop() {
    for (const client of clients) await client.end().catch(() => undefined);
    clients.clear();
    if (startupAttempted && !running && !fs.existsSync(path.join(data, "postmaster.pid"))) await new Promise(resolve => setTimeout(resolve, 100));
    if (running || fs.existsSync(path.join(data, "postmaster.pid"))) {
      command(path.join(pgRoot, "bin/pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]); running = false;
    }
    startupAttempted = false;
    if (fs.existsSync(path.join(data, "postmaster.pid"))) failed("local_cluster_stop");
  }
  try {
    command("/usr/bin/openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-days", "1", "-keyout", key, "-out", cert]);
    fs.chmodSync(key, 0o600);
    command(path.join(pgRoot, "bin/initdb"), ["-D", data, "-U", admin, "--auth-local=trust", "--auth-host=reject", "--no-locale"]);
    fs.appendFileSync(path.join(data, "postgresql.conf"), `
listen_addresses='127.0.0.1'
port=${listenPort}
unix_socket_directories='${socket}'
unix_socket_permissions=0700
ssl=on
ssl_cert_file='${cert}'
ssl_key_file='${key}'
shared_preload_libraries='pg_stat_statements,auto_explain,${auditRoot}/pgaudit,${supaRoot}/supautils'
supautils.privileged_role='synthetic_privileged'
supautils.superuser='${admin}'
supautils.privileged_role_allowed_configs='${expandedOperator
  ? "log_statement,log_min_error_statement,log_parameter_max_length,log_parameter_max_length_on_error,log_min_duration_statement,log_min_duration_sample,log_transaction_sample_rate,log_duration,log_lock_waits,debug_print_parse,debug_print_rewritten,debug_print_plan,track_activities,pg_stat_statements.*,pgaudit.log,pgaudit.log_parameter,pgaudit.log_statement,pgaudit.log_client,auto_explain.log_min_duration"
  : "log_statement,log_min_error_statement,log_parameter_max_length,pg_stat_statements.*,pgaudit.log,pgaudit.log_statement"}'
log_destination='stderr,csvlog'
logging_collector=on
log_filename='qualification.log'
log_statement='ddl'
log_min_error_statement='error'
log_error_verbosity='default'
log_parameter_max_length=-1
log_parameter_max_length_on_error=0
log_min_duration_statement=-1
log_min_duration_sample=-1
log_transaction_sample_rate=0
log_line_prefix='%m [%p] %u@%d %e '
password_encryption='scram-sha-256'
pg_stat_statements.track='top'
pg_stat_statements.track_utility=on
pg_stat_statements.save=on
pgaudit.log='none'
pgaudit.log_parameter=off
`, { mode: 0o600 });
    fs.writeFileSync(path.join(data, "pg_hba.conf"), `local all ${admin},synthetic_unprivileged,synthetic_privileged,synthetic_lane_admin,synthetic_other_grantor trust
local all all scram-sha-256
hostssl all ${admin},synthetic_unprivileged,synthetic_privileged,synthetic_lane_admin,synthetic_other_grantor 127.0.0.1/32 trust
hostssl all all 127.0.0.1/32 scram-sha-256
host all all 0.0.0.0/0 reject
host all all ::/0 reject
`, { mode: 0o600 });
    startupAttempted = true;
    command(path.join(pgRoot, "bin/pg_ctl"), ["-D", data, "-l", log, "-w", "start"]); running = true;
    const control = await connect();
    await control.query(`CREATE EXTENSION pg_stat_statements;
CREATE ROLE ${capability} NOLOGIN;
CREATE ROLE synthetic_unprivileged LOGIN;
CREATE ROLE synthetic_privileged LOGIN;
CREATE ROLE synthetic_other_grantor LOGIN;
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
CREATE TABLE private.square_account_configuration (broker_login name,enrollment_login name,webhook_login name,surface_enabled boolean,blocked boolean);
CREATE TABLE private.square_remote_sandbox_binding (broker_login name,enroller_login name,webhook_login name,runtime_login name,enabled boolean);
CREATE TABLE private.square_gcp_callback_binding (broker_login name,enabled boolean);`);
    if (expandedOperator) await control.query(`CREATE ROLE synthetic_lane_admin LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOCREATEDB NOREPLICATION;
GRANT synthetic_privileged,pg_signal_backend,pg_read_all_settings TO synthetic_lane_admin;
GRANT ${capability} TO synthetic_lane_admin WITH ADMIN TRUE;
GRANT USAGE ON SCHEMA private TO synthetic_lane_admin;
GRANT SELECT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA private TO synthetic_lane_admin;`);
    const systemId = (await control.query("SELECT system_identifier::text AS value FROM pg_control_system()")).rows[0].value;
    const databaseOid = (await control.query("SELECT oid::text AS value FROM pg_database WHERE datname=current_database()")).rows[0].value;
    const logs = [log, path.join(data, "log/qualification.log"), path.join(data, "log/qualification.csv")];
    const stats = [path.join(data, "pg_stat_tmp/pgss_query_texts.stat"), path.join(data, "pg_stat/pg_stat_statements.stat")];
    return { root, data, socket, port: listenPort, cert, control, connect, stop, versions, systemId, databaseOid, logs, stats,
      logOffsets: () => logs.map(file => fs.existsSync(file) ? fs.statSync(file).size : 0),
      logBytes: offsets => Buffer.concat(logs.map((file, i) => fs.existsSync(file) ? fs.readFileSync(file).subarray(offsets[i]) : Buffer.alloc(0))),
      statBytes: () => Buffer.concat(stats.map(file => fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0))) };
  } catch { await stop(); failed("fixture_bootstrap"); }
}
module.exports = { createFixture, failed, command, hash, env, pgRoot, admin, target, capability };
