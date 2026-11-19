/* eslint-disable @typescript-eslint/no-require-imports -- Actual Square scheduler, cryptography, provider parser and shared read executor; controlled SQL/network boundaries. */
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const {installLoader,id}=require('./qbo-customer-test-support.cjs');
let currentAdmin=null;
installLoader({'@/lib/supabase/admin':{createSupabaseAdminClient:()=>currentAdmin},
 '@/lib/security/require-auth':{requireAuth:()=>{throw Error('browser_auth_forbidden_in_scheduler');}},
 '@/lib/security/get-current-workspace':{getCurrentWorkspace:()=>{throw Error('browser_workspace_forbidden_in_scheduler');}}});
const {runSquareRecurring,runDueSquareRefreshes}=require('../lib/integrations/square-direct/recurring.ts');
const {squareRecurringScope,squareRecurringAllowed}=require('../lib/integrations/square-direct/recurring-scope.ts');
const {createDirectSquareProvider,SquareDirectRateLimitError}=require('../lib/integrations/square-direct/provider.ts');
const {sealCredential,openCredential}=require('../lib/integrations/square-direct/crypto.ts');
const {SQUARE_OAUTH_SCOPES}=require('../lib/integrations/providers/square/account-connection-oauth.ts');
const {GET}=require('../app/api/integrations/square/scheduled-sync/route.ts');
const workspace=id(1),other=id(2),connection=id(3),entity=id(4),key=Buffer.alloc(32,7).toString('base64');
const originalEnv={...process.env},oldFetch=global.fetch;
after(()=>{process.env=originalEnv;global.fetch=oldFetch;});
function configure(){process.env.NODE_ENV='production';process.env.VERCEL_ENV='production';process.env.SQUARE_CUSTOMER_BACKEND_ENABLED='true';
 process.env.SQUARE_CUSTOMER_APPLICATION_ID='sq0idp-SYNTHETIC_RECURRING';process.env.SQUARE_CUSTOMER_APPLICATION_SECRET='synthetic-app-secret';process.env.SQUARE_CUSTOMER_ENCRYPTION_KEY=key;
 process.env.SQUARE_AUTOMATIC_REFRESH_ENABLED='true';process.env.SQUARE_AUTOMATIC_REFRESH_WORKSPACE_IDS=workspace;process.env.CRON_SECRET='synthetic-cron-secret-not-a-real-credential';}
function fixture({totalPages=2,mode='good',expired=false,scale=1}={}){
 const now=new Date(),start=new Date(now.getTime()-86400000).toISOString(),end=now.toISOString(),eventAt=new Date(now.getTime()-60000).toISOString();
 const credential={schemaVersion:'oauth_credential_envelope_v1',providerKey:'square',environment:'production',externalAuthorizedEntityReference:'MERCHANT_TEST',
  accessToken:'synthetic-test-access-token',refreshToken:'synthetic-test-refresh-token',refreshExpiresAt:null,issuedAt:start,updatedAt:start,
  accessExpiresAt:new Date(now.getTime()+(expired?60000:86400000)).toISOString(),grantedScopes:[...SQUARE_OAUTH_SCOPES]};
 let row={connectionId:connection,workspaceId:workspace,businessEntityId:entity,generation:1,credentialVersion:1,
  ciphertext:sealCredential(credential,key,{workspaceId:workspace,connectionId:connection,generation:1,credentialVersion:1}),
  merchantId:'MERCHANT_TEST',accessExpiresAt:credential.accessExpiresAt,locationId:'LOCATION_TEST',windowStart:null,windowEnd:null,
  cursor:null,readKind:'updated',cursorBindingFingerprint:null,cursorFingerprint:null,leaseId:null,state:'connected'};
 const state={consent:true,ownerActive:true,lastSuccess:'2020-01-01T00:00:00Z',checkpoint:null,mode,totalPages,scale,commits:0,tokenRequests:0,dataReads:0,loseClaim:false,loseRefresh:false,losePage:false};
 const calls=[],payments=new Map();
 const snapshot=()=>structuredClone(row);
 const lazy=run=>{const value={then:(yes,no)=>Promise.resolve().then(run).then(yes,no),abortSignal:signal=>{assert(signal instanceof AbortSignal);return value;}};return value;};
 const db={rpc(name,args){return lazy(()=>{
  calls.push({name,args:structuredClone(args)});
  if(name==='square_customer_recover_recurring_v1')return{data:0,error:null};
  if(name==='square_customer_due_recurring_v1')return{data:[{connection_id:connection,workspace_id:workspace}],error:null};
  assert.equal(name,'square_customer_recurring_v1');assert(!Object.hasOwn(args,'p_actor_id'));assert(!Object.hasOwn(args,'p_session_id'));
  if(args.p_workspace_id!==workspace||args.p_application_id!==process.env.SQUARE_CUSTOMER_APPLICATION_ID)return{data:null,error:{code:'42501'}};
  const op=args.p_operation,p=args.p_payload;
  if(op==='claim'){
   if(!state.consent||!state.ownerActive||row.leaseId)return{data:null,error:{code:'55000'}};
   row={...row,leaseId:p.leaseId,state:'syncing',windowStart:row.windowStart??start,windowEnd:row.windowEnd??end};
   return state.loseClaim?{data:null,error:{code:'controlled_lost_ack'}}:{data:snapshot(),error:null};
  }
  if(row.leaseId!==p.leaseId||p.connectionId!==connection)return{data:null,error:{code:'42501'}};
  if(op==='fail'){
   assert(Number.isInteger(p.retryAfterSeconds));assert(p.retryAfterSeconds>=0&&p.retryAfterSeconds<=86400);
   row.state=p.reason;row.leaseId=null;return{data:{recorded:true},error:null};
  }
  if(!state.consent||!state.ownerActive)return{data:null,error:{code:'42501'}};
  if(op==='authorize')return{data:{authorized:true},error:null};
  if(op==='reconcile')return{data:snapshot(),error:null};
  if(op==='commit_refresh'){
   assert.equal(p.credentialVersion,row.credentialVersion+1);row={...row,credentialVersion:p.credentialVersion,ciphertext:p.ciphertext,accessExpiresAt:p.accessExpiresAt};
   return state.loseRefresh?{data:null,error:{code:'controlled_lost_ack'}}:{data:snapshot(),error:null};
  }
  if(op==='commit_page'){
   state.commits++;for(const payment of p.payments)payments.set(payment.id,payment);
   row={...row,state:'connected',leaseId:null,cursor:p.cursor,cursorFingerprint:p.cursorFingerprint,cursorBindingFingerprint:p.cursorBindingFingerprint};
   if(!p.cursor){state.lastSuccess=new Date().toISOString();state.checkpoint=row.windowEnd;row.windowStart=null;row.windowEnd=null;}
   return state.losePage?{data:null,error:{code:'controlled_lost_ack'}}:{data:{stored:true,hasMore:p.cursor!==null},error:null};
  }
  throw Error(`unexpected_operation:${op}`);
 });}};
 const network=async(url,init)=>{
  const u=new URL(url);assert.equal(u.origin,'https://connect.squareup.com');assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.equal(init.credentials,'omit');assert(init.signal instanceof AbortSignal);
  if(u.pathname==='/oauth2/token'){
   state.tokenRequests++;if(state.mode==='token429')return new Response('private body',{status:429,headers:{'retry-after':'7200'}});
   if(state.mode==='token_revoke')state.consent=false;
   return Response.json({access_token:'synthetic-renewed-access-token',refresh_token:credential.refreshToken,token_type:'bearer',merchant_id:'MERCHANT_TEST',short_lived:true,expires_at:new Date(now.getTime()+86400000).toISOString()});
  }
  if(u.pathname==='/oauth2/token/status')return Response.json({client_id:process.env.SQUARE_CUSTOMER_APPLICATION_ID,merchant_id:'MERCHANT_TEST',scopes:[...SQUARE_OAUTH_SCOPES],expires_at:new Date(now.getTime()+86400000).toISOString()});
  assert.equal(u.pathname,'/v2/payments');state.dataReads++;
  if(state.mode==='429'||state.mode==='partial429'&&state.dataReads===2)return new Response('private body',{status:429,headers:{'retry-after':'7200'}});
  if(state.mode==='401')return new Response('private body',{status:401});
  if(state.mode==='revoke')state.consent=false;
  const page=u.searchParams.has('cursor')?Number(u.searchParams.get('cursor').slice(1)):0;
  assert.equal(u.searchParams.get('sort_field'),'UPDATED_AT');assert.equal(u.searchParams.get('begin_time'),'1970-01-01T00:00:00.000Z');assert.equal(u.searchParams.get('location_id'),'LOCATION_TEST');
  const payment={id:`PAYMENT_${page}`,location_id:state.mode==='foreign_location'?'OTHER_LOCATION':'LOCATION_TEST',status:'COMPLETED',created_at:eventAt,updated_at:eventAt,total_money:{amount:1000*state.scale,currency:'USD'},customer_id:'must-not-store',note:'must-not-store'};
  return Response.json({payments:state.mode==='duplicate'?[payment,payment]:[payment],...(page+1<state.totalPages?{cursor:`c${page+1}`}:{})});
 };
 const run=()=>runSquareRecurring({connection_id:connection,workspace_id:workspace},{deadlineAt:Date.now()+240000,cleanupDeadlineAt:Date.now()+285000},{db,network,now:()=>now});
 return{db,network,state,calls,payments,row:()=>row,credential,run};
}

test('Square recurrence retains production backend gate and requires explicit bounded workspace scope',async()=>{
 configure();assert.deepEqual(squareRecurringScope(),{workspaceIds:[workspace]});assert.equal(squareRecurringAllowed(other),false);
 for(const patch of [{SQUARE_AUTOMATIC_REFRESH_ENABLED:'false'},{SQUARE_AUTOMATIC_REFRESH_WORKSPACE_IDS:'*'},{SQUARE_AUTOMATIC_REFRESH_WORKSPACE_IDS:`${workspace},${workspace}`}])assert.equal(squareRecurringScope({...process.env,...patch}),null);
 const f=fixture();process.env.VERCEL_ENV='preview';assert.equal((await f.run()).outcome,'deferred');assert.equal(f.calls.length,0);assert.equal(f.state.dataReads,0);
});
test('real authorized Square parser continues checkpoint-bound pages and only marks a complete window fresh',async()=>{
 configure();const f=fixture();const result=await f.run();assert.deepEqual(result,{outcome:'succeeded',pages:2,complete:true});assert.equal(f.state.commits,2);assert.equal(f.state.dataReads,2);assert.equal(f.payments.size,2);
 assert.notEqual(f.state.lastSuccess,'2020-01-01T00:00:00Z');assert(f.state.checkpoint);assert.equal(f.row().cursor,null);assert.doesNotMatch(JSON.stringify([...f.payments.values()]),/must-not-store|customer_id|note/);
 const ops=f.calls.map(c=>c.args.p_operation);assert.deepEqual(ops,['claim','authorize','commit_page','claim','authorize','commit_page']);assert([...f.payments.values()].every(p=>p.amountMinor==='1000'&&p.currency==='USD'));
});
test('four-page bound preserves a durable continuation without claiming complete coverage, and next tick resumes',async()=>{
 configure();const f=fixture({totalPages:6});assert.deepEqual(await f.run(),{outcome:'progressed',pages:4,complete:false});assert.equal(f.state.lastSuccess,'2020-01-01T00:00:00Z');assert.equal(f.state.checkpoint,null);assert.equal(f.row().cursor,'c4');assert.equal(f.payments.size,4);
 assert.deepEqual(await f.run(),{outcome:'succeeded',pages:2,complete:true});assert.equal(f.payments.size,6);assert.equal(f.state.dataReads,6);
});
test('later page failure preserves earlier complete pages and old completion time, with provider Retry-After retained',async()=>{
 configure();const f=fixture({totalPages:3,mode:'partial429'});assert.deepEqual(await f.run(),{outcome:'failed',pages:1,complete:false});assert.equal(f.payments.size,1);assert.equal(f.row().cursor,'c1');assert.equal(f.state.lastSuccess,'2020-01-01T00:00:00Z');assert.equal(f.state.checkpoint,null);
 const fail=f.calls.at(-1);assert.equal(fail.args.p_operation,'fail');assert.equal(fail.args.p_payload.retryAfterSeconds,7200);assert.equal(fail.args.p_payload.reason,'retry_required');
 f.state.mode='good';assert.deepEqual(await f.run(),{outcome:'succeeded',pages:2,complete:true});assert.equal(f.payments.size,3);
});
test('duplicate/malformed/foreign payment pages and revocation cannot commit any part of the attempted page',async()=>{
 for(const mode of ['duplicate','foreign_location','revoke','401']){
  configure();const f=fixture({mode});const result=await f.run();assert.equal(result.outcome,'failed');assert.equal(f.state.commits,0);assert.equal(f.payments.size,0);assert.equal(f.state.lastSuccess,'2020-01-01T00:00:00Z');
  if(mode==='401')assert.equal(f.row().state,'reauthorization_required');
 }
});
test('renewed encrypted credential uses one CAS and read-back on lost acknowledgement, and owner revocation stops subsequent requests',async()=>{
 configure();const f=fixture({expired:true,totalPages:1});f.state.loseRefresh=true;assert.equal((await f.run()).outcome,'succeeded',JSON.stringify({operations:f.calls.map(c=>c.args.p_operation),tokenRequests:f.state.tokenRequests}));assert.equal(f.state.tokenRequests,1);
 assert.equal(f.calls.filter(c=>c.args.p_operation==='commit_refresh').length,1);assert.equal(f.calls.filter(c=>c.args.p_operation==='reconcile').length,1);assert.equal(f.row().credentialVersion,2);
 assert.equal(openCredential(f.row().ciphertext,key,{workspaceId:workspace,connectionId:connection,generation:1,credentialVersion:2}).accessToken,'synthetic-renewed-access-token');
 const revoked=fixture({expired:true,mode:'token_revoke'});assert.equal((await revoked.run()).outcome,'failed');assert.equal(revoked.state.dataReads,0);assert.equal(revoked.state.commits,0);assert.equal(revoked.row().credentialVersion,1);
});
test('token endpoint Retry-After survives existing OAuth error sanitization without leaking response bodies',async()=>{
 configure();const f=fixture({expired:true,mode:'token429'});assert.equal((await f.run()).outcome,'failed');assert.equal(f.state.tokenRequests,1);assert.equal(f.state.dataReads,0);assert.equal(f.calls.at(-1).args.p_payload.retryAfterSeconds,7200);
 const provider=createDirectSquareProvider({applicationId:process.env.SQUARE_CUSTOMER_APPLICATION_ID,applicationSecret:process.env.SQUARE_CUSTOMER_APPLICATION_SECRET,network:f.network});
 await assert.rejects(provider.refresh(f.credential),error=>error instanceof SquareDirectRateLimitError&&error.retryAfterSeconds===7200&&error.message==='square_direct_provider_failed');
});
test('lost claim outcome cleans only that lease; lost page acknowledgement stops instead of retrying a committed page',async()=>{
 configure();const f=fixture();f.state.loseClaim=true;assert.equal((await f.run()).outcome,'failed');assert.equal(f.state.dataReads,0);assert.equal(f.row().leaseId,null);
 assert.equal(f.calls[0].args.p_payload.leaseId,f.calls[1].args.p_payload.leaseId);
 const committed=fixture({totalPages:1});committed.state.losePage=true;await assert.rejects(committed.run(),/cleanup_unavailable/);assert.equal(committed.state.commits,1);assert.equal(committed.state.dataReads,1);assert.equal(committed.payments.size,1);assert.equal(committed.row().state,'connected');
});
test('timer bounds concurrency, rejects duplicate due rows and does not impersonate a browser session',async()=>{
 const rows=Array.from({length:20},(_,n)=>({connection_id:id(200+n),workspace_id:id(300+n%3)}));let active=0,peak=0;const tenants=new Set();
 const result=await runDueSquareRefreshes({due:async()=>rows,eligible:()=>true,sync:async row=>{assert(!tenants.has(row.workspace_id));tenants.add(row.workspace_id);active++;peak=Math.max(active,peak);await new Promise(r=>setTimeout(r,1));active--;tenants.delete(row.workspace_id);return{outcome:'progressed',pages:4,complete:false};}});
 assert.equal(result.attempted,20);assert.equal(result.progressed,20);assert.equal(result.pages,80);assert.equal(peak,2);assert.equal(active,0);
 await assert.rejects(runDueSquareRefreshes({due:async()=>[rows[0],rows[0]],eligible:()=>true,sync:async()=>{throw Error('forbidden');}}),/due_invalid/);
});
test('cron authenticates before access, retains environment gate, scopes recovery/due and executes only allowed operations',async()=>{
 configure();const f=fixture({totalPages:1});currentAdmin=f.db;global.fetch=f.network;
 const request=()=>new Request('https://www.vaeroex.com/api/integrations/square/scheduled-sync',{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}});
 assert.equal((await GET(new Request('https://www.vaeroex.com/api/integrations/square/scheduled-sync'))).status,401);assert.equal(f.calls.length,0);
 process.env.VERCEL_ENV='preview';assert.deepEqual(await(await GET(request())).json(),{enabled:false,attempted:0});assert.equal(f.calls.length,0);
 configure();const response=await GET(request());assert.equal(response.status,200);const body=await response.json();assert.equal(body.succeeded,1);assert.equal(body.pages,1);
 assert.deepEqual(f.calls.slice(0,2).map(c=>c.name),['square_customer_recover_recurring_v1','square_customer_due_recurring_v1']);assert.deepEqual(f.calls[0].args.p_allowed_workspaces,[workspace]);
});
