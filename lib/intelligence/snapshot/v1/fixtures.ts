import {
  deterministicKpiSemantics,
  evaluateKpiPerformance,
  recommendKpiTarget,
  resolveKpiTargetReference,
  type KpiSemantics
} from "@/lib/kpis/semantics";
import type { EvidenceManifest } from "@/lib/ai/evidence-engine/contracts";
import { snapshotHash } from "@/lib/intelligence/snapshot/v1/canonical";
import type { BuildIntelligenceSnapshotV1Input } from "@/lib/intelligence/snapshot/v1/builder";
import type {
  CoverageProducerOutputV1,
  IntelligenceLayerProducerOutputV1,
  KpiObservationPointV1,
  KpiProducerMetricV1
} from "@/lib/intelligence/snapshot/v1/types";
import {
  COVERAGE_PRODUCER_ID,
  COVERAGE_PRODUCER_VERSION,
  DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1,
  EVIDENCE_MANIFEST_PRODUCER_ID,
  EVIDENCE_MANIFEST_PRODUCER_VERSION,
  INTELLIGENCE_LAYER_PRODUCER_ID,
  INTELLIGENCE_LAYER_PRODUCER_VERSION,
  KPI_DETERMINISTIC_PRODUCER_ID,
  KPI_DETERMINISTIC_PRODUCER_VERSION
} from "@/lib/intelligence/snapshot/v1/versions";

export const FOUNDATION_FIXTURE_WORKSPACE_ID = "workspace-foundation-a";
export const FOUNDATION_FIXTURE_AS_OF = "2026-07-28T12:00:00.000Z";
export const FOUNDATION_FIXTURE_EVALUATION_DATE = "2026-07-28";
export const FOUNDATION_FIXTURE_GENERATED_AT = "2026-07-28T12:00:01.000Z";

const observationDates = ["2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01"];

function semantic(label: string, overrides: Partial<KpiSemantics>): KpiSemantics {
  return { ...deterministicKpiSemantics(label), ...overrides };
}

function observationPoints(id: string, values: number[]): KpiObservationPointV1[] {
  return values.map((value, index) => ({
    observationId: `${id}:observation:${index + 1}`,
    observedAt: observationDates[index] || `2026-07-${`${index + 1}`.padStart(2, "0")}`,
    value
  }));
}

function kpiFixture({
  id,
  label,
  values,
  semantics,
  manualTarget = null
}: {
  id: string;
  label: string;
  values: number[];
  semantics: KpiSemantics;
  manualTarget?: number | null;
}): KpiProducerMetricV1 {
  const points = observationPoints(id, values);
  const evaluation = evaluateKpiPerformance({
    observations: points.map((point) => ({ actual_value: point.value, metric_date: point.observedAt })),
    semantics,
    target: manualTarget
  });

  return {
    id,
    workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
    semantics: { ...semantics, displayName: label, originalSourceLabel: label },
    manualTarget,
    configuredSemanticTarget: resolveKpiTargetReference(semantics),
    effectiveAuthoritativeTarget: resolveKpiTargetReference(semantics, manualTarget),
    evaluation,
    recommendation: recommendKpiTarget({
      observations: points.map((point) => ({ actual_value: point.value, metric_date: point.observedAt })),
      semantics
    }),
    observations: {
      current: points.at(-1) || null,
      previous: points.at(-2) || null,
      rangeStart: points[0] || null,
      selectedRange: {
        startAt: points[0]?.observedAt || null,
        endAt: points.at(-1)?.observedAt || null,
        totalObservationCount: points.length,
        boundedObservations: points
      }
    },
    freshness: {
      status: "current",
      ageDays: 27,
      latestMeasurementAt: points.at(-1)?.observedAt || null
    },
    evidenceReferenceIds: []
  };
}

export function foundationKpiProducerOutput() {
  return [
    kpiFixture({
      id: "kpi-revenue",
      label: "Revenue",
      values: [100, 104, 108, 112, 116, 120],
      semantics: semantic("Revenue", { classificationConfirmed: true }),
      manualTarget: 125
    }),
    kpiFixture({
      id: "kpi-checkout-wait",
      label: "Average Checkout Wait",
      values: [8.1, 7.8, 7.2, 6.9, 6.5, 6.2],
      semantics: semantic("Average Checkout Wait", { classificationConfirmed: true }),
      manualTarget: 4
    }),
    kpiFixture({
      id: "kpi-utilization-range",
      label: "Staff Utilization",
      values: [62, 66, 70, 74, 78, 80],
      semantics: semantic("Staff Utilization", {
        canonicalName: "staff_utilization",
        desiredDirection: "target_range",
        targetBehavior: "acceptable_range",
        idealRangeMin: 72,
        idealRangeMax: 85,
        classificationSource: "user",
        classificationConfidence: 1,
        classificationConfirmed: true
      })
    }),
    kpiFixture({
      id: "kpi-inventory-variance",
      label: "Inventory Variance",
      values: [18, 16, 14, 13, 11, 10],
      semantics: semantic("Inventory Variance", {
        canonicalName: "inventory_variance",
        desiredDirection: "exact_target",
        targetBehavior: "exact_threshold",
        idealValue: 10,
        classificationSource: "user",
        classificationConfidence: 1,
        classificationConfirmed: true
      })
    }),
    kpiFixture({
      id: "kpi-staffing-coverage",
      label: "Staffing Coverage",
      values: [12, 12, 13, 12, 12, 12],
      semantics: semantic("Staffing Coverage", {
        canonicalName: "staffing_coverage",
        desiredDirection: "maintain",
        targetBehavior: "stability_goal",
        idealValue: 12,
        classificationSource: "user",
        classificationConfidence: 1,
        classificationConfirmed: true
      })
    }),
    kpiFixture({
      id: "kpi-ambiguous",
      label: "Operational Index",
      values: [44, 45, 47, 46, 48, 49],
      semantics: deterministicKpiSemantics("Operational Index"),
      manualTarget: 50
    })
  ] as const;
}

function insight({
  id,
  type,
  priority,
  title,
  recordId,
  fingerprint
}: {
  id: string;
  type: "Risk" | "Opportunity";
  priority: "High" | "Medium";
  title: string;
  recordId: string;
  fingerprint: string;
}) {
  return {
    id,
    type,
    title,
    summary: `${title} based on the current deterministic evidence package.`,
    why: "The canonical KPI evaluation supports this classification.",
    impact: "Leadership should review the affected operating area.",
    recommendedAction: "Review the source evidence and decide the next operating step.",
    confidence: priority === "High" ? "High" as const : "Medium" as const,
    evidence: ["Deterministic fixture evidence"],
    evidenceCount: 1,
    supportingRecords: [{
      id: recordId,
      title,
      recordType: "KPI record",
      date: "2026-07-01",
      value: "Structured KPI value",
      support: "Deterministic fixture support",
      href: "/app/kpis",
      classification: "Original" as const,
      sourceKey: `fixture:${recordId}`
    }],
    independentSourceCount: 1,
    contradictoryEvidence: [],
    missingEvidence: [],
    sourceTypes: ["KPIs"],
    sourceHref: "/app/kpis",
    priority,
    lastUpdated: "2026-07-01T00:00:00.000Z",
    affectedArea: "Operations",
    timePeriod: "2026-07",
    limitation: "The deterministic result does not establish causation.",
    fingerprint
  };
}

export function foundationIntelligenceLayerOutput(): IntelligenceLayerProducerOutputV1 {
  const risk = insight({
    id: "finding-checkout-wait",
    type: "Risk",
    priority: "High",
    title: "Checkout wait remains above the manual target",
    recordId: "kpi:checkout-wait-latest",
    fingerprint: "risk:checkout-wait:performance-gap:2026-07"
  });
  const opportunity = insight({
    id: "finding-revenue",
    type: "Opportunity",
    priority: "Medium",
    title: "Revenue is moving toward the manual target",
    recordId: "kpi:revenue-latest",
    fingerprint: "opportunity:revenue:positive-performance:2026-07"
  });

  return {
    executiveSummary: `${risk.title}. ${risk.why}`,
    businessHealth: { available: true, score: 78, status: "Strong", trend: "Holding steady" },
    dataQuality: {
      score: 92,
      label: "Strong",
      confidence: "High",
      reason: "Fixture data includes current structured evidence.",
      suggestedNextData: []
    },
    forecastReadiness: {
      state: "ready",
      label: "Forecasting ready",
      reason: "The fixture has enough dated history.",
      ready: true,
      directional: true,
      currentKpiCount: 6,
      totalMeasurementCount: 36,
      readyKpiCount: 6,
      directionalKpiCount: 0,
      historicalDepthLabel: "6 of 6 KPIs have at least 2 dated measurements",
      freshnessLabel: "6 of 6 KPIs updated within 45 days"
    },
    topRisk: risk,
    topOpportunity: opportunity,
    topRecommendation: risk,
    insights: [risk, opportunity],
    memorySummary: {
      profileSignals: 2,
      sourceRecords: 4,
      kpiHistoryRecords: 36,
      reports: 0,
      vaeroexRuns: 0,
      decisions: 0,
      recommendationOutcomes: 0
    }
  };
}

export function foundationCoverageOutput(): CoverageProducerOutputV1 {
  const categories = [
    ["revenue", 92, "High Confidence"],
    ["operations", 86, "Strong"],
    ["historical_trends", 88, "Strong"]
  ] as const;
  return {
    overallCoverage: 89,
    overallConfidenceLabel: "Strong",
    overallReason: "Fixture coverage is sufficient for parity tests.",
    categories: categories.map(([id, coverage, confidenceLabel]) => ({
      id,
      label: id,
      coverage,
      confidenceLabel,
      sourceCount: 6,
      lastUpdated: "2026-07-01",
      dataQualityLabel: "Good historical coverage",
      recommendedNextUpload: "Continue current evidence cadence.",
      reason: "Fixture coverage.",
      sourceTypes: ["KPIs"],
      evidence: ["Bounded fixture evidence"],
      historyMonths: 6,
      structuredSourceCount: 6,
      forecastReady: true
    })),
    confidenceOverTime: [],
    sourceMix: [],
    evidenceSummary: { originalEvidenceCount: 2, memoryItemCount: 1, derivedFindingCount: 2 },
    dataGaps: [],
    recommendedNextUpload: "Continue current evidence cadence.",
    forecastReadiness: {
      ready: true,
      directional: true,
      state: "ready",
      label: "Forecasting ready",
      reason: "Fixture history is sufficient.",
      currentKpiCount: 6,
      totalMeasurementCount: 36,
      readyKpiCount: 6,
      directionalKpiCount: 0,
      historicalDepthLabel: "Six periods",
      freshnessLabel: "Current"
    }
  };
}

export function foundationEvidenceManifest(): EvidenceManifest {
  return {
    version: "evidence_manifest_v1",
    manifestId: "foundation-manifest",
    workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
    queryFingerprint: snapshotHash("foundation-query"),
    generatedAt: FOUNDATION_FIXTURE_GENERATED_AT,
    evidence: [
      {
        citationId: 1,
        candidateId: "candidate-original",
        sourceOrdinal: "S1",
        domain: "operations",
        title: "Operations workbook",
        excerpt: "This unrestricted fixture excerpt must not enter the snapshot.",
        summary: null,
        evidenceRole: "original",
        originalEvidenceEligible: true,
        confidenceScore: 90,
        indexedAt: "2026-07-02T00:00:00.000Z",
        recordedAt: "2026-07-01T00:00:00.000Z",
        lineageVersion: "evidence_lineage_v1",
        eligibilityDecisionVersion: "evidence_eligibility_v1"
      },
      {
        citationId: 2,
        candidateId: "candidate-context",
        sourceOrdinal: "S2",
        domain: "operations",
        title: "Business Note",
        excerpt: "Contextual fixture content must also remain outside the snapshot.",
        summary: null,
        evidenceRole: "supporting",
        originalEvidenceEligible: false,
        confidenceScore: 70,
        indexedAt: "2026-07-02T00:00:00.000Z",
        recordedAt: "2026-07-01T00:00:00.000Z",
        lineageVersion: "evidence_lineage_v1",
        eligibilityDecisionVersion: "evidence_eligibility_v1"
      }
    ],
    sourceRegistry: {
      version: "source_registry_v1",
      workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
      entries: [
        {
          sourceOrdinal: "S1",
          canonicalSourceKey: `${FOUNDATION_FIXTURE_WORKSPACE_ID}:file:operations`,
          independentSourceKey: `${FOUNDATION_FIXTURE_WORKSPACE_ID}:file:operations`,
          sourceType: "source_file",
          title: "Operations workbook",
          evidenceRole: "original",
          sourceId: "source-original",
          sourceFileId: "source-original",
          parentSourceId: null,
          candidateIds: ["candidate-original"]
        },
        {
          sourceOrdinal: "S2",
          canonicalSourceKey: `${FOUNDATION_FIXTURE_WORKSPACE_ID}:business-note:context`,
          independentSourceKey: null,
          sourceType: "business_note",
          title: "Business Note",
          evidenceRole: "supporting",
          sourceId: "business-note-context",
          sourceFileId: null,
          parentSourceId: null,
          candidateIds: ["candidate-context"]
        }
      ],
      candidateToSourceOrdinal: { "candidate-original": "S1", "candidate-context": "S2" },
      independentOriginalSourceCount: 1
    },
    componentVersions: {
      candidateRetriever: "fixture_retriever_v1",
      embedding: null,
      reranker: "deterministic_noop_v1",
      sourceRegistry: "source_registry_v1",
      signalPlanner: "fixture_signal_planner_v1",
      citationVerifier: "citation_verification_v1"
    },
    policy: {
      derivedOutputsExcludedFromOriginalEvidence: true,
      citationsApplicationGenerated: true,
      sourceIndependenceApplicationCalculated: true
    }
  };
}

export function foundationSnapshotBuildInput(): BuildIntelligenceSnapshotV1Input {
  const intelligenceLayer = foundationIntelligenceLayerOutput();
  const kpis = foundationKpiProducerOutput();
  const coverage = foundationCoverageOutput();
  const evidenceManifests = [foundationEvidenceManifest()];
  return {
    workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
    asOf: FOUNDATION_FIXTURE_AS_OF,
    evaluationDate: FOUNDATION_FIXTURE_EVALUATION_DATE,
    generatedAt: FOUNDATION_FIXTURE_GENERATED_AT,
    versions: DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1,
    intelligenceLayer: {
      producerId: INTELLIGENCE_LAYER_PRODUCER_ID,
      producerVersion: INTELLIGENCE_LAYER_PRODUCER_VERSION,
      workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
      asOf: FOUNDATION_FIXTURE_AS_OF,
      semanticInputFingerprint: snapshotHash(intelligenceLayer),
      output: intelligenceLayer
    },
    kpis: {
      producerId: KPI_DETERMINISTIC_PRODUCER_ID,
      producerVersion: KPI_DETERMINISTIC_PRODUCER_VERSION,
      workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
      asOf: FOUNDATION_FIXTURE_AS_OF,
      semanticInputFingerprint: snapshotHash(kpis),
      output: kpis
    },
    coverage: {
      producerId: COVERAGE_PRODUCER_ID,
      producerVersion: COVERAGE_PRODUCER_VERSION,
      workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
      asOf: FOUNDATION_FIXTURE_AS_OF,
      semanticInputFingerprint: snapshotHash(coverage),
      output: coverage
    },
    evidenceManifests: {
      producerId: EVIDENCE_MANIFEST_PRODUCER_ID,
      producerVersion: EVIDENCE_MANIFEST_PRODUCER_VERSION,
      workspaceId: FOUNDATION_FIXTURE_WORKSPACE_ID,
      asOf: FOUNDATION_FIXTURE_AS_OF,
      semanticInputFingerprint: snapshotHash(evidenceManifests.map((manifest) => ({
        manifestId: manifest.manifestId,
        queryFingerprint: manifest.queryFingerprint,
        evidence: manifest.evidence.map(({ candidateId, evidenceRole, originalEvidenceEligible, recordedAt, lineageVersion, eligibilityDecisionVersion }) => ({
          candidateId,
          evidenceRole,
          originalEvidenceEligible,
          recordedAt,
          lineageVersion,
          eligibilityDecisionVersion
        }))
      }))),
      output: evidenceManifests
    }
  };
}
