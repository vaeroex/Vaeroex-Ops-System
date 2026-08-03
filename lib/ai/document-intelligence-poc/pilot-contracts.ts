import "server-only";

export const DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION = "document_router_pilot_v1" as const;
export const DOCUMENT_ASSESSMENT_VERSION = "document_assessment_v1" as const;
export const DOCUMENT_ROUTING_POLICY_VERSION = "document_routing_policy_v1" as const;
export const DOCUMENT_AGREEMENT_VERSION = "document_extraction_agreement_v1" as const;
export const DOCUMENT_PILOT_NORMALIZATION_VERSION = "document_pilot_normalization_v1" as const;
export const DOCUMENT_PILOT_TELEMETRY_VERSION = "document_pilot_telemetry_v1" as const;
export const DOCUMENT_UPLOAD_CONCEPT_LABEL = "Upload Evidence" as const;

export type DocumentPilotFileKind = "csv" | "xlsx" | "docx" | "pdf" | "png" | "jpeg" | "unsupported";
export type DocumentPilotEnvironment = "development" | "preview" | "production" | "test";
export type DocumentPilotMode = "routing_dry_run" | "shadow_extraction" | "dual_extraction_comparison" | "cost_only_measurement";
export type DocumentAssessmentState =
  | "native_clean"
  | "native_acceptable"
  | "native_low_quality"
  | "image_only"
  | "visual_specialist_required"
  | "unsupported"
  | "review_required";
export type DocumentRoutingPath =
  | "deterministic_structured_parser"
  | "native_document_extraction"
  | "nvidia_direct"
  | "nvidia_fallback"
  | "unsupported";
export type DocumentRoutingExecution = "native_only" | "pilot_dry_run" | "pilot_cost_only" | "pilot_shadow_allowed" | "pilot_disabled";
export type DocumentAssessmentReasonCode =
  | "structured_native_required"
  | "native_text_clean"
  | "native_text_acceptable"
  | "image_input_requires_visual_extraction"
  | "image_only_document"
  | "no_meaningful_native_text"
  | "low_characters_per_page"
  | "severe_invalid_character_ratio"
  | "elevated_invalid_character_ratio"
  | "severe_repeated_garbage"
  | "elevated_repeated_garbage"
  | "reading_order_corrupt"
  | "reading_order_degraded"
  | "table_reconstruction_failed"
  | "critical_numbers_without_labels"
  | "conflicting_reporting_periods"
  | "critical_page_provenance_missing"
  | "unsupported_document_layout"
  | "native_validator_failed"
  | "declared_type_mismatch"
  | "page_limit_exceeded"
  | "file_size_limit_exceeded"
  | "authorized_file_required"
  | "synthetic_pilot_only"
  | "unsupported_file_type";

export type DocumentMagicByteAssessment = Readonly<{
  detected: "pdf" | "png" | "jpeg" | "zip_container" | "plain_text" | "unknown";
  declaredTypeMatches: boolean;
  extensionMatches: boolean;
}>;

export type NativeDocumentObservations = Readonly<{
  text?: string;
  pageCount?: number;
  nativeTextPageCount?: number;
  imageOnlyPageEstimate?: number;
  readingOrderQuality?: "good" | "degraded" | "corrupt" | "unknown";
  tableDetected?: boolean;
  tableReconstructionSuccess?: boolean | null;
  pageAssociationAvailable?: boolean;
  orientation?: "portrait" | "landscape" | "mixed" | "unknown";
  rotation?: 0 | 90 | 180 | 270 | "mixed" | "unknown";
  skewIndicators?: readonly string[];
  lowResolutionIndicators?: readonly string[];
  contrastIndicators?: readonly string[];
  extractionWarnings?: readonly string[];
  conflictingReportingPeriods?: boolean;
  unsupportedLayout?: boolean;
  validatorPassed?: boolean | null;
  criticalFieldCount?: number;
  criticalFieldsWithLabels?: number;
  criticalFieldsWithPageProvenance?: number;
}>;

export type DocumentAssessmentInputV1 = Readonly<{
  declaredMimeType: string;
  extension: string;
  fileSizeBytes: number;
  magicBytes: Buffer;
  native: NativeDocumentObservations;
  visualDocumentClass?: "screenshot" | "phone_photo" | "scan" | "handwritten_annotation" | "other";
}>;

export type DocumentAssessmentV1 = Readonly<{
  version: typeof DOCUMENT_ASSESSMENT_VERSION;
  mimeType: string;
  extension: string;
  fileKind: DocumentPilotFileKind;
  magicBytes: DocumentMagicByteAssessment;
  pageCount: number | null;
  fileSizeBytes: number;
  nativeTextAvailable: boolean;
  extractedCharacterCount: number;
  charactersPerPage: number | null;
  imageOnlyPageEstimate: number | null;
  textLayerCoverage: number | null;
  invalidCharacterRatio: number;
  repeatedGarbageRatio: number;
  readingOrderQuality: "good" | "degraded" | "corrupt" | "unknown";
  numericTokenCount: number;
  labeledNumericFieldCount: number;
  currencyTokenCount: number;
  percentageTokenCount: number;
  dateTokenCount: number;
  reportingPeriodDetection: "detected" | "conflicting" | "not_detected";
  tableDetection: boolean;
  tableReconstructionSuccess: boolean | null;
  pageAssociationAvailable: boolean;
  orientation: "portrait" | "landscape" | "mixed" | "unknown";
  rotation: 0 | 90 | 180 | 270 | "mixed" | "unknown";
  skewIndicators: readonly string[];
  lowResolutionIndicators: readonly string[];
  contrastIndicators: readonly string[];
  extractionWarnings: readonly string[];
  assessmentScore: number;
  state: DocumentAssessmentState;
  reasonCodes: readonly DocumentAssessmentReasonCode[];
}>;

export type DocumentRoutingDecisionV1 = Readonly<{
  contractVersion: typeof DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION;
  routingPolicyVersion: typeof DOCUMENT_ROUTING_POLICY_VERSION;
  mode: DocumentPilotMode;
  path: DocumentRoutingPath;
  execution: DocumentRoutingExecution;
  nvidiaExecutionAllowed: boolean;
  reasonCodes: readonly DocumentAssessmentReasonCode[];
  reviewRequired: boolean;
  writesAuthoritativeData: false;
}>;

export type RoutedDocumentAssessmentV1 = Readonly<{
  assessment: DocumentAssessmentV1;
  decision: DocumentRoutingDecisionV1;
}>;

export type DocumentPilotConfig = Readonly<{
  environment: DocumentPilotEnvironment;
  mode: DocumentPilotMode;
  routerPilotEnabled: boolean;
  nvidiaPilotEnabled: boolean;
  shadowConfirmationEnabled: boolean;
  nvidiaExecutionAllowed: boolean;
  syntheticOnly: true;
  maxPages: number;
  maxFileBytes: number;
  maxExtractionAttempts: 2;
  maxProviderCalls: number;
  maxLatencyMs: number;
  planningCostPerPageUsd: number | null;
  planningCostPerCallUsd: number | null;
}>;

export type DocumentCriticalFieldType =
  | "kpi_name"
  | "kpi_value"
  | "kpi_target"
  | "sign"
  | "decimal"
  | "currency"
  | "percentage"
  | "unit"
  | "reporting_period"
  | "page"
  | "source_coordinates";

export type DocumentCriticalField = Readonly<{
  identity: string;
  type: DocumentCriticalFieldType;
  value: string;
  page: number | null;
  sourceCoordinates: readonly [number, number, number, number] | null;
  critical: boolean;
}>;

export type DocumentExtractionFailureCode =
  | "transport_failure"
  | "timeout"
  | "rate_limit"
  | "provider_unavailable"
  | "validation_failure"
  | "malformed_content"
  | "unsupported_input"
  | "circuit_open"
  | null;

export type ProviderNeutralDocumentExtractionV1 = Readonly<{
  contractVersion: typeof DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION;
  normalizationVersion: typeof DOCUMENT_PILOT_NORMALIZATION_VERSION;
  source: "native" | "nvidia";
  provider: "vaeroex" | "nvidia";
  model: string;
  clientRevision: string;
  status: "success" | "failed";
  pageCount: number;
  outputElementCount: number;
  criticalFields: readonly DocumentCriticalField[];
  validationResult: "valid" | "review_required" | "invalid";
  failureCode: DocumentExtractionFailureCode;
  latencyMs: number;
  providerCalls: number;
  successfulCalls: number;
  failedCalls: number;
  retries: number;
}>;

export type DocumentAgreementClassification =
  | "exact_agreement"
  | "normalized_agreement"
  | "noncritical_disagreement"
  | "critical_disagreement"
  | "one_parser_missing"
  | "both_unreliable";

export type DocumentFieldAgreement = Readonly<{
  identityHash: string;
  fieldType: DocumentCriticalFieldType;
  result: "exact" | "normalized" | "different" | "missing_native" | "missing_nvidia";
  critical: boolean;
}>;

export type DocumentExtractionAgreementV1 = Readonly<{
  version: typeof DOCUMENT_AGREEMENT_VERSION;
  classification: DocumentAgreementClassification;
  fieldsCompared: number;
  criticalDisagreements: number;
  reviewRequired: boolean;
  fieldResults: readonly DocumentFieldAgreement[];
  establishesBusinessTruth: false;
}>;

export type DocumentPilotCacheIdentity = Readonly<{
  documentHash: string;
  provider: "nvidia";
  model: string;
  clientRevision: string;
  extractionContractVersion: typeof DOCUMENT_ROUTER_PILOT_CONTRACT_VERSION;
  normalizationVersion: typeof DOCUMENT_PILOT_NORMALIZATION_VERSION;
  routingPolicyVersion: typeof DOCUMENT_ROUTING_POLICY_VERSION;
}>;

export type DocumentPilotTelemetryV1 = Readonly<{
  version: typeof DOCUMENT_PILOT_TELEMETRY_VERSION;
  workspaceScopeHash: string;
  documentHash: string;
  documentType: DocumentPilotFileKind;
  parserSelected: DocumentRoutingPath;
  routingReasonCodes: readonly DocumentAssessmentReasonCode[];
  pageCount: number | null;
  pagesSentToNvidia: number;
  providerCalls: number;
  successfulCalls: number;
  failedCalls: number;
  retries: number;
  latencyMs: number;
  inputSizeBytes: number;
  outputElementCount: number;
  cacheHit: boolean;
  duplicateDocumentSkip: boolean;
  assessmentResult: DocumentAssessmentState;
  validationResult: "valid" | "review_required" | "invalid" | "not_run";
  reviewRequired: boolean;
  costEstimateKind: "configured_planning_estimate" | "unknown";
  costBasis: "actual_provider_usage" | "projected_eligible_usage" | "none";
  costBasisPages: number;
  costBasisCalls: number;
  estimatedCostUsd: number | null;
  mode: DocumentPilotMode;
}>;

export type DocumentPilotOutcomeV1 = Readonly<{
  routed: RoutedDocumentAssessmentV1;
  selectedExtraction: ProviderNeutralDocumentExtractionV1 | null;
  nativeExtractionPreserved: boolean;
  agreement: DocumentExtractionAgreementV1 | null;
  reviewRequired: boolean;
  authorityDisposition: "preview_only_no_authoritative_write";
  cacheHit: boolean;
  duplicateDocumentSkip: boolean;
  telemetry: DocumentPilotTelemetryV1;
}>;

export type DocumentPilotAggregateMetrics = Readonly<{
  documents: number;
  workspaces: number;
  averageNvidiaPagesPerDocument: number;
  averageNvidiaPagesPerWorkspace: number;
  uploadsBypassingNvidiaPercent: number;
  nativeEscalationPercent: number;
  cacheHitRate: number;
  duplicateSkipRate: number;
  averageEstimatedCostPerWorkspaceUsd: number | null;
  estimatedCostPer100PagesUsd: number | null;
  estimatedCostPer1000PagesUsd: number | null;
  estimatedCostPer10000PagesUsd: number | null;
  estimatedCostAsPercentOf500Subscription: number | null;
}>;
