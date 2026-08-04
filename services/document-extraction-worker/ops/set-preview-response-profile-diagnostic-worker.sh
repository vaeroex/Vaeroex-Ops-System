#!/bin/sh
set -eu

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${PHASE_C1_PREVIEW_CONFIRMATION:?PHASE_C1_PREVIEW_CONFIRMATION is required}"
: "${RESPONSE_PROFILE_DIAGNOSTIC_CONFIRMATION:?RESPONSE_PROFILE_DIAGNOSTIC_CONFIRMATION is required}"

WORKER_POOL="${WORKER_POOL:-vaeroex-document-extraction-preview}"

if [ "$PHASE_C1_PREVIEW_CONFIRMATION" != "vaeroex-document-extraction-phase-c1-preview-only" ]; then
  printf '%s\n' "Preview diagnostic environment confirmation did not match." >&2
  exit 2
fi
if [ "$GCP_PROJECT_ID" != "vaeroex-document-worker" ] || [ "$GCP_REGION" != "us-west1" ] \
  || [ "$WORKER_POOL" != "vaeroex-document-extraction-preview" ]; then
  printf '%s\n' "Only the isolated Preview worker may enter response-profile diagnostic mode." >&2
  exit 2
fi
if [ "$RESPONSE_PROFILE_DIAGNOSTIC_CONFIRMATION" != "nemotron-parse-response-profile-one-call-v1" ]; then
  printf '%s\n' "One-call response-profile diagnostic confirmation did not match." >&2
  exit 2
fi

gcloud run worker-pools update "$WORKER_POOL" \
  --project "$GCP_PROJECT_ID" \
  --region "$GCP_REGION" \
  --update-env-vars "DOCUMENT_EXTRACTION_PRIVATE_WORKER_ENABLED=true,DOCUMENT_EXTRACTION_PROVIDER_EXECUTION_ENABLED=true,DOCUMENT_EXTRACTION_BROKER_AUTH_QUALIFICATION_ENABLED=false,DOCUMENT_EXTRACTION_SYNTHETIC_QUALIFICATION_ENABLED=true,DOCUMENT_EXTRACTION_SYNTHETIC_PROVIDER_CALLS_ENABLED=true,DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_ENABLED=true,DOCUMENT_EXTRACTION_RESPONSE_PROFILE_DIAGNOSTIC_CONFIRMATION=$RESPONSE_PROFILE_DIAGNOSTIC_CONFIRMATION" \
  --instances 1 \
  --quiet >/dev/null

printf '%s\n' "One Preview worker instance enabled for one-call response-profile diagnostics."
