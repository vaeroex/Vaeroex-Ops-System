import type { EvidenceManifest, EvidenceRole } from "@/lib/ai/evidence-engine/contracts";
import type { KpiOverviewMetric } from "@/lib/ai/kpi-overview";
import type {
  KpiDesiredDirection,
  KpiPerformanceEvaluation,
  KpiSemantics,
  KpiTargetBehavior,
  KpiTargetRecommendation,
  KpiTargetReference
} from "@/lib/kpis/semantics";
import type { KpiForecastReadinessState } from "@/lib/kpis/forecast-eligibility";
import type {
  BusinessIntelligenceConfidenceLabel,
  BusinessIntelligenceCoverageCategoryId,
  BusinessIntelligenceCoverageResult
} from "@/lib/intelligence/coverage";
import type {
  BusinessHealthDriverImpact,
  IntelligenceConfidence,
  IntelligenceInsightType,
  IntelligenceLayerResult
} from "@/lib/intelligence/layer";
import type {
  DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1,
  SupportedProducerId,
  SupportedProducerVersion
} from "@/lib/intelligence/snapshot/v1/versions";

export type SnapshotUnavailableState =
  | "unavailable"
  | "unresolved"
  | "insufficient_data"
  | "not_applicable"
  | "unknown_semantics";

export type SnapshotReasonCode =
  | "missing_producer"
  | "missing_producer_field"
  | "producer_reported_unavailable"
  | "insufficient_original_evidence"
  | "insufficient_history"
  | "target_not_configured"
  | "recommendation_not_available"
  | "semantic_direction_unknown"
  | "not_applicable_to_metric"
  | "source_not_available";

export type SnapshotState<T> = Readonly<{ state: "available"; value: T }> | Readonly<{
  state: SnapshotUnavailableState;
  reason: Readonly<{ code: SnapshotReasonCode; detail?: string }>;
}>;

export type BusinessHealthStatus = IntelligenceLayerResult["businessHealth"]["status"];
export type BusinessHealthTrajectory = IntelligenceLayerResult["businessHealth"]["trend"];
export type DataQualityLabel = IntelligenceLayerResult["dataQuality"]["label"];
export type KpiRawMovement = KpiPerformanceEvaluation["rawMovement"];
export type KpiPerformanceEffect = KpiPerformanceEvaluation["latestPerformanceEffect"];
export type KpiSelectedRangeTrend = KpiPerformanceEvaluation["selectedRangeTrend"];
export type KpiTargetStatus = KpiPerformanceEvaluation["targetStatus"];
export type KpiFreshnessStatus = KpiOverviewMetric["freshness"];
export type KpiRecommendationConfidence = KpiTargetRecommendation["confidence"];
export type KpiRecommendationAvailability = "available" | "unavailable";

export type IntelligenceProducerEnvelopeV1<T> = Readonly<{
  producerId: SupportedProducerId;
  producerVersion: SupportedProducerVersion;
  workspaceId: string;
  asOf: string;
  semanticInputFingerprint: string;
  output: T;
}>;

export type IntelligenceSnapshotVersionsV1 = typeof DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1;

export type KpiSemanticSnapshotV1 = Readonly<{
  desiredDirection: KpiDesiredDirection;
  targetBehavior: KpiTargetBehavior;
  idealValue: number | null;
  idealRangeMin: number | null;
  idealRangeMax: number | null;
  classificationSource: KpiSemantics["classificationSource"];
  classificationConfidence: number | null;
  classificationConfirmed: boolean;
}>;

export type KpiObservationPointV1 = Readonly<{
  observationId: string;
  observedAt: string;
  value: number;
}>;

export type KpiObservationSummaryV1 = Readonly<{
  current: KpiObservationPointV1 | null;
  previous: KpiObservationPointV1 | null;
  rangeStart: KpiObservationPointV1 | null;
  selectedRange: Readonly<{
    startAt: string | null;
    endAt: string | null;
    totalObservationCount: number;
    boundedObservations: readonly KpiObservationPointV1[];
  }>;
}>;

export type KpiRecommendedTargetV1 =
  | Readonly<{ kind: "scalar"; value: number }>
  | Readonly<{ kind: "range"; min: number; max: number }>;

export type KpiSnapshotV1 = Readonly<{
  id: string;
  identity: Readonly<{
    canonicalName: string;
    displayName: string;
    originalSourceLabel: string;
    unit: string | null;
    scale: number;
    metricRole: KpiSemantics["metricRole"];
  }>;
  semantics: SnapshotState<KpiSemanticSnapshotV1>;
  manualTarget: SnapshotState<Readonly<{ value: number }>>;
  configuredSemanticTarget: SnapshotState<KpiTargetReference>;
  effectiveAuthoritativeTarget: SnapshotState<KpiTargetReference>;
  recommendationAvailability: KpiRecommendationAvailability;
  recommendedNextTarget: SnapshotState<Readonly<{
    target: KpiRecommendedTargetV1;
    confidence: Exclude<KpiRecommendationConfidence, "Unavailable">;
    outlierCount: number;
  }>>;
  observations: KpiObservationSummaryV1;
  performance: SnapshotState<Readonly<{
    rawMovement: KpiRawMovement;
    latestPerformanceEffect: KpiPerformanceEffect;
    selectedRangeTrend: KpiSelectedRangeTrend;
    targetStatus: KpiTargetStatus;
    latestValue: number | null;
    previousValue: number | null;
    rangeStartValue: number | null;
    change: number | null;
    changePercent: number | null;
  }>>;
  freshness: SnapshotState<Readonly<{
    status: KpiFreshnessStatus;
    ageDays: number | null;
    latestMeasurementAt: string | null;
  }>>;
  evidenceReferenceIds: readonly string[];
}>;

export type EvidenceAuthorityRoleV1 = "original" | "supporting_context" | "derived" | "historical";

export type EvidenceReferenceV1 = Readonly<{
  id: string;
  workspaceId: string;
  recordId: string;
  recordType: string;
  sourceType: string;
  sourceKeyHash: string;
  sourceIds: readonly string[];
  authorityRole: EvidenceAuthorityRoleV1;
  sourceEvidenceRole: EvidenceRole | "manual";
  lifecycle: "active";
  originalEvidenceEligible: boolean;
  recordedAt: string | null;
  indexedAt: string | null;
  lineageVersion: string;
  lineageIds: readonly string[];
  eligibilityPolicyVersion: string;
}>;

export type CitationReferenceV1 = Readonly<{
  id: string;
  evidenceReferenceId: string;
  manifestId: string;
  sourceOrdinal: string;
}>;

export type FindingSnapshotV1 = Readonly<{
  id: string;
  fingerprint: string;
  origin: "deterministic";
  producerId: "intelligence_layer" | "operational_evidence";
  producerVersion: string;
  type: IntelligenceInsightType;
  priority: "High" | "Medium" | "Low";
  confidence: IntelligenceConfidence;
  title: string;
  summary: string;
  why: string;
  impact: string;
  recommendedAction: string;
  limitation: string;
  affectedArea: string;
  timePeriod: string;
  lastUpdated: string;
  deterministicDependencies: Readonly<{
    kpiIds: readonly string[];
    evidenceReferenceIds: readonly string[];
  }>;
  citationIds: readonly string[];
}>;

export type FindingIndexV1 = Readonly<{
  riskFindingIds: readonly string[];
  opportunityFindingIds: readonly string[];
  recommendationFindingIds: readonly string[];
  forecastFindingIds: readonly string[];
}>;

export type PriorityRoleV1 = "top_risk" | "top_opportunity" | "top_recommendation" | "top_forecast";
export type PrioritySnapshotV1 = Readonly<{ role: PriorityRoleV1; rank: 1; findingId: string }>;

export type ForecastReadinessSnapshotV1 = Readonly<{
  state: KpiForecastReadinessState;
  ready: boolean;
  directional: boolean;
  currentKpiCount: number;
  totalMeasurementCount: number;
  readyKpiCount: number;
  directionalKpiCount: number;
  historicalDepthLabel: string;
  freshnessLabel: string;
}>;

export type CoverageCategorySnapshotV1 = Readonly<{
  id: BusinessIntelligenceCoverageCategoryId;
  coverage: number;
  confidenceLabel: BusinessIntelligenceConfidenceLabel;
  sourceCount: number;
  lastUpdated: string | null;
  historyMonths: number;
  structuredSourceCount: number;
  forecastReady: boolean;
}>;

export type CoverageSnapshotV1 = Readonly<{
  overallCoverage: number;
  overallConfidenceLabel: BusinessIntelligenceConfidenceLabel;
  categories: readonly CoverageCategorySnapshotV1[];
  evidenceSummary: BusinessIntelligenceCoverageResult["evidenceSummary"];
}>;

export type SnapshotLimitationV1 = Readonly<{
  code: string;
  scope: "snapshot" | "business_health" | "data_quality" | "forecast" | "coverage" | "kpi" | "finding" | "evidence";
  severity: "information" | "warning";
  message: string;
}>;

export type ProducerReceiptV1 = Readonly<{
  producerId: SupportedProducerId;
  producerVersion: SupportedProducerVersion;
  workspaceId: string;
  asOf: string;
  semanticInputFingerprint: string;
}>;

export type IntelligenceSnapshotV1 = Readonly<{
  contract: Readonly<{
    id: "intelligence_snapshot_v1";
    version: "1.0.0";
    schemaVersion: 1;
  }>;
  scope: Readonly<{
    workspaceId: string;
    asOf: string;
    evaluationDate: string;
  }>;
  versions: IntelligenceSnapshotVersionsV1;
  fingerprints: Readonly<{
    input: string;
    snapshot: string;
  }>;
  businessHealth: SnapshotState<Readonly<{
    score: number;
    status: Exclude<BusinessHealthStatus, "Insufficient Data">;
    trajectory: BusinessHealthTrajectory;
    confidence: IntelligenceConfidence;
    components: SnapshotState<Readonly<{
      dataQualityBase: number;
      riskPenalty: number;
      opportunityAdjustment: number;
      driverImpacts: readonly BusinessHealthDriverImpact[];
    }>>;
  }>>;
  dataQuality: SnapshotState<Readonly<{
    score: number;
    label: DataQualityLabel;
    confidence: IntelligenceConfidence;
  }>>;
  readiness: Readonly<{
    forecast: SnapshotState<ForecastReadinessSnapshotV1>;
    coverage: SnapshotState<CoverageSnapshotV1>;
  }>;
  kpis: readonly KpiSnapshotV1[];
  findings: readonly FindingSnapshotV1[];
  findingIndex: FindingIndexV1;
  priorities: readonly PrioritySnapshotV1[];
  evidence: Readonly<{
    references: readonly EvidenceReferenceV1[];
    citations: readonly CitationReferenceV1[];
    sourceRegistryVersions: readonly EvidenceManifest["sourceRegistry"]["version"][];
  }>;
  limitations: readonly SnapshotLimitationV1[];
  provenance: readonly ProducerReceiptV1[];
}>;

export type IntelligenceSnapshotBuildPerformanceV1 = Readonly<{
  totalMs: number;
  adapterMs: number;
  orderingMs: number;
  validationMs: number;
  hashingMs: number;
  serializationMs: number;
}>;

export type IntelligenceSnapshotBuildReceiptV1 = Readonly<{
  id: string;
  snapshotFingerprint: string;
  workspaceId: string;
  generatedAt: string;
  builderVersion: string;
  validation: Readonly<{ status: "passed"; invariantCount: number }>;
  adapterVersions: IntelligenceSnapshotVersionsV1["adapters"];
  performance: IntelligenceSnapshotBuildPerformanceV1;
  fixtureSizes: Readonly<{
    kpis: number;
    findings: number;
    evidenceReferences: number;
    citations: number;
    serializedBytes: number;
  }>;
}>;

export type IntelligenceSnapshotBuildResultV1 = Readonly<{
  snapshot: IntelligenceSnapshotV1;
  receipt: IntelligenceSnapshotBuildReceiptV1;
}>;

export type IntelligenceLayerProducerOutputV1 = IntelligenceLayerResult;
export type CoverageProducerOutputV1 = BusinessIntelligenceCoverageResult;
export type EvidenceManifestProducerOutputV1 = readonly EvidenceManifest[];

export type KpiProducerMetricV1 = Readonly<{
  id: string;
  workspaceId: string;
  semantics: KpiSemantics;
  manualTarget: number | null;
  configuredSemanticTarget: KpiTargetReference;
  effectiveAuthoritativeTarget: KpiTargetReference;
  evaluation: KpiPerformanceEvaluation;
  recommendation: KpiTargetRecommendation;
  observations: KpiObservationSummaryV1;
  freshness: Readonly<{
    status: KpiFreshnessStatus;
    ageDays: number | null;
    latestMeasurementAt: string | null;
  }>;
  evidenceReferenceIds: readonly string[];
}>;

export type KpiProducerOutputV1 = readonly KpiProducerMetricV1[];
