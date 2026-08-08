#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"

WORKER_POOL="${WORKER_POOL:-vaeroex-document-extraction-preview}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview shutdown confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ] \
  || [ "$WORKER_POOL" != "vaeroex-document-extraction-preview" ]; then
  printf '%s\n' "Only the isolated Preview worker may be disabled by this script." >&2
  exit 2
fi

gcloud run worker-pools update "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --instances 0 \
  --update-env-vars "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=false,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=false,DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=false,DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_ENABLED=false,DOCUMENT_EXTRACTION_FIELD_PATH_DIAGNOSTIC_ENABLED=false" \
  --remove-env-vars "DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_CONFIRMATION,DOCUMENT_EXTRACTION_FIELD_PATH_DIAGNOSTIC_CONFIRMATION" \
  --quiet >/dev/null

instances="$(gcloud run worker-pools describe "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --format 'value(scaling.manualInstanceCount)')"
if [ -z "$instances" ]; then
  instances="$(gcloud run worker-pools describe "$WORKER_POOL" \
    --project "$GCP_PROJECT_ID" \
    --region "$GCP_REGION" \
    --format "value(metadata.annotations['run.googleapis.com/manualInstanceCount'])")"
fi
test "$instances" = "0"
printf '%s\n' "Preview worker disabled and scaled to zero."
