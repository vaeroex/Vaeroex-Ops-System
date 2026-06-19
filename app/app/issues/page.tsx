import { convertIssueToTaskAction, createIssueAction } from "@/app/app/operations/actions";
import { AssignmentPanel, AssignmentTargetFields, type TeamPersonOption } from "@/components/accountability/AccountabilityForms";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
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
  { name: "assigned_role", label: "Assigned role" },
  { name: "assigned_department", label: "Assigned department" },
  { name: "due_date", label: "Due date", type: "date" }
];

function ownerLabel(issue: { assigned_person_id?: string | null; assigned_role?: string | null; assigned_department?: string | null; assigned_to?: string | null }, peopleById: Map<string, string>) {
  if (issue.assigned_person_id) return peopleById.get(issue.assigned_person_id) || "Assigned person";
  if (issue.assigned_role) return issue.assigned_role;
  if (issue.assigned_department) return issue.assigned_department;
  if (issue.assigned_to) return "App user";
  return "Unassigned";
}

export default async function IssuesPage({ searchParams }: IssuesPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: issues, error }, folderResult, peopleResult] = await Promise.all([
    supabase
      .from("issues")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "issues"),
    supabase.from("people").select("id,full_name,role_title,department").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name")
  ]);
  const people = (peopleResult.data || []) as TeamPersonOption[];
  const peopleById = new Map(people.map((person) => [person.id, person.full_name]));
  const managedIssues = (issues || []).map((issue) => {
    const management = managedValues(issue);
    const owner = ownerLabel(issue, peopleById);

    return {
      id: issue.id,
      title: issue.title,
      type: issue.issue_type || "Issue",
      status: issue.status,
      owner,
      category: issue.severity,
      createdAt: issue.created_at,
      updatedAt: management.updatedAt || issue.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(issue.description, "No description."),
      meta: [
        { label: "Assigned to", value: owner },
        { label: "Role", value: issue.assigned_role || "Not set" },
        { label: "Department", value: issue.assigned_department || "Not set" },
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
        assigned_role: issue.assigned_role,
        assigned_department: issue.assigned_department,
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
          <AssignmentPanel
            sourceType="issue"
            sourceId={issue.id}
            sourceTitle={issue.title}
            relatedModule="Issues"
            returnPath="/app/issues"
            actionHref="/app/issues"
            people={people}
            defaultTitle={`Resolve issue: ${issue.title}`}
            defaultDescription={issue.recommended_fix || issue.description || ""}
            defaultRole={issue.assigned_role || "Manager"}
          />
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Issues"
        title="Issues"
        description="Log recurring problems, identify root causes, capture recommended fixes, and convert confirmed issues into accountable tasks."
      />

      <ErrorNotice message={(params?.error as string | undefined) || error?.message || folderResult.error?.message || peopleResult.error?.message} />

      <section className="space-y-6">
        <CreateDrawer title="Log issue" description="Capture enough detail for a manager to choose the next action." triggerLabel="New Issue">
          <form action={createIssueAction} className="grid gap-4 lg:grid-cols-2">
            <TextInput label="Issue title" name="title" required />
            <TextInput label="Issue type" name="issue_type" placeholder="Process, customer, safety, equipment" />
            <TextArea label="Description" name="description" rows={4} />
            <SelectInput label="Severity" name="severity" defaultValue="Medium" options={issueSeverities} />
            <SelectInput label="Status" name="status" defaultValue="Open" options={issueStatuses} />
            <TextArea label="Root cause" name="root_cause" rows={3} />
            <TextArea label="Recommended fix" name="recommended_fix" rows={3} />
            <TextInput label="Due date" name="due_date" type="date" />
            <div className="lg:col-span-2">
              <p className="mb-2 text-sm font-medium">Assignment</p>
              <AssignmentTargetFields people={people} defaultRole="Manager" />
            </div>
            <div className="lg:col-span-2">
              <PrimaryButton>Log issue</PrimaryButton>
            </div>
          </form>
        </CreateDrawer>

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

      </section>
    </div>
  );
}
