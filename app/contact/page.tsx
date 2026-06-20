import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicRequestForm } from "@/components/legal/PublicRequestForm";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

const inquiryCategories = [
  "General Question",
  "Product Demo",
  "Platform Questions",
  "Partnership Opportunities",
  "Business Inquiry",
  "Support Request",
  "Billing or Subscription"
];

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
          <ScrollReveal delayMs={120} className="vaeroex-hover-card mt-6 rounded-lg border border-line bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-vaeroex-blue">Looking for a product walkthrough?</p>
            <p className="mt-2 text-sm leading-6 text-muted">Use the demo request page if you want a guided Vaeroex preview.</p>
            <Link href="/demo" className="mt-4 inline-flex rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
              Book a Demo
            </Link>
          </ScrollReveal>
        </div>
        <ScrollReveal delayMs={140}>
          <PublicRequestForm
            returnPath="/contact"
            issueType="General Question"
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
