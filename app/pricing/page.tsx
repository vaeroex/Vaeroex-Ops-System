import Link from "next/link";
import type { Metadata } from "next";
import { Check, CircleHelp } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { PublicCtaBand, PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex Pricing",
  description: "Vaeroex Operations Intelligence is $500 per month for a private business workspace, Business Memory, KPI intelligence, and evidence-backed leadership support.",
  path: "/pricing"
});

const planInclusions = [
  "Private business workspace",
  "Business Memory",
  "Executive Overview and Business Health",
  "KPI and performance intelligence",
  "Risk and opportunity detection",
  "Evidence-backed recommendations",
  "Executive briefings",
  "File analysis and structured import review",
  "Search or Ask Vaeroex",
  "Continuous platform improvements"
] as const;

const setupSteps = [
  ["Create the workspace", "Choose the operating environment and add concise business context."],
  ["Add current evidence", "Upload reports, spreadsheets, KPIs, and relevant operating information."],
  ["Review the intelligence", "Vaeroex surfaces supported changes, risks, priorities, and recommended reviews."]
] as const;

type PricingPageProps = {
  searchParams?: Promise<{ checkout?: string; checkout_error?: string }>;
};

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const params = await searchParams;
  const checkoutError = params?.checkout_error;
  const checkoutCancelled = params?.checkout === "cancelled";

  const planCard = (
    <article className="overflow-hidden rounded-lg border border-cyan-300/20 bg-[#07111f] shadow-command">
      <div className="border-b border-white/10 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Operations Intelligence</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold text-white">One complete workspace</h2>
          <div className="text-right">
            <p className="text-4xl font-semibold text-white">{VAEROEX_PLAN_PRICE_LABEL}</p>
            <p className="mt-1 text-xs text-slate-400">Monthly subscription</p>
          </div>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-300">For owners, executives, and operations leaders who need clarity from fragmented business information.</p>
      </div>
      <div className="hidden gap-2 p-5 sm:grid sm:grid-cols-2 sm:p-6">
        {planInclusions.map((item) => (
          <div key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-200">
            <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-200" aria-hidden="true" />
            <span>{item}</span>
          </div>
        ))}
      </div>
      <details className="group border-b border-white/10 px-5 py-2 sm:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-white">
          Everything included
          <span className="text-xs text-cyan-200 group-open:hidden">View</span>
          <span className="hidden text-xs text-cyan-200 group-open:block">Close</span>
        </summary>
        <div className="grid gap-2 border-t border-white/10 py-4">
          {planInclusions.map((item) => (
            <div key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-200">
              <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-200" aria-hidden="true" />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </details>
      <div className="border-t border-white/10 p-5 sm:p-6">
        <StartWithVaeroexMenu className="w-full sm:w-auto" />
      </div>
    </article>
  );

  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />

      <PublicPageHero
        eyebrow="Simple pricing"
        title="Pay for operational clarity—not another place to manage work."
        description="One monthly subscription gives leadership a private Operations Intelligence workspace with Business Memory, performance context, evidence-backed recommendations, and executive briefings."
        actions={
          <a href={VAEROEX_MAILTO_LINKS.billing} className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">Billing questions</a>
        }
        aside={planCard}
      />

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-7xl">
          {checkoutError ? <div className="mb-6 rounded-lg border border-amber-300/30 bg-amber-950/25 p-4 text-sm font-semibold text-amber-100">{checkoutError}</div> : null}
          {checkoutCancelled ? <div className="mb-6 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">Checkout was cancelled. You can restart when you are ready.</div> : null}
          <div className="grid gap-10 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
            <div>
              <PublicSectionHeading eyebrow="Who it is for" title="Leaders who need a connected view of the business." />
              <p className="mt-4 text-sm leading-6 text-slate-300">Vaeroex is designed for an owner, CEO, COO, operations leader, or department leader who needs evidence-backed visibility across information already being created by the business.</p>
              <p className="mt-3 text-sm leading-6 text-slate-400">It is not priced as an employee collaboration suite, CRM, or task-management replacement.</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">How setup works</p>
              <ol className="mt-4 divide-y divide-white/10 border-y border-white/10">
                {setupSteps.map(([title, body], index) => (
                  <li key={title} className="grid gap-2 py-4 sm:grid-cols-[2rem_minmax(0,.35fr)_minmax(0,.65fr)]">
                    <span className="text-xs font-semibold text-cyan-200">0{index + 1}</span>
                    <h3 className="font-semibold text-white">{title}</h3>
                    <p className="text-sm leading-6 text-slate-400">{body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center gap-3">
            <CircleHelp className="h-5 w-5 text-cyan-200" aria-hidden="true" />
            <h2 className="text-2xl font-semibold text-white">Subscription questions</h2>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <details className="rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
              <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-semibold text-white">Does the subscription renew automatically?</summary>
              <p className="border-t border-white/10 pt-3 text-sm leading-6 text-slate-400">Yes. Vaeroex subscriptions renew monthly unless canceled. Review the <Link href="/subscription-billing-terms" className="font-semibold text-cyan-200 hover:text-white">Subscription Billing Terms</Link> for details.</p>
            </details>
            <details className="rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
              <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-semibold text-white">How are refunds handled?</summary>
              <p className="border-t border-white/10 pt-3 text-sm leading-6 text-slate-400">Refund requests are handled according to the <Link href="/refund-policy" className="font-semibold text-cyan-200 hover:text-white">Vaeroex Refund Policy</Link>.</p>
            </details>
            <details className="rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
              <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-semibold text-white">Can pricing change?</summary>
              <p className="border-t border-white/10 pt-3 text-sm leading-6 text-slate-400">Pricing may change in the future. Customers will receive advance notice before a pricing change takes effect.</p>
            </details>
            <details className="rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
              <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-semibold text-white">Who can help with billing?</summary>
              <p className="border-t border-white/10 pt-3 text-sm leading-6 text-slate-400">Contact <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-cyan-200 hover:text-white">{VAEROEX_CONTACT_EMAILS.billing}</a> for subscription or payment questions.</p>
            </details>
          </div>
        </div>
      </section>

      <PublicCtaBand
        title="Start with one private Operations Intelligence workspace."
        description="Bring together the evidence leadership already relies on and review what changed, what matters, and what needs attention next."
        primaryHref="/api/stripe/checkout"
        secondaryHref="/operations-intelligence"
        secondaryLabel="Explore the product"
      />
      <PublicFooter />
    </main>
  );
}
