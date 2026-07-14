import { createBusinessSignalAction, deleteBusinessSignalAction } from "@/app/app/operations/actions";
import { manageRecordAction, updateManagedRecordAction } from "@/app/app/operations/record-management-actions";
import { ConfirmSubmitButton } from "@/components/operations/ConfirmSubmitButton";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { PageHeader } from "@/components/operations/PageHeader";
import { businessSignalMatchesEvidenceScope, type BusinessSignalEvidenceScope } from "@/lib/intelligence/business-signal-evidence";
import { isOriginalBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { RecordDetailDrawer } from "@/components/operations/RecordDetailDrawer";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type TasksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type BusinessSignalRow = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  priority: string | null;
  category: string | null;
  due_date: string | null;
  related_type: string | null;
  related_id: string | null;
  ai_generated: boolean | null;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
  deleted_at?: string | null;
};

const businessSignalCategories = [
  "Leadership",
  "Customer",
  "Market",
  "Product",
  "Pricing",
  "Vendor",
  "Operations",
  "Finance",
  "Sales",
  "Strategy",
  "Regulatory",
  "Seasonal",
  "Facilities",
  "Other"
];
const signalSources = ["Manual", "Uploaded"];
function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function readableDate(value?: string | null) {
  if (!value) return "No date";
  return new Date(value).toLocaleDateString();
}

function compactDate(value?: string | null) {
  if (!value) return "Undated";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function sourceLabel(signal: { ai_generated?: boolean | null; related_type?: string | null }) {
  if (signal.ai_generated) return "Vaeroex Result";

  const source = (signal.related_type || "").toLowerCase();
  if (source === "uploaded") return "Uploaded File";
  if (source === "form_submission") return "Form Submission";
  if (source === "issue") return "Issue Record";
  if (source === "vaeroex_run" || source === "vaeroex_recommendation") return "Vaeroex Result";

  return "Manual Entry";
}

function editSourceValue(signal: { related_type?: string | null }) {
  return sourceLabel(signal) === "Uploaded File" ? "Uploaded" : "Manual";
}

function businessSignalConfidence(signal: BusinessSignalRow) {
  let score = 0;
  const descriptionLength = signal.description?.trim().length || 0;
  const source = sourceLabel(signal);

  if (descriptionLength >= 60) score += 1;
  if (descriptionLength >= 160) score += 1;
  if (signal.category && signal.category !== "General") score += 1;
  if (signal.due_date) score += 1;
  if (source !== "Manual Entry") score += 1;
  if (signal.ai_generated || signal.related_id) score += 1;

  if (score >= 4) return "High" as const;
  if (score >= 2) return "Medium" as const;
  return "Low" as const;
}

function confidenceExplanation(confidence: "High" | "Medium" | "Low") {
  if (confidence === "High") {
    return "This signal has enough context, category, date, or source evidence for Vaeroex to use it with stronger confidence.";
  }

  if (confidence === "Medium") {
    return "This signal is useful, but Vaeroex may need more detail, history, or source evidence before relying on it heavily.";
  }

  return "This signal is saved, but Vaeroex has limited supporting context. Add details, a date, or a source to improve confidence.";
}

function sourceExplanation(source: string) {
  if (source === "Uploaded File") return "This signal came from uploaded business information or imported file context.";
  if (source === "Vaeroex Result") return "This signal was generated from a Vaeroex insight or recommendation.";
  if (source === "Form Submission") return "This signal came from a submitted form and may reflect real business activity.";
  if (source === "Issue Record") return "This signal came from an issue record and can support risk or process analysis.";
  return "This signal was entered manually as business context.";
}

function usedBy(signal: BusinessSignalRow) {
  const category = (signal.category || "").toLowerCase();
  const items = ["Executive Summary", "Business Health", "Intelligence"];

  if (["finance", "financial", "pricing", "sales", "customer", "market"].some((value) => category.includes(value))) {
    items.push("Revenue Forecast");
  }

  if (signal.due_date || signal.created_at) {
    items.push("Weekly Brief");
  }

  return Array.from(new Set(items));
}

function groupSignals(signals: BusinessSignalRow[]) {
  const groups = signals.reduce<Record<string, BusinessSignalRow[]>>((acc, signal) => {
    const category = signal.category || "Operations";
    acc[category] = acc[category] || [];
    acc[category].push(signal);
    return acc;
  }, {});

  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, items]) => ({
      category,
      latestDate: items
        .map((item) => item.due_date || item.created_at)
        .sort((a, b) => b.localeCompare(a))[0],
      items: items.sort((a, b) => (b.due_date || b.created_at).localeCompare(a.due_date || a.created_at))
    }));
}

function SignalBadge({
  label,
  value,
  explanation
}: {
  label: string;
  value: string;
  explanation: string;
}) {
  return (
    <details className="relative">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center rounded-full border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 hover:border-cyan-300/50 hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40">
        {label}: {value}
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-white/10 bg-[#08111f] p-3 text-xs leading-5 text-slate-300 shadow-2xl shadow-black/30">
        {explanation}
      </div>
    </details>
  );
}

function BusinessSignalEditForm({ signal }: { signal: BusinessSignalRow }) {
  return (
    <form action={updateManagedRecordAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="collection" value="tasks" />
      <input type="hidden" name="record_id" value={signal.id} />
      <input type="hidden" name="return_path" value="/app/tasks" />
      <input type="hidden" name="status" value="Business Signal" />
      <input type="hidden" name="priority" value="Context" />
      <input type="hidden" name="assigned_role" value="" />
      <input type="hidden" name="assigned_department" value="" />
      <TextInput label="Title" name="title" required defaultValue={signal.title} />
      <SelectInput label="Category" name="category" defaultValue={signal.category || "Operations"} options={businessSignalCategories} />
      <TextInput label="Date" name="due_date" type="date" defaultValue={signal.due_date || ""} />
      <SelectInput label="Source" name="related_type" defaultValue={editSourceValue(signal)} options={signalSources} />
      <div className="sm:col-span-2">
        <TextArea label="Description" name="description" rows={5} defaultValue={signal.description || ""} />
      </div>
      <div className="sm:col-span-2">
        <PrimaryButton>Save changes</PrimaryButton>
      </div>
    </form>
  );
}

function BusinessSignalDetails({ signal }: { signal: BusinessSignalRow }) {
  const confidence = businessSignalConfidence(signal);
  const source = sourceLabel(signal);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-white/10 bg-slate-950/50 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">Description</p>
        <p className="mt-2 text-sm leading-6 text-slate-300">{signal.description || "No description saved yet."}</p>
      </section>
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Used By</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {usedBy(signal).map((item) => (
              <span key={item} className="rounded-full border border-white/10 bg-slate-950/60 px-2.5 py-1 text-xs font-semibold text-slate-200">
                {item}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Memory Context</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Vaeroex treats this as business memory for intelligence, confidence, forecasts, and executive briefings.
            It does not create assignments or execution records.
          </p>
        </div>
      </section>
      <section className="grid gap-2 sm:grid-cols-4">
        {[
          ["Date", readableDate(signal.due_date || signal.created_at)],
          ["Category", signal.category || "Operations"],
          ["Confidence", confidence],
          ["Source", source]
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
            <p className="mt-1 text-sm font-semibold text-slate-100">{value}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

const menuItemClass =
  "block min-h-10 w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-slate-100 hover:border-cyan-300/40 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45";

function BusinessSignalActions({ signal, archived = false }: { signal: BusinessSignalRow; archived?: boolean }) {
  return (
    <details className="relative">
      <summary
        className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-md border border-white/10 bg-white/[0.04] text-lg font-semibold text-slate-200 hover:border-cyan-300/40 hover:bg-cyan-950/30 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45"
        aria-label={`Actions for ${signal.title}`}
      >
        ...
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-52 space-y-1 rounded-lg border border-white/10 bg-[#08111f] p-2 text-slate-100 shadow-2xl shadow-black/30">
        <RecordDetailDrawer
          title={signal.title}
          description={signal.description || "Business Signal details"}
          eyebrow="Business Signal"
          triggerLabel="View"
          triggerClassName={menuItemClass}
        >
          <BusinessSignalDetails signal={signal} />
        </RecordDetailDrawer>
        <RecordDetailDrawer
          title={signal.title}
          description="Edit this Business Signal. Changes stay inside this workspace."
          eyebrow="Edit Business Signal"
          triggerLabel="Edit"
          triggerClassName={menuItemClass}
        >
          <BusinessSignalEditForm signal={signal} />
        </RecordDetailDrawer>
        <form action={manageRecordAction}>
          <input type="hidden" name="collection" value="tasks" />
          <input type="hidden" name="record_id" value={signal.id} />
          <input type="hidden" name="record_action" value={archived ? "restore" : "archive"} />
          <input type="hidden" name="return_path" value={archived ? "/app/tasks?view=archived" : "/app/tasks"} />
          <ConfirmSubmitButton
            message={archived ? `Restore "${signal.title}" to active Business Memory?` : `Archive "${signal.title}"? It will leave active memory but remain in historical context.`}
            className={menuItemClass}
          >
            {archived ? "Restore" : "Archive"}
          </ConfirmSubmitButton>
        </form>
        <form action={deleteBusinessSignalAction}>
          <input type="hidden" name="record_id" value={signal.id} />
          <input type="hidden" name="return_path" value={archived ? "/app/tasks?view=archived" : "/app/tasks"} />
          <ConfirmSubmitButton
            message={`Permanently delete "${signal.title}"? This may affect future Vaeroex intelligence, forecasts, and briefings.`}
            className="block min-h-10 w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-red-100 hover:bg-red-950/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/45"
          >
            Delete
          </ConfirmSubmitButton>
        </form>
      </div>
    </details>
  );
}

function BusinessSignalRowCard({ signal, archived = false }: { signal: BusinessSignalRow; archived?: boolean }) {
  const confidence = businessSignalConfidence(signal);
  const source = sourceLabel(signal);

  return (
    <article id={`signal-${signal.id}`} className="scroll-mt-28 border-t border-white/10 first:border-t-0">
      <div className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-start">
        <details className="group min-w-0">
          <summary className="cursor-pointer list-none rounded-md px-1 py-1 hover:bg-cyan-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/45">
            <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_130px_120px] sm:items-center">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{signal.title}</p>
                <p className="text-xs text-slate-500">Click to expand memory details</p>
              </div>
              <span className="text-xs font-semibold text-slate-300">{compactDate(signal.due_date || signal.created_at)}</span>
              <span className="truncate text-xs font-semibold text-slate-400">{signal.category || "Operations"}</span>
            </div>
          </summary>
          <div className="mt-2 space-y-3 rounded-lg border border-white/10 bg-slate-950/45 p-3">
            <p className="text-sm leading-6 text-slate-300">{signal.description || "No description saved yet."}</p>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Used By</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {usedBy(signal).map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-semibold text-slate-200">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <p className="text-xs leading-5 text-slate-500">
              Business Signals teach Vaeroex. They do not create work, assignments, or execution records.
            </p>
          </div>
        </details>
        <div className="flex flex-wrap gap-2 md:justify-end">
          <SignalBadge label="Confidence" value={confidence} explanation={confidenceExplanation(confidence)} />
          <SignalBadge label="Source" value={source} explanation={sourceExplanation(source)} />
        </div>
        <div className="md:justify-self-end">
          <BusinessSignalActions signal={signal} archived={archived} />
        </div>
      </div>
    </article>
  );
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const params = await searchParams;
  const query = param(params?.q).toLowerCase().trim();
  const evidenceFilterValue = param(params?.evidence_ids);
  const evidenceScopeValue = param(params?.evidence_scope);
  const evidenceScope = (["related-signal-pattern", "limited-signal-context"] as const).includes(evidenceScopeValue as BusinessSignalEvidenceScope)
    ? evidenceScopeValue as BusinessSignalEvidenceScope
    : null;
  const evidenceFilterRequested = Boolean(evidenceFilterValue || evidenceScope);
  const showArchived = param(params?.view) === "archived" && !evidenceFilterRequested;
  const evidenceIds = new Set(
    evidenceFilterValue
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))
  );
  const findingId = param(params?.finding);
  const { supabase, workspaceId } = await requireWorkspacePage();
  const { data: tasks, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });

  const signals = ((tasks || []) as BusinessSignalRow[]).filter((signal) => {
    if (showArchived ? !(signal.archived_at && !signal.deleted_at) : Boolean(signal.archived_at || signal.deleted_at)) return false;
    if (evidenceFilterValue && !evidenceIds.has(signal.id)) return false;
    if (evidenceScope && (!isOriginalBusinessEvidence(signal) || !businessSignalMatchesEvidenceScope(signal, evidenceScope))) return false;
    if (!query) return true;
    return [signal.title, signal.description, signal.category, sourceLabel(signal)]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const groupedSignals = groupSignals(signals);
  const highConfidenceCount = signals.filter((signal) => businessSignalConfidence(signal) === "High").length;
  const uploadedCount = signals.filter((signal) => sourceLabel(signal) === "Uploaded File").length;
  const latestSignal = signals[0]?.due_date || signals[0]?.created_at;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <PageHeader
          eyebrow="Business Memory"
          title="Business Signals"
          description={showArchived ? "Archived context is retained for history and excluded from active intelligence." : "Capture meaningful business events, observations, or strategic context that help Vaeroex build long-term understanding of your business."}
        />
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
                <span className="mt-1 block text-slate-400">This signal will help Vaeroex interpret future intelligence, confidence, forecasts, and executive briefings.</span>
              </span>
            </label>
            <div className="lg:col-span-2">
              <PrimaryButton>Save Business Signal</PrimaryButton>
            </div>
          </form>
        </CreateDrawer>
      </div>

      <ErrorNotice message={(params?.error as string | undefined) || error?.message} />
      {evidenceFilterRequested ? (
        <div className="flex flex-col gap-2 rounded-lg border border-cyan-300/20 bg-cyan-950/20 px-3 py-2 text-sm text-slate-200 sm:flex-row sm:items-center sm:justify-between">
          <p>Showing {signals.length} active supporting Business Signal{signals.length === 1 ? "" : "s"} for the selected Intelligence finding.</p>
          <a href={findingId ? `/app/intelligence?finding=${encodeURIComponent(findingId)}` : "/app/intelligence"} className="shrink-0 font-semibold text-cyan-200 hover:text-white">Back to Intelligence</a>
        </div>
      ) : null}
      {params?.message ? (
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-100">{params.message as string}</div>
      ) : null}

      <nav className="flex gap-2 text-sm" aria-label="Business Signal views">
        <a href="/app/tasks" className={`rounded-md px-3 py-2 font-semibold ${showArchived ? "text-slate-400 hover:text-white" : "bg-cyan-950/40 text-cyan-100"}`}>Active Signals</a>
        <a href="/app/tasks?view=archived" className={`rounded-md px-3 py-2 font-semibold ${showArchived ? "bg-cyan-950/40 text-cyan-100" : "text-slate-400 hover:text-white"}`}>Archived Signals</a>
      </nav>

      <section className="rounded-lg border border-white/10 bg-[#08111f] p-3 shadow-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {[
              ["Signals", signals.length],
              ...(highConfidenceCount ? [["High Confidence", highConfidenceCount]] : []),
              ...(uploadedCount ? [["Uploaded", uploadedCount]] : []),
              ["Latest", latestSignal ? compactDate(latestSignal) : "None"]
            ].map(([label, value]) => (
              <span key={label} className="inline-flex min-h-8 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold text-slate-200">
                <span className="text-slate-500">{label}</span>
                <span className="text-white">{value}</span>
              </span>
            ))}
          </div>
          <form className="flex min-w-0 gap-2" method="get">
            {evidenceFilterValue ? <input type="hidden" name="evidence_ids" value={evidenceFilterValue} /> : null}
            {evidenceScope ? <input type="hidden" name="evidence_scope" value={evidenceScope} /> : null}
            {findingId ? <input type="hidden" name="finding" value={findingId} /> : null}
            <input
              name="q"
              defaultValue={param(params?.q)}
              placeholder="Search memory..."
              className="min-h-10 min-w-0 rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-300/50"
            />
            <button className="min-h-10 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-100 hover:bg-cyan-950/30">
              Search
            </button>
          </form>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Memory Timeline</h2>
          <span className="text-xs text-slate-500">{groupedSignals.length} categor{groupedSignals.length === 1 ? "y" : "ies"}</span>
        </div>

        {groupedSignals.length ? (
          <div className="space-y-2">
            {groupedSignals.map((group) => (
              <details key={group.category} className="rounded-lg border border-white/10 bg-[#08111f] shadow-panel">
                <summary className="grid cursor-pointer list-none gap-2 px-3 py-2.5 hover:bg-cyan-950/20 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                  <span className="truncate text-sm font-semibold text-white">
                    {group.category} <span className="text-slate-500">({group.items.length})</span>
                  </span>
                  <span className="text-xs font-semibold text-slate-400">Latest: {compactDate(group.latestDate)}</span>
                  <span className="text-xs font-semibold text-cyan-200">Expand</span>
                </summary>
                <div>
                  {group.items.map((signal) => (
                    <BusinessSignalRowCard key={signal.id} signal={signal} archived={showArchived} />
                  ))}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-sm text-slate-400">
            {showArchived ? "No archived Business Signals." : "No Business Signals yet. Add meaningful context when something happens that Vaeroex should remember."}
          </div>
        )}
      </section>
    </div>
  );
}
