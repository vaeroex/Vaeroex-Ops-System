import Link from "next/link";
import type { Metadata } from "next";
import { Check, CircleHelp } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { VAEROEX_PLAN_PRICE_LABEL } from "@/lib/billing/plans";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { PUBLIC_SYSTEMS } from "@/lib/marketing/public-systems";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex Intelligence Pricing",
  description: "Review current availability and pricing across Executive Intelligence, Drug Discovery Intelligence, and Biological Intelligence.",
  path: "/pricing"
});

const executiveInclusions = [
  "Private business workspace",
  "Business Health and View Analysis",
  "KPIs and performance context",
  "Prioritized Intelligence and Explain Finding",
  "Evidence and trusted business context",
  "Saved Analyses and document analysis"
] as const;

type PricingPageProps = {
  searchParams?: Promise<{ checkout?: string; checkout_error?: string }>;
};

export default async function PricingPage({ searchParams }: PricingPageProps) {
  const params = await searchParams;
  const checkoutError = params?.checkout_error;
  const checkoutCancelled = params?.checkout === "cancelled";

  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />

      <PublicPageHero
        eyebrow="Vaeroex Intelligence"
        title="Current availability across specialized intelligence."
        description="Executive Intelligence is available through the current Vaeroex subscription. Drug Discovery Intelligence and Biological Intelligence remain in development, with pricing not yet announced."
        actions={
          <a href={VAEROEX_MAILTO_LINKS.billing} className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">Billing questions</a>
        }
      />

      <section id="intelligence-pricing" className="border-b border-white/10 px-5 py-12 sm:px-6 sm:py-14" aria-label="Vaeroex intelligence availability and pricing">
        <div className="mx-auto max-w-[86rem]">
          <PublicSectionHeading
            eyebrow="Intelligence areas"
            title="Three specialized offerings. One clear availability state for each."
            description="Executive Intelligence is available now. Drug Discovery Intelligence and Biological Intelligence remain in development and cannot initiate checkout or subscription activation."
          />
          <div className="mt-8 grid items-stretch gap-4 lg:grid-cols-3">
            {PUBLIC_SYSTEMS.map((system) => (
              <article key={system.id} data-pricing-system={system.id} className={`flex min-h-[31rem] flex-col rounded-lg border bg-[#07111f] p-5 shadow-command sm:p-6 ${system.availability === "available" ? "border-cyan-300/30" : "border-white/10"}`}>
                <header className="border-b border-white/10 pb-5">
                  <p className="text-xs font-semibold uppercase tracking-normal text-cyan-200">{system.statusLabel}</p>
                  <h2 className="mt-4 text-2xl font-semibold text-white">
                    <Link href={system.route} className="rounded-sm hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">{system.name}</Link>
                  </h2>
                  <p className="mt-3 text-sm leading-6 text-slate-400">{system.description}</p>
                </header>

                {system.availability === "available" ? (
                  <div className="flex flex-1 flex-col pt-5">
                    <div>
                      <p className="text-3xl font-semibold text-white">{VAEROEX_PLAN_PRICE_LABEL}</p>
                      <p className="mt-1 text-xs text-slate-400">Monthly subscription</p>
                    </div>
                    <div className="mt-6">
                      <h3 className="text-sm font-semibold text-white">What&apos;s included</h3>
                      <ul className="mt-3 space-y-2">
                        {executiveInclusions.map((item) => (
                          <li key={item} className="flex items-start gap-2 text-sm leading-6 text-slate-300">
                            <Check className="mt-1 h-4 w-4 shrink-0 text-emerald-200" aria-hidden="true" />
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="mt-auto pt-6">
                      <StartWithVaeroexMenu className="w-full" />
                      <p className="mt-4 text-xs leading-5 text-slate-400">Renews monthly unless canceled through Manage billing. Cancellation takes effect at the end of the current paid billing period and prevents the next renewal. Payments are final and non-refundable except where required by applicable law.</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col pt-5">
                    <p className="text-xl font-semibold text-white">{system.pricing.display}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-400">This specialized Vaeroex intelligence environment is not currently available for purchase or subscription activation.</p>
                    <span className="mt-auto inline-flex min-h-11 items-center border-y border-cyan-300/20 py-3 text-sm font-semibold uppercase text-cyan-100" aria-disabled="true">
                      {system.pricing.ctaLabel}
                    </span>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-7xl">
          {checkoutError ? <div className="mb-6 rounded-lg border border-amber-300/30 bg-amber-950/25 p-4 text-sm font-semibold text-amber-100">{checkoutError}</div> : null}
          {checkoutCancelled ? <div className="mb-6 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-sm text-slate-300">Checkout was cancelled. You can restart when you are ready.</div> : null}
          <div className="flex items-center gap-3">
            <CircleHelp className="h-5 w-5 text-cyan-200" aria-hidden="true" />
            <h2 className="text-2xl font-semibold text-white">Subscription questions</h2>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <details className="rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
              <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-semibold text-white">Does the subscription renew automatically?</summary>
              <p className="border-t border-white/10 pt-3 text-sm leading-6 text-slate-400">Yes. Vaeroex subscriptions renew monthly unless cancellation is scheduled through Manage billing. Cancellation prevents the next renewal, while access continues through the end of the current paid billing period. Review the <Link href="/subscription-billing-terms" className="font-semibold text-cyan-200 hover:text-white">Subscription Billing Terms</Link> for details.</p>
            </details>
            <details className="rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
              <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-semibold text-white">How are refunds handled?</summary>
              <p className="border-t border-white/10 pt-3 text-sm leading-6 text-slate-400">All purchases and subscription payments are final and non-refundable, except where a refund is required by applicable law. Cancellation does not provide a prorated refund or credit for unused time. Review the <Link href="/refund-policy" className="font-semibold text-cyan-200 hover:text-white">Vaeroex Refund Policy</Link> for details.</p>
            </details>
            <details className="rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
              <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-semibold text-white">Can pricing change?</summary>
              <p className="border-t border-white/10 pt-3 text-sm leading-6 text-slate-400">Your subscription price will not increase while your subscription remains continuously active. If Vaeroex lowers the applicable subscription price, active subscribers will receive the lower price for future renewals. If you cancel and later resubscribe, your new subscription will use the pricing available when you resubscribe. Price reductions do not provide retroactive refunds or credits for billing periods already paid.</p>
            </details>
            <details className="rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
              <summary className="min-h-11 cursor-pointer list-none py-2 text-sm font-semibold text-white">Who can help with billing?</summary>
              <p className="border-t border-white/10 pt-3 text-sm leading-6 text-slate-400">Contact <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-cyan-200 hover:text-white">{VAEROEX_CONTACT_EMAILS.billing}</a> for subscription or payment questions.</p>
            </details>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
