/* Real PostgreSQL, synthetic records and owned LOGINs only. Never a linked/hosted database. */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { runAdditionalQualification } = require("./run-square-durable-page-qualification.js");

const migrationName = "20260907225626_square_remote_sandbox_binding.sql";
const root = path.resolve(__dirname, "..");
const applicationId = "sandbox-sq0idb-9K0xgcatxe0ABuUmkSNjFw"; // Public application identifier, not a credential.
const origin = "https://square-sandbox.vaeroex.com";
const fingerprint = `sha256:${"a".repeat(64)}`;
const syntheticKey = "projects/square-qualification/locations/global/keyRings/synthetic/cryptoKeys/credential";
const syntheticResources = {
  kms_key_resource: syntheticKey,
  app_secret_version_resource: "projects/square-qualification/secrets/synthetic-app/versions/1",
  webhook_secret_version_resource: "projects/square-qualification/secrets/synthetic-webhook/versions/2",
  credential_service_account: "synthetic-square@square-qualification.iam.gserviceaccount.com",
  workload_identity_audience: "//iam.googleapis.com/projects/123456789/locations/global/workloadIdentityPools/synthetic/providers/vercel",
};
let assertions = 0, scenarios = 0, stage = "startup";
const equal = (actual, expected, label) => { assertions++; assert.deepEqual(actual, expected, label); };
const ok = (value, label) => { assertions++; assert.ok(value, label); };
const quote = value => '"' + String(value).replaceAll('"', '""') + '"';
const safeCode = error => /^[A-Z0-9_]{1,30}$/.test(String(error?.code)) ? String(error.code) : "test_failure";
async function denied(run, label, code = "42501") {
  let caught;
  try { await run(); } catch (error) { caught = error; }
  equal(caught?.code, code, label);
  scenarios++;
}
const binding = async client => (await client.query("select public.get_square_remote_sandbox_binding_v1() as value")).rows[0].value;

async function existingSquareDefinitions(client) {
  return (await client.query(`select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,
    pg_get_functiondef(p.oid) as body,p.proacl::text as acl from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
    and p.proname like '%square%' and p.proname<>'get_square_remote_sandbox_binding_v1' order by 1,2,3`)).rows;
}

async function migrationTests(runtime) {
  stage = "canonical_migrations_and_atomic_additive_install";
  const files = runtime.migrationFiles(), baseline = files.filter(name => name < migrationName);
  equal(baseline.length, 104, "complete canonical prerequisite chain contains exactly 104 migrations");
  equal(files.filter(name => name >= migrationName), [migrationName], "remote binding is the sole explicit additive tail");
  const database = await runtime.createDatabase("remote_sandbox");
  const owner = database.client;
  await runtime.applyMigrations(owner, baseline);
  const before = await runtime.sourceSchemaFingerprint(owner);
  const squareBefore = await existingSquareDefinitions(owner);
  const sql = fs.readFileSync(path.join(root, "supabase/migrations", migrationName), "utf8");
  const commit = sql.toLowerCase().lastIndexOf("commit;");
  ok(commit > 0, "new migration has an explicit transaction boundary");
  try {
    await denied(() => owner.query(sql.slice(0, commit) + "select 1/0;\n" + sql.slice(commit)),
      "failure before COMMIT rolls the complete migration back", "22012");
  } finally { await owner.query("rollback"); }
  equal((await owner.query("select to_regclass('private.square_remote_sandbox_binding') as value")).rows[0].value,
    null, "interrupted installation leaves no approval table");
  equal((await owner.query("select to_regprocedure('public.get_square_remote_sandbox_binding_v1()') as value")).rows[0].value,
    null, "interrupted installation leaves no checked function");
  equal(await runtime.sourceSchemaFingerprint(owner), before, "rollback preserves non-Square and QBO schema/ACL fingerprints");
  await runtime.applyMigrations(owner, [migrationName]);
  equal(await runtime.sourceSchemaFingerprint(owner), before, "successful installation preserves non-Square and QBO definitions exactly");
  equal(await existingSquareDefinitions(owner), squareBefore, "existing Square checked functions, limits and ACLs remain exact");
  const defaults = (await owner.query(`select
    (select count(*)::int from private.square_remote_sandbox_binding) as bindings,
    (select count(*)::int from private.square_account_configuration) as configurations,
    (select count(*)::int from private.square_qualification_gate) as qualification_gates,
    (select count(*)::int from private.square_connections) as connections,
    (select count(*)::int from private.square_account_enrollments) as enrollments,
    (select count(*)::int from private.square_ingestion_tasks) as tasks,
    (select count(*)::int from private.square_account_credentials) as credentials,
    (select count(*)::int from pg_roles where rolname like 'square_sandbox_%') as logins`)).rows[0];
  equal(Object.values(defaults), Array(8).fill(0), "installation creates no approval, credentials, enrollment, task, connection or LOGIN");
  const metadata = (await owner.query(`select c.relrowsecurity,c.relforcerowsecurity,p.prosecdef,p.proconfig,
    pg_get_function_identity_arguments(p.oid) as args
    from pg_class c cross join pg_proc p where c.oid='private.square_remote_sandbox_binding'::regclass
      and p.oid='public.get_square_remote_sandbox_binding_v1()'::regprocedure`)).rows[0];
  equal([metadata.relrowsecurity, metadata.relforcerowsecurity, metadata.prosecdef], [true, true, true],
    "private approval is forced-RLS and accessible only through the checked definer");
  equal(metadata.proconfig, ['search_path=""'], "checked function has a fixed empty search path");
  equal(metadata.args, "", "caller cannot supply or select authority arguments");
  const roles = ["anon", "authenticated", "service_role", "square_account_broker_authority", "square_verified_enrollment_authority",
    "square_ingestion_runtime_authority", "square_ingestion_qualification_admin"];
  for (const role of roles) {
    const privileges = (await owner.query(`select has_table_privilege($1,'private.square_remote_sandbox_binding','SELECT,INSERT,UPDATE,DELETE') as direct,
      has_function_privilege($1,'public.get_square_remote_sandbox_binding_v1()','EXECUTE') as invoke`, [role])).rows[0];
    equal(privileges.direct, false, "ordinary and capability roles have no direct approval-table privileges");
    equal(privileges.invoke, ["square_account_broker_authority", "square_verified_enrollment_authority", "square_ingestion_runtime_authority"].includes(role),
      "only the three intended capabilities can invoke the checked function");
  }
  equal((await owner.query(`select count(*)::int as n from pg_auth_members m join pg_roles r on r.oid=m.roleid
    join pg_roles u on u.oid=m.member where r.rolname like 'square_%'
    and u.rolname in ('anon','authenticated','service_role')`)).rows[0].n, 0, "API roles acquire no Square capability membership");
  scenarios++;
  return database;
}

async function integratedTests(runtime, database) {
  const owner = database.client;
  const capabilities = ["square_account_broker_authority", "square_verified_enrollment_authority", "square_account_broker_authority", "square_ingestion_runtime_authority"];
  const names = ["broker", "enroller", "webhook", "runtime"];
  const logins = [];
  for (let index = 0; index < names.length; index++)
    logins.push(await runtime.login(database, names[index], [capabilities[index]], "square_sandbox"));
  const [broker, enroller, webhook, ingestion] = logins;
  const outsider = await runtime.login(database, "outsider", [], "square_sandbox");
  const wrongLogin = await runtime.login(database, "wrong", ["square_account_broker_authority"], "square_sandbox");
  for (const login of logins) {
    equal((await login.client.query("select session_user as actual_login")).rows[0].actual_login, login.name,
      "qualification uses an actual LOGIN connection, not SET ROLE impersonation");
    await denied(() => binding(login.client), "missing owner approval denies every dedicated LOGIN");
  }
  const user = crypto.randomUUID(), workspace = crypto.randomUUID(), entity = crypto.randomUUID();
  await owner.query("insert into auth.users(id,email) values($1,'square-remote-synthetic@example.invalid')", [user]);
  await owner.query("insert into public.workspaces(id,name,created_by) values($1,'Disposable remote Square fixture',$2)", [workspace, user]);
  await owner.query(`insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')
    on conflict(workspace_id,user_id) where user_id is not null do update set role=excluded.role,status=excluded.status`, [workspace, user]);
  await owner.query(`insert into public.business_entities(id,workspace_id,entity_key,display_name,base_currency,timezone,status,created_by,updated_by)
    values($1,$2,'synthetic_remote','Synthetic remote entity','USD','UTC','active',$3,$3)`, [entity, workspace, user]);
  await owner.query(`insert into private.square_account_configuration(environment,application_id,redirect_uri,broker_login,enrollment_login,
    webhook_login,kms_key_resource,surface_enabled,enrollment_enabled,approval_expires_at,retention_policy_version,
    retention_approval_fingerprint,source_retention_seconds,cursor_retention_seconds,revocation_access_policy)
    values('sandbox',$1,$2,$3,$4,$5,$6,true,false,clock_timestamp()+interval '1 day','synthetic_remote_v1',$7,3600,3600,'deny_source_access')`,
    [applicationId, origin + "/api/integrations/square/callback", broker.name, enroller.name, webhook.name, syntheticKey, fingerprint]);
  await owner.query(`insert into private.square_remote_sandbox_binding(deployment_key,project_ref,vercel_team_id,vercel_team_slug,
    vercel_project_id,application_origin,environment,application_id,api_version,operator_id,workspace_id,business_entity_id,
    broker_login,enroller_login,webhook_login,runtime_login,approval_expires_at,policy_version,policy_fingerprint)
    values('vaeroex-square-sandbox','oysjpoondtcrqpghhrbd','team_uORtrMvad77Qz6HikOgD4cnp','vaeroex-2167s-projects',
    'prj_SYNTHETICLOCALONLY1234',$1,'sandbox',$2,'2026-08-19',$3,$4,$5,$6,$7,$8,$9,
    clock_timestamp()+interval '1 day','synthetic_remote_v1',$10)`,
    [origin, applicationId, user, workspace, entity, broker.name, enroller.name, webhook.name, ingestion.name, fingerprint]);

  stage = "default_closed_and_exact_login_authority";
  equal((await owner.query("select enabled,provider_calls_enabled from private.square_remote_sandbox_binding")).rows[0],
    { enabled: false, provider_calls_enabled: false }, "both surface approval and provider-call permission default closed");
  await denied(() => binding(broker.client), "inserting metadata does not enable the surface");
  await owner.query("update private.square_remote_sandbox_binding set enabled=true");
  const accepted = await binding(broker.client);
  equal(accepted.contractVersion, "square_remote_sandbox_binding_v1", "checked binding carries the exact contract version");
  equal([accepted.projectRef, accepted.vercelProjectName, accepted.applicationOrigin, accepted.applicationId, accepted.environment, accepted.apiVersion],
    ["oysjpoondtcrqpghhrbd", "vaeroex-square-sandbox", origin, applicationId, "sandbox", "2026-08-19"], "host, environment, application and raw API pin remain exact");
  equal([accepted.operatorId, accepted.workspaceId, accepted.businessEntityId, accepted.operatorRole], [user, workspace, entity, "owner"],
    "operator scope comes from the private record and current database membership");
  equal([accepted.enabled, accepted.providerCallsEnabled], [true, false], "host attestation does not authorize a provider call");
  equal([accepted.kmsKeyResource, accepted.appSecretVersionResource, accepted.webhookSecretVersionResource,
    accepted.credentialServiceAccount, accepted.workloadIdentityAudience], Array(5).fill(null), "disabled provider access needs no invented secret resource");
  for (const login of logins) equal(await binding(login.client), accepted, "all four actual LOGINs resolve the same owner-selected binding");
  for (const login of [outsider, wrongLogin]) await denied(() => binding(login.client), "ordinary and foreign capable LOGINs cannot obtain the binding");
  for (const role of ["anon", "authenticated", "service_role", "square_account_broker_authority"]) {
    await owner.query(`set role ${quote(role)}`);
    try { await denied(() => binding(owner), "SET ROLE and a privileged session are not an approved dedicated LOGIN"); }
    finally { await owner.query("reset role"); }
  }
  await outsider.client.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role: broker.name, workspace_id: workspace })]);
  await denied(() => binding(outsider.client), "forged JWT/GUC claims cannot establish database authority");
  await owner.query(`grant ${quote(broker.name)} to ${quote(outsider.name)}`);
  try {
    await outsider.client.query(`set role ${quote(broker.name)}`);
    equal((await outsider.client.query("select current_user as current,session_user as session")).rows[0],
      { current: broker.name, session: outsider.name }, "SET ROLE forgery reaches the intended current_user without changing session_user");
    await denied(() => binding(outsider.client), "even SET ROLE to an approved LOGIN cannot forge actual session identity");
  } finally { await outsider.client.query("reset role"); await owner.query(`revoke ${quote(broker.name)} from ${quote(outsider.name)}`); }
  for (const login of [...logins, outsider, wrongLogin])
    await denied(() => login.client.query("select * from private.square_remote_sandbox_binding"), "checked caller cannot directly read private approval data");
  await owner.query(`grant usage on schema private to ${quote(outsider.name)}`);
  await owner.query(`grant select on private.square_remote_sandbox_binding to ${quote(outsider.name)}`);
  try {
    equal((await outsider.client.query("select count(*)::int as n from private.square_remote_sandbox_binding")).rows[0].n, 0,
      "forced RLS keeps approvals invisible even after an accidental direct SELECT grant");
  } finally {
    await owner.query(`revoke all on private.square_remote_sandbox_binding from ${quote(outsider.name)}`);
    await owner.query(`revoke usage on schema private from ${quote(outsider.name)}`);
  }
  await owner.query(`revoke square_ingestion_runtime_authority from ${quote(ingestion.name)}`);
  await denied(() => binding(ingestion.client), "named LOGIN without its capability is denied");
  await owner.query(`grant square_ingestion_runtime_authority to ${quote(ingestion.name)}`);
  for (const [flag, restore] of [["bypassrls", "nobypassrls"], ["createdb", "nocreatedb"], ["createrole", "nocreaterole"],
    ["replication", "noreplication"], ["superuser", "nosuperuser"], ["nologin", "login"]]) {
    await owner.query(`alter role ${quote(broker.name)} ${flag}`);
    try { await denied(() => binding(broker.client), "LOGIN must retain every constrained role attribute"); }
    finally { await owner.query(`alter role ${quote(broker.name)} ${restore}`); }
  }

  stage = "current_configuration_membership_and_policy";
  async function changed(table, column, value, test) {
    const previous = (await owner.query(`select ${quote(column)} as value from ${table}`)).rows[0].value;
    await owner.query(`update ${table} set ${quote(column)}=$1`, [value]);
    try { await test(); } finally { await owner.query(`update ${table} set ${quote(column)}=$1`, [previous]); }
  }
  for (const [column, value] of [["enabled", false], ["approval_expires_at", new Date(0)], ["broker_login", wrongLogin.name],
    ["policy_version", "different_synthetic_policy"], ["policy_fingerprint", `sha256:${"b".repeat(64)}`]])
    await changed("private.square_remote_sandbox_binding", column, value,
      () => denied(() => binding(broker.client), "changed binding fails current-invocation authorization"));
  for (const [column, value] of [["surface_enabled", false], ["blocked", true], ["approval_expires_at", new Date(0)],
    ["redirect_uri", "https://foreign.invalid/callback"], ["broker_login", wrongLogin.name], ["enrollment_login", wrongLogin.name],
    ["webhook_login", wrongLogin.name], ["retention_policy_version", "different_synthetic_policy"],
    ["retention_approval_fingerprint", `sha256:${"b".repeat(64)}`], ["source_retention_seconds", null],
    ["cursor_retention_seconds", null], ["revocation_access_policy", null]])
    await changed("private.square_account_configuration", column, value,
      () => denied(() => binding(broker.client), "missing, stale or mismatched account policy fails closed"));
  for (const value of ["disabled", "invited"])
    await changed("public.workspace_members", "status", value,
      () => denied(() => binding(broker.client), "operator requires active workspace membership"));
  for (const value of ["staff", "viewer"])
    await changed("public.workspace_members", "role", value,
      () => denied(() => binding(broker.client), "operator requires a current management role"));
  for (const value of ["admin", "manager"])
    await changed("public.workspace_members", "role", value,
      async () => equal((await binding(broker.client)).operatorRole, value, "current supported management role is returned, not a stored role claim"));
  for (const value of ["inactive", "archived"])
    await changed("public.business_entities", "status", value,
      () => denied(() => binding(broker.client), "business entity must remain active"));
  for (const [column, value] of [["project_ref", "mdiianhfrojmxqpwrflh"], ["vercel_project_id", "prj_J810bZ9ECoN4CyLKujUoEEH8N6ja"],
    ["environment", "production"], ["application_origin", "https://www.vaeroex.com"], ["api_version", "2026-01-01"],
    ["runtime_login", broker.name]])
    await denied(() => owner.query(`update private.square_remote_sandbox_binding set ${quote(column)}=$1`, [value]),
      "schema refuses Production or non-isolated host identity and shared LOGIN configuration", "23514");
  await denied(() => owner.query("update private.square_account_configuration set cursor_retention_seconds=3601"),
    "private cursor retention cannot exceed the existing one-hour limit", "23514");

  stage = "provider_resource_permission_is_separate";
  await denied(() => owner.query("update private.square_remote_sandbox_binding set provider_calls_enabled=true"),
    "provider calls cannot be enabled without every exact secret/KMS identity", "23514");
  for (const [column, value] of Object.entries(syntheticResources))
    await owner.query(`update private.square_remote_sandbox_binding set ${quote(column)}=$1`, [value]);
  equal((await binding(broker.client)).providerCallsEnabled, false, "populating resource names does not enable provider calls");
  await owner.query("update private.square_remote_sandbox_binding set provider_calls_enabled=true");
  equal((await binding(broker.client)).providerCallsEnabled, true, "only explicit owner-approved complete resource configuration permits calls");
  for (const column of Object.keys(syntheticResources))
    await denied(() => owner.query(`update private.square_remote_sandbox_binding set ${quote(column)}=null`),
      "enabled provider permission requires each resource independently", "23514");
  await changed("private.square_account_configuration", "kms_key_resource", syntheticKey + "-foreign",
    () => denied(() => binding(broker.client), "provider permission requires the existing broker KMS binding to match"));
  await owner.query("update private.square_remote_sandbox_binding set provider_calls_enabled=false");
  for (const column of Object.keys(syntheticResources))
    await owner.query(`update private.square_remote_sandbox_binding set ${quote(column)}=null`);

  stage = "wall_clock_expiry_after_each_lock_wait";
  const waiter = await runtime.connect(broker.connection);
  const pid = (await waiter.query("select pg_backend_pid() as pid")).rows[0].pid;
  // Observe an actual blocked backend before releasing the lock. Expiry is then
  // awaited using database wall time, not a lucky JavaScript sleep or GC result.
  for (const [index, table] of ["private.square_remote_sandbox_binding", "private.square_account_configuration",
    "public.workspace_members", "public.business_entities"].entries()) {
    const expiryTable = index % 2 ? "private.square_account_configuration" : "private.square_remote_sandbox_binding";
    await owner.query("update private.square_remote_sandbox_binding set approval_expires_at=clock_timestamp()+interval '1 day'");
    await owner.query("update private.square_account_configuration set approval_expires_at=clock_timestamp()+interval '1 day'");
    await owner.query(`update ${expiryTable} set approval_expires_at=clock_timestamp()+interval '3 seconds'`);
    await owner.query("begin");
    let pending;
    try {
      await owner.query(`select 1 from ${table} for update`);
      pending = binding(waiter).then(value => ({ value }), error => ({ error }));
      const deadline = Date.now() + 2500;
      let blocked = false;
      while (Date.now() < deadline) {
        await owner.query("select pg_stat_clear_snapshot()");
        const observed = (await owner.query(`select wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0 as blocked
          from pg_stat_activity where pid=$1`, [pid])).rows[0];
        if (observed?.blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      ok(blocked, "qualified actual LOGIN waits on the intended protected row lock");
      ok((await owner.query(`select approval_expires_at>clock_timestamp() as valid from ${expiryTable}`)).rows[0].valid,
        "approval was valid when the checked invocation started waiting");
      await owner.query(`select pg_sleep(greatest(0,extract(epoch from approval_expires_at-clock_timestamp()))::double precision+0.025) from ${expiryTable}`);
      equal((await owner.query(`select approval_expires_at<=clock_timestamp() as expired from ${expiryTable}`)).rows[0].expired,
        true, "database wall time has crossed the finite approval deadline before releasing the lock");
    } finally { await owner.query("rollback"); }
    const result = await pending;
    equal(result?.error?.code, "42501", "approval expiry is rechecked after each possible lock wait");
    scenarios++;
  }
  await owner.query("update private.square_remote_sandbox_binding set approval_expires_at=clock_timestamp()+interval '1 day'");
  await owner.query("update private.square_account_configuration set approval_expires_at=clock_timestamp()+interval '1 hour'");
  const limited = await binding(broker.client);
  equal(Date.parse(limited.approvalExpiresAt), (await owner.query("select approval_expires_at from private.square_account_configuration")).rows[0].approval_expires_at.getTime(),
    "returned approval deadline is the earlier of host and account approval");
  await owner.query("insert into private.square_account_capacity_blocks values('sandbox',$1,clock_timestamp())", [applicationId]);
  for (const login of logins) await denied(() => binding(login.client), "append-only capacity latch denies every host capability");
  equal((await owner.query("select count(*)::int as n from private.square_ingestion_tasks")).rows[0].n, 0,
    "binding qualification creates no ingestion task or provider activity");
  scenarios++;
}

async function main() {
  await runAdditionalQualification(async runtime => {
    const database = await migrationTests(runtime);
    await integratedTests(runtime, database);
  });
  console.log(`Square remote Sandbox database qualification: ${assertions} assertions across ${scenarios} scenarios.`);
}
if (require.main === module) main().catch(error => {
  process.stderr.write(`Square remote Sandbox qualification failed at ${stage} (${safeCode(error)}).\n`);
  if (error.code === "ERR_ASSERTION") process.stderr.write(`Assertion: ${String(error.message).split("\n")[0]}\n`);
  process.exitCode = 1;
});
