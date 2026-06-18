import Link from "next/link";
import { EmptyState } from "@/components/operations/EmptyState";
import { PageHeader } from "@/components/operations/PageHeader";
import { SectionCard } from "@/components/operations/SectionCard";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

const quickActions = [
  "Create Form",
  "Create Checklist",
  "Log Issue",
  "Generate SOP",
  "Run Vaeroex Audit",
  "Generate Weekly Report",
  "Ask Vaeroex"
];

export default async function AppDashboardPage() {
  const { supabase, context, workspaceId } = await requireWorkspacePage();
  const today = new Date().toISOString().slice(0, 10);

  const [
    openTasks,
    overdueTasks,
    submissions,
    openIssues,
    assetsNeedingAttention,
    checklistRuns,
    kpiHistory,
    importedFiles,
    crmLeads,
    operationalMetrics,
    recentTasks,
    recentIssues,
    recentImports,
    reports,
    vaeroexRuns
  ] = await Promise.all([
    supabase?.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "Done"),
    supabase?.from("tasks").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).lt("due_date", today).neq("status", "Done"),
    supabase?.from("form_submissions").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase?.from("issues").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "Closed"),
    supabase?.from("assets").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).neq("status", "Ready"),
    supabase?.from("checklist_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase?.from("kpis").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase?.from("file_imports").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "completed"),
    supabase?.from("crm_leads").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase?.from("operational_metrics").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId),
    supabase?.from("tasks").select("id,title,status,priority,due_date").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5),
    supabase?.from("issues").select("id,title,severity,status,recommended_fix").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(5),
    supabase
      ?.from("file_imports")
      .select("id,import_type,status,rows_total,rows_imported,extraction_summary,created_at,imported_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase?.from("reports").select("title, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1),
    supabase?.from("ai_agent_runs").select("output_json, created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1)
  ]);

  const cards = [
    { label: "Open tasks", value: openTasks?.count ?? 0 },
    { label: "Overdue tasks", value: overdueTasks?.count ?? 0 },
    { label: "New form submissions", value: submissions?.count ?? 0 },
    { label: "Open issues", value: openIssues?.count ?? 0 },
    { label: "Assets needing attention", value: assetsNeedingAttention?.count ?? 0 },
    { label: "Recent checklist completions", value: checklistRuns?.count ?? 0 },
    { label: "KPI history records", value: kpiHistory?.count ?? 0 },
    { label: "Completed imports", value: importedFiles?.count ?? 0 },
    { label: "CRM leads", value: crmLeads?.count ?? 0 },
    { label: "Operational metrics", value: operationalMetrics?.count ?? 0 }
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dashboard"
        title={context.activeWorkspace?.name ?? "Vaeroex dashboard"}
        description="Track operational workload, bottlenecks, asset readiness, checklist activity, and Vaeroex recommendations from one accountability dashboard."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <article key={card.label} className="rounded-lg border border-line bg-white p-5 shadow-panel">
            <p className="text-sm text-muted">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_.9fr]">
        <SectionCard title="Suggested next actions">
          {recentTasks?.data?.length ? (
            <ul className="space-y-3 text-sm text-muted">
              <li>Review overdue and high-priority tasks first.</li>
              <li>Convert repeated issues into SOP drafts after manager review.</li>
              <li>Run a Vaeroex audit after new form submissions or issue logs are added.</li>
            </ul>
          ) : (
            <EmptyState
              title="No workspace activity yet"
              description="Create a task, form, checklist, issue, or asset record to start building your accountability dashboard."
              action={
                <Link href="/app/tasks" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
                  Create first task
                </Link>
              }
            />
          )}
        </SectionCard>
        <SectionCard title="Latest Vaeroex operations summary">
          <p className="text-sm leading-6 text-muted">
            {vaeroexRuns?.data?.[0]
              ? "Vaeroex has a saved operations audit result for this workspace."
              : "No Vaeroex audit has been run yet."}
          </p>
          <p className="mt-4 text-sm text-muted">
            Latest report: {reports?.data?.[0]?.title || "No report generated yet"}
          </p>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Business memory" description="Imported files feed KPI history, CRM leads, operational metrics, reports, and future Vaeroex analysis.">
          <div className="space-y-3">
            {recentImports?.data?.length ? (
              recentImports.data.map((item) => (
                <div key={item.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold capitalize">{item.import_type.replace(/_/g, " ")}</p>
                    <StatusBadge value={item.status === "completed" ? "Saved" : item.status} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">
                    {item.rows_imported} of {item.rows_total} rows saved
                    {item.imported_at ? ` on ${new Date(item.imported_at).toLocaleDateString()}` : "."}
                  </p>
                </div>
              ))
            ) : (
              <EmptyState title="No imported history yet" description="Upload a spreadsheet in Files, review the mappings, and save approved rows into business history." />
            )}
          </div>
        </SectionCard>
        <SectionCard title="Trend readiness" description="More dated KPI and operational metric records give Vaeroex better comparisons over time.">
          <div className="space-y-3 text-sm leading-6 text-muted">
            <p>KPI records: {kpiHistory?.count ?? 0}</p>
            <p>Operational metric records: {operationalMetrics?.count ?? 0}</p>
            <p>CRM leads with history: {crmLeads?.count ?? 0}</p>
            <p>Completed file imports: {importedFiles?.count ?? 0}</p>
          </div>
        </SectionCard>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Recent tasks" description="Current operational follow-up work.">
          <div className="space-y-3">
            {recentTasks?.data?.length ? (
              recentTasks.data.map((task) => (
                <div key={task.id} className="flex items-start justify-between gap-3 rounded-lg border border-line p-3">
                  <div>
                    <p className="text-sm font-semibold">{task.title}</p>
                    <p className="mt-1 text-xs text-muted">Due {task.due_date || "not set"}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    <StatusBadge value={task.priority} />
                    <StatusBadge value={task.status} />
                  </div>
                </div>
              ))
            ) : (
              <EmptyState title="No tasks yet" description="Create setup tasks or convert issues and submissions into follow-up tasks." />
            )}
          </div>
        </SectionCard>
        <SectionCard title="Recent issues" description="Bottlenecks and process breakdowns needing review.">
          <div className="space-y-3">
            {recentIssues?.data?.length ? (
              recentIssues.data.map((issue) => (
                <div key={issue.id} className="rounded-lg border border-line p-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold">{issue.title}</p>
                    <StatusBadge value={issue.severity} />
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted">{issue.recommended_fix || "Recommended fix pending."}</p>
                </div>
              ))
            ) : (
              <EmptyState title="No issues logged" description="Log a bottleneck, missed follow-up, equipment problem, or process breakdown." />
            )}
          </div>
        </SectionCard>
      </section>

      <section className="rounded-lg border border-line bg-white p-5 shadow-panel">
        <h3 className="text-lg font-semibold">Quick actions</h3>
        <div className="mt-4 flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <Link
              key={action}
              href={
                action === "Create Form"
                  ? "/app/forms"
                  : action === "Create Checklist"
                    ? "/app/checklists"
                    : action === "Log Issue"
                      ? "/app/issues"
                      : action === "Generate SOP"
                        ? "/app/sops"
                        : action === "Generate Weekly Report"
                          ? "/app/reports"
                          : "/app/agents"
              }
              className="rounded-lg border border-line bg-slate-50 px-3 py-2 text-sm font-medium hover:border-vaeroex-blue"
            >
              {action}
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
