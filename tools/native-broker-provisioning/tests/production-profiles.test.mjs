import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  productionDatabaseIdentity,
  productionDeploymentBinding,
  productionAuthorityRpc,
  productionCapabilityAllowed,
  productionProvisioningBuildProfile,
  productionProvisioningProfile,
  productionProvisioningProfiles,
  productionSourcePins,
} from "../production-profile.mjs";
import { productionSourceManifest } from "../production-source.mjs";
import { customerNativeContract, customerMigrationFile, customerMigrationSha256 } from "../customer-source.mjs";

test("customer native contract pins exactly the candidate and its eight function bodies", () => {
  const contract=customerNativeContract();
  assert.equal(createHash("sha256").update(readFileSync(customerMigrationFile)).digest("hex"),customerMigrationSha256);
  const prefix="square_production_customer_";
  assert.ok(contract.sql.includes(`left(p.proname,${prefix.length})='${prefix}'`));
  assert.equal((contract.sql.match(/\('[^']+','[a-f0-9]{64}'\)/g)||[]).length,8);
  assert.match(contract.sql,/count\(\*\)=4 FROM pg_class/);
  assert.match(contract.sql,/r\.relpersistence='p'/);
  assert.match(contract.sql,/r\.relrowsecurity AND r\.relforcerowsecurity/);
  assert.match(contract.sql,/count\(\*\)=3 FROM pg_proc/);
  for (const check of ["pg_get_constraintdef", "pg_get_indexdef", "t.tgenabled", "t.tgqual", "c.conrelid IN"]) {
    assert.ok(contract.sql.includes(check), `customer catalog contract includes ${check}`);
  }
});

test("customer binding may remain open only during exact native role revocation", () => {
  const source=readFileSync(new URL("../native.c",import.meta.url),"utf8");
  const harness=readFileSync(new URL("./production-catalog-qualify.c",import.meta.url),"utf8");
  assert.match(source,/customer_fence \? !production_contract_valid\(phase\)/);
  assert.match(source,/checked_authority\(target,false\)/);
  assert.match(source,/!strcmp\(operation,"fence"\) \? fence_authority\(target\) : closed_authority\(target\)/);
  assert.match(source,/\$1 IN \('internal','customer'\) AND count\(\*\)=46/);
  assert.match(source,/\$1<>'customer' OR c\.conrelid IS NULL OR c\.conrelid NOT IN/);
  assert.doesNotMatch(source,/SET LOCAL search_path=public/);
  assert.doesNotMatch(harness,/SET LOCAL search_path=public/);
  assert.match(harness,/customer_open_binding_rejects_non_fence/);
  assert.match(harness,/customer_binding_not_mutated_by_role_fence/);
  assert.match(harness,/production_ledger_phase\(\)==PRODUCTION_PHASE_CUSTOMER[\s\S]*?SET search_path=pg_catalog/);
});
import { createLocalSyntheticNativeAdapter, createLocalSyntheticProductionNativeAdapter } from "../adapter.mjs";
import { createInMemorySyntheticSecretStore } from "../lifecycle.mjs";
import { sandboxTarget } from "../sandbox-profile.mjs";

const root = resolve(import.meta.dirname, "../../..");
const hash = file => createHash("sha256").update(readFileSync(resolve(root, file))).digest("hex");
const names = ["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"];

test("Production profiles pin the exact reviewed 102+overlay sources", () => {
  assert.deepEqual(productionSourcePins, {
    baselineVersion: "20260902191323",
    baselineMigrationCount: 102,
    baselineLedgerFingerprint: "sha256:3326a738d016df98e0fd22830b8c950dac3cc6d50bd26b61de1d9ebd282c201f",
    foundationSha256: "f8598ca685c795ad56bfdb7a29a1ded3da1c096d42ffb62ea4e123271db54c6d",
    overlayVersion: "20260902191324",
    overlayMigrationCount: 103,
    overlayLedgerFingerprint: "sha256:224d377fe3f44a59dabd188ad897624207830940a985e408e0072fb7941db146",
    overlaySha256: "2cc43a9313d056e58b75143f032f347cb0972f45cc1edbd484f6b1fb0574661f",
    internalRuntimeVersion: "20260902191325",
    internalRuntimeMigrationCount: 104,
    internalRuntimeLedgerFingerprint: "sha256:7dc51d888ee9c4a6bb595b1a4431ab5fcdb649e34c871ba91a6512d5fa2dc89f",
    internalRuntimeSha256: "ff2182044f28d6901f1582db3d31ef20d027a1e4590f0b295a7a64a1ad4c1325",
  });
  assert.equal(hash("supabase/migrations/20260902191323_integration_production_runtime_foundation.sql"), productionSourcePins.foundationSha256);
  assert.equal(hash("supabase/migrations/20260902191324_square_production_runtime_overlay.sql"), productionSourcePins.overlaySha256);
  const names = readdirSync(resolve(root, "supabase/migrations"))
    .filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const versions = names
    .filter(name => name.split("_", 1)[0] <= productionSourcePins.baselineVersion)
    .map(name => name.split("_", 1)[0]).sort();
  const ledger = `sha256:${createHash("sha256").update(
    versions.map(version => `${version.length}:${version}`).join(""),
  ).digest("hex")}`;
  assert.equal(versions.length, productionSourcePins.baselineMigrationCount);
  assert.equal(ledger, productionSourcePins.baselineLedgerFingerprint);
  assert.equal(names[productionSourcePins.baselineMigrationCount - 1],
    `${productionSourcePins.baselineVersion}_integration_production_runtime_foundation.sql`);
  assert.equal(names[productionSourcePins.baselineMigrationCount],
    `${productionSourcePins.overlayVersion}_square_production_runtime_overlay.sql`);
  const overlayVersions = names
    .filter(name => name.split("_", 1)[0] <= productionSourcePins.overlayVersion)
    .map(name => name.split("_", 1)[0]).sort();
  const overlayLedger = `sha256:${createHash("sha256").update(
    overlayVersions.map(version => `${version.length}:${version}`).join(""),
  ).digest("hex")}`;
  assert.equal(overlayVersions.length, productionSourcePins.overlayMigrationCount);
  assert.equal(overlayLedger, productionSourcePins.overlayLedgerFingerprint);
  const internalRuntimeFiles = names.filter(name => name.split("_", 1)[0] === productionSourcePins.internalRuntimeVersion);
  assert.ok(internalRuntimeFiles.length <= 1, "191325 aliases are not accepted");
  if (internalRuntimeFiles.length === 1) {
    assert.equal(internalRuntimeFiles[0],
      `${productionSourcePins.internalRuntimeVersion}_square_production_internal_pilot_runtime.sql`);
    assert.equal(hash(`supabase/migrations/${internalRuntimeFiles[0]}`), productionSourcePins.internalRuntimeSha256);
  }
});

test("six profiles map one login to the exact authority RPC for each accepted source phase", () => {
  assert.deepEqual(productionProvisioningProfiles().map(profile => profile.name), names);
  for (const name of names) assert.deepEqual(productionProvisioningProfile(name), {
    name,
    role: `square_production_${name}`,
    capabilityRole: `square_production_${name}_authority`,
    authorityRpcByPhase: {
      overlay: `public.check_square_production_${name}_authority_v1(text,text,text,bigint,text)`,
      internalRuntime: ["oauth", "broker", "runtime", "evidence"].includes(name)
        ? `public.square_production_internal_${name}_v1(text,jsonb)`
        : `public.check_square_production_${name}_authority_v1(text,text,text,bigint,text)`,
    },
    secretParent: `projects/vaeroex-integrations-prod/secrets/square-production-${name}-db`,
  });
  for (const name of names) {
    assert.equal(productionAuthorityRpc(name, "overlay"),
      `public.check_square_production_${name}_authority_v1(text,text,text,bigint,text)`);
    assert.equal(productionAuthorityRpc(name, "internalRuntime"),
      ["oauth", "broker", "runtime", "evidence"].includes(name)
        ? `public.square_production_internal_${name}_v1(text,jsonb)`
        : `public.check_square_production_${name}_authority_v1(text,text,text,bigint,text)`);
  }
  assert.throws(() => productionAuthorityRpc("oauth", "future"), /production_native_source_phase_denied/);
  assert.throws(() => productionProvisioningProfile("runtime_other"), /production_native_profile_denied/);
  for (const invalid of [undefined, null, {}, { role: "square_production_runtime" },
    { capabilityRole: "square_production_runtime_authority" },
    { role: "square_production_runtime_other", capabilityRole: "square_production_runtime_authority" },
    { role: "square_production_runtime", capabilityRole: "square_production_oauth_authority" }]) {
    assert.equal(productionCapabilityAllowed(invalid), false, "malformed capability target fails closed");
  }
});

test("source manifest accepts an absent 191325 and rejects version aliases or unpinned bytes", () => {
  const migrationNames = readdirSync(resolve(root, "supabase/migrations"))
    .filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const withoutInternalRuntime = migrationNames
    .filter(name => name.split("_", 1)[0] !== productionSourcePins.internalRuntimeVersion);
  const digest = name => hash(`supabase/migrations/${name}`);
  assert.deepEqual(productionSourceManifest({ migrationNames: withoutInternalRuntime, digest }),
    { phase: "overlay", internalRuntimeSha256: null });
  assert.throws(() => productionSourceManifest({ migrationNames: withoutInternalRuntime,
    digest: name => name.endsWith("_square_production_runtime_overlay.sql") ? "0".repeat(64) : digest(name) }),
  /production_native_source_manifest_denied/);
  const expectedRuntime = `${productionSourcePins.internalRuntimeVersion}_square_production_internal_pilot_runtime.sql`;
  const withExpectedRuntime = [...withoutInternalRuntime, expectedRuntime];
  if (typeof productionSourcePins.internalRuntimeSha256 === "string") {
    assert.deepEqual(productionSourceManifest({ migrationNames: withExpectedRuntime,
      digest: name => name === expectedRuntime ? productionSourcePins.internalRuntimeSha256 : digest(name) }),
    { phase: "internalRuntime", internalRuntimeSha256: productionSourcePins.internalRuntimeSha256 });
  } else {
    assert.throws(() => productionSourceManifest({ migrationNames: withExpectedRuntime,
      digest: name => name === expectedRuntime ? "1".repeat(64) : digest(name) }),
    /production_native_source_manifest_denied/);
  }
  assert.throws(() => productionSourceManifest({
    migrationNames: [...withoutInternalRuntime, `${productionSourcePins.internalRuntimeVersion}_alias.sql`], digest,
  }), /production_native_source_manifest_denied/);
  assert.throws(() => productionSourceManifest({ migrationNames: [...withoutInternalRuntime, withoutInternalRuntime[0]], digest }),
    /production_native_source_manifest_denied/);
});

test("optional final-phase source identity reaches the native execution gate and exact RPC map", () => {
  const buildSource = readFileSync(resolve(root, "tools/native-broker-provisioning/build-production.mjs"), "utf8");
  const nativeSource = readFileSync(resolve(root, "tools/native-broker-provisioning/native.c"), "utf8");
  assert.match(buildSource, /productionSourceManifest\(\{ migrationNames: names, digest \}\)/);
  assert.match(buildSource, /VAEROEX_PRODUCTION_INTERNAL_RUNTIME_SOURCE_SHA256/);
  assert.match(nativeSource, new RegExp(productionSourcePins.internalRuntimeSha256));
  assert.match(nativeSource, /PRODUCTION_PHASE_OVERLAY/);
  assert.match(nativeSource, /PRODUCTION_PHASE_INTERNAL_RUNTIME/);
  assert.doesNotMatch(nativeSource, /sha256_pending/);
  for (const name of names) {
    assert.ok(nativeSource.includes(productionAuthorityRpc(name, "overlay")));
    assert.ok(nativeSource.includes(productionAuthorityRpc(name, "internalRuntime")));
  }
});

test("Production profile fencing pairs login state with non-inheriting capability membership", () => {
  const nativeSource = readFileSync(resolve(root, "tools/native-broker-provisioning/native.c"), "utf8");
  const qualifier = readFileSync(resolve(root,
    "tools/native-broker-provisioning/tests/production-native-qualify.cjs"), "utf8");
  const catalogQualifier = readFileSync(resolve(root,
    "tools/native-broker-provisioning/tests/production-catalog-qualify.cjs"), "utf8");
  const catalogHarness = readFileSync(resolve(root,
    "tools/native-broker-provisioning/tests/production-catalog-qualify.c"), "utf8");
  assert.match(nativeSource, /CREATE ROLE",target,[\s\S]*?NOLOGIN[\s\S]*?NOINHERIT/);
  assert.match(nativeSource, /WITH ADMIN FALSE, INHERIT FALSE, SET FALSE/);
  assert.match(nativeSource, /production_authority_catalog_fence\(\)[\s\S]*?managed_close_capability\(target\)[\s\S]*?terminate_target_sessions\(control_db,target\)[\s\S]*?closed_authority\(target\)/,
    "managed Production closes inherited authority and drains the exact login before taking application locks");
  assert.match(nativeSource, /role_command\("GRANT " CAPABILITY " TO",target,[\s\S]*?INHERIT FALSE, SET FALSE/,
    "managed and self-owned Production fences both remove inherited capability authority");
  assert.match(nativeSource, /if \(ok && !strcmp\(op,"activate"\)\) \{[\s\S]*?INHERIT TRUE, SET FALSE/);
  assert.match(nativeSource, /target_role\.rolcanlogin AND target_role\.rolinherit AND m\.inherit_option/);
  assert.match(nativeSource, /NOT target_role\.rolcanlogin AND NOT target_role\.rolinherit AND NOT m\.inherit_option/);
  assert.match(qualifier, /existing_session_loses_effective_rpc_before_session_termination/);
  assert.match(qualifier, /active_login_with_noninheriting_capability_membership_rejected/);
  assert.match(qualifier, /noncurrent_profile_privilege_drift_blocks_current_profile_before_mutation/);
  assert.match(nativeSource, /production_authority_valid\(target,!strcmp\(op,"fence"\),managed_capability_transition\)/,
    "only the pre-revocation fence path permits target-owned settings");
  assert.match(nativeSource, /production_authority_valid\(target,state==2 \|\| state==3,state==3\)/,
    "the fence role check applies the same narrow pre-revocation exception");
  assert.match(nativeSource, /\$3::integer=3 AND r\.rolcanlogin AND r\.rolinherit/,
    "checked recovery accepts only the exact login-open, inherit-enabled role transition");
  assert.match(nativeSource, /managed_fence_entry_role_state\(target,role_oid\)/,
    "a fresh managed fence records the exact active, transition, or already-closed entry contract");
  assert.match(nativeSource, /managed_fence_entry_state==0\?0:3/,
    "an already-closed entry remains closed while active and transition entries use the checked-recovery predicate");
  assert.match(catalogHarness, /managed-password-fence[\s\S]*managed_recovery_active_contract[\s\S]*role_valid\(MAPPED_ROLE,target_oid,2\)/,
    "the existing active-path assertion remains an exact active-role contract");
  assert.match(catalogHarness, /managed-interrupted-recovery[\s\S]*managed_recovery_transition_contract[\s\S]*role_valid\(MAPPED_ROLE,target_oid,3\)/,
    "the separate checked-recovery assertion accepts only the exact transition contract");
  assert.match(catalogHarness, /managed-closed-fence[\s\S]*managed_recovery_closed_contract[\s\S]*role_valid\(MAPPED_ROLE,target_oid,0\)/,
    "an already-closed fence uses the exact closed assertion rather than the transition contract");
  assert.match(nativeSource, /\$8=\$6 OR target_role\.rolconfig IS NULL/,
    "the exception is bound to the exact operation target");
  assert.match(nativeSource, /\$8=\$6 OR NOT EXISTS \(SELECT FROM pg_db_role_setting s WHERE s\.setrole=target_role\.oid\)/,
    "only the exact target's per-database settings are deferred to postflight");
  for (const label of [
    "target_settings_require_checked_post_commit_recovery",
    "target_settings_fence_observation",
    "target_settings_fence_nologin_committed",
    "target_settings_fence_noinherit_committed",
    "target_settings_global_setting_preserved_for_checked_recovery",
    "target_settings_exact_global_and_database_rows_preserved_for_checked_recovery",
    "target_settings_database_setting_preserved_for_checked_recovery",
    "target_settings_membership_fenced",
    "target_settings_sessions_drained",
    "reconciled_target_settings_restore_exact_fence_contract",
  ]) assert.match(qualifier, new RegExp(label));
  for (const label of [
    "target_password_locker_observation",
    "target_password_locker_native_fence_succeeds",
    "target_password_locker_drained_before_nologin_transition",
    "target_reconnect_cannot_hold_password_lock_through_fence",
    "password_locker_rollback_and_exact_closed_state_confirmed",
    "managed_capability_only_commit_state_observed",
    "managed_capability_only_commit_recovery_succeeds",
    "managed_capability_only_commit_recovers_exact_closed_state",
    "managed_transition_wait_and_closed_reconciliation_succeed",
    "managed_active_entry_overtaken_by_recovery_fence_reconciles_exact_closure",
    "managed_transition_wait_finishes_exact_closed_state",
    "managed_control_socket_deadline_interrupts_blocking_drain",
    "managed_already_closed_fence_succeeds",
    "managed_already_closed_fence_preserves_exact_state",
    "managed_recovery_transition_matrix",
    "missing_capability_membership",
  ]) assert.match(catalogQualifier, new RegExp(label));
  assert.match(catalogQualifier, /"-DVAEROEX_SYNTHETIC_ONLY", "-DVAEROEX_MANAGED_PROFILE_TEST"/,
    "the password-lock regression compiles the managed path on the exact Production-shaped catalog");
  assert.match(nativeSource, /while \(ok && !stopped\(\) && PQisBusy\(db\)\)[\s\S]*?terminate_target_sessions\(control_db,target\)/,
    "the exact-target drainer remains active while NOLOGIN waits");
  assert.match(nativeSource, /watched_control_socket[\s\S]*?shutdown\(control_fd, SHUT_RDWR\)/,
    "the native deadline interrupts a blocking control-session drain as well as the primary connection");
  assert.match(nativeSource, /strcmp\(operation,"fence"\)[\s\S]*?role_valid\(target,role_oid,3\)[\s\S]*?command\("ROLLBACK"\)[\s\S]*?continue/,
    "queued non-fence operations retry only the exact capability-only transition");
  assert.match(nativeSource, /\*fence_entry_state==2 && \(observed==3 \|\| observed==0\)[\s\S]*?\*fence_entry_state==3 && \(observed==3 \|\| observed==0\)/,
    "queued active and recovery fences accept only the still-transitional or exact-closed result");
  assert.match(nativeSource, /managed_fence_role\(target\)[\s\S]*?command\("COMMIT"\)[\s\S]*?pg_terminate_backend/,
    "the reconnect window is followed by the existing post-commit session drain");
});

test("post-mutation recovery reports each safety condition independently", () => {
  const qualifier = readFileSync(resolve(root,
    "tools/native-broker-provisioning/tests/production-native-qualify.cjs"), "utf8");
  const nativeSource = readFileSync(resolve(root, "tools/native-broker-provisioning/native.c"), "utf8");
  for (const label of [
    "post_mutation_fence_confirmed",
    "post_mutation_recovery_required",
    "post_mutation_commit_uncertain",
    "post_mutation_role_nologin",
    "post_mutation_role_noinherit",
    "post_mutation_role_zero_sessions",
  ]) assert.match(qualifier, new RegExp(label));
  assert.match(qualifier, /databaseCommit: commitStatus/);
  assert.match(qualifier, /const digestAvailability/);
  assert.match(qualifier, /production_fixture_digest_function_available/);
  assert.match(qualifier, /fixture\.connect\(fenceProfile\.role, fenceCandidate\.toString\("ascii"\), "tls"\)/,
    "the Node SCRAM fencing probe supplies its candidate as the required string type");
  assert.match(qualifier, /postflight_authority_drift_observation/);
  assert.match(nativeSource, /LOCK TABLE pg_catalog\.pg_proc IN SHARE ROW EXCLUSIVE MODE/,
    "the native transaction locks the function catalog before authority reads");
  assert.match(nativeSource, /LOCK TABLE pg_catalog\.pg_authid IN SHARE ROW EXCLUSIVE MODE/,
    "the native transaction fences role-attribute mutations before authority reads");
  assert.match(nativeSource, /LOCK TABLE pg_catalog\.pg_auth_members IN SHARE ROW EXCLUSIVE MODE/,
    "the native transaction serializes membership mutations before authority reads");
  assert.match(nativeSource, /LOCK TABLE pg_catalog\.pg_db_role_setting IN SHARE ROW EXCLUSIVE MODE/,
    "the native transaction fences per-database role settings before authority reads");
  assert.match(qualifier, /const postflightMutation = await fixture\.connect\(\)/,
    "postflight mutations run without an external fixture lock masking the native lock");
  assert.doesNotMatch(qualifier, /postflightLock/, "the regression must exercise native-held catalog locks");
  assert.match(qualifier, /authority_drift_delivery_invoked/);
  assert.match(qualifier, /authority_drift_delivery_mutation_not_applied/);
  assert.match(qualifier, /authority_drift_delivery_blocked_by_authority_lock/);
  assert.match(qualifier, /authority_drift_membership_delivery_mutation_not_applied/);
  assert.match(qualifier, /authority_drift_membership_delivery_blocked_by_authority_lock/);
  assert.match(qualifier, /authority_drift_native_rejected_after_delivery/);
  assert.match(qualifier, /postcommit_authority_drift_observation/);
  assert.match(qualifier, /authority_drift_postcommit_delivery_invoked/);
  assert.match(qualifier, /authority_drift_postcommit_assignment_committed/);
  assert.match(qualifier, /authority_drift_postcommit_mutation_committed/);
  assert.match(qualifier, /authority_drift_postcommit_next_native_boundary_rejected/);
  assert.match(qualifier, /authority_drift_postcommit_restored_authority_inspects/);
  const postcommit = qualifier.slice(qualifier.indexOf("const appliedAssignment ="),
    qualifier.indexOf('stage = "bounded_production_concurrency"'));
  assert.match(postcommit, /appliedAssignment\.ack === true && appliedAssignment\.committed === true &&\s*appliedAssignment\.storeAcknowledged === true/);
  assert.doesNotMatch(postcommit.slice(0, postcommit.indexOf("authority_drift_postcommit_assignment_committed")),
    /fixture\.control\.query|CREATE OR REPLACE FUNCTION/,
    "administrator mutation must not wait on native-held locks inside delivery");
  assert.match(postcommit, /authority_drift_postcommit_assignment_committed[\s\S]*?CREATE OR REPLACE FUNCTION[\s\S]*?appliedMutation = true[\s\S]*?postflightNative\.inspect/);
  assert.match(postcommit, /finally \{\s*if \(appliedMutation\) await fixture\.control\.query/);
  assert.match(qualifier, /authority_rpc_drift_observation/);
  assert.match(qualifier, /mutationErrorCategory/);
  assert.match(qualifier, /same_signature_authority_rpc_mutation_applied/);
  assert.match(qualifier, /same_signature_authority_rpc_body_drift_rejected/);
});

test("portable catalog qualification executes exact phase predicates from CI", () => {
  const qualifier = readFileSync(resolve(root,
    "tools/native-broker-provisioning/tests/production-catalog-qualify.cjs"), "utf8");
  const harness = readFileSync(resolve(root,
    "tools/native-broker-provisioning/tests/production-catalog-qualify.c"), "utf8");
  const bootstrap = readFileSync(resolve(root,
    "tools/native-broker-provisioning/tests/bootstrap.cjs"), "utf8");
  const workflow = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const migration = readFileSync(resolve(root,
    "supabase/migrations/20260902191325_square_production_internal_pilot_runtime.sql"), "utf8");
  const nativeSource = readFileSync(resolve(root, "tools/native-broker-provisioning/native.c"), "utf8");
  const catalogVerifier = nativeSource.slice(
    nativeSource.indexOf("static bool production_internal_runtime_functions_valid"),
    nativeSource.indexOf("static bool production_internal_runtime_contract_valid"),
  );
  const authorityVerifier = nativeSource.slice(
    nativeSource.indexOf("static bool production_authority_valid"),
    nativeSource.indexOf("#ifdef VAEROEX_SYNTHETIC_ONLY", nativeSource.indexOf("static bool production_authority_valid")),
  );
  assert.match(qualifier, /20260902191323_integration_production_runtime_foundation\.sql/);
  assert.match(qualifier, /20260902191324_square_production_runtime_overlay\.sql/);
  assert.match(qualifier, /VAEROEX_PRODUCTION_INTERNAL_RUNTIME_MIGRATION/);
  assert.match(qualifier, new RegExp(productionSourcePins.internalRuntimeSha256));
  assert.match(qualifier, /const foundationSource = fs\.readFileSync\(foundation\)/);
  assert.match(qualifier, /const overlaySource = fs\.readFileSync\(overlay\)/);
  assert.match(qualifier, /const internalSource = internal \? fs\.readFileSync\(internal\) : null/);
  assert.match(qualifier, /"-f", "-"/);
  assert.match(qualifier, /input: source/);
  assert.doesNotMatch(qualifier, /psql\(\["-f", (?:foundation|overlay|internal)\]/);
  assert.match(qualifier, /baseline_triggers/);
  assert.match(qualifier, /internal_triggers/);
  assert.match(qualifier, /parentTriggers\.length === 2/);
  assert.match(qualifier, /trigger_record\.tgrelid='public\.business_entities'::regclass/);
  assert.match(qualifier, /DISABLE TRIGGER "\$\{name\}"[\s\S]*qualify\(internalBinary, "internal_triggers"\)/);
  const internalTriggerVerifier = nativeSource.slice(
    nativeSource.indexOf("static bool production_internal_runtime_triggers_valid"),
    nativeSource.indexOf("static bool production_internal_runtime_functions_valid"),
  );
  assert.match(internalTriggerVerifier, /crn\.nspname='private'[\s\S]*c\.contype='f'/,
    "native validation includes parent-side triggers declared by protected foreign keys");
  assert.match(qualifier, /catalog_contract_positive_\$\{match\[1\]\}/);
  assert.match(qualifier, /"internal_functions"/);
  assert.match(qualifier, /internalSourceAtOverlay = "exact_103_qualified"/);
  assert.match(qualifier, /qualify\(overlayBinary, "closed_authority"\)/);
  assert.match(qualifier, /baselineSourceAtInternal = "exact_104_rejected"/);
  assert.match(qualifier, /CREATE DOMAIN extensions\.vector AS text/);
  assert.match(qualifier, /CREATE FUNCTION public\.match_business_memory_chunks/);
  assert.match(qualifier, /CREATE FUNCTION public\.set_updated_at\(\) RETURNS trigger/);
  assert.match(qualifier, /CREATE TRIGGER set_production_catalog_legacy_update_fixture_updated_at/);
  assert.match(qualifier, /CREATE TABLE public\.business_entities/);
  assert.match(qualifier, /fs\.realpathSync\("\/tmp"\), "vpcs-"/);
  assert.match(qualifier, /Buffer\.byteLength\(path\.join\(socket\(\), `\.s\.PGSQL\.\$\{port\}`\)\) < 104/);
  assert.match(qualifier, /process\.once\("SIGINT", \(\) => terminate\("SIGINT"\)\)/);
  assert.match(qualifier, /process\.once\("SIGTERM", \(\) => terminate\("SIGTERM"\)\)/);
  assert.match(harness, /VAEROEX_CATALOG_SOCKET_PATH/);
  assert.doesNotMatch(harness, /strncmp\(argv\[1\],"\/private\/"/);
  assert.match(bootstrap, /"pg_stat_statements", "auto_explain", "pgcrypto"/);
  assert.match(workflow, /pnpm test:native-broker-production-catalog/);
  for (const functionName of [
    "private.square_production_internal_reject_immutable_mutation_v1",
    "private.square_production_internal_guard_lifecycle_update_v1",
    "private.square_production_internal_require_keys_v1",
    "private.square_production_internal_fingerprint_v1",
    "private.square_production_internal_audit_v1",
    "private.square_production_internal_require_login_v1",
    "private.square_production_internal_lock_permit_v1",
    "private.square_production_internal_install_permit_v1",
    "public.square_production_internal_oauth_v1",
    "public.square_production_internal_broker_v1",
    "public.square_production_internal_runtime_v1",
    "public.square_production_internal_evidence_v1",
  ]) {
    const start = migration.indexOf(`create function ${functionName}`);
    assert.ok(start >= 0, `${functionName} exists in the pinned migration`);
    const bodyStart = migration.indexOf("as $function$", start) + "as $function$".length;
    const bodyEnd = migration.indexOf("$function$", bodyStart);
    const bodyHash = createHash("sha256").update(migration.slice(bodyStart, bodyEnd)).digest("hex");
    assert.match(nativeSource, new RegExp(bodyHash),
      `${functionName} catalog predicate pins its exact PostgreSQL function body`);
    const operationalMatch = /^public\.square_production_internal_(oauth|broker|runtime|evidence)_v1$/.exec(functionName);
    if (operationalMatch) {
      assert.match(catalogVerifier, new RegExp(
        `${functionName.replaceAll(".", "\\.")}\\(text,jsonb\\)'[\\s\\S]{0,300}'${bodyHash}'`,
      ), `${functionName} canonical catalog entry pins its exact migration body hash`);
      assert.match(authorityVerifier, new RegExp(
        `production_named_authority_valid\\("square_production_${operationalMatch[1]}_authority",[\\s\\S]{0,180}`
        + `${functionName.replaceAll(".", "\\.")}\\(text,jsonb\\)\",[\\s\\S]{0,100}\"${bodyHash}\"`,
      ), `${functionName} authority mapping reuses its canonical catalog body hash`);
    }
  }
});

test("verified private Production identity is exact and Sandbox factory is unchanged", () => {
  assert.deepEqual(productionDatabaseIdentity, {
    projectReference: "mdiianhfrojmxqpwrflh", region: "us-west-2",
    directIdentityHost: "db.mdiianhfrojmxqpwrflh.supabase.co", database: "postgres",
    databaseOid: "5", systemIdentifier: "7642734024280108049", postgresBuild: "17.6.1.127",
  });
  assert.deepEqual(productionDeploymentBinding, {
    status: "reviewed_ready",
    connectionHost: "aws-1-us-west-2.pooler.supabase.com", connectionPort: 5432,
    rootCertificate: "/etc/vaeroex-production-native/supabase-root-2021.crt",
    provisionerProjectId: "vaeroex-integrations-prod", provisionerInstanceId: "6328469880854922663",
    provisionerZone: "us-west1-b",
    provisionerServiceAccount: "sq-prod-provisioner@vaeroex-integrations-prod.iam.gserviceaccount.com",
    provisionerProjectNumber: "711446392261", adminRole: "postgres",
    rootCaSha256: "700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7",
  });
  assert.equal(hash("tools/jit-access-feasibility/supabase-root-2021.crt"), productionDeploymentBinding.rootCaSha256);
  for (const name of names) {
    const built = productionProvisioningBuildProfile(name);
    assert.deepEqual(built, {
      kind: "production", name,
      install: `/opt/vaeroex-production-square-${name}`, state: `/var/lib/vaeroex-production-square-${name}`,
      target: { projectReference: "mdiianhfrojmxqpwrflh", host: productionDeploymentBinding.connectionHost,
        port: 5432, database: "postgres", role: `square_production_${name}`,
        systemIdentifier: "7642734024280108049", databaseOid: "5", adminRole: "postgres",
        capabilityRole: `square_production_${name}_authority`, rootCertificate: productionDeploymentBinding.rootCertificate,
        roleOid: "0" },
      maintenance: { projectId: "vaeroex-integrations-prod", projectNumber: "711446392261",
        instanceId: "6328469880854922663", zone: "us-west1-b",
        serviceAccount: productionDeploymentBinding.provisionerServiceAccount,
        secretParent: `projects/vaeroex-integrations-prod/secrets/square-production-${name}-db`,
        caSha256: productionDeploymentBinding.rootCaSha256 },
    });
  }
  const profile = productionProvisioningProfile("oauth");
  const target = Object.freeze({ projectReference: "synthetic-production", host: "127.0.0.1", port: 5432,
    database: "postgres", role: profile.role, systemIdentifier: "1", databaseOid: "5", adminRole: "synthetic_owner",
    capabilityRole: profile.capabilityRole, rootCertificate: "/tmp/nonsecret-test-ca", roleOid: "0" });
  assert.throws(() => createLocalSyntheticNativeAdapter({ executable: "/tmp/native", target }), /local_synthetic_native_operation_failed/);
  assert.ok(createLocalSyntheticProductionNativeAdapter({ executable: "/tmp/native", target }));
  for (const malformed of [undefined, {}, { ...target, projectReference: "synthetic" },
    { ...target, host: "localhost" }, { ...target, role: "square_production_oauth_other" },
    { ...target, capabilityRole: "square_production_broker_authority" },
    Object.fromEntries(Object.entries(target).filter(([key]) => key !== "roleOid"))]) {
    assert.throws(() => createLocalSyntheticProductionNativeAdapter({ executable: "/tmp/native", target: malformed }),
      /local_synthetic_native_operation_failed/);
  }
});

test("every missing deployment identity field still denies all six native builds", async () => {
  const source = readFileSync(resolve(root, "tools/native-broker-provisioning/production-profile.mjs"), "utf8");
  const start = source.indexOf("export const productionDeploymentBinding = Object.freeze({");
  const end = source.indexOf("\n});", start) + "\n});".length;
  assert.ok(start >= 0 && end > start);
  for (const field of Object.keys(productionDeploymentBinding)) {
    const binding = { ...productionDeploymentBinding, [field]: null };
    const changed = source.slice(0, start) +
      `export const productionDeploymentBinding = Object.freeze(${JSON.stringify(binding)});` + source.slice(end);
    const fixture = await import(`data:text/javascript;base64,${Buffer.from(changed).toString("base64")}`);
    for (const name of names) assert.throws(() => fixture.productionProvisioningBuildProfile(name),
      /production_native_deployment_manifest_required/, field);
  }
});

test("synthetic secret stores opt into exactly one target family", async () => {
  const profile = productionProvisioningProfile("runtime");
  const productionTarget = Object.freeze({ projectReference: "synthetic-production", host: "127.0.0.1", port: 5432,
    database: "postgres", role: profile.role, systemIdentifier: "1", databaseOid: "5", adminRole: "synthetic_owner",
    capabilityRole: profile.capabilityRole, rootCertificate: "/tmp/nonsecret-test-ca", roleOid: "0" });
  const productionStore = createInMemorySyntheticSecretStore({ production: true });
  const handle = productionStore.reserve({ target: productionTarget, intent: "production-store" });
  assert.equal((await productionStore.discard(handle)).ack, true);
  assert.throws(() => productionStore.reserve({ target: sandboxTarget, intent: "sandbox-store" }));
  assert.throws(() => createInMemorySyntheticSecretStore({ production: "true" }));
  assert.throws(() => createInMemorySyntheticSecretStore().reserve({ target: productionTarget, intent: "wrong-store" }));
});
