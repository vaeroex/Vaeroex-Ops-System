import { NextResponse } from "next/server";
import { VAEROEX_PLAN_SLUG } from "@/lib/billing/plans";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createOperationsIntelligenceCheckoutSession,
  retrieveStripeCheckoutSession,
  stripeObjectId,
  STRIPE_CHECKOUT_UNAVAILABLE_MESSAGE
} from "@/lib/stripe/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckoutIntentClaim = {
  state: "checkout_intent" | "existing_subscription";
  intent_id?: string | null;
  workspace_id?: string | null;
  status?: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  stripe_checkout_session_id?: string | null;
  session_expires_at?: string | null;
};

function redirectTo(path: string) {
  return NextResponse.redirect(new URL(path, getAppUrl()), 303);
}

function pricingRedirect(message: string) {
  return redirectTo(`/pricing?checkout_error=${encodeURIComponent(message)}`);
}

async function claimCheckoutIntent(
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>,
  userId: string,
  email: string
) {
  const { data, error } = await admin.rpc("claim_stripe_checkout_intent_v1", {
    p_user_id: userId,
    p_email: email,
    p_plan_slug: VAEROEX_PLAN_SLUG
  });

  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Checkout intent could not be prepared.");
  }

  return data as CheckoutIntentClaim;
}

async function expireCheckoutIntent({
  admin,
  intentId,
  userId,
  sessionId
}: {
  admin: NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
  intentId: string;
  userId: string;
  sessionId: string;
}) {
  const { data, error } = await admin.rpc("expire_stripe_checkout_intent_v1", {
    p_intent_id: intentId,
    p_user_id: userId,
    p_session_id: sessionId
  });

  if (error || data !== true) {
    throw new Error("Expired Checkout intent could not be closed safely.");
  }
}

export async function GET(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      action: "stripe.checkout",
      limit: 8,
      windowSeconds: 10 * 60,
      requestHeaders: request.headers,
      metadata: { source: "pricing_checkout" },
      strict: true
    });

    if (!rateLimit.allowed) {
      return pricingRedirect(rateLimitMessage(rateLimit));
    }

    const supabase = await createSupabaseServerClient();
    if (!supabase) return pricingRedirect(STRIPE_CHECKOUT_UNAVAILABLE_MESSAGE);

    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return redirectTo("/signup?next=%2Fapi%2Fstripe%2Fcheckout&message=Create%20or%20sign%20in%20to%20your%20Vaeroex%20account%20before%20checkout.");
    }

    const email = user.email?.trim().toLowerCase();
    if (!email || !user.email_confirmed_at) {
      return redirectTo("/login?next=%2Fapi%2Fstripe%2Fcheckout&error=Verify%20your%20email%20before%20starting%20checkout.");
    }

    const admin = createSupabaseAdminClient();
    if (!admin) return pricingRedirect(STRIPE_CHECKOUT_UNAVAILABLE_MESSAGE);

    let claim = await claimCheckoutIntent(admin, user.id, email);

    if (claim.state === "existing_subscription") {
      if (["active", "trialing"].includes(claim.status || "")) {
        return redirectTo(claim.workspace_id ? "/app/account/subscription" : "/app/setup");
      }

      return redirectTo(
        `/billing-required?reason=${encodeURIComponent("An existing Stripe subscription requires billing attention before another subscription can be started.")}`
      );
    }

    if (!claim.intent_id) {
      throw new Error("Checkout intent did not include an identifier.");
    }

    if (claim.stripe_checkout_session_id) {
      const existingSession = await retrieveStripeCheckoutSession(claim.stripe_checkout_session_id);

      if (existingSession.status === "open" && existingSession.url) {
        return NextResponse.redirect(existingSession.url, 303);
      }

      if (existingSession.status === "complete") {
        return redirectTo(`/checkout/success?session_id=${encodeURIComponent(existingSession.id)}`);
      }

      if (existingSession.status !== "expired") {
        throw new Error("Existing Checkout Session has an unexpected state.");
      }

      await expireCheckoutIntent({
        admin,
        intentId: claim.intent_id,
        userId: user.id,
        sessionId: existingSession.id
      });
      claim = await claimCheckoutIntent(admin, user.id, email);
    }

    if (claim.state !== "checkout_intent" || !claim.intent_id) {
      throw new Error("Checkout retry could not establish a unique intent.");
    }

    const session = await createOperationsIntelligenceCheckoutSession({
      intentId: claim.intent_id,
      userId: user.id,
      email,
      stripeCustomerId: claim.stripe_customer_id
    });

    if (!session.id || !session.url || !session.expires_at) {
      throw new Error("Stripe did not return a complete Checkout Session.");
    }

    const { error: recordError } = await admin.rpc("record_stripe_checkout_session_v1", {
      p_intent_id: claim.intent_id,
      p_user_id: user.id,
      p_session_id: session.id,
      p_customer_id: stripeObjectId(session.customer) || claim.stripe_customer_id || "",
      p_expires_at: new Date(session.expires_at * 1000).toISOString()
    });

    if (recordError) {
      throw new Error("Checkout Session could not be attributed safely.");
    }

    return NextResponse.redirect(session.url, 303);
  } catch {
    return pricingRedirect(STRIPE_CHECKOUT_UNAVAILABLE_MESSAGE);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
