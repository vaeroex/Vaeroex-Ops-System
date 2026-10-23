// Local, offline qualification using an explicitly supplied private metadata capture.
// No connection credentials, network calls, production mutations or CI dispatch.
// PGlite is one backend: injected contention is NOT native concurrency proof.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {prepareWriterCases} from './shared-evidence-writer-cases.mjs';
import {installFenceFixture} from './shared-evidence-fence-fixture.mjs';
import {read,definition,w,other,owner,uuid,admin,login,typedRead} from './shared-evidence-sql-fixture.mjs';

async function main() {
const directory=process.argv[2];
assert.ok(directory,'Supply the authorized local metadata capture directory; never fetch missing definitions.');
const captured=['functions.json','direct-bound-guards.json','sheets-guards.json','bounded-helper-bodies.json']
 .flatMap(file=>JSON.parse(readFileSync(resolve(directory,file),'utf8')));
const actual=name=>{
 const matches=captured.filter(row=>(row.name===name||row.name?.endsWith("."+name))&&row.definition&&!row.definition_withheld);
 assert.equal(matches.length,1,`exactly one captured definition required: ${name}`);
 return matches[0].definition;
};
const body=sql=>sql.match(/AS (\$[^$]*\$)([\s\S]*?)\1/i)?.[2]??sql.match(/as (\$[^$]*\$)([\s\S]*?)\1/i)?.[2];

// The original CREATE is deliberately modified by the later accounting migration.
const qboBase=read('supabase/production-migrations/20260930004000_qbo_production_source_validation.sql');
const qbo=qboBase.match(/create(?: or replace)? function public\.complete_qbo_production_source_validation_v1\([\s\S]*?AS (\$[^$]*\$)[\s\S]*?\1;/i)?.[0];
assert.ok(qbo,'QBO source function found');
const from="v_pending.normalized_schema_version='qbo_minimizer_v1'";
const to="v_pending.normalized_schema_version in ('qbo_minimizer_v1','qbo_minimizer_v2')";
const upgrade=read('supabase/production-migrations/20260930193412_qbo_production_accounting_intake.sql');
assert.ok(upgrade.includes(from.replaceAll("'","''"))&&upgrade.includes(to.replaceAll("'","''")));
assert.equal(qbo.split(from).length,2);
assert.equal(body(qbo.replace(from,to)),body(actual('complete_qbo_production_source_validation_v1')));

const {db}=await prepareWriterCases();
let assertions=1;
try {
 await admin(db);await installFenceFixture(db);
 // Actual privately captured session predicate, never a public CI fixture.
 await db.exec(actual('current_auth_session_live_v1'));
 await db.exec(actual('is_workspace_member'));
 const memberAllowed=async()=> (await db.query('select public.is_workspace_member($1) ok',[w])).rows[0].ok;
 await login(db);assert.equal(await memberAllowed(),true);
 await login(db,owner,uuid(8));assert.equal(await memberAllowed(),false);
 await login(db,owner,'invalid-session');assert.equal(await memberAllowed(),false);
 await admin(db);await db.query("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[uuid(6)]);
 await login(db);assert.equal(await memberAllowed(),false);
 await admin(db);await db.query('update auth.sessions set not_after=null where id=$1',[uuid(6)]);
 await db.query("update auth.users set banned_until=now()+interval '1 hour' where id=$1",[owner]);
 await login(db);assert.equal(await memberAllowed(),false);
 await admin(db);await db.query('update auth.users set banned_until=null,deleted_at=now() where id=$1',[owner]);
 await login(db);assert.equal(await memberAllowed(),false);
 await admin(db);await db.query('update auth.users set deleted_at=null where id=$1',[owner]);
 await login(db);assert.equal(await memberAllowed(),true);
 assert.equal((await db.query('select public.is_workspace_member($1) ok',[other])).rows[0].ok,false);assertions+=8;
 await admin(db);
 await db.exec(`alter table private.google_sheets_derivation_roots add column root_id uuid,add column table_name text,add column record_id uuid;
 alter table private.google_sheets_source_root_links add column root_id uuid,add column source_row_id uuid;
 alter table private.google_sheets_retention_roots add column erased_at timestamptz,add column expires_at timestamptz;
 alter table google_sheets_connections add column disconnected_at timestamptz;
 create table google_sheets_sync_runs(id uuid,workspace_id uuid,connection_id uuid);
 alter table file_imports add column file_upload_id uuid;
 alter function public.google_sheets_record_readable_v1(uuid,text,uuid) rename to fixture_readable_stub;
 alter function private.google_sheets_operational_source_current_v1(uuid,uuid,uuid) rename to fixture_operational_stub;`);
 await db.exec(actual('google_sheets_record_readable_v1'));
 await db.exec(actual('google_sheets_operational_source_current_v1'));
 await login(db);await typedRead(db,{kind:'sheets_ticket_source',source_id:uuid(302)});assertions++;
 await admin(db);await db.query('update private.google_sheets_privacy_epochs set blocked=true where workspace_id=$1',[w]);
 await login(db);await assert.rejects(typedRead(db,{kind:'sheets_ticket_source',source_id:uuid(302)}),e=>e.code==='42501');assertions++;
 await admin(db);await db.query('update private.google_sheets_privacy_epochs set blocked=false where workspace_id=$1',[w]);
 await db.query("insert into private.google_sheets_retention_roots(workspace_id,id,expires_at) values($1,$2,now()-interval '1 day')",[w,uuid(801)]);
 await db.query('insert into private.google_sheets_source_root_links(workspace_id,source_row_id,root_id) values($1,$2,$3)',[w,uuid(302),uuid(801)]);
 await login(db);await assert.rejects(typedRead(db,{kind:'sheets_ticket_source',source_id:uuid(302)}),e=>e.code==='42501');assertions++;
 await admin(db);await db.query("update private.google_sheets_retention_roots set expires_at=now()+interval '1 day' where id=$1",[uuid(801)]);
 await login(db);await typedRead(db,{kind:'sheets_ticket_source',source_id:uuid(302)});assertions++;
 await admin(db);
 assert.equal((await db.query('select private.google_sheets_operational_source_current_v1($1,$2,null) ok',[w,uuid(999)])).rows[0].ok,false);assertions++;

 // Exact captured cascade/capability functions with an explicit synthetic hash.
 // Canonical hash and erasure orchestration parity are NOT qualified here.
 await db.exec("create function private.google_sheets_erasure_hash_v1(p_value jsonb) returns text language sql immutable as $$select md5(p_value::text)$$;");
 await db.exec(`create table private.google_sheets_erasure_capabilities(transaction_id bigint,backend_id integer,workspace_id uuid,table_name text,record_id uuid,old_hash text);`);
 await db.exec(actual('google_sheets_exact_delete_allowed_v1'));
 await db.exec(definition('google_sheets_erasure_cascade_guard_v1'));
 await db.exec(`create trigger aa_google_sheets_erasure_cascade_guard before update or delete on kpis for each row execute function private.google_sheets_erasure_cascade_guard_v1();
 alter function private.shared_evidence_write_fence_v1(uuid) rename to fixture_real_write_fence;
 create function private.shared_evidence_write_fence_v1(w uuid) returns void language plpgsql as $$begin
 if current_setting('test.fence_conflict',true)='true' then raise exception 'shared_evidence_write_conflict' using errcode='40001';end if;
 perform private.fixture_real_write_fence(w);end$$;`);
 await db.exec("select set_config('vaeroex.google_sheets_erasure_request','synthetic',false);select set_config('test.fence_conflict','true',false)");
 await assert.rejects(db.query('delete from kpis where id=$1',[uuid(304)]),e=>e.code==='42501');assertions++;
 await db.exec('begin');
 await db.query("insert into private.google_sheets_erasure_capabilities select txid_current(),pg_backend_pid(),workspace_id,'kpis',id,private.google_sheets_erasure_hash_v1(to_jsonb(k)) from kpis k where id=$1",[uuid(304)]);
 await assert.rejects(db.query('delete from kpis where id=$1',[uuid(304)]),e=>e.code==='40001');await db.exec('rollback');assertions++;
 assert.equal((await db.query('select count(*)::int n from kpis where id=$1',[uuid(304)])).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from private.google_sheets_erasure_capabilities')).rows[0].n,0);assertions+=2;
 await db.exec("select set_config('test.fence_conflict','false',false);begin");
 await db.query("insert into private.google_sheets_erasure_capabilities select txid_current(),pg_backend_pid(),workspace_id,'kpis',id,private.google_sheets_erasure_hash_v1(to_jsonb(k)) from kpis k where id=$1",[uuid(304)]);
 await db.query('delete from kpis where id=$1',[uuid(304)]);await db.exec('rollback');
 assert.equal((await db.query('select count(*)::int n from kpis where id=$1',[uuid(304)])).rows[0].n,1);assertions++;
 console.log(JSON.stringify({assertions,passed:true,providerCalls:0,releaseQualified:false,nativeConcurrency:false,
  qualified:['composed QBO body matches captured body','membership wrapper preserves live-session predicate','captured Sheets retention/operational readers in typed path','captured erasure guard precedes injected conflict; rollback preserves data'],
  notCoveredByThisLocalRun:['deployed erasure orchestration','native concurrency (separately qualified by bounded synthetic CI)','full writer and trigger composition']}));
} finally {await db.close();}

}
main().catch(error=>{
 // A failed body comparison must never print either private function body.
 console.error(JSON.stringify({passed:false,code:/^[A-Z0-9_]{1,32}$/.test(error?.code??'')?error.code:'LOCAL_TEST_FAILED'}));
 process.exitCode=1;
});
