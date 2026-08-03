import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { VerifiedWorkerAssertion } from "@/lib/document-extraction/broker-auth";
import type { DocumentExtractionCriticalFieldManifestV1 } from "@/lib/document-extraction/contracts";

type RpcResult = { data: unknown; error: { message?: string; code?: string } | null };
type RpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
};

export type ClaimedDocumentExtractionJob = {
  id: string;
  route: "nvidia_primary" | "nvidia_fallback";
  document_class: string;
  page_count: number;
  lease_expires_at: string;
};

export type DocumentExtractionLeaseContext = {
  job_id: string;
  workspace_id: string;
  route: "nvidia_primary" | "nvidia_fallback";
  document_class: string;
  page_count: number;
  cache_key: string;
  extraction_contract_version: string;
  normalization_version: string;
  stage: string;
  status: string;
  lease_expires_at: string;
};

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

export async function claimDocumentExtractionJob(workerId: string, leaseSeconds = 120) {
  const rows = await rpc<ClaimedDocumentExtractionJob[]>("claim_document_extraction_job_v2", {
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

export async function resolveDocumentExtractionLease(jobId: string, workerId: string) {
  return rpc<DocumentExtractionLeaseContext>("resolve_document_extraction_job_lease_v1", {
    p_job_id: jobId,
    p_worker_id: workerId
  });
}

export async function advanceDocumentExtractionStage({
  jobId,
  workerId,
  expectedStage,
  nextStage,
  requestId
}: {
  jobId: string;
  workerId: string;
  expectedStage: string;
  nextStage: string;
  requestId: string;
}) {
  return rpc<{ advanced: boolean; reason?: string; stage?: string; status?: string }>(
    "advance_document_extraction_job_v2",
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
  ttlSeconds
}: {
  jobId: string;
  workerId: string;
  tokenHash: string;
  ttlSeconds: number;
}) {
  return rpc<{ issued: boolean; reason?: string; grant_id?: string; expires_at?: string; page_count?: number }>(
    "issue_document_extraction_file_grant_v1",
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
  tokenHash
}: {
  grantId: string;
  workerId: string;
  tokenHash: string;
}) {
  return rpc<ConsumedFileGrant>("consume_document_extraction_file_grant_v1", {
    p_grant_id: grantId,
    p_worker_id: workerId,
    p_token_hash: tokenHash
  });
}

export async function authorizeDocumentExtractionDispatch({
  jobId,
  workerId,
  dispatchRequestId
}: {
  jobId: string;
  workerId: string;
  dispatchRequestId: string;
}) {
  return rpc<{ authorized: boolean; reason: string; idempotent?: boolean }>(
    "authorize_document_extraction_dispatch_v2",
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_dispatch_request_id: dispatchRequestId
    }
  );
}

export async function recordDocumentExtractionProviderOutcome({
  jobId,
  workerId,
  dispatchRequestId,
  resultClass,
  latencyMs
}: {
  jobId: string;
  workerId: string;
  dispatchRequestId: string;
  resultClass: string;
  latencyMs: number;
}) {
  return rpc<{ recorded: boolean; idempotent: boolean; circuit_state: string | null; retry_permitted?: boolean }>(
    "record_document_extraction_provider_outcome_v1",
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
  nextDispatchRequestId
}: {
  jobId: string;
  workerId: string;
  priorDispatchRequestId: string;
  nextDispatchRequestId: string;
}) {
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
  aadDigest
}: {
  jobId: string;
  workerId: string;
  artifactFingerprint: string;
  criticalFieldManifest: DocumentExtractionCriticalFieldManifestV1;
  ciphertext: Uint8Array;
  keyVersion: string;
  nonce: Uint8Array;
  authenticationTag: Uint8Array;
  aadDigest: string;
}) {
  return rpc<{ job_id: string; status: string; approval_status: string }>(
    "complete_document_extraction_job_v2",
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
  failureClass
}: {
  jobId: string;
  workerId: string;
  failureCode: string;
  failureClass: string;
}) {
  return rpc<{ job_id: string; status: string; retryable: boolean }>(
    "fail_document_extraction_job_v2",
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
}) {
  return rpc<string>("record_document_extraction_telemetry_v1", {
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

// This remains broker-internal. The worker never decrypts cache payloads and is
// therefore not given a public operation that can invalidate historical data.
export async function invalidateDocumentExtractionCacheForJob(jobId: string, reasonCode: string) {
  return rpc<{ invalidated: boolean; cache_id?: string; job_id?: string; reason?: string }>(
    "invalidate_document_extraction_cache_for_job_v1",
    { p_job_id: jobId, p_reason_code: reasonCode }
  );
}
