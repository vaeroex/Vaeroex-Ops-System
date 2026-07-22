import { createPersonAction } from "@/app/app/operations/actions";
import { CreateDrawer } from "@/components/operations/CreateDrawer";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { PrimaryButton, SelectInput, TextArea, TextInput } from "@/components/operations/FormControls";
import { ManagedRecordList, type ManagedRecordEditField } from "@/components/operations/ManagedRecordList";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import { buildPrestigeIntelligence } from "@/lib/intelligence/prestige";
import { getRecordFolders, managedValues, shortPreview } from "@/lib/records/management";
import type { Database } from "@/lib/supabase/types";
import { OPERATIONAL_ROLES, TEAM_DEPARTMENTS } from "@/lib/team/options";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

type PeoplePageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const peopleStatuses = ["active", "onboarding", "inactive"];
type PersonRow = Database["public"]["Tables"]["people"]["Row"];
const personEditFields: ManagedRecordEditField[] = [
  { name: "full_name", label: "Full name", required: true },
  { name: "email", label: "Email" },
  { name: "phone", label: "Phone" },
  { name: "role_title", label: "Role", type: "select", options: OPERATIONAL_ROLES },
  { name: "department", label: "Department", type: "select", options: TEAM_DEPARTMENTS },
  { name: "status", label: "Status", type: "select", options: peopleStatuses },
  { name: "start_date", label: "Start date", type: "date" },
  { name: "notes", label: "Notes", type: "textarea", rows: 4 }
];

export default async function PeoplePage({ searchParams }: PeoplePageProps) {
  const params = await searchParams;
  const { supabase, context, workspaceId } = await requireWorkspacePage();
  const [
    { data: people, error },
    folderResult,
    issueResult,
    assignmentResult,
    kpiResult,
    checklistRunResult,
    crmResult,
    reportResult,
    notificationResult
  ] = await Promise.all([
    supabase
      .from("people")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("full_name", { ascending: true }),
    getRecordFolders(supabase, workspaceId, "people"),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
    supabase.from("operational_assignments").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("metric_date", { ascending: false }).limit(200),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(200),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(20),
    supabase.from("notifications").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(50)
  ]);
  const peopleRows = (people || []) as PersonRow[];
  const sourceParentResult = await loadSourceParentEligibilityResult({
    supabase,
    workspaceId,
    rows: [...(kpiResult.data || []), ...(crmResult.data || [])]
  });
  const sourceParentEligibility = sourceParentResult.eligibility;
  const eligibleKpis = filterBySourceParentEligibility(kpiResult.data || [], sourceParentEligibility);
  const eligibleCustomerEvidence = filterBySourceParentEligibility(crmResult.data || [], sourceParentEligibility);
  const today = new Date().toISOString().slice(0, 10);
  const intelligence = buildPrestigeIntelligence({
    workspaceName: context.activeWorkspace?.name || "Vaeroex workspace",
    isDemoWorkspace: false,
    periodLabel: "People",
    range: { startDate: today, endDate: today, previousStartDate: today, previousEndDate: today },
    kpis: eligibleKpis,
    issues: issueResult.data || [],
    assets: [],
    checklists: [],
    checklistRuns: [],
    sops: [],
    files: [],
    imports: [],
    crmLeads: eligibleCustomerEvidence,
    reports: [],
    vaeroexRuns: [],
    operationalMetrics: [],
    notifications: notificationResult.data || [],
    assignments: assignmentResult.data || [],
    shares: [],
    people: peopleRows,
    decisions: [],
    recommendationOutcomes: []
  });
  const managedPeople = peopleRows.map((person) => {
    const management = managedValues(person);

    return {
      id: person.id,
      title: person.full_name,
      type: person.role_title || "Person",
      status: person.status,
      owner: person.department || "General",
      category: person.role_title || "Team",
      createdAt: person.created_at,
      updatedAt: management.updatedAt || person.updated_at,
      folderId: management.folderId,
      archivedAt: management.archivedAt,
      deletedAt: management.deletedAt,
      preview: shortPreview(person.notes, person.email || person.phone || "No notes yet."),
      meta: [
        { label: "Email", value: person.email || "No email" },
        { label: "Phone", value: person.phone || "No phone" },
        { label: "Start date", value: person.start_date || "Not set" }
      ],
      editFields: personEditFields,
      editValues: {
        full_name: person.full_name,
        email: person.email,
        phone: person.phone,
        role_title: person.role_title,
        department: person.department,
        status: person.status,
        start_date: person.start_date,
        notes: person.notes
      },
      children: <p className="text-sm leading-6 text-muted">{person.notes || "No notes yet."}</p>
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="People"
        title="People"
        description="Add team members so reports, follow-ups, alerts, and Vaeroex insights can be assigned or shared with the right people. These workspace roles do not grant app admin access."
      />

      <ErrorNotice
        message={
          (params?.error as string | undefined) ||
          error?.message ||
          folderResult.error?.message ||
          issueResult.error?.message ||
          assignmentResult.error?.message ||
          kpiResult.error?.message ||
          checklistRunResult.error?.message ||
          crmResult.error?.message ||
          reportResult.error?.message ||
          notificationResult.error?.message ||
          sourceParentResult.error?.message
        }
      />

      <section className="space-y-6">
        <SectionCard title="Accountability Map" description="Where source-system evidence connects to roles, departments, and leadership review areas.">
          <div className="grid gap-3 lg:grid-cols-3">
            {intelligence.accountabilityMap.slice(0, 9).map((item) => (
              <article key={item.id} className="rounded-lg border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-ink">{item.label}</p>
                    <p className="mt-1 text-xs text-muted">{item.role || item.department || "Workspace"}</p>
                  </div>
                  <StatusBadge value={item.riskLevel} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted">
                  <span>{item.assignedWork} source links</span>
                  <span>{item.overdueWork} need review</span>
                  <span>{item.openIssues} issues</span>
                  <span>{item.completedWork} reviewed</span>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted">{item.explanation}</p>
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Role-Based Briefings" description="Different accountability summaries for owners, directors, managers, supervisors, coordinators, staff, and viewers.">
          <div className="grid gap-3 lg:grid-cols-3">
            {intelligence.roleBriefings.map((briefing) => (
              <article key={briefing.role} className="rounded-lg border border-line bg-white p-4">
                <p className="text-sm font-semibold text-ink">{briefing.title}</p>
                <p className="mt-2 text-sm leading-6 text-muted">{briefing.summary}</p>
                <ul className="mt-3 space-y-1 text-xs leading-5 text-muted">
                  {briefing.focus.map((item) => (
                    <li key={item}>- {item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </SectionCard>

        <CreateDrawer title="Add person" description="This directory is separate from workspace login permissions. Multiple people can share the same role." triggerLabel="New Person">
          <form action={createPersonAction} className="grid gap-4 lg:grid-cols-2">
            <TextInput label="Full name" name="full_name" required />
            <TextInput label="Email" name="email" type="email" />
            <TextInput label="Phone" name="phone" />
            <SelectInput label="Role" name="role_title" options={OPERATIONAL_ROLES} />
            <SelectInput label="Department" name="department" options={TEAM_DEPARTMENTS} />
            <SelectInput label="Status" name="status" defaultValue="active" options={peopleStatuses} />
            <TextInput label="Start date" name="start_date" type="date" />
            <div className="lg:col-span-2">
              <TextArea label="Notes" name="notes" rows={4} />
            </div>
            <div className="lg:col-span-2">
              <PrimaryButton>Add person</PrimaryButton>
            </div>
          </form>
        </CreateDrawer>

        <ManagedRecordList
          collection="people"
          records={managedPeople}
          folders={folderResult.folders}
          title="People records"
          description="Keep team contacts compact, searchable, and easy to manage without exposing long notes by default."
          emptyTitle="No people yet"
          emptyDescription="Add team members, contractors, managers, or operational contacts."
          returnPath="/app/people"
          searchParams={params}
        />
      </section>
    </div>
  );
}
