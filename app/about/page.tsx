import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";

const approach = [
  ["Visibility first", "Businesses need a clear view of performance, activity, risk, and ownership before decisions can improve."],
  ["Accountability next", "Owners, roles, due dates, and review points make follow-through visible without adding unnecessary complexity."],
  ["Execution always", "Insights only matter when they become reviewed action, measurable outcomes, and better operating habits."]
];

const builtFor = [
  "Businesses with 3-50 employees",
  "Owners who are tired of chasing updates",
  "Managers who need clearer follow-through",
  "Teams outgrowing spreadsheets and memory",
  "Operators who want practical structure"
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">About Vaeroex</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">Built from real operations experience.</h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted">
          Vaeroex exists because growing businesses often reach a point where effort is high, information is scattered, and accountability is hard to see.
          The platform is built to help leaders create the structure their growth depends on.
        </p>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Why Vaeroex Exists</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Growing businesses feel pressure before they build structure.</h2>
          </div>
          <div className="space-y-4 text-sm leading-6 text-muted">
            <p>
              Small and growing businesses often run on conversation, spreadsheets, text threads, and individual memory. That works until the team grows,
              customers increase, handoffs multiply, and important follow-ups start falling through the cracks.
            </p>
            <p>
              Vaeroex helps turn daily activity into operational clarity: what is happening, who owns it, what is at risk, and what should happen next.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-6 md:grid-cols-3">
          {approach.map(([title, description]) => (
            <article key={title} className="rounded-lg border border-line bg-white p-5 shadow-panel">
              <h2 className="text-lg font-semibold text-vaeroex-blue">{title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Built for Operators</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Professional enough for leadership, practical enough for the people doing the work.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Vaeroex is intentionally focused on practical business workflows: KPIs, CRM, reports, SOPs, tasks, issues, checklists, files, people,
              notifications, and business memory.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-5 shadow-sm">
            <p className="text-sm font-semibold text-vaeroex-blue">Built for growing businesses</p>
            <div className="mt-4 grid gap-3">
              {builtFor.map((item) => (
                <div key={item} className="rounded-lg border border-line bg-white px-4 py-3 text-sm font-semibold">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-lg border border-line bg-vaeroex-navy p-8 text-white shadow-command">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">From Visibility to Execution</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Vaeroex helps leadership see the business clearly and act with more confidence.</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            The goal is not to add another complicated tool. The goal is to give growing businesses the operating structure they need to make better decisions,
            assign clearer ownership, and follow through.
          </p>
          <Link href="/demo" className="mt-6 inline-flex rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
            Book a Demo
          </Link>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
