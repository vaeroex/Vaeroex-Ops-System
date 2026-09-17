"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Offline native catalog qualification CLI. */
// Creates only a private local PostgreSQL cluster. It accepts no DSN, password,
// network endpoint, hosted identity, or deployment input.
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

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
  internal: "f7e6f8f72357dafc1a5b6ad0566c2aa90293175420b84b593b98065370e45928",
  preFoundationLedger: "sha256:db7c39a62dce07ac3d21a78653a6d4a905f399d00ea1a4dce452ed4018958060",
});
const hash = source => crypto.createHash("sha256").update(source).digest("hex");
let stage = "source_manifest", root, socketRoot, running = false, terminating = false, assertions = 0;
const check = (value, name) => { assertions++; if (!value) { stage = name; throw new Error("catalog_qualification_failed"); } };
const contractStages = new Set([
  "begin", "closed_authority", "ledger_phase", "relations", "foundation_schema", "overlay_schema",
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
  fs.writeFileSync(path.join(data(), "pg_hba.conf"), "local all postgres trust\nlocal all all reject\n", { mode: 0o600 });
  run(path.join(pgRoot, "bin/pg_ctl"), ["-D", data(), "-l", path.join(root, "postgres.log"), "-w", "start"]);
  running = true;
  run(path.join(pgRoot, "bin/createdb"), ["-h", socket(), "-p", port, "-U", "postgres", database]);
  const seed = versions.map(version => `('${version}')`).join(",");
  psql(["-c", `CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
    CREATE SCHEMA private; REVOKE ALL ON SCHEMA private FROM PUBLIC;
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
    stage = "internal_trigger_substitution";
    psql(["-c", `DROP TRIGGER square_production_internal_permit_delete_guard ON private.square_production_internal_permits;
      CREATE TRIGGER square_production_internal_permit_delete_guard BEFORE DELETE ON private.square_production_internal_permits
      FOR EACH ROW WHEN (false) EXECUTE FUNCTION private.square_production_internal_reject_immutable_mutation_v1();`]);
    qualify(internalBinary, "internal_triggers");
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
