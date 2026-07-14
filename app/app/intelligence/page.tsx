import { BusinessIntelligenceCoveragePanel } from "@/components/intelligence/BusinessIntelligenceCoverage";
import { IntelligenceSignalInbox } from "@/components/intelligence/IntelligenceSignalInbox";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { buildBusinessIntelligenceCoverage } from "@/lib/intelligence/coverage";
import { filterBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import { isSecurityResponseMessage } from "@/lib/security/security-response";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

function compactText(value: string | null | undefined, fallback: string, maxLength = 160) {
  const text = (value || fallback).replace(/\s+/g, " ").trim();

  if (text.length <= maxLength) {
    return text;
  }

  const shortened = text.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
  return `${shortened}...`;
}

type IntelligencePageProps = {
  searchParams?: Promise<{ finding?: string }>;
};

export default async function IntelligencePage({ searchParams }: IntelligencePageProps) {
  const params = await searchParams;
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const [tasksResult, issuesResult, kpisResult, filesResult, reportsResult, runsResult, crmResult, crmHistoryResult, importsResult, sopsResult, formsResult, submissionsResult, peopleResult, decisionsResult, outcomesResult, checklistsResult, checklistRunsResult, metricsResult, assetsResult, memoryChunksResult] = await Promise.all([
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("metric_date", { ascending: false }),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("crm_lead_history").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    supabase.from("forms").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("form_submissions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("people").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name"),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("vaeroex_recommendation_outcomes").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("checklists").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("checklist_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("operational_metrics").select("*").eq("workspace_id", workspaceId).order("metric_date", { ascending: false }),
    supabase.from("assets").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("updated_at", { ascending: false }),
    supabase.from("business_memory_chunks").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).is("archived_at", null)
  ]);

  const errors = [
    tasksResult.error,
    issuesResult.error,
    kpisResult.error,
    filesResult.error,
    reportsResult.error,
    runsResult.error,
    crmResult.error,
    crmHistoryResult.error,
    importsResult.error,
    sopsResult.error,
    formsResult.error,
    submissionsResult.error,
    peopleResult.error,
    decisionsResult.error,
    outcomesResult.error,
    checklistsResult.error,
    checklistRunsResult.error,
    metricsResult.error,
    assetsResult.error,
    memoryChunksResult.error
  ].filter(Boolean);

  if (errors.some((error) => isSecurityResponseMessage(error?.message))) {
    return (
      <div className="mx-auto max-w-3xl">
        <SecurityResponseNotice />
      </div>
    );
  }

  const sourceParentResult = await loadSourceParentEligibilityResult({
    supabase,
    workspaceId,
    rows: [
      ...(kpisResult.data || []),
      ...(crmResult.data || []),
      ...(crmHistoryResult.data || []),
      ...(metricsResult.data || [])
    ]
  });
  const sourceParentEligibility = sourceParentResult.eligibility;
  const displayErrors = [...errors, sourceParentResult.error].filter(Boolean) as Array<{ message: string }>;
  const eligibleKpis = filterBySourceParentEligibility(kpisResult.data || [], sourceParentEligibility);
  const eligibleCustomerEvidence = filterBySourceParentEligibility(crmResult.data || [], sourceParentEligibility);
  const eligibleCustomerHistory = filterBySourceParentEligibility(crmHistoryResult.data || [], sourceParentEligibility);
  const eligibleOperationalMetrics = filterBySourceParentEligibility(metricsResult.data || [], sourceParentEligibility);
  const eligibleRuns = filterBusinessEvidence(runsResult.data || [], { sourceKind: "platform_run" });
  const intelligence = buildIntelligenceLayer({
    workspace: context.activeWorkspace,
    tasks: tasksResult.data || [],
    issues: issuesResult.data || [],
    kpis: eligibleKpis,
    files: filesResult.data || [],
    reports: reportsResult.data || [],
    vaeroexRuns: eligibleRuns,
    crmLeads: eligibleCustomerEvidence,
    imports: importsResult.data || [],
    sops: sopsResult.data || [],
    forms: formsResult.data || [],
    submissions: submissionsResult.data || [],
    people: peopleResult.data || [],
    decisions: decisionsResult.data || [],
    recommendationOutcomes: outcomesResult.data || []
  });
  const businessIntelligenceCoverage = buildBusinessIntelligenceCoverage({
    tasks: tasksResult.data || [],
    issues: issuesResult.data || [],
    kpis: eligibleKpis,
    files: filesResult.data || [],
    reports: reportsResult.data || [],
    vaeroexRuns: eligibleRuns,
    crmLeads: eligibleCustomerEvidence,
    crmHistory: eligibleCustomerHistory,
    imports: importsResult.data || [],
    sops: sopsResult.data || [],
    forms: formsResult.data || [],
    submissions: submissionsResult.data || [],
    people: peopleResult.data || [],
    decisions: decisionsResult.data || [],
    recommendationOutcomes: outcomesResult.data || [],
    checklists: checklistsResult.data || [],
    checklistRuns: checklistRunsResult.data || [],
    operationalMetrics: eligibleOperationalMetrics,
    assets: assetsResult.data || [],
    memoryChunks: memoryChunksResult.data || []
  });
  const { topRisk, topOpportunity, topRecommendation } = intelligence;
  const summaryTiles = [
    {
      label: "Business Health",
      value: intelligence.businessHealth.available ? `${intelligence.businessHealth.score}/100` : "Limited evidence",
      detail: intelligence.businessHealth.available ? `${intelligence.businessHealth.status} · ${intelligence.businessHealth.trend}` : "More eligible original evidence is needed before Vaeroex scores Business Health."
    },
    {
      label: "Highest Priority Risk",
      value: topRisk?.title || "No major risk visible",
      detail: topRisk ? compactText(topRisk.summary, "Risk signal available.", 96) : "Add more evidence to improve risk detection."
    },
    {
      label: "Best Opportunity",
      value: topOpportunity?.title || "No clear opportunity visible",
      detail: topOpportunity ? compactText(topOpportunity.summary, "Opportunity signal available.", 96) : "Add customer, KPI, or report history."
    },
    {
      label: "Recommended Decision",
      value: topRecommendation?.title || "More evidence is needed",
      detail: topRecommendation ? compactText(topRecommendation.recommendedAction, "Review the strongest current signal.", 96) : intelligence.dataQuality.suggestedNextData[0] || "Add current source evidence before drawing a stronger conclusion."
    }
  ];

  return (
    <div className="space-y-6">
      <ErrorNotice message={displayErrors[0]?.message || null} />

      <section className="rounded-xl border border-cyan-300/20 bg-[#061225] p-4 text-slate-100 shadow-command">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-vaeroex-accent">Operations Intelligence</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white">What leadership should know</h1>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-300">
              {compactText(intelligence.executiveSummary, "Vaeroex needs more business context before surfacing a stronger leadership briefing.", 190)}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {summaryTiles.map((tile) => (
            <article key={tile.label} className="rounded-lg border border-white/10 bg-slate-950/35 p-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-400">{tile.label}</p>
              <h2 className="mt-2 text-sm font-semibold leading-5 text-white">{tile.value}</h2>
              <p className="mt-2 text-xs leading-5 text-slate-300">{tile.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <IntelligenceSignalInbox insights={intelligence.insights} initialFindingId={params?.finding} />

      <details className="rounded-lg border border-white/10 bg-[#08111f] p-4 text-slate-100">
        <summary className="cursor-pointer list-none text-sm font-semibold text-cyan-100">
          Business Intelligence Coverage
          <span className="ml-2 rounded-full border border-cyan-300/30 bg-cyan-950/30 px-2 py-0.5 text-xs text-cyan-50">
            {intelligence.dataQuality.score}/100
          </span>
        </summary>
        <div className="mt-4">
          <BusinessIntelligenceCoveragePanel coverage={businessIntelligenceCoverage} />
        </div>
      </details>

    </div>
  );
}
