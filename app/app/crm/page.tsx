import type { Route } from "next";
import { createCrmLeadAction } from "@/app/app/operations/actions";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { ModuleTabs } from "@/components/operations/ModuleTabs";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type CrmPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type CrmLeadHistoryRow = Database["public"]["Tables"]["crm_lead_history"]["Row"];

const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Proposal", "Converted", "Lost"];
const crmLeadEditFields: ManagedRecordEditField[] = [
  { name: "lead_name", label: "Lead name", required: true },
  { name: "company", label: "Company" },
  { name: "email", label: "Email" },
  { name: "phone", label: "Phone" },
  { name: "status", label: "Status", type: "select", options: LEAD_STATUSES },
  { name: "estimated_value", label: "Estimated value", type: "number" },
  { name: "owner", label: "Owner" },
  { name: "notes", label: "Notes", type: "textarea", rows: 5 }
];

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency"
});

function SuccessNotice({ message }: { message?: string | null }) {
  if (!message) {
    return null;
  }

  return <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>;
}

function isConverted(status: string | null | undefined) {
  const normalized = (status || "").toLowerCase();
  return normalized.includes("converted") || normalized.includes("won") || normalized.includes("customer");
}

function isLost(status: string | null | undefined) {
  return (status || "").toLowerCase().includes("lost");
}

function formatMoney(value: number | null) {
  return currencyFormatter.format(value || 0);
}

function sourceLabel(lead: CrmLeadRow) {
  return lead.source_file_id || lead.import_id ? "Imported" : "Manual";
}

function historiesForLead(histories: CrmLeadHistoryRow[], leadId: string) {
  return histories.filter((item) => item.lead_id === leadId).slice(0, 5);
}

function HistoryList({ histories }: { histories: CrmLeadHistoryRow[] }) {
  if (!histories.length) {
    return <p className="text-sm leading-6 text-muted">No lead history yet.</p>;
  }

  return (
    <div className="space-y-2">
      {histories.map((item) => (
        <div key={item.id} className="rounded-lg border border-line bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold capitalize text-ink">{item.event_type.replace(/_/g, " ")}</p>
            <p className="text-xs text-muted">{new Date(item.created_at).toLocaleDateString()}</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted">
            {item.status || "No status"} · {formatMoney(item.estimated_value)} · {item.owner || "No owner"}
          </p>
          {item.notes ? <p className="mt-2 text-sm leading-6 text-muted">{item.notes}</p> : null}
        </div>
      ))}
    </div>
  );
}

function MetricCard({ label, value, note }: { label: string; value: string | number; note: string }) {
  return (
    <article className="rounded-lg border border-line bg-white p-5 shadow-panel">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted">{note}</p>
    </article>
  );
}

export default async function CrmPage({ searchParams }: CrmPageProps) {
  const params = await searchParams;
  const { supabase, workspaceId } = await requireWorkspacePage();
  const [leadResult, historyResult, folderResult] = await Promise.all([
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("crm_lead_history").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500),
    getRecordFolders(supabase, workspaceId, "crm_leads")
  ]);
  const leads = (leadResult.data || []) as CrmLeadRow[];
  const histories = (historyResult.data || []) as CrmLeadHistoryRow[];
  const activeLeads = leads.filter((lead) => !lead.deleted_at && !lead.archived_at);
  const openLeads = activeLeads.filter((lead) => !isConverted(lead.status) && !isLost(lead.status));
  const convertedLeads = activeLeads.filter((lead) => isConverted(lead.status));
  const pipelineValue = openLeads.reduce((sum, lead) => sum + (lead.estimated_value || 0), 0);
  const managedLeads = leads.map((lead) => {
    const management = managedValues(lead);
    const leadHistories = historiesForLead(histories, lead.id);

    return {
      id: lead.id,
      title: lead.lead_name,
      type: `${sourceLabel(lead)} lead`,
      status: lead.status,
      owner: lead.owner || "Unassigned",
      category: lead.company || "Direct",
      createdAt: lead.created_at,
      updatedAt: management.updatedAt || lead.last_activity_at || lead.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(lead.notes, `${lead.company || "No company"} · ${lead.email || lead.phone || "No contact added"}`),
      meta: [
        { label: "Company", value: lead.company || "Not set" },
        { label: "Email", value: lead.email || "Not set" },
        { label: "Phone", value: lead.phone || "Not set" },
        { label: "Estimated value", value: formatMoney(lead.estimated_value) },
        { label: "Source", value: sourceLabel(lead) },
        { label: "History events", value: leadHistories.length }
      ],
      editFields: crmLeadEditFields,
      editValues: {
        lead_name: lead.lead_name,
        company: lead.company,
        email: lead.email,
        phone: lead.phone,
        status: lead.status,
        estimated_value: lead.estimated_value,
        owner: lead.owner,
        notes: lead.notes
      },
      children: (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Notes</p>
            <p className="mt-2 text-sm leading-6 text-muted">{lead.notes || "No notes yet."}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Recent history</p>
            <div className="mt-2">
              <HistoryList histories={leadHistories} />
            </div>
          </div>
        </div>
      )
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Lead pipeline"
        description="Track leads manually or import them later. The dashboard and reports use CRM records either way, so no spreadsheet is required to start."
      />
      <ModuleTabs
        tabs={[
          { label: "Pipeline", href: "/app/crm", active: !params?.status },
          { label: "Leads", href: "/app/crm?view=active" as Route },
          { label: "Follow-ups", href: "/app/tasks?category=Follow-up" as Route },
          { label: "History", href: "/app/crm?sort=last_updated" as Route, active: params?.sort === "last_updated" }
        ]}
      />

      <ErrorNotice message={(params?.error as string | undefined) || leadResult.error?.message || historyResult.error?.message || folderResult.error?.message} />
      <SuccessNotice message={params?.message as string | undefined} />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Active leads" value={activeLeads.length} note="Current CRM records in this workspace." />
        <MetricCard label="Open pipeline" value={openLeads.length} note="Not converted or lost." />
        <MetricCard label="Converted" value={convertedLeads.length} note="Leads marked converted, won, or customer." />
        <MetricCard label="Pipeline value" value={formatMoney(pipelineValue)} note="Estimated value for open leads." />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <SectionCard title="CRM records" description="Leads are collapsed by default and can be searched, edited, archived, duplicated, grouped, or moved in bulk.">
          <ManagedRecordList
            collection="crm_leads"
            records={managedLeads}
            folders={folderResult.folders}
            title="Lead records"
            description="Manual and imported leads live together so reports and Vaeroex context have one customer pipeline."
            emptyTitle="No CRM leads yet"
            emptyDescription="Create a lead manually to start tracking pipeline activity without using a spreadsheet."
            returnPath="/app/crm"
            searchParams={params}
          />
        </SectionCard>

        <SectionCard title="Create lead" description="Add one lead at a time. Imported spreadsheets are optional.">
          <form action={createCrmLeadAction} className="space-y-4">
            <TextInput label="Lead name" name="lead_name" placeholder="Customer or contact name" required />
            <TextInput label="Company" name="company" placeholder="Business name" />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput label="Email" name="email" type="email" />
              <TextInput label="Phone" name="phone" />
            </div>
            <SelectInput label="Status" name="status" defaultValue="New" options={LEAD_STATUSES} />
            <TextInput label="Estimated value" name="estimated_value" type="number" step="0.01" min="0" />
            <TextInput label="Owner" name="owner" placeholder="Manager or sales owner" />
            <TextArea label="Notes" name="notes" rows={5} placeholder="Next step, customer need, quote notes, or follow-up details" />
            <PrimaryButton>Save lead</PrimaryButton>
          </form>
        </SectionCard>
      </section>
    </div>
  );
}
