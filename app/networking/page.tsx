import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

const networkGroups = [
  ["Business Owners", "Leaders building stronger visibility, accountability, and execution inside growing companies."],
  ["Operators", "People who understand the practical realities of improving workflows, follow-through, and daily execution."],
  ["Consultants", "Advisors who help businesses improve structure, performance, management rhythm, and implementation."],
  ["Advisors", "Experienced leaders who can contribute judgment, perspective, market context, and operational discipline."],
  ["Investors", "Long-term thinkers interested in the Vaeroex vision, business intelligence category, and disciplined company building."],
  ["Implementation Partners", "Trusted partners who can help teams translate Vaeroex insights into better operating habits."],
  ["Service Providers", "Aligned providers who support practical business needs around systems, process, execution, and leadership rhythm."],
  ["Industry Experts", "People with specialized knowledge who understand how strong operating structure improves business performance."],
  ["Strategic Partners", "Organizations and leaders aligned with Vaeroex's platform direction, customer outcomes, and long-term vision."]
];

const networkPrinciples = [
  "Trusted relationships",
  "Practical business support",
  "Aligned incentives",
  "Long-term thinking",
  "Trusted expertise",
  "Strategic introductions"
];

const strategicRelationshipCards = [
  ["Experienced operators", "People who understand how visibility, accountability, and execution actually change day-to-day business performance."],
  ["Advisory relationships", "Leaders who can bring thoughtful perspective around product direction, customer needs, market context, and operating discipline."],
  ["Strategic alignment", "Partners who share the vision for building an intelligence layer that helps businesses operate with greater clarity."]
];

export default function NetworkingPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="vaeroex-hero-reveal mx-auto max-w-6xl px-6 py-12">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Vaeroex Network</p>
        <h1 className="mt-3 max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
          A premium professional ecosystem connected to the Vaeroex Intelligence Platform.
        </h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted">
          The Vaeroex Network brings together business leaders, operators, advisors, investors, consultants, implementation partners,
          and strategic relationships who believe that visibility, accountability, and execution drive growth.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 text-sm font-semibold">
          {["Intelligence Platform", "Operations Intelligence Suite", "Visibility", "Accountability", "Execution"].map((pillar) => (
            <span key={pillar} className="rounded-full border border-line bg-white px-4 py-2 shadow-sm">
              {pillar}
            </span>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/contact" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
            Join the Vaeroex Network
          </Link>
          <Link href="#strategic-relationships" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
            Explore Strategic Partnerships
          </Link>
          <Link href="/contact" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
            Start a Conversation
          </Link>
        </div>
      </section>

      <section className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Extension of the Platform</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Business intelligence is stronger when trusted people help turn it into action.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Vaeroex is an Intelligence Platform first, with the Operations Intelligence Suite as its current product. The Network extends that mission through trusted relationships,
              implementation support, practical expertise, and strategic conversations that help strong ideas become stronger business structure.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {networkPrinciples.map((principle, index) => (
              <ScrollReveal key={principle} delayMs={index * 55} className="vaeroex-hover-card rounded-lg border border-line bg-slate-50 p-4 text-sm font-semibold shadow-sm">
                {principle}
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Network Categories</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">A business-focused network built around practical execution.</h2>
          </div>
          <Link href="/contact" className="text-sm font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
            Partner with Vaeroex
          </Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {networkGroups.map(([title, description], index) => (
            <ScrollReveal key={title} as="article" delayMs={(index % 3) * 80} className="vaeroex-hover-card rounded-lg border border-line bg-white p-5 shadow-panel">
              <h3 className="text-lg font-semibold text-vaeroex-blue">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <section id="strategic-relationships" className="border-y border-line bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl">
          <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-start">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Strategic Relationships</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">Advisors, investors, and strategic partners aligned with the Vaeroex vision.</h2>
              <p className="mt-4 text-sm leading-6 text-muted">
                Vaeroex welcomes conversations with experienced operators, advisors, investors, and strategic partners who share our vision for building the intelligence layer
                that helps businesses operate with greater clarity, accountability, and execution.
              </p>
              <p className="mt-3 text-sm leading-6 text-muted">
                We believe meaningful growth is driven by strong relationships, shared expertise, aligned incentives, and long-term thinking.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {strategicRelationshipCards.map(([title, description], index) => (
                <ScrollReveal key={title} as="article" delayMs={index * 80} className="vaeroex-hover-card rounded-lg border border-line bg-slate-50 p-5 shadow-sm">
                  <h3 className="font-semibold text-vaeroex-blue">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
                </ScrollReveal>
              ))}
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/contact" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Start a Conversation
            </Link>
            <Link href="/contact" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
              Explore Strategic Partnerships
            </Link>
          </div>
        </div>
      </section>

      <section className="px-6 py-12">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">What It Supports</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">The network is designed for trusted business support, not casual networking.</h2>
            <p className="mt-4 text-sm leading-6 text-muted">
              Vaeroex Network conversations are focused on fit, capability, credibility, and practical value for growing businesses.
              The goal is to help leaders find aligned support where it strengthens the platform outcome.
            </p>
          </div>
          <ScrollReveal delayMs={120} className="vaeroex-hover-card rounded-lg border border-line bg-slate-50 p-5 shadow-sm">
            <p className="text-sm font-semibold text-vaeroex-blue">Examples of fit</p>
            <ul className="mt-3 space-y-2 text-sm leading-6 text-muted">
              <li>Referral partners who serve growing businesses.</li>
              <li>Implementation partners who help teams improve operating structure.</li>
              <li>Advisors and industry experts who can contribute thoughtful market and operating perspective.</li>
              <li>Operators who understand performance, accountability, and workflow execution.</li>
              <li>Trusted service providers who support business growth and management systems.</li>
            </ul>
          </ScrollReveal>
        </div>
      </section>

      <section className="border-t border-line bg-white px-6 py-12">
        <div className="mx-auto max-w-6xl rounded-lg border border-line bg-slate-50 p-5 text-xs leading-5 text-muted shadow-sm">
          Vaeroex does not operate as a broker-dealer, investment marketplace, or fundraising platform. Any strategic, advisory, or investment-related discussions are handled independently and subject to appropriate professional review.
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <ScrollReveal className="vaeroex-ambient rounded-lg border border-line bg-vaeroex-navy p-8 text-white shadow-command">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Strategic Partner Interest</p>
          <div className="mt-3 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Aligned with the Vaeroex vision?</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Contact Vaeroex to discuss network interest, strategic partnerships, advisor relationships, implementation support, or trusted business relationships.
              </p>
            </div>
            <Link href="/contact" className="inline-flex shrink-0 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Partner with Vaeroex
            </Link>
          </div>
        </ScrollReveal>
      </section>

      <PublicFooter />
    </main>
  );
}
