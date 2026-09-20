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
  assert.match(nativeSource, /CREATE ROLE",target,[\s\S]*?NOLOGIN[\s\S]*?NOINHERIT/);
  assert.match(nativeSource, /WITH ADMIN FALSE, INHERIT FALSE, SET FALSE/);
  assert.match(nativeSource, /if \(!strcmp\(op,"fence"\)\) ok = role_command\("GRANT " CAPABILITY " TO",target,[\s\S]*?INHERIT FALSE, SET FALSE/);
  assert.match(nativeSource, /if \(ok && !strcmp\(op,"activate"\)\) \{[\s\S]*?INHERIT TRUE, SET FALSE/);
  assert.match(nativeSource, /target_role\.rolcanlogin AND target_role\.rolinherit AND m\.inherit_option/);
  assert.match(nativeSource, /NOT target_role\.rolcanlogin AND NOT target_role\.rolinherit AND NOT m\.inherit_option/);
  assert.match(qualifier, /existing_session_loses_effective_rpc_before_session_termination/);
  assert.match(qualifier, /active_login_with_noninheriting_capability_membership_rejected/);
  assert.match(qualifier, /noncurrent_profile_privilege_drift_blocks_current_profile_before_mutation/);
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
  assert.match(qualifier, /postflight_authority_drift_applied_observation/);
  assert.match(qualifier, /authority_drift_applied_delivery_invoked/);
  assert.match(qualifier, /authority_drift_applied_mutation_committed/);
  assert.match(qualifier, /authority_drift_applied_native_rejected_after_delivery/);
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

test("unverified hosted identity pins remain non-executable and Sandbox factory is unchanged", () => {
  assert.deepEqual(productionDatabaseIdentity, {
    projectReference: "mdiianhfrojmxqpwrflh", region: "us-west-2",
    directIdentityHost: "db.mdiianhfrojmxqpwrflh.supabase.co", database: "postgres",
    databaseOid: "5", systemIdentifier: "7642734024280108049", postgresBuild: "17.6.1.127",
  });
  assert.equal(productionDeploymentBinding.status, "blocked_pending_reviewed_identity_manifest");
  assert.ok(Object.entries(productionDeploymentBinding).filter(([key]) => key !== "status").every(([, value]) => value === null));
  for (const name of names) assert.throws(() => productionProvisioningBuildProfile(name),
    /production_native_deployment_manifest_required/);
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
