import "server-only";

import { randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { stripeObjectId, type StripeEvent } from "@/lib/stripe/billing";
import { StorageAccessError } from "@/lib/storage-capacity/access";
import { capacityAllowance, CAPACITY_PACK_MONTHLY_CENTS, MAX_SELF_SERVE_PACKS } from "@/lib/storage-capacity/policy";
import type { CapacityQuote, WorkspaceCapacityBilling } from "@/lib/storage-capacity/billing-contracts";

export const CAPACITY_TERMS_VERSION = "storage-capacity-v1";
const PRODUCT = "workspace_storage_capacity";
// Pin the provider object contract independently of the account's webhook version.
const STRIPE_API_VERSION = "2024-06-20";
type Admin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: {message: string;code?:string} | null}> };
type Intent = {
  id:string;workspace_id:string;actor_id:string;packs:number;current_packs:number;stripe_price_id:string;
  livemode:boolean;terms_version:string;state:string;stripe_session_id:string|null;stripe_customer_id:string|null;
  expires_at:string;created_at:string;pricing_mode?:"full_month"|"fixed_anchor";renewal_at?:string|null;quoted_cents?:number|null;
};
type Price = {id:string;active:boolean;livemode:boolean;currency:string;unit_amount:number;type:string;recurring?:{interval:string;interval_count:number;usage_type:string};tax_behavior?:string;billing_scheme:string};
type Session = {id:string;url?:string;status:string;payment_status:string;expires_at:number;amount_total:number;currency:string;customer:unknown;subscription:unknown;client_reference_id:string;metadata?:Record<string,string>;livemode:boolean};
type Subscription = {id:string;customer:unknown;metadata?:Record<string,string>;status:string;livemode:boolean;cancel_at_period_end:boolean;ended_at:number|null;billing_cycle_anchor:number;items:{data:Array<{quantity:number;price:Price}>};latest_invoice:unknown};
type Charge = {id:string;invoice:unknown;paid:boolean;amount:number;amount_refunded:number;disputed:boolean;currency:string;customer:unknown};
type Invoice = {id:string;customer:unknown;subscription:unknown;billing_reason:string;status:string;paid:boolean;currency:string;amount_paid:number;amount_due:number;charge:unknown;lines:{has_more:boolean;data:Array<{type:string;subscription:unknown;price?:{id:string};quantity:number;amount:number;proration:boolean;period:{start:number;end:number}}>}};
type PaidPeriod = {id:string;packs:number;period_start:string;period_end:string;paid_cents:number;refunded_cents:number;disputed:boolean;initial_period:boolean};

export function capacityBillingMode(): WorkspaceCapacityBilling["mode"] {
  const key = process.env.STRIPE_SECRET_KEY || "";
  return key.startsWith("sk_test_") || key.startsWith("rk_test_") ? "test" : key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "unavailable";
}
export function capacityPurchasesEnabled() {
  return Boolean(process.env.STRIPE_PRICE_WORKSPACE_CAPACITY_MONTHLY && process.env.NEXT_PUBLIC_APP_URL
    && (capacityBillingMode() === "test" || (capacityBillingMode() === "live"
      && process.env.WORKSPACE_CAPACITY_PURCHASES_APPROVED_TERMS === CAPACITY_TERMS_VERSION)));
}
function adminClient(): Admin {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new StorageAccessError(503,"Capacity billing is temporarily unavailable.");
  return admin;
}
async function rpc<T>(admin:Admin,name:string,args:Record<string,unknown>):Promise<T> {
  const {data,error} = await (admin as unknown as RpcClient).rpc(name,args);
  if(error) throw new StorageAccessError(error.code === "42501" ? 403 : 409,error.message);
  return data as T;
}
async function stripe<T>(path:string,params?:URLSearchParams,idempotencyKey?:string):Promise<T> {
  const key=process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StorageAccessError(503,"Capacity billing is temporarily unavailable.");
  const response=await fetch(`https://api.stripe.com/v1${path}`,{
    method:params?"POST":"GET",cache:"no-store",signal:AbortSignal.timeout(20_000),
    headers:{Authorization:`Bearer ${key}`,"Stripe-Version":STRIPE_API_VERSION,
      ...(params?{"Content-Type":"application/x-www-form-urlencoded"}:{}),...(idempotencyKey?{"Idempotency-Key":idempotencyKey}:{})},
    ...(params?{body:params.toString()}:{})
  });
  if(!response.ok) throw new StorageAccessError(503,"Stripe could not confirm capacity billing. Please try again.");
  return await response.json() as T;
}
function requirePurchasesEnabled() {
  if(!capacityPurchasesEnabled()) throw new StorageAccessError(503,"Capacity purchases are awaiting release approval. Existing capacity and files remain available.");
}
export function validateCapacityPrice(price:Price) {
  if(!price.active || price.currency!=="usd" || price.unit_amount!==CAPACITY_PACK_MONTHLY_CENTS || price.type!=="recurring"
    || price.recurring?.interval!=="month" || price.recurring.interval_count!==1 || price.recurring.usage_type!=="licensed"
    || price.billing_scheme!=="per_unit" || price.livemode!==(capacityBillingMode()==="live")) {
    throw new StorageAccessError(503,"The capacity price does not match the approved $5 monthly pack.");
  }
}
async function verifiedPrice() {
  const id=process.env.STRIPE_PRICE_WORKSPACE_CAPACITY_MONTHLY;
  if(!id) throw new StorageAccessError(503,"Capacity pricing is not configured.");
  const price=await stripe<Price>(`/prices/${encodeURIComponent(id)}`);
  validateCapacityPrice(price);return price;
}
async function verifyCapacityCustomer(customerId:string|null) {
  if(!customerId)return;
  const customer=await stripe<{balance:number;discount:unknown;deleted?:boolean}>(`/customers/${encodeURIComponent(customerId)}`);
  if(customer.deleted || customer.balance!==0 || customer.discount) {
    throw new StorageAccessError(409,"This workspace's capacity billing account needs a billing review before another purchase. No payment has been taken.");
  }
}
export function nextMonthlyDate(value:string) {
  const date=new Date(value); const day=date.getUTCDate();
  date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1);
  const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,lastDay));return date.toISOString();
}
function quoteFromIntent(intent:Intent,existingMonthlyCents:number):CapacityQuote {
  const allowance=capacityAllowance(intent.current_packs+intent.packs);
  return {quoteId:intent.id,workspaceId:intent.workspace_id,packs:intent.packs,currentPacks:intent.current_packs,
    totalPacks:intent.current_packs+intent.packs,totalBytes:allowance.bytes,totalFiles:allowance.files,currency:"usd",
    monthlyCents:intent.packs*CAPACITY_PACK_MONTHLY_CENTS,existingMonthlyCents,
    amountDueTodayCents:intent.quoted_cents ?? intent.packs*CAPACITY_PACK_MONTHLY_CENTS,renewalDate:intent.renewal_at || nextMonthlyDate(new Date().toISOString()),
    expiresAt:intent.expires_at,termsVersion:intent.terms_version,
    cancellationEffect:"Cancel renewal at any time. Purchased capacity ends at the end of its paid period. Files are retained; only new uploads exceeding the remaining allowance are blocked.",
    checkoutTerms:"Each purchase is a separate monthly subscription renewing on the date shown. The first period may be prorated; Stripe shows the current amount before payment, up to the amount reviewed here. Subsequent periods cost $5 USD per pack per month. No automatic additional packs or usage overage charges. Partial refunds keep capacity; full refunds and active or lost payment disputes withdraw the affected paid period. A won dispute or closed inquiry restores any remaining eligible paid period."};
}

async function state(admin:Admin,workspaceId:string,actorId:string) {
  return rpc<{committedPacks:number;subscriptions:WorkspaceCapacityBilling["subscriptions"];pendingIntents:Array<{id:string;sessionId:string|null;packs:number;state:string}>}>(admin,"workspace_capacity_state_v1",{p_workspace_id:workspaceId,p_actor_id:actorId});
}
async function recoverExpiredCheckouts(admin:Admin,workspaceId:string,actorId:string,requestedPacks:number) {
  const current=await state(admin,workspaceId,actorId);
  for(const pending of current.pendingIntents) {
    if(!pending.sessionId) continue;
    let session=await stripe<Session>(`/checkout/sessions/${encodeURIComponent(pending.sessionId)}`);
    if(session.status==="open" && pending.state==="quoted" && pending.packs!==requestedPacks) {
      session=await stripe<Session>(`/checkout/sessions/${encodeURIComponent(session.id)}/expire`,new URLSearchParams());
    }
    if(session.status==="expired") await rpc(admin,"workspace_capacity_expire_v1",{p_intent_id:pending.id,p_session_id:session.id});
    else if(session.status==="complete" && stripeObjectId(session.subscription)) {
      await syncCapacitySubscription(admin,stripeObjectId(session.subscription)!,`reconcile:${randomUUID()}`,"checkout.reconciled");
    }
  }
}
export async function getWorkspaceCapacityBilling(workspaceId:string,actorId?:string):Promise<WorkspaceCapacityBilling> {
  if(!actorId) {
    const client=await createSupabaseServerClient();const result=await client?.auth.getUser();actorId=result?.data.user?.id;
  }
  if(!actorId) throw new StorageAccessError(401,"Sign in to manage capacity.");
  const result=await state(adminClient(),workspaceId,actorId);
  return {purchasesEnabled:capacityPurchasesEnabled(),mode:capacityBillingMode(),maxPacks:MAX_SELF_SERVE_PACKS,committedPacks:result.committedPacks,subscriptions:result.subscriptions};
}
export async function quoteWorkspaceCapacity(workspaceId:string,actorId:string,packs:number) {
  requirePurchasesEnabled();
  if(!Number.isSafeInteger(packs) || packs<1 || packs>MAX_SELF_SERVE_PACKS) throw new StorageAccessError(400,"Choose between 1 and 10 capacity packs.");
  const admin=adminClient();await recoverExpiredCheckouts(admin,workspaceId,actorId,packs);
  const price=await verifiedPrice();
  const intent=await rpc<Intent>(admin,"workspace_capacity_quote_v1",{p_workspace_id:workspaceId,p_actor_id:actorId,p_packs:packs,p_price_id:price.id,p_livemode:price.livemode,p_terms_version:CAPACITY_TERMS_VERSION});
  await verifyCapacityCustomer(intent.stripe_customer_id);
  // Preparing an unpaid Checkout provides Stripe's actual first-period amount.
  // The payment URL is withheld until the owner accepts this exact review.
  await prepareCheckout(admin,intent,price,actorId);
  const current=await state(admin,workspaceId,actorId);
  // Paid capacity can outlast a canceled renewal, while a failed/refunded
  // subscription may still renew. Price the recurring commitments separately.
  const existingMonthlyCents=current.subscriptions
    .filter(subscription=>!subscription.cancelAtPeriodEnd && !["canceled","incomplete_expired"].includes(subscription.status))
    .reduce((total,subscription)=>total+subscription.monthlyCents,0);
  return quoteFromIntent(intent,existingMonthlyCents);
}
export async function checkoutWorkspaceCapacity(workspaceId:string,actorId:string,email:string,quoteId:string) {
  requirePurchasesEnabled();const admin=adminClient();const price=await verifiedPrice();
  const intent=await rpc<Intent>(admin,"workspace_capacity_confirm_v1",{p_workspace_id:workspaceId,p_actor_id:actorId,p_intent_id:quoteId});
  if(intent.stripe_price_id!==price.id || intent.livemode!==price.livemode) throw new StorageAccessError(409,"Capacity pricing changed. Review a new quote.");
  await verifyCapacityCustomer(intent.stripe_customer_id);
  if(intent.stripe_session_id) {
    const existing=await stripe<Session>(`/checkout/sessions/${encodeURIComponent(intent.stripe_session_id)}`);
    if(existing.status==="open" && existing.url) return {url:existing.url};
    if(existing.status==="complete") return {url:`${getAppUrl()}/app/settings/storage?checkout=complete`};
    await rpc(admin,"workspace_capacity_expire_v1",{p_intent_id:intent.id,p_session_id:existing.id});
    throw new StorageAccessError(409,"Checkout expired. Review a new quote.");
  }
  const session=await prepareCheckout(admin,intent,price,actorId,email);
  return {url:session.url};
}
async function prepareCheckout(admin:Admin,intent:Intent,price:Price,actorId:string,email?:string) {
  if(intent.stripe_session_id) {
    const existing=await stripe<Session>(`/checkout/sessions/${encodeURIComponent(intent.stripe_session_id)}`);
    if(existing.status!=="open" || !existing.url)throw new StorageAccessError(409,"This checkout is no longer open. Refresh usage before buying capacity.");
    await recordQuoteAmount(admin,intent,actorId,existing);return existing;
  }
  if(!email) {
    const {data,error}=await admin.auth.admin.getUserById(actorId);
    if(error || !data.user?.email || !data.user.email_confirmed_at)throw new StorageAccessError(403,"Verify your email before reviewing capacity checkout.");
    email=data.user.email;
  }
  const workspaceId=intent.workspace_id;
  const params=new URLSearchParams({mode:"subscription",client_reference_id:intent.id,
    "line_items[0][price]":price.id,"line_items[0][quantity]":String(intent.packs),"payment_method_types[0]":"card",
    allow_promotion_codes:"false","automatic_tax[enabled]":"false","adaptive_pricing[enabled]":"false",
    billing_address_collection:"auto",expires_at:String(Math.floor(Date.now()/1000)+1800),
    success_url:`${getAppUrl()}/app/settings/storage?checkout=complete`,cancel_url:`${getAppUrl()}/app/settings/storage?checkout=cancelled`,
    "custom_text[submit][message]":`First renewal: ${intent.renewal_at ? new Date(intent.renewal_at).toUTCString() : "one month after purchase"}. Then $${(intent.packs*5).toFixed(2)} USD monthly. Capacity applies only to this workspace. Cancel renewal at any time; existing files are retained. No automatic additional packs or usage overage charges.`,
    "metadata[product]":PRODUCT,"metadata[capacity_intent_id]":intent.id,"metadata[workspace_id]":workspaceId,
    "subscription_data[metadata][product]":PRODUCT,"subscription_data[metadata][capacity_intent_id]":intent.id,
    "subscription_data[metadata][workspace_id]":workspaceId});
  if(intent.pricing_mode==="fixed_anchor" && intent.renewal_at) {
    params.set("subscription_data[billing_cycle_anchor]",String(Math.floor(new Date(intent.renewal_at).getTime()/1000)));
    params.set("subscription_data[proration_behavior]","create_prorations");
  }
  if(intent.stripe_customer_id)params.set("customer",intent.stripe_customer_id);else params.set("customer_email",email);
  const session=await stripe<Session>("/checkout/sessions",params,`workspace-capacity:${intent.id}`);
  if(!session.id || !session.url || session.client_reference_id!==intent.id) throw new StorageAccessError(503,"Stripe did not return a valid capacity checkout.");
  await rpc(admin,"workspace_capacity_record_checkout_v1",{p_workspace_id:workspaceId,p_actor_id:actorId,p_intent_id:intent.id,
    p_session_id:session.id,p_customer_id:stripeObjectId(session.customer)||"",p_expires_at:new Date(session.expires_at*1000).toISOString()});
  intent.stripe_session_id=session.id;
  await recordQuoteAmount(admin,intent,actorId,session);
  return session;
}
async function recordQuoteAmount(admin:Admin,intent:Intent,actorId:string,session:Session) {
  if(session.currency!=="usd" || !Number.isSafeInteger(session.amount_total) || session.amount_total<=0 || session.amount_total>intent.packs*500) {
    throw new StorageAccessError(503,"Stripe did not return the expected capacity amount. No purchase has been confirmed.");
  }
  await rpc(admin,"workspace_capacity_record_quote_price_v1",{p_workspace_id:intent.workspace_id,p_actor_id:actorId,p_intent_id:intent.id,p_quoted_cents:session.amount_total});
  intent.quoted_cents=session.amount_total;intent.expires_at=new Date(session.expires_at*1000).toISOString();
}

export function capacityInvoicePeriod(invoice:Invoice,subscription:Subscription,priceId:string,packs:number,charge:Charge|null,intent?:Intent):PaidPeriod|null {
  if(invoice.status!=="paid" || !invoice.paid) return null;
  const customer=stripeObjectId(subscription.customer);
  if(stripeObjectId(invoice.subscription)!==subscription.id || stripeObjectId(invoice.customer)!==customer
    || invoice.currency!=="usd" || invoice.amount_paid<=0 || invoice.amount_due!==invoice.amount_paid
    || invoice.lines.has_more || invoice.lines.data.length!==1) throw new Error("Capacity invoice attribution or price is invalid.");
  const line=invoice.lines.data[0];
  const initialPeriod=Boolean(intent?.pricing_mode==="fixed_anchor" && invoice.billing_reason==="subscription_create" && line.proration);
  if((line.type!=="subscription" && !(initialPeriod && line.type==="invoiceitem")) || stripeObjectId(line.subscription)!==subscription.id || line.price?.id!==priceId || line.quantity!==packs
    || line.amount!==invoice.amount_paid || (!initialPeriod && (line.proration || invoice.amount_paid!==packs*500))
    || (initialPeriod && (invoice.amount_paid>(intent?.quoted_cents??0) || line.period.end!==Math.floor(new Date(intent?.renewal_at||"").getTime()/1000)))
    || !Number.isSafeInteger(line.period.start) || !Number.isSafeInteger(line.period.end)
    || line.period.end<=line.period.start) throw new Error("Capacity invoice period is invalid.");
  // No capacity is issued for manual/out-of-band payment, credits, trials or a failed card charge.
  if(!charge || !charge.paid || stripeObjectId(invoice.charge)!==charge.id || stripeObjectId(charge.invoice)!==invoice.id
    || stripeObjectId(charge.customer)!==customer || charge.currency!=="usd" || charge.amount!==invoice.amount_paid) {
    throw new Error("Capacity requires a verified successful Stripe payment.");
  }
  return {id:invoice.id,packs,period_start:new Date(line.period.start*1000).toISOString(),period_end:new Date(line.period.end*1000).toISOString(),
    paid_cents:invoice.amount_paid,refunded_cents:charge.amount_refunded,disputed:charge.disputed,initial_period:initialPeriod};
}

async function syncCapacitySubscription(admin:Admin,subscriptionId:string,eventKey:string,eventType:string,additionalInvoiceId?:string|null) {
  const checkedAt=new Date().toISOString();
  const subscription=await stripe<Subscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if(subscription.metadata?.product!==PRODUCT) return null;
  const intentId=subscription.metadata.capacity_intent_id;
  if(!intentId || !/^[0-9a-f-]{36}$/i.test(intentId)) throw new Error("Capacity subscription has no trusted purchase intent.");
  const intent=await rpc<Intent|null>(admin,"workspace_capacity_provider_intent_v1",{p_intent_id:intentId});
  if(!intent || !intent.stripe_session_id) throw new Error("Capacity Checkout attribution is pending.");
  const session=await stripe<Session>(`/checkout/sessions/${encodeURIComponent(intent.stripe_session_id)}`);
  if(session.client_reference_id!==intent.id || session.metadata?.capacity_intent_id!==intent.id || session.metadata.product!==PRODUCT
    || session.status!=="complete" || stripeObjectId(session.subscription)!==subscription.id
    || stripeObjectId(session.customer)!==stripeObjectId(subscription.customer) || session.livemode!==intent.livemode
    || subscription.livemode!==intent.livemode || subscription.metadata.workspace_id!==intent.workspace_id
    || subscription.items.data.length!==1 || subscription.items.data[0].price.id!==intent.stripe_price_id
    || subscription.items.data[0].quantity!==intent.packs) throw new Error("Capacity subscription does not match its confirmed workspace purchase.");
  if(intent.pricing_mode==="fixed_anchor" && subscription.billing_cycle_anchor!==Math.floor(new Date(intent.renewal_at||"").getTime()/1000)) {
    throw new Error("Capacity renewal date does not match the accepted review.");
  }
  // Current provider objects decide entitlement, never a stale event snapshot or success redirect.
  const invoices=await stripe<{data:Invoice[]}>(`/invoices?subscription=${encodeURIComponent(subscription.id)}&status=paid&limit=10`);
  const now=Math.floor(Date.now()/1000);
  const selected=new Map<string,Invoice>();
  // Persisted prior periods already expire without another provider lookup.
  // Reconcile the latest paid invoice, currently covering periods, and the
  // explicit event invoice (especially an older refunded invoice).
  if(invoices.data[0])selected.set(invoices.data[0].id,invoices.data[0]);
  for(const invoice of invoices.data) {
    if(invoice.lines.data.some(line=>line.period.start<=now && line.period.end>now))selected.set(invoice.id,invoice);
  }
  if(additionalInvoiceId && !selected.has(additionalInvoiceId)) {
    selected.set(additionalInvoiceId,invoices.data.find(invoice=>invoice.id===additionalInvoiceId)
      || await stripe<Invoice>(`/invoices/${encodeURIComponent(additionalInvoiceId)}`));
  }
  if(selected.size>3)throw new Error("Capacity has overlapping billing periods and requires billing review.");
  const reconciled=await Promise.all([...selected.values()].map(async invoice=>{
    const chargeId=stripeObjectId(invoice.charge);
    const charge=chargeId?await stripe<Charge>(`/charges/${encodeURIComponent(chargeId)}`):null;
    if(charge?.disputed) {
      const disputes=await stripe<{data:Array<{charge:unknown;status:string}>;has_more:boolean}>(`/disputes?charge=${encodeURIComponent(charge.id)}&limit=100`);
      if(disputes.has_more || !disputes.data.length || disputes.data.some(dispute=>stripeObjectId(dispute.charge)!==charge.id
        || !["warning_needs_response","warning_under_review","warning_closed","needs_response","under_review","won","lost"].includes(dispute.status))) {
        throw new Error("Capacity payment dispute status could not be verified.");
      }
      charge.disputed=disputes.data.some(dispute=>["needs_response","under_review","lost"].includes(dispute.status));
    }
    const period=capacityInvoicePeriod(invoice,subscription,intent.stripe_price_id,intent.packs,charge,intent);
    return period;
  }));
  const periods=reconciled.filter((period):period is PaidPeriod=>period!==null);
  return rpc<{workspace_id:string;paid_packs:number}>(admin,"workspace_capacity_sync_v1",{
    p_event_key:eventKey,p_event_type:eventType,p_intent_id:intent.id,p_session_id:session.id,p_subscription_id:subscription.id,
    p_customer_id:stripeObjectId(subscription.customer),p_price_id:intent.stripe_price_id,p_livemode:intent.livemode,
    p_packs:intent.packs,p_status:subscription.status,p_cancel_at_period_end:subscription.cancel_at_period_end,
    p_ended_at:subscription.ended_at?new Date(subscription.ended_at*1000).toISOString():null,p_checked_at:checkedAt,p_invoices:periods});
}

export async function cancelWorkspaceCapacity(workspaceId:string,actorId:string,subscriptionId:string) {
  const admin=adminClient();const current=await state(admin,workspaceId,actorId);
  const owned=current.subscriptions.find(subscription=>subscription.id===subscriptionId);
  if(!owned) throw new StorageAccessError(403,"This capacity subscription does not belong to this workspace.");
  await stripe<Subscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`,new URLSearchParams({cancel_at_period_end:"true"}),`capacity-cancel:${subscriptionId}`);
  await syncCapacitySubscription(admin,subscriptionId,`owner-cancel:${randomUUID()}`,"owner.cancel_requested");
  return {endsAt:owned.paidThrough};
}

/** Called only after the shared route has verified Stripe's webhook signature. */
export async function processCapacityStripeEvent(admin:Admin,event:StripeEvent):Promise<{handled:boolean;workspaceId?:string}> {
  const object=event.data.object;let subscriptionId:string|null=null;let invoiceId:string|null=null;
  if(event.type.startsWith("checkout.session.")) {
    if((object.metadata as Record<string,string>|undefined)?.product!==PRODUCT)return {handled:false};
    const session=await stripe<Session>(`/checkout/sessions/${encodeURIComponent(String(object.id))}`);
    if(session.metadata?.product!==PRODUCT)throw new Error("Capacity session attribution mismatch.");
    if(session.status==="expired") {
      await rpc(admin,"workspace_capacity_expire_v1",{p_intent_id:session.metadata.capacity_intent_id,p_session_id:session.id});return {handled:true};
    }
    subscriptionId=stripeObjectId(session.subscription);
    if(!subscriptionId || session.status!=="complete")return {handled:true};
  } else if(event.type.startsWith("customer.subscription.")) subscriptionId=String(object.id);
  else if(event.type.startsWith("invoice.")) {
    const invoice=await stripe<Invoice>(`/invoices/${encodeURIComponent(String(object.id))}`);
    invoiceId=invoice.id;subscriptionId=stripeObjectId(invoice.subscription);
  } else if(event.type==="charge.refunded" || event.type.startsWith("charge.dispute.") || event.type.startsWith("refund.")) {
    const chargeId=event.type==="charge.refunded"?String(object.id):stripeObjectId(object.charge);
    if(!chargeId)return {handled:false};
    const charge=await stripe<Charge>(`/charges/${encodeURIComponent(chargeId)}`);invoiceId=stripeObjectId(charge.invoice);
    if(invoiceId){const invoice=await stripe<Invoice>(`/invoices/${encodeURIComponent(invoiceId)}`);subscriptionId=stripeObjectId(invoice.subscription);}
  }
  if(!subscriptionId)return {handled:false};
  const result=await syncCapacitySubscription(admin,subscriptionId,event.id,event.type,invoiceId);
  return result?{handled:true,workspaceId:result.workspace_id}:{handled:false};
}
