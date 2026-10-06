const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict'),os=require('node:os');
const ts=require('typescript'),root=process.env.VAEROEX_AUDIT_ROOT||'/tmp/vaeroex-audit-production';
const resolve=Module._resolveFilename;
Module._resolveFilename=function(r,p,i,o){return resolve.call(this,r.startsWith('@/')?path.join(root,r.slice(2)):r,p,i,o);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:f}).outputText,f);
global.fetch=()=>{throw Error('Network prohibited');};
const plans=require(path.join(root,'lib/billing/plans.ts'));
const subscription={allowed:true,plan:{slug:'vaeroex',...plans.VAEROEX_PLAN_LIMITS}};
const filename=path.join(root,'lib/billing/usage-limits.ts'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
mod.require=r=>r==='@/lib/billing/get-subscription-status'?{getSubscriptionStatus:async()=>subscription}:r==='@/lib/billing/plans'?plans:require(r);
mod._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,filename);
const actual=mod.exports,ws='synthetic-quota-workspace',calls=[];
function client({ai=999,files=499,fail=null}={}){
 return {from(table){const filters=[];return {select(...args){assert.deepEqual(args[1],{count:'exact',head:true});return this;},eq(k,v){filters.push([k,v]);return this;},is(k,v){filters.push([k,v]);return this;},gte(k,v){filters.push([k,v]);return this;},then(resolve,reject){assert(filters.some(([k,v])=>k==='workspace_id'&&v===ws)||filters.some(([k,v])=>k==='user_id'&&v==='synthetic-user'));calls.push({table,filters});const count=table==='ai_agent_runs'?ai:table==='file_uploads'?files:1;return Promise.resolve(table===fail?{count:null,data:null,error:{code:'57014',message:'synthetic count timeout'}}:{count,data:null,error:null}).then(resolve,reject);}};}};
}
const args=supabase=>({supabase,workspaceId:ws,userId:'synthetic-user',email:'synthetic@example.invalid'});
function view(result){return {reached:result.reached,limitValue:result.limitValue,count:result.count??null,usage:result.usage??null,subscriptionAllowed:result.subscription?.allowed??null,errorReported:Object.hasOwn(result,'error')||Object.hasOwn(result,'unavailable')};}
(async()=>{
 const atLimit=await actual.isUsageLimitReached({...args(client({ai:1000})),limit:'ai_runs_this_month'});assert(atLimit.reached);
 const below=await actual.isUsageLimitReached({...args(client()),limit:'ai_runs_this_month'});assert(!below.reached);
 const aggregateFailure=await actual.isUsageLimitReached({...args(client({fail:'ai_agent_runs'})),limit:'ai_runs_this_month'});assert(!aggregateFailure.reached);assert.equal(aggregateFailure.usage.ai_runs_this_month,0);
 const specializedFailure=await actual.isAiRunUsageLimitReached({supabase:client({fail:'ai_agent_runs'}),workspaceId:ws,subscription});assert(!specializedFailure.reached);assert.equal(specializedFailure.count,0);
 const fileFailure=await actual.isUsageLimitReached({...args(client({fail:'file_uploads'})),limit:'files'});assert(!fileFailure.reached);assert.equal(fileFailure.usage.files,0);
 const before=calls.length,concurrency=16;
 const results=await Promise.all(Array.from({length:concurrency},()=>actual.isUsageLimitReached({...args(client({ai:999})),limit:'ai_runs_this_month'})));
 const admitted=results.filter(r=>r.subscription.allowed&&!r.reached).length;assert.equal(admitted,16);assert(results.every(r=>r.usage.ai_runs_this_month===999));
 assert.equal(calls.length-before,96);
 const fileResults=await Promise.all(Array.from({length:concurrency},()=>actual.isUsageLimitReached({...args(client({files:499})),limit:'files'})));
 const fileAdmitted=fileResults.filter(r=>r.subscription.allowed&&!r.reached).length;assert.equal(fileAdmitted,16);
 console.log(JSON.stringify({capturedAt:new Date().toISOString(),sourceRoot:root,scope:'Actual usage module and plan normalization; subscription authorization is a fixture; count DB responses mocked; no writes/providers/HTTP/actual concurrent SQL',planLimits:plans.VAEROEX_PLAN_LIMITS,positiveControls:{atLimit:view(atLimit),belowLimit:view(below)},faults:{aggregateAI:view(aggregateFailure),specializedAI:view(specializedFailure),files:view(fileFailure)},concurrency:{requests:concurrency,ai:{startingCount:999,limit:1000,checksAdmitted:admitted,hypotheticalCountIfEveryCallerCommits:999+admitted},files:{startingCount:499,limit:500,checksAdmitted:fileAdmitted,hypotheticalCountIfEveryCallerCommits:499+fileAdmitted},aggregateCountQueriesFor16Checks:96,actualWrites:0},interpretation:'Preflight count-only helpers do not reserve the final slot. This proves helper fail-open and simultaneous admission, not observed persisted overspend; endpoint throttles/generation claims/database gates may limit particular paths.',host:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,totalMemoryBytes:os.totalmem()}},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
