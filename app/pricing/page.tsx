import Link from "next/link";
import type { Metadata } from "next";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { VAEROEX_PLAN_LIMITS, VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex Pricing",
  description: "Review Vaeroex subscription pricing for Operations Intelligence.",
  path: "/pricing"
});

const buyingSummary = [
  ["Workspace", `${VAEROEX_PLAN_LIMITS.max_workspaces} included`],
  ["Users", `${VAEROEX_PLAN_LIMITS.max_users} included`],
  ["Billing", "Monthly subscription"]
] as const;

const subscriptionDetails = [
  `${VAEROEX_PLAN_LIMITS.max_workspaces} workspace included`,
  `${VAEROEX_PLAN_LIMITS.max_users} users included`,
  "Monthly subscription",
  "Subscription renews automatically unless canceled",
  "Pricing may change with advance notice",
  "Refunds handled according to the Refund Policy"
] as const;

type PricingPageProps = {
  searchParams?: Promise<{ checkout?: string; checkout_error?: string }>;
};

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const params = await searchParams;
  const checkoutError = params?.checkout_error;
  const checkoutCancelled = params?.checkout === "cancelled";

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <div className="vaeroex-hero-reveal">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Pricing</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Vaeroex Pricing</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
              Vaeroex pricing is organized by product and subscription type. Choose the Vaeroex subscription you want to start with.
            </p>
            <div className="mt-6 flex flex-wrap items-start gap-3">
              <StartWithVaeroexMenu />
              <a href={VAEROEX_MAILTO_LINKS.billing} className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                Billing Questions
              </a>
            </div>
          </div>

          <ScrollReveal as="article" delayMs={120} className="vaeroex-pricing-card vaeroex-hover-card rounded-lg border border-line bg-white p-6 shadow-command">
            {checkoutError ? (
              <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
                {checkoutError}
              </div>
            ) : null}
            {checkoutCancelled ? (
              <div className="mb-5 rounded-lg border border-line bg-slate-50 p-4 text-sm font-semibold text-muted">
                Checkout was cancelled. You can restart when you are ready.
              </div>
            ) : null}
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Available Product</p>
                <h2 className="mt-3 text-3xl font-semibold">Operations Intelligence</h2>
                <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
                  For organizations that need operational visibility, accountability, execution, and decision support.
                </p>
              </div>
              <div className="shrink-0 rounded-lg border border-vaeroex-blue/20 bg-vaeroex-soft px-4 py-3 text-left sm:text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-vaeroex-blue">Price</p>
                <p className="mt-1 text-3xl font-semibold text-vaeroex-blue">{VAEROEX_PLAN_PRICE_LABEL}</p>
              </div>
            </div>

            <dl className="mt-5 grid gap-2 sm:grid-cols-3">
              {buyingSummary.map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 flex flex-wrap gap-3">
              <a href="/api/stripe/checkout" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                Start With Vaeroex
              </a>
              <Link href="/operations-intelligence" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                Learn More
              </Link>
            </div>

            <details className="mt-6 rounded-lg border border-line bg-slate-50">
              <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-ink hover:text-vaeroex-blue [&::-webkit-details-marker]:hidden">
                Subscription Details
              </summary>
              <div className="grid gap-2 border-t border-line p-4">
                {subscriptionDetails.map((detail) => (
                  <div key={detail} className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold">
                    {detail}
                  </div>
                ))}
                <div className="rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold">
                  Billing questions:{" "}
                  <a href={VAEROEX_MAILTO_LINKS.billing} className="text-vaeroex-blue hover:text-vaeroex-accent">
                    {VAEROEX_CONTACT_EMAILS.billing}
                  </a>
                </div>
              </div>
            </details>
          </ScrollReveal>
        </div>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <ScrollReveal className="rounded-lg border border-line bg-white p-6 shadow-panel">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Billing Details</p>
            <div className="mt-3 space-y-3 text-sm leading-6 text-muted">
              <p>Vaeroex subscriptions renew automatically unless canceled.</p>
              <p>Pricing may change in the future. Customers will receive advance notice before pricing changes take effect.</p>
              <p>Refunds are handled according to the Vaeroex Refund Policy.</p>
            </div>
          </ScrollReveal>

          <ScrollReveal delayMs={120} className="rounded-lg border border-line bg-white p-6 shadow-panel">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Contact</p>
            <div className="mt-3 space-y-3 text-sm leading-6 text-muted">
              <p>
                Billing, subscription, or payment questions can be sent to{" "}
                <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
                  {VAEROEX_CONTACT_EMAILS.billing}
                </a>
                .
              </p>
              <p>
                General questions can be sent to{" "}
                <a href={VAEROEX_MAILTO_LINKS.general} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
                  {VAEROEX_CONTACT_EMAILS.general}
                </a>
                .
              </p>
            </div>
          </ScrollReveal>
        </section>
      </section>

      <PublicFooter />
    </main>
  );
}
