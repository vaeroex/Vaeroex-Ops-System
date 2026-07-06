import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicRequestForm } from "@/components/legal/PublicRequestForm";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { VAEROEX_COMPANY_ADDRESS_LINES, VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

const inquiryCategories = [
  "Product Demo",
  "Platform Questions",
  "Network Interest",
  "Strategic Partnership",
  "Advisor Interest",
  "Investor / Strategic Relationship",
  "Implementation Partner",
  "Partnership Opportunities",
  "Business Inquiry",
  "Support Request",
  "Billing or Subscription",
  "General Inquiry"
];

const contactChannels = [
  ["General & demo", VAEROEX_CONTACT_EMAILS.general, VAEROEX_MAILTO_LINKS.general],
  ["Support", VAEROEX_CONTACT_EMAILS.support, VAEROEX_MAILTO_LINKS.support],
  ["Billing", VAEROEX_CONTACT_EMAILS.billing, VAEROEX_MAILTO_LINKS.billing],
  ["Partnerships", VAEROEX_CONTACT_EMAILS.partners, VAEROEX_MAILTO_LINKS.partners]
] as const;

type ContactPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-12 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
        <div className="vaeroex-hero-reveal">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Contact Vaeroex</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Let's start a conversation.</h1>
          <p className="mt-4 text-sm leading-6 text-muted">
            Whether you're exploring Vaeroex, requesting a product demo, interested in partnerships, or have questions about how intelligence,
            visibility, accountability, and execution can support your business, we'd like to hear from you.
          </p>
          <p className="mt-3 text-sm font-semibold text-vaeroex-blue">Visibility • Accountability • Execution</p>
          <ScrollReveal delayMs={120} className="vaeroex-form-intro vaeroex-hover-card mt-6 rounded-lg border border-line bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-vaeroex-blue">Looking for a product walkthrough?</p>
            <p className="mt-2 text-sm leading-6 text-muted">Start with the Operations Intelligence page for the current product capability.</p>
            <Link href="/operations-intelligence" className="mt-4 inline-flex rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
              Explore Operations Intelligence
            </Link>
          </ScrollReveal>
          <ScrollReveal delayMs={180} className="vaeroex-hover-card mt-4 rounded-lg border border-line bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-vaeroex-blue">Prefer direct email?</p>
            <div className="mt-3 grid gap-2 text-sm">
              {contactChannels.map(([label, email, href]) => (
                <a key={email} href={href} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-slate-50 px-3 py-2 font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
                  <span>{label}</span>
                  <span>{email}</span>
                </a>
              ))}
            </div>
          </ScrollReveal>
          <ScrollReveal delayMs={220} className="mt-4 rounded-lg border border-line bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-vaeroex-blue">Company mailing address</p>
            <address className="mt-3 not-italic text-sm leading-6 text-muted">
              {VAEROEX_COMPANY_ADDRESS_LINES.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </address>
          </ScrollReveal>
        </div>
        <ScrollReveal delayMs={140}>
          <PublicRequestForm
            returnPath="/contact"
            issueType="General Inquiry"
            issueOptions={inquiryCategories}
            message={params?.message}
            error={params?.error}
            submitLabel="Send contact request"
          />
        </ScrollReveal>
      </section>
      <PublicFooter />
    </main>
  );
}
