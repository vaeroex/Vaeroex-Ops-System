import { createTaskAction } from "@/app/app/operations/actions";
import { AssignmentPanel, AssignmentTargetFields, type TeamPersonOption } from "@/components/accountability/AccountabilityForms";
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
  { name: "title", label: "Follow-up title", required: true },
  { name: "description", label: "Description", type: "textarea", rows: 4 },
  { name: "status", label: "Status", type: "select", options: taskStatuses },
  { name: "priority", label: "Priority", type: "select", options: priorities },
  { name: "category", label: "Category" },
  { name: "assigned_role", label: "Assigned role" },
  { name: "assigned_department", label: "Assigned department" },
  { name: "due_date", label: "Due date", type: "date" }
];

function ownerLabel(task: { assigned_person_id?: string | null; assigned_role?: string | null; assigned_department?: string | null; assigned_to?: string | null }, peopleById: Map<string, string>) {
  if (task.assigned_person_id) return peopleById.get(task.assigned_person_id) || "Assigned person";
  if (task.assigned_role) return task.assigned_role;
  if (task.assigned_department) return task.assigned_department;
  if (task.assigned_to) return "App user";
  return "Unassigned";
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [{ data: tasks, error }, folderResult, peopleResult] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
    getRecordFolders(supabase, workspaceId, "tasks"),
    supabase.from("people").select("id,full_name,role_title,department").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name")
  ]);

  const people = (peopleResult.data || []) as TeamPersonOption[];
  const peopleById = new Map(people.map((person) => [person.id, person.full_name]));
  const openTasks = (tasks || []).filter((task) => task.status !== "Done");
  const doneTasks = (tasks || []).filter((task) => task.status === "Done");
  const managedTasks = (tasks || []).map((task) => {
    const management = managedValues(task);
    const owner = ownerLabel(task, peopleById);

    return {
      id: task.id,
      title: task.title,
      type: task.ai_generated ? "Vaeroex follow-up" : "Follow-up",
      status: task.status,
      owner,
      category: task.category || "General",
      createdAt: task.created_at,
      updatedAt: management.updatedAt || task.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(task.description, "No description."),
      meta: [
        { label: "Assigned to", value: owner },
        { label: "Role", value: task.assigned_role || "Not set" },
        { label: "Department", value: task.assigned_department || "Not set" },
        { label: "Priority", value: task.priority },
        { label: "Due date", value: task.due_date || "Not set" },
        { label: "Source", value: task.ai_generated ? "Drafted by Vaeroex" : task.related_type || "Manual" }
      ],
      editFields: taskEditFields,
      editValues: {
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        category: task.category,
        assigned_role: task.assigned_role,
        assigned_department: task.assigned_department,
        due_date: task.due_date
      },
      children: (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{task.description || "No description."}</p>
          <AssignmentPanel
            sourceType="task"
            sourceId={task.id}
            sourceTitle={task.title}
            relatedModule="Tasks"
            returnPath="/app/tasks"
            actionHref="/app/tasks"
            people={people}
            defaultTitle={task.title}
            defaultDescription={task.description || ""}
            defaultRole={task.assigned_role || "Manager"}
          />
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Execution"
        title="Follow-up Ownership"
        description="Track accountable follow-ups from manual entry, form submissions, issue logs, setup plans, and Vaeroex-reviewed decision support."
      />

      <ErrorNotice message={(params?.error as string | undefined) || error?.message || folderResult.error?.message || peopleResult.error?.message} />

      <section className="vaeroex-mobile-safe-scroll flex gap-2 overflow-x-auto pb-1">
        {[
          { label: "Open", value: openTasks.length },
          { label: "Done", value: doneTasks.length },
          { label: "Urgent or high", value: (tasks || []).filter((task) => ["Urgent", "High"].includes(task.priority)).length }
        ].map((item) => (
          <span key={item.label} className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-semibold text-slate-700">
            {item.label}
            <span className="text-ink">{item.value}</span>
          </span>
        ))}
      </section>

      <section className="space-y-6">
        <CreateDrawer title="Create follow-up" description="Use follow-ups for the next concrete action, not long notes." triggerLabel="New Follow-up">
          <form action={createTaskAction} className="grid gap-4 lg:grid-cols-2">
            <TextInput label="Follow-up title" name="title" required />
            <TextArea label="Description" name="description" rows={4} />
            <SelectInput label="Status" name="status" defaultValue="To Do" options={taskStatuses} />
            <SelectInput label="Priority" name="priority" defaultValue="Medium" options={priorities} />
            <TextInput label="Category" name="category" placeholder="Follow-up, safety, onboarding, customer" />
            <TextInput label="Due date" name="due_date" type="date" />
            <div className="lg:col-span-2">
              <p className="mb-2 text-sm font-medium">Assignment</p>
              <AssignmentTargetFields people={people} defaultRole="Manager" />
            </div>
            <div className="lg:col-span-2">
              <PrimaryButton>Create follow-up</PrimaryButton>
            </div>
          </form>
        </CreateDrawer>

        <ManagedRecordList
          collection="tasks"
          records={managedTasks}
          folders={folderResult.folders}
          title="Execution records"
          description="Search, group, edit, archive, duplicate, or bulk-manage follow-up work."
          emptyTitle="No follow-ups yet"
          emptyDescription="Create a follow-up manually or convert a submission or issue into accountable work."
          searchParams={params}
        />

      </section>
    </div>
  );
}
