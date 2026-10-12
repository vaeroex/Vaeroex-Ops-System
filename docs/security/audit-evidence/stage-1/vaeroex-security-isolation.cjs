const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = process.cwd();
const ts = require('typescript');
const zod = require('zod');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const U = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';
const S = '55555555-5555-4555-8555-555555555555';
const writes = [];
const requests = [];
function query(table, admin) {
  const q = {op:'select', filters:[], payload:null};
  for (const method of ['select','insert','update','delete','eq','gt','is','order']) q[method] = (...args) => {
    if (['insert','update','delete'].includes(method)) {q.op=method; q.payload=args[0];}
    if (['eq','gt','is'].includes(method)) q.filters.push([method, ...args]);
    return q;
  };
  q.resolve = () => {
    if (q.op !== 'select') writes.push({table, op:q.op, payload:q.payload, filters:q.filters});
    let data = null;
    if (!admin && table === 'profiles') data={id:U};
    if (!admin && table === 'workspace_members') data=[{id:'member-b', user_id:U, workspace_id:B, role:'manager', status:'active', workspaces:{id:B,name:'Synthetic Workspace B'}}];
    if (admin && table === 'google_sheets_oauth_states') data=q.op==='select' ? {id:S,workspace_id:A,connection_id:C,initiated_by:U,redirect_uri:'https://synthetic.invalid/api/integrations/google-sheets/callback', expires_at:new Date(Date.now()+600000).toISOString(), consumed_at:null} : {id:S};
    if (admin && table === 'google_sheets_connections') data={id:C,status:'pending_authorization'};
    return {data,error:null};
  };
  q.then=(resolve,reject)=>Promise.resolve(q.resolve()).then(resolve,reject);
  q.maybeSingle=q.single=()=>Promise.resolve(q.resolve());
  return q;
}
const userDb = {auth:{getUser:async()=>({data:{user:{id:U,email:'synthetic@example.invalid'}}})},from:t=>query(t,false)};
const adminDb = {from:t=>query(t,true),rpc:(name,args)=>{requests.push(args);return {maybeSingle:async()=>({data:{allowed:true,request_count:1},error:null})};}};
const serverStub={
 sheetsConfiguration:()=>({appOrigin:'https://synthetic.invalid',redirectUri:'https://synthetic.invalid/api/integrations/google-sheets/callback'}),
 sheetsAdmin:()=>adminDb,
 sheetsStateHash:()=> 'sha256:'+'a'.repeat(64),
 exchangeSheetsCode:async()=>({accessToken:'fake-access-only',refreshToken:'fake-refresh-only',expiresAt:new Date(Date.now()+3600000).toISOString()}),
 encryptSheetsTokens:()=> 'synthetic-ciphertext',
 revokeSheetsToken:async()=>{}
};
const stubs={
 'server-only':{},
 'next/headers':{cookies:async()=>({get:()=>({value:B})}),headers:async()=>new Headers()},
 'next/navigation':{redirect:location=>{throw new Error('REDIRECT:'+location)}},
 'next/server':{NextResponse:{redirect:(url,status)=>({url:String(url),status,headers:new Headers()}),json:(body,init)=>({body,...init,headers:new Headers(init?.headers)})}},
 '@/lib/supabase/server':{createSupabaseServerClient:async()=>userDb},
 '@/lib/supabase/admin':{createSupabaseAdminClient:()=>adminDb},
 '@/lib/billing/require-active-subscription':{requireActiveSubscription:async()=>({allowed:true})},
 '@/lib/admin/admin-emails':{isVaeroexAdminUser:()=>false},
 '@/lib/workspaces/demo-compatibility':{isDemoWorkspaceRecord:()=>false},
 '@/lib/integrations/google-sheets/server':serverStub,
 'zod':zod
};
const cache={};
function load(file) {
 const abs=path.join(root,file); if(cache[abs]) return cache[abs];
 const exports={}; const module={exports}; cache[abs]=exports;
 const source=ts.transpileModule(fs.readFileSync(abs,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const requireFrom=(id)=>{
  if(Object.hasOwn(stubs,id))return stubs[id];
  if(id.startsWith('@/'))return load(id.slice(2)+'.ts');
  return require(id);
 };
 vm.runInNewContext('(function(require,module,exports){'+source+'\n})',{Buffer,URL,URLSearchParams,Headers,Request,Response,Date,console,process:{env:{}},setTimeout})(requireFrom,module,exports);
 return module.exports;
}
(async()=>{
 const context=await load('lib/workspaces/current.ts').getWorkspaceContext(A);
 assert.equal(context.activeWorkspace.id,B);
 const access=await load('lib/security/require-workspace-access.ts').requireWorkspaceAccess(A);
 assert.equal(access.workspaceId,B);
 const response=await load('app/api/integrations/google-sheets/callback/route.ts').GET(new Request('https://synthetic.invalid/api/integrations/google-sheets/callback?state='+'x'.repeat(43)+'&code=synthetic-code'));
 assert.match(response.url,/result=connected/);
 assert(writes.some(w=>w.table==='google_sheets_credentials' && w.payload?.workspace_id===A));
 console.log(JSON.stringify({test:'oauth_callback_revoked_workspace_membership',result:'REPRODUCED',requestedWorkspace:A,authorizedWorkspace:access.workspaceId,credentialWrittenTo:A,callbackResponse:response.url,scope:'Actual application modules, synthetic in-memory DB and provider; no live network/account/DB'}));
 const limiter=load('lib/security/rate-limit.ts');
 for(const ip of ['192.0.2.1','192.0.2.2']) await limiter.enforceRateLimit({action:'ai.provider.workspace',workspaceId:A,limit:1,windowSeconds:600,strict:true,requestHeaders:new Headers({'x-forwarded-for':ip})});
 assert.notEqual(requests[0].p_identifier_hash,requests[1].p_identifier_hash);
 const spoof1=limiter.clientIpFromHeaders(new Headers({'cf-connecting-ip':'198.51.100.1','x-forwarded-for':'192.0.2.1'}));
 assert.equal(spoof1,'198.51.100.1');
 console.log(JSON.stringify({test:'workspace_quota_ip_partition',result:'REPRODUCED',sameWorkspace:A,distinctKeys:new Set(requests.map(r=>r.p_identifier_hash)).size,claimedCfHeaderOverridesForwarded:spoof1,scope:'Actual limiter with captured synthetic RPC arguments; deployment header sanitation untested'}));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
