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

const definitionCards = [
  {
    title: "Intelligence layer",
    body: "Vaeroex sits above operational activity and turns scattered signals into executive understanding."
  },
  {
    title: "Works with existing systems",
    body: "Operations Intelligence does not replace the systems your organization already relies on. It helps leadership understand what those systems reveal."
  },
  {
    title: "Evidence-backed recommendations",
    body: "Every meaningful recommendation should connect back to evidence, confidence, and known limitations."
  },
  {
    title: "Executive outcomes",
    body: "Leadership receives briefs, risk context, opportunity signals, decision support, and clearer operating visibility."
  }
] as const;

const differentiation = [
  ["Traditional software", "Stores records and activity inside separate operating systems."],
  ["Operations Intelligence", "Connects information to visibility, context, prediction, evidence, and executive action."]
] as const;

const leadershipOutcomes = [
  "Know what changed",
  "Understand why it matters",
  "See what may happen next",
  "Review evidence and confidence",
  "Generate executive-ready outputs"
] as const;

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

      <section className="border-y border-white/10 bg-[#050b18] px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">What It Is</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">The intelligence layer for operating activity.</h2>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-slate-300">
              The software your business already uses records activity. Operations Intelligence helps leadership understand what that activity means.
            </p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {definitionCards.map((card, index) => (
              <ScrollReveal key={card.title} delayMs={index * 60} className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-4 shadow-command">
                <h3 className="font-semibold text-vaeroex-accent">{card.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{card.body}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#030712] px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <OperationsIntelligenceProductExperience />
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#050b18] px-6 py-10">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr] lg:items-stretch">
            <ScrollReveal className="rounded-xl border border-white/10 bg-white/[0.05] p-5 shadow-command">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Why It Is Different</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">Traditional software stores information. Operations Intelligence creates understanding.</h2>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Dashboards can show what happened. Operations Intelligence adds context, evidence, confidence, and decision support so leadership can review what matters.
              </p>
            </ScrollReveal>

            <div className="grid gap-3 sm:grid-cols-2">
              {differentiation.map(([title, body], index) => (
                <ScrollReveal key={title} delayMs={index * 90} className="rounded-xl border border-white/10 bg-white/[0.06] p-5 shadow-command">
                  <p className="text-sm font-semibold uppercase tracking-[0.16em] text-vaeroex-accent">{title}</p>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{body}</p>
                </ScrollReveal>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-5">
            {leadershipOutcomes.map((outcome, index) => (
              <ScrollReveal key={outcome} delayMs={index * 55} className="rounded-lg border border-vaeroex-blue/20 bg-vaeroex-blue/10 p-3 text-sm font-semibold leading-5 text-slate-100">
                {outcome}
              </ScrollReveal>
            ))}
          </div>
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
