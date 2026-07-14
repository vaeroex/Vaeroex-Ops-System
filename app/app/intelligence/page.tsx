import { IntelligenceSignalInbox } from "@/components/intelligence/IntelligenceSignalInbox";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { filterBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
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
  const [tasksResult, issuesResult, kpisResult, filesResult, reportsResult, runsResult, crmResult, importsResult, sopsResult, formsResult, submissionsResult, peopleResult, decisionsResult, outcomesResult] = await Promise.all([
    supabase.from("tasks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
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
    supabase.from("vaeroex_recommendation_outcomes").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false })
  ]);

  const errors = [
    tasksResult.error,
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
    outcomesResult.error
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
      ...(crmResult.data || [])
    ]
  });
  const sourceParentEligibility = sourceParentResult.eligibility;
  const displayErrors = [...errors, sourceParentResult.error].filter(Boolean) as Array<{ message: string }>;
  const eligibleKpis = filterBySourceParentEligibility(kpisResult.data || [], sourceParentEligibility);
  const eligibleCustomerEvidence = filterBySourceParentEligibility(crmResult.data || [], sourceParentEligibility);
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
  return (
    <div className="space-y-4">
      <ErrorNotice message={displayErrors[0]?.message || null} />
      <IntelligenceSignalInbox insights={intelligence.insights} initialFindingId={params?.finding} />
    </div>
  );
}
