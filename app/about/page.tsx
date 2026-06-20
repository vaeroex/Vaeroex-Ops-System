import Link from "next/link";
import type { Route } from "next";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";

const recurringProblems = [
  "Scattered information",
  "Unclear ownership",
  "Reactive decision-making",
  "Communication gaps",
  "Inconsistent follow-through",
  "Lack of structured visibility"
];

const insightCards = [
  ["They need structure", "Growing becomes easier to manage when information, ownership, and review rhythms are clear."],
  ["They need visibility", "Leaders need to understand what is happening across performance, people, issues, reports, and follow-up."],
  ["They need accountability", "Teams need clear owners, due dates, responsibilities, and review points."],
  ["They need execution", "Information has to become decisions, actions, and outcomes, not another disconnected record."]
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Why Vaeroex Exists</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Businesses do not need more disconnected software. They need structure.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted">
          Vaeroex is an Operations Intelligence Platform built to help leaders understand what is happening, why it matters,
          and what should happen next.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 text-sm font-semibold">
          {["Visibility", "Accountability", "Execution"].map((pillar) => (
            <span key={pillar} className="rounded-full border border-line bg-white px-4 py-2 shadow-sm">
              {pillar}
            </span>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.82fr_1.18fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">The Problem</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Leaders often lack a clear view of what is happening.</h2>
          </div>
          <div className="space-y-4 text-sm leading-6 text-muted">
            <p>
              Critical information is often scattered across spreadsheets, emails, meetings, reports, and disconnected systems.
              Business leaders spend valuable time trying to understand performance, identify problems, track accountability,
              and determine what should happen next.
            </p>
            <p>
              The result is usually the same: visibility is incomplete, ownership is unclear, decisions become reactive, and execution depends too much on memory.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.92fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Operational Experience</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">The same operational challenges appear across teams and departments.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Real-world operational environments exposed recurring patterns: people were working hard, but the structure around the work was often incomplete.
              Across different organizations, the specific details changed, but the root causes were familiar.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {recurringProblems.map((problem) => (
              <div key={problem} className="rounded-lg border border-line bg-white p-4 text-sm font-semibold shadow-sm">
                {problem}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">The Insight</p>
          <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight">Most businesses do not struggle because they lack effort. They struggle because they lack clarity.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {insightCards.map(([title, description]) => (
              <article key={title} className="rounded-lg border border-line bg-slate-50 p-5 shadow-sm">
                <h3 className="font-semibold text-vaeroex-blue">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">The Solution</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Vaeroex turns information into clarity, accountability, and execution.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Rather than simply storing data, Vaeroex helps leaders connect business activity to performance signals, accountability systems,
              reports, risks, and recommended next actions.
            </p>
          </div>
          <article className="rounded-lg border border-line bg-vaeroex-navy p-6 text-white shadow-command">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Mission</p>
            <h3 className="mt-3 text-3xl font-semibold tracking-tight">Build the structure your growth depends on.</h3>
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Helping leaders understand what is happening, why it matters, and what should happen next.
            </p>
          </article>
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Founder Perspective</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Isaac, Founder of Vaeroex</h2>
          </div>
          <div className="space-y-4 text-sm leading-6 text-muted">
            <p>
              Long before Vaeroex existed, Isaac was someone who paid attention to how work actually moved through organizations.
              Across teams, departments, and leadership environments, the same pattern appeared repeatedly: important information was scattered,
              accountability was unclear, decisions were often reactive, and leaders lacked visibility into what was actually happening.
            </p>
            <p>
              Leadership experience created the opportunity to address many of those challenges directly by improving communication,
              strengthening accountability, streamlining workflows, and creating systems that helped teams operate more effectively.
            </p>
            <p>
              Later, time in the United States Air Force reinforced principles that continue to shape Vaeroex: discipline, accountability,
              continuous improvement, and the importance of turning information into actionable intelligence.
            </p>
            <p>
              That experience became the foundation for Vaeroex: a premium Operations Intelligence Platform for growing businesses that need
              better visibility, clearer accountability, and stronger execution.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-lg border border-line bg-white p-6 shadow-panel">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Aligned Partners</p>
          <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Vaeroex also connects with operators, consultants, and trusted service providers.</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">
                The Vaeroex Network extends the platform through practical business support, referrals, implementation partners, and strategic introductions.
              </p>
            </div>
            <Link href={"/networking" as Route} className="inline-flex shrink-0 rounded-lg border border-line px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
              Explore Vaeroex Network
            </Link>
          </div>
        </div>
      </section>

      <section className="px-6 pb-12">
        <div className="mx-auto max-w-6xl rounded-lg border border-line bg-vaeroex-navy p-8 text-white shadow-command">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Structure Creates Clarity</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">Structure turns complexity into clarity.</h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            Vaeroex is built to help growing organizations create the visibility, accountability, and execution needed to make better decisions and build sustainable growth.
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
