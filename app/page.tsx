import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Brain,
  ChartNoAxesCombined,
  CircleGauge,
  FileCheck2,
  Lightbulb,
  LockKeyhole,
  Radar,
  ShieldAlert
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { PublicCtaBand, PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { MarketingDashboardPreview } from "@/components/motion/MarketingDashboardPreview";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex — Operations Intelligence Platform",
  description: "Vaeroex turns fragmented business information into evidence-backed visibility, risks, priorities, and recommendations for leadership.",
  path: "/"
});

const howItWorks = [
  ["Add business information", "Bring reports, spreadsheets, operating records, and observations into a private workspace."],
  ["Organize the evidence", "Vaeroex separates original sources from remembered context and derived analysis."],
  ["Surface what matters", "Changes, risks, opportunities, and performance signals are brought into one leadership view."],
  ["Review with confidence", "Every conclusion retains source support, confidence, and known limitations."]
] as const;

const capabilities = [
  { title: "Executive Overview", description: "A concise view of business health, change, and the decision that deserves review.", icon: CircleGauge },
  { title: "Business Health", description: "A conservative score that appears only when eligible evidence can support it.", icon: ChartNoAxesCombined },
  { title: "Business Memory", description: "Relevant organizational context preserved with provenance, lifecycle, and confidence.", icon: Brain },
  { title: "Risk & Opportunity", description: "Evidence-backed conditions surfaced before they disappear inside separate systems.", icon: Radar },
  { title: "KPI Intelligence", description: "Targets, trends, freshness, and performance meaning without decorative reporting.", icon: ShieldAlert },
  { title: "Recommendations", description: "Leadership review paths grounded in the evidence Vaeroex can actually support.", icon: Lightbulb }
] as const;

const trustPoints = [
  ["Original evidence", "Files, structured imports, and business observations retain their source identity."],
  ["Relevant context", "Business Memory helps Vaeroex retrieve what matters without treating every record as an independent source."],
  ["Derived intelligence", "Briefings and recommendations remain clearly separate from the evidence used to create them."]
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
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Program membership only; no investment, certification, endorsement, or partnership is implied.
            </p>
          </div>
          <div className="flex justify-start lg:justify-end">
            <img
              src="/brand/nvidia-inception-program-badge.svg"
              alt="NVIDIA Inception Program badge"
              className="h-auto w-44 sm:w-52"
            />
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
        eyebrow="Operations Intelligence"
        title="See what is happening—and what leadership should review next."
        description="Vaeroex turns fragmented business information into evidence-backed visibility, risks, priorities, and recommendations without replacing the systems you already use."
        actions={
          <>
            <StartWithVaeroexMenu />
            <Link href="/operations-intelligence" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Explore Operations Intelligence
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <div className="hidden w-full flex-wrap gap-x-5 gap-y-2 pt-1 text-xs font-semibold text-slate-400 sm:flex" aria-label="Platform trust points">
              <span>Evidence-backed intelligence</span>
              <span>Private business workspace</span>
              <span>Designed for executive review</span>
            </div>
          </>
        }
        aside={<MarketingDashboardPreview />}
      />

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-7xl">
          <PublicSectionHeading
            eyebrow="How Vaeroex works"
            title="From scattered information to a clearer leadership review."
            description="One evidence path connects what the business records to what leadership needs to understand."
          />
          <ol className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {howItWorks.map(([title, description], index) => (
              <ScrollReveal key={title} as="li" delayMs={index * 70} className="border-t border-white/15 pt-4">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-vaeroex-blue text-sm font-semibold text-white">{index + 1}</span>
                  <h3 className="font-semibold text-white">{title}</h3>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-400">{description}</p>
              </ScrollReveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto max-w-7xl">
          <PublicSectionHeading
            eyebrow="Core capabilities"
            title="The intelligence leadership needs, without another management system."
            description="Vaeroex connects current performance, organizational context, and source evidence in one review-ready experience."
          />
          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-2 xl:grid-cols-3">
            {capabilities.map((capability, index) => {
              const Icon = capability.icon;

              return (
                <ScrollReveal key={capability.title} delayMs={(index % 3) * 60} className="group bg-[#07111f] p-4 transition-colors hover:bg-[#0a1728]">
                  <Icon className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                  <h3 className="mt-4 text-lg font-semibold text-white">{capability.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{capability.description}</p>
                </ScrollReveal>
              );
            })}
          </div>
          <div className="mt-8 grid gap-5 border-t border-white/10 pt-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Current product</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-normal text-white">Vaeroex Operations Intelligence</h2>
              <p className="mt-3 max-w-4xl text-sm leading-6 text-slate-300">A private intelligence layer for leaders who need to understand what changed, what requires attention, and what decision should be reviewed next.</p>
            </div>
            <Link href="/operations-intelligence" className="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              See how it works
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
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
              <p className="mt-4 text-base leading-7 text-slate-300">Vaeroex preserves the boundary between source evidence, remembered context, and generated analysis. Confidence stays conservative when coverage is limited.</p>
              <Link href="/trust" className="mt-5 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                Review the Trust Center
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="divide-y divide-white/10 border-y border-white/10">
              {trustPoints.map(([title, description], index) => (
                <div key={title} className="grid gap-2 py-4 sm:grid-cols-[2rem_minmax(0,.38fr)_minmax(0,.62fr)] sm:items-start">
                  <FileCheck2 className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                  <h3 className="font-semibold text-white">{title}</h3>
                  <p className="text-sm leading-6 text-slate-400">{description}</p>
                  <span className="sr-only">Step {index + 1} of the evidence path</span>
                </div>
              ))}
            </div>
          </div>
          <details className="group mt-8 rounded-lg border border-white/10 bg-white/[0.035] px-5 py-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              <span>
                <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Long-term platform direction</span>
                <span className="mt-1 block font-semibold text-white">One intelligence architecture, designed to expand carefully.</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-cyan-200 group-open:hidden">View</span>
              <span className="hidden shrink-0 text-sm font-semibold text-cyan-200 group-open:block">Close</span>
            </summary>
            <p className="mt-3 max-w-4xl border-t border-white/10 pt-3 text-sm leading-6 text-slate-400">Operations Intelligence is the current product. Future applications remain direction areas, not currently available product promises.</p>
          </details>
        </div>
      </section>

      <PublicCtaBand
        title="Make the next leadership review start with what matters."
        description="Bring business evidence into one private workspace and let Vaeroex surface the changes, risks, and decisions worth reviewing."
        primaryHref="/pricing"
        secondaryHref="/operations-intelligence"
        secondaryLabel="Explore the product"
      />

      <NvidiaInceptionSection />

      <PublicFooter />
    </main>
  );
}
