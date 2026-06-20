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
        <TextInput label="Role" name="role" placeholder="Owner, Director, Manager..." />
        <TextInput label="Business type" name="business_type" placeholder="Retail, restaurant, service, construction..." />
        <SelectInput label="Team size" name="team_size" required options={["1-2", "3-10", "11-25", "26-50", "51+"]} />
        <SelectInput label="Preferred contact method" name="preferred_contact_method" required options={["Email", "Phone", "Text", "Video call"]} />
        <TextInput label="Workspace" name="workspace" placeholder="Optional if you already have one" />
        <div className="md:col-span-2">
          <TextArea label="What are you looking to improve or explore with Vaeroex?" name="improvement_goal" required rows={4} />
        </div>
        <div className="md:col-span-2">
          <TextArea label="Message" name="message" required rows={5} />
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
