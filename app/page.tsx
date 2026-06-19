import Link from "next/link";
import { VaeroexLogo } from "@/components/brand/VaeroexLogo";
import { PublicFooter } from "@/components/legal/PublicFooter";

const pillars = [
  ["Visibility", "See performance, risks, files, follow-ups, and decisions in one business view."],
  ["Accountability", "Clarify owners, roles, review points, and what needs attention now."],
  ["Execution", "Turn insight into follow-up, SOP updates, reports, and measurable progress."]
];

const modules = ["KPI Visibility", "CRM Signals", "Reports", "Files", "SOPs", "Checklists", "Issues", "People", "Follow-up"];

const workflowSteps = [
  "Create your intelligence workspace",
  "Choose the business profile that fits your work",
  "Generate the first visibility, accountability, and execution records",
  "Ask Vaeroex for decision support, reports, and next actions"
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f8fafc] text-ink">
      <nav className="border-b border-slate-800 bg-vaeroex-navy px-6 py-4 text-white shadow-command">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3 text-lg font-semibold">
            <span className="grid h-10 w-12 place-items-center rounded-lg border border-white/10 bg-white/10">
              <VaeroexLogo variant="symbol" size="xs" priority />
            </span>
            <span>Vaeroex</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-lg border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-100 hover:border-vaeroex-accent hover:bg-white/15">
              Log in
            </Link>
            <Link href="/signup" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Create account
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-14 lg:grid-cols-[1fr_0.86fr] lg:items-center">
        <div>
          <VaeroexLogo variant="full" size="hero" priority className="mb-6 max-w-full" />
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Operations Intelligence Platform</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            Build the structure your growth depends on.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">
            Vaeroex gives growing businesses the visibility to see what is happening, the accountability to know who owns it,
            and the execution support to turn decisions into measurable progress.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {pillars.map(([title, description]) => (
              <div key={title} className="rounded-lg border border-line bg-white p-4 shadow-sm">
                <p className="text-sm font-semibold text-vaeroex-blue">{title}</p>
                <p className="mt-2 text-xs leading-5 text-slate-600">{description}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white shadow-sm shadow-blue-900/20 hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Start with Vaeroex
            </Link>
            <Link href="/login" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-accent hover:text-vaeroex-blue">
              Log in
            </Link>
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-600">
            Keep operational records practical and safe. Do not enter patient data, PHI, Social Security numbers,
            medical record numbers, insurance IDs, or other regulated sensitive information.
          </p>
        </div>

        <div className="rounded-lg border border-slate-800 bg-vaeroex-navy p-5 text-white shadow-command">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div>
              <p className="text-sm font-semibold">Operations intelligence preview</p>
              <p className="mt-1 text-xs text-vaeroex-silver">Visibility, accountability, execution</p>
            </div>
            <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-100">Ready</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ["Health", "92"],
              ["At risk", "3"],
              ["Focus", "Sales"]
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-white/10 bg-white/[0.06] p-3">
                <p className="text-xs text-vaeroex-silver">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <p className="text-sm font-semibold">Decision support</p>
            <p className="mt-2 text-sm leading-6 text-slate-100">
              Follow-up quality is slipping while lead volume is stable. Review ownership, update the follow-up process, and confirm next actions this week.
            </p>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {["Improve visibility", "Assign owner", "Review execution"].map((action) => (
              <div key={action} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-center text-xs font-semibold text-white">
                {action}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-semibold">Built around clarity, ownership, and follow-through</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => (
              <div key={module} className="rounded-lg border border-line bg-slate-50 p-4 shadow-sm">
                <p className="font-semibold">{module}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-12 lg:grid-cols-[0.8fr_1fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">How setup works</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Go from scattered activity to structured business intelligence.</h2>
        </div>
        <div className="grid gap-3">
          {workflowSteps.map((step, index) => (
            <div key={step} className="flex gap-4 rounded-lg border border-line bg-white p-4 shadow-panel">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-vaeroex-navy text-sm font-semibold text-white">
                {index + 1}
              </span>
              <p className="pt-1 text-sm font-semibold">{step}</p>
            </div>
          ))}
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
