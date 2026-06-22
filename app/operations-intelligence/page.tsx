import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

const productCapabilities = [
  ["Executive Dashboard", "A leadership view of performance, risks, priorities, open work, and recommended next actions."],
  ["Business Health Score", "A sample score model that summarizes operating signals into a focused executive view."],
  ["Business Memory", "Historical context for reports, decisions, imports, actions, KPI movement, and follow-up outcomes."],
  ["Profit Leak Detection", "Identify missed actions, stalled follow-ups, unresolved issues, and avoidable execution gaps."],
  ["KPI Intelligence", "Track targets, actuals, trends, comparisons, and below-target signals."],
  ["CRM", "Understand lead activity, follow-ups, conversion movement, and pipeline accountability."],
  ["Reports", "Daily, weekly, monthly, quarterly, yearly, and year-to-date summaries using workspace context."],
  ["SOPs", "Create, manage, review, and improve procedures as operating knowledge changes."],
  ["Tasks", "Turn recommendations and reviews into assigned action with ownership and status."],
  ["Issues", "Track blockers, risks, customer problems, and internal execution gaps."],
  ["Files", "Upload business records, extract usable context, and connect file analysis to reports."],
  ["People", "Connect responsibility, roles, assignments, and notification paths."],
  ["Notifications", "Surface shared reports, assignments, KPI alerts, and items needing attention."],
  ["Executive Briefings", "Summarize what changed, what matters, and what leadership should review next."],
  ["Scheduled Reports", "Support recurring leadership reviews without forcing email delivery."],
  ["Decision Support", "Convert workspace context into reviewed recommendations and next steps."],
  ["Accountability", "Clarify owners, due dates, follow-up expectations, and execution status."]
] as const;

const dashboardSignals = [
  ["Business Health Score", "92 / 100", "Strong execution, low risk"],
  ["Profit Leak", "7 items", "Follow-ups and issue drift need review"],
  ["KPI Intelligence", "3 below target", "Response time, conversion, checklist completion"],
  ["CRM Follow-Up", "Owner needed", "Pipeline accountability gap detected"]
] as const;

const operatingExamples = [
  ["Reports", "Generate leadership summaries with completed work, overdue items, risks, KPI trends, and recommended next actions."],
  ["Checklists", "Run operating routines, see missed steps, and connect failures to issue reviews."],
  ["SOPs", "Keep procedures current by tying reviews to recurring problems, stale documents, and accountability gaps."],
  ["Files", "Bring in spreadsheets, documents, and operational data so Vaeroex can preserve historical context."]
] as const;

const workflowSteps = [
  ["Collect", "Tasks, KPIs, reports, CRM activity, files, SOPs, checklists, issues, and people context flow into one workspace."],
  ["Analyze", "Vaeroex surfaces trends, risks, bottlenecks, below-target metrics, missed actions, and recurring problems."],
  ["Recommend", "The platform turns context into practical actions, owners, reports, SOP updates, and review items."],
  ["Track", "Teams can see what changed, what was assigned, what improved, and what still needs attention."]
] as const;

export default function OperationsIntelligencePage() {
  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />

      <section className="vaeroex-ambient relative overflow-hidden px-6 py-14 text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(30,107,255,0.28),transparent_30%),radial-gradient(circle_at_78%_18%,rgba(56,189,248,0.18),transparent_28%),radial-gradient(circle_at_62%_82%,rgba(168,85,247,0.18),transparent_34%)]" />
        <div className="relative mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-vaeroex-accent">Current Capability</p>
            <h1 className="mt-3 text-5xl font-semibold tracking-tight sm:text-6xl">Operations Intelligence</h1>
            <p className="mt-5 max-w-3xl text-2xl font-semibold leading-tight text-slate-100">
              What Vaeroex can do today.
            </p>
            <p className="mt-5 max-w-3xl text-base leading-7 text-slate-300">
              Vaeroex helps organizations turn operational activity into visibility, accountability, and execution through dashboards, KPIs, reports, SOPs, tasks, CRM context, file analysis, and decision support.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="#how-it-works" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-950/30 hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                Learn More
              </Link>
              <Link href="/" className="rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                View Platform
              </Link>
              <Link href="/pricing" className="rounded-lg border border-white/20 bg-white/10 px-5 py-3 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:text-vaeroex-accent">
                View Pricing
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-white/15 bg-[#08111f]/95 p-4 shadow-command">
            <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Sample Dashboard Preview</p>
                <h2 className="mt-1 text-xl font-semibold text-white">Executive operating view</h2>
              </div>
              <span className="rounded-full border border-emerald-300/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100">Live-ready</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {dashboardSignals.map(([label, value, helper]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-vaeroex-accent">{value}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-300">{helper}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-amber-300/25 bg-amber-400/10 p-4 text-amber-100">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] opacity-75">Recommended Action</p>
              <p className="mt-2 text-sm font-semibold leading-6">
                Assign CRM follow-up owner, review overdue issues, and generate a weekly recovery report.
              </p>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-400">Illustrative product preview only. Actual workspace results depend on customer data and configuration.</p>
          </div>
        </div>
      </section>

      <section className="border-y border-white/10 bg-[#050b18] px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Product Capability</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">Visibility, accountability, and execution for daily operations.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Operations Intelligence connects the records, routines, people, files, metrics, and decisions that shape how a business actually runs.
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {productCapabilities.map(([title, description], index) => (
              <ScrollReveal key={title} delayMs={(index % 4) * 60} className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-4 shadow-command">
                <h3 className="font-semibold text-vaeroex-accent">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-b border-white/10 bg-[#030712] px-6 py-14">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">How It Works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">From operating activity to action.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Vaeroex is designed for business owners and operators who need a clearer way to understand what is happening, what is slipping, and what should happen next.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {workflowSteps.map(([title, description], index) => (
              <ScrollReveal key={title} delayMs={index * 80} className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-command">
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

      <section className="border-b border-white/10 bg-[#050b18] px-6 py-14">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Use Cases</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-white">Product examples inside Operations Intelligence.</h2>
            </div>
            <p className="max-w-xl text-sm leading-6 text-slate-300">
              These examples show where business-specific tools belong: inside the current Operations Intelligence capability, not the company-level homepage.
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {operatingExamples.map(([title, description], index) => (
              <ScrollReveal key={title} delayMs={index * 70} className="vaeroex-hover-card rounded-lg border border-white/10 bg-white/[0.06] p-5 shadow-command">
                <h3 className="font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{description}</p>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 py-14">
        <ScrollReveal className="vaeroex-ambient mx-auto max-w-6xl rounded-lg border border-white/10 bg-vaeroex-navy p-8 text-white shadow-command">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">See Operations Intelligence</p>
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Build the structure your growth depends on.</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Learn how Vaeroex can support visibility, accountability, execution, and decision support, then review the subscription details when you are ready.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/" className="inline-flex shrink-0 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                View Platform
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
