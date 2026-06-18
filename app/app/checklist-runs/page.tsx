import Link from "next/link";
import { runChecklistAction } from "@/app/app/operations/actions";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea } from "@/components/operations/FormControls";
import { JsonPreview } from "@/components/operations/JsonPreview";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type ChecklistRunsPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export default async function ChecklistRunsPage({ searchParams }: ChecklistRunsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: checklists, error: checklistsError }, { data: runs, error: runsError }] = await Promise.all([
    supabase
      .from("checklists")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true }),
    supabase
      .from("checklist_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
  ]);
  const checklistNameById = new Map((checklists || []).map((checklist) => [checklist.id, checklist.name]));

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

      <ErrorNotice message={params?.error || checklistsError?.message || runsError?.message} />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <SectionCard title="Runs" description="All checklist run records for this workspace.">
          {runs?.length ? (
            <div className="space-y-4">
              {runs.map((run) => (
                <article key={run.id} className="rounded-lg border border-line p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <p className="font-semibold">{checklistNameById.get(run.checklist_id) || "Checklist"}</p>
                      <p className="mt-1 text-xs text-muted">
                        Created {new Date(run.created_at).toLocaleString()} · Completed{" "}
                        {run.completed_at ? new Date(run.completed_at).toLocaleString() : "not set"}
                      </p>
                    </div>
                    <StatusBadge value={run.status} />
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted">{run.notes || "No notes."}</p>
                  <div className="mt-4">
                    <JsonPreview value={run.responses_json} />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No checklist runs yet" description="Run a checklist to create completion history and manager visibility." />
          )}
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
              <SelectInput label="Status" name="status" defaultValue="Complete" options={["Open", "In progress", "Complete", "Needs review"]} />
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
