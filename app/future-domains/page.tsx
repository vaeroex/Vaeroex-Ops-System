import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

const domains = [
  [
    "Industrial Intelligence",
    "Areas where intelligence can be applied to equipment context, reliability signals, maintenance patterns, operational visibility, and facility-level awareness."
  ],
  [
    "Infrastructure Intelligence",
    "Areas where intelligence can be applied to systems, assets, service continuity, risk signals, monitoring context, and response planning."
  ],
  [
    "Security Intelligence",
    "Areas where intelligence can be applied to situational awareness, risk analysis, information management, event review, and decision support."
  ],
  [
    "Organizational Intelligence",
    "Areas where intelligence can be applied to decision context, business memory, operating patterns, and leadership visibility."
  ]
] as const;

const principles = [
  "Information should become visibility.",
  "Visibility should become awareness.",
  "Awareness should support prediction.",
  "Prediction should guide action."
] as const;

export default function FutureDomainsPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr] lg:items-start">
          <div className="vaeroex-hero-reveal">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Future Intelligence Domains</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">Where Vaeroex can expand over time.</h1>
            <p className="mt-5 text-sm leading-6 text-muted">
              Operations Intelligence is the current Vaeroex product. Future Domains describes platform direction and areas where intelligence can be applied
              as Vaeroex evolves.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/operations-intelligence" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
                View Current Product
              </Link>
              <Link href="/" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                View Platform
              </Link>
            </div>
          </div>

          <ScrollReveal delayMs={120} className="vaeroex-hover-card rounded-lg border border-line bg-white p-6 shadow-panel">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Important Context</p>
            <h2 className="mt-2 text-2xl font-semibold">This is not a product list.</h2>
            <p className="mt-3 text-sm leading-6 text-muted">
              The areas below are future intelligence domains and strategic directions. They should not be read as customer-facing products,
              launch commitments, implementation timelines, or customer promises.
            </p>
          </ScrollReveal>
        </div>

        <section className="mt-10">
          <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Platform Direction</p>
          <h2 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight">The same intelligence model can apply across different environments.</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {domains.map(([title, description], index) => (
              <ScrollReveal key={title} as="article" delayMs={index * 70} className="vaeroex-hover-card rounded-lg border border-line bg-white p-5 shadow-sm">
                <h3 className="font-semibold text-vaeroex-blue">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
              </ScrollReveal>
            ))}
          </div>
        </section>

        <section className="mt-12 grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <ScrollReveal className="rounded-lg border border-line bg-white p-6 shadow-panel">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Intelligence Pattern</p>
            <h2 className="mt-2 text-2xl font-semibold">The Vaeroex approach is domain-flexible.</h2>
            <ul className="mt-4 grid gap-2 text-sm leading-6 text-muted">
              {principles.map((principle) => (
                <li key={principle} className="rounded-lg border border-line bg-slate-50 px-3 py-2">
                  {principle}
                </li>
              ))}
            </ul>
          </ScrollReveal>

          <ScrollReveal delayMs={120} className="vaeroex-ambient rounded-lg border border-line bg-vaeroex-navy p-6 text-white shadow-command">
            <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-accent">Current Product</p>
            <h2 className="mt-2 text-2xl font-semibold">Operations Intelligence is what Vaeroex offers today.</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              For current capabilities, dashboard previews, subscription details, and customer use cases, review the Operations Intelligence product page.
            </p>
            <Link href="/operations-intelligence" className="mt-5 inline-flex rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Explore Operations Intelligence
            </Link>
          </ScrollReveal>
        </section>
      </section>

      <PublicFooter />
    </main>
  );
}
