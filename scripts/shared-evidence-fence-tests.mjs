// Single-backend PGlite contract tests. Contention is injected, not native concurrency.
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareWriterCases,isCurrent} from './shared-evidence-writer-cases.mjs';
import {read,w,other,owner,owner2,session,uuid,login,admin,map,capture,seal,settle,newBrief,typedRead} from './shared-evidence-sql-fixture.mjs';
import {installFenceFixture,fenceRelations as relations} from './shared-evidence-fence-fixture.mjs';
async function fixture(){
 const {db,cases}=await prepareWriterCases();await admin(db);
 const {placeholders}=await installFenceFixture(db);
 await db.exec(`create table private.fence_test_events(workspace_id uuid);
 alter function private.shared_evidence_write_fence_v1(uuid) rename to shared_evidence_real_write_fence_v1;
 create function private.shared_evidence_write_fence_v1(w uuid) returns void language plpgsql security definer set search_path='' as $$begin
 if current_setting('test.shared_fence_conflict',true)=w::text then raise exception 'shared_evidence_write_conflict' using errcode='40001';end if;
 insert into private.fence_test_events values(w);perform private.shared_evidence_real_write_fence_v1(w);end$$;
 revoke all on function private.shared_evidence_write_fence_v1(uuid) from public,anon,authenticated,service_role;`);
 return {db,cases,placeholders};
}
test('known dependency installation is closed; all twelve stored writers abort on conflict without changing evidence',async()=>{
 const {db,cases,placeholders}=await fixture();
 try{
  assert.ok(placeholders.length>0,'partial deployed fixture is explicitly disclosed');
  assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname='aaa_shared_evidence_writer_fence'")).rows[0].n,relations.length);
  for(const probe of cases){await admin(db);await db.query("select set_config('test.shared_fence_conflict',$1,false)",[w]);await assert.rejects(db.query(probe.sql,probe.args),e=>e.code==='40001',probe.provider);await db.exec("select set_config('test.shared_fence_conflict','',false)");await login(db);assert.equal(await isCurrent(probe,db),true,probe.provider);}
  await admin(db);await db.query("select set_config('test.shared_fence_conflict',$1,false)",[w]);
  for(const table of relations)await assert.rejects(db.query(`insert into ${table}(${table==='public.workspaces'?'id':'workspace_id'}) values($1)`,[w]),e=>e.code==='40001',table);
  await db.exec("select set_config('test.shared_fence_conflict','',false)");
  await admin(db);await db.query('update google_sheets_mapping_approvals set approved_by=$1',[owner2]);await login(db);await typedRead(db,{kind:'sheets_ticket_source',source_id:uuid(302)});await admin(db);await db.query("update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1",[owner2]);await login(db);await assert.rejects(typedRead(db,{kind:'sheets_ticket_source',source_id:uuid(302)}),e=>e.code==='42501');
  await admin(db);await assert.rejects(db.exec('truncate public.reporting_history_days'),e=>e.code==='42501');
  await assert.rejects(db.exec('insert into private.google_sheets_retention_roots(workspace_id) values(null)'),e=>e.code==='42501');
 }finally{await db.close();}
});
test('fence includes phantom, coverage, both moved workspaces and final VSI settlement; rejects stale isolation',async()=>{
 const {db}=await fixture();try{
  await db.exec('delete from private.fence_test_events');
  await db.query('insert into private.google_sheets_retention_roots(workspace_id,id) values($1,$2)',[w,uuid(800)]);
  await db.query('update private.google_sheets_retention_roots set workspace_id=$1 where id=$2',[other,uuid(800)]);
  assert.deepEqual((await db.query('select distinct workspace_id from private.fence_test_events order by workspace_id')).rows.map(r=>r.workspace_id),[w,other]);
  await db.query("select set_config('test.shared_fence_conflict',$1,false)",[w]);
  await assert.rejects(db.query("insert into reporting_history_days values($1,'harvest',$2,'2026-10-03','{}',now(),now())",[w,uuid(11)]),e=>e.code==='40001');
  await db.exec("select set_config('test.shared_fence_conflict','',false)");
  await login(db);const ref=await capture(db,await map(db));const manifest=await seal(db,ref);
  await admin(db);await db.query("select set_config('test.shared_fence_conflict',$1,false)",[w]);
  await login(db,owner,session,'service_role');await assert.rejects(settle(db,manifest.manifest_id),e=>e.code==='40001');
  await admin(db);assert.equal((await db.query('select count(*)::int n from vsi_exchanges')).rows[0].n,0);
  await db.exec("select set_config('test.shared_fence_conflict','',false)");await db.exec("begin isolation level repeatable read");
  await login(db,owner,session,'service_role');await assert.rejects(settle(db,manifest.manifest_id),e=>e.code==='40001');await db.exec('rollback');
  await login(db,owner,session,'service_role');await settle(db,manifest.manifest_id);await admin(db);assert.equal((await db.query('select count(*)::int n from vsi_exchanges')).rows[0].n,1);
  const run=await newBrief(db);await login(db);const brief=await seal(db,ref,{kind:'briefing_run',id:run});
  const args=[w,run,owner,session,uuid(101),'intelligence_briefing_v1',JSON.stringify({contractId:'intelligence_briefing_v1',workspaceId:w,briefingType:'weekly',generationKey:'fixture-key'}),brief.manifest_id];
  await db.query("select set_config('test.shared_fence_conflict',$1,false)",[w]);await login(db,owner,session,'service_role');
  await assert.rejects(db.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',args),e=>e.code==='40001');
  await db.exec("select set_config('test.shared_fence_conflict','',false)");await db.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',args);
  await admin(db);assert.equal((await db.query("select count(*)::int n from private.shared_evidence_artifact_manifests where artifact_kind='briefing_run' and artifact_id=$1",[run])).rows[0].n,1);

 }finally{await db.close();}
});
