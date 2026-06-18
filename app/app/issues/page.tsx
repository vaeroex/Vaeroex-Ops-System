import { convertIssueToTaskAction, createIssueAction } from "@/app/app/operations/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type IssuesPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export default async function IssuesPage({ searchParams }: IssuesPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const { data: issues, error } = await supabase
    .from("issues")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Issues"
        title="Bottlenecks and breakdowns"
        description="Log recurring problems, identify root causes, capture recommended fixes, and convert confirmed issues into accountable tasks."
      />

      <ErrorNotice message={params?.error || error?.message} />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <SectionCard title="Issue log" description="Open operational risks and improvement opportunities.">
          {issues?.length ? (
            <div className="space-y-4">
              {issues.map((issue) => (
                <article key={issue.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold">{issue.title}</p>
                      <p className="mt-1 text-sm leading-6 text-muted">{issue.description || "No description."}</p>
                      <p className="mt-2 text-xs text-muted">
                        {issue.issue_type || "General"} · Due {issue.due_date || "not set"}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge value={issue.severity} />
                      <StatusBadge value={issue.status} />
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Root cause</p>
                      <p className="mt-2 text-sm leading-6">{issue.root_cause || "Not documented."}</p>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Recommended fix</p>
                      <p className="mt-2 text-sm leading-6">{issue.recommended_fix || "Not documented."}</p>
                    </div>
                  </div>
                  <form action={convertIssueToTaskAction} className="mt-4">
                    <input type="hidden" name="issue_id" value={issue.id} />
                    <ConfirmSubmitButton message="Create a task to resolve this issue?">
                      Create resolution task
                    </ConfirmSubmitButton>
                  </form>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No issues logged" description="Add a bottleneck, missed handoff, equipment problem, quality concern, or follow-up gap." />
          )}
        </SectionCard>

        <SectionCard title="Log issue" description="Capture enough detail for a manager to choose the next action.">
          <form action={createIssueAction} className="space-y-4">
            <TextInput label="Issue title" name="title" required />
            <TextInput label="Issue type" name="issue_type" placeholder="Process, customer, safety, equipment" />
            <TextArea label="Description" name="description" rows={4} />
            <SelectInput label="Severity" name="severity" defaultValue="Medium" options={["Low", "Medium", "High", "Urgent"]} />
            <SelectInput label="Status" name="status" defaultValue="Open" options={["Open", "Investigating", "Waiting", "Closed"]} />
            <TextArea label="Root cause" name="root_cause" rows={3} />
            <TextArea label="Recommended fix" name="recommended_fix" rows={3} />
            <TextInput label="Due date" name="due_date" type="date" />
            <PrimaryButton>Log issue</PrimaryButton>
          </form>
        </SectionCard>
      </section>
    </div>
  );
}
