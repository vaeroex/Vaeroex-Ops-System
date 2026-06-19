import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { squarespaceCheckoutUrl } from "@/lib/billing/squarespace-plan-map";
import { VAEROEX_PLAN_FEATURES, VAEROEX_PLAN_NAME, VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";

const outcomes = [
  "Business Health Score",
  "Executive Briefings",
  "Profit Leak Detection",
  "Business Memory",
  "Accountability Signals",
  "KPI Tracking",
  "Reports",
  "CRM",
  "SOPs",
  "Decision Support"
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <section className="mx-auto max-w-5xl px-6 py-10">
        <Link href="/" className="text-sm font-semibold text-vaeroex-blue">
          Vaeroex
        </Link>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Everything included</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight">Operations intelligence for growing businesses.</h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
              Build the structure your growth depends on. Vaeroex brings visibility, accountability, and execution support into one subscription.
              Checkout is handled securely on Squarespace.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a href={squarespaceCheckoutUrl} className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white">
                Subscribe on Squarespace
              </a>
              <Link href="/signup" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold">
                Create account
              </Link>
            </div>
          </div>

          <article className="rounded-lg border border-line bg-white p-6 shadow-panel">
            <p className="text-sm text-muted">Plan</p>
            <h2 className="mt-2 text-3xl font-semibold">{VAEROEX_PLAN_NAME}</h2>
            <p className="mt-2 text-lg font-semibold text-vaeroex-blue">{VAEROEX_PLAN_PRICE_LABEL}</p>
            <p className="mt-3 text-sm leading-6 text-muted">
              Everything included for operational clarity, business intelligence, accountability, and decision support. Squarespace remains the source of truth for checkout, billing, and subscription status.
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
          <h2 className="text-xl font-semibold">Built to help owners see what matters and act on it</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {outcomes.map((outcome) => (
              <div key={outcome} className="rounded-lg border border-line bg-slate-50 p-3 text-sm font-semibold">
                {outcome}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-lg border border-line bg-white p-6 shadow-panel">
          <h2 className="text-xl font-semibold">Included platform capabilities</h2>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {VAEROEX_PLAN_FEATURES.map((feature) => (
              <div key={feature} className="rounded-lg border border-line px-3 py-2 text-sm text-muted">
                {feature}
              </div>
            ))}
          </div>
        </section>
        <section className="mt-6 rounded-lg border border-line bg-white p-5 text-xs leading-5 text-muted shadow-panel">
          <p>Subscriptions renew automatically unless canceled. Cancel anytime. Pricing may change in the future with advance notice. Refunds are handled according to the Refund Policy.</p>
          <p className="mt-2">Vaeroex outputs require human review before customers rely on recommendations or save generated records.</p>
        </section>
      </section>
      <PublicFooter />
    </main>
  );
}
