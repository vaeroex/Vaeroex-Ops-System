// Owned-container qualification entry point. --fence runs the actual draft fence
// with real sessions and explicitly synthetic dependencies. No live database route.
const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {preflight,waitForLock}=require('./shared-evidence-postgres-qualification.cjs');
const root=path.resolve(__dirname,'..');
function check(args,env=process.env) {
 assert.equal(args.length,1);assert(['--check','--source-write-probes','--fence','--privacy-erasure','--failure-accounting'].includes(args[0]));
 preflight(['--check'],env);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'docs/security-drafts/ci/writer-probe-manifest.json'),'utf8'));
 assert.equal(manifest.scope,'synthetic_source_write_diagnostics');assert.equal(manifest.releaseQualified,false);
 for(const entry of manifest.files) {
  assert(!path.isAbsolute(entry.path)&&!entry.path.split('/').includes('..'));
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,entry.path))).digest('hex'),entry.sha256);
 }
 return manifest;
}
const adapter=client=>({query:(sql,args)=>client.query(sql,args),exec:sql=>client.query(sql),close:async()=>{}});
async function observeWriter(control,pid,finished) {
 const until=Date.now()+3000;
 while(Date.now()<until) {
  if(finished())return 'committed_before_reader_end';
  const {rows}=await control.query('select wait_event_type from pg_stat_activity where pid=$1',[pid]);
  if(rows[0]?.wait_event_type==='Lock')return 'blocked_on_reader';
  await delay(20);
 }
 throw Error('writer_barrier_timeout');
}
async function qualify(target) {
 assert.equal(target.targetKind,'owned-supabase-image');
 const f=await import('./shared-evidence-sql-fixture.mjs'),{prepareWriterCases,isCurrent}=await import('./shared-evidence-writer-cases.mjs');
 const database=await target.createDatabase('shared_write_probes','empty');const control=database.client;
 const {Client}=require('pg'),clients=[];const results=[];
 try {
  const {db,cases}=await prepareWriterCases({createDatabase:async()=>adapter(control)});
  for(let i=0;i<2;i++){const c=new Client({...database.connection,application_name:`shared_probe_${i}`,statement_timeout:5000,query_timeout:7000});c.on('error',()=>{});clients.push(c);await c.connect();await c.query("set lock_timeout='4s'");}
  const [reader,writer]=clients;const r=adapter(reader),b=adapter(writer);const writerPid=(await writer.query('select pg_backend_pid() p')).rows[0].p;
  const pids=await Promise.all([control,...clients].map(async c=>(await c.query('select pg_backend_pid() p')).rows[0].p));assert.equal(new Set(pids).size,3);
  for(const probe of cases) {
   await f.login(r);await reader.query('begin');assert(await isCurrent(probe,r));
   await writer.query('reset role');let done=false;
   const write=(async()=>{await writer.query('begin');await writer.query(probe.sql,probe.args);await writer.query('commit');done=true;})();write.catch(()=>{});
   const barrier=await observeWriter(control,writerPid,()=>done);
   if(barrier==='blocked_on_reader') {await reader.query('rollback');await write;}
   else {await write;assert.equal(await isCurrent(probe,r),false,'committed change must invalidate exact evidence');await reader.query('rollback');}
   await f.login(r);assert.equal(await isCurrent(probe,r),false,'fresh read must reject the committed source change');
   results.push({provider:probe.provider,storageMutation:barrier,releaseQualified:false});
  }
  // Actual manifest-aware VSI completion: a rollback must leave no answer/cost,
  // and competing same-attempt completions must settle exactly once.
  await f.login(db);const ref=await f.capture(db,await f.map(db));const seal=await f.seal(db,ref);await f.admin(db);
  await f.login(r,f.owner,f.session,'service_role');await reader.query('begin');await f.settle(r,seal.manifest_id);await reader.query('rollback');
  assert.equal((await control.query('select count(*)::int n from vsi_cost_events')).rows[0].n,0);
  assert.equal((await control.query('select count(*)::int n from vsi_exchanges')).rows[0].n,0);
  await reader.query('begin');await f.settle(r,seal.manifest_id);
  await f.login(b,f.owner,f.session,'service_role');const second=f.settle(b,seal.manifest_id).then(()=>({ok:true}),error=>({ok:false,code:error.code}));
  await waitForLock(control,writerPid);await reader.query('commit');const outcome=await second;
  assert(!outcome.ok&&['40001','42501'].includes(outcome.code),'second successful completion must fail closed');
  assert.equal((await control.query('select count(*)::int n from vsi_cost_events')).rows[0].n,1);
  assert.equal((await control.query('select count(*)::int n from vsi_exchanges')).rows[0].n,1);
  // Briefs use the real audited trusted-completion body and draft wrapper, with
  // the same explicit partial-platform fixture limits as the existing SQL suite.
  const run=await f.newBrief(db);const briefSeal=await f.seal(db,ref,{kind:'briefing_run',id:run});await f.admin(db);
  const args=[f.w,run,f.owner,f.session,f.uuid(101),'intelligence_briefing_v1',JSON.stringify({contractId:'intelligence_briefing_v1',workspaceId:f.w,briefingType:'weekly',generationKey:'fixture-key'}),briefSeal.manifest_id];
  await reader.query('begin');await reader.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',args);
  const briefSecond=writer.query('select complete_trusted_derived_run_v2($1,$2,$3,$4,$5,$6,$7,$8)',args).then(()=>({ok:true}),error=>({ok:false,code:error.code}));
  await waitForLock(control,writerPid);await reader.query('commit');const briefOutcome=await briefSecond;
  assert(!briefOutcome.ok&&['40001','42501'].includes(briefOutcome.code));
  assert.equal((await control.query("select count(*)::int n from private.shared_evidence_artifact_manifests where artifact_kind='briefing_run' and artifact_id=$1",[run])).rows[0].n,1);
  return {scope:'synthetic_source_write_diagnostics',sessions:3,sourceCases:results,settlement:{vsiRollback:true,vsiOnce:true,briefOnce:true},releaseQualified:false,fullComposition:'unavailable',providerCalls:0};
 }finally{for(const c of clients){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}}
}
async function main(args=process.argv.slice(2)) {
 const manifest=check(args);
 if(args[0]==='--check')return {scope:manifest.scope,filesVerified:manifest.files.length,execution:'not_run',releaseQualified:false};
 const run=args[0]==='--failure-accounting'?require('./vsi-failure-accounting-qualification.cjs').qualifyFailureAccounting:args[0]==='--privacy-erasure'?require('./shared-evidence-erasure-qualification.cjs').qualifyErasure:args[0]==='--fence'?require('./shared-evidence-fence-qualification.cjs').qualifyFence:qualify;
 return require('./qbo-candidate-local-container.cjs').runContainerQualification(run);
}
if(require.main===module)main().then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(JSON.stringify({status:'blocked_or_failed',reason:'synthetic_writer_probe_failed',code:/^[A-Z0-9_]{1,30}$/.test(error.code||'')?error.code:undefined,
 stage:/^[a-z_]{1,80}$/.test(error.qualificationStage||'')?error.qualificationStage:undefined,
 assertionLine:Number.isInteger(error.assertionLine)?error.assertionLine:undefined,
 assertionActualCode:/^[A-Z0-9]{5}$/.test(error.assertionActualCode||'')?error.assertionActualCode:undefined}));process.exitCode=1;});
module.exports={check,qualify,observeWriter};
