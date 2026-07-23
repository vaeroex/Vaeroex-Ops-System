import Link from "next/link";
import type { Metadata } from "next";
import {
  ArrowRight,
  Brain,
  FileSearch2,
  FileText,
  Gauge,
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
  title: "Operations Intelligence | Vaeroex Executive Intelligence Platform",
  description: "Operations Intelligence is Vaeroex's flagship Executive Intelligence platform for Business Health, prioritized intelligence, focused explanations, Evidence, and Saved Analyses.",
  path: "/operations-intelligence"
});

const processSteps = [
  ["Connect Your Business", "Bring reports, spreadsheets, documents, KPIs, and relevant business information into one secure workspace."],
  ["Build Trusted Business Understanding", "Vaeroex organizes information with source context so facts remain distinct from interpretation."],
  ["Transform Information into Executive Intelligence", "Deterministic intelligence identifies current conditions, meaningful changes, and leadership priorities."],
  ["Advanced Executive Reasoning", "Supported patterns are explained in clear business language, with uncertainty and limitations kept visible."],
  ["Executive Clarity", "Leadership receives a concise, evidence-backed view of what matters, why it matters, and where to focus next."]
] as const;

const capabilities = [
  { title: "Business Health", body: "The executive summary experience: a concise current-state view with the strongest supported drivers.", icon: Gauge },
  { title: "Intelligence", body: "Prioritized findings, risks, opportunities, and changes ranked for leadership attention.", icon: ScanSearch },
  { title: "Explain Finding", body: "A focused investigation that explains one supported issue, why it matters, and what to examine next.", icon: FileSearch2 },
  { title: "Evidence", body: "The trusted business information behind each conclusion remains clear and available for inspection.", icon: Brain },
  { title: "Saved Analyses", body: "Completed analyses can be preserved for later leadership review without regenerating or rewriting them.", icon: FileText }
] as const;

const evidenceInputs = [
  ["Connected business information", "Bring together supported spreadsheets, documents, images, KPIs, and operating records without losing their business context."],
  ["Clear source accountability", "Supporting information remains connected to its source so leadership can inspect what each conclusion is based on."],
  ["Current and historical perspective", "Freshness and prior periods remain visible so current conditions are not confused with outdated information."]
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
        eyebrow="Operations Intelligence · A Vaeroex product"
        title="Operations Intelligence"
        description="Vaeroex's flagship Executive Intelligence platform helps leaders see what is happening, understand why it matters, and know what deserves attention next."
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
            title="From connected business information to executive clarity."
            description="Business facts remain facts. Advanced executive reasoning explains what the supported information means together."
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
                <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Current product</span>
                <span className="mt-2 block text-2xl font-semibold text-white">The intelligence leadership can review today.</span>
                <span className="mt-2 block text-sm leading-6 text-slate-400">Business Health · Intelligence · Explain Finding · Evidence · Saved Analyses</span>
              </span>
              <span className="shrink-0 text-sm font-semibold text-cyan-200 group-open:hidden">Explore capabilities</span>
              <span className="hidden shrink-0 text-sm font-semibold text-cyan-200 group-open:block">Hide capabilities</span>
            </summary>
            <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-2 xl:grid-cols-4">
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
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,.72fr)_minmax(0,1.28fr)]">
          <div>
            <FileSearch2 className="h-6 w-6 text-cyan-200" aria-hidden="true" />
            <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-normal">Business information becomes trusted understanding, not unsupported conclusions.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">Operations Intelligence connects supported business information while keeping its source context available for leadership review.</p>
          </div>
          <div className="divide-y divide-white/10 border-y border-white/10">
            {evidenceInputs.map(([title, body]) => (
              <div key={title} className="grid gap-2 py-5 sm:grid-cols-[minmax(0,.34fr)_minmax(0,.66fr)]">
                <h3 className="font-semibold text-white">{title}</h3>
                <p className="text-sm leading-6 text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-2">
          <div>
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-950/25 text-cyan-100">
              <FileSearch2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <h2 className="mt-5 text-3xl font-semibold leading-tight tracking-normal">Facts remain facts. Interpretation remains explainable.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">Vaeroex preserves the distinction between business information, deterministic calculations, and the executive interpretation built from them.</p>
            <div className="mt-6 grid gap-3">
              {["Supporting sources remain identifiable", "Business facts stay separate from interpretation", "Technical failures never become business conclusions"].map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm text-slate-200">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-200" aria-hidden="true" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="divide-y divide-white/10 border-y border-white/10">
            <div className="py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Evidence-backed intelligence</p>
              <p className="mt-2 text-lg font-semibold text-white">Vaeroex shows what it understands—and what it does not.</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">Confidence, freshness, supporting sources, and limitations remain visible. Limited evidence produces limited conclusions, not invented certainty.</p>
            </div>
            <div className="py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">Advanced executive reasoning</p>
              <p className="mt-2 text-lg font-semibold text-white">Explanation that adds understanding, not new facts.</p>
              <p className="mt-2 text-sm leading-6 text-slate-400">Executive interpretation connects supported patterns, priorities, and limitations without altering the underlying business information.</p>
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
        eyebrow="Operations Intelligence by Vaeroex"
        title="Give leadership a clearer basis for the next decision."
        description="Start with one private workspace for Business Health, Intelligence, Explain Finding, Evidence, and Saved Analyses."
        primaryHref="/pricing"
        primaryLabel="View pricing"
        secondaryHref="/contact"
        secondaryLabel="Talk with Vaeroex"
      />

      <PublicFooter />
    </main>
  );
}
