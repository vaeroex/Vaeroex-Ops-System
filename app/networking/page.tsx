import type { Metadata } from "next";
import { ArrowRight, Handshake, Network, ShieldCheck } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicCtaBand, PublicPageHero, PublicSectionHeading } from "@/components/marketing/PublicPagePrimitives";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Vaeroex Network",
  description: "The Vaeroex Network is a curated professional relationship network for operators, advisors, integration partners, and organizations aligned with Operations Intelligence.",
  path: "/networking"
});

const relationshipTypes = [
  ["Operators and advisors", "Experienced leaders who understand evidence, operating performance, and executive decision rhythms."],
  ["Technology and integration partners", "Organizations that can help connect Vaeroex with the external systems customers already use."],
  ["Implementation relationships", "Qualified professionals who help organizations improve how they review and respond to intelligence."],
  ["Strategic relationships", "Industry experts and aligned organizations interested in the long-term Vaeroex direction."]
] as const;

const process = [
  ["Share your interest", "Describe your background, organization, and the relationship you want to explore."],
  ["Vaeroex reviews fit", "We consider relevance, credibility, customer value, and alignment with the current platform."],
  ["Continue the conversation", "If there is a practical fit, Vaeroex will contact you about a focused next discussion."]
] as const;

export default function NetworkingPage() {
  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="Vaeroex Network"
        title="A curated network for relationships that strengthen Operations Intelligence."
        description="The Vaeroex Network connects credible operators, advisors, technology partners, and strategic organizations around one goal: helping leadership understand business conditions with greater clarity."
        actions={
          <a href={VAEROEX_MAILTO_LINKS.partners} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
            Start a partner conversation
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>
        }
      />

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-7xl">
          <PublicSectionHeading
            eyebrow="Who should reach out"
            title="Focused relationships, not an open directory."
            description="The Network is for people and organizations with a credible way to improve product context, integrations, implementation quality, or customer understanding."
          />
          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 md:grid-cols-2">
            {relationshipTypes.map(([title, body]) => (
              <article key={title} className="bg-[#07111f] p-5">
                <Handshake className="h-5 w-5 text-cyan-200" aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold text-white">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="border-b border-white/10 px-5 py-14 sm:px-6 sm:py-16">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,.74fr)_minmax(0,1.26fr)]">
          <div>
            <Network className="h-6 w-6 text-cyan-200" aria-hidden="true" />
            <h2 className="mt-4 text-3xl font-semibold tracking-normal">What participation means.</h2>
            <p className="mt-4 text-sm leading-6 text-slate-300">A Network conversation is an evaluation of potential fit. It is not automatic membership, an endorsement, a marketplace listing, or a promise of commercial activity.</p>
            <div className="mt-5 flex items-start gap-3 rounded-lg border border-amber-300/20 bg-amber-950/10 p-4">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-100" aria-hidden="true" />
              <p className="text-xs leading-5 text-slate-400">Vaeroex does not guarantee referrals, revenue, contracts, partnership status, investment opportunities, or customer access through the Network.</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">What happens after you inquire</p>
            <ol className="mt-4 divide-y divide-white/10 border-y border-white/10">
              {process.map(([title, body], index) => (
                <li key={title} className="grid gap-2 py-5 sm:grid-cols-[2rem_minmax(0,.34fr)_minmax(0,.66fr)]">
                  <span className="text-xs font-semibold text-cyan-200">0{index + 1}</span>
                  <h3 className="font-semibold text-white">{title}</h3>
                  <p className="text-sm leading-6 text-slate-400">{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <PublicCtaBand
        eyebrow="Partner interest"
        title="Tell Vaeroex where your experience creates practical value."
        description={`Send a concise introduction to ${VAEROEX_CONTACT_EMAILS.partners}. Include your background, organization, and the relationship you want to explore.`}
        primaryHref="/contact"
        primaryLabel="Contact Vaeroex"
        secondaryHref="/operations-intelligence"
        secondaryLabel="Understand the product"
      />
      <PublicFooter />
    </main>
  );
}
