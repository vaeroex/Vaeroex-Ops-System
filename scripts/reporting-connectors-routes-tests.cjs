/* eslint-disable @typescript-eslint/no-require-imports -- Production route modules exercised with isolated auth/database/provider boundaries. */
const {test,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const Module=require('node:module');const ts=require('typescript');
const oldLoad=Module._load,oldTs=require.extensions['.ts'];
let role='owner',actor='actor',accessCalls=[],dbCalls=[],queue=[],rpcResults=[],providerCalls=0;
const db={from(table){const calls=[['from',table]];const chain={};for(const method of ['select','update','eq','is','gt','single','maybeSingle']) chain[method]=(...args)=>{calls.push([method,...args]);return chain;};
 chain.then=(resolve,reject)=>{dbCalls.push(calls);return Promise.resolve(queue.shift()??{data:null,error:null}).then(resolve,reject);};return chain;},
 async rpc(name,args){dbCalls.push([['rpc',name,args]]);return rpcResults.shift()??{data:true,error:null};}};
Module._load=function(name,parent,main){if(name==='server-only') return {};
 if(name==='@/lib/security/require-workspace-access')return{requireWorkspaceAccess:async preferred=>{accessCalls.push(preferred);return{workspaceId:preferred??'workspace',user:{id:actor},membership:{role}};}};
 return oldLoad.call(this,name,parent,main);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const security=require('../lib/integrations/reporting/security.ts');security.admin=()=>db;
let enabled=true;security.available=()=>enabled;
const oauth=require('../lib/integrations/reporting/oauth.ts');oauth.exchange=async()=>{providerCalls++;return{accessToken:'synthetic-token',refreshToken:'synthetic-refresh'};};oauth.authorizationUrl=()=> 'https://id.getharvest.com/oauth2/authorize';
const adapters=require('../lib/integrations/reporting/adapters.ts');adapters.accounts=async()=>{providerCalls++;return[{id:'123',name:'Test'}];};adapters.snapshot=async()=>{providerCalls++;return{};};
const {get,post}=require('../lib/integrations/reporting/routes.ts');
const connection='44444444-4444-4444-8444-444444444444';
function reset(){role='owner';actor='actor';accessCalls=[];dbCalls=[];queue=[];rpcResults=[];providerCalls=0;enabled=true;process.env.REPORTING_CONNECTOR_TOKEN_KEY=Buffer.alloc(32,1).toString('base64');}
function request(action,body,origin='https://www.vaeroex.com'){return new Request(`https://www.vaeroex.com/api/integrations/harvest/${action}`,{method:'POST',headers:{host:'www.vaeroex.com',origin,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams(body)});}
const context=action=>({params:Promise.resolve({provider:'harvest',action})});
const callback=extra=>new Request(`https://www.vaeroex.com/api/integrations/harvest/callback?state=${'a'.repeat(43)}&code=synthetic-code${extra??''}`,{headers:{host:'www.vaeroex.com'}});
after(()=>{Module._load=oldLoad;require.extensions['.ts']=oldTs;});
test('mutations reject other origins and nonowners before database/provider access',async()=>{
 reset();await post(request('connect',{confirmation:'connect'},'https://evil.example'),context('connect'));assert.equal(accessCalls.length,0);assert.equal(dbCalls.length,0);
 reset();role='admin';await post(request('connect',{confirmation:'connect'}),context('connect'));assert.equal(dbCalls.length,0);assert.equal(providerCalls,0);
});
test('OAuth start persists random hashed state with workspace and initiating user; explicit consent required',async()=>{
 reset();await post(request('connect',{}),context('connect'));assert.equal(dbCalls.length,0);
 const result=await post(request('connect',{confirmation:'connect'}),context('connect'));assert.equal(result.status,303);
 assert.equal(result.headers.get('cache-control'),'no-store');const args=dbCalls[0][0][2];
 assert.equal(args.p_workspace,'workspace');assert.equal(args.p_actor,'actor');assert.equal(args.p_provider,'harvest');assert.match(args.p_hash,/^[a-f0-9]{64}$/);
});
test('callback rejects duplicate state and wrong actor without consuming state or exchanging tokens',async()=>{
 reset();await get(callback('&state=duplicate'),context('callback'));assert.equal(dbCalls.length,0);
 reset();queue.push({data:{workspace_id:'original-workspace',connection_id:connection,initiated_by:'someone-else'},error:null});
 await get(callback(),context('callback'));assert.deepEqual(accessCalls,['original-workspace']);assert.equal(providerCalls,0);assert.equal(dbCalls.length,1);
});
test('callback uses the original workspace and atomic single-use state before exchange',async()=>{
 reset();queue.push({data:{workspace_id:'original-workspace',connection_id:connection,initiated_by:actor},error:null},{data:{connection_id:connection},error:null});
 const result=await get(callback(),context('callback'));assert.match(result.headers.get('location'),/choose_account/);assert.equal(providerCalls,2);
 assert.deepEqual(accessCalls,['original-workspace']);assert.ok(dbCalls[1].some(c=>c[0]==='is'&&c[1]==='consumed_at'&&c[2]===null));
 const finish=dbCalls.find(c=>c[0][0]==='rpc')[0][2];assert.equal(finish.p_workspace,'original-workspace');assert.doesNotMatch(finish.p_ciphertext,/synthetic-token/);
 reset();queue.push({data:{workspace_id:'original-workspace',connection_id:connection,initiated_by:actor},error:null},{data:null,error:{}});
 await get(callback(),context('callback'));assert.equal(providerCalls,0,'losing/replayed callback never exchanges a code');
});
test('account selection cannot submit an account not present in encrypted provider discovery',async()=>{
 reset();queue.push({data:{status:'choose_account',created_by:actor},error:null},{data:{ciphertext:security.seal('harvest','workspace',connection,{accessToken:'synthetic-token',accounts:[{id:'123',name:'Real choice'}]})},error:null});
 await post(request('select-account',{connectionId:connection,accountId:'forged',confirmation:'select'}),context('select-account'));
 assert.equal(dbCalls.filter(c=>c[0][0]==='rpc').length,0);assert.equal(providerCalls,0);
 for(const calls of dbCalls){assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='workspace_id'&&c[2]==='workspace'));assert.ok(calls.some(c=>c[0]==='eq'&&c[1]==='provider'&&c[2]==='harvest'));}
});
test('a failed lease claim makes no provider call and a disabled connector can still disconnect',async()=>{
 reset();queue.push({data:{status:'connected',account:{id:'123',name:'Test'},created_by:actor},error:null});rpcResults.push({data:false,error:null});
 const wait=await post(request('sync',{connectionId:connection}),context('sync'));assert.match(wait.headers.get('location'),/sync_wait/);assert.equal(providerCalls,0);
 reset();enabled=false;const result=await post(request('disconnect',{connectionId:connection,confirmation:'disconnect'}),context('disconnect'));
 assert.match(result.headers.get('location'),/disconnected/);assert.equal(dbCalls[0][0][1],'disconnect_reporting_connection');
});
