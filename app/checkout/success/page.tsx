import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { retrieveStripeCheckoutSession, stripeObjectId } from "@/lib/stripe/billing";

export const dynamic = "force-dynamic";

type CheckoutSuccessPageProps = {
  searchParams?: Promise<{ session_id?: string }>;
};

type CheckoutState =
  | { kind: "ready"; workspaceId: string | null }
  | { kind: "preparing" }
  | { kind: "login_required"; sessionId: string }
  | { kind: "unverified" };

async function verifyCheckoutState(sessionId: string): Promise<CheckoutState> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return { kind: "unverified" };

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return { kind: "unverified" };

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return { kind: "login_required", sessionId };

  try {
    const session = await retrieveStripeCheckoutSession(sessionId);
    const intentId = session.metadata?.purchase_intent_id || session.client_reference_id;
    const metadataUserId = session.metadata?.vaeroex_user_id;
    const subscriptionId = stripeObjectId(session.subscription);
    const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";

    if (
      session.id !== sessionId ||
      session.mode !== "subscription" ||
      session.status !== "complete" ||
      !paid ||
      !intentId ||
      !subscriptionId ||
      metadataUserId !== user.id ||
      session.client_reference_id !== intentId
    ) {
      return { kind: "unverified" };
    }

    const { data: intent } = await admin
      .from("stripe_checkout_intents")
      .select("id,user_id,stripe_checkout_session_id,stripe_subscription_id,status")
      .eq("id", intentId)
      .eq("user_id", user.id)
      .eq("stripe_checkout_session_id", sessionId)
      .maybeSingle();

    if (!intent) return { kind: "unverified" };
    if (intent.stripe_subscription_id && intent.stripe_subscription_id !== subscriptionId) {
      return { kind: "unverified" };
    }

    const { data: subscription } = await admin
      .from("customer_subscriptions")
      .select("workspace_id,status,current_period_end,billing_provider,stripe_checkout_intent_id,stripe_subscription_id")
      .eq("stripe_checkout_intent_id", intentId)
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    const periodEnd = subscription?.current_period_end ? Date.parse(subscription.current_period_end) : Number.NaN;
    const ready =
      subscription?.billing_provider === "stripe" &&
      ["active", "trialing"].includes(subscription.status) &&
      Number.isFinite(periodEnd) &&
      periodEnd > Date.now();

    return ready
      ? { kind: "ready", workspaceId: subscription.workspace_id }
      : { kind: "preparing" };
  } catch {
    return { kind: "unverified" };
  }
}

export default async function CheckoutSuccessPage({ searchParams }: CheckoutSuccessPageProps) {
  const params = await searchParams;
  const sessionId = params?.session_id || "";
  const state = await verifyCheckoutState(sessionId);
  const title = state.kind === "ready"
    ? "Subscription ready"
    : state.kind === "preparing"
      ? "Payment confirmed"
      : state.kind === "login_required"
        ? "Sign in to verify your subscription"
        : "Checkout could not be verified";
  const description = state.kind === "ready"
    ? "Your Executive Intelligence subscription is active and securely connected to your Vaeroex account."
    : state.kind === "preparing"
      ? "Stripe confirmed the subscription. Vaeroex is still receiving the signed billing event needed to prepare access. Refresh shortly; you will not be asked to pay again."
      : state.kind === "login_required"
        ? "Use the same verified Vaeroex account that started Checkout. Vaeroex will verify the completed Stripe Session before showing subscription access."
        : "Vaeroex did not find a completed subscription belonging to this signed-in account. No access was granted from the URL alone.";

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto grid max-w-4xl gap-6 px-6 py-16">
        <div className="rounded-lg border border-line bg-white p-8 shadow-command">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Checkout</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">{description}</p>

          <div className="mt-7 flex flex-wrap gap-3">
            {state.kind === "ready" ? (
              <Link href={state.workspaceId ? "/app" : "/app/setup"} className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                {state.workspaceId ? "Open Vaeroex" : "Create your workspace"}
              </Link>
            ) : null}
            {state.kind === "preparing" ? (
              <Link href={`/checkout/success?session_id=${encodeURIComponent(sessionId)}`} className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white">
                Check again
              </Link>
            ) : null}
            {state.kind === "login_required" ? (
              <Link href={`/login?next=${encodeURIComponent(`/checkout/success?session_id=${state.sessionId}`)}`} className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white">
                Sign in
              </Link>
            ) : null}
            {state.kind === "unverified" ? (
              <Link href="/pricing" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold">
                Return to Pricing
              </Link>
            ) : null}
          </div>

          <p className="mt-6 text-sm leading-6 text-muted">
            Your subscription renews automatically unless cancellation is scheduled through Manage billing. Cancellation prevents the next renewal, while paid access continues through the end of the current billing period. Payments are final and non-refundable except where required by applicable law, with no prorated refund or credit for unused time.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted">
            Your subscription price will not increase while it remains continuously active. If Vaeroex lowers the applicable subscription price, active subscribers will receive the lower price for future renewals. If you cancel and later resubscribe, the new subscription uses the pricing available at that time.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted">
            Billing questions can be sent to{" "}
            <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
              {VAEROEX_CONTACT_EMAILS.billing}
            </a>
            .
          </p>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
