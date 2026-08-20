import Link from "next/link";
import type { Metadata } from "next";
import type { Route } from "next";
import { ShieldCheck } from "lucide-react";
import { acceptPreCheckoutLegalPoliciesAction } from "@/app/checkout/legal/actions";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import {
  hasAcceptedCurrentPreCheckoutPolicies,
  preCheckoutAcceptanceSnapshot
} from "@/lib/legal/pre-checkout-acceptance";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Review Terms Before Checkout | Vaeroex",
  description: "Review and accept the current Vaeroex subscription terms before Stripe Checkout."
};

type CheckoutLegalPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function CheckoutLegalPage({ searchParams }: CheckoutLegalPageProps) {
  const params = await searchParams;
  const snapshot = preCheckoutAcceptanceSnapshot();
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  const acceptedCurrent = user && supabase
    ? await hasAcceptedCurrentPreCheckoutPolicies(supabase, user.id)
    : false;

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto grid max-w-5xl gap-6 px-6 py-10">
        <div className="rounded-lg border border-line bg-white p-6 shadow-command sm:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Required before Checkout</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">Review Vaeroex subscription terms.</h1>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
                Before Stripe Checkout opens, Vaeroex records that the authenticated account reviewed and accepted the current Terms of Service, Privacy Policy, Subscription and Billing Terms, and incorporated policies.
              </p>
            </div>
            <div className="rounded-lg border border-vaeroex-blue/15 bg-vaeroex-soft p-4 text-sm">
              <p className="font-semibold text-vaeroex-blue">Executive Intelligence</p>
              <p className="mt-2 text-2xl font-semibold">{VAEROEX_PLAN_PRICE_LABEL}</p>
              <p className="mt-1 text-muted">Recurring monthly subscription</p>
            </div>
          </div>

          {params?.error ? <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-950">{params.error}</div> : null}
          {params?.message ? <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">{params.message}</div> : null}
          {!user ? (
            <div className="mt-6 rounded-lg border border-line bg-slate-50 p-4 text-sm leading-6 text-muted">
              Create or sign in to a verified Vaeroex account before reviewing terms and starting Checkout.
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/signup?next=%2Fcheckout%2Flegal" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Create account</Link>
                <Link href="/login?next=%2Fcheckout%2Flegal" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">Log in</Link>
              </div>
            </div>
          ) : null}
          {user && !user.email_confirmed_at ? (
            <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              Verify your email before Checkout so the subscription can be connected to the right Vaeroex account.
            </div>
          ) : null}
        </div>

        <section className="rounded-lg border border-line bg-white p-6 shadow-panel sm:p-8">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-vaeroex-soft text-vaeroex-blue">
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-semibold">Terms and incorporated policies</h2>
              <p className="mt-2 text-sm leading-6 text-muted">
                Open these documents in a new tab before accepting. The Terms of Service incorporate or reference the applicable supporting policies listed here.
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {snapshot.requiredPolicies.map((policy) => (
              <Link
                key={policy.id}
                href={policy.href as Route}
                target="_blank"
                className="rounded-lg border border-line bg-slate-50 p-4 text-sm hover:border-vaeroex-blue"
              >
                <span className="block font-semibold text-ink">{policy.title}</span>
                <span className="mt-2 block text-xs text-muted">Version {policy.version}</span>
              </Link>
            ))}
          </div>

          <div className="mt-6 rounded-lg border border-line bg-slate-50 p-4 text-sm leading-6 text-slate-700">
            <p>
              Executive Intelligence is {VAEROEX_PLAN_PRICE_LABEL}. It is a recurring monthly subscription that renews automatically, and the applicable payment method will be charged each billing period unless cancellation is scheduled through Manage billing in the Stripe Customer Portal.
            </p>
            <p className="mt-3">
              Cancellation prevents the next renewal and takes effect at the end of the current paid billing period, with access continuing through that paid period where applicable. Payments are final and non-refundable except where required by applicable law. Review the{" "}
              <Link href="/subscription-billing-terms" target="_blank" className="font-semibold text-vaeroex-blue">Subscription and Billing Terms</Link>
              {" "}and{" "}
              <Link href="/refund-policy" target="_blank" className="font-semibold text-vaeroex-blue">Refund Policy</Link>
              {" "}for details.
            </p>
            <p className="mt-3">
              Billing questions can be sent to{" "}
              <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue">{VAEROEX_CONTACT_EMAILS.billing}</a>.
            </p>
          </div>

          <form action={acceptPreCheckoutLegalPoliciesAction} className="mt-6 space-y-4">
            <input type="hidden" name="required_policy_hash" value={snapshot.requiredPolicyHash} />
            <label className="flex gap-3 rounded-lg border border-line p-4 text-sm leading-6">
              <input name="accept_pre_checkout_legal" type="checkbox" required className="mt-1 h-4 w-4 shrink-0 accent-vaeroex-blue" />
              <span>
                I have reviewed and agree to the Vaeroex Terms of Service, Privacy Policy, Subscription and Billing Terms, Refund Policy, and the incorporated responsible-use, AI, sensitive-data, data-retention, and human-review policies listed above.
              </span>
            </label>
            <button
              disabled={!user || !user.email_confirmed_at || Boolean(acceptedCurrent)}
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Accept and continue to Stripe Checkout
            </button>
            {acceptedCurrent ? (
              <Link href="/api/stripe/checkout" className="ml-0 inline-flex min-h-11 items-center justify-center rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white sm:ml-3">
                Continue to Stripe Checkout
              </Link>
            ) : null}
          </form>
        </section>
      </section>
      <PublicFooter />
    </main>
  );
}
