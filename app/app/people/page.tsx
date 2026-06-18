import { createPersonAction } from "@/app/app/operations/actions";
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
        title="Team visibility"
        description="Track team roles, departments, status, contact details, and onboarding notes for operational accountability."
      />

      <ErrorNotice message={params?.error || error?.message} />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <SectionCard title="People directory" description="Operational contacts for the current workspace.">
          {people?.length ? (
            <div className="overflow-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-2">Name</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {people.map((person) => (
                    <tr key={person.id}>
                      <td className="py-3">
                        <p className="font-semibold">{person.full_name}</p>
                        <p className="text-xs text-muted">Started {person.start_date || "not set"}</p>
                      </td>
                      <td>{person.role_title || "-"}</td>
                      <td>{person.department || "-"}</td>
                      <td>{person.email || "-"}</td>
                      <td>{person.phone || "-"}</td>
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

        <SectionCard title="Add person" description="This directory is separate from workspace login permissions.">
          <form action={createPersonAction} className="space-y-4">
            <TextInput label="Full name" name="full_name" required />
            <TextInput label="Email" name="email" type="email" />
            <TextInput label="Phone" name="phone" />
            <TextInput label="Role title" name="role_title" />
            <TextInput label="Department" name="department" />
            <SelectInput label="Status" name="status" defaultValue="active" options={["active", "onboarding", "inactive"]} />
            <TextInput label="Start date" name="start_date" type="date" />
            <TextArea label="Notes" name="notes" rows={4} />
            <PrimaryButton>Add person</PrimaryButton>
          </form>
        </SectionCard>
      </section>
    </div>
  );
}
