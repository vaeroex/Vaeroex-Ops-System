/* eslint-disable @typescript-eslint/no-require-imports -- Owned native PostgreSQL due-selection and actual dispatcher regression. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process'),{randomUUID,createHash}=require('node:crypto');
const Module=require('node:module'),ts=require('typescript'),{Client}=require('pg');
const root=path.resolve(__dirname,'..'),bin=process.env.SHEETS_TEST_PG_BIN;
if(!bin||!path.isAbsolute(bin))throw Error('Set SHEETS_TEST_PG_BIN to the installed native PostgreSQL bin directory');
const schedulerFile=path.join(root,'lib/integrations/google-sheets/scheduler.ts'),source=fs.readFileSync(schedulerFile,'utf8');
const schedulerModule=new Module(schedulerFile,module);schedulerModule.filename=schedulerFile;schedulerModule.paths=module.paths;schedulerModule.require=name=>name==='server-only'?{}:require(name);
schedulerModule._compile(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,schedulerFile);
const {runDueSheetsRefreshes,SHEETS_SCHEDULER_MAX_ATTEMPTS}=schedulerModule.exports;
const migrationName='20261005202215_sheets_dispatch_round_robin.sql',migration=fs.readFileSync(path.join(root,'supabase/migrations',migrationName),'utf8');
const oldSql=fs.readFileSync(path.join(root,'supabase/migrations/20261005182541_bounded_google_sheets_dispatch.sql'),'utf8');
const oldStart=oldSql.indexOf('create function public.due_google_sheets_syncs_v1('),oldEnd=oldSql.indexOf('$function$;',oldStart)+12;
assert(oldStart>=0&&oldEnd>oldStart);assert.equal(SHEETS_SCHEDULER_MAX_ATTEMPTS,100);
let owned,db,writer,started=false,checks=0,writeQueue=Promise.resolve();
function command(name,args){const result=spawnSync(path.join(bin,name),args,{encoding:'utf8',timeout:30000,maxBuffer:1048576});if(result.status!==0)throw Error(`owned_${name}_failed:${result.stderr.slice(0,500)}`);}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
(async()=>{
 owned=fs.mkdtempSync('/tmp/vaeroex-sheets-fairness-native-');fs.chmodSync(owned,0o700);fs.mkdirSync(path.join(owned,'socket'),{mode:0o700});
 command('initdb',['-D',path.join(owned,'data'),'--username=postgres','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale']);
 command('pg_ctl',['-D',path.join(owned,'data'),'-l',path.join(owned,'postgres.log'),'-o',`-c listen_addresses='' -c unix_socket_directories='${path.join(owned,'socket')}' -c unix_socket_permissions=0700 -c max_connections=8 -c shared_buffers=16MB -c log_statement=none -c log_min_error_statement=panic`,'-w','start']);started=true;
 db=new Client({host:path.join(owned,'socket'),port:5432,user:'postgres',database:'postgres',statement_timeout:15000});await db.connect();
 const identity=(await db.query("select current_setting('data_directory') d,inet_server_addr() ip")).rows[0];assert.equal(fs.realpathSync(identity.d),fs.realpathSync(path.join(owned,'data')));assert.equal(identity.ip,null);
 // Reduced synthetic table intentionally qualifies selection only; full claim,
 // authority, source writes and stale-worker protocols have separate tests.
 await db.query("create schema auth;create role anon;create role authenticated;create role service_role;grant usage on schema public,auth to anon,authenticated,service_role;create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;create table public.google_sheets_connections(id uuid primary key,workspace_id uuid not null,status text not null,automatic_refresh_enabled boolean not null,active_approval_id uuid,next_sync_at timestamptz,sync_lease_expires_at timestamptz);alter table public.google_sheets_connections enable row level security;");
 await db.query(oldSql.slice(oldStart,oldEnd));
 const tick=new Date(),busyDue=new Date(+tick-3600000).toISOString(),quietDue=new Date(+tick-60000).toISOString(),future=new Date(+tick+3600000).toISOString();
 const fixtures=[],workspaceIds=Array.from({length:100},()=>randomUUID());
 for(let w=0;w<100;w++)for(let n=0;n<(w<10?10:1);n++)fixtures.push({id:randomUUID(),workspace_id:workspaceIds[w],status:'connected',automatic_refresh_enabled:true,active_approval_id:randomUUID(),next_sync_at:w<10?busyDue:quietDue,sync_lease_expires_at:null});
 const excluded=[{status:'disconnected'},{automatic_refresh_enabled:false},{active_approval_id:null},{next_sync_at:future},{sync_lease_expires_at:future}].map(overrides=>({...fixtures[0],id:randomUUID(),workspace_id:randomUUID(),...overrides}));
 await db.query('insert into public.google_sheets_connections select * from jsonb_populate_recordset(null::public.google_sheets_connections,$1::jsonb)',[JSON.stringify([...fixtures,...excluded])]);
 const due=async(ids,limit=10)=>{await db.query("set role service_role;select set_config('request.jwt.claim.role','service_role',false)");try{return(await db.query('select * from public.due_google_sheets_syncs_v1($1,$2,$3)',[tick,limit,ids])).rows;}finally{await db.query('reset role');}};
 const seen=[];let oldWorkspaces=new Set();
 for(let page=0;page<5;page++){const rows=await due(seen);assert.equal(rows.length,10);for(const r of rows){seen.push(r.id);oldWorkspaces.add(r.workspace_id);}await db.query('update public.google_sheets_connections set next_sync_at=$1 where id=any($2::uuid[])',[future,rows.map(r=>r.id)]);}
 assert.equal(oldWorkspaces.size,10,'negative fixture must reproduce busy-tenant starvation across old due pages');checks++;
 await assert.rejects(due([...seen,randomUUID()]),/dispatch_invalid/);checks++;
 await db.query('update public.google_sheets_connections c set next_sync_at=f.next_sync_at from jsonb_to_recordset($1::jsonb) f(id uuid,next_sync_at timestamptz) where c.id=f.id',[JSON.stringify(fixtures)]);
 const rowsHash=async()=>hash(JSON.stringify((await db.query('select * from public.google_sheets_connections order by id')).rows));
 const beforeMigration=await rowsHash();await db.query(migration);assert.equal(await rowsHash(),beforeMigration,'migration must preserve all existing rows');checks++;
 for(const role of ['anon','authenticated']){await db.query(`set role ${role};select set_config('request.jwt.claim.role','${role}',false)`);await assert.rejects(db.query('select * from public.due_google_sheets_syncs_v1($1,10,$2)',[tick,[]]),e=>e.code==='42501');await db.query('reset role');checks++;}
 await db.query("set role service_role;select set_config('request.jwt.claim.role','authenticated',false)");await assert.rejects(db.query('select * from public.due_google_sheets_syncs_v1($1,10,$2)',[tick,[]]),/service_denied/);await db.query('reset role');checks++;
 writer=new Client({host:path.join(owned,'socket'),port:5432,user:'postgres',database:'postgres',statement_timeout:15000});await writer.connect();
 const complete=connectionId=>{const update=writeQueue.then(()=>writer.query('update public.google_sheets_connections set next_sync_at=$1 where id=$2',[future,connectionId]));writeQueue=update.catch(()=>{});return update;};
 const selected=[],active=new Set();let peakActive=0,dueQueries=0;
 const start=Date.now();const result=await runDueSheetsRefreshes({due:async(_tick,limit,_deadline,ids)=>{dueQueries++;assert(limit<=10);assert(ids.length<=100);return due(ids,limit);},sync:async connection=>{
   assert(!active.has(connection.workspace_id),'per-tenant concurrency exceeded');active.add(connection.workspace_id);peakActive=Math.max(peakActive,active.size);assert(peakActive<=4);
   try{const expected=fixtures.find(f=>f.id===connection.id);assert(expected,'ineligible connection dispatched');selected.push(connection);assert.equal(new Date(connection.next_sync_at).toISOString(),expected.next_sync_at,'original eligibility changed');
     await new Promise(resolve=>setTimeout(resolve,connection.workspace_id===workspaceIds[0]?100:1));
     await complete(connection.id);
   }finally{active.delete(connection.workspace_id);}
 },backoff:async()=>{throw Error('unexpected_backoff');}});
 assert.equal(result.attempted,100);assert.equal(result.succeeded,100);assert.equal(result.failed,0);assert.equal(dueQueries,10);assert.equal(new Set(selected.map(r=>r.id)).size,100);assert.equal(new Set(selected.map(r=>r.workspace_id)).size,100);assert.equal(active.size,0);assert.equal(peakActive,4);checks+=8;
 const allSeen=selected.map(r=>r.id);assert.equal((await due(allSeen)).length,10);checks++;
 await assert.rejects(due([...allSeen,randomUUID()]),/dispatch_invalid/);await assert.rejects(due([],11),/dispatch_invalid/);checks+=2;
 assert.equal((await db.query('select count(*)::int n from public.google_sheets_connections where id=any($1::uuid[]) and next_sync_at<=$2',[fixtures.map(f=>f.id),tick])).rows[0].n,90);checks++;
 assert.deepEqual((await db.query('select * from public.google_sheets_connections where id=any($1::uuid[]) order by id',[excluded.map(f=>f.id)])).rows.map(r=>({...r,next_sync_at:r.next_sync_at?.toISOString()??null,sync_lease_expires_at:r.sync_lease_expires_at?.toISOString()??null})),excluded.sort((a,b)=>a.id.localeCompare(b.id)));checks++;
 console.log(JSON.stringify({suite:'google_sheets_dispatch_fairness_native',checks,passed:true,migration:migrationName,migrationSha256:hash(migration),schedulerSha256:hash(source),syntheticWorkspaces:100,eligibleConnections:190,ineligibleConnections:5,oldSql:{attempts:50,workspacesServed:oldWorkspaces.size,maxExcluded:50},corrected:{...result,dueQueries,workspacesServed:100,remainingDue:90,peakActive,elapsedMs:Date.now()-start},historyPreservedByMigration:true,originalEligibilityPreserved:true,advancedConnectionsRetainTenantOrder:true,liveProviderCalls:0,limits:'Owned Unix-only native PostgreSQL reduced selection schema and actual scheduler. Synthetic completion updates next eligibility only. No provider, import, HTTP, throughput, elapsed worker-recovery, or active-user capacity claim.'},null,2));
})().catch(error=>{console.error(JSON.stringify({failure:true,code:error.code,message:error.message,stack:error.code?undefined:error.stack}));process.exitCode=1;}).finally(async()=>{if(db)await db.end();if(writer)await writer.end();if(started)command('pg_ctl',['-D',path.join(owned,'data'),'-m','fast','-w','stop']);});
