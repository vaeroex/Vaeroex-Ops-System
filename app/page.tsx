import Link from "next/link";

const modules = ["Dashboard", "Forms", "Checklists", "Tasks", "Issues", "Assets", "People", "SOPs", "Reports"];

const workflowSteps = [
  "Create a workspace",
  "Choose an industry template",
  "Generate starter operations records",
  "Ask Vaeroex for audits, SOPs, and reports"
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <nav className="border-b border-line bg-white/90 px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/" className="text-lg font-semibold">
            Vaeroex Ops System
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue">
              Log in
            </Link>
            <Link href="/signup" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
              Create account
            </Link>
          </div>
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-14 lg:grid-cols-[1fr_0.86fr] lg:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Operations platform for growing teams</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Build the operating system your business can actually use.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted">
            Vaeroex Ops System helps teams manage forms, checklists, tasks, issues, assets, people, SOPs, reports,
            and practical recommendations from Vaeroex in one protected workspace.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-blue-700">
              Start with Vaeroex
            </Link>
            <Link href="/login" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue">
              Log in
            </Link>
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-muted">
            Keep operational records practical and safe. Do not enter patient data, PHI, Social Security numbers,
            medical record numbers, insurance IDs, or other regulated sensitive information.
          </p>
        </div>

        <div className="rounded-lg border border-line bg-white p-5 shadow-panel">
          <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
            <div>
              <p className="text-sm font-semibold">Workspace preview</p>
              <p className="mt-1 text-xs text-muted">Accountability dashboard</p>
            </div>
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Ready</span>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              ["Open tasks", "12"],
              ["Issues", "4"],
              ["Checklist runs", "28"]
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-line bg-slate-50 p-3">
                <p className="text-xs text-muted">{label}</p>
                <p className="mt-2 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-line p-4">
            <p className="text-sm font-semibold">Latest Vaeroex recommendation</p>
            <p className="mt-2 text-sm leading-6 text-muted">
              Turn repeat follow-up misses into a checklist, owner review, and weekly report before they become customer issues.
            </p>
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-3">
            {["Create form", "Run audit", "Draft SOP"].map((action) => (
              <div key={action} className="rounded-lg bg-vaeroex-soft px-3 py-2 text-center text-xs font-semibold text-vaeroex-blue">
                {action}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-2xl font-semibold">Core operations modules</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((module) => (
              <div key={module} className="rounded-lg border border-line bg-slate-50 p-4">
                <p className="font-semibold">{module}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-12 lg:grid-cols-[0.8fr_1fr]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">How setup works</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Go from blank workspace to usable operations system.</h2>
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
    </main>
  );
}
