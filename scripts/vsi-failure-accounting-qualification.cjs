// Native synthetic qualification only, through the existing owned-container runner.
// Three sessions and exact lock observations; no hosted target, metadata input,
// provider calls, application activation, or complete deployed-schema claim.
const assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const databaseSuffix='vsi_accounting';
const barrierClass=19483,barrierId=714;
const adapter=c=>({query:(q,a)=>c.query(q,a),exec:q=>c.query(q),close:async()=>{}});
async function installAccountingBarrier(db){
 await db.exec(`create function private.fixture_accounting_pause() returns trigger language plpgsql as $$begin
 if current_setting('test.vsi_accounting_pause',true)='on' then perform pg_advisory_xact_lock(${barrierClass},${barrierId});end if;return new;end$$;
 create trigger fixture_accounting_pause before insert on public.vsi_cost_events for each row execute function private.fixture_accounting_pause();`);
}
async function waitForAccountingBarrier(control,firstPid,controlPid){
 const until=Date.now()+5000;
 while(Date.now()<until){
  const {rows}=await control.query(`select exists(select 1 from pg_locks where pid=$1 and locktype='advisory'
   and classid=$3::oid and objid=$4::oid and objsubid=2 and not granted) barrier_wait,
   $2::int=any(pg_blocking_pids($1)) controller_blocks`,[firstPid,controlPid,barrierClass,barrierId]);
  if(rows[0].barrier_wait&&rows[0].controller_blocks)return;
  await delay(20);
 }throw Error('accounting_cost_barrier_not_observed');
}
async function waitForAccountingSerialization(control,firstPid,secondPid,controlPid,workspace){
 const until=Date.now()+5000;
 while(Date.now()<until){
  const {rows}=await control.query(`with key as (select hashtextextended('google_sheets:'||$4::text,0) privacy)
   select exists(select 1 from pg_locks,key where pid=$2 and locktype='advisory' and objsubid=1 and not granted
    and classid=((privacy>>32)&4294967295)::oid and objid=(privacy&4294967295)::oid) second_waits_privacy,
   $1::int=any(pg_blocking_pids($2)) first_blocks_second,
   exists(select 1 from pg_locks,key where pid=$1 and locktype='advisory' and objsubid=1 and granted
    and classid=((privacy>>32)&4294967295)::oid and objid=(privacy&4294967295)::oid) first_holds_privacy,
   exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and objsubid=2 and not granted
    and classid=$5::oid and objid=$6::oid) first_waits_barrier,
   $3::int=any(pg_blocking_pids($1)) controller_blocks_first`,[firstPid,secondPid,controlPid,workspace,barrierClass,barrierId]);
  const r=rows[0];
  if(r.second_waits_privacy&&r.first_blocks_second&&r.first_holds_privacy&&r.first_waits_barrier&&r.controller_blocks_first)return;
  await delay(20);
 }throw Error('accounting_overlapping_serialization_not_observed');
}
async function accountingSnapshot(db,f,id){
 const request=(await db.query('select to_jsonb(r) v from vsi_requests r where id=$1',[id])).rows[0]?.v;
 const conversation=(await db.query('select to_jsonb(c) v from vsi_conversations c where id=$1',[f.uuid(102)])).rows[0]?.v;
 const events=(await db.query('select to_jsonb(e) v from vsi_cost_events e where request_id=$1 order by id',[id])).rows.map(r=>r.v);
 const exchanges=(await db.query('select to_jsonb(e) v from vsi_exchanges e where id=$1',[id])).rows.map(r=>r.v);
 const links=(await db.query('select to_jsonb(m) v from private.shared_evidence_artifact_manifests m where artifact_id=$1 order by artifact_revision',[id])).rows.map(r=>r.v);
 return {request,conversation,events,exchanges,links};
}
async function assertLegacySuccess(db,f,id){
 const state=await accountingSnapshot(db,f,id);
 assert.equal(state.request.status,'completed');assert.equal(Number(state.request.cost_usd),0.03);
 assert.equal(Number(state.request.reservation_usd),0);assert.equal(state.request.lease_until,null);
 assert.equal(state.events.length,1);assert.equal(Number(state.events[0].cost_usd),0.03);
 assert.equal(state.exchanges.length,1);assert.equal(state.exchanges[0].answer,'Supported fixture answer');
 return state;
}
async function runAccountingDenials(db,f,h){
 // Run without an open transaction: each denied statement must leave an exact
 // pending snapshot and no ledger/output mutation, then authority is restored.
 const id=await f.newRequest(db,2070);await f.admin(db);
 await db.query("update private.google_sheets_retention_roots set expires_at=now()-interval '1 day' where id=$1",[f.uuid(901)]);
 const before=await accountingSnapshot(db,f,id);
 const deny=async(code,call)=>{
  await f.login(db,f.owner,f.session,'service_role');await assert.rejects(call(),e=>e.code===code);
  await f.admin(db);assert.deepEqual(await accountingSnapshot(db,f,id),before);
 };
 await deny('55000',()=>f.settle(db,null,f.settlement({id}),2));
 await db.query('delete from auth.sessions where id=$1',[f.session]);
 await deny('42501',()=>h.failAccounting(db,{request:id}));
 await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[f.session,f.owner]);
 await db.query("update workspace_members set role='admin' where user_id=$1 and workspace_id=$2",[f.owner,f.w]);
 await deny('42501',()=>h.failAccounting(db,{request:id}));
 await db.query("update workspace_members set role='owner' where user_id=$1 and workspace_id=$2",[f.owner,f.w]);
 await db.query('update private.google_sheets_privacy_epochs set blocked=true where workspace_id=$1',[f.w]);
 await deny('55000',()=>h.failAccounting(db,{request:id}));
 await db.query('update private.google_sheets_privacy_epochs set blocked=false where workspace_id=$1',[f.w]);
 for(const change of [{actor:f.owner2},{session:f.secondSession},{workspace:f.other},{conversation:f.uuid(999)},{attempt:2}])
  await deny(change.attempt?'40001':'42501',()=>h.failAccounting(db,{request:id,...change}));
 await f.login(db);await assert.rejects(h.failAccounting(db,{request:id}),e=>e.code==='42501');
 await f.admin(db);assert.deepEqual(await accountingSnapshot(db,f,id),before);
 await f.login(db,f.owner,f.session,'service_role');
 assert.deepEqual((await h.failAccounting(db,{request:id})).rows[0].v,{state:'failed'});
 await h.assertFailureAccountingState(db,{id});
 assert.deepEqual((await accountingSnapshot(db,f,id)).conversation,before.conversation);
 assert.equal((await db.query("select google_sheets_record_readable_v1($1,'vsi_conversations',$2) v",[f.w,f.uuid(102)])).rows[0].v,false);
 await f.login(db,f.owner,f.session,'service_role');
 await assert.rejects(f.settle(db,null,f.settlement({id}),2),e=>e.code==='55000');
 await h.assertFailureAccountingState(db,{id});await f.admin(db);
 return {expiredSuccessDenied:true,expiredFailureAccountsOnly:true,sessionRoleBindingAndPrivacyDenied:true,clientGrantDenied:true};
}
async function qualifyFailureAccounting(target){
 assert.equal(target.targetKind,'owned-supabase-image');
 const f=await import('./shared-evidence-sql-fixture.mjs');
 const h=await import('./vsi-failure-accounting-tests.mjs');
 const database=await target.createDatabase(databaseSuffix,'empty');
 const control=database.client,db=adapter(control),clients=[];
 let firstPending=null,secondPending=null,stage='fixture';
 try{
  await h.createFailureAccountingFixture({createDatabase:async()=>db});await f.admin(db);await installAccountingBarrier(db);
  const {Client}=require('pg');
  for(let i=0;i<2;i++){
   const c=new Client({...database.connection,application_name:`synthetic_accounting_${i}`,statement_timeout:15000,query_timeout:18000});
   c.on('error',()=>{});clients.push(c);await c.connect();
  }
  const [first,second]=clients;
  const pids=await Promise.all([control,...clients].map(async c=>(await c.query('select pg_backend_pid() p')).rows[0].p));assert.equal(new Set(pids).size,3);
  const results=[];let sequence=2000;
  for(const order of [['failure','failure'],['failure','success'],['success','failure']]){
   stage=order.join('_then_')+'_prepare';
   const id=await f.newRequest(db,sequence);sequence+=10;await f.admin(db);
   await db.query("update private.google_sheets_retention_roots set expires_at=now()+interval '1 day' where id=$1",[f.uuid(901)]);
   const before=await accountingSnapshot(db,f,id);
   const invoke=(client,kind)=>kind==='failure'?h.failAccounting(adapter(client),{request:id}).then(r=>r.rows[0].v):f.settle(adapter(client),null,f.settlement({id}),2);
   const capture=p=>p.then(value=>({ok:true,value}),error=>({ok:false,code:error.code}));
   await control.query('select pg_advisory_lock($1,$2)',[barrierClass,barrierId]);
   for(const client of clients){await f.login(adapter(client),f.owner,f.session,'service_role');await client.query('begin');}
   await first.query("select set_config('test.vsi_accounting_pause','on',true)");
   firstPending=capture(invoke(first,order[0]));
   stage=order.join('_then_')+'_first_barrier';await waitForAccountingBarrier(control,pids[1],pids[0]);
   secondPending=capture(invoke(second,order[1]));
   stage=order.join('_then_')+'_both_pending';await waitForAccountingSerialization(control,pids[1],pids[2],pids[0],f.w);
   // Neither query has returned: first waits at its cost write; second waits on
   // first's exact privacy lock. Only now let the winning transaction finish.
   await control.query('select pg_advisory_unlock($1,$2)',[barrierClass,barrierId]);
   const firstResult=await firstPending;firstPending=null;assert.equal(firstResult.ok,true);
   if(order[0]==='failure')assert.deepEqual(firstResult.value,{state:'failed'});
   else assert.equal(firstResult.value.error,undefined);
   await first.query('commit');
   const secondResult=await secondPending;secondPending=null;
   stage=order.join('_then_')+'_assert';
   if(order[0]==='success'){
    assert.deepEqual(secondResult,{ok:false,code:'40001'});await second.query('rollback');
    const successful=await assertLegacySuccess(db,f,id);
    await f.login(adapter(second),f.owner,f.session,'service_role');
    await assert.rejects(h.failAccounting(adapter(second),{request:id}),e=>e.code==='40001');
    assert.deepEqual(await accountingSnapshot(db,f,id),successful);
   }else{
    assert.equal(secondResult.ok,true);
    if(order[1]==='failure')assert.deepEqual(secondResult.value,{state:'already_failed'});
    else assert.equal(secondResult.value.error,'stale_attempt');
    await second.query('commit');await h.assertFailureAccountingState(db,{id});
    assert.deepEqual((await accountingSnapshot(db,f,id)).conversation,before.conversation);
   }
   results.push({first:order[0],second:order[1],bothRpcsPending:true,exactPrivacySerialization:true,costEvents:1,output:order[0]==='success'?'preserved_success':'none'});
  }
  stage='authority_privacy_and_expiry';const denials=await runAccountingDenials(db,f,h);
  return {scope:'synthetic_native_vsi_failure_accounting',sessions:3,races:results,denials,providerCalls:0,releaseQualified:false,fullComposition:'unavailable',applicationActivation:false,privateProductionBodiesAdded:0};
 }catch(error){
  error.qualificationStage=stage;
  error.assertionLine=Number(/vsi-failure-accounting-qualification\.cjs:(\d+):/.exec(error.stack||'')?.[1])||undefined;
  error.assertionActualCode=/^[A-Z0-9]{5}$/.test(error.actual?.code||'')?error.actual.code:undefined;
  throw error;
 }finally{
  // Unblock first, then roll it back before awaiting the serialized second.
  // This ordering also handles an assertion failure while both queries wait.
  await control.query('reset role').catch(()=>{});
  await control.query('select pg_advisory_unlock($1,$2)',[barrierClass,barrierId]).catch(()=>{});
  if(firstPending)await firstPending;
  if(clients[0])await clients[0].query('rollback').catch(()=>{});
  if(secondPending)await secondPending;
  for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}
 }
}
module.exports={databaseSuffix,barrierClass,barrierId,installAccountingBarrier,waitForAccountingBarrier,waitForAccountingSerialization,accountingSnapshot,assertLegacySuccess,runAccountingDenials,qualifyFailureAccounting};
