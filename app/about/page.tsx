import Link from "next/link";
import type { Metadata } from "next";
import { ArrowRight, Compass, Eye, Layers3 } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicCtaBand, PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "About Vaeroex",
  description: "Vaeroex is an intelligence company building Operations Intelligence for evidence-backed business visibility, context, and leadership decisions.",
  path: "/about"
});

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />

      <PublicPageHero
        eyebrow="About Vaeroex"
        title="Vaeroex is an intelligence company built around a simple need: clearer decisions."
        description="Organizations rarely lack information. They lack a connected understanding of what that information means, why it matters, and what leadership should review next."
        actions={
          <>
            <Link href="/operations-intelligence" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              Explore Operations Intelligence
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/contact" className="inline-flex min-h-11 items-center rounded-lg border border-white/15 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-slate-100 hover:border-cyan-300/50 hover:bg-cyan-950/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">Contact Vaeroex</Link>
          </>
        }
      />

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,.78fr)_minmax(0,1.22fr)] lg:items-start">
          <div>
            <Eye className="h-6 w-6 text-cyan-200" aria-hidden="true" />
            <PublicSectionHeading eyebrow="Why Vaeroex exists" title="Important business context is usually divided across systems, files, metrics, and teams." />
          </div>
          <div className="space-y-5 text-base leading-7 text-slate-300">
            <p>That fragmentation makes it difficult to see meaningful change early, connect related evidence, or understand whether one strong result is masking a weaker condition elsewhere.</p>
            <p>Vaeroex was created to help leadership turn those disconnected inputs into evidence-backed visibility, context, and decisions without replacing the systems where operational work already happens.</p>
            <div className="border-l-2 border-cyan-300/40 pl-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Mission</p>
              <p className="mt-2 text-xl font-semibold leading-8 text-white">Help organizations understand sooner, decide with stronger evidence, and act with greater clarity.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Current product</p>
            <h2 className="mt-3 text-3xl font-semibold leading-tight tracking-normal sm:text-4xl">Operations Intelligence is the first major application of Vaeroex.</h2>
            <p className="mt-4 text-base leading-7 text-slate-300">It gives owners, executives, and operations leaders a concise view of business health, performance movement, risk, opportunity, and evidence-backed recommendations.</p>
            <Link href="/operations-intelligence" className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-cyan-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
              See the current product
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-3">
            {[
              ["See", "A connected view of what is happening."],
              ["Understand", "Context for why the condition matters."],
              ["Review", "A supported recommendation for leadership."]
            ].map(([title, body]) => (
              <div key={title} className="bg-[#07111f] p-5">
                <Layers3 className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                <h3 className="mt-4 font-semibold text-white">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,.72fr)_minmax(0,1.28fr)]">
          <div>
            <Compass className="h-6 w-6 text-cyan-200" aria-hidden="true" />
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Founder perspective</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-normal">Built from the gap between having information and understanding it.</h2>
          </div>
          <div className="space-y-4 text-base leading-7 text-slate-300">
            <p>Vaeroex began with a recurring observation: the signals leaders needed often already existed, but they were scattered across reports, systems, and day-to-day operating records.</p>
            <p>The company is focused on building intelligence systems that preserve evidence, make uncertainty visible, and help leadership recognize what matters before it becomes obvious.</p>
            <p className="text-sm font-semibold text-slate-200">Isaac Vizcarra, Founder of Vaeroex</p>
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-10 sm:px-6 sm:py-12">
        <details className="group mx-auto max-w-7xl rounded-lg border border-white/10 bg-white/[0.035] px-5 py-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
            <span>
              <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Long-term direction</span>
              <span className="mt-1 block text-lg font-semibold text-white">Build a responsible intelligence architecture that can support more complex environments over time.</span>
            </span>
            <span className="shrink-0 text-sm font-semibold text-cyan-200 group-open:hidden">Read more</span>
            <span className="hidden shrink-0 text-sm font-semibold text-cyan-200 group-open:block">Close</span>
          </summary>
          <p className="mt-4 max-w-4xl border-t border-white/10 pt-4 text-sm leading-6 text-slate-400">Operations Intelligence is the current product. The broader Vaeroex vision is to apply the same evidence, context, and decision-support discipline to additional environments where timely understanding matters. These are long-term direction areas, not currently available product claims.</p>
        </details>
      </section>

      <PublicCtaBand
        title="The Advantage of Knowing First."
        description="See the current Operations Intelligence product, or start a conversation about how Vaeroex can support a clearer leadership review."
        primaryHref="/operations-intelligence"
        primaryLabel="Explore the product"
      />
      <PublicFooter />
    </main>
  );
}
