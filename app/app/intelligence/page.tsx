import Link from "next/link";
import type { Route } from "next";
import { PageHeader } from "@/components/operations/PageHeader";
import { StatusBadge } from "@/components/operations/StatusBadge";
import type { Database } from "@/lib/supabase/types";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type TaskRow = Database["public"]["Tables"]["tasks"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type ReportRow = Database["public"]["Tables"]["reports"]["Row"];
type VaeroexRunRow = Database["public"]["Tables"]["ai_agent_runs"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];

type InsightType = "Risk" | "Opportunity" | "Prediction" | "Recommendation" | "Anomaly";
type Confidence = "High" | "Medium" | "Low";
type Insight = {
  id: string;
  type: InsightType;
  title: string;
  summary: string;
  why: string;
  action: string;
  confidence: Confidence;
  evidence: string[];
  sourceTypes: string[];
  href: Route;
};

const currencyFormatter = new Intl.NumberFormat("en-US", { currency: "USD", maximumFractionDigits: 0, style: "currency" });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function isClosed(value: string | null | undefined) {
  return ["closed", "done", "complete", "completed", "converted", "won"].includes((value || "").toLowerCase());
}

function isOverdue(date: string | null | undefined) {
  return Boolean(date && date < new Date().toISOString().slice(0, 10));
}

function formatMetric(value: number | null, name: string) {
  if (value === null) return "not set";
  return /revenue|cost|value|sales/i.test(name) ? currencyFormatter.format(value) : numberFormatter.format(value);
}

function latestKpisByName(kpis: KpiRow[]) {
  const map = new Map<string, KpiRow>();

  for (const kpi of [...kpis].sort((a, b) => b.metric_date.localeCompare(a.metric_date))) {
    if (!map.has(kpi.name)) {
      map.set(kpi.name, kpi);
    }
  }

  return Array.from(map.values());
}

function kpiHistoryCounts(kpis: KpiRow[]) {
  const map = new Map<string, number>();

  for (const kpi of kpis) {
    map.set(kpi.name, (map.get(kpi.name) || 0) + 1);
  }

  return map;
}

function confidenceClass(confidence: Confidence) {
  if (confidence === "High") return "border-cyan-300/40 bg-cyan-400/15 text-cyan-100";
  if (confidence === "Medium") return "border-blue-300/30 bg-blue-500/15 text-blue-100";
  return "border-slate-400/30 bg-slate-500/15 text-slate-100";
}

function typeClass(type: InsightType) {
  if (type === "Risk" || type === "Anomaly") return "border-red-400/35 bg-red-950/25 text-red-100";
  if (type === "Opportunity") return "border-emerald-400/35 bg-emerald-950/25 text-emerald-100";
  if (type === "Prediction") return "border-cyan-400/30 bg-cyan-950/20 text-cyan-100";
  return "border-blue-400/30 bg-blue-950/25 text-blue-100";
}

function askHref(insight: Insight) {
  return `/app/agents?prompt=${encodeURIComponent(`Why does this matter and what should we do next? ${insight.title}: ${insight.summary}`)}` as Route;
}

function InsightCard({ insight }: { insight: Insight }) {
  return (
    <article className={`rounded-lg border p-4 shadow-panel ${typeClass(insight.type)}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-75">{insight.type}</p>
          <h3 className="mt-2 text-base font-semibold text-white">{insight.title}</h3>
          <p className="mt-2 text-sm leading-6 opacity-90">{insight.summary}</p>
        </div>
        <span className={`w-fit shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${confidenceClass(insight.confidence)}`}>
          {insight.confidence} confidence
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm leading-6 md:grid-cols-2">
        <div>
          <dt className="font-semibold text-white">Why it matters</dt>
          <dd className="mt-1 opacity-85">{insight.why}</dd>
        </div>
        <div>
          <dt className="font-semibold text-white">Recommended action</dt>
          <dd className="mt-1 opacity-85">{insight.action}</dd>
        </div>
      </dl>

      <details className="mt-4 rounded-lg border border-white/10 bg-slate-950/35 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-cyan-100">View evidence</summary>
        <div className="mt-3 grid gap-3 text-xs leading-5 text-slate-200 md:grid-cols-[1fr_.5fr]">
          <ul className="space-y-2">
            {insight.evidence.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <div>
            <p className="font-semibold text-white">Source types used</p>
            <p className="mt-1 text-slate-300">{insight.sourceTypes.join(", ")}</p>
          </div>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={insight.href} className="rounded-lg border border-current/25 px-3 py-2 text-xs font-semibold hover:bg-slate-950/30">
          Open source
        </Link>
        <Link href="/app/actions" className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
          Create action
        </Link>
        <Link href={askHref(insight)} className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20">
          Ask Vaeroex
        </Link>
      </div>
    </article>
  );
}

function SummaryPanel({
  title,
  value,
  detail,
  href
}: {
  title: string;
  value: string;
  detail: string;
  href: Route;
}) {
  return (
    <Link href={href} className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100 shadow-panel transition hover:border-cyan-300/40 hover:bg-blue-950/25">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm leading-6 text-slate-300">{detail}</p>
    </Link>
  );
}

function groupInsights(insights: Insight[], type: InsightType) {
  return insights.filter((insight) => insight.type === type);
}

export default async function IntelligencePage() {
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const [tasksResult, issuesResult, kpisResult, filesResult, reportsResult, runsResult, crmResult, importsResult] = await Promise.all([
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("metric_date", { ascending: false }),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false })
  ]);

  const tasks = (tasksResult.data || []) as TaskRow[];
  const issues = (issuesResult.data || []) as IssueRow[];
  const kpis = (kpisResult.data || []) as KpiRow[];
  const files = (filesResult.data || []) as FileUploadRow[];
  const reports = (reportsResult.data || []) as ReportRow[];
  const runs = (runsResult.data || []) as VaeroexRunRow[];
  const crmLeads = (crmResult.data || []) as CrmLeadRow[];
  const imports = (importsResult.data || []) as FileImportRow[];
  const errors = [tasksResult.error, issuesResult.error, kpisResult.error, filesResult.error, reportsResult.error, runsResult.error, crmResult.error, importsResult.error].filter(Boolean);

  const openTasks = tasks.filter((task) => !isClosed(task.status));
  const overdueTasks = openTasks.filter((task) => isOverdue(task.due_date));
  const openIssues = issues.filter((issue) => !isClosed(issue.status));
  const latestKpis = latestKpisByName(kpis);
  const belowTargetKpis = latestKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value < kpi.target * 0.9);
  const improvingKpis = latestKpis.filter((kpi) => kpi.target !== null && kpi.actual_value !== null && kpi.actual_value >= kpi.target);
  const pendingImports = imports.filter((item) => item.status !== "completed");
  const failedRuns = runs.filter((run) => run.status === "failed");
  const historyCounts = kpiHistoryCounts(kpis);
  const forecastReadyKpis = latestKpis.filter((kpi) => (historyCounts.get(kpi.name) || 0) >= 4);
  const dataQualityScore = Math.min(100, Math.round((files.length ? 20 : 0) + (kpis.length ? 25 : 0) + (reports.length ? 20 : 0) + (runs.some((run) => run.status === "completed") ? 20 : 0) + (crmLeads.length || issues.length || tasks.length ? 15 : 0)));
  const dataQuality = dataQualityScore >= 70 ? "Strong" : dataQualityScore >= 40 ? "Developing" : "Limited";
  const insights: Insight[] = [
    ...openIssues.slice(0, 3).map((issue) => ({
      id: `issue-${issue.id}`,
      type: "Risk" as const,
      title: issue.title,
      summary: issue.recommended_fix || issue.description || `Issue is currently ${issue.status}.`,
      why: "Open issues indicate unresolved risk or a process gap leadership may need to prioritize.",
      action: issue.recommended_fix || "Confirm the owner, severity, and next follow-up.",
      confidence: issue.severity === "High" || issue.severity === "Urgent" ? "High" as const : "Medium" as const,
      evidence: [`Issue status: ${issue.status}`, `Severity: ${issue.severity}`, issue.root_cause ? `Root cause: ${issue.root_cause}` : "Root cause not documented"],
      sourceTypes: ["Issues"],
      href: "/app/issues" as Route
    })),
    ...overdueTasks.slice(0, 3).map((task) => ({
      id: `task-${task.id}`,
      type: "Risk" as const,
      title: task.title,
      summary: `Follow-up is overdue${task.due_date ? ` since ${task.due_date}` : ""}.`,
      why: "Overdue follow-ups reduce accountability and can hide recurring execution gaps.",
      action: "Assign or confirm an owner and decide whether this still matters.",
      confidence: task.priority === "High" || task.priority === "Urgent" ? "High" as const : "Medium" as const,
      evidence: [`Priority: ${task.priority}`, `Status: ${task.status}`, task.assigned_role || task.assigned_to ? `Owner: ${task.assigned_role || task.assigned_to}` : "No owner recorded"],
      sourceTypes: ["Follow-ups"],
      href: "/app/tasks" as Route
    })),
    ...belowTargetKpis.slice(0, 3).map((kpi) => ({
      id: `kpi-risk-${kpi.id}`,
      type: "Risk" as const,
      title: `${kpi.name} is below target`,
      summary: `Actual ${formatMetric(kpi.actual_value, kpi.name)} vs target ${formatMetric(kpi.target, kpi.name)}.`,
      why: "A below-target KPI is a signal that performance changed or the target needs leadership review.",
      action: "Review related reports, files, and follow-ups before changing the target.",
      confidence: (historyCounts.get(kpi.name) || 0) >= 3 ? "High" as const : "Medium" as const,
      evidence: [`Metric date: ${kpi.metric_date}`, `Category: ${kpi.category || "General"}`, `Historical records: ${historyCounts.get(kpi.name) || 1}`],
      sourceTypes: ["KPIs"],
      href: "/app/kpis" as Route
    })),
    ...crmLeads.filter((lead) => !isClosed(lead.status)).slice(0, 2).map((lead) => ({
      id: `lead-${lead.id}`,
      type: "Opportunity" as const,
      title: lead.company ? `${lead.lead_name} at ${lead.company}` : lead.lead_name,
      summary: `${formatMetric(lead.estimated_value, "revenue")} estimated value · status ${lead.status}.`,
      why: "Customer context can reveal revenue opportunities when follow-up and ownership are visible.",
      action: "Review the next follow-up and decide whether this opportunity belongs in the leadership review.",
      confidence: lead.estimated_value ? "Medium" as const : "Low" as const,
      evidence: [`Lead status: ${lead.status}`, lead.owner ? `Owner: ${lead.owner}` : "No owner recorded", lead.last_activity_at ? `Last activity: ${lead.last_activity_at}` : "No recent activity recorded"],
      sourceTypes: ["Customer Context"],
      href: "/app/crm" as Route
    })),
    ...improvingKpis.slice(0, 2).map((kpi) => ({
      id: `kpi-opportunity-${kpi.id}`,
      type: "Opportunity" as const,
      title: `${kpi.name} is on or above target`,
      summary: `Actual ${formatMetric(kpi.actual_value, kpi.name)} vs target ${formatMetric(kpi.target, kpi.name)}.`,
      why: "Positive KPI movement can point to a repeatable practice worth preserving.",
      action: "Capture what changed and decide whether to turn it into a SOP, checklist, or report note.",
      confidence: (historyCounts.get(kpi.name) || 0) >= 3 ? "High" as const : "Medium" as const,
      evidence: [`Metric date: ${kpi.metric_date}`, `Historical records: ${historyCounts.get(kpi.name) || 1}`, kpi.source ? `Source: ${kpi.source}` : "Source not recorded"],
      sourceTypes: ["KPIs"],
      href: "/app/kpis" as Route
    })),
    ...forecastReadyKpis.slice(0, 2).map((kpi) => ({
      id: `prediction-${kpi.id}`,
      type: "Prediction" as const,
      title: `${kpi.name} has enough history for trend review`,
      summary: `${historyCounts.get(kpi.name)} historical records are available for directional forecasting.`,
      why: "Vaeroex can forecast more responsibly when historical records exist across multiple periods.",
      action: "Compare this metric against recent files, reports, and action outcomes before making a decision.",
      confidence: "Medium" as const,
      evidence: [`Latest value: ${formatMetric(kpi.actual_value, kpi.name)}`, `Target: ${formatMetric(kpi.target, kpi.name)}`, `History count: ${historyCounts.get(kpi.name)}`],
      sourceTypes: ["KPI history"],
      href: "/app/kpis" as Route
    })),
    ...pendingImports.slice(0, 2).map((item) => ({
      id: `import-${item.id}`,
      type: "Recommendation" as const,
      title: `${item.import_type.replace(/_/g, " ")} import needs review`,
      summary: `${item.rows_imported} of ${item.rows_total} rows have been imported.`,
      why: "Unreviewed imported data can keep dashboards and reports from reflecting the newest business context.",
      action: "Review the import mapping before allowing the data to influence future intelligence.",
      confidence: "Medium" as const,
      evidence: [`Status: ${item.status}`, `Rows staged: ${item.rows_total}`, item.extraction_summary || "No extraction summary recorded"],
      sourceTypes: ["Files", "Imports"],
      href: "/app/files" as Route
    })),
    ...failedRuns.slice(0, 2).map((run) => ({
      id: `run-${run.id}`,
      type: "Anomaly" as const,
      title: `Vaeroex run failed: ${run.agent_type.replace(/_/g, " ")}`,
      summary: run.error_message || "The run did not complete.",
      why: "Failed intelligence runs reduce confidence until the underlying data or service issue is resolved.",
      action: "Retry from Ask Vaeroex or review technical details if you are an admin.",
      confidence: "High" as const,
      evidence: [`Run status: ${run.status}`, `Created: ${new Date(run.created_at).toLocaleString()}`, run.error_message || "No error message recorded"],
      sourceTypes: ["Vaeroex Runs"],
      href: "/app/agents" as Route
    }))
  ];

  const topRisk = groupInsights(insights, "Risk")[0];
  const topOpportunity = groupInsights(insights, "Opportunity")[0];
  const topRecommendation = groupInsights(insights, "Recommendation")[0] || insights.find((insight) => insight.type === "Risk");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="Leadership Intelligence"
        description="What should leadership know that is not immediately obvious? Vaeroex turns workspace context into risks, opportunities, recommendations, and evidence."
        actions={
          <Link href="/app/agents" className="rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white">
            Ask Vaeroex
          </Link>
        }
      />

      {errors.length ? (
        <div className="rounded-lg border border-red-400/35 bg-red-950/30 p-3 text-sm text-red-100">
          {errors[0]?.message || "Some intelligence data could not be loaded."}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
        <div className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-slate-100 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-vaeroex-accent">Executive summary</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">
            {topRisk ? topRisk.title : topOpportunity ? topOpportunity.title : "Vaeroex needs more business context."}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            {topRisk
              ? topRisk.why
              : topOpportunity
                ? topOpportunity.why
                : "Upload files, import KPI history, add reports, or ask Vaeroex a question so the workspace can build business memory."}
          </p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <SummaryPanel title="Top risk" value={topRisk?.title || "None visible"} detail={topRisk?.summary || "No active risk signal is strong enough yet."} href={topRisk?.href || "/app/sources"} />
            <SummaryPanel title="Top opportunity" value={topOpportunity?.title || "Needs context"} detail={topOpportunity?.summary || "Add customer, KPI, file, or report history."} href={topOpportunity?.href || "/app/sources"} />
            <SummaryPanel title="Recommended action" value={topRecommendation?.action || "Add source data"} detail={topRecommendation?.summary || "Vaeroex generates stronger recommendations as evidence improves."} href={"/app/actions" as Route} />
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-slate-100 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Confidence and data quality</p>
          <p className="mt-3 text-4xl font-semibold text-white">{dataQualityScore}/100</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">{dataQuality} workspace context.</p>
          <dl className="mt-5 grid gap-3 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <dt>Sources</dt>
              <dd className="font-semibold text-white">{files.length + reports.length}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <dt>KPI history</dt>
              <dd className="font-semibold text-white">{kpis.length}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <dt>Saved Vaeroex runs</dt>
              <dd className="font-semibold text-white">{runs.length}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        {(["Risk", "Opportunity", "Prediction", "Recommendation", "Anomaly"] as InsightType[]).map((type) => {
          const grouped = groupInsights(insights, type);

          return (
            <section key={type} className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-100">{type}s</h2>
                <StatusBadge value={`${grouped.length} signal${grouped.length === 1 ? "" : "s"}`} />
              </div>
              {grouped.length ? (
                <div className="space-y-3">
                  {grouped.map((insight) => (
                    <InsightCard key={insight.id} insight={insight} />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-sm leading-6 text-slate-300">
                  {type === "Prediction"
                    ? "No prediction is shown yet because Vaeroex needs more historical data before forecasting responsibly."
                    : `No ${type.toLowerCase()} signal is strong enough yet.`}
                </div>
              )}
            </section>
          );
        })}
      </section>

      <section className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100">
        <h2 className="text-base font-semibold text-white">Business memory</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Vaeroex builds workspace context from uploaded sources, approved imports, reports, KPI history, customer context, actions, issues, and saved Vaeroex runs. It does not replace those systems; it summarizes what leadership should know from them.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/app/sources" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-cyan-950/30">Review sources</Link>
          <Link href="/app/actions" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-cyan-950/30">Review actions</Link>
          <Link href={`/app/agents?prompt=${encodeURIComponent(`Summarize the current intelligence for ${context.activeWorkspace?.name || "this workspace"}. Include evidence, confidence, and recommended action.`)}` as Route} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">Ask for briefing</Link>
        </div>
      </section>
    </div>
  );
}
