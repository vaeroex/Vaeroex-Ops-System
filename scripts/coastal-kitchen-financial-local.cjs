/* eslint-disable @typescript-eslint/no-require-imports -- Opt-in owned loopback-only financial qualification. */
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),req=Module.createRequire(root+'/package.json'),ts=req('typescript');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{esModuleInterop:true,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const resolver=Module._resolveFilename;Module._resolveFilename=function(r,p,...rest){if(r==='server-only')return r;return resolver.call(this,r.startsWith('@/')?root+'/'+r.slice(2):r,p,...rest)};
require.cache['server-only']={id:'server-only',filename:'server-only',loaded:true,exports:{}};
const privateDir=process.argv[process.argv.indexOf('--config-dir')+1];
assert(process.argv.includes('--config-dir')&&path.isAbsolute(privateDir),'Owned local config required');
assert(!path.resolve(privateDir).startsWith(root+path.sep),'Private config must remain outside Git');
const config=req('./scripts/vsi-e2e-fixture.cjs').readConfig(path.join(privateDir,'private-e2e-config.json'));
Object.assign(process.env,{NEXT_PUBLIC_SUPABASE_URL:config.apiUrl,NEXT_PUBLIC_SUPABASE_ANON_KEY:config.anonKey,SUPABASE_SERVICE_ROLE_KEY:config.serviceKey,VERCEL_ENV:'preview',QBO_PRODUCTION_CUSTOMER_CONNECTIONS_ENABLED:'true'});
const {Client}=req('pg'),{createClient}=req('@supabase/supabase-js');
const {financialHistory,financialQuestion}=req('./scripts/website-demo/financial-history.ts');
async function main(){
 const actor=JSON.parse(fs.readFileSync(path.join(privateDir,'coastal-actor.private.json')));
 const db=new Client({connectionString:config.dbUrl});await db.connect();
 assert(fs.realpathSync((await db.query("select current_setting('data_directory') directory")).rows[0].directory).startsWith(fs.realpathSync(config.ownedSupabaseHome)+'/stacks/'));
 const marker=path.join(privateDir,'financial-seed.json');
 if(!fs.existsSync(marker)){
  await db.query('begin');
  try {
   let fixture=fs.readFileSync(path.join(root,'supabase/tests/fixtures/qbo-production-native.sql'),'utf8');
   fixture=fixture.replaceAll('a9f00000-0000-4000-8000-000000000001',actor.id).replaceAll('b9f00000-0000-4000-8000-000000000001',actor.workspaceId);
   fixture=fixture.replace(/(insert into (?:auth.users|public.workspaces|public.workspace_members|public.customer_subscriptions)[\s\S]*?);/g,'$1 on conflict do nothing;');
   await db.query(fixture);
   // Fixture-only native ingestion membership is transactional and revoked before commit.
   await db.query('grant integration_provider_source_authority to postgres');
   const suite=fs.readFileSync(path.join(root,'supabase/tests/qbo_customer_source_browse.test.sql'),'utf8');
   await db.query(suite.slice(suite.indexOf('create function pg_temp.browse_source_hash'),suite.indexOf('-- Real role/JWT')));
   await db.query("select public.schedule_qbo_initialization_v2(2,'coastal_financial_schedule')");
   await db.query("update private.integration_sync_tasks set state='dispatched',dispatcher_task_name=encode(extensions.digest(convert_to(id::text,'UTF8'),'sha256'),'hex'),dispatch_generation=1,row_version=row_version+1,updated_at=clock_timestamp() where stream_key='qbo_profitandloss' and connection_id='e9f00000-0000-4000-8000-000000000101'");
   await db.query("update private.integration_sync_tasks set state='leased',lease_id=gen_random_uuid(),lease_owner_fingerprint=decode(repeat('a',64),'hex'),lease_expires_at=clock_timestamp()+interval '1 hour',heartbeat_at=clock_timestamp(),delivery_attribution_state='attributed',last_delivery_dispatch_generation=1,last_delivery_retry_count=0,last_delivery_execution_count=0,last_delivery_attempt_fingerprint=decode(repeat('b',64),'hex'),row_version=row_version+1,updated_at=clock_timestamp() where stream_key='qbo_profitandloss' and connection_id='e9f00000-0000-4000-8000-000000000101'");
   const task=(await db.query("select * from private.integration_sync_tasks where stream_key='qbo_profitandloss' and connection_id='e9f00000-0000-4000-8000-000000000101'")).rows[0];assert(task);
   for(const report of financialHistory){
    const v=(await db.query('select pg_temp.browse_source_version(t,1) v from private.integration_sync_tasks t where id=$1',[task.id])).rows[0].v;
    v.normalizedProjection=report.projection;v.source.providerRecordId=`ProfitAndLoss:accrual:${report.start}:${report.end}:USD`;
    v.temporal.periodStart=report.start;v.temporal.periodEnd=report.end;
    v.sourceFingerprint=(await db.query('select pg_temp.browse_source_hash($1::jsonb) hash',[JSON.stringify(v)])).rows[0].hash;
    const identity=(await db.query("select 'sha256:'||encode(private.phase_3_contract_fingerprint_v1($1::jsonb),'hex') hash",[JSON.stringify({identityVersion:'external_source_identity_v1',workspaceId:v.workspaceId,businessEntityId:v.businessEntityId,connectionId:v.connectionId,source:{kind:'provider',providerKey:'quickbooks_online',providerRecordType:'ProfitAndLoss',providerRecordId:v.source.providerRecordId}})])).rows[0].hash;
    const command={contractVersion:'integration_provider_source_commit_v1',taskId:task.id,leaseId:task.lease_id,leaseOwnerFingerprint:'sha256:'+'a'.repeat(64),mappingId:task.control_metadata.mappingId,sourceIdentityFingerprint:identity,version:v};
    await db.query('set local role integration_provider_source_authority');
    await db.query('select public.commit_provider_external_source_record_version_v1($1::jsonb,$2)',[JSON.stringify(command),'coastal_'+report.end]);await db.query('reset role');
   }
   const claims=(await db.query("select jsonb_array_elements(public.claim_qbo_production_source_validation_v1($1,'sha256:'||repeat('c',64),100)) claim",[task.id])).rows;
   for(const {claim} of claims){const validated=req('./lib/integrations/provider-runtime/qbo/production-validation.ts').validateProductionQboSourceClaim(claim);assert.equal(validated.validatedVersion.validation.state,'valid');await db.query("select public.complete_qbo_production_source_validation_v1($1,$2,'sha256:'||repeat('c',64),$3::jsonb,$4)",[claim.sourceVersionId,claim.claimId,JSON.stringify(validated.validatedVersion),'coastal_validate_'+claim.sourceVersionId]);}
   await db.query("update private.integration_connections set status='active',state_reason_code='healthy',row_version=row_version+1,updated_at=clock_timestamp() where id='e9f00000-0000-4000-8000-000000000101'");
   await db.query('revoke integration_provider_source_authority from postgres');
   await db.query('commit');fs.writeFileSync(marker,JSON.stringify({synthetic:true,reports:2}),{mode:0o600});
  }catch(error){await db.query('rollback');throw error;}
 }
 await db.query("update public.business_entities set display_name='Coastal Kitchen' where id='d9f00000-0000-4000-8000-000000000001' and workspace_id=$1",[actor.workspaceId]);
 await db.end();
 const client=createClient(config.apiUrl,config.anonKey,{auth:{persistSession:false,autoRefreshToken:false}});
 assert(!(await client.auth.signInWithPassword({email:actor.email,password:actor.password})).error,'Local login failed');
 const {authorizeVsiRead,retrieveVsiEvidence}=req('./lib/vsi/retrieval.ts');
 const access=await authorizeVsiRead({supabase:client,workspaceId:actor.workspaceId,actorUserId:actor.id});
 const ticket=await req('./lib/integrations/google-sheets/read-authority.ts').beginGoogleSheetsRead(client,actor.workspaceId,actor.id);
 const evidence=await retrieveVsiEvidence(access,financialQuestion,new Date().toISOString(),ticket);
 fs.writeFileSync(path.join(privateDir,'financial-retrieval.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 assert.equal(evidence.sources.filter(s=>s.sourceType==='financial_report').length,2,'Two real eligible P&L sources required');
 console.log(JSON.stringify({retrieved:evidence.sources.map(s=>({type:s.sourceType,title:s.title})),limitations:evidence.limitations}));
 if(process.argv.includes('--api-generate')){
  const attempt=process.argv.includes('--api-attempt')?process.argv[process.argv.indexOf('--api-attempt')+1]:'1';assert(/^[1-5]$/.test(attempt),'Attempt must be explicitly numbered 1–5');
  const out=path.join(privateDir,`financial-api-generation-${attempt}.private.json`);assert(!fs.existsSync(out),'Review the existing API attempt before another paid call');
  const keyFile=path.join(require('node:os').homedir(),'.config/vaeroex/coastal-kitchen/provider.env');assert.equal(fs.statSync(keyFile).mode&0o077,0);
  const providerKey=require('node:util').parseEnv(fs.readFileSync(keyFile,'utf8')).OPENAI_API_KEY;assert(providerKey);
  assert(req('./lib/vsi/config.ts').getVsiConfig().requestReserveUsd<=.25);
  const port=await new Promise((resolve,reject)=>{const probe=require('node:net').createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});
  const origin='http://127.0.0.1:'+port;
  const child=require('node:child_process').spawn(process.execPath,[req.resolve('next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',String(port)],{cwd:root,env:{...process.env,OPENAI_API_KEY:providerKey,NEXT_PUBLIC_APP_URL:origin},stdio:['ignore','pipe','pipe']});
  const log=fs.openSync(path.join(privateDir,'financial-next.private.log'),'a',0o600);child.stdout.on('data',b=>fs.writeSync(log,b));child.stderr.on('data',b=>fs.writeSync(log,b));
  try {
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned local Next startup timed out')),60000);child.once('exit',()=>{clearTimeout(timer);reject(Error('Owned local Next server exited'));});child.stdout.on('data',b=>{if(b.toString().includes('Ready in')){clearTimeout(timer);resolve();}});});
   const login=await req('./scripts/vsi-e2e-fixture.cjs').session(config,actor,origin);
   const headers={'content-type':'application/json',origin,cookie:login.cookies.map(c=>c.name+'='+c.value).join('; ')};
   const api=async(route,method='GET',body)=>{const r=await fetch(origin+'/api/vsi'+route,{method,headers,body:body?JSON.stringify({expectedWorkspaceId:actor.workspaceId,...body}):undefined});return{status:r.status,data:await r.json()};};
   const before=await api('/usage?workspaceId='+actor.workspaceId);assert.equal(before.status,200);
   const foreign=await client.rpc('qbo_customer_source_browse_v1',{p_workspace_id:'b9f00000-0000-4000-8000-000000000002',p_connection_id:null,p_source_id:null,p_after_id:null,p_kind:'reports'});assert(foreign.error,'Foreign workspace financial read must fail');
   const wrongTenant=await api('/conversations','POST',{expectedWorkspaceId:'b9f00000-0000-4000-8000-000000000002'});assert.equal(wrongTenant.status,403);
   const created=await api('/conversations','POST',{title:'Coastal Kitchen cost and profitability qualification'});assert.equal(created.status,201,JSON.stringify(created.data));
   const id=created.data.conversation.id,requestId=crypto.randomUUID();
   fs.writeFileSync(out,JSON.stringify({status:'started',reservedWorstCaseUsd:.25,conversationId:id}),{mode:0o600});
   const answered=await api('/conversations/'+id+'/messages','POST',{message:financialQuestion,requestId});
   fs.writeFileSync(out,JSON.stringify({synthetic:true,question:financialQuestion,...answered},null,2),{mode:0o600});assert.equal(answered.status,200,JSON.stringify(answered.data));
   const reopened=await api('/conversations/'+id+'?workspaceId='+actor.workspaceId);assert.equal(reopened.status,200);assert.equal(reopened.data.exchanges.length,1);assert.equal(reopened.data.exchanges[0].answer,answered.data.exchange.answer);
   const replay=await api('/conversations/'+id+'/messages','POST',{message:financialQuestion,requestId});assert.equal(replay.status,200);assert.equal(replay.data.replayed,true);
   const after=await api('/usage?workspaceId='+actor.workspaceId);assert.equal(after.data.used,before.data.used+1);
   const check={authenticatedApi:true,persistedReopened:true,idempotentReplay:true,oneQuestion:true,foreignFinancialCode:foreign.error.code,wrongTenantStatus:wrongTenant.status,cost:after.data.workspaceBudget.spentUsd-before.data.workspaceBudget.spentUsd};
   fs.writeFileSync(path.join(privateDir,`financial-api-checks-${attempt}.json`),JSON.stringify(check,null,2),{mode:0o600});console.log(JSON.stringify(check));
  }finally{child.kill('SIGTERM');}
 }
 if(process.argv.includes('--generate')){
  const out=path.join(privateDir,'financial-generation.private.json');assert(!fs.existsSync(out),'Review an existing attempt before any retry');
  const keyFile=path.join(require('node:os').homedir(),'.config/vaeroex/coastal-kitchen/provider.env');assert.equal(fs.statSync(keyFile).mode&0o077,0);
  process.env.OPENAI_API_KEY=require('node:util').parseEnv(fs.readFileSync(keyFile,'utf8')).OPENAI_API_KEY;
  assert(req('./lib/vsi/config.ts').getVsiConfig().requestReserveUsd<=.25);
  fs.writeFileSync(out,JSON.stringify({status:'started',reservedWorstCaseUsd:.25}),{mode:0o600});
  try {const answer=await req('./lib/vsi/engine.ts').runVsiAnswer({readTicket:ticket,supabase:client,workspaceId:actor.workspaceId,actorUserId:actor.id,question:financialQuestion,recentMessages:[],requestId:crypto.randomUUID()});fs.writeFileSync(out,JSON.stringify({synthetic:true,question:financialQuestion,answer},null,2),{mode:0o600});console.log(JSON.stringify({generated:true,cost:answer.usage.estimatedCostUsd,citations:answer.citations.length}));}
  catch(e){fs.writeFileSync(out,JSON.stringify({status:'failed',message:e.message,usage:e.usage}),{mode:0o600});throw e;}
 }
}
main().catch(e=>{console.error(JSON.stringify({code:e.code||e.name,message:e.message}));process.exit(1)});
