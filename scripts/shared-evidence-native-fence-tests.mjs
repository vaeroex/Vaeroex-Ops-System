// Runs the native runner's SQL helpers sequentially in PGlite. NOT a concurrency pass.
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import * as f from './shared-evidence-sql-fixture.mjs';
import {prepareWriterCases} from './shared-evidence-writer-cases.mjs';
import {installFenceFixture} from './shared-evidence-fence-fixture.mjs';
const {assertFailureAccounting,makeAttempt,installCommitBarrier,waitForCommitBarrier,barrierClass,barrierId}=createRequire(import.meta.url)('./shared-evidence-fence-qualification.cjs');
test('native helper setup and per-provider VSI/brief manifests execute sequentially with exact reopen and failure accounting',async()=>{
 const {db,cases}=await prepareWriterCases();const client={query:(sql,args)=>args?db.query(sql,args):db.exec(sql)};
 try{
  const fixture=await installFenceFixture(db);assert.equal(fixture.relations.length,64);assert.equal(fixture.placeholders.length,16);
  await installCommitBarrier(client);let n=2000;
  for(const probe of cases){const saved=[];
   for(const kind of ['vsi_request','briefing_run']){
    const attempt=await makeAttempt(db,f,probe,kind,n);n+=10;
    await f.login(db,f.owner,f.session,'service_role');await attempt.call(client);await f.admin(db);
    const revision=(await db.query('select artifact_revision from private.shared_evidence_artifact_manifests where artifact_id=$1 and artifact_kind=$2',[attempt.id,attempt.artifactKind])).rows[0].artifact_revision;
    await f.login(db);const original=(await db.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4) v',[f.w,attempt.artifactKind,attempt.id,revision])).rows[0].v;
    assert.equal(original.projections.length,1);assert.equal(original.projections[0].data.provider,probe.provider);
    saved.push({attempt,revision});
   }
   const stale=await makeAttempt(db,f,probe,'vsi_request',n);n+=10;await db.query(probe.sql,probe.args);
   for(const {attempt,revision} of saved){await f.login(db);await assert.rejects(db.query('select reopen_shared_evidence_artifact_v1($1,$2,$3,$4)',[f.w,attempt.artifactKind,attempt.id,revision]),e=>['40001','42501'].includes(e.code));}
   await f.login(db,f.owner,f.session,'service_role');await assert.rejects(stale.call(client),e=>['40001','42501'].includes(e.code));await stale.failure(client);await stale.failure(client);
   await f.admin(db);await assertFailureAccounting(client,stale);
  }
 }finally{await db.close();}
});
test('barrier requires exact advisory identity and controller PID; workflow invokes actual fence mode',async()=>{
 let calls=0;await waitForCommitBarrier({query:async(sql,args)=>{assert.deepEqual(args,[17,barrierClass,barrierId,18]);assert.match(sql,/pg_blocking_pids/);assert.match(sql,/objsubid=2/);calls++;return{rows:[{waiting:true,controlled:calls>1}]};}},17,18);assert.equal(calls,2);
 const workflow=readFileSync(new URL('../.github/workflows/shared-evidence-qualification.yml',import.meta.url),'utf8');
 assert.match(workflow,/env -u SUPABASE_INTERNAL_IMAGE_REGISTRY node scripts\/shared-evidence-writer-qualification.cjs --fence/);
 assert.match(workflow,/shared-evidence-native-fence-tests.mjs/);assert.match(workflow,/supabase stop --no-backup/);
 assert.doesNotMatch(workflow,/pull_request|workflow_dispatch|secrets\.|environment:|supabase link|migration up|vercel deploy/);
});
