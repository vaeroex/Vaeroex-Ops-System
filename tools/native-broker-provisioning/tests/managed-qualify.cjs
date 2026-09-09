"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Offline native qualification CLI. */
// Fresh local fixture only. No remote inputs, real credentials or provider calls.
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
if (process.argv.length !== 2) { process.stdout.write('{"outcome":"remote_inputs_rejected"}\n'); process.exit(2); }
const systemLibpq = process.env.VAEROEX_MANAGED_TEST_SYSTEM_LIBPQ;
if (systemLibpq !== undefined && (systemLibpq !== "16.15" || process.platform !== "linux")) {
  process.stdout.write('{"outcome":"system_libpq_profile_rejected"}\n'); process.exit(2);
}
let fixture, stage = "dependencies";
const { createFixture, command, env, pgRoot, admin, target, capability } = require("./fixture.cjs");
const nativeEnv = { PATH: env.PATH, LANG: env.LANG, LC_ALL: env.LC_ALL };
const checks = [];
const check = (ok, name) => { if (!ok) { stage = name; throw new Error("managed_native_assertion"); } checks.push(name); };
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, env);

function worker(binary, op, oid, options = {}) {
  const args = [op, "127.0.0.1", String(fixture.port), "postgres", "synthetic_lane_admin", target,
    capability, options.systemId ?? fixture.systemId, fixture.databaseOid, fixture.cert,
    "synthetic_managed_intent", String(oid), "synthetic_managed_approval"];
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: nativeEnv, stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"] });
    let output = "", candidate = "", outcome, roleOid, failed = false, ready = false, delivered = false;
    const fail = () => { failed = true; child.kill("SIGKILL"); };
    const timer = setTimeout(fail, 20000);
    child.once("error", fail);
    child.stderr.on("data", fail);
    for (const stream of child.stdio.slice(3)) stream.on("error", () => undefined);
    child.stdout.on("data", bytes => {
      output += bytes.toString();
      if (output.length > 1024) return fail();
      while (output.includes("\n")) {
        const end = output.indexOf("\n"), line = output.slice(0, end); output = output.slice(end + 1);
        if (line === '{"phase":"ready"}') { if (ready) return fail(); ready = true; continue; }
        const match = /^\{"outcome":"(prepared|assigned|activated|authenticated|fenced|inspected)","committed":true,"role_oid":"([0-9]{1,10})"\}$/.exec(line);
        const denied = /^\{"outcome":"(failed|uncertain|policy_blocked)"\}$/.exec(line);
        if (outcome || (!match && !denied)) return fail();
        outcome = match?.[1] ?? denied[1]; roleOid = match?.[2];
      }
    });
    child.stdio[4].on("data", bytes => {
      candidate += bytes.toString("ascii");
      if (candidate.length > 129 || !/^[0-9a-f]*\n?$/.test(candidate)) return fail();
      if (!candidate.endsWith("\n")) return;
      if (delivered || !/^[0-9a-f]{128}\n$/.test(candidate)) return fail();
      delivered = true;
      void Promise.resolve().then(async () => {
        if (options.onCandidate) await options.onCandidate();
        if (!options.withholdAck) child.stdio[5].end("STORED\n");
      }).catch(fail);
    });
    child.stdio[3].end("\n");
    child.stdio[6].end(options.password ? options.password + "\n" : "");
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (failed || signal || output || !outcome) return reject(new Error("fixed_worker_protocol"));
      resolve({ outcome, roleOid, ready, code, password: candidate.endsWith("\n") ? candidate.slice(0, -1) : null });
    });
  });
}

async function main() {
  fixture = await createFixture();
  stage = "build";
  const source = path.resolve(__dirname, "../native.c");
  const strict = path.join(fixture.root, "native-strict"), managed = path.join(fixture.root, "native-managed-local");
  const release = path.join(fixture.root, "native-release");
  const flags = ["-std=c11", "-Wall", "-Wextra", "-Werror", "-pthread", "-I" + path.join(pgRoot, "include"),
    "-L" + path.join(pgRoot, "lib"), "-Wl,-rpath," + path.join(pgRoot, "lib"), source, "-lpq"];
  // Optional CI lane changes only the managed client's dependency. The actual
  // local PostgreSQL/pgAudit/Supautils fixture and strict client remain pinned17.6.
  // No arbitrary library prefix, header directory or runtime version is input.
  const managedInclude = systemLibpq ? "/usr/include/postgresql" : path.join(pgRoot, "include");
  const managedLibrary = systemLibpq ? "/usr/lib/x86_64-linux-gnu" : path.join(pgRoot, "lib");
  const managedFlags = ["-std=c11", "-Wall", "-Wextra", "-Werror", "-pthread", "-I" + managedInclude,
    "-L" + managedLibrary, "-Wl,-rpath," + managedLibrary, source, "-lpq"];
  const versionSource = path.join(fixture.root, "managed-libpq-version.c");
  const versionProbe = path.join(fixture.root, "managed-libpq-version");
  fs.writeFileSync(versionSource, '#include <libpq-fe.h>\n#include <stdio.h>\nint main(void){printf("%d\\n",PQlibVersion());return 0;}\n');
  stage = "build_managed_version_probe";
  command("/usr/bin/cc", [...managedFlags.map(value => value === source ? versionSource : value), "-o", versionProbe]);
  check(command(versionProbe, []).trim() === (systemLibpq ? "160015" : "170006"), "actual_managed_libpq_runtime_" + (systemLibpq ? "160015" : "170006"));
  // The fixture has already verified exact dependency digests. Its generated
  // configuration contains public local extension paths, never credentials.
  const preloads = fs.readFileSync(path.join(fixture.data, "postgresql.conf"), "utf8")
    .match(/^shared_preload_libraries='([^']+)'$/m)[1].split(",");
  const auditPath = preloads.find(value => value.endsWith("/pgaudit"));
  const utilsPath = preloads.find(value => value.endsWith("/supautils"));
  check([auditPath, utilsPath].every(value => typeof value === "string" && path.isAbsolute(value) && !/[\s"\\]/.test(value)), "exact_local_hook_paths");
  stage = "build_strict_client";
  command("/usr/bin/cc", [...flags, "-DVAEROEX_SYNTHETIC_ONLY", "-o", strict]);
  stage = "build_managed_local_client";
  command("/usr/bin/cc", [...managedFlags, "-DVAEROEX_SYNTHETIC_ONLY", "-DVAEROEX_MANAGED_PROFILE_TEST",
    '-DVAEROEX_TEST_AUDIT_PRELOAD="' + auditPath + '"', '-DVAEROEX_TEST_UTILS_PRELOAD="' + utilsPath + '"', "-o", managed]);
  stage = "build_closed_release";
  command("/usr/bin/cc", [...flags, "-o", release]);
  const pinned = path.join(fixture.root, "native-managed-pinned-never-connected");
  const managedPins = { HOST: "managed.synthetic.invalid", PORT: "5432", DATABASE: "postgres",
    ADMIN: "synthetic_lane_admin", TARGET: target, SYSTEM_ID: fixture.systemId,
    DATABASE_OID: fixture.databaseOid, CA: fixture.cert,
    ADMIN_USER: "synthetic_lane_admin.synthetic", TARGET_USER: target + ".synthetic" };
  stage = "build_pinned_managed_client";
  command("/usr/bin/cc", [...managedFlags, "-DVAEROEX_MANAGED_SUPABASE",
    ...Object.entries(managedPins).map(([name, value]) => `-DVAEROEX_MANAGED_${name}="${value}"`), "-o", pinned]);
  const missingPins = spawnSync("/usr/bin/cc", [...managedFlags, "-DVAEROEX_MANAGED_SUPABASE", "-o", path.join(fixture.root, "missing-pins")], { env });
  check(missingPins.status !== 0, "managed_build_without_immutable_pins_rejected");
  const profileTest = path.join(fixture.root, "managed-profile-test");
  stage = "build_managed_profile_test";
  // Exercise glibc's normalized feature macro even on non-glibc local builds.
  command("/usr/bin/cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-pthread", "-D_DEFAULT_SOURCE=1", "-I" + managedInclude,
    "-L" + managedLibrary, "-Wl,-rpath," + managedLibrary, path.join(__dirname, "managed-profile-test.c"), "-lpq", "-o", profileTest]);
  check(command(profileTest, []).includes("12 managed profile observations PASS"), "fixed_managed_preloads_and_effective_setting_boundaries");
  const blocked = spawnSync(release, [], { env: nativeEnv, encoding: "utf8" });
  check(blocked.status === 4 && blocked.stdout === '{"outcome":"policy_blocked"}\n', "ordinary_release_remains_closed");
  const remote = spawnSync(managed, ["inspect", "remote.invalid", "5432", "postgres", admin, target,
    capability, fixture.systemId, fixture.databaseOid, fixture.cert, "synthetic_intent", "0", "synthetic_approval"], { env: nativeEnv, encoding: "utf8" });
  check(remote.status === 2 && remote.stdout === '{"outcome":"failed"}\n', "managed_profile_fixture_rejects_remote_target");
  const wrongPin = spawnSync(pinned, ["inspect", "other.synthetic.invalid", "5432", "postgres", "synthetic_lane_admin", target,
    capability, fixture.systemId, fixture.databaseOid, fixture.cert, "synthetic_intent", "0", "synthetic_approval"], { env: nativeEnv, encoding: "utf8" });
  check(wrongPin.status === 2 && wrongPin.stdout === '{"outcome":"failed"}\n', "managed_build_refuses_target_override_before_private_input");

  stage = "operator";
  await fixture.control.query(`CREATE ROLE synthetic_lane_admin LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOCREATEDB NOREPLICATION;
GRANT synthetic_privileged,pg_signal_backend,pg_read_all_settings TO synthetic_lane_admin;
GRANT ${capability} TO synthetic_lane_admin WITH ADMIN TRUE;
GRANT USAGE ON SCHEMA private TO synthetic_lane_admin;
GRANT SELECT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA private TO synthetic_lane_admin;`);
  const lane = await fixture.connect("synthetic_lane_admin");
  let denied;
  try { await lane.query("SET track_activities=off"); } catch (error) { denied = error.code; }
  check(denied === "42501", "managed_operator_activity_set_actually_denied");
  check((await lane.query("SHOW track_activities")).rows[0].track_activities === "on", "managed_activity_on_is_observed_not_hidden");
  for (const [, name, sql, value] of fs.readFileSync(source, "utf8").matchAll(/\{"([a-z_.]+)", "(SET [^"]+)", "([^"]+)"\}/g)) {
    if (name === "track_activities") continue;
    stage = "effective_setting_" + name;
    const current = (await lane.query("SELECT current_setting($1) AS value", [name])).rows[0].value;
    if (current !== value) await lane.query(sql);
    check((await lane.query("SELECT current_setting($1) AS value", [name])).rows[0].value === value, "effective_setting_" + name);
  }
  stage = "prepare";
  let offset = fixture.logOffsets();
  const oldProfile = await worker(strict, "prepare", 0);
  check(oldProfile.outcome === "failed" && !oldProfile.ready && !oldProfile.password, "strict_profile_failure_reproduced_before_generation");
  const prepared = await worker(managed, "prepare", 0);
  check(prepared.outcome === "prepared" && prepared.roleOid !== "0" && !prepared.password, "managed_profile_prepares_exact_nologin_role");
  const oid = prepared.roleOid;
  check((await worker(managed, "inspect", oid)).outcome === "inspected", "managed_profile_readback_before_redundant_set");

  stage = "authority_visibility";
  await fixture.control.query("ALTER TABLE private.square_gcp_callback_binding ENABLE ROW LEVEL SECURITY; ALTER TABLE private.square_gcp_callback_binding FORCE ROW LEVEL SECURITY");
  const invisible = await worker(managed, "assign", oid);
  check(invisible.outcome === "failed" && !invisible.ready && !invisible.password, "force_rls_filtered_empty_binding_is_not_complete_authority");
  await fixture.control.query("ALTER TABLE private.square_gcp_callback_binding DISABLE ROW LEVEL SECURITY");
  await fixture.control.query("INSERT INTO private.square_gcp_callback_binding(broker_login,enabled) VALUES($1,true)", [target]);
  const active = await worker(managed, "assign", oid);
  check(active.outcome === "failed" && !active.ready && !active.password, "enabled_binding_blocks_before_generation");
  await fixture.control.query("DELETE FROM private.square_gcp_callback_binding WHERE broker_login=$1", [target]);
  const wrongIdentity = await worker(managed, "assign", oid, { systemId: "1234567890123456789" });
  check(wrongIdentity.outcome === "failed" && !wrongIdentity.ready && !wrongIdentity.password, "physical_identity_mismatch_blocks_before_generation");

  stage = "scram";
  offset = fixture.logOffsets();
  let activityObserved = false;
  const first = await worker(managed, "assign", oid, { onCandidate: async () => {
    const rows = (await fixture.control.query("SELECT query FROM pg_stat_activity WHERE application_name='vaeroex-native-provisioner'")).rows;
    activityObserved = rows.some(row => row.query.includes("SCRAM-SHA-256$"));
  } });
  check(first.outcome === "assigned" && first.password?.length === 128, "supported_libpq_scram_assignment_and_private_delivery");
  check(activityObserved, "restricted_admin_activity_visibility_is_real_residual_risk");
  await pause(100);
  const bytes = Buffer.concat([fixture.logBytes(offset), fixture.statBytes()]);
  check(!bytes.includes(Buffer.from(first.password)), "plaintext_absent_from_ordinary_logs_and_statistics");
  check(!bytes.includes(Buffer.from("SCRAM-SHA-256$")), "verifier_absent_from_ordinary_logs_and_statistics");
  check(bytes.includes(Buffer.from("AUDIT:")) && bytes.includes(Buffer.from(target)) && bytes.includes(Buffer.from("<REDACTED>")), "role_change_audit_preserves_target_with_redaction");
  check((await worker(managed, "activate", oid)).outcome === "activated", "separate_checked_login_activation");
  check((await worker(managed, "authenticate", oid, { password: first.password })).outcome === "authenticated", "candidate_native_scram_identity_without_new_admin_grants");
  const held = await fixture.connect(target, first.password, "tls");
  check((await held.query("SELECT session_user AS actor")).rows[0].actor === target, "actual_native_session_user");
  check((await worker(managed, "fence", oid)).outcome === "fenced", "fence_commits_nologin_then_drains_existing_sessions");
  check((await fixture.control.query("SELECT count(*)::integer AS count FROM pg_stat_activity WHERE usename=$1", [target])).rows[0].count === 0, "fence_zero_session_readback");

  stage = "uncertain_and_recovery";
  const uncertain = await worker(managed, "assign", oid, { withholdAck: true });
  check(uncertain.outcome === "uncertain" && !!uncertain.password, "lost_private_delivery_ack_is_uncertain");
  check((await worker(managed, "fence", oid)).outcome === "fenced", "uncertain_assignment_requires_fresh_fence");
  const replacement = await worker(managed, "assign", oid);
  check(replacement.outcome === "assigned" && replacement.password !== first.password && replacement.password !== uncertain.password, "recovery_generates_unique_replacement_not_replay");
  check((await worker(managed, "activate", oid)).outcome === "activated", "replacement_activation");
  check((await worker(managed, "authenticate", oid, { password: replacement.password })).outcome === "authenticated", "replacement_native_authentication");
  check((await worker(managed, "authenticate", oid, { password: first.password })).outcome !== "authenticated", "retired_password_rejected");
  check((await worker(managed, "fence", oid)).outcome === "fenced", "final_local_role_fenced");
  await lane.end();
  await fixture.stop(); fixture = null;
  check(true, "local_fixture_stopped_before_success_report");
  process.stdout.write(JSON.stringify({ outcome: "passed", checks, hostedQualification: false }) + "\n");
}
main().catch(() => { process.stdout.write(JSON.stringify({ outcome: "failed", stage }) + "\n"); process.exitCode = 1; })
  .finally(async () => {
    try { if (fixture) await fixture.stop(); }
    catch { process.stdout.write('{"outcome":"failed","stage":"local_fixture_cleanup"}\n'); process.exitCode = 1; }
  });
