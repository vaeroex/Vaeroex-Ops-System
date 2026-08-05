import "server-only";

import { createHash } from "node:crypto";
import {
  DOCUMENT_EXTRACTION_JOB_BINDING_VERSION,
  DOCUMENT_EXTRACTION_NORMALIZATION_VERSION,
  DOCUMENT_EXTRACTION_PAGE_IDENTITY_VERSION,
  DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION,
  DOCUMENT_EXTRACTION_REVIEW_VERSION,
  DOCUMENT_EXTRACTION_WORKSPACE_BINDING_VERSION,
  type DocumentExtractionReviewProvenanceV1
} from "@/lib/document-extraction/contracts";

const HEX_64 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTITY = /^[A-Za-z0-9._:/-]{1,200}$/;

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
