/* eslint-disable @typescript-eslint/no-require-imports -- Owned native PostgreSQL protocol regression. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const bin=process.env.SHEETS_TEST_PG_BIN;
const Module=require('node:module'),ts=require('typescript');
const schedulerFile=path.resolve(__dirname,'../lib/integrations/google-sheets/scheduler.ts'),schedulerModule=new Module(schedulerFile,module);
schedulerModule.filename=schedulerFile;schedulerModule.paths=module.paths;schedulerModule.require=name=>name==='server-only'?{}:require(name);
schedulerModule._compile(ts.transpileModule(fs.readFileSync(schedulerFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,schedulerFile);
const {createSheetsScheduledAdmission}=schedulerModule.exports;
if(!bin||!path.isAbsolute(bin))throw Error('Set SHEETS_TEST_PG_BIN to the installed native PostgreSQL bin directory');
const {Client}=require('pg'),{qualify}=require('./google-sheets-data-tests.cjs');
let owned,db,started=false;const clients=[];let checks=0;
function command(name,args){const result=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:30000,maxBuffer:1048576});if(result.status!==0)throw Error(`owned_${name}_failed:${result.stderr.slice(0,500)}`);}
async function session(){const client=new Client({host:path.join(owned,'socket'),port:5432,user:'postgres',database:'postgres',statement_timeout:15000});await client.connect();clients.push(client);return client;}
const call=async(client,name,args)=>{await client.query("set role service_role;select set_config('request.jwt.claim.role','service_role',false)");try{return(await client.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result;}finally{await client.query("reset role;select set_config('request.jwt.claim.role','service_role',false)");}};
(async()=>{
 owned=fs.mkdtempSync('/tmp/vaeroex-sheets-dispatch-native-');fs.chmodSync(owned,0o700);fs.mkdirSync(path.join(owned,'socket'),{mode:0o700});
 command('initdb',['-D',path.join(owned,'data'),'--username=postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
 command('pg_ctl',['-D',path.join(owned,'data'),'-l',path.join(owned,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${path.join(owned,'socket')}' -c unix_socket_permissions=0700 -c max_connections=16 -c shared_buffers=32MB -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
 db=await session();const state=(await db.query("select current_setting('data_directory') d,inet_server_addr() ip")).rows[0];assert.equal(fs.realpathSync(state.d),fs.realpathSync(path.join(owned,'data')));assert.equal(state.ip,null);
 const baseline=await qualify({query:(sql,args)=>db.query(sql,args?.map(value=>Array.isArray(value)?JSON.stringify(value):value)),exec:sql=>db.query(sql)});
 assert.equal((await db.query('select count(*)::int n from public.google_sheets_connections where sync_lease_expires_at>clock_timestamp()')).rows[0].n,0);
 const actor=randomUUID(),actorSession=randomUUID(),headers=['Record ID','Date','Orders'],mapping={rowKeyColumn:0,dateColumn:1,dateFormat:'iso',locationColumn:null,metrics:[{column:2,name:'Dispatch orders',category:'Operations',unit:'count',target:100}]};
 await db.query('insert into public.profiles values($1)',[actor]);await db.query('insert into auth.users(id)values($1)',[actor]);await db.query("insert into auth.sessions values($1,$2,now()+interval '1 day')",[actorSession,actor]);
 const fixtures=[];
 for(let i=0;i<8;i++){
  const workspace=randomUUID(),entity=randomUUID(),connection=randomUUID();fixtures.push({workspace,entity,connection});
  await db.query("insert into public.workspaces(id,subscription_required)values($1,false)",[workspace]);
  await db.query("insert into public.workspace_members values($1,$2,'owner','active')",[workspace,actor]);
  await db.query("insert into public.business_entities values($1,$2,'active','Dispatch fixture')",[entity,workspace]);
  await db.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name,spreadsheet_id,sheet_id,sheet_title,headers) values($1,$2,$3,$4,'connected','Dispatch fixture','abcdefghijklmnopqrstuvwxyz123456',0,'Metrics',$5)",[connection,workspace,entity,actor,JSON.stringify(headers)]);
  await call(db,'approve_google_sheets_mapping_v1',[workspace,connection,actor,actorSession,JSON.stringify(mapping),true]);
 }
 const connections=await Promise.all(fixtures.map(()=>session()));
 const results=await Promise.all(fixtures.map(async(f,i)=>{try{return{...f,accepted:true,...await call(connections[i],'claim_google_sheets_sync_v1',[f.workspace,f.connection,actor,actorSession,'manual'])};}catch(error){return{...f,accepted:false,error:error.message};}}));
 const accepted=results.filter(x=>x.accepted);assert.equal(accepted.length,4);assert(results.filter(x=>!x.accepted).every(x=>x.error.includes('capacity_busy')));checks+=2;
 assert.equal((await db.query('select count(*)::int n from public.google_sheets_connections where sync_lease_expires_at>clock_timestamp()')).rows[0].n,4);checks++;
 const f=accepted[0],otherConnection=randomUUID();
 await db.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name,spreadsheet_id,sheet_id,sheet_title,headers)values($1,$2,$3,$4,'connected','Same workspace fixture','abcdefghijklmnopqrstuvwxyz123456',0,'Metrics',$5)",[otherConnection,f.workspace,f.entity,actor,JSON.stringify(headers)]);
 await call(db,'approve_google_sheets_mapping_v1',[f.workspace,otherConnection,actor,actorSession,JSON.stringify(mapping),true]);
 await assert.rejects(call(db,'claim_google_sheets_sync_v1',[f.workspace,otherConnection,actor,actorSession,'manual']),/workspace_busy/);checks++;
 // A due connection behind another active connection in its own workspace
 // remains visible; the fair admission coordinator can wait without hiding it.
 const visible=(await db.query("select * from public.due_google_sheets_syncs_v1(clock_timestamp(),10,'{}')")).rows;
 assert(visible.some(row=>row.id===otherConnection));checks++;
 const target=results.find(item=>!item.accepted),releaseClient=await session(),claimClient=await session();
 const overlapStarted=Date.now(),admission=createSheetsScheduledAdmission(overlapStarted+30000);
 const releaseManuals=(async()=>{await new Promise(resolve=>setTimeout(resolve,5000));for(const item of accepted)await call(releaseClient,'fail_google_sheets_sync_v1',[item.workspace,item.connection,item.runId,'manual_fixture_completed']);})();
 const admitted=await admission.run(()=>call(claimClient,'claim_google_sheets_sync_v1',[target.workspace,target.connection,null,null,'scheduled']));
 const scheduledAdmissionDelayMs=Date.now()-overlapStarted;await releaseManuals;
 assert(scheduledAdmissionDelayMs>=5000&&scheduledAdmissionDelayMs<=30000);assert(admission.metrics().admissionRpcAttempts>=6);checks+=2;
 await call(db,'fail_google_sheets_sync_v1',[target.workspace,target.connection,admitted.runId,'fixture_cleanup']);
 // Re-establish four distinct accepted runs for the independent stale-worker
 // protocol tests below. Prior run history remains terminal and unchanged.
 for(const item of accepted)item.runId=(await call(db,'claim_google_sheets_sync_v1',[item.workspace,item.connection,actor,actorSession,'manual'])).runId;
 for(const item of accepted)await db.query("update public.google_sheets_connections set sync_lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[item.connection]);
 const locker=await session();await locker.query('begin');await locker.query("select pg_advisory_xact_lock(hashtextextended('google_sheets:'||$1,0))",[f.workspace]);
 const recovery=await call(db,'recover_google_sheets_syncs_v1',[100]);assert.equal(recovery.recovered,3);assert.equal(recovery.skipped,1);assert.equal(recovery.remainingExpired,1);checks+=3;
 await locker.query('rollback');const finalRecovery=await call(db,'recover_google_sheets_syncs_v1',[100]);assert.equal(finalRecovery.recovered,1);assert.equal(finalRecovery.remainingExpired,0);checks+=2;
 for(const item of accepted){await assert.rejects(call(db,'commit_google_sheets_sync_v1',[item.workspace,item.connection,item.runId,'[]',true]),/fence_denied/);checks++;}
 const replacement=await call(db,'claim_google_sheets_sync_v1',[f.workspace,f.connection,actor,actorSession,'manual']);
 await call(db,'fail_google_sheets_sync_v1',[f.workspace,f.connection,f.runId,'late_failure']);
 assert.equal((await db.query('select sync_lease_run_id from public.google_sheets_connections where id=$1',[f.connection])).rows[0].sync_lease_run_id,replacement.runId);checks++;
 await assert.rejects(call(db,'commit_google_sheets_sync_v1',[f.workspace,f.connection,f.runId,'[]',true]),/fence_denied/);checks++;
 await call(db,'fail_google_sheets_sync_v1',[f.workspace,f.connection,replacement.runId,'fixture_cleanup']);
 // A contradictory historical lease must be held, not rewritten into failure.
 await db.query("update public.google_sheets_connections set sync_lease_run_id=$2,sync_lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[f.connection,replacement.runId]);
 const held=await call(db,'recover_google_sheets_syncs_v1',[100]);assert.equal(held.recovered,0);assert.equal(held.skipped,1);assert.equal(held.remainingExpired,1);checks+=3;
 assert.equal((await db.query('select error_code from public.google_sheets_sync_runs where id=$1',[replacement.runId])).rows[0].error_code,'fixture_cleanup');checks++;
 await db.query('update public.google_sheets_connections set sync_lease_run_id=null,sync_lease_expires_at=null where id=$1',[f.connection]);
 // Several due connections in one tenant cannot occupy the first due page.
 for(let i=0;i<5;i++){const extra=randomUUID();await db.query("insert into public.google_sheets_connections(id,workspace_id,business_entity_id,created_by,status,display_name,spreadsheet_id,sheet_id,sheet_title,headers)values($1,$2,$3,$4,'connected','Fair due fixture','abcdefghijklmnopqrstuvwxyz123456',0,'Metrics',$5)",[extra,f.workspace,f.entity,actor,JSON.stringify(headers)]);await call(db,'approve_google_sheets_mapping_v1',[f.workspace,extra,actor,actorSession,JSON.stringify(mapping),true]);}
 await db.query("update public.google_sheets_connections set next_sync_at=clock_timestamp()-interval '10 seconds' where workspace_id=any($1::uuid[])",[fixtures.map(x=>x.workspace)]);
 await db.query("set role service_role;select set_config('request.jwt.claim.role','service_role',false)");
 const due=(await db.query("select * from public.due_google_sheets_syncs_v1(clock_timestamp(),8,'{}')")).rows;
 await db.query('reset role');assert.equal(due.length,8);assert.equal(new Set(due.map(x=>x.workspace_id)).size,8);checks+=2;
 const work=(await db.query("select status,count(*)::int n from public.google_sheets_sync_runs where workspace_id=any($1::uuid[])group by status",[fixtures.map(x=>x.workspace)])).rows;
 assert.deepEqual(work,[{status:'failed',n:10}]);checks++;
 console.log(JSON.stringify({suite:'google_sheets_dispatch_native',checks,baseline,scheduledAdmissionDelayMs,admissionTelemetry:admission.metrics(),concurrentClaimers:8,accepted:4,capacityDenied:4,workspaceDenied:1,recoveredAccepted:4,staleCommitsDenied:5,historicalMismatchPreserved:true,healthyRecoveryContinuesPastLockedTenant:true,originalEligibilityPreserved:true,liveProviderCalls:0,workerKill:false,recoveryClockAccelerated:true,limits:'Owned native SQL protocol proof with reduced fixture schema. No elapsed worker recovery or active-user capacity claim.'},null,2));
})().catch(error=>{console.error(JSON.stringify({failure:true,code:error.code,message:error.message,stack:error.code?undefined:error.stack}));process.exitCode=1;}).finally(async()=>{await Promise.allSettled(clients.map(client=>client.end()));if(started)command('pg_ctl',['-D',path.join(owned,'data'),'-m','fast','-w','stop']);});
