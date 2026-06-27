import { createTaskAction } from "@/app/app/operations/actions";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type TasksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const taskStatuses = ["To Do", "In Progress", "Waiting", "Done"];
const priorities = ["Low", "Medium", "High", "Urgent"];
const taskEditFields: ManagedRecordEditField[] = [
  { name: "title", label: "Signal title", required: true },
  { name: "description", label: "Evidence or context", type: "textarea", rows: 4 },
  { name: "status", label: "Status", type: "select", options: taskStatuses },
  { name: "priority", label: "Priority", type: "select", options: priorities },
  { name: "category", label: "Category" }
];

function sourceLabel(task: { ai_generated?: boolean | null; related_type?: string | null }) {
  if (task.ai_generated) return "Vaeroex signal";
  return task.related_type || "Manual source";
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: tasks, error }, folderResult] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "tasks")
  ]);

  const openTasks = (tasks || []).filter((task) => task.status !== "Done");
  const doneTasks = (tasks || []).filter((task) => task.status === "Done");
  const managedTasks = (tasks || []).map((task) => {
    const management = managedValues(task);
    const source = sourceLabel(task);

    return {
      id: task.id,
      title: task.title,
      type: task.ai_generated ? "Vaeroex signal" : "Source signal",
      status: task.status,
      owner: source,
      category: task.category || "General",
      createdAt: task.created_at,
      updatedAt: management.updatedAt || task.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(task.description, "No description."),
      meta: [
        { label: "Priority", value: task.priority },
        { label: "Source", value: source },
        { label: "Status", value: task.status }
      ],
      editFields: taskEditFields,
      editValues: {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        category: task.category
      },
      children: (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{task.description || "No description."}</p>
          <p className="rounded-lg border border-line bg-white p-3 text-sm leading-6 text-muted">
            Vaeroex treats this as source context for intelligence. Use your existing operating system if this signal requires execution tracking.
          </p>
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Source Context"
        title="Source Signals"
        description="Review source-system signals that help Vaeroex understand patterns, risks, and evidence. Execution stays in the systems your business already uses."
      />

      <ErrorNotice message={(params?.error as string | undefined) || error?.message || folderResult.error?.message} />

      <section className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto pb-1">
        {[
          { label: "Open", value: openTasks.length },
          { label: "Reviewed", value: doneTasks.length },
          { label: "Urgent or high", value: (tasks || []).filter((task) => ["Urgent", "High"].includes(task.priority)).length }
        ].map((item) => (
          <span key={item.label} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            {item.label}
            <span className="text-ink">{item.value}</span>
          </span>
        ))}
      </section>

      <section className="space-y-6">
        <CreateDrawer title="Add source signal" description="Capture evidence Vaeroex should consider. Do not use this as a task-management system." triggerLabel="New Signal">
          <form action={createTaskAction} className="grid gap-4 lg:grid-cols-2">
            <TextInput label="Signal title" name="title" required />
            <TextArea label="Evidence or context" name="description" rows={4} />
            <SelectInput label="Status" name="status" defaultValue="To Do" options={taskStatuses} />
            <SelectInput label="Priority" name="priority" defaultValue="Medium" options={priorities} />
            <TextInput label="Category" name="category" placeholder="Customer, risk, operations, financial, process" />
            <div className="lg:col-span-2">
              <PrimaryButton>Add source signal</PrimaryButton>
            </div>
          </form>
        </CreateDrawer>

        <ManagedRecordList
          collection="tasks"
          records={managedTasks}
          folders={folderResult.folders}
          title="Source signals"
          description="Search, group, edit, archive, duplicate, or bulk-manage evidence Vaeroex can analyze."
          emptyTitle="No source signals yet"
          emptyDescription="Add source context only when it helps Vaeroex understand the business. Use your existing systems for execution."
          searchParams={params}
        />

      </section>
    </div>
  );
}
