import type { Json } from "@/lib/supabase/types";

export const DOCUMENT_EXTRACTION_ROUTING_POLICY_VERSION = "document_extraction_routing_v1" as const;
export const DOCUMENT_EXTRACTION_CONTRACT_VERSION = "document_extraction_artifact_v1" as const;
export const DOCUMENT_EXTRACTION_NORMALIZATION_VERSION = "document_extraction_normalization_v1" as const;
export const DOCUMENT_EXTRACTION_REVIEW_VERSION = 1 as const;
export const DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION =
  "document_extraction_review_provenance_v1" as const;
export const DOCUMENT_EXTRACTION_PAGE_IDENTITY_VERSION =
  "document_extraction_page_identity_v1" as const;
export const DOCUMENT_EXTRACTION_WORKSPACE_BINDING_VERSION =
  "document_extraction_workspace_binding_v1" as const;
export const DOCUMENT_EXTRACTION_JOB_BINDING_VERSION =
  "document_extraction_job_binding_v1" as const;
export const DOCUMENT_EXTRACTION_BROKER_PROTOCOL_VERSION = "document_extraction_broker_v2" as const;
export const DOCUMENT_EXTRACTION_WORKER_RUNTIME_VERSION = "document_extraction_worker_v2" as const;
export const DOCUMENT_EXTRACTION_CIRCUIT_POLICY_VERSION = "document_extraction_circuit_v1" as const;
export const DOCUMENT_EXTRACTION_TELEMETRY_VERSION = "document_extraction_telemetry_v1" as const;
export const DOCUMENT_EXTRACTION_PRODUCTION_APPROVAL_VERSION =
  "document_extraction_production_pilot_v1" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_PROVIDER = "nvidia" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_MODEL = "nvidia/nemotron-parse" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_CLIENT_REVISION =
  "vaeroex_nemotron_parse_rest_v2" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_PARSER_REVISION =
  "nemotron_parse_hosted_tool_call_rest_v2" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION =
  "nvidia_build_nemotron_parse_hosted_tool_call_v2" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE = "hosted_tool_call_v2" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_HOSTED_COMPATIBILITY_CONTRACT_VERSION =
  "hosted_tool_call_v2" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION =
  "nemotron_parse_hosted_request_v1" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION =
  "nemotron_parse_hosted_response_v2" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION =
  "nemotron_parse_hosted_normalization_v1" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_V1_2_MODEL = "nvidia/nemotron-parse-v1.2" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_V1_2_PARSER_REVISION =
  "nemotron_parse_v1_2_tagged_rest_v1" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_V1_2_ENDPOINT_CONTRACT_VERSION =
  "nemotron_parse_v1_2_openai_chat_v1" as const;
export const NVIDIA_DOCUMENT_EXTRACTION_MAX_FILE_BYTES = 25_000_000 as const;
export const NVIDIA_DOCUMENT_EXTRACTION_MAX_PAGES = 16 as const;
export const NVIDIA_DOCUMENT_EXTRACTION_MAX_RENDERED_DIMENSION = 2_048 as const;
export const NVIDIA_DOCUMENT_EXTRACTION_TIMEOUT_SECONDS = 120 as const;
export const NVIDIA_DOCUMENT_EXTRACTION_MAX_RETRIES = 1 as const;

export type DocumentExtractionRoute = "native" | "nvidia_primary" | "nvidia_fallback";
export type DocumentExtractionDocumentClass =
  | "digital_pdf"
  | "digital_docx"
  | "scanned_pdf"
  | "image_only_pdf"
  | "png"
  | "jpeg"
  | "screenshot"
  | "phone_photo";
export type DocumentExtractionStage =
  | "queued"
  | "leased"
  | "preparing"
  | "dispatching"
  | "provider_dispatched"
  | "extracting"
  | "normalizing"
  | "validating"
  | "encrypting"
  | "awaiting_review"
  | "classifying"
  | "promoting"
  | "terminal";
export type DocumentExtractionStatus =
  | "queued"
  | "processing"
  | "needs_review"
  | "completed"
  | "failed"
  | "cancelled"
  | "dispatch_unknown";
export type DocumentExtractionReviewStatus =
  | "pending"
  | "in_review"
  | "approved"
  | "approved_with_corrections"
  | "rejected"
  | "unresolved"
  | "stale"
  | "invalidated";
export type DocumentExtractionCriticalFieldKind =
  | "kpi_name"
  | "current_value"
  | "target"
  | "sign"
  | "decimal"
  | "currency"
  | "percentage"
  | "unit"
  | "reporting_period"
  | "page"
  | "source_coordinates";
export type DocumentExtractionCriticalFieldDecision = "confirmed" | "corrected" | "rejected" | "unresolved";
export type DocumentExtractionReviewAction = "save" | "approve" | "reject";
export type DocumentExtractionCriticalFieldValueType = "string" | "number" | "boolean" | "coordinates";

export type DocumentSourceCoordinatesV1 = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DocumentExtractionCriticalFieldV1 = {
  id: string;
  kind: DocumentExtractionCriticalFieldKind;
  value: string | number | boolean | null;
  normalizedValue: string | number | boolean | null;
  page: number;
  coordinates: DocumentSourceCoordinatesV1 | null;
  confidence: number | null;
  validationReasonCodes: string[];
};

export type DocumentExtractionValidationFindingV1 = {
  code: string;
  severity: "info" | "warning" | "error";
  fieldId: string | null;
  page: number | null;
};

export type NormalizedDocumentExtractionArtifactV1 = {
  contractVersion: typeof DOCUMENT_EXTRACTION_CONTRACT_VERSION;
  normalizationVersion: typeof DOCUMENT_EXTRACTION_NORMALIZATION_VERSION;
  route: DocumentExtractionRoute;
  documentClass: DocumentExtractionDocumentClass;
  pageCount: number;
  pages: Array<{
    page: number;
    blocks: Array<{
      id: string;
      kind: "text" | "table" | "heading" | "key_value";
      text: string;
      coordinates: DocumentSourceCoordinatesV1 | null;
    }>;
  }>;
  criticalFields: DocumentExtractionCriticalFieldV1[];
  validationFindings: DocumentExtractionValidationFindingV1[];
  artifactFingerprint: string;
};

export type DocumentExtractionCorrectedFieldV1 = {
  fieldId: string;
  decision: DocumentExtractionCriticalFieldDecision;
  correctedValue?: string | number | boolean | null;
  correctedPage?: number;
  correctedCoordinates?: DocumentSourceCoordinatesV1 | null;
  reasonCode?: string;
};

export type DocumentExtractionCriticalFieldManifestV1 = {
  manifest_version: "document_extraction_critical_fields_v1";
  artifact_fingerprint: string;
  extraction_contract_version: typeof DOCUMENT_EXTRACTION_CONTRACT_VERSION;
  fields: Array<{
    id: string;
    kind: DocumentExtractionCriticalFieldKind;
    value_type: DocumentExtractionCriticalFieldValueType;
  }>;
};

export type DocumentExtractionReviewProvenanceV1 = {
  review_provenance_version: typeof DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION;
  content_fingerprint: string;
  parser_revision: string;
  client_revision: string;
  provider_profile: string;
  endpoint_contract_version: string;
  request_serializer_version: string;
  response_validator_version: string;
  provider_normalization_version: string;
  artifact_normalization_version: typeof DOCUMENT_EXTRACTION_NORMALIZATION_VERSION;
  compatibility_policy_version: string;
  model_alias: string;
  page_identity_fingerprint: string;
  workspace_binding_fingerprint: string;
  job_binding_fingerprint: string;
  review_version: typeof DOCUMENT_EXTRACTION_REVIEW_VERSION;
};

export type DocumentExtractionCriticalFieldManifestV2 = {
  manifest_version: "document_extraction_critical_fields_v2";
  artifact_fingerprint: string;
  extraction_contract_version: typeof DOCUMENT_EXTRACTION_CONTRACT_VERSION;
  review_provenance_fingerprint: string;
  review_provenance: DocumentExtractionReviewProvenanceV1;
  fields: DocumentExtractionCriticalFieldManifestV1["fields"];
};

export type DocumentExtractionCriticalFieldManifest =
  | DocumentExtractionCriticalFieldManifestV1
  | DocumentExtractionCriticalFieldManifestV2;

export type DocumentExtractionReviewDecisionV1 = {
  reviewVersion: typeof DOCUMENT_EXTRACTION_REVIEW_VERSION;
  action: DocumentExtractionReviewAction;
  artifactFingerprint: string;
  classificationFingerprint: string | null;
  extractionContractVersion: typeof DOCUMENT_EXTRACTION_CONTRACT_VERSION;
  fields: DocumentExtractionCorrectedFieldV1[];
};

export type DocumentExtractionApprovalEnvelopeV1 = {
  mode: "reviewed_document_extraction";
  jobId: string;
  reviewId: string;
  artifactFingerprint: string;
  classificationFingerprint: string;
  reviewVersion: typeof DOCUMENT_EXTRACTION_REVIEW_VERSION;
};

export type DocumentExtractionFingerprintsV1 = {
  contentHmac: string;
  cacheKey: string;
  artifactFingerprint?: string;
  classificationFingerprint?: string;
};

export type EncryptedDocumentExtractionEnvelopeV1 = {
  algorithm: "aes-256-gcm";
  keyVersion: string;
  nonce: Uint8Array;
  authenticationTag: Uint8Array;
  aadDigest: string;
  ciphertext: Uint8Array;
};

export type DocumentExtractionEligibilityReason =
  | "globally_disabled"
  | "worker_disabled"
  | "provider_calls_disabled"
  | "workspace_not_entitled"
  | "workspace_disabled"
  | "quota_exhausted"
  | "document_class_not_allowed"
  | "circuit_open"
  | "concurrency_limit_reached"
  | "review_required"
  | "approval_missing"
  | "stale_fingerprint"
  | "phase_a_inert"
  | "eligible";

export type DocumentExtractionEligibilityResult = {
  eligible: boolean;
  reason: DocumentExtractionEligibilityReason;
  privacySafeMetadata?: Json;
};

// Provider-specific response shapes must be normalized before crossing this boundary.
// None of these contracts confer Evidence, Business Memory, KPI, or intelligence authority.
