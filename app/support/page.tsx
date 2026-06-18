import Link from "next/link";
import { createSupportRequestAction } from "@/app/support/actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";

type SupportPageProps = {
  searchParams?: Promise<{ error?: string; message?: string }>;
};

export default async function PublicSupportPage({ searchParams }: SupportPageProps) {
  const params = await searchParams;

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-ink">
      <section className="mx-auto max-w-3xl rounded-lg border border-line bg-white p-7 shadow-panel">
        <Link href="/" className="text-sm font-semibold text-vaeroex-blue">Vaeroex Ops System</Link>
        <h1 className="mt-4 text-3xl font-semibold">Contact Vaeroex support</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Send workspace access, billing, setup, or operations questions to Vaeroex for review.
        </p>
        {params?.message ? <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{params.message}</div> : null}
        <div className="mt-5">
          <ErrorNotice message={params?.error} />
        </div>
        <form action={createSupportRequestAction} className="mt-6 grid gap-4 md:grid-cols-2">
          <input type="hidden" name="return_path" value="/support" />
          <TextInput label="Name" name="name" required />
          <TextInput label="Email" name="email" type="email" required />
          <TextInput label="Workspace" name="workspace" placeholder="Workspace name or ID" />
          <SelectInput label="Issue type" name="issue_type" required options={["Subscription access", "Workspace setup", "Vaeroex result", "Bug or error", "Billing question", "Other"]} />
          <SelectInput label="Priority" name="priority" required defaultValue="Medium" options={["Low", "Medium", "High", "Urgent"]} />
          <label className="block text-sm font-medium">
            Screenshot/file placeholder
            <input disabled placeholder="File upload will be added later" className="mt-2 w-full rounded-lg border border-dashed border-line bg-slate-100 px-3 py-2 text-muted" />
          </label>
          <div className="md:col-span-2">
            <TextArea label="Message" name="message" required rows={6} />
          </div>
          <div className="md:col-span-2">
            <button className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">Send support request</button>
          </div>
        </form>
      </section>
    </main>
  );
}
