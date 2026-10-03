"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Local-only native qualification. */
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
if (process.argv.length !== 2) { process.stdout.write("mapped_native_remote_inputs_denied\n"); process.exit(2); }
const { createFixture, command, pgRoot, admin } = require("./fixture.cjs");
let fixture, stage = "dependencies", assertions = 0;
const check = value => { assertions++; if (!value) throw Error("mapped_native_failed"); };
async function main() {
  const { sandboxProvisioningProfile } = await import(pathToFileURL(path.resolve(__dirname, "../sandbox-profile.mjs")));
  const { createLocalSyntheticNativeAdapter } = await import(pathToFileURL(path.resolve(__dirname, "../adapter.mjs")));
  const { createSyntheticProvisioningCoordinator, createInMemorySyntheticSecretStore } = await import(pathToFileURL(path.resolve(__dirname, "../lifecycle.mjs")));
  fixture = await createFixture();
  stage = "mapped_schema";
  await fixture.control.query(`
    ALTER TABLE private.square_account_configuration ADD COLUMN enrollment_enabled boolean;
    ALTER TABLE private.square_gcp_callback_binding ADD COLUMN deployment_key text UNIQUE, ADD COLUMN provider_calls_enabled boolean;
    CREATE TABLE private.square_gcp_mapped_runtime_binding (deployment_key text,enroller_login name,runtime_login name,enabled boolean,provider_calls_enabled boolean);
    CREATE TABLE private.square_qualification_gate (expires_at timestamptz);
    ALTER TABLE private.square_gcp_mapped_runtime_binding ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.square_gcp_mapped_runtime_binding FORCE ROW LEVEL SECURITY;
    CREATE ROLE square_verified_enrollment_authority NOLOGIN;
    CREATE ROLE square_ingestion_runtime_authority NOLOGIN;
    CREATE ROLE synthetic_lane_admin LOGIN CREATEROLE NOSUPERUSER NOBYPASSRLS NOCREATEDB NOREPLICATION;
    GRANT synthetic_privileged,pg_signal_backend,pg_read_all_settings TO synthetic_lane_admin;
    GRANT square_verified_enrollment_authority,square_ingestion_runtime_authority TO synthetic_lane_admin WITH ADMIN TRUE;
    GRANT USAGE ON SCHEMA private TO synthetic_lane_admin;
    GRANT SELECT,UPDATE,DELETE,TRUNCATE ON ALL TABLES IN SCHEMA private TO synthetic_lane_admin;
    INSERT INTO private.square_gcp_callback_binding VALUES ('square_sandbox_callback_broker',false,'synthetic',false);
    INSERT INTO private.square_gcp_mapped_runtime_binding VALUES ('synthetic','square_sandbox_enroller','square_sandbox_runtime',false,false);
    INSERT INTO private.square_account_configuration VALUES ('square_sandbox_callback_broker','square_sandbox_enroller',null,false,true,false);`);
  const candidates = [];
  try {
    for (const profileName of ["enroller", "runtime"]) {
      stage = "build_" + profileName;
      const p = sandboxProvisioningProfile(profileName), binary = path.join(fixture.root, "mapped-" + profileName);
      command("/usr/bin/cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-pthread", "-I" + path.join(pgRoot, "include"),
        "-L" + path.join(pgRoot, "lib"), "-Wl,-rpath," + path.join(pgRoot, "lib"), "-DVAEROEX_SYNTHETIC_ONLY",
        "-DVAEROEX_MAPPED_" + profileName.toUpperCase(), path.resolve(__dirname, "../native.c"), "-lpq", "-o", binary]);
      const target = Object.freeze({ ...p.target, projectReference: "synthetic-mapped", host: "127.0.0.1", port: fixture.port,
        adminRole: admin, systemIdentifier: fixture.systemId, databaseOid: fixture.databaseOid, rootCertificate: fixture.cert });
      stage = "managed_visibility_" + profileName;
      const preloads = fs.readFileSync(path.join(fixture.data, "postgresql.conf"), "utf8").match(/^shared_preload_libraries='([^']+)'$/m)[1].split(",");
      const auditPath = preloads.find(value => value.endsWith("/pgaudit")), utilsPath = preloads.find(value => value.endsWith("/supautils"));
      const managedBinary = binary + "-managed-local";
      command("/usr/bin/cc", ["-std=c11", "-Wall", "-Wextra", "-Werror", "-pthread", "-I" + path.join(pgRoot, "include"),
        "-L" + path.join(pgRoot, "lib"), "-Wl,-rpath," + path.join(pgRoot, "lib"), "-DVAEROEX_SYNTHETIC_ONLY", "-DVAEROEX_MANAGED_PROFILE_TEST",
        '-DVAEROEX_TEST_AUDIT_PRELOAD="' + auditPath + '"', '-DVAEROEX_TEST_UTILS_PRELOAD="' + utilsPath + '"',
        "-DVAEROEX_MAPPED_" + profileName.toUpperCase(), path.resolve(__dirname, "../native.c"), "-lpq", "-o", managedBinary]);
      const managedTarget = Object.freeze({ ...target, adminRole: "synthetic_lane_admin" });
      const managedNative = createLocalSyntheticNativeAdapter({ executable: managedBinary, target: managedTarget });
      const managedContext = { target: managedTarget, intent: "synthetic-visibility-" + profileName, approvalId: "synthetic-only", signal: new AbortController().signal };
      let hiddenDenied = false; try { await managedNative.inspect(managedContext); } catch { hiddenDenied = true; } check(hiddenDenied);
      await fixture.control.query("ALTER TABLE private.square_gcp_mapped_runtime_binding DISABLE ROW LEVEL SECURITY");
      check((await managedNative.inspect(managedContext)).ack);
      await fixture.control.query("ALTER TABLE private.square_gcp_mapped_runtime_binding ENABLE ROW LEVEL SECURITY");
      const native = createLocalSyntheticNativeAdapter({ executable: binary, target });
      const context = { target, intent: "synthetic-" + profileName, approvalId: "synthetic-mapped-only", signal: new AbortController().signal };
      stage = "legacy_gate_denial_" + profileName;
      for (const sql of ["UPDATE private.square_account_configuration SET enrollment_enabled=true,blocked=false",
        "INSERT INTO private.square_qualification_gate VALUES (clock_timestamp()+interval '1 hour')"]) {
        await fixture.control.query(sql);
        let denied = false; try { await native.inspect(context); } catch { denied = true; } check(denied);
        await fixture.control.query("UPDATE private.square_account_configuration SET enrollment_enabled=false,blocked=true;DELETE FROM private.square_qualification_gate");
      }
      for (const [table, column] of [["square_gcp_mapped_runtime_binding", "enabled"], ["square_gcp_mapped_runtime_binding", "provider_calls_enabled"],
        ["square_gcp_callback_binding", "enabled"], ["square_gcp_callback_binding", "provider_calls_enabled"]]) {
        stage = "active_gate_denial_" + profileName;
        // Fixed synthetic table/column literals only; never credential-bearing SQL.
        await fixture.control.query(`UPDATE private.${table} SET ${column}=true`);
        let denied = false; try { await native.inspect(context); } catch { denied = true; }
        check(denied); await fixture.control.query(`UPDATE private.${table} SET ${column}=false`);
      }
      stage = "create_" + profileName;
      const memory = createInMemorySyntheticSecretStore(), audit = [];
      const store = { ...memory, async stage(handle, bytes) { candidates.push(Buffer.from(bytes)); return memory.stage(handle, bytes); } };
      const coordinator = createSyntheticProvisioningCoordinator({ target, native, secretStore: store,
        audit: { async append(event) { audit.push(event); return { ack: true }; } } });
      const result = await coordinator.run({ operation: "create", actor: "synthetic-owner", intent: context.intent, approvalId: context.approvalId,
        deadlineMs: 30000, cleanupTimeoutMs: 5000 });
      check(result.outcome === "staged_ready");
      check(audit.some(event => event.phase === "fence_after_authentication"));
      const roles = (await fixture.control.query("SELECT r.rolcanlogin,(SELECT count(*)::int FROM pg_auth_members m WHERE m.member=r.oid) AS memberships," +
        "pg_has_role(r.oid,$2,'MEMBER') AS expected,(SELECT count(*)::int FROM pg_stat_activity WHERE usename=$1) AS sessions FROM pg_roles r WHERE rolname=$1",
      [target.role, target.capabilityRole])).rows;
      check(roles.length === 1 && roles[0].rolcanlogin === false && roles[0].memberships === 1 && roles[0].expected && roles[0].sessions === 0);
      const wrong = Object.freeze({ ...target, capabilityRole: profileName === "enroller" ? "square_ingestion_runtime_authority" : "square_verified_enrollment_authority" });
      let denied = false; try { createLocalSyntheticNativeAdapter({ executable: binary, target: wrong }); } catch { denied = true; } check(denied);
      check(!JSON.stringify(audit).includes("SCRAM-SHA-256$"));
    }
    stage = "privacy_and_stop";
    check(candidates.length === 2 && !candidates[0].equals(candidates[1]));
    await fixture.stop();
    const evidence = Buffer.concat([fixture.logBytes([0, 0, 0]), fixture.statBytes()]);
    check(candidates.every(value => !evidence.includes(value))); check(!evidence.includes(Buffer.from("SCRAM-SHA-256$")));
    check(evidence.includes(Buffer.from("AUDIT:")) && evidence.includes(Buffer.from("<REDACTED>")));
    check(!fs.existsSync(path.join(fixture.data, "postmaster.pid")));
    fixture = undefined;
    process.stdout.write(JSON.stringify({ outcome: "passed", assertions, hostedQualification: false, profiles: ["enroller", "runtime"] }) + "\n");
  } finally { for (const value of candidates) value.fill(0); }
}
main().catch(error => { process.stdout.write(JSON.stringify({ outcome: "failed", stage,
  ...(typeof error.safeStage === "string" && /^[a-z_]{1,64}$/.test(error.safeStage) ? { dependency: error.safeStage } : {}) }) + "\n"); process.exitCode = 1; })
  .finally(async () => { try { if (fixture) await fixture.stop(); } catch { process.stdout.write("mapped_native_cleanup_failed\n"); process.exitCode = 1; } });
