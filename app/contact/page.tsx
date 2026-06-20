import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicRequestForm } from "@/components/legal/PublicRequestForm";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";

type ContactPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function ContactPage({ searchParams }: ContactPageProps) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-12 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Contact Vaeroex</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Talk with Vaeroex about your intelligence platform needs.</h1>
          <p className="mt-4 text-sm leading-6 text-muted">
            Send questions about the Operations Intelligence Suite, pricing, subscriptions, setup, trust, partnerships, or whether Vaeroex is a fit for your business.
          </p>
          <p className="mt-3 text-sm font-semibold text-vaeroex-blue">Visibility • Accountability • Execution</p>
          <div className="mt-6 rounded-lg border border-line bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-vaeroex-blue">Looking for a product walkthrough?</p>
            <p className="mt-2 text-sm leading-6 text-muted">Use the demo request page if you want a guided preview.</p>
            <Link href="/demo" className="mt-4 inline-flex rounded-lg border border-line px-4 py-2 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
              Book a Demo
            </Link>
          </div>
        </div>
        <PublicRequestForm
          returnPath="/contact"
          issueType="Contact request"
          message={params?.message}
          error={params?.error}
          submitLabel="Send contact request"
        />
      </section>
      <PublicFooter />
    </main>
  );
}
