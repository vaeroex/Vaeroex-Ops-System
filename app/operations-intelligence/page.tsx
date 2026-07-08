import Link from "next/link";
import type { Metadata } from "next";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { OperationsIntelligenceEngineDemo } from "@/components/motion/OperationsIntelligenceEngineDemo";
import { OperationsIntelligenceProductExperience } from "@/components/motion/OperationsIntelligenceProductExperience";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { operationsIntelligenceJsonLd, publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Operations Intelligence by Vaeroex",
  description: "Operations Intelligence by Vaeroex transforms operational activity into visibility, context, prediction, evidence, and executive recommendations.",
  path: "/operations-intelligence"
});

const operationsIntelligenceSchema = JSON.stringify(operationsIntelligenceJsonLd);

export default function OperationsIntelligencePage() {
  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: operationsIntelligenceSchema }} />
      <PublicSiteHeader />

      <section className="vaeroex-ambient relative overflow-hidden px-6 py-10 text-white sm:py-12">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(30,107,255,0.24),transparent_30%),radial-gradient(circle_at_78%_18%,rgba(56,189,248,0.16),transparent_28%),radial-gradient(circle_at_62%_82%,rgba(168,85,247,0.16),transparent_34%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-7 lg:grid-cols-[0.86fr_1.14fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-vaeroex-accent">Operations Intelligence</p>
            <h1 className="mt-3 max-w-4xl text-5xl font-semibold tracking-tight sm:text-6xl">
              Transform operational activity into executive intelligence.
            </h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
              Operations Intelligence continuously transforms operational activity into visibility, context, prediction, evidence, and executive recommendations without replacing the systems your organization already relies on.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="#intelligence-created" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-950/30 hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                Explore Intelligence
              </Link>
              <Link href="/pricing" className="rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                View Pricing
              </Link>
              <Link href="/" className="rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                View Platform
              </Link>
            </div>
          </div>

          <OperationsIntelligenceEngineDemo />
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#050b18] px-6 py-7">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[0.75fr_1.25fr] lg:items-center">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">The Simple Version</p>
          <h2 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Your software records activity. Vaeroex helps leadership understand what that activity means, what evidence supports it, and what deserves review.
          </h2>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#030712] px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <OperationsIntelligenceProductExperience />
        </div>
      </section>

      <section className="px-6 py-10">
        <ScrollReveal className="vaeroex-ambient mx-auto max-w-7xl rounded-lg border border-white/10 bg-vaeroex-navy p-6 text-white shadow-command">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Choose Vaeroex</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">The Advantage of Knowing First.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                See operating conditions sooner, understand the evidence behind them, and give leadership a clearer basis for decisions.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/pricing" className="inline-flex shrink-0 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                View Pricing
              </Link>
              <Link href="/" className="inline-flex shrink-0 rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                View Platform
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </section>

      <PublicFooter />
    </main>
  );
}
