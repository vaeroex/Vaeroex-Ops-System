/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server modules with controlled provider I/O. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),test=require('node:test'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
const resolve=Module._resolveFilename,load=Module._load;
const intentId='aa200000-0000-4000-8000-000000000001',workspaceId='bb200000-0000-4000-8000-000000000001',actorId='cc200000-0000-4000-8000-000000000001';
let rpcCalls=[],requests=[],intent,subscription,invoice,charge,session,disputeStatus,providerInvoices,billingSubscriptions;
const admin={auth:{admin:{getUserById:async()=>({data:{user:{email:'owner@example.test',email_confirmed_at:'2026-01-01T00:00:00Z'}},error:null})}},async rpc(name,args){rpcCalls.push({name,args});
  if(name==='workspace_capacity_state_v1')return {data:{committedPacks:3,subscriptions:billingSubscriptions,pendingIntents:[]},error:null};
  if(name==='workspace_capacity_quote_v1'||name==='workspace_capacity_confirm_v1'||name==='workspace_capacity_provider_intent_v1')return {data:{...intent},error:null};
  if(name==='workspace_capacity_record_checkout_v1'){intent.stripe_session_id=args.p_session_id;return {data:true,error:null};}
  if(name==='workspace_capacity_sync_v1')return {data:{workspace_id:workspaceId,paid_packs:2},error:null};
  return {data:true,error:null};}};
Module._resolveFilename=function(request,parent,isMain,options){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,isMain,options);};
Module._load=function(request,parent,isMain){
  if(request==='server-only')return {};
  if(request==='@/lib/supabase/admin')return {createSupabaseAdminClient:()=>admin};
  if(request==='@/lib/supabase/config')return {getAppUrl:()=> 'https://stage.example.test'};
  if(request==='@/lib/supabase/server')return {createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:{id:actorId}}})}})};
  return load.call(this,request,parent,isMain);
};
const billing=require('../lib/storage-capacity/billing.ts');
const price={id:'price_capacity',active:true,livemode:false,currency:'usd',unit_amount:500,type:'recurring',billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}};
function fixture(){
  process.env.STRIPE_SECRET_KEY='sk_test_synthetic';process.env.STRIPE_PRICE_WORKSPACE_CAPACITY_MONTHLY='price_capacity';process.env.NEXT_PUBLIC_APP_URL='https://stage.example.test';delete process.env.WORKSPACE_CAPACITY_PURCHASES_APPROVED_TERMS;
  rpcCalls=[];requests=[];disputeStatus='under_review';providerInvoices=null;
  billingSubscriptions=[{id:'sub_capacity',packs:2,status:'active',paidThrough:'2026-11-12T00:00:00Z',cancelAtPeriodEnd:false,monthlyCents:1000}];
  intent={id:intentId,workspace_id:workspaceId,actor_id:actorId,packs:2,current_packs:0,stripe_price_id:'price_capacity',livemode:false,terms_version:'storage-capacity-v1',state:'checkout',stripe_session_id:'cs_capacity',stripe_customer_id:null,expires_at:new Date(Date.now()+1800000).toISOString(),created_at:new Date().toISOString()};
  subscription={id:'sub_capacity',customer:'cus_capacity',metadata:{product:'workspace_storage_capacity',capacity_intent_id:intentId,workspace_id:workspaceId},status:'active',livemode:false,cancel_at_period_end:false,ended_at:null,items:{data:[{quantity:2,price}]},latest_invoice:'in_capacity'};
  session={id:'cs_capacity',url:'https://checkout.stripe.com/c/pay/test',status:'complete',payment_status:'paid',expires_at:Math.floor(Date.now()/1000)+1800,amount_total:1000,currency:'usd',customer:'cus_capacity',subscription:'sub_capacity',client_reference_id:intentId,metadata:{product:'workspace_storage_capacity',capacity_intent_id:intentId,workspace_id:workspaceId},livemode:false};
  invoice={id:'in_capacity',customer:'cus_capacity',subscription:'sub_capacity',status:'paid',paid:true,currency:'usd',amount_paid:1000,amount_due:1000,charge:'ch_capacity',lines:{has_more:false,data:[{type:'subscription',subscription:'sub_capacity',price:{id:'price_capacity'},quantity:2,amount:1000,proration:false,period:{start:1791763200,end:1794441600}}]}};
  charge={id:'ch_capacity',invoice:'in_capacity',paid:true,amount:1000,amount_refunded:0,disputed:false,currency:'usd',customer:'cus_capacity'};
  global.fetch=async(url,init)=>{requests.push({url,init});const u=new URL(url);let result;
    if(u.pathname==='/v1/prices/price_capacity')result=price;
    else if(u.pathname==='/v1/subscriptions/sub_capacity')result=subscription;
    else if(u.pathname==='/v1/checkout/sessions/cs_capacity'||u.pathname==='/v1/checkout/sessions')result=session;
    else if(u.pathname==='/v1/invoices')result={data:providerInvoices||[invoice]};
    else if(u.pathname==='/v1/invoices/in_capacity')result=invoice;
    else if(u.pathname==='/v1/charges/ch_capacity')result=charge;
    else if(u.pathname==='/v1/disputes')result={data:[{charge:'ch_capacity',status:disputeStatus}],has_more:false};
    else throw new Error('Unexpected provider request '+url);
    return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
  };
}
test.beforeEach(fixture);
const event=(type,object)=>({id:'evt_synthetic',created:1791763200,type,data:{object}});
const syncCall=()=>rpcCalls.find(call=>call.name==='workspace_capacity_sync_v1');

test('test checkout works while live purchases require the exact approved terms',()=>{
  assert.equal(billing.capacityPurchasesEnabled(),true);
  process.env.STRIPE_SECRET_KEY='sk_live_synthetic';assert.equal(billing.capacityPurchasesEnabled(),false);
  process.env.WORKSPACE_CAPACITY_PURCHASES_APPROVED_TERMS='different';assert.equal(billing.capacityPurchasesEnabled(),false);
  process.env.WORKSPACE_CAPACITY_PURCHASES_APPROVED_TERMS='storage-capacity-v1';assert.equal(billing.capacityPurchasesEnabled(),true);
});
test('price validation rejects usage pricing, wrong currency, annual period and live/test mismatch',()=>{
  assert.doesNotThrow(()=>billing.validateCapacityPrice(price));
  for(const patch of [{unit_amount:499},{currency:'eur'},{livemode:true},{recurring:{...price.recurring,interval:'year'}},{recurring:{...price.recurring,usage_type:'metered'}}])assert.throws(()=>billing.validateCapacityPrice({...price,...patch}));
});
test('short-month renewal estimate handles January 31',()=>assert.equal(billing.nextMonthlyDate('2027-01-31T17:00:00Z'),'2027-02-28T17:00:00.000Z'));
test('owner billing view preserves the database commitment ceiling independently of paid packs',async()=>{
  const state=await billing.getWorkspaceCapacityBilling(workspaceId,actorId);
  assert.equal(state.committedPacks,3);assert.equal(state.subscriptions[0].packs,2);
});
test('review quotes exact workspace allowance and provider amount without granting capacity',async()=>{
  session.status='open';intent.stripe_session_id=null;intent.pricing_mode='fixed_anchor';intent.renewal_at='2026-11-12T00:00:00Z';
  const quote=await billing.quoteWorkspaceCapacity(workspaceId,actorId,2);
  assert.equal(quote.totalBytes,35000000000);assert.equal(quote.totalFiles,1500);assert.equal(quote.amountDueTodayCents,1000);
  assert.equal(quote.monthlyCents,1000);assert.equal(quote.workspaceId,workspaceId);assert.equal(syncCall(),undefined);
  assert.equal(quote.renewalDate,intent.renewal_at);assert(!('url' in quote),'Unconfirmed review must not expose payment URL');
  const create=requests.find(r=>r.init.method==='POST');assert.equal(new URLSearchParams(create.init.body).get('subscription_data[billing_cycle_anchor]'),String(new Date(intent.renewal_at).getTime()/1000));
});
test('recurring review excludes canceled paid capacity and includes unpaid renewable commitments',async()=>{
  session.status='open';intent.current_packs=2;
  billingSubscriptions=[
    {id:'sub_paid_canceling',packs:2,status:'active',paidThrough:'2027-01-01T00:00:00Z',cancelAtPeriodEnd:true,monthlyCents:1000},
    {id:'sub_unpaid_renewing',packs:3,status:'past_due',paidThrough:null,cancelAtPeriodEnd:false,monthlyCents:1500},
    {id:'sub_ended',packs:1,status:'canceled',paidThrough:null,cancelAtPeriodEnd:false,monthlyCents:500},
    {id:'sub_incomplete_expired',packs:1,status:'incomplete_expired',paidThrough:null,cancelAtPeriodEnd:false,monthlyCents:500}
  ];
  const quote=await billing.quoteWorkspaceCapacity(workspaceId,actorId,2);
  assert.equal(quote.existingMonthlyCents,1500);assert.equal(quote.monthlyCents+quote.existingMonthlyCents,2500);
  assert.equal(quote.totalPacks,4);assert.equal(quote.totalBytes,55000000000);assert.equal(quote.totalFiles,2500);
});
test('explicit confirmation binds one checkout and retries reuse its session',async()=>{
  intent.stripe_session_id=null;session.status='open';
  const first=await billing.checkoutWorkspaceCapacity(workspaceId,actorId,'owner@example.test',intentId);
  const second=await billing.checkoutWorkspaceCapacity(workspaceId,actorId,'owner@example.test',intentId);
  assert.equal(first.url,second.url);const posts=requests.filter(r=>r.url.endsWith('/checkout/sessions')&&r.init.method==='POST');assert.equal(posts.length,1);
  const params=new URLSearchParams(posts[0].init.body);assert.equal(params.get('line_items[0][quantity]'),'2');assert.equal(params.get('allow_promotion_codes'),'false');
  assert.equal(params.get('metadata[workspace_id]'),workspaceId);assert.equal(params.get('subscription_data[metadata][capacity_intent_id]'),intentId);
  assert.equal(posts[0].init.headers['Idempotency-Key'],'workspace-capacity:'+intentId);
  assert.equal(syncCall(),undefined,'creating checkout must not grant capacity');
});
test('paid event re-fetches authoritative invoice and payment before granting',async()=>{
  const result=await billing.processCapacityStripeEvent(admin,event('invoice.paid',{id:'in_capacity',amount_paid:1,subscription:'sub_attacker'}));
  assert.equal(result.handled,true);assert.equal(syncCall().args.p_packs,2);assert.equal(syncCall().args.p_invoices[0].paid_cents,1000);
  assert.equal(syncCall().args.p_event_key,'evt_synthetic');
  assert(requests.every(r=>r.init.headers['Stripe-Version']==='2024-06-20'));
});
test('base-plan subscription bypasses capacity without any entitlement or email operation',async()=>{
  subscription.metadata={product:'operations_intelligence'};
  assert.deepEqual(await billing.processCapacityStripeEvent(admin,event('customer.subscription.updated',{id:'sub_capacity'})),{handled:false});assert.equal(syncCall(),undefined);
});
test('success redirect or unpaid invoice cannot manufacture a paid period',async()=>{
  invoice.paid=false;invoice.status='open';
  await billing.processCapacityStripeEvent(admin,event('invoice.payment_failed',{id:'in_capacity'}));
  assert.deepEqual(syncCall().args.p_invoices,[]);
});
test('paid invoice with missing successful charge is rejected',async()=>{
  invoice.charge=null;await assert.rejects(()=>billing.processCapacityStripeEvent(admin,event('invoice.paid',{id:'in_capacity'})),/verified successful/);assert.equal(syncCall(),undefined);
});
test('paid invoice for another customer is rejected',async()=>{
  invoice.customer='cus_other';await assert.rejects(()=>billing.processCapacityStripeEvent(admin,event('invoice.paid',{id:'in_capacity'})),/attribution/);assert.equal(syncCall(),undefined);
});
test('subscription metadata cannot move confirmed purchase across workspaces',async()=>{
  subscription.metadata.workspace_id='other-workspace';await assert.rejects(()=>billing.processCapacityStripeEvent(admin,event('invoice.paid',{id:'in_capacity'})),/workspace purchase/);assert.equal(syncCall(),undefined);
});
test('full refund uses retrieved charge total rather than event claims',async()=>{
  charge.amount_refunded=1000;await billing.processCapacityStripeEvent(admin,event('charge.refunded',{id:'ch_capacity',amount_refunded:0}));assert.equal(syncCall().args.p_invoices[0].refunded_cents,1000);
});
test('partial refund and dispute are recorded separately for the correct paid period',async()=>{
  charge.amount_refunded=200;charge.disputed=true;await billing.processCapacityStripeEvent(admin,event('charge.dispute.created',{id:'dp_test',charge:'ch_capacity'}));
  assert.equal(syncCall().args.p_invoices[0].refunded_cents,200);assert.equal(syncCall().args.p_invoices[0].disputed,true);
});
test('owner cancellation schedules period end and preserves paid data',async()=>{
  await billing.cancelWorkspaceCapacity(workspaceId,actorId,'sub_capacity');
  const post=requests.find(r=>r.init.method==='POST');assert.equal(new URLSearchParams(post.init.body).get('cancel_at_period_end'),'true');assert.equal(syncCall().args.p_invoices.length,1);
  await assert.rejects(()=>billing.cancelWorkspaceCapacity(workspaceId,actorId,'sub_other'),/does not belong/);
});
test('first-period proration must stay within the reviewed amount and exact renewal date',()=>{
  intent.pricing_mode='fixed_anchor';intent.quoted_cents=1000;intent.renewal_at=new Date(invoice.lines.data[0].period.end*1000).toISOString();
  invoice.billing_reason='subscription_create';invoice.amount_due=900;invoice.amount_paid=900;invoice.lines.data[0].proration=true;invoice.lines.data[0].type='invoiceitem';invoice.lines.data[0].amount=900;charge.amount=900;
  const period=billing.capacityInvoicePeriod(invoice,subscription,'price_capacity',2,charge,intent);assert.equal(period.paid_cents,900);assert.equal(period.initial_period,true);
  intent.quoted_cents=899;assert.throws(()=>billing.capacityInvoicePeriod(invoice,subscription,'price_capacity',2,charge,intent),/period/);
  intent.quoted_cents=1000;invoice.lines.data[0].period.end+=1;assert.throws(()=>billing.capacityInvoicePeriod(invoice,subscription,'price_capacity',2,charge,intent),/period/);
});
test('a verified won dispute clears disputed state for current paid capacity',async()=>{
  charge.disputed=true;disputeStatus='won';await billing.processCapacityStripeEvent(admin,event('charge.dispute.closed',{id:'dp_test',charge:'ch_capacity'}));assert.equal(syncCall().args.p_invoices[0].disputed,false);
});
test('routine sync avoids fetching charges for expired historical invoices',async()=>{
  providerInvoices=[invoice,...Array.from({length:9},(_,i)=>({...invoice,id:'in_old'+i,charge:'ch_old'+i,lines:{...invoice.lines,data:invoice.lines.data.map(line=>({...line,period:{start:100,end:200}}))}}))];
  await billing.processCapacityStripeEvent(admin,event('customer.subscription.updated',{id:'sub_capacity'}));
  assert.equal(requests.filter(request=>request.url.includes('/charges/')).length,1);assert.equal(syncCall().args.p_invoices.length,1);
});
