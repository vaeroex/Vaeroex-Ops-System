// Synthetic-only, owned disposable PostgreSQL. No production metadata input.
// Repository erasure guards + actual draft fence/completion; NOT complete erasure
// orchestration, installed writer composition, or production qualification.
const assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const {makeAttempt}=require('./shared-evidence-fence-qualification.cjs');
const adapter=c=>({query:(q,a)=>c.query(q,a),exec:q=>c.query(q),close:async()=>{}});
function extract(sql,name){
 const escaped=name.replaceAll('.','\\.');
 const match=sql.match(new RegExp(`create(?: or replace)? function ${escaped}\\([\\s\\S]*?as (\\$[^$]*\\$)[\\s\\S]*?\\1;`,'i'));
 assert.ok(match,`repository function missing: ${name}`);return match[0];
}
async function installErasureFixture(db,f){
 const erasure=f.read('supabase/production-migrations/20261012191836_google_sheets_restricted_erasure_retention.sql');
 const canonical=f.read('supabase/migrations/20260821172015_external_integrations_phase_3_deterministic_dependencies.sql');
 // Explicit SHA-256-only fixture bridge permits the same offline PGlite test.
 // It is not a copy of production extension internals.
 await db.exec(`create schema extensions;create function extensions.digest(v bytea,algorithm text) returns bytea language plpgsql immutable strict as $$begin
 if algorithm<>'sha256' then raise exception 'fixture_digest_algorithm_denied';end if;return sha256(v);end$$;`);
 for(const name of ['private.phase_3_canonical_json_v1','private.phase_3_contract_fingerprint_v1'])await db.exec(extract(canonical,name));
 await db.exec(extract(f.read('supabase/production-migrations/20261002225025_google_sheets_support_erasure.sql'),'private.google_sheets_erasure_hash_v1'));
 const ddl=erasure.match(/create table private\.google_sheets_erasure_capabilities \([\s\S]*?\n\);/i)?.[0];assert.ok(ddl);await db.exec(ddl);
 await db.exec(`alter table private.google_sheets_erasure_capabilities enable row level security;
 alter table private.google_sheets_erasure_capabilities force row level security;
 revoke all on private.google_sheets_erasure_capabilities from public,anon,authenticated,service_role;`);
 for(const name of ['private.google_sheets_exact_delete_allowed_v1','private.google_sheets_erasure_cascade_guard_v1'])await db.exec(extract(erasure,name));
 await db.exec(`revoke all on function private.google_sheets_exact_delete_allowed_v1(uuid,text,uuid,jsonb),private.google_sheets_erasure_cascade_guard_v1() from public,anon,authenticated,service_role;
 create trigger aa_google_sheets_erasure_cascade_guard before update or delete on kpis for each row execute function private.google_sheets_erasure_cascade_guard_v1();`);
}
async function issueSyntheticCapability(client,f){
 await client.query("select set_config('vaeroex.google_sheets_erasure_request',$1,true)",[f.uuid(990)]);
 // Test controller only; not a new application RPC or production issuer.
 await client.query(`insert into private.google_sheets_erasure_capabilities
 select txid_current(),pg_backend_pid(),$1,workspace_id,'kpis',id,private.google_sheets_erasure_hash_v1(to_jsonb(k)) from kpis k where id=$2`,[f.uuid(990),f.uuid(304)]);
}
async function waitForPrivacyInversion(control,readerPid,writerPid,workspace){
 const until=Date.now()+5000;
 while(Date.now()<until){
  const {rows}=await control.query(`with keys as (select hashtextextended('google_sheets:'||$3::text,0) privacy,hashtextextended('shared-evidence-write-v1:'||$3::text,0) fence)
   select exists(select 1 from pg_locks,keys where pid=$1 and locktype='advisory' and objsubid=1 and not granted
    and classid=((privacy>>32)&4294967295)::oid and objid=(privacy&4294967295)::oid) privacy_wait,
   $2::int=any(pg_blocking_pids($1)) writer_blocks,
   exists(select 1 from pg_locks,keys where pid=$1 and locktype='advisory' and objsubid=1 and granted
    and classid=((fence>>32)&4294967295)::oid and objid=(fence&4294967295)::oid) reader_has_fence`,[readerPid,writerPid,workspace]);
  if(rows[0].privacy_wait&&rows[0].writer_blocks&&rows[0].reader_has_fence)return;
  await delay(20);
 }throw Error('exact_privacy_fence_inversion_not_observed');
}
async function qualifyErasure(target){
 assert.equal(target.targetKind,'owned-supabase-image');
 const f=await import('./shared-evidence-sql-fixture.mjs');
 const {prepareWriterCases}=await import('./shared-evidence-writer-cases.mjs');
 const {installFenceFixture}=await import('./shared-evidence-fence-fixture.mjs');
 const database=await target.createDatabase('shared_privacy_erasure','empty');
 const control=database.client,db=adapter(control),clients=[];let pending=null;
 try{
  const {cases}=await prepareWriterCases({createDatabase:async()=>db});await installFenceFixture(db);await installErasureFixture(db,f);
  const probe=cases.find(c=>c.provider==='google_sheets');assert.ok(probe);
  const {Client}=require('pg');
  for(let i=0;i<2;i++){const c=new Client({...database.connection,application_name:`synthetic_privacy_${i}`,statement_timeout:12000,query_timeout:15000});c.on('error',()=>{});clients.push(c);await c.connect();}
  const [reader,writer]=clients;
  const pids=await Promise.all([control,...clients].map(async c=>(await c.query('select pg_backend_pid() p')).rows[0].p));assert.equal(new Set(pids).size,3);
  const original=(await control.query('select to_jsonb(k) row from kpis k where id=$1',[f.uuid(304)])).rows[0].row;
  const results=[];let sequence=4000;
  for(const kind of ['vsi_request','briefing_run'])for(const blocked of [false,true]){
   const attempt=await makeAttempt(db,f,probe,kind,sequence);sequence+=10;
   const targetTable=kind==='vsi_request'?'vsi_requests':'ai_agent_runs';
   const targetBefore=(await control.query(`select to_jsonb(t) row from ${targetTable} t where id=$1`,[attempt.id])).rows[0].row;
   await control.query('update private.google_sheets_privacy_epochs set blocked=$2 where workspace_id=$1',[f.w,blocked]);
   await writer.query('reset role');await writer.query('begin');
   await writer.query('select private.google_sheets_privacy_lock_v1($1)',[f.w]);
   await f.login(adapter(reader),f.owner,f.session,'service_role');await reader.query('begin');
   pending=attempt.call(reader).then(()=>({ok:true}),error=>({ok:false,code:error.code}));
   await waitForPrivacyInversion(control,pids[1],pids[2],f.w);
   await writer.query("select set_config('vaeroex.google_sheets_erasure_request',$1,true)",[f.uuid(990)]);
   await writer.query('savepoint unlisted');
   await assert.rejects(writer.query('delete from kpis where id=$1',[f.uuid(304)]),e=>e.code==='42501');
   await writer.query('rollback to savepoint unlisted');
   await issueSyntheticCapability(writer,f);
   await assert.rejects(writer.query('delete from kpis where id=$1',[f.uuid(304)]),e=>e.code==='40001');
   await writer.query('rollback'); // Releases privacy, capability and attempted row mutation.
   const outcome=await pending;pending=null;
   if(blocked){assert.deepEqual(outcome,{ok:false,code:'55000'});await reader.query('rollback');}
   else{assert.deepEqual(outcome,{ok:true});await reader.query('commit');}
   assert.deepEqual((await control.query('select to_jsonb(k) row from kpis k where id=$1',[f.uuid(304)])).rows[0].row,original);
   assert.equal((await control.query('select count(*)::int n from private.google_sheets_erasure_capabilities')).rows[0].n,0);
   assert.equal((await control.query('select count(*)::int n from private.shared_evidence_commit_claims where target_id=$1',[attempt.id])).rows[0].n,0);
   const artifacts=(await control.query('select artifact_revision from private.shared_evidence_artifact_manifests where artifact_id=$1 and artifact_kind=$2',[attempt.id,attempt.artifactKind])).rows;
   assert.equal(artifacts.length,blocked?0:1);
   if(kind==='vsi_request')assert.equal((await control.query('select count(*)::int n from vsi_cost_events where request_id=$1',[attempt.id])).rows[0].n,blocked?0:1);
   if(blocked){
    assert.deepEqual((await control.query(`select to_jsonb(t) row from ${targetTable} t where id=$1`,[attempt.id])).rows[0].row,targetBefore,'rejected completion cannot modify its underlying request or run');
    if(kind==='vsi_request')assert.equal((await control.query('select count(*)::int n from vsi_exchanges where id=$1',[attempt.id])).rows[0].n,0);
   }
   if(!blocked){
    await f.login(adapter(reader));await reader.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4)',[f.w,attempt.artifactKind,attempt.id,artifacts[0].artifact_revision]);
    await writer.query('begin');await issueSyntheticCapability(writer,f);await writer.query('delete from kpis where id=$1',[f.uuid(304)]);await writer.query('commit');
    await assert.rejects(reader.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4)',[f.w,attempt.artifactKind,attempt.id,artifacts[0].artifact_revision]),e=>['42501','40001'].includes(e.code));
    await control.query('insert into kpis select * from jsonb_populate_record(null::kpis,$1)',[JSON.stringify(original)]);
    // Committed test capabilities remain non-authoritative in a new transaction.
    await writer.query('begin');await writer.query("select set_config('vaeroex.google_sheets_erasure_request',$1,true)",[f.uuid(990)]);
    await assert.rejects(writer.query('delete from kpis where id=$1',[f.uuid(304)]),e=>e.code==='42501');await writer.query('rollback');
    await control.query('delete from private.google_sheets_erasure_capabilities');
   }
   await control.query('update private.google_sheets_privacy_epochs set blocked=false where workspace_id=$1',[f.w]);
   results.push({consumer:kind,committedPrivacyBarrier:blocked,exactLockInversionObserved:true,unlistedDenied:true,contendedErasureRolledBack:true,completion:blocked?'privacy_rejected':'saved_once_and_reopen_revoked'});
  }
  return {scope:'synthetic_native_privacy_erasure',sessions:3,scenarios:results,providerCalls:0,releaseQualified:false,fullComposition:'unavailable',erasureOrchestration:'synthetic_controller',hashBridge:'sha256_only_fixture',privateProductionBodiesAdded:0};
 }finally{
  // Release writer's privacy lock before awaiting a blocked reader.
  if(clients[1])await clients[1].query('rollback').catch(()=>{});
  if(pending)await pending;
  for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}
 }
}
module.exports={extract,installErasureFixture,issueSyntheticCapability,waitForPrivacyInversion,qualifyErasure};
