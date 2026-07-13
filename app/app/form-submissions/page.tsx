import Link from "next/link";
import { convertSubmissionToTaskAction, createFormSubmissionAction } from "@/app/app/operations/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { ReadableData } from "@/components/operations/ReadableData";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type FormSubmissionsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const priorityOptions = ["Low", "Medium", "High", "Urgent"];
const submissionEditFields: ManagedRecordEditField[] = [
  { name: "submitter_name", label: "Submitter name" },
  { name: "submitter_email", label: "Submitter email" },
  { name: "ai_detected_priority", label: "Priority", type: "select", options: priorityOptions },
  { name: "ai_summary", label: "Summary", type: "textarea", rows: 5 }
];

export default async function FormSubmissionsPage({ searchParams }: FormSubmissionsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: forms, error: formsError }, { data: submissions, error: submissionsError }, folderResult] = await Promise.all([
    supabase
      .from("forms")
      .select("*")
      .eq("workspace_id", workspaceId)
      .is("archived_at", null)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
    supabase
      .from("form_submissions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "form_submissions")
  ]);
  const formNameById = new Map((forms || []).map((form) => [form.id, form.name]));
  const activeFormIds = new Set((forms || []).map((form) => form.id));
  const managedSubmissions = (submissions || []).filter((submission) => activeFormIds.has(submission.form_id)).map((submission) => {
    const management = managedValues(submission);
    const formName = formNameById.get(submission.form_id) || "Form";

    return {
      id: submission.id,
      title: submission.submitter_name || "Unnamed submitter",
      type: formName,
      status: submission.ai_detected_priority || "Medium",
      owner: submission.submitter_email || "No email",
      category: formName,
      createdAt: submission.created_at,
      updatedAt: management.updatedAt || submission.created_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(submission.ai_summary, "No Vaeroex summary draft yet."),
      meta: [
        { label: "Form", value: formName },
        { label: "Submitter email", value: submission.submitter_email || "No email" }
      ],
      editFields: submissionEditFields,
      editValues: {
        submitter_name: submission.submitter_name,
        submitter_email: submission.submitter_email,
        ai_detected_priority: submission.ai_detected_priority,
        ai_summary: submission.ai_summary
      },
      children: (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{submission.ai_summary || "No Vaeroex summary draft yet."}</p>
          <ReadableData value={submission.data_json} empty="No submission details saved." />
          <form action={convertSubmissionToTaskAction}>
            <input type="hidden" name="return_path" value="/app/form-submissions" />
            <input type="hidden" name="form_id" value={submission.form_id} />
            <input type="hidden" name="submission_id" value={submission.id} />
            <ConfirmSubmitButton message="Create a Business Signal from this submission?">Create Business Signal</ConfirmSubmitButton>
          </form>
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Form submissions"
        title="Submission inbox"
        description="Review business submissions across every form, inspect Vaeroex summary drafts, and capture Business Signals when the evidence should inform intelligence."
        actions={
          <Link href="/app/forms" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            Manage forms
          </Link>
        }
      />

      <ErrorNotice message={(params?.error as string | undefined) || formsError?.message || submissionsError?.message || folderResult.error?.message} />

      <section className="space-y-6">
        <CreateDrawer title="Add submission" description="Record an internal submission for an existing form." triggerLabel="New Submission">
          {forms?.length ? (
            <form action={createFormSubmissionAction} className="grid gap-4 lg:grid-cols-2">
              <input type="hidden" name="return_path" value="/app/form-submissions" />
              <label className="block text-sm font-medium">
                Form
                <select
                  name="form_id"
                  required
                  className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
                >
                  {forms.map((form) => (
                    <option key={form.id} value={form.id}>
                      {form.name}
                    </option>
                  ))}
                </select>
              </label>
              <TextInput label="Submitter name" name="submitter_name" required />
              <TextInput label="Submitter email" name="submitter_email" type="email" />
              <SelectInput label="Priority" name="priority" defaultValue="Medium" options={priorityOptions} />
              <div className="lg:col-span-2">
                <TextArea label="Submission summary" name="summary" required rows={4} />
              </div>
              <div className="lg:col-span-2">
                <TextArea label="Follow-up items, one per line" name="follow_up" rows={4} />
              </div>
              <div className="lg:col-span-2">
                <PrimaryButton>Save submission</PrimaryButton>
              </div>
            </form>
          ) : (
            <EmptyState
              title="Create a form first"
              description="Submissions need a target form."
              action={
                <Link href="/app/forms" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
                  Create form
                </Link>
              }
            />
          )}
        </CreateDrawer>

        <ManagedRecordList
          collection="form_submissions"
          records={managedSubmissions}
          folders={folderResult.folders}
          title="Submission records"
          description="Submissions stay compact until leadership needs details or source evidence."
          emptyTitle="No submissions yet"
          emptyDescription="Capture a submission from a form detail page or add one here after creating a form."
          returnPath="/app/form-submissions"
          searchParams={params}
        />

      </section>
    </div>
  );
}
