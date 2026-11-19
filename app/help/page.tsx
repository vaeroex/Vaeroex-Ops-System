import Link from "next/link";
import type { Metadata } from "next";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicPageHero } from "@/components/marketing/PublicPagePrimitives";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { publicPageMetadata, utilityRobots } from "@/lib/seo/public-seo";

export const metadata: Metadata = {
  ...publicPageMetadata({
    title: "Customer Help | Vaeroex",
    description: "Contact Vaeroex for help with an account, a workspace, or a billing question.",
    path: "/help",
  }),
  robots: utilityRobots,
};

export default function PublicHelpPage() {
  return (
    <main className="vaeroex-public-site min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="Customer help"
        title="How can we help?"
        description="For help accessing an account or using your workspace, send the support team a description of what happened."
        actions={<Link href="/support" className="vx-button vx-button--primary">Contact support</Link>}
      />
      <section className="border-t border-white/10 px-5 py-12 sm:px-6">
        <div className="mx-auto grid max-w-7xl gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold">Account and workspace questions</h2>
            <p className="mt-3 text-slate-300">You can also reach support by email.</p>
            <a className="vx-text-link mt-3" href={VAEROEX_MAILTO_LINKS.support}>{VAEROEX_CONTACT_EMAILS.support}</a>
          </div>
          <div>
            <h2 className="text-2xl font-semibold">Billing questions</h2>
            <p className="mt-3 text-slate-300">Contact billing about an invoice, payment, or renewal.</p>
            <a className="vx-text-link mt-3" href={VAEROEX_MAILTO_LINKS.billing}>{VAEROEX_CONTACT_EMAILS.billing}</a>
          </div>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
