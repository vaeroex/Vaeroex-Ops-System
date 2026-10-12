import { NextResponse } from "next/server";
import { VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import { processCapacityStripeEvent } from "@/lib/storage-capacity/billing";
import { sendVaeroexWelcomeEmail, type WelcomeEmailResult } from "@/lib/email/welcome";
import { logSecurityAuditEvent } from "@/lib/security/tool-execution-gateway";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/types";
import { minimizeStripeWebhookReceipt } from "@/lib/stripe/webhook-receipt";
import {
  mapStripeStatus,
  retrieveStripeCustomer,
  retrieveStripeSubscription,
  stripeObjectId,
  stripeInvoiceSubscriptionId,
  stripeSubscriptionPeriod,
  stripeSubscriptionPriceId,
  stripeTimestampToIso,
  type StripeCheckoutSession,
  type StripeCustomer,
  type StripeEvent,
  type StripeInvoice,
  type StripeSubscription,
  verifyStripeSignature
} from "@/lib/stripe/billing";

export const runtime = "nodejs";
export const maxDuration = 300;

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

type StripeSyncResult = {
  customerEmail: string | null;
  customerName: string | null;
  stripeSubscriptionId: string | null;
  status: ReturnType<typeof mapStripeStatus>;
  subscriptionRecordId: string | null;
  workspaceId: string | null;
};

function normalizeEmail(email?: string | null) {
  return String(email || "").trim().toLowerCase();
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

function metadataValue(
  key: string,
  subscription?: StripeSubscription | null,
  session?: StripeCheckoutSession | null
) {
  return subscription?.metadata?.[key] || session?.metadata?.[key] || null;
}

async function syncStripeSubscription({
  admin,
  event,
  subscription,
  session,
  invoice,
  customer,
  lastPaymentAt,
  observationGeneration
}: {
  admin: AdminClient;
  event: StripeEvent;
  subscription?: StripeSubscription | null;
  session?: StripeCheckoutSession | null;
  invoice?: StripeInvoice | null;
  customer?: StripeCustomer | null;
  lastPaymentAt?: string | null;
  observationGeneration?: number;
}) {
  const stripeSubscriptionId = subscription?.id || stripeObjectId(session?.subscription) || (invoice ? stripeInvoiceSubscriptionId(invoice) : null);
  const stripeCustomerId = stripeObjectId(subscription?.customer) || stripeObjectId(session?.customer) || stripeObjectId(invoice?.customer) || customer?.id || null;
  const customerEmail = normalizeEmail(
    session?.customer_details?.email || session?.customer_email || invoice?.customer_email || customer?.email
  );
  const customerName = session?.customer_details?.name || customer?.name || null;

  if (!stripeSubscriptionId || !stripeCustomerId || !customerEmail || !event.created) {
    throw new Error("Stripe event did not include the required subscription attribution.");
  }

  const status = mapStripeStatus(subscription?.status);
  const { currentPeriodStart, currentPeriodEnd } = stripeSubscriptionPeriod(subscription);
  const checkoutIntentId = metadataValue("purchase_intent_id", subscription, session);
  const metadataUserId = metadataValue("vaeroex_user_id", subscription, session);
  const args = {
    p_event_id: event.id,
    p_event_created_at: new Date(event.created * 1000).toISOString(),
    p_event_type: event.type,
    p_checkout_intent_id: checkoutIntentId,
    p_user_id: metadataUserId,
    p_stripe_subscription_id: stripeSubscriptionId,
    p_stripe_customer_id: stripeCustomerId,
    p_customer_email: customerEmail,
    p_customer_name: customerName,
    p_status: status,
    p_plan_slug: VAEROEX_PLAN_SLUG,
    p_stripe_price_id: stripeSubscriptionPriceId(subscription),
    p_current_period_start: stripeTimestampToIso(currentPeriodStart),
    p_current_period_end: stripeTimestampToIso(currentPeriodEnd),
    p_cancel_at_period_end: Boolean(subscription?.cancel_at_period_end),
    p_canceled_at: stripeTimestampToIso(subscription?.canceled_at),
    p_last_payment_at: lastPaymentAt ?? (["active", "trialing"].includes(status) ? new Date().toISOString() : null),
    p_raw_payload: event as unknown as Json
  };
  const { data, error } = observationGeneration === undefined
    ? await admin.rpc("sync_stripe_subscription_entitlement_v1", args)
    : await admin.rpc("sync_stripe_subscription_entitlement_v2", {
      ...args,
      p_observation_generation: observationGeneration
    });

  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(error?.message || "Stripe subscription could not be reconciled.");
  }

  const result = data as {
    subscription_record_id?: string | null;
    workspace_id?: string | null;
    status?: string | null;
  };

  return {
    customerEmail,
    customerName,
    stripeSubscriptionId,
    status: mapStripeStatus(result.status || status),
    subscriptionRecordId: result.subscription_record_id ?? null,
    workspaceId: result.workspace_id ?? null
  };
}

async function subscriptionFromId(admin: AdminClient, subscriptionId?: string | null) {
  if (!subscriptionId) return null;

  // Fence the provider observation before reading it. A later observation can
  // supersede this one without a delayed response restoring stale access.
  const { data: generation, error } = await admin.rpc("claim_stripe_subscription_observation_v1", {
    p_stripe_subscription_id: subscriptionId
  });
  if (error || typeof generation !== "number" || !Number.isSafeInteger(generation) || generation < 1) {
    throw new Error("Stripe subscription observation could not be claimed.");
  }
  const subscription = await retrieveStripeSubscription(subscriptionId);
  if (subscription.id !== subscriptionId) {
    throw new Error("Stripe subscription lookup attribution disagrees.");
  }

  return { subscription, generation };
}

async function subscriptionFromInvoice(admin: AdminClient, invoice: StripeInvoice) {
  const observation = await subscriptionFromId(admin, stripeInvoiceSubscriptionId(invoice));
  if (!observation) return null;

  const customerId = stripeObjectId(invoice.customer);
  if (!customerId || stripeObjectId(observation.subscription.customer) !== customerId) {
    throw new Error("Stripe invoice and subscription attribution disagree.");
  }

  return observation;
}

async function closeFailedCheckoutIntent(admin: AdminClient, session: StripeCheckoutSession) {
  const intentId = session.metadata?.purchase_intent_id || session.client_reference_id;
  const userId = session.metadata?.vaeroex_user_id;

  if (!intentId || !userId || session.client_reference_id !== intentId) {
    throw new Error("Failed Checkout Session attribution is invalid.");
  }

  const { data, error } = await admin.rpc("expire_stripe_checkout_intent_v1", {
    p_intent_id: intentId,
    p_user_id: userId,
    p_session_id: session.id
  });

  if (error || data !== true) {
    throw new Error("Failed Checkout Session could not be closed safely.");
  }

  return {
    customerEmail: normalizeEmail(session.customer_details?.email || session.customer_email) || null,
    customerName: session.customer_details?.name || null,
    stripeSubscriptionId: stripeObjectId(session.subscription),
    status: "expired" as const,
    subscriptionRecordId: null,
    workspaceId: null
  };
}

async function processStripeEvent(admin: AdminClient, event: StripeEvent) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as StripeCheckoutSession;
      const observation = await subscriptionFromId(admin, stripeObjectId(session.subscription));
      if (!observation) throw new Error("Completed Checkout Session did not include a retrievable subscription.");
      const customer = await getCustomer(stripeObjectId(session.customer));
      return syncStripeSubscription({ admin, event, session, subscription: observation.subscription, customer, observationGeneration: observation.generation });
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed": {
      return closeFailedCheckoutIntent(admin, event.data.object as StripeCheckoutSession);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const eventSubscription = event.data.object as StripeSubscription;
      const observation = event.type === "customer.subscription.deleted"
        ? null
        : await subscriptionFromId(admin, eventSubscription.id);
      const subscription = event.type === "customer.subscription.deleted" ? eventSubscription : observation?.subscription;
      if (!subscription) throw new Error("Stripe subscription could not be retrieved.");
      const customer = await getCustomer(stripeObjectId(subscription.customer));
      return syncStripeSubscription({ admin, event, subscription, customer, observationGeneration: observation?.generation });
    }
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as StripeInvoice;
      const observation = await subscriptionFromInvoice(admin, invoice);
      if (!observation) throw new Error("Paid invoice did not include a retrievable subscription.");
      const { subscription, generation } = observation;
      const customer = await getCustomer(stripeObjectId(invoice.customer));
      return syncStripeSubscription({
        admin,
        event,
        invoice,
        subscription,
        observationGeneration: generation,
        customer,
        lastPaymentAt: new Date().toISOString()
      });
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as StripeInvoice;
      const observation = await subscriptionFromInvoice(admin, invoice);
      if (!observation) throw new Error("Failed invoice did not include a retrievable subscription.");
      const { subscription, generation } = observation;
      const customer = await getCustomer(stripeObjectId(invoice.customer));
      return syncStripeSubscription({
        admin,
        event,
        invoice,
        subscription,
        observationGeneration: generation,
        customer
      });
    }
    default:
      return {
        customerEmail: null,
        customerName: null,
        stripeSubscriptionId: null,
        status: "manual_review" as const,
        subscriptionRecordId: null,
        workspaceId: null
      };
  }
}

function shouldSendWelcomeEmail(event: StripeEvent, result: StripeSyncResult) {
  return (
    ["checkout.session.completed", "customer.subscription.created"].includes(event.type) &&
    ["active", "trialing"].includes(result.status) &&
    Boolean(result.customerEmail && result.subscriptionRecordId)
  );
}

async function markWelcomeEmailResult({
  admin,
  subscriptionRecordId,
  result
}: {
  admin: AdminClient;
  subscriptionRecordId: string;
  result: WelcomeEmailResult;
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

async function sendWelcomeEmailOnce(admin: AdminClient, event: StripeEvent, result: StripeSyncResult) {
  if (!shouldSendWelcomeEmail(event, result) || !result.customerEmail || !result.subscriptionRecordId) {
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

  const emailResult = await sendVaeroexWelcomeEmail({
    to: result.customerEmail,
    stripeSubscriptionId: result.stripeSubscriptionId
  });

  await markWelcomeEmailResult({
    admin,
    subscriptionRecordId: result.subscriptionRecordId,
    result: emailResult
  });

  console.log(
    JSON.stringify({
      level: emailResult.status === "failed" ? "warning" : "info",
      component: "vaeroex-email",
      event: "welcome_email_processed",
      status: emailResult.status,
      stripeEventId: event.id,
      stripeSubscriptionId: result.stripeSubscriptionId,
      subscriptionRecordId: result.subscriptionRecordId
    })
  );

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
    .select("id,processed,processing_error")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (duplicate?.processed) {
    return NextResponse.json({ ok: true, duplicate: true, event_id: duplicate.id, processed: duplicate.processed });
  }

  let initialSubscriptionId = stripeObjectId((event.data.object as { subscription?: unknown }).subscription);
  if (event.type.startsWith("invoice.")) {
    try {
      initialSubscriptionId = stripeInvoiceSubscriptionId(event.data.object as StripeInvoice);
    } catch {
      // Persist invalid attribution for a retryable failure without selecting
      // either conflicting subscription as the receipt's trusted identity.
      initialSubscriptionId = null;
    }
  }
  const receiptPayload = minimizeStripeWebhookReceipt(event);
  const { data: eventRow, error: eventError } = duplicate
    ? await admin
        .from("subscription_events")
        .update({
          payload_json: receiptPayload,
          processing_error: null,
          stripe_subscription_id: initialSubscriptionId
        })
        .eq("id", duplicate.id)
        .select("id")
        .maybeSingle()
    : await admin
        .from("subscription_events")
        .insert({
          source: "stripe",
          billing_provider: "stripe",
          event_type: event.type,
          stripe_event_id: event.id,
          stripe_subscription_id: initialSubscriptionId,
          payload_json: receiptPayload,
          processed: false,
          processing_error: null
        })
        .select("id")
        .maybeSingle();

  if (eventError) {
    if (eventError.code === "23505") {
      const { data: concurrentEvent, error: concurrentEventError } = await admin
        .from("subscription_events")
        .select("id,processed")
        .eq("stripe_event_id", event.id)
        .maybeSingle();

      if (!concurrentEventError && concurrentEvent?.processed) {
        return NextResponse.json({
          ok: true,
          duplicate: true,
          event_id: concurrentEvent.id,
          processed: true
        });
      }

      return NextResponse.json(
        { ok: false, error: "A matching Stripe event is still being processed." },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: false, error: eventError.message }, { status: 500 });
  }

  try {
    // Capacity has its own workspace-bound paid-invoice ledger. Never send add-on
    // events through base-plan entitlement reconciliation or onboarding email.
    const capacity = await processCapacityStripeEvent(admin, event);
    if (capacity.handled) {
      if (eventRow) {
        const { error: capacityRecordError } = await admin.from("subscription_events")
          .update({ processed: true, processing_error: null }).eq("id", eventRow.id);
        if (capacityRecordError) throw new Error("Capacity webhook receipt could not be recorded.");
      }
      return NextResponse.json({ ok: true, processed: true, product: "workspace_storage_capacity", event_id: eventRow?.id ?? null });
    }
    const result = await processStripeEvent(admin, event);
    const welcomeEmail = await sendWelcomeEmailOnce(admin, event, result);

    await logSecurityAuditEvent({
      supabase: admin,
      workspaceId: result.workspaceId,
      userId: null,
      actionName: `stripe.${event.type}`,
      operationType: "BILLING",
      targetTable: "customer_subscriptions",
      targetRecordId: result.subscriptionRecordId,
      initiatedBy: "system",
      allowed: true,
      requestId: event.id,
      metadata: {
        source: "stripe_webhook",
        stripe_subscription_id: result.stripeSubscriptionId,
        customer_email: result.customerEmail,
        status: result.status,
        welcome_email: welcomeEmail
      } satisfies Json
    });

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
      welcome_email: welcomeEmail
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe subscription event processing failed.";

    await logSecurityAuditEvent({
      supabase: admin,
      workspaceId: null,
      userId: null,
      actionName: `stripe.${event.type}`,
      operationType: "BILLING",
      targetTable: "subscription_events",
      targetRecordId: eventRow?.id ?? null,
      initiatedBy: "system",
      allowed: false,
      reasonBlocked: message,
      requestId: event.id,
      metadata: {
        source: "stripe_webhook",
        stripe_event_type: event.type
      } satisfies Json
    });

    if (eventRow) {
      await admin
        .from("subscription_events")
        .update({
          processed: false,
          processing_error: message
        })
        .eq("id", eventRow.id)
        .eq("processed", false);
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
