import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const workspace = '11111111-1111-4111-8111-111111111111';
const otherWorkspace = '22222222-2222-4222-8222-222222222222';
const user = '33333333-3333-4333-8333-333333333333';
const connection = '44444444-4444-4444-8444-444444444444';
const otherConnection = '55555555-5555-4555-8555-555555555555';
const lease = '66666666-6666-4666-8666-666666666666';
const receipt = (id, created, total = 12) => ({ receipt_number: id, store_id: 'S-1',
  created_at: `${created}T12:00:00Z`, receipt_date: '2020-06-01T09:00:00Z', updated_at: '2024-06-01T12:00:00Z',
  receipt_type: 'SALE', total_money: total, total_tax: 1, total_discount: 0, cancelled: false });

test('Loyverse historical creation ranges preserve other periods, replace overlaps, deduplicate and retain honest coverage', async () => {
  const db = new PGlite();
  const claim = async () => db.query(`update loyverse_connections set sync_lease_id=$1,sync_lease_expires_at=now()+interval '10 minutes'
    where workspace_id=$2 and id=$3`, [lease, workspace, connection]);
  const apply = async (start, end, rows, tenant = workspace) => {
    await claim();
    return db.query('select apply_loyverse_receipts($1,$2,$3,$4,$5,$6::jsonb) as n',
      [tenant, connection, lease, `${start}T00:00:00Z`, `${end}T00:00:00Z`, JSON.stringify(rows)]);
  };
  const report = async (start = null, end = null, tenant = workspace) =>
    (await db.query('select loyverse_saved_report($1,$2,$3,$4) as report', [tenant, connection, start, end])).rows[0].report;
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role') $$;
      create table public.workspaces(id uuid primary key); create table public.profiles(id uuid primary key);
      create table public.workspace_members(workspace_id uuid,user_id uuid,status text);
      grant usage on schema public,auth to authenticated,service_role;
      grant select on public.workspace_members to authenticated,service_role;`);
    for (const file of ['20261017013603_loyverse_read_only_connection.sql', '20261017184954_loyverse_merchant_reconnect_guard.sql',
      '20261019070953_loyverse_import_history.sql']) await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    await db.query('insert into workspaces values ($1),($2)', [workspace, otherWorkspace]);
    await db.query('insert into profiles values ($1)', [user]);
    await db.query(`insert into workspace_members values ($1,$2,'active')`, [workspace, user]);
    await db.query(`insert into loyverse_connections(id,workspace_id,created_by,status) values ($1,$2,$3,'connected'),($4,$5,$3,'connected')`,
      [connection, workspace, user, otherConnection, otherWorkspace]);
    await assert.rejects(apply('2024-01-01','2024-01-03',[]), /service_role_required/);
    await db.exec(`set request.jwt.claims='{"role":"service_role"}';`);
    await db.query(`insert into loyverse_receipt_facts(workspace_id,connection_id,receipt_number,store_id,receipt_date,updated_at,
      receipt_type,total_money,total_tax,total_discount,cancelled) values ($1,$2,'legacy','s',now(),now(),'SALE',5,0,0,false)`, [workspace,connection]);
    assert.equal((await report()).unknown_date_receipts, 1);
    assert.equal((await report()).covered_days, 0);
    assert.equal((await apply('2024-01-01','2024-01-03',[receipt('A','2024-01-01'),receipt('B','2024-01-02')])).rows[0].n,2);
    assert.equal((await report('2024-01-01','2024-01-02')).sales,24);
    assert.equal((await report('2024-01-01','2024-01-02')).complete_days,2);
    assert.equal((await report('2020-06-01','2020-06-01')).receipts,0,'receipt_date is not the creation filter');
    await apply('2024-02-01','2024-02-02',[]);
    assert.equal((await report('2024-02-01','2024-02-01')).sales,0);
    assert.equal((await report('2024-02-01','2024-02-01')).covered_days,1,'empty success still proves a completed read');
    assert.equal((await report()).requested_days,32);
    assert.equal((await report()).covered_days,3,'gaps are not declared covered');
    await apply('2024-01-02','2024-01-04',[receipt('B','2024-01-02',30)]);
    assert.equal((await report()).sales,47,'outside A and unknown legacy survive');
    await apply('2024-01-03','2024-01-04',[receipt('A','2024-01-03',20)]);
    assert.equal((await report()).sales,55,'moved provider ID replaces globally without duplication');
    assert.equal((await report('2024-01-01','2024-01-01')).receipts,0);
    await apply('2024-01-02','2024-01-03',[]);
    assert.equal((await report()).sales,25,'empty selected range removes stale B only');
    await apply('2024-01-03','2024-01-04',[receipt('A','2024-01-03',21),receipt('legacy','2024-01-03',6)]);
    assert.equal((await report()).unknown_date_receipts,0,'re-import learns legacy creation timestamp');
    const before = await report();
    await assert.rejects(apply('2024-01-03','2024-01-04',[receipt('A','2024-01-03'),receipt('A','2024-01-03')]),/snapshot_invalid/);
    await assert.rejects(apply('2024-01-03','2024-01-04',[receipt('outside','2024-01-05')]),/snapshot_invalid/);
    await assert.rejects(apply('2024-01-01','2025-02-01',[]),/snapshot_invalid/);
    await assert.rejects(apply('2024-01-03','2024-01-04',[{...receipt('bad','2024-01-03'),store_id:null}]),/null value/);
    await assert.rejects(apply('2024-01-03','2024-01-04',[],otherWorkspace),/lease_invalid/);
    assert.deepEqual(await report(), before,'all failed batches roll back facts and coverage');
    assert.equal(await report(null,null,otherWorkspace),null);
    await db.query(`insert into loyverse_receipt_facts(workspace_id,connection_id,receipt_number,store_id,receipt_date,created_at,updated_at,
      receipt_type,total_money,total_tax,total_discount,cancelled)
      select $1,$2,'bulk-'||n,'s','2024-03-01','2024-03-01','2024-03-01','SALE',1,0,0,false from generate_series(1,1501) n`,[workspace,connection]);
    assert.equal((await report('2024-03-01','2024-03-01')).receipts,1501,'aggregate is not capped at 1000 REST rows');
    const today = new Date().toISOString().slice(0,10);
    await claim();
    await db.query('select apply_loyverse_receipts($1,$2,$3,$4,$5,$6::jsonb)',
      [workspace,connection,lease,`${today}T00:00:00Z`,new Date().toISOString(),'[]']);
    assert.equal((await report(today,today)).covered_days,1);
    assert.equal((await report(today,today)).complete_days,0,'today is honestly marked partial');
    await db.query(`insert into loyverse_import_days values($1,$2,'2024-01-01','2024-01-02',now())`,[otherWorkspace,otherConnection]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub='${user}';`);
    assert.ok((await db.query('select workspace_id from loyverse_import_days')).rows.every(row=>row.workspace_id===workspace));
    await assert.rejects(db.query('select loyverse_saved_report($1,$2)',[workspace,connection]),/permission denied/);
    await assert.rejects(db.query('delete from loyverse_import_days'),/permission denied/);
    await db.exec('reset role;');
    await claim();
    await db.query(`update loyverse_connections set sync_lease_expires_at=now()-interval '1 second' where id=$1`,[connection]);
    await assert.rejects(db.query('select apply_loyverse_receipts($1,$2,$3,$4,$5,$6::jsonb)',[workspace,connection,lease,'2024-01-03','2024-01-04','[]']),/lease_invalid/);
    assert.equal((await db.query('select disconnect_loyverse_connection($1,$2) as ok',[otherWorkspace,connection])).rows[0].ok,false);
    assert.equal((await db.query('select disconnect_loyverse_connection($1,$2) as ok',[workspace,connection])).rows[0].ok,true);
    assert.equal((await db.query('select count(*)::int as n from loyverse_receipt_facts where workspace_id=$1',[workspace])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int as n from loyverse_import_days where workspace_id=$1',[workspace])).rows[0].n,0);
    await assert.rejects(apply('2024-01-03','2024-01-04',[]),/lease_invalid/);
  } finally { await db.close(); }
});
