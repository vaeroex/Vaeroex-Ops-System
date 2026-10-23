// Offline helper verification, not native concurrency evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import * as f from './shared-evidence-sql-fixture.mjs';
import * as h from './vsi-failure-accounting-tests.mjs';
const n=createRequire(import.meta.url)('./vsi-failure-accounting-qualification.cjs');
test('native accounting target and workflow stay within the owned synthetic runner',()=>{
 assert.match(n.databaseSuffix,/^[a-z][a-z0-9_]{0,19}$/);
 const workflow=f.read('.github/workflows/shared-evidence-qualification.yml');
 assert.match(workflow,/shared-evidence-writer-qualification.cjs --failure-accounting/);
 for(const script of ['vsi-failure-accounting-tests.mjs','vsi-failure-accounting-native-tests.mjs','vsi-failure-accounting-application-tests.cjs','vsi-http-accounting-tests.cjs','shared-evidence-security-draft-tests.mjs'])assert.ok(workflow.includes(script));
 assert.doesNotMatch(workflow,/pull_request|workflow_dispatch|secrets\.|environment:|supabase link|migration up|vercel deploy/);
 const runner=f.read('scripts/shared-evidence-writer-qualification.cjs');
 assert.match(runner,/qualifyFailureAccounting/);assert.match(runner,/runContainerQualification\(run\)/);
});
test('native accounting observer requires both pending queries and exact controller/privacy locks',async()=>{
 let calls=0;
 await n.waitForAccountingBarrier({query:async(sql,args)=>{
  assert.deepEqual(args,[17,16,n.barrierClass,n.barrierId]);assert.match(sql,/objsubid=2/);assert.match(sql,/pg_blocking_pids/);
  return {rows:[{barrier_wait:true,controller_blocks:++calls>1}]};
 }},17,16);assert.equal(calls,2);
 calls=0;
 await n.waitForAccountingSerialization({query:async(sql,args)=>{
  assert.deepEqual(args,[17,18,16,f.w,n.barrierClass,n.barrierId]);assert.match(sql,/google_sheets:/);assert.match(sql,/objsubid=1/);assert.match(sql,/objsubid=2/);assert.match(sql,/pg_blocking_pids/);
  const fields=['second_waits_privacy','first_blocks_second','first_holds_privacy','first_waits_barrier','controller_blocks_first'];
  const row=Object.fromEntries(fields.map(field=>[field,true]));if(calls<fields.length)row[fields[calls]]=false;calls++;return {rows:[row]};
 }},17,18,16,f.w);assert.equal(calls,6);
});
test('native helper barrier SQL and assertions cover rollback, exact success and expired-source bookkeeping',async()=>{
 const db=await h.createFailureAccountingFixture();
 try{
  await f.admin(db);await n.installAccountingBarrier(db);
  const before=await n.accountingSnapshot(db,f,f.uuid(103));
  await f.login(db,f.owner,f.session,'service_role');await db.exec("begin;select set_config('test.vsi_accounting_pause','on',true)");
  await h.failAccounting(db);await db.exec('rollback');await f.admin(db);
  assert.deepEqual(await n.accountingSnapshot(db,f,f.uuid(103)),before);
  await db.query("update private.google_sheets_retention_roots set expires_at=now()+interval '1 day' where id=$1",[f.uuid(901)]);
  await f.login(db,f.owner,f.session,'service_role');await f.settle(db,null,f.settlement(),2);await f.admin(db);
  await n.assertLegacySuccess(db,f,f.uuid(103));
  assert.deepEqual(await n.runAccountingDenials(db,f,h),{expiredSuccessDenied:true,expiredFailureAccountsOnly:true,sessionRoleBindingAndPrivacyDenied:true,clientGrantDenied:true});
 }finally{await db.close();}
});
