import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration = readFileSync(new URL('../supabase/migrations/20261019001207_ready_account_reporting_connectors.sql',import.meta.url),'utf8');
const roleMigration = readFileSync(new URL('../supabase/migrations/20261019033506_reporting_supported_jwt_role.sql',import.meta.url),'utf8');
const historyMigration = readFileSync(new URL('../supabase/migrations/20261019070945_reporting_import_history.sql',import.meta.url),'utf8');
const w='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', actor='33333333-3333-4333-8333-333333333333', c='44444444-4444-4444-8444-444444444444', lease='55555555-5555-4555-8555-555555555555';
const ciphertext='A'.repeat(64), account={id:'123',name:'Test account'};
const report=()=>({start:new Date().toISOString(),end:new Date().toISOString(),metrics:[{key:'hours',value:1},{key:'entries',value:1},{key:'billable_hours',value:1},{key:'running',value:0}]});
async function setup() {
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;
 create table public.workspaces(id uuid primary key);create table public.profiles(id uuid primary key);
 create table public.workspace_members(workspace_id uuid,user_id uuid,status text,role text);
 grant usage on schema public,auth to authenticated,service_role;
 grant select on public.workspace_members to authenticated,service_role;`);
 await db.exec(migration); await db.exec(roleMigration); await db.exec(historyMigration);
 await db.query('insert into workspaces values($1),($2)',[w,other]);await db.query('insert into profiles values($1)',[actor]);
 await db.query("insert into workspace_members values($1,$2,'active','owner')",[w,actor]);
 return db;
}
async function connect(db) {
 await db.exec(`set request.jwt.claim.role=''; set request.jwt.claims='{"role":"service_role"}';`);
 await db.query('select begin_reporting_connection($1,$2,$3,$4,$5)',[w,'harvest',actor,c,'b'.repeat(64)]);
 await db.query('select finish_reporting_connection($1,$2,$3,$4)',[w,'harvest',c,ciphertext]);
 await db.query('select select_reporting_account($1,$2,$3,$4,$5)',[w,'harvest',c,JSON.stringify(account),ciphertext]);
}
const apply=(db,scope=w,payload=report(),claim=lease)=>db.query('select apply_reporting_snapshot($1,$2,$3,$4,$5) as ok',[scope,'harvest',c,claim,JSON.stringify(payload)]);
test('credentials and OAuth states have no client access; connections are tenant-isolated',async()=>{
 const db=await setup();try{
 await assert.rejects(db.query('select begin_reporting_connection($1,$2,$3,$4,$5)',[w,'harvest',actor,c,null]),/service_role_required/);
 await connect(db);
 await db.query("insert into reporting_connections(workspace_id,provider,created_by)values($1,'xero',$2)",[other,actor]);
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${actor}';`);
 assert.deepEqual((await db.query('select workspace_id from reporting_connections')).rows,[{workspace_id:w}]);
 for(const table of ['reporting_credentials','reporting_oauth_states']) await assert.rejects(db.query(`select * from ${table}`),/permission denied/);
 await assert.rejects(db.query("update reporting_connections set status='disconnected'"),/permission denied/);
 await assert.rejects(apply(db),/permission denied/);
 await db.exec('reset role');
 const grants=await db.query("select has_function_privilege('anon','apply_reporting_snapshot(uuid,text,uuid,uuid,jsonb)','EXECUTE') as anon,has_function_privilege('authenticated','apply_reporting_snapshot(uuid,text,uuid,uuid,jsonb)','EXECUTE') as authenticated,has_function_privilege('service_role','apply_reporting_snapshot(uuid,text,uuid,uuid,jsonb)','EXECUTE') as service");
 assert.deepEqual(grants.rows[0],{anon:false,authenticated:false,service:true});
 }finally{await db.close();}
});
test('only current owners can begin; completion and selection cannot replay or retarget',async()=>{
 const db=await setup();try{
 await db.exec(`set request.jwt.claim.role=''; set request.jwt.claims='{"role":"service_role"}';`);
 await assert.rejects(db.query('select begin_reporting_connection($1,$2,$3,$4,$5)',[other,'harvest',actor,c,null]),/owner_required/);
 await connect(db);
 assert.equal((await db.query('select finish_reporting_connection($1,$2,$3,$4) as ok',[w,'harvest',c,'B'.repeat(64)])).rows[0].ok,false);
 assert.equal((await db.query('select select_reporting_account($1,$2,$3,$4,$5) as ok',[w,'harvest',c,JSON.stringify({id:'999',name:'Other account'}),ciphertext])).rows[0].ok,false);
 await assert.rejects(db.query('select begin_reporting_connection($1,$2,$3,$4,$5)',[w,'harvest',actor,lease,null]),/unique/);
 assert.deepEqual((await db.query('select account from reporting_connections where id=$1',[c])).rows[0].account,account);
 }finally{await db.close();}
});
test('one sync lease wins; failed/invalid results preserve the old complete report',async()=>{
 const db=await setup();try{
 await connect(db);
 const claim=()=>db.query('select claim_reporting_sync($1,$2,$3,$4) as ok',[w,'harvest',c,lease]);
 const claims=await Promise.all([claim(),claim()]);assert.equal(claims.filter(x=>x.rows[0].ok).length,1);
 assert.equal((await apply(db,other)).rows[0].ok,false);
 const old=report();assert.equal((await apply(db,w,old)).rows[0].ok,true);
 assert.equal((await apply(db)).rows[0].ok,false,'consumed lease cannot replay');
 assert.equal((await claim()).rows[0].ok,false,'free-tier cooldown blocks repeated reads');
 await db.query("update reporting_connections set next_sync_at=now()-interval '1 second' where id=$1",[c]);await claim();
 for(const payload of [
  {...report(),metrics:[{key:'hours',value:-1}]}, {...report(),metrics:[{key:'notes',value:1}]},
  {...report(),metrics:[{key:'hours',value:1,secret:'must-not-persist'}]}, {...report(),metrics:[{key:'hours',value:1},{key:'hours',value:2}]},
  {...report(),metrics:[{key:'hours',value:null}]}, {...report(),metrics:[{key:null,value:1}]},
  {...report(),metrics:[{key:'hours',value:1,currency:'USD'}]}, {...report(),start:null}
 ]) await assert.rejects(apply(db,w,payload));
 assert.deepEqual((await db.query('select snapshot from reporting_connections where id=$1',[c])).rows[0].snapshot,old);
 }finally{await db.close();}
});
test('disconnect fences refresh and sync, removes stored data, and cannot affect another workspace',async()=>{
 const db=await setup();try{
 await connect(db);await db.query('select claim_reporting_sync($1,$2,$3,$4)',[w,'harvest',c,lease]);
 const disconnect=(scope)=>db.query('select disconnect_reporting_connection($1,$2,$3) as ok',[scope,'harvest',c]);
 assert.equal((await disconnect(other)).rows[0].ok,false);
 assert.equal((await disconnect(w)).rows[0].ok,true);
 assert.equal((await db.query('select save_reporting_refresh($1,$2,$3,$4,$5) as ok',[w,'harvest',c,lease,'B'.repeat(64)])).rows[0].ok,false);
 assert.equal((await apply(db)).rows[0].ok,false);
 for(const table of ['reporting_credentials','reporting_oauth_states']) assert.equal((await db.query(`select count(*)::int as n from ${table}`)).rows[0].n,0);
 const row=(await db.query('select status,account,snapshot from reporting_connections where id=$1',[c])).rows[0];
 assert.deepEqual(row,{status:'disconnected',account:null,snapshot:null});
 }finally{await db.close();}
});

test('modern JSON claims admit only service role and legacy claims remain compatible',async()=>{
 const db=await setup();try{
 for(const role of ['authenticated','anon']){
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role})]);
  await assert.rejects(db.query('select begin_reporting_connection($1,$2,$3,$4,$5)',[w,'harvest',actor,c,null]),/service_role_required/);
 }
 await db.exec("set request.jwt.claims=''; set request.jwt.claim.role='service_role'");
 await db.query('select begin_reporting_connection($1,$2,$3,$4,$5)',[w,'harvest',actor,c,null]);
 assert.equal((await db.query('select count(*)::int as n from reporting_connections')).rows[0].n,1);
 }finally{await db.close();}
});

const historyFact=(recordId,day,hours=1)=>({recordId,day,metrics:[{key:'entries',value:1},{key:'hours',value:hours},{key:'billable_hours',value:hours},{key:'running',value:0}]});
async function historyLease(db,provider='harvest',connection=c){
 await db.exec(`reset role;set request.jwt.claim.role='';set request.jwt.claims='{"role":"service_role"}';`);
 await db.query("update reporting_connections set next_sync_at=now()-interval '1 second',lease_id=null,lease_expires_at=null where id=$1",[connection]);
 assert.equal((await db.query('select claim_reporting_sync($1,$2,$3,$4) as ok',[w,provider,connection,lease])).rows[0].ok,true);
}
const importRows=(db,from,to,rows,provider='harvest',currencies=[],scope=w,connection=c)=>db.query(
 `select apply_reporting_history($1,$2,$3,$4,$5,$6,$7,$8,($6::date+1)::timestamp at time zone 'UTC') as ok`,[scope,provider,connection,lease,from,to,JSON.stringify(rows),currencies]);
async function readHistory(db,from=null,to=null,provider='harvest',scope=w,connection=c){
 await db.exec(`set role authenticated;set request.jwt.claim.sub='${actor}';`);
 return (await db.query('select read_reporting_history($1,$2,$3,$4,$5) as report',[scope,provider,connection,from,to])).rows[0].report;
}
const metricValue=(report,key,currency)=>report.metrics.find(m=>m.key===key&&m.currency===currency)?.value;

test('history preserves nonoverlapping dates, replaces overlaps, moves IDs and deletes missing source records',async()=>{
 const db=await setup();try{
 await connect(db);
 let report=await readHistory(db);assert.equal(report.hasHistory,false);assert.equal(report.coverage.days,0);
 await historyLease(db);await importRows(db,'2020-01-01','2020-01-02',[historyFact('moving','2020-01-01',2),historyFact('deleted','2020-01-02',3)]);
 await historyLease(db);await importRows(db,'2021-04-01','2021-04-02',[historyFact('other','2021-04-01',4)]);
 report=await readHistory(db);assert.equal(report.records,3);assert.equal(metricValue(report,'hours'),9);assert.equal(report.coverage.days,4);
 await historyLease(db);await importRows(db,'2022-05-01','2022-05-01',[historyFact('moving','2022-05-01',5)]);
 report=await readHistory(db);assert.equal(report.records,3);assert.equal(metricValue(report,'hours'),12,'ID moved globally, old contribution is gone');
 await historyLease(db);await importRows(db,'2020-01-01','2020-01-02',[]);
 report=await readHistory(db);assert.equal(report.records,2);assert.equal(metricValue(report,'hours'),9,'selected missing record deleted; other years retained');
 report=await readHistory(db,'2020-01-01','2020-01-02');assert.equal(report.hasHistory,true);assert.equal(report.coverage.days,2);assert.equal(report.records,0);assert.equal(metricValue(report,'hours'),0);
 report=await readHistory(db,'2019-01-01','2019-12-31');assert.equal(report.hasHistory,true);assert.equal(report.coverage.days,0);assert.deepEqual(report.metrics,[]);
 await historyLease(db);await importRows(db,'2022-05-01','2022-05-01',[historyFact('moving','2022-05-01',5)]);
 report=await readHistory(db);assert.equal(report.records,2);assert.equal(metricValue(report,'hours'),9,'same range replay is idempotent');
 }finally{await db.close();}
});

test('historical aggregation includes more than 1,000 facts and rejects incomplete/invalid payloads atomically',async()=>{
 const db=await setup();try{
 await connect(db);await historyLease(db);
 const rows=Array.from({length:1205},(_,i)=>historyFact(`row${i}`,'2018-07-01',0.5));
 await importRows(db,'2018-07-01','2018-07-01',rows);
 let report=await readHistory(db);assert.equal(report.records,1205);assert.equal(metricValue(report,'hours'),602.5);
 for(const invalid of [
  [historyFact('duplicate','2018-07-01'),historyFact('duplicate','2018-07-01')],
  [historyFact('outside','2018-07-02')],
  [{...historyFact('extra','2018-07-01'),name:'must not persist'}],
  [{...historyFact('secret','2018-07-01'),metrics:[{key:'employee_name',value:1}]}],
  [{...historyFact('negative','2018-07-01'),metrics:historyFact('x','2018-07-01').metrics.map(m=>({...m,value:-1}))}],
  Array.from({length:2001},(_,i)=>historyFact(`large${i}`,'2018-07-01'))
 ]){
  await historyLease(db);await assert.rejects(importRows(db,'2018-07-01','2018-07-01',invalid));
  report=await readHistory(db);assert.equal(report.records,1205);assert.equal(metricValue(report,'hours'),602.5);
 }
 await historyLease(db);await assert.rejects(importRows(db,'2018-01-01','2019-01-02',[]),/invalid_date_range/);
 await assert.rejects(importRows(db,'infinity','infinity',[]),/invalid_date_range/);
 await assert.rejects(importRows(db,'2018-02-30','2018-02-30',[]));
 }finally{await db.close();}
});

test('history reads require active membership and writes are fenced by workspace, lease and disconnect',async()=>{
 const db=await setup();try{
 await connect(db);await historyLease(db);
 assert.equal((await importRows(db,'2019-01-01','2019-01-01',[],'harvest',[],other)).rows[0].ok,false);
 await importRows(db,'2019-01-01','2019-01-01',[historyFact('one','2019-01-01')]);
 await readHistory(db);
 await assert.rejects(importRows(db,'2019-01-01','2019-01-01',[]),/permission denied/);
 await assert.rejects(readHistory(db,null,null,'harvest',other),/membership_required/);
 assert.equal((await db.query('select count(*)::int n from reporting_history_facts')).rows[0].n,1);
 await db.exec('reset role');await db.query("update workspace_members set status='inactive' where user_id=$1",[actor]);
 await assert.rejects(readHistory(db),/membership_required/);
 assert.equal((await db.query('select count(*)::int n from reporting_history_facts')).rows[0].n,0,'RLS hides suspended membership');
 await db.exec('reset role');await db.query("update workspace_members set status='active' where user_id=$1",[actor]);
 await historyLease(db);await db.query("update reporting_connections set lease_expires_at=now()-interval '1 second' where id=$1",[c]);
 assert.equal((await importRows(db,'2019-01-01','2019-01-01',[])).rows[0].ok,false);
 await historyLease(db);await db.query('select disconnect_reporting_connection($1,$2,$3)',[w,'harvest',c]);
 assert.equal((await importRows(db,'2019-01-01','2019-01-01',[])).rows[0].ok,false);
 for(const table of ['reporting_history_facts','reporting_history_days'])assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n,0);
 await assert.rejects(readHistory(db),/connection_missing/);
 }finally{await db.close();}
});

test('Xero history keeps currencies separate and imported-empty dates retain truthful currency zeros',async()=>{
 const db=await setup();try{
 await db.exec(`set request.jwt.claims='{"role":"service_role"}';`);
 await db.query('select begin_reporting_connection($1,$2,$3,$4,$5)',[w,'xero',actor,c,null]);
 await db.query('select finish_reporting_connection($1,$2,$3,$4)',[w,'xero',c,ciphertext]);
 await db.query('select select_reporting_account($1,$2,$3,$4,$5)',[w,'xero',c,JSON.stringify(account),ciphertext]);
 const xero=(recordId,currency,value)=>({recordId,day:'2017-01-01',metrics:[{key:'invoices',value:1,currency},{key:'billed',value,currency},{key:'outstanding',value,currency},{key:'bills',value:0,currency},{key:'purchases',value:0,currency}]});
 await historyLease(db,'xero');await importRows(db,'2017-01-01','2017-01-01',[xero('usd','USD',10.25),xero('eur','EUR',20.5)],'xero',['USD','EUR']);
 let report=await readHistory(db,null,null,'xero');assert.equal(metricValue(report,'billed','USD'),10.25);assert.equal(metricValue(report,'billed','EUR'),20.5);
 const movedVoid={...xero('usd','USD',0),day:'2017-02-01'};movedVoid.metrics=movedVoid.metrics.map(m=>({...m,value:0}));
 await historyLease(db,'xero');await importRows(db,'2017-02-01','2017-02-01',[movedVoid],'xero',['USD']);
 report=await readHistory(db,null,null,'xero');assert.equal(report.records,2);assert.equal(metricValue(report,'billed','USD'),0,'moved void clears the original contribution');
 await historyLease(db,'xero');await importRows(db,'2017-01-01','2017-01-01',[],'xero',['USD']);
 report=await readHistory(db,null,null,'xero');assert.equal(report.records,1);assert.equal(metricValue(report,'billed','USD'),0);assert.equal(metricValue(report,'billed','EUR'),undefined);
 }finally{await db.close();}
});

test('a partial observation remains incomplete on later dates until that date is imported completely',async()=>{
 const db=await setup();try{
 await connect(db);await historyLease(db);
 const partial=(cutoff)=>db.query('select apply_reporting_history($1,$2,$3,$4,$5,$6,$7,$8,$9)',[w,'harvest',c,lease,'2020-01-01','2020-01-02','[]',[] ,cutoff]);
 await partial('2020-01-02T12:00:00Z');
 let report=await readHistory(db);assert.equal(report.coverage.days,2);assert.equal(report.coverage.completeDays,1);assert.equal(report.coverage.incompleteDays,1);
 assert.equal(new Date(report.coverage.coveredThrough).toISOString(),'2020-01-02T12:00:00.000Z');
 await historyLease(db);await assert.rejects(partial('2020-01-04T00:00:00Z'),/invalid_observation_cutoff/);
 await assert.rejects(partial('2020-01-01T23:59:59Z'),/invalid_observation_cutoff/);
 report=await readHistory(db);assert.equal(report.coverage.incompleteDays,1,'invalid retry leaves partial coverage intact');
 await historyLease(db);await importRows(db,'2020-01-02','2020-01-02',[]);
 report=await readHistory(db);assert.equal(report.coverage.completeDays,2);assert.equal(report.coverage.incompleteDays,0);
 }finally{await db.close();}
});

test('existing aggregate snapshot stays available without inventing historical facts or covered dates',async()=>{
 const db=await setup();try{
 await connect(db);await historyLease(db);const legacy=report();await apply(db,w,legacy);
 let history=await readHistory(db);assert.equal(history.hasHistory,false);assert.equal(history.records,0);
 await historyLease(db);await importRows(db,'2012-06-01','2012-06-02',[]);
 history=await readHistory(db);assert.equal(history.hasHistory,true);assert.equal(history.coverage.days,2);
 assert.deepEqual((await db.query('select snapshot from reporting_connections where id=$1',[c])).rows[0].snapshot,legacy);
 }finally{await db.close();}
});
