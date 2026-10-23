/* eslint-disable @typescript-eslint/no-require-imports -- Owned disposable CI infrastructure. */
// Actual Sandbox draft locks/terminal functions, synthetic rows and minimum
// dependency DDL. No hosted target option, model transport or external credentials.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {Client}=require('pg');
const {waitForLock}=require('./shared-evidence-postgres-qualification.cjs');
const {installCommitBarrier,waitForCommitBarrier,barrierClass,barrierId}=require('./shared-evidence-fence-qualification.cjs');
const adapter=client=>({query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql),close:async()=>{}});
const squareWriters=[
 ['square_account_capacity_blocks','environment'],['square_account_configuration','blocked'],['square_account_connections','revocation_pending'],
 ['square_account_enrollments','generation'],['square_connection_generations','connection_generation'],['square_connections','current_generation'],
 ['square_ingestion_page_receipts','page_id'],['square_ingestion_resources','current_version_key'],['square_ingestion_scans','stream'],
 ['square_ingestion_tasks','connection_generation'],['square_ingestion_versions','ordinal'],['square_interpretation_facts','generation'],
 ['square_interpretation_runs','revision'],['square_location_mappings','location_id'],['square_observation_admissions','generation'],['square_observation_approvals','approval_fingerprint']
];
let stage='preflight';
function preflight(args,env=process.env){
 assert.deepEqual(args,args[0]==='--check'?['--check']:['--native']);
 require('./shared-evidence-postgres-qualification.cjs').preflight(['--check'],env);
 for(const name of ['runtime-gate.ts','sandbox-policy.ts','qualitative-policy.ts']){
  const text=fs.readFileSync('lib/ai/shared-evidence/'+name,'utf8');
  assert(!/return true/.test(text));assert(/return (?:false|null)/.test(text));
 }
 const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
 assert.equal(config.git.deploymentEnabled['codex/sandbox-synthesis-qualification'],false);
 const sql=fs.readFileSync('docs/security-drafts/sandbox/admission.sql','utf8');
 assert.equal(squareWriters.length,16);
 for(const [table] of squareWriters)assert(sql.includes('private.'+table));
 return {scope:'synthetic_sandbox_locking',releaseQualified:false,execution:'not_run',squareDependencyTables:16,providerCalls:0};
}
async function qualify(target){
 assert.equal(target.targetKind,'owned-supabase-image');
 const fns=await import('./shared-evidence-sql-fixture.mjs');
 const sandbox=await import('./sandbox-shared-evidence-fixture.mjs');const {setupSandboxFixture}=sandbox;
 const database=await target.createDatabase('sandbox_synthesis','empty'),control=database.client,db=adapter(control),clients=[];
 let barrierHeld=false,pending=[];
 try{
  stage='synthetic_install';const f=await setupSandboxFixture({createDatabase:async()=>db}),{ids}=f;
  await f.enabledPolicy();await fns.admin(db);await installCommitBarrier(control);
  for(let i=0;i<3;i++){
   const c=new Client({...database.connection,application_name:'sandbox_synthetic_'+i,statement_timeout:10000,query_timeout:12000});
   c.on('error',()=>{});clients.push(c);await c.connect();await c.query("set lock_timeout='6s'");
  }
  const [reader,writer,competitor]=clients,r=adapter(reader),c=adapter(competitor);
  const pids=await Promise.all([control,...clients].map(async client=>(await client.query('select pg_backend_pid() p')).rows[0].p));assert.equal(new Set(pids).size,4);
  const read=async(client,identity)=>(await client.query('select read_sandbox_shared_evidence_v1($1,$2,$3) v',[ids.workspace,JSON.stringify(identity),ids.installation])).rows[0].v.resolved;
  const seal=async(kind,id)=>{
   await f.login();const originals=[await read(control,f.qboIdentity),await read(control,f.squareIdentity)];
   return (await control.query('select seal_sandbox_shared_evidence_v1($1,$2,$3,1,$4,$5,$6,$7) v',[ids.workspace,kind,id,ids.ticket,JSON.stringify(originals.map(o=>o.identity)),[],ids.installation])).rows[0].v.manifest_id;
  };
  async function blockedWrite(sql,args=[]){
   await writer.query('reset role');await writer.query('begin');
   const write=writer.query(sql,args);write.catch(()=>{});pending.push(write);
   await waitForLock(control,pids[2]);
   assert((await control.query('select $1::int=any(pg_blocking_pids($2)) held',[pids[1],pids[2]])).rows[0].held,'reader must actually block the writer');
   await reader.query('rollback');await write;await writer.query('rollback');pending=[];
  }
  for(const [table,column] of squareWriters){
   stage='square_dependency_lock';await fns.admin(db);await sandbox.sandboxLogin(r);
   await reader.query('begin');await read(reader,f.squareIdentity);
   const lock=(await control.query("select exists(select 1 from pg_locks where pid=$1 and relation=to_regclass($2) and mode='ShareLock' and granted) held",[pids[1],'private.'+table])).rows[0].held;assert(lock);
   await blockedWrite(`update private.${table} set ${column}=${column}`);
  }
  const qboWriters=[['integration_connections','status'],['provider_entity_mappings','row_version'],['external_source_records','current_version_id'],['external_source_record_versions','validation_state']];
  for(const [table,column] of qboWriters){
   stage='qbo_dependency_lock';await sandbox.sandboxLogin(r);
   await reader.query('begin');await read(reader,f.qboIdentity);await fns.admin(db);
   await blockedWrite(`update private.${table} set ${column}=${column}`);
  }
  // A source change committed before final validation must save neither answer
  // nor cost. The next request uses a fresh exact preview, not a restored lineage.
  stage='source_changed_before_settlement';const stale=await seal('vsi_request',ids.request);await fns.admin(db);
  await control.query('update private.provider_entity_mappings set row_version=row_version+1 where id=$1',[ids.qboMapping]);
  await sandbox.sandboxLogin(r,ids.owner,ids.session,'service_role');
  await assert.rejects(fns.settle(r,stale),e=>['42501','40001'].includes(e.code));
  assert.equal((await control.query('select count(*)::int n from vsi_exchanges')).rows[0].n,0);
  assert.equal((await control.query('select count(*)::int n from vsi_cost_events')).rows[0].n,0);
  const next=await fns.newRequest(db,980);await f.login();const vsiManifest=await seal('vsi_request',next);
  async function terminalRace(kind,id,manifest){
   stage=kind==='vsi_request'?'vsi_final_commit_race':'brief_final_commit_race';await fns.admin(db);
   await sandbox.sandboxLogin(r,ids.owner,ids.session,'service_role');await sandbox.sandboxLogin(c,ids.owner,ids.session,'service_role');
   const call=client=>kind==='vsi_request'?fns.settle(adapter(client),manifest,fns.settlement({id})):client.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',[ids.workspace,id,ids.owner,ids.session,ids.ticket,'intelligence_briefing_v1',JSON.stringify({contractId:'intelligence_briefing_v1',workspaceId:ids.workspace,briefingType:'weekly',generationKey:'fixture-key'}),manifest]);
   await control.query('select pg_advisory_lock($1,$2)',[barrierClass,barrierId]);barrierHeld=true;
   await reader.query('begin');await reader.query("set local test.shared_fence_pause='on'");
   const first=call(reader);first.catch(()=>{});pending.push(first);
   await waitForCommitBarrier(control,pids[1],pids[0]);
   await writer.query('reset role');await writer.query('begin');
   const revoke=writer.query('update private.square_account_connections set revocation_pending=true where connection_id=$1',[ids.squareConnection]);revoke.catch(()=>{});pending.push(revoke);
   await waitForLock(control,pids[2]);assert((await control.query('select $1::int=any(pg_blocking_pids($2)) held',[pids[1],pids[2]])).rows[0].held);
   const second=call(competitor).then(()=>({ok:true}),e=>({ok:false,code:e.code}));pending.push(second);await waitForLock(control,pids[3]);
   await control.query('select pg_advisory_unlock($1,$2)',[barrierClass,barrierId]);barrierHeld=false;
   await first;await reader.query('commit');await revoke;await writer.query('commit');
   const result=await second;assert(!result.ok&&['42501','40001'].includes(result.code));pending=[];
   await sandbox.sandboxLogin(r);await assert.rejects(reader.query('select reopen_shared_evidence_target_v1($1,$2,$3)',[ids.workspace,kind==='vsi_request'?'vsi_exchange':'briefing_run',id]),e=>e.code==='42501');
  }
  await terminalRace('vsi_request',next,vsiManifest);await fns.admin(db);
  assert.equal((await control.query('select count(*)::int n from vsi_cost_events where request_id=$1',[next])).rows[0].n,1);
  assert.equal((await control.query('select count(*)::int n from vsi_exchanges where id=$1',[next])).rows[0].n,1);
  // Only synthetic fixture state is reset between independent terminal cases.
  await control.query('update private.square_account_connections set revocation_pending=false where connection_id=$1',[ids.squareConnection]);
  const brief=await fns.newBrief(db,990);await f.login();const briefManifest=await seal('briefing_run',brief);
  await terminalRace('briefing_run',brief,briefManifest);await fns.admin(db);
  assert.equal((await control.query("select count(*)::int n from private.shared_evidence_artifact_manifests where artifact_kind='briefing_run' and artifact_id=$1",[brief])).rows[0].n,1);
  assert.equal((await control.query("select status from ai_agent_runs where id=$1",[brief])).rows[0].status,'completed');
  return {scope:'synthetic_sandbox_locking',sessions:4,squareDependencyTables:16,qboDependencyTables:4,changedSourceSavesNothing:true,vsiAndBriefFinalCommitLocks:true,competingSettlementsOnce:true,revocationDeniesReopen:true,providerCalls:0,releaseQualified:false,fullInstalledWriterAndTriggerParity:'unverified',fixtureLimitations:f.limitations.filter(text=>!text.startsWith('PGlite'))};
 }finally{
  if(barrierHeld)await control.query('select pg_advisory_unlock($1,$2)',[barrierClass,barrierId]).catch(()=>{});
  for(const client of clients)await client.query('rollback').catch(()=>{});
  await Promise.allSettled(pending);
  for(const client of clients)await client.end().catch(()=>{});
 }
}
if(require.main===module){const args=process.argv.slice(2);try{const checked=preflight(args);if(args[0]==='--check')console.log(JSON.stringify(checked));else require('./qbo-candidate-local-container.cjs').runContainerQualification(qualify).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({status:'failed',stage,code:/^[A-Z0-9]{5}$/.test(error.code||'')?error.code:undefined,assertion:error.code==='ERR_ASSERTION'}));process.exitCode=1;});}catch{console.error(JSON.stringify({status:'blocked',stage:'preflight'}));process.exitCode=1;}}
module.exports={preflight,qualify};
