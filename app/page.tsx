import Link from "next/link";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";

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
];

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

      <section className="relative overflow-hidden bg-vaeroex-navy px-6 py-16 text-white sm:py-20">
        <div className="absolute inset-y-8 right-[-5rem] hidden opacity-10 lg:block">
          <VaeroexLogo variant="full" size="hero" priority className="h-72 w-[44rem]" />
        </div>
        <div className="relative mx-auto max-w-6xl">
          <VaeroexLogo variant="full" size="lg" priority className="mb-8" />
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-vaeroex-accent">Intelligence Platform</p>
          <h1 className="mt-5 max-w-4xl text-5xl font-semibold tracking-tight sm:text-6xl">Vaeroex</h1>
          <p className="mt-5 max-w-3xl text-2xl font-semibold text-slate-100">Build the structure your growth depends on.</p>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
            Vaeroex helps growing businesses transform scattered information into operational clarity, predictive insight, and accountable execution.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-sm font-semibold text-slate-100" aria-label="Vaeroex brand pillars">
            {["Visibility", "Accountability", "Execution"].map((pillar) => (
              <span key={pillar} className="rounded-full border border-white/15 bg-white/10 px-4 py-2">
                {pillar}
              </span>
            ))}
          </div>
          <p className="mt-6 inline-flex rounded-full border border-vaeroex-accent/40 bg-vaeroex-accent/10 px-4 py-2 text-sm font-semibold text-vaeroex-accent">
            Now available: Operations Intelligence Suite
          </p>
          <p className="mt-4 max-w-3xl text-sm leading-6 text-slate-300">
            Built for business owners, executives, directors, managers, and operators who need to understand what is happening, why it matters, and what to do next.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
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
          <article className="rounded-lg border border-line bg-slate-50 p-6 shadow-sm">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Brand pillars</p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight">Visibility • Accountability • Execution</h3>
            <p className="mt-3 text-sm leading-6 text-muted">
              Vaeroex is built around a simple leadership pattern: see what is happening, clarify who owns it, and turn insight into reviewed action.
            </p>
          </article>
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
          {suiteCapabilities.map(([title, description]) => (
            <article key={title} className="rounded-lg border border-line bg-white p-4 shadow-panel">
              <h3 className="font-semibold text-vaeroex-blue">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            </article>
          ))}
        </div>
      </section>

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
            <div className="grid gap-3 md:grid-cols-2">
              {intelligenceLoop.map(([title, description], index) => (
                <article key={title} className="rounded-lg border border-line bg-slate-50 p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-vaeroex-navy text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <h3 className="font-semibold">{title}</h3>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted">{description}</p>
                </article>
              ))}
            </div>
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
              {audienceTypes.map((audience) => (
                <div key={audience} className="rounded-lg border border-line bg-white p-4 text-sm font-semibold shadow-sm">
                  {audience}
                </div>
              ))}
            </div>
          </div>
          <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
            <p className="text-sm font-semibold text-vaeroex-blue">Best fit</p>
            <p className="mt-3 text-2xl font-semibold">Businesses with 3-50 employees that are growing faster than their structure.</p>
            <p className="mt-3 text-sm leading-6 text-muted">
              The platform is designed for practical leadership rhythms: reviewing signals, assigning ownership, tracking recommendations, and measuring whether actions worked.
            </p>
          </article>
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Why Vaeroex Is Different</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight">Vaeroex connects visibility, accountability, and execution.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {differentCards.map(([setup, point]) => (
              <article key={setup} className="rounded-lg border border-line bg-slate-50 p-5 shadow-sm">
                <p className="text-sm font-semibold text-muted">{setup}</p>
                <h3 className="mt-3 text-lg font-semibold text-vaeroex-blue">{point}</h3>
              </article>
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
              {futureCategories.map((category) => (
                <div key={category} className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-semibold">
                  {category}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-12">
        <div className="mx-auto max-w-6xl rounded-lg border border-line bg-vaeroex-navy p-8 text-white shadow-command">
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
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
