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
      {message ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{message}</div> : null}
      <div className="mt-4">
        <ErrorNotice message={error} />
      </div>
      <form action={createSupportRequestAction} className="mt-6 grid gap-4 md:grid-cols-2">
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
          <button className="rounded-lg bg-vaeroex-blue px-5 py-3 text-sm font-semibold text-white">{submitLabel}</button>
        </div>
      </form>
    </div>
  );
}
