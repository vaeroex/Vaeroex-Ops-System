import Link from "next/link";
import { createSupportRequestAction } from "@/app/support/actions";
import { PublicFooter } from "@/components/legal/PublicFooter";
import { PublicSiteHeader } from "@/components/legal/PublicSiteHeader";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { VAEROEX_CONTACT_EMAILS, VAEROEX_MAILTO_LINKS } from "@/lib/contact/emails";

type SupportPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function PublicSupportPage({ searchParams }: SupportPageProps) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-slate-50 text-ink">
      <PublicSiteHeader />
      <section className="mx-auto max-w-3xl px-6 py-10">
      <div className="rounded-lg border border-line bg-white p-7 shadow-panel">
        <Link href="/" className="text-sm font-semibold text-vaeroex-blue">Vaeroex</Link>
        <h1 className="mt-4 text-3xl font-semibold">Contact Vaeroex support</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Send account, billing, setup, or intelligence-result questions for review.
        </p>
        <div className="mt-4 grid gap-2 rounded-lg border border-line bg-slate-50 p-4 text-sm leading-6 text-muted">
          <p>
            Support questions can also be sent to{" "}
            <a href={VAEROEX_MAILTO_LINKS.support} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
              {VAEROEX_CONTACT_EMAILS.support}
            </a>
            .
          </p>
          <p>
            Billing, subscription, or payment questions can be sent to{" "}
            <a href={VAEROEX_MAILTO_LINKS.billing} className="font-semibold text-vaeroex-blue hover:text-vaeroex-accent">
              {VAEROEX_CONTACT_EMAILS.billing}
            </a>
            .
          </p>
        </div>
        {params?.message ? <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{params.message}</div> : null}
        <div className="mt-5">
          <ErrorNotice message={params?.error} />
        </div>
        <form action={createSupportRequestAction} className="mt-6 grid gap-4 md:grid-cols-2">
          <input type="hidden" name="return_path" value="/support" />
          <TextInput label="Name" name="name" required />
          <TextInput label="Email" name="email" type="email" required />
          <TextInput label="Workspace" name="workspace" placeholder="Workspace name or ID" />
          <TextInput label="Page/module" name="page_module" placeholder="Overview, Evidence, Saved Analyses, Billing..." />
          <SelectInput label="Issue type" name="issue_type" required options={["Subscription access", "Workspace setup", "Intelligence result", "Bug or error", "Billing question", "Other"]} />
          <SelectInput label="Priority" name="priority" required defaultValue="Medium" options={["Low", "Medium", "High", "Urgent"]} />
          <div className="md:col-span-2">
            <TextArea label="Message" name="message" required rows={6} />
            <p className="mt-2 text-xs leading-5 text-muted">
              Do not include patient data, Social Security numbers, payment card numbers, government IDs, or regulated sensitive data. Screenshots can be sent by email if Vaeroex support requests them.
            </p>
          </div>
          <div className="md:col-span-2">
            <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Send support request</button>
          </div>
        </form>
      </div>
      </section>
      <PublicFooter />
    </main>
  );
}
