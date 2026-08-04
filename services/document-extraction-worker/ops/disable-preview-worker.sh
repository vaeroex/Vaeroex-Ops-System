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

gcloud run worker-pools update "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --instances 0 \
  --update-env-vars "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=false,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=false" \
  --quiet >/dev/null

instances="$(gcloud run worker-pools describe "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --format 'value(scaling.manualInstanceCount)')"
test "$instances" = "0"
printf '%s\n' "Preview worker disabled and scaled to zero."
