import { createSupportRequestAction } from "@/app/support/actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";

type PublicRequestFormProps = {
  returnPath: "/contact" | "/demo";
  issueType: string;
  issueOptions?: string[];
  message?: string;
  error?: string;
  submitLabel: string;
};

export function PublicRequestForm({ returnPath, issueType, issueOptions, message, error, submitLabel }: PublicRequestFormProps) {
  const showInquiryType = Boolean(issueOptions?.length);

  return (
    <div className="rounded-lg border border-line bg-white p-6 shadow-panel">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-blue">Contact form</p>
      <h2 className="mt-2 text-2xl font-semibold text-ink">Send a message to Vaeroex.</h2>
      <p className="mt-2 text-sm leading-6 text-muted">Choose the request type and provide enough context for the right team to respond.</p>
      {message ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="mt-4"><ErrorNotice message={error} /></div> : null}
      <form action={createSupportRequestAction} className="mt-5 grid gap-4 md:grid-cols-2">
        <input type="hidden" name="return_path" value={returnPath} />
        {showInquiryType ? (
          <SelectInput label="Inquiry type" name="issue_type" required defaultValue={issueType} options={issueOptions || []} />
        ) : (
          <input type="hidden" name="issue_type" value={issueType} />
        )}
        <input type="hidden" name="page_module" value={issueType} />
        <TextInput label="Name" name="name" required />
        <TextInput label="Email" name="email" type="email" required />
        <TextInput label="Company" name="company" required />
        <div className="md:col-span-2">
          <TextArea label="How can Vaeroex help?" name="message" required rows={4} />
          <p className="mt-2 text-xs leading-5 text-muted">
            Do not include patient data, Social Security numbers, payment card numbers, government IDs, or regulated sensitive data.
          </p>
        </div>
        <div className="md:col-span-2">
          <button className="min-h-11 rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60">{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}
