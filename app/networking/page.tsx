import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";

const networkGroups = [
  ["Business owners", "Leaders building stronger visibility, accountability, and execution inside growing companies."],
  ["Operators", "People who understand the practical realities of improving workflows, follow-through, and daily execution."],
  ["Consultants", "Advisors who help businesses improve structure, performance, management rhythm, and implementation."],
  ["Implementation partners", "Trusted partners who can help teams translate Vaeroex insights into better operating habits."],
  ["Service providers", "Aligned providers who support practical business needs around growth, systems, process, and execution."],
  ["Strategic connectors", "People who make thoughtful introductions where trust, timing, and business fit matter."]
];

const networkPrinciples = [
  "Trusted relationships",
  "Practical business support",
  "Aligned referrals",
  "Implementation partners",
  "Operator perspective",
  "Strategic introductions"
];

export default function NetworkingPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Vaeroex Network</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
          A curated network for operators, business leaders, consultants, and strategic partners.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted">
          The Vaeroex Network connects business leaders, operators, consultants, and strategic partners who believe that visibility,
          accountability, and execution drive growth.
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
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Extension of the Platform</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Business intelligence is stronger when trusted people help turn it into action.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Vaeroex is software first, but implementation, referrals, and trusted expertise can help leaders move faster when the right relationship is available.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {networkPrinciples.map((principle) => (
              <div key={principle} className="rounded-lg border border-line bg-slate-50 p-4 text-sm font-semibold shadow-sm">
                {principle}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Who It Connects</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">A business-focused network built around practical execution.</h2>
          </div>
          <Link href="/contact" className="text-sm font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
            Start a partner conversation
          </Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {networkGroups.map(([title, description]) => (
            <article key={title} className="rounded-lg border border-line bg-white p-5 shadow-panel">
              <h3 className="text-lg font-semibold text-vaeroex-blue">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">What It Supports</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">The network is designed for trusted business support, not casual networking.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Vaeroex Network conversations are focused on fit, capability, credibility, and practical value for growing businesses.
              The goal is to help leaders find aligned support where it strengthens the platform outcome.
            </p>
          </div>
          <div className="rounded-lg border border-line bg-slate-50 p-5 shadow-sm">
            <p className="text-sm font-semibold text-vaeroex-blue">Examples of fit</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
              <li>Referral partners who serve growing businesses.</li>
              <li>Implementation partners who help teams improve operating structure.</li>
              <li>Operators who understand performance, accountability, and workflow execution.</li>
              <li>Trusted service providers who support business growth and management systems.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="rounded-lg border border-line bg-vaeroex-navy p-8 text-white shadow-command">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Strategic Partner Interest</p>
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Aligned with visibility, accountability, and execution?</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Contact Vaeroex to discuss referrals, implementation support, operator relationships, or strategic partner fit.
              </p>
            </div>
            <Link href="/contact" className="inline-flex shrink-0 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Contact Vaeroex
            </Link>
          </div>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
