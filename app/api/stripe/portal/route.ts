import { NextResponse } from "next/server";
import { getSubscriptionStatus } from "@/lib/billing/get-subscription-status";
import { createStripePortalSession, STRIPE_PORTAL_UNAVAILABLE_MESSAGE } from "@/lib/stripe/billing";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getAppUrl } from "@/lib/supabase/config";

export const runtime = "nodejs";

function redirectWith(path: string, key: "error" | "message", text: string) {
  return NextResponse.redirect(new URL(`${path}?${key}=${encodeURIComponent(text)}`, getAppUrl()), 303);
}

export async function POST() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return redirectWith("/app/account/subscription", "error", "Supabase is not configured.");
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return redirectWith("/login", "error", "Log in before managing billing.");
  }

  const subscription = await getSubscriptionStatus({
    supabase,
    userId: user.id,
    email: user.email
  });

  if (!subscription?.stripe_customer_id) {
    return redirectWith("/app/account/subscription", "error", "No Stripe billing account was found for this Vaeroex user.");
  }

  try {
    const session = await createStripePortalSession(subscription.stripe_customer_id);

    if (!session.url) {
      return redirectWith("/app/account/subscription", "error", STRIPE_PORTAL_UNAVAILABLE_MESSAGE);
    }

    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : STRIPE_PORTAL_UNAVAILABLE_MESSAGE;
    return redirectWith("/app/account/subscription", "error", message);
  }
}

export async function GET() {
  return POST();
}
