import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { VerifiedWorkerAssertion } from "@/lib/document-extraction/broker-auth";
import {
  DOCUMENT_EXTRACTION_CONTRACT_VERSION,
  DOCUMENT_EXTRACTION_NORMALIZATION_VERSION,
  DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION,
  DOCUMENT_EXTRACTION_ROUTING_POLICY_VERSION,
  GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  NVIDIA_DOCUMENT_EXTRACTION_CLIENT_REVISION,
  NVIDIA_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_HOSTED_COMPATIBILITY_CONTRACT_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_MODEL,
  NVIDIA_DOCUMENT_EXTRACTION_PARSER_REVISION,
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER,
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
  NVIDIA_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION,
  NVIDIA_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION,
  type DocumentExtractionCriticalFieldManifestV2,
  type DocumentExtractionCriticalFieldManifestV3
} from "@/lib/document-extraction/contracts";

type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

export type ClaimedDocumentExtractionJob = {
  id: string;
  route: "nvidia_primary" | "nvidia_fallback" | "google_primary" | "google_fallback";
  document_class: string;
  page_count: number;
  lease_expires_at: string;
};

export type DocumentExtractionLeaseContext = {
  job_id: string;
  workspace_id: string;
  route: "nvidia_primary" | "nvidia_fallback" | "google_primary" | "google_fallback";
  document_class: string;
  page_count: number;
  cache_key: string;
  parser_provider: string;
  parser_model: string;
  parser_revision: string;
  client_revision: string;
  provider_profile: string;
  processor_type: string | null;
  processor_id: string | null;
  processor_resource: string | null;
  processor_location: string | null;
  processor_version: string | null;
  endpoint_contract_version: string;
  request_serializer_version: string;
  response_validator_version: string;
  provider_normalization_version: string;
  compatibility_policy_version: string;
  table_policy_version: string | null;
  confidence_policy_version: string | null;
  selection_mark_policy_version: string | null;
  routing_policy_version: string;
  review_provenance_version: string;
  extraction_contract_version: string;
  normalization_version: string;
  stage: string;
  status: string;
  lease_expires_at: string;
};

export type DocumentExtractionProviderProfile =
  | typeof NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE
  | typeof GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE;

export type ConsumedFileGrant = {
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  file_extension: string;
  file_size_bytes: number;
  job_id: string;
};

function client() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) throw new Error("document_extraction_database_unavailable");
  return supabase;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await (client() as unknown as RpcClient).rpc(name, args);
  if (result.error) {
    const code = result.error.code === "42501" ? "denied" : "failed";
    throw new Error(`document_extraction_rpc_${code}:${name}`);
  }
  return result.data as T;
}

function providerRpc(
  providerProfile: DocumentExtractionProviderProfile,
  nvidiaRpc: string,
  googleRpc: string
) {
  if (providerProfile === NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE) return nvidiaRpc;
  if (providerProfile === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE) return googleRpc;
  throw new Error("document_extraction_provider_profile_not_approved");
}

export async function consumeWorkerAssertion(assertion: VerifiedWorkerAssertion) {
  return rpc<boolean>("consume_document_extraction_worker_assertion_v1", {
    p_worker_id: assertion.workerId,
    p_key_version: assertion.keyVersion,
    p_nonce_hash: assertion.nonceHash,
    p_request_hash: assertion.requestHash,
    p_asserted_at: assertion.assertedAt,
    p_expires_at: assertion.expiresAt
  });
}

export async function claimDocumentExtractionJob(
  workerId: string,
  providerProfile: DocumentExtractionProviderProfile,
  leaseSeconds = 120
) {
  const rows = await rpc<ClaimedDocumentExtractionJob[]>(providerRpc(
    providerProfile,
    "claim_document_extraction_job_v2",
    "claim_google_document_extraction_job_v1"
  ), {
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds
  });
  return rows[0] || null;
}

export async function heartbeatDocumentExtractionJob(jobId: string, workerId: string, leaseSeconds = 120) {
  return rpc<boolean>("heartbeat_document_extraction_job_v1", {
    p_job_id: jobId,
    p_worker_id: workerId,
    p_lease_seconds: leaseSeconds
  });
}

export async function resolveDocumentExtractionLease(
  jobId: string,
  workerId: string,
  providerProfile: DocumentExtractionProviderProfile
) {
  const context = await rpc<DocumentExtractionLeaseContext>(providerRpc(
    providerProfile,
    "resolve_document_extraction_job_lease_v1",
    "resolve_google_document_extraction_job_lease_v1"
  ), {
    p_job_id: jobId,
    p_worker_id: workerId
  });
  if (providerProfile === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE) return context;
  return {
    ...context,
    parser_provider: NVIDIA_DOCUMENT_EXTRACTION_PROVIDER,
    parser_model: NVIDIA_DOCUMENT_EXTRACTION_MODEL,
    parser_revision: NVIDIA_DOCUMENT_EXTRACTION_PARSER_REVISION,
    client_revision: NVIDIA_DOCUMENT_EXTRACTION_CLIENT_REVISION,
    provider_profile: NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_PROFILE,
    processor_type: null,
    processor_id: null,
    processor_resource: null,
    processor_location: null,
    processor_version: null,
    endpoint_contract_version: NVIDIA_DOCUMENT_EXTRACTION_ENDPOINT_CONTRACT_VERSION,
    request_serializer_version: NVIDIA_DOCUMENT_EXTRACTION_REQUEST_SERIALIZER_VERSION,
    response_validator_version: NVIDIA_DOCUMENT_EXTRACTION_RESPONSE_VALIDATOR_VERSION,
    provider_normalization_version: NVIDIA_DOCUMENT_EXTRACTION_PROVIDER_NORMALIZATION_VERSION,
    compatibility_policy_version: NVIDIA_DOCUMENT_EXTRACTION_HOSTED_COMPATIBILITY_CONTRACT_VERSION,
    table_policy_version: null,
    confidence_policy_version: null,
    selection_mark_policy_version: null,
    routing_policy_version: DOCUMENT_EXTRACTION_ROUTING_POLICY_VERSION,
    review_provenance_version: DOCUMENT_EXTRACTION_REVIEW_PROVENANCE_VERSION,
    extraction_contract_version: DOCUMENT_EXTRACTION_CONTRACT_VERSION,
    normalization_version: DOCUMENT_EXTRACTION_NORMALIZATION_VERSION
  };
}

export async function advanceDocumentExtractionStage({
  jobId,
  workerId,
  expectedStage,
  nextStage,
  requestId,
  providerProfile
}: {
  jobId: string;
  workerId: string;
  expectedStage: string;
  nextStage: string;
  requestId: string;
  providerProfile: DocumentExtractionProviderProfile;
}) {
  return rpc<{ advanced: boolean; reason?: string; stage?: string; status?: string }>(
    providerRpc(
      providerProfile,
      "advance_document_extraction_job_v2",
      "advance_google_document_extraction_job_v1"
    ),
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_expected_stage: expectedStage,
      p_next_stage: nextStage,
      p_request_id: requestId
    }
  );
}

export async function issueDocumentExtractionFileGrant({
  jobId,
  workerId,
  tokenHash,
  ttlSeconds,
  providerProfile
}: {
  jobId: string;
  workerId: string;
  tokenHash: string;
  ttlSeconds: number;
  providerProfile: DocumentExtractionProviderProfile;
}) {
  return rpc<{ issued: boolean; reason?: string; grant_id?: string; expires_at?: string; page_count?: number }>(
    providerRpc(
      providerProfile,
      "issue_document_extraction_file_grant_v1",
      "issue_google_document_extraction_file_grant_v1"
    ),
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_token_hash: tokenHash,
      p_ttl_seconds: ttlSeconds
    }
  );
}

export async function consumeDocumentExtractionFileGrant({
  grantId,
  workerId,
  tokenHash,
  providerProfile
}: {
  grantId: string;
  workerId: string;
  tokenHash: string;
  providerProfile: DocumentExtractionProviderProfile;
}) {
  return rpc<ConsumedFileGrant>(providerRpc(
    providerProfile,
    "consume_document_extraction_file_grant_v1",
    "consume_google_document_extraction_file_grant_v1"
  ), {
    p_grant_id: grantId,
    p_worker_id: workerId,
    p_token_hash: tokenHash
  });
}

export async function authorizeDocumentExtractionDispatch({
  jobId,
  workerId,
  dispatchRequestId,
  providerProfile
}: {
  jobId: string;
  workerId: string;
  dispatchRequestId: string;
  providerProfile: DocumentExtractionProviderProfile;
}) {
  return rpc<{ authorized: boolean; reason: string; idempotent?: boolean }>(
    providerRpc(
      providerProfile,
      "authorize_document_extraction_dispatch_v2",
      "authorize_google_document_extraction_dispatch_v1"
    ),
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_dispatch_request_id: dispatchRequestId
    }
  );
}

export async function checkDocumentExtractionProviderBoundary({
  jobId,
  workerId,
  boundary,
  providerProfile
}: {
  jobId: string;
  workerId: string;
  boundary: "asset_create" | "asset_upload" | "inference";
  providerProfile: DocumentExtractionProviderProfile;
}) {
  return rpc<{ allowed: boolean; reason: string; boundary: string; lease_expires_at: string | null }>(
    providerRpc(
      providerProfile,
      "check_document_extraction_provider_boundary_v1",
      "check_google_document_extraction_provider_boundary_v1"
    ),
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_boundary: boundary
    }
  );
}

export async function recordDocumentExtractionProviderOutcome({
  jobId,
  workerId,
  dispatchRequestId,
  resultClass,
  latencyMs,
  providerProfile
}: {
  jobId: string;
  workerId: string;
  dispatchRequestId: string;
  resultClass: string;
  latencyMs: number;
  providerProfile: DocumentExtractionProviderProfile;
}) {
  return rpc<{ recorded: boolean; idempotent: boolean; circuit_state: string | null; retry_permitted?: boolean }>(
    providerRpc(
      providerProfile,
      "record_document_extraction_provider_outcome_v1",
      "record_google_document_extraction_provider_outcome_v1"
    ),
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_dispatch_request_id: dispatchRequestId,
      p_result_class: resultClass,
      p_latency_ms: latencyMs
    }
  );
}

export async function authorizeDocumentExtractionRetry({
  jobId,
  workerId,
  priorDispatchRequestId,
  nextDispatchRequestId,
  providerProfile
}: {
  jobId: string;
  workerId: string;
  priorDispatchRequestId: string;
  nextDispatchRequestId: string;
  providerProfile: DocumentExtractionProviderProfile;
}) {
  if (providerProfile === GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE) {
    throw new Error("document_extraction_google_retry_not_permitted");
  }
  return rpc<{ authorized: boolean; reason: string }>(
    "authorize_document_extraction_retry_dispatch_v1",
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_prior_dispatch_request_id: priorDispatchRequestId,
      p_next_dispatch_request_id: nextDispatchRequestId
    }
  );
}

function bytea(value: Uint8Array) {
  return `\\x${Buffer.from(value).toString("hex")}`;
}

export async function completeDocumentExtractionJob({
  jobId,
  workerId,
  artifactFingerprint,
  criticalFieldManifest,
  ciphertext,
  keyVersion,
  nonce,
  authenticationTag,
  aadDigest,
  providerProfile
}: {
  jobId: string;
  workerId: string;
  artifactFingerprint: string;
  criticalFieldManifest:
    | DocumentExtractionCriticalFieldManifestV2
    | DocumentExtractionCriticalFieldManifestV3;
  ciphertext: Uint8Array;
  keyVersion: string;
  nonce: Uint8Array;
  authenticationTag: Uint8Array;
  aadDigest: string;
  providerProfile: DocumentExtractionProviderProfile;
}) {
  return rpc<{
    completed: boolean;
    reason?: "nonce_collision";
    job_id?: string;
    status?: string;
    approval_status?: string;
  }>(
    providerRpc(
      providerProfile,
      "complete_document_extraction_job_v3",
      "complete_google_document_extraction_job_v1"
    ),
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_artifact_fingerprint: artifactFingerprint,
      p_critical_field_manifest_json: criticalFieldManifest,
      p_payload_ciphertext: bytea(ciphertext),
      p_encryption_key_version: keyVersion,
      p_encryption_nonce: bytea(nonce),
      p_authentication_tag: bytea(authenticationTag),
      p_aad_digest: aadDigest
    }
  );
}

export async function failDocumentExtractionJob({
  jobId,
  workerId,
  failureCode,
  failureClass,
  providerProfile
}: {
  jobId: string;
  workerId: string;
  failureCode: string;
  failureClass: string;
  providerProfile: DocumentExtractionProviderProfile;
}) {
  return rpc<{ job_id: string; status: string; retryable: boolean }>(
    providerRpc(
      providerProfile,
      "fail_document_extraction_job_v2",
      "fail_google_document_extraction_job_v1"
    ),
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_failure_code: failureCode,
      p_failure_class: failureClass
    }
  );
}

export async function recordDocumentExtractionTelemetry(args: {
  jobId: string;
  workerId: string;
  requestId: string;
  jobIdHash: string;
  workspaceHash: string;
  latencyMs: number | null;
  validationResult: string | null;
  encryptionResult: string | null;
  cacheResult: string | null;
  costRateVersion: string | null;
  costAmountUsd: number | null;
  providerProfile: DocumentExtractionProviderProfile;
}) {
  return rpc<string>(providerRpc(
    args.providerProfile,
    "record_document_extraction_telemetry_v1",
    "record_google_document_extraction_telemetry_v1"
  ), {
    p_job_id: args.jobId,
    p_worker_id: args.workerId,
    p_request_id: args.requestId,
    p_job_id_hash: args.jobIdHash,
    p_workspace_hash: args.workspaceHash,
    p_latency_ms: args.latencyMs,
    p_validation_result: args.validationResult,
    p_encryption_result: args.encryptionResult,
    p_cache_result: args.cacheResult,
    p_cost_rate_version: args.costRateVersion,
    p_cost_amount_usd: args.costAmountUsd
  });
}

export async function enqueueGoogleDocumentExtractionJob(args: {
  intakeRequestId: string;
  route: "google_primary" | "google_fallback";
  documentClass: string;
  assessmentFingerprint: string;
  pageCount: number;
  parserProvider: string;
  parserModel: string;
  parserRevision: string;
  clientRevision: string;
  contentHmac: string;
  cacheKey: string;
  routingPolicyVersion: string;
  extractionContractVersion: string;
  normalizationVersion: string;
  providerProfile: typeof GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE;
  processorType: string;
  processorId: string;
  processorResource: string;
  processorLocation: string;
  processorVersion: string;
  endpointContractVersion: string;
  requestSerializerVersion: string;
  responseValidatorVersion: string;
  providerNormalizationVersion: string;
  compatibilityPolicyVersion: string;
  tablePolicyVersion: string;
  confidencePolicyVersion: string;
  selectionMarkPolicyVersion: string;
  reviewProvenanceVersion: string;
}) {
  if (args.providerProfile !== GOOGLE_DOCUMENT_EXTRACTION_PROVIDER_PROFILE) {
    throw new Error("document_extraction_provider_profile_not_approved");
  }
  return rpc<Record<string, unknown>>("enqueue_google_document_extraction_job_v1", {
    p_intake_request_id: args.intakeRequestId,
    p_route: args.route,
    p_document_class: args.documentClass,
    p_assessment_fingerprint: args.assessmentFingerprint,
    p_page_count: args.pageCount,
    p_parser_provider: args.parserProvider,
    p_parser_model: args.parserModel,
    p_parser_revision: args.parserRevision,
    p_client_revision: args.clientRevision,
    p_content_hmac: args.contentHmac,
    p_cache_key: args.cacheKey,
    p_routing_policy_version: args.routingPolicyVersion,
    p_extraction_contract_version: args.extractionContractVersion,
    p_normalization_version: args.normalizationVersion,
    p_provider_profile: args.providerProfile,
    p_processor_type: args.processorType,
    p_processor_id: args.processorId,
    p_processor_resource: args.processorResource,
    p_processor_location: args.processorLocation,
    p_processor_version: args.processorVersion,
    p_endpoint_contract_version: args.endpointContractVersion,
    p_request_serializer_version: args.requestSerializerVersion,
    p_response_validator_version: args.responseValidatorVersion,
    p_provider_normalization_version: args.providerNormalizationVersion,
    p_compatibility_policy_version: args.compatibilityPolicyVersion,
    p_table_policy_version: args.tablePolicyVersion,
    p_confidence_policy_version: args.confidencePolicyVersion,
    p_selection_mark_policy_version: args.selectionMarkPolicyVersion,
    p_review_provenance_version: args.reviewProvenanceVersion
  });
}

// This remains broker-internal. The worker never decrypts cache payloads and is
// therefore not given a public operation that can invalidate historical data.
export async function invalidateDocumentExtractionCacheForJob(jobId: string, reasonCode: string) {
  return rpc<{ invalidated: boolean; cache_id?: string; job_id?: string; reason?: string }>(
    "invalidate_document_extraction_cache_for_job_v1",
    { p_job_id: jobId, p_reason_code: reasonCode }
  );
}
