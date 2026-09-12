const assert=require('node:assert/strict');
require('./square-account-browser-test-support.js').loadSquareBrowserModules();
const {NextRequest}=require('next/server');
const Module=require('node:module');const original=Module._load;
let queries=0, authCalls=0, rpcCalls=0, mode='valid';
const {view}=require('./square-workspace-evidence-regression-tests.js');
const workspace='10000000-0000-4000-8000-000000000001';
const fake={auth:{getUser:async()=>{authCalls++;return {data:{user:mode==='unauth'?null:{id:'10000000-0000-4000-8000-000000000002'}},error:null};},signInWithPassword:async()=>({error:null}),signOut:async()=>({error:null})},
  rpc:async()=>{rpcCalls++;return {data:mode==='forged'?{...view,secret:'PRIVATE_SENTINEL'}:view,error:mode==='revoked'?{}:null};},
  from(table){queries++;let result={data:[],error:null};
    if(table==='workspace_members')result={data:mode==='nonmember'?[]:[{workspace_id:workspace,workspaces:{id:workspace,name:'Synthetic workspace'}}],error:null};
    if(table==='workspaces')result={data:{id:workspace,subscription_required:mode==='unsubscribed'},error:null};
    const chain={select(){return chain;},eq(){return chain;},or(){return chain;},order(){return chain;},limit(){return chain;},maybeSingle(){return chain;},then(ok){return Promise.resolve(result).then(ok);}};return chain;
  }};
Module._load=function(name,parent,main){if(name==='@supabase/ssr')return {createServerClient:()=>fake};return original.call(this,name,parent,main);};
const {handle}=require('../services/square-workspace-host/src/handler.ts');
const host='square-sandbox.vaeroex.com';
const request=(path='/evidence',h={})=>new NextRequest(`https://${host}${path}`,{headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https',...h}});
Object.assign(process.env,{NODE_ENV:'production',SQUARE_EVIDENCE_HOST:'gcp-square-sandbox-workspace-v1',NEXT_PUBLIC_SUPABASE_URL:'https://oysjpoondtcrqpghhrbd.supabase.co',NEXT_PUBLIC_APP_URL:`https://${host}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'sb_publishable_SYNTHETIC_NEVER_ISSUED_123456789'});
for(const name of ['VERCEL','VERCEL_ENV','VERCEL_TARGET_ENV','VERCEL_PROJECT_ID','VERCEL_URL','VAEROEX_ADMIN_EMAILS'])delete process.env[name];
(async()=>{
 const {withoutSquareQualificationPaths}=require('./square-dormant-scope-test-support.js');
 assert.equal(withoutSquareQualificationPaths('services/square-workspace-host/src/handler.ts'),'');
 for(const p of ['services/square-workspace-host/app/admin/route.ts','services/square-workspace-host/src/unapproved.ts','services/external-integrations-qbo/src/server.ts'])assert.equal(withoutSquareQualificationPaths(p),p);
 const {publicKey}=require('../services/square-workspace-host/src/config.ts');
 for(const key of [undefined,'sb_secret_PRIVATE','plain-secret','a.'+Buffer.from(JSON.stringify({role:'service_role',ref:'oysjpoondtcrqpghhrbd',iss:'supabase'})).toString('base64url')+'.s'])assert.equal(publicKey(key),false);
 for(const h of [{host:'localhost'},{host:'preview.vercel.app'},{'x-forwarded-proto':'http'},{forwarded:'host=x'}])assert.equal((await handle(request('/evidence',h))).status,404);
 for(const p of ['/admin','/api','/_next/static/a.js'])assert.equal((await handle(request(p))).status,404);
 assert.equal(queries+authCalls+rpcCalls,0);
 const valid=await (await handle(request())).text();assert.match(valid,/Payment: 1/);assert.match(valid,/Inventory observations: 6/);assert.match(valid,/2 unresolved location relationships; 1 reference conflict/);assert(!valid.includes(workspace));assert(!/<script|src=|PRIVATE_SENTINEL/.test(valid));
 for(mode of ['nonmember','unsubscribed','revoked','forged']){const before=rpcCalls;const body=await(await handle(request())).text();assert(!body.includes('Square Sandbox evidence</h3>'));assert(!body.includes('PRIVATE_SENTINEL'));if(['nonmember','unsubscribed'].includes(mode))assert.equal(rpcCalls,before);}
 mode='unauth';assert.equal((await handle(request())).status,303);
 mode='valid';
 const controller=new AbortController();controller.abort();const before=queries+authCalls+rpcCalls;
 assert.equal((await handle(new NextRequest(`https://${host}/evidence`,{signal:controller.signal,headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https'}}))).status,503);
 assert.equal(queries+authCalls+rpcCalls,before,'aborted request does not query');
 fake.auth.signOut=async()=>({error:{message:'PRIVATE_SENTINEL'}});
 const logout=await handle(new NextRequest(`https://${host}/signout`,{method:'POST',headers:{host,'x-forwarded-host':host,'x-forwarded-proto':'https',origin:`https://${host}`,'content-type':'application/x-www-form-urlencoded',cookie:'sb-test-auth-token=SYNTHETIC'},body:'x=1'}));
 assert.equal(logout.status,303);assert.equal(logout.cookies.get('sb-test-auth-token').value,'');assert.match(logout.headers.get('set-cookie'),/Max-Age=0/);
 console.log('square_workspace_host_handler_authority_privacy_passed');
})().catch(()=>{process.exitCode=1;console.error('square_workspace_host_handler_failed');});
