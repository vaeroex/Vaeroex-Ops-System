/* eslint-disable @typescript-eslint/no-require-imports -- Production route modules exercised with isolated auth/database/provider boundaries. */
const {test,after}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const Module=require('node:module');const ts=require('typescript');
const oldLoad=Module._load,oldTs=require.extensions['.ts'];
let role='owner',actor='actor',accessCalls=[],dbCalls=[],queue=[],rpcResults=[],providerCalls=0,importArgs=null,importError=null;
const db={from(table){const calls=[['from',table]];const chain={};for(const method of ['select','update','eq','is','gt','single','maybeSingle']) chain[method]=(...args)=>{calls.push([method,...args]);return chain;};
 chain.then=(resolve,reject)=>{dbCalls.push(calls);return Promise.resolve(queue.shift()??{data:null,error:null}).then(resolve,reject);};return chain;},
 async rpc(name,args){dbCalls.push([['rpc',name,args]]);return rpcResults.shift()??{data:true,error:null};}};
Module._load=function(name,parent,main){if(name==='server-only') return {};
 if(name==='@/lib/security/require-workspace-access')return{requireWorkspaceAccess:async preferred=>{accessCalls.push(preferred);return{workspaceId:preferred??'workspace',user:{id:actor},membership:{role}};}};
 return oldLoad.call(this,name,parent,main);};
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,f);
const security=require('../lib/integrations/reporting/security.ts');security.admin=()=>db;
let enabled=true;security.available=()=>enabled;
const oauth=require('../lib/integrations/reporting/oauth.ts');oauth.exchange=async()=>{providerCalls++;return{accessToken:'synthetic-token',refreshToken:'synthetic-refresh'};};
const adapters=require('../lib/integrations/reporting/adapters.ts');adapters.accounts=async()=>{providerCalls++;return[{id:'123',name:'Test'}];};adapters.snapshot=async()=>{providerCalls++;return{};};
adapters.importHistory=async(...args)=>{providerCalls++;importArgs=args;if(importError)throw new Error(importError);return{startDate:args[4].startDate,endDate:args[4].endDate,records:[],currencies:[]};};
const {get,post}=require('../lib/integrations/reporting/routes.ts');
const connection='44444444-4444-4444-8444-444444444444';
function reset(){role='owner';actor='actor';accessCalls=[];dbCalls=[];queue=[];rpcResults=[];providerCalls=0;importArgs=null;importError=null;enabled=true;process.env.REPORTING_CONNECTOR_TOKEN_KEY=Buffer.alloc(32,1).toString('base64');
 for(const provider of ['XERO','HARVEST','ZOHO_INVENTORY']){process.env[`${provider}_REPORTING_ENABLED`]='true';process.env[`${provider}_CLIENT_ID`]='synthetic-client';process.env[`${provider}_CLIENT_SECRET`]='synthetic-secret';}}
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
 const result=await post(request('connect',{confirmation:'connect'}),context('connect'));assert.equal(result.status,200);
 assert.equal(result.headers.get('location'),null,'native form must receive a document, not a provider redirect');
 assert.equal(result.headers.get('cache-control'),'no-store, max-age=0');const args=dbCalls[0][0][2];
 assert.equal(args.p_workspace,'workspace');assert.equal(args.p_actor,'actor');assert.equal(args.p_provider,'harvest');assert.match(args.p_hash,/^[a-f0-9]{64}$/);
 const html=await result.text(),policy=require('../lib/integrations/control-plane/square-customer-handoff-policy.json');
 assert.equal(result.headers.get('content-security-policy'),policy.csp);assert.equal(result.headers.get('referrer-policy'),'no-referrer');
 assert.deepEqual([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]),[policy.script]);
 const url=new URL(/data-target="([^"]+)"/.exec(html)[1].replace(/&amp;/g,'&'));
 assert.equal(url.origin,'https://id.getharvest.com');assert.equal(url.pathname,'/oauth2/authorize');
 assert.equal(url.searchParams.get('redirect_uri'),'https://www.vaeroex.com/api/integrations/harvest/callback');
 assert.equal(security.hashState(url.searchParams.get('state')),args.p_hash);
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

test('only unique conflicts report an existing connection; other database errors fail closed',async()=>{
 for(const [code,result] of [['23505','connection_exists'],['42501','sync_failed'],['PGRST202','sync_failed']]){
  reset();rpcResults.push({data:null,error:{code}});
  const response=await post(request('connect',{confirmation:'connect'}),context('connect'));
  assert.equal(new URL(response.headers.get('location')).searchParams.get('result'),result);
  assert.equal(providerCalls,0);assert.equal(dbCalls.length,1);
 }
});

test('historical sync validates dates before lease or provider access and commits only the requested complete period',async()=>{
 for(const dates of [{startDate:'2018-01-01'},{startDate:'2018-02-30',endDate:'2018-03-01'},{startDate:'2018-01-01',endDate:'2020-01-01'}]){
  reset();const result=await post(request('sync',{connectionId:connection,...dates}),context('sync'));
  assert.match(result.headers.get('location'),/invalid_date_range/);assert.equal(dbCalls.length,0);assert.equal(providerCalls,0);
 }
 reset();queue.push({data:{status:'connected',account:{id:'123',name:'Test'},created_by:actor},error:null},
  {data:{ciphertext:security.seal('harvest','workspace',connection,{accessToken:'synthetic-token'})},error:null});
 const result=await post(request('sync',{connectionId:connection,startDate:'2014-01-01',endDate:'2014-12-31'}),context('sync'));
 assert.match(result.headers.get('location'),/synced/);assert.equal(importArgs[4].startDate,'2014-01-01');
 const apply=dbCalls.find(c=>c[0][1]==='apply_reporting_history')[0][2];
 assert.equal(apply.p_start_date,'2014-01-01');assert.equal(apply.p_end_date,'2014-12-31');assert.deepEqual(apply.p_records,[]);assert.equal(apply.p_workspace,'workspace');
 assert.equal(dbCalls.filter(c=>c[0][1]==='apply_reporting_snapshot').length,0);
});

test('historical overflow preserves saved data and releases only the matching lease',async()=>{
 reset();importError='snapshot_too_large';queue.push({data:{status:'connected',account:{id:'123',name:'Test'},created_by:actor},error:null},
  {data:{ciphertext:security.seal('harvest','workspace',connection,{accessToken:'synthetic-token'})},error:null});
 const result=await post(request('sync',{connectionId:connection,startDate:'2014-01-01',endDate:'2014-12-31'}),context('sync'));
 assert.match(result.headers.get('location'),/snapshot_too_large/);
 assert.equal(dbCalls.filter(c=>c[0][1]==='apply_reporting_history').length,0);
 const cleanup=dbCalls.at(-1);assert.ok(cleanup.some(c=>c[0]==='eq'&&c[1]==='lease_id'));
 assert.ok(cleanup.some(c=>c[0]==='eq'&&c[1]==='workspace_id'&&c[2]==='workspace'));
 assert.equal(cleanup.find(c=>c[0]==='update')[1].last_error_code,'snapshot_too_large');
});
