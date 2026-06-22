import { NextResponse } from "next/server";
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

  const email = user.email?.trim().toLowerCase();
  const filters = [
    `user_id.eq.${user.id}`,
    email ? `customer_email.ilike.${email}` : ""
  ].filter(Boolean);

  const { data: subscription, error } = await supabase
    .from("customer_subscriptions")
    .select("stripe_customer_id")
    .or(filters.join(","))
    .not("stripe_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return redirectWith("/app/account/subscription", "error", error.message);
  }

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
