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
  authority: FileAnalysisExtractionAuthority;
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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  fileId
}: {
  supabase: SupabaseClient<Database>;
  workspaceId: string;
  fileId: string;
}): Promise<DocumentExtractionAuthorityResult> {
  const unapproved: FileAnalysisExtractionAuthority = { mode: "unapproved_document_extraction" };
  const { data, error } = await supabase.rpc("resolve_document_extraction_file_authority_v1", {
    p_workspace_id: workspaceId,
    p_file_id: fileId
  });
  if (error || !isRecord(data)) {
    return { eligible: false, reason: "authority_check_failed", authority: unapproved };
  }
  if (data.eligible === true && data.mode === "existing_native_file_analysis") {
    return {
      eligible: true,
      reason: "existing_native_compatibility",
      authority: existingNativeFileAnalysisAuthority()
    };
  }

  const jobId = typeof data.job_id === "string" ? data.job_id : "";
  const reviewId = typeof data.review_id === "string" ? data.review_id : "";
  const artifactFingerprint = typeof data.artifact_fingerprint === "string" ? data.artifact_fingerprint : "";
  const classificationFingerprint = typeof data.classification_fingerprint === "string" ? data.classification_fingerprint : "";
  if (
    data.eligible !== true
    || data.mode !== "reviewed_document_extraction"
    || !uuidPattern.test(jobId)
    || !uuidPattern.test(reviewId)
    || !/^[0-9a-f]{64}$/.test(artifactFingerprint)
    || !/^[0-9a-f]{64}$/.test(classificationFingerprint)
    || data.review_version !== DOCUMENT_EXTRACTION_REVIEW_VERSION
  ) {
    return { eligible: false, reason: "approval_missing_or_stale", authority: unapproved };
  }

  return {
    eligible: true,
    reason: "eligible",
    authority: reviewedDocumentExtractionAuthority({
      jobId,
      reviewId,
      artifactFingerprint,
      classificationFingerprint
    })
  };
}
