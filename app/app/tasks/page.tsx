import { createBusinessSignalAction } from "@/app/app/operations/actions";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type TasksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type BusinessSignalRow = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  category: string | null;
  due_date: string | null;
  related_type: string | null;
  related_id: string | null;
  ai_generated: boolean;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  deleted_at?: string | null;
  folder_id?: string | null;
};

const businessSignalCategories = [
  "Leadership",
  "Customer",
  "Market",
  "Product",
  "Pricing",
  "Vendor",
  "Operations",
  "Financial",
  "Regulatory",
  "Seasonal",
  "Facilities",
  "Other"
];
const signalSources = ["Manual", "Uploaded"];
const businessSignalEditFields: ManagedRecordEditField[] = [
  { name: "title", label: "Title", required: true },
  { name: "description", label: "Description", type: "textarea", rows: 4 },
  { name: "category", label: "Category", type: "select", options: businessSignalCategories },
  { name: "due_date", label: "Date", type: "date" },
  { name: "related_type", label: "Source", type: "select", options: signalSources }
];
const examples = [
  "Leadership change",
  "New product launch",
  "Pricing update",
  "Vendor issue",
  "New warehouse",
  "Seasonal demand expected",
  "Major customer lost",
  "Regulation change"
];

function readableDate(value?: string | null) {
  if (!value) return "Not dated";
  return new Date(value).toLocaleDateString();
}

function sourceLabel(signal: { ai_generated?: boolean | null; related_type?: string | null }) {
  if (signal.ai_generated) return "Vaeroex";

  const source = (signal.related_type || "").toLowerCase();
  if (source === "uploaded") return "Uploaded";
  if (source === "form_submission") return "Form submission";
  if (source === "issue") return "Issue record";
  if (source === "vaeroex_run" || source === "vaeroex_recommendation") return "Vaeroex result";

  return "Manual";
}

function editSourceValue(signal: { related_type?: string | null }) {
  return sourceLabel(signal) === "Uploaded" ? "Uploaded" : "Manual";
}

function businessSignalConfidence(signal: BusinessSignalRow) {
  let score = 0;
  const descriptionLength = signal.description?.trim().length || 0;
  const source = sourceLabel(signal);

  if (descriptionLength >= 60) score += 1;
  if (descriptionLength >= 160) score += 1;
  if (signal.category && signal.category !== "General") score += 1;
  if (signal.due_date) score += 1;
  if (source !== "Manual") score += 1;
  if (signal.ai_generated || signal.related_id) score += 1;

  if (score >= 4) return "High" as const;
  if (score >= 2) return "Medium" as const;
  return "Low" as const;
}

function groupSignals(signals: BusinessSignalRow[]) {
  const groups = signals.reduce<Record<string, BusinessSignalRow[]>>((acc, signal) => {
    const category = signal.category || "General";
    acc[category] = acc[category] || [];
    acc[category].push(signal);
    return acc;
  }, {});

  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({
      category,
      items: items.sort((a, b) => (b.due_date || b.created_at).localeCompare(a.due_date || a.created_at))
    }));
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

  const signals = ((tasks || []) as BusinessSignalRow[]).filter((signal) => !signal.deleted_at && !signal.archived_at);
  const groupedSignals = groupSignals(signals);
  const highConfidenceCount = signals.filter((signal) => businessSignalConfidence(signal) === "High").length;
  const uploadedCount = signals.filter((signal) => sourceLabel(signal) === "Uploaded").length;
  const managedSignals = ((tasks || []) as BusinessSignalRow[]).map((signal) => {
    const management = managedValues(signal);
    const source = sourceLabel(signal);
    const confidence = businessSignalConfidence(signal);
    const signalDate = signal.due_date || signal.created_at;

    return {
      id: signal.id,
      title: signal.title,
      type: "Business signal",
      status: confidence,
      owner: source,
      category: signal.category || "General",
      createdAt: signal.created_at,
      updatedAt: signalDate || management.updatedAt || signal.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(signal.description, "No description."),
      meta: [
        { label: "Source", value: source },
        { label: "Date", value: readableDate(signal.due_date || signal.created_at) },
        { label: "Confidence", value: `${confidence} confidence` },
        { label: "Business Memory", value: "Saved" }
      ],
      editFields: businessSignalEditFields,
      editValues: {
        title: signal.title,
        description: signal.description,
        category: signal.category,
        due_date: signal.due_date,
        related_type: editSourceValue(signal)
      },
      children: (
        <div className="space-y-4">
          <p className="text-sm leading-6 text-muted">{signal.description || "No description."}</p>
          <p className="rounded-lg border border-line bg-white p-3 text-sm leading-6 text-muted">
            Business Signals teach Vaeroex about the organization. They provide context for intelligence, confidence,
            forecasts, and executive briefings. They do not create assignments or execution records.
          </p>
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Business Memory"
        title="Business Signals"
        description="Capture meaningful business events, observations, or strategic context that help Vaeroex build long-term understanding of your business."
      />

      <ErrorNotice message={(params?.error as string | undefined) || error?.message || folderResult.error?.message} />

      <section className="grid gap-3 md:grid-cols-3">
        {[
          { label: "Business Signals", value: signals.length },
          { label: "High confidence", value: highConfidenceCount },
          { label: "Uploaded source", value: uploadedCount }
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{item.label}</p>
            <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-cyan-300/20 bg-cyan-950/20 p-4 text-sm leading-6 text-cyan-50">
        <p className="font-semibold text-white">Business Signals teach Vaeroex. They do not create work.</p>
        <p className="mt-2 text-cyan-100/85">
          Add events and observations that may matter later: leadership changes, customer losses, vendor problems,
          product launches, seasonal shifts, pricing changes, facilities updates, or regulatory context.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {examples.map((example) => (
            <span key={example} className="rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100">
              {example}
            </span>
          ))}
        </div>
      </section>

      <CreateDrawer title="Add Business Signal" description="Save context that should become part of Business Memory." triggerLabel="New Business Signal">
        <form action={createBusinessSignalAction} className="grid gap-4 lg:grid-cols-2">
          <TextInput label="Title" name="title" required placeholder="Example: Major customer lost" />
          <SelectInput label="Category" name="category" defaultValue="Operations" options={businessSignalCategories} />
          <TextInput label="Date (optional)" name="signal_date" type="date" />
          <SelectInput label="Source" name="source" defaultValue="Manual" options={signalSources} />
          <div className="lg:col-span-2">
            <TextArea
              label="Description"
              name="description"
              rows={5}
              placeholder="Describe what happened, why it may matter, and any context leadership should remember."
            />
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-3 text-sm text-slate-100 lg:col-span-2">
            <input name="save_to_memory" type="checkbox" defaultChecked className="mt-1 h-4 w-4 rounded border-white/20 bg-slate-950 text-vaeroex-blue" />
            <span>
              <span className="block font-semibold">Save to Business Memory</span>
              <span className="mt-1 block text-slate-400">
                This signal will help Vaeroex interpret future intelligence, confidence, forecasts, and executive briefings.
              </span>
            </span>
          </label>
          <div className="lg:col-span-2">
            <PrimaryButton>Save Business Signal</PrimaryButton>
          </div>
        </form>
      </CreateDrawer>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100">Saved Business Signals</h2>
          <p className="mt-1 text-sm text-slate-400">Grouped by category and signal date so leadership context stays easy to scan.</p>
        </div>

        {groupedSignals.length ? (
          <div className="space-y-4">
            {groupedSignals.map((group) => (
              <section key={group.category} className="rounded-lg border border-white/10 bg-[#08111f] p-4 shadow-panel">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-white">{group.category}</h3>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-300">
                    {group.items.length} signal{group.items.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-3 grid gap-3">
                  {group.items.map((signal) => {
                    const confidence = businessSignalConfidence(signal);

                    return (
                      <article key={signal.id} className="rounded-lg border border-white/10 bg-slate-950/45 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <p className="text-sm font-semibold text-white">{signal.title}</p>
                            <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-400">{signal.description || "No description provided."}</p>
                          </div>
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <StatusBadge value={confidence} />
                            <StatusBadge value={sourceLabel(signal)} />
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-slate-500">{readableDate(signal.due_date || signal.created_at)} · Saved to Business Memory</p>
                      </article>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-[#08111f] p-6 text-sm text-slate-400">
            No Business Signals yet. Add meaningful context when something happens that Vaeroex should remember.
          </div>
        )}
      </section>

      <details className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
        <summary className="cursor-pointer text-sm font-semibold text-slate-100">Organize Business Signals</summary>
        <div className="mt-4">
          <ManagedRecordList
            collection="tasks"
            records={managedSignals}
            folders={folderResult.folders}
            title="Business Signals"
            description="Search, group, edit, archive, duplicate, or organize business context Vaeroex can use for intelligence."
            emptyTitle="No Business Signals yet"
            emptyDescription="Add meaningful context only when it helps Vaeroex understand the business. Business Signals teach Vaeroex; they do not create work."
            searchParams={params}
            labels={{
              status: "Confidence",
              owner: "Source",
              category: "Category",
              date: "Signal date"
            }}
          />
        </div>
      </details>
    </div>
  );
}
