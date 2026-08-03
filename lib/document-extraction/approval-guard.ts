import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENT_EXTRACTION_REVIEW_VERSION,
  type DocumentExtractionApprovalEnvelopeV1
} from "@/lib/document-extraction/contracts";
import type { Database, Json } from "@/lib/supabase/types";

export type FileAnalysisExtractionAuthority =
  | { mode: "existing_native_file_analysis" }
  | { mode: "unapproved_document_extraction" }
  | DocumentExtractionApprovalEnvelopeV1;

export type DocumentExtractionAuthorityResult = {
  eligible: boolean;
  reason: "existing_native_compatibility" | "eligible" | "approval_missing_or_stale" | "authority_check_failed";
};

function isRecord(value: Json | undefined): value is Record<string, Json | undefined> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function existingNativeFileAnalysisAuthority(): FileAnalysisExtractionAuthority {
  return { mode: "existing_native_file_analysis" };
}

export function reviewedDocumentExtractionAuthority(
  envelope: Omit<DocumentExtractionApprovalEnvelopeV1, "mode" | "reviewVersion">
): FileAnalysisExtractionAuthority {
  return { ...envelope, mode: "reviewed_document_extraction", reviewVersion: DOCUMENT_EXTRACTION_REVIEW_VERSION };
}

function stringValue(value: Json | undefined) {
  return typeof value === "string" ? value : "";
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveFileAnalysisExtractionAuthority(metadata: Json): FileAnalysisExtractionAuthority {
  const record = isRecord(metadata) ? metadata : {};
  const authority = isRecord(record.document_extraction_authority) ? record.document_extraction_authority : null;
  const jobMarker = stringValue(record.document_extraction_job_id) || stringValue(authority?.job_id);
  if (!jobMarker) return existingNativeFileAnalysisAuthority();

  const reviewId = stringValue(authority?.review_id);
  const artifactFingerprint = stringValue(authority?.artifact_fingerprint);
  const classificationFingerprint = stringValue(authority?.classification_fingerprint);
  if (
    !uuidPattern.test(jobMarker)
    || !uuidPattern.test(reviewId)
    || !/^[0-9a-f]{64}$/.test(artifactFingerprint)
    || !/^[0-9a-f]{64}$/.test(classificationFingerprint)
    || authority?.review_version !== DOCUMENT_EXTRACTION_REVIEW_VERSION
  ) return { mode: "unapproved_document_extraction" };

  return reviewedDocumentExtractionAuthority({
    jobId: jobMarker,
    reviewId,
    artifactFingerprint,
    classificationFingerprint
  });
}

export function pendingDocumentExtractionAuthorityMetadata(jobId: string): Json {
  return { document_extraction_job_id: jobId, document_extraction_authority: { job_id: jobId } };
}

export function documentExtractionAuthorityMetadata(authority: DocumentExtractionApprovalEnvelopeV1): Json {
  return {
    document_extraction_authority: {
      job_id: authority.jobId,
      review_id: authority.reviewId,
      artifact_fingerprint: authority.artifactFingerprint,
      classification_fingerprint: authority.classificationFingerprint,
      review_version: authority.reviewVersion
    }
  };
}

export async function assertDocumentExtractionAuthority({
  supabase,
  workspaceId,
  fileId,
  authority,
  metadata
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  fileId: string;
  authority: FileAnalysisExtractionAuthority;
  metadata?: Json;
}): Promise<DocumentExtractionAuthorityResult> {
  if (authority.mode === "unapproved_document_extraction") {
    return { eligible: false, reason: "approval_missing_or_stale" };
  }
  if (authority.mode === "existing_native_file_analysis") {
    const record = isRecord(metadata) ? metadata : {};
    if (record.document_extraction_authority || record.document_extraction_job_id) {
      return { eligible: false, reason: "approval_missing_or_stale" };
    }
    return { eligible: true, reason: "existing_native_compatibility" };
  }

  const { data, error } = await supabase.rpc("assert_document_extraction_authority_v1", {
    p_workspace_id: workspaceId,
    p_file_id: fileId,
    p_job_id: authority.jobId,
    p_review_id: authority.reviewId,
    p_artifact_fingerprint: authority.artifactFingerprint,
    p_classification_fingerprint: authority.classificationFingerprint,
    p_review_version: authority.reviewVersion
  });
  if (error || !isRecord(data)) return { eligible: false, reason: "authority_check_failed" };
  return data.eligible === true
    ? { eligible: true, reason: "eligible" }
    : { eligible: false, reason: "approval_missing_or_stale" };
}
