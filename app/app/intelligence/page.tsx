import Link from "next/link";
import { ContextualAskVaeroex } from "@/components/ai/ContextualAskVaeroex";
import { BusinessIntelligenceCoveragePanel } from "@/components/intelligence/BusinessIntelligenceCoverage";
import { IntelligenceSignalInbox } from "@/components/intelligence/IntelligenceSignalInbox";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { buildBusinessIntelligenceCoverage } from "@/lib/intelligence/coverage";
import { generatedOutputHref } from "@/lib/intelligence/generated-output";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
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

export default async function IntelligencePage() {
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const [tasksResult, issuesResult, kpisResult, filesResult, reportsResult, runsResult, crmResult, crmHistoryResult, importsResult, sopsResult, formsResult, submissionsResult, peopleResult, decisionsResult, outcomesResult, checklistsResult, checklistRunsResult, metricsResult, assetsResult] = await Promise.all([
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
    supabase.from("assets").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("updated_at", { ascending: false })
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
    assetsResult.error
  ].filter(Boolean);

  if (errors.some((error) => isSecurityResponseMessage(error?.message))) {
    return (
      <div className="mx-auto max-w-3xl">
        <SecurityResponseNotice />
      </div>
    );
  }

  const intelligence = buildIntelligenceLayer({
    workspace: context.activeWorkspace,
    tasks: tasksResult.data || [],
    issues: issuesResult.data || [],
    kpis: kpisResult.data || [],
    files: filesResult.data || [],
    reports: reportsResult.data || [],
    vaeroexRuns: runsResult.data || [],
    crmLeads: crmResult.data || [],
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
    kpis: kpisResult.data || [],
    files: filesResult.data || [],
    reports: reportsResult.data || [],
    vaeroexRuns: runsResult.data || [],
    crmLeads: crmResult.data || [],
    crmHistory: crmHistoryResult.data || [],
    imports: importsResult.data || [],
    sops: sopsResult.data || [],
    forms: formsResult.data || [],
    submissions: submissionsResult.data || [],
    people: peopleResult.data || [],
    decisions: decisionsResult.data || [],
    recommendationOutcomes: outcomesResult.data || [],
    checklists: checklistsResult.data || [],
    checklistRuns: checklistRunsResult.data || [],
    operationalMetrics: metricsResult.data || [],
    assets: assetsResult.data || []
  });
  const { topRisk, topOpportunity, topRecommendation, topForecast } = intelligence;
  const summaryTiles = [
    {
      label: "Business Health",
      value: `${intelligence.businessHealth.score}/100`,
      detail: `${intelligence.businessHealth.status} · ${intelligence.businessHealth.trend}`
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
      label: "Forecast Summary",
      value: topForecast?.title || intelligence.forecastReadiness.label,
      detail: topForecast ? compactText(topForecast.summary, "Forecast signal available.", 96) : compactText(intelligence.forecastReadiness.reason, "Forecast history is still building.", 120)
    },
    {
      label: "Recommended Next Action",
      value: topRecommendation?.title || "Add more business context",
      detail: topRecommendation ? compactText(topRecommendation.recommendedAction, "Review the strongest current signal.", 96) : intelligence.dataQuality.suggestedNextData[0] || "Upload current source evidence."
    }
  ];

  return (
    <div className="space-y-6">
      <ErrorNotice message={errors[0]?.message || null} />

      <section className="rounded-2xl border border-cyan-300/20 bg-[#061225] p-4 text-slate-100 shadow-command">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-vaeroex-accent">Executive Summary</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white">Leadership Intelligence</h1>
            <p className="mt-2 max-w-5xl text-sm leading-6 text-slate-300">
              {compactText(intelligence.executiveSummary, "Vaeroex needs more business context before surfacing a stronger leadership briefing.", 190)}
            </p>
          </div>
          <Link href="/app/agents" className="inline-flex min-h-10 w-fit items-center rounded-lg bg-vaeroex-blue px-4 py-2 text-sm font-semibold text-white hover:bg-cyan-400 hover:text-vaeroex-navy">
            Ask Vaeroex
          </Link>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {summaryTiles.map((tile) => (
            <article key={tile.label} className="rounded-xl border border-white/10 bg-slate-950/35 p-3">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-400">{tile.label}</p>
              <h2 className="mt-2 line-clamp-2 text-sm font-semibold leading-5 text-white">{tile.value}</h2>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-300">{tile.detail}</p>
            </article>
          ))}
        </div>
      </section>

      <IntelligenceSignalInbox insights={intelligence.insights} />

      <details className="rounded-xl border border-white/10 bg-[#08111f] p-4 text-slate-100">
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

      <details className="rounded-xl border border-white/10 bg-[#08111f] p-4 text-slate-100">
        <summary className="cursor-pointer list-none text-sm font-semibold text-cyan-100">
          Business Memory
        </summary>
        <div className="mt-4">
          <p className="text-sm leading-6 text-slate-300">
            Vaeroex builds workspace context from uploaded sources, approved imports, reports, KPI history, customer context, actions, issues, and saved Vaeroex runs. It does not replace those systems; it summarizes what leadership should know from them.
          </p>
          <div className="mt-4 grid gap-2 text-sm text-slate-300 md:grid-cols-3">
            <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3">{intelligence.memorySummary.decisions} decision record{intelligence.memorySummary.decisions === 1 ? "" : "s"} stored.</p>
            <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3">{intelligence.memorySummary.recommendationOutcomes} recommendation outcome{intelligence.memorySummary.recommendationOutcomes === 1 ? "" : "s"} tracked.</p>
            <p className="rounded-lg border border-white/10 bg-white/[0.04] p-3">{intelligence.dataQuality.suggestedNextData[0]}</p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/app/sources" className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-cyan-950/30">
              Review sources
            </Link>
            <Link href={generatedOutputHref({ type: "executive_briefing" })} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-cyan-950/30">
              Generate Executive Briefing
            </Link>
            <ContextualAskVaeroex
              label="Explain This Briefing"
              prompt={`Summarize the current intelligence for ${context.activeWorkspace?.name || "this workspace"}. Include evidence, confidence, and recommended action.`}
              contextType="business_memory_summary"
              contextId={context.activeWorkspace?.id || "workspace"}
              sourceTitle="Current intelligence and business memory"
              sourceSummary={`Business memory includes ${intelligence.memorySummary.decisions} decision records, ${intelligence.memorySummary.recommendationOutcomes} recommendation outcomes, and data confidence ${intelligence.dataQuality.confidence}.`}
              evidence={[
                `Suggested next data: ${intelligence.dataQuality.suggestedNextData[0]}`,
                `Top risk: ${topRisk?.title || "No top risk visible"}`,
                `Top opportunity: ${topOpportunity?.title || "No top opportunity visible"}`,
                `Top recommendation: ${topRecommendation?.title || "No top recommendation visible"}`
              ]}
              compact
            />
          </div>
        </div>
      </details>
    </div>
  );
}
