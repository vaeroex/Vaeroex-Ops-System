/* Offline runner/workflow contract tests. No subprocess, Docker, service, or network. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {preflight,waitForLock,seedFoundation}=require('./shared-evidence-postgres-qualification.cjs');
const {verifyLocalContext,verifyOwnedContainer}=require('./qbo-candidate-local-container.cjs');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
async function run() {
 const manifest=preflight(['--check'],{});assert.equal(manifest.fullCompositionReady,false);
 for(const args of [[],['--foundation','--url=postgres://localhost/x'],['postgres://localhost/x'],['--hosted'],['--check','--full-composition']])assert.throws(()=>preflight(args,{}));
 for(const name of ['DATABASE_URL','PGHOST','PGPASSWORD','SUPABASE_ACCESS_TOKEN','SUPABASE_TEST_DATABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_INTERNAL_IMAGE_REGISTRY'])assert.throws(()=>preflight(['--foundation'],{[name]:'synthetic'}),/configuration_forbidden/);
 assert.throws(()=>preflight(['--full-composition'],{}),e=>e.message==='full_composition_unavailable'&&e.blockers.includes('private.guard_workspace_mutation_entitlement_v1'));
 assert.throws(()=>preflight(['--check'],{},p=>read(p)+(p.endsWith('foundation.sql')?'\n-- changed':'')),/frozen_contract_hash_mismatch/);
 const noEscape=JSON.parse(read('docs/security-drafts/ci/manifest.json'));noEscape.files[0].path='../escape';
 assert.throws(()=>preflight(['--check'],{},p=>p.endsWith('/manifest.json')?JSON.stringify(noEscape):read(p)),/manifest path/);
 verifyLocalContext([{Endpoints:{docker:{Host:'unix:///var/run/docker.sock'}}}],undefined);
 assert.throws(()=>verifyLocalContext([{Endpoints:{docker:{Host:'ssh://remote'}}}],undefined));
 const proof={id:'id',name:'owned',image:'sha256:synthetic',nonce:'nonce'};
 const container={Id:'id',Name:'/owned',Image:proof.image,Config:{Labels:{'com.vaeroex.qbo-test':'nonce'}},NetworkSettings:{Ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'12345'}]}}};
 assert.equal(verifyOwnedContainer(container,proof),12345);
 for(const mutate of [c=>c.Id='other',c=>c.Image='other',c=>c.Config.Labels={},c=>c.NetworkSettings.Ports['5432/tcp'][0].HostIp='0.0.0.0']){const c=structuredClone(container);mutate(c);assert.throws(()=>verifyOwnedContainer(c,proof));}
 let polls=0;await waitForLock({query:async(sql,args)=>{assert.deepEqual(args,[17]);return {rows:[{wait_event_type:++polls===1?null:'Lock'}]};}},17);assert.equal(polls,2);
 const workflow=read('.github/workflows/shared-evidence-qualification.yml');
 assert.match(workflow,/on:\n  push:\n    branches:\n      - codex\/shared-evidence-security-draft\n/);
 assert.doesNotMatch(workflow,/pull_request|workflow_dispatch|secrets\.|environment:|supabase link|migration up|--full-composition|vercel deploy/);
 assert.match(workflow,/contents: read/);assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/timeout-minutes: 30/);
 assert.match(workflow,/SUPABASE_DB_MIGRATIONS_ENABLED=false supabase db start/);
 assert.match(workflow,/env -u SUPABASE_INTERNAL_IMAGE_REGISTRY node scripts\/shared-evidence-postgres-qualification.cjs --foundation/);
 assert.match(workflow,/supabase stop --no-backup/);
 for(const action of workflow.matchAll(/uses: (\S+)/g))assert.match(action[1],/@[a-f0-9]{40}$/);
 assert.equal(JSON.parse(read('vercel.json')).git.deploymentEnabled['codex/shared-evidence-security-draft'],false);
 // Compile the frozen foundation and unchanged draft in embedded PostgreSQL only.
 // This checks local DDL compatibility, not independent-session behavior.
 const {PGlite}=require('@electric-sql/pglite');const db=new PGlite();
 try {
  const platform=read('supabase/tests/fixtures/square-durable-platform.sql').replace(/^create extension .*;$/gm,'');
  await db.exec(platform);
  await seedFoundation({query:(sql,args)=>args?db.query(sql,args):db.exec(sql)});
  const grants=await db.query("select has_function_privilege('authenticated','public.capture_legacy_evidence_v1(uuid,uuid,date,date)','execute') allowed,has_function_privilege('anon','public.capture_legacy_evidence_v1(uuid,uuid,date,date)','execute') denied");
  assert.equal(grants.rows[0].allowed,true);assert.equal(grants.rows[0].denied,false);
  await db.exec(`set request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000000003","session_id":"00000000-0000-4000-8000-000000000006","role":"authenticated"}';set role authenticated;`);
  const snapshot=await db.query("select preview_legacy_evidence_mapping_v1('00000000-0000-4000-8000-000000000001','harvest','00000000-0000-4000-8000-000000000011') v");
  const mapping=await db.query("select confirm_legacy_evidence_mapping_v1('00000000-0000-4000-8000-000000000001','harvest','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000009',$1) v",[snapshot.rows[0].v.incarnation_hash]);
  const reference=await db.query("select capture_legacy_evidence_v1('00000000-0000-4000-8000-000000000001',$1,'2026-10-01','2026-10-01') v",[mapping.rows[0].v]);
  assert.equal(reference.rows[0].v.stage,'unadmitted');assert.deepEqual(reference.rows[0].v.data.records[0].metrics,[{key:'hours',value:8}]);
 } finally {await db.close();}
 console.log('Offline qualification controls, frozen foundation DDL and workflow scope passed; no native PostgreSQL or Docker started.');
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={run};
