import { createChecklistAction, runChecklistAction } from "@/app/app/operations/actions";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { JsonPreview } from "@/components/operations/JsonPreview";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type ChecklistsPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export default async function ChecklistsPage({ searchParams }: ChecklistsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: checklists, error: checklistsError }, { data: runs, error: runsError }] = await Promise.all([
    supabase
      .from("checklists")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    supabase
      .from("checklist_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(12)
  ]);
  const checklistNameById = new Map((checklists || []).map((checklist) => [checklist.id, checklist.name]));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Checklists"
        title="Readiness and recurring work"
        description="Create repeatable checklists, run them from the active workspace, and keep completion history visible for managers."
      />

      <ErrorNotice message={params?.error || checklistsError?.message || runsError?.message} />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <SectionCard title="Checklist library" description="Templates for recurring operational routines.">
            {checklists?.length ? (
              <div className="space-y-4">
                {checklists.map((checklist) => (
                  <article key={checklist.id} className="rounded-lg border border-line p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <p className="font-semibold">{checklist.name}</p>
                        <p className="mt-1 text-sm leading-6 text-muted">{checklist.description || "No description yet."}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <StatusBadge value={checklist.frequency || "As needed"} />
                        <StatusBadge value={checklist.assigned_role || "Unassigned"} />
                      </div>
                    </div>
                    <div className="mt-4">
                      <JsonPreview value={checklist.items_json} />
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="No checklists yet" description="Create a recurring readiness, opening, closing, inspection, or manager review checklist." />
            )}
          </SectionCard>

          <SectionCard title="Checklist runs" description="Recent completions and in-progress runs.">
            {runs?.length ? (
              <div className="overflow-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="py-2">Checklist</th>
                      <th>Status</th>
                      <th>Completed</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {runs.map((run) => (
                      <tr key={run.id}>
                        <td className="py-3 font-semibold">{checklistNameById.get(run.checklist_id) || "Checklist"}</td>
                        <td>
                          <StatusBadge value={run.status} />
                        </td>
                        <td className="text-muted">{run.completed_at ? new Date(run.completed_at).toLocaleString() : "Not completed"}</td>
                        <td className="text-muted">{run.notes || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No checklist runs" description="Run a checklist to start building completion history for this workspace." />
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Create checklist" description="Add items one per line.">
            <form action={createChecklistAction} className="space-y-4">
              <TextInput label="Checklist name" name="name" required />
              <TextInput label="Category" name="category" placeholder="Opening, safety, quality, manager review" />
              <SelectInput label="Frequency" name="frequency" options={["Daily", "Weekly", "Monthly", "Per job", "As needed"]} />
              <TextInput label="Assigned role" name="assigned_role" placeholder="Manager, technician, shift lead" />
              <TextArea label="Description" name="description" />
              <TextArea label="Checklist items, one per line" name="items" rows={6} />
              <PrimaryButton>Create checklist</PrimaryButton>
            </form>
          </SectionCard>

          <SectionCard title="Run checklist" description="Record a quick run against an existing checklist.">
            {checklists?.length ? (
              <form action={runChecklistAction} className="space-y-4">
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
                <SelectInput label="Status" name="status" defaultValue="Complete" options={["Open", "In progress", "Complete", "Needs review"]} />
                <TextArea label="Responses or completed items, one per line" name="responses" rows={4} />
                <TextArea label="Notes" name="notes" rows={3} />
                <PrimaryButton>Save run</PrimaryButton>
              </form>
            ) : (
              <EmptyState title="Create a checklist first" description="Checklist runs need a checklist template." />
            )}
          </SectionCard>
        </div>
      </section>
    </div>
  );
}
