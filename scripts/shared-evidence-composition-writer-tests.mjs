// Local-only captured writer composition. Captured bodies stay outside Git.
// PGlite executes one backend: injected statement failure is NOT a native race.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {prepareWriterCases,isCurrent} from './shared-evidence-writer-cases.mjs';
import {installFenceFixture} from './shared-evidence-fence-fixture.mjs';
import {read,w,other,owner,session,uuid,admin,login,map,capture,reopen} from './shared-evidence-sql-fixture.mjs';

const directory=process.argv[2];
assert.ok(directory,'Provide the authorized local capture directory. This script never fetches metadata.');
const captured=JSON.parse(readFileSync(resolve(directory,'functions.json'),'utf8'));
const actual=name=>{
 const rows=captured.filter(r=>r.schema==='public'&&r.name===name&&r.definition&&!r.definition_withheld);
 assert.equal(rows.length,1,`one screened captured writer required: ${name}`);
 return rows[0].definition;
};
const ddl=(file,table)=>{
 const sql=read(`supabase/migrations/${file}`).match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`,'i'))?.[0];
 assert.ok(sql,`repository DDL required: ${table}`);return sql;
};
const {db,cases}=await prepareWriterCases();
const results=[];
const lease=uuid(900);
const service=async()=>{await admin(db);await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'service_role',sub:owner,session_id:session})]);};
const providers=['harvest','xero','clockify','toggl','zoho-inventory','katana','loyverse','zoho-books','wix-orders'];
const functions=['apply_reporting_history','apply_reporting_snapshot','apply_loyverse_receipts','apply_wix_order_snapshot','apply_zoho_books_history',
 'disconnect_reporting_connection','disconnect_loyverse_connection','disconnect_wix_order_connection','disconnect_zoho_books_connection',
 'select_reporting_account','save_reporting_refresh'];
try {
 await admin(db);await installFenceFixture(db);
 for(const [file,tables] of [
  ['20261019001207_ready_account_reporting_connectors.sql',['reporting_oauth_states']],
  ['20261017013603_loyverse_read_only_connection.sql',['loyverse_credentials','loyverse_oauth_states']],
  ['20261017023221_zoho_books_read_only_connection.sql',['zoho_books_credentials','zoho_books_oauth_states','zoho_books_daily_summaries']],
  ['20261017051502_wix_orders_read_only_connection.sql',['wix_order_credentials','wix_order_install_states']],
 ])for(const table of tables)await db.exec(ddl(file,table));
 for(const name of functions)await db.exec(actual(name));
 // A late statement error simulates a writer encountering the fence after an
 // earlier statement. It deliberately does not replace the real draft fence.
 await db.exec(`create function private.test_writer_late_conflict() returns trigger language plpgsql as $$begin
 if current_setting('test.writer_conflict',true)=tg_table_name then raise exception 'synthetic_writer_conflict' using errcode='40001';end if;
 if tg_op='DELETE' then return old;end if;return new;end$$;`);
 for(const table of ['reporting_connections','reporting_history_days','loyverse_import_days','zoho_books_history_coverage','wix_order_import_days'])
  await db.exec(`create trigger zzz_synthetic_writer_conflict before insert or update or delete on public.${table} for each row execute function private.test_writer_late_conflict()`);
 const history=new Set(['harvest','xero','clockify']);
 for(const provider of providers){
  const probe=cases.find(c=>c.provider===provider);
  const connection=provider==='harvest'?uuid(11):['xero','clockify','toggl','zoho-inventory','katana'].includes(provider)
   ?uuid(50+['xero','clockify','toggl','zoho-inventory','katana'].indexOf(provider)):uuid({'loyverse':60,'zoho-books':61,'wix-orders':62}[provider]);
  const table=provider==='loyverse'?'loyverse_connections':provider==='zoho-books'?'zoho_books_connections':provider==='wix-orders'?'wix_order_connections':'reporting_connections';
  const reporting=table==='reporting_connections';
  const tables=history.has(provider)?[table,'reporting_history_facts','reporting_history_days']:
   reporting?[table]:provider==='loyverse'?[table,'loyverse_receipt_facts','loyverse_import_days']:
   provider==='zoho-books'?[table,'zoho_books_history_facts','zoho_books_history_coverage','zoho_books_daily_summaries']:[table,'wix_order_facts','wix_order_import_days'];
  const snapshot=async()=>{const out={};for(const t of tables)out[t]=(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') value from public.${t} t where workspace_id=$1`,[w])).rows[0].value;return out;};
  const claim=async()=>{await service();await db.query(`update public.${table} set ${reporting?'lease_id':'sync_lease_id'}=$1,${reporting?'lease_expires_at':'sync_lease_expires_at'}=clock_timestamp()+interval '10 minutes' where id=$2`,[lease,connection]);};
  let args,sql,conflictTable;
  if(history.has(provider)){
   const metrics=(provider==='xero'?['invoices','billed','outstanding','bills','purchases']:['entries','hours','billable_hours','running']).map(key=>({key,value:key==='running'||key==='bills'||key==='purchases'?0:2,...(provider==='xero'?{currency:'USD'}:{})}));
   sql='select public.apply_reporting_history($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text[],$9) value';
   args=[w,provider,connection,lease,'2026-10-01','2026-10-01',JSON.stringify([{recordId:'replacement',day:'2026-10-01',metrics}]),provider==='xero'?['USD']:[],'2026-10-02'];conflictTable='reporting_history_days';
  } else if(reporting){
   const keys=provider==='toggl'?['projects','hours']:provider==='katana'?['stock_rows','unavailable']:['items','low_stock'];
   const now=new Date().toISOString();sql='select public.apply_reporting_snapshot($1,$2,$3,$4,$5::jsonb) value';args=[w,provider,connection,lease,JSON.stringify({start:now,end:now,metrics:keys.map(key=>({key,value:2}))})];conflictTable=table;
  } else if(provider==='loyverse'){
   sql='select public.apply_loyverse_receipts($1,$2,$3,$4,$5,$6::jsonb) value';args=[w,connection,lease,'2026-10-01','2026-10-02',JSON.stringify([{receipt_number:'replacement',store_id:'synthetic',created_at:'2026-10-01T12:00:00Z',receipt_date:'2026-10-01T12:00:00Z',updated_at:'2026-10-01T12:00:00Z',receipt_type:'SALE',total_money:2,total_tax:0,total_discount:0,cancelled:false}])];conflictTable='loyverse_import_days';
  } else if(provider==='zoho-books'){
   sql='select public.apply_zoho_books_history($1,$2,$3,$4,$5,$6,$7::jsonb) value';args=[w,connection,lease,'2026-10-01','2026-10-01','2026-10-02',JSON.stringify([{kind:'invoice',source_id:'2',day:'2026-10-01',counted:true,currency:'USD',total:2,outstanding:0}])];conflictTable='zoho_books_history_coverage';
  } else {
   sql='select public.apply_wix_order_snapshot($1,$2,$3,$4,$5,$6::jsonb) value';args=[w,connection,lease,'2026-10-01','2026-10-02',JSON.stringify([{order_id:uuid(901),created_at:'2026-10-01T12:00:00Z',total_amount:2,currency_code:'USD',payment_status:'PAID'}])];conflictTable='wix_order_import_days';
  }
  await claim();const before=await snapshot();
  // Keep exact role denial in the writer, rather than substituting ownership.
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'authenticated',sub:owner,session_id:session})]);
  await assert.rejects(db.query(sql,args),e=>e.code==='42501');await service();
  const wrong=[...args];wrong[0]=other;
  if(reporting)assert.equal((await db.query(sql,wrong)).rows[0].value,false);
  else await assert.rejects(db.query(sql,wrong),e=>/lease_invalid/.test(e.message));
  assert.deepEqual(await snapshot(),before);
  await db.query("select set_config('test.writer_conflict',$1,false)",[conflictTable]);
  await assert.rejects(db.query(sql,args),e=>e.code==='40001');
  assert.deepEqual(await snapshot(),before,'all source rows, coverage and lease survive failed writer');
  await db.query("select set_config('test.writer_conflict','',false)");
  const result=(await db.query(sql,args)).rows[0].value;assert.ok(result===true||result===1);
  await login(db);assert.equal(await isCurrent(probe,db),false,'actual writer invalidates exact prior reference');await service();
  if(reporting)assert.equal((await db.query(sql,args)).rows[0].value,false,'consumed lease cannot replay');
  else await assert.rejects(db.query(sql,args),e=>/lease_invalid/.test(e.message));
  const disconnect=reporting?'select public.disconnect_reporting_connection($1,$2,$3) value':`select public.disconnect_${provider==='wix-orders'?'wix_order':provider==='zoho-books'?'zoho_books':'loyverse'}_connection($1,$2) value`;
  const disconnectArgs=reporting?[w,provider,connection]:[w,connection];
  assert.equal((await db.query(disconnect,disconnectArgs)).rows[0].value,true);
  await login(db);assert.equal(await isCurrent(probe,db),false);await service();
  results.push({provider,installedWriter:true,ownerReferenceInvalidated:true,wrongWorkspaceDenied:true,roleClaimDenied:true,lateFailureAtomicRollback:true,leaseReplayDenied:true,disconnect:true});
 }
 const lifecycle=[];
 for(const [i,provider] of ['harvest','katana'].entries()) {
  await service();const connection=uuid(920+i);const syntheticCipher='synthetic-fixture-value-'.repeat(3);
  await db.query("insert into reporting_connections(id,workspace_id,provider,created_by,status) values($1,$2,$3,$4,'pending')",[connection,w,provider,owner]);
  await db.query('insert into reporting_credentials(workspace_id,provider,connection_id,ciphertext) values($1,$2,$3,$4)',[w,provider,connection,syntheticCipher]);
  await db.query("update reporting_connections set status='choose_account' where id=$1",[connection]);
  const state=async()=>({connection:(await db.query('select to_jsonb(c) value from reporting_connections c where id=$1',[connection])).rows[0].value,
   credential:(await db.query('select to_jsonb(c) value from reporting_credentials c where connection_id=$1',[connection])).rows[0].value,
   installation:(await db.query('select to_jsonb(c) value from private.katana_evidence_installations c where connection_id=$1',[connection])).rows[0]?.value??null});
  const before=await state();const account={id:'synthetic-account',name:'Synthetic account'};
  const select=tenant=>db.query('select public.select_reporting_account($1,$2,$3,$4::jsonb,$5) value',[tenant,provider,connection,JSON.stringify(account),syntheticCipher+'updated']);
  assert.equal((await select(other)).rows[0].value,false);
  await db.query("select set_config('test.writer_conflict','reporting_connections',false)");
  await assert.rejects(select(w),e=>e.code==='40001');assert.deepEqual(await state(),before,'credential and nonce rollback when final account update fails');
  await db.query("select set_config('test.writer_conflict','',false)");
  assert.equal((await select(w)).rows[0].value,true);const after=await state();
  if(provider==='katana')assert.notEqual(after.installation.nonce,before.installation.nonce);
  assert.equal((await select(w)).rows[0].value,false,'account cannot be silently retargeted after selection');
  await db.query("update reporting_connections set lease_id=$1,lease_expires_at=clock_timestamp()+interval '10 minutes',snapshot=$3 where id=$2",[lease,connection,JSON.stringify({start:'2026-10-01',end:'2026-10-02',metrics:[{key:provider==='katana'?'stock_rows':'hours',value:1}]})]);
  if(provider==='harvest')await db.query("insert into reporting_history_facts values($1,$2,$3,'lifecycle','2026-10-01','[{\"key\":\"hours\",\"value\":1}]')",[w,provider,connection]);
  await login(db);const ref=await capture(db,await map(db,provider,connection));await service();
  const refresh=()=>db.query('select public.save_reporting_refresh($1,$2,$3,$4,$5) value',[w,provider,connection,lease,syntheticCipher+'refreshed']);
  if(provider==='katana')await assert.rejects(refresh(),e=>e.code==='42501');else assert.equal((await refresh()).rows[0].value,true);
  await login(db);assert.equal((await reopen(db,ref.reference_id)).status,'current');await service();
  await db.query('select public.disconnect_reporting_connection($1,$2,$3)',[w,provider,connection]);
  assert.equal((await refresh()).rows[0].value,false,'late refresh cannot restore disconnected credential');
  await login(db);await assert.rejects(reopen(db,ref.reference_id),e=>e.code==='42501');await service();
  if(provider==='katana'){
   assert.equal((await db.query('select count(*)::int n from private.katana_evidence_installations where connection_id=$1',[connection])).rows[0].n,0);
   await assert.rejects(db.query("update reporting_connections set status='connected' where id=$1",[connection]),e=>e.code==='42501');
  }
  lifecycle.push({provider,selectionRollback:true,retargetDenied:true,refresh:provider==='katana'?'denied_no_refresh_contract':'preserves_source_reference',disconnectInvalidates:true,lateRefreshDenied:true});
 }
 console.log(JSON.stringify({scope:'captured_legacy_writer_draft_fence_composition',passed:true,providers:results,lifecycle,providerCalls:0,productionReads:0,nativeConcurrency:false,releaseQualified:false,remaining:['QBO and Square installed writer composition','full platform trigger composition','EXECUTE grants and RLS parity; writer tests run as fixture owner with service-role claims']},null,2));
}catch(error){
 // PostgreSQL errors can embed a captured function/query. Emit status only.
 const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,32}$/.test(error.code)?error.code:'LOCAL_TEST_FAILED';
 console.error(JSON.stringify({scope:'captured_legacy_writer_draft_fence_composition',passed:false,code,completedProviders:results.map(r=>r.provider)}));
 process.exitCode=1;
}finally{await db.close();}
