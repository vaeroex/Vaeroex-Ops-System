import type { Route } from "next";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { TextArea, TextInput, PrimaryButton } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { ReadableData } from "@/components/operations/ReadableData";
import { SectionCard } from "@/components/operations/SectionCard";
import { createFormAction } from "@/app/app/operations/actions";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type FormsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const formEditFields: ManagedRecordEditField[] = [
  { name: "name", label: "Form name", required: true },
  { name: "form_type", label: "Form type" },
  { name: "description", label: "Description", type: "textarea", rows: 4 }
];

export default async function FormsPage({ searchParams }: FormsPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: forms, error }, folderResult] = await Promise.all([
    supabase
      .from("forms")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "forms")
  ]);
  const managedForms = (forms || []).map((form) => {
    const management = managedValues(form);

    return {
      id: form.id,
      title: form.name,
      type: form.form_type || "Operations form",
      status: form.is_public ? "Public" : "Private",
      owner: form.created_by ? "Workspace" : "Unassigned",
      category: form.form_type || "operations",
      createdAt: form.created_at,
      updatedAt: management.updatedAt || form.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(form.description, "No description yet."),
      href: `/app/forms/${form.id}` as Route,
      meta: [
        { label: "Public slug", value: form.public_slug || "Not public" },
        { label: "Field count", value: Array.isArray(form.schema_json) ? form.schema_json.length : 0 }
      ],
      editFields: formEditFields,
      editValues: {
        name: form.name,
        form_type: form.form_type,
        description: form.description
      },
      children: <ReadableData value={form.schema_json} empty="No fields saved." />
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Forms"
        title="Operations forms"
        description="Create intake, job completion, issue, shift handoff, and follow-up forms. Submissions can become follow-up tasks after manager review."
      />

      <ErrorNotice message={(params?.error as string | undefined) || error?.message || folderResult.error?.message} />

      <section className="space-y-6">
        <CreateDrawer title="Create form" description="Start simple. You can refine fields later." triggerLabel="New Form">
          <form action={createFormAction} className="grid gap-4 lg:grid-cols-2">
            <TextInput label="Form name" name="name" required />
            <TextInput label="Form type" name="form_type" placeholder="intake, completion, issue, follow-up" />
            <div className="lg:col-span-2">
              <TextArea label="Description" name="description" />
            </div>
            <div className="lg:col-span-2">
              <TextArea
                label="Fields, one per line"
                name="fields"
                placeholder={"Submitted by\nOperational details\nPriority\nFollow-up date"}
                rows={5}
              />
            </div>
            <label className="flex items-center gap-2 text-sm font-medium lg:col-span-2">
              <input type="checkbox" name="is_public" className="h-4 w-4" />
              Enable public form link
            </label>
            <div className="lg:col-span-2">
              <PrimaryButton>Create form</PrimaryButton>
            </div>
          </form>
        </CreateDrawer>

        <SectionCard title="Form library" description="Tenant-safe forms for the active workspace.">
          <ManagedRecordList
            collection="forms"
            records={managedForms}
            folders={folderResult.folders}
            title="Form records"
            description="Forms stay collapsed until you need to inspect fields or open the detail page."
            emptyTitle="No forms yet"
            emptyDescription="Create your first form to collect operational data and follow-up needs."
            searchParams={params}
          />
        </SectionCard>

      </section>
    </div>
  );
}
