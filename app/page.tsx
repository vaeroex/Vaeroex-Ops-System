import Link from "next/link";
import type { Route } from "next";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { IntelligenceLoopShowcase } from "@/components/motion/IntelligenceLoopShowcase";
import { MarketingDashboardPreview } from "@/components/motion/MarketingDashboardPreview";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

const intelligenceFlow = [
  ["Information", "Signals, records, observations, activity, files, events, and context exist across every organization."],
  ["Visibility", "Intelligence reveals what is happening across people, systems, assets, environments, and decisions."],
  ["Understanding", "Intelligence connects context, patterns, history, and change so leaders understand why something matters."],
  ["Action", "Intelligence becomes valuable when it supports decisions, ownership, response, measurement, and execution."]
] as const;

const intelligenceCapabilities = [
  ["Visibility", "Current", "Available through Vaeroex today.", "Structure scattered signals into a clearer view of what is happening and what needs attention."],
  ["Context Memory", "Current", "Available through Vaeroex today.", "Preserve relevant history so current signals can be understood against prior decisions, patterns, and outcomes."],
  ["Risk Detection", "Current", "Available through Vaeroex today.", "Surface changing conditions, repeated friction, unresolved signals, and emerging exposure before they are ignored."],
  ["Predictive Insight", "Current", "Available through Vaeroex today.", "Identify directional movement and early indicators that may require review, escalation, or response."],
  ["Decision Support", "Current", "Available through Vaeroex today.", "Turn context into review-ready recommendations, priorities, ownership paths, and next-step options."],
  ["Accountability Systems", "Current", "Available through Vaeroex today.", "Clarify responsibility, response paths, unresolved items, and the link between decisions and execution."],
  ["Performance Intelligence", "Current", "Available through Vaeroex today.", "Compare outcomes, targets, movement, and signal quality over time."],
  ["Operational Intelligence", "Current", "Available through Vaeroex today.", "Apply intelligence to organizational execution, reviews, workflows, records, and recurring decisions."],
  ["Asset Intelligence", "Expanding", "An intelligence capability area the platform can continue to evolve toward.", "Apply intelligence to assets, equipment, systems, reliability, and environmental signals."],
  ["Situational Awareness", "Expanding", "An intelligence capability area the platform can continue to evolve toward.", "Help teams understand context, risk, alerts, and priorities across changing environments."]
] as const;

const intelligenceDomains = [
  ["Operations Intelligence", "Current", "Helps organizations understand execution, accountability, performance signals, reviews, and operational decisions."],
  ["Industrial Intelligence", "Expanding domain", "A future-facing area where intelligence architecture can support assets, equipment, systems, reliability, and field signals."],
  ["Infrastructure Intelligence", "Expanding domain", "A future-facing area where intelligence architecture can support distributed systems, remote environments, critical assets, and visibility."],
  ["Security Intelligence", "Expanding domain", "A future-facing area where intelligence architecture can support risk awareness, monitoring context, alerts, and situational understanding."],
  ["Defense Intelligence", "Expanding domain", "A future-facing area where intelligence architecture can support complex environments where visibility, context, and decision support matter."]
] as const;

const intelligenceLoop = [
  ["Capture", "Bring together signals, records, observations, files, events, context, and activity."],
  ["Remember", "Preserve relevant history so new signals can be compared against prior context and outcomes."],
  ["Analyze", "Identify patterns, anomalies, risk surfaces, changing conditions, and decision points."],
  ["Prioritize", "Surface what matters most through confidence, urgency, impact, ownership, and timing."],
  ["Execute", "Turn recommendations into reviewed decisions, assigned response paths, and measurable action."],
  ["Measure", "Track outcomes over time to understand what changed, what improved, and what needs attention next."]
] as const;

const signalCards = [
  ["Signal Confidence", "Illustrative confidence score for a detected pattern."],
  ["Risk Surface", "Example risk signal identified from changing conditions."],
  ["Anomaly Pattern", "Sample pattern that differs from expected behavior."],
  ["Context Match", "Historical context connected to a current signal."],
  ["Decision Point", "A moment requiring review, prioritization, or response."],
  ["Action Path", "Suggested next step generated from intelligence."],
  ["Ownership Signal", "Responsible party or response path identified."],
  ["Outcome Signal", "Impact tracked after action is taken."]
] as const;

const differentCards = [
  ["Most tools store information.", "Vaeroex helps organizations understand it."],
  ["Most systems show information.", "Vaeroex explains what changed, why it matters, and what should happen next."],
  ["Most systems stop at visibility.", "Vaeroex connects visibility to accountability and execution."]
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

      <section className="vaeroex-ambient relative overflow-hidden bg-[#030712] px-6 pb-12 pt-8 text-white sm:pb-14 sm:pt-10 lg:pb-14 lg:pt-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(34,211,238,0.22),transparent_28%),radial-gradient(circle_at_78%_12%,rgba(219,39,119,0.22),transparent_30%),radial-gradient(circle_at_74%_78%,rgba(124,58,237,0.24),transparent_34%)]" />
        <div className="vaeroex-ambient-background pointer-events-none absolute inset-y-0 right-[-5rem] hidden items-center opacity-[0.07] lg:flex">
          <VaeroexLogo variant="full" size="hero" priority className="h-60 w-[36rem]" />
        </div>
        <div className="vaeroex-hero-reveal relative mx-auto grid max-w-6xl gap-7 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div>
            <VaeroexLogo variant="full" size="md" priority className="mb-4 hidden sm:inline-flex" />
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-vaeroex-accent">Intelligence Platform</p>
            <h1 className="mt-3 max-w-4xl text-5xl font-semibold tracking-tight sm:text-6xl">Vaeroex</h1>
            <p className="mt-4 max-w-3xl text-2xl font-semibold leading-tight text-slate-100 sm:text-3xl">
              Transforming information into visibility, understanding, and action.
            </p>
            <p className="mt-4 max-w-3xl text-lg font-semibold text-vaeroex-accent">Build the structure your growth depends on.</p>
            <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
              Vaeroex helps organizations transform scattered information into meaningful intelligence, creating the visibility, understanding, and action needed to make better decisions and execute with confidence.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-sm font-semibold text-slate-100" aria-label="Vaeroex brand pillars">
              {["Visibility", "Accountability", "Execution"].map((pillar) => (
                <span key={pillar} className="rounded-full border border-white/15 bg-white/10 px-4 py-2">
                  {pillar}
                </span>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="#platform" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-950/30 hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                Explore Vaeroex
              </Link>
              <Link href={operationsIntelligenceRoute} className="rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                View Operations Intelligence
              </Link>
              <Link href="/demo" className="rounded-lg border border-white/20 bg-transparent px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                Book a Demo
              </Link>
            </div>
          </div>
          <MarketingDashboardPreview />
        </div>
      </section>

      <section id="platform" className="border-b border-white/10 bg-[#050b18] px-6 py-14">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">What Intelligence Means</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">Information becomes useful when it creates action.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Information is everywhere. Visibility shows what is happening. Understanding explains why it matters. Action turns intelligence into execution.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Vaeroex is built to help organizations move from scattered information to structured intelligence.
            </p>
          </div>
          <div className="relative grid gap-3 md:grid-cols-4">
            <div className="pointer-events-none absolute left-8 right-8 top-8 hidden h-px bg-gradient-to-r from-vaeroex-blue via-vaeroex-accent to-fuchsia-400 md:block" />
            {intelligenceFlow.map(([title, description], index) => (
              <ScrollReveal key={title} delayMs={index * 90} className="vaeroex-hover-card relative rounded-lg border border-white/10 bg-white/[0.06] p-4 shadow-command backdrop-blur">
                <span className="grid h-10 w-10 place-items-center rounded-full border border-vaeroex-accent/40 bg-vaeroex-accent/10 text-sm font-semibold text-vaeroex-accent">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#030712] px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Sample Intelligence Signals</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">A preview of intelligence turning into decisions.</h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-slate-300">
              These website examples are illustrative only. They show the kind of visibility, accountability, and execution signals Vaeroex is built to organize.
            </p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {signalCards.map(([title, description], index) => (
              <ScrollReveal key={title} delayMs={(index % 4) * 70} className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-command">
                <span className="inline-flex rounded-full border border-vaeroex-accent/30 bg-vaeroex-accent/10 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-vaeroex-accent">
                  Sample
                </span>
                <h3 className="mt-4 font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#050b18] px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Intelligence Capabilities</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">What Vaeroex is built to do.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Vaeroex combines current platform capabilities with an architecture designed to evolve across multiple intelligence domains over time.
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {intelligenceCapabilities.map(([title, status, badge, description], index) => (
              <ScrollReveal key={title} as="article" delayMs={(index % 5) * 65} className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.055] p-4 shadow-command backdrop-blur">
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold ${badgeClass(status)}`}>
                  {status}
                </span>
                <h3 className="mt-4 font-semibold text-white">{title}</h3>
                <p className="mt-2 text-xs leading-5 text-slate-400">{badge}</p>
                <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#030712] px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Intelligence Domains</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">One platform direction. Multiple areas of application.</h2>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Vaeroex is designed around an intelligence architecture that can be applied across multiple domains over time.
              </p>
              <p className="mt-3 text-xs leading-5 text-slate-400">
                Expanding domains are future-facing categories, not currently available product promises.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              {intelligenceDomains.map(([title, status, description], index) => (
                <ScrollReveal key={title} delayMs={index * 70} className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-command">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-white">{title}</h3>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold ${status === "Current" ? badgeClass("Current") : badgeClass("Expanding")}`}>
                      {status}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>
                </ScrollReveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="bg-[#050b18] px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <ScrollReveal className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-6 shadow-command">
            <div className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr] lg:items-center">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Current Capability</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">Operations Intelligence</h2>
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  Vaeroex's current intelligence capability helps organizations improve visibility, accountability, and execution across their operations.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 lg:justify-end">
                <Link href={operationsIntelligenceRoute} className="inline-flex rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                  Explore Operations Intelligence
                </Link>
                <Link href="/demo" className="inline-flex rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                  Book a Demo
                </Link>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#030712] px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">The Vaeroex Intelligence Loop</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">Capture, remember, analyze, prioritize, execute, and measure.</h2>
              <p className="mt-4 text-sm leading-6 text-slate-300">
                Vaeroex does more than store information. It helps organizations build a continuous loop from insight to action, then back to measured outcomes.
              </p>
            </div>
            <IntelligenceLoopShowcase steps={intelligenceLoop} />
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#050b18] px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Why Vaeroex Is Different</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight text-white">Vaeroex connects visibility, accountability, and execution.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {differentCards.map(([setup, point], index) => (
              <ScrollReveal key={setup} as="article" delayMs={index * 90} className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-command">
                <p className="text-sm font-semibold text-slate-400">{setup}</p>
                <h3 className="mt-3 text-lg font-semibold text-vaeroex-accent">{point}</h3>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-14">
        <ScrollReveal className="vaeroex-ambient mx-auto max-w-6xl rounded-lg border border-white/10 bg-vaeroex-navy p-8 text-white shadow-command">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Explore Vaeroex</p>
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Build the structure your growth depends on.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Book a demo to see how Vaeroex turns information into visibility, understanding, action, accountability, and execution.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/demo" className="inline-flex shrink-0 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                Book a Demo
              </Link>
              <Link href="/pricing" className="inline-flex shrink-0 rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                View Pricing
              </Link>
            </div>
          </div>
        </ScrollReveal>
      </section>

      <PublicFooter />
    </main>
  );
}
