import Link from "next/link";
import { convertSubmissionToTaskAction, createFormSubmissionAction } from "@/app/app/operations/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { JsonPreview } from "@/components/operations/JsonPreview";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type FormSubmissionsPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export default async function FormSubmissionsPage({ searchParams }: FormSubmissionsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: forms, error: formsError }, { data: submissions, error: submissionsError }] = await Promise.all([
    supabase
      .from("forms")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
    supabase
      .from("form_submissions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
  ]);
  const formNameById = new Map((forms || []).map((form) => [form.id, form.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Form submissions"
        title="Submission inbox"
        description="Review operational submissions across every form, inspect Vaeroex summary drafts, and create follow-up tasks when a manager confirms the next action."
        actions={
          <Link href="/app/forms" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            Manage forms
          </Link>
        }
      />

      <ErrorNotice message={params?.error || formsError?.message || submissionsError?.message} />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <SectionCard title="All submissions" description="Recent submissions from the active workspace.">
          {submissions?.length ? (
            <div className="space-y-4">
              {submissions.map((submission) => (
                <article key={submission.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold">{submission.submitter_name || "Unnamed submitter"}</p>
                      <p className="mt-1 text-xs text-muted">
                        {formNameById.get(submission.form_id) || "Form"} · {submission.submitter_email || "No email"} ·{" "}
                        {new Date(submission.created_at).toLocaleString()}
                      </p>
                    </div>
                    <StatusBadge value={submission.ai_detected_priority || "Medium"} />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted">{submission.ai_summary || "No Vaeroex summary draft yet."}</p>
                  <div className="mt-4">
                    <JsonPreview value={submission.data_json} />
                  </div>
                  <form action={convertSubmissionToTaskAction} className="mt-4">
                    <input type="hidden" name="return_path" value="/app/form-submissions" />
                    <input type="hidden" name="form_id" value={submission.form_id} />
                    <input type="hidden" name="submission_id" value={submission.id} />
                    <ConfirmSubmitButton message="Create a follow-up task from this submission?">
                      Create follow-up task
                    </ConfirmSubmitButton>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No submissions yet" description="Capture a submission from a form detail page or add one here after creating a form." />
          )}
        </SectionCard>

        <SectionCard title="Add submission" description="Record an internal submission for an existing form.">
          {forms?.length ? (
            <form action={createFormSubmissionAction} className="space-y-4">
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
              <TextArea label="Submission summary" name="summary" required rows={4} />
              <SelectInput label="Priority" name="priority" defaultValue="Medium" options={["Low", "Medium", "High", "Urgent"]} />
              <TextArea label="Follow-up items, one per line" name="follow_up" rows={4} />
              <PrimaryButton>Save submission</PrimaryButton>
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
        </SectionCard>
      </section>
    </div>
  );
}
