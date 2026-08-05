import "server-only";

import { createHash } from "node:crypto";
import {
  DOCUMENT_EXTRACTION_JOB_BINDING_VERSION,
  DOCUMENT_EXTRACTION_NORMALIZATION_VERSION,
  DOCUMENT_EXTRACTION_NORMALIZATION_VERSION_V2,
  DOCUMENT_EXTRACTION_PAGE_IDENTITY_VERSION,
  DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION,
  DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION_V2,
  DOCUMENT_EXTRACTION_REVIEW_VERSION,
  DOCUMENT_EXTRACTION_ROUTING_POLICY_VERSION,
  DOCUMENT_EXTRACTION_WORKSPACE_BINDING_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_CLIENT_REVISION,
  GOOGLE_DOCUMENT_EXTRACTION_COMPATIBILITY_POLICY_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_CONFIDENCE_POLICY_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_LOCATION,
  GOOGLE_DOCUMENT_EXTRACTION_MODEL,
  GOOGLE_DOCUMENT_EXTRACTION_PARSER_REVISION,
  GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_TYPE,
  GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  GOOGLE_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_SELECTION_MARK_POLICY_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_TABLE_POLICY_VERSION,
  type DocumentExtractionReviewProvenanceV1,
  type DocumentExtractionReviewProvenanceV2
} from "@/lib/document-extraction/contracts";

const HEX_64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,200}$/;
const PROCESSOR_RESOURCE = /^projects\/[1-9][0-9]{5,20}\/locations\/us\/processors\/[a-f0-9]{8,64}\/processorVersions\/pretrained-ocr-v2\.1-2024-08-07$/;

export type DocumentExtractionReviewProvenanceInput = {
  workspaceId: string;
  jobId: string;
  cacheKey: string;
  contentFingerprint: string;
  pageCount: number;
  parserRevision: string;
  clientRevision: string;
  providerProfile: string;
  endpointContractVersion: string;
  requestSerializerVersion: string;
  responseValidatorVersion: string;
  providerNormalizationVersion: string;
  compatibilityPolicyVersion: string;
  modelAlias: string;
};

export type DocumentExtractionReviewProvenanceInputV2 = {
  workspaceId: string;
  jobId: string;
  cacheKey: string;
  contentFingerprint: string;
  pageCount: number;
  processorId: string;
  processorResource: string;
  routingPolicyVersion: string;
};

function sha256Components(components: Array<string | number>) {
  return createHash("sha256").update(components.map(String).join("\n"), "utf8").digest("hex");
}

function identity(value: string, label: string) {
  if (!IDENTITY.test(value)) throw new Error(`Invalid document extraction ${label}.`);
  return value;
}

function hex(value: string, label: string) {
  if (!HEX_64.test(value)) throw new Error(`Invalid document extraction ${label}.`);
  return value;
}

export function documentExtractionReviewProvenanceFingerprint(
  provenance: DocumentExtractionReviewProvenanceV1
) {
  return sha256Components([
    provenance.review_provenance_version,
    provenance.content_fingerprint,
    provenance.parser_revision,
    provenance.client_revision,
    provenance.provider_profile,
    provenance.endpoint_contract_version,
    provenance.request_serializer_version,
    provenance.response_validator_version,
    provenance.provider_normalization_version,
    provenance.artifact_normalization_version,
    provenance.compatibility_policy_version,
    provenance.model_alias,
    provenance.page_identity_fingerprint,
    provenance.workspace_binding_fingerprint,
    provenance.job_binding_fingerprint,
    provenance.review_version
  ]);
}

export function documentExtractionReviewProvenanceFingerprintV2(
  provenance: DocumentExtractionReviewProvenanceV2
) {
  return sha256Components([
    provenance.review_provenance_version,
    provenance.content_fingerprint,
    provenance.parser_provider,
    provenance.parser_revision,
    provenance.client_revision,
    provenance.provider_profile,
    provenance.processor_type,
    provenance.processor_id,
    provenance.processor_resource,
    provenance.processor_location,
    provenance.processor_version,
    provenance.endpoint_contract_version,
    provenance.request_serializer_version,
    provenance.response_validator_version,
    provenance.provider_normalization_version,
    provenance.artifact_normalization_version,
    provenance.compatibility_policy_version,
    provenance.table_policy_version,
    provenance.confidence_policy_version,
    provenance.selection_mark_policy_version,
    provenance.routing_policy_version,
    provenance.model_alias,
    provenance.page_identity_fingerprint,
    provenance.workspace_binding_fingerprint,
    provenance.job_binding_fingerprint,
    provenance.review_version
  ]);
}

export function buildDocumentExtractionReviewProvenance(
  input: DocumentExtractionReviewProvenanceInput
) {
  const workspaceId = input.workspaceId.toLowerCase();
  const jobId = input.jobId.toLowerCase();
  if (!UUID.test(workspaceId) || !UUID.test(jobId)) {
    throw new Error("Invalid document extraction review binding identity.");
  }
  const cacheKey = hex(input.cacheKey, "cache key");
  const contentFingerprint = hex(input.contentFingerprint, "content fingerprint");
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1 || input.pageCount > 10_000) {
    throw new Error("Invalid document extraction page identity.");
  }
  const workspaceBindingFingerprint = sha256Components([
    DOCUMENT_EXTRACTION_WORKSPACE_BINDING_VERSION,
    workspaceId
  ]);
  const jobBindingFingerprint = sha256Components([
    DOCUMENT_EXTRACTION_JOB_BINDING_VERSION,
    workspaceBindingFingerprint,
    jobId,
    cacheKey
  ]);
  const pageIdentityFingerprint = sha256Components([
    DOCUMENT_EXTRACTION_PAGE_IDENTITY_VERSION,
    jobBindingFingerprint,
    cacheKey,
    input.pageCount
  ]);
  const provenance: DocumentExtractionReviewProvenanceV1 = {
    review_provenance_version: DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION,
    content_fingerprint: contentFingerprint,
    parser_revision: identity(input.parserRevision, "parser revision"),
    client_revision: identity(input.clientRevision, "client revision"),
    provider_profile: identity(input.providerProfile, "provider profile"),
    endpoint_contract_version: identity(input.endpointContractVersion, "endpoint contract"),
    request_serializer_version: identity(input.requestSerializerVersion, "request serializer"),
    response_validator_version: identity(input.responseValidatorVersion, "response validator"),
    provider_normalization_version: identity(
      input.providerNormalizationVersion,
      "provider normalization version"
    ),
    artifact_normalization_version: DOCUMENT_EXTRACTION_NORMALIZATION_VERSION,
    compatibility_policy_version: identity(
      input.compatibilityPolicyVersion,
      "compatibility policy"
    ),
    model_alias: identity(input.modelAlias, "model alias"),
    page_identity_fingerprint: pageIdentityFingerprint,
    workspace_binding_fingerprint: workspaceBindingFingerprint,
    job_binding_fingerprint: jobBindingFingerprint,
    review_version: DOCUMENT_EXTRACTION_REVIEW_VERSION
  };
  return {
    provenance,
    reviewProvenanceFingerprint: documentExtractionReviewProvenanceFingerprint(provenance)
  } as const;
}

export function buildDocumentExtractionReviewProvenanceV2(
  input: DocumentExtractionReviewProvenanceInputV2
) {
  const workspaceId = input.workspaceId.toLowerCase();
  const jobId = input.jobId.toLowerCase();
  if (!UUID.test(workspaceId) || !UUID.test(jobId)) {
    throw new Error("Invalid document extraction review binding identity.");
  }
  const cacheKey = hex(input.cacheKey, "cache key");
  const contentFingerprint = hex(input.contentFingerprint, "content fingerprint");
  if (!Number.isInteger(input.pageCount) || input.pageCount < 1 || input.pageCount > 15) {
    throw new Error("Invalid document extraction page identity.");
  }
  if (!PROCESSOR_RESOURCE.test(input.processorResource)) {
    throw new Error("Invalid Google Document AI processor resource.");
  }
  if (
    !/^[a-f0-9]{8,64}$/.test(input.processorId)
    || !input.processorResource.includes(`/processors/${input.processorId}/`)
    || input.routingPolicyVersion !== DOCUMENT_EXTRACTION_ROUTING_POLICY_VERSION
  ) {
    throw new Error("Invalid Google Document AI review identity.");
  }
  const workspaceBindingFingerprint = sha256Components([
    DOCUMENT_EXTRACTION_WORKSPACE_BINDING_VERSION,
    workspaceId
  ]);
  const jobBindingFingerprint = sha256Components([
    DOCUMENT_EXTRACTION_JOB_BINDING_VERSION,
    workspaceBindingFingerprint,
    jobId,
    cacheKey
  ]);
  const pageIdentityFingerprint = sha256Components([
    DOCUMENT_EXTRACTION_PAGE_IDENTITY_VERSION,
    jobBindingFingerprint,
    cacheKey,
    input.pageCount
  ]);
  const provenance: DocumentExtractionReviewProvenanceV2 = {
    review_provenance_version: DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION_V2,
    content_fingerprint: contentFingerprint,
    parser_provider: GOOGLE_DOCUMENT_EXTRACTION_PROVIDER,
    parser_revision: GOOGLE_DOCUMENT_EXTRACTION_PARSER_REVISION,
    client_revision: GOOGLE_DOCUMENT_EXTRACTION_CLIENT_REVISION,
    provider_profile: GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
    processor_type: GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_TYPE,
    processor_id: input.processorId,
    processor_resource: input.processorResource,
    processor_location: GOOGLE_DOCUMENT_EXTRACTION_LOCATION,
    processor_version: GOOGLE_DOCUMENT_EXTRACTION_PROCESSOR_VERSION,
    endpoint_contract_version: GOOGLE_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION,
    request_serializer_version: GOOGLE_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION,
    response_validator_version: GOOGLE_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION,
    provider_normalization_version: GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION,
    artifact_normalization_version: DOCUMENT_EXTRACTION_NORMALIZATION_VERSION_V2,
    compatibility_policy_version: GOOGLE_DOCUMENT_EXTRACTION_COMPATIBILITY_POLICY_VERSION,
    table_policy_version: GOOGLE_DOCUMENT_EXTRACTION_TABLE_POLICY_VERSION,
    confidence_policy_version: GOOGLE_DOCUMENT_EXTRACTION_CONFIDENCE_POLICY_VERSION,
    selection_mark_policy_version: GOOGLE_DOCUMENT_EXTRACTION_SELECTION_MARK_POLICY_VERSION,
    routing_policy_version: DOCUMENT_EXTRACTION_ROUTING_POLICY_VERSION,
    model_alias: GOOGLE_DOCUMENT_EXTRACTION_MODEL,
    page_identity_fingerprint: pageIdentityFingerprint,
    workspace_binding_fingerprint: workspaceBindingFingerprint,
    job_binding_fingerprint: jobBindingFingerprint,
    review_version: DOCUMENT_EXTRACTION_REVIEW_VERSION
  };
  return {
    provenance,
    reviewProvenanceFingerprint: documentExtractionReviewProvenanceFingerprintV2(provenance)
  } as const;
}
