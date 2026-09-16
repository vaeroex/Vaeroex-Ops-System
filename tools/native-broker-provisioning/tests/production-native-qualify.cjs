"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- Offline native qualification CLI. */
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
if (process.argv.length !== 2) { process.stdout.write('{"outcome":"remote_inputs_rejected"}\n'); process.exit(2); }
const { createFixture, command, pgRoot, admin } = require("./fixture.cjs");
let fixture, stage = "dependencies", assertions = 0;
const candidates = new Map();
const check = (value, name) => { assertions++; if (!value) { stage = name; throw new Error("production_native_failed"); } };
const repository = path.resolve(__dirname, "../../..");
const overlaySource = fs.readFileSync(path.join(repository,
  "supabase/migrations/20260902191324_square_production_runtime_overlay.sql"), "utf8");
const operationalStart = overlaySource.indexOf("create function private.check_square_production_operational_generation_v1(");
const operationalOpen = overlaySource.indexOf("$function$", operationalStart);
const operationalClose = overlaySource.indexOf("$function$", operationalOpen + "$function$".length);
const productionOperationalAuthoritySource = operationalStart >= 0 && operationalOpen > operationalStart && operationalClose > operationalOpen
  ? overlaySource.slice(operationalOpen + "$function$".length, operationalClose) : null;
if (productionOperationalAuthoritySource === null ||
    require("node:crypto").createHash("sha256").update(productionOperationalAuthoritySource).digest("hex") !==
      "9f88e3f2787d4e7a30f66e4a42b00a8044b0c51cd69f9368b4bb9f45c0f8fdab") {
  process.stdout.write('{"outcome":"failed","stage":"production_source_pin"}\n'); process.exit(1);
}
const productionAuthoritySource = profile => `
begin
  if not pg_catalog.pg_has_role(session_user,'${profile.capabilityRole}','MEMBER') then
    raise exception '${profile.capabilityRole}_denied' using errcode='42501';
  end if;
  perform private.check_square_production_operational_generation_v1(
    p_provider_key,p_environment,p_project_id,p_generation,p_configuration_fingerprint,'${profile.name}');
end
`;

async function main() {
  const profilesModule = await import(pathToFileURL(path.resolve(__dirname, "../production-profile.mjs")));
  const adapterModule = await import(pathToFileURL(path.resolve(__dirname, "../adapter.mjs")));
  const lifecycleModule = await import(pathToFileURL(path.resolve(__dirname, "../lifecycle.mjs")));
  const profiles = profilesModule.productionProvisioningProfiles();
  const overlayRpc = profile => profilesModule.productionAuthorityRpc(profile.name, "overlay");
  fixture = await createFixture();
  stage = "production_shape";
  await fixture.control.query(`
    CREATE SCHEMA extensions;
    ALTER EXTENSION pg_stat_statements SET SCHEMA extensions;
    REVOKE ALL ON SCHEMA extensions FROM PUBLIC;
    CREATE TABLE private.integration_production_platform_bindings(
      infrastructure_provisioned boolean NOT NULL DEFAULT false,runtime_enabled boolean NOT NULL DEFAULT false,
      economic_contributions_enabled boolean NOT NULL DEFAULT false,ai_dispatch_enabled boolean NOT NULL DEFAULT false);
    CREATE TABLE private.integration_production_provider_bindings(
      provider_key text NOT NULL,environment text NOT NULL,enabled boolean NOT NULL DEFAULT false,
      provider_calls_enabled boolean NOT NULL DEFAULT false,customer_onboarding_enabled boolean NOT NULL DEFAULT false,
      webhook_intake_enabled boolean NOT NULL DEFAULT false,evidence_enabled boolean NOT NULL DEFAULT false,
      economic_contributions_enabled boolean NOT NULL DEFAULT false,ai_dispatch_enabled boolean NOT NULL DEFAULT false);
    CREATE TABLE private.integration_production_provider_secrets(marker boolean);
    CREATE TABLE private.integration_production_provider_capabilities(
      provider_key text NOT NULL,environment text NOT NULL,project_id text NOT NULL,capability text NOT NULL,
      database_login name,database_secret_purpose text);
    CREATE TABLE private.square_production_configuration_generations(
      runtime_enabled boolean NOT NULL DEFAULT false,provider_calls_enabled boolean NOT NULL DEFAULT false,
      customer_onboarding_enabled boolean NOT NULL DEFAULT false,webhook_intake_enabled boolean NOT NULL DEFAULT false,
      evidence_enabled boolean NOT NULL DEFAULT false,economic_contributions_enabled boolean NOT NULL DEFAULT false,
      ai_dispatch_enabled boolean NOT NULL DEFAULT false);
    CREATE TABLE private.square_production_runtime_bindings(marker boolean);
    CREATE TABLE private.square_production_generation_fences(marker boolean);
    CREATE TABLE private.square_production_lifecycle_audit_events(marker boolean);
    CREATE TABLE private.production_business_probe(secret text);
    ALTER TABLE private.integration_production_platform_bindings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.integration_production_platform_bindings FORCE ROW LEVEL SECURITY;
    ALTER TABLE private.integration_production_provider_bindings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.integration_production_provider_bindings FORCE ROW LEVEL SECURITY;
    ALTER TABLE private.integration_production_provider_secrets ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.integration_production_provider_secrets FORCE ROW LEVEL SECURITY;
    ALTER TABLE private.integration_production_provider_capabilities ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.integration_production_provider_capabilities FORCE ROW LEVEL SECURITY;
    ALTER TABLE private.square_production_configuration_generations ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.square_production_configuration_generations FORCE ROW LEVEL SECURITY;
    ALTER TABLE private.square_production_runtime_bindings ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.square_production_runtime_bindings FORCE ROW LEVEL SECURITY;
    ALTER TABLE private.square_production_generation_fences ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.square_production_generation_fences FORCE ROW LEVEL SECURITY;
    ALTER TABLE private.square_production_lifecycle_audit_events ENABLE ROW LEVEL SECURITY;
    ALTER TABLE private.square_production_lifecycle_audit_events FORCE ROW LEVEL SECURITY;
    INSERT INTO private.integration_production_platform_bindings DEFAULT VALUES;
    INSERT INTO private.integration_production_provider_bindings(provider_key,environment) VALUES('square','production');
  `);
  await fixture.control.query(`SET check_function_bodies=off;
    CREATE FUNCTION private.check_square_production_operational_generation_v1(
    p_provider_key text,p_environment text,p_project_id text,p_generation bigint,
    p_configuration_fingerprint text,p_capability text
  ) RETURNS void LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS
    $function$${productionOperationalAuthoritySource}$function$;
    REVOKE ALL ON FUNCTION private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text) FROM PUBLIC;
    SET check_function_bodies=on;`);
  // This bootstrap-superuser fixture has no automatic creator membership. A
  // separate non-superuser CREATEROLE member below proves that a count-correct
  // but identity-substituted ADMIN edge is rejected.
  for (const profile of profiles) {
    await fixture.control.query(`CREATE ROLE ${profile.capabilityRole} NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
    await fixture.control.query(`GRANT USAGE ON SCHEMA public TO ${profile.capabilityRole}`);
    await fixture.control.query(`CREATE FUNCTION public.check_square_production_${profile.name}_authority_v1(
      p_provider_key text,p_environment text,p_project_id text,p_generation bigint,p_configuration_fingerprint text
    ) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$${productionAuthoritySource(profile)}$function$`);
    await fixture.control.query(`REVOKE ALL ON FUNCTION ${overlayRpc(profile)} FROM PUBLIC`);
    await fixture.control.query(`GRANT EXECUTE ON FUNCTION ${overlayRpc(profile)} TO ${profile.capabilityRole}`);
    await fixture.control.query(`INSERT INTO private.integration_production_provider_capabilities
      (provider_key,environment,project_id,capability,database_login,database_secret_purpose)
      VALUES('square','production','vaeroex-integrations-prod',$1,$2,$3)`,
    [profile.name, profile.role, `database_${profile.name}`]);
  }
  stage = "production_function_abi";
  const helperAbi = (await fixture.control.query(`SELECT proargnames,proargmodes FROM pg_proc
    WHERE oid='private.check_square_production_operational_generation_v1(text,text,text,bigint,text,text)'::regprocedure`)).rows[0];
  check(helperAbi && JSON.stringify(helperAbi.proargnames) === JSON.stringify([
    "p_provider_key", "p_environment", "p_project_id", "p_generation", "p_configuration_fingerprint", "p_capability",
  ]) && helperAbi.proargmodes === null, "operational_helper_named_sql_parameters_exact");
  for (const profile of profiles) {
    const wrapperAbi = (await fixture.control.query("SELECT proargnames,proargmodes FROM pg_proc WHERE oid=$1::regprocedure",
      [overlayRpc(profile)])).rows[0];
    check(wrapperAbi && JSON.stringify(wrapperAbi.proargnames) === JSON.stringify([
      "p_provider_key", "p_environment", "p_project_id", "p_generation", "p_configuration_fingerprint",
    ]) && wrapperAbi.proargmodes === null, `${profile.name}_wrapper_named_sql_parameters_exact`);
  }
  const source = path.resolve(__dirname, "../native.c");
  const flags = ["-std=c11", "-Wall", "-Wextra", "-Werror", "-pthread", "-I" + path.join(pgRoot, "include"),
    "-L" + path.join(pgRoot, "lib"), "-Wl,-rpath," + path.join(pgRoot, "lib"), "-DVAEROEX_SYNTHETIC_ONLY", source, "-lpq"];
  const singleProfile = spawnSync("/usr/bin/cc", ["-std=c11", "-fsyntax-only", "-I" + path.join(pgRoot, "include"),
    "-DVAEROEX_PRODUCTION_OAUTH", source], { encoding: "utf8", timeout: 20000 });
  check(singleProfile.status === 0, "single_production_native_profile_builds");
  const mixedProfile = spawnSync("/usr/bin/cc", ["-std=c11", "-fsyntax-only", "-I" + path.join(pgRoot, "include"),
    "-DVAEROEX_PRODUCTION_OAUTH", "-DVAEROEX_MAPPED_RUNTIME", source], { encoding: "utf8", timeout: 20000 });
  check(mixedProfile.status !== 0, "mixed_sandbox_and_production_native_profiles_reject_at_build_time");
  const launcherSource = path.resolve(__dirname, "../maintenance-launcher.c");
  const launcherFixtureFlags = ["-DVAEROEX_LAUNCHER_SYNTHETIC_ONLY", `-DVAEROEX_TEST_NODE=${JSON.stringify(process.execPath)}`,
    "-DVAEROEX_TEST_INSTALL=\"/private/tmp/production-native-qualify\""];
  const singleLauncher = spawnSync("/usr/bin/cc", ["-std=c11", "-fsyntax-only", ...launcherFixtureFlags, "-DVAEROEX_PRODUCTION_OAUTH", launcherSource],
    { encoding: "utf8", timeout: 20000 });
  check(singleLauncher.status === 0, "single_production_launcher_builds");
  const mixedLauncher = spawnSync("/usr/bin/cc", ["-std=c11", "-fsyntax-only", ...launcherFixtureFlags, "-DVAEROEX_PRODUCTION_OAUTH",
    "-DVAEROEX_MAPPED_RUNTIME", launcherSource], { encoding: "utf8", timeout: 20000 });
  check(mixedLauncher.status !== 0, "mixed_sandbox_and_production_launchers_reject_at_build_time");
  const binaries = new Map();
  for (const profile of profiles) {
    const binary = path.join(fixture.root, `production-${profile.name}`);
    command("/usr/bin/cc", [...flags.slice(0, -2), `-DVAEROEX_PRODUCTION_${profile.name.toUpperCase()}`, ...flags.slice(-2), "-o", binary]);
    binaries.set(profile.name, binary);
  }

  const makeTarget = profile => Object.freeze({
    projectReference: "synthetic-production", host: "127.0.0.1", port: fixture.port, database: "postgres",
    role: profile.role, systemIdentifier: fixture.systemId, databaseOid: fixture.databaseOid, adminRole: admin,
    capabilityRole: profile.capabilityRole, rootCertificate: fixture.cert, roleOid: "0",
  });
  const productionAuthorityDiagnostic = profile => {
    const target = makeTarget(profile);
    const result = spawnSync(binaries.get(profile.name), ["diagnose", target.host, String(target.port), target.database,
      target.adminRole, target.role, target.capabilityRole, target.systemIdentifier, target.databaseOid,
      target.rootCertificate, "post-mutation-authority-diagnostic", target.roleOid, "synthetic-production"], {
      env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, encoding: "utf8", maxBuffer: 8192,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    check(result.status === 0 && !result.error, "post_mutation_authority_diagnostic_completed");
    const line = result.stdout.trim();
    let value;
    try { value = JSON.parse(line); } catch { value = null; }
    const names = ["identity", "profile", "platformClosed", "providerClosed", "configurationClosed", "capabilityClosed",
      "closedAuthority", "targetLock", "phaseValid", "productionContract", "brokerWrapperShape", "brokerHelper",
      "brokerCapabilityRole", "brokerNoMembership", "brokerTargetAbsent", "brokerPublicUsage", "brokerExecuteAcl", "brokerPrivateClosed",
      "oauthAuthority", "brokerAuthority", "schedulerAuthority", "webhookAuthority", "runtimeAuthority", "evidenceAuthority",
      "brokerCapabilityExists", "brokerWrapperExists"];
    check(value?.outcome === "production_authority_diagnostic" && names.every(name => typeof value[name] === "boolean"),
      "post_mutation_authority_diagnostic_shape");
    const queryCategories = ["none", "undefined_column", "undefined_function", "undefined_table", "syntax", "datatype", "permission", "aborted_transaction", "other_sqlstate", "transport", "other"];
    const categoryNames = ["oauth", "broker", "scheduler", "webhook", "runtime", "evidence"];
    const functionCategoryNames = ["schema", "function", "table", "column", "sequence", "fdw", "server", "tablespace", "parameter", "role", "aclexplode", "acldefault", "regprocedure", "digest", "convertTo", "digestTyped", "getExpr"];
    check(categoryNames.every(name => queryCategories.includes(value?.[`${name}QueryCategory`])),
      "post_mutation_authority_query_category_shape");
    check(functionCategoryNames.every(name => queryCategories.includes(value?.[`${name}Category`])),
      "post_mutation_authority_function_category_shape");
    process.stdout.write(JSON.stringify({ outcome: "post_mutation_authority_observation", ...Object.fromEntries(
      names.map(name => [name, value?.[name] === true]),
    ), brokerRoleExists: value?.brokerRoleExists === true, oauthQueryError: value?.oauthQueryError === true, oauthQueryCategory: value?.oauthQueryCategory,
    brokerQueryError: value?.brokerQueryError === true, brokerQueryCategory: value?.brokerQueryCategory,
    schedulerQueryError: value?.schedulerQueryError === true, webhookQueryError: value?.webhookQueryError === true,
    schedulerQueryCategory: value?.schedulerQueryCategory, webhookQueryCategory: value?.webhookQueryCategory,
    runtimeQueryError: value?.runtimeQueryError === true, runtimeQueryCategory: value?.runtimeQueryCategory,
    evidenceQueryError: value?.evidenceQueryError === true, evidenceQueryCategory: value?.evidenceQueryCategory,
    schemaCategory: value?.schemaCategory, functionCategory: value?.functionCategory, tableCategory: value?.tableCategory,
    columnCategory: value?.columnCategory, sequenceCategory: value?.sequenceCategory, fdwCategory: value?.fdwCategory,
    serverCategory: value?.serverCategory, tablespaceCategory: value?.tablespaceCategory, parameterCategory: value?.parameterCategory,
    roleCategory: value?.roleCategory, aclexplodeCategory: value?.aclexplodeCategory, acldefaultCategory: value?.acldefaultCategory,
    regprocedureCategory: value?.regprocedureCategory, digestCategory: value?.digestCategory, convertToCategory: value?.convertToCategory,
    digestTypedCategory: value?.digestTypedCategory, getExprCategory: value?.getExprCategory }) + "\n");
    for (const name of names) check(value[name] === true, `post_mutation_authority_${name}`);
  };
  stage = "precreate_capability_creator_substitution";
  const preCreateProfile = profiles[0], preCreateTarget = makeTarget(preCreateProfile);
  await fixture.control.query("CREATE ROLE synthetic_precreate_extra_operator NOLOGIN CREATEROLE NOSUPERUSER NOCREATEDB NOREPLICATION NOBYPASSRLS");
  await fixture.control.query(`GRANT ${preCreateProfile.capabilityRole} TO synthetic_precreate_extra_operator WITH ADMIN TRUE, INHERIT FALSE, SET FALSE`);
  const preCreateNative = adapterModule.createLocalSyntheticProductionNativeAdapter({
    executable: binaries.get(preCreateProfile.name), target: preCreateTarget,
  });
  let preCreateMembershipDenied = false;
  try {
    await preCreateNative.inspect({ target: preCreateTarget, intent: "precreate-capability-membership-drift",
      approvalId: "synthetic-production", signal: new AbortController().signal });
  } catch { preCreateMembershipDenied = true; }
  check(preCreateMembershipDenied, "substituted_creator_admin_edge_rejected_before_target_creation");
  const preCreateTargetAbsent = (await fixture.control.query(
    "SELECT NOT EXISTS (SELECT FROM pg_roles WHERE rolname=$1) absent", [preCreateProfile.role],
  )).rows[0];
  check(preCreateTargetAbsent && preCreateTargetAbsent.absent, "precreate_membership_drift_leaves_no_target_role");
  await fixture.control.query(`REVOKE ${preCreateProfile.capabilityRole} FROM synthetic_precreate_extra_operator`);
  await fixture.control.query("DROP ROLE synthetic_precreate_extra_operator");
  stage = "capability_parameter_acl";
  await fixture.control.query(`GRANT SET ON PARAMETER session_replication_role TO ${preCreateProfile.capabilityRole}`);
  const directParameterDependency = (await fixture.control.query(`SELECT count(*)::integer count
    FROM pg_catalog.pg_shdepend WHERE refclassid='pg_authid'::regclass
      AND refobjid=$1::regrole AND deptype='a'
      AND classid='pg_parameter_acl'::regclass AND objsubid=0
      AND objid=(SELECT oid FROM pg_catalog.pg_parameter_acl
        WHERE parname='session_replication_role')`, [preCreateProfile.capabilityRole])).rows[0];
  check(directParameterDependency?.count === 1, "direct_parameter_acl_creates_shared_acl_dependency");
  let directParameterDenied = false;
  try {
    await preCreateNative.inspect({ target: preCreateTarget, intent: "direct-parameter-authority-drift",
      approvalId: "synthetic-production", signal: new AbortController().signal });
  } catch { directParameterDenied = true; }
  check(directParameterDenied, "direct_parameter_acl_rejected");
  await fixture.control.query(`REVOKE SET ON PARAMETER session_replication_role FROM ${preCreateProfile.capabilityRole}`);
  await fixture.control.query("GRANT SET ON PARAMETER session_replication_role TO PUBLIC");
  const publicParameterDependency = (await fixture.control.query(`SELECT count(*)::integer count
    FROM pg_catalog.pg_shdepend WHERE refclassid='pg_authid'::regclass
      AND refobjid=$1::regrole AND deptype='a'
      AND classid='pg_parameter_acl'::regclass AND objsubid=0
      AND objid=(SELECT oid FROM pg_catalog.pg_parameter_acl
        WHERE parname='session_replication_role')`, [preCreateProfile.capabilityRole])).rows[0];
  check(publicParameterDependency?.count === 0, "public_parameter_acl_has_no_role_dependency");
  let publicParameterDenied = false;
  try {
    await preCreateNative.inspect({ target: preCreateTarget, intent: "public-parameter-authority-drift",
      approvalId: "synthetic-production", signal: new AbortController().signal });
  } catch { publicParameterDenied = true; }
  check(publicParameterDenied, "effective_public_parameter_acl_rejected");
  await fixture.control.query("REVOKE SET ON PARAMETER session_replication_role FROM PUBLIC");
  stage = "failure_fence";
  const failedProfile = profiles[0], failedTarget = makeTarget(failedProfile);
  const failedNative = adapterModule.createLocalSyntheticProductionNativeAdapter({ executable: binaries.get(failedProfile.name), target: failedTarget });
  const baseStore = lifecycleModule.createInMemorySyntheticSecretStore({ production: true });
  const failingStore = { ...baseStore, async withCredential() { throw new Error("synthetic_auth_read_denied"); } };
  const failedCoordinator = lifecycleModule.createSyntheticProductionProvisioningCoordinator({ target: failedTarget, native: failedNative,
    secretStore: failingStore, audit: { async append() { return { ack: true }; } } });
  const failed = await failedCoordinator.run({ operation: "create", actor: "synthetic-owner", intent: "production-failure-fence",
    approvalId: "synthetic-production", deadlineMs: 30000, cleanupTimeoutMs: 5000 });
  // This failure is before target-role creation, so there is no identity to
  // fence. Recovery is still mandatory; the post-mutation case below proves
  // that a committed role is fenced when one exists.
  check(!failed.fenceConfirmed && failed.requiresFreshReplacement, "precreate_failure_requires_recovery_without_target_fence");
  const role = (await fixture.control.query("SELECT rolcanlogin,rolinherit FROM pg_roles WHERE rolname=$1", [failedProfile.role])).rows[0];
  check(!role, "precreate_failure_leaves_no_production_login");

  // A store failure happens only after native assignment mutates an exact
  // existing role identity. Use the actual create path so native prepare,
  // capability membership, and its acknowledged role OID establish the
  // production closed-state contract before the injected store failure.
  const postMutationProfile = profiles[1];
  const postMutationTarget = makeTarget(postMutationProfile);
  const postMutationNativeBase = adapterModule.createLocalSyntheticProductionNativeAdapter({
    executable: binaries.get(postMutationProfile.name), target: postMutationTarget,
  });
  let postMutationRoleOid = "0";
  const postMutationNative = Object.freeze({
    ...postMutationNativeBase,
    async prepare(context) {
      const prepared = await postMutationNativeBase.prepare(context);
      postMutationRoleOid = prepared.roleOid;
      return prepared;
    },
    async fence(context) {
      return postMutationNativeBase.fence(Object.freeze({ ...context,
        target: Object.freeze({ ...context.target, roleOid: postMutationRoleOid }),
      }));
    },
    async assign(context) {
      const assigned = await postMutationNativeBase.assign(context);
      return Object.freeze({ ...assigned, storeAcknowledged: false });
    },
  });
  const postMutationStore = lifecycleModule.createInMemorySyntheticSecretStore({ production: true });
  const postMutationCoordinator = lifecycleModule.createSyntheticProductionProvisioningCoordinator({ target: postMutationTarget,
    native: postMutationNative, secretStore: postMutationStore, audit: { async append() { return { ack: true }; } } });
  stage = "post_mutation_fixture_run";
  const postMutation = await postMutationCoordinator.run({ operation: "create", actor: "synthetic-owner",
    intent: "production-post-mutation-fence", approvalId: "synthetic-production", deadlineMs: 30000, cleanupTimeoutMs: 5000 });
  const postMutationRole = (await fixture.control.query(`SELECT rolcanlogin,rolinherit,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE usename=$1) sessions
    FROM pg_roles WHERE rolname=$1`, [postMutationProfile.role])).rows[0];
  const commitStatus = ["not_attempted", "uncertain", "acknowledged"].includes(postMutation.databaseCommit)
    ? postMutation.databaseCommit : "other";
  process.stdout.write(JSON.stringify({
    outcome: "post_mutation_recovery_observation",
    phase: ["preflight", "verify_closed_authority", "reserve", "prepare_no_login", "fence", "assign_and_commit",
      "enable_login_for_authentication", "authenticate_candidate", "fence_after_authentication", "close", "staged_ready"].includes(postMutation.phase)
      ? postMutation.phase : "other",
    result: ["uncertain", "fenced_failure", "cancelled", "blocked"].includes(postMutation.outcome)
      ? postMutation.outcome : "other",
    fenceConfirmed: postMutation.fenceConfirmed === true,
    requiresFreshReplacement: postMutation.requiresFreshReplacement === true,
    databaseCommit: commitStatus,
    rolePresent: Boolean(postMutationRole),
    noLogin: postMutationRole?.rolcanlogin === false,
    noInherit: postMutationRole?.rolinherit === false,
    zeroSessions: postMutationRole?.sessions === 0,
  }) + "\n");
  check(postMutation.fenceConfirmed === true, "post_mutation_fence_confirmed");
  check(postMutation.requiresFreshReplacement === true, "post_mutation_recovery_required");
  check(postMutation.databaseCommit === "uncertain", "post_mutation_commit_uncertain");
  check(Boolean(postMutationRole), "post_mutation_role_present");
  check(postMutationRole.rolcanlogin === false, "post_mutation_role_nologin");
  check(postMutationRole.rolinherit === false, "post_mutation_role_noinherit");
  check(postMutationRole.sessions === 0, "post_mutation_role_zero_sessions");
  await fixture.control.query(`DROP ROLE ${postMutationProfile.role}`);

  for (const profile of profiles) {
    stage = `profile_${profile.name}`;
    const target = makeTarget(profile);
    const native = adapterModule.createLocalSyntheticProductionNativeAdapter({ executable: binaries.get(profile.name), target });
    const memory = lifecycleModule.createInMemorySyntheticSecretStore({ production: true });
    const store = { ...memory, async stage(handle, bytes) {
      if (candidates.has(profile.name)) throw new Error("synthetic_duplicate_private_candidate");
      candidates.set(profile.name, Buffer.from(bytes));
      return memory.stage(handle, bytes);
    } };
    const audit = [];
    const coordinator = lifecycleModule.createSyntheticProductionProvisioningCoordinator({ target, native, secretStore: store,
      audit: { async append(event) { audit.push(event); return { ack: true }; } } });
    const result = await coordinator.run({ operation: "create", actor: "synthetic-owner", intent: `production-${profile.name}`,
      approvalId: "synthetic-production", deadlineMs: 30000, cleanupTimeoutMs: 5000 });
    check(result.outcome === "staged_ready" && !result.requiresFreshReplacement && result.fenceConfirmed,
      `${profile.name}_staged_ready_and_authentication_fenced`);
    check(audit.some(event => event.phase === "fence_after_authentication"), `${profile.name}_authentication_fenced`);
    const readback = (await fixture.control.query(`SELECT r.rolcanlogin,r.rolinherit,r.rolsuper,r.rolcreatedb,r.rolcreaterole,
      (SELECT count(*)::integer FROM pg_auth_members m WHERE m.member=r.oid) memberships,
      (SELECT count(*)::integer FROM pg_auth_members m WHERE m.roleid=$2::regrole) capability_members,
      pg_has_role(r.oid,$2,'MEMBER') mapped,
      (SELECT bool_and(NOT m.inherit_option) FROM pg_auth_members m WHERE m.member=r.oid AND m.roleid=$2::regrole) membership_fenced,
      has_function_privilege($2,$3::regprocedure,'EXECUTE') authority_rpc,
      has_function_privilege(r.oid,$3::regprocedure,'EXECUTE') fenced_rpc,
      has_table_privilege(r.oid,'private.production_business_probe'::regclass,'SELECT') business_read,
      (SELECT count(*)::integer FROM pg_stat_activity WHERE usename=$1) sessions
      FROM pg_roles r WHERE r.rolname=$1`, [profile.role, profile.capabilityRole, overlayRpc(profile)])).rows[0];
    check(readback && !readback.rolcanlogin && !readback.rolinherit && !readback.rolsuper && !readback.rolcreatedb &&
      !readback.rolcreaterole && readback.memberships === 1 && readback.mapped && readback.membership_fenced && readback.authority_rpc && !readback.fenced_rpc &&
      readback.capability_members === 1 && !readback.business_read && readback.sessions === 0,
      `${profile.name}_exact_closed_authority_with_target_membership`);
  }
  // PostgreSQL 16+ evaluates inherited membership in an already-authenticated
  // session. Fencing must therefore change the fixed capability edge before
  // the session drain; NOLOGIN/NOINHERIT on the role alone is not sufficient.
  stage = "peer_profile_least_privilege_drift";
  const fenceProfile = profiles.find(profile => profile.name === "runtime");
  const fenceTarget = Object.freeze({ ...makeTarget(fenceProfile), roleOid: (await fixture.control.query(
    "SELECT oid::text value FROM pg_roles WHERE rolname=$1", [fenceProfile.role])).rows[0].value });
  const fenceNative = adapterModule.createLocalSyntheticProductionNativeAdapter({
    executable: binaries.get(fenceProfile.name), target: fenceTarget,
  });
  const peerProfile = profiles.find(profile => profile.name === "oauth");
  await fixture.control.query(`ALTER ROLE ${peerProfile.role} CREATEROLE`);
  let peerRoleDriftDenied = false;
  try {
    await fenceNative.inspect({ target: fenceTarget, intent: "peer-role-createrole-drift",
      approvalId: "synthetic-production", signal: new AbortController().signal });
  } catch { peerRoleDriftDenied = true; }
  check(peerRoleDriftDenied, "noncurrent_profile_privilege_drift_blocks_current_profile_before_mutation");
  await fixture.control.query(`ALTER ROLE ${peerProfile.role} NOCREATEROLE`);
  check((await fenceNative.inspect({ target: fenceTarget, intent: "peer-role-privilege-restored",
    approvalId: "synthetic-production", signal: new AbortController().signal })).ack,
  "restored_noncurrent_profile_allows_current_closed_inspection");
  stage = "live_session_membership_fence";
  const fenceCandidate = candidates.get(fenceProfile.name);
  check(Buffer.isBuffer(fenceCandidate) && fenceCandidate.length === 128, "runtime_private_candidate_available_for_fence_regression");
  await fixture.control.query(`ALTER ROLE ${fenceProfile.role} LOGIN INHERIT;
    GRANT ${fenceProfile.capabilityRole} TO ${fenceProfile.role} WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`);
  let activeMembershipRejected = false;
  try {
    await fenceNative.authenticate({ target: fenceTarget, intent: "active-membership-false", approvalId: "synthetic-production",
      signal: new AbortController().signal, async withCredential(consume) {
        return consume(Buffer.from(fenceCandidate));
      } });
  } catch { activeMembershipRejected = true; }
  check(activeMembershipRejected, "active_login_with_noninheriting_capability_membership_rejected");
  await fixture.control.query(`GRANT ${fenceProfile.capabilityRole} TO ${fenceProfile.role}
    WITH ADMIN FALSE, INHERIT TRUE, SET FALSE`);
  const live = await fixture.connect(fenceProfile.role, fenceCandidate, "tls");
  const activeAuthority = (await live.query("SELECT has_function_privilege(session_user,$1::regprocedure,'EXECUTE') allowed",
    [overlayRpc(fenceProfile)])).rows[0];
  check(activeAuthority?.allowed === true, "active_session_has_only_its_mapped_rpc_before_fence");
  await fixture.control.query(`BEGIN;
    GRANT ${fenceProfile.capabilityRole} TO ${fenceProfile.role} WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
    ALTER ROLE ${fenceProfile.role} NOLOGIN NOINHERIT;
    COMMIT`);
  const fencedAuthority = (await live.query("SELECT has_function_privilege(session_user,$1::regprocedure,'EXECUTE') allowed",
    [overlayRpc(fenceProfile)])).rows[0];
  check(fencedAuthority?.allowed === false, "existing_session_loses_effective_rpc_before_session_termination");
  check((await fenceNative.inspect({ target: fenceTarget, intent: "closed-live-session-no-authority",
    approvalId: "synthetic-production", signal: new AbortController().signal })).ack,
  "closed_profile_inspects_while_live_session_has_no_effective_authority");
  const fenced = await fenceNative.fence({ target: fenceTarget, intent: "drain-live-session-after-membership-fence",
    approvalId: "synthetic-production", signal: new AbortController().signal });
  check(fenced.ack && fenced.sessionsTerminated, "native_fence_drains_existing_zero_authority_session");
  await live.end().catch(() => undefined);
  const fencedReadback = (await fixture.control.query(`SELECT r.rolcanlogin,r.rolinherit,m.inherit_option,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE usename=$1) sessions
    FROM pg_roles r JOIN pg_auth_members m ON m.member=r.oid AND m.roleid=$2::regrole
    WHERE r.rolname=$1`, [fenceProfile.role, fenceProfile.capabilityRole])).rows[0];
  check(fencedReadback && !fencedReadback.rolcanlogin && !fencedReadback.rolinherit &&
    !fencedReadback.inherit_option && fencedReadback.sessions === 0,
  "native_fence_commits_closed_membership_before_drain_completion");
  stage = "native_postflight_authority_recheck";
  const postflightProfile = profiles.find(profile => profile.name === "runtime");
  const postflightTarget = Object.freeze({ ...makeTarget(postflightProfile), roleOid: (await fixture.control.query(
    "SELECT oid::text value FROM pg_roles WHERE rolname=$1", [postflightProfile.role])).rows[0].value });
  const postflightNative = adapterModule.createLocalSyntheticProductionNativeAdapter({
    executable: binaries.get(postflightProfile.name), target: postflightTarget,
  });
  const postflightDrift = profiles.find(profile => profile.name === "oauth");
  let postflightMutated = false, postflightDenied = false;
  try {
    await postflightNative.assign({ target: postflightTarget, intent: "postflight-authority-recheck",
      approvalId: "synthetic-production", signal: new AbortController().signal, async deliver() {
        await fixture.control.query(`CREATE OR REPLACE FUNCTION ${overlayRpc(postflightDrift)} RETURNS void
          LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS
          $function$ BEGIN RAISE EXCEPTION 'synthetic_postflight_drift' USING ERRCODE='55000'; END $function$`);
        postflightMutated = true;
        return { ack: true };
      } });
  } catch { postflightDenied = true; }
  if (postflightMutated) await fixture.control.query(`CREATE OR REPLACE FUNCTION ${overlayRpc(postflightDrift)} RETURNS void
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$${productionAuthoritySource(postflightDrift)}$function$`);
  check(postflightMutated && postflightDenied, "authority_drift_after_secret_ack_rejected_before_commit");
  check((await postflightNative.inspect({ target: postflightTarget, intent: "postflight-authority-restored",
    approvalId: "synthetic-production", signal: new AbortController().signal })).ack,
  "failed_postflight_assignment_rolls_back_and_restored_authority_inspects");
  stage = "current_permission_recheck";
  await fixture.control.query("GRANT SELECT(secret) ON private.production_business_probe TO square_production_runtime_authority");
  const driftProfile = profiles.find(profile => profile.name === "runtime");
  const driftTarget = Object.freeze({ ...makeTarget(driftProfile), roleOid: (await fixture.control.query(
    "SELECT oid::text value FROM pg_roles WHERE rolname=$1", [driftProfile.role])).rows[0].value });
  const driftNative = adapterModule.createLocalSyntheticProductionNativeAdapter({ executable: binaries.get("runtime"), target: driftTarget });
  await fixture.control.query(`ALTER ROLE ${driftProfile.role} LOGIN INHERIT`);
  let activeInspectionDenied = false;
  try { await driftNative.inspect({ target: driftTarget, intent: "ambient-active-login", approvalId: "synthetic-production", signal: new AbortController().signal }); }
  catch { activeInspectionDenied = true; }
  check(activeInspectionDenied, "ambient_active_production_login_is_not_a_closed_inspection");
  await fixture.control.query(`ALTER ROLE ${driftProfile.role} NOLOGIN NOINHERIT`);
  let driftDenied = false;
  try { await driftNative.inspect({ target: driftTarget, intent: "current-permission-recheck", approvalId: "synthetic-production", signal: new AbortController().signal }); }
  catch { driftDenied = true; }
  check(driftDenied, "column_only_future_migration_drift_rejected");
  const crossProfile = profiles.find(profile => profile.name === "oauth");
  const crossTarget = Object.freeze({ ...makeTarget(crossProfile), roleOid: (await fixture.control.query(
    "SELECT oid::text value FROM pg_roles WHERE rolname=$1", [crossProfile.role])).rows[0].value });
  const crossNative = adapterModule.createLocalSyntheticProductionNativeAdapter({ executable: binaries.get("oauth"), target: crossTarget });
  let crossDriftDenied = false;
  try { await crossNative.inspect({ target: crossTarget, intent: "all-profile-permission-recheck",
    approvalId: "synthetic-production", signal: new AbortController().signal }); }
  catch { crossDriftDenied = true; }
  check(crossDriftDenied, "other_profile_authority_drift_rejects_native_postflight");
  await fixture.control.query("REVOKE SELECT(secret) ON private.production_business_probe FROM square_production_runtime_authority");
  stage = "capability_membership_drift";
  await fixture.control.query("GRANT square_production_runtime_authority TO synthetic_unprivileged WITH ADMIN FALSE, INHERIT TRUE, SET FALSE");
  let capabilityMembershipDenied = false;
  try { await driftNative.inspect({ target: driftTarget, intent: "capability-membership-drift", approvalId: "synthetic-production", signal: new AbortController().signal }); }
  catch { capabilityMembershipDenied = true; }
  check(capabilityMembershipDenied, "additional_capability_member_rejected");
  await fixture.control.query("REVOKE square_production_runtime_authority FROM synthetic_unprivileged");
  stage = "authority_rpc_drift";
  const authorityDrift = profiles.find(profile => profile.name === "oauth");
  const authorityTarget = Object.freeze({ ...makeTarget(authorityDrift), roleOid: (await fixture.control.query(
    "SELECT oid::text value FROM pg_roles WHERE rolname=$1", [authorityDrift.role])).rows[0].value });
  const authorityNative = adapterModule.createLocalSyntheticProductionNativeAdapter({ executable: binaries.get("oauth"), target: authorityTarget });
  await fixture.control.query(`CREATE OR REPLACE FUNCTION ${overlayRpc(authorityDrift)} RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS
    $function$ BEGIN RAISE EXCEPTION 'synthetic_replaced_authority' USING ERRCODE='55000'; END $function$`);
  let authorityDriftDenied = false;
  try { await authorityNative.inspect({ target: authorityTarget, intent: "authority-rpc-drift", approvalId: "synthetic-production", signal: new AbortController().signal }); }
  catch { authorityDriftDenied = true; }
  check(authorityDriftDenied, "same_signature_authority_rpc_body_drift_rejected");
  await fixture.control.query(`CREATE OR REPLACE FUNCTION ${overlayRpc(authorityDrift)} RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $function$${productionAuthoritySource(authorityDrift)}$function$`);
  await fixture.control.query(`REVOKE USAGE ON SCHEMA public FROM ${authorityDrift.capabilityRole}`);
  let publicUsageDenied = false;
  try { await authorityNative.inspect({ target: authorityTarget, intent: "authority-public-usage-drift", approvalId: "synthetic-production", signal: new AbortController().signal }); }
  catch { publicUsageDenied = true; }
  check(publicUsageDenied, "authority_rpc_direct_public_schema_usage_drift_rejected");
  await fixture.control.query(`GRANT USAGE ON SCHEMA public TO ${authorityDrift.capabilityRole}`);
  check(candidates.size === 6 && new Set([...candidates.values()].map(value => value.toString("hex"))).size === 6, "unique_private_credentials");
  await fixture.stop();
  const evidence = Buffer.concat([fixture.logBytes([0, 0, 0]), fixture.statBytes()]);
  check([...candidates.values()].every(value => !evidence.includes(value)), "plaintext_absent_from_logs_and_statistics");
  check(!evidence.includes(Buffer.from("SCRAM-SHA-256$")), "verifier_absent_from_logs_and_statistics");
  fixture = undefined;
  process.stdout.write(JSON.stringify({ outcome: "passed", assertions, hostedQualification: false,
    profiles: profiles.map(profile => profile.name), deploymentBinding: "blocked_pending_reviewed_identity_manifest" }) + "\n");
}

main().catch(error => {
  process.stdout.write(JSON.stringify({ outcome: "failed", stage,
    ...(typeof error.safeStage === "string" ? { dependency: error.safeStage } : {}) }) + "\n");
  process.exitCode = 1;
}).finally(async () => {
  for (const value of candidates.values()) value.fill(0);
  try { if (fixture) await fixture.stop(); }
  catch { process.stdout.write('{"outcome":"failed","stage":"local_fixture_cleanup"}\n'); process.exitCode = 1; }
});
