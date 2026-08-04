#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"
: "${QUALIFICATION_CONFIRMATION:?QUALIFICATION_CONFIRMATION is required}"

WORKER_POOL="${WORKER_POOL:-vaeroex-document-extraction-preview}"
if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview qualification environment confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ] \
  || [ "$WORKER_POOL" != "vaeroex-document-extraction-preview" ]; then
  printf '%s\n' "Only the isolated Preview worker may enter qualification mode." >&2
  exit 2
fi
if [ "$QUALIFICATION_CONFIRMATION" != "synthetic-preview-only-12-documents-13-pages" ]; then
  printf '%s\n' "Synthetic qualification confirmation did not match." >&2
  exit 2
fi

gcloud run worker-pools update "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --update-env-vars "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=true,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=true,DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=true,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=true,DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_ENABLED=false" \
  --remove-env-vars "DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_CONFIRMATION" \
  --instances 1 \
  --quiet >/dev/null

printf '%s\n' "One Preview worker instance enabled for the bounded synthetic window."
