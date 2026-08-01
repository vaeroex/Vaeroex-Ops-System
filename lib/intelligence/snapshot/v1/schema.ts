import { z } from "zod";
import { SOURCE_REGISTRY_VERSION } from "@/lib/ai/evidence-engine/contracts";
import { KPI_DESIRED_DIRECTIONS, KPI_TARGET_BEHAVIORS } from "@/lib/kpis/semantics";
import {
  BUSINESS_NOTE_ADDITIONAL_CONTEXT_KEYS,
  BUSINESS_NOTE_SOURCE_CLASSIFICATIONS,
  BUSINESS_NOTE_TYPES
} from "@/lib/ai/business-notes/contracts";
import {
  BUSINESS_HEALTH_CALCULATION_VERSIONS,
  DATA_QUALITY_CALCULATION_VERSIONS,
  DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1,
  INTELLIGENCE_SNAPSHOT_LIMITS
} from "@/lib/intelligence/snapshot/v1/versions";
import type {
  IntelligenceSnapshotBuildReceiptV1,
  IntelligenceSnapshotV1,
  SnapshotState
} from "@/lib/intelligence/snapshot/v1/types";

const boundedLabel = z.string().min(1).max(INTELLIGENCE_SNAPSHOT_LIMITS.boundedLabel);
const boundedText = z.string().max(INTELLIGENCE_SNAPSHOT_LIMITS.boundedText);
const dateValue = z.string().min(1).max(64);
const timestampValue = z.string().datetime({ offset: true });
const finiteNumber = z.number().finite();
const nonnegativeInteger = z.number().int().min(0);
const fingerprint = z.string().regex(/^sha256:[a-f0-9]{64}$/);

const reasonCode = z.enum([
  "missing_producer",
  "missing_producer_field",
  "producer_reported_unavailable",
  "insufficient_original_evidence",
  "no_evaluable_performance_outcome",
  "insufficient_history",
  "target_not_configured",
  "recommendation_not_available",
  "semantic_direction_unknown",
  "not_applicable_to_metric",
  "source_not_available"
]);

const unavailableState = z.object({
  state: z.enum(["unavailable", "unresolved", "insufficient_data", "not_applicable", "unknown_semantics"]),
  reason: z.object({ code: reasonCode, detail: boundedText.optional() }).strict()
}).strict();

function snapshotStateSchema<T>(value: z.ZodType<T>): z.ZodType<SnapshotState<T>> {
  return z.union([z.object({ state: z.literal("available"), value }).strict(), unavailableState]) as z.ZodType<SnapshotState<T>>;
}

const kpiTargetReference = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("scalar"), value: finiteNumber, source: z.enum(["manual", "semantic"]) }).strict(),
  z.object({ kind: z.literal("range"), min: finiteNumber, max: finiteNumber, source: z.literal("semantic") }).strict(),
  z.object({ kind: z.literal("none") }).strict()
]);

const observationPoint = z.object({
  observationId: boundedLabel,
  observedAt: dateValue,
  value: finiteNumber
}).strict();

const kpiSnapshot = z.object({
  id: boundedLabel,
  identity: z.object({
    canonicalName: boundedLabel,
    displayName: boundedLabel,
    originalSourceLabel: boundedLabel,
    unit: boundedLabel.nullable(),
    scale: finiteNumber.positive(),
    metricRole: z.enum(["actual", "target", "benchmark", "unknown"])
  }).strict(),
  semantics: snapshotStateSchema(z.object({
    desiredDirection: z.enum(KPI_DESIRED_DIRECTIONS),
    targetBehavior: z.enum(KPI_TARGET_BEHAVIORS),
    idealValue: finiteNumber.nullable(),
    idealRangeMin: finiteNumber.nullable(),
    idealRangeMax: finiteNumber.nullable(),
    classificationSource: z.enum(["user", "deterministic", "luna", "migration", "unknown"]),
    classificationConfidence: finiteNumber.min(0).max(1).nullable(),
    classificationConfirmed: z.boolean()
  }).strict()),
  manualTarget: snapshotStateSchema(z.object({ value: finiteNumber }).strict()),
  configuredSemanticTarget: snapshotStateSchema(kpiTargetReference),
  effectiveAuthoritativeTarget: snapshotStateSchema(kpiTargetReference),
  recommendationAvailability: z.enum(["available", "unavailable"]),
  recommendedNextTarget: snapshotStateSchema(z.object({
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("scalar"), value: finiteNumber }).strict(),
      z.object({ kind: z.literal("range"), min: finiteNumber, max: finiteNumber }).strict()
    ]),
    confidence: z.enum(["Higher", "Medium", "Low"]),
    outlierCount: nonnegativeInteger
  }).strict()),
  observations: z.object({
    current: observationPoint.nullable(),
    previous: observationPoint.nullable(),
    rangeStart: observationPoint.nullable(),
    selectedRange: z.object({
      startAt: dateValue.nullable(),
      endAt: dateValue.nullable(),
      totalObservationCount: nonnegativeInteger,
      boundedObservations: z.array(observationPoint).max(INTELLIGENCE_SNAPSHOT_LIMITS.observationsPerKpi)
    }).strict()
  }).strict(),
  performance: snapshotStateSchema(z.object({
    rawMovement: z.enum(["increased", "decreased", "unchanged", "insufficient_data"]),
    latestPerformanceEffect: z.enum(["favorable", "unfavorable", "neutral", "indeterminate"]),
    selectedRangeTrend: z.enum(["favorable", "unfavorable", "stable", "mixed", "insufficient_data", "indeterminate"]),
    targetStatus: z.enum([
      "achieved",
      "within_range",
      "above_acceptable_maximum",
      "below_required_minimum",
      "moving_toward_target",
      "moving_away_from_target",
      "no_target",
      "direction_unknown"
    ]),
    latestValue: finiteNumber.nullable(),
    previousValue: finiteNumber.nullable(),
    rangeStartValue: finiteNumber.nullable(),
    change: finiteNumber.nullable(),
    changePercent: finiteNumber.nullable()
  }).strict()),
  freshness: snapshotStateSchema(z.object({
    status: z.enum(["current", "stale", "old"]),
    ageDays: nonnegativeInteger.nullable(),
    latestMeasurementAt: dateValue.nullable()
  }).strict()),
  evidenceReferenceIds: z.array(boundedLabel).max(INTELLIGENCE_SNAPSHOT_LIMITS.findingEvidenceReferences)
}).strict();

const evidenceReference = z.object({
  id: boundedLabel,
  workspaceId: boundedLabel,
  recordId: boundedLabel,
  recordType: boundedLabel,
  sourceType: boundedLabel,
  sourceKeyHash: fingerprint,
  sourceIds: z.array(boundedLabel).max(INTELLIGENCE_SNAPSHOT_LIMITS.sourceIdsPerEvidenceReference),
  authorityRole: z.enum(["original", "supporting_context", "derived", "historical"]),
  sourceEvidenceRole: z.enum(["original", "supporting", "derived", "historical", "manual"]),
  lifecycle: z.literal("active"),
  originalEvidenceEligible: z.boolean(),
  recordedAt: dateValue.nullable(),
  indexedAt: dateValue.nullable(),
  lineageVersion: boundedLabel,
  lineageIds: z.array(boundedLabel).max(INTELLIGENCE_SNAPSHOT_LIMITS.lineageIdsPerEvidenceReference),
  eligibilityPolicyVersion: boundedLabel
}).strict();

const finding = z.object({
  id: boundedLabel,
  fingerprint: boundedLabel,
  origin: z.literal("deterministic"),
  producerId: z.enum(["intelligence_layer", "operational_evidence"]),
  producerVersion: boundedLabel,
  type: z.enum(["Risk", "Opportunity", "Forecast", "Bottleneck", "Recommendation", "Anomaly"]),
  priority: z.enum(["High", "Medium", "Low"]),
  confidence: z.enum(["High", "Medium", "Low"]),
  title: boundedText,
  summary: boundedText,
  why: boundedText,
  impact: boundedText,
  recommendedAction: boundedText,
  limitation: boundedText,
  affectedArea: boundedLabel,
  timePeriod: boundedLabel,
  lastUpdated: dateValue,
  deterministicDependencies: z.object({
    kpiIds: z.array(boundedLabel).max(INTELLIGENCE_SNAPSHOT_LIMITS.findingKpiDependencies),
    evidenceReferenceIds: z.array(boundedLabel).max(INTELLIGENCE_SNAPSHOT_LIMITS.findingEvidenceReferences)
  }).strict(),
  citationIds: z.array(boundedLabel).max(INTELLIGENCE_SNAPSHOT_LIMITS.findingEvidenceReferences)
}).strict();

const forecastReadiness = z.object({
  state: z.enum(["ready", "directional_only", "building_history", "stale_data", "insufficient_historical_measurements", "no_kpi_data"]),
  ready: z.boolean(),
  directional: z.boolean(),
  currentKpiCount: nonnegativeInteger,
  totalMeasurementCount: nonnegativeInteger,
  readyKpiCount: nonnegativeInteger,
  directionalKpiCount: nonnegativeInteger,
  historicalDepthLabel: boundedText,
  freshnessLabel: boundedText
}).strict();

const coverage = z.object({
  overallCoverage: finiteNumber.min(0).max(100),
  overallConfidenceLabel: z.enum(["Very Limited", "Learning", "Partial", "Good", "Strong", "High Confidence"]),
  categories: z.array(z.object({
    id: z.enum(["revenue", "financials", "operations", "customers", "sales_pipeline", "processes", "staffing", "issues_risks", "historical_trends", "business_memory"]),
    coverage: finiteNumber.min(0).max(100),
    confidenceLabel: z.enum(["Very Limited", "Learning", "Partial", "Good", "Strong", "High Confidence"]),
    sourceCount: nonnegativeInteger,
    lastUpdated: dateValue.nullable(),
    historyMonths: nonnegativeInteger,
    structuredSourceCount: nonnegativeInteger,
    forecastReady: z.boolean()
  }).strict()).max(10),
  evidenceSummary: z.object({
    originalEvidenceCount: nonnegativeInteger,
    memoryItemCount: nonnegativeInteger,
    derivedFindingCount: nonnegativeInteger
  }).strict()
}).strict();

const contextualEvidence = z.object({
  contractVersion: z.literal("business_note_context_record_v1"),
  snapshotAdapterVersion: z.literal("business_note_context_snapshot_adapter_v1"),
  id: boundedLabel,
  workspaceId: boundedLabel,
  releaseChannel: z.enum(["production", "preview", "development"]),
  sourceNoteId: boundedLabel,
  sourceVersion: z.number().int().positive(),
  sourceTextHash: z.string().regex(/^[a-f0-9]{64}$/),
  authorityRole: z.literal("supporting_context"),
  originalEvidenceEligible: z.literal(false),
  lifecycle: z.literal("active"),
  validationState: z.literal("approved_review"),
  title: z.string().min(1).max(160),
  summary: z.string().min(1).max(800),
  noteType: z.enum(BUSINESS_NOTE_TYPES),
  sourceClassification: z.enum(BUSINESS_NOTE_SOURCE_CLASSIFICATIONS),
  departments: z.array(boundedLabel).max(12),
  topics: z.array(boundedLabel).max(20),
  entities: z.array(z.object({
    id: boundedLabel,
    kind: z.enum(["person", "customer", "vendor", "project"]),
    name: boundedLabel,
    sourceQuote: boundedText,
    provenance: z.literal("original_note_extraction")
  }).strict()).max(INTELLIGENCE_SNAPSHOT_LIMITS.contextualEntitiesPerRecord),
  statements: z.array(z.object({
    id: boundedLabel,
    kind: z.enum(["reported_fact", "opinion_or_assumption", "reported_risk", "reported_opportunity", "reported_decision", "reported_metric"]),
    text: z.string().min(1).max(600),
    sourceQuote: boundedText,
    confidence: finiteNumber.min(0).max(1),
    provenance: z.literal("original_note_extraction")
  }).strict()).max(INTELLIGENCE_SNAPSHOT_LIMITS.contextualStatementsPerRecord),
  userAddedContext: z.array(z.object({
    field: z.enum(BUSINESS_NOTE_ADDITIONAL_CONTEXT_KEYS),
    label: boundedLabel,
    value: boundedLabel,
    provenance: z.literal("supplied_during_review"),
    userProvided: z.literal(true),
    partOfOriginalNoteQuotation: z.literal(false),
    evidenceTreatment: z.literal("contextual_metadata")
  }).strict()).max(INTELLIGENCE_SNAPSHOT_LIMITS.contextualUserFieldsPerRecord),
  applicability: z.object({
    start: dateValue.nullable(),
    end: dateValue.nullable(),
    source: z.enum(["user_review", "validated_extraction", "undated"]),
    temporalStatus: z.enum(["applicable", "upcoming", "undated"])
  }).strict(),
  extractionConfidence: finiteNumber.min(0).max(1),
  approvedAt: timestampValue,
  observedAt: dateValue.nullable(),
  provenance: z.object({
    version: z.literal("business_note_context_provenance_v1"),
    extractionVersion: boundedLabel,
    validatorVersion: boundedLabel,
    policyVersion: boundedLabel,
    providerName: boundedLabel.nullable(),
    modelUsed: boundedLabel.nullable(),
    fallbackUsed: z.boolean(),
    reviewedExtractionHash: fingerprint,
    userContextProvenance: z.literal("separate_review_context")
  }).strict()
}).strict();

const versions = z.object({
  calculations: z.object({
    kpiSemantics: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.calculations.kpiSemantics),
    intelligenceLayer: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.calculations.intelligenceLayer),
    businessHealth: z.enum(BUSINESS_HEALTH_CALCULATION_VERSIONS),
    dataQuality: z.enum(DATA_QUALITY_CALCULATION_VERSIONS),
    forecastReadiness: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.calculations.forecastReadiness),
    coverage: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.calculations.coverage)
  }).strict(),
  policies: z.object({
    evidenceEligibility: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.policies.evidenceEligibility),
    lineage: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.policies.lineage),
    freshness: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.policies.freshness),
    ordering: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.policies.ordering)
  }).strict(),
  adapters: z.object({
    intelligenceLayer: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.adapters.intelligenceLayer),
    kpis: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.adapters.kpis),
    coverage: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.adapters.coverage),
    evidence: z.literal(DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1.adapters.evidence)
  }).strict()
}).strict();

export const intelligenceSnapshotV1Schema: z.ZodType<IntelligenceSnapshotV1> = z.object({
  contract: z.object({
    id: z.literal("intelligence_snapshot_v1"),
    version: z.literal("1.0.0"),
    schemaVersion: z.literal(1)
  }).strict(),
  scope: z.object({
    workspaceId: boundedLabel,
    asOf: timestampValue,
    evaluationDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  }).strict(),
  versions,
  fingerprints: z.object({ input: fingerprint, snapshot: fingerprint }).strict(),
  businessHealth: snapshotStateSchema(z.object({
    score: finiteNumber.min(0).max(100),
    status: z.enum(["Strong", "Watch", "At Risk"]),
    trajectory: z.enum(["Improving", "Holding steady", "Declining", "Not enough history"]),
    confidence: z.enum(["High", "Medium", "Low"]),
    components: snapshotStateSchema(z.object({
      dataQualityBase: finiteNumber.min(0).max(100),
      riskPenalty: finiteNumber.min(0),
      opportunityAdjustment: finiteNumber.min(0),
      driverImpacts: z.array(z.object({
        findingId: boundedLabel,
        kind: z.enum(["risk", "opportunity"]),
        scoreImpact: finiteNumber
      }).strict()).max(INTELLIGENCE_SNAPSHOT_LIMITS.findings)
    }).strict())
  }).strict()),
  dataQuality: snapshotStateSchema(z.object({
    score: finiteNumber.min(0).max(100),
    label: z.enum(["Strong", "Developing", "Limited"]),
    confidence: z.enum(["High", "Medium", "Low"])
  }).strict()),
  readiness: z.object({
    forecast: snapshotStateSchema(forecastReadiness),
    coverage: snapshotStateSchema(coverage)
  }).strict(),
  kpis: z.array(kpiSnapshot).max(INTELLIGENCE_SNAPSHOT_LIMITS.kpis),
  findings: z.array(finding).max(INTELLIGENCE_SNAPSHOT_LIMITS.findings),
  findingIndex: z.object({
    riskFindingIds: z.array(boundedLabel).max(INTELLIGENCE_SNAPSHOT_LIMITS.findings),
    opportunityFindingIds: z.array(boundedLabel).max(INTELLIGENCE_SNAPSHOT_LIMITS.findings),
    recommendationFindingIds: z.array(boundedLabel).max(INTELLIGENCE_SNAPSHOT_LIMITS.findings),
    forecastFindingIds: z.array(boundedLabel).max(INTELLIGENCE_SNAPSHOT_LIMITS.findings)
  }).strict(),
  priorities: z.array(z.object({
    role: z.enum(["top_risk", "top_opportunity", "top_recommendation", "top_forecast"]),
    rank: z.literal(1),
    findingId: boundedLabel
  }).strict()).max(INTELLIGENCE_SNAPSHOT_LIMITS.priorities),
  evidence: z.object({
    references: z.array(evidenceReference).max(INTELLIGENCE_SNAPSHOT_LIMITS.evidenceReferences),
    citations: z.array(z.object({
      id: boundedLabel,
      evidenceReferenceId: boundedLabel,
      manifestId: boundedLabel,
      sourceOrdinal: boundedLabel
    }).strict()).max(INTELLIGENCE_SNAPSHOT_LIMITS.citations),
    sourceRegistryVersions: z.array(z.literal(SOURCE_REGISTRY_VERSION)).max(INTELLIGENCE_SNAPSHOT_LIMITS.sourceRegistryVersions)
  }).strict(),
  contextualEvidence: z.array(contextualEvidence).max(INTELLIGENCE_SNAPSHOT_LIMITS.contextualEvidenceRecords).optional(),
  limitations: z.array(z.object({
    code: boundedLabel,
    scope: z.enum(["snapshot", "business_health", "data_quality", "forecast", "coverage", "kpi", "finding", "evidence"]),
    severity: z.enum(["information", "warning"]),
    message: boundedText
  }).strict()).max(INTELLIGENCE_SNAPSHOT_LIMITS.limitations),
  provenance: z.array(z.object({
    producerId: z.enum(["intelligence_layer", "canonical_kpi_semantics", "business_intelligence_coverage", "evidence_engine_manifest", "validated_business_note_context"]),
    producerVersion: z.enum(["intelligence_layer_v1", "kpi_semantics_v1", "business_intelligence_coverage_v1", "evidence_manifest_v1", "business_note_context_record_v1"]),
    workspaceId: boundedLabel,
    asOf: timestampValue,
    semanticInputFingerprint: fingerprint
  }).strict()).max(5)
}).strict();

export const intelligenceSnapshotBuildReceiptV1Schema: z.ZodType<IntelligenceSnapshotBuildReceiptV1> = z.object({
  id: fingerprint,
  snapshotFingerprint: fingerprint,
  workspaceId: boundedLabel,
  generatedAt: timestampValue,
  builderVersion: boundedLabel,
  validation: z.object({ status: z.literal("passed"), invariantCount: nonnegativeInteger }).strict(),
  adapterVersions: versions.shape.adapters,
  performance: z.object({
    totalMs: finiteNumber.min(0),
    adapterMs: finiteNumber.min(0),
    orderingMs: finiteNumber.min(0),
    validationMs: finiteNumber.min(0),
    hashingMs: finiteNumber.min(0),
    serializationMs: finiteNumber.min(0)
  }).strict(),
  fixtureSizes: z.object({
    kpis: nonnegativeInteger,
    findings: nonnegativeInteger,
    evidenceReferences: nonnegativeInteger,
    citations: nonnegativeInteger,
    serializedBytes: nonnegativeInteger
  }).strict()
}).strict();

export function parseIntelligenceSnapshotV1(value: unknown) {
  return intelligenceSnapshotV1Schema.parse(value);
}

export function parseIntelligenceSnapshotBuildReceiptV1(value: unknown) {
  return intelligenceSnapshotBuildReceiptV1Schema.parse(value);
}
