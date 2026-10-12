/* eslint-disable @typescript-eslint/no-require-imports -- Owned native SQL recovery cursor regression. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const {Client}=require('pg'),{qualify}=require('./google-sheets-data-tests.cjs');
const bin=process.env.SHEETS_TEST_PG_BIN;
if(!bin||!path.isAbsolute(bin))throw Error('Set SHEETS_TEST_PG_BIN to the installed native PostgreSQL bin directory');
let owned,started=false,db;const clients=[];let checks=0;
function command(name,args){const result=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:30000,maxBuffer:1048576});if(result.status!==0)throw Error(`owned_${name}_failed:${result.stderr.slice(0,500)}`);}
async function session(){const client=new Client({host:path.join(owned,'socket'),port:5432,user:'postgres',database:'postgres',statement_timeout:15000});await client.connect();clients.push(client);return client;}
async function call(client,limit=100){await client.query("set role service_role;select set_config('request.jwt.claim.role','service_role',false)");try{return(await client.query('select public.recover_google_sheets_syncs_v1($1) result',[limit])).rows[0].result;}finally{await client.query('reset role');}}
(async()=>{
 owned=fs.mkdtempSync('/tmp/vaeroex-sheets-recovery-continuation-');fs.chmodSync(owned,0o700);fs.mkdirSync(path.join(owned,'socket'),{mode:0o700});
 command('initdb',['-D',path.join(owned,'data'),'--username=postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
 command('pg_ctl',['-D',path.join(owned,'data'),'-l',path.join(owned,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${path.join(owned,'socket')}' -c unix_socket_permissions=0700 -c max_connections=12 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
 db=await session();const state=(await db.query("select current_setting('data_directory') d,inet_server_addr() ip")).rows[0];assert.equal(fs.realpathSync(state.d),fs.realpathSync(path.join(owned,'data')));assert.equal(state.ip,null);
 const baseline=await qualify({query:(sql,args)=>db.query(sql,args?.map(value=>Array.isArray(value)?JSON.stringify(value):value)),exec:sql=>db.query(sql)});
 const sourceInventory=async()=>(await db.query("select (select count(*)::int from public.google_sheets_source_rows) sources,(select count(*)::int from public.google_sheets_source_versions) versions,(select count(*)::int from public.google_sheets_fact_links) facts")).rows[0];
 const beforeSources=await sourceInventory(),actor=randomUUID();await db.query('insert into public.profiles values($1)',[actor]);
 const workspace=async()=>{const id=randomUUID(),entity=randomUUID();await db.query('insert into public.workspaces(id,subscription_required)values($1,false)',[id]);await db.query("insert into public.business_entities values($1,$2,'active','Recovery fixture')",[entity,id]);return{id,entity};};
 const fixtures=[];
 const record=async(group,status,minutes)=>{
  const connection=randomUUID(),approval=randomUUID(),run=randomUUID();
  await db.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name,automatic_refresh_enabled)values($1,$2,$3,$4,'connected','Recovery fixture',true)",[connection,group.id,group.entity,actor]);
  await db.query("insert into public.google_sheets_mapping_approvals(id,workspace_id,connection_id,approved_by,spreadsheet_id,sheet_id,header_row,headers,field_mapping)values($1,$2,$3,$4,'abcdefghijklmnopqrstuvwxyz123456',0,1,'[]','{}')",[approval,group.id,connection,actor]);
  await db.query("insert into public.google_sheets_sync_runs(id,workspace_id,connection_id,trigger_kind,approval_id,status,error_code,eligible_at,started_at,completed_at)values($1,$2,$3,'scheduled',$4,$5,case when $5='failed' then 'preserved_fixture' else null end,clock_timestamp()-interval '2 hours',clock_timestamp()-interval '2 hours',case when $5='failed' then clock_timestamp()-interval '1 hour' else null end)",[run,group.id,connection,approval,status]);
  await db.query("update public.google_sheets_connections set active_approval_id=$2,sync_lease_run_id=$3,sync_lease_expires_at=clock_timestamp()-($4||' minutes')::interval where id=$1",[connection,approval,run,minutes]);
  const result={workspace:group.id,connection,run};fixtures.push(result);return result;
 };
 const runState=async(fixture)=>(await db.query('select status,error_code from public.google_sheets_sync_runs where id=$1',[fixture.run])).rows[0];
 const mismatchWorkspace=await workspace(),mismatches=[];
 for(let i=0;i<101;i++)mismatches.push(await record(mismatchWorkspace,'failed',90));
 const mismatchIds=mismatches.map(item=>item.run);
 const historyHash=async()=>(await db.query("select encode(sha256(convert_to(jsonb_agg(to_jsonb(run) order by id)::text,'utf8')),'hex') hash from public.google_sheets_sync_runs run where id=any($1::uuid[])",[mismatchIds])).rows[0].hash;
 const originalHistory=await historyHash(),target=await record(await workspace(),'running',60);
 const negative=[await call(db),await call(db)];assert(negative.every(result=>result.recovered===0&&result.skipped===100));assert.equal((await runState(target)).status,'running');checks+=2;
 await db.query(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261005190709_sheets_recovery_fair_scan.sql'),'utf8'));
 const repaired=await call(db);assert.equal(repaired.recovered,1);assert.equal(repaired.historicalMismatches,101);assert.equal(repaired.remainingExpired,101);assert.equal(repaired.examined,1);assert.equal((await runState(target)).error_code,'lease_expired');assert.equal(await historyHash(),originalHistory);checks+=6;
 const lockWorkspace=await workspace(),locked=[];for(let i=0;i<101;i++)locked.push(await record(lockWorkspace,'running',45));
 const behindRows=await record(await workspace(),'running',30),rowLocker=await session();
 await rowLocker.query('begin');await rowLocker.query('select id from public.google_sheets_connections where id=any($1::uuid[])for update',[locked.map(item=>item.connection)]);
 const rowSkipStarted=Date.now(),rowSkipped=await call(db);const rowSkipMs=Date.now()-rowSkipStarted;
 assert.equal(rowSkipped.recovered,1);assert.equal(rowSkipped.examined,1);assert.equal((await runState(behindRows)).status,'failed');assert(rowSkipMs<1000);checks+=4;
 await rowLocker.query('rollback');
 const advisoryLocker=await session();await advisoryLocker.query('begin');await advisoryLocker.query("select pg_advisory_xact_lock(hashtextextended('google_sheets:'||$1,0))",[lockWorkspace.id]);
 // Start a fresh scan cycle to put all 101 advisory-blocked entries before the healthy one.
 await db.query('update private.google_sheets_recovery_scan_state set last_expiry=null,last_connection_id=null where singleton');
 const behindAdvisory=await record(await workspace(),'running',15),firstPage=await call(db),secondPage=await call(db);
 assert.equal(firstPage.examined,100);assert.equal(firstPage.recovered,0,'first bounded page contains only advisory-blocked tenants');assert.equal(secondPage.examined,100);assert.equal(secondPage.recovered,1);assert.equal((await runState(behindAdvisory)).status,'failed');checks+=5;
 await advisoryLocker.query('rollback');
 const peers=await Promise.all([session(),session()]);const overlap=await Promise.all(peers.map(client=>call(client)));
 assert(overlap.every(result=>result.examined<=100));checks++;
 let cleanup=await call(db),attempts=0;while(cleanup.remainingExpired>101&&attempts++<4)cleanup=await call(db);
 assert.equal(cleanup.remainingExpired,101);assert.equal(cleanup.historicalMismatches,101);assert.equal(await historyHash(),originalHistory);assert.deepEqual(await sourceInventory(),beforeSources);checks+=4;
 const terminal=(await db.query("select count(*)::int n from public.google_sheets_sync_runs where id=any($1::uuid[])and status='failed' and error_code='lease_expired'",[fixtures.filter(item=>!mismatchIds.includes(item.run)).map(item=>item.run)])).rows[0].n;
 assert.equal(terminal,104);checks++;
 await db.query("set role service_role;select set_config('request.jwt.claim.role','service_role',false)");
 await assert.rejects(db.query('select public.commit_google_sheets_sync_v1($1,$2,$3,$4,true)',[target.workspace,target.connection,target.run,'[]']),/fence_denied/);checks++;await db.query('reset role');
 for(const role of ['anon','authenticated']){await db.query(`set role ${role}`);await assert.rejects(db.query('select public.recover_google_sheets_syncs_v1(100)'),/permission denied/);await db.query('reset role');checks++;}
 const boundary=(await db.query("select not has_table_privilege('anon','private.google_sheets_recovery_scan_state','SELECT') and not has_table_privilege('authenticated','private.google_sheets_recovery_scan_state','UPDATE') and not has_table_privilege('service_role','private.google_sheets_recovery_scan_state','UPDATE') safe")).rows[0].safe;assert(boundary);checks++;
 console.log(JSON.stringify({passed:true,checks,baseline,negativeControl:{historicalMismatches:101,calls:negative,targetRemainedRunning:true},repaired,rowLockedOldest:101,rowSkipMs,rowSkipped,advisoryLockedOldest:101,firstPage,secondPage,overlap,terminalRuns:terminal,preservedHistoricalMismatches:101,sourceInventory:beforeSources,sourceInventoryPreserved:true,liveProviders:0,limitations:'Fresh Unix-socket-only native PostgreSQL with reduced fixture schema. Accelerated expiry and SQL lock holders; no elapsed kill recovery or active-user capacity qualification.'},null,2));
})().catch(error=>{console.error(JSON.stringify({failure:true,code:error.code,message:error.message,stack:error.code&&error.code!=='ERR_ASSERTION'?undefined:error.stack}));process.exitCode=1;}).finally(async()=>{await Promise.allSettled(clients.map(client=>client.end()));if(started)command('pg_ctl',['-D',path.join(owned,'data'),'-m','fast','-w','stop']);});
