const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const { resetLocalFixture } = require("./prepare-production-shaped-local-database.js");

const root = path.resolve(__dirname, "..");
const cli = process.env.SUPABASE_CLI_PATH || "supabase";
const overlayVersion = "20260902191324";
const runtimeVersion = "20260902191325";
const runtimeLedgerFingerprint = "sha256:7dc51d888ee9c4a6bb595b1a4431ab5fcdb649e34c871ba91a6512d5fa2dc89f";
const loginRoles = ["oauth", "broker", "runtime", "evidence"];

function assertNoRemoteConfiguration() {
  for (const name of [
    "DATABASE_URL", "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD",
    "PGSERVICE", "PGSERVICEFILE", "PGPASSFILE", "SUPABASE_ACCESS_TOKEN", "SUPABASE_TEST_DATABASE_URL",
    "SUPABASE_TEST_BRANCH_NAME", "SUPABASE_TEST_PARENT_PROJECT_REF", "SERVICE_ROLE_KEY", "SQUARE_ACCESS_TOKEN"
  ]) if (Object.hasOwn(process.env, name)) throw new Error("remote_or_inherited_database_configuration_forbidden");
  if (fs.existsSync(path.join(root, "supabase/.temp/project-ref"))) {
    throw new Error("linked_project_configuration_forbidden");
  }
}

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  if (result.status !== 0) {
    if (capture) process.stderr.write(`${result.stdout || ""}${result.stderr || ""}`);
    throw new Error("square_production_internal_runtime_command_failed");
  }
  return result;
}

function localDatabaseUrl() {
  const status = run(cli, ["status", "-o", "env"], true);
  const line = status.stdout.split(/\r?\n/).find(value => value.startsWith("DB_URL="));
  if (!line) throw new Error("square_production_internal_runtime_local_database_missing");
  const raw = line.slice("DB_URL=".length).trim();
  const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
    || parsed.pathname !== "/postgres" || parsed.search || parsed.hash) {
    throw new Error("square_production_internal_runtime_nonlocal_database_forbidden");
  }
  return value;
}

function runtimeFingerprint(parts) {
  const normalized = ["square-production-internal-runtime-v1", ...parts].map(value => String(value));
  for (const part of normalized) assert.match(part, /^[\x20-\x7e]*$/, "fingerprint parts are transport-stable ASCII");
  const encoded = normalized.map(part => `${part.length}:${part}`).join("");
  return `sha256:${crypto.createHash("sha256").update(encoded, "utf8").digest("hex")}`;
}

function id() { return crypto.randomUUID(); }

function assertMigrationManifest() {
  const names = fs.readdirSync(path.join(root, "supabase/migrations"))
    .filter(name => /^\d+_.+\.sql$/.test(name)).sort();
  const prefix = names.filter(name => name.split("_", 1)[0] <= runtimeVersion);
  assert.equal(prefix.length, 104);
  assert.deepEqual(prefix.slice(-3), [
    "20260902191323_integration_production_runtime_foundation.sql",
    "20260902191324_square_production_runtime_overlay.sql",
    "20260902191325_square_production_internal_pilot_runtime.sql"
  ]);
  const versions = prefix.map(name => name.split("_", 1)[0]);
  assert.equal(
    `sha256:${crypto.createHash("sha256").update(
      versions.map(version => `${version.length}:${version}`).join("")
    ).digest("hex")}`,
    runtimeLedgerFingerprint
  );
  assert.equal(
    crypto.createHash("sha256").update(fs.readFileSync(path.join(
      root, "supabase/migrations/20260902191324_square_production_runtime_overlay.sql"
    ))).digest("hex"),
    "2cc43a9313d056e58b75143f032f347cb0972f45cc1edbd484f6b1fb0574661f"
  );
}

function nativeCommand(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    cwd: root, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout || 180000, maxBuffer: 32 * 1024 * 1024
  });
  if (result.status !== 0) {
    const error = new Error("square_production_internal_native_command_failed");
    error.localDiagnostic = String(result.stderr || "").slice(0, 3000);
    throw error;
  }
  return result.stdout;
}

async function createNativeTarget() {
  assertNoRemoteConfiguration();
  if (process.env.SQUARE_QUALIFICATION_PG_SOCKET) {
    const socket = fs.realpathSync(process.env.SQUARE_QUALIFICATION_PG_SOCKET);
    if (!path.isAbsolute(socket) || !socket.startsWith("/private/tmp/")) {
      throw new Error("explicit_local_postgres_socket_forbidden");
    }
    const database = `square_production_runtime_${crypto.randomBytes(8).toString("hex")}`;
    const adminConnection = { host: socket, port: 5432, database: "postgres", user: "postgres", ssl: false };
    const admin = new Client({ ...adminConnection, application_name: "square_production_runtime_admin" });
    await admin.connect();
    const identity = (await admin.query(`
      select current_user actor,current_setting('data_directory') data,
        inet_server_addr() address,current_setting('server_version_num')::integer version
    `)).rows[0];
    assert.equal(identity.actor, "postgres");
    assert.equal(identity.address, null);
    assert.ok(identity.data.startsWith("/private/tmp/"));
    assert.ok(identity.version >= 170000 && identity.version < 180000);
    await admin.query(`create database ${database}`);
    await admin.end();
    const connection = { ...adminConnection, database };
    const client = new Client({ ...connection, application_name: "square_production_runtime_qualification" });
    await client.connect();
    return {
      directory: identity.data, connection, client,
      async stop() {
        await client.end().catch(() => undefined);
        const cleanup = new Client({ ...adminConnection, application_name: "square_production_runtime_cleanup" });
        await cleanup.connect();
        try {
          await cleanup.query("select pg_terminate_backend(pid) from pg_stat_activity where datname=$1", [database]);
          await cleanup.query(`drop database ${database}`);
        } finally {
          await cleanup.end();
        }
      }
    };
  }
  const bin = process.env.SQUARE_QUALIFICATION_PG_BIN;
  if (!bin || !path.isAbsolute(bin) || !fs.statSync(path.join(bin, "initdb")).isFile()) {
    throw new Error("explicit_native_postgres_bin_required");
  }
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(fs.realpathSync("/tmp"), "square-production-runtime-")));
  fs.chmodSync(directory, 0o700);
  const data = path.join(directory, "data");
  const socket = path.join(directory, "socket");
  fs.mkdirSync(socket, { mode: 0o700 });
  const clusterName = `square_production_runtime_${crypto.randomBytes(8).toString("hex")}`;
  nativeCommand(path.join(bin, "initdb"), [
    "-D", data, "--username=postgres", "--auth-local=trust", "--auth-host=reject", "--encoding=UTF8", "--no-locale"
  ]);
  const serverOptions = [
    "-c", "listen_addresses=", "-c", `unix_socket_directories=${socket}`,
    "-c", "unix_socket_permissions=0700", "-c", `cluster_name=${clusterName}`,
    "-c", "shared_buffers=32MB", "-c", "max_connections=20",
    "-c", "log_statement=none", "-c", "log_min_error_statement=panic", "-c", "log_error_verbosity=terse"
  ].join(" ");
  nativeCommand(path.join(bin, "pg_ctl"), [
    "-D", data, "-l", path.join(directory, "postgres.log"), "-o", serverOptions, "-w", "start"
  ]);
  const connection = { host: socket, port: 5432, database: "postgres", user: "postgres", ssl: false };
  const client = new Client({ ...connection, application_name: "square_production_runtime_qualification" });
  await client.connect();
  const identity = (await client.query(`
    select current_database() database,current_setting('data_directory') data,
      current_setting('cluster_name') cluster,current_setting('listen_addresses') listen,
      inet_server_addr() address,current_setting('server_version_num')::integer version
  `)).rows[0];
  assert.equal(identity.database, "postgres");
  assert.equal(fs.realpathSync(identity.data), fs.realpathSync(data));
  assert.equal(identity.cluster, clusterName);
  assert.equal(identity.listen, "");
  assert.equal(identity.address, null);
  assert.ok(identity.version >= 170000 && identity.version < 180000);
  return {
    bin, directory, connection, client,
    async stop() {
      await client.end().catch(() => undefined);
      nativeCommand(path.join(bin, "pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"]);
    }
  };
}

async function applyNativePrefix(client, throughVersion) {
  await client.query("set search_path=public,extensions");
  await client.query(fs.readFileSync(path.join(root, "supabase/tests/fixtures/square-durable-platform.sql"), "utf8"));
  await client.query(`
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key)
  `);
  const names = fs.readdirSync(path.join(root, "supabase/migrations"))
    .filter(name => /^\d+_.+\.sql$/.test(name) && name.split("_", 1)[0] <= throughVersion)
    .sort();
  for (const name of names) {
    try {
      await client.query(fs.readFileSync(path.join(root, "supabase/migrations", name), "utf8"));
      await client.query("insert into supabase_migrations.schema_migrations(version) values($1)", [name.split("_", 1)[0]]);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      error.message = `${name}:${error.message}`;
      throw error;
    }
  }
}

async function runPgTapNative(client) {
  await client.query("create extension if not exists pgtap with schema public");
  const results = await client.query(fs.readFileSync(path.join(
    root, "supabase/tests/square_production_internal_pilot_runtime.test.sql"
  ), "utf8"));
  const outputs = (Array.isArray(results) ? results : [results]).flatMap(result =>
    (result.rows || []).flatMap(row => Object.values(row).filter(value => typeof value === "string"))
  );
  const failures = outputs.filter(value => value.startsWith("not ok") || value.startsWith("# Looks like"));
  assert.deepEqual(failures, [], `pgTAP failures: ${failures.join(" | ")}`);
}

async function catalogSnapshot(client) {
  const result = await client.query(`
    select pg_catalog.jsonb_build_object(
      'relations',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        namespace.nspname,relation.relname,relation.relkind,relation.relacl::text
      ) order by namespace.nspname,relation.relname)
      from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where relation.relname~*'(qbo|quickbooks)' or namespace.nspname~*'(qbo|quickbooks)'),'[]'::jsonb),
      'columns',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        namespace.nspname,relation.relname,attribute.attnum,attribute.attname,
        pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),attribute.attnotnull,
        attribute.attidentity,attribute.attgenerated,pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid,true)
      ) order by namespace.nspname,relation.relname,attribute.attnum)
      from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      join pg_catalog.pg_attribute attribute on attribute.attrelid=relation.oid
      left join pg_catalog.pg_attrdef default_value on default_value.adrelid=relation.oid and default_value.adnum=attribute.attnum
      where (relation.relname~*'(qbo|quickbooks)' or namespace.nspname~*'(qbo|quickbooks)')
        and attribute.attnum>0 and not attribute.attisdropped),'[]'::jsonb),
      'functions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        namespace.nspname,function_record.proname,pg_catalog.pg_get_function_identity_arguments(function_record.oid),
        pg_catalog.pg_get_functiondef(function_record.oid),function_record.proacl::text
      ) order by namespace.nspname,function_record.proname,pg_catalog.pg_get_function_identity_arguments(function_record.oid))
      from pg_catalog.pg_proc function_record join pg_catalog.pg_namespace namespace on namespace.oid=function_record.pronamespace
      where function_record.proname~*'(qbo|quickbooks)'),'[]'::jsonb)
    ) snapshot
  `);
  return result.rows[0].snapshot;
}

async function createRuntimeLogins(client) {
  for (const capability of loginRoles) {
    const login = `square_production_${capability}`;
    await client.query(`create role ${login} login inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls`);
    await client.query(`grant square_production_${capability}_authority to ${login}`);
  }
}

async function dropRuntimeLogins(client) {
  await client.query("reset session authorization").catch(() => undefined);
  for (const capability of [...loginRoles].reverse()) {
    await client.query(`drop role if exists square_production_${capability}`).catch(() => undefined);
  }
}

async function asRuntimeRole(client, capability, operation, payload) {
  const login = `square_production_${capability}`;
  await client.query(`set session authorization ${login}`);
  try {
    const result = await client.query(
      `select public.square_production_internal_${capability}_v1($1,$2::jsonb) value`,
      [operation, JSON.stringify(payload)]
    );
    return result.rows[0].value;
  } finally {
    await client.query("reset session authorization");
  }
}

async function assertRuntimeRoleRejects(client, capability, operation, payload, expected) {
  const login = `square_production_${capability}`;
  let caught;
  await client.query(`set session authorization ${login}`);
  try {
    await client.query("savepoint expected_runtime_rejection");
    try {
      await client.query(
        `select public.square_production_internal_${capability}_v1($1,$2::jsonb)`,
        [operation, JSON.stringify(payload)]
      );
    } catch (error) {
      caught = error;
    }
    await client.query("rollback to savepoint expected_runtime_rejection");
  } finally {
    await client.query("reset session authorization");
  }
  assert.ok(caught, `${capability}/${operation} unexpectedly succeeded`);
  assert.match(String(caught.message), expected);
}

async function verifyCredentialReadLockOrder(client, credentialPayload) {
  const parameters = client.connectionParameters;
  const host = parameters.host;
  assert.ok(host === "127.0.0.1" || host === "localhost" || host.startsWith("/private/tmp/"),
    "concurrency peer must remain on the qualified local PostgreSQL target");
  const peer = new Client({
    application_name: "square_production_runtime_concurrency_peer",
    database: parameters.database,
    host,
    password: parameters.password,
    port: parameters.port,
    ssl: false,
    user: parameters.user
  });
  let clientOpen = false;
  let peerOpen = false;
  let readOutcomePromise;
  await peer.connect();
  try {
    const clientPid = (await client.query("select pg_catalog.pg_backend_pid() pid")).rows[0].pid;
    await client.query("begin");
    clientOpen = true;
    await peer.query("begin");
    peerOpen = true;
    await peer.query("set local lock_timeout='1500ms'");
    await peer.query(
      "select 1 from private.square_production_internal_scans where scan_id=$1 for update",
      [credentialPayload.scanId]
    );
    let readSettled = false;
    readOutcomePromise = asRuntimeRole(client, "broker", "read_credential", credentialPayload).then(
      value => { readSettled = true; return { value }; },
      error => { readSettled = true; return { error }; }
    );
    let observedLockWait = false;
    for (let attempt = 0; attempt < 40 && !readSettled; attempt += 1) {
      const activity = (await peer.query(
        "select wait_event_type from pg_catalog.pg_stat_activity where pid=$1", [clientPid]
      )).rows[0];
      if (activity?.wait_event_type === "Lock") {
        observedLockWait = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(observedLockWait, true,
      "credential read waits on the scan row before acquiring the permit");
    await peer.query(
      "select 1 from private.square_production_internal_permits where permit_id=$1 for update",
      [credentialPayload.permitId]
    );
    await peer.query("commit");
    peerOpen = false;
    const readOutcome = await readOutcomePromise;
    if (readOutcome.error) throw readOutcome.error;
    await client.query("commit");
    clientOpen = false;
    return readOutcome.value;
  } finally {
    if (peerOpen) await peer.query("rollback").catch(() => undefined);
    if (readOutcomePromise) await readOutcomePromise.catch(() => undefined);
    if (clientOpen) await client.query("rollback").catch(() => undefined);
    await peer.end().catch(() => undefined);
  }
}

async function seedClosedFoundation(client) {
  await client.query(`
    insert into private.integration_production_platform_bindings(
      binding_key,environment,project_id,project_number,region,network_name,subnet_name,router_name,nat_name,
      egress_address_name,ingress_address_name,task_queue_name,artifact_repository_name,database_authority_target,
      runtime_policy_version,retention_policy_version,observability_policy_version,backup_policy_version,source_commit
    ) values (
      'vaeroex-production-integrations-v1','production','vaeroex-integrations-prod','123456789012','us-west1',
      'vaeroex-integrations-production','vaeroex-integrations-us-west1','vaeroex-integrations-router',
      'vaeroex-integrations-nat','vaeroex-integrations-egress','vaeroex-integrations-ingress',
      'vaeroex-integrations-tasks','vaeroex-integrations-images','existing_production_postgres',
      'production_runtime_v1','production_retention_v1','production_observability_v1','production_backup_v1',repeat('a',40)
    );
    insert into private.integration_production_provider_bindings(
      provider_key,environment,platform_binding_key,project_id,region,application_id,route_namespace,
      callback_uri,kms_key_resource,source_commit
    ) values (
      'square','production','vaeroex-production-integrations-v1','vaeroex-integrations-prod','us-west1',
      'sq0idp-production-fixture','/api/integrations/square',
      'https://square.vaeroex.com/api/integrations/square/callback',
      'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
      repeat('a',40)
    );
    insert into private.integration_production_provider_secrets(
      provider_key,environment,project_id,secret_purpose,secret_version_resource
    ) select 'square','production','vaeroex-integrations-prod',purpose,
      'projects/vaeroex-integrations-prod/secrets/square-production-'||replace(purpose,'_','-')||'/versions/1'
    from unnest(array[
      'application','database_broker','database_evidence','database_oauth','database_runtime',
      'database_scheduler','database_webhook','webhook_signature'
    ]::text[]) purpose;
    insert into private.integration_production_provider_capabilities(
      provider_key,environment,project_id,capability,service_account,database_login,database_secret_purpose
    ) select 'square','production','vaeroex-integrations-prod',capability,
      'sq-prod-'||replace(capability,'_','-')||'@vaeroex-integrations-prod.iam.gserviceaccount.com',
      case when capability='task_invoker' then null else ('square_production_'||capability)::name end,
      case when capability='task_invoker' then null else 'database_'||capability end
    from unnest(array['broker','evidence','oauth','runtime','scheduler','task_invoker','webhook']::text[]) capability;
    insert into private.square_production_configuration_generations(
      generation,application_id,kms_key_resource,provider_policy_version,source_commit,prepared_at
    ) values (
      1,'sq0idp-production-fixture',
      'projects/vaeroex-integrations-prod/locations/us-west1/keyRings/square-production/cryptoKeys/provider-credentials',
      'square_production_internal_pilot_v1',repeat('a',40),statement_timestamp()
    );
    insert into private.square_production_runtime_bindings(
      provider_key,environment,project_id,region,generation,configuration_fingerprint,
      platform_binding_key,platform_fingerprint,provider_authority_fingerprint,source_commit,bound_at
    ) select configuration.provider_key,configuration.environment,configuration.project_id,configuration.region,
      configuration.generation,configuration.configuration_fingerprint,platform.binding_key,
      platform.platform_fingerprint,configuration.provider_authority_fingerprint,configuration.source_commit,
      statement_timestamp()
    from private.square_production_configuration_generations configuration
    cross join private.integration_production_platform_bindings platform
    where configuration.generation=1;
  `);
}

async function seedOperator(client, values) {
  await client.query(`insert into auth.users(
      id,email,raw_user_meta_data,raw_app_meta_data,created_at,updated_at
    ) values($1,'internal-pilot@example.invalid','{}','{}',statement_timestamp(),statement_timestamp())`,
  [values.operatorId]);
  await client.query(`insert into public.profiles(id,email,full_name)
    values($1,'internal-pilot@example.invalid','Internal Pilot') on conflict(id) do nothing`, [values.operatorId]);
  await client.query("insert into public.workspaces(id,name,created_by) values($1,'Internal Pilot Workspace',$2)",
    [values.workspaceId, values.operatorId]);
  await client.query("insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')",
    [values.workspaceId, values.operatorId]);
  await client.query(`insert into public.business_entities(
      id,workspace_id,entity_key,display_name,base_currency,timezone,created_by,updated_by
    ) values($1,$2,'internal-pilot','Internal Pilot Entity','USD','America/Los_Angeles',$3,$3)`,
  [values.entityId, values.workspaceId, values.operatorId]);
  await client.query("insert into auth.sessions(id,user_id,not_after) values($1,$2,statement_timestamp()+interval '2 days')",
    [values.sessionId, values.operatorId]);
}

async function exerciseRuntime(client) {
  const ids = {
    operatorId: id(), workspaceId: id(), entityId: id(), sessionId: id(), permitId: id(), stateId: id(),
    credentialId: id(), scanId: id(), taskId: id(), leaseId: id(), sourceVersionId: id()
  };
  const expectedMerchantId = "merchant-internal-001";
  const expectedLocationId = "location-internal-001";
  await seedClosedFoundation(client);
  await seedOperator(client, ids);
  await createRuntimeLogins(client);

  const configuration = (await client.query(`
    select configuration_fingerprint from private.square_production_configuration_generations where generation=1
  `)).rows[0].configuration_fingerprint;
  const approvalExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const installFingerprint = runtimeFingerprint([
    "install-permit-v1", ids.permitId, "1", configuration, ids.workspaceId, ids.entityId,
    ids.operatorId, ids.sessionId, expectedMerchantId, expectedLocationId, approvalExpiresAt
  ]);
  const installed = (await client.query(
    "select private.square_production_internal_install_permit_v1($1::jsonb) value",
    [JSON.stringify({
      approvalExpiresAt, businessEntityId: ids.entityId, configurationFingerprint: configuration,
      expectedLocationId, expectedMerchantId, generation: 1, operatorId: ids.operatorId,
      operatorSessionId: ids.sessionId, permitId: ids.permitId,
      requestFingerprint: installFingerprint, workspaceId: ids.workspaceId
    })]
  )).rows[0].value;
  assert.equal(installed.state, "prepared");

  await client.query("begin");
  try {
    await client.query("savepoint expired_denial");
    const expiredStateId = id();
    const expiredStateHash = crypto.createHash("sha256").update("synthetic-expired-denial-state").digest("hex");
    const expiredStateExpiresAt = new Date(Date.now() + 1_000).toISOString();
    const expiredCreateFingerprint = runtimeFingerprint([
      "create-state-v1", ids.permitId, expiredStateId, expiredStateHash, ids.operatorId, ids.sessionId,
      expiredStateExpiresAt, "1"
    ]);
    await asRuntimeRole(client, "oauth", "create_state", {
      actorId: ids.operatorId, expiresAt: expiredStateExpiresAt, permitId: ids.permitId,
      requestFingerprint: expiredCreateFingerprint, sessionId: ids.sessionId,
      stateHash: expiredStateHash, stateId: expiredStateId
    });
    await client.query("select pg_catalog.pg_sleep(1.1)");
    await assertRuntimeRoleRejects(client, "oauth", "deny_state", {
      denyRequestFingerprint: runtimeFingerprint(["deny-state-v1", expiredStateHash]),
      stateHash: expiredStateHash
    }, /square_production_internal_state_expired/);
    assert.deepEqual((await client.query(
      `select state_record.status,permit.state permit_state
       from private.square_production_internal_oauth_states state_record
       join private.square_production_internal_permits permit on permit.permit_id=state_record.permit_id
       where state_record.state_id=$1`, [expiredStateId]
    )).rows[0], { status: "pending", permit_state: "consent_pending" },
    "expired denial cannot mutate OAuth or permit lifecycle state");
    await client.query("rollback to savepoint expired_denial");

    await client.query("savepoint stale_denial");
    const staleStateId = id();
    const staleStateHash = crypto.createHash("sha256").update("synthetic-stale-denial-state").digest("hex");
    const staleStateExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const staleCreateFingerprint = runtimeFingerprint([
      "create-state-v1", ids.permitId, staleStateId, staleStateHash, ids.operatorId, ids.sessionId,
      staleStateExpiresAt, "1"
    ]);
    await asRuntimeRole(client, "oauth", "create_state", {
      actorId: ids.operatorId, expiresAt: staleStateExpiresAt, permitId: ids.permitId,
      requestFingerprint: staleCreateFingerprint, sessionId: ids.sessionId,
      stateHash: staleStateHash, stateId: staleStateId
    });
    await client.query(`update private.square_production_internal_permits
      set state='prepared',row_version=row_version+1 where permit_id=$1`, [ids.permitId]);
    await assertRuntimeRoleRejects(client, "oauth", "deny_state", {
      denyRequestFingerprint: runtimeFingerprint(["deny-state-v1", staleStateHash]),
      stateHash: staleStateHash
    }, /square_production_internal_state_expired/);
    assert.deepEqual((await client.query(
      `select state_record.status,permit.state permit_state
       from private.square_production_internal_oauth_states state_record
       join private.square_production_internal_permits permit on permit.permit_id=state_record.permit_id
       where state_record.state_id=$1`, [staleStateId]
    )).rows[0], { status: "pending", permit_state: "prepared" },
    "stale-permit denial cannot mutate OAuth or permit lifecycle state");
    await client.query("rollback to savepoint stale_denial");

    const deniedStateId = id();
    const deniedStateHash = crypto.createHash("sha256").update("synthetic-denied-state").digest("hex");
    const deniedStateExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    const deniedCreateFingerprint = runtimeFingerprint([
      "create-state-v1", ids.permitId, deniedStateId, deniedStateHash, ids.operatorId, ids.sessionId,
      deniedStateExpiresAt, "1"
    ]);
    await asRuntimeRole(client, "oauth", "create_state", {
      actorId: ids.operatorId, expiresAt: deniedStateExpiresAt, permitId: ids.permitId,
      requestFingerprint: deniedCreateFingerprint, sessionId: ids.sessionId,
      stateHash: deniedStateHash, stateId: deniedStateId
    });
    const denyRequestFingerprint = runtimeFingerprint(["deny-state-v1", deniedStateHash]);
    const denied = await asRuntimeRole(client, "oauth", "deny_state", {
      denyRequestFingerprint, stateHash: deniedStateHash
    });
    assert.deepEqual(Object.keys(denied).sort(), [
      "configurationFingerprint", "denialReceiptFingerprint", "generation", "status"
    ]);
    assert.equal(denied.status, "denied");
    assert.equal(denied.generation, 1);
    assert.equal(denied.configurationFingerprint, configuration);
    assert.match(denied.denialReceiptFingerprint, /^sha256:[a-f0-9]{64}$/);
    const deniedReplay = await asRuntimeRole(client, "oauth", "deny_state", {
      denyRequestFingerprint, stateHash: deniedStateHash
    });
    assert.deepEqual(deniedReplay, denied, "deny replay returns the same durable receipt and generation binding");
    const stopFingerprint = runtimeFingerprint([
      "cleanup-v1", ids.permitId, "manual_operator_stop", "3"
    ]);
    const stopped = await asRuntimeRole(client, "oauth", "cleanup", {
      cleanupFingerprint: stopFingerprint, permitId: ids.permitId, reasonCode: "manual_operator_stop"
    });
    assert.equal(stopped.state, "cleaned");
    assert.equal(stopped.replayed, false);
    const stoppedReplay = await asRuntimeRole(client, "oauth", "cleanup", {
      cleanupFingerprint: stopFingerprint, permitId: ids.permitId, reasonCode: "manual_operator_stop"
    });
    assert.equal(stoppedReplay.state, "cleaned");
    assert.equal(stoppedReplay.replayed, true);
    assert.equal(stoppedReplay.fenceFingerprint, stopped.fenceFingerprint);
  } finally {
    await client.query("rollback");
  }

  const stateHash = crypto.createHash("sha256").update("synthetic-one-use-state").digest("hex");
  const stateExpiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const createStateFingerprint = runtimeFingerprint([
    "create-state-v1", ids.permitId, ids.stateId, stateHash, ids.operatorId, ids.sessionId,
    stateExpiresAt, "1"
  ]);
  await client.query(`
    update private.integration_production_provider_capabilities
    set database_login='square_production_oauth_drift'
    where provider_key='square' and environment='production' and capability='oauth'
  `);
  await assert.rejects(
    asRuntimeRole(client, "oauth", "create_state", {
      actorId: ids.operatorId, expiresAt: stateExpiresAt, permitId: ids.permitId,
      requestFingerprint: createStateFingerprint, sessionId: ids.sessionId,
      stateHash, stateId: ids.stateId
    }),
    /square_production_internal_login_denied/
  );
  await client.query(`
    update private.integration_production_provider_capabilities
    set database_login='square_production_oauth'
    where provider_key='square' and environment='production' and capability='oauth'
  `);
  const createdState = await asRuntimeRole(client, "oauth", "create_state", {
    actorId: ids.operatorId, expiresAt: stateExpiresAt, permitId: ids.permitId,
    requestFingerprint: createStateFingerprint, sessionId: ids.sessionId,
    stateHash, stateId: ids.stateId
  });
  assert.equal(createdState.state, "consent_pending");
  await assert.rejects(
    asRuntimeRole(client, "oauth", "deny_state", {
      denyRequestFingerprint: runtimeFingerprint([
        "deny-state-v1", crypto.createHash("sha256").update("wrong-state").digest("hex")
      ]),
      stateHash
    }),
    /square_production_internal_state_denied/
  );

  const consumeRequestFingerprint = runtimeFingerprint([
    "consume-state-v2", stateHash
  ]);
  await assert.rejects(
    asRuntimeRole(client, "oauth", "consume_state", {
      consumeRequestFingerprint, consumedAtMs: Date.now(), stateHash
    }),
    /square_production_internal_payload_keys_invalid/
  );
  await client.query("select pg_catalog.pg_sleep(1.1)");
  const consumed = await asRuntimeRole(client, "oauth", "consume_state", {
    consumeRequestFingerprint, stateHash
  });
  assert.equal(consumed.status, "consumed");
  assert.equal(consumed.stateId, ids.stateId);
  assert.deepEqual(Object.keys(consumed).sort(), [
    "configurationFingerprint", "consumeReceiptFingerprint", "generation", "permitId", "stateId", "status"
  ]);
  const independentlyReconstructedConsumeFingerprint = runtimeFingerprint([
    "consume-state-v2", stateHash
  ]);
  assert.equal(independentlyReconstructedConsumeFingerprint, consumeRequestFingerprint,
    "a retry reconstructs the exact consume idempotency key without response-only timing state");
  await client.query("select pg_catalog.pg_sleep(0.1)");
  const consumedReplay = await asRuntimeRole(client, "oauth", "consume_state", {
    consumeRequestFingerprint: independentlyReconstructedConsumeFingerprint, stateHash
  });
  assert.equal(consumedReplay.status, "replayed");
  assert.deepEqual(Object.keys(consumedReplay).sort(), Object.keys(consumed).sort());
  assert.equal(consumedReplay.consumeReceiptFingerprint, consumed.consumeReceiptFingerprint);
  const reconciledState = await asRuntimeRole(client, "oauth", "reconcile_state", {
    consumeRequestFingerprint, stateHash
  });
  assert.equal(reconciledState.status, "consumed");
  assert.equal(reconciledState.generation, 1);
  assert.equal(reconciledState.configurationFingerprint, configuration);
  assert.equal(reconciledState.consumeReceiptFingerprint, consumed.consumeReceiptFingerprint);

  const exchangeRequestFingerprint = runtimeFingerprint([
    "acquire-exchange-v1", ids.stateId, consumed.consumeReceiptFingerprint
  ]);
  await client.query(`
    update private.integration_production_provider_capabilities
    set service_account='sq-prod-broker-wrong@vaeroex-integrations-prod.iam.gserviceaccount.com'
    where provider_key='square' and environment='production' and capability='broker'
  `);
  await assert.rejects(
    asRuntimeRole(client, "broker", "acquire_exchange", {
      exchangeRequestFingerprint, stateId: ids.stateId
    }),
    /square_production_internal_login_denied/
  );
  await client.query(`
    update private.integration_production_provider_capabilities
    set service_account='sq-prod-broker@vaeroex-integrations-prod.iam.gserviceaccount.com'
    where provider_key='square' and environment='production' and capability='broker'
  `);
  const exchange = await asRuntimeRole(client, "broker", "acquire_exchange", {
    exchangeRequestFingerprint, stateId: ids.stateId
  });
  assert.equal(exchange.status, "acquired");
  assert.deepEqual(Object.keys(exchange).sort(), [
    "applicationId", "applicationSecretVersionResource", "auditFingerprint",
    "configurationFingerprint", "consumeReceiptFingerprint", "exchangeId",
    "exchangeReceiptFingerprint", "exchangeRequestFingerprint", "expectedLocationId",
    "expectedMerchantId", "generation", "kmsKeyResource", "permitId", "requestedScopes",
    "stateId", "status"
  ]);
  assert.equal(exchange.generation, 1);
  assert.equal(exchange.configurationFingerprint, configuration);
  assert.equal(exchange.consumeReceiptFingerprint, consumed.consumeReceiptFingerprint);
  assert.match(exchange.exchangeId, /^[a-f0-9-]{36}$/);
  assert.match(exchange.exchangeReceiptFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(exchange.applicationSecretVersionResource,
    "projects/vaeroex-integrations-prod/secrets/square-production-application/versions/1");
  const reconciledAcquire = await asRuntimeRole(client, "broker", "reconcile_acquire", {
    exchangeRequestFingerprint, stateId: ids.stateId
  });
  assert.deepEqual(Object.keys(reconciledAcquire).sort(), [
    "applicationId", "applicationSecretVersionResource", "configurationFingerprint",
    "consumeReceiptFingerprint", "exchangeId", "exchangeReceiptFingerprint",
    "exchangeRequestFingerprint", "expectedLocationId", "expectedMerchantId", "generation",
    "kmsKeyResource", "permitId", "requestedScopes", "stateId", "status"
  ]);
  assert.equal(reconciledAcquire.status, "acquired");
  assert.equal(reconciledAcquire.stateId, ids.stateId);
  assert.equal(reconciledAcquire.exchangeRequestFingerprint, exchangeRequestFingerprint);
  assert.equal(reconciledAcquire.exchangeId, exchange.exchangeId);
  assert.equal(reconciledAcquire.exchangeReceiptFingerprint, exchange.exchangeReceiptFingerprint);
  assert.equal(reconciledAcquire.generation, 1);
  assert.equal(reconciledAcquire.configurationFingerprint, configuration);
  assert.equal(reconciledAcquire.consumeReceiptFingerprint, consumed.consumeReceiptFingerprint);
  await client.query("begin");
  try {
    const firstUncertainReconciliation = await asRuntimeRole(client, "broker", "reconcile_exchange", {
      exchangeId: exchange.exchangeId, exchangeReceiptFingerprint: exchange.exchangeReceiptFingerprint,
      exchangeRequestFingerprint, stateId: ids.stateId
    });
    assert.equal(firstUncertainReconciliation.status, "uncertain");
    assert.equal((await client.query(`select count(*)::integer count
      from private.square_production_internal_audit_events
      where permit_id=$1 and event_kind='exchange_uncertain' and outcome='blocked'
        and reason_code='exchange_outcome_uncertain'`, [ids.permitId])).rows[0].count, 1,
    "first reconcile transition emits one sanitized uncertain-exchange audit");
    const repeatedUncertainReconciliation = await asRuntimeRole(client, "broker", "reconcile_exchange", {
      exchangeId: exchange.exchangeId, exchangeReceiptFingerprint: exchange.exchangeReceiptFingerprint,
      exchangeRequestFingerprint, stateId: ids.stateId
    });
    assert.equal(repeatedUncertainReconciliation.status, "uncertain");
    assert.equal((await client.query(`select count(*)::integer count
      from private.square_production_internal_audit_events
      where permit_id=$1 and event_kind='exchange_uncertain' and outcome='blocked'
        and reason_code='exchange_outcome_uncertain'`, [ids.permitId])).rows[0].count, 1,
    "repeated reconciliation does not duplicate the uncertain-exchange audit");
  } finally {
    await client.query("rollback");
  }
  await assert.rejects(
    asRuntimeRole(client, "broker", "reconcile_acquire", {
      exchangeRequestFingerprint, stateId: id()
    }),
    /square_production_internal_exchange_acquire_receipt_denied/
  );
  await assert.rejects(
    asRuntimeRole(client, "broker", "reconcile_acquire", {
      exchangeRequestFingerprint: runtimeFingerprint(["acquire-exchange-v1", id(), consumed.consumeReceiptFingerprint]),
      stateId: ids.stateId
    }),
    /square_production_internal_exchange_acquire_receipt_denied/
  );
  const uncertainExchange = await asRuntimeRole(client, "broker", "acquire_exchange", {
    exchangeRequestFingerprint, stateId: ids.stateId
  });
  assert.equal(uncertainExchange.status, "uncertain");
  assert.equal(uncertainExchange.exchangeId, exchange.exchangeId);
  assert.equal(uncertainExchange.exchangeReceiptFingerprint, exchange.exchangeReceiptFingerprint);
  assert.equal(uncertainExchange.generation, 1);
  assert.equal(uncertainExchange.configurationFingerprint, configuration);
  assert.equal(uncertainExchange.consumeReceiptFingerprint, consumed.consumeReceiptFingerprint);
  await assert.rejects(
    asRuntimeRole(client, "broker", "reconcile_acquire", {
      exchangeRequestFingerprint, stateId: ids.stateId
    }),
    /square_production_internal_exchange_acquire_uncertain/
  );
  const reconciledUncertainExchange = await asRuntimeRole(client, "broker", "reconcile_exchange", {
    exchangeId: exchange.exchangeId, exchangeReceiptFingerprint: exchange.exchangeReceiptFingerprint,
    exchangeRequestFingerprint, stateId: ids.stateId
  });
  assert.equal(reconciledUncertainExchange.status, "uncertain");
  assert.equal(reconciledUncertainExchange.generation, 1);
  assert.equal(reconciledUncertainExchange.configurationFingerprint, configuration);
  assert.equal(reconciledUncertainExchange.consumeReceiptFingerprint, consumed.consumeReceiptFingerprint);

  const credentialVersion = 1;
  const aadContext = {
    credentialId: ids.credentialId, credentialVersion: String(credentialVersion), environment: "production",
    generation: "1", permitId: ids.permitId, projectId: "vaeroex-integrations-prod", providerKey: "square"
  };
  const aadDigest = runtimeFingerprint([
    "aad-v1", "square", "production", "vaeroex-integrations-prod", "1", ids.permitId,
    ids.credentialId, String(credentialVersion)
  ]);
  const externalEntityFingerprint = runtimeFingerprint([
    "external-entity-v1", expectedMerchantId, expectedLocationId
  ]);
  const ciphertextBase64 = Buffer.from("synthetic-encrypted-envelope-v1").toString("base64");
  const providerIssuedAt = new Date(Date.now() - 1000).toISOString();
  const accessExpiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const grantedScopes = ["INVENTORY_READ", "ITEMS_READ", "MERCHANT_PROFILE_READ", "ORDERS_READ", "PAYMENTS_READ"];
  const commandFingerprint = runtimeFingerprint([
    "credential-command-v1", ids.stateId, exchange.exchangeId, exchange.exchangeReceiptFingerprint,
    ids.credentialId, String(credentialVersion),
    runtimeFingerprint(["ciphertext-v1", ciphertextBase64]), aadDigest, externalEntityFingerprint,
    providerIssuedAt, accessExpiresAt, grantedScopes.join(",")
  ]);
  const credentialPayload = {
    aadContext, aadDigest, accessExpiresAt, ciphertextBase64, commandFingerprint,
    credentialId: ids.credentialId, credentialVersion, exchangeId: exchange.exchangeId,
    exchangeReceiptFingerprint: exchange.exchangeReceiptFingerprint, externalEntityFingerprint, grantedScopes,
    locationId: expectedLocationId, merchantId: expectedMerchantId, providerIssuedAt, stateId: ids.stateId
  };
  const committedCredential = await asRuntimeRole(client, "broker", "commit_credential", credentialPayload);
  assert.deepEqual(Object.keys(committedCredential).sort(), [
    "configurationFingerprint", "consumeReceiptFingerprint", "credentialCommandFingerprint",
    "exchangeId", "exchangeReceiptFingerprint", "exchangeRequestFingerprint", "generation",
    "permitId", "replayed", "stateId", "status"
  ]);
  assert.equal(committedCredential.status, "stored");
  assert.equal(committedCredential.replayed, false);
  assert.equal(committedCredential.generation, 1);
  assert.equal(committedCredential.configurationFingerprint, configuration);
  assert.equal(committedCredential.consumeReceiptFingerprint, consumed.consumeReceiptFingerprint);
  assert.equal(committedCredential.exchangeRequestFingerprint, exchangeRequestFingerprint);
  assert.equal(committedCredential.credentialCommandFingerprint, commandFingerprint);
  const replayedCredential = await asRuntimeRole(client, "broker", "commit_credential", credentialPayload);
  assert.deepEqual(Object.keys(replayedCredential).sort(), Object.keys(committedCredential).sort());
  assert.equal(replayedCredential.status, "stored");
  assert.equal(replayedCredential.replayed, true);
  assert.equal(replayedCredential.credentialCommandFingerprint, commandFingerprint);
  for (const changedReplay of [
    { ciphertextBase64: Buffer.from("synthetic-encrypted-envelope-v2").toString("base64") },
    { merchantId: "merchant-internal-changed" },
    { grantedScopes: grantedScopes.slice(1) }
  ]) {
    await assert.rejects(
      asRuntimeRole(client, "broker", "commit_credential", { ...credentialPayload, ...changedReplay }),
      /square_production_internal_credential_commit_denied/
    );
  }
  await assert.rejects(
    asRuntimeRole(client, "broker", "commit_credential", { ...credentialPayload, exchangeId: id() }),
    /square_production_internal_credential_commit_denied/
  );
  const storedExchange = await asRuntimeRole(client, "broker", "acquire_exchange", {
    exchangeRequestFingerprint, stateId: ids.stateId
  });
  assert.equal(storedExchange.status, "stored");
  assert.equal(storedExchange.exchangeId, exchange.exchangeId);
  assert.equal(storedExchange.exchangeReceiptFingerprint, exchange.exchangeReceiptFingerprint);
  assert.equal(storedExchange.generation, 1);
  assert.equal(storedExchange.configurationFingerprint, configuration);
  assert.equal(storedExchange.consumeReceiptFingerprint, consumed.consumeReceiptFingerprint);
  const reconciledStoredAcquire = await asRuntimeRole(client, "broker", "reconcile_acquire", {
    exchangeRequestFingerprint, stateId: ids.stateId
  });
  assert.deepEqual(Object.keys(reconciledStoredAcquire).sort(), [
    "configurationFingerprint", "consumeReceiptFingerprint", "credentialCommandFingerprint",
    "exchangeId", "exchangeReceiptFingerprint", "exchangeRequestFingerprint", "generation",
    "permitId", "stateId", "status"
  ]);
  assert.equal(reconciledStoredAcquire.status, "stored");
  assert.equal(reconciledStoredAcquire.credentialCommandFingerprint, commandFingerprint);
  const reconciledStoredExchange = await asRuntimeRole(client, "broker", "reconcile_exchange", {
    exchangeId: exchange.exchangeId, exchangeReceiptFingerprint: exchange.exchangeReceiptFingerprint,
    exchangeRequestFingerprint, stateId: ids.stateId
  });
  assert.equal(reconciledStoredExchange.status, "stored");
  assert.equal(reconciledStoredExchange.exchangeId, exchange.exchangeId);
  assert.deepEqual(Object.keys(reconciledStoredExchange).sort(), [
    "configurationFingerprint", "consumeReceiptFingerprint", "credentialCommandFingerprint",
    "exchangeId", "exchangeReceiptFingerprint", "exchangeRequestFingerprint", "generation",
    "permitId", "stateId", "status"
  ]);

  const mappingFingerprint = runtimeFingerprint([
    "confirm-mapping-v1", ids.permitId, ids.operatorId, ids.sessionId,
    expectedMerchantId, expectedLocationId, "4"
  ]);
  const mapping = await asRuntimeRole(client, "oauth", "confirm_mapping", {
    actorId: ids.operatorId, locationId: expectedLocationId, mappingFingerprint,
    merchantId: expectedMerchantId, permitId: ids.permitId, sessionId: ids.sessionId
  });
  assert.equal(mapping.state, "mapped");

  const paymentWindowEnd = new Date(Date.now() - 1000).toISOString();
  const paymentWindowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const leaseOwnerFingerprint = runtimeFingerprint(["manual-runtime-owner-v1"]);
  const scanRequestFingerprint = runtimeFingerprint([
    "create-scan-v1", ids.permitId, ids.scanId, ids.taskId,
    paymentWindowStart, paymentWindowEnd, leaseOwnerFingerprint, "5"
  ]);
  const scan = await asRuntimeRole(client, "runtime", "create_scan", {
    leaseOwnerFingerprint, paymentWindowEnd, paymentWindowStart, permitId: ids.permitId,
    requestFingerprint: scanRequestFingerprint, scanId: ids.scanId, taskId: ids.taskId
  });
  assert.equal(scan.status, "ready");

  const leaseRequestFingerprint = runtimeFingerprint([
    "acquire-page-v1", ids.scanId, ids.leaseId, leaseOwnerFingerprint, "1"
  ]);
  const lease = await asRuntimeRole(client, "runtime", "acquire_page", {
    leaseId: ids.leaseId, leaseOwnerFingerprint, requestFingerprint: leaseRequestFingerprint,
    scanId: ids.scanId
  });
  assert.equal(lease.status, "leased");
  assert.equal(lease.path, "/v2/payments");
  assert.equal(lease.continuationAllowed, false);
  await client.query("begin");
  try {
    const releaseFingerprint = runtimeFingerprint([
      "release-page-v1", ids.scanId, ids.leaseId, leaseOwnerFingerprint,
      "provider_response_invalid", "2"
    ]);
    const released = await asRuntimeRole(client, "runtime", "release_page", {
      leaseId: ids.leaseId, leaseOwnerFingerprint, reasonCode: "provider_response_invalid",
      releaseFingerprint, scanId: ids.scanId
    });
    assert.equal(released.status, "blocked");
    const recoveryPermit = (await client.query(
      "select state,row_version,credential_id is not null has_credential,mapped_at is not null has_mapping from private.square_production_internal_permits where permit_id=$1",
      [ids.permitId]
    )).rows[0];
    assert.deepEqual(recoveryPermit, {
      state: "recovery_required", row_version: "7", has_credential: true, has_mapping: true
    });
    const recoveryCleanupFingerprint = runtimeFingerprint([
      "cleanup-v1", ids.permitId, "manual_operator_stop", "7"
    ]);
    const recoveryCleanup = await asRuntimeRole(client, "oauth", "cleanup", {
      cleanupFingerprint: recoveryCleanupFingerprint, permitId: ids.permitId,
      reasonCode: "manual_operator_stop"
    });
    assert.equal(recoveryCleanup.state, "cleaned");
  } finally {
    await client.query("rollback");
  }
  const credentialReadFingerprint = runtimeFingerprint([
    "read-credential-v1", ids.scanId, ids.leaseId, leaseOwnerFingerprint,
    ids.credentialId, String(credentialVersion)
  ]);
  const encryptedCredential = await asRuntimeRole(client, "broker", "read_credential", {
    leaseId: ids.leaseId, leaseOwnerFingerprint, permitId: ids.permitId,
    requestFingerprint: credentialReadFingerprint, scanId: ids.scanId
  });
  assert.equal(encryptedCredential.ciphertextBase64, ciphertextBase64);
  assert.equal(Object.hasOwn(encryptedCredential, "accessToken"), false);

  const responseFingerprint = runtimeFingerprint(["payments-response-v1", "one-bounded-page"]);
  const pageId = runtimeFingerprint(["payments-page-v1", ids.scanId, responseFingerprint]);
  const locationFingerprint = runtimeFingerprint(["location-v1", expectedLocationId]);
  const occurredAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const observedAt = new Date().toISOString();
  const paymentFingerprint = runtimeFingerprint(["payment-v1", "synthetic-payment-001"]);
  const versionFingerprint = runtimeFingerprint(["payment-version-v1", "synthetic-version-001"]);
  const sourceFingerprint = runtimeFingerprint([
    "payment-observation-v1", ids.scanId, pageId, "1", paymentFingerprint,
    versionFingerprint, locationFingerprint, "completed", occurredAt, observedAt
  ]);
  const observations = [{
    locationFingerprint, observedAt, occurredAt, ordinal: 1, paymentFingerprint,
    paymentStatus: "completed", sourceFingerprint, sourceVersionId: ids.sourceVersionId,
    versionFingerprint
  }];
  const observationResultFingerprint = runtimeFingerprint([
    "page-observation-v1", ids.sourceVersionId, "1", paymentFingerprint,
    versionFingerprint, locationFingerprint, "completed", occurredAt, observedAt, sourceFingerprint
  ]);
  const resultFingerprint = runtimeFingerprint([
    "page-result-v2", ids.scanId, pageId, observationResultFingerprint
  ]);
  const pageCommandFingerprint = runtimeFingerprint([
    "commit-page-v1", ids.scanId, ids.leaseId, pageId, responseFingerprint,
    resultFingerprint, "false"
  ]);
  const pagePayload = {
    commandFingerprint: pageCommandFingerprint, continuation: false, leaseId: ids.leaseId,
    leaseOwnerFingerprint, observations, pageId, responseFingerprint, scanId: ids.scanId
  };
  const contendedCredentialRead = await verifyCredentialReadLockOrder(client, {
    leaseId: ids.leaseId, leaseOwnerFingerprint, permitId: ids.permitId,
    requestFingerprint: credentialReadFingerprint, scanId: ids.scanId
  });
  assert.equal(contendedCredentialRead.ciphertextBase64, ciphertextBase64);
  const committedPage = await asRuntimeRole(client, "runtime", "commit_page", pagePayload);
  assert.equal(committedPage.status, "committed");
  assert.equal(committedPage.replayed, false);
  const replayedPage = await asRuntimeRole(client, "runtime", "commit_page", pagePayload);
  assert.equal(replayedPage.status, "committed");
  assert.equal(replayedPage.replayed, true);
  for (const changedObservation of [
    { ...observations[0], paymentStatus: "pending" },
    { ...observations[0], sourceVersionId: id() }
  ]) {
    await assert.rejects(
      asRuntimeRole(client, "runtime", "commit_page", {
        ...pagePayload, observations: [changedObservation]
      }),
      /square_production_internal_(observation|page_commit)_denied/
    );
  }

  const evidenceFingerprint = runtimeFingerprint([
    "read-evidence-v1", ids.permitId, "1", configuration, "7",
    ids.workspaceId, ids.entityId, ids.operatorId, ids.sessionId
  ]);
  const evidence = await asRuntimeRole(client, "evidence", "read", {
    actorId: ids.operatorId, businessEntityId: ids.entityId, permitId: ids.permitId,
    requestFingerprint: evidenceFingerprint, sessionId: ids.sessionId, workspaceId: ids.workspaceId
  });
  assert.equal(evidence.state, "synced");
  assert.equal(evidence.observationCount, 1);
  assert.equal(evidence.providerCallsEnabled, false);
  assert.equal(Object.hasOwn(evidence, "merchantId"), false);
  const foreignWorkspaceId = id();
  const foreignEvidenceFingerprint = runtimeFingerprint([
    "read-evidence-v1", ids.permitId, "1", configuration, "7",
    foreignWorkspaceId, ids.entityId, ids.operatorId, ids.sessionId
  ]);
  await assert.rejects(
    asRuntimeRole(client, "evidence", "read", {
      actorId: ids.operatorId, businessEntityId: ids.entityId, permitId: ids.permitId,
      requestFingerprint: foreignEvidenceFingerprint, sessionId: ids.sessionId,
      workspaceId: foreignWorkspaceId
    }),
    /square_production_internal_evidence_denied/
  );
  for (const changed of [
    { actorId: id() },
    { businessEntityId: id() },
    { sessionId: id() }
  ]) {
    const deniedPayload = {
      actorId: ids.operatorId, businessEntityId: ids.entityId, permitId: ids.permitId,
      sessionId: ids.sessionId, workspaceId: ids.workspaceId, ...changed
    };
    deniedPayload.requestFingerprint = runtimeFingerprint([
      "read-evidence-v1", ids.permitId, "1", configuration, "7",
      deniedPayload.workspaceId, deniedPayload.businessEntityId,
      deniedPayload.actorId, deniedPayload.sessionId
    ]);
    await assert.rejects(
      asRuntimeRole(client, "evidence", "read", deniedPayload),
      /square_production_internal_evidence_denied/
    );
  }
  await client.query(
    "delete from public.workspace_members where workspace_id=$1 and user_id=$2",
    [ids.workspaceId, ids.operatorId]
  );
  await assert.rejects(
    asRuntimeRole(client, "evidence", "read", {
      actorId: ids.operatorId, businessEntityId: ids.entityId, permitId: ids.permitId,
      requestFingerprint: evidenceFingerprint, sessionId: ids.sessionId, workspaceId: ids.workspaceId
    }),
    /square_production_internal_operator_denied/
  );
  await client.query(
    "insert into public.workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')",
    [ids.workspaceId, ids.operatorId]
  );
  await client.query("update auth.sessions set not_after=statement_timestamp()-interval '1 second' where id=$1",
    [ids.sessionId]);
  await assert.rejects(
    asRuntimeRole(client, "evidence", "read", {
      actorId: ids.operatorId, businessEntityId: ids.entityId, permitId: ids.permitId,
      requestFingerprint: evidenceFingerprint, sessionId: ids.sessionId, workspaceId: ids.workspaceId
    }),
    /square_production_internal_operator_denied/
  );
  await client.query("update auth.sessions set not_after=statement_timestamp()+interval '2 days' where id=$1",
    [ids.sessionId]);

  const cleanupFingerprint = runtimeFingerprint([
    "cleanup-v1", ids.permitId, "internal_pilot_complete", "7"
  ]);
  const cleaned = await asRuntimeRole(client, "oauth", "cleanup", {
    cleanupFingerprint, permitId: ids.permitId, reasonCode: "internal_pilot_complete"
  });
  assert.equal(cleaned.state, "cleaned");
  const closedEvidenceFingerprint = runtimeFingerprint([
    "read-evidence-v1", ids.permitId, "1", configuration, "8",
    ids.workspaceId, ids.entityId, ids.operatorId, ids.sessionId
  ]);
  const closedEvidence = await asRuntimeRole(client, "evidence", "read", {
    actorId: ids.operatorId, businessEntityId: ids.entityId, permitId: ids.permitId,
    requestFingerprint: closedEvidenceFingerprint, sessionId: ids.sessionId,
    workspaceId: ids.workspaceId
  });
  assert.equal(closedEvidence.state, "cleaned");
  assert.equal(closedEvidence.fenced, true);

  await assert.rejects(
    asRuntimeRole(client, "runtime", "acquire_page", {
      leaseId: id(), leaseOwnerFingerprint,
      requestFingerprint: runtimeFingerprint(["blocked-after-cleanup"]), scanId: ids.scanId
    }),
    /square_production_internal_permit_fenced/
  );
  await client.query("set session authorization square_production_scheduler_authority");
  await assert.rejects(
    client.query("select public.square_production_internal_runtime_v1('acquire_page','{}'::jsonb)"),
    /permission denied/
  );
  await client.query("reset session authorization");

  const minimized = await client.query(`
    select (select count(*)::integer from private.square_production_internal_permits) permits,
      (select count(*)::integer from private.square_production_internal_credentials) credentials,
      (select count(*)::integer from private.square_production_internal_scans) scans,
      (select count(*)::integer from private.square_production_internal_page_receipts) pages,
      (select count(*)::integer from private.square_production_internal_source_versions) observations,
      (select count(*)::integer from private.square_production_internal_fences) fences,
      (select bool_and(not runtime_enabled and not provider_calls_enabled and not customer_onboarding_enabled
        and not webhook_intake_enabled and not evidence_enabled and not economic_contributions_enabled
        and not ai_dispatch_enabled) from private.square_production_configuration_generations) gates_closed
  `);
  assert.deepEqual(minimized.rows[0], {
    permits: 1, credentials: 1, scans: 1, pages: 1, observations: 1, fences: 1, gates_closed: true
  });
}

async function main() {
  assertMigrationManifest();
  const databaseUrl = localDatabaseUrl();
  await resetLocalFixture(overlayVersion);
  let client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const beforeQbo = await catalogSnapshot(client);
  await client.end();

  await resetLocalFixture(runtimeVersion);
  run(process.execPath, [
    "scripts/run-isolated-database-tests.js",
    "supabase/tests/square_production_internal_pilot_runtime.test.sql"
  ]);
  client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const ledger = await client.query(`
      select count(*)::integer count,max(version)::text head,
        'sha256:'||encode(digest(convert_to(string_agg(length(version)::text||':'||version,'' order by version),'UTF8'),'sha256'),'hex') fingerprint
      from supabase_migrations.schema_migrations where version<=$1
    `, [runtimeVersion]);
    assert.deepEqual(ledger.rows[0], { count: 104, head: runtimeVersion, fingerprint: runtimeLedgerFingerprint });
    assert.deepEqual(await catalogSnapshot(client), beforeQbo, "runtime migration leaves QBO catalog byte-for-byte unchanged");
    await exerciseRuntime(client);
  } finally {
    await dropRuntimeLogins(client);
    await client.end();
  }
  process.stdout.write("square_production_internal_runtime_qualification_ok\n");
}

async function nativeMain() {
  assertMigrationManifest();
  const target = await createNativeTarget();
  try {
    await applyNativePrefix(target.client, overlayVersion);
    const beforeQbo = await catalogSnapshot(target.client);
    const migrationName = `${runtimeVersion}_square_production_internal_pilot_runtime.sql`;
    await target.client.query(fs.readFileSync(path.join(root, "supabase/migrations", migrationName), "utf8"));
    await target.client.query(
      "insert into supabase_migrations.schema_migrations(version) values($1)",
      [runtimeVersion]
    );
    const ledger = await target.client.query(`
      select count(*)::integer count,max(version)::text head,
        'sha256:'||encode(digest(convert_to(string_agg(length(version)::text||':'||version,'' order by version),'UTF8'),'sha256'),'hex') fingerprint
      from supabase_migrations.schema_migrations where version<=$1
    `, [runtimeVersion]);
    assert.deepEqual(ledger.rows[0], { count: 104, head: runtimeVersion, fingerprint: runtimeLedgerFingerprint });
    assert.deepEqual(await catalogSnapshot(target.client), beforeQbo,
      "runtime migration leaves QBO catalog byte-for-byte unchanged");
    await runPgTapNative(target.client);
    await exerciseRuntime(target.client);
    process.stdout.write(`square_production_internal_runtime_native_qualification_ok ${target.directory}\n`);
  } finally {
    await dropRuntimeLogins(target.client);
    await target.stop();
  }
}

const entrypoint = process.argv.length === 3 && process.argv[2] === "--native"
  ? nativeMain
  : process.argv.length === 2
    ? main
    : null;
if (!entrypoint) {
  process.stderr.write("usage: node scripts/run-square-production-internal-pilot-runtime-qualification.js [--native]\n");
  process.exitCode = 2;
} else entrypoint().catch(error => {
  const diagnostic = error && typeof error.localDiagnostic === "string"
    ? `\n${error.localDiagnostic}`
    : "";
  const databaseDiagnostic = error && (error.code || error.position)
    ? `\npostgres_code=${error.code || "unknown"} position=${error.position || "unknown"}`
    : "";
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}${databaseDiagnostic}${diagnostic}\n`);
  process.exitCode = 1;
});
