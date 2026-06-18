import { createPersonAction } from "@/app/app/operations/actions";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { EmptyState } from "@/components/operations/EmptyState";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type PeoplePageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export default async function PeoplePage({ searchParams }: PeoplePageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const { data: people, error } = await supabase
    .from("people")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("full_name", { ascending: true });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People"
        title="People"
        description="Track team roles, departments, status, contact details, and onboarding notes for operational accountability."
      />

      <ErrorNotice message={params?.error || error?.message} />

      <section className="space-y-6">
        <CreateDrawer title="Add person" description="This directory is separate from workspace login permissions." triggerLabel="New Person">
          <form action={createPersonAction} className="grid gap-4 lg:grid-cols-2">
            <TextInput label="Full name" name="full_name" required />
            <TextInput label="Email" name="email" type="email" />
            <TextInput label="Phone" name="phone" />
            <TextInput label="Role title" name="role_title" />
            <TextInput label="Department" name="department" />
            <SelectInput label="Status" name="status" defaultValue="active" options={["active", "onboarding", "inactive"]} />
            <TextInput label="Start date" name="start_date" type="date" />
            <div className="lg:col-span-2">
              <TextArea label="Notes" name="notes" rows={4} />
            </div>
            <div className="lg:col-span-2">
              <PrimaryButton>Add person</PrimaryButton>
            </div>
          </form>
        </CreateDrawer>

        <SectionCard title="People directory" description="Operational contacts for the current workspace.">
          {people?.length ? (
            <div>
              <table className="w-full table-fixed text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="w-[42%] py-2 sm:w-[30%]">Name</th>
                    <th className="hidden sm:table-cell">Role</th>
                    <th className="hidden md:table-cell">Department</th>
                    <th className="hidden lg:table-cell">Email</th>
                    <th className="hidden xl:table-cell">Phone</th>
                    <th className="w-[32%] sm:w-auto">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {people.map((person) => (
                    <tr key={person.id}>
                      <td className="min-w-0 py-3 pr-3">
                        <p className="truncate font-semibold">{person.full_name}</p>
                        <p className="text-xs text-muted">Started {person.start_date || "not set"}</p>
                      </td>
                      <td className="hidden truncate pr-3 sm:table-cell">{person.role_title || "-"}</td>
                      <td className="hidden truncate pr-3 md:table-cell">{person.department || "-"}</td>
                      <td className="hidden truncate pr-3 lg:table-cell">{person.email || "-"}</td>
                      <td className="hidden truncate pr-3 xl:table-cell">{person.phone || "-"}</td>
                      <td>
                        <StatusBadge value={person.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No people yet" description="Add team members, contractors, managers, or operational contacts." />
          )}
        </SectionCard>

      </section>
    </div>
  );
}
