const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { resetLocalFixture } = require("./prepare-production-shaped-local-database.js");

const root = path.resolve(__dirname, "..");
const cli = process.env.SUPABASE_CLI_PATH || "supabase";
const baseVersion = "20260902191323";
const overlayVersion = "20260902191324";

function fail(message, status = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(status);
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
    fail(`${command} ${args.join(" ")} failed`, result.status || 1);
  }
  return result;
}

function localDatabaseUrl() {
  const status = run(cli, ["status", "-o", "env"], true);
  const line = status.stdout.split(/\r?\n/).find((value) => value.startsWith("DB_URL="));
  if (!line) fail("The isolated local database URL is unavailable.");
  const raw = line.slice("DB_URL=".length).trim();
  const value = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  const parsed = new URL(value);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost"].includes(parsed.hostname)
    || parsed.search || parsed.hash) {
    fail("Square Production qualification is restricted to a canonical local PostgreSQL URL.");
  }
  return value;
}

function assertMigrationManifest() {
  const names = fs.readdirSync(path.join(root, "supabase/migrations"))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  const baselineVersions = names
    .filter((name) => name.split("_", 1)[0] <= baseVersion)
    .map((name) => name.split("_", 1)[0]);
  assert.equal(baselineVersions.length, 102);
  assert.equal(
    `sha256:${crypto.createHash("sha256").update(
      baselineVersions.map((version) => `${version.length}:${version}`).join("")
    ).digest("hex")}`,
    "sha256:3326a738d016df98e0fd22830b8c950dac3cc6d50bd26b61de1d9ebd282c201f"
  );
  assert.equal(names[101], `${baseVersion}_integration_production_runtime_foundation.sql`);
  assert.equal(names[102], `${overlayVersion}_square_production_runtime_overlay.sql`);
  assert.equal(names[103], "20260907042202_square_dormant_trusted_authority.sql");
}

async function qualifySubstitutedLedger(databaseUrl) {
  const migration = fs.readFileSync(path.join(
    root,
    "supabase/migrations/20260902191324_square_production_runtime_overlay.sql"
  ), "utf8");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const changed = await client.query(`
      update supabase_migrations.schema_migrations
      set version='20260826089999'
      where version='20260826090000'
    `);
    assert.equal(changed.rowCount, 1, "negative fixture substitutes exactly one expected ledger version");
    await assert.rejects(
      client.query(migration),
      /square_production_overlay_requires_exact_102_version_baseline/,
      "missing-plus-unexpected ledger substitution must fail closed"
    );
    await client.query("rollback");
    const absent = await client.query(
      "select to_regclass('private.square_production_configuration_generations') is null as absent"
    );
    assert.equal(absent.rows[0].absent, true, "rejected ledger substitution creates no overlay relation");
  } finally {
    await client.end();
  }
}

async function qualifyPerDatabaseRoleSetting(databaseUrl) {
  const migration = fs.readFileSync(path.join(
    root,
    "supabase/migrations/20260902191324_square_production_runtime_overlay.sql"
  ), "utf8");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      do $fixture$
      begin
        execute pg_catalog.format(
          'alter role square_production_oauth_authority in database %I set statement_timeout=%L',
          current_database(),
          '1s'
        );
      end
      $fixture$
    `);
    const present = await client.query(`
      select count(*)::integer as count
      from pg_catalog.pg_db_role_setting
      where setrole='square_production_oauth_authority'::regrole::oid
    `);
    assert.equal(present.rows[0].count, 1, "negative fixture creates one database-scoped role setting");
    await assert.rejects(
      client.query(migration),
      /square_production_overlay_authority_role_drift/,
      "database-scoped authority settings must fail closed before overlay creation"
    );
    await client.query("rollback");
    const absent = await client.query(
      "select to_regclass('private.square_production_configuration_generations') is null as absent"
    );
    assert.equal(absent.rows[0].absent, true, "rejected role setting creates no overlay relation");
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.query(`
      do $cleanup$
      begin
        execute pg_catalog.format(
          'alter role square_production_oauth_authority in database %I reset all',
          current_database()
        );
      end
      $cleanup$
    `).catch(() => undefined);
    await client.end();
  }
}

async function qualifySequencePrivilegeDrift(databaseUrl) {
  const migration = fs.readFileSync(path.join(
    root,
    "supabase/migrations/20260902191324_square_production_runtime_overlay.sql"
  ), "utf8");
  const sequence = "public.document_extraction_provider_outcomes_outcome_sequence_seq";
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`grant usage on sequence ${sequence} to public`);
    const effective = await client.query(`
      select pg_catalog.has_sequence_privilege(
        'square_production_oauth_authority',
        $1::regclass,
        'USAGE'
      ) as effective
    `, [sequence]);
    assert.equal(effective.rows[0].effective, true, "negative fixture exposes one application sequence");
    await assert.rejects(
      client.query(migration),
      error => error.message === "square_production_overlay_authority_rpc_not_closed"
        && error.code === "42501"
        && error.detail === "failed_checks=unexpected_non_system_sequence_privilege",
      "effective application-sequence authority must fail the final closure"
    );
    await client.query("rollback");
    const absent = await client.query(
      "select to_regclass('private.square_production_configuration_generations') is null as absent"
    );
    assert.equal(absent.rows[0].absent, true, "rejected sequence privilege leaves no overlay relation");
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.query(`revoke usage on sequence ${sequence} from public`).catch(() => undefined);
    await client.end();
  }
}

async function qualifyMaintainPrivilegeDrift(databaseUrl) {
  const migration = fs.readFileSync(path.join(
    root,
    "supabase/migrations/20260902191324_square_production_runtime_overlay.sql"
  ), "utf8");
  const relation = "public.document_extraction_provider_outcomes";
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`grant maintain on table ${relation} to public`);
    const effective = await client.query(`
      select pg_catalog.has_table_privilege(
        'square_production_oauth_authority',
        $1::regclass,
        'MAINTAIN'
      ) as effective
    `, [relation]);
    assert.equal(effective.rows[0].effective, true, "negative fixture exposes table maintenance");
    await assert.rejects(
      client.query(migration),
      error => error.message === "square_production_overlay_authority_rpc_not_closed"
        && error.code === "42501"
        && error.detail === "failed_checks=unexpected_non_system_relation_privilege",
      "effective application-table MAINTAIN authority must fail the final closure"
    );
    await client.query("rollback");
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.query(`revoke maintain on table ${relation} from public`).catch(() => undefined);
    await client.end();
  }
}

async function qualifyCustomPgRoutineDrift(databaseUrl) {
  const migration = fs.readFileSync(path.join(
    root,
    "supabase/migrations/20260902191324_square_production_runtime_overlay.sql"
  ), "utf8");
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`
      set allow_system_table_mods=on;
      create schema pg_square_qualification;
      grant usage on schema pg_square_qualification to public;
      create function pg_square_qualification.ambient_public_probe()
      returns integer language sql as 'select 1'
    `);
    const effective = await client.query(`
      select pg_catalog.has_schema_privilege(
          'square_production_oauth_authority','pg_square_qualification','USAGE'
        ) and pg_catalog.has_function_privilege(
          'square_production_oauth_authority',
          'pg_square_qualification.ambient_public_probe()','EXECUTE'
        ) as effective
    `);
    assert.equal(effective.rows[0].effective, true, "negative fixture exposes a callable custom pg_* routine");
    await assert.rejects(
      client.query(migration),
      /square_production_overlay_authority_rpc_not_closed/,
      "a callable routine in a custom pg_* schema must fail the final closure"
    );
    await client.query("rollback");
  } finally {
    await client.query("rollback").catch(() => undefined);
    await client.query("drop schema if exists pg_square_qualification cascade").catch(() => undefined);
    await client.query("set allow_system_table_mods=off").catch(() => undefined);
    await client.end();
  }
}

async function snapshotQboCatalog(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`
      select pg_catalog.jsonb_build_object(
        'columns',coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
            namespace.nspname,relation.relname,attribute.attnum,attribute.attname,
            pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),
            attribute.attnotnull,attribute.attidentity,attribute.attgenerated,
            pg_catalog.pg_get_expr(default_value.adbin,default_value.adrelid,true)
          ) order by namespace.nspname,relation.relname,attribute.attnum)
          from pg_catalog.pg_class relation
          join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
          join pg_catalog.pg_attribute attribute on attribute.attrelid=relation.oid
          left join pg_catalog.pg_attrdef default_value
            on default_value.adrelid=relation.oid and default_value.adnum=attribute.attnum
          where (relation.relname ~* '(qbo|quickbooks)' or namespace.nspname ~* '(qbo|quickbooks)')
            and attribute.attnum>0 and not attribute.attisdropped
        ),'[]'::jsonb),
        'constraints',coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
            namespace.nspname,relation.relname,constraint_record.conname,
            pg_catalog.pg_get_constraintdef(constraint_record.oid,true)
          ) order by namespace.nspname,relation.relname,constraint_record.conname)
          from pg_catalog.pg_constraint constraint_record
          join pg_catalog.pg_class relation on relation.oid=constraint_record.conrelid
          join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
          where relation.relname ~* '(qbo|quickbooks)' or constraint_record.conname ~* '(qbo|quickbooks)'
        ),'[]'::jsonb),
        'indexes',coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
            namespace.nspname,relation.relname,index_relation.relname,
            pg_catalog.pg_get_indexdef(index_record.indexrelid,0,true)
          ) order by namespace.nspname,relation.relname,index_relation.relname)
          from pg_catalog.pg_index index_record
          join pg_catalog.pg_class relation on relation.oid=index_record.indrelid
          join pg_catalog.pg_class index_relation on index_relation.oid=index_record.indexrelid
          join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
          where relation.relname ~* '(qbo|quickbooks)' or index_relation.relname ~* '(qbo|quickbooks)'
        ),'[]'::jsonb),
        'functions',coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
            namespace.nspname,function_record.proname,
            pg_catalog.pg_get_function_identity_arguments(function_record.oid),
            pg_catalog.pg_get_functiondef(function_record.oid)
          ) order by namespace.nspname,function_record.proname,
            pg_catalog.pg_get_function_identity_arguments(function_record.oid))
          from pg_catalog.pg_proc function_record
          join pg_catalog.pg_namespace namespace on namespace.oid=function_record.pronamespace
          where function_record.proname ~* '(qbo|quickbooks)'
        ),'[]'::jsonb),
        'triggers',coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
            namespace.nspname,relation.relname,trigger_record.tgname,
            pg_catalog.pg_get_triggerdef(trigger_record.oid,true)
          ) order by namespace.nspname,relation.relname,trigger_record.tgname)
          from pg_catalog.pg_trigger trigger_record
          join pg_catalog.pg_class relation on relation.oid=trigger_record.tgrelid
          join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
          where not trigger_record.tgisinternal
            and (relation.relname ~* '(qbo|quickbooks)' or trigger_record.tgname ~* '(qbo|quickbooks)')
        ),'[]'::jsonb),
        'policies',coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
            namespace.nspname,relation.relname,policy.polname,
            pg_catalog.pg_get_expr(policy.polqual,policy.polrelid,true),
            pg_catalog.pg_get_expr(policy.polwithcheck,policy.polrelid,true)
          ) order by namespace.nspname,relation.relname,policy.polname)
          from pg_catalog.pg_policy policy
          join pg_catalog.pg_class relation on relation.oid=policy.polrelid
          join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
          where relation.relname ~* '(qbo|quickbooks)' or policy.polname ~* '(qbo|quickbooks)'
        ),'[]'::jsonb)
      ) as snapshot
    `);
    return result.rows[0].snapshot;
  } finally {
    await client.end();
  }
}

async function snapshotPreservedRoutineAcls(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const result = await client.query(`
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(
        namespace.nspname,
        function_record.proname,
        pg_catalog.pg_get_function_identity_arguments(function_record.oid),
        owner_role.rolname,
        case when function_acl.grantee=0 then 'PUBLIC' else grantee_role.rolname end,
        function_acl.privilege_type,
        function_acl.is_grantable
      ) order by namespace.nspname,function_record.proname,
        pg_catalog.pg_get_function_identity_arguments(function_record.oid),
        function_acl.grantee,function_acl.privilege_type),'[]'::jsonb) as snapshot
      from pg_catalog.pg_proc function_record
      join pg_catalog.pg_namespace namespace on namespace.oid=function_record.pronamespace
      join pg_catalog.pg_roles owner_role on owner_role.oid=function_record.proowner
      cross join lateral pg_catalog.aclexplode(function_record.proacl) function_acl
      left join pg_catalog.pg_roles grantee_role on grantee_role.oid=function_acl.grantee
      where namespace.nspname not in ('pg_catalog','information_schema','extensions')
        and function_record.proname not like '%square_production%'
        and function_record.oid<>all(array[
          'public.match_business_memory_chunks(uuid,extensions.vector,integer,double precision)'::regprocedure::oid,
          'public.set_updated_at()'::regprocedure::oid
        ])
    `);
    return result.rows[0].snapshot;
  } finally {
    await client.end();
  }
}

async function main() {
  assertMigrationManifest();
  const databaseUrl = localDatabaseUrl();

  await resetLocalFixture(baseVersion);
  await qualifySubstitutedLedger(databaseUrl);
  await resetLocalFixture(baseVersion);
  await qualifyPerDatabaseRoleSetting(databaseUrl);
  await resetLocalFixture(baseVersion);
  await qualifySequencePrivilegeDrift(databaseUrl);
  await resetLocalFixture(baseVersion);
  await qualifyMaintainPrivilegeDrift(databaseUrl);
  await resetLocalFixture(baseVersion);
  await qualifyCustomPgRoutineDrift(databaseUrl);
  await resetLocalFixture(baseVersion);
  const beforeQbo = await snapshotQboCatalog(databaseUrl);
  const beforePreservedRoutineAcls = await snapshotPreservedRoutineAcls(databaseUrl);

  await resetLocalFixture(overlayVersion);
  const afterQbo = await snapshotQboCatalog(databaseUrl);
  const afterPreservedRoutineAcls = await snapshotPreservedRoutineAcls(databaseUrl);
  assert.deepEqual(afterQbo, beforeQbo, "Square Production overlay leaves every QBO catalog contract unchanged");
  assert.deepEqual(
    afterPreservedRoutineAcls,
    beforePreservedRoutineAcls,
    "Square Production overlay preserves every unrelated explicit routine grant"
  );

  run(process.execPath, [
    "scripts/run-isolated-database-tests.js",
    "supabase/tests/square_production_runtime_overlay.test.sql"
  ]);
}

main().catch((error) => fail(error instanceof Error ? error.stack || error.message : String(error)));
