import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { squarespaceCheckoutUrl } from "@/lib/billing/squarespace-plan-map";
import { VAEROEX_PLAN_NAME, VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

const platformCapabilities = [
  "Visibility",
  "Decision Support",
  "Context Memory",
  "Accountability",
  "Execution Support"
] as const;

const buyingSummary = [
  ["Platform", "Vaeroex Intelligence Platform"],
  ["Current capability", "Operations Intelligence"],
  ["Included access", "1 workspace and 10 users"],
  ["Monthly subscription", VAEROEX_PLAN_PRICE_LABEL]
] as const;

const operationsSummary = [
  "Executive visibility into business health, priorities, risks, and performance signals.",
  "Workspace tools for KPIs, CRM, reports, files, SOPs, checklists, tasks, issues, and people context.",
  "Vaeroex recommendations, business memory, scheduled reports, alerts, and reviewed next actions."
] as const;

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="vaeroex-hero-reveal">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Pricing</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">One Vaeroex subscription. Everything included.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
              One subscription for the Vaeroex Intelligence Platform, including Operations Intelligence and all current platform capabilities.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={squarespaceCheckoutUrl} className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white">
                Start with Vaeroex
              </a>
              <Link href="/operations-intelligence" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                Explore Operations Intelligence
              </Link>
            </div>
          </div>

          <ScrollReveal as="article" delayMs={120} className="vaeroex-pricing-card vaeroex-hover-card rounded-lg border border-line bg-white p-6 shadow-command">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Everything Included</p>
            <h2 className="mt-3 text-3xl font-semibold">{VAEROEX_PLAN_NAME}</h2>
            <p className="mt-2 text-2xl font-semibold text-vaeroex-blue">{VAEROEX_PLAN_PRICE_LABEL}</p>
            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              {buyingSummary.map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm leading-6 text-muted">
              Your Vaeroex subscription is managed through Vaeroex checkout and official Vaeroex sales channels.
            </p>
            <div className="mt-5 rounded-lg border border-line bg-slate-50 p-4">
              <p className="text-sm font-semibold">Included usage</p>
              <ul className="mt-2 space-y-2 text-sm text-muted">
                <li>1 workspace included</li>
                <li>10 users included</li>
                <li>Vaeroex usage for decision support</li>
                <li>All current platform capabilities included</li>
              </ul>
            </div>
          </ScrollReveal>
        </div>

        <section className="mt-8 rounded-lg border border-line bg-white p-6 shadow-panel">
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">What You Are Buying</p>
              <h2 className="mt-2 text-xl font-semibold">A single subscription to the Vaeroex Intelligence Platform.</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                The subscription gives you access to Vaeroex as the platform, with Operations Intelligence included as the current capability available today.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {platformCapabilities.map((feature, index) => (
                <ScrollReveal key={feature} delayMs={(index % 5) * 45} className="vaeroex-hover-card rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold">
                  {feature}
                </ScrollReveal>
              ))}
            </div>
          </div>

          <div className="mt-6 border-t border-line pt-6">
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Current Included Capability</p>
                <h2 className="mt-2 text-xl font-semibold">Operations Intelligence</h2>
                <p className="mt-3 text-sm leading-6 text-muted">
                  Operations Intelligence is the included capability that helps teams understand operational activity, performance, accountability, and follow-through.
                </p>
                <Link href="/operations-intelligence" className="mt-4 inline-flex rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                  Learn More
                </Link>
              </div>
              <div className="grid gap-3">
                {operationsSummary.map((summary, index) => (
                  <ScrollReveal key={summary} delayMs={index * 55} className="vaeroex-hover-card rounded-lg border border-line bg-slate-50 p-4 text-sm leading-6 text-muted">
                    {summary}
                  </ScrollReveal>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-line bg-white p-5 text-xs leading-5 text-muted shadow-panel">
          <p>Vaeroex subscriptions renew automatically unless canceled. Cancel anytime. Pricing may change in the future with advance notice.</p>
          <p className="mt-2">Refunds are handled according to the Refund Policy. Promotions, discounts, and special offers may be available through the Vaeroex Direct Website or official Vaeroex sales channels.</p>
          <p className="mt-2">
            Billing, subscription, or payment questions can be sent to{" "}
            <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
              {VAEROEX_CONTACT_EMAILS.billing}
            </a>
            .
          </p>
          <p className="mt-2">Vaeroex outputs require human review before customers rely on recommendations or save generated records.</p>
        </section>
      </section>

      <PublicFooter />
    </main>
  );
}
