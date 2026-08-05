#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${WORKER_MODE:?WORKER_MODE is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"
: "${GOOGLE_QUALIFICATION_CONFIRMATION:?GOOGLE_QUALIFICATION_CONFIRMATION is required}"

WORKER_POOL="${WORKER_POOL:-vaeroex-document-extraction-preview}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview environment confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] \
  || [ "$GCP_REGION" != "us-west1" ] \
  || [ "$WORKER_POOL" != "vaeroex-document-extraction-preview" ]; then
  printf '%s\n' "Only the isolated Preview worker may change mode." >&2
  exit 2
fi

case "$WORKER_MODE" in
  disabled)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "disable-google-document-ai-preview"
    values="DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=false,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=false,DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=false"
    instances=0
    remove_approval=true
    ;;
  authentication)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "google-document-ai-auth-zero-provider-calls"
    values="DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=true,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=false,DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED=true,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=false"
    instances=1
    remove_approval=true
    ;;
  one-page)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "google-document-ai-one-page-one-call-zero-retry"
    values="DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=true,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=true,DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=true,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=true,DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL=google_document_ai_preview_qualification_v1"
    instances=1
    remove_approval=false
    ;;
  frozen-corpus)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "google-document-ai-frozen-corpus-12-documents-13-pages-zero-retry"
    values="DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=true,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=true,DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=true,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=true,DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL=google_document_ai_preview_qualification_v1"
    instances=1
    remove_approval=false
    ;;
  *) printf '%s\n' "WORKER_MODE is invalid." >&2; exit 2 ;;
esac

if [ "$remove_approval" = true ]; then
  gcloud run worker-pools update "$WORKER_POOL" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --instances "$instances" \
    --update-env-vars "$values" \
    --remove-env-vars "DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL" \
    --quiet >/dev/null
else
  gcloud run worker-pools update "$WORKER_POOL" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --instances "$instances" \
    --update-env-vars "$values" \
    --quiet >/dev/null
fi

printf '%s\n' "Google Document AI Preview worker mode updated: $WORKER_MODE."
