import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Brain,
  FileCheck2,
  Lightbulb,
  LockKeyhole,
  Radar,
  ShieldCheck,
  Waypoints
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicCtaBand, PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { MarketingDashboardPreview } from "@/components/motion/MarketingDashboardPreview";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex Intelligence Systems | Evidence-Backed Intelligence Software",
  description: "Vaeroex builds evidence-backed intelligence systems that turn fragmented information into decision-ready understanding for leadership.",
  path: "/"
});

const systems = [
  { title: "Evidence architecture", description: "Original sources retain provenance, eligibility, and lifecycle status instead of disappearing into an untraceable answer.", icon: FileCheck2 },
  { title: "Organizational understanding", description: "Business Memory preserves relevant context while keeping remembered knowledge distinct from original evidence.", icon: Brain },
  { title: "Decision-ready intelligence", description: "Leadership receives a direct view of what changed, why it matters, and what deserves review next.", icon: Lightbulb }
] as const;

const intelligencePath = [
  ["Collect", "Bring reports, spreadsheets, documents, images, metrics, and business observations into a private workspace."],
  ["Qualify", "Vaeroex checks source eligibility, lineage, freshness, and lifecycle before information can support intelligence."],
  ["Understand", "Relevant evidence is compared for change, agreement, risk, opportunity, and meaningful operating context."],
  ["Explain", "The result arrives with supporting evidence, calibrated confidence, and clear limitations for leadership review."]
] as const;

const differences = [
  ["Evidence before assertion", "Unsupported conclusions stay out. Limited coverage produces limited claims rather than invented certainty."],
  ["Understanding before automation", "Vaeroex is designed to improve leadership judgment, not act as an autonomous operator."],
  ["One current product, broader company discipline", "Operations Intelligence is available today. The underlying evidence discipline gives Vaeroex room to expand carefully over time."]
] as const;

function NvidiaInceptionSection() {
  return (
    <section className="border-b border-white/10 bg-[#030712] px-5 py-8 sm:px-6 sm:py-10" aria-labelledby="nvidia-inception-heading">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-6 border-y border-white/10 py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">NVIDIA Inception Program</p>
            <h2 id="nvidia-inception-heading" className="mt-2 text-xl font-semibold leading-tight tracking-normal text-white sm:text-2xl">
              Vaeroex is a member of the NVIDIA Inception program.
            </h2>
          </div>
          <div className="flex justify-start lg:justify-end">
            <img src="/brand/nvidia-inception-program-badge.svg" alt="NVIDIA Inception Program badge" className="h-auto w-44 sm:w-52" />
          </div>
        </div>
        <p className="mt-3 max-w-4xl text-xs leading-5 text-slate-500">
          © 2025 NVIDIA, the NVIDIA logo, and NVIDIA Inception are trademarks and/or registered trademarks of NVIDIA Corporation in the U.S. and other countries.
        </p>
      </div>
    </section>
  );
}

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />

      <PublicPageHero
        eyebrow="Vaeroex Intelligence Systems"
        title="Systems that turn information into intelligence."
        description="Vaeroex develops evidence-backed intelligence systems that help leadership understand what is happening, what changed, why it matters, and what should be reviewed next."
        actions={
          <>
            <Link href="/operations-intelligence" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Explore Operations Intelligence
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a href="/api/stripe/checkout" className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Start With Vaeroex
            </a>
            <div className="hidden w-full flex-wrap gap-x-5 gap-y-2 pt-1 text-xs font-semibold text-slate-400 sm:flex" aria-label="Company principles">
              <span>Evidence-backed systems</span>
              <span>Decision-ready understanding</span>
              <span>Conservative by design</span>
            </div>
          </>
        }
        aside={<MarketingDashboardPreview />}
      />

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-7xl">
          <PublicSectionHeading
            eyebrow="What Vaeroex builds"
            title="Intelligence systems designed around evidence, context, and executive understanding."
            description="Vaeroex connects information without erasing where it came from, then turns the supported result into a clearer leadership review."
          />
          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-3">
            {systems.map((system, index) => {
              const Icon = system.icon;
              return (
                <ScrollReveal key={system.title} delayMs={index * 70} className="bg-[#07111f] p-5 transition-colors hover:bg-[#0a1728]">
                  <Icon className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                  <h2 className="mt-4 text-lg font-semibold text-white">{system.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{system.description}</p>
                </ScrollReveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,.72fr)_minmax(0,1.28fr)] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Flagship product</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-normal text-white sm:text-4xl">Operations Intelligence by Vaeroex.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">A system for turning business evidence into executive understanding. It brings Business Health, current changes, prioritized findings, KPI context, Business Memory, and evidence-backed Reports into one calm review.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/operations-intelligence" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                See the product
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/pricing" className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-slate-200 hover:border-cyan-300/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">View pricing</Link>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Business Health", "A conservative view of current business condition, shown only when eligible evidence supports it."],
              ["Prioritized Intelligence", "Needs Attention, Positive Signal, and What Changed keep the executive review focused."],
              ["Evidence & Business Memory", "Relevant context stays connected to its source, confidence, and lifecycle."],
              ["Reports", "Executive Brief, Board Report, Improvement Plan, and Investigation Summary turn supported findings into review-ready analysis."]
            ].map(([title, body]) => (
              <div key={title} className="border-t border-white/15 pt-4">
                <h3 className="font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-7xl">
          <PublicSectionHeading
            eyebrow="How intelligence is created"
            title="A bounded path from source information to supported understanding."
            description="The process is designed to retrieve what is relevant, preserve source accountability, and keep uncertainty visible."
          />
          <ol className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {intelligencePath.map(([title, description], index) => (
              <ScrollReveal key={title} as="li" delayMs={index * 65} className="border-t border-white/15 pt-4">
                <span className="text-xs font-semibold text-cyan-200">0{index + 1}</span>
                <h3 className="mt-3 text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
              </ScrollReveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
          <div>
            <Radar className="h-6 w-6 text-cyan-200" aria-hidden="true" />
            <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-normal text-white sm:text-4xl">Built for understanding, not feature accumulation.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">Vaeroex is not another system where teams manage every task, contact, or workflow. It is an intelligence layer that helps leadership interpret the evidence those systems create.</p>
          </div>
          <div className="divide-y divide-white/10 border-y border-white/10">
            {differences.map(([title, body]) => (
              <div key={title} className="grid gap-2 py-4 sm:grid-cols-[1.25rem_minmax(0,.38fr)_minmax(0,.62fr)]">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-200" aria-hidden="true" />
                <h3 className="font-semibold text-white">{title}</h3>
                <p className="text-sm leading-6 text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,.78fr)_minmax(0,1.22fr)] lg:items-start">
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-950/25 text-cyan-100">
                <LockKeyhole className="h-5 w-5" aria-hidden="true" />
              </div>
              <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-normal sm:text-4xl">Trust starts with knowing what each conclusion is built on.</h2>
              <p className="mt-4 text-base leading-7 text-slate-300">Private workspaces, evidence lineage, lifecycle exclusion, and a clear boundary between original evidence and derived analysis help keep conclusions accountable.</p>
              <Link href="/trust" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                Review the Trust Center
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="divide-y divide-white/10 border-y border-white/10">
              {[
                ["Original evidence", "Files, structured imports, and business observations retain source identity and eligibility."],
                ["Relevant context", "Business Memory retrieves useful context without turning every remembered item into a separate original source."],
                ["Derived analysis", "Findings and Reports remain interpretations of evidence, not new evidence about the business."]
              ].map(([title, description]) => (
                <div key={title} className="grid gap-2 py-4 sm:grid-cols-[2rem_minmax(0,.38fr)_minmax(0,.62fr)] sm:items-start">
                  <FileCheck2 className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                  <h3 className="font-semibold text-white">{title}</h3>
                  <p className="text-sm leading-6 text-slate-400">{description}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-8 grid gap-4 border-t border-white/10 pt-8 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <Waypoints className="h-5 w-5 text-cyan-200" aria-hidden="true" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Long-term company direction</p>
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">Vaeroex is building a disciplined intelligence architecture that can support more complex environments over time. Operations Intelligence is the product available today.</p>
            </div>
          </div>
        </div>
      </section>

      <PublicCtaBand
        eyebrow="Vaeroex Intelligence Systems"
        title="Start with the business evidence leadership already depends on."
        description="Operations Intelligence turns that information into a clearer view of what changed, what matters, and what deserves review next."
        primaryHref="/operations-intelligence"
        primaryLabel="Explore Operations Intelligence"
        secondaryHref="/pricing"
        secondaryLabel="View pricing"
      />

      <NvidiaInceptionSection />
      <PublicFooter />
    </main>
  );
}
