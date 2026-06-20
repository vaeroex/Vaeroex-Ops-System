import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { squarespaceCheckoutUrl } from "@/lib/billing/squarespace-plan-map";
import { VAEROEX_PLAN_FEATURES, VAEROEX_PLAN_NAME, VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";

const included = [
  "Vaeroex Intelligence Platform",
  "Operations Intelligence Suite",
  "Executive Dashboard",
  "Business Health Score",
  "Business Memory",
  "Profit Leak Detection",
  "Predictive Insights",
  "Decision Support",
  "KPIs",
  "CRM",
  "Reports",
  "SOPs",
  "Tasks",
  "Issues",
  "Files",
  "People",
  "Team Accountability",
  "Notifications",
  "Scheduled Reports",
  "Vaeroex"
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Pricing</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">One Vaeroex plan. Everything included.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
              Build the structure your growth depends on. Vaeroex brings the Operations Intelligence Suite into one subscription for visibility, accountability, execution, and decision support.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={squarespaceCheckoutUrl} className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white">
                Start Vaeroex Subscription
              </a>
              <Link href="/demo" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                Book a Demo
              </Link>
            </div>
          </div>

          <article className="rounded-lg border border-line bg-white p-6 shadow-command">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Everything Included</p>
            <h2 className="mt-3 text-3xl font-semibold">{VAEROEX_PLAN_NAME}</h2>
            <p className="mt-2 text-2xl font-semibold text-vaeroex-blue">{VAEROEX_PLAN_PRICE_LABEL}</p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Platform</p>
                <p className="mt-1 text-sm font-semibold">Vaeroex Intelligence Platform</p>
              </div>
              <div className="rounded-lg border border-line bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Product</p>
                <p className="mt-1 text-sm font-semibold">Operations Intelligence Suite</p>
              </div>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">
              Your Vaeroex subscription is managed through Vaeroex checkout and official Vaeroex sales channels.
            </p>
            <div className="mt-5 rounded-lg border border-line bg-slate-50 p-4">
              <p className="text-sm font-semibold">Included usage</p>
              <ul className="mt-2 space-y-2 text-sm text-muted">
                <li>1 workspace included</li>
                <li>10 users included</li>
                <li>Generous Vaeroex usage for decision support</li>
                <li>All visibility, accountability, and execution tools included</li>
              </ul>
            </div>
          </article>
        </div>

        <section className="mt-8 rounded-lg border border-line bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold">Included platform capabilities</h2>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {included.map((feature) => (
              <div key={feature} className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold">
                {feature}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-line bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold">Plan details</h2>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {VAEROEX_PLAN_FEATURES.map((feature) => (
              <div key={feature} className="rounded-lg border border-line px-3 py-2 text-sm text-muted">
                {feature}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-line bg-white p-5 text-xs leading-5 text-muted shadow-panel">
          <p>Vaeroex subscriptions renew automatically unless canceled. Cancel anytime. Pricing may change in the future with advance notice.</p>
          <p className="mt-2">Refunds are handled according to the Refund Policy. Promotions, discounts, and special offers may be available through the Vaeroex Direct Website or official Vaeroex sales channels.</p>
          <p className="mt-2">Vaeroex outputs require human review before customers rely on recommendations or save generated records.</p>
        </section>
      </section>

      <PublicFooter />
    </main>
  );
}
