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
  title: "Vaeroex Intelligence Systems | Executive Clarity",
  description: "Vaeroex builds intelligence systems that transform business information into visibility, awareness, prediction, and executive action.",
  path: "/"
});

const systems = [
  { title: "Trusted business understanding", description: "Connect business information while keeping facts, sources, and context clear and inspectable.", icon: FileCheck2 },
  { title: "Deterministic intelligence", description: "Business facts, KPI values, and current conditions remain grounded in verified calculations.", icon: Brain },
  { title: "Advanced executive reasoning", description: "Supported patterns become clear explanations, priorities, and decision support for leadership.", icon: Lightbulb }
] as const;

const intelligencePath = [
  ["Connect Your Business", "Bring reports, spreadsheets, documents, KPIs, and relevant business information into one secure workspace."],
  ["Build Trusted Business Understanding", "Vaeroex organizes information with source context so facts remain distinct from interpretation."],
  ["Transform Information into Executive Intelligence", "Deterministic intelligence identifies current conditions, meaningful changes, and leadership priorities."],
  ["Advanced Executive Reasoning", "Supported patterns are explained in clear business language, with uncertainty and limitations kept visible."],
  ["Executive Clarity", "Leadership receives a concise, evidence-backed view of what matters, why it matters, and where to focus next."]
] as const;

const differences = [
  ["Facts first. Reasoning second.", "Deterministic business facts remain separate from the interpretation that explains what they mean together."],
  ["Clarity before automation", "Vaeroex is designed to strengthen leadership judgment, not act as an autonomous operator."],
  ["One flagship platform, broader systems mission", "Executive Intelligence is available today. Vaeroex is building intelligence systems for clearer decisions over time."]
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
        eyebrow="VAEROEX · INTELLIGENCE SYSTEMS"
        title="Transform business information into executive clarity."
        description="Vaeroex builds intelligence systems that transform business information into visibility, awareness, prediction, and executive action—helping leaders understand what matters, why it matters, and where to focus next."
        actions={
          <>
            <Link href="/executive-intelligence" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Explore Executive Intelligence
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a href="/api/stripe/checkout" className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Start With Vaeroex
            </a>
            <div className="hidden w-full flex-wrap gap-x-5 gap-y-2 pt-1 text-xs font-semibold text-slate-400 sm:flex" aria-label="Company principles">
              <span>Facts first. Reasoning second.</span>
              <span>Evidence-backed intelligence.</span>
              <span>Built for leadership.</span>
            </div>
          </>
        }
        aside={<MarketingDashboardPreview />}
      />

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-7xl">
          <PublicSectionHeading
            eyebrow="What Vaeroex builds"
            title="Intelligence systems designed for visibility, awareness, prediction, and action."
            description="Vaeroex turns trusted business information into explainable intelligence that helps leadership understand the present and focus on what comes next."
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
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-normal text-white sm:text-4xl">Executive Intelligence by Vaeroex.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">Vaeroex&apos;s flagship Executive Intelligence platform, built to turn trusted business evidence into Business Health, prioritized intelligence, focused explanations, and executive decision support.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/executive-intelligence" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                Explore Executive Intelligence
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link href="/pricing" className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-semibold text-slate-200 hover:border-cyan-300/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">View pricing</Link>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ["Business Health", "A concise, evidence-backed view of current business condition and the drivers behind it."],
              ["Intelligence", "Prioritized findings, risks, opportunities, and changes keep leadership focused on what matters."],
              ["Explain Finding", "A focused investigation helps leadership understand one supported issue without repeating the facts."],
              ["Evidence", "The trusted business information behind each conclusion remains clear and available for review."],
              ["Saved Analyses", "Completed analyses can be preserved for later leadership review without rewriting their content."]
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
            eyebrow="How it works"
            title="From connected business information to executive clarity."
            description="Vaeroex keeps facts grounded, applies advanced executive reasoning where it adds value, and presents conclusions leadership can inspect."
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
            <p className="mt-4 text-base leading-7 text-slate-300">Vaeroex is not another system where teams manage every task, contact, or workflow. It is an Intelligence Systems company focused on helping leadership understand the information those systems create.</p>
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
              <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-normal sm:text-4xl">Trust starts with knowing what is fact and what is interpretation.</h2>
              <p className="mt-4 text-base leading-7 text-slate-300">Secure workspaces, inspectable evidence, explainable recommendations, and visible limitations help keep executive intelligence accountable.</p>
              <Link href="/trust" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                Review the Trust Center
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="divide-y divide-white/10 border-y border-white/10">
              {[
                ["Business facts", "KPI values, Business Health, and source records remain distinct from interpretation."],
                ["Executive interpretation", "Advanced reasoning explains supported patterns without becoming a new fact about the business."],
                ["Leadership control", "Confidence, freshness, citations, and limitations remain visible for review."]
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
              <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">Vaeroex is building intelligence systems that transform business information into visibility, awareness, prediction, and executive action. Executive Intelligence is the flagship product available today.</p>
            </div>
          </div>
        </div>
      </section>

      <PublicCtaBand
        eyebrow="Vaeroex Intelligence Systems"
        title="Turn the information leadership already has into executive clarity."
        description="Explore how Executive Intelligence connects trusted business information with deterministic intelligence and advanced executive reasoning."
        primaryHref="/executive-intelligence"
        primaryLabel="Explore Executive Intelligence"
        secondaryHref="/pricing"
        secondaryLabel="View pricing"
      />

      <NvidiaInceptionSection />
      <PublicFooter />
    </main>
  );
}
