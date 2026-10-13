// Invoke the same deterministic producers and snapshot consumers as the actual
// Intelligence route. Only storage/auth/provider IO is replaced by local inputs.
import { AS_OF, WORKSPACE_ID, workspace, kpis, performanceKpiSettings, files, imports } from "./data";
import { buildIntelligenceLayer } from "@/lib/intelligence/layer";
import { buildBusinessIntelligenceCoverage } from "@/lib/intelligence/coverage";
import { buildOperationalEvidenceInsights } from "@/lib/intelligence/operational-evidence";
import { buildIntelligenceSnapshotFromProducersV1 } from "@/lib/intelligence/snapshot/v1/composition";
import { projectExecutiveOverviewV1, projectIntelligenceInboxV1 } from "@/lib/intelligence/snapshot/v1/projections";
import { buildExecutiveHomepageFromSnapshotV1 } from "@/lib/intelligence/snapshot/v1/consumers/executive-overview";
import { buildIntelligenceInboxFromSnapshotV1 } from "@/lib/intelligence/snapshot/v1/consumers/intelligence-inbox";
import { buildIntelligenceCardIdentityV1 } from "@/lib/intelligence/card-lifecycle/identity";
import { buildIntelligenceCardLifecycleOverlayV1 } from "@/lib/intelligence/card-lifecycle/overlay";
import { buildBusinessHealthExplanationFromSnapshotV1 } from "@/lib/ai/business-health-explanation/snapshot-context";
import { overviewComparisons } from "@/lib/presentation/overview-comparison";

export function calculatedIntelligence() {
  const sourceParents = { files, imports };
  const operationalInsights = buildOperationalEvidenceInsights({ sourceParents, kpis, kpiSettings: performanceKpiSettings, operationalMetrics: [], memoryChunks: [], files, imports });
  const intelligence = buildIntelligenceLayer({ asOf: AS_OF, workspace, kpis, kpiSettings: performanceKpiSettings, files, imports, sourceParents, operationalInsights });
  const coverage = buildBusinessIntelligenceCoverage({ kpis, files, imports, sourceParents });
  const snapshot = buildIntelligenceSnapshotFromProducersV1({ workspaceId: WORKSPACE_ID, asOf: AS_OF, intelligence, coverage }).snapshot;
  const executiveHomepageModel = buildExecutiveHomepageFromSnapshotV1({ projection: projectExecutiveOverviewV1(snapshot), intelligence, coverage, snapshots: [], kpiTrends: overviewComparisons(kpis, performanceKpiSettings, "Weekly"), sourceDataAvailable: true }).model;
  const { insights } = buildIntelligenceInboxFromSnapshotV1({ projection: projectIntelligenceInboxV1(snapshot), intelligence });
  const identities = Object.fromEntries(insights.map(insight => [insight.id, buildIntelligenceCardIdentityV1({ insight, finding: snapshot.findings.find(finding => finding.id === insight.id) || null })]));
  const lifecycleCards = buildIntelligenceCardLifecycleOverlayV1({ insights, identities, lifecycleRecords: [], nowMs: Date.parse(AS_OF) });
  const businessHealthAnalysisPackage = buildBusinessHealthExplanationFromSnapshotV1({ workspaceId: WORKSPACE_ID, intelligence, homepage: executiveHomepageModel, snapshots: [], coverage, sourceLabelsByKey: Object.fromEntries(files.map(file => [`source-file:${file.id}`, file.display_name])), asOf: AS_OF }).analysisPackage;
  return { healthView: { latestEvidenceUpdate: AS_OF, executiveHomepageModel, businessHealthAnalysisPackage, businessHealthHistory: [], businessHealthExplanationAsOf: AS_OF, businessHealthSnapshotResult: { errorMessage: null }, businessHealthAnalysisState: { status: "unavailable", artifact: null, message: "Generation is not connected in this local capture environment." }, businessHealthAnalysisToken: null }, lifecycleCards, intelligence, coverage, snapshot };
}
