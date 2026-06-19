import Link from "next/link";
import { runChecklistAction } from "@/app/app/operations/actions";
import { AssignmentPanel, AssignmentTargetFields, type TeamPersonOption } from "@/components/accountability/AccountabilityForms";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { ReadableData } from "@/components/operations/ReadableData";
import { SectionCard } from "@/components/operations/SectionCard";
import { getRecordFolders, jsonLines, managedValues, shortPreview } from "@/lib/records/management";
import { PRIORITIES } from "@/lib/team/options";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type ChecklistRunsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const runStatuses = ["Open", "In progress", "Complete", "Needs review"];
const runEditFields: ManagedRecordEditField[] = [
  { name: "status", label: "Status", type: "select", options: runStatuses },
  { name: "completed_at", label: "Completed date", type: "date" },
  { name: "due_date", label: "Due date", type: "date" },
  { name: "priority", label: "Priority", type: "select", options: PRIORITIES },
  { name: "assigned_role", label: "Assigned role" },
  { name: "assigned_department", label: "Assigned department" },
  { name: "notes", label: "Notes", type: "textarea", rows: 4 },
  { name: "responses_json", label: "Responses or completed items, one per line", type: "lines", rows: 6 }
];

export default async function ChecklistRunsPage({ searchParams }: ChecklistRunsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: checklists, error: checklistsError }, { data: runs, error: runsError }, folderResult, peopleResult] = await Promise.all([
    supabase
      .from("checklists")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
    supabase
      .from("checklist_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "checklist_runs"),
    supabase.from("people").select("id,full_name,role_title,department").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name")
  ]);
  const people = (peopleResult.data || []) as TeamPersonOption[];
  const checklistNameById = new Map((checklists || []).map((checklist) => [checklist.id, checklist.name]));
  const peopleById = new Map(people.map((person) => [person.id, person.full_name]));
  const managedRuns = (runs || []).map((run) => {
    const management = managedValues(run);
    const checklistName = checklistNameById.get(run.checklist_id) || "Checklist";
    const owner =
      (run.assigned_person_id && peopleById.get(run.assigned_person_id)) ||
      run.assigned_role ||
      run.assigned_department ||
      (run.assigned_to ? "Assigned user" : "Unassigned");

    return {
      id: run.id,
      title: checklistName,
      type: "Checklist run",
      status: run.status,
      owner,
      category: run.completed_at ? "Completed" : "Open",
      createdAt: run.created_at,
      updatedAt: management.updatedAt || run.created_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(run.notes, "No notes."),
      meta: [
        { label: "Completed", value: run.completed_at ? new Date(run.completed_at).toLocaleDateString() : "Not completed" },
        { label: "Checklist", value: checklistName },
        { label: "Assigned to", value: owner },
        { label: "Due date", value: run.due_date || "Not set" },
        { label: "Priority", value: run.priority || "Medium" }
      ],
      editFields: runEditFields,
      editValues: {
        status: run.status,
        completed_at: run.completed_at?.slice(0, 10) || "",
        due_date: run.due_date,
        priority: run.priority,
        assigned_role: run.assigned_role,
        assigned_department: run.assigned_department,
        notes: run.notes,
        responses_json: jsonLines(run.responses_json)
      },
      children: (
        <div className="space-y-4">
          <ReadableData value={run.responses_json} empty="No responses saved." />
          <AssignmentPanel
            sourceType="checklist_run"
            sourceId={run.id}
            sourceTitle={checklistName}
            relatedModule="Checklist Runs"
            defaultTitle={`Follow up: ${checklistName}`}
            defaultRole={run.assigned_role || "Manager"}
            returnPath="/app/checklist-runs"
            actionHref="/app/checklist-runs"
            people={people}
          />
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Checklist runs"
        title="Run history"
        description="Review completed and in-progress checklist runs, responses, notes, and readiness exceptions across the active workspace."
        actions={
          <Link href="/app/checklists" className="rounded-lg border border-line bg-white px-4 py-2 text-sm font-semibold">
            Manage checklists
          </Link>
        }
      />

      <ErrorNotice message={(params?.error as string | undefined) || checklistsError?.message || runsError?.message || folderResult.error?.message || peopleResult.error?.message} />

      <section className="space-y-6">
        <CreateDrawer title="Record run" description="Save a run against an existing checklist." triggerLabel="New Run">
          {checklists?.length ? (
            <form action={runChecklistAction} className="grid gap-4 lg:grid-cols-2">
              <input type="hidden" name="return_path" value="/app/checklist-runs" />
              <label className="block text-sm font-medium">
                Checklist
                <select
                  name="checklist_id"
                  required
                  className="mt-2 w-full rounded-lg border border-line px-3 py-2 outline-none focus:border-vaeroex-blue"
                >
                  {checklists.map((checklist) => (
                    <option key={checklist.id} value={checklist.id}>
                      {checklist.name}
                    </option>
                  ))}
                </select>
              </label>
              <SelectInput label="Status" name="status" defaultValue="Complete" options={runStatuses} />
              <AssignmentTargetFields people={people} defaultRole="Manager" />
              <TextInput label="Due date" name="due_date" type="date" />
              <SelectInput label="Priority" name="priority" defaultValue="Medium" options={PRIORITIES} />
              <div className="lg:col-span-2">
                <TextArea label="Responses or completed items, one per line" name="responses" rows={5} />
              </div>
              <div className="lg:col-span-2">
                <TextArea label="Notes" name="notes" rows={4} />
              </div>
              <div className="lg:col-span-2">
                <PrimaryButton>Save run</PrimaryButton>
              </div>
            </form>
          ) : (
            <EmptyState
              title="Create a checklist first"
              description="Runs need a checklist template."
              action={
                <Link href="/app/checklists" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
                  Create checklist
                </Link>
              }
            />
          )}
        </CreateDrawer>

        <SectionCard title="Runs" description="All checklist run records for this workspace.">
          <ManagedRecordList
            collection="checklist_runs"
            records={managedRuns}
            folders={folderResult.folders}
            title="Checklist run records"
            description="Review completion history without expanding every response by default."
            emptyTitle="No checklist runs yet"
            emptyDescription="Run a checklist to create completion history and manager visibility."
            returnPath="/app/checklist-runs"
            searchParams={params}
          />
        </SectionCard>

      </section>
    </div>
  );
}
