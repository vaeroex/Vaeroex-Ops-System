/* Explicit owned-container target only. No URL parameter, hosted fallback, or credential lookup. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const root=path.resolve(__dirname,'..');
const manifestPath='docs/security-drafts/ci/manifest.json';
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function preflight(args,env=process.env,readFile=read) {
 assert.equal(args.length,1,'one explicit mode required: --check, --foundation, or --full-composition');
 assert.ok(['--check','--foundation','--full-composition'].includes(args[0]),'unknown mode or arbitrary database target forbidden');
 for(const key of Object.keys(env)) if(/^(PG[A-Z_]*|DATABASE_URL|SUPABASE_.*|SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_.*|(?:OPENAI|ANTHROPIC|SQUARE)_(?:API_KEY|ACCESS_TOKEN))$/.test(key)) throw new Error('inherited_external_configuration_forbidden:'+key);
 const manifest=JSON.parse(readFile(manifestPath));
 assert.equal(manifest.version,1);assert.equal(manifest.scope,'synthetic_legacy_foundation_only');
 for(const file of manifest.files) {
  assert.ok(!path.isAbsolute(file.path)&&!file.path.split('/').includes('..'),'manifest path must remain in checkout');
  assert.equal(sha(readFile(file.path)),file.sha256,'frozen_contract_hash_mismatch:'+file.path);
 }
 if(args[0]==='--full-composition') {
  // No completion flag can turn this limited runner into a full-composition test.
  const error=new Error('full_composition_unavailable');error.blockers=[...manifest.missingAuditedTriggerDefinitions,...manifest.remainingContractGaps];throw error;
 }
 return manifest;
}
async function login(client,actor=uuid(3),session=uuid(6)) {
 await client.query('reset role');
 await client.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:actor,session_id:session,role:'authenticated'})]);
 await client.query('set role authenticated');
}
async function waitForLock(controller,pid) {
 const until=Date.now()+3000;
 while(Date.now()<until) {
  const {rows}=await controller.query("select wait_event_type from pg_stat_activity where pid=$1",[pid]);
  if(rows[0]?.wait_event_type==='Lock')return;
  await delay(20);
 }
 throw new Error('expected_writer_lock_not_observed');
}
async function seedFoundation(control) {
  await control.query(read('docs/security-drafts/ci/foundation.sql'));
  await control.query(read('docs/security-drafts/01-legacy-evidence.sql'));
  await control.query('insert into workspaces values($1)',[uuid(1)]);
  await control.query('insert into profiles values($1)',[uuid(3)]);
  await control.query('insert into auth.users(id) values($1)',[uuid(3)]);
  await control.query('insert into auth.sessions(id,user_id) values($1,$2)',[uuid(6),uuid(3)]);
  await control.query("insert into workspace_members values($1,$2,'active','owner')",[uuid(1),uuid(3)]);
  await control.query("insert into business_entities values($1,$2,'active')",[uuid(1),uuid(9)]);
  await control.query("insert into reporting_connections(id,workspace_id,provider,created_by,status,account) values($1,$2,'harvest',$3,'connected','{\"id\":\"synthetic-only\"}')",[uuid(11),uuid(1),uuid(3)]);
  await control.query("insert into reporting_history_facts values($1,'harvest',$2,'entry-1','2026-10-01','[{\"key\":\"hours\",\"value\":8}]')",[uuid(1),uuid(11)]);
  await control.query("insert into reporting_history_days values($1,'harvest',$2,'2026-10-01','{}','2026-10-02','2026-10-02')",[uuid(1),uuid(11)]);
}
async function foundation(target) {
 assert.equal(target.targetKind,'owned-supabase-image');
 const {Client}=require('pg');
 const database=await target.createDatabase('shared_foundation');
 const control=database.client,others=[];
 try {
  await seedFoundation(control);
  for(let i=0;i<2;i++) {
   const c=new Client({...database.connection,application_name:`shared_foundation_${i}`,statement_timeout:5000,query_timeout:7000});
   c.on('error',()=>{});others.push(c);await c.connect();await c.query("set lock_timeout='4s'");
  }
  const [reader,writer]=others;
  const pids=await Promise.all([control,reader,writer].map(async c=>(await c.query('select pg_backend_pid() p')).rows[0].p));
  assert.equal(new Set(pids).size,3,'independent database sessions');
  await login(reader);
  const state=(await reader.query('select preview_legacy_evidence_mapping_v1($1,$2,$3) v',[uuid(1),'harvest',uuid(11)])).rows[0].v;
  const mapping=async()=> (await reader.query('select confirm_legacy_evidence_mapping_v1($1,$2,$3,$4,$5) v',[uuid(1),'harvest',uuid(11),uuid(9),state.incarnation_hash])).rows[0].v;
  const binding=await mapping();
  const capture=(await reader.query("select capture_legacy_evidence_v1($1,$2,'2026-10-01','2026-10-01') v",[uuid(1),binding])).rows[0].v;
  assert.equal(capture.stage,'unadmitted');
  const reopen=async()=> (await reader.query('select reopen_legacy_evidence_v1($1,$2) v',[uuid(1),capture.reference_id])).rows[0].v;
  assert.equal((await reopen()).status,'current');
  await writer.query('begin');
  await writer.query("update reporting_history_facts set metrics='[{\"key\":\"hours\",\"value\":9}]'");
  assert.equal((await reopen()).status,'current','uncommitted writer is not visible');
  await writer.query('commit');
  assert.equal((await reopen()).status,'changed','committed writer makes exact reference unavailable');
  // Both orderings of binding confirmation vs connection revocation.
  await reader.query('begin');await mapping();
  const disconnect=writer.query("update reporting_connections set status='disconnected'");disconnect.catch(()=>{});
  await waitForLock(control,pids[2]);await reader.query('commit');await disconnect;
  await assert.rejects(reopen(),e=>e.code==='42501');
  await assert.rejects(mapping(),e=>e.code==='42501');
  // The audited owner helper holds session authority through transaction end.
  await writer.query("update reporting_connections set status='connected'");
  await reader.query('begin');await reader.query('select preview_legacy_evidence_mapping_v1($1,$2,$3)',[uuid(1),'harvest',uuid(11)]);
  const revoke=writer.query('delete from auth.sessions where id=$1',[uuid(6)]);revoke.catch(()=>{});
  await waitForLock(control,pids[2]);await reader.query('commit');await revoke;
  await assert.rejects(reader.query('select preview_legacy_evidence_mapping_v1($1,$2,$3)',[uuid(1),'harvest',uuid(11)]),e=>e.code==='42501');
  return {scope:'synthetic_legacy_foundation_only',sessions:3,passed:true,fullComposition:'unavailable',providerCalls:0};
 } finally {
  for(const c of others){await c.query('rollback').catch(()=>{});await c.end().catch(()=>{});}
 }
}
async function main(args=process.argv.slice(2)) {
 const manifest=preflight(args);
 if(args[0]==='--check')return {scope:manifest.scope,hashesVerified:manifest.files.length,fullComposition:'unavailable',missingAuditedTriggerDefinitions:manifest.missingAuditedTriggerDefinitions};
 // Require only after offline/full-composition checks: no Docker access on a denied mode.
 return require('./qbo-candidate-local-container.cjs').runContainerQualification(foundation);
}
if(require.main===module)main().then(v=>console.log(JSON.stringify(v))).catch(e=>{
 console.error(JSON.stringify({status:'blocked_or_failed',reason:e.blockers?'full_composition_unavailable':'local_qualification_failed',blockers:e.blockers,code:/^[A-Z0-9_]{1,30}$/.test(e.code||'')?e.code:undefined}));process.exitCode=1;
});
module.exports={preflight,foundation,main,waitForLock,seedFoundation};
