import Link from "next/link";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";

const whatVaeroexDoes = [
  ["Understand performance", "See KPI movement, revenue signals, leads, issues, reports, and business health in one place."],
  ["Track accountability", "Clarify owners, due dates, review points, and the work that needs leadership attention."],
  ["Create reports", "Turn workspace activity into daily, weekly, monthly, quarterly, yearly, and year-to-date summaries."],
  ["Identify risks", "Surface overdue work, slipping metrics, stale procedures, missed follow-ups, and operational patterns."],
  ["Turn insight into action", "Create reviewed follow-ups, SOP updates, checklist reviews, and decision-ready next steps."]
];

const audiences = ["Owners", "Executives", "Directors", "Managers", "Supervisors", "Operators"];

const capabilities = [
  "Executive Dashboard",
  "KPIs",
  "CRM",
  "Reports",
  "SOPs",
  "Tasks",
  "Issues",
  "Checklists",
  "Files",
  "People",
  "Notifications",
  "Business Health Score",
  "Business Memory",
  "Profit Leak Detection",
  "Scheduled Reports"
];

const workflowSteps = [
  ["Centralize operations", "Bring KPIs, CRM, reports, files, tasks, issues, SOPs, and people into a structured workspace."],
  ["Analyze performance", "Review trends, targets, accountability signals, and business activity over time."],
  ["Surface risks", "See where follow-up, ownership, procedure review, or execution is starting to slip."],
  ["Assign actions", "Turn decisions into clear next steps with owners, timing, and visible status."],
  ["Track outcomes", "Use reports and business memory to see whether decisions are improving performance."]
];

const whyVaeroex = [
  ["Visibility", "Know what is happening before small problems become expensive patterns."],
  ["Accountability", "Make ownership visible so decisions do not disappear into conversation."],
  ["Execution", "Move from insight to reviewed action, then measure whether the action worked."]
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
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-vaeroex-accent">Operations Intelligence Platform</p>
          <h1 className="mt-5 max-w-4xl text-5xl font-semibold tracking-tight sm:text-6xl">Vaeroex</h1>
          <p className="mt-5 max-w-3xl text-2xl font-semibold text-slate-100">Build the structure your growth depends on.</p>
          <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
            Vaeroex helps growing businesses turn operations, performance data, reports, tasks, teams, and business activity into clarity,
            accountability, and better execution.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 text-sm font-semibold text-slate-100">
            {["Visibility", "Accountability", "Execution"].map((pillar) => (
              <span key={pillar} className="rounded-full border border-white/15 bg-white/10 px-4 py-2">
                {pillar}
              </span>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/demo" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-950/30 hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Book a Demo
            </Link>
            <Link href="/pricing" className="rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
              View Pricing
            </Link>
            <Link href="#platform" className="rounded-lg border border-white/20 bg-transparent px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
              Explore Platform
            </Link>
          </div>
        </div>
      </section>

      <section id="platform" className="border-b border-line bg-white px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">What Vaeroex Does</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Turn daily business activity into decision support.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Vaeroex gives leadership a practical structure for seeing performance, understanding risk, and following through.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {whatVaeroexDoes.map(([title, description]) => (
              <article key={title} className="rounded-lg border border-line bg-slate-50 p-4 shadow-sm">
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Built For Growing Businesses</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">For teams that need structure without enterprise complexity.</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {audiences.map((audience) => (
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
              Vaeroex is designed for owners and operators who need better visibility, clearer accountability, and stronger execution habits.
            </p>
          </article>
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Platform Capabilities</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">One place for the signals that run the business.</h2>
            </div>
            <Link href="/pricing" className="text-sm font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
              See everything included
            </Link>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {capabilities.map((capability) => (
              <div key={capability} className="rounded-lg border border-line bg-slate-50 p-3 text-sm font-semibold shadow-sm">
                {capability}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">How It Works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">From scattered updates to structured execution.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Start with the records you already have, add the workflows you need, and let Vaeroex help leadership see what deserves attention.
            </p>
          </div>
          <div className="grid gap-3">
            {workflowSteps.map(([title, description], index) => (
              <article key={title} className="flex gap-4 rounded-lg border border-line bg-white p-4 shadow-panel">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-vaeroex-navy text-sm font-semibold text-white">
                  {index + 1}
                </span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Why Vaeroex</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight">Visibility, accountability, and execution are the structure growth depends on.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {whyVaeroex.map(([title, description]) => (
              <article key={title} className="rounded-lg border border-line bg-slate-50 p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-vaeroex-blue">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
              </article>
            ))}
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
                Book a demo to see how Vaeroex turns business activity into visibility, accountability, and execution.
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
