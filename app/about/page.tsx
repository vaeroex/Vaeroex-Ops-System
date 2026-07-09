import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

const intelligenceFlow = [
  ["Information", "Signals, records, observations, activity, files, events, and context."],
  ["Visibility", "Seeing what is happening across an organization, system, or environment."],
  ["Awareness", "Understanding patterns, context, risk, change, and meaning."],
  ["Prediction", "Identifying emerging risks, opportunities, and likely outcomes before they become obvious."],
  ["Action", "Turning intelligence into decisions, review, response, and measurable outcomes."]
] as const;

const differenceCards = [
  ["Most systems collect information.", "Vaeroex is built to help organizations understand it."],
  ["Most tools show what happened.", "Vaeroex helps connect signals, context, risk, prediction, and action."],
  ["Most intelligence stops at awareness.", "Vaeroex is designed to connect awareness to recommended action and outcomes."]
] as const;

const longTermDomains = [
  "industrial systems",
  "infrastructure",
  "security",
  "defense",
  "organizational intelligence"
] as const;

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="vaeroex-hero-reveal mx-auto max-w-6xl px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">About Vaeroex</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Vaeroex is an intelligence company.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted">
          We build systems that help organizations turn information into visibility, awareness, prediction, and action.
        </p>
        <p className="mt-3 text-sm font-semibold text-vaeroex-blue">The Advantage of Knowing First.</p>
        <div className="mt-6 flex flex-wrap gap-2 text-sm font-semibold">
          {["Visibility", "Awareness", "Action"].map((pillar) => (
            <span key={pillar} className="rounded-full border border-line bg-white px-4 py-2 shadow-sm">
              {pillar}
            </span>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.82fr_1.18fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Why Vaeroex Exists</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Information is everywhere. Understanding is not.</h2>
          </div>
          <div className="space-y-4 text-sm leading-6 text-muted">
            <p>
              Organizations generate signals through activity, records, people, systems, assets, environments, decisions, and events.
              Without structure, those signals remain scattered, delayed, or disconnected.
            </p>
            <p>
              Vaeroex exists to help organizations turn information into intelligence - revealing what is happening, why it matters,
              what may happen next, and what leadership should review.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">From Information to Intelligence</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Information becomes valuable when it clarifies action.</h2>
          <p className="mt-4 text-sm leading-6 text-muted">
            Vaeroex follows a simple intelligence path: Information -&gt; Visibility -&gt; Awareness -&gt; Prediction -&gt; Action.
          </p>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-5">
          {intelligenceFlow.map(([title, description], index) => (
            <ScrollReveal key={title} delayMs={index * 70} className="vaeroex-hover-card rounded-lg border border-line bg-white p-4 shadow-sm">
              <span className="grid h-9 w-9 place-items-center rounded-full border border-vaeroex-blue/25 bg-vaeroex-blue/10 text-sm font-semibold text-vaeroex-blue">
                {index + 1}
              </span>
              <h3 className="mt-4 font-semibold text-vaeroex-blue">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">What Makes Vaeroex Different</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight">Vaeroex connects signals, context, prediction, and response.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {differenceCards.map(([setup, point], index) => (
              <ScrollReveal key={setup} as="article" delayMs={index * 80} className="vaeroex-hover-card rounded-lg border border-line bg-slate-50 p-5 shadow-sm">
                <p className="text-sm font-semibold text-muted">{setup}</p>
                <h3 className="mt-3 text-lg font-semibold text-vaeroex-blue">{point}</h3>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Current Application</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Operations Intelligence is the first major application of Vaeroex.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Operations Intelligence helps organizations apply Vaeroex intelligence to operational visibility,
              evidence-backed reporting, decision support, and review.
            </p>
            <Link href="/operations-intelligence" className="mt-5 inline-flex rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Explore Operations Intelligence
            </Link>
          </div>
          <ScrollReveal as="article" delayMs={120} className="vaeroex-ambient rounded-lg border border-line bg-vaeroex-navy p-6 text-white shadow-command">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Mission</p>
            <h3 className="mt-3 text-3xl font-semibold tracking-tight">Turn information into visibility, awareness, prediction, and action.</h3>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              The company goal is larger than one product category. Operations Intelligence is where the architecture is applied today.
            </p>
          </ScrollReveal>
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <ScrollReveal className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Founder Perspective</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Isaac, Founder of Vaeroex</h2>
          </div>
          <div className="space-y-4 text-sm leading-6 text-muted">
            <p>
              Vaeroex began from a simple observation: organizations rarely suffer from a lack of information.
              They suffer from a lack of clarity.
            </p>
            <p>
              Across operational, leadership, and structured environments, the same pattern appeared repeatedly:
              signals existed, but they were scattered. Decisions were being made, but context was incomplete.
              Responsibility existed, but context was difficult to see. The work was happening, but leaders often lacked
              the intelligence needed to see what mattered most.
            </p>
            <p>
              That observation became the foundation for Vaeroex. The mission is to build intelligence systems that help
              organizations move from information to visibility, from visibility to awareness, from awareness to prediction,
              and from prediction to action.
            </p>
          </div>
        </ScrollReveal>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Long-Term Vision</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Vaeroex is designed to grow beyond a single product category.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Operations Intelligence is the first application. Over time, the same intelligence architecture can be applied across
              additional domains where visibility, awareness, prediction, and action matter.
            </p>
            <p className="mt-3 text-xs leading-5 text-muted">
              These are long-term direction areas, not currently available product claims.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {longTermDomains.map((domain, index) => (
              <ScrollReveal key={domain} delayMs={index * 55} className="vaeroex-hover-card rounded-lg border border-line bg-white p-4 text-sm font-semibold capitalize shadow-sm">
                {domain}
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-12">
        <ScrollReveal className="vaeroex-ambient mx-auto max-w-6xl rounded-lg border border-line bg-vaeroex-navy p-8 text-white shadow-command">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">The Advantage of Knowing First</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">See further, understand faster, and move first.</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            Vaeroex helps organizations turn scattered information into intelligence that supports awareness, response, and outcomes.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/" className="inline-flex rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Explore Platform
            </Link>
            <Link href="/operations-intelligence" className="inline-flex rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
              Explore Operations Intelligence
            </Link>
            <Link href="/contact" className="inline-flex rounded-lg border border-white/20 bg-transparent px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
              Contact Vaeroex
            </Link>
          </div>
        </ScrollReveal>
      </section>

      <PublicFooter />
    </main>
  );
}
