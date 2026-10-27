// Isolated incremental-upgrade contract only; no production connection or secret.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { read, typedSetup, sheetsFixture, admin, login, map, capture, reopen, uuid, w, owner } from './shared-evidence-sql-fixture.mjs';
const require=createRequire(import.meta.url),{assemble}=require('./shared-evidence-mapping-upgrade.cjs');

test('incremental mapping upgrade preserves stored records and authority while adding v2 and protected currency',async()=>{
 const {db}=await typedSetup();try{
  await admin(db);await sheetsFixture(db);await db.exec(read('docs/security-drafts/08-sheets-projection.sql'));
  const current=read('docs/security-drafts/01-legacy-evidence.sql');
  const start=current.indexOf('create function private.resolve_legacy_evidence_v1('),end=current.indexOf('end $$;',start)+7;
  const functionSource=current.slice(start,end),block=/  -- Currency is protected connection metadata[\s\S]*?  end if;\n/;
  assert.match(functionSource,block);
  await db.exec(functionSource.replace('create function ','create or replace function ').replace(block,''));
  // Existing v1 signature/PLpgSQL owner barrier, before the new v2 exists.
  await db.exec(`create function public.discover_shared_evidence_v1(uuid,date,date) returns jsonb language plpgsql security definer set search_path='' as $$ begin perform private.require_evidence_owner_v1($1); return '{"stage":"catalog_only","candidates":[],"truncated":false}'::jsonb; end $$;
    revoke all on function public.discover_shared_evidence_v1(uuid,date,date) from public,anon,service_role; grant execute on function public.discover_shared_evidence_v1(uuid,date,date) to authenticated;`);
  const connection=uuid(950);await db.query("insert into loyverse_connections(id,workspace_id,created_by,status,merchant_id,currency_code) values($1,$2,$3,'connected',$4,'USD')",[connection,w,owner,uuid(951)]);
  await db.query("insert into loyverse_receipt_facts(workspace_id,connection_id,receipt_number,store_id,receipt_date,created_at,updated_at,receipt_type,total_money,total_tax,total_discount,cancelled) values($1,$2,'receipt','store','2026-10-01','2026-10-01','2026-10-01','SALE',0,0,0,false)",[w,connection]);
  await login(db);const binding=await map(db,'loyverse',connection),before=await capture(db,binding);assert.equal(Object.hasOwn(before.data,'currency'),false);
  await admin(db);const stored=async()=>JSON.stringify((await db.query('select to_jsonb(r) value from private.legacy_evidence_references r order by id')).rows);
  const prior=await stored(),upgrade=assemble();assert.equal(upgrade.sql,read('docs/security-drafts/mapping-upgrade/forward.sql'));
  await db.exec(upgrade.sql);assert.equal(await stored(),prior);
  await login(db);assert.deepEqual(await reopen(db,before.reference_id),{status:'changed',reference_id:before.reference_id});
  const after=await capture(db,binding);assert.equal(after.data.currency,'USD');assert.equal(after.data.records[0].total_money,0);assert.notEqual(before.source_hash,after.source_hash);
  const v2=(await db.query("select public.discover_shared_evidence_v2($1,'2026-10-01','2026-10-07',array['loyverse']) v",[w])).rows[0].v;
  assert.equal(v2.candidates[0].provider,'loyverse');assert.equal(v2.totalCandidates,v2.candidates.length);
  const v1=(await db.query("select public.discover_shared_evidence_v1($1,'2026-10-01','2026-10-07') v",[w])).rows[0].v;
  assert.deepEqual(Object.keys(v1).sort(),['candidates','stage','truncated']);
  await admin(db);const grant=(await db.query("select has_function_privilege('authenticated','public.discover_shared_evidence_v2(uuid,date,date,text[])','EXECUTE') a,has_function_privilege('anon','public.discover_shared_evidence_v2(uuid,date,date,text[])','EXECUTE') n,has_function_privilege('service_role','public.discover_shared_evidence_v2(uuid,date,date,text[])','EXECUTE') s")).rows[0];assert.deepEqual(grant,{a:true,n:false,s:false});
  const afterStored=await stored();await db.exec(upgrade.sql);assert.equal(await stored(),afterStored,'repeat local DDL leaves immutable records untouched');
  await login(db);assert.equal((await reopen(db,after.reference_id)).status,'current');
 }finally{await db.close();}
});
