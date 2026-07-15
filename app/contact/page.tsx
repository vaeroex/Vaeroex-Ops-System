import type { Metadata } from "next";
import { Clock3, Mail, MapPin } from "lucide-react";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicRequestForm } from "@/components/legal/PublicRequestForm";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { PublicPageHero } from "@/components/marketing/PublicPagePrimitives";
import { VAEROEX_COMPANY_ADDRESS_LINES, VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";
import { publicPageMetadata } from "@/lib/seo/public-seo";

export const metadata: Metadata = publicPageMetadata({
  title: "Contact Vaeroex Intelligence Systems",
  description: "Contact Vaeroex Intelligence Systems about Operations Intelligence, product questions, support, billing, or strategic relationships.",
  path: "/contact"
});

const inquiryCategories = ["Product Demo", "Platform Questions", "Strategic Partnership", "Support Request", "Billing or Subscription", "General Inquiry"];

const contactChannels = [
  ["Product and general questions", VAEROEX_CONTACT_EMAILS.general, VAEROEX_MAILTO_LINKS.general],
  ["Customer support", VAEROEX_CONTACT_EMAILS.support, VAEROEX_MAILTO_LINKS.support],
  ["Billing", VAEROEX_CONTACT_EMAILS.billing, VAEROEX_MAILTO_LINKS.billing],
  ["Partnerships", VAEROEX_CONTACT_EMAILS.partners, VAEROEX_MAILTO_LINKS.partners]
] as const;

type ContactPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-[#030712] text-white">
      <PublicSiteHeader />
      <PublicPageHero
        eyebrow="Vaeroex Intelligence Systems"
        title="Tell us what you want to understand."
        description="Use the form for Operations Intelligence questions, a product walkthrough, support, billing, or a strategic conversation. Your request goes to the appropriate Vaeroex contact."
      />

      <section className="border-b border-white/10 bg-[#050b18] px-5 py-12 sm:px-6 sm:py-14">
        <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[minmax(0,.72fr)_minmax(30rem,1.28fr)] lg:items-start">
          <div>
            <div className="divide-y divide-white/10 border-y border-white/10">
              <div className="flex gap-3 py-4">
                <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
                <div>
                  <h2 className="font-semibold text-white">What happens next</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">Vaeroex reviews the category and message, then responds through the contact information you provide. Urgent account matters should use Customer Support.</p>
                </div>
              </div>
              <div className="flex gap-3 py-4">
                <Mail className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
                <div className="min-w-0">
                  <h2 className="font-semibold text-white">Direct email</h2>
                  <div className="mt-2 grid gap-2">
                    {contactChannels.map(([label, email, href]) => (
                      <a key={email} href={href} className="group block rounded-md py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">
                        <span className="block text-xs text-slate-500">{label}</span>
                        <span className="mt-0.5 block break-all text-sm font-semibold text-slate-200 group-hover:text-cyan-200">{email}</span>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex gap-3 py-4">
                <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
                <div>
                  <h2 className="font-semibold text-white">Business address</h2>
                  <address className="mt-2 not-italic text-sm leading-6 text-slate-400">
                    {VAEROEX_COMPANY_ADDRESS_LINES.map((line) => <span key={line} className="block">{line}</span>)}
                  </address>
                </div>
              </div>
            </div>
            <p className="mt-5 text-xs leading-5 text-slate-500">Do not submit patient data, Social Security numbers, payment card numbers, government IDs, or regulated sensitive information through this form.</p>
          </div>

          <PublicRequestForm
            returnPath="/contact"
            issueType="General Inquiry"
            issueOptions={inquiryCategories}
            message={params?.message}
            error={params?.error}
            submitLabel="Send contact request"
          />
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}
