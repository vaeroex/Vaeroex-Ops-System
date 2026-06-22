import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { squarespaceCheckoutUrl } from "@/lib/billing/squarespace-plan-map";
import { VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

const buyingSummary = [
  ["Product", "Operations Intelligence"],
  ["Price", VAEROEX_PLAN_PRICE_LABEL],
  ["Workspace", "1 included"],
  ["Users", "10 included"]
] as const;

const includedItems = [
  "Executive dashboard and business health view",
  "KPIs, CRM, reports, files, SOPs, tasks, issues, checklists, people, and notifications",
  "Vaeroex analysis, recommendations, business memory, and report scheduling",
  "Support, help resources, demo workspace, and security-focused workspace access"
] as const;

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="vaeroex-hero-reveal">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Pricing</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Operations Intelligence pricing.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
              One Vaeroex subscription gives your business access to Operations Intelligence for {VAEROEX_PLAN_PRICE_LABEL}.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={squarespaceCheckoutUrl} className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white">
                Start with Vaeroex
              </a>
              <Link href="/operations-intelligence" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                What does it do?
              </Link>
            </div>
          </div>

          <ScrollReveal as="article" delayMs={120} className="vaeroex-pricing-card vaeroex-hover-card rounded-lg border border-line bg-white p-6 shadow-command">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Single Subscription</p>
            <h2 className="mt-3 text-3xl font-semibold">Operations Intelligence</h2>
            <p className="mt-2 text-3xl font-semibold text-vaeroex-blue">{VAEROEX_PLAN_PRICE_LABEL}</p>
            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              {buyingSummary.map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-sm leading-6 text-muted">
              Your subscription is managed through Vaeroex checkout and official Vaeroex sales channels.
            </p>
          </ScrollReveal>
        </div>

        <section className="mt-8 rounded-lg border border-line bg-white p-6 shadow-panel">
          <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">What You Are Buying</p>
              <h2 className="mt-2 text-xl font-semibold">Operations Intelligence for one workspace.</h2>
              <p className="mt-3 text-sm leading-6 text-muted">
                This subscription is for the current Operations Intelligence product. Product education, screenshots, workflows, and implementation details live on the Operations Intelligence page.
              </p>
              <Link href="/operations-intelligence" className="mt-4 inline-flex rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                Learn More
              </Link>
            </div>
            <div className="grid gap-3">
              {includedItems.map((item, index) => (
                <ScrollReveal key={item} delayMs={index * 45} className="vaeroex-hover-card rounded-lg border border-line bg-slate-50 p-4 text-sm leading-6 text-muted">
                  {item}
                </ScrollReveal>
              ))}
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
