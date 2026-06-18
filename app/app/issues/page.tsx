import { convertIssueToTaskAction, createIssueAction } from "@/app/app/operations/actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type IssuesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const issueSeverities = ["Low", "Medium", "High", "Urgent"];
const issueStatuses = ["Open", "Investigating", "Waiting", "Closed"];
const issueEditFields: ManagedRecordEditField[] = [
  { name: "title", label: "Issue title", required: true },
  { name: "issue_type", label: "Issue type" },
  { name: "description", label: "Description", type: "textarea", rows: 4 },
  { name: "severity", label: "Severity", type: "select", options: issueSeverities },
  { name: "status", label: "Status", type: "select", options: issueStatuses },
  { name: "root_cause", label: "Root cause", type: "textarea", rows: 3 },
  { name: "recommended_fix", label: "Recommended fix", type: "textarea", rows: 3 },
  { name: "due_date", label: "Due date", type: "date" }
];

export default async function IssuesPage({ searchParams }: IssuesPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: issues, error }, folderResult] = await Promise.all([
    supabase
      .from("issues")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "issues")
  ]);
  const managedIssues = (issues || []).map((issue) => {
    const management = managedValues(issue);

    return {
      id: issue.id,
      title: issue.title,
      type: issue.issue_type || "Issue",
      status: issue.status,
      owner: issue.assigned_to ? "Assigned" : "Unassigned",
      category: issue.severity,
      createdAt: issue.created_at,
      updatedAt: management.updatedAt || issue.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(issue.description, "No description."),
      meta: [
        { label: "Severity", value: issue.severity },
        { label: "Due date", value: issue.due_date || "Not set" },
        { label: "Root cause", value: issue.root_cause || "Not documented" },
        { label: "Recommended fix", value: issue.recommended_fix || "Not documented" }
      ],
      editFields: issueEditFields,
      editValues: {
        title: issue.title,
        issue_type: issue.issue_type,
        description: issue.description,
        severity: issue.severity,
        status: issue.status,
        root_cause: issue.root_cause,
        recommended_fix: issue.recommended_fix,
        due_date: issue.due_date
      },
      children: (
        <div className="space-y-3 text-sm leading-6 text-muted">
          <p>{issue.description || "No description."}</p>
          <p>
            <span className="font-semibold text-ink">Root cause:</span> {issue.root_cause || "Not documented."}
          </p>
          <p>
            <span className="font-semibold text-ink">Recommended fix:</span> {issue.recommended_fix || "Not documented."}
          </p>
          <form action={convertIssueToTaskAction} className="pt-2">
            <input type="hidden" name="issue_id" value={issue.id} />
            <ConfirmSubmitButton message="Create a task to resolve this issue?">Create resolution task</ConfirmSubmitButton>
          </form>
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Issues"
        title="Bottlenecks and breakdowns"
        description="Log recurring problems, identify root causes, capture recommended fixes, and convert confirmed issues into accountable tasks."
      />

      <ErrorNotice message={(params?.error as string | undefined) || error?.message || folderResult.error?.message} />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <SectionCard title="Issue log" description="Open operational risks and improvement opportunities.">
          <ManagedRecordList
            collection="issues"
            records={managedIssues}
            folders={folderResult.folders}
            title="Issue records"
            description="Keep risks organized by folder, severity, status, owner, or due date."
            emptyTitle="No issues logged"
            emptyDescription="Add a bottleneck, missed handoff, equipment problem, quality concern, or follow-up gap."
            searchParams={params}
          />
        </SectionCard>

        <SectionCard title="Log issue" description="Capture enough detail for a manager to choose the next action.">
          <form action={createIssueAction} className="space-y-4">
            <TextInput label="Issue title" name="title" required />
            <TextInput label="Issue type" name="issue_type" placeholder="Process, customer, safety, equipment" />
            <TextArea label="Description" name="description" rows={4} />
            <SelectInput label="Severity" name="severity" defaultValue="Medium" options={issueSeverities} />
            <SelectInput label="Status" name="status" defaultValue="Open" options={issueStatuses} />
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
