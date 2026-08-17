import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadApprovedBusinessNoteContextV1 } from "@/lib/ai/business-notes/contextual-evidence";
import { businessNoteReleaseChannel } from "@/lib/ai/business-notes/release-channel";
import { filterEligibleMemoryRowsByLifecycle } from "@/lib/ai/evidence-index";
import { buildIntelligenceBriefingEvidence } from "@/lib/ai/intelligence-briefing/evidence";
import { intelligenceBriefingKpiEvidenceKey } from "@/lib/ai/intelligence-briefing/identity";
import { intelligenceBriefingPeriod } from "@/lib/ai/intelligence-briefing/period";
import type {
  IntelligenceBriefingPackage,
  IntelligenceBriefingType
} from "@/lib/ai/intelligence-briefing/contracts";
import { buildBusinessIntelligenceCoverage } from "@/lib/intelligence/coverage";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
import { buildOperationalEvidenceInsights } from "@/lib/intelligence/operational-evidence";
import {
  filterBySourceParentEligibility,
  loadSourceParentEligibilityResult
} from "@/lib/intelligence/source-parent-eligibility";
import { projectIntelligenceBriefingV1 } from "@/lib/intelligence/snapshot/v1/briefing-projection";
import { buildIntelligenceSnapshotFromProducersV1 } from "@/lib/intelligence/snapshot/v1/composition";
import { loadActiveWorkspaceKpis } from "@/lib/kpis/load-workspace-kpis";
import { buildCanonicalKpiProducerOutputV1 } from "@/lib/kpis/snapshot-producer";
import type { Database } from "@/lib/supabase/types";

type WorkspaceShape = Readonly<{
  name?: string | null;
  industry?: string | null;
  size?: string | null;
}>;

function queryFailure(errors: readonly ({ message: string } | null | undefined)[]) {
  return errors.find(Boolean)?.message || null;
}

export async function buildWorkspaceIntelligenceBriefingPackage({
  supabase,
  workspaceId,
  workspace,
  briefingType,
  asOf = new Date().toISOString(),
  previousBriefing = null
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  workspace: WorkspaceShape;
  briefingType: IntelligenceBriefingType;
  asOf?: string;
  previousBriefing?: IntelligenceBriefingPackage["previousBriefing"];
}) {
  if (!Number.isFinite(Date.parse(asOf))) throw new Error("Intelligence briefing as-of time is invalid.");
  const period = intelligenceBriefingPeriod(briefingType, new Date(asOf));
  const [
    issuesResult,
    kpisResult,
    settingsResult,
    filesResult,
    crmResult,
    crmHistoryResult,
    importsResult,
    sopsResult,
    formsResult,
    submissionsResult,
    peopleResult,
    decisionsResult,
    metricsResult,
    memoryResult,
    assetsResult
  ] = await Promise.all([
    supabase.from("issues").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    loadActiveWorkspaceKpis({ supabase, workspaceId }),
    supabase.from("kpi_settings").select("*").eq("workspace_id", workspaceId).order("sort_order", { ascending: true }).order("weight", { ascending: false }),
    supabase.from("file_uploads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("crm_leads").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("crm_lead_history").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("file_imports").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("sops").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
    supabase.from("forms").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("form_submissions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("people").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("full_name"),
    supabase.from("business_decisions").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }),
    supabase.from("operational_metrics").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("created_at", { ascending: false }).limit(2000),
    supabase.from("business_memory_chunks").select("*").eq("workspace_id", workspaceId).is("archived_at", null).is("deleted_at", null).order("indexed_at", { ascending: false }).limit(500),
    supabase.from("assets").select("*").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false })
  ]);
  const error = queryFailure([
    issuesResult.error,
    kpisResult.error,
    settingsResult.error,
    filesResult.error,
    crmResult.error,
    crmHistoryResult.error,
    importsResult.error,
    sopsResult.error,
    formsResult.error,
    submissionsResult.error,
    peopleResult.error,
    decisionsResult.error,
    metricsResult.error,
    memoryResult.error,
    assetsResult.error
  ]);
  if (error) throw new Error("Intelligence briefing evidence could not be loaded safely.");

  const rawKpis = kpisResult.data || [];
  const rawCustomers = crmResult.data || [];
  const rawMetrics = metricsResult.data || [];
  const sourceParent = await loadSourceParentEligibilityResult({
    supabase,
    workspaceId,
    rows: [...rawKpis, ...rawCustomers, ...rawMetrics]
  });
  if (sourceParent.error) throw new Error("Intelligence briefing source lifecycle could not be verified.");
  const kpis = filterBySourceParentEligibility(rawKpis, sourceParent.eligibility);
  const customers = filterBySourceParentEligibility(rawCustomers, sourceParent.eligibility);
  const operationalMetrics = filterBySourceParentEligibility(rawMetrics, sourceParent.eligibility);
  const memoryChunks = await filterEligibleMemoryRowsByLifecycle({
    supabase,
    workspaceId,
    rows: memoryResult.data || []
  });
  const settings = settingsResult.data || [];
  const files = filesResult.data || [];
  const imports = importsResult.data || [];
  const operationalInsights = buildOperationalEvidenceInsights({
    kpis,
    kpiSettings: settings,
    operationalMetrics,
    memoryChunks,
    files,
    imports
  });
  const intelligence = buildIntelligenceLayer({
    asOf,
    workspace,
    issues: issuesResult.data || [],
    kpis,
    kpiSettings: settings,
    files,
    crmLeads: customers,
    imports,
    sops: sopsResult.data || [],
    forms: formsResult.data || [],
    submissions: submissionsResult.data || [],
    people: peopleResult.data || [],
    decisions: decisionsResult.data || [],
    operationalInsights
  });
  const coverage = buildBusinessIntelligenceCoverage({
    kpis,
    issues: issuesResult.data || [],
    files,
    imports,
    sops: sopsResult.data || [],
    forms: formsResult.data || [],
    submissions: submissionsResult.data || [],
    people: peopleResult.data || [],
    crmLeads: customers,
    crmHistory: crmHistoryResult.data || [],
    operationalMetrics,
    assets: assetsResult.data || [],
    decisions: decisionsResult.data || [],
    memoryChunks
  });
  const releaseChannel = businessNoteReleaseChannel();
  const businessNotes = await loadApprovedBusinessNoteContextV1({
    supabase,
    workspaceId,
    releaseChannel,
    asOf
  });
  if (businessNotes.error) throw new Error("Approved Business Note context could not be loaded safely.");
  const sourceLabelsById = Object.fromEntries(files.map((file) => [file.id, file.display_name]));
  const evidence = buildIntelligenceBriefingEvidence({
    workspaceId,
    period,
    kpiRows: kpis,
    kpiSettings: settings,
    insights: intelligence.insights,
    sourceLabelsById,
    generatedAt: asOf
  });
  const periodKpis = kpis.filter((row) => row.metric_date >= period.start && row.metric_date <= period.end);
  const kpiProducer = buildCanonicalKpiProducerOutputV1({
    workspaceId,
    rows: periodKpis,
    settings,
    asOf
  }).map((metric) => ({
    ...metric,
    evidenceReferenceIds: evidence.evidenceReferenceIdsByMetric.get(intelligenceBriefingKpiEvidenceKey(metric.semantics)) || []
  }));
  const snapshot = buildIntelligenceSnapshotFromProducersV1({
    workspaceId,
    asOf,
    intelligence,
    coverage,
    evidenceManifests: [evidence.manifest],
    ...(businessNotes.records.length ? {
      contextualEvidence: { releaseChannel, records: businessNotes.records }
    } : {}),
    kpis: kpiProducer
  });
  const briefingPackage = projectIntelligenceBriefingV1({
    snapshot: snapshot.snapshot,
    briefingType,
    period,
    manifest: evidence.manifest,
    citationIdsByMetric: evidence.citationIdsByMetric,
    citationIdsByFinding: evidence.citationIdsByFinding,
    hrefByCandidateId: evidence.hrefByCandidateId,
    sourceLabelByCandidateId: evidence.sourceLabelByCandidateId,
    previousBriefing
  });
  return { briefingPackage, snapshot: snapshot.snapshot, receipt: snapshot.receipt };
}
