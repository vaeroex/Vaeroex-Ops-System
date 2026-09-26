"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Offline native catalog qualification CLI. */
// Creates only a private local PostgreSQL cluster. It accepts no DSN, password,
// network endpoint, hosted identity, or deployment input.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { Client } = require("pg");

if (process.argv.length !== 2 || process.getuid?.() === 0) {
  process.stdout.write('{"outcome":"local_inputs_rejected"}\n');
  process.exit(2);
}

const { pgRoot } = require("./fixture.cjs");
const repository = path.resolve(__dirname, "../../..");
const foundationName = "20260902191323_integration_production_runtime_foundation.sql";
const overlayName = "20260902191324_square_production_runtime_overlay.sql";
const internalName = "20260902191325_square_production_internal_pilot_runtime.sql";
const pins = Object.freeze({
  foundation: "f8598ca685c795ad56bfdb7a29a1ded3da1c096d42ffb62ea4e123271db54c6d",
  overlay: "2cc43a9313d056e58b75143f032f347cb0972f45cc1edbd484f6b1fb0574661f",
  internal: "ff2182044f28d6901f1582db3d31ef20d027a1e4590f0b295a7a64a1ad4c1325",
  preFoundationLedger: "sha256:db7c39a62dce07ac3d21a78653a6d4a905f399d00ea1a4dce452ed4018958060",
});
const hash = source => crypto.createHash("sha256").update(source).digest("hex");
let stage = "source_manifest", root, socketRoot, running = false, terminating = false, assertions = 0;
let customerContract;
const check = (value, name) => { assertions++; if (!value) { stage = name; throw new Error("catalog_qualification_failed"); } };
const contractStages = new Set([
  "begin", "closed_authority", "managed_catalog_fence", "ledger_phase", "relations", "foundation_schema", "overlay_schema",
  "baseline_triggers", "baseline_function_abi", "internal_relations", "internal_schema",
  "internal_triggers", "internal_functions", "authority"
]);

const baseEnv = Object.freeze({ PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C", PSQL_HISTORY: "/dev/null",
  PGPASSFILE: "/dev/null", PGSERVICEFILE: "/dev/null", PGSYSCONFDIR: "/nonexistent" });
function run(executable, args, timeout = 30000) {
  const result = spawnSync(executable, args, { env: { ...baseEnv, ...(root ? { TMPDIR: root } : {}) }, encoding: "utf8",
    timeout, maxBuffer: 8 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("catalog_qualification_failed");
  return result;
}
function exactLocalFile(value, expectedName) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\u0000-\u0020\u007f'\\]/.test(value) ||
      path.basename(value) !== expectedName) throw new Error("catalog_qualification_failed");
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isFile()) throw new Error("catalog_qualification_failed");
  return resolved;
}

const migrations = path.join(repository, "supabase/migrations");
const foundation = exactLocalFile(path.join(migrations, foundationName), foundationName);
const overlay = exactLocalFile(path.join(migrations, overlayName), overlayName);
const foundationSource = fs.readFileSync(foundation);
const overlaySource = fs.readFileSync(overlay);
check(hash(foundationSource) === pins.foundation && hash(overlaySource) === pins.overlay, "baseline_source_pin");
const versions = fs.readdirSync(migrations).filter(name => /^\d+_.+\.sql$/.test(name))
  .map(name => name.split("_", 1)[0]).filter(version => version <= "20260902191322").sort();
check(versions.length === 101 && versions.every(version => /^\d{12,20}$/.test(version)), "pre_foundation_ledger_shape");
check(`sha256:${crypto.createHash("sha256").update(versions.map(version => `${version.length}:${version}`).join(""))
  .digest("hex")}` === pins.preFoundationLedger, "pre_foundation_ledger_pin");

let internal = null;
const repositoryInternal = path.join(migrations, internalName);
if (fs.existsSync(repositoryInternal)) internal = exactLocalFile(repositoryInternal, internalName);
if (process.env.VAEROEX_PRODUCTION_INTERNAL_RUNTIME_MIGRATION !== undefined) {
  const supplied = exactLocalFile(process.env.VAEROEX_PRODUCTION_INTERNAL_RUNTIME_MIGRATION, internalName);
  if (internal && supplied !== internal) throw new Error("catalog_qualification_failed");
  internal = supplied;
}
const internalSource = internal ? fs.readFileSync(internal) : null;
if (internalSource) check(hash(internalSource) === pins.internal, "internal_source_pin");

const data = () => path.join(root, "data");
const socket = () => socketRoot;
const port = "55432";
const database = "production_catalog_runtime";
const psql = (args, timeout) => run(path.join(pgRoot, "bin/psql"), ["-X", "-v", "ON_ERROR_STOP=1",
  "-h", socket(), "-p", port, "-U", "postgres", "-d", database, ...args], timeout);
function startupPacket(user, applicationName) {
  const fields = ["user", user, "database", database, "application_name", applicationName];
  const body = Buffer.concat([Buffer.from([0, 3, 0, 0]),
    ...fields.map(value => Buffer.concat([Buffer.from(value), Buffer.from([0])])), Buffer.from([0])]);
  const packet = Buffer.alloc(4 + body.length);
  packet.writeInt32BE(packet.length, 0);
  body.copy(packet, 4);
  return packet;
}
function passwordPacket(payload) {
  const packet = Buffer.alloc(5 + payload.length);
  packet[0] = "p".charCodeAt(0);
  packet.writeInt32BE(4 + payload.length, 1);
  payload.copy(packet, 5);
  return packet;
}
async function nextProtocolMessage(connection, state) {
  for (;;) {
    if (state.buffer.length >= 5) {
      const length = state.buffer.readInt32BE(1);
      if (length >= 4 && state.buffer.length >= 1 + length) {
        const message = { type: String.fromCharCode(state.buffer[0]),
          payload: state.buffer.subarray(5, 1 + length) };
        state.buffer = state.buffer.subarray(1 + length);
        return message;
      }
    }
    const chunk = await new Promise((resolve, reject) => {
      const cleanup = () => { connection.off("data", onData); connection.off("error", onError); connection.off("close", onClose); };
      const onData = value => { cleanup(); resolve(value); };
      const onError = error => { cleanup(); reject(error); };
      const onClose = () => { cleanup(); reject(new Error("protocol_closed")); };
      connection.once("data", onData); connection.once("error", onError); connection.once("close", onClose);
    });
    state.buffer = Buffer.concat([state.buffer, chunk]);
  }
}
async function pauseScramAuthentication(user, applicationName) {
  const connection = net.createConnection({ path: path.join(socket(), `.s.PGSQL.${port}`) });
  connection.setTimeout(5000, () => connection.destroy(new Error("protocol_timeout")));
  await new Promise((resolve, reject) => { connection.once("connect", resolve); connection.once("error", reject); });
  const state = { buffer: Buffer.alloc(0) };
  connection.write(startupPacket(user, applicationName));
  let message;
  do { message = await nextProtocolMessage(connection, state); } while (message.type !== "R");
  check(message.payload.readInt32BE(0) === 10, "paused_scram_server_requests_sasl");
  const clientFirstBare = "n=*,r=0123456789abcdef0123456789abcdef";
  const initial = Buffer.from(`n,,${clientFirstBare}`);
  const mechanism = Buffer.from("SCRAM-SHA-256\0");
  const initialLength = Buffer.alloc(4); initialLength.writeInt32BE(initial.length, 0);
  connection.write(passwordPacket(Buffer.concat([mechanism, initialLength, initial])));
  do { message = await nextProtocolMessage(connection, state); } while (message.type !== "R");
  check(message.payload.readInt32BE(0) === 11, "paused_scram_server_challenge_observed");
  return { connection, state, clientFirstBare, serverFirst: message.payload.subarray(4).toString("utf8") };
}
function scramAttributes(value) {
  const attributes = new Map();
  for (const component of value.split(",")) {
    if (component.length < 3 || component[1] !== "=" || attributes.has(component[0]))
      throw new Error("catalog_qualification_failed");
    attributes.set(component[0], component.slice(2));
  }
  return attributes;
}
function errorSqlstate(payload) {
  for (let offset = 0; offset < payload.length && payload[offset] !== 0;) {
    const field = String.fromCharCode(payload[offset++]);
    const end = payload.indexOf(0, offset);
    if (end < 0) break;
    const value = payload.subarray(offset, end).toString("utf8");
    if (field === "C") return value;
    offset = end + 1;
  }
  return "unknown";
}
async function finishPausedScram(session, password) {
  const attributes = scramAttributes(session.serverFirst);
  const nonce = attributes.get("r"), salt = attributes.get("s"), rounds = Number(attributes.get("i"));
  check(typeof nonce === "string" && nonce.startsWith("0123456789abcdef0123456789abcdef") &&
    typeof salt === "string" && Number.isInteger(rounds) && rounds >= 4096, "paused_scram_challenge_shape");
  const finalWithoutProof = `c=biws,r=${nonce}`;
  const saltedPassword = crypto.pbkdf2Sync(password, Buffer.from(salt, "base64"), rounds, 32, "sha256");
  const clientKey = crypto.createHmac("sha256", saltedPassword).update("Client Key").digest();
  const storedKey = crypto.createHash("sha256").update(clientKey).digest();
  const authentication = `${session.clientFirstBare},${session.serverFirst},${finalWithoutProof}`;
  const signature = crypto.createHmac("sha256", storedKey).update(authentication).digest();
  const proof = Buffer.alloc(clientKey.length);
  for (let index = 0; index < proof.length; index++) proof[index] = clientKey[index] ^ signature[index];
  session.connection.write(passwordPacket(Buffer.from(`${finalWithoutProof},p=${proof.toString("base64")}`)));
  let ready = false, sqlstate = "none", saslFinal = false;
  for (let count = 0; count < 16 && !ready && sqlstate === "none"; count++) {
    const message = await nextProtocolMessage(session.connection, session.state);
    if (message.type === "R") saslFinal ||= message.payload.readInt32BE(0) === 12;
    else if (message.type === "E") sqlstate = errorSqlstate(message.payload);
    else if (message.type === "Z") ready = true;
  }
  saltedPassword.fill(0); clientKey.fill(0); storedKey.fill(0); signature.fill(0); proof.fill(0);
  return { ready, sqlstate, saslFinal };
}
const psqlSource = (source, timeout) => {
  const result = spawnSync(path.join(pgRoot, "bin/psql"), ["-X", "-v", "ON_ERROR_STOP=1",
    "-h", socket(), "-p", port, "-U", "postgres", "-d", database, "-f", "-"], {
    env: { ...baseEnv, TMPDIR: root }, input: source, encoding: "utf8", timeout, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("catalog_qualification_failed");
  return result;
};
function compile(output, sourcePin) {
  const include = path.join(pgRoot, "include"), library = path.join(pgRoot, "lib");
  const source = path.join(__dirname, "production-catalog-qualify.c");
  const flags = ["-std=c11", "-O0", "-Wall", "-Wextra", "-Werror", "-pthread", `-I${include}`, `-L${library}`,
    `-Wl,-rpath,${library}`, "-DVAEROEX_SYNTHETIC_ONLY", "-DVAEROEX_MANAGED_PROFILE_TEST",
    "-DVAEROEX_PRODUCTION_OAUTH", `-DVAEROEX_CATALOG_SOCKET_PATH=${JSON.stringify(socket())}`,
    ...(sourcePin ? [`-DVAEROEX_PRODUCTION_INTERNAL_RUNTIME_SOURCE_SHA256=${JSON.stringify(sourcePin)}`] : []),
    ...(sourcePin && customerContract ? [`-DVAEROEX_PRODUCTION_CUSTOMER_CONTRACT=${JSON.stringify(customerContract.sql)}`] : []),
    source, "-lpq", "-o", output];
  run("/usr/bin/cc", flags);
}
function qualify(binary, expectedStage = null) {
  const result = spawnSync(binary, [socket(), port, database, "postgres"], {
    env: { ...baseEnv, TMPDIR: root }, encoding: "utf8", timeout: 30000, maxBuffer: 4096,
  });
  if (expectedStage === null) {
    if (!result.error && result.status === 3 && result.stdout === "") {
      const match = /^production_catalog_contract_invalid:([a-z_]+)\n?$/.exec(result.stderr);
      if (match && contractStages.has(match[1])) stage = `catalog_contract_positive_${match[1]}`;
    }
    check(!result.error && result.status === 0 && result.stdout.trim() === "production_catalog_contract_valid" &&
      result.stderr === "", stage.startsWith("catalog_contract_positive_") ? stage : "catalog_contract_positive");
  } else {
    check(!result.error && result.status === 3 && result.stdout === "" &&
      result.stderr.trim() === `production_catalog_contract_invalid:${expectedStage}`, `${expectedStage}_substitution_rejected`);
  }
}
function qualifyManagedFence(binary) {
  const result = spawnSync(binary, [socket(), port, database, "synthetic_hosted_operator", "managed-fence"], {
    env: { ...baseEnv, TMPDIR: root }, encoding: "utf8", timeout: 30000, maxBuffer: 4096,
  });
  check(!result.error && result.status === 0 && result.stdout.trim() === "production_managed_catalog_fence_valid" &&
    result.stderr === "", "managed_nonowner_catalog_fence_positive");
}
function qualifyManagedApplicationLockFence(binary) {
  const result = spawnSync(binary, [socket(), port, database, "postgres", "managed-application-lock-fence"], {
    env: { ...baseEnv, TMPDIR: root }, encoding: "utf8", timeout: 30000, maxBuffer: 4096,
  });
  check(!result.error, "managed_application_lock_fence_process");
  check(result.status === 0, "managed_application_lock_fence_status");
  check(result.stdout.trim() === "production_managed_application_lock_fence_valid",
    "managed_application_lock_fence_label");
  check(result.stderr === "", "managed_application_lock_fence_stderr");
}
function qualifyManagedPasswordFence(binary) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, [socket(), port, database, "postgres", "managed-password-fence"], {
      env: { ...baseEnv, TMPDIR: root }, stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "", finished = false;
    const timer = setTimeout(() => { if (!finished) child.kill("SIGKILL"); }, 20000);
    child.stdout.on("data", bytes => { if (stdout.length + bytes.length <= 4096) stdout += bytes.toString("utf8"); });
    child.stderr.on("data", bytes => { if (stderr.length + bytes.length <= 4096) stderr += bytes.toString("utf8"); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => {
      finished = true; clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}
function managedInterruptedRecoveryResult(binary) {
  return spawnSync(binary, [socket(), port, database, "postgres", "managed-interrupted-recovery"], {
    env: { ...baseEnv, TMPDIR: root }, encoding: "utf8", timeout: 30000, maxBuffer: 4096,
  });
}
function qualifyManagedInterruptedRecovery(binary) {
  const result = managedInterruptedRecoveryResult(binary);
  check(!result.error && result.status === 0 && result.signal === null &&
    result.stdout === "production_managed_interrupted_recovery_valid\n" && result.stderr === "",
  "managed_capability_only_commit_recovery_succeeds");
}
function qualifyManagedClosedFence(binary) {
  const result = spawnSync(binary, [socket(), port, database, "postgres", "managed-closed-fence"], {
    env: { ...baseEnv, TMPDIR: root }, encoding: "utf8", timeout: 30000, maxBuffer: 4096,
  });
  check(!result.error && result.status === 0 && result.signal === null &&
    result.stdout === "production_managed_closed_fence_valid\n" && result.stderr === "",
  "managed_already_closed_fence_succeeds");
}
function qualifyManagedTransitionWait(binary) {
  const result = spawnSync(binary, [socket(), port, database, "postgres", "managed-transition-wait"], {
    env: { ...baseEnv, TMPDIR: root }, encoding: "utf8", timeout: 30000, maxBuffer: 4096,
  });
  check(!result.error && result.status === 0 && result.signal === null &&
    result.stdout === "production_managed_transition_wait_valid\nproduction_managed_active_entry_overtaken_valid\n" && result.stderr === "",
  "managed_transition_wait_and_closed_reconciliation_succeed");
  check(result.stdout.includes("production_managed_active_entry_overtaken_valid\n"),
    "managed_active_entry_overtaken_by_recovery_fence_reconciles_exact_closure");
}
function qualifyManagedControlTimeout(binary) {
  const result = spawnSync(binary, [socket(), port, database, "postgres", "managed-control-timeout"], {
    env: { ...baseEnv, TMPDIR: root }, encoding: "utf8", timeout: 10000, maxBuffer: 4096,
  });
  check(!result.error && result.status === 0 && result.signal === null &&
    result.stdout === "production_managed_control_timeout_valid\n" && result.stderr === "",
  "managed_control_socket_deadline_interrupts_blocking_drain");
}
function rejectManagedInterruptedRecovery(binary, label) {
  const result = managedInterruptedRecoveryResult(binary);
  const rejectedStage = /^production_catalog_contract_invalid:(managed_recovery_(?:transition_contract|transition_entry_role))\n?$/.exec(
    result.stderr ?? "");
  check(!result.error && result.status === 3 && result.signal === null && result.stdout === "" && rejectedStage,
    `managed_recovery_rejects_${label}`);
}
function cleanup() {
  if (root && (running || fs.existsSync(path.join(data(), "postmaster.pid")))) {
    const result = spawnSync(path.join(pgRoot, "bin/pg_ctl"), ["-D", data(), "-m", "fast", "-w", "stop"],
      { env: baseEnv, encoding: "utf8", timeout: 30000, maxBuffer: 4096 });
    if (result.error || result.status !== 0) throw new Error("catalog_cleanup_failed");
    running = false;
  }
  if (root) {
    const temporary = fs.realpathSync(os.tmpdir());
    if (path.dirname(root) !== temporary || !path.basename(root).startsWith("vpc-"))
      throw new Error("catalog_cleanup_failed");
    fs.rmSync(root, { recursive: true, force: true });
    root = undefined;
  }
  if (socketRoot) {
    const shortTemporary = fs.realpathSync("/tmp");
    if (path.dirname(socketRoot) !== shortTemporary || !path.basename(socketRoot).startsWith("vpcs-"))
      throw new Error("catalog_cleanup_failed");
    fs.rmSync(socketRoot, { recursive: true, force: true });
    socketRoot = undefined;
  }
}
function terminate(signal) {
  if (terminating) return;
  terminating = true;
  try { cleanup(); }
  catch {
    process.stdout.write('{"outcome":"failed","stage":"catalog_cleanup"}\n');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify({ outcome: "cancelled", stage: "signal_cleanup", signal }) + "\n");
  process.exit(signal === "SIGINT" ? 130 : 143);
}
process.once("SIGINT", () => terminate("SIGINT"));
process.once("SIGTERM", () => terminate("SIGTERM"));

async function main() {
  const customerModule = await import("../customer-source.mjs");
  customerContract = customerModule.customerNativeContract();
  stage = "cluster_bootstrap";
  // Keep the separately owned socket directory below Darwin's sockaddr_un
  // bound while compiling that exact path into the local-only C harness.
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "vpc-")));
  fs.chmodSync(root, 0o700);
  socketRoot = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "vpcs-")));
  fs.chmodSync(socketRoot, 0o700);
  check(Buffer.byteLength(path.join(socket(), `.s.PGSQL.${port}`)) < 104, "socket_path_bound");
  run(path.join(pgRoot, "bin/initdb"), ["-D", data(), "-U", "postgres", "--auth-local=trust", "--auth-host=reject", "--no-locale"]);
  fs.appendFileSync(path.join(data(), "postgresql.conf"), `
listen_addresses=''
port=${port}
unix_socket_directories='${socket()}'
unix_socket_permissions=0700
password_encryption='scram-sha-256'
`, { mode: 0o600 });
  fs.writeFileSync(path.join(data(), "pg_hba.conf"),
    "local all postgres,synthetic_hosted_operator,synthetic_application_login trust\n" +
    "local all square_production_oauth scram-sha-256\nlocal all all reject\n", { mode: 0o600 });
  run(path.join(pgRoot, "bin/pg_ctl"), ["-D", data(), "-l", path.join(root, "postgres.log"), "-w", "start"]);
  running = true;
  run(path.join(pgRoot, "bin/createdb"), ["-h", socket(), "-p", port, "-U", "postgres", database]);
  const seed = versions.map(version => `('${version}')`).join(",");
  psql(["-c", `CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE ROLE synthetic_hosted_operator LOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS;
    CREATE ROLE synthetic_application_login LOGIN NOCREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS;
    CREATE SCHEMA private; REVOKE ALL ON SCHEMA private FROM PUBLIC;
    GRANT USAGE ON SCHEMA private TO synthetic_application_login;
    CREATE SCHEMA extensions; CREATE EXTENSION pgcrypto WITH SCHEMA extensions; REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
    CREATE DOMAIN extensions.vector AS text;
    CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $function$
      BEGIN NEW.updated_at=pg_catalog.now(); RETURN NEW; END
    $function$;
    CREATE TABLE public.production_catalog_legacy_update_fixture(
      id integer PRIMARY KEY, updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
    );
    CREATE TRIGGER set_production_catalog_legacy_update_fixture_updated_at
      BEFORE UPDATE ON public.production_catalog_legacy_update_fixture
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
    CREATE FUNCTION public.match_business_memory_chunks(
      target_workspace_id uuid, query_embedding extensions.vector,
      match_count integer DEFAULT 8, min_similarity double precision DEFAULT 0.1
    ) RETURNS TABLE(
      id uuid, workspace_id uuid, source_type text, source_id uuid, source_file_id uuid,
      source_title text, source_excerpt text, summary text, chunk_index integer,
      source_metadata jsonb, source_quality text, confidence_score integer,
      indexed_at timestamptz, similarity double precision
    ) LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,extensions
      AS $function$ SELECT NULL::uuid,NULL::uuid,NULL::text,NULL::uuid,NULL::uuid,
        NULL::text,NULL::text,NULL::text,NULL::integer,NULL::jsonb,NULL::text,
        NULL::integer,NULL::timestamptz,NULL::double precision WHERE false $function$;
    GRANT EXECUTE ON FUNCTION public.match_business_memory_chunks(
      uuid,extensions.vector,integer,double precision) TO authenticated;
    CREATE TABLE public.business_entities(
      id uuid NOT NULL, workspace_id uuid NOT NULL, status text NOT NULL DEFAULT 'active',
      PRIMARY KEY(id), UNIQUE(workspace_id,id)
    );
    CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
    INSERT INTO supabase_migrations.schema_migrations(version) VALUES ${seed};`]);

  stage = "overlay_migrations";
  psqlSource(foundationSource, 60000);
  psql(["-c", "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20260902191323')"]);
  psqlSource(overlaySource, 60000);
  psql(["-c", "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20260902191324')"]);
  const overlayBinary = path.join(root, "catalog-overlay");
  compile(overlayBinary, null);
  psql(["-c", `ALTER TABLE private.integration_production_platform_bindings OWNER TO synthetic_hosted_operator;
    GRANT USAGE ON SCHEMA private TO synthetic_hosted_operator`]);
  const managedPrivilegeShape = psql(["-At", "-c", `SELECT
    (SELECT relowner<> 'synthetic_hosted_operator'::regrole FROM pg_class WHERE oid='pg_catalog.pg_proc'::regclass)
    AND (SELECT relowner='synthetic_hosted_operator'::regrole FROM pg_class
      WHERE oid='private.integration_production_platform_bindings'::regclass)
    AND NOT has_table_privilege('synthetic_hosted_operator','pg_catalog.pg_proc','MAINTAIN')
    AND NOT has_table_privilege('synthetic_hosted_operator','pg_catalog.pg_proc','UPDATE')
    AND NOT has_table_privilege('synthetic_hosted_operator','pg_catalog.pg_proc','DELETE')
    AND NOT has_table_privilege('synthetic_hosted_operator','pg_catalog.pg_proc','TRUNCATE')`]).stdout.trim();
  check(managedPrivilegeShape === "t", "managed_operator_has_production_shaped_catalog_permissions");
  const applicationFence = spawnSync(path.join(pgRoot, "bin/psql"), ["-X", "-qAt", "-v", "ON_ERROR_STOP=0",
    "-h", socket(), "-p", port, "-U", "synthetic_application_login", "-d", database,
    "-c", "BEGIN", "-c", "LOCK TABLE private.integration_production_platform_bindings IN SHARE ROW EXCLUSIVE MODE",
    "-c", "\\echo :SQLSTATE", "-c", "ROLLBACK"], {
    env: { ...baseEnv, TMPDIR: root }, encoding: "utf8", timeout: 30000, maxBuffer: 4096,
    stdio: ["ignore", "pipe", "ignore"],
  });
  check(!applicationFence.error, "application_fence_process_completed");
  check(applicationFence.status === 0 && applicationFence.stdout === "42501\n" && applicationFence.stderr === null,
    "application_fence_denied_for_relation_privilege");
  stage = "managed_target_lock_not_publicly_blockable";
  const advisoryBlocker = new Client({ host: socket(), port: Number(port), database,
    user: "synthetic_application_login", password: "", ssl: false,
    application_name: "synthetic_public_target_lock_holder", connectionTimeoutMillis: 3000,
    statement_timeout: 5000, query_timeout: 6000 });
  try {
    await advisoryBlocker.connect();
    await advisoryBlocker.query("BEGIN");
    await advisoryBlocker.query(
      "SELECT pg_advisory_xact_lock(1936744818, hashtext('square_production_oauth'))");
    qualifyManagedFence(overlayBinary);
  } finally {
    await advisoryBlocker.query("ROLLBACK").catch(() => undefined);
    await advisoryBlocker.end().catch(() => undefined);
  }
  psql(["-c", `ALTER TABLE private.integration_production_platform_bindings OWNER TO postgres;
    REVOKE USAGE ON SCHEMA private FROM synthetic_hosted_operator`]);
  qualify(overlayBinary);

  stage = "overlay_trigger_substitution";
  psql(["-c", `DROP TRIGGER square_production_binding_authority ON private.square_production_runtime_bindings;
    CREATE TRIGGER square_production_binding_authority BEFORE INSERT ON private.square_production_runtime_bindings
    FOR EACH ROW WHEN (false) EXECUTE FUNCTION private.validate_square_production_runtime_binding_v1();`]);
  qualify(overlayBinary, "baseline_triggers");
  psql(["-c", `DROP TRIGGER square_production_binding_authority ON private.square_production_runtime_bindings;
    CREATE TRIGGER square_production_binding_authority BEFORE INSERT ON private.square_production_runtime_bindings
    FOR EACH ROW EXECUTE FUNCTION private.validate_square_production_runtime_binding_v1();`]);
  qualify(overlayBinary);

  let internalRuntime = "source_absent";
  let internalSourceAtOverlay = "source_absent";
  let baselineSourceAtInternal = "not_applicable";
  if (internal) {
    stage = "internal_source_overlay_phase";
    const internalBinary = path.join(root, "catalog-internal");
    compile(internalBinary, pins.internal);
    qualify(internalBinary);
    internalSourceAtOverlay = "exact_103_qualified";
    stage = "internal_migration";
    psqlSource(internalSource, 120000);
    psql(["-c", "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20260902191325')"]);
    stage = "source_phase_boundary";
    qualify(overlayBinary, "closed_authority");
    baselineSourceAtInternal = "exact_104_rejected";
    qualify(internalBinary);
    stage = "managed_password_locker_fence";
    const originalPassword = "synthetic-managed-password-locker-original";
    psql(["-c", `CREATE ROLE square_production_oauth LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        PASSWORD '${originalPassword}';
      GRANT square_production_oauth_authority TO square_production_oauth
        WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`]);
    stage = "managed_recovery_transition_matrix";
    const rejectedTransitions = Object.freeze([
      [true, true, true, "active"],
      [true, false, true, "login_noinherit_inheriting_membership"],
      [true, false, false, "login_noinherit_noninheriting_membership"],
      [false, true, true, "nologin_inherit_inheriting_membership"],
      [false, true, false, "nologin_inherit_noninheriting_membership"],
      [false, false, true, "nologin_noinherit_inheriting_membership"],
      [false, false, false, "closed"],
    ]);
    for (const [login, inherit, membershipInherits, label] of rejectedTransitions) {
      psql(["-c", `ALTER ROLE square_production_oauth ${login ? "LOGIN" : "NOLOGIN"} ${inherit ? "INHERIT" : "NOINHERIT"};
        GRANT square_production_oauth_authority TO square_production_oauth
          WITH ADMIN FALSE, INHERIT ${membershipInherits ? "TRUE" : "FALSE"}, SET FALSE`]);
      rejectManagedInterruptedRecovery(internalBinary, label);
    }
    psql(["-c", `ALTER ROLE square_production_oauth LOGIN INHERIT;
      REVOKE square_production_oauth_authority FROM square_production_oauth`]);
    rejectManagedInterruptedRecovery(internalBinary, "missing_capability_membership");
    psql(["-c", `GRANT square_production_oauth_authority TO square_production_oauth
      WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`]);
    stage = "managed_application_lock_grant";
    psql(["-c", `GRANT USAGE ON SCHEMA private TO square_production_oauth;
      GRANT UPDATE ON private.square_production_internal_permits TO square_production_oauth`]);
    const applicationLocker = new Client({ host: socket(), port: Number(port), database,
      user: "square_production_oauth", password: originalPassword, ssl: false,
      application_name: "synthetic_managed_application_locker", connectionTimeoutMillis: 3000,
      statement_timeout: 6000, query_timeout: 7000 });
    applicationLocker.on("error", () => undefined);
    stage = "managed_application_lock_connect";
    await applicationLocker.connect();
    stage = "managed_application_lock_begin";
    const applicationPid = (await applicationLocker.query("SELECT pg_backend_pid() pid")).rows[0].pid;
    await applicationLocker.query("BEGIN");
    stage = "managed_application_lock_acquire";
    await applicationLocker.query("LOCK TABLE private.square_production_internal_permits IN ROW EXCLUSIVE MODE");
    stage = "managed_application_lock_observe";
    check(Number.isInteger(applicationPid) && applicationPid > 0, "managed_application_pid_shape");
    const applicationLockHeld = psql(["-At", "-c", `SELECT EXISTS(
      SELECT FROM pg_locks WHERE pid=${applicationPid} AND granted AND
      relation='private.square_production_internal_permits'::regclass AND mode='RowExclusiveLock')`]).stdout.trim();
    check(applicationLockHeld === "t", "managed_application_row_exclusive_lock_observed");
    stage = "managed_application_lock_native_fence";
    qualifyManagedApplicationLockFence(internalBinary);
    let applicationSessionClosed = false;
    try { await applicationLocker.query("SELECT 1"); }
    catch { applicationSessionClosed = true; }
    await applicationLocker.end().catch(() => undefined);
    check(applicationSessionClosed, "managed_application_locker_drained_before_share_lock");
    psql(["-c", `REVOKE UPDATE ON private.square_production_internal_permits FROM square_production_oauth;
      REVOKE USAGE ON SCHEMA private FROM square_production_oauth`]);
    const interruptedFence = psql(["-At", "-F", "|", "-c", `SELECT r.rolcanlogin,r.rolinherit,
      NOT m.inherit_option,NOT m.admin_option,NOT m.set_option
      FROM pg_roles r JOIN pg_auth_members m ON m.member=r.oid
      WHERE r.rolname='square_production_oauth'
        AND m.roleid='square_production_oauth_authority'::regrole`]).stdout.trim();
    check(interruptedFence === "t|t|t|t|t", "managed_capability_only_commit_state_observed");
    stage = "managed_capability_only_recovery";
    qualifyManagedInterruptedRecovery(internalBinary);
    const recoveredFence = psql(["-At", "-F", "|", "-c", `SELECT NOT r.rolcanlogin,NOT r.rolinherit,
      NOT m.inherit_option,NOT m.admin_option,NOT m.set_option,
      (SELECT count(*) FROM pg_stat_activity WHERE usename='square_production_oauth')
      FROM pg_roles r JOIN pg_auth_members m ON m.member=r.oid
      WHERE r.rolname='square_production_oauth'
        AND m.roleid='square_production_oauth_authority'::regrole`]).stdout.trim();
    check(recoveredFence === "t|t|t|t|t|0", "managed_capability_only_commit_recovers_exact_closed_state");
    stage = "managed_transition_wait";
    psql(["-c", `ALTER ROLE square_production_oauth LOGIN INHERIT;
      GRANT square_production_oauth_authority TO square_production_oauth
        WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`]);
    qualifyManagedTransitionWait(internalBinary);
    const transitionWaitClosed = psql(["-At", "-F", "|", "-c", `SELECT NOT r.rolcanlogin,NOT r.rolinherit,
      NOT m.inherit_option,NOT m.admin_option,NOT m.set_option,
      (SELECT count(*) FROM pg_stat_activity WHERE usename='square_production_oauth')
      FROM pg_roles r JOIN pg_auth_members m ON m.member=r.oid
      WHERE r.rolname='square_production_oauth'
        AND m.roleid='square_production_oauth_authority'::regrole`]).stdout.trim();
    check(transitionWaitClosed === "t|t|t|t|t|0", "managed_transition_wait_finishes_exact_closed_state");
    stage = "managed_control_socket_timeout";
    qualifyManagedControlTimeout(internalBinary);
    stage = "managed_already_closed_fence";
    qualifyManagedClosedFence(internalBinary);
    const preservedClosedFence = psql(["-At", "-F", "|", "-c", `SELECT NOT r.rolcanlogin,NOT r.rolinherit,
      NOT m.inherit_option,NOT m.admin_option,NOT m.set_option,
      (SELECT count(*) FROM pg_stat_activity WHERE usename='square_production_oauth')
      FROM pg_roles r JOIN pg_auth_members m ON m.member=r.oid
      WHERE r.rolname='square_production_oauth'
        AND m.roleid='square_production_oauth_authority'::regrole`]).stdout.trim();
    check(preservedClosedFence === "t|t|t|t|t|0", "managed_already_closed_fence_preserves_exact_state");
    psql(["-c", `ALTER ROLE square_production_oauth LOGIN INHERIT;
      GRANT square_production_oauth_authority TO square_production_oauth
        WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`]);
    stage = "managed_password_locker_fence";
    const pausedScram = await pauseScramAuthentication("square_production_oauth", "paused_scram_probe");
    const pausedActivity = psql(["-At", "-F", "|", "-c", `SELECT coalesce(usename,'<null>'),
      coalesce(application_name,'<null>'),backend_type,coalesce(state,'<null>'),coalesce(datname,'<null>')
      FROM pg_stat_activity WHERE application_name='paused_scram_probe'`]).stdout.trim();
    check(pausedActivity === "", "paused_scram_absent_from_activity_before_fence");
    const pausedRows = pausedActivity === "" ? [] : pausedActivity.split("|");
    process.stdout.write(JSON.stringify({ outcome: "paused_scram_catalog_observation",
      rowVisible: pausedRows.length === 5, userVisible: pausedRows[0] === "square_production_oauth",
      userNull: pausedRows[0] === "<null>", applicationVisible: pausedRows[1] === "paused_scram_probe",
      backendType: pausedRows[2] ?? null, stateNull: pausedRows[3] === "<null>",
      databaseVisible: pausedRows[4] === database }) + "\n");
    const verifierBefore = psql(["-At", "-c",
      "SELECT rolpassword FROM pg_authid WHERE rolname='square_production_oauth'"]).stdout.trim();
    const locker = new Client({ host: socket(), port: Number(port), database,
      user: "square_production_oauth", password: originalPassword, ssl: false,
      application_name: "synthetic_managed_password_locker", connectionTimeoutMillis: 3000,
      statement_timeout: 6000, query_timeout: 7000 });
    locker.on("error", () => undefined);
    await locker.connect();
    await locker.query("BEGIN");
    await locker.query("ALTER ROLE CURRENT_USER PASSWORD 'synthetic-uncommitted-password-locker'");
    let reconnectConnected = false, reconnectClosed = false;
    const fencePromise = qualifyManagedPasswordFence(internalBinary);
    const reconnectPromise = (async () => {
      await new Promise(resolve => setTimeout(resolve, 30));
      let reconnect;
      try {
        reconnect = new Client({ host: socket(), port: Number(port), database,
          user: "square_production_oauth", password: originalPassword, ssl: false,
          application_name: "synthetic_managed_password_reconnect", connectionTimeoutMillis: 3000,
          statement_timeout: 6000, query_timeout: 7000 });
        reconnect.on("error", () => undefined);
        await reconnect.connect(); reconnectConnected = true;
        await reconnect.query("BEGIN");
        await reconnect.query("ALTER ROLE CURRENT_USER PASSWORD 'synthetic-reconnect-password-locker'");
        await reconnect.query("SELECT pg_sleep(2)");
      } catch { reconnectClosed = true; }
      finally { await reconnect?.end().catch(() => undefined); }
    })();
    const fenceResult = await fencePromise;
    await reconnectPromise;
    await locker.end().catch(() => undefined);
    const pausedOutcome = await finishPausedScram(pausedScram, originalPassword);
    pausedScram.connection.destroy();
    const readback = psql(["-At", "-F", "|", "-c", `SELECT NOT r.rolcanlogin,NOT r.rolinherit,
      coalesce((SELECT bool_and(NOT m.inherit_option) FROM pg_auth_members m
        WHERE m.member=r.oid AND m.roleid='square_production_oauth_authority'::regrole),false),
      (SELECT count(*) FROM pg_stat_activity WHERE usename='square_production_oauth'),r.rolpassword
      FROM pg_authid r WHERE r.rolname='square_production_oauth'`]).stdout.trim().split("|");
    const fenceSucceeded = fenceResult.code === 0 && fenceResult.signal === null &&
      fenceResult.stdout === "production_managed_password_fence_valid\n" && fenceResult.stderr === "";
    const exactClosedState = readback.length === 5 && readback[0] === "t" && readback[1] === "t" &&
      readback[2] === "t" && readback[3] === "0" && readback[4] === verifierBefore;
    process.stdout.write(JSON.stringify({ outcome: "target_password_locker_observation",
      nativeFenceRejected: !fenceSucceeded, reconnectConnected, reconnectClosed,
      pausedScramCompleted: pausedOutcome.saslFinal, pausedScramReady: pausedOutcome.ready,
      pausedScramSqlstate: pausedOutcome.sqlstate,
      noLogin: readback[0] === "t", noInherit: readback[1] === "t",
      membershipFenced: readback[2] === "t", zeroSessions: readback[3] === "0",
      verifierUnchanged: readback[4] === verifierBefore }) + "\n");
    check(fenceSucceeded, "target_password_locker_native_fence_succeeds");
    check(readback[3] === "0", "target_password_locker_drained_before_nologin_transition");
    check(!reconnectConnected || reconnectClosed, "target_reconnect_cannot_hold_password_lock_through_fence");
    check(pausedOutcome.saslFinal && !pausedOutcome.ready && pausedOutcome.sqlstate === "28000",
      "paused_scram_rechecks_nologin_after_authentication");
    check(exactClosedState, "password_locker_rollback_and_exact_closed_state_confirmed");
    psql(["-c", `REVOKE square_production_oauth_authority FROM square_production_oauth;
      DROP ROLE square_production_oauth`]);
    const parentTriggers = psql(["-At", "-c", `SELECT trigger_record.tgname
      FROM pg_catalog.pg_trigger trigger_record
      JOIN pg_catalog.pg_constraint constraint_record ON constraint_record.oid=trigger_record.tgconstraint
      WHERE trigger_record.tgisinternal AND constraint_record.contype='f'
        AND constraint_record.conrelid='private.square_production_internal_permits'::regclass
        AND trigger_record.tgrelid='public.business_entities'::regclass
      ORDER BY trigger_record.tgname`]).stdout.trim().split("\n");
    check(parentTriggers.length === 2 && parentTriggers.every(name => /^RI_ConstraintTrigger_[A-Za-z0-9_]+$/.test(name)),
      "both_referenced_side_triggers_present");
    for (const name of parentTriggers) {
      psql(["-c", `ALTER TABLE public.business_entities DISABLE TRIGGER "${name}"`]);
      try { qualify(internalBinary, "internal_triggers"); }
      finally { psql(["-c", `ALTER TABLE public.business_entities ENABLE TRIGGER "${name}"`]); }
      qualify(internalBinary);
    }
    stage = "internal_trigger_substitution";
    psql(["-c", `DROP TRIGGER square_production_internal_permit_delete_guard ON private.square_production_internal_permits;
      CREATE TRIGGER square_production_internal_permit_delete_guard BEFORE DELETE ON private.square_production_internal_permits
      FOR EACH ROW WHEN (false) EXECUTE FUNCTION private.square_production_internal_reject_immutable_mutation_v1();`]);
    qualify(internalBinary, "internal_triggers");
    // Restore the deliberate substitution before qualifying the customer delta.
    psql(["-c", `DROP TRIGGER square_production_internal_permit_delete_guard ON private.square_production_internal_permits;
      CREATE TRIGGER square_production_internal_permit_delete_guard BEFORE DELETE ON private.square_production_internal_permits
      FOR EACH ROW EXECUTE FUNCTION private.square_production_internal_reject_immutable_mutation_v1();`]);
    stage = "customer_source_and_native_admission";
    psqlSource(fs.readFileSync(customerModule.customerMigrationFile, "utf8"), 120000);
    psql(["-c", "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ('20260925032300')"]);
    qualify(internalBinary);
    psql(["-c", "GRANT EXECUTE ON FUNCTION public.square_production_customer_v1(text,jsonb) TO square_production_runtime_authority"]);
    qualify(internalBinary, "authority");
    psql(["-c", "REVOKE EXECUTE ON FUNCTION public.square_production_customer_v1(text,jsonb) FROM square_production_runtime_authority"]);
    qualify(internalBinary);
    psql(["-c", "ALTER TABLE private.square_production_customer_credentials NO FORCE ROW LEVEL SECURITY"]);
    qualify(internalBinary, "authority");
    psql(["-c", "ALTER TABLE private.square_production_customer_credentials FORCE ROW LEVEL SECURITY"]);
    qualify(internalBinary);
    internalRuntime = "exact_104_qualified";
  }
  cleanup();
  process.stdout.write(JSON.stringify({ outcome: "passed", localOnly: true, hostedQualification: false,
    overlay: "exact_103_qualified", internalSourceAtOverlay, baselineSourceAtInternal,
    internalRuntime, assertions }) + "\n");
}

main().catch(() => {
  const failedStage = stage;
  try { cleanup(); }
  catch { process.stdout.write('{"outcome":"failed","stage":"catalog_cleanup"}\n'); process.exitCode = 1; return; }
  process.stdout.write(JSON.stringify({ outcome: "failed", stage: failedStage }) + "\n");
  process.exitCode = 1;
});
