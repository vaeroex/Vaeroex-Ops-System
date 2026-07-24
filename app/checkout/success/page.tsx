import Link from "next/link";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

type CheckoutSuccessPageProps = {
  searchParams?: Promise<{ session_id?: string }>;
};

export default async function CheckoutSuccessPage({ searchParams }: CheckoutSuccessPageProps) {
  const params = await searchParams;
  const hasSession = Boolean(params?.session_id);

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />

      <section className="mx-auto grid max-w-4xl gap-6 px-6 py-16">
        <div className="rounded-lg border border-line bg-white p-8 shadow-command">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Checkout</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">Subscription started</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
            Your Executive Intelligence subscription has been received. Create your Vaeroex account with the same email address used at checkout so Vaeroex can match your subscription access.
          </p>

          {!hasSession ? (
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              If you reached this page without completing checkout, start from Pricing or contact Vaeroex billing support.
            </div>
          ) : null}

          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/signup" className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white hover:bg-vaeroex-accent hover:text-vaeroex-navy">
              Create Vaeroex Account
            </Link>
            <Link href="/login" className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-semibold hover:border-vaeroex-blue hover:text-vaeroex-blue">
              I already have an account
            </Link>
          </div>

          <p className="mt-6 text-sm leading-6 text-muted">
            Billing questions can be sent to{" "}
            <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
              {VAEROEX_CONTACT_EMAILS.billing}
            </a>
            .
          </p>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
