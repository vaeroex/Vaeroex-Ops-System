import { NextResponse } from "next/server";
import { enforceRateLimit, rateLimitMessage } from "@/lib/security/rate-limit";
import { createOperationsIntelligenceCheckoutSession, STRIPE_CHECKOUT_UNAVAILABLE_MESSAGE } from "@/lib/stripe/billing";
import { getAppUrl } from "@/lib/supabase/config";

export const runtime = "nodejs";

function pricingRedirect(message: string) {
  return NextResponse.redirect(new URL(`/pricing?checkout_error=${encodeURIComponent(message)}`, getAppUrl()), 303);
}

export async function GET(request: Request) {
  try {
    const rateLimit = await enforceRateLimit({
      action: "stripe.checkout",
      limit: 8,
      windowSeconds: 10 * 60,
      requestHeaders: request.headers,
      metadata: { source: "pricing_checkout" }
    });

    if (!rateLimit.allowed) {
      return pricingRedirect(rateLimitMessage(rateLimit));
    }

    const session = await createOperationsIntelligenceCheckoutSession();

    if (!session.url) {
      return pricingRedirect(STRIPE_CHECKOUT_UNAVAILABLE_MESSAGE);
    }

    return NextResponse.redirect(session.url, 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : STRIPE_CHECKOUT_UNAVAILABLE_MESSAGE;
    return pricingRedirect(message);
  }
}

export async function POST(request: Request) {
  return GET(request);
}
