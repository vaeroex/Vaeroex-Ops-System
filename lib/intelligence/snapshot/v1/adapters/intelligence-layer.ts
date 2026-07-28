import { snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import { available, unavailable } from "@/lib/intelligence/snapshot/v1/state";
import type {
  EvidenceAuthorityRoleV1,
  EvidenceReferenceV1,
  FindingIndexV1,
  FindingSnapshotV1,
  ForecastReadinessSnapshotV1,
  IntelligenceLayerProducerOutputV1,
  IntelligenceSnapshotV1,
  PrioritySnapshotV1,
  SnapshotLimitationV1
} from "@/lib/intelligence/snapshot/v1/types";

function contextualRecord(recordType: string, sourceKey: string) {
  return /business note|business memory/i.test(recordType) || /^(?:business-note|business-memory):/i.test(sourceKey);
}

function recordAuthority(classification: "Original" | "Manual" | "Derived", recordType: string, sourceKey: string): EvidenceAuthorityRoleV1 {
  if (contextualRecord(recordType, sourceKey)) return "supporting_context";
  return classification === "Derived" ? "derived" : "original";
}

export function adaptIntelligenceLayerProducerOutputV1({
  workspaceId,
  producerVersion,
  evidenceEligibilityPolicyVersion,
  lineageVersion,
  output
}: {
  workspaceId: string;
  producerVersion: string;
  evidenceEligibilityPolicyVersion: string;
  lineageVersion: string;
  output: IntelligenceLayerProducerOutputV1;
}) {
  const evidenceById = new Map<string, EvidenceReferenceV1>();
  const findings: FindingSnapshotV1[] = output.insights.map((insight) => {
    const evidenceReferenceIds = insight.supportingRecords.map((record) => {
      const id = `intelligence-layer:${record.id}`;
      const authorityRole = recordAuthority(record.classification, record.recordType, record.sourceKey);
      const reference: EvidenceReferenceV1 = {
        id,
        workspaceId,
        recordId: record.id,
        recordType: record.recordType,
        sourceType: record.classification === "Manual" ? "manual" : "intelligence_layer_source",
        sourceKeyHash: snapshotHash(record.sourceKey),
        sourceIds: [record.id],
        authorityRole,
        sourceEvidenceRole: record.classification === "Manual"
          ? "manual"
          : record.classification === "Derived"
            ? "derived"
            : "original",
        lifecycle: "active",
        originalEvidenceEligible: authorityRole === "original",
        recordedAt: record.date || null,
        indexedAt: null,
        lineageVersion,
        lineageIds: [record.id],
        eligibilityPolicyVersion: evidenceEligibilityPolicyVersion
      };
      const current = evidenceById.get(id);
      if (current && JSON.stringify(current) !== JSON.stringify(reference)) {
        throw new Error(`Conflicting evidence reference ${id} was emitted by the Intelligence Layer.`);
      }
      evidenceById.set(id, reference);
      return id;
    });

    return {
      id: insight.id,
      fingerprint: insight.fingerprint,
      origin: "deterministic",
      producerId: "intelligence_layer",
      producerVersion,
      type: insight.type,
      priority: insight.priority,
      confidence: insight.confidence,
      title: insight.title,
      summary: insight.summary,
      why: insight.why,
      impact: insight.impact,
      recommendedAction: insight.recommendedAction,
      limitation: insight.limitation,
      affectedArea: insight.affectedArea,
      timePeriod: insight.timePeriod,
      lastUpdated: insight.lastUpdated,
      deterministicDependencies: {
        kpiIds: [],
        evidenceReferenceIds
      },
      citationIds: []
    };
  });
  const insightIds = new Set(findings.map((finding) => finding.id));
  const priority = (role: PrioritySnapshotV1["role"], id: string | undefined) =>
    id && insightIds.has(id) ? [{ role, rank: 1 as const, findingId: id }] : [];
  const priorities: PrioritySnapshotV1[] = [
    ...priority("top_risk", output.topRisk?.id),
    ...priority("top_opportunity", output.topOpportunity?.id),
    ...priority("top_recommendation", output.topRecommendation?.id),
    ...priority("top_forecast", output.topForecast?.id)
  ];
  const findingIndex: FindingIndexV1 = {
    riskFindingIds: findings.filter((finding) => ["Risk", "Bottleneck", "Anomaly"].includes(finding.type)).map((finding) => finding.id),
    opportunityFindingIds: findings.filter((finding) => finding.type === "Opportunity").map((finding) => finding.id),
    recommendationFindingIds: findings.filter((finding) => finding.type === "Recommendation").map((finding) => finding.id),
    forecastFindingIds: findings.filter((finding) => finding.type === "Forecast").map((finding) => finding.id)
  };
  const limitations: SnapshotLimitationV1[] = [{
    code: "data_quality_reason",
    scope: "data_quality",
    severity: "information",
    message: output.dataQuality.reason
  }];
  const forecast: ForecastReadinessSnapshotV1 = {
    state: output.forecastReadiness.state,
    ready: output.forecastReadiness.ready,
    directional: output.forecastReadiness.directional,
    currentKpiCount: output.forecastReadiness.currentKpiCount,
    totalMeasurementCount: output.forecastReadiness.totalMeasurementCount,
    readyKpiCount: output.forecastReadiness.readyKpiCount,
    directionalKpiCount: output.forecastReadiness.directionalKpiCount,
    historicalDepthLabel: output.forecastReadiness.historicalDepthLabel,
    freshnessLabel: output.forecastReadiness.freshnessLabel
  };

  const businessHealth: IntelligenceSnapshotV1["businessHealth"] = output.businessHealth.available && output.businessHealth.status !== "Insufficient Data"
      ? available({
        score: output.businessHealth.score,
        status: output.businessHealth.status,
        trajectory: output.businessHealth.trend,
        confidence: output.dataQuality.confidence,
        components: available({
          dataQualityBase: output.businessHealth.components.dataQualityBase,
          riskPenalty: output.businessHealth.components.riskPenalty,
          opportunityAdjustment: output.businessHealth.components.opportunityAdjustment,
          driverImpacts: output.businessHealth.components.driverImpacts.map((impact) => ({ ...impact }))
        })
      })
      : unavailable("insufficient_data", "insufficient_original_evidence");

  return {
    businessHealth,
    dataQuality: available({
      score: output.dataQuality.score,
      label: output.dataQuality.label,
      confidence: output.dataQuality.confidence
    }),
    forecastReadiness: available(forecast),
    findings,
    findingIndex,
    priorities,
    evidenceReferences: [...evidenceById.values()],
    limitations
  };
}
