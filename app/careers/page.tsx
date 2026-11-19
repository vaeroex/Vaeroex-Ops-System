import type { Metadata } from "next";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicPageHero } from "@/components/marketing/PublicPagePrimitives";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Careers at Vaeroex",
  description: "Current hiring status and a contact for future opportunities at Vaeroex.",
  path: "/careers",
});

export default function CareersPage() {
  return (
    <main className="vaeroex-public-site min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="Careers at Vaeroex"
        title="There are no open positions at this time."
        description="If you work in scientific software, research, or product design, you can share your interest in future opportunities. Include a brief introduction and an example of your work."
        actions={<a className="vx-text-link" href={VAEROEX_MAILTO_LINKS.careers}>{VAEROEX_CONTACT_EMAILS.careers}</a>}
      />
      <PublicFooter />
    </main>
  );
}
