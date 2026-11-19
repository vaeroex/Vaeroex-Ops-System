import Link from "next/link";
import type { Metadata } from "next";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicPageHero } from "@/components/marketing/PublicPagePrimitives";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Research Partnerships | Vaeroex",
  description: "Discuss a research partnership with Vaeroex around assay evidence, protein structures, or compound review.",
  path: "/networking",
});

export default function NetworkingPage() {
  return (
    <main className="vaeroex-public-site min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="Research partnerships"
        title="What evidence informs your next experiment?"
        description="Vaeroex welcomes research teams studying how assay measurements, experimental structures, and model predictions inform compound selection. Tell us which question your team is working on."
        actions={<Link className="vx-button vx-button--primary" href="/contact?inquiry=research-partnership">Discuss a research partnership</Link>}
      />
      <section className="border-t border-white/10 px-5 py-12 sm:px-6">
        <div className="mx-auto max-w-7xl">
          <h2 className="text-2xl font-semibold">Get in touch by email</h2>
          <p className="mt-3 max-w-2xl text-slate-300">Include your organization and the part of the research workflow you would like to explore together.</p>
          <a className="vx-text-link mt-3" href={VAEROEX_MAILTO_LINKS.partners}>{VAEROEX_CONTACT_EMAILS.partners}</a>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
