import Link from "next/link";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

type BillingRequiredPageProps = {
  searchParams?: Promise<{ reason?: string; error?: string; message?: string }>;
};

export default async function BillingRequiredPage({ searchParams }: BillingRequiredPageProps) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-ink">
      <section className="mx-auto max-w-3xl rounded-lg border border-line bg-white p-7 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-wide text-vaeroex-blue">Subscription required</p>
        <h1 className="mt-2 text-3xl font-semibold">Your Vaeroex subscription is required to access this workspace.</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {params?.reason || "Use the same email you used for your Vaeroex subscription, or request manual activation if access does not unlock automatically."}
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="https://vaeroex.com/pricing" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            View Vaeroex subscription
          </Link>
          <a href="#already-purchased" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            I already purchased
          </a>
          <a href="#already-purchased" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            Request Manual Activation
          </a>
          <a href={VAEROEX_MAILTO_LINKS.billing} className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            Email Billing
          </a>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted">
          Billing, subscription, or payment questions can be sent to{" "}
          <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
            {VAEROEX_CONTACT_EMAILS.billing}
          </a>
          .
        </p>
      </section>

      <section id="already-purchased" className="mx-auto mt-6 max-w-3xl rounded-lg border border-line bg-white p-7 shadow-panel">
        <h2 className="text-xl font-semibold">Request manual activation</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Submit the email and purchase details from your Vaeroex subscription. Vaeroex will verify access and unlock the workspace when confirmed.
        </p>
        {params?.message ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{params.message}</div> : null}
        <div className="mt-4">
          <ErrorNotice message={params?.error} />
        </div>
        <form action="/api/subscription/request-activation" method="post" className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="block text-sm font-medium">
            Name
            <input required name="name" className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue" />
          </label>
          <label className="block text-sm font-medium">
            Email used for Vaeroex subscription
            <input required name="email" type="email" className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue" />
          </label>
          <label className="block text-sm font-medium">
            Company
            <input name="company" className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue" />
          </label>
          <label className="block text-sm font-medium">
            Subscription purchased
            <input name="plan_purchased" defaultValue="Vaeroex" className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue" />
          </label>
          <label className="block text-sm font-medium md:col-span-2">
            Order number if available
            <input name="order_number" className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue" />
          </label>
          <label className="block text-sm font-medium md:col-span-2">
            Message
            <textarea name="message" rows={4} className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue" />
          </label>
          <div className="md:col-span-2">
            <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
              Request Manual Activation
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
