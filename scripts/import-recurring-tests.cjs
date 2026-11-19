/* eslint-disable @typescript-eslint/no-require-imports -- Real executor/transport/parsers/projection with controlled provider and SQL boundaries. */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { installLoader, id } = require('./qbo-customer-test-support.cjs');
const workspace=id(1),other=id(2),actor=id(3),day=new Date(Date.now()-86400000).toISOString().slice(0,10);
let role='owner';
installLoader({'@/lib/security/require-workspace-access':{requireWorkspaceAccess:async()=>({workspaceId:workspace,user:{id:actor},membership:{role}})}});
const providers=['loyverse','zoho-books','wix-orders'];
const servers=Object.fromEntries(providers.map(p=>[p,require(`../lib/integrations/${p}/server.ts`)]));
const {runImportRefresh,importTables,importRecurringRange}=require('../lib/integrations/import-refresh/execution.ts');
const {runDueImportRefreshes}=require('../lib/integrations/import-refresh/scheduler.ts');
const {importRefreshScope,importRecurringAllowed}=require('../lib/integrations/import-refresh/scope.ts');
const {GET}=require('../app/api/integrations/imports/scheduled-sync/route.ts');
const {sharedRow}=require('../lib/ai/shared-evidence/generation.ts');
const {evidenceEngineHash}=require('../lib/ai/evidence-engine/hash.ts');
const originalFetch=global.fetch,oldEnv={...process.env},oldAdmin=Object.fromEntries(providers.map(p=>[p,servers[p].admin]));
after(()=>{global.fetch=originalFetch;process.env=oldEnv;for(const p of providers)servers[p].admin=oldAdmin[p];});
function configure(){
 role='owner';process.env.VERCEL_ENV='preview';
 process.env.IMPORT_AUTOMATIC_REFRESH_ENABLED='true';process.env.IMPORT_AUTOMATIC_REFRESH_WORKSPACE_IDS=workspace;process.env.IMPORT_AUTOMATIC_REFRESH_PROVIDERS=providers.join(',');
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://synthetic.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-service-role-not-a-credential';process.env.CRON_SECRET='synthetic-cron-secret-not-a-real-credential';
 for(const [prefix,path] of [['LOYVERSE','loyverse'],['ZOHO_BOOKS','zoho-books']]){
  process.env[`${prefix}_ENABLED`]='true';process.env[`${prefix}_REDIRECT_URI`]=`https://www.vaeroex.com/api/integrations/${path}/callback`;
  process.env[`${prefix}_CLIENT_ID`]='synthetic-client-id';process.env[`${prefix}_CLIENT_SECRET`]='synthetic-client-secret';process.env[`${prefix}_TOKEN_ENCRYPTION_KEY`]=Buffer.alloc(32,8).toString('base64');
 }
 process.env.WIX_ORDERS_ENABLED='true';process.env.WIX_ORDERS_ORIGIN='https://www.vaeroex.com';process.env.WIX_ORDERS_APP_ID=id(90);process.env.WIX_ORDERS_SHARE_URL_ID=id(91);process.env.WIX_ORDERS_APP_SECRET='synthetic-app-secret';process.env.WIX_ORDERS_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');
}
function harness(provider,number=10,{expired=false}={}){
 const row={id:id(number),workspace_id:workspace,status:'connected',recurring_enabled:true,recurring_last_attempt_at:null,
  organization_id:'123456',sync_lease_id:null,sync_lease_kind:null,sync_lease_authorized_by:null,sync_lease_expires_at:null,last_sync_at:null,last_error_code:null,records:null};
 let saved=provider==='wix-orders'?{instance_ciphertext:servers[provider].encryptInstance(workspace,row.id,id(70))}
  :{token_ciphertext:servers[provider].encryptToken(workspace,row.id,{accessToken:'synthetic-access-token',refreshToken:'synthetic-refresh-token',expiresAt:new Date(Date.now()+(expired?-60000:3600000)).toISOString()})};
 const calls=[],queries=[];let applied=0;
 const lazy=run=>{const result={then:(yes,no)=>Promise.resolve().then(run).then(yes,no),abortSignal:signal=>{assert(signal instanceof AbortSignal);return result;}};return result;};
 const db={from(table){const filters=[],query={table,filters};queries.push(query);
  const chain=lazy(()=>{
   if(!filters.some(([k,v])=>k==='workspace_id'&&v===workspace)||!filters.some(([k,v])=>['id','connection_id'].includes(k)&&v===row.id))return{data:null,error:{}};
   if(table===importTables[provider].connections&&filters.some(([k,v])=>k!=='sync_lease_expires_at'&&row[k]!==v))return{data:null,error:{}};
   return{data:table===importTables[provider].connections?structuredClone(row):saved,error:null};
  });
  for(const name of ['select','single'])chain[name]=()=>chain;
  for(const name of ['eq','gt'])chain[name]=(key,value)=>{filters.push([key,value]);return chain;};return chain;
 },rpc(name,args){return lazy(()=>{
  calls.push({name,args:structuredClone(args)});
  if(name==='recover_import_refreshes')return{data:0,error:null};
  if(name==='list_due_import_refreshes')return{data:[connection()],error:null};
  const match=args.p_workspace===workspace&&args.p_provider===provider&&args.p_connection===row.id;
  if(name==='claim_import_refresh'){
   const authorized=args.p_trigger==='manual'?args.p_actor===actor:row.recurring_enabled;
   const allowed=match&&authorized&&row.status==='connected'&&!row.sync_lease_id;
   if(allowed){row.sync_lease_id=args.p_lease;row.sync_lease_kind=args.p_trigger;row.sync_lease_authorized_by=actor;row.sync_lease_expires_at=new Date(Date.now()+65000).toISOString();row.recurring_last_attempt_at=new Date().toISOString();}
   return row.loseClaim&&allowed?{data:null,error:{code:'controlled_lost_response'}}:{data:allowed,error:null};
  }
  const owns=(match||args.p_workspace_id===workspace&&args.p_connection_id===row.id)&&row.status==='connected'&&row.sync_lease_id===(args.p_lease??args.p_lease_id)
   &&(row.sync_lease_kind==='manual'||row.recurring_enabled);
  if(name==='save_import_refresh_token'){
   const valid=owns&&Date.parse(row.sync_lease_expires_at)>Date.now();if(valid)saved={token_ciphertext:args.p_ciphertext};return{data:valid,error:null};
  }
  if(name==='fail_import_refresh'){
   if(owns){row.sync_lease_id=null;row.last_error_code=args.p_error;if(args.p_error==='authorization_required')row.status='reauthorization_required';}
   return{data:owns,error:null};
  }
  if(['apply_loyverse_receipts','apply_zoho_books_history','apply_wix_order_snapshot'].includes(name)){
   if(!owns||Date.parse(row.sync_lease_expires_at)<=Date.now())return{data:null,error:{code:'42501'}};
   row.records=structuredClone(args.p_receipts??args.p_facts??args.p_orders);row.last_sync_at=new Date().toISOString();row.last_error_code=null;row.sync_lease_id=null;applied++;
   return{data:row.records.length,error:null};
  }
  throw new Error(`unexpected_rpc:${name}`);
 });}};
 const connection=()=>({id:row.id,workspace_id:workspace,provider});
 const run=options=>runImportRefresh({provider,workspaceId:workspace,connectionId:row.id,trigger:'scheduled',db,...options});
 const tick=()=>runDueImportRefreshes({due:async()=>[connection()],eligible:c=>importRecurringAllowed(c.workspace_id,c.provider),sync:(c,execution)=>run({execution})});
 const projected=()=>{const range=importRecurringRange(new Date());const source={identity:{kind:'legacy_reference',reference_id:id(number+100)},hash:evidenceEngineHash({provider,records:row.records,at:row.last_sync_at}),data:{provider,workspace_id:workspace,entity_id:id(5),connection_id:row.id,period_start:range.startDate,period_end:range.endDate,time_zone:'UTC',scope:'Fictional protected binding',coverage:'partial',currency:'USD',records:provider==='zoho-books'?row.records.map(record=>({...record,key:[workspace,row.id,record.kind,record.source_id]})):row.records,read_sources:[{table:importTables[provider].connections,id:row.id}],eligibility:{internal:'fixture'}}};return{source,row:sharedRow(source,workspace)};};
 return{row,db,calls,queries,run,tick,connection,projected,applied:()=>applied};
}
function reply(provider,scale=1){
 if(provider==='loyverse')return{receipts:[{receipt_number:'receipt-1',store_id:'store',receipt_date:`${day}T10:00:00Z`,created_at:`${day}T10:00:00Z`,updated_at:`${day}T11:00:00Z`,receipt_type:'SALE',total_money:15*scale,total_tax:1,total_discount:0,note:'private detail stripped'}]};
 if(provider==='zoho-books')return{invoice:{invoice_id:'123',date:day,status:'sent',currency_code:'USD',total:100*scale,balance:40*scale},expense:{expense_id:'456',date:day,currency_code:'USD',total:25}};
 return{orders:[{id:id(777),createdDate:`${day}T10:00:00Z`,status:'APPROVED',paymentStatus:'NOT_PAID',currency:'USD',priceSummary:{total:{amount:(20*scale).toFixed(2)}},buyerInfo:{email:'private@example.invalid'}}],metadata:{}};
}
function mockProvider(provider,scale=1,{mode='good',onRead,onToken}={}){
 const calls=[];let dataReads=0;
 global.fetch=async(url,init)=>{
  const u=new URL(url);calls.push(u.pathname);assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert(init.signal instanceof AbortSignal);
  if(u.pathname.includes('token')){
   onToken?.();if(mode==='token429')return new Response('private failure body',{status:429,headers:{'retry-after':'7200'}});
   if(provider==='wix-orders')return Response.json({access_token:'synthetic-wix-token'});
   return Response.json({access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_in:3600,scope:'MERCHANT_READ RECEIPTS_READ',api_domain:'https://www.zohoapis.com'});
  }
  dataReads++;onRead?.(dataReads);
  if(mode==='429')return new Response('private failure body',{status:429,headers:{'retry-after':'7200'}});
  if(mode==='401')return new Response('private failure body',{status:401});
  const value=reply(provider,scale);
  if(provider==='loyverse'){
   if(mode==='duplicate')value.receipts.push(value.receipts[0]);
   if(mode==='partial'){if(dataReads>1)return new Response('',{status:503});value.cursor='next';}
   return Response.json(value);
  }
  if(provider==='zoho-books'){
   const kind=u.pathname.endsWith('/invoices')?'invoices':'expenses';
   if(mode==='partial'&&kind==='invoices'&&u.searchParams.get('page')==='2')return new Response('',{status:503});
   const list=[kind==='invoices'?value.invoice:value.expense];if(mode==='duplicate')list.push(list[0]);
   return Response.json({code:0,[kind]:list,page_context:{has_more_page:mode==='partial'&&kind==='invoices'}});
  }
  if(mode==='duplicate')value.orders.push(value.orders[0]);
  if(mode==='partial'){if(dataReads>1)return new Response('',{status:503});value.metadata={cursors:{next:'next'}};}
  return Response.json(value);
 };
 return{calls,dataReads:()=>dataReads};
}

test('import rollout is default-off and requires explicit valid workspace and provider scopes',()=>{
 configure();assert.deepEqual(importRefreshScope().providers,providers);
 for(const patch of [{IMPORT_AUTOMATIC_REFRESH_ENABLED:'false'},{IMPORT_AUTOMATIC_REFRESH_WORKSPACE_IDS:'*'},
  {IMPORT_AUTOMATIC_REFRESH_PROVIDERS:'square'},{IMPORT_AUTOMATIC_REFRESH_PROVIDERS:'loyverse,loyverse'},
  {IMPORT_AUTOMATIC_REFRESH_WORKSPACE_IDS:`${workspace},${workspace}`}])assert.equal(importRefreshScope({...process.env,...patch}),null);
 assert.equal(importRecurringAllowed(other,'loyverse'),false);
});
for(const [n,provider]of providers.entries())test(`${provider}: actual scheduled parsing changes retrievable facts and preserves prior evidence after failure/duplicates/revocation`,async()=>{
 configure();const h=harness(provider,n+10);mockProvider(provider);assert.equal((await h.tick()).succeeded,1);const before=h.projected();
 mockProvider(provider,2);assert.equal((await h.tick()).succeeded,1);const changed=h.projected();assert.notEqual(changed.row.hash,before.row.hash);assert.notDeepEqual(changed.row.facts,before.row.facts);
 assert.throws(()=>sharedRow(changed.source,other));assert.doesNotMatch(JSON.stringify(h.row.records),/private detail|buyerInfo|private@example/);
 if(provider==='loyverse')assert(changed.row.facts.some(v=>v.includes('30 USD')));
 if(provider==='zoho-books'){assert(changed.row.facts.some(v=>v.includes('200 USD')));assert(changed.row.facts.some(v=>v.includes('balance at import')));}
 if(provider==='wix-orders')assert(changed.row.facts.some(v=>v.includes('40 USD')&&v.includes('NOT_PAID')));
 const saved=structuredClone(h.row);
 for(const mode of ['429','partial','duplicate']){
  mockProvider(provider,3,{mode});assert.equal(await h.run(),'failed');assert.equal(h.applied(),2);assert.deepEqual(h.row.records,saved.records);assert.equal(h.row.last_sync_at,saved.last_sync_at);assert.equal(h.projected().row.hash,changed.row.hash);
  if(mode==='429')assert.equal(h.calls.at(-1).args.p_retry_seconds,7200);
 }
 mockProvider(provider,3,{onRead:()=>{h.row.recurring_enabled=false;h.row.sync_lease_id=null;}});assert.equal(await h.run(),'deferred');assert.equal(h.applied(),2);assert.deepEqual(h.row.records,saved.records);
 const reads=mockProvider(provider);assert.equal(await h.run(),'deferred');assert.equal(reads.calls.length,0);
 for(const query of h.queries)assert(query.filters.some(([key,value])=>key==='workspace_id'&&value===workspace));
});
test('credential rotation is persisted only through the admitted guarded RPC, and revocation prevents token or evidence writes',async()=>{
 for(const provider of ['loyverse','zoho-books']){
  configure();const h=harness(provider,10,{expired:true});mockProvider(provider);assert.equal(await h.run(),'succeeded');
  const save=h.calls.find(c=>c.name==='save_import_refresh_token');assert(save);assert.equal(save.args.p_lease,h.calls[0].args.p_lease);assert.equal(save.args.p_workspace,workspace);assert.doesNotMatch(save.args.p_ciphertext,/synthetic-new-access/);
  const revoked=harness(provider,11,{expired:true});const reads=mockProvider(provider,1,{onToken:()=>{revoked.row.recurring_enabled=false;revoked.row.sync_lease_id=null;}});
  assert.equal(await revoked.run(),'deferred');assert.equal(reads.dataReads(),0);assert.equal(revoked.applied(),0);
 }
});
test('a lost claim response is reconciled by the same lease; excluded, duplicate and busy work never fetches',async()=>{
 configure();const h=harness('loyverse');h.row.loseClaim=true;const reads=mockProvider('loyverse');assert.equal(await h.run(),'failed');assert.equal(reads.calls.length,0);assert.equal(h.row.sync_lease_id,null);
 assert.deepEqual(h.calls.map(c=>c.name),['claim_import_refresh','fail_import_refresh']);assert.equal(h.calls[0].args.p_lease,h.calls[1].args.p_lease);
 h.row.loseClaim=false;h.row.sync_lease_id=id(88);assert.equal(await h.run(),'deferred');process.env.IMPORT_AUTOMATIC_REFRESH_WORKSPACE_IDS=other;assert.equal(await h.run(),'deferred');assert.equal(reads.calls.length,0);
});
test('manual imports retain old date ranges, require the actual owner, and use the same atomic admission',async()=>{
 configure();const h=harness('loyverse');mockProvider('loyverse');const {resolveImportRange}=require('../lib/integrations/date-range.ts');
 const invalid=await h.run({trigger:'manual',actorId:actor,range:resolveImportRange('2020-01-01','2020-01-31')}).catch(e=>e);
 assert(invalid instanceof Error,'fixture current-day records cannot enter the old range');assert.equal(h.applied(),0);
 assert.equal(h.calls[0].name,'claim_import_refresh');assert.equal(h.calls[0].args.p_trigger,'manual');assert.equal(h.calls[0].args.p_actor,actor);
 await assert.rejects(h.run({trigger:'manual',actorId:'untrusted',range:resolveImportRange('2020-01-01','2020-01-31')}),/actor_required/);
});
test('scheduler rejects duplicate scopes and bounds deadline/concurrency with one worker per workspace',async()=>{
 const rows=Array.from({length:20},(_,n)=>({id:id(200+n),workspace_id:id(300+n%3),provider:'loyverse'}));let active=0,peak=0;const tenants=new Set();
 const result=await runDueImportRefreshes({due:async()=>rows,eligible:()=>true,sync:async row=>{assert(!tenants.has(row.workspace_id));tenants.add(row.workspace_id);active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,1));active--;tenants.delete(row.workspace_id);return'succeeded';}});
 assert.equal(result.succeeded,20);assert.equal(peak,2);assert.equal(active,0);
 await assert.rejects(runDueImportRefreshes({due:async()=>[rows[0],rows[0]],eligible:()=>true,sync:async()=>{throw Error('forbidden');}}),/due_invalid/);
 let now=0;const bounded=await runDueImportRefreshes({now:()=>now,due:async()=>rows,eligible:()=>true,sync:async()=>{now=200000;return'succeeded';}});assert(bounded.attempted<=2);assert(bounded.remaining>=18);
});
test('cron authenticates before database access and applies provider configuration before due-page selection',async()=>{
 configure();const h=harness('loyverse');for(const p of providers)servers[p].admin=()=>h.db;
 assert.equal((await GET(new Request('https://synthetic.invalid/api/integrations/imports/scheduled-sync'))).status,401);assert.equal(h.calls.length,0);
 const request=()=>new Request('https://synthetic.invalid/api/integrations/imports/scheduled-sync',{headers:{authorization:`Bearer ${process.env.CRON_SECRET}`}});
 process.env.IMPORT_AUTOMATIC_REFRESH_PROVIDERS='*';assert.deepEqual(await(await GET(request())).json(),{enabled:false,attempted:0});assert.equal(h.calls.length,0);
 configure();process.env.WIX_ORDERS_ENABLED='false';mockProvider('loyverse');const response=await GET(request());assert.equal(response.status,200);assert.equal((await response.json()).succeeded,1);
 assert.deepEqual(h.calls.slice(0,2).map(c=>c.name),['recover_import_refreshes','list_due_import_refreshes']);assert(!h.calls[1].args.p_allowed_providers.includes('wix-orders'));
});
test('expired attempt cannot apply its response; cleanup preserves prior evidence and releases that lease',async()=>{
 configure();const h=harness('loyverse');mockProvider('loyverse');assert.equal(await h.run(),'succeeded');const saved=structuredClone(h.row);
 mockProvider('loyverse',2,{onRead:()=>{h.row.sync_lease_expires_at=new Date(Date.now()-1).toISOString();}});
 assert.equal(await h.run(),'failed');assert.equal(h.applied(),1);assert.deepEqual(h.row.records,saved.records);assert.equal(h.row.last_sync_at,saved.last_sync_at);assert.equal(h.row.sync_lease_id,null);
 assert.equal(h.calls.at(-1).name,'fail_import_refresh');
});
test('manual historical Loyverse import retains the requested old period through the real parser and atomic apply',async()=>{
 configure();const h=harness('loyverse');const {resolveImportRange}=require('../lib/integrations/date-range.ts');
 global.fetch=async()=>Response.json({receipts:[{receipt_number:'old-receipt',store_id:'old-store',receipt_date:'2019-12-01T10:00:00Z',created_at:'2020-01-02T10:00:00Z',updated_at:'2020-01-02T10:00:00Z',receipt_type:'REFUND',total_money:-12}]});
 assert.equal(await h.run({trigger:'manual',actorId:actor,range:resolveImportRange('2020-01-01','2020-01-31')}),'succeeded');
 const apply=h.calls.find(call=>call.name==='apply_loyverse_receipts');assert.equal(apply.args.p_window_start,'2020-01-01T00:00:00.000Z');assert.equal(apply.args.p_window_end,'2020-02-01T00:00:00.000Z');
 assert.equal(h.row.records[0].receipt_type,'REFUND');assert.equal(h.row.records[0].total_money,-12);assert.equal(h.row.records[0].receipt_date,'2019-12-01T10:00:00.000Z');
});
