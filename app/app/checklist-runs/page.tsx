import Link from "next/link";
import { runChecklistAction } from "@/app/app/operations/actions";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { ReadableData } from "@/components/operations/ReadableData";
import { SectionCard } from "@/components/operations/SectionCard";
import { getRecordFolders, jsonLines, managedValues, shortPreview } from "@/lib/records/management";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type ChecklistRunsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const runStatuses = ["Open", "In progress", "Complete", "Needs review"];
const runEditFields: ManagedRecordEditField[] = [
  { name: "status", label: "Status", type: "select", options: runStatuses },
  { name: "completed_at", label: "Completed date", type: "date" },
  { name: "notes", label: "Notes", type: "textarea", rows: 4 },
  { name: "responses_json", label: "Responses or completed items, one per line", type: "lines", rows: 6 }
];

export default async function ChecklistRunsPage({ searchParams }: ChecklistRunsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: checklists, error: checklistsError }, { data: runs, error: runsError }, folderResult] = await Promise.all([
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
    getRecordFolders(supabase, workspaceId, "checklist_runs")
  ]);
  const checklistNameById = new Map((checklists || []).map((checklist) => [checklist.id, checklist.name]));
  const managedRuns = (runs || []).map((run) => {
    const management = managedValues(run);
    const checklistName = checklistNameById.get(run.checklist_id) || "Checklist";

    return {
      id: run.id,
      title: checklistName,
      type: "Checklist run",
      status: run.status,
      owner: run.assigned_to ? "Assigned" : "Unassigned",
      category: run.completed_at ? "Completed" : "Open",
      createdAt: run.created_at,
      updatedAt: management.updatedAt || run.created_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(run.notes, "No notes."),
      meta: [
        { label: "Completed", value: run.completed_at ? new Date(run.completed_at).toLocaleDateString() : "Not completed" },
        { label: "Checklist", value: checklistName }
      ],
      editFields: runEditFields,
      editValues: {
        status: run.status,
        completed_at: run.completed_at?.slice(0, 10) || "",
        notes: run.notes,
        responses_json: jsonLines(run.responses_json)
      },
      children: <ReadableData value={run.responses_json} empty="No responses saved." />
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

      <ErrorNotice message={(params?.error as string | undefined) || checklistsError?.message || runsError?.message || folderResult.error?.message} />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
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

        <SectionCard title="Record run" description="Save a run against an existing checklist.">
          {checklists?.length ? (
            <form action={runChecklistAction} className="space-y-4">
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
              <TextArea label="Responses or completed items, one per line" name="responses" rows={5} />
              <TextArea label="Notes" name="notes" rows={4} />
              <PrimaryButton>Save run</PrimaryButton>
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
        </SectionCard>
      </section>
    </div>
  );
}
