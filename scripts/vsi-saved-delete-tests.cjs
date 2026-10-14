/* eslint-disable @typescript-eslint/no-require-imports -- Isolated CommonJS database regression. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync('supabase/migrations/20261014031409_vsi_saved_analysis_deletion.sql','utf8');
const baseline = fs.readFileSync('supabase/migrations/20260817185529_intelligence_briefing_storage_contract.sql','utf8');
assert.equal(migration.slice(migration.indexOf('create or replace')).replaceAll("'monthly_briefing', 'vsi'", "'monthly_briefing'"), baseline.slice(baseline.indexOf('create or replace function public.soft_delete_saved_analyses(')));
(async () => {
 const db = new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create schema auth;
   create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create function public.can_manage_workspace(uuid) returns boolean language sql as $$ select $1::text=current_setting('test.workspace',true) and current_setting('test.manager',true)='yes' $$;
   create table public.reports(id uuid primary key, workspace_id uuid,archived_at timestamptz,deleted_at timestamptz,source_data_json jsonb);
   alter table public.reports enable row level security;
   create policy scoped_reports on public.reports to authenticated using(workspace_id::text=current_setting('test.workspace',true)) with check(workspace_id::text=current_setting('test.workspace',true));
   grant usage on schema auth to authenticated; grant select,update on public.reports to authenticated;`);
  await db.exec(migration);
  const ws='00000000-0000-4000-8000-000000000001', foreign='00000000-0000-4000-8000-000000000002';
  const ids=['00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012'];
  for(let i=0;i<2;i++) await db.query('insert into reports values($1,$2,null,null,$3)',[ids[i],i?foreign:ws,{record_kind:'saved_analysis',envelope_version:1,analysis_type:'vsi',saved_analysis_key:ids[i],workspace_id:i?foreign:ws,release_channel:'production',comparisons:[{value:27}]}]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('test.workspace',$1,false),set_config('test.manager','yes',false)",[ws]);
  await db.exec('set role authenticated');
  const call=(workspace,rows,channel='production')=>db.query('select public.soft_delete_saved_analyses($1,$2,$3) n',[workspace,rows,channel]);
  await assert.rejects(()=>call(ws,ids),e=>e.code==='P0001');
  assert.equal((await db.query('select deleted_at from reports where id=$1',[ids[0]])).rows[0].deleted_at,null);
  await assert.rejects(()=>call(foreign,[ids[1]]),e=>e.code==='42501');
  await assert.rejects(()=>call(ws,[ids[0]],'preview'),e=>e.code==='P0001');
  await db.query("select set_config('test.manager','no',false)");
  await assert.rejects(()=>call(ws,[ids[0]]),e=>e.code==='42501');
  await db.query("select set_config('test.manager','yes',false)");
  assert.equal((await call(ws,[ids[0]])).rows[0].n,1);
  const saved=(await db.query('select deleted_at,source_data_json from reports where id=$1',[ids[0]])).rows[0];
  assert(saved.deleted_at); assert.deepEqual(saved.source_data_json.comparisons,[{value:27}]);
  await assert.rejects(()=>call(ws,[ids[0]]),e=>e.code==='P0001');
  await db.exec('reset role');
  assert.equal((await db.query('select deleted_at from reports where id=$1',[ids[1]])).rows[0].deleted_at,null);
  console.log('VSI soft delete: exact allowlist-only migration, caller RLS, role/workspace/channel boundaries, atomic batch rejection, retained snapshot PASS');
 } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
