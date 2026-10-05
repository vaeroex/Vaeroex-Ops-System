/* eslint-disable @typescript-eslint/no-require-imports -- Real handler bounded-dependency fixture; no live provider calls. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');require('./qbo-customer-test-support.cjs').installLoader();
const {createQboExecutionBudget,QboExecutionBudgetError,QBO_TASK_LEASE_SECONDS}=require('../services/external-integrations-qbo/src/execution-budget.ts');
const {QboRuntimeProviderError}=require('../lib/integrations/provider-runtime/qbo/client.ts');
const root=path.resolve(__dirname,'..'),file=path.join(root,'services/external-integrations-qbo/src/server.ts'),source=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);
const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='executeTask');assert(fn);
const authority={workspaceId:'workspace-a',businessEntityId:'entity-a',connectionId:'connection-a',connectionGeneration:3,taskId:'task-a',rowVersion:7,credentialVersion:2,queueAudience:'https://runtime.example',providerTenantReferenceFingerprint:'realm-fingerprint',state:'dispatched',dispatchGeneration:2,connectionConfigurationVersion:1,mappingVersion:1};
function fixture(mode){let now=0,phase='work';const calls=[],events=[];const acquired={...authority,acquired:true,terminalReplay:false,rowVersion:8,syncRunId:'run-a',streamKey:'accounts',taskKind:'initial_sync',controlMetadata:{}};let remaining;
 const context={exports:{},URL,createQboExecutionBudget:()=>createQboExecutionBudget(()=>now),QboExecutionBudgetError,QBO_TASK_LEASE_SECONDS,
  CloudTaskEnvelopeSchema:{parse:x=>x},readBody:async()=>({taskId:'task-a'}),queueConfiguration:()=>({queueName:'queue',queueResource:'projects/example/locations/example/queues/queue'}),
  canonicalTaskName:x=>x,randomUUID:()=> 'fixed-lease-id',contractSha256:()=> 'owner-fingerprint',env:()=> 'https://runtime.example',LeaseResultSchema:{parse:x=>x},
  readQboRuntimeTaskDelivery:async(input)=>{calls.push(['read',input]);return authority;},parseQboProductionCloudTaskDelivery:()=>({dispatchGeneration:2,retryCount:0,executionCount:0,attemptFingerprint:'delivery-fingerprint'}),
  leaseRuntimeTask:async(input,request,actor,client)=>{calls.push(['lease',input,actor,client]);return acquired;},
  database:budget=>{remaining=budget;return {role:role=>({role}),close:async()=>calls.push(['close'])};},
  resolveProviderAccessCredential:async(input)=>{await input.readCredential(2);return {state:'available',accessToken:'synthetic-access-token',credentialReadEvidenceId:'evidence-a',externalAuthorizedEntityReference:'realm-a'};},
  callBroker:async(route,body,budget)=>{assert.equal(typeof budget,'function');assert.equal(budget(),240000);calls.push(['broker',route,body]);return {};},
  BoundedIdentifierSchema:{parse:x=>x},externalReferenceFingerprint:()=> 'realm-fingerprint',
  FetchQboRuntimeTransport:class{async request(input){calls.push(['transport',input]);if(mode==='timeout'){assert.equal(input.timeoutMs,1000);now=240001;throw Error('synthetic_dependency_timeout');}return {status:200,body:Buffer.from('{}'),headers:{}};}},
  executeQboProductionRead:async(input)=>{calls.push(['execute',input]);assert.equal(input.task.rowVersion,8);assert.equal(input.leaseId,'fixed-lease-id');assert.equal(input.owner,'owner-fingerprint');
   if(mode==='expired'){now=285001;throw Error('synthetic_late_dependency');}
   if(mode==='timeout')now=239000;
   await input.transport.request({url:'https://quickbooks.api.intuit.com/v3/company/realm-a/query',method:'GET',accessToken:'synthetic-access-token',timeoutMs:30000,maximumResponseBytes:8388608});
   if(mode==='lost_ack')throw Error('synthetic_lost_completion_ack');
   return {observed:1,committed:1,completed:{state:'succeeded',continuationTaskId:null}};},
  QboRuntimeProviderError,QboCdcCoverageError:class extends Error{},
  failRuntimeTask:async(input,request,actor,client)=>{phase='cleanup';calls.push(['fail',input,actor,client]);assert.equal(remaining(),mode==='timeout'?44999:285000);if(mode==='lost_ack')throw Error('integration_sync_task_failure_stale');return {state:'retry_wait'};},
  safeEvent:(...args)=>events.push(args),json:(response,status,body)=>({status,body})};
 vm.runInNewContext(ts.transpileModule(fn.getText(source)+'\nexports.execute=executeTask;',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
 return {calls,events,phase:()=>phase,run:()=>context.exports.execute({headers:{'x-cloudtasks-taskname':'task-name'}},{})};}
(async()=>{
 let factorySource=source;
 if(process.argv.includes('--negative-control')){
  const before=require('node:child_process').execFileSync('git',['show','8d9ca438bec93f2121c789530cb6810fad8bf6ef:services/external-integrations-qbo/src/server.ts'],{cwd:root,encoding:'utf8'});
  factorySource=ts.createSourceFile(file,before,ts.ScriptTarget.Latest,true);
 }
 const factory=factorySource.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='database');assert(factory);
 let constructed=0,handles=0;const factoryContext={exports:{},config:{databaseUrl:'synthetic',mode:'provider_runtime'},rolesByMode:{provider_runtime:['integration_provider_runtime_authority','integration_provider_source_authority']},
  QboProductionDatabase:class{constructor(url,roles){assert.equal(url,'synthetic');assert.equal(roles.length,2);constructed++;}request(){handles++;return {};}}};
 vm.runInNewContext(ts.transpileModule('let instanceDatabase=null;\n'+factory.getText(factorySource)+'\nexports.database=database;',{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,factoryContext);
 assert.equal(constructed,0,'health-only startup does not open a database pool');
 for(let i=0;i<40;i++)factoryContext.exports.database();assert.equal(constructed,1,'HTTP handler overlap shares one process-owned pool');assert.equal(handles,40);
 const originalFetch=global.fetch;const requests=[];
 try{
  global.fetch=async(url,init)=>{requests.push({url:String(url),init});
   if(String(url)==='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token')return {ok:true,text:async()=>JSON.stringify({access_token:'synthetic-google-token'})};
   assert.equal(String(url),'https://cloudtasks.googleapis.com/v2/projects/example-project/locations/us-central1/queues/example-queue/tasks');
   const task=JSON.parse(init.body).task;assert.equal(task.dispatchDeadline,'300s');assert.equal(task.httpRequest.oidcToken.audience,'https://runtime.example');
   return {ok:true,status:200,json:async()=>({name:task.name})};};
  const {googleCreateCloudTask}=require('../services/external-integrations-qbo/src/google.ts');
  await googleCreateCloudTask({queueResource:'projects/example-project/locations/us-central1/queues/example-queue',taskId:'a'.repeat(64),
   targetUrl:'https://runtime.example/tasks/execute',oidcServiceAccountEmail:'runtime@example-project.iam.gserviceaccount.com',oidcAudience:'https://runtime.example',payload:{taskId:'synthetic'}});
  assert.equal(requests.length,2);
 }finally{global.fetch=originalFetch;}
 const normal=fixture('success'),success=await normal.run();assert.equal(success.status,200);assert.equal(success.body.state,'succeeded');assert.equal(normal.calls.find(c=>c[0]==='lease')[1].leaseSeconds,300);assert.equal(normal.calls.filter(c=>c[0]==='fail').length,0);assert.equal(normal.calls.filter(c=>c[0]==='transport')[0][1].timeoutMs,30000);assert.equal(normal.calls.at(-1)[0],'close');
 const timeout=fixture('timeout'),retry=await timeout.run();assert.equal(retry.status,200);assert.equal(retry.body.durableFailureRecorded,true);assert.equal(retry.body.state,'retry_wait');const failure=timeout.calls.find(c=>c[0]==='fail')[1];
 for(const key of ['workspaceId','businessEntityId','connectionId','connectionGeneration','taskId'])assert.equal(failure[key],authority[key]);assert.equal(failure.expectedRowVersion,8);assert.equal(failure.leaseId,'fixed-lease-id');assert.equal(failure.leaseOwnerFingerprint,'owner-fingerprint');assert.equal(failure.failureCategory,'timeout');assert.equal(failure.failureCode,'qbo_execution_budget_exhausted');assert.equal(failure.retryable,true);assert.equal(timeout.calls.at(-1)[0],'close');
 const expired=fixture('expired');await assert.rejects(expired.run(),/execution_budget_exhausted/);assert.equal(expired.calls.filter(c=>c[0]==='fail').length,0);assert.equal(expired.calls.at(-1)[0],'close');
 const lost=fixture('lost_ack');await assert.rejects(lost.run(),/failure_stale/);assert.equal(lost.calls.filter(c=>c[0]==='fail').length,1);assert.equal(lost.calls.at(-1)[0],'close');
 console.log(JSON.stringify({passed:true,scenarios:6,coverage:['lazy process-owned pool used by40 handler handles','explicit300s CloudTask delivery deadline retains OIDC audience','real executeTask lease300 with useful240 and cleanup285','provider timeout clipped to remaining work budget','scope,rowVersion,lease,owner retained in retryable durable timeout','expired cleanup cannot claim successful failure recording','lost completion acknowledgement cannot bypass stale failure fence'],limitations:'Synthetic dependencies and monotonic clock; no native lease-expiry or killed-worker recovery claim'},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
