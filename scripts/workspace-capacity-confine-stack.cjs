/* eslint-disable @typescript-eslint/no-require-imports -- Owned native local-stack confinement only; raw CLI output is secret. */
// Default is an identity-only inspection. --execute stops/resumes this one owned
// native stack under the existing OS profile, preserving its data and migrations.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto'),{spawn}=require('node:child_process');
const {Client}=require('pg');
const {envFor,parseStatus,VERSION,INSPECTED_DARWIN_ARM64_SHA256}=require('./workspace-closeout-local-stack.cjs');
const {profile:requiredProfile}=require('./workspace-capacity-environment.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const privateJson=file=>{assert.equal(fs.statSync(file).mode&0o077,0,'private_file_required');return JSON.parse(fs.readFileSync(file,'utf8'));};
function validate(configFile,runtimeFile){
 const config=privateJson(configFile),runtime=privateJson(runtimeFile);assert.equal(config.mode,'disposable-native-local');assert.equal(runtime.syntheticOnly,true);assert.equal(runtime.paidCredentialsPresent,false);
 assert.equal(fs.realpathSync(runtime.configFile),fs.realpathSync(configFile),'runtime_configuration_mismatch');
 const assembly=privateJson(config.assemblyManifest);assert.equal(assembly.schema,'vaeroex_native_stack_assembly_v1');assert.equal(assembly.status,'ready');assert.equal(assembly.executed,true);
 const output=fs.realpathSync(assembly.output),home=fs.realpathSync(assembly.home),project=fs.realpathSync(assembly.project);
 assert.equal(path.dirname(output),fs.realpathSync('/tmp'),'owned_temporary_stack_required');assert(/^vaeroex-closeout-assembly-[a-z0-9-]+$/.test(path.basename(output)));
 assert.equal(home,path.join(output,'home'));assert.equal(project,path.join(output,'project'));assert.equal(fs.realpathSync(config.ownedSupabaseHome),home);assert.equal(fs.realpathSync(config.ownedProjectRoot),project);
 assert.equal(assembly.home,home);assert.equal(assembly.project,project);assert.equal(assembly.stackId,config.stackId);assert(!fs.existsSync(path.join(project,'supabase/.temp/project-ref')),'linked_project_forbidden');
 const runtimeOutput=fs.realpathSync(runtime.out);assert.equal(path.dirname(runtimeOutput),fs.realpathSync('/tmp'));assert(/^vaeroex-capacity-[a-z0-9-]+$/.test(path.basename(runtimeOutput)));
 assert.equal(fs.realpathSync(path.dirname(runtime.profileFile)),runtimeOutput);assert.equal(fs.readFileSync(runtime.profileFile,'utf8'),requiredProfile,'exact_local_only_profile_required');
 assert.equal(assembly.cliVersion,VERSION);assert.equal(assembly.cliSha256,INSPECTED_DARWIN_ARM64_SHA256);assert.equal(sha(fs.readFileSync(assembly.cli)),assembly.cliSha256,'cli_checksum_mismatch');
 const start=['start','--workdir',project,'--runtime','native','--eager','--exclude','realtime,functions,studio,mail,analytics,pooler','--output-format','json'];assert.deepEqual(assembly.commands[1],start,'native_start_contract_changed');
 return{config,runtime,assembly,start,profileSha256:sha(requiredProfile)};
}
function command(ctx,exe,args,timeoutMs=30000){return new Promise((resolve,reject)=>{
 const child=spawn(exe,args,{cwd:ctx.assembly.project,env:envFor(ctx.assembly),stdio:['ignore','pipe','pipe']});let stdout='',size=0,reason=null,hardKill;
 const terminate=code=>{if(reason)return;reason=code;child.kill('SIGTERM');hardKill=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},5000);};const timer=setTimeout(()=>terminate('owned_cli_timeout'),timeoutMs);
 for(const stream of[child.stdout,child.stderr])stream.on('data',b=>{size+=b.length;if(size>8*1024*1024)terminate('owned_cli_output_limit');else if(stream===child.stdout)stdout+=b;});
 child.on('error',()=>{clearTimeout(timer);clearTimeout(hardKill);reject(Error('owned_cli_spawn_failed'));});child.on('exit',code=>{clearTimeout(timer);clearTimeout(hardKill);if(reason||code!==0)reject(Error(reason||'owned_cli_command_failed'));else resolve(stdout);});
});}
async function inspectStatus(ctx){
 assert.equal((await command(ctx,ctx.assembly.cli,['--version'])).trim(),VERSION,'cli_version_mismatch');
 const status=parseStatus(await command(ctx,ctx.assembly.cli,['status','--workdir',ctx.assembly.project,'--output-format','json']),ctx.assembly.project);
 for(const field of['stackId','apiUrl','dbUrl','anonKey','serviceKey'])assert.equal(status[field],ctx.config[field],'owned_stack_identity_mismatch');
 return{sameIdentity:true,stackId:status.stackId};
}
async function openOwnedDatabase(ctx){
 const u=new URL(ctx.config.dbUrl);assert(['127.0.0.1','[::1]'].includes(u.hostname)&&u.pathname==='/postgres','owned_loopback_database_required');
 const db=new Client({connectionString:ctx.config.dbUrl,ssl:false,connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:31000});await db.connect();
 try{const row=(await db.query("select current_database() db,current_setting('data_directory') directory,inet_server_addr() ip")).rows[0];assert.equal(row.db,'postgres');assert(row.ip===null||['127.0.0.1','::1'].includes(row.ip));const directory=fs.realpathSync(row.directory);assert(directory.startsWith(fs.realpathSync(ctx.config.ownedSupabaseHome)+'/stacks/'),'owned_database_directory_required');return{db,directory};}catch(error){await db.end();throw error;}
}
async function inventory(ctx){
 const{db,directory}=await openOwnedDatabase(ctx);try{
  await db.query('begin isolation level repeatable read read only');
  const tables=(await db.query("select n.nspname schema,c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private','auth','storage','supabase_migrations') and c.relkind in('r','p') and not c.relispartition order by 1,2")).rows;
  const quote=s=>'"'+s.replaceAll('"','""')+'"',rows=[];
  // Two commutative 64-bit row fingerprints bound memory independently of row
  // count; counts and both sums detect unintended changes without returning data.
  for(const t of tables){const value=(await db.query('select count(*)::text count,coalesce(sum(hashtextextended(to_jsonb(t)::text,0)::numeric),0)::text sum0,coalesce(sum(hashtextextended(to_jsonb(t)::text,1)::numeric),0)::text sum1 from '+quote(t.schema)+'.'+quote(t.name)+' t')).rows[0];rows.push({schema:t.schema,table:t.name,...value});}
  await db.query('commit');return{directory,tables:rows,digest:sha(JSON.stringify(rows)),scope:'Persistent public/private/Auth/Storage/migration table counts and two commutative row fingerprints; no row contents or credentials exported.'};
 }finally{await db.end();}
}
async function confine(configFile,runtimeFile,{execute=false}={}){
 const ctx=validate(configFile,runtimeFile);await inspectStatus(ctx);const owned=await openOwnedDatabase(ctx);await owned.db.end();
 if(!execute)return{inspected:true,executed:false,sameIdentity:true,ownedDatabaseVerified:true,profileSha256:ctx.profileSha256,plannedResult:path.join(ctx.runtime.out,'network-stack.json'),commandPurpose:'Stop/resume only the identified existing native stack under the local-only OS profile; no reset, migration, seed or deletion.'};
 const before=await inventory(ctx),events=[];const record=(stage)=>events.push({stage,at:new Date().toISOString()});record('identity_and_inventory_verified');
 try{
  await command(ctx,ctx.assembly.cli,['stop','--workdir',ctx.assembly.project],120000);record('owned_stack_stopped_preserving_data');
  await command(ctx,'/usr/bin/sandbox-exec',['-f',ctx.runtime.profileFile,ctx.assembly.cli,...ctx.start],180000);record('native_services_started_under_profile');await inspectStatus(ctx);
  const after=await inventory(ctx);assert.equal(after.directory,before.directory,'owned_data_directory_changed');assert.deepEqual(after.tables,before.tables,'database_records_changed_during_restart');
  const result={runId:ctx.runtime.runId,startedAt:events.find(e=>e.stage==='native_services_started_under_profile').at,verifiedAt:new Date().toISOString(),ownedProject:ctx.assembly.project,ownedSupabaseHome:ctx.assembly.home,stackId:ctx.config.stackId,profileSha256:ctx.profileSha256,allNativeServicesLaunchedUnderInheritedSeatbelt:true,sameIdentity:true,databaseDirectoryPreserved:true,databaseInventoryPreserved:true,databaseInventorySha256:after.digest,inventoryScope:after.scope,tableCount:after.tables.length,productionTouched:false,appliedMigrations:false,events,limitations:['Database rows verified with counts and paired commutative fingerprints. Storage object bytes are independently verified by the capacity inventory, not by this restart command.']};
  const target=path.join(ctx.runtime.out,'network-stack.json');if(fs.existsSync(target))fs.renameSync(target,path.join(ctx.runtime.out,'network-stack.previous-'+randomUUID()+'.json'));fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n',{mode:0o600,flag:'wx'});return{ownedNativeServicesConfined:true,sameIdentity:true,databaseInventoryPreserved:true,evidence:target};
 }catch(error){fs.writeFileSync(path.join(ctx.runtime.out,'network-stack-failure-'+randomUUID()+'.json'),JSON.stringify({runId:ctx.runtime.runId,at:new Date().toISOString(),events,reason:/^[a-z_]+$/.test(error.message)?error.message:'confinement_verification_failed',preserveOwnedData:true,automaticUnconfinedRestart:false})+'\n',{mode:0o600,flag:'wx'});throw error;}
}
module.exports={validate,inspectStatus,openOwnedDatabase,inventory,confine};
if(require.main===module)(async()=>{const[configFile,runtimeFile,...options]=process.argv.slice(2);assert(configFile&&runtimeFile&&options.length<=1&&options.every(x=>x==='--execute'),'usage_config_runtime_optional_execute');console.log(JSON.stringify(await confine(configFile,runtimeFile,{execute:options.includes('--execute')})));})().catch(error=>{console.error(JSON.stringify({confinementFailed:true,reason:/^[a-z_]+$/.test(error.message)?error.message:'owned_stack_guard_failed'}));process.exitCode=1;});
