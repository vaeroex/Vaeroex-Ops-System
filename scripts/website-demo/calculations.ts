// Invoke the same deterministic producers and snapshot consumers as the actual
// Intelligence route. Only storage/auth/provider IO is replaced by local inputs.
import { AS_OF, WORKSPACE_ID, workspace, kpis, performanceKpiSettings, files, imports, operationalMetrics } from "./data";
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
import { recordDailyBusinessHealthSnapshot, businessHealthSnapshotCalculationVersion, type BusinessHealthSnapshotRow } from "@/lib/intelligence/business-health-history";
import { contextualRecords } from "./context";
import { overviewComparisons } from "@/lib/presentation/overview-comparison";

function producers(asOf: string) {
  const datedKpis = kpis.filter(row => row.metric_date <= asOf.slice(0,10));
  const datedFiles = files.filter(row => row.created_at <= asOf);
  const datedImports = imports.filter(row => row.created_at <= asOf);
  const datedMetrics = operationalMetrics.filter(row => row.metric_date <= asOf.slice(0,10));
  const sourceParents = { files: datedFiles, imports: datedImports };
  const operationalInsights = buildOperationalEvidenceInsights({ sourceParents, kpis: datedKpis, kpiSettings: performanceKpiSettings, operationalMetrics: datedMetrics, memoryChunks: [], files: datedFiles, imports: datedImports });
  const intelligence = buildIntelligenceLayer({ asOf, workspace, kpis: datedKpis, kpiSettings: performanceKpiSettings, files: datedFiles, imports: datedImports, sourceParents, operationalInsights });
  const coverage = buildBusinessIntelligenceCoverage({ kpis: datedKpis, files: datedFiles, imports: datedImports, sourceParents, operationalMetrics: datedMetrics });
  const snapshot = buildIntelligenceSnapshotFromProducersV1({ workspaceId: WORKSPACE_ID, asOf, intelligence, coverage, contextualEvidence: {releaseChannel: "production", records: contextualRecords.filter(record=>record.approvedAt <= asOf)} }).snapshot;
  return { intelligence, coverage, snapshot };
}

export function calculatedIntelligence() {
  const { intelligence, coverage, snapshot } = producers(AS_OF);
  const snapshots = historicalReviews();
  const executiveHomepageModel = buildExecutiveHomepageFromSnapshotV1({ projection: projectExecutiveOverviewV1(snapshot), intelligence, coverage, snapshots, kpiTrends: overviewComparisons(kpis, performanceKpiSettings, "Weekly"), sourceDataAvailable: true }).model;
  const { insights } = buildIntelligenceInboxFromSnapshotV1({ projection: projectIntelligenceInboxV1(snapshot), intelligence });
  const identities = Object.fromEntries(insights.map(insight => [insight.id, buildIntelligenceCardIdentityV1({ insight, finding: snapshot.findings.find(finding => finding.id === insight.id) || null })]));
  const lifecycleCards = buildIntelligenceCardLifecycleOverlayV1({ insights, identities, lifecycleRecords: [], nowMs: Date.parse(AS_OF) });
  const businessHealthAnalysisPackage = buildBusinessHealthExplanationFromSnapshotV1({ workspaceId: WORKSPACE_ID, intelligence, homepage: executiveHomepageModel, snapshots, coverage, sourceLabelsByKey: Object.fromEntries(files.map(file => [`source-file:${file.id}`, file.display_name])), asOf: AS_OF }).analysisPackage;
  return { healthView: { latestEvidenceUpdate: AS_OF, executiveHomepageModel, businessHealthAnalysisPackage, businessHealthHistory: snapshots.map(row => ({snapshotDate: row.snapshot_date, score: row.score, status: row.status, trend: row.trend, calculationVersion: businessHealthSnapshotCalculationVersion(row)})), businessHealthExplanationAsOf: AS_OF, businessHealthSnapshotResult: { errorMessage: null }, businessHealthAnalysisState: { status: "unavailable", artifact: null, message: "Generation is not connected in this local capture environment." }, businessHealthAnalysisToken: null }, lifecycleCards, intelligence, coverage, snapshot, snapshots };
}

// Replay the real daily recorder against a closed in-memory sink. No database or
// production credential is present. Both values and version metadata come from
// normal producers/recordDailyBusinessHealthSnapshot, never authored scores.
function historicalReviews() {
  const rows: BusinessHealthSnapshotRow[] = [];
  const RealDate = Date;
  for (const day of ["2026-08-31", "2026-09-28", "2026-10-05"]) {
    const asOf = `${day}T18:00:00.000Z`;
    const Clock = function(this: unknown, ...args: unknown[]) { return new.target ? Reflect.construct(RealDate, args.length ? args : [asOf], new.target) : new RealDate(asOf).toString(); };
    Clock.prototype = RealDate.prototype; Object.setPrototypeOf(Clock, RealDate);
    Object.defineProperty(Clock, "now", {value: () => RealDate.parse(asOf)});
    globalThis.Date = Clock as unknown as DateConstructor;
    try {
      const {intelligence} = producers(asOf);
      const sink = { from(table: string) {
        if (table !== "business_health_snapshots") throw new Error("Unexpected historical table");
        return {upsert(row: BusinessHealthSnapshotRow, options: {ignoreDuplicates: boolean; onConflict: string}) {
          if (row.workspace_id !== WORKSPACE_ID || !options.ignoreDuplicates || options.onConflict !== "workspace_id,snapshot_date") throw new Error("Invalid historical snapshot admission");
          if (!rows.some(existing=>existing.snapshot_date === row.snapshot_date)) rows.push({...row,id:`coastal-health-${day}`,created_at:asOf});
          return {error:null};
        }};
      }} as unknown as Parameters<typeof recordDailyBusinessHealthSnapshot>[0];
      void recordDailyBusinessHealthSnapshot(sink, {readTicketId:"00000000-0000-4000-8000-000000000199",workspaceId:WORKSPACE_ID,score:intelligence.businessHealth.score,status:intelligence.businessHealth.status,trend:intelligence.businessHealth.trend,dataConfidence:intelligence.dataQuality.confidence,dataQualityScore:intelligence.dataQuality.score,memorySignalCount:intelligence.memorySummary.sourceRecords + intelligence.memorySummary.kpiHistoryRecords,sourceSummary:{performance_baseline:intelligence.businessHealth.components.dataQualityBase,positive_performance:intelligence.businessHealth.components.opportunityAdjustment,negative_performance:intelligence.businessHealth.components.riskPenalty}});
    } finally {globalThis.Date = RealDate;}
  }
  return rows;
}
