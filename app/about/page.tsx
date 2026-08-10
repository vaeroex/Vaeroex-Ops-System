import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Compass, Eye, Layers3 } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicCtaBand, PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { publicPageMetadata } from "@/lib/seo/public-seo";
import { INTELLIGENCE_SYSTEMS_ROUTE, PUBLIC_SYSTEMS } from "@/lib/marketing/public-systems";

export const metadata: Metadata = publicPageMetadata({
  title: "About Vaeroex | Intelligence Systems",
  description: "Why Vaeroex is being built to transform complex information into visibility, awareness, prediction, and action across specialized domains.",
  path: "/about"
});

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />

      <PublicPageHero
        eyebrow="Vaeroex Intelligence Systems"
        title="Information is everywhere. Understanding is not."
        description="Vaeroex exists to close the gap between having information and having intelligence: turning complex information into visibility, awareness, prediction, and action."
        actions={
          <>
            <Link href={INTELLIGENCE_SYSTEMS_ROUTE} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Explore Intelligence Systems
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/contact" className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">Contact Vaeroex</Link>
          </>
        }
      />

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,.78fr)_minmax(0,1.22fr)] lg:items-start">
          <div>
            <Eye className="h-6 w-6 text-cyan-200" aria-hidden="true" />
            <PublicSectionHeading eyebrow="Why Vaeroex exists" title="The world has more information than ever, but information alone does not create intelligence." />
          </div>
          <div className="space-y-5 text-base leading-7 text-slate-300">
            <p>Complex environments can generate enormous amounts of data, evidence, signals, and analysis without making it clear what matters, how it connects, what may be changing, or where attention should go.</p>
            <p>Vaeroex is being built to turn that complexity into inspectable understanding while preserving uncertainty, context, and human judgment.</p>
            <div className="border-l-2 border-cyan-300/40 pl-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Mission</p>
              <p className="mt-2 text-xl font-semibold leading-8 text-white">Transforming information into visibility, awareness, prediction, and action.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Specialized intelligence</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-normal sm:text-4xl">One intelligence identity, shaped for distinct domains.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">Different domains contain different evidence, relationships, constraints, and objectives. Vaeroex develops specialized environments for those realities instead of treating every problem as the same generic interface.</p>
            <Link href={INTELLIGENCE_SYSTEMS_ROUTE} className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Understand the Vaeroex approach
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <div className="mt-7 grid gap-5 border-t border-white/10 pt-5 md:grid-cols-3">
              {PUBLIC_SYSTEMS.map((system) => (
                <div key={system.id}>
                  <p className="text-xs font-semibold uppercase tracking-normal text-teal-200">{system.statusLabel}</p>
                  <Link href={system.route} className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                    {system.name}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <p className="max-w-xl text-sm leading-6 text-slate-400">{system.tagline}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-3">
            {[
              ["Visibility", "Make important conditions and relationships easier to see."],
              ["Awareness", "Understand how information connects and why it matters."],
              ["Action", "Identify what deserves human attention, investigation, or action."]
            ].map(([title, body]) => (
              <div key={title} className="bg-[#07111f] p-5">
                <Layers3 className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                <h3 className="mt-4 font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,.72fr)_minmax(0,1.28fr)]">
          <div>
            <Compass className="h-6 w-6 text-cyan-200" aria-hidden="true" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Founder perspective</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal">The intelligence problem.</h2>
          </div>
          <blockquote className="space-y-4 text-base leading-7 text-slate-300">
            <p className="text-xl font-medium leading-8 text-white">&ldquo;The world doesn&rsquo;t have an information problem. It has an intelligence problem. We can collect more data than ever before, but information only becomes valuable when we can understand what it means, how it connects, what may happen next, and what to do with it. That&rsquo;s what Vaeroex is being built to solve.&rdquo;</p>
            <footer>
              <p className="text-sm font-semibold text-slate-200">Isaac Vizcarra</p>
              <p className="text-sm text-slate-400">Founder &amp; CEO</p>
            </footer>
          </blockquote>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-10 sm:px-6 sm:py-12">
        <details className="group mx-auto max-w-7xl rounded-lg border border-white/10 bg-white/[0.035] px-5 py-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Long-term direction</span>
              <span className="mt-1 block text-lg font-semibold text-white">Build trustworthy specialized intelligence for complex domains over time.</span>
            </span>
            <span className="shrink-0 text-sm font-semibold text-cyan-200 group-open:hidden">Read more</span>
            <span className="hidden shrink-0 text-sm font-semibold text-cyan-200 group-open:block">Close</span>
          </summary>
          <p className="mt-4 max-w-4xl border-t border-white/10 pt-4 text-sm leading-6 text-slate-400">Executive Intelligence is available today. Drug Discovery Intelligence and Biological Intelligence remain in development. The broader Vaeroex direction is to apply measured, inspectable intelligence wherever complex information needs to become useful understanding, without presenting future direction as current capability.</p>
        </details>
      </section>

      <PublicCtaBand
        title="The Advantage of Knowing First."
        description="Explore the Vaeroex intelligence philosophy and the specialized environments taking shape within it."
        primaryHref={INTELLIGENCE_SYSTEMS_ROUTE}
        primaryLabel="Explore Vaeroex intelligence"
      />
      <PublicFooter />
    </main>
  );
}
