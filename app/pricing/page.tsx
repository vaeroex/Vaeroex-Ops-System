import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { VAEROEX_PLAN_LIMITS, VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

const buyingSummary = [
  ["Product name", "Operations Intelligence"],
  ["Price", VAEROEX_PLAN_PRICE_LABEL],
  ["Included workspace", `${VAEROEX_PLAN_LIMITS.max_workspaces} included`],
  ["Included users", `${VAEROEX_PLAN_LIMITS.max_users} included`]
] as const;

const subscriptionDetails = [
  "One Vaeroex subscription",
  `${VAEROEX_PLAN_LIMITS.max_workspaces} workspace included`,
  `${VAEROEX_PLAN_LIMITS.max_users} users included`,
  "Monthly subscription",
  "Automatic renewal unless canceled",
  "Subscription access managed by Vaeroex"
] as const;

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
          <div className="vaeroex-hero-reveal">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Pricing</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Operations Intelligence pricing.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
              A single Vaeroex subscription for the current Operations Intelligence capability.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                Start With Vaeroex
              </Link>
              <a href={VAEROEX_MAILTO_LINKS.billing} className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                Billing Questions
              </a>
            </div>
          </div>

          <ScrollReveal as="article" delayMs={120} className="vaeroex-pricing-card vaeroex-hover-card rounded-lg border border-line bg-white p-6 shadow-command">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Vaeroex Subscription</p>
            <h2 className="mt-3 text-3xl font-semibold">Operations Intelligence</h2>
            <p className="mt-2 text-4xl font-semibold text-vaeroex-blue">{VAEROEX_PLAN_PRICE_LABEL}</p>
            <dl className="mt-5 grid gap-2 sm:grid-cols-2">
              {buyingSummary.map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </ScrollReveal>
        </div>

        <section className="mt-8 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
          <ScrollReveal className="rounded-lg border border-line bg-white p-6 shadow-panel">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Subscription Details</p>
            <h2 className="mt-2 text-2xl font-semibold">What is included in the subscription?</h2>
            <div className="mt-4 grid gap-2">
              {subscriptionDetails.map((detail) => (
                <div key={detail} className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold">
                  {detail}
                </div>
              ))}
            </div>
          </ScrollReveal>

          <ScrollReveal delayMs={120} className="rounded-lg border border-line bg-white p-6 shadow-panel">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Billing Details</p>
            <div className="mt-3 space-y-3 text-sm leading-6 text-muted">
              <p>Vaeroex subscriptions renew automatically unless canceled.</p>
              <p>Customers can manage subscription-related requests through the Vaeroex website or by contacting Vaeroex billing.</p>
              <p>Pricing may change in the future. Customers will receive advance notice before pricing changes take effect.</p>
              <p>Refunds are handled according to the Vaeroex Refund Policy.</p>
              <p>
                Billing, subscription, or payment questions can be sent to{" "}
                <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
                  {VAEROEX_CONTACT_EMAILS.billing}
                </a>
                .
              </p>
            </div>
          </ScrollReveal>
        </section>

        <section className="mt-8 rounded-lg border border-line bg-vaeroex-navy p-6 text-white shadow-command">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Start</p>
              <h2 className="mt-2 text-2xl font-semibold">Create your Vaeroex account.</h2>
              <p className="mt-2 text-sm leading-6 text-slate-300">
                Begin with account setup, then continue toward workspace creation and subscription access.
              </p>
            </div>
            <Link href="/signup" className="inline-flex shrink-0 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Start With Vaeroex
            </Link>
          </div>
        </section>
      </section>

      <PublicFooter />
    </main>
  );
}
