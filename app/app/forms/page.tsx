import Link from "next/link";
import { EmptyState } from "@/components/operations/EmptyState";
import { TextArea, TextInput, PrimaryButton } from "@/components/operations/FormControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { createFormAction } from "@/app/app/operations/actions";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type FormsPageProps = {
  searchParams?: Promise<{ error?: string }>;
};

export default async function FormsPage({ searchParams }: FormsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const { data: forms, error } = await supabase
    .from("forms")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Forms"
        title="Operations forms"
        description="Create intake, job completion, issue, shift handoff, and follow-up forms. Submissions can become follow-up tasks after manager review."
      />

      {params?.error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{params.error}</div> : null}
      {error ? <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error.message}</div> : null}

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <SectionCard title="Form library" description="Tenant-safe forms for the active workspace.">
          {forms?.length ? (
            <div className="overflow-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="py-2">Name</th>
                    <th>Type</th>
                    <th>Public</th>
                    <th>Slug</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {forms.map((form) => (
                    <tr key={form.id}>
                      <td className="py-3">
                        <p className="font-semibold">{form.name}</p>
                        <p className="text-xs text-muted">{form.description || "No description yet."}</p>
                      </td>
                      <td>{form.form_type || "operations"}</td>
                      <td>
                        <StatusBadge value={form.is_public ? "Public" : "Private"} />
                      </td>
                      <td className="text-xs text-muted">{form.public_slug || "-"}</td>
                      <td className="text-right">
                        <Link href={`/app/forms/${form.id}`} className="text-sm font-semibold text-vaeroex-blue">
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No forms yet" description="Create your first form to collect operational data and follow-up needs." />
          )}
        </SectionCard>

        <SectionCard title="Create form" description="Start simple. You can refine fields later.">
          <form action={createFormAction} className="space-y-4">
            <TextInput label="Form name" name="name" required />
            <TextInput label="Form type" name="form_type" placeholder="intake, completion, issue, follow-up" />
            <TextArea label="Description" name="description" />
            <TextArea
              label="Fields, one per line"
              name="fields"
              placeholder={"Submitted by\nOperational details\nPriority\nFollow-up date"}
              rows={5}
            />
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="is_public" className="h-4 w-4" />
              Enable public form link
            </label>
            <PrimaryButton>Create form</PrimaryButton>
          </form>
        </SectionCard>
      </section>
    </div>
  );
}
