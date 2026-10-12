/* eslint-disable @typescript-eslint/no-require-imports -- Exercise server modules with controlled provider I/O. */
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module'),path=require('node:path'),test=require('node:test'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},fileName:filename}).outputText,filename);
const resolve=Module._resolveFilename,load=Module._load;
const intentId='aa200000-0000-4000-8000-000000000001',workspaceId='bb200000-0000-4000-8000-000000000001',actorId='cc200000-0000-4000-8000-000000000001';
let rpcCalls=[],requests=[],intent,subscription,invoice,charge,session,disputeStatus,providerInvoices,billingSubscriptions,pendingIntents,customer,payment,rateCount;
const address={line1:'123 Main St',city:'Newark',state:'NJ',postalCode:'07102',country:'US'};
const admin={auth:{admin:{getUserById:async()=>({data:{user:{email:'owner@example.test',email_confirmed_at:'2026-01-01T00:00:00Z'}},error:null})}},async rpc(name,args){rpcCalls.push({name,args});
  if(name==='workspace_capacity_state_v1')return {data:{committedPacks:3,subscriptions:billingSubscriptions,pendingIntents},error:null};
  if(name==='workspace_capacity_invoice_quote_v1'||name==='workspace_capacity_quote_v1'||name==='workspace_capacity_confirm_v1'||name==='workspace_capacity_provider_intent_v1')return {data:{...intent},error:null};
  if(name==='workspace_capacity_record_invoice_v1'){Object.assign(intent,{stripe_customer_id:args.p_customer_id,stripe_subscription_id:args.p_subscription_id,stripe_initial_invoice_id:args.p_invoice_id,renewal_at:args.p_renewal_at,quoted_cents:args.p_quoted_cents,expires_at:args.p_expires_at});return {data:true,error:null};}
  if(name==='workspace_capacity_record_checkout_v1'){intent.stripe_session_id=args.p_session_id;return {data:true,error:null};}
  if(name==='workspace_capacity_sync_v1')return {data:{workspace_id:workspaceId,paid_packs:2},error:null};
  return {data:true,error:null};}};
Module._resolveFilename=function(request,parent,isMain,options){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,parent,isMain,options);};
Module._load=function(request,parent,isMain){
  if(request==='server-only')return {};
  if(request==='@/lib/security/rate-limit')return {enforceRateLimit:async(options)=>{assert.equal(options.limit,20);assert.equal(options.windowSeconds,600);assert.equal(options.workspaceId,workspaceId);assert.equal(options.userId,actorId);assert.equal(options.strict,true);return {allowed:++rateCount<=20};},rateLimitMessage:()=> 'Too many requests. Please try again shortly.'};
  if(request==='@/lib/supabase/admin')return {createSupabaseAdminClient:()=>admin};
  if(request==='@/lib/supabase/config')return {getAppUrl:()=> 'https://stage.example.test'};
  if(request==='@/lib/supabase/server')return {createSupabaseServerClient:async()=>({auth:{getUser:async()=>({data:{user:{id:actorId}}})}})};
  return load.call(this,request,parent,isMain);
};
const billing=require('../lib/storage-capacity/billing.ts');
const price={id:'price_capacity',active:true,livemode:false,currency:'usd',unit_amount:500,type:'recurring',tax_behavior:'inclusive',billing_scheme:'per_unit',recurring:{interval:'month',interval_count:1,usage_type:'licensed'}};
function fixture(){
  process.env.STRIPE_SECRET_KEY='sk_test_synthetic';process.env.STRIPE_PRICE_WORKSPACE_CAPACITY_MONTHLY='price_capacity';process.env.NEXT_PUBLIC_APP_URL='https://stage.example.test';delete process.env.WORKSPACE_CAPACITY_PURCHASES_APPROVED_TERMS;
  process.env.STRIPE_PUBLISHABLE_KEY='pk_test_synthetic';
  rpcCalls=[];requests=[];disputeStatus='under_review';providerInvoices=null;pendingIntents=[];rateCount=0;
  customer={id:'cus_capacity',balance:0,default_source:null,invoice_settings:{default_payment_method:null},discount:null};
  payment={id:'pi_capacity',client_secret:'pi_capacity_secret_synthetic',customer:'cus_capacity',invoice:'in_capacity',amount:1000,currency:'usd',livemode:false,status:'requires_payment_method',setup_future_usage:'off_session',payment_method_types:['card']};
  billingSubscriptions=[{id:'sub_capacity',packs:2,status:'active',paidThrough:'2026-11-12T00:00:00Z',cancelAtPeriodEnd:false,monthlyCents:1000}];
  intent={id:intentId,workspace_id:workspaceId,actor_id:actorId,packs:2,current_packs:0,stripe_price_id:'price_capacity',livemode:false,terms_version:'storage-capacity-v1',state:'checkout',stripe_session_id:'cs_capacity',stripe_customer_id:null,expires_at:new Date(Date.now()+1800000).toISOString(),created_at:new Date().toISOString()};
  subscription={id:'sub_capacity',customer:'cus_capacity',metadata:{product:'workspace_storage_capacity',capacity_intent_id:intentId,workspace_id:workspaceId},status:'active',livemode:false,cancel_at_period_end:false,ended_at:null,items:{data:[{quantity:2,price}]},latest_invoice:'in_capacity'};
  session={id:'cs_capacity',url:'https://checkout.stripe.com/c/pay/test',status:'complete',payment_status:'paid',expires_at:Math.floor(Date.now()/1000)+1800,amount_total:1000,currency:'usd',customer:'cus_capacity',subscription:'sub_capacity',client_reference_id:intentId,metadata:{product:'workspace_storage_capacity',capacity_intent_id:intentId,workspace_id:workspaceId},livemode:false};
  invoice={id:'in_capacity',customer:'cus_capacity',subscription:'sub_capacity',status:'paid',paid:true,currency:'usd',amount_paid:1000,amount_due:1000,charge:'ch_capacity',lines:{has_more:false,data:[{type:'subscription',subscription:'sub_capacity',price:{id:'price_capacity'},quantity:2,amount:1000,proration:false,period:{start:1791763200,end:1794441600}}]}};
  charge={id:'ch_capacity',invoice:'in_capacity',paid:true,amount:1000,amount_refunded:0,disputed:false,currency:'usd',customer:'cus_capacity'};
  global.fetch=async(url,init)=>{requests.push({url,init});const u=new URL(url);let result;
    if(u.pathname==='/v1/prices/price_capacity')result=price;
    else if(u.pathname==='/v1/subscriptions/sub_capacity'||u.pathname==='/v1/subscriptions')result=subscription;
    else if(u.pathname==='/v1/customers')result=customer;
    else if(u.pathname==='/v1/payment_intents/pi_capacity'){if(init.method==='POST')payment.setup_future_usage=new URLSearchParams(init.body).get('setup_future_usage');result=payment;}
    else if(u.pathname==='/v1/checkout/sessions/cs_capacity'||u.pathname==='/v1/checkout/sessions')result=session;
    else if(u.pathname==='/v1/invoices')result={data:providerInvoices||[invoice]};
    else if(u.pathname==='/v1/invoices/in_capacity')result=invoice;
    else if(u.pathname==='/v1/invoices/in_capacity/void')result={...invoice,status:'void'};
    else if(u.pathname==='/v1/charges/ch_capacity')result=charge;
    else if(u.pathname==='/v1/disputes')result={data:[{charge:'ch_capacity',status:disputeStatus}],has_more:false};
    else throw new Error('Unexpected provider request '+url);
    return new Response(JSON.stringify(result),{status:200,headers:{'content-type':'application/json'}});
  };
}
function invoiceFixture(){
  const start=Math.floor(Date.now()/1000),end=Math.floor(new Date(billing.nextMonthlyDate(new Date(start*1000).toISOString())).getTime()/1000);
  Object.assign(intent,{pricing_mode:'invoice_monthly',state:'quoted',stripe_session_id:null});
  Object.assign(subscription,{status:'incomplete',created:start,current_period_start:start,current_period_end:end,automatic_tax:{enabled:true},payment_settings:{save_default_payment_method:'on_subscription'}});
  Object.assign(invoice,{status:'open',paid:false,amount_paid:0,charge:null,total:1000,tax:62,automatic_tax:{enabled:true,status:'complete'},auto_advance:false,hosted_invoice_url:'https://invoice.stripe.com/i/test',payment_intent:'pi_capacity',billing_reason:'subscription_create'});
  invoice.lines.data[0].price.tax_behavior='inclusive';invoice.lines.data[0].period={start,end};
}
test.beforeEach(fixture);
const event=(type,object)=>({id:'evt_synthetic',created:1791763200,type,data:{object}});
const syncCall=()=>rpcCalls.find(call=>call.name==='workspace_capacity_sync_v1');

test('test checkout works while live purchases require the exact approved terms',()=>{
  assert.equal(billing.capacityPurchasesEnabled(),true);
  process.env.STRIPE_SECRET_KEY='sk_live_synthetic';process.env.STRIPE_PUBLISHABLE_KEY='pk_live_synthetic';assert.equal(billing.capacityPurchasesEnabled(),false);
  process.env.WORKSPACE_CAPACITY_PURCHASES_APPROVED_TERMS='different';assert.equal(billing.capacityPurchasesEnabled(),false);
  process.env.WORKSPACE_CAPACITY_PURCHASES_APPROVED_TERMS='storage-capacity-v1';assert.equal(billing.capacityPurchasesEnabled(),true);
});
test('price validation rejects usage pricing, wrong currency, annual period and live/test mismatch',()=>{
  assert.doesNotThrow(()=>billing.validateCapacityPrice(price));
  for(const patch of [{tax_behavior:'exclusive'},{tax_behavior:'unspecified'},{unit_amount:499},{currency:'eur'},{livemode:true},{recurring:{...price.recurring,interval:'year'}},{recurring:{...price.recurring,usage_type:'metered'}}])assert.throws(()=>billing.validateCapacityPrice({...price,...patch}));
});
test('short-month renewal estimate handles January 31',()=>assert.equal(billing.nextMonthlyDate('2027-01-31T17:00:00Z'),'2027-02-28T17:00:00.000Z'));
test('owner billing view preserves the database commitment ceiling independently of paid packs',async()=>{
  const state=await billing.getWorkspaceCapacityBilling(workspaceId,actorId);
  assert.equal(state.committedPacks,3);assert.equal(state.subscriptions[0].packs,2);
});
test('review quotes exact workspace allowance and provider amount without granting capacity',async()=>{
  invoiceFixture();
  const quote=await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);
  assert.equal(quote.totalBytes,35000000000);assert.equal(quote.totalFiles,1500);assert.equal(quote.amountDueTodayCents,1000);
  assert.equal(quote.monthlyCents,1000);assert.equal(quote.workspaceId,workspaceId);assert.equal(syncCall(),undefined);
  assert.equal(quote.renewalDate,intent.renewal_at);assert(!('url' in quote),'Unconfirmed review must not expose payment URL');
  const create=requests.find(r=>r.url.endsWith('/subscriptions'));const params=new URLSearchParams(create.init.body);
  assert.equal(params.get('payment_behavior'),'default_incomplete');assert.equal(params.get('automatic_tax[enabled]'),'true');assert.equal(params.get('proration_behavior'),'none');
  assert.equal(params.get('payment_settings[save_default_payment_method]'),'on_subscription');assert.equal(quote.taxIncludedCents,62);
  assert.equal(JSON.stringify(rpcCalls).includes(address.line1),false,'DB stores a hash, not the billing address');
});
test('recurring review excludes canceled paid capacity and includes unpaid renewable commitments',async()=>{
  invoiceFixture();intent.current_packs=2;
  billingSubscriptions=[
    {id:'sub_paid_canceling',packs:2,status:'active',paidThrough:'2027-01-01T00:00:00Z',cancelAtPeriodEnd:true,monthlyCents:1000},
    {id:'sub_unpaid_renewing',packs:3,status:'past_due',paidThrough:null,cancelAtPeriodEnd:false,monthlyCents:1500},
    {id:'sub_ended',packs:1,status:'canceled',paidThrough:null,cancelAtPeriodEnd:false,monthlyCents:500},
    {id:'sub_incomplete_expired',packs:1,status:'incomplete_expired',paidThrough:null,cancelAtPeriodEnd:false,monthlyCents:500}
  ];
  const quote=await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);
  assert.equal(quote.existingMonthlyCents,1500);assert.equal(quote.monthlyCents+quote.existingMonthlyCents,2500);
  assert.equal(quote.totalPacks,4);assert.equal(quote.totalBytes,55000000000);assert.equal(quote.totalFiles,2500);
});
test('non-US billing addresses are rejected before a provider request',async()=>{
  await assert.rejects(()=>billing.quoteWorkspaceCapacity(workspaceId,actorId,1,{...address,country:'GB'}),/valid billing address/);
  assert.equal(requests.length,0);
  assert.equal(rpcCalls.length,0);
});
test('older prorated Checkout purchase requests cannot start a new payment',async()=>{
  await assert.rejects(()=>billing.checkoutWorkspaceCapacity(workspaceId,actorId,'owner@example.test',intentId),/older payment review/);
  assert.equal(requests.filter(r=>r.init.method==='POST').length,0);
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

test('invalid billing address fails before any provider request',async()=>{
  await assert.rejects(()=>billing.quoteWorkspaceCapacity(workspaceId,actorId,1,{...address,state:''}),/billing address/);
  assert.equal(requests.length,0);assert.equal(rpcCalls.length,0);
});
test('review retries reuse the bound unpaid invoice without another customer or subscription',async()=>{
  invoiceFixture();
  const first=await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);
  const second=await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);
  assert.equal(first.quoteId,second.quoteId);assert.equal(first.renewalDate,second.renewalDate);
  assert.equal(requests.filter(r=>r.url.endsWith('/subscriptions')&&r.init.method==='POST').length,1);
  assert.equal(requests.filter(r=>r.url.endsWith('/customers')&&r.init.method==='POST').length,1);
  assert.equal(requests.some(r=>r.url.includes('/payment_intents/')),false);
  assert(!JSON.stringify(first).includes('clientSecret'));assert(!JSON.stringify(first).includes('invoice.stripe.com'));
});
test('a customer with a saved default card is rejected before subscription creation',async()=>{
  invoiceFixture();customer.invoice_settings.default_payment_method='pm_previous';
  await assert.rejects(()=>billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address),/new unpaid billing account/);
  assert.equal(requests.some(r=>r.url.endsWith('/subscriptions')),false);
});
test('the invoice must contain exact gross monthly price and completed inclusive tax',async()=>{
  invoiceFixture();invoice.amount_due=1001;
  await assert.rejects(()=>billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address),/exact capacity invoice/);
  invoice.amount_due=1000;invoice.automatic_tax.status='requires_location_inputs';
  await assert.rejects(()=>billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address),/exact capacity invoice/);
});
test('explicit consent releases only a fixed USD PaymentIntent; no hosted payment URL or auto confirmation',async()=>{
  invoiceFixture();await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);intent.terms_accepted_at=new Date().toISOString();
  const result=await billing.checkoutWorkspaceCapacity(workspaceId,actorId,'owner@example.test',intentId);
  assert.equal(result.clientSecret,payment.client_secret);assert.equal(result.amountCents,1000);assert.equal(result.currency,'usd');assert(!('url' in result));
  assert.equal(requests.some(r=>r.url.endsWith('/confirm')||r.url.endsWith('/pay')),false);assert.equal(syncCall(),undefined);
});
test('missing consent and changed PaymentIntent currency cannot expose a payment secret',async()=>{
  invoiceFixture();await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);
  await assert.rejects(()=>billing.checkoutWorkspaceCapacity(workspaceId,actorId,'owner@example.test',intentId),/review and confirm/i);
  intent.terms_accepted_at=new Date().toISOString();payment.currency='eur';
  await assert.rejects(()=>billing.checkoutWorkspaceCapacity(workspaceId,actorId,'owner@example.test',intentId),/reviewed USD payment/);
});
test('quote-time unpaid subscription events are isolated from paid entitlement and the base plan',async()=>{
  invoiceFixture();const result=await billing.processCapacityStripeEvent(admin,event('customer.subscription.created',{id:'sub_capacity'}));
  assert.equal(result.handled,true);assert.equal(syncCall(),undefined);
  await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);intent.terms_accepted_at=new Date().toISOString();
  await billing.processCapacityStripeEvent(admin,event('invoice.payment_failed',{id:'in_capacity'}));assert.equal(syncCall(),undefined);
});
test('invoice payment grants verified inclusive gross price against immutable initial invoice binding',async()=>{
  invoiceFixture();await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);intent.terms_accepted_at=new Date().toISOString();
  subscription.status='active';invoice.paid=true;invoice.status='paid';invoice.amount_paid=1000;invoice.charge=charge.id;
  await billing.processCapacityStripeEvent(admin,event('invoice.paid',{id:invoice.id}));
  assert.equal(syncCall().args.p_session_id,invoice.id);assert.equal(syncCall().args.p_invoices[0].paid_cents,1000);
  assert.equal(requests.some(r=>r.url.includes('/checkout/sessions')),false);
});
test('provider expiration releases an unpaid invoice only after the actual invoice is void',async()=>{
  invoiceFixture();await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);subscription.status='incomplete_expired';
  await assert.rejects(()=>billing.processCapacityStripeEvent(admin,event('customer.subscription.updated',{id:subscription.id})),/expiry has not/);
  invoice.status='void';await billing.processCapacityStripeEvent(admin,event('customer.subscription.updated',{id:subscription.id}));
  assert(rpcCalls.some(r=>r.name==='workspace_capacity_expire_invoice_v1'));assert.equal(syncCall(),undefined);
});
test('a bound pending invoice is not released merely because its local expiry passed',async()=>{
  invoiceFixture();await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);
  pendingIntents=[{id:intent.id,pricingMode:'invoice_monthly',invoiceId:invoice.id,subscriptionId:subscription.id,packs:2,state:'checkout',expiresAt:'2000-01-01T00:00:00Z'}];
  await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);
  assert.equal(rpcCalls.some(r=>r.name==='workspace_capacity_expire_invoice_v1'),false);
  assert.equal(requests.some(r=>r.url.endsWith('/void')),false);
});

async function recoveryFixture(){
  invoiceFixture();await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);
  intent.terms_accepted_at=new Date().toISOString();subscription.status='past_due';invoice.billing_reason='subscription_cycle';
}
test('renewal recovery reviews the current invoice before releasing its existing USD payment',async()=>{
  await recoveryFixture();const quote=await billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,subscription.id);
  assert.equal(quote.amountDueTodayCents,1000);assert.equal(quote.taxIncludedCents,62);assert.equal(quote.periodEnd,quote.renewalDate);assert(!('clientSecret' in quote));
  const result=await billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,subscription.id,invoice.id);
  assert.equal(result.clientSecret,payment.client_secret);assert.equal(result.renewalDate,quote.renewalDate);
  const again=await billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,subscription.id,invoice.id);assert.deepEqual(again,result);
  assert.equal(requests.filter(r=>r.url.endsWith('/subscriptions')&&r.init.method==='POST').length,1);
  assert.equal(requests.some(r=>r.url.endsWith('/confirm')||r.url.endsWith('/pay')),false);
});
test('recovery rejects cross-workspace subscription IDs, changed invoices and already paid invoices',async()=>{
  await recoveryFixture();await assert.rejects(()=>billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,'sub_other'),/does not belong/);
  await assert.rejects(()=>billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,subscription.id,'in_old'),/invoice changed/);
  invoice.paid=true;invoice.status='paid';await assert.rejects(()=>billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,subscription.id,invoice.id),/no unpaid invoice/);
});
test('recovery cannot resurrect canceled subscriptions or sell an expired historical period',async()=>{
  await recoveryFixture();subscription.status='canceled';await assert.rejects(()=>billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,subscription.id),/no eligible overdue/);
  subscription.status='past_due';subscription.current_period_end=100;invoice.lines.data[0].period.end=100;
  await assert.rejects(()=>billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,subscription.id),/current capacity period/);
});
test('scheduled cancellation remains scheduled after recovery review',async()=>{
  await recoveryFixture();subscription.cancel_at_period_end=true;
  const quote=await billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,subscription.id);
  assert.equal(quote.cancelAtPeriodEnd,true);assert.match(quote.cancellationEffect,/Renewal is canceled/);assert.equal(syncCall(),undefined);
});
test('renewal recovery saves a replacement card only after explicit payment consent',async()=>{
  await recoveryFixture();payment.setup_future_usage=null;
  await billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,subscription.id);
  assert.equal(requests.some(r=>r.url.includes('/payment_intents/')&&r.init.method==='POST'),false);
  const result=await billing.recoverWorkspaceCapacityPayment(workspaceId,actorId,subscription.id,invoice.id);
  assert.equal(result.amountCents,1000);assert.equal(payment.setup_future_usage,'off_session');
  const update=requests.find(r=>r.url.includes('/payment_intents/')&&r.init.method==='POST');assert.equal(new URLSearchParams(update.init.body).get('setup_future_usage'),'off_session');
  assert.equal(requests.some(r=>r.url.endsWith('/confirm')||r.url.endsWith('/pay')),false);
});
test('rate limit prevents excess provider preparation without preventing payment retries',async()=>{
  invoiceFixture();await billing.quoteWorkspaceCapacity(workspaceId,actorId,2,address);intent.terms_accepted_at=new Date().toISOString();
  for(let i=0;i<19;i++)await billing.checkoutWorkspaceCapacity(workspaceId,actorId,'owner@example.test',intentId);
  const count=requests.length;await assert.rejects(()=>billing.checkoutWorkspaceCapacity(workspaceId,actorId,'owner@example.test',intentId),/Too many requests/);
  assert.equal(requests.length,count);assert.equal(requests.filter(r=>r.url.endsWith('/subscriptions')&&r.init.method==='POST').length,1);
});
