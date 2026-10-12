import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { stripeObjectId, type StripeEvent } from "@/lib/stripe/billing";
import { StorageAccessError } from "@/lib/storage-capacity/access";
import { capacityAllowance, CAPACITY_PACK_MONTHLY_CENTS, MAX_SELF_SERVE_PACKS } from "@/lib/storage-capacity/policy";
import type { CapacityBillingAddress, CapacityPaymentSession, CapacityQuote, CapacityRecoveryQuote, WorkspaceCapacityBilling } from "@/lib/storage-capacity/billing-contracts";
import { capacityBillingAddressSchema } from "@/lib/storage-capacity/billing-address";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";

export const CAPACITY_TERMS_VERSION = "storage-capacity-v1";
const PRODUCT = "workspace_storage_capacity";
// Pin the provider object contract independently of the account's webhook version.
const STRIPE_API_VERSION = "2024-06-20";
type Admin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type RpcClient = { rpc(name: string, args: Record<string, unknown>): PromiseLike<{data: unknown; error: {message: string;code?:string} | null}> };
type Intent = {
  id:string;workspace_id:string;actor_id:string;packs:number;current_packs:number;stripe_price_id:string;
  livemode:boolean;terms_version:string;state:string;stripe_session_id:string|null;stripe_customer_id:string|null;
  expires_at:string;created_at:string;pricing_mode?:"full_month"|"fixed_anchor"|"invoice_monthly";renewal_at?:string|null;quoted_cents?:number|null;
  stripe_initial_invoice_id?:string|null;stripe_subscription_id?:string|null;billing_address_hash?:string|null;
  terms_accepted_at?:string|null;
};
type Price = {id:string;active:boolean;livemode:boolean;currency:string;unit_amount:number;type:string;recurring?:{interval:string;interval_count:number;usage_type:string};tax_behavior?:string;billing_scheme:string};
type Session = {id:string;url?:string;status:string;payment_status:string;expires_at:number;amount_total:number;currency:string;customer:unknown;subscription:unknown;client_reference_id:string;metadata?:Record<string,string>;livemode:boolean};
type Subscription = {id:string;customer:unknown;metadata?:Record<string,string>;status:string;livemode:boolean;cancel_at_period_end:boolean;ended_at:number|null;billing_cycle_anchor:number;current_period_start:number;current_period_end:number;created:number;automatic_tax?:{enabled:boolean};payment_settings?:{save_default_payment_method:string};items:{data:Array<{quantity:number;price:Price}>};latest_invoice:unknown};
type Charge = {id:string;invoice:unknown;paid:boolean;amount:number;amount_refunded:number;disputed:boolean;currency:string;customer:unknown};
type Invoice = {id:string;customer:unknown;subscription:unknown;billing_reason:string;status:string;paid:boolean;currency:string;amount_paid:number;amount_due:number;charge:unknown;payment_intent?:unknown;total?:number;tax?:number;automatic_tax?:{enabled:boolean;status:string|null};auto_advance?:boolean;lines:{has_more:boolean;data:Array<{type:string;subscription:unknown;price?:{id:string;tax_behavior?:string};quantity:number;amount:number;proration:boolean;period:{start:number;end:number}}>}};
type PaymentIntent = {id:string;client_secret:string|null;customer:unknown;invoice:unknown;amount:number;currency:string;livemode:boolean;status:string;setup_future_usage:string|null;payment_method_types:string[]};
type PaidPeriod = {id:string;packs:number;period_start:string;period_end:string;paid_cents:number;refunded_cents:number;disputed:boolean;initial_period:boolean};

export function capacityBillingMode(): WorkspaceCapacityBilling["mode"] {
  const key = process.env.STRIPE_SECRET_KEY || "";
  return key.startsWith("sk_test_") || key.startsWith("rk_test_") ? "test" : key.startsWith("sk_live_") || key.startsWith("rk_live_") ? "live" : "unavailable";
}
export function capacityPurchasesEnabled() {
  return Boolean(process.env.STRIPE_PRICE_WORKSPACE_CAPACITY_MONTHLY && process.env.NEXT_PUBLIC_APP_URL
    && process.env.STRIPE_PUBLISHABLE_KEY?.startsWith(`pk_${capacityBillingMode()}_`)
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
  if(!response.ok) {
    const error=await response.json().catch(()=>null) as {error?:{code?:string}}|null;
    if(error?.error?.code==="customer_tax_location_invalid")throw new StorageAccessError(400,"Stripe could not validate the billing address. Check the address and postal code before continuing.");
    throw new StorageAccessError(503,"Stripe could not confirm capacity billing. Please try again.");
  }
  return await response.json() as T;
}
function requirePurchasesEnabled() {
  if(!capacityPurchasesEnabled()) throw new StorageAccessError(503,"Capacity purchases are awaiting release approval. Existing capacity and files remain available.");
}
async function limitPaymentPreparation(workspaceId:string,actorId:string) {
  const limit=await enforceRateLimit({action:"storage.capacity.payment",limit:20,windowSeconds:600,workspaceId,userId:actorId,strict:true});
  if(!limit.allowed)throw new StorageAccessError(429,rateLimitMessage(limit));
}
export function validateCapacityPrice(price:Price) {
  if(!price.active || price.currency!=="usd" || price.unit_amount!==CAPACITY_PACK_MONTHLY_CENTS || price.type!=="recurring"
    || price.recurring?.interval!=="month" || price.recurring.interval_count!==1 || price.recurring.usage_type!=="licensed"
    || price.billing_scheme!=="per_unit" || price.tax_behavior!=="inclusive" || price.livemode!==(capacityBillingMode()==="live")) {
    throw new StorageAccessError(503,"The capacity price does not match the approved $5 monthly pack.");
  }
}
async function verifiedPrice() {
  const id=process.env.STRIPE_PRICE_WORKSPACE_CAPACITY_MONTHLY;
  if(!id) throw new StorageAccessError(503,"Capacity pricing is not configured.");
  const price=await stripe<Price>(`/prices/${encodeURIComponent(id)}`);
  validateCapacityPrice(price);return price;
}
export function nextMonthlyDate(value:string) {
  const date=new Date(value); const day=date.getUTCDate();
  date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1);
  const lastDay=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();
  date.setUTCDate(Math.min(day,lastDay));return date.toISOString();
}
function quoteFromIntent(intent:Intent,existingMonthlyCents:number,invoice:Invoice):CapacityQuote {
  const allowance=capacityAllowance(intent.current_packs+intent.packs);
  return {quoteId:intent.id,workspaceId:intent.workspace_id,packs:intent.packs,currentPacks:intent.current_packs,
    totalPacks:intent.current_packs+intent.packs,totalBytes:allowance.bytes,totalFiles:allowance.files,currency:"usd",
    monthlyCents:intent.packs*CAPACITY_PACK_MONTHLY_CENTS,existingMonthlyCents,
    amountDueTodayCents:invoice.amount_due,taxIncludedCents:invoice.tax||0,renewalDate:intent.renewal_at!,
    expiresAt:intent.expires_at,termsVersion:intent.terms_version,
    cancellationEffect:"Cancel renewal at any time. Purchased capacity ends at the end of its paid period. Files are retained; only new uploads exceeding the remaining allowance are blocked.",
    checkoutTerms:"Each purchase is a separate monthly subscription: $5 USD per pack for the first month and each monthly renewal, with applicable tax included. There is no proration or added tax at payment. The first renewal is on the exact date shown. By confirming, you authorize Stripe to save your payment method for these monthly renewals. No automatic additional packs or usage overage charges. Partial refunds keep capacity; full refunds and active or lost payment disputes withdraw the affected paid period. A won dispute or closed inquiry restores any remaining eligible paid period."};
}

async function state(admin:Admin,workspaceId:string,actorId:string) {
  return rpc<{committedPacks:number;subscriptions:WorkspaceCapacityBilling["subscriptions"];pendingIntents:Array<{id:string;sessionId:string|null;packs:number;state:string;pricingMode?:string;subscriptionId?:string|null;invoiceId?:string|null;expiresAt?:string;addressHash?:string|null}>}>(admin,"workspace_capacity_state_v1",{p_workspace_id:workspaceId,p_actor_id:actorId});
}
async function recoverExpiredCheckouts(admin:Admin,workspaceId:string,actorId:string,requestedPacks:number,addressHash:string) {
  const current=await state(admin,workspaceId,actorId);
  for(const pending of current.pendingIntents) {
    if(pending.pricingMode==="invoice_monthly") {
      if(!pending.invoiceId)continue;
      let invoice=await stripe<Invoice>(`/invoices/${encodeURIComponent(pending.invoiceId)}`);
      if(invoice.status==="open" && pending.state==="quoted" && (pending.packs!==requestedPacks || pending.addressHash!==addressHash)) {
        // Stripe refuses to void a paid invoice, making the payment/expiry race safe.
        try { invoice=await stripe<Invoice>(`/invoices/${encodeURIComponent(invoice.id)}/void`,new URLSearchParams(),`capacity-void:${invoice.id}`); }
        catch { invoice=await stripe<Invoice>(`/invoices/${encodeURIComponent(invoice.id)}`); if(invoice.status!=="paid" && invoice.status!=="void")throw new StorageAccessError(409,"The previous capacity invoice is still open. Finish it before reviewing another purchase."); }
      }
      if(invoice.status==="void")await rpc(admin,"workspace_capacity_expire_invoice_v1",{p_intent_id:pending.id,p_invoice_id:invoice.id});
      else if(invoice.status==="paid" && pending.subscriptionId)await syncCapacitySubscription(admin,pending.subscriptionId,`reconcile:${randomUUID()}`,"invoice.reconciled",invoice.id);
      continue;
    }
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
export async function quoteWorkspaceCapacity(workspaceId:string,actorId:string,packs:number,billingAddress:CapacityBillingAddress) {
  requirePurchasesEnabled();
  if(!Number.isSafeInteger(packs) || packs<1 || packs>MAX_SELF_SERVE_PACKS) throw new StorageAccessError(400,"Choose between 1 and 10 capacity packs.");
  const parsed=capacityBillingAddressSchema.safeParse(billingAddress);
  if(!parsed.success)throw new StorageAccessError(400,"Enter a complete, valid billing address before reviewing capacity.");
  await limitPaymentPreparation(workspaceId,actorId);
  const address=parsed.data;
  const addressHash=createHash("sha256").update(JSON.stringify([address.line1,address.line2||"",address.city,address.state||"",address.postalCode||"",address.country])).digest("hex");
  const admin=adminClient();await recoverExpiredCheckouts(admin,workspaceId,actorId,packs,addressHash);
  const price=await verifiedPrice();
  const intent=await rpc<Intent>(admin,"workspace_capacity_invoice_quote_v1",{p_workspace_id:workspaceId,p_actor_id:actorId,p_packs:packs,p_price_id:price.id,p_livemode:price.livemode,p_terms_version:CAPACITY_TERMS_VERSION,p_address_hash:addressHash});
  const invoice=await prepareCapacityInvoice(admin,intent,price,actorId,address);
  const current=await state(admin,workspaceId,actorId);
  // Paid capacity can outlast a canceled renewal, while a failed/refunded
  // subscription may still renew. Price the recurring commitments separately.
  const existingMonthlyCents=current.subscriptions
    .filter(subscription=>!subscription.cancelAtPeriodEnd && !["canceled","incomplete_expired"].includes(subscription.status))
    .reduce((total,subscription)=>total+subscription.monthlyCents,0);
  return quoteFromIntent(intent,existingMonthlyCents,invoice);
}
export async function checkoutWorkspaceCapacity(workspaceId:string,actorId:string,_email:string,quoteId:string):Promise<CapacityPaymentSession> {
  requirePurchasesEnabled();await limitPaymentPreparation(workspaceId,actorId);const admin=adminClient();const price=await verifiedPrice();
  const intent=await rpc<Intent>(admin,"workspace_capacity_confirm_v1",{p_workspace_id:workspaceId,p_actor_id:actorId,p_intent_id:quoteId});
  if(intent.stripe_price_id!==price.id || intent.livemode!==price.livemode) throw new StorageAccessError(409,"Capacity pricing changed. Review a new quote.");
  if(intent.pricing_mode==="invoice_monthly") {
    if(!intent.stripe_initial_invoice_id || !intent.stripe_subscription_id || !intent.terms_accepted_at)throw new StorageAccessError(409,"Review and confirm this workspace's capacity invoice before paying.");
    const [invoice,subscription]=await Promise.all([
      stripe<Invoice>(`/invoices/${encodeURIComponent(intent.stripe_initial_invoice_id)}`),
      stripe<Subscription>(`/subscriptions/${encodeURIComponent(intent.stripe_subscription_id)}`)
    ]);
    verifyUnpaidCapacityInvoice(intent,subscription,invoice);
    const paymentIntentId=stripeObjectId(invoice.payment_intent);
    if(!paymentIntentId)throw new StorageAccessError(503,"Stripe did not return the reviewed capacity payment.");
    const payment=await stripe<PaymentIntent>(`/payment_intents/${encodeURIComponent(paymentIntentId)}`);
    if(payment.invoice!==invoice.id || stripeObjectId(payment.customer)!==intent.stripe_customer_id
      || payment.amount!==intent.packs*500 || payment.currency!=="usd" || payment.livemode!==intent.livemode
      || !payment.client_secret || !["requires_payment_method","requires_confirmation","requires_action"].includes(payment.status)
      || payment.payment_method_types.length!==1 || payment.payment_method_types[0]!=="card" || payment.setup_future_usage!=="off_session") {
      throw new StorageAccessError(409,"The reviewed USD payment cannot be confirmed. Refresh usage before attempting another payment.");
    }
    return {clientSecret:payment.client_secret,publishableKey:process.env.STRIPE_PUBLISHABLE_KEY!,amountCents:payment.amount,currency:"usd",renewalDate:intent.renewal_at!};
  }
  throw new StorageAccessError(409,"This older payment review is no longer available. Review a new exact-price capacity purchase.");
}

export async function recoverWorkspaceCapacityPayment(workspaceId:string,actorId:string,subscriptionId:string,acceptedInvoiceId?:string):Promise<CapacityRecoveryQuote|CapacityPaymentSession> {
  // Recovery remains available when new purchases are disabled for a rollout.
  if(!process.env.STRIPE_PUBLISHABLE_KEY?.startsWith(`pk_${capacityBillingMode()}_`))throw new StorageAccessError(503,"Capacity payment recovery is temporarily unavailable.");
  await limitPaymentPreparation(workspaceId,actorId);
  const admin=adminClient();const current=await state(admin,workspaceId,actorId);
  if(!current.subscriptions.some(item=>item.id===subscriptionId))throw new StorageAccessError(403,"This capacity subscription does not belong to this workspace.");
  const subscription=await stripe<Subscription>(`/subscriptions/${encodeURIComponent(subscriptionId)}`);
  const intentId=subscription.metadata?.capacity_intent_id;
  const intent=intentId?await rpc<Intent|null>(admin,"workspace_capacity_provider_intent_v1",{p_intent_id:intentId}):null;
  if(!intent || intent.pricing_mode!=="invoice_monthly" || !intent.terms_accepted_at || intent.workspace_id!==workspaceId
    || intent.stripe_subscription_id!==subscription.id || stripeObjectId(subscription.customer)!==intent.stripe_customer_id
    || subscription.metadata?.workspace_id!==workspaceId || subscription.metadata?.product!==PRODUCT || subscription.livemode!==intent.livemode
    || subscription.automatic_tax?.enabled!==true || subscription.payment_settings?.save_default_payment_method!=="on_subscription"
    || !["past_due","unpaid"].includes(subscription.status) || subscription.ended_at
    || subscription.items.data.length!==1 || subscription.items.data[0].price.id!==intent.stripe_price_id
    || subscription.items.data[0].price.tax_behavior!=="inclusive" || subscription.items.data[0].quantity!==intent.packs) {
    throw new StorageAccessError(409,"This subscription has no eligible overdue monthly payment. Refresh its billing status.");
  }
  const invoiceId=stripeObjectId(subscription.latest_invoice);
  if(!invoiceId || (acceptedInvoiceId && acceptedInvoiceId!==invoiceId))throw new StorageAccessError(409,"The overdue invoice changed. Review the current payment before continuing.");
  const invoice=await stripe<Invoice>(`/invoices/${encodeURIComponent(invoiceId)}`);const line=invoice.lines.data[0];const now=Math.floor(Date.now()/1000);
  if(invoice.status!=="open" || invoice.paid || invoice.amount_paid!==0 || invoice.billing_reason!=="subscription_cycle"
    || stripeObjectId(invoice.subscription)!==subscription.id || stripeObjectId(invoice.customer)!==intent.stripe_customer_id
    || invoice.currency!=="usd" || invoice.total!==intent.packs*500 || invoice.amount_due!==intent.packs*500
    || invoice.automatic_tax?.enabled!==true || invoice.automatic_tax.status!=="complete" || invoice.lines.has_more || invoice.lines.data.length!==1
    || !line || line.type!=="subscription" || stripeObjectId(line.subscription)!==subscription.id || line.price?.id!==intent.stripe_price_id
    || line.price.tax_behavior!=="inclusive" || line.quantity!==intent.packs || line.proration || line.amount!==intent.packs*500
    || line.period.start!==subscription.current_period_start || line.period.end!==subscription.current_period_end
    || line.period.start>now || line.period.end<=now) {
    throw new StorageAccessError(409,"There is no unpaid invoice for the current capacity period at the agreed price. Refresh its billing status.");
  }
  const renewalDate=new Date(line.period.end*1000).toISOString();
  if(!acceptedInvoiceId)return {subscriptionId,invoiceId,packs:intent.packs,amountDueTodayCents:invoice.amount_due,currency:"usd",taxIncludedCents:invoice.tax||0,
    periodStart:new Date(line.period.start*1000).toISOString(),periodEnd:renewalDate,renewalDate,cancelAtPeriodEnd:subscription.cancel_at_period_end,
    cancellationEffect:subscription.cancel_at_period_end?"Renewal is canceled. This payment covers only the period shown. Files remain retained afterward.":"This pays the existing overdue monthly invoice. The same packs renew monthly on the date shown. Cancel renewal at any time; retained files are kept."};
  const paymentIntentId=stripeObjectId(invoice.payment_intent);
  if(!paymentIntentId)throw new StorageAccessError(409,"The overdue payment is being updated. Refresh its billing status.");
  let payment=await stripe<PaymentIntent>(`/payment_intents/${encodeURIComponent(paymentIntentId)}`);
  if(stripeObjectId(payment.invoice)!==invoice.id || stripeObjectId(payment.customer)!==intent.stripe_customer_id
    || payment.amount!==intent.packs*500 || payment.currency!=="usd" || payment.livemode!==intent.livemode
    || !payment.client_secret || !["requires_payment_method","requires_confirmation","requires_action"].includes(payment.status)
    || payment.payment_method_types.length!==1 || payment.payment_method_types[0]!=="card" || ![null,"off_session"].includes(payment.setup_future_usage)) {
    throw new StorageAccessError(409,"The overdue USD payment cannot be confirmed. Refresh its billing status before paying again.");
  }
  // Stripe renewal attempts can omit setup_future_usage. After the owner's
  // explicit recovery consent, prepare saving the replacement card without
  // confirming or charging this existing invoice's PaymentIntent.
  if(payment.setup_future_usage===null) {
    payment=await stripe<PaymentIntent>(`/payment_intents/${encodeURIComponent(paymentIntentId)}`,new URLSearchParams({setup_future_usage:"off_session"}),`capacity-recovery-save:${invoice.id}`);
    if(payment.setup_future_usage!=="off_session" || stripeObjectId(payment.invoice)!==invoice.id || stripeObjectId(payment.customer)!==intent.stripe_customer_id
      || payment.amount!==intent.packs*500 || payment.currency!=="usd" || payment.livemode!==intent.livemode || !payment.client_secret
      || !["requires_payment_method","requires_confirmation","requires_action"].includes(payment.status))throw new StorageAccessError(409,"The overdue payment changed. Refresh its billing status before paying again.");
  }
  return {clientSecret:payment.client_secret,publishableKey:process.env.STRIPE_PUBLISHABLE_KEY!,amountCents:payment.amount,currency:"usd",renewalDate};
}
function verifyUnpaidCapacityInvoice(intent:Intent,subscription:Subscription,invoice:Invoice) {
  const line=invoice.lines.data[0];
  if(subscription.id!==intent.stripe_subscription_id || stripeObjectId(subscription.customer)!==intent.stripe_customer_id
    || subscription.metadata?.capacity_intent_id!==intent.id || subscription.metadata?.workspace_id!==intent.workspace_id
    || subscription.metadata?.product!==PRODUCT || subscription.livemode!==intent.livemode
    || subscription.status!=="incomplete" || subscription.automatic_tax?.enabled!==true
    || subscription.payment_settings?.save_default_payment_method!=="on_subscription"
    || subscription.items.data.length!==1 || subscription.items.data[0].price.id!==intent.stripe_price_id
    || subscription.items.data[0].price.tax_behavior!=="inclusive" || subscription.items.data[0].quantity!==intent.packs
    || subscription.current_period_end!==Math.floor(new Date(intent.renewal_at||"").getTime()/1000)
    || invoice.id!==intent.stripe_initial_invoice_id || stripeObjectId(invoice.subscription)!==subscription.id
    || stripeObjectId(invoice.customer)!==intent.stripe_customer_id || invoice.status!=="open" || invoice.paid
    || invoice.auto_advance!==false || invoice.amount_paid!==0 || invoice.currency!=="usd"
    || invoice.amount_due!==intent.packs*500 || invoice.total!==intent.packs*500
    || invoice.automatic_tax?.enabled!==true || invoice.automatic_tax.status!=="complete"
    || invoice.lines.has_more || invoice.lines.data.length!==1 || !line || line.type!=="subscription"
    || stripeObjectId(line.subscription)!==subscription.id || line.price?.id!==intent.stripe_price_id
    || line.quantity!==intent.packs || line.proration || line.amount!==intent.packs*500
    || line.period.end!==subscription.current_period_end || line.period.start!==subscription.current_period_start) {
    throw new StorageAccessError(409,"The exact capacity invoice, tax-inclusive price, or renewal changed. No payment has been authorized; review the purchase again.");
  }
}
async function prepareCapacityInvoice(admin:Admin,intent:Intent,price:Price,actorId:string,address:CapacityBillingAddress):Promise<Invoice> {
  if(intent.stripe_initial_invoice_id && intent.stripe_subscription_id) {
    const [invoice,subscription]=await Promise.all([
      stripe<Invoice>(`/invoices/${encodeURIComponent(intent.stripe_initial_invoice_id)}`),
      stripe<Subscription>(`/subscriptions/${encodeURIComponent(intent.stripe_subscription_id)}`)
    ]);
    verifyUnpaidCapacityInvoice(intent,subscription,invoice);return invoice;
  }
  const {data,error}=await admin.auth.admin.getUserById(actorId);
  if(error || !data.user?.email || !data.user.email_confirmed_at)throw new StorageAccessError(403,"Verify your email before reviewing capacity.");
  // A fresh customer per purchase has no saved card, balance or discount. Never
  // reuse a previous subscription's default method while preparing a review.
  const customer=await stripe<{id:string;balance:number;default_source:unknown;invoice_settings:{default_payment_method:unknown};discount:unknown}>("/customers",new URLSearchParams({
    email:data.user.email,"address[line1]":address.line1,"address[line2]":address.line2||"","address[city]":address.city,
    "address[state]":address.state||"","address[postal_code]":address.postalCode||"","address[country]":address.country,
    "tax[validate_location]":"immediately","metadata[product]":PRODUCT,"metadata[workspace_id]":intent.workspace_id,"metadata[capacity_intent_id]":intent.id
  }),`capacity-invoice-customer:${intent.id}`);
  if(!customer.id || customer.balance!==0 || customer.default_source || customer.invoice_settings.default_payment_method || customer.discount) {
    throw new StorageAccessError(409,"Capacity review requires a new unpaid billing account. No payment has been authorized.");
  }
  const subscription=await stripe<Subscription>("/subscriptions",new URLSearchParams({
    customer:customer.id,"items[0][price]":price.id,"items[0][quantity]":String(intent.packs),payment_behavior:"default_incomplete",
    proration_behavior:"none","automatic_tax[enabled]":"true","payment_settings[save_default_payment_method]":"on_subscription",
    "payment_settings[payment_method_types][0]":"card","metadata[product]":PRODUCT,"metadata[workspace_id]":intent.workspace_id,"metadata[capacity_intent_id]":intent.id
  }),`capacity-invoice-subscription:${intent.id}`);
  const invoiceId=stripeObjectId(subscription.latest_invoice);
  if(!invoiceId)throw new StorageAccessError(503,"Stripe did not produce a capacity invoice.");
  const invoice=await stripe<Invoice>(`/invoices/${encodeURIComponent(invoiceId)}`);
  intent.stripe_customer_id=customer.id;intent.stripe_subscription_id=subscription.id;intent.stripe_initial_invoice_id=invoice.id;
  intent.renewal_at=new Date(subscription.current_period_end*1000).toISOString();
  intent.expires_at=new Date((subscription.created+23*3600)*1000).toISOString();intent.quoted_cents=intent.packs*500;
  verifyUnpaidCapacityInvoice(intent,subscription,invoice);
  await rpc(admin,"workspace_capacity_record_invoice_v1",{p_workspace_id:intent.workspace_id,p_actor_id:actorId,p_intent_id:intent.id,
    p_customer_id:customer.id,p_subscription_id:subscription.id,p_invoice_id:invoice.id,p_renewal_at:intent.renewal_at,p_expires_at:intent.expires_at,p_quoted_cents:intent.quoted_cents});
  return invoice;
}

export function capacityInvoicePeriod(invoice:Invoice,subscription:Subscription,priceId:string,packs:number,charge:Charge|null,intent?:Intent):PaidPeriod|null {
  if(invoice.status!=="paid" || !invoice.paid) return null;
  const customer=stripeObjectId(subscription.customer);
  if(stripeObjectId(invoice.subscription)!==subscription.id || stripeObjectId(invoice.customer)!==customer
    || invoice.currency!=="usd" || invoice.amount_paid<=0 || invoice.amount_due!==invoice.amount_paid
    || invoice.lines.has_more || invoice.lines.data.length!==1) throw new Error("Capacity invoice attribution or price is invalid.");
  const line=invoice.lines.data[0];
  const initialPeriod=Boolean(intent?.pricing_mode==="fixed_anchor" && invoice.billing_reason==="subscription_create" && line.proration);
  if(intent?.pricing_mode==="invoice_monthly" && (invoice.automatic_tax?.enabled!==true || invoice.automatic_tax.status!=="complete"
    || line.price?.tax_behavior!=="inclusive" || invoice.total!==packs*500 || invoice.amount_paid!==packs*500
    || (invoice.billing_reason==="subscription_create" && (invoice.id!==intent.stripe_initial_invoice_id
      || line.period.end!==Math.floor(new Date(intent.renewal_at||"").getTime()/1000))))) {
    throw new Error("Capacity invoice must match the exact tax-inclusive monthly price and accepted renewal.");
  }
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
  if(!intent)throw new Error("Capacity purchase attribution is pending.");
  let purchaseReference:string;
  if(intent.pricing_mode==="invoice_monthly") {
    // Creating the unpaid invoice emits events before the owner accepts terms.
    // Acknowledge those events without granting any capacity or base-plan access.
    if(!intent.stripe_initial_invoice_id || !intent.stripe_subscription_id) {
      if(subscription.status==="incomplete")return {workspace_id:intent.workspace_id,paid_packs:0};
      throw new Error("Capacity invoice attribution is pending.");
    }
    purchaseReference=intent.stripe_initial_invoice_id;
    if(intent.stripe_subscription_id!==subscription.id || intent.stripe_customer_id!==stripeObjectId(subscription.customer)
      || subscription.automatic_tax?.enabled!==true || subscription.items.data[0]?.price.tax_behavior!=="inclusive") {
      throw new Error("Capacity subscription does not match its reviewed tax-inclusive invoice.");
    }
    if(subscription.status==="incomplete")return {workspace_id:intent.workspace_id,paid_packs:0};
    if(subscription.status==="incomplete_expired") {
      const initial=await stripe<Invoice>(`/invoices/${encodeURIComponent(purchaseReference)}`);
      if(initial.status!=="void")throw new Error("Capacity invoice expiry has not been confirmed.");
      await rpc(admin,"workspace_capacity_expire_invoice_v1",{p_intent_id:intent.id,p_invoice_id:initial.id});
      return {workspace_id:intent.workspace_id,paid_packs:0};
    }
    if(!intent.terms_accepted_at) {
      if(subscription.status==="canceled")return {workspace_id:intent.workspace_id,paid_packs:0};
      throw new Error("Capacity payment requires the owner's explicit recurring purchase consent.");
    }
  } else {
    if(!intent.stripe_session_id)throw new Error("Capacity Checkout attribution is pending.");
    const session=await stripe<Session>(`/checkout/sessions/${encodeURIComponent(intent.stripe_session_id)}`);
    if(session.client_reference_id!==intent.id || session.metadata?.capacity_intent_id!==intent.id || session.metadata.product!==PRODUCT
      || session.status!=="complete" || stripeObjectId(session.subscription)!==subscription.id
      || stripeObjectId(session.customer)!==stripeObjectId(subscription.customer) || session.livemode!==intent.livemode) {
      throw new Error("Capacity Checkout does not match its confirmed workspace purchase.");
    }
    purchaseReference=session.id;
  }
  if(subscription.livemode!==intent.livemode || subscription.metadata.workspace_id!==intent.workspace_id
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
    p_event_key:eventKey,p_event_type:eventType,p_intent_id:intent.id,p_session_id:purchaseReference,p_subscription_id:subscription.id,
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
