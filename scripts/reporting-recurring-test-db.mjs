import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const ids = Object.freeze({
  workspace: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  actor: '33333333-3333-4333-8333-333333333333',
  connection: '44444444-4444-4444-8444-444444444444',
  lease: '55555555-5555-4555-8555-555555555555',
  viewer: '66666666-6666-4666-8666-666666666666'
});
const sql = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

// Real reporting migrations + the existing production billing functions. Auth
// identities/claims are controlled local fixtures, not proof of hosted Auth.
export async function createReportingRecurringTestDb({ beforeRecurringMigration } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,banned_until timestamptz);
    create table public.profiles(id uuid primary key);
    create table public.workspaces(id uuid primary key,subscription_required boolean not null default false,
      manually_unlocked boolean not null default false,subscription_status text default 'active',trial_ends_at timestamptz);
    create table public.customer_subscriptions(id uuid primary key default gen_random_uuid(),workspace_id uuid,billing_provider text,
      manually_activated boolean not null default false,status text,current_period_end timestamptz,
      stripe_customer_id text,stripe_subscription_id text,created_at timestamptz default now());
    create table public.workspace_members(workspace_id uuid,user_id uuid,status text,role text,primary key(workspace_id,user_id));
    grant usage on schema public,auth to authenticated,service_role;
    grant select on public.workspace_members to authenticated,service_role;`);
  const lifecycle = sql('20261002040031_google_sheets_lifecycle.sql');
  await db.exec(lifecycle.slice(lifecycle.indexOf('create function private.require_google_sheets_eligible_v1'),
    lifecycle.indexOf('create function public.google_sheets_lifecycle_v1')));
  const entitlement = sql('20261005022017_workspace_security_boundaries.sql');
  await db.exec(entitlement.slice(entitlement.indexOf('create function private.workspace_billing_entitled_v1'),
    entitlement.indexOf('create function private.workspace_entitlement_active_v1')));
  for (const migration of ['20261019001207_ready_account_reporting_connectors.sql', '20261019033506_reporting_supported_jwt_role.sql',
    '20261019070945_reporting_import_history.sql']) await db.exec(sql(migration));
  await db.query('insert into workspaces(id) values($1),($2)', [ids.workspace, ids.other]);
  await db.query('insert into profiles values($1),($2)', [ids.actor, ids.viewer]);
  await db.query('insert into auth.users(id) values($1),($2)', [ids.actor, ids.viewer]);
  await db.query("insert into workspace_members values($1,$2,'active','owner'),($1,$3,'active','viewer')", [ids.workspace, ids.actor, ids.viewer]);
  await asService(db);
  if (beforeRecurringMigration) await beforeRecurringMigration(db);
  await db.exec(sql('20261117005822_reporting_recurring_refresh.sql'));
  return db;
}

export async function asService(db) {
  await db.exec(`reset role; set request.jwt.claim.role=''; set request.jwt.claims='{"role":"service_role"}';`);
}
export async function connectReporting(db, { provider = 'harvest', workspace = ids.workspace, actor = ids.actor,
  connection = ids.connection, account = { id: '123', name: 'Fictional account' }, ciphertext = 'A'.repeat(64), recurring = true } = {}) {
  await asService(db);
  await db.query('select begin_reporting_connection($1,$2,$3,$4,null)', [workspace, provider, actor, connection]);
  await db.query('select finish_reporting_connection($1,$2,$3,$4)', [workspace, provider, connection, ciphertext]);
  await db.query('select select_reporting_account($1,$2,$3,$4,$5)', [workspace, provider, connection, JSON.stringify(account), ciphertext]);
  if (recurring) await db.query('select set_reporting_recurring($1,$2,$3,$4,true)', [workspace, provider, connection, actor]);
}
export async function dueNow(db, connection = ids.connection) {
  await db.query("update reporting_connections set recurring_next_refresh_at=clock_timestamp()-interval '1 second',next_sync_at=clock_timestamp()-interval '1 second' where id=$1", [connection]);
}
export async function claimReporting(db, { workspace = ids.workspace, provider = 'harvest', connection = ids.connection, lease = ids.lease } = {}) {
  return (await db.query('select claim_reporting_recurring($1,$2,$3,$4) as ok', [workspace, provider, connection, lease])).rows[0].ok;
}
export async function reportingPeriod(db, connection = ids.connection) {
  return (await db.query(`select ((recurring_last_attempt_at at time zone 'UTC')::date-7)::text as start,
    ((recurring_last_attempt_at at time zone 'UTC')::date-1)::text as end,
    ((recurring_last_attempt_at at time zone 'UTC')::date)::text||'T00:00:00Z' as cutoff
    from reporting_connections where id=$1`, [connection])).rows[0];
}
