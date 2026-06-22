import { NextResponse } from "next/server";
import { VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import { sendVaeroexOnboardingEmail, type OnboardingEmailResult } from "@/lib/email/onboarding";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import {
  mapStripeStatus,
  retrieveStripeCustomer,
  retrieveStripeSubscription,
  stripeObjectId,
  stripeTimestampToIso,
  type StripeCheckoutSession,
  type StripeCustomer,
  type StripeEvent,
  type StripeInvoice,
  type StripeSubscription,
  verifyStripeSignature
} from "@/lib/stripe/billing";

export const runtime = "nodejs";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

type ExistingSubscription = {
  id: string;
  workspace_id: string | null;
  customer_email: string;
  customer_name: string | null;
  user_id: string | null;
  manually_activated: boolean;
};

type StripeSyncResult = {
  customerEmail: string | null;
  customerName: string | null;
  stripeSubscriptionId: string | null;
  status: ReturnType<typeof mapStripeStatus>;
  subscriptionRecordId: string | null;
};

function asJson(value: unknown): Json {
  return value as Json;
}

function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
}

function priceIdFromSubscription(subscription?: StripeSubscription | null) {
  return subscription?.items?.data?.[0]?.price?.id || process.env.STRIPE_PRICE_OPERATIONS_INTELLIGENCE_MONTHLY || null;
}

async function findExistingSubscription({
  admin,
  stripeSubscriptionId,
  stripeCustomerId,
  customerEmail
}: {
  admin: AdminClient;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  customerEmail?: string | null;
}) {
  const filters = [
    stripeSubscriptionId ? `stripe_subscription_id.eq.${stripeSubscriptionId}` : "",
    stripeCustomerId ? `stripe_customer_id.eq.${stripeCustomerId}` : "",
    customerEmail ? `customer_email.ilike.${normalizeEmail(customerEmail)}` : ""
  ].filter(Boolean);

  if (!filters.length) {
    return null;
  }

  const { data } = await admin
    .from("customer_subscriptions")
    .select("id,workspace_id,customer_email,customer_name,user_id,manually_activated")
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data as ExistingSubscription | null;
}

async function getCustomer(customerId?: string | null) {
  if (!customerId) {
    return null;
  }

  try {
    return await retrieveStripeCustomer(customerId);
  } catch {
    return null;
  }
}

async function profileIdForEmail(admin: AdminClient, email: string) {
  const { data } = await admin.from("profiles").select("id").eq("email", normalizeEmail(email)).maybeSingle();
  return data?.id ?? null;
}

async function syncStripeSubscription({
  admin,
  event,
  subscription,
  session,
  invoice,
  customer,
  forcedStatus,
  lastPaymentAt
}: {
  admin: AdminClient;
  event: StripeEvent;
  subscription?: StripeSubscription | null;
  session?: StripeCheckoutSession | null;
  invoice?: StripeInvoice | null;
  customer?: StripeCustomer | null;
  forcedStatus?: ReturnType<typeof mapStripeStatus> | null;
  lastPaymentAt?: string | null;
}) {
  const stripeSubscriptionId = subscription?.id || stripeObjectId(session?.subscription) || stripeObjectId(invoice?.subscription);
  const stripeCustomerId = stripeObjectId(subscription?.customer) || stripeObjectId(session?.customer) || stripeObjectId(invoice?.customer) || customer?.id || null;
  let existing = await findExistingSubscription({
    admin,
    stripeSubscriptionId,
    stripeCustomerId,
    customerEmail: session?.customer_details?.email || session?.customer_email || invoice?.customer_email || customer?.email || null
  });
  const customerEmail =
    normalizeEmail(session?.customer_details?.email || session?.customer_email || invoice?.customer_email || customer?.email || existing?.customer_email);
  const customerName = session?.customer_details?.name || customer?.name || existing?.customer_name || null;

  if (!customerEmail) {
    throw new Error("Stripe event did not include a customer email and no existing subscription could be matched.");
  }

  const status = forcedStatus || mapStripeStatus(subscription?.status);
  const userId = existing?.user_id || (await profileIdForEmail(admin, customerEmail));
  const payload = {
    user_id: userId,
    workspace_id: existing?.workspace_id ?? null,
    customer_email: customerEmail,
    customer_name: customerName,
    source: "stripe",
    billing_provider: "stripe",
    plan_slug: VAEROEX_PLAN_SLUG,
    status,
    stripe_customer_id: stripeCustomerId,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_price_id: priceIdFromSubscription(subscription),
    current_period_start: stripeTimestampToIso(subscription?.current_period_start),
    current_period_end: stripeTimestampToIso(subscription?.current_period_end),
    stripe_current_period_end: stripeTimestampToIso(subscription?.current_period_end),
    stripe_cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
    canceled_at: stripeTimestampToIso(subscription?.canceled_at),
    last_payment_at: lastPaymentAt ?? (["active", "trialing"].includes(status) ? new Date().toISOString() : null),
    raw_payload_json: event as unknown as Json,
    notes: "Stripe billing event"
  };

  if (existing) {
    const { error } = await admin.from("customer_subscriptions").update(payload).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error, data } = await admin
      .from("customer_subscriptions")
      .insert({
        ...payload,
        manually_activated: false
      })
      .select("id")
      .single();
    if (error) throw error;
    existing = {
      id: data.id,
      workspace_id: null,
      customer_email: customerEmail,
      customer_name: customerName,
      user_id: userId,
      manually_activated: false
    };
  }

  if (existing?.workspace_id) {
    await admin
      .from("workspaces")
      .update({
        subscription_status: status,
        plan_slug: VAEROEX_PLAN_SLUG
      })
      .eq("id", existing.workspace_id);
  }

  return {
    customerEmail,
    customerName,
    stripeSubscriptionId,
    status,
    subscriptionRecordId: existing?.id ?? null
  };
}

async function subscriptionFromId(subscriptionId?: string | null) {
  if (!subscriptionId) {
    return null;
  }

  return retrieveStripeSubscription(subscriptionId);
}

async function processStripeEvent(admin: AdminClient, event: StripeEvent) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as StripeCheckoutSession;
      const subscription = await subscriptionFromId(stripeObjectId(session.subscription));
      const customer = await getCustomer(stripeObjectId(session.customer));
      return syncStripeSubscription({ admin, event, session, subscription, customer });
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as StripeSubscription;
      const customer = await getCustomer(stripeObjectId(subscription.customer));
      return syncStripeSubscription({ admin, event, subscription, customer });
    }
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as StripeInvoice;
      const subscription = await subscriptionFromId(stripeObjectId(invoice.subscription));
      const customer = await getCustomer(stripeObjectId(invoice.customer) || stripeObjectId(subscription?.customer));
      return syncStripeSubscription({
        admin,
        event,
        invoice,
        subscription,
        customer,
        lastPaymentAt: new Date().toISOString()
      });
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as StripeInvoice;
      const subscription = await subscriptionFromId(stripeObjectId(invoice.subscription));
      const customer = await getCustomer(stripeObjectId(invoice.customer) || stripeObjectId(subscription?.customer));
      return syncStripeSubscription({
        admin,
        event,
        invoice,
        subscription,
        customer,
        forcedStatus: "past_due"
      });
    }
    default:
      return {
        customerEmail: null,
        customerName: null,
        stripeSubscriptionId: null,
        status: "manual_review" as const,
        subscriptionRecordId: null
      };
  }
}

function shouldSendOnboardingEmail(event: StripeEvent, result: StripeSyncResult) {
  return (
    ["checkout.session.completed", "customer.subscription.created"].includes(event.type) &&
    ["active", "trialing"].includes(result.status) &&
    Boolean(result.customerEmail && result.subscriptionRecordId)
  );
}

async function markOnboardingEmailResult({
  admin,
  subscriptionRecordId,
  result
}: {
  admin: AdminClient;
  subscriptionRecordId: string;
  result: OnboardingEmailResult;
}) {
  if (result.status === "sent") {
    await admin
      .from("customer_subscriptions")
      .update({
        onboarding_email_status: "sent",
        onboarding_email_sent_at: new Date().toISOString(),
        onboarding_email_message_id: result.messageId,
        onboarding_email_error: null
      })
      .eq("id", subscriptionRecordId);
    return;
  }

  if (result.status === "skipped") {
    await admin
      .from("customer_subscriptions")
      .update({
        onboarding_email_status: "skipped",
        onboarding_email_error: result.reason
      })
      .eq("id", subscriptionRecordId);
    return;
  }

  await admin
    .from("customer_subscriptions")
    .update({
      onboarding_email_status: "failed",
      onboarding_email_error: result.error
    })
    .eq("id", subscriptionRecordId);
}

async function sendOnboardingEmailOnce(admin: AdminClient, event: StripeEvent, result: StripeSyncResult) {
  if (!shouldSendOnboardingEmail(event, result) || !result.customerEmail || !result.subscriptionRecordId) {
    return { status: "not_applicable" as const };
  }

  const { data: claim, error: claimError } = await admin
    .from("customer_subscriptions")
    .update({
      onboarding_email_status: "sending",
      onboarding_email_error: null
    })
    .eq("id", result.subscriptionRecordId)
    .in("onboarding_email_status", ["not_sent", "failed"])
    .is("onboarding_email_sent_at", null)
    .select("id")
    .maybeSingle();

  if (claimError) {
    await admin
      .from("customer_subscriptions")
      .update({
        onboarding_email_status: "failed",
        onboarding_email_error: claimError.message
      })
      .eq("id", result.subscriptionRecordId);
    return { status: "failed" as const, error: claimError.message };
  }

  if (!claim) {
    return { status: "already_handled" as const };
  }

  const emailResult = await sendVaeroexOnboardingEmail({
    to: result.customerEmail,
    customerName: result.customerName,
    stripeSubscriptionId: result.stripeSubscriptionId
  });

  await markOnboardingEmailResult({
    admin,
    subscriptionRecordId: result.subscriptionRecordId,
    result: emailResult
  });

  return emailResult;
}

export async function POST(request: Request) {
  const admin = createSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json({ ok: false, error: "STRIPE_WEBHOOK_SECRET is not configured." }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!verifyStripeSignature(rawBody, signature, webhookSecret)) {
    return NextResponse.json({ ok: false, error: "Invalid Stripe webhook signature." }, { status: 401 });
  }

  let event: StripeEvent;

  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Stripe payload could not be parsed." }, { status: 400 });
  }

  const { data: duplicate } = await admin
    .from("subscription_events")
    .select("id,processed")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (duplicate) {
    return NextResponse.json({ ok: true, duplicate: true, event_id: duplicate.id, processed: duplicate.processed });
  }

  const initialSubscriptionId = stripeObjectId((event.data.object as { subscription?: unknown }).subscription);
  const { data: eventRow, error: eventError } = await admin
    .from("subscription_events")
    .insert({
      source: "stripe",
      billing_provider: "stripe",
      event_type: event.type,
      stripe_event_id: event.id,
      stripe_subscription_id: initialSubscriptionId,
      payload_json: asJson(event),
      processed: false,
      processing_error: null
    })
    .select("id")
    .maybeSingle();

  if (eventError) {
    return NextResponse.json({ ok: false, error: eventError.message }, { status: eventError.code === "23505" ? 200 : 500 });
  }

  try {
    const result = await processStripeEvent(admin, event);
    const onboardingEmail = await sendOnboardingEmailOnce(admin, event, result);

    if (eventRow) {
      await admin
        .from("subscription_events")
        .update({
          customer_email: result.customerEmail,
          stripe_subscription_id: result.stripeSubscriptionId,
          processed: true,
          processing_error: null
        })
        .eq("id", eventRow.id);
    }

    return NextResponse.json({
      ok: true,
      processed: true,
      event_id: eventRow?.id ?? null,
      status: result.status,
      onboarding_email: onboardingEmail
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe subscription event processing failed.";

    if (eventRow) {
      await admin
        .from("subscription_events")
        .update({
          processed: false,
          processing_error: message
        })
        .eq("id", eventRow.id);
    }

    return NextResponse.json({ ok: false, error: message }, { status: 202 });
  }
}
