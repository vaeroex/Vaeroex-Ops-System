import Link from "next/link";
import type { Metadata } from "next";
import type { Route } from "next";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { CapabilityIntelligenceDemo } from "@/components/motion/CapabilityIntelligenceDemo";
import { IntelligenceFlowDemo } from "@/components/motion/IntelligenceFlowDemo";
import { IntelligenceLoopShowcase } from "@/components/motion/IntelligenceLoopShowcase";
import { MarketingDashboardPreview } from "@/components/motion/MarketingDashboardPreview";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { SignalProductionDemo } from "@/components/motion/SignalProductionDemo";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex — Intelligence Platform",
  description: "Vaeroex helps organizations transform scattered information into visibility, awareness, prediction, and action.",
  path: "/"
});

const intelligenceDomains = [
  ["Operations Intelligence", "Current", "Helps organizations understand execution, accountability, performance signals, reviews, and operational decisions."],
  ["Industrial Intelligence", "Expanding domain", "A future-facing area where intelligence architecture can support assets, equipment, systems, reliability, and field signals."],
  ["Infrastructure Intelligence", "Expanding domain", "A future-facing area where intelligence architecture can support distributed systems, remote environments, critical assets, and visibility."],
  ["Security Intelligence", "Expanding domain", "A future-facing area where intelligence architecture can support risk awareness, monitoring context, alerts, and situational understanding."],
  ["Defense Intelligence", "Expanding domain", "A future-facing area where intelligence architecture can support complex environments where visibility, context, and decision support matter."]
] as const;

const intelligenceLoop = [
  ["Capture", "Collect signals, activity, files, events, observations, and context from across an organization or environment."],
  ["Remember", "Preserve context, history, decisions, outcomes, and patterns so intelligence does not reset."],
  ["Analyze", "Identify relationships, changes, anomalies, risk patterns, and meaningful signals."],
  ["Predict", "Surface emerging risks, likely outcomes, opportunities, and conditions before they become obvious."],
  ["Prioritize", "Determine what matters most and what requires attention, review, escalation, or response."],
  ["Execute", "Turn intelligence into review-ready decisions, executive briefs, recommendations, and supporting outputs."],
  ["Measure", "Track outcomes over time to understand what changed, what improved, and what needs attention next."]
] as const;

const differentCards = [
  ["Most organizations have information.", "Vaeroex turns scattered signals into visibility."],
  ["Most systems show what happened.", "Vaeroex helps explain why it matters and what may happen next."],
  ["Most intelligence stops at awareness.", "Vaeroex connects understanding to ownership, response, and action."]
] as const;

function badgeClass(status: string) {
  return status === "Current"
    ? "border-vaeroex-accent/40 bg-vaeroex-accent/10 text-vaeroex-accent"
    : "border-fuchsia-300/30 bg-fuchsia-500/10 text-fuchsia-100";
}

const operationsIntelligenceRoute = "/operations-intelligence" as Route;

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />

      <section className="vaeroex-ambient relative overflow-hidden bg-[#030712] px-6 pb-10 pt-6 text-white sm:pb-12 sm:pt-8 lg:pb-12 lg:pt-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(34,211,238,0.22),transparent_28%),radial-gradient(circle_at_78%_12%,rgba(219,39,119,0.22),transparent_30%),radial-gradient(circle_at_74%_78%,rgba(124,58,237,0.24),transparent_34%)]" />
        <div className="vaeroex-ambient-background pointer-events-none absolute inset-y-0 right-[-5rem] hidden items-center opacity-[0.07] lg:flex">
          <VaeroexLogo variant="full" size="hero" priority className="h-60 w-[36rem]" />
        </div>
        <div className="vaeroex-hero-reveal relative mx-auto grid max-w-6xl gap-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div>
            <VaeroexLogo variant="full" size="md" priority className="mb-3 hidden sm:inline-flex" />
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-vaeroex-accent">Intelligence Platform</p>
            <h1 className="mt-2 max-w-4xl text-5xl font-semibold tracking-tight sm:text-6xl">Vaeroex</h1>
            <p className="mt-3 max-w-3xl text-2xl font-semibold leading-tight text-slate-100 sm:text-3xl">
              Transforming information into visibility, awareness, prediction, and action.
            </p>
            <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">
              Vaeroex helps organizations transform scattered information into meaningful intelligence, creating the visibility, awareness, prediction, and action needed to understand sooner and move with confidence.
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-sm font-semibold text-slate-100" aria-label="Vaeroex brand pillars">
              {["Visibility", "Accountability", "Execution"].map((pillar) => (
                <span key={pillar} className="rounded-full border border-white/15 bg-white/10 px-4 py-2">
                  {pillar}
                </span>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link href="#platform" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-950/30 hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                View Platform
              </Link>
              <Link href={operationsIntelligenceRoute} className="rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                Explore Operations Intelligence
              </Link>
            </div>
          </div>
          <MarketingDashboardPreview />
        </div>
      </section>

      <section id="platform" className="border-b border-white/10 bg-[#050b18] px-6 py-10 sm:py-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-7 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">What Intelligence Means</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">Information becomes useful when it creates action.</h2>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Information is everywhere. Visibility shows what is happening. Understanding explains why it matters. Prediction shows what may happen next. Action turns intelligence into execution.
              </p>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                Vaeroex is built to help organizations move from scattered information to structured intelligence.
              </p>
            </div>
            <IntelligenceFlowDemo />
          </div>

          <div className="mt-8 border-t border-white/10 pt-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Sample Intelligence Signals</p>
                <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">A preview of intelligence turning into decisions.</h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-slate-300">
                These website examples are illustrative only. They show the kind of visibility, accountability, and execution signals Vaeroex is built to organize.
              </p>
            </div>
            <div className="mt-5">
              <SignalProductionDemo />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#030712] px-6 py-10 sm:py-12">
        <div className="mx-auto max-w-6xl">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Intelligence Capabilities</p>
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-white">What Vaeroex is built to do.</h2>
              <p className="max-w-xl text-sm leading-6 text-slate-300">
                Vaeroex turns scattered information into visibility, context, risk detection, prediction, and decision support.
              </p>
            </div>
            <div className="mt-5">
              <CapabilityIntelligenceDemo />
            </div>
          </div>

          <div className="mt-8 border-t border-white/10 pt-8">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Current Capability</p>
            <div className="mt-3 grid gap-5 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
              <ScrollReveal className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-command">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Applied Intelligence</p>
                <h3 className="mt-2 text-2xl font-semibold tracking-tight text-white">Operations Intelligence</h3>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  Operations Intelligence is one application of Vaeroex, focused on helping organizations improve visibility, accountability, and execution in operational environments.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <Link href={operationsIntelligenceRoute} className="inline-flex rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                    Explore Operations Intelligence
                  </Link>
                  <Link href="#platform" className="inline-flex rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                    Learn More
                  </Link>
                </div>
              </ScrollReveal>

              <details className="group rounded-lg border border-white/10 bg-white/[0.05] p-5 shadow-command">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Future Platform Direction</span>
                    <span className="mt-2 block text-xl font-semibold tracking-tight text-white">Multiple areas of application over time.</span>
                    <span className="mt-2 block text-sm leading-6 text-slate-300">
                      Vaeroex is designed around an intelligence architecture that can expand beyond the current capability.
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-100 group-open:border-vaeroex-accent/50 group-open:text-vaeroex-accent">
                    Expand
                  </span>
                </summary>
                <p className="mt-4 text-xs leading-5 text-slate-400">
                  These are platform direction areas, not currently available product promises.
                </p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {intelligenceDomains.filter(([title]) => title !== "Operations Intelligence").map(([title, status, description], index) => (
                    <ScrollReveal key={title} delayMs={index * 70} className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-4 shadow-command">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="font-semibold text-white">{title}</h3>
                        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${badgeClass(status)}`}>
                          {status}
                        </span>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>
                    </ScrollReveal>
                  ))}
                </div>
              </details>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#050b18] px-6 py-10 sm:py-12">
        <div className="mx-auto max-w-6xl">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">The Vaeroex Intelligence Loop</p>
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <h2 className="max-w-3xl text-3xl font-semibold tracking-tight text-white">Capture, remember, analyze, predict, prioritize, execute, and measure.</h2>
              <p className="max-w-xl text-sm leading-6 text-slate-300">
                Vaeroex helps organizations move from raw signals to awareness, prediction, action, and measured outcomes.
              </p>
            </div>
            <div className="mt-5">
              <IntelligenceLoopShowcase steps={intelligenceLoop} />
            </div>
          </div>

          <div className="mt-8 border-t border-white/10 pt-8">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Why Vaeroex Is Different</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-white">Vaeroex connects information, context, prediction, and action.</h2>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              {differentCards.map(([setup, point], index) => (
                <ScrollReveal key={setup} as="article" delayMs={index * 90} className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-4 shadow-command">
                  <p className="text-sm font-semibold text-slate-400">{setup}</p>
                  <h3 className="mt-3 text-lg font-semibold text-vaeroex-accent">{point}</h3>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-10">
        <ScrollReveal className="vaeroex-ambient mx-auto max-w-6xl rounded-lg border border-white/10 bg-vaeroex-navy p-6 text-white shadow-command">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Explore Vaeroex</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">The Advantage of Knowing First.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                See further, understand faster, and move first with an intelligence platform built to turn information into visibility, awareness, prediction, and action.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="#platform" className="inline-flex shrink-0 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                View Platform
              </Link>
              <Link href={operationsIntelligenceRoute} className="inline-flex shrink-0 rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                Explore Operations Intelligence
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </section>

      <PublicFooter />
    </main>
  );
}
