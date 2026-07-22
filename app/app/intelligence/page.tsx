import { IntelligenceSignalInbox } from "@/components/intelligence/IntelligenceSignalInbox";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { filterEligibleMemoryRowsByLifecycle } from "@/lib/ai/evidence-index";
import { buildFindingExplanationPackage } from "@/lib/ai/finding-explanation/context";
import { trySealFindingExplanationPackage } from "@/lib/ai/finding-explanation/token";
import { isFindingExplanationEnabled } from "@/lib/ai/providers/workflow-provider-policy";
import { filterBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
import { buildOperationalEvidenceInsights } from "@/lib/intelligence/operational-evidence";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import { isSecurityResponseMessage } from "@/lib/security/security-response";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type IntelligencePageProps = {
  searchParams?: Promise<{ finding?: string }>;
};

export default async function IntelligencePage({ searchParams }: IntelligencePageProps) {
  const params = await searchParams;
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const [issuesResult, kpisResult, filesResult, reportsResult, runsResult, crmResult, importsResult, sopsResult, formsResult, submissionsResult, peopleResult, decisionsResult, outcomesResult, metricsResult, memoryResult] = await Promise.all([
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("metric_date", { ascending: false }),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("reports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    supabase.from("forms").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("form_submissions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("people").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name"),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("vaeroex_recommendation_outcomes").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("operational_metrics").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(2000),
    supabase.from("business_memory_chunks").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("indexed_at", { ascending: false }).limit(500)
  ]);

  const errors = [
    issuesResult.error,
    kpisResult.error,
    filesResult.error,
    reportsResult.error,
    runsResult.error,
    crmResult.error,
    importsResult.error,
    sopsResult.error,
    formsResult.error,
    submissionsResult.error,
    peopleResult.error,
    decisionsResult.error,
    outcomesResult.error,
    metricsResult.error,
    memoryResult.error
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
      ...(metricsResult.data || [])
    ]
  });
  const sourceParentEligibility = sourceParentResult.eligibility;
  const eligibleKpis = filterBySourceParentEligibility(kpisResult.data || [], sourceParentEligibility);
  const eligibleCustomerEvidence = filterBySourceParentEligibility(crmResult.data || [], sourceParentEligibility);
  const eligibleOperationalMetrics = filterBySourceParentEligibility(metricsResult.data || [], sourceParentEligibility);
  const eligibleRuns = filterBusinessEvidence(runsResult.data || [], { sourceKind: "platform_run" });
  let eligibleMemoryChunks = [] as NonNullable<typeof memoryResult.data>;
  let memoryEligibilityError: Error | null = null;
  try {
    eligibleMemoryChunks = await filterEligibleMemoryRowsByLifecycle({
      supabase,
      workspaceId,
      rows: memoryResult.data || []
    });
  } catch (error) {
    memoryEligibilityError = error instanceof Error ? error : new Error("Business Memory eligibility could not be verified.");
  }
  const operationalInsights = buildOperationalEvidenceInsights({
    kpis: eligibleKpis,
    operationalMetrics: eligibleOperationalMetrics,
    memoryChunks: eligibleMemoryChunks,
    files: filesResult.data || [],
    imports: importsResult.data || []
  });
  const displayErrors = [...errors, sourceParentResult.error, memoryEligibilityError].filter(Boolean) as Array<{ message: string }>;
  const intelligence = buildIntelligenceLayer({
    workspace: context.activeWorkspace,
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
    recommendationOutcomes: outcomesResult.data || [],
    operationalInsights
  });
  const userId = context.membership?.user_id;
  const explanationTokens = isFindingExplanationEnabled() && userId
    ? Object.fromEntries(intelligence.insights.flatMap((insight) => {
        if (!["Risk", "Anomaly", "Bottleneck"].includes(insight.type)) return [];
        try {
          const analysisPackage = buildFindingExplanationPackage({ workspaceId, insight });
          if (!analysisPackage.requiredCitationIds.length) return [];
          const token = trySealFindingExplanationPackage({ analysisPackage, workspaceId, userId });
          return token ? [[insight.id, token]] : [];
        } catch {
          return [];
        }
      }))
    : {};
  return (
    <div className="space-y-4">
      <ErrorNotice message={displayErrors[0]?.message || null} />
      <IntelligenceSignalInbox insights={intelligence.insights} initialFindingId={params?.finding} explanationTokens={explanationTokens} />
    </div>
  );
}
