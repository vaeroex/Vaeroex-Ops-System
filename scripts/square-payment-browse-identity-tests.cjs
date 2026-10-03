/* eslint-disable @typescript-eslint/no-require-imports -- Offline PostgreSQL projection qualification. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, name), 'utf8');
const migrationName = fs.readdirSync(path.join(root, 'supabase/production-migrations'))
  .filter(name => /^\d{14}_square_customer_browse_identity\.sql$/.test(name));
assert.equal(migrationName.length, 1);
const migration = `supabase/production-migrations/${migrationName[0]}`;

async function database() {
  const db = new PGlite();
  try {
    // Synthetic platform tables; owner/session helpers and Square migrations below are real SQL.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create role square_production_oauth_authority; create role square_production_broker_authority;
      create role square_production_runtime_authority; create role square_production_evidence_authority;
      create role square_production_scheduler_authority; create role square_production_webhook_authority;
      grant usage on schema public to anon,authenticated,service_role;
      create schema auth; create schema private; create schema extensions; create schema supabase_migrations;
      create function auth.role() returns text language sql stable as $$select coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role'$$;
      create function extensions.digest(bytea,text) returns bytea language sql immutable as $$select case when $2='sha256' then sha256($1) end$$;
      create table supabase_migrations.schema_migrations(version text primary key);
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb,raw_app_meta_data jsonb,created_at timestamptz,updated_at timestamptz,deleted_at timestamptz,banned_until timestamptz);
      create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users,not_after timestamptz);
      create table public.profiles(id uuid primary key,email text,full_name text);
      create table public.workspaces(id uuid primary key,name text,created_by uuid,manually_unlocked boolean not null default false);
      create table public.workspace_members(workspace_id uuid,user_id uuid,role text,status text,primary key(workspace_id,user_id));
      create table public.business_entities(id uuid primary key,workspace_id uuid not null,entity_key text,display_name text,base_currency text,timezone text,created_by uuid,updated_by uuid,status text not null default 'active',unique(workspace_id,id));
      create table public.customer_subscriptions(id uuid primary key default gen_random_uuid(),user_id uuid,workspace_id uuid,customer_email text,status text,billing_provider text,current_period_end timestamptz,stripe_customer_id text,stripe_subscription_id text,manually_activated boolean,created_at timestamptz not null default now());
      create table private.square_production_customer_connections(id uuid);
      create table private.square_production_customer_bindings(id uuid);
    `);
    const versions = fs.readdirSync(path.join(root, 'supabase/migrations'))
      .filter(name => /^\d+_.+\.sql$/.test(name) && name.split('_')[0] <= '20260902191325').sort().map(name => name.split('_')[0]);
    versions.push('20260925032300');
    assert.equal(versions.length, 105);
    for (const version of versions) await db.query('insert into supabase_migrations.schema_migrations values($1)', [version]);
    const authority = source('supabase/production-migrations/20260925032300_square_production_customer_connection.sql');
    for (const name of ['require_owner', 'require_eligible', 'require_keys']) {
      const helper = authority.match(new RegExp(`create function private\\.square_production_customer_${name}_v1\\([\\s\\S]*?\\$function\\$;`))?.[0];
      assert(helper, `Missing applied helper ${name}`);
      await db.exec(helper);
    }
    for (const name of ['20260929004917_square_customer_service_backend.sql', '20260929041048_square_customer_payment_history.sql', '20260929052211_square_customer_payment_browse.sql']) {
      await db.exec(source(`supabase/production-migrations/${name}`));
      await db.query('insert into supabase_migrations.schema_migrations values($1)', [name.split('_')[0]]);
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}

test('projection migration fails explicitly before its production Square browse dependency', async () => {
  const db = new PGlite();
  try {
    await assert.rejects(db.exec(source(migration)), error =>
      error.code === '55000' && error.message === 'square_customer_identity_requires_browse');
    await db.exec('rollback');
    const result = await db.query("select to_regprocedure('public.square_customer_payments_v1(uuid,uuid,uuid,uuid,integer,text,text,text)') as browse");
    assert.equal(result.rows[0].browse, null, 'failed prerequisite creates no browse RPC');
  } finally { await db.close(); }
});

test('forward browse migration preserves authority and exercises real tenant-scoped projection SQL', async () => {
  const db = await database();
  try {
    const catalog = `select n.nspname,p.proname,p.proacl::text,p.proowner::regrole::text,p.prosecdef,p.provolatile,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.oid='public.square_customer_payments_v1(uuid,uuid,uuid,uuid,integer,text,text,text)'::regprocedure`;
    const backend = `select pg_get_functiondef('public.square_customer_backend_v1(text,uuid,uuid,uuid,text,jsonb)'::regprocedure) as definition`;
    const authorityBefore = (await db.query(catalog)).rows;
    const backendBefore = (await db.query(backend)).rows;
    const candidate = fs.lstatSync(path.join(root, migration));
    assert(candidate.isFile() && !candidate.isSymbolicLink(), 'production candidate is a real file');
    assert.equal(fs.lstatSync(path.join(root, 'supabase/migrations', migrationName[0]), { throwIfNoEntry: false }), undefined,
      'canonical bootstrap has no premature migration or dangling symlink');
    await db.exec(source(migration));
    assert.deepEqual((await db.query(catalog)).rows, authorityBefore, 'same owner, grants, security and search path');
    assert.deepEqual((await db.query(backend)).rows, backendBefore, 'lifecycle backend unchanged');
    const browseTests = source('supabase/tests/square_customer_payment_browse.test.sql');
    await db.exec(browseTests);
    const boundary = browseTests.indexOf('create temp table browse_before');
    assert(boundary > 0);
    await db.exec(browseTests.slice(0, boundary));
    await db.exec(source('supabase/tests/square_customer_browse_identity.test.sql'));
    assert.equal(Number((await db.query('select count(*) as count from square_customer_private.connections')).rows[0].count), 0,
      'synthetic fixture rolls back');
  } finally { await db.close(); }
});
