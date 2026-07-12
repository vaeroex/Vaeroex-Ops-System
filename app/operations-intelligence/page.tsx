import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Brain,
  ChartNoAxesCombined,
  CircleGauge,
  FileSearch2,
  Gauge,
  Lightbulb,
  ScanSearch,
  ShieldCheck
} from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { StartWithVaeroexMenu } from "@/components/legal/StartWithVaeroexMenu";
import { PublicCtaBand, PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { OperationsIntelligenceEngineDemo } from "@/components/motion/OperationsIntelligenceEngineDemo";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { operationsIntelligenceJsonLd, publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Operations Intelligence by Vaeroex",
  description: "Vaeroex Operations Intelligence turns fragmented business activity into evidence-backed visibility, risk, performance context, and leadership recommendations.",
  path: "/operations-intelligence"
});

const processSteps = [
  ["Information", "Business records, source files, metrics, and observations enter a private workspace."],
  ["Evidence", "Vaeroex preserves provenance and retrieves only the context relevant to the question."],
  ["Understanding", "Signals are compared for change, agreement, risk, and meaningful business impact."],
  ["Leadership review", "The result arrives with confidence, limitations, and a clear recommendation to consider."]
] as const;

const capabilities = [
  { title: "Executive Overview", body: "The current business state, meaningful change, and priority decision in one view.", icon: CircleGauge },
  { title: "Business Health", body: "A conservative health signal grounded in eligible original evidence.", icon: Gauge },
  { title: "KPI Intelligence", body: "Actuals, targets, trends, freshness, and business meaning without report clutter.", icon: ChartNoAxesCombined },
  { title: "Risk & Opportunity", body: "Conditions that deserve leadership attention, ranked with source support.", icon: ScanSearch },
  { title: "Business Memory", body: "Relevant organizational context that retains provenance and lifecycle status.", icon: Brain },
  { title: "Executive Briefings", body: "Review-ready summaries with changes, evidence limits, and recommended decisions.", icon: Lightbulb }
] as const;

const audience = ["Owners reviewing a growing business", "CEOs and COOs connecting performance across systems", "Operations leaders preparing an evidence-backed review", "Department leaders who need context beyond one report"] as const;
const exclusions = ["A CRM or customer record system", "A task or project-management replacement", "An accounting or ERP platform", "An autonomous operator that acts without human authority"] as const;

const operationsIntelligenceSchema = JSON.stringify(operationsIntelligenceJsonLd);

export default function OperationsIntelligencePage() {
  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: operationsIntelligenceSchema }} />
      <PublicSiteHeader />

      <PublicPageHero
        eyebrow="Vaeroex Operations Intelligence"
        title="Turn operational activity into a clearer leadership decision."
        description="Vaeroex connects fragmented business information into evidence-backed performance context, risks, opportunities, and recommendations without replacing the systems your organization already uses."
        actions={
          <>
            <StartWithVaeroexMenu />
            <Link href="#product-experience" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              See the product experience
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </>
        }
      />

      <section id="product-experience" className="border-b border-white/10 bg-[#050b18] px-5 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-7xl">
          <OperationsIntelligenceEngineDemo />
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-7xl">
          <PublicSectionHeading
            eyebrow="How it works"
            title="The systems keep recording activity. Vaeroex helps leadership understand it."
            description="A bounded evidence path turns the right information into a supported answer, without treating every record or generated output as an independent fact."
          />
          <ol className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {processSteps.map(([title, body], index) => (
              <ScrollReveal key={title} as="li" delayMs={index * 65} className="border-t border-white/15 pt-4">
                <span className="text-xs font-semibold text-cyan-200">0{index + 1}</span>
                <h3 className="mt-3 text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
              </ScrollReveal>
            ))}
          </ol>

          <details className="group mt-10 border-t border-white/10 pt-8">
            <summary className="flex min-h-11 cursor-pointer list-none flex-col gap-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 sm:flex-row sm:items-end sm:justify-between">
              <span>
                <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">What it creates</span>
                <span className="mt-2 block text-2xl font-semibold text-white">Six leadership outcomes, available when you want the detail.</span>
                <span className="mt-2 block text-sm leading-6 text-slate-400">Executive Overview · Business Health · KPI Intelligence · Risk &amp; Opportunity · Business Memory · Executive Briefings</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-cyan-200 group-open:hidden">Explore capabilities</span>
              <span className="hidden shrink-0 text-sm font-semibold text-cyan-200 group-open:block">Hide capabilities</span>
            </summary>
            <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-2 xl:grid-cols-3">
              {capabilities.map((capability, index) => {
                const Icon = capability.icon;
                return (
                  <ScrollReveal key={capability.title} delayMs={(index % 3) * 55} className="bg-[#07111f] p-4 hover:bg-[#0a1728]">
                    <Icon className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                    <h3 className="mt-3 text-lg font-semibold text-white">{capability.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{capability.body}</p>
                  </ScrollReveal>
                );
              })}
            </div>
          </details>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-2">
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-950/25 text-cyan-100">
              <FileSearch2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-normal">Business Memory keeps context. Evidence keeps it accountable.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">Source files, structured records, and business observations retain provenance. Business Memory preserves relevant context. Generated reports and recommendations remain derived analysis rather than new original evidence.</p>
            <div className="mt-6 grid gap-3">
              {["Original evidence remains identifiable", "Archived and deleted records stay excluded", "Technical failures never become business conclusions"].map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm text-slate-200">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-200" aria-hidden="true" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="divide-y divide-white/10 border-y border-white/10">
            <div className="py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Confidence & coverage</p>
              <p className="mt-2 text-lg font-semibold text-white">Vaeroex shows what it understands—and what it does not.</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">Confidence grows with relevant source depth, recency, agreement, and history. Limited evidence produces limited conclusions, not invented certainty.</p>
            </div>
            <div className="py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Executive briefings</p>
              <p className="mt-2 text-lg font-semibold text-white">The answer first. Evidence and limitations when leadership needs them.</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">Briefings focus on meaningful change, primary risks, opportunities, and decisions requiring review instead of reproducing every record.</p>
            </div>
            <div className="py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Human review</p>
              <p className="mt-2 text-lg font-semibold text-white">Vaeroex informs decisions. Leadership remains in control.</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">Recommendations are review-ready intelligence, not autonomous authority to change customer systems or business records.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200">Designed for</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal">Leaders who need one coherent operating view.</h2>
            <ul className="mt-6 divide-y divide-white/10 border-y border-white/10">
              {audience.map((item) => <li key={item} className="py-3 text-sm leading-6 text-slate-300">{item}</li>)}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Not designed as</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal">Another place for teams to manage work.</h2>
            <ul className="mt-6 divide-y divide-white/10 border-y border-white/10">
              {exclusions.map((item) => <li key={item} className="py-3 text-sm leading-6 text-slate-400">{item}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <PublicCtaBand
        title="Give leadership a clearer basis for the next decision."
        description="Start with one private workspace for Operations Intelligence, Business Memory, KPI context, evidence-backed recommendations, and executive briefings."
        primaryHref="/pricing"
        primaryLabel="View pricing"
        secondaryHref="/contact"
        secondaryLabel="Talk with Vaeroex"
      />

      <PublicFooter />
    </main>
  );
}
