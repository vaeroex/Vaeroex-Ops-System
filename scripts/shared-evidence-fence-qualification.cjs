// Native fence scenarios, invoked only by the owned-container runner. Synthetic
// source DML and disclosed partial dependency DDL; never full deployed parity.
const assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const adapter=client=>({query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql),close:async()=>{}});
const barrierClass=19483,barrierId=712;
async function installCommitBarrier(client){
 await client.query(`create function private.shared_test_commit_barrier() returns trigger language plpgsql security definer set search_path='' as $$begin
 if current_setting('test.shared_fence_pause',true)='on' then perform pg_advisory_xact_lock(${barrierClass},${barrierId});end if;return new;end$$;
 revoke all on function private.shared_test_commit_barrier() from public,anon,authenticated,service_role;
 create trigger zz_shared_test_commit_barrier before insert on private.shared_evidence_commit_claims for each row execute function private.shared_test_commit_barrier();`);
}
async function waitForCommitBarrier(control,readerPid,controlPid){
 const until=Date.now()+5000;
 while(Date.now()<until){const {rows}=await control.query(`select exists(select 1 from pg_locks where pid=$1 and locktype='advisory' and classid=$2::oid and objid=$3::oid and objsubid=2 and not granted) waiting,
 $4::int=any(pg_blocking_pids($1)) controlled`,[readerPid,barrierClass,barrierId,controlPid]);
  if(rows[0].waiting&&rows[0].controlled)return;await delay(20);
 }throw Error('exact_commit_barrier_not_observed');
}
async function makeAttempt(db,f,probe,kind,n){
 await f.admin(db);const id=f.uuid(n),conversation=f.uuid(n+1),ticket=f.uuid(n+2);
 await db.query("insert into private.google_sheets_read_tickets(id,workspace_id,actor_id,expires_at,epoch,bound,sources) values($1,$2,$3,clock_timestamp()+interval '1 hour',1,true,$4)",[ticket,f.w,f.owner,JSON.stringify(probe.roots)]);
 if(kind==='vsi_request'){
  await db.query("insert into vsi_conversations(id,workspace_id,actor_user_id,actor_role) values($1,$2,$3,'owner')",[conversation,f.w,f.owner]);
  await db.query("insert into vsi_requests(id,workspace_id,actor_user_id,conversation_id,request_id,question_hash,status,reservation_usd,lease_until) values($1,$2,$3,$4,$1,encode(sha256(convert_to('Question','UTF8')),'hex'),'pending',0.1,clock_timestamp()+interval '1 hour')",[id,f.w,f.owner,conversation]);
 }else await db.query("insert into ai_agent_runs(id,workspace_id,agent_type,input_json,status,created_by,trusted_source) values($1,$2,'intelligence_briefing_v1',$3,'processing',$4,true)",[id,f.w,JSON.stringify({workflow:'intelligence_briefing_v1',google_sheets_read_ticket_id:ticket,shared_evidence_contract:'shared_evidence_v1',generation_key:'fixture-key',briefing_type:'weekly'}),f.owner]);
 await f.login(db);const m=(await db.query('select seal_shared_evidence_manifest_v1($1,$2,$3,1,$4,$5,$6) v',[f.w,kind,id,ticket,JSON.stringify([probe.source]),[]])).rows[0].v;
 await f.admin(db);
 const input=f.settlement({id,conversationId:conversation,readTicketId:ticket});
 return {id,kind,manifest:m.manifest_id,artifactKind:kind==='vsi_request'?'vsi_exchange':'briefing_run',
  call:client=>kind==='vsi_request'?f.settle(adapter(client),m.manifest_id,input):client.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',[f.w,id,f.owner,f.session,ticket,'intelligence_briefing_v1',JSON.stringify({contractId:'intelligence_briefing_v1',workspaceId:f.w,briefingType:'weekly',generationKey:'fixture-key'}),m.manifest_id]),
  failure:client=>kind==='vsi_request'?f.settle(adapter(client),null,{id,conversationId:conversation,attempt:1,readTicketId:ticket,usage:{estimatedCostUsd:0.03,providerCalls:1,failed:true}},2):client.query('select fail_trusted_derived_run_v1($1,$2,$3,$4,$5,$6)',[f.w,id,f.owner,f.session,'intelligence_briefing_v1','synthetic contention']),
 };
}
async function assertFailureAccounting(client,attempt){
 const row=(await client.query('select status,cost_usd from vsi_requests where id=$1',[attempt.id])).rows[0];
 assert.equal(row.status,'failed');assert.equal(Number(row.cost_usd),0.03);
 assert.equal((await client.query('select count(*)::int n from vsi_exchanges where id=$1',[attempt.id])).rows[0].n,0);
 assert.equal(await countSaved(client,attempt),0);
 assert.equal((await client.query('select count(*)::int n from vsi_cost_events where request_id=$1',[attempt.id])).rows[0].n,1);
}
async function countSaved(control,attempt){return (await control.query('select count(*)::int n from private.shared_evidence_artifact_manifests where artifact_id=$1 and artifact_kind=$2',[attempt.id,attempt.artifactKind])).rows[0].n;}
async function savedIdentity(control,attempt){const {rows}=await control.query('select artifact_revision from private.shared_evidence_artifact_manifests where artifact_id=$1 and artifact_kind=$2',[attempt.id,attempt.artifactKind]);assert.equal(rows.length,1);return rows[0].artifact_revision;}
async function reopen(client,f,attempt,revision){await f.login(adapter(client));return client.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4)',[f.w,attempt.artifactKind,attempt.id,revision]);}
async function expectConflict(writer,sql,args){
 await writer.query('begin');try{await assert.rejects(writer.query(sql,args),e=>e.code==='40001');}finally{await writer.query('rollback');}
}
async function qualifyFence(target){
 assert.equal(target.targetKind,'owned-supabase-image');
 const f=await import('./shared-evidence-sql-fixture.mjs');
 const {prepareWriterCases,isCurrent}=await import('./shared-evidence-writer-cases.mjs');
 const {installFenceFixture}=await import('./shared-evidence-fence-fixture.mjs');
 const database=await target.createDatabase('shared_fence','empty'),control=database.client,db=adapter(control),clients=[];
 const results=[];let barrierHeld=false,pending=null;
 try{
  const {cases}=await prepareWriterCases({createDatabase:async()=>db});
  const fixture=await installFenceFixture(db);await installCommitBarrier(control);
  // A real separate workspace/connection, not merely another lock key.
  await control.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account) values($1,$2,'harvest',$3,'connected','{\"id\":\"other-synthetic-account\"}')",[f.uuid(900),f.other,f.owner]);
  const {Client}=require('pg');for(let i=0;i<2;i++){const c=new Client({...database.connection,application_name:`shared_fence_${i}`,statement_timeout:15000,query_timeout:20000});c.on('error',()=>{});clients.push(c);await c.connect();await c.query("set lock_timeout='12s'");}
  const [reader,writer]=clients;const [controllerPid,readerPid,writerPid]=await Promise.all([control,...clients].map(async c=>(await c.query('select pg_backend_pid() p')).rows[0].p));assert.equal(new Set([controllerPid,readerPid,writerPid]).size,3);
  let sequence=1000;let testedRelations=false;
  for(const probe of cases){const saved=[];
   // Each consumer has its own manifest containing THIS provider, not a Harvest proxy.
   for(const kind of ['vsi_request','briefing_run']){
    const attempt=await makeAttempt(db,f,probe,kind,sequence);sequence+=10;
    await f.login(adapter(reader),f.owner,f.session,'service_role');await writer.query('reset role');
    // Writer changes remain uncommitted: final validation must reject the active fence.
    await writer.query('begin');try{await writer.query(probe.sql,probe.args);await assert.rejects(attempt.call(reader),e=>e.code==='40001');}finally{await writer.query('rollback');}
    assert.equal(await countSaved(control,attempt),0);
    // Reader is paused inside actual completion after final validation, before output.
    await control.query('select pg_advisory_lock($1,$2)',[barrierClass,barrierId]);barrierHeld=true;
    await reader.query('begin');await reader.query("set local test.shared_fence_pause='on'");
    pending=attempt.call(reader).then(value=>({ok:true,value}),error=>({ok:false,error}));
    try{
     await waitForCommitBarrier(control,readerPid,controllerPid);
     await expectConflict(writer,probe.sql,probe.args);
     if(!testedRelations){for(const table of fixture.relations)await expectConflict(writer,`insert into ${table}(${table==='public.workspaces'?'id':'workspace_id'}) values($1)`,[f.w]);testedRelations=true;}
     assert.equal((await writer.query('update reporting_connections set last_error_code=null where id=$1 and workspace_id=$2',[f.uuid(900),f.other])).rowCount,1);
     assert.equal(await countSaved(control,attempt),0,'output cannot exist before the barrier releases');
    }finally{await control.query('select pg_advisory_unlock($1,$2)',[barrierClass,barrierId]);barrierHeld=false;}
    const outcome=await pending;pending=null;if(!outcome.ok)throw outcome.error;
    // Competing same-attempt completion must fail, not duplicate charges/output.
    await f.login(adapter(writer),f.owner,f.session,'service_role');await assert.rejects(attempt.call(writer),e=>e.code==='40001');
    await reader.query('commit');assert.equal(await countSaved(control,attempt),1);
    if(kind==='vsi_request')assert.equal((await control.query('select count(*)::int n from vsi_cost_events where request_id=$1',[attempt.id])).rows[0].n,1);
    const revision=await savedIdentity(control,attempt);await reopen(reader,f,attempt,revision);saved.push({attempt,revision});
   }
   // Commit source mutation before a fresh pending attempt validates. Its saved
   // predecessor must also become unavailable by exact revision after this change.
   const stale=await makeAttempt(db,f,probe,'vsi_request',sequence);sequence+=10;
   await writer.query('reset role');await writer.query(probe.sql,probe.args);
   await f.login(adapter(reader));assert.equal(await isCurrent(probe,adapter(reader)),false,probe.provider);
   for(const {attempt,revision} of saved)await assert.rejects(reopen(reader,f,attempt,revision),e=>['40001','42501'].includes(e.code));
   await f.login(adapter(reader),f.owner,f.session,'service_role');await assert.rejects(stale.call(reader),e=>['40001','42501'].includes(e.code));assert.equal(await countSaved(control,stale),0);
   // A failed generation still accounts its one observed provider call once.
   await stale.failure(reader);await stale.failure(reader);
   await assertFailureAccounting(control,stale);
   results.push({provider:probe.provider,vsi:true,brief:true,writerBeforeValidation:true,writerInsideFinalCommit:true,exactSavedReopenInvalidated:true,failureAccountedOnce:true});
  }
  // Output, claim and charge rollback using a fresh valid reference after mutations.
  await f.login(db);const ref=await f.capture(db,await f.map(db));const probe={source:{kind:'legacy_reference',reference_id:ref.reference_id},roots:[]};
  for(const kind of ['vsi_request','briefing_run']){const attempt=await makeAttempt(db,f,probe,kind,sequence);sequence+=10;
   await f.login(adapter(reader),f.owner,f.session,'service_role');await reader.query('begin');await attempt.call(reader);await reader.query('rollback');assert.equal(await countSaved(control,attempt),0);
   assert.equal((await control.query('select count(*)::int n from private.shared_evidence_commit_claims where target_id=$1',[attempt.id])).rows[0].n,0);
   if(kind==='vsi_request')assert.equal((await control.query('select count(*)::int n from vsi_cost_events where request_id=$1',[attempt.id])).rows[0].n,0);
  }
  return {scope:'synthetic_native_workspace_fence',sessions:3,fencedRelations:fixture.relations.length,placeholderRelations:fixture.placeholders,sourceCases:results,rollback:{vsi:true,brief:true},providerCalls:0,releaseQualified:false,fullComposition:'unavailable',ingestionWriters:'not_exercised'};
 }finally{
  // Release before awaiting/rolling back the reader, even on assertion failure.
  if(barrierHeld)await control.query('select pg_advisory_unlock($1,$2)',[barrierClass,barrierId]).catch(()=>{});
  if(pending)await pending;
  for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}
 }
}
module.exports={assertFailureAccounting,qualifyFence,installCommitBarrier,waitForCommitBarrier,makeAttempt,barrierClass,barrierId};
