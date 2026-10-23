import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {prepareWriterCases,isCurrent} from './shared-evidence-writer-cases.mjs';
import {login,admin} from './shared-evidence-sql-fixture.mjs';
const {check,observeWriter}=createRequire(import.meta.url)('./shared-evidence-writer-qualification.cjs');
test('all twelve synthetic source mutations invalidate exact evidence without native execution',async()=>{
 const {db,cases}=await prepareWriterCases();try{
  for(const probe of cases){await login(db);assert(await isCurrent(probe,db),probe.provider);await admin(db);await db.query(probe.sql,probe.args);await login(db);assert.equal(await isCurrent(probe,db),false,probe.provider);}
 }finally{await db.close();}
});
test('expanded runner fails closed on configuration/mode and distinguishes lock from commit',async()=>{
 assert.equal(check(['--check'],{}).releaseQualified,false);
 assert.equal(check(['--fence'],{}).releaseQualified,false);
 for(const args of [[],['--foundation'],['--full-composition'],['--source-write-probes','--url=postgres://remote']])assert.throws(()=>check(args,{}));
 for(const key of ['DATABASE_URL','PGHOST','SUPABASE_ACCESS_TOKEN'])assert.throws(()=>check(['--check'],{[key]:'forbidden'}));
 assert.equal(await observeWriter({query:async()=>({rows:[{wait_event_type:'Lock'}]})},1,()=>false),'blocked_on_reader');
 assert.equal(await observeWriter({query:async()=>{throw Error('query not needed');}},1,()=>true),'committed_before_reader_end');
});
