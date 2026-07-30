import { IntelligenceSignalInbox } from "@/components/intelligence/IntelligenceSignalInbox";
import { ErrorNotice } from "@/components/operations/ErrorNotice";
import { SecurityResponseNotice } from "@/components/security/SecurityResponseNotice";
import { filterEligibleMemoryRowsByLifecycle } from "@/lib/ai/evidence-index";
import { loadApprovedBusinessNoteContextV1 } from "@/lib/ai/business-notes/contextual-evidence";
import { businessNoteReleaseChannel } from "@/lib/ai/business-notes/release-channel";
import { buildFindingExplanationPackage } from "@/lib/ai/finding-explanation/context";
import { buildFindingExplanationFromSnapshotV1 } from "@/lib/ai/finding-explanation/snapshot-context";
import { trySealFindingExplanationPackage } from "@/lib/ai/finding-explanation/token";
import { isFindingExplanationEnabled } from "@/lib/ai/providers/workflow-provider-policy";
import { filterBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
import { buildOperationalEvidenceInsights } from "@/lib/intelligence/operational-evidence";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import { buildIntelligenceSnapshotFromProducersV1 } from "@/lib/intelligence/snapshot/v1/composition";
import { buildIntelligenceInboxFromSnapshotV1 } from "@/lib/intelligence/snapshot/v1/consumers/intelligence-inbox";
import { projectIntelligenceInboxV1 } from "@/lib/intelligence/snapshot/v1/projections";
import type { IntelligenceSnapshotV1 } from "@/lib/intelligence/snapshot/v1/types";
import { isSecurityResponseMessage } from "@/lib/security/security-response";
import { requireWorkspacePage } from "@/lib/workspaces/page-context";

export const dynamic = "force-dynamic";

type IntelligencePageProps = {
  searchParams?: Promise<{ finding?: string }>;
};

export default async function IntelligencePage({ searchParams }: IntelligencePageProps) {
  const params = await searchParams;
  const { supabase, workspaceId, context } = await requireWorkspacePage();
  const [issuesResult, kpisResult, kpiSettingsResult, filesResult, runsResult, crmResult, importsResult, sopsResult, formsResult, submissionsResult, peopleResult, decisionsResult, metricsResult, memoryResult] = await Promise.all([
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("kpis").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("metric_date", { ascending: false }),
    supabase.from("kpi_settings").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true }).order("weight", { ascending: false }),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("ai_agent_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    supabase.from("forms").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("form_submissions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("people").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name"),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("operational_metrics").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(2000),
    supabase.from("business_memory_chunks").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("indexed_at", { ascending: false }).limit(500)
  ]);

  const errors = [
    issuesResult.error,
    kpisResult.error,
    kpiSettingsResult.error,
    filesResult.error,
    runsResult.error,
    crmResult.error,
    importsResult.error,
    sopsResult.error,
    formsResult.error,
    submissionsResult.error,
    peopleResult.error,
    decisionsResult.error,
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
    kpiSettings: kpiSettingsResult.data || [],
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
    kpiSettings: kpiSettingsResult.data || [],
    files: filesResult.data || [],
    vaeroexRuns: eligibleRuns,
    crmLeads: eligibleCustomerEvidence,
    imports: importsResult.data || [],
    sops: sopsResult.data || [],
    forms: formsResult.data || [],
    submissions: submissionsResult.data || [],
    people: peopleResult.data || [],
    decisions: decisionsResult.data || [],
    operationalInsights
  });
  const snapshotAsOf = new Date().toISOString();
  const businessNoteContextReleaseChannel = businessNoteReleaseChannel();
  const businessNoteContext = await loadApprovedBusinessNoteContextV1({
    supabase,
    workspaceId,
    releaseChannel: businessNoteContextReleaseChannel,
    asOf: snapshotAsOf
  });
  if (businessNoteContext.error) {
    console.error(JSON.stringify({
      level: "error",
      component: "finding-explanation",
      event: "business_note_context_load_failed",
      reason: businessNoteContext.error.message
    }));
  }
  let intelligenceSnapshot: IntelligenceSnapshotV1 | null = null;
  let displayedInsights = intelligence.insights;
  try {
    const snapshotBuild = buildIntelligenceSnapshotFromProducersV1({
      workspaceId,
      asOf: snapshotAsOf,
      intelligence,
      ...(businessNoteContext.records.length ? {
        contextualEvidence: {
          releaseChannel: businessNoteContextReleaseChannel,
          records: businessNoteContext.records
        }
      } : {})
    });
    intelligenceSnapshot = snapshotBuild.snapshot;
    const inbox = buildIntelligenceInboxFromSnapshotV1({
      projection: projectIntelligenceInboxV1(snapshotBuild.snapshot),
      intelligence
    });
    displayedInsights = inbox.insights;
  } catch (error) {
    if (process.env.VERCEL_ENV !== "preview") throw error;
    console.error(JSON.stringify({
      level: "error",
      component: "intelligence-inbox",
      event: "snapshot_v1_projection_fallback",
      classification: "adapter_defect",
      reason: error instanceof Error ? error.message : "snapshot_construction_failed"
    }));
  }
  const userId = context.membership?.user_id;
  const explanationTokens = isFindingExplanationEnabled() && userId
    ? Object.fromEntries(displayedInsights.flatMap((insight) => {
        if (!["Risk", "Anomaly", "Bottleneck"].includes(insight.type)) return [];
        try {
          const analysisPackage = intelligenceSnapshot
            ? buildFindingExplanationFromSnapshotV1({
                workspaceId,
                insight,
                snapshot: intelligenceSnapshot,
                now: new Date(snapshotAsOf)
              }).analysisPackage
            : buildFindingExplanationPackage({ workspaceId, insight, now: new Date(snapshotAsOf) });
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
      <IntelligenceSignalInbox insights={displayedInsights} initialFindingId={params?.finding} explanationTokens={explanationTokens} />
    </div>
  );
}
