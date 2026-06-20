import Link from "next/link";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { AnimatedMetric } from "@/components/motion/AnimatedMetric";
import { IntelligenceLoopShowcase } from "@/components/motion/IntelligenceLoopShowcase";
import { MarketingDashboardPreview } from "@/components/motion/MarketingDashboardPreview";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { ScrollStory } from "@/components/motion/ScrollStory";

const audienceTypes = ["Owners", "Executives", "Directors", "Managers", "Operators"];

const suiteCapabilities = [
  ["Business Health Score", "Measure overall business performance across operations, sales, accountability, process health, and execution."],
  ["Business Memory", "Preserve operational context over time so leaders can understand what changed, when it changed, and what actions followed."],
  ["Profit Leak Detection", "Identify missed follow-ups, underperforming KPIs, unresolved issues, stale SOPs, and other hidden performance gaps."],
  ["Predictive Insights", "Surface emerging risks and performance signals before they become larger operational problems."],
  ["Decision Support", "Turn scattered business activity into recommended next actions, assigned ownership, and measurable follow-through."],
  ["Risk Intelligence", "Monitor operational indicators, overdue work, declining metrics, and repeated issues that may require leadership attention."],
  ["Accountability Intelligence", "Understand who owns what, what is overdue, what is unresolved, and where execution is breaking down."],
  ["Executive Briefings", "Generate leadership-ready summaries that explain performance, risks, trends, and recommended next actions."],
  ["Recommendation Tracking", "Track whether recommended actions were accepted, assigned, completed, and whether they improved outcomes."],
  ["Operations Autopilot with Human Approval", "Allow Vaeroex to suggest actions while requiring human review before records are created or changed."]
];

const intelligenceLoop = [
  ["Capture", "Bring together tasks, KPIs, reports, CRM activity, files, issues, SOPs, checklists, and team activity."],
  ["Remember", "Build business memory by preserving context, decisions, reports, actions, and historical performance."],
  ["Analyze", "Use operational intelligence to identify trends, risks, performance changes, and accountability gaps."],
  ["Prioritize", "Surface what matters most through Business Health Score, Profit Leak Detection, Smart Alerts, and Executive Briefings."],
  ["Execute", "Turn recommendations into tasks, SOPs, KPI alerts, reports, assignments, and follow-up actions."],
  ["Measure", "Track outcomes over time to understand what improved, what declined, and what needs attention next."]
] as const;

const exampleSignals = [
  ["Business Health Score", 84, "/100", "Example leadership score"],
  ["Risks surfaced", 12, "", "Operational signals reviewed"],
  ["Recommendations assigned", 18, "", "Follow-through opportunities"],
  ["KPI trends reviewed", 36, "", "Performance changes monitored"]
] as const;

const differentCards = [
  ["Most tools help teams store work.", "Vaeroex helps leaders understand work."],
  ["Most dashboards show numbers.", "Vaeroex explains what changed, why it matters, and what should happen next."],
  ["Most AI tools generate summaries.", "Vaeroex connects recommendations to tasks, reports, SOPs, KPIs, assignments, and outcomes."]
];

const futureCategories = [
  "Business intelligence",
  "Decision intelligence",
  "Predictive intelligence",
  "Workforce intelligence",
  "Risk intelligence",
  "Performance intelligence"
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f8fafc] text-ink">
      <PublicSiteHeader />

      <section className="vaeroex-ambient relative overflow-hidden bg-vaeroex-navy px-6 pb-10 pt-7 text-white sm:pb-12 sm:pt-9 lg:pb-10 lg:pt-8">
        <div className="vaeroex-ambient-background pointer-events-none absolute inset-y-0 right-[-4rem] hidden items-center opacity-[0.08] lg:flex">
          <VaeroexLogo variant="full" size="hero" priority className="h-56 w-[34rem]" />
        </div>
        <div className="vaeroex-hero-reveal relative mx-auto grid max-w-6xl gap-7 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div>
            <VaeroexLogo variant="full" size="md" priority className="mb-4 hidden sm:inline-flex" />
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-vaeroex-accent">Intelligence Platform</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">Vaeroex</h1>
            <p className="mt-3 max-w-3xl text-xl font-semibold text-slate-100 sm:text-2xl">Build the structure your growth depends on.</p>
            <p className="mt-4 hidden max-w-3xl text-base leading-7 text-slate-300 sm:block">
              Vaeroex helps growing businesses transform scattered information into operational clarity, predictive insight, and accountable execution.
            </p>
            <div className="mt-4 hidden flex-wrap gap-2 text-sm font-semibold text-slate-100 sm:flex" aria-label="Vaeroex brand pillars">
              {["Visibility", "Accountability", "Execution"].map((pillar) => (
                <span key={pillar} className="rounded-full border border-white/15 bg-white/10 px-4 py-2">
                  {pillar}
                </span>
              ))}
            </div>
            <p className="mt-4 hidden rounded-full border border-vaeroex-accent/40 bg-vaeroex-accent/10 px-4 py-2 text-sm font-semibold text-vaeroex-accent sm:inline-flex">
              Now available: Operations Intelligence Suite
            </p>
            <p className="mt-3 hidden max-w-3xl text-sm leading-6 text-slate-300 sm:block">
              Built for business owners, executives, directors, managers, and operators who need to understand what is happening, why it matters, and what to do next.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/demo" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-950/30 hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                Book a Demo
              </Link>
              <Link href="/pricing" className="rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                View Pricing
              </Link>
              <Link href="#operations-intelligence" className="rounded-lg border border-white/20 bg-transparent px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                Explore Operations Intelligence
              </Link>
            </div>
          </div>
          <MarketingDashboardPreview />
        </div>
      </section>

      <section id="platform" className="border-b border-line bg-white px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Platform</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">The intelligence layer for growing businesses.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Vaeroex combines business memory, predictive insight, risk detection, and decision support to help teams operate with greater visibility and accountability.
            </p>
          </div>
          <ScrollReveal as="article" delayMs={120} className="vaeroex-hover-card rounded-lg border border-line bg-slate-50 p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Brand pillars</p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight">Visibility • Accountability • Execution</h3>
            <p className="mt-3 text-sm leading-6 text-muted">
              Vaeroex is built around a simple leadership pattern: see what is happening, clarify who owns it, and turn insight into reviewed action.
            </p>
          </ScrollReveal>
        </div>
      </section>

      <section className="border-b border-line bg-slate-50 px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Platform capability preview</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight">Example intelligence signals Vaeroex can help leaders review.</h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-muted">
              These are sample website metrics that demonstrate the type of visibility, accountability, and execution signals Vaeroex is built to organize.
            </p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {exampleSignals.map(([label, value, suffix, helper], index) => (
              <AnimatedMetric
                key={label}
                label={label}
                value={value}
                suffix={suffix}
                delayMs={index * 90}
                helper={helper}
                className="vaeroex-hover-card rounded-lg border border-line bg-white p-5 shadow-sm"
              />
            ))}
          </div>
        </div>
      </section>

      <section id="operations-intelligence" className="mx-auto max-w-6xl px-6 py-12">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Current Flagship Product</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Operations Intelligence Suite</h2>
          <p className="mt-3 text-xl font-semibold text-slate-700">
            A complete intelligence system for visibility, accountability, and execution.
          </p>
          <p className="mt-4 text-sm leading-6 text-muted">
            The Operations Intelligence Suite brings together business data, team activity, reports, KPIs, files, tasks, SOPs, CRM, alerts, and Vaeroex intelligence into one structured operating layer.
          </p>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {suiteCapabilities.map(([title, description], index) => (
            <ScrollReveal key={title} as="article" delayMs={(index % 6) * 70} className="vaeroex-hover-card rounded-lg border border-line bg-white p-4 shadow-panel">
              <h3 className="font-semibold text-vaeroex-blue">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <ScrollStory />

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">The Vaeroex Intelligence Loop</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">From insight to action, then back to measured outcomes.</h2>
              <p className="mt-4 text-sm leading-6 text-muted">
                Vaeroex does more than store information. It helps organizations build a continuous loop from insight to action.
              </p>
            </div>
            <IntelligenceLoopShowcase steps={intelligenceLoop} />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Built For Growing Businesses</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">For teams that need structure without enterprise complexity.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Vaeroex is built for leaders who need a better way to understand performance, risk, ownership, and follow-through.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {audienceTypes.map((audience, index) => (
                <ScrollReveal key={audience} delayMs={index * 60} className="vaeroex-hover-card rounded-lg border border-line bg-white p-4 text-sm font-semibold shadow-sm">
                  {audience}
                </ScrollReveal>
              ))}
            </div>
          </div>
          <ScrollReveal as="article" delayMs={140} className="vaeroex-hover-card rounded-lg border border-line bg-white p-5 shadow-panel">
            <p className="text-sm font-semibold text-vaeroex-blue">Best fit</p>
            <p className="mt-3 text-2xl font-semibold">Businesses with 3-50 employees that are growing faster than their structure.</p>
            <p className="mt-3 text-sm leading-6 text-muted">
              The platform is designed for practical leadership rhythms: reviewing signals, assigning ownership, tracking recommendations, and measuring whether actions worked.
            </p>
          </ScrollReveal>
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Why Vaeroex Is Different</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight">Vaeroex connects visibility, accountability, and execution.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {differentCards.map(([setup, point], index) => (
              <ScrollReveal key={setup} as="article" delayMs={index * 90} className="vaeroex-hover-card rounded-lg border border-line bg-slate-50 p-5 shadow-sm">
                <p className="text-sm font-semibold text-muted">{setup}</p>
                <h3 className="mt-3 text-lg font-semibold text-vaeroex-blue">{point}</h3>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-lg border border-line bg-white p-6 shadow-panel">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Long-Term Vision</p>
          <div className="mt-3 grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Built to expand as an intelligence layer.</h2>
              <p className="mt-4 text-sm leading-6 text-muted">
                Vaeroex is designed to expand across multiple intelligence categories as the platform evolves, including business intelligence, decision intelligence, predictive intelligence, workforce intelligence, risk intelligence, and performance intelligence.
              </p>
              <p className="mt-3 text-sm leading-6 text-muted">
                The long-term vision for Vaeroex is to become the intelligence layer that helps organizations understand performance, anticipate risk, improve execution, and make better decisions.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {futureCategories.map((category, index) => (
                <ScrollReveal key={category} delayMs={index * 50} className="vaeroex-hover-card rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold">
                  {category}
                </ScrollReveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-12">
        <ScrollReveal className="vaeroex-ambient mx-auto max-w-6xl rounded-lg border border-line bg-vaeroex-navy p-8 text-white shadow-command">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Ready to see Vaeroex?</p>
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Build the structure your growth depends on.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Book a demo to see how the Operations Intelligence Suite helps turn business activity into clarity, accountability, and execution.
              </p>
            </div>
            <Link href="/demo" className="inline-flex shrink-0 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Book a Demo
            </Link>
          </div>
        </ScrollReveal>
      </section>

      <PublicFooter />
    </main>
  );
}
