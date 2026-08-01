import { KPI_SEMANTIC_VERSION } from "@/lib/kpis/semantics";

export const INTELLIGENCE_SNAPSHOT_CONTRACT_ID = "intelligence_snapshot_v1" as const;
export const INTELLIGENCE_SNAPSHOT_CONTRACT_VERSION = "1.0.0" as const;
export const INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const INTELLIGENCE_SNAPSHOT_BUILDER_VERSION = "intelligence_snapshot_builder_v1" as const;
export const INTELLIGENCE_SNAPSHOT_ORDERING_VERSION = "intelligence_snapshot_ordering_v1" as const;
export const INTELLIGENCE_SNAPSHOT_FINGERPRINT_VERSION = "intelligence_snapshot_fingerprint_v1" as const;
export const BUSINESS_HEALTH_CALCULATION_VERSION_V1 = "business_health_calculation_v1" as const;
export const BUSINESS_HEALTH_CALCULATION_VERSION = "business_health_calculation_v2" as const;
export const DATA_QUALITY_CALCULATION_VERSION_V1 = "data_quality_calculation_v1" as const;
export const DATA_QUALITY_CALCULATION_VERSION = "data_quality_calculation_v2" as const;
export const BUSINESS_HEALTH_CALCULATION_VERSIONS = [BUSINESS_HEALTH_CALCULATION_VERSION_V1, BUSINESS_HEALTH_CALCULATION_VERSION] as const;
export const DATA_QUALITY_CALCULATION_VERSIONS = [DATA_QUALITY_CALCULATION_VERSION_V1, DATA_QUALITY_CALCULATION_VERSION] as const;
export type BusinessHealthCalculationVersion = (typeof BUSINESS_HEALTH_CALCULATION_VERSIONS)[number];
export type DataQualityCalculationVersion = (typeof DATA_QUALITY_CALCULATION_VERSIONS)[number];
export const FORECAST_READINESS_CALCULATION_VERSION = "forecast_readiness_v1" as const;
export const COVERAGE_CALCULATION_VERSION = "business_intelligence_coverage_calculation_v1" as const;
export const EVIDENCE_ELIGIBILITY_POLICY_VERSION = "evidence_eligibility_v1" as const;
export const EVIDENCE_LINEAGE_POLICY_VERSION = "evidence_lineage_v1" as const;
export const FRESHNESS_POLICY_VERSION = "intelligence_freshness_v1" as const;

export const INTELLIGENCE_LAYER_PRODUCER_ID = "intelligence_layer" as const;
export const INTELLIGENCE_LAYER_PRODUCER_VERSION = "intelligence_layer_v1" as const;
export const KPI_DETERMINISTIC_PRODUCER_ID = "canonical_kpi_semantics" as const;
export const KPI_DETERMINISTIC_PRODUCER_VERSION = KPI_SEMANTIC_VERSION;
export const COVERAGE_PRODUCER_ID = "business_intelligence_coverage" as const;
export const COVERAGE_PRODUCER_VERSION = "business_intelligence_coverage_v1" as const;
export const EVIDENCE_MANIFEST_PRODUCER_ID = "evidence_engine_manifest" as const;
export const EVIDENCE_MANIFEST_PRODUCER_VERSION = "evidence_manifest_v1" as const;
export const CONTEXTUAL_EVIDENCE_PRODUCER_ID = "validated_business_note_context" as const;
export const CONTEXTUAL_EVIDENCE_PRODUCER_VERSION = "business_note_context_record_v1" as const;

export const INTELLIGENCE_LAYER_ADAPTER_VERSION = "intelligence_layer_snapshot_adapter_v1" as const;
export const KPI_SNAPSHOT_ADAPTER_VERSION = "canonical_kpi_snapshot_adapter_v1" as const;
export const COVERAGE_SNAPSHOT_ADAPTER_VERSION = "coverage_snapshot_adapter_v1" as const;
export const EVIDENCE_SNAPSHOT_ADAPTER_VERSION = "evidence_manifest_snapshot_adapter_v1" as const;
export const CONTEXTUAL_EVIDENCE_SNAPSHOT_ADAPTER_VERSION = "business_note_context_snapshot_adapter_v1" as const;
export const SHADOW_PARITY_VERSION = "intelligence_snapshot_shadow_parity_v1" as const;

export const SUPPORTED_PRODUCER_VERSIONS = Object.freeze({
  [INTELLIGENCE_LAYER_PRODUCER_ID]: INTELLIGENCE_LAYER_PRODUCER_VERSION,
  [KPI_DETERMINISTIC_PRODUCER_ID]: KPI_DETERMINISTIC_PRODUCER_VERSION,
  [COVERAGE_PRODUCER_ID]: COVERAGE_PRODUCER_VERSION,
  [EVIDENCE_MANIFEST_PRODUCER_ID]: EVIDENCE_MANIFEST_PRODUCER_VERSION,
  [CONTEXTUAL_EVIDENCE_PRODUCER_ID]: CONTEXTUAL_EVIDENCE_PRODUCER_VERSION
});

export const INTELLIGENCE_SNAPSHOT_LIMITS = Object.freeze({
  kpis: 200,
  observationsPerKpi: 6,
  findings: 100,
  priorities: 4,
  evidenceReferences: 500,
  citations: 1_000,
  limitations: 100,
  sourceRegistryVersions: 16,
  sourceIdsPerEvidenceReference: 8,
  lineageIdsPerEvidenceReference: 16,
  findingEvidenceReferences: 24,
  findingKpiDependencies: 16,
  boundedText: 4_000,
  boundedLabel: 256,
  executiveReasoningKpis: 12,
  executiveReasoningFindings: 12,
  executiveReasoningEvidenceReferences: 24,
  executiveReasoningLimitations: 12,
  contextualEvidenceRecords: 24,
  contextualStatementsPerRecord: 12,
  contextualEntitiesPerRecord: 12,
  contextualUserFieldsPerRecord: 3,
  projectedContextRecords: 4,
  projectedContextStatementsPerRecord: 4,
  projectedContextEntitiesPerRecord: 2,
  projectedContextSummaryCharacters: 360,
  projectedContextStatementCharacters: 320,
  projectedContextQuoteExcerptCharacters: 320
});

export type SupportedProducerId = keyof typeof SUPPORTED_PRODUCER_VERSIONS;
export type SupportedProducerVersion = (typeof SUPPORTED_PRODUCER_VERSIONS)[SupportedProducerId];

export const DEFAULT_INTELLIGENCE_SNAPSHOT_VERSIONS_V1 = Object.freeze({
  calculations: {
    kpiSemantics: KPI_SEMANTIC_VERSION,
    intelligenceLayer: INTELLIGENCE_LAYER_PRODUCER_VERSION,
    businessHealth: BUSINESS_HEALTH_CALCULATION_VERSION,
    dataQuality: DATA_QUALITY_CALCULATION_VERSION,
    forecastReadiness: FORECAST_READINESS_CALCULATION_VERSION,
    coverage: COVERAGE_CALCULATION_VERSION
  },
  policies: {
    evidenceEligibility: EVIDENCE_ELIGIBILITY_POLICY_VERSION,
    lineage: EVIDENCE_LINEAGE_POLICY_VERSION,
    freshness: FRESHNESS_POLICY_VERSION,
    ordering: INTELLIGENCE_SNAPSHOT_ORDERING_VERSION
  },
  adapters: {
    intelligenceLayer: INTELLIGENCE_LAYER_ADAPTER_VERSION,
    kpis: KPI_SNAPSHOT_ADAPTER_VERSION,
    coverage: COVERAGE_SNAPSHOT_ADAPTER_VERSION,
    evidence: EVIDENCE_SNAPSHOT_ADAPTER_VERSION
  }
} as const);
