/* eslint-disable @typescript-eslint/no-require-imports -- Isolated QBO pool/deadline qualification. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {fork}=require('node:child_process'),{randomUUID}=require('node:crypto'),{performance}=require('node:perf_hooks');
const {Client,Pool}=require('pg'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
const roles=['integration_provider_runtime_authority','integration_provider_source_authority'];
function load(configuration,PoolClass=Pool){
 const file=path.join(root,'services/external-integrations-qbo/src/database.ts');
 const context={exports:{},setTimeout,clearTimeout,process,require:name=>{
  if(name==='server-only')return {};if(name==='pg')return {Pool:PoolClass};
  if(name==='./database-config')return {qboDatabaseConfiguration:()=>configuration};throw Error('unexpected_import');}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
 return context.exports.QboProductionDatabase;
}
function loadBudget(){const context={exports:{},performance,require:name=>{assert.equal(name,'server-only');return {};}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'services/external-integrations-qbo/src/execution-budget.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);return context.exports;}
async function offline(){
 const {createQboExecutionBudget,QBO_TASK_LEASE_SECONDS}=loadBudget();let now=0;const budget=createQboExecutionBudget(()=>now);
 assert.equal(QBO_TASK_LEASE_SECONDS,270);assert.equal(budget.remainingMilliseconds(),240000);now=239990;assert.equal(budget.timeout(30000),10);
 now=240000;assert.throws(()=>budget.remainingMilliseconds(),/budget_exhausted/);assert.equal(budget.workExhausted(),true);
 assert.equal(budget.beginCleanup(),15000);now=254999;assert.equal(budget.remainingMilliseconds(),1);now=255000;assert.throws(()=>budget.remainingMilliseconds(),/budget_exhausted/);
 const clients=[],operations=[];let instances=0;let failRollback=false;
 class TestPool{constructor(){instances++;this.totalCount=1;this.idleCount=1;this.waitingCount=0;}on(){}async connect(){const client={release:destroy=>operations.push(['release',destroy]),query:async(sql)=>{const text=typeof sql==='string'?sql:sql.text;operations.push(text);if(text.startsWith('select public.'))throw Object.assign(Error('private_query_failure'),{code:'40001'});if(text==='rollback'&&failRollback)throw Error('private_rollback_failure');return {rows:[]};}};clients.push(client);return client;}async end(){operations.push('end');}}
 const Database=load({max:4},TestPool),db=new Database('synthetic',roles,'synthetic');
 const handles=Array.from({length:40},()=>db.request());assert.equal(instances,1);
 await handles[0].close();assert(!operations.includes('end'));assert.throws(()=>handles[0].role(roles[0]),/session_closed/);
 assert.throws(()=>handles[1].role('integration_oauth_ingress_authority'),/identifier_denied/);
 const retained=handles[1].role(roles[1]);await handles[1].close();assert.throws(()=>retained.rpc('probe',{p:1}),/session_closed/);
 let result=await handles[2].role(roles[0]).rpc('probe',{p:1});assert.equal(result.error.code,'40001');assert.deepEqual(operations.slice(-2),['rollback',['release',false]]);
 failRollback=true;result=await handles[3].role(roles[1]).rpc('probe',{p:1});assert.equal(result.error.code,'40001');assert.deepEqual(operations.slice(-2),['rollback',['release',true]]);
 assert(!JSON.stringify(result).includes('private'));await Promise.all(handles.map(h=>h.close()));assert(!operations.includes('end'));await db.close();assert.equal(operations.filter(x=>x==='end').length,1);await db.close();assert.equal(operations.filter(x=>x==='end').length,1);
 // An expired waiter must release its late socket without ever executing SQL.
 let grant;const late=[];class WaitingPool{connect(){return new Promise(resolve=>{grant=resolve;});}async end(){}}
 const Waiting=load({max:4},WaitingPool),waiting=new Waiting('synthetic',roles,'synthetic');
 await assert.rejects(waiting.request(()=>5).role(roles[0]).rpc('probe',{p:1}),/acquisition_budget_exhausted/);
 grant({query:async()=>{late.push('sql');return {rows:[]};},release:()=>late.push('release')});await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(late,['release']);await waiting.close();
 return {passed:true,scope:'offline pool ownership, role denial, rollback destruction, monotonic budget, late-acquisition cancellation',requestHandles:40,poolInstances:instances};
}
function privateConfiguration(file){assert(path.isAbsolute(file));const stat=fs.statSync(file);assert.equal(stat.mode&0o077,0);const value=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.equal(value.mode,'disposable-native-local');const u=new URL(value.dbUrl);assert(['127.0.0.1','[::1]'].includes(u.hostname));assert.equal(u.pathname,'/postgres');assert(value.ownedSupabaseHome&&value.ownedProjectRoot);return value;}
async function worker(file,databaseName,index){const config=privateConfiguration(file),url=new URL(config.dbUrl);assert(/^vxa_budget_[a-f0-9]{16}$/.test(databaseName));url.pathname='/'+databaseName;url.username='supabase_admin';
 const app='vxa-budget-'+index,Database=load({connectionString:url.toString(),ssl:false,max:4,connectionTimeoutMillis:10000,idleTimeoutMillis:10000,application_name:app});
 const db=new Database('synthetic',roles,'synthetic');let maxTotal=0,maxWaiting=0,success=0,failed=0;const latency=[];
 const timer=setInterval(()=>{const s=db.statistics();maxTotal=Math.max(maxTotal,s.total);maxWaiting=Math.max(maxWaiting,s.waiting);},2);
 try {
  await new Promise(resolve=>process.once('message',resolve));
  await Promise.all(Array.from({length:40},async(_,i)=>{const session=db.request(),role=roles[i%2],start=performance.now();try{
   const result=await session.role(role).rpc('qbo_budget_probe',{p_delay_ms:25,p_label:index+'-'+i,p_fail:i%5===0});
   latency.push(performance.now()-start);if(i%5===0){assert.equal(result.error.code,'P0001');failed++;}else{assert.equal(result.error,null);assert.equal(result.data.role,role);success++;}
  }finally{await session.close();}}));
  // Replay accepted labels through the actual transaction path, preserving identity.
  for(let i=0;i<40;i++)if(i%5!==0){const s=db.request();const result=await s.role(roles[i%2]).rpc('qbo_budget_probe',{p_delay_ms:0,p_label:index+'-'+i,p_fail:false});assert.equal(result.error,null);await s.close();}
  const before=performance.now(),deadline=before+100,s=db.request(()=>{const left=deadline-performance.now();if(left<1)throw Error('budget_expired');return left;});
  const cancelled=await s.role(roles[0]).rpc('qbo_budget_probe',{p_delay_ms:1500,p_label:index+'-cancelled',p_fail:false});await s.close();assert(['57014','unknown'].includes(cancelled.error?.code),'only_execution_timeout_is_expected');const cancelledInMs=performance.now()-before;assert(cancelledInMs>=80&&cancelledInMs<1000,'actual_SQL_must_run_then_be_cancelled');
  const recovered=db.request();const recovery=await recovered.role(roles[1]).rpc('qbo_budget_probe',{p_delay_ms:0,p_label:index+'-recovered',p_fail:false});assert.equal(recovery.error,null);assert.equal(recovery.data.role,roles[1]);await recovered.close();
  const idle=db.statistics();assert(idle.total<=4);assert.equal(idle.waiting,0);assert(maxTotal<=4);assert(maxWaiting>0);
  latency.sort((a,b)=>a-b);process.send({passed:true,worker:index,success,failed,replays:32,recovered:1,maxTotal,maxWaiting,cancelledInMs,cancellationCode:cancelled.error.code,p95Ms:latency[Math.ceil(latency.length*.95)-1],p99Ms:latency[Math.ceil(latency.length*.99)-1],idle});
 }finally{clearInterval(timer);await db.close();}}
async function native(file){const config=privateConfiguration(file),db=new Client({connectionString:config.dbUrl,ssl:false,connectionTimeoutMillis:5000});await db.connect();let fixture,children=[];let monitoring;
 try{
  const identity=(await db.query("select current_setting('data_directory') directory,inet_server_addr() ip,current_database() db")).rows[0];assert.equal(identity.db,'postgres');assert(fs.realpathSync(identity.directory).startsWith(fs.realpathSync(config.ownedSupabaseHome)+path.sep));assert([null,'127.0.0.1','::1'].includes(identity.ip));
  const databaseName='vxa_budget_'+randomUUID().replaceAll('-','').slice(0,16);await db.query('create database '+databaseName);
  const u=new URL(config.dbUrl);u.pathname='/'+databaseName;fixture=new Client({connectionString:u.toString(),ssl:false,connectionTimeoutMillis:5000});await fixture.connect();
  await fixture.query(`create table public.qbo_budget_inventory(label text primary key,worker_role text not null);
   grant usage on schema public to ${roles.join(',')};grant select,insert on public.qbo_budget_inventory to ${roles.join(',')};
   create function public.qbo_budget_probe(p_delay_ms integer,p_label text,p_fail boolean) returns jsonb language plpgsql security invoker set search_path='' as $f$
   begin insert into public.qbo_budget_inventory values(p_label,current_user) on conflict do nothing;
   perform pg_catalog.pg_sleep(p_delay_ms/1000.0);if p_fail then raise exception 'synthetic_failure';end if;
   return pg_catalog.jsonb_build_object('role',current_user,'label',p_label);end;$f$;
   revoke all on function public.qbo_budget_probe(integer,text,boolean) from public;
   grant execute on function public.qbo_budget_probe(integer,text,boolean) to ${roles.join(',')};`);
  let peakConnections=0,peakActive=0,peakWaiting=0,samples=0;const sample=async()=>{const rows=(await db.query("select state,wait_event_type,count(*)::int n from pg_stat_activity where datname=$1 and application_name like 'vxa-budget-%' group by state,wait_event_type",[databaseName])).rows;peakConnections=Math.max(peakConnections,rows.reduce((n,r)=>n+r.n,0));peakActive=Math.max(peakActive,rows.filter(r=>r.state==='active').reduce((n,r)=>n+r.n,0));peakWaiting=Math.max(peakWaiting,rows.filter(r=>r.wait_event_type).reduce((n,r)=>n+r.n,0));samples++;};
  const promises=[0,1].map(index=>new Promise((resolve,reject)=>{const child=fork(__filename,['--worker',file,databaseName,String(index)],{cwd:root,env:{PATH:'/usr/bin:/bin',NODE_ENV:'test'},stdio:['ignore','ignore','pipe','ipc']});children.push(child);let result,errors='';child.stderr.on('data',bytes=>{errors+=bytes.toString();});child.once('error',reject);child.on('message',value=>{result=value;});child.once('exit',code=>{if(code===0&&result?.passed)resolve(result);else reject(Error('isolated_worker_failed_'+code+':'+errors.slice(-600)));});}));
  // Start both processes only after they load their synthetic configuration.
  await new Promise(resolve=>setTimeout(resolve,1000));children.forEach(child=>child.send('start'));
  let stopped=false;monitoring=(async()=>{while(!stopped){await sample();await new Promise(resolve=>setTimeout(resolve,5));}})();
  let workers;try{workers=await Promise.all(promises);}finally{stopped=true;await monitoring;monitoring=null;}
  assert(peakConnections<=8);assert(peakConnections>4,'two_process_overlap_required');
  const inventory=(await fixture.query("select count(*)::int total,count(*) filter(where label like '%cancelled')::int cancelled,count(*) filter(where label like '%recovered')::int recovered from public.qbo_budget_inventory")).rows[0];assert.deepEqual(inventory,{total:66,cancelled:0,recovered:2});
  const remaining=(await db.query("select count(*)::int n from pg_stat_activity where datname=$1 and application_name like 'vxa-budget-%'",[databaseName])).rows[0].n;assert.equal(remaining,0);
  return {passed:true,scope:'native PostgreSQL transaction/pool budget; synthetic RPC only; TLS separately qualified; not provider throughput or full customer capacity',databaseName,processes:2,concurrentHandles:80,poolMaximumPerProcess:4,peakConnections,peakActive,peakWaiting,samples,inventory,workers,preserved:true};
 }finally{for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');if(fixture)await fixture.end();await db.end();}}
if(require.main===module)(async()=>{if(process.argv[2]==='--worker')return worker(process.argv[3],process.argv[4],Number(process.argv[5]));const result={offline:await offline()};if(process.argv[2]==='--native')result.native=await native(process.argv[3]);console.log(JSON.stringify(result,null,2));})().catch(error=>{console.error(error);process.exitCode=1;});
