import Link from "next/link";
import { squarespaceCheckoutUrls } from "@/lib/billing/squarespace-plan-map";

const plans = [
  {
    slug: "starter" as const,
    name: "Starter Operations System",
    description: "Best for solo owners or small teams that need basic forms, checklists, SOPs, and reports.",
    limits: ["1 workspace", "3 users", "10 forms", "10 checklists", "50 Vaeroex runs/month"],
    features: ["Dashboard", "Forms", "Checklists", "Tasks", "Issues", "SOPs", "Basic Vaeroex", "Weekly report"]
  },
  {
    slug: "growth" as const,
    name: "Growth Operations System",
    description: "Best for growing businesses that need team accountability, workflows, asset tracking, and more Vaeroex reports.",
    limits: ["3 workspaces", "10 users", "50 forms", "50 checklists", "250 Vaeroex runs/month"],
    features: ["Everything in Starter", "Asset tracking", "People directory", "Advanced reports", "More Vaeroex runs", "Industry templates"]
  },
  {
    slug: "pro" as const,
    name: "Pro Operations System",
    description: "Best for businesses with multiple locations, more users, more workflows, and heavier reporting needs.",
    limits: ["10 workspaces", "25 users", "Unlimited forms", "Unlimited checklists", "1000 Vaeroex runs/month"],
    features: ["Everything in Growth", "Multi-location support", "More reports", "Priority setup support", "Custom workflow support"]
  }
];

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-ink">
      <section className="mx-auto max-w-6xl">
        <Link href="/" className="text-sm font-semibold text-vaeroex-blue">
          Vaeroex Ops System
        </Link>
        <h1 className="mt-5 text-4xl font-semibold tracking-tight">Choose your operations system</h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
          Checkout is handled securely on Squarespace. After purchase, create your Vaeroex account with the same email used at checkout.
        </p>
        <div className="mt-8 grid gap-5 lg:grid-cols-3">
          {plans.map((plan) => (
            <article key={plan.slug} className="rounded-lg border border-line bg-white p-6 shadow-panel">
              <h2 className="text-xl font-semibold">{plan.name}</h2>
              <p className="mt-3 text-sm leading-6 text-muted">{plan.description}</p>
              <div className="mt-5">
                <p className="text-sm font-semibold">Limits</p>
                <ul className="mt-2 space-y-2 text-sm text-muted">
                  {plan.limits.map((limit) => (
                    <li key={limit}>{limit}</li>
                  ))}
                </ul>
              </div>
              <div className="mt-5">
                <p className="text-sm font-semibold">Included</p>
                <ul className="mt-2 space-y-2 text-sm text-muted">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
              </div>
              <a
                href={squarespaceCheckoutUrls[plan.slug]}
                className="mt-6 inline-flex w-full justify-center rounded-lg bg-vaeroex-blue px-4 py-2.5 text-sm font-semibold text-white"
              >
                Buy on Squarespace
              </a>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
