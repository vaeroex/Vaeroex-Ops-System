import Link from "next/link";
import type { Route } from "next";
import { ContextualAskVaeroex } from "@/components/ai/ContextualAskVaeroex";
import { BusinessIntelligenceCoveragePanel } from "@/components/intelligence/BusinessIntelligenceCoverage";
import { PageHeader } from "@/components/operations/PageHeader";
import { StatusBadge } from "@/components/operations/StatusBadge";
import { buildBusinessIntelligenceCoverage } from "@/lib/intelligence/coverage";
import { generatedOutputHref, outputTypeForInsight } from "@/lib/intelligence/generated-output";
import {
  buildIntelligenceLayer,
  type IntelligenceConfidence,
  type IntelligenceInsight,
  type IntelligenceInsightType
} from "@/lib/intelligence/layer";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

function confidenceClass(confidence: IntelligenceConfidence) {
  if (confidence === "High") return "border-cyan-300/40 bg-cyan-400/15 text-cyan-100";
  if (confidence === "Medium") return "border-blue-300/30 bg-blue-500/15 text-blue-100";
  return "border-slate-400/30 bg-slate-500/15 text-slate-100";
}

function typeClass(type: IntelligenceInsightType) {
  if (type === "Risk" || type === "Anomaly") return "border-red-400/35 bg-red-950/25 text-red-100";
  if (type === "Opportunity") return "border-emerald-400/35 bg-emerald-950/25 text-emerald-100";
  if (type === "Forecast") return "border-cyan-400/30 bg-cyan-950/20 text-cyan-100";
  if (type === "Bottleneck") return "border-amber-400/35 bg-amber-950/25 text-amber-100";
  return "border-blue-400/30 bg-blue-950/25 text-blue-100";
}

function groupInsights(insights: IntelligenceInsight[], type: IntelligenceInsightType) {
  return insights.filter((insight) => insight.type === type);
}

function InsightCard({ insight }: { insight: IntelligenceInsight }) {
  const primaryOutputType = outputTypeForInsight(insight);
  const primaryOutputLabel = primaryOutputType === "risk_brief" ? "Generate Risk Brief" : primaryOutputType === "executive_briefing" ? "Generate Executive Briefing" : "Generate Improvement Plan";

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
          <dt className="font-semibold text-white">Why Vaeroex surfaced it</dt>
          <dd className="mt-1 opacity-85">{insight.why}</dd>
        </div>
        <div>
          <dt className="font-semibold text-white">Executive recommendation</dt>
          <dd className="mt-1 opacity-85">{insight.recommendedAction}</dd>
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
            <p className="mt-3 font-semibold text-white">Evidence count</p>
            <p className="mt-1 text-slate-300">{insight.evidenceCount} record signal{insight.evidenceCount === 1 ? "" : "s"}</p>
          </div>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={generatedOutputHref({ type: primaryOutputType, source: insight.id })} className="rounded-lg bg-vaeroex-blue px-3 py-2 text-xs font-semibold text-white">
          {primaryOutputLabel}
        </Link>
        {primaryOutputType !== "action_plan" ? (
          <Link href={generatedOutputHref({ type: "action_plan", source: insight.id })} className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20">
            Generate Improvement Plan
          </Link>
        ) : null}
        <Link href={generatedOutputHref({ type: "executive_briefing", source: insight.id })} className="rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/20">
          Generate Executive Briefing
        </Link>
        <ContextualAskVaeroex
          label="Explain This"
          prompt={`Explain why this ${insight.type.toLowerCase()} matters, what evidence supports it, what could happen next, and what leadership should review.`}
          contextType={`intelligence_${insight.type.toLowerCase()}`}
          contextId={insight.id}
          sourceTitle={insight.title}
          sourceSummary={`${insight.summary} Executive recommendation: ${insight.recommendedAction}`}
          evidence={[
            insight.why,
            ...insight.evidence,
            `Confidence: ${insight.confidence}`,
            `Source types: ${insight.sourceTypes.join(", ")}`,
            `Evidence count: ${insight.evidenceCount}`
          ]}
          compact
        />
      </div>

      <details className="mt-3 rounded-lg border border-white/10 bg-slate-950/30 p-3">
        <summary className="cursor-pointer text-xs font-semibold text-slate-200">Advanced source options</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={insight.sourceHref as Route} className="rounded-lg border border-current/25 px-3 py-2 text-xs font-semibold hover:bg-slate-950/30">
            Open source record area
          </Link>
          <Link href={generatedOutputHref({ type: "checklist", source: insight.id })} className="rounded-lg border border-current/25 px-3 py-2 text-xs font-semibold hover:bg-slate-950/30">
            Generate Checklist
          </Link>
          <Link href={generatedOutputHref({ type: "sop", source: insight.id })} className="rounded-lg border border-current/25 px-3 py-2 text-xs font-semibold hover:bg-slate-950/30">
            Generate SOP
          </Link>
        </div>
      </details>
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
  const { topRisk, topOpportunity, topRecommendation } = intelligence;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Intelligence"
        title="Leadership Intelligence"
        description="What should leadership know that is not immediately obvious? Vaeroex turns workspace context into risks, opportunities, business impact, evidence, and executive recommendations."
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
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">{intelligence.executiveSummary}</p>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <SummaryPanel title="Top risk" value={topRisk?.title || "None visible"} detail={topRisk?.summary || "No active risk signal is strong enough yet."} href={(topRisk?.sourceHref || "/app/sources") as Route} />
            <SummaryPanel title="Top opportunity" value={topOpportunity?.title || "Needs context"} detail={topOpportunity?.summary || "Add customer, KPI, file, or report history."} href={(topOpportunity?.sourceHref || "/app/sources") as Route} />
            <SummaryPanel
              title="Executive recommendation"
              value={topRecommendation?.recommendedAction || "Add source data"}
              detail={topRecommendation?.summary || "Vaeroex generates stronger recommendations as evidence improves."}
              href={topRecommendation ? generatedOutputHref({ type: "action_plan", source: topRecommendation.id }) : "/app/actions"}
            />
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-[#08111f] p-5 text-slate-100 shadow-panel">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Business memory confidence</p>
          <p className="mt-3 text-4xl font-semibold text-white">{intelligence.dataQuality.score}/100</p>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            {intelligence.dataQuality.label} context. {intelligence.dataQuality.reason}
          </p>
          <dl className="mt-5 grid gap-3 text-sm">
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <dt>Sources</dt>
              <dd className="font-semibold text-white">{intelligence.memorySummary.sourceRecords}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <dt>KPI history</dt>
              <dd className="font-semibold text-white">{intelligence.memorySummary.kpiHistoryRecords}</dd>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.04] p-3">
              <dt>Saved Vaeroex runs</dt>
              <dd className="font-semibold text-white">{intelligence.memorySummary.vaeroexRuns}</dd>
            </div>
          </dl>
        </div>
      </section>

      <BusinessIntelligenceCoveragePanel coverage={businessIntelligenceCoverage} />

      <section className="grid gap-4 xl:grid-cols-2">
        {(["Risk", "Opportunity", "Forecast", "Bottleneck", "Recommendation", "Anomaly"] as IntelligenceInsightType[]).map((type) => {
          const grouped = groupInsights(intelligence.insights, type);

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
                  {type === "Forecast"
                    ? "No forecast is shown yet because Vaeroex needs more historical data before forecasting responsibly."
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
      </section>
    </div>
  );
}
