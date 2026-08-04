#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"
: "${AUTH_QUALIFICATION_CONFIRMATION:?AUTH_QUALIFICATION_CONFIRMATION is required}"

WORKER_POOL="${WORKER_POOL:-vaeroex-document-extraction-preview}"
if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview authentication environment confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ] \
  || [ "$WORKER_POOL" != "vaeroex-document-extraction-preview" ]; then
  printf '%s\n' "Only the isolated Preview worker may enter authentication mode." >&2
  exit 2
fi
if [ "$AUTH_QUALIFICATION_CONFIRMATION" != "cloud-run-broker-auth-zero-provider-calls" ]; then
  printf '%s\n' "Broker authentication confirmation did not match." >&2
  exit 2
fi

gcloud run worker-pools update "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --update-env-vars "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=true,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=false,DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED=true,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=false" \
  --instances 1 \
  --quiet >/dev/null

printf '%s\n' "One Preview worker enabled for zero-provider broker authentication proof."
