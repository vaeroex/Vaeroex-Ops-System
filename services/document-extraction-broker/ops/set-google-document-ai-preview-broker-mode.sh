#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${BROKER_SERVICE:?BROKER_SERVICE is required}"
: "${BROKER_MODE:?BROKER_MODE is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"
: "${GOOGLE_QUALIFICATION_CONFIRMATION:?GOOGLE_QUALIFICATION_CONFIRMATION is required}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview broker confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ]; then
  printf '%s\n' "Only the isolated Phase C1 Google project and region are accepted." >&2
  exit 2
fi
case "$BROKER_SERVICE" in
  vaeroex-doc-broker-pr265-???????|vaeroex-doc-broker-pr265-????????|vaeroex-doc-broker-pr265-????????????) ;;
  *) printf '%s\n' "BROKER_SERVICE must be bound to the PR #265 commit." >&2; exit 2 ;;
esac

case "$BROKER_MODE" in
  inert)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "disable-google-document-ai-preview"
    values="DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=false,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=false"
    remove_approval=true
    ;;
  authentication)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "google-document-ai-auth-zero-provider-calls"
    values="DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=true,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=false"
    remove_approval=true
    ;;
  one-page)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "google-document-ai-one-page-one-call-zero-retry"
    values="DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=true,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=true,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=true,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=true,DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL=google_document_ai_preview_qualification_v1"
    remove_approval=false
    ;;
  frozen-corpus)
    test "$GOOGLE_QUALIFICATION_CONFIRMATION" = "google-document-ai-frozen-corpus-12-documents-13-pages-zero-retry"
    values="DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=true,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=true,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=true,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=true,DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL=google_document_ai_preview_qualification_v1"
    remove_approval=false
    ;;
  *) printf '%s\n' "BROKER_MODE is invalid." >&2; exit 2 ;;
esac

if [ "$remove_approval" = true ]; then
  gcloud run services update "$BROKER_SERVICE" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --update-env-vars "$values" \
    --remove-env-vars "DOCUMENT_EXTRACTION_GOOGLE_PREVIEW_APPROVAL" \
    --quiet >/dev/null
else
  gcloud run services update "$BROKER_SERVICE" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --update-env-vars "$values" \
    --quiet >/dev/null
fi

printf '%s\n' "Google Document AI Preview broker mode updated: $BROKER_MODE."
