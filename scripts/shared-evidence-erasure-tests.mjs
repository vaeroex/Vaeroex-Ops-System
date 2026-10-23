// Sequential helper verification only. Native interleavings run in disposable CI.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import * as f from './shared-evidence-sql-fixture.mjs';
import {prepareWriterCases} from './shared-evidence-writer-cases.mjs';
import {installFenceFixture} from './shared-evidence-fence-fixture.mjs';
const {databaseSuffix,installErasureFixture,issueSyntheticCapability,waitForPrivacyInversion}=createRequire(import.meta.url)('./shared-evidence-erasure-qualification.cjs');
test('privacy runner database suffix respects existing owned-container bounds',()=>{
 assert.match(databaseSuffix,/^[a-z][a-z0-9_]{0,19}$/);
});
test('repository erasure guard/canonical hash enforce exact old row and transaction capability; rollback leaves source intact',async()=>{
 const {db}=await prepareWriterCases();
 try{
  await f.admin(db);await installFenceFixture(db);await installErasureFixture(db,f);
  const row=(await db.query('select to_jsonb(k) r from kpis k where id=$1',[f.uuid(304)])).rows[0].r;
  await db.exec('begin');await issueSyntheticCapability(db,f);
  assert.equal((await db.query("select private.google_sheets_exact_delete_allowed_v1($1,'kpis',$2,$3) ok",[f.w,f.uuid(304),JSON.stringify({...row,actual_value:99})])).rows[0].ok,false);
  await db.query('delete from kpis where id=$1',[f.uuid(304)]);await db.exec('rollback');
  assert.deepEqual((await db.query('select to_jsonb(k) r from kpis k where id=$1',[f.uuid(304)])).rows[0].r,row);
  await db.exec('begin');await issueSyntheticCapability(db,f);await db.exec('commit');
  await db.exec("begin;select set_config('vaeroex.google_sheets_erasure_request','synthetic',true)");
  await assert.rejects(db.query('delete from kpis where id=$1',[f.uuid(304)]),e=>e.code==='42501');await db.exec('rollback');
 }finally{await db.close();}
});
test('native privacy barrier requires exact blocked privacy key, writer PID and held workspace fence; workflow invokes it',async()=>{
 let calls=0;
 await waitForPrivacyInversion({query:async(sql,args)=>{assert.deepEqual(args,[17,18,f.w]);assert.match(sql,/pg_blocking_pids/);assert.match(sql,/shared-evidence-write-v1/);assert.match(sql,/google_sheets:/);calls++;return {rows:[{privacy_wait:true,writer_blocks:true,reader_has_fence:calls>1}]};}},17,18,f.w);
 assert.equal(calls,2);
 const workflow=f.read('.github/workflows/shared-evidence-qualification.yml');assert.match(workflow,/shared-evidence-writer-qualification.cjs --privacy-erasure/);
 assert.doesNotMatch(workflow,/pull_request|workflow_dispatch|secrets\.|environment:|supabase link|migration up|vercel deploy/);
});
