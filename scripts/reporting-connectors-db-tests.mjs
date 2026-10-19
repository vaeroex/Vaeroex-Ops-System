import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const migration = readFileSync(new URL('../supabase/migrations/20261019001207_ready_account_reporting_connectors.sql',import.meta.url),'utf8');
const w='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222', actor='33333333-3333-4333-8333-333333333333', c='44444444-4444-4444-8444-444444444444', lease='55555555-5555-4555-8555-555555555555';
const ciphertext='A'.repeat(64), account={id:'123',name:'Test account'};
const report=()=>({start:new Date().toISOString(),end:new Date().toISOString(),metrics:[{key:'hours',value:1},{key:'entries',value:1},{key:'billable_hours',value:1},{key:'running',value:0}]});
async function setup() {
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.workspaces(id uuid primary key);create table public.profiles(id uuid primary key);
 create table public.workspace_members(workspace_id uuid,user_id uuid,status text,role text);
 grant usage on schema public,auth to authenticated,service_role;
 grant select on public.workspace_members to authenticated,service_role;`);
 await db.exec(migration);
 await db.query('insert into workspaces values($1),($2)',[w,other]);await db.query('insert into profiles values($1)',[actor]);
 await db.query("insert into workspace_members values($1,$2,'active','owner')",[w,actor]);
 return db;
}
async function connect(db) {
 await db.exec("set request.jwt.claim.role='service_role'");
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
 await db.exec("set request.jwt.claim.role='service_role'");
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
