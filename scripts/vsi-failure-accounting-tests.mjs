// Synthetic local qualification only; no network/native service/provider calls.
// Exports fixture/call/assert helpers for an already-owned native runner to reuse;
// native concurrency is not claimed by this single-backend suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {prepareWriterCases} from './shared-evidence-writer-cases.mjs';
import {installFenceFixture} from './shared-evidence-fence-fixture.mjs';
import * as f from './shared-evidence-sql-fixture.mjs';
const {extract,installErasureFixture}=createRequire(import.meta.url)('./shared-evidence-erasure-qualification.cjs');
const signature='public.fail_vsi_request_accounting_v1(uuid,uuid,uuid,uuid,uuid,integer,numeric,integer,boolean)';
export const failureAccountingArgs=(overrides={})=>Object.values({workspace:f.w,actor:f.owner,session:f.session,conversation:f.uuid(102),request:f.uuid(103),attempt:1,cost:'0.03',calls:1,estimated:false,...overrides});
export const failAccounting=(db,overrides={})=>db.query('select public.fail_vsi_request_accounting_v1($1,$2,$3,$4,$5,$6,$7,$8,$9) v',failureAccountingArgs(overrides));
export async function createFailureAccountingFixture(options={}){
 const {db}=await prepareWriterCases(options);await f.admin(db);await installFenceFixture(db);await installErasureFixture(db,f);
 await db.exec(`alter table private.google_sheets_derivation_roots add column root_id uuid,add column table_name text,add column record_id uuid;
 alter table private.google_sheets_retention_roots add column erased_at timestamptz,add column expires_at timestamptz;
 alter table private.google_sheets_source_root_links add column root_id uuid,add column source_row_id uuid;
 alter table google_sheets_connections add column disconnected_at timestamptz;
 create table google_sheets_sync_runs(id uuid,workspace_id uuid,connection_id uuid);
 alter function public.google_sheets_record_readable_v1(uuid,text,uuid) rename to fixture_old_readability;`);
 // Reconstruct the existing reader, no private capture body copied into Git.
 await db.exec(extract(f.read('supabase/production-migrations/20261012191836_google_sheets_restricted_erasure_retention.sql'),'public.google_sheets_record_readable_v1'));
 for(const table of ['vsi_requests','vsi_conversations','vsi_exchanges'])await db.exec(`create trigger aa_google_sheets_erasure_cascade_guard before update or delete on ${table} for each row execute function private.google_sheets_erasure_cascade_guard_v1();`);
 await db.query("insert into private.google_sheets_retention_roots(workspace_id,id,expires_at) values($1,$2,now()-interval '1 day')",[f.w,f.uuid(901)]);
 await db.query("insert into private.google_sheets_derivation_roots(workspace_id,table_name,record_id,root_id) values($1,'vsi_conversations',$2,$3)",[f.w,f.uuid(102),f.uuid(901)]);
 await db.exec(f.read('docs/security-drafts/13-vsi-failure-accounting.sql'));
 await f.login(db,f.owner,f.session,'service_role');return db;
}
export async function assertFailureAccountingState(db,{id=f.uuid(103),cost=0.03,calls=1,estimated=false}={}){
 await f.admin(db);
 const request=(await db.query('select status,cost_usd,reservation_usd,lease_until,accepted_at,usage_json from vsi_requests where id=$1',[id])).rows[0];
 assert.equal(request.status,'failed');assert.equal(Number(request.cost_usd),cost);assert.equal(Number(request.reservation_usd),0);assert.equal(request.lease_until,null);assert.equal(request.accepted_at,null);
 const events=(await db.query('select cost_usd,usage_json from vsi_cost_events where request_id=$1',[id])).rows;assert.equal(events.length,1);
 assert.equal(Number(events[0].cost_usd),cost);assert.deepEqual(events[0].usage_json,{accountingContract:'vsi_failure_accounting_v1',failed:true,estimatedCostUsd:cost,providerCalls:calls,costEstimated:estimated});
 assert.deepEqual(request.usage_json,[events[0].usage_json]);
 assert.equal((await db.query('select count(*)::int n from vsi_exchanges where id=$1',[id])).rows[0].n,0);
 assert.equal((await db.query('select count(*)::int n from private.shared_evidence_artifact_manifests where artifact_id=$1',[id])).rows[0].n,0);
}
const denied=(promise,code)=>assert.rejects(promise,e=>e.code===code);
const asService=async db=>f.login(db,f.owner,f.session,'service_role');
const run=async fn=>{const db=await createFailureAccountingFixture();try{await fn(db);}finally{await db.close();}};
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
test('expired conversation failure accounts once without reopening transcript or modifying context',()=>run(async db=>{
 await f.admin(db);const before=(await db.query('select to_jsonb(c) v from vsi_conversations c where id=$1',[f.uuid(102)])).rows[0].v;
 await asService(db);await denied(f.settle(db,null,{id:f.uuid(103),conversationId:f.uuid(102),attempt:1,usage:{estimatedCostUsd:0.03}},2),'55000');
 assert.deepEqual((await failAccounting(db)).rows[0].v,{state:'failed'});assert.deepEqual((await failAccounting(db)).rows[0].v,{state:'already_failed'});
 await denied(failAccounting(db,{cost:'0.04'}),'40001');await denied(failAccounting(db,{calls:2}),'40001');await denied(failAccounting(db,{estimated:true}),'40001');
 await assertFailureAccountingState(db);assert.deepEqual((await db.query('select to_jsonb(c) v from vsi_conversations c where id=$1',[f.uuid(102)])).rows[0].v,before);
 assert.equal((await db.query("select google_sheets_record_readable_v1($1,'vsi_conversations',$2) v",[f.w,f.uuid(102)])).rows[0].v,false);
 await asService(db);await denied(f.settle(db,null,{id:f.uuid(103),conversationId:f.uuid(102),attempt:1,answer:'Must not save'},2),'55000');
}));
test('unknown provider count stays null and estimated reserve cost is explicit',()=>run(async db=>{
 await failAccounting(db,{cost:'0.1',calls:null,estimated:true});await failAccounting(db,{cost:'0.10000000',calls:null,estimated:true});
 await assertFailureAccountingState(db,{cost:0.1,calls:null,estimated:true});
}));
test('existing active viewer role remains allowed only when conversation role matches',()=>run(async db=>{
 await f.admin(db);await db.query("update workspace_members set role='viewer' where user_id=$1",[f.owner]);await db.query("update vsi_conversations set actor_role='viewer' where id=$1",[f.uuid(102)]);
 await asService(db);await failAccounting(db,{cost:'0',calls:0});await assertFailureAccountingState(db,{cost:0,calls:0});
}));
test('exact binding, current authority, billing, privacy and erasure gates remain fail closed',()=>run(async db=>{
 for(const input of [{workspace:f.other},{actor:f.owner2},{session:f.secondSession},{conversation:f.uuid(999)},{request:f.uuid(999)}])await denied(failAccounting(db,input),'42501');
 await denied(failAccounting(db,{attempt:2}),'40001');
 await f.admin(db);await db.query("update workspace_members set role='admin' where user_id=$1",[f.owner]);await asService(db);await denied(failAccounting(db),'42501');
 await f.admin(db);await db.query("update workspace_members set role='owner' where user_id=$1",[f.owner]);await db.query('delete from auth.sessions where id=$1',[f.session]);await asService(db);await denied(failAccounting(db),'42501');
 await f.admin(db);await db.query('insert into auth.sessions(id,user_id) values($1,$2)',[f.session,f.owner]);await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[f.owner]);await asService(db);await denied(failAccounting(db),'42501');
 await f.admin(db);await db.query('update auth.users set banned_until=null,deleted_at=now() where id=$1',[f.owner]);await asService(db);await denied(failAccounting(db),'42501');
 await f.admin(db);await db.query('update auth.users set deleted_at=null where id=$1',[f.owner]);await db.exec('create or replace function private.workspace_billing_entitled_v1(w uuid) returns boolean language sql as $$select false$$;');await asService(db);await denied(failAccounting(db),'42501');
 await f.admin(db);await db.exec('create or replace function private.workspace_billing_entitled_v1(w uuid) returns boolean language sql as $$select true$$;');await db.query('update private.google_sheets_privacy_epochs set blocked=true where workspace_id=$1',[f.w]);await asService(db);await denied(failAccounting(db),'55000');
 await f.admin(db);await db.query('update private.google_sheets_privacy_epochs set blocked=false where workspace_id=$1',[f.w]);await asService(db);await db.query("select set_config('vaeroex.google_sheets_erasure_request','synthetic',false)");await denied(failAccounting(db),'42501');
 await f.admin(db);assert.equal((await db.query('select count(*)::int n from vsi_cost_events')).rows[0].n,0);assert.equal((await db.query('select status from vsi_requests where id=$1',[f.uuid(103)])).rows[0].status,'pending');
}));
test('strict scalar bounds, grants and deleted conversation reject without accounting',()=>run(async db=>{
 for(const input of [{cost:null},{cost:'NaN'},{cost:'Infinity'},{cost:'-Infinity'},{cost:'-0.1'},{cost:'10.00000001'},{cost:'0.000000001'},{calls:-1},{calls:1001},{estimated:null},{attempt:0},{conversation:null}])await denied(failAccounting(db,input),'22023');
 await db.exec('begin isolation level repeatable read');await denied(failAccounting(db),'40001');await db.exec('rollback');
 await f.admin(db);for(const role of ['anon','authenticated','service_role'])assert.equal((await db.query('select has_function_privilege($1,$2,$3) v',[role,signature,'EXECUTE'])).rows[0].v,role==='service_role');
 await f.login(db);await denied(failAccounting(db),'42501');await f.admin(db);await db.query('delete from vsi_conversations where id=$1',[f.uuid(102)]);await asService(db);await denied(failAccounting(db),'42501');
 await f.admin(db);assert.equal((await db.query('select count(*)::int n from vsi_cost_events')).rows[0].n,0);
}));
test('success then failure and failure then success serialize without overwriting output or double charging',()=>run(async db=>{
 await f.admin(db);await db.query("update private.google_sheets_retention_roots set expires_at=now()+interval '1 day' where id=$1",[f.uuid(901)]);
 await asService(db);await f.settle(db,null,f.settlement(),2);await denied(failAccounting(db),'40001');
 await f.admin(db);assert.equal((await db.query('select count(*)::int n from vsi_exchanges where id=$1',[f.uuid(103)])).rows[0].n,1);assert.equal((await db.query('select count(*)::int n from vsi_cost_events where request_id=$1',[f.uuid(103)])).rows[0].n,1);
 const id=await f.newRequest(db,910);await asService(db);await failAccounting(db,{request:id});
 const result=await f.settle(db,null,f.settlement({id}),2);assert.equal(result.error,'stale_attempt');await assertFailureAccountingState(db,{id});
}));
test('late trigger failure rolls back inserted event; existing conflicting ledger is not overwritten',()=>run(async db=>{
 await f.admin(db);await db.exec("create function private.fixture_fail_after_cost() returns trigger language plpgsql as $$begin raise exception 'fixture conflict' using errcode='40001';end$$;create trigger zzz_fixture_fail_after_cost before update on vsi_requests for each row execute function private.fixture_fail_after_cost();");
 await asService(db);await denied(failAccounting(db),'40001');await f.admin(db);assert.equal((await db.query('select count(*)::int n from vsi_cost_events')).rows[0].n,0);
 await db.exec('drop trigger zzz_fixture_fail_after_cost on vsi_requests');
 await db.query("insert into vsi_cost_events(request_id,workspace_id,actor_user_id,attempt,occurred_at,cost_usd,usage_json) values($1,$2,$3,1,now(),0.02,'{}')",[f.uuid(103),f.w,f.owner]);
 await asService(db);await denied(failAccounting(db),'40001');await f.admin(db);assert.equal(Number((await db.query('select cost_usd from vsi_cost_events')).rows[0].cost_usd),0.02);
}));
}
