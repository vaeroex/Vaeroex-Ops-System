import Link from "next/link";
import { notFound } from "next/navigation";
import { convertSubmissionToTaskAction, createFormSubmissionAction } from "@/app/app/operations/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { EmptyState } from "@/components/operations/EmptyState";
import { TextArea, TextInput, SelectInput, PrimaryButton } from "@/components/operations/FormControls";
import { JsonPreview } from "@/components/operations/JsonPreview";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type FormDetailPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string }>;
};

export default async function FormDetailPage({ params, searchParams }: FormDetailPageProps) {
  const { id } = await params;
  const query = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: form }, { data: submissions, error }] = await Promise.all([
    supabase.from("forms").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle(),
    supabase
      .from("form_submissions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("form_id", id)
      .order("created_at", { ascending: false })
  ]);

  if (!form) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Form detail"
        title={form.name}
        description={form.description || "Review schema, capture submissions, and create follow-up tasks."}
        actions={
          <Link href="/app/forms" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            Back to forms
          </Link>
        }
      />

      {query?.error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{query.error}</div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error.message}</div> : null}

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <SectionCard title="Submissions" description="Vaeroex summaries are drafts until a manager confirms the follow-up.">
          {submissions?.length ? (
            <div className="space-y-4">
              {submissions.map((submission) => (
                <article key={submission.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold">{submission.submitter_name || "Unnamed submitter"}</p>
                      <p className="text-xs text-muted">{submission.submitter_email || "No email"} · {new Date(submission.created_at).toLocaleString()}</p>
                    </div>
                    <StatusBadge value={submission.ai_detected_priority || "Medium"} />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted">{submission.ai_summary || "No summary generated yet."}</p>
                  <div className="mt-4">
                    <JsonPreview value={submission.data_json} />
                  </div>
                  <form action={convertSubmissionToTaskAction} className="mt-4">
                    <input type="hidden" name="form_id" value={form.id} />
                    <input type="hidden" name="submission_id" value={submission.id} />
                    <ConfirmSubmitButton message="Create a follow-up task from this submission?">
                      Create follow-up task
                    </ConfirmSubmitButton>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No submissions yet" description="Submit a test response or share the public link when enabled." />
          )}
        </SectionCard>

        <div className="space-y-6">
          <SectionCard title="Submit form" description="Capture an operational submission for manager review.">
            <form action={createFormSubmissionAction} className="space-y-4">
              <input type="hidden" name="form_id" value={form.id} />
              <TextInput label="Submitter name" name="submitter_name" required />
              <TextInput label="Submitter email" name="submitter_email" type="email" />
              <TextArea label="Submission summary" name="summary" required rows={4} />
              <SelectInput label="Priority" name="priority" defaultValue="Medium" options={["Low", "Medium", "High", "Urgent"]} />
              <TextArea label="Follow-up items, one per line" name="follow_up" rows={4} />
              <PrimaryButton>Save submission</PrimaryButton>
            </form>
          </SectionCard>
          <SectionCard title="Form schema">
            <JsonPreview value={form.schema_json} />
          </SectionCard>
        </div>
      </section>
    </div>
  );
}
