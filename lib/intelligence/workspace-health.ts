import "server-only";

import type { BusinessHealthTrendPoint } from "@/components/intelligence/BusinessHealthTrendChart";
import { filterEligibleMemoryRowsByLifecycle } from "@/lib/ai/evidence-index";
import { loadApprovedBusinessNoteContextV1 } from "@/lib/ai/business-notes/contextual-evidence";
import { businessNoteReleaseChannel } from "@/lib/ai/business-notes/release-channel";
import { buildBusinessHealthExplanationFromSnapshotV1 } from "@/lib/ai/business-health-explanation/snapshot-context";
import { loadBusinessHealthAnalysisState } from "@/lib/ai/business-health-explanation/storage";
import { trySealBusinessHealthExplanationPackage } from "@/lib/ai/business-health-explanation/token";
import {
  businessHealthSnapshotCalculationVersion,
  getBusinessHealthSnapshotResult,
  recordDailyBusinessHealthSnapshot
} from "@/lib/intelligence/business-health-history";
import { excludeChecklistDerivedMetrics, excludeChecklistDerivedRecords } from "@/lib/intelligence/checklist-retirement";
import { buildBusinessIntelligenceCoverage } from "@/lib/intelligence/coverage";
import { evidenceLineageMetadata, filterBusinessEvidence } from "@/lib/intelligence/evidence-eligibility";
import { buildExecutiveHomepageModel } from "@/lib/intelligence/executive-homepage";
import { filterBySourceParentEligibility, loadSourceParentEligibilityResult } from "@/lib/intelligence/source-parent-eligibility";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
import { buildOperationalEvidenceInsights } from "@/lib/intelligence/operational-evidence";
import {
  buildOverviewRunCompatibility,
  latestOverviewEvidenceUpdate,
  type OverviewCompatibilityRun
} from "@/lib/intelligence/overview-run-compatibility";
import { buildIntelligenceSnapshotFromProducersV1 } from "@/lib/intelligence/snapshot/v1/composition";
import { buildExecutiveHomepageFromSnapshotV1 } from "@/lib/intelligence/snapshot/v1/consumers/executive-overview";
import { projectExecutiveOverviewV1 } from "@/lib/intelligence/snapshot/v1/projections";
import { applyKpiSettingsToRows, sortKpiRowsBySettings, type KpiSettingRow } from "@/lib/kpis/settings";
import { loadActiveWorkspaceKpis } from "@/lib/kpis/load-workspace-kpis";
import type { Database } from "@/lib/supabase/types";

type KpiRow = Database["public"]["Tables"]["kpis"]["Row"];
type IssueRow = Database["public"]["Tables"]["issues"]["Row"];
type SopRow = Database["public"]["Tables"]["sops"]["Row"];
type FileUploadRow = Database["public"]["Tables"]["file_uploads"]["Row"];
type FileImportRow = Database["public"]["Tables"]["file_imports"]["Row"];
type AssetRow = Database["public"]["Tables"]["assets"]["Row"];
type CrmLeadRow = Database["public"]["Tables"]["crm_leads"]["Row"];
type CrmLeadHistoryRow = Database["public"]["Tables"]["crm_lead_history"]["Row"];
type OperationalMetricRow = Database["public"]["Tables"]["operational_metrics"]["Row"];
type PersonRow = Database["public"]["Tables"]["people"]["Row"];
type BusinessDecisionRow = Database["public"]["Tables"]["business_decisions"]["Row"];
type BusinessMemoryChunkRow = Database["public"]["Tables"]["business_memory_chunks"]["Row"];

type WorkspaceHealthQueryInput = {
  supabase: Parameters<typeof loadActiveWorkspaceKpis>[0]["supabase"];
  workspaceId: string;
};

export type WorkspaceHealthComparisonTrend = Parameters<typeof buildExecutiveHomepageModel>[0]["kpiTrends"][number];

// Request-scoped authenticated client only: callers keep their workspace access
// gate. No service credentials or cross-request cache are introduced here.
export async function loadWorkspaceHealthEvidence({ supabase, workspaceId }: WorkspaceHealthQueryInput) {
  const [
    kpiResult,
    kpiSettingsResult,
    issueResult,
    sopResult,
    fileResult,
    importResult,
    assetResult,
    crmLeadResult,
    crmHistoryResult,
    vaeroexRunResult,
    metricResult,
    peopleResult,
    decisionResult,
    memoryChunksResult,
    formResult,
    submissionResult
  ] = await Promise.all([
    loadActiveWorkspaceKpis({ supabase, workspaceId }),
    supabase.from("kpi_settings").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true }).order("weight", { ascending: false }),
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(200),
    supabase.from("assets").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase.from("crm_lead_history").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(300),
    supabase
      .from("ai_agent_runs")
      .select("agent_type,input_json,output_json,status,error_message,created_at,updated_at,archived_at,deleted_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("operational_metrics").select("*").eq("workspace_id", workspaceId).order("metric_date", { ascending: false }).limit(500),
    supabase.from("people").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name").limit(100),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(30),
    supabase.from("business_memory_chunks").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).is("archived_at", null).limit(500),
    supabase.from("forms").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }).limit(200),
    supabase.from("form_submissions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(500)
  ]);

  const rawKpis = (kpiResult.data || []) as KpiRow[];
  const rawCrmLeads = (crmLeadResult.data || []) as CrmLeadRow[];
  const rawCrmHistory = (crmHistoryResult.data || []) as CrmLeadHistoryRow[];
  const rawOperationalMetrics = (metricResult.data || []) as OperationalMetricRow[];
  const sourceParentResult = await loadSourceParentEligibilityResult({
    supabase,
    workspaceId,
    rows: [...rawKpis, ...rawCrmLeads, ...rawCrmHistory, ...rawOperationalMetrics, ...(memoryChunksResult.data || [])]
  });
  const sourceParentEligibility = sourceParentResult.eligibility;
  const kpiSettings = (kpiSettingsResult.data || []) as KpiSettingRow[];
  const kpis = filterBySourceParentEligibility(
    filterBusinessEvidence(sortKpiRowsBySettings(applyKpiSettingsToRows(rawKpis, kpiSettings), kpiSettings) as KpiRow[]),
    sourceParentEligibility
  );
  const intelligenceKpis = excludeChecklistDerivedMetrics(kpis);
  const intelligenceKpiSettings = excludeChecklistDerivedMetrics(kpiSettings);
  const issues = excludeChecklistDerivedRecords(filterBusinessEvidence((issueResult.data || []) as IssueRow[]));
  const sops = filterBusinessEvidence((sopResult.data || []) as SopRow[]);
  const files = filterBusinessEvidence((fileResult.data || []) as FileUploadRow[]);
  const activeFileIds = new Set(files.map((file) => file.id));
  const imports = filterBusinessEvidence((importResult.data || []) as FileImportRow[])
    .filter((item) => activeFileIds.has(item.file_upload_id));
  const assets = filterBusinessEvidence((assetResult.data || []) as AssetRow[]);
  const crmLeads = filterBySourceParentEligibility(filterBusinessEvidence(rawCrmLeads), sourceParentEligibility);
  const activeCustomerEvidenceIds = new Set(crmLeads.map((lead) => lead.id));
  const crmHistory = filterBySourceParentEligibility(filterBusinessEvidence(rawCrmHistory), sourceParentEligibility)
    .filter((history) => activeCustomerEvidenceIds.has(history.lead_id));
  const overviewRunCompatibility = buildOverviewRunCompatibility(
    (vaeroexRunResult.data || []) as OverviewCompatibilityRun[]
  );
  const operationalMetrics = filterBySourceParentEligibility(filterBusinessEvidence(rawOperationalMetrics), sourceParentEligibility);
  const intelligenceOperationalMetrics = excludeChecklistDerivedMetrics(operationalMetrics);
  const people = filterBusinessEvidence((peopleResult.data || []) as PersonRow[]);
  const decisions = filterBusinessEvidence((decisionResult.data || []) as BusinessDecisionRow[]);
  let memoryChunks = [] as BusinessMemoryChunkRow[];
  let memoryEligibilityError: Error | null = null;
  try {
    memoryChunks = await filterEligibleMemoryRowsByLifecycle({
      supabase,
      workspaceId,
      rows: (memoryChunksResult.data || []) as BusinessMemoryChunkRow[]
    }) as BusinessMemoryChunkRow[];
  } catch (error) {
    memoryEligibilityError = error instanceof Error ? error : new Error("Business Memory eligibility could not be verified.");
  }
  const queryErrors = [
    kpiResult.error,
    kpiSettingsResult.error,
    issueResult.error,
    sopResult.error,
    fileResult.error,
    importResult.error,
    assetResult.error,
    crmLeadResult.error,
    crmHistoryResult.error,
    vaeroexRunResult.error,
    metricResult.error,
    peopleResult.error,
    decisionResult.error,
    memoryChunksResult.error,
    formResult.error,
    submissionResult.error,
    sourceParentResult.error,
    memoryEligibilityError
  ];
  const businessHealthSourceErrors = [
    kpiResult.error,
    kpiSettingsResult.error,
    issueResult.error,
    sopResult.error,
    fileResult.error,
    importResult.error,
    assetResult.error,
    crmLeadResult.error,
    crmHistoryResult.error,
    vaeroexRunResult.error,
    metricResult.error,
    peopleResult.error,
    decisionResult.error,
    memoryChunksResult.error,
    sourceParentResult.error,
    memoryEligibilityError
  ].filter(Boolean);
  return {
    kpis,
    kpiSettings,
    intelligenceKpis,
    intelligenceKpiSettings,
    issues,
    sops,
    files,
    imports,
    assets,
    crmLeads,
    crmHistory,
    operationalMetrics,
    intelligenceOperationalMetrics,
    people,
    decisions,
    memoryChunks,
    forms: formResult.data || [],
    submissions: submissionResult.data || [],
    overviewRunCompatibility,
    sourceParentResult,
    queryErrors,
    errors: queryErrors.filter(Boolean),
    businessHealthSourceErrors
  };
}

export type WorkspaceHealthEvidence = Awaited<ReturnType<typeof loadWorkspaceHealthEvidence>>;

type WorkspaceHealthViewInput = WorkspaceHealthQueryInput & {
  workspace: Parameters<typeof buildIntelligenceLayer>[0]["workspace"];
  userId: string | null;
  evidence: WorkspaceHealthEvidence;
  comparisonTrends?: WorkspaceHealthComparisonTrend[];
  includeAnalysis?: boolean;
};

// Overview supplies its period-specific changes; the Health formula, history
// and evidence package are shared with Intelligence without a second calculator.
export async function buildWorkspaceHealthView({
  supabase,
  workspaceId,
  workspace,
  userId,
  evidence,
  comparisonTrends = [],
  includeAnalysis = true
}: WorkspaceHealthViewInput) {
  const {
    intelligenceKpis,
    intelligenceKpiSettings,
    issues,
    sops,
    files,
    imports,
    assets,
    crmLeads,
    intelligenceOperationalMetrics,
    people,
    decisions,
    memoryChunks,
    forms,
    submissions,
    overviewRunCompatibility,
    sourceParentResult,
    businessHealthSourceErrors
  } = evidence;
  const operationalInsights = buildOperationalEvidenceInsights({
    sourceParents: sourceParentResult.eligibility.records,
    kpis: intelligenceKpis,
    kpiSettings: intelligenceKpiSettings,
    operationalMetrics: intelligenceOperationalMetrics,
    memoryChunks,
    files,
    imports
  });
  const businessHealthExplanationAsOf = new Date().toISOString();
  const intelligenceLayer = buildIntelligenceLayer({
    sourceParents: sourceParentResult.eligibility.records,
    asOf: businessHealthExplanationAsOf,
    workspace,
    kpis: intelligenceKpis,
    kpiSettings: intelligenceKpiSettings,
    issues,
    files,
    crmLeads,
    imports,
    sops,
    forms,
    submissions,
    people,
    decisions,
    operationalInsights
  });
  const businessHealthMemorySignals = intelligenceLayer.memorySummary.sourceRecords + intelligenceLayer.memorySummary.kpiHistoryRecords;
  if (!businessHealthSourceErrors.length && intelligenceLayer.businessHealth.available) {
    await recordDailyBusinessHealthSnapshot(supabase, {
      workspaceId,
      score: intelligenceLayer.businessHealth.score,
      status: intelligenceLayer.businessHealth.status,
      trend: intelligenceLayer.businessHealth.trend,
      dataConfidence: intelligenceLayer.dataQuality.confidence,
      dataQualityScore: intelligenceLayer.dataQuality.score,
      memorySignalCount: businessHealthMemorySignals,
      sourceSummary: {
        kpis: intelligenceKpis.length,
        files: files.length,
        issues: issues.length,
        crm_leads: crmLeads.length,
        business_memory_signals: businessHealthMemorySignals,
        vaeroex_runs: overviewRunCompatibility.snapshotSourceCount,
        performance_baseline: intelligenceLayer.businessHealth.components.dataQualityBase,
        positive_performance: intelligenceLayer.businessHealth.components.opportunityAdjustment,
        negative_performance: intelligenceLayer.businessHealth.components.riskPenalty,
        ...evidenceLineageMetadata({ sourceType: "business_health_snapshot" })
      }
    });
  }
  const businessHealthSnapshotResult = await getBusinessHealthSnapshotResult(supabase, workspaceId);
  const businessHealthHistory: BusinessHealthTrendPoint[] = businessHealthSnapshotResult.snapshots.map((snapshot) => ({
    snapshotDate: snapshot.snapshot_date,
    score: snapshot.score,
    status: snapshot.status,
    trend: snapshot.trend,
    calculationVersion: businessHealthSnapshotCalculationVersion(snapshot)
  }));
  const businessIntelligenceCoverage = buildBusinessIntelligenceCoverage({
    sourceParents: sourceParentResult.eligibility.records,
    kpis: intelligenceKpis,
    issues,
    files,
    imports,
    sops,
    crmLeads,
    overviewRunCompatibility,
    operationalMetrics: intelligenceOperationalMetrics,
    assets,
    people,
    decisions,
    memoryChunks
  });
  const latestEvidenceUpdate = latestOverviewEvidenceUpdate([
    ...intelligenceKpis.map((row) => row.updated_at || row.created_at),
    ...issues.map((row) => row.updated_at || row.created_at),
    ...files.map((row) => row.updated_at || row.created_at),
    ...decisions.map((row) => row.updated_at || row.created_at)
  ], overviewRunCompatibility);
  let executiveHomepageModel: ReturnType<typeof buildExecutiveHomepageModel>;
  try {
    const executiveOverviewSnapshot = buildIntelligenceSnapshotFromProducersV1({
      workspaceId,
      asOf: businessHealthExplanationAsOf,
      intelligence: intelligenceLayer,
      coverage: businessIntelligenceCoverage
    });
    const executiveOverviewProjection = projectExecutiveOverviewV1(executiveOverviewSnapshot.snapshot);
    executiveHomepageModel = buildExecutiveHomepageFromSnapshotV1({
      projection: executiveOverviewProjection,
      intelligence: intelligenceLayer,
      coverage: businessIntelligenceCoverage,
      snapshots: businessHealthSnapshotResult.snapshots,
      kpiTrends: comparisonTrends,
      sourceDataAvailable: businessHealthSourceErrors.length === 0
    }).model;
  } catch (error) {
    if (process.env.VERCEL_ENV !== "preview") throw error;
    console.error(JSON.stringify({
      level: "error",
      component: "executive-overview",
      event: "snapshot_v1_projection_fallback",
      classification: "adapter_defect",
      reason: error instanceof Error ? error.message : "snapshot_construction_failed"
    }));
    executiveHomepageModel = buildExecutiveHomepageModel({
      intelligence: intelligenceLayer,
      coverage: businessIntelligenceCoverage,
      snapshots: businessHealthSnapshotResult.snapshots,
      kpiTrends: comparisonTrends,
      sourceDataAvailable: businessHealthSourceErrors.length === 0
    });
  }
  const executiveSourceLabelsByKey = Object.fromEntries([
    ...files.map((file) => [`source-file:${file.id}`, file.display_name]),
    ...imports.flatMap((item) => {
      const source = files.find((file) => file.id === item.file_upload_id);
      return source ? [[`import:${item.id}`, source.display_name] as const] : [];
    })
  ]);
  const businessNoteContextReleaseChannel = businessNoteReleaseChannel();
  const businessNoteContext = await loadApprovedBusinessNoteContextV1({
    supabase,
    workspaceId,
    releaseChannel: businessNoteContextReleaseChannel,
    asOf: businessHealthExplanationAsOf
  });
  if (businessNoteContext.error) {
    console.error(JSON.stringify({
      level: "error",
      component: "business-health-explanation",
      event: "business_note_context_load_failed",
      reason: businessNoteContext.error.message
    }));
  }
  const businessHealthExplanationSnapshot = buildBusinessHealthExplanationFromSnapshotV1({
    workspaceId,
    intelligence: intelligenceLayer,
    homepage: executiveHomepageModel,
    snapshots: businessHealthSnapshotResult.snapshots,
    coverage: businessIntelligenceCoverage,
    ...(businessNoteContext.records.length ? {
      contextualEvidence: {
        releaseChannel: businessNoteContextReleaseChannel,
        records: businessNoteContext.records
      }
    } : {}),
    sourceLabelsByKey: executiveSourceLabelsByKey,
    asOf: businessHealthExplanationAsOf
  });
  const businessHealthAnalysisPackage = businessHealthExplanationSnapshot.analysisPackage;
  const businessHealthAnalysisToken = userId && includeAnalysis
    ? trySealBusinessHealthExplanationPackage({
        analysisPackage: businessHealthAnalysisPackage,
        workspaceId,
        userId
      })
    : null;
  const businessHealthAnalysisState = includeAnalysis
    ? await loadBusinessHealthAnalysisState({
        supabase,
        workspaceId,
        analysisPackage: businessHealthAnalysisPackage,
        requestTokenAvailable: Boolean(businessHealthAnalysisToken)
      })
    : { status: "available" as const, artifact: null, message: null };
  return {
    executiveHomepageModel,
    intelligenceLayer,
    operationalInsights,
    businessIntelligenceCoverage,
    latestEvidenceUpdate,
    businessHealthExplanationAsOf,
    businessHealthHistory,
    businessHealthSnapshotResult,
    businessHealthAnalysisPackage,
    businessHealthAnalysisToken,
    businessHealthAnalysisState,
    errors: evidence.errors
  };
}

export type WorkspaceHealthView = Awaited<ReturnType<typeof buildWorkspaceHealthView>>;

export async function loadWorkspaceHealth(input: Omit<WorkspaceHealthViewInput, "evidence">) {
  const evidence = await loadWorkspaceHealthEvidence(input);
  return { evidence, ...await buildWorkspaceHealthView({ ...input, evidence }) };
}
